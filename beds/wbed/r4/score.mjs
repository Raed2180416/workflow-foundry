// Output schema and end-to-end scorer for W-bed R4. Shared by the oracle and the generator's decisiveness check.
//
// Pass rule (W-BED §3.4, composed): every pack's report passes its own rung's oracle (R1 or R3, recomputed from the
// child seed); the pack's four translated balances are exact; the elimination set is exact (pairs and amounts, as a
// multiset, order free); the consolidated block is exact; the group currency is the stated one; every subsidiary once.
import { validate } from '../lib/contracts.mjs';
import { childOracle } from './children.mjs';

export const LIMITS = { subsidiaries: 16, eliminations: 400 };
const int = { type: 'integer' };
const str = n => ({ type: 'string', maxLength: n });
export const BALANCES = ['external_receivables_minor', 'external_payables_minor', 'ic_receivables_minor', 'ic_payables_minor'];
export const CONSOLIDATED = ['subsidiaries', 'receivables_minor', 'payables_minor', 'eliminated_minor', 'eliminations'];
export const outputSchema = {
  type: 'object',
  required: ['group_currency', 'subsidiaries', 'eliminations', 'consolidated'],
  properties: {
    group_currency: str(3),
    subsidiaries: { type: 'array', maxItems: LIMITS.subsidiaries, items: { type: 'object',
      required: ['sub_id', 'pack', 'report', ...BALANCES],
      properties: { sub_id: str(8), pack: { type: 'string', enum: ['receivables-close', 'statement-audit'] }, report: { type: 'object' },
        external_receivables_minor: int, external_payables_minor: int, ic_receivables_minor: int, ic_payables_minor: int } } },
    eliminations: { type: 'array', maxItems: LIMITS.eliminations, items: { type: 'object', required: ['receivable_item', 'payable_item', 'amount_minor'],
      properties: { receivable_item: str(20), payable_item: str(20), amount_minor: int } } },
    consolidated: { type: 'object', required: CONSOLIDATED,
      properties: { subsidiaries: int, receivables_minor: int, payables_minor: int, eliminated_minor: int, eliminations: int } },
  },
};

export const elimKey = e => `${String(e.receivable_item).trim().toUpperCase()}|${String(e.payable_item).trim().toUpperCase()}|${e.amount_minor}`;
export const pairKey = e => `${String(e.receivable_item).trim().toUpperCase()}|${String(e.payable_item).trim().toUpperCase()}`;

function snapshotOutput(output) {
  try {
    if (output && typeof output === 'object' && ((Array.isArray(output.subsidiaries) && output.subsidiaries.length > LIMITS.subsidiaries)
      || (Array.isArray(output.eliminations) && output.eliminations.length > LIMITS.eliminations))) return { oversized: true };
    return structuredClone(output);
  } catch { return undefined; }
}

/** Score `raw` against the true consolidated report. `world.subs` carries each pack's child task (its oracle's input). */
export function scoreGroup(world, truth, raw) {
  const out = snapshotOutput(raw);
  const errors = out === undefined ? ['$: not plain JSON-like data'] : out?.oversized ? ['$: oversized'] : validate(outputSchema, out);
  if (errors.length) return { pass: false, score: 0, details: { reason: 'schema-invalid', errors: errors.slice(0, 8) } };
  const want = new Map(truth.subsidiaries.map(s => [s.sub_id, s]));
  const kid = new Map(world.subs.map(s => [s.id, s]));
  const seen = new Set();
  let childPass = 0, balancesExact = 0, extra = 0, dup = 0;
  const mismatches = [];
  for (const s of out.subsidiaries) {
    const id = String(s.sub_id).trim().toUpperCase();
    if (seen.has(id)) { dup++; continue; }
    seen.add(id);
    const t = want.get(id);
    if (!t) { extra++; continue; }
    const k = kid.get(id);
    let child;
    try { child = childOracle(k, s.report); } catch (e) { child = { pass: false, details: { error: String(e.message ?? e) } }; }
    if (child.pass) childPass++;
    const bad = BALANCES.filter(f => s[f] !== t[f]);
    if (s.pack !== t.pack) bad.push('pack');
    if (!bad.length) balancesExact++;
    if ((!child.pass || bad.length) && mismatches.length < 8) mismatches.push({ sub_id: id, child: child.pass ? 'pass' : (child.details?.reason ?? 'fail'), fields: bad });
  }
  const missing = [...want.keys()].filter(id => !seen.has(id)).length;
  const a = out.eliminations.map(elimKey).sort(), b = truth.eliminations.map(elimKey).sort();
  const elimExact = a.join(',') === b.join(',');
  const truePairs = new Set(truth.eliminations.map(pairKey));
  const pairsRight = out.eliminations.filter(e => truePairs.has(pairKey(e))).length;
  const consolidatedBad = CONSOLIDATED.filter(f => out.consolidated[f] !== truth.consolidated[f]);
  const currencyOk = String(out.group_currency).toUpperCase() === truth.group_currency;
  const n = want.size;
  const pass = childPass === n && balancesExact === n && !extra && !dup && !missing && elimExact && !consolidatedBad.length && currencyOk;
  const score = 0.4 * (childPass / Math.max(1, n + extra + dup)) + 0.2 * (balancesExact / Math.max(1, n + extra + dup))
    + 0.2 * (pairsRight / Math.max(1, Math.max(b.length, a.length))) + (consolidatedBad.length ? 0 : 0.2);
  return { pass, score: pass ? 1 : Math.min(0.999999, Math.round(score * 1e6) / 1e6),
    details: { subsidiaries: n, childPass, balancesExact, extra, dup, missing, elimExact, eliminations: { expected: b.length, got: a.length, pairsRight },
      consolidatedBad, currencyOk, mismatches } };
}
