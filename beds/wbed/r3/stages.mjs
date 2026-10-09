// Stage contracts, stage oracles and cross-stage relations for W-bed R3 (W-BED §2.1 `stages`, §2.2 items 2-3).
//
// Stage oracles (analyst-side diagnostics, never success criteria) score only what their stage owns:
//   split     per supplier, the set of ledger line ids (name or other name)
//   match     per supplier, the two balances and the differing documents (reference, kind, amount, counts, date)
//   classify  per supplier, the reason code of each discrepancy (the per-item judgment)
//   reduce    local only: by_reason lists all six codes once, counts agree with the listed discrepancies, totals are
//             the sums of by_reason, statements counted once each
// What no single stage owns is the fan-in: whether the reduced result is the reduction of the per-item hand-offs.
//   Z1 item conservation: each reported supplier carries the match balances and exactly the classified discrepancies,
//      and statement - ledger = sum of discrepancies
//   Z2 adjusted identity: adjusted = ledger + accepted (PRICE, FX, MISSING_CREDIT) discrepancies
//   Z3 fan-in conservation: by_reason recomputed from the classified items (per supplier, per reason, one conversion)
//   Z4 coverage: every split item appears exactly once in the reduced result
import { contract, int, str, arr, obj } from '../lib/contracts.mjs';
import { canonical } from '../lib/prng.mjs';
import { refKey, toUsdCents } from '../lib/domain.mjs';
import { outputSchema, discKey } from './score.mjs';
import { REASONS, ACCEPTED } from './vocab.mjs';

const disc = obj({ ref: str(60), reason: str(20), amount_minor: int });
export const CONTRACTS = {
  input: contract('wbed-r3/input', obj({ statements: { type: 'object' }, ledger: str(4e6), vendors: str(2e5), ap_notes: str(2e5), audit_spec: str(2e5) })),
  split: contract('wbed-r3/split', obj({ items: arr(obj({ vendor_id: str(20), ledger_lines: arr(str(10), 500) }), 500) })),
  match: contract('wbed-r3/match', obj({ items: arr(obj({ vendor_id: str(20), currency: str(3), statement_balance_minor: int, ledger_balance_minor: int,
    differences: arr(obj({ ref: str(60), type: str(4), amount_minor: int, stmt_count: int, ledger_count: int, date: str(10) }), 100) }), 500) })),
  classify: contract('wbed-r3/classify', obj({ items: arr(obj({ vendor_id: str(20), discrepancies: arr(disc, 100) }), 500) })),
  reduce: contract('wbed-r3/reduce', outputSchema),
};

const eqCanon = (a, b) => canonical(a) === canonical(b);
function diffList(want, got, key) {
  const g = new Map((Array.isArray(got) ? got : []).map(x => [key(x), x]));
  const out = [];
  for (const w of want) {
    const x = g.get(key(w));
    if (!x) out.push({ key: key(w), missing: true });
    else if (!eqCanon(w, x)) out.push({ key: key(w), expected: w, got: x });
    if (out.length >= 8) break;
  }
  return { mismatches: out, extra: (Array.isArray(got) ? got.length : 0) - want.length };
}
function sectionResult(errors, sections) {
  if (errors.length) return { pass: false, details: { reason: 'contract', errors: errors.slice(0, 8) } };
  const bad = Object.entries(sections).filter(([, d]) => d.mismatches.length || d.extra !== 0);
  return { pass: bad.length === 0, details: Object.fromEntries(Object.entries(sections).map(([k, d]) => [k, { mismatches: d.mismatches.length, extra: d.extra, first: d.mismatches[0] ?? null }])) };
}
const normSplit = it => (it && Array.isArray(it.ledger_lines) ? { ...it, ledger_lines: [...it.ledger_lines].sort() } : it);
const normMatch = it => (it && Array.isArray(it.differences) ? { ...it, differences: it.differences.map(d => ({ ...d, ref: refKey(d.ref) })).sort((a, b) => `${a.type}|${a.ref}`.localeCompare(`${b.type}|${b.ref}`)) } : it);
const normClass = it => (it && Array.isArray(it.discrepancies) ? { ...it, discrepancies: it.discrepancies.map(discKey).sort() } : it);

/** Local reduce checks: the reduced result's own arithmetic (no hand-off, no quotes). */
export function reduceLocal(out) {
  const errors = CONTRACTS.reduce.check(out);
  if (errors.length) return { pass: false, details: { reason: 'contract', errors: errors.slice(0, 8) } };
  const problems = [];
  const reasons = out.by_reason.map(x => x.reason);
  if (reasons.length !== REASONS.length || REASONS.some(r => !reasons.includes(r))) problems.push('by_reason-codes');
  const ids = out.statements.map(s => s.vendor_id);
  if (new Set(ids).size !== ids.length) problems.push('statement-twice');
  for (const x of out.by_reason) {
    const n = out.statements.reduce((s, st) => s + st.discrepancies.filter(d => d.reason === x.reason).length, 0);
    if (n !== x.count) { problems.push(`count-${x.reason}`); break; }
  }
  const sum = rs => out.by_reason.filter(x => rs.includes(x.reason)).reduce((s, x) => s + x.usd_cents, 0);
  if (out.totals.statements !== out.statements.length) problems.push('totals.statements');
  if (out.totals.discrepancies !== out.by_reason.reduce((s, x) => s + x.count, 0)) problems.push('totals.discrepancies');
  if (out.totals.difference_usd_cents !== sum(REASONS)) problems.push('totals.difference');
  if (out.totals.adjustments_usd_cents !== sum([...ACCEPTED])) problems.push('totals.adjustments');
  return { pass: problems.length === 0, details: { problems } };
}

// ---- cross-stage relations
const byVendor = items => new Map(items.map(x => [x.vendor_id, x]));
export const RELATIONS = [
  { id: 'Z1-item-conservation', stages: ['match', 'classify', 'reduce'],
    text: 'each reported supplier carries the matched balances and exactly the classified discrepancies; statement - ledger = sum of discrepancies',
    check: trace => {
      const m = byVendor(trace.match.items), c = byVendor(trace.classify.items);
      const bad = trace.reduce.statements.filter(s => {
        const mi = m.get(s.vendor_id), ci = c.get(s.vendor_id);
        if (!mi || !ci) return true;
        const sumD = s.discrepancies.reduce((x, d) => x + d.amount_minor, 0);
        return s.statement_balance_minor !== mi.statement_balance_minor || s.ledger_balance_minor !== mi.ledger_balance_minor
          || s.statement_balance_minor - s.ledger_balance_minor !== sumD
          || s.discrepancies.map(discKey).sort().join(',') !== ci.discrepancies.map(discKey).sort().join(',');
      });
      return { pass: bad.length === 0, details: { statements: bad.length, first: bad[0]?.vendor_id ?? null } };
    } },
  { id: 'Z2-adjusted-identity', stages: ['match', 'classify', 'reduce'],
    text: 'adjusted balance = ledger balance + the PRICE, FX and MISSING_CREDIT discrepancies',
    check: trace => {
      const m = byVendor(trace.match.items), c = byVendor(trace.classify.items);
      const bad = trace.reduce.statements.filter(s => {
        const mi = m.get(s.vendor_id), ci = c.get(s.vendor_id);
        if (!mi || !ci) return true;
        return s.adjusted_balance_minor !== mi.ledger_balance_minor + ci.discrepancies.filter(d => ACCEPTED.has(d.reason)).reduce((x, d) => x + d.amount_minor, 0);
      });
      return { pass: bad.length === 0, details: { statements: bad.length, first: bad[0]?.vendor_id ?? null } };
    } },
  { id: 'Z3-fan-in-conservation', stages: ['match', 'classify', 'reduce'],
    text: 'by_reason equals the reduction of the classified items: per supplier and reason, sum, convert once, add; counts add up',
    check: (trace, world) => {
      const m = byVendor(trace.match.items);
      const got = new Map(trace.reduce.by_reason.map(x => [x.reason, x]));
      const bad = REASONS.filter(reason => {
        let count = 0, cents = 0;
        for (const ci of trace.classify.items) {
          const ds = ci.discrepancies.filter(d => d.reason === reason);
          count += ds.length;
          if (ds.length) { const cur = m.get(ci.vendor_id).currency; cents += toUsdCents(ds.reduce((x, d) => x + d.amount_minor, 0), cur, world.quotes[cur]); }
        }
        const x = got.get(reason);
        return !x || x.count !== count || x.usd_cents !== cents;
      });
      return { pass: bad.length === 0, details: { reasons: bad } };
    } },
  { id: 'Z4-coverage', stages: ['split', 'reduce'],
    text: 'every supplier of the fan-out appears exactly once in the reduced result',
    check: trace => {
      const want = trace.split.items.map(x => x.vendor_id).sort(), got = trace.reduce.statements.map(x => x.vendor_id).sort();
      return { pass: want.join(',') === got.join(','), details: { want: want.length, got: got.length } };
    } },
];

export function makeStages(truthOf, inputOf) {
  return [
    { id: 'split', inputSchema: CONTRACTS.input.schema, outputSchema: CONTRACTS.split.schema,
      project: task => ({ task, input: inputOf(task) }),
      oracle: (st, out) => sectionResult(CONTRACTS.split.check(out), { items: diffList(truthOf(st.task).split.items.map(normSplit), (out?.items ?? []).map(normSplit), x => x?.vendor_id) }) },
    { id: 'match', inputSchema: CONTRACTS.split.schema, outputSchema: CONTRACTS.match.schema,
      project: task => ({ task, input: truthOf(task).split }),
      oracle: (st, out) => sectionResult(CONTRACTS.match.check(out), { items: diffList(truthOf(st.task).match.items.map(normMatch), (out?.items ?? []).map(normMatch), x => x?.vendor_id) }) },
    { id: 'classify', inputSchema: CONTRACTS.match.schema, outputSchema: CONTRACTS.classify.schema,
      project: task => ({ task, input: truthOf(task).match }),
      oracle: (st, out) => sectionResult(CONTRACTS.classify.check(out), { items: diffList(truthOf(st.task).classify.items.map(normClass), (out?.items ?? []).map(normClass), x => x?.vendor_id) }) },
    { id: 'reduce', inputSchema: CONTRACTS.classify.schema, outputSchema: CONTRACTS.reduce.schema,
      project: task => { const t = truthOf(task); return { task, input: { match: t.match, classify: t.classify } }; },
      oracle: (st, out) => reduceLocal(out) },
  ];
}

export function composeOracle(stages, task, trace, world) {
  const per = {};
  for (const s of stages) per[s.id] = s.oracle(s.project(task), trace[s.id]);
  const rel = {};
  for (const x of RELATIONS) {
    try { rel[x.id] = x.check(trace, world); } catch (e) { rel[x.id] = { pass: false, details: { error: String(e.message ?? e) } }; }
  }
  const pass = Object.values(per).every(r => r.pass) && Object.values(rel).every(r => r.pass);
  return { pass, stages: per, relations: rel };
}
