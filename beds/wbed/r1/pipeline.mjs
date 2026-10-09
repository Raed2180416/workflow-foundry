// The bed's own exact solver for R1, written as the four-stage pipeline of W-BED §3.1 (extract -> normalise ->
// reconcile -> report) over the hidden world. referenceSolve runs it with no options; each bad control runs it with one
// option that reproduces one plausible mistake, so a control's per-stage outputs (its trace) can be scored by the stage
// oracles. This is the oracle's reference, not the hand-curated reference workflow (arm c), which is written later.
import { isoDay, refKey, toUsdCents, minorDigits, swappedDay } from '../lib/domain.mjs';
import { STATUS_WORDS, statusLiveOf } from './vocab.mjs';
import { usdOf } from './world.mjs';

// ---- stage 1: extract (one record per line of every input; surface text kept, nothing interpreted)
export function extract(world) {
  const R = world.render;
  return {
    customer_rows: world.rw.allRows.map(x => ({ row: x.rowId, system: x.system, void: Boolean(x.void) })).sort((a, b) => a.row - b.row),
    invoices: world.invoices.map(i => {
      const t = R.invText.get(i.no);
      return { invoice: i.no, system: i.system, row: i.row, date_text: t.date, currency: i.currency, amount_minor: i.minor, status_text: t.status };
    }),
    payments: world.payments.map((p, line) => ({ line, kind: p.kind, ref: p.ref, date: isoDay(p.day), currency: p.currency, amount_minor: p.minor, invoice_ref: p.invText, payer: p.payerText })),
  };
}

// How a reader dates an invoice. opts.atlasFlip reads every numeric ATLAS date in the other order; opts.atlasOldOrder
// reads every ATLAS date with the pre-switch order; opts.tallyMonthFirst reads TALLY dates month first.
function readDay(world, inv, opts) {
  const ambiguous = swappedDay(inv.day);
  if (ambiguous === null) return inv.day;
  if (inv.system === 'ATLAS') {
    if (opts.atlasFlip) return ambiguous;
    if (opts.atlasOldOrder && world.conv.atlasSwitch !== null && inv.style !== world.conv.atlasPre) return ambiguous;
  }
  if (inv.system === 'TALLY' && opts.tallyMonthFirst) return ambiguous;
  return inv.day;
}
function liveStatus(inv, opts) {
  if (opts.voidStatusCounted && inv.status === 'void' && !inv.flag) return true;
  if (opts.flagFlipped && inv.flag) return inv.flagPolarity !== 'live';
  return statusLiveOf(inv);
}

// ---- stage 2: normalise (per document: ISO date, US cents, and whether the document's own fields let it count)
export function normalise(world, opts = {}) {
  const close = world.conv.close;
  const usd = (currency, minor) => (opts.unconverted ? minor * 10 ** (2 - minorDigits(currency)) : usdOf(world, currency, minor));
  return {
    invoices: world.invoices.map(i => {
      const day = readDay(world, i, opts);
      return { invoice: i.no, row: i.row, date: isoDay(day), usd_cents: usd(i.currency, i.minor), live: liveStatus(i, opts) && (opts.ignoreClose || day <= close) };
    }),
    payments: world.payments.map((p, line) => ({ line, kind: p.kind, ref: p.ref, date: isoDay(p.day), usd_cents: usd(p.currency, p.minor),
      invoice_key: refKey(p.invText), in_period: Boolean(opts.ignoreClose || p.day <= close) })),
  };
}

// ---- stage 3: reconcile (identity resolution of the customer rows: records' truth clusters)
export function reconcile(world, opts = {}) {
  if (opts.noDedup) return { customers: world.rw.rows.map(x => ({ customer_id: x.rowId, source_rows: [x.rowId] })).sort((a, b) => a.customer_id - b.customer_id) };
  return { customers: world.customers.map(c => ({ customer_id: c.customer_id, source_rows: [...c.source_rows] })).sort((a, b) => a.customer_id - b.customer_id) };
}

// ---- stage 4: report (attach documents to customers through the row and invoice relations, convert, total)
export function report(world, ex, no, rc, opts = {}) {
  const ownerOfRow = new Map();
  for (const c of rc.customers) for (const r of c.source_rows) ownerOfRow.set(r, c.customer_id);
  const twinOwner = new Map(); // opts.voidRowKept: a twin void row's invoices go to the customer it links to
  if (opts.voidRowKept) for (const v of world.rw.voids) if (v.twinOf !== undefined) twinOwner.set(v.rowId, world.entityCluster.get(v.twinOf));
  const exInv = new Map(ex.invoices.map(i => [i.invoice, i]));
  const ownerOfInvoice = inv => {
    let o = ownerOfRow.get(inv.row);
    if (o === undefined && opts.voidRowKept) o = twinOwner.get(inv.row);
    if (o !== undefined && opts.canonicalOnly && inv.row !== o) o = undefined;
    return o;
  };
  const acc = new Map(rc.customers.map(c => [c.customer_id, { inv: 0, paid: 0, invMinor: new Map(), paidMinor: new Map() }]));
  const add = (bucket, kind, currency, minor, cents) => {
    if (opts.roundAtEnd) { const m = bucket[`${kind}Minor`]; m.set(currency, (m.get(currency) ?? 0) + minor); } else bucket[kind] += cents;
  };
  const counted = new Map(); // invoice key -> { inv (normalised), owner }
  const worldInv = new Map(world.invoices.map(i => [i.no, i]));
  for (const ni of no.invoices) {
    if (!ni.live) continue;
    const owner = ownerOfInvoice(ni);
    if (owner === undefined) continue;
    const wi = worldInv.get(ni.invoice);
    counted.set(refKey(ni.invoice), { ni, owner, wi });
    add(acc.get(owner), 'inv', wi.currency, wi.minor, ni.usd_cents);
  }
  // Payments. Default: PAY lines only, one per bank reference.
  const trusted = new Set(); // opts.statusPaidTrusted: invoices whose billing status says paid are paid in full
  if (opts.statusPaidTrusted) {
    for (const [k, c] of counted) {
      if (exInv.get(c.ni.invoice).status_text === STATUS_WORDS[c.wi.system].paid && !c.wi.flag) { trusted.add(k); add(acc.get(c.owner), 'paid', c.wi.currency, c.wi.minor, c.ni.usd_cents); }
    }
  }
  const seenRef = new Set();
  for (const np of no.payments) {
    if (!opts.remitDouble) {
      if (np.kind !== 'PAY' || seenRef.has(np.ref)) continue;
      seenRef.add(np.ref);
    }
    if (!np.in_period) continue;
    const c = counted.get(np.invoice_key);
    if (!c || trusted.has(np.invoice_key)) continue;
    const wp = world.payments[np.line];
    const owner = opts.payerCredited ? (world.entityCluster.get(wp.payer) ?? c.owner) : c.owner;
    add(acc.get(owner), 'paid', wp.currency, wp.minor, np.usd_cents);
  }
  const customers = rc.customers.map(c => {
    const a = acc.get(c.customer_id);
    let inv = a.inv, paid = a.paid;
    if (opts.roundAtEnd) {
      for (const [cur, m] of a.invMinor) inv += toUsdCents(m, cur, world.fx.cur[cur]);
      for (const [cur, m] of a.paidMinor) paid += toUsdCents(m, cur, world.fx.cur[cur]);
    }
    return { customer_id: c.customer_id, source_rows: [...c.source_rows].sort((x, y) => x - y), invoiced_usd_cents: inv, paid_usd_cents: paid, open_usd_cents: inv - paid };
  });
  const sum = f => customers.reduce((s, c) => s + c[f], 0);
  return { customers, totals: { customers: customers.length, invoiced_usd_cents: sum('invoiced_usd_cents'), paid_usd_cents: sum('paid_usd_cents'), open_usd_cents: sum('open_usd_cents') } };
}

/** Full trace { extract, normalise, reconcile, report } under `opts` (default: the exact solver). */
export function runPipeline(world, opts = {}) {
  const ex = extract(world);
  const no = normalise(world, opts);
  const rc = reconcile(world, opts);
  return { extract: ex, normalise: no, reconcile: rc, report: report(world, ex, no, rc, opts) };
}

/** Only the final report (cheap path for the decisiveness check: no extract text needed). */
export function solveReport(world, opts = {}) {
  const no = normaliseLite(world, opts);
  const rc = reconcile(world, opts);
  return report(world, liteExtract(world), no, rc, opts);
}
// Before rendering exists (inside the generator's acceptance loop), references and status texts are the canonical ones.
function liteExtract(world) {
  return { invoices: world.invoices.map(i => ({ invoice: i.no, status_text: i.flag ? i.flag : STATUS_WORDS[i.system][i.status] })) };
}
function normaliseLite(world, opts) {
  const close = world.conv.close;
  const usd = (currency, minor) => (opts.unconverted ? minor * 10 ** (2 - minorDigits(currency)) : usdOf(world, currency, minor));
  return {
    invoices: world.invoices.map(i => { const day = readDay(world, i, opts); return { invoice: i.no, row: i.row, usd_cents: usd(i.currency, i.minor), live: liveStatus(i, opts) && (opts.ignoreClose || day <= close) }; }),
    payments: world.payments.map((p, line) => ({ line, kind: p.kind, ref: p.ref, usd_cents: usd(p.currency, p.minor), invoice_key: refKey(p.invNo), in_period: Boolean(opts.ignoreClose || p.day <= close) })),
  };
}
