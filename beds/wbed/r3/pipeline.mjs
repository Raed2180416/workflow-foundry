// The bed's own exact solver for R3, written as the reference outline's stages (W-BED §3.3): split our ledger by
// supplier (the fan-out projection) -> per supplier, match statement and ledger by reference -> classify each
// difference (the per-item judgment) -> reduce (adjusted balances, per-reason USD totals: the code reducer).
// referenceSolve runs it with no options; each control runs it with one option reproducing one plausible mistake.
import { refKey, toUsdCents, isoDay, dayNum } from '../lib/domain.mjs';
import { REASONS, ACCEPTED } from './vocab.mjs';
import { reasonOf } from './world.mjs';

const isoOf = isoDay;

// ---- stage 1: split (each supplier's ledger lines, found by name or other name)
export function split(world, opts = {}) {
  return {
    items: world.vendors.map(v => ({
      vendor_id: v.id,
      ledger_lines: world.ledgerOf.get(v.id).filter(x => !opts.exactNameOnly || x.name === v.name).map(x => x.id),
    })),
  };
}

// ---- stage 2: match (per supplier: balances and the documents whose two sides differ)
function matchOne(world, v, lineIds, opts) {
  const ids = new Set(lineIds);
  const ledger = world.ledgerOf.get(v.id).filter(x => ids.has(x.id));
  let stmt = v.stmt.map(x => ({ ...x }));
  if (opts.crIgnored && v.cr) stmt = stmt.map(x => (x.type === 'CRN' || x.type === 'PMT' ? { ...x, amount: Math.abs(x.amount) } : x));
  if (opts.duplicateCollapsed) { const seen = new Set(); stmt = stmt.filter(x => { const k = `${x.type}|${x.key}`; if (seen.has(k)) return false; seen.add(k); return true; }); }
  const groups = new Map();
  const g = (x, side) => {
    const k = `${x.type}|${x.key}`;
    if (!groups.has(k)) groups.set(k, { type: x.type, key: x.key, ref: x.ref, refSide: side, stmtCount: 0, ledgerCount: 0, stmtSum: 0, ledgerSum: 0, day: x.day });
    const e = groups.get(k);
    if (side === 'stmt') { e.stmtCount++; e.stmtSum += x.amount; if (e.refSide !== 'stmt') { e.ref = x.ref; e.refSide = 'stmt'; } } else { e.ledgerCount++; e.ledgerSum += x.amount; }
    e.day = Math.min(e.day, x.day);
  };
  for (const x of stmt) g(x, 'stmt');
  for (const x of ledger) g(x, 'ledger');
  const differences = [...groups.values()]
    .filter(e => e.stmtSum !== e.ledgerSum || e.stmtCount !== e.ledgerCount)
    .map(e => ({ ref: e.ref, type: e.type, amount_minor: e.stmtSum - e.ledgerSum, stmt_count: e.stmtCount, ledger_count: e.ledgerCount, date: isoOf(e.day) }))
    .sort((a, b) => a.date.localeCompare(b.date) || refKey(a.ref).localeCompare(refKey(b.ref)));
  return {
    vendor_id: v.id, currency: v.currency,
    statement_balance_minor: stmt.reduce((s, x) => s + x.amount, 0),
    ledger_balance_minor: ledger.reduce((s, x) => s + x.amount, 0),
    differences,
  };
}
export function match(world, sp, opts = {}) {
  const byId = new Map(world.vendors.map(v => [v.id, v]));
  const skim = opts.skim ?? new Set();
  return {
    items: sp.items.map(it => {
      const v = byId.get(it.vendor_id);
      const m = matchOne(world, v, it.ledger_lines, opts);
      // A single-context reader past its budget skims: it takes the closing balance and assumes the ledger agrees.
      if (skim.has(v.id)) return { ...m, ledger_balance_minor: m.statement_balance_minor, differences: [] };
      return m;
    }),
  };
}

// ---- stage 3: classify (per difference: the reason code, decided from the notes and the cut-off)
const dayOf = iso => { const [y, m, d] = iso.split('-').map(Number); return dayNum(y, m, d); };
export function classify(world, mt, opts = {}) {
  const byId = new Map(world.vendors.map(v => [v.id, v]));
  return {
    items: mt.items.map(m => ({
      vendor_id: m.vendor_id,
      discrepancies: m.differences.map(d => ({
        ref: d.ref,
        reason: reasonOf(world, byId.get(m.vendor_id), { type: d.type, key: refKey(d.ref), stmtCount: d.stmt_count, ledgerCount: d.ledger_count, amount: d.amount_minor, day: dayOf(d.date) }, opts),
        amount_minor: d.amount_minor,
      })),
    })),
  };
}

// ---- stage 4: reduce (the code reducer: adjusted balances, per-reason counts and US-cent totals)
const roundedRate = rate => (rate.perUsd ? { ...rate, den: Math.round(rate.den / 100) * 100 } : { ...rate, num: Math.round(rate.num / 10000) * 10000 });
export function reduce(world, sp, mt, cl, opts = {}) {
  const mBy = new Map(mt.items.map(m => [m.vendor_id, m]));
  const usd = (cur, minor) => {
    if (opts.currencyMixed) return minor;
    const rate = opts.rateRounded ? roundedRate(world.quotes[cur]) : world.quotes[cur];
    return toUsdCents(minor, cur, rate);
  };
  let statements = cl.items.map(c => {
    const m = mBy.get(c.vendor_id);
    const accepted = c.discrepancies.filter(d => ACCEPTED.has(d.reason) || (opts.timingAccepted && d.reason === 'TIMING'));
    const adjusted = opts.acceptAll ? m.statement_balance_minor : m.ledger_balance_minor + accepted.reduce((s, d) => s + d.amount_minor, 0);
    return {
      vendor_id: c.vendor_id, currency: m.currency,
      statement_balance_minor: m.statement_balance_minor, ledger_balance_minor: m.ledger_balance_minor, adjusted_balance_minor: adjusted,
      discrepancies: c.discrepancies.map(d => ({ ref: d.ref, reason: d.reason, amount_minor: opts.signFlipped ? -d.amount_minor : d.amount_minor })),
    };
  });
  if (opts.exceptionsOnly) statements = statements.filter(s => s.discrepancies.length > 0);
  // Fan-in. A reducer-less solve keeps only what is still "in view": opts.lostMiddle drops the middle third.
  let pool = statements;
  if (opts.lostMiddle) { const n = statements.length, a = Math.floor(n / 3), b = Math.ceil((2 * n) / 3); pool = statements.filter((_, i) => i < a || i >= b); }
  const by_reason = REASONS.map(reason => {
    let count = 0, cents = 0;
    for (const s of pool) {
      const ds = s.discrepancies.filter(d => d.reason === reason);
      count += ds.length;
      if (ds.length) cents += usd(s.currency, ds.reduce((x, d) => x + d.amount_minor, 0));
    }
    return { reason, count, usd_cents: cents };
  });
  const sum = rs => by_reason.filter(x => rs.includes(x.reason)).reduce((s, x) => s + x.usd_cents, 0);
  return {
    statements, by_reason,
    totals: { statements: statements.length, discrepancies: by_reason.reduce((s, x) => s + x.count, 0), difference_usd_cents: sum(REASONS), adjustments_usd_cents: sum([...ACCEPTED]) },
  };
}

/** Full trace { split, match, classify, reduce } under `opts` (default: the exact solver). */
export function runPipeline(world, opts = {}) {
  const sp = split(world, opts);
  const mt = match(world, sp, opts);
  const cl = classify(world, mt, opts);
  return { split: sp, match: mt, classify: cl, reduce: reduce(world, sp, mt, cl, opts) };
}
export const solveOutput = (world, opts = {}) => runPipeline(world, opts).reduce;
