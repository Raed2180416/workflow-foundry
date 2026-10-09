// The bed's own exact solver for R4, written as the reference outline's stages (children -> translate -> pair ->
// eliminate -> report) over the hidden world. referenceSolve runs it with no options; each bad control runs it with one
// option that reproduces one plausible mistake, so every control has a full trace for the stage oracles. This is the
// oracle's reference, not the hand-curated reference workflow (arm c), which Opus writes later against flow-v3.
import { minorDigits } from '../lib/domain.mjs';
import { translateMinor } from '../lib/fx.mjs';
import { FAMILIES, buildLedger, misreadTrace } from './children.mjs';
import { childTruthTrace, rateKeyOf } from './world.mjs';
import { periodKey } from './vocab.mjs';

const CHILD_ERROR_CONTROL = 'remittance-double-count'; // an R1 relation control: every R1 stage passes, X2 fails

// ---- stage 0: children (each pack solved by its own rung's exact solver)
// Control outputs of a pack are pure functions of the pack: memoised by its task object (shared by every re-draw).
const memoOut = new WeakMap();
const memo = (task, key, fn) => { let m = memoOut.get(task); if (!m) memoOut.set(task, m = {}); return (m[key] ??= fn()); };
export function children(world, opts = {}, { traces = true } = {}) {
  const errorKid = world.subs.find(s => s.family === 'wbed-r1' && !s.planted);
  return world.subs.map(s => {
    if (opts.childError && s === errorKid) {
      const c = FAMILIES['wbed-r1'].badControls.find(x => x.name === CHILD_ERROR_CONTROL);
      const trace = traces ? c.trace(s.task) : null;
      return { sub_id: s.id, family: s.family, output: trace ? structuredClone(trace.report) : structuredClone(memo(s.task, 'error', () => c.make(s.task))), trace };
    }
    if (opts.outsideReused && s.planted) {
      const misread = () => misreadTrace(buildLedger(s.spec.seed, s.spec.split, s.spec.difficulty), s.planted.system);
      const trace = traces ? misread() : null;
      return { sub_id: s.id, family: s.family, output: structuredClone(trace ? trace.report : memo(s.task, 'misread', () => misread().report)), trace };
    }
    return { sub_id: s.id, family: s.family, output: structuredClone(s.output), trace: traces ? childTruthTrace(s) : null };
  });
}

// ---- translation helpers
const mdOf = opts => (opts.jpyCents ? c => (c === 'JPY' ? 2 : minorDigits(c)) : minorDigits);
export function tr(world, minor, currency, rateKey, opts = {}) {
  const G = world.groupCurrency;
  if (currency === G) return minor;
  const q4 = world.rates[rateKey]?.[currency];
  return translateMinor(minor, currency, G, q4, { inverted: !!opts.fxInverted, mdOf: mdOf(opts) });
}
const sumBy = (xs, key, val) => { const m = new Map(); for (const x of xs) m.set(key(x), (m.get(key(x)) ?? 0) + val(x)); return m; };

/** External balances of one pack from its output, by the stated rule (section 3-4 of the group spec). */
export function externalOf(world, sub, output, opts = {}) {
  const key = opts.rateDateGroup ? rateKeyOf(world, world.groupDate) : rateKeyOf(world, sub.reportDate);
  if (sub.family === 'wbed-r1') {
    const field = opts.recAtInvoiced ? 'invoiced_usd_cents' : 'open_usd_cents';
    const rec = opts.extPerLine ? output.customers.reduce((a, c) => a + tr(world, c[field], 'USD', key, opts), 0) : tr(world, output.totals[field], 'USD', key, opts);
    return { rec, pay: 0 };
  }
  const field = opts.payAtStatement ? 'statement_balance_minor' : 'adjusted_balance_minor';
  const pay = opts.extPerLine
    ? output.statements.reduce((a, v) => a + tr(world, v[field], v.currency, key, opts), 0)
    : [...sumBy(output.statements, v => v.currency, v => v[field])].reduce((a, [c, m]) => a + tr(world, m, c, key, opts), 0);
  return { rec: 0, pay };
}
/** Intercompany balances of one subsidiary (section 5): per currency sums, each translated once at the group date. */
export function icOf(world, subId, opts = {}) {
  const key = rateKeyOf(world, world.groupDate);
  const side = s => {
    const xs = world.items.filter(x => x.sub === subId && x.side === s);
    if (opts.perItem) return xs.reduce((a, x) => a + tr(world, x.minor, x.currency, key, opts), 0);
    return [...sumBy(xs, x => x.currency, x => x.minor)].reduce((a, [c, m]) => a + tr(world, m, c, key, opts), 0);
  };
  return { rec: side('R'), pay: side('P') };
}

// ---- stage 1: translate
export function translate(world, kids, opts = {}) {
  return {
    subsidiaries: world.subs.map((s, i) => {
      const e = externalOf(world, s, kids[i].output, opts), ic = icOf(world, s.id, opts);
      return { sub_id: s.id, external_receivables_minor: e.rec, external_payables_minor: e.pay, ic_receivables_minor: ic.rec, ic_payables_minor: ic.pay };
    }),
  };
}

// ---- stage 2: pair (the judged step: memo meaning plus exact amount)
/** Amount-only pairing: each payable, in schedule order, takes the first unpaired receivable of the counterparty against
 *  this subsidiary with the same currency and amount; memos are not read. */
export function amountOnlyPairs(world) {
  const taken = new Set(), out = [];
  for (const p of world.items.filter(x => x.side === 'P')) {
    const r = world.items.find(x => x.side === 'R' && x.sub === p.cp && x.cp === p.sub && x.currency === p.currency && x.minor === p.minor && !taken.has(x.id));
    if (r) { taken.add(r.id); out.push({ receivable_item: r.id, payable_item: p.id }); }
  }
  return out;
}
/** Memo-only pairing: the same charge for the same period between the two companies; currency and amount not compared. */
export function memoOnlyPairs(world) {
  const taken = new Set(), out = [];
  for (const r of world.items.filter(x => x.side === 'R')) {
    const p = world.items.find(x => x.side === 'P' && x.sub === r.cp && x.cp === r.sub && x.kind === r.kind && periodKey(x.period) === periodKey(r.period) && !taken.has(x.id));
    if (p) { taken.add(p.id); out.push({ receivable_item: r.id, payable_item: p.id }); }
  }
  return out;
}
export function pair(world, opts = {}) {
  if (opts.amountOnly) return { pairs: amountOnlyPairs(world) };
  if (opts.memoOnly) return { pairs: memoOnlyPairs(world) };
  return { pairs: world.pairs.map(x => ({ ...x })) };
}

// ---- stage 3: eliminate
export function eliminationsOf(world, pairs, opts = {}) {
  const key = rateKeyOf(world, world.groupDate);
  const item = new Map(world.items.map(x => [x.id, x]));
  const rows = pairs.map(p => {
    const r = item.get(p.receivable_item);
    const amount = opts.elimUntranslated ? r.minor : tr(world, r.minor, r.currency, key, opts);
    return { receivable_item: p.receivable_item, payable_item: p.payable_item, amount_minor: amount };
  });
  return opts.doubleElim ? [...rows, ...rows.map(x => ({ ...x }))] : rows;
}
export function eliminate(world, pr, opts = {}) {
  return { eliminations: eliminationsOf(world, pr.pairs, opts) };
}

// ---- stage 4: report (consolidate)
function trimReport(family, out) {
  const o = structuredClone(out);
  if (family === 'wbed-r1') o.customers = o.customers.filter(c => c.invoiced_usd_cents !== 0 || c.paid_usd_cents !== 0);
  else o.statements = o.statements.filter(s => s.discrepancies.length > 0);
  return o;
}
export function report(world, kids, tl, el, opts = {}) {
  let reports = kids.map(k => k.output);
  if (opts.shuffled) {
    const r1 = world.subs.map((s, i) => i).filter(i => world.subs[i].family === 'wbed-r1');
    const rot = reports.slice();
    r1.forEach((i, j) => { rot[i] = reports[r1[(j + 1) % r1.length]]; });
    reports = rot;
  }
  if (opts.childTrimmed) reports = reports.map((o, i) => trimReport(world.subs[i].family, o));
  const eliminations = opts.reportCandidatePairs ? eliminationsOf(world, amountOnlyPairs(world), opts) : el.eliminations.map(x => ({ ...x }));
  const subsidiaries = world.subs.map((s, i) => ({ sub_id: s.id, pack: s.pack, report: structuredClone(reports[i]), ...pick4(tl.subsidiaries[i]) }));
  const eliminated = eliminations.reduce((a, x) => a + x.amount_minor, 0);
  const sum = f => subsidiaries.reduce((a, s) => a + s[f], 0);
  const less = opts.elimNotApplied ? 0 : eliminated;
  const rec = opts.allIcRemoved ? sum('external_receivables_minor') : sum('external_receivables_minor') + sum('ic_receivables_minor') - less;
  const pay = opts.allIcRemoved ? sum('external_payables_minor') : sum('external_payables_minor') + sum('ic_payables_minor') - less;
  return {
    group_currency: world.groupCurrency,
    subsidiaries,
    eliminations,
    consolidated: { subsidiaries: subsidiaries.length, receivables_minor: rec, payables_minor: pay, eliminated_minor: eliminated, eliminations: eliminations.length },
  };
}
const pick4 = t => ({ external_receivables_minor: t.external_receivables_minor, external_payables_minor: t.external_payables_minor,
  ic_receivables_minor: t.ic_receivables_minor, ic_payables_minor: t.ic_payables_minor });

/** Full trace { children, translate, pair, eliminate, report } under `opts` (default: the exact solver). */
export function runPipeline(world, opts = {}, { traces = true } = {}) {
  const kids = children(world, opts, { traces });
  const tl = translate(world, kids, opts);
  const pr = pair(world, opts);
  const el = eliminate(world, pr, opts);
  return { children: kids, translate: tl, pair: pr, eliminate: el, report: report(world, kids, tl, el, opts) };
}
