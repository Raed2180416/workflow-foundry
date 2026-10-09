// Output schema and end-to-end scorer for W-bed R2. Shared by the oracle and the generator's decisiveness check.
//
// Pass rule (W-BED §2.2 item 1, §3.2): exact. The routing decision of every document (each document exactly once, the
// right route, 'review' included), the entries as a multiset (doc, action, party, ref, currency, amount in minor units),
// the holds as a multiset (doc, ref, reason) and the review queue as a set. References compare by the stated rule
// (ignoring case, spaces, hyphens, slashes). Escalating a decidable document fails, as does handling an undecidable one.
import { validate } from '../lib/contracts.mjs';
import { refKey } from '../lib/domain.mjs';
import { ROUTES, ACTIONS, HOLD_REASONS } from './vocab.mjs';

export const LIMITS = { docs: 200, entries: 2000 };
const s = n => ({ type: 'string', maxLength: n });
export const outputSchema = {
  type: 'object',
  required: ['routing', 'entries', 'holds', 'review_queue'],
  properties: {
    routing: { type: 'array', maxItems: LIMITS.docs, items: { type: 'object', required: ['doc', 'kind'], properties: { doc: { type: 'integer' }, kind: { type: 'string', enum: ROUTES } } } },
    entries: { type: 'array', maxItems: LIMITS.entries, items: { type: 'object', required: ['doc', 'action', 'party', 'ref', 'currency', 'amount_minor'],
      properties: { doc: { type: 'integer' }, action: { type: 'string', enum: ACTIONS }, party: s(20), ref: s(60), currency: s(3), amount_minor: { type: 'integer' } } } },
    holds: { type: 'array', maxItems: LIMITS.docs, items: { type: 'object', required: ['doc', 'ref', 'reason'],
      properties: { doc: { type: 'integer' }, ref: s(60), reason: { type: 'string', enum: HOLD_REASONS } } } },
    review_queue: { type: 'array', maxItems: LIMITS.docs, items: { type: 'integer' } },
  },
};

export const entryKey = e => [e.doc, e.action, String(e.party).trim().toUpperCase(), refKey(e.ref), String(e.currency).toUpperCase(), e.amount_minor].join('|');
export const holdKey = h => [h.doc, refKey(h.ref), h.reason].join('|');
const count = keys => { const m = new Map(); for (const k of keys) m.set(k, (m.get(k) ?? 0) + 1); return m; };
/** Multiset difference: { missing, extra } counts between two key lists. */
export function multisetDiff(want, got) {
  const w = count(want), g = count(got);
  let missing = 0, extra = 0;
  const first = [];
  for (const [k, n] of w) { const d = n - (g.get(k) ?? 0); if (d > 0) { missing += d; if (first.length < 4) first.push({ missing: k }); } }
  for (const [k, n] of g) { const d = n - (w.get(k) ?? 0); if (d > 0) { extra += d; if (first.length < 8) first.push({ extra: k }); } }
  return { missing, extra, first };
}

function snapshotOutput(output) {
  try {
    if (output && typeof output === 'object' && Array.isArray(output.entries) && output.entries.length > LIMITS.entries) return { oversized: true };
    return structuredClone(output);
  } catch { return undefined; }
}

/** Score `raw` against the true output { routing, entries, holds, review_queue }. */
export function scoreInbox(truth, raw) {
  const out = snapshotOutput(raw);
  const errors = out === undefined ? ['$: not plain JSON-like data'] : out?.oversized ? ['$.entries: oversized'] : validate(outputSchema, out);
  if (errors.length) return { pass: false, score: 0, details: { reason: 'schema-invalid', errors: errors.slice(0, 8) } };
  const want = new Map(truth.routing.map(x => [x.doc, x.kind]));
  const seen = new Set();
  let routedRight = 0, dupRoute = 0, unknownDoc = 0;
  for (const x of out.routing) {
    if (seen.has(x.doc)) { dupRoute++; continue; }
    seen.add(x.doc);
    if (!want.has(x.doc)) { unknownDoc++; continue; }
    if (want.get(x.doc) === x.kind) routedRight++;
  }
  const missingRoute = [...want.keys()].filter(d => !seen.has(d)).length;
  const entries = multisetDiff(truth.entries.map(entryKey), out.entries.map(entryKey));
  const holds = multisetDiff(truth.holds.map(holdKey), out.holds.map(holdKey));
  const rq = multisetDiff(truth.review_queue.map(String), out.review_queue.map(String));
  const n = want.size;
  const routingOk = routedRight === n && dupRoute === 0 && unknownDoc === 0 && missingRoute === 0;
  const pass = routingOk && !entries.missing && !entries.extra && !holds.missing && !holds.extra && !rq.missing && !rq.extra;
  const frac = (good, total) => (total ? good / total : 1);
  const score = 0.4 * frac(routedRight, n + dupRoute + unknownDoc)
    + 0.4 * frac(truth.entries.length - entries.missing, truth.entries.length + entries.extra)
    + 0.1 * frac(truth.holds.length - holds.missing, truth.holds.length + holds.extra)
    + 0.1 * frac(truth.review_queue.length - rq.missing, truth.review_queue.length + rq.extra);
  return {
    pass, score: pass ? 1 : Math.min(0.999999, Math.round(score * 1e6) / 1e6),
    details: { docs: n, routedRight, dupRoute, unknownDoc, missingRoute, entries, holds, reviewQueue: rq },
  };
}
