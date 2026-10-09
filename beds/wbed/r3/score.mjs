// Output schema and end-to-end scorer for W-bed R3. Shared by the oracle and the generator's decisiveness check.
//
// Pass rule (W-BED §2.2 item 1, §3.3): exact on the reduced result. Every supplier once (clean ones included) with its
// currency and its statement, ledger and adjusted balances in minor units; its discrepancies as a multiset of
// (reference by the stated matching rule, reason, amount); by_reason exact for all six codes; totals exact.
import { validate } from '../lib/contracts.mjs';
import { refKey } from '../lib/domain.mjs';
import { REASONS } from './vocab.mjs';

export const LIMITS = { statements: 500, discrepancies: 50 };
const int = { type: 'integer' };
export const outputSchema = {
  type: 'object',
  required: ['statements', 'by_reason', 'totals'],
  properties: {
    statements: { type: 'array', maxItems: LIMITS.statements, items: { type: 'object',
      required: ['vendor_id', 'currency', 'statement_balance_minor', 'ledger_balance_minor', 'adjusted_balance_minor', 'discrepancies'],
      properties: { vendor_id: { type: 'string', maxLength: 20 }, currency: { type: 'string', maxLength: 3 },
        statement_balance_minor: int, ledger_balance_minor: int, adjusted_balance_minor: int,
        discrepancies: { type: 'array', maxItems: LIMITS.discrepancies, items: { type: 'object', required: ['ref', 'reason', 'amount_minor'],
          properties: { ref: { type: 'string', maxLength: 60 }, reason: { type: 'string', enum: REASONS }, amount_minor: int } } } } } },
    by_reason: { type: 'array', maxItems: 12, items: { type: 'object', required: ['reason', 'count', 'usd_cents'],
      properties: { reason: { type: 'string', enum: REASONS }, count: int, usd_cents: int } } },
    totals: { type: 'object', required: ['statements', 'discrepancies', 'difference_usd_cents', 'adjustments_usd_cents'],
      properties: { statements: int, discrepancies: int, difference_usd_cents: int, adjustments_usd_cents: int } },
  },
};

export const discKey = d => `${refKey(d.ref)}|${d.reason}|${d.amount_minor}`;
const BAL = ['statement_balance_minor', 'ledger_balance_minor', 'adjusted_balance_minor'];

function snapshotOutput(output) {
  try {
    if (output && typeof output === 'object' && Array.isArray(output.statements) && output.statements.length > LIMITS.statements) return { oversized: true };
    return structuredClone(output);
  } catch { return undefined; }
}

/** Score `raw` against the true reduced result. */
export function scoreAudit(truth, raw) {
  const out = snapshotOutput(raw);
  const errors = out === undefined ? ['$: not plain JSON-like data'] : out?.oversized ? ['$.statements: oversized'] : validate(outputSchema, out);
  if (errors.length) return { pass: false, score: 0, details: { reason: 'schema-invalid', errors: errors.slice(0, 8) } };
  const want = new Map(truth.statements.map(s => [s.vendor_id, s]));
  const seen = new Set();
  let exact = 0, extra = 0, dup = 0;
  const mismatches = [];
  for (const s of out.statements) {
    const id = String(s.vendor_id).trim().toUpperCase();
    if (seen.has(id)) { dup++; continue; }
    seen.add(id);
    const t = want.get(id);
    if (!t) { extra++; continue; }
    const bad = [];
    if (String(s.currency).toUpperCase() !== t.currency) bad.push('currency');
    for (const f of BAL) if (s[f] !== t[f]) bad.push(f);
    const a = t.discrepancies.map(discKey).sort().join(','), b = s.discrepancies.map(discKey).sort().join(',');
    if (a !== b) bad.push('discrepancies');
    if (!bad.length) exact++;
    else if (mismatches.length < 10) mismatches.push({ vendor_id: id, fields: bad });
  }
  const missing = [...want.keys()].filter(id => !seen.has(id)).length;
  const br = new Map();
  let brDup = 0;
  for (const x of out.by_reason) { if (br.has(x.reason)) brDup++; br.set(x.reason, x); }
  const reasonsBad = truth.by_reason.filter(t => { const x = br.get(t.reason); return !x || x.count !== t.count || x.usd_cents !== t.usd_cents; }).map(t => t.reason);
  const totalsBad = Object.keys(truth.totals).filter(k => out.totals[k] !== truth.totals[k]);
  const n = want.size;
  const pass = exact === n && !extra && !dup && !missing && !brDup && !reasonsBad.length && !totalsBad.length;
  const score = 0.7 * (exact / Math.max(1, n + extra + dup)) + 0.15 * (1 - reasonsBad.length / REASONS.length) + (totalsBad.length ? 0 : 0.15);
  return { pass, score: pass ? 1 : Math.min(0.999999, Math.round(score * 1e6) / 1e6),
    details: { statements: n, exact, extra, dup, missing, reasonsBad, brDup, totalsBad, mismatches } };
}
