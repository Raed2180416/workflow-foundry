// Output schema and end-to-end scorer for W-bed R1. Shared by the oracle (index.mjs) and the generator's
// decisiveness check (world.mjs via setVerifier), so both apply exactly the same pass rule.
//
// Pass rule (W-BED §2.2 item 1, §3.1): exact. Every real customer appears once with exactly its live rows, its
// canonical id, and its invoiced / paid / open amounts in US cents; no extra customers; the totals block is exact.
import { validate } from '../lib/contracts.mjs';

export const LIMITS = { customers: 2000, sourceRows: 400 };
const cents = { type: 'integer' };
export const outputSchema = {
  type: 'object',
  required: ['customers', 'totals'],
  properties: {
    customers: {
      type: 'array',
      maxItems: LIMITS.customers,
      items: {
        type: 'object',
        required: ['customer_id', 'source_rows', 'invoiced_usd_cents', 'paid_usd_cents', 'open_usd_cents'],
        properties: {
          customer_id: { type: 'integer' },
          source_rows: { type: 'array', minItems: 1, maxItems: LIMITS.sourceRows, items: { type: 'integer' } },
          invoiced_usd_cents: cents,
          paid_usd_cents: cents,
          open_usd_cents: cents,
        },
      },
    },
    totals: {
      type: 'object',
      required: ['customers', 'invoiced_usd_cents', 'paid_usd_cents', 'open_usd_cents'],
      properties: { customers: { type: 'integer' }, invoiced_usd_cents: cents, paid_usd_cents: cents, open_usd_cents: cents },
    },
  },
};

const AMOUNTS = ['invoiced_usd_cents', 'paid_usd_cents', 'open_usd_cents'];
const keyOf = rows => [...rows].sort((a, b) => a - b).join(',');

export function snapshotOutput(output) {
  try {
    if (output && typeof output === 'object' && Array.isArray(output.customers) && output.customers.length > LIMITS.customers) return { oversized: true };
    return structuredClone(output);
  } catch { return undefined; }
}

/** Score `rawOutput` against the true report { customers, totals }. */
export function scoreReport(truth, rawOutput) {
  const out = snapshotOutput(rawOutput);
  const errors = out === undefined ? ['$: not plain JSON-like data'] : out?.oversized ? ['$.customers: oversized'] : validate(outputSchema, out);
  if (errors.length) return { pass: false, score: 0, details: { reason: 'schema-invalid', errors: errors.slice(0, 8) } };
  const seen = new Map();
  for (let i = 0; i < out.customers.length; i++) {
    for (const id of out.customers[i].source_rows) {
      if (seen.has(id)) return { pass: false, score: 0, details: { reason: 'row-in-multiple-customers', row: id } };
      seen.set(id, i);
    }
  }
  const want = new Map(truth.customers.map(c => [keyOf(c.source_rows), c]));
  let exact = 0, membership = 0, extra = 0;
  const mismatches = [];
  for (const c of out.customers) {
    const t = want.get(keyOf(c.source_rows));
    if (!t) { extra++; if (mismatches.length < 12) mismatches.push({ kind: 'unknown-customer', source_rows: c.source_rows.slice(0, 8) }); continue; }
    membership++;
    const bad = [];
    if (c.customer_id !== t.customer_id) bad.push('customer_id');
    for (const f of AMOUNTS) if (c[f] !== t[f]) bad.push(f);
    if (!bad.length) exact++;
    else if (mismatches.length < 12) mismatches.push({ kind: 'field', customer_id: t.customer_id, fields: bad, expected: Object.fromEntries(bad.map(f => [f, t[f]])), got: Object.fromEntries(bad.map(f => [f, c[f]])) });
  }
  const missing = truth.customers.length - membership;
  const totalsBad = ['customers', ...AMOUNTS].filter(f => out.totals[f] !== truth.totals[f]);
  const n = truth.customers.length;
  const pass = exact === n && extra === 0 && missing === 0 && totalsBad.length === 0;
  const score = Math.round(Math.max(0, (0.8 * exact) / Math.max(1, n + extra) + (totalsBad.length ? 0 : 0.2)) * 1e6) / 1e6;
  return {
    pass, score: pass ? 1 : Math.min(score, 0.999999),
    details: { customers: n, predicted: out.customers.length, exact, membership, extra, missing, totalsBad, mismatches },
  };
}
