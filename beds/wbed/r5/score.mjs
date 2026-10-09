// Output schema and end-to-end scorer for W-bed R5. The output is R4's consolidated report plus the decoded rows of the
// dump subsidiary. Pass rule (W-BED §3.5): the decoded rows are exact against the generator truth (a multiset, order
// free; one row per invoice record of the dump), the dump's subsidiary is named, and R4's own oracle passes on the rest.
import { validate } from '../lib/contracts.mjs';
import { outputSchema as R4_SCHEMA } from '../r4/score.mjs';
import * as R4 from '../r4/index.mjs';
import { rowsDiff } from './decode.mjs';

const int = { type: 'integer' };
const str = n => ({ type: 'string', maxLength: n });
export const ROW_SCHEMA = { type: 'object', required: ['invoice', 'system', 'row', 'date_text', 'currency', 'amount_minor', 'status_text'],
  properties: { invoice: str(400), system: str(400), row: int, date_text: str(400), currency: str(400), amount_minor: int, status_text: str(400) } };
export const DUMP_SCHEMA = { type: 'object', required: ['sub_id', 'rows'], properties: { sub_id: str(8), rows: { type: 'array', maxItems: 5000, items: ROW_SCHEMA } } };
export const outputSchema = { ...R4_SCHEMA, required: [...R4_SCHEMA.required, 'dump'], properties: { ...R4_SCHEMA.properties, dump: DUMP_SCHEMA } };

function snapshot(output) {
  try {
    if (output && typeof output === 'object' && Array.isArray(output.dump?.rows) && output.dump.rows.length > 5000) return { oversized: true };
    return structuredClone(output);
  } catch { return undefined; }
}

/** Score `raw` for the R5 task of `world` (its R4 part by R4's oracle, recomputed from (seed, split, difficulty)). */
export function scoreDump(world, raw) {
  const out = snapshot(raw);
  const errors = out === undefined ? ['$: not plain JSON-like data'] : out?.oversized ? ['$: oversized'] : validate(outputSchema, out);
  if (errors.length) return { pass: false, score: 0, details: { reason: 'schema-invalid', errors: errors.slice(0, 8) } };
  const rows = rowsDiff(world.rows, out.dump.rows);
  const subOk = String(out.dump.sub_id).trim().toUpperCase() === world.sub.id;
  const { dump, ...rest } = out;
  void dump;
  const r4 = R4.oracle(world.spec, rest);
  const pass = rows.exact && subOk && r4.pass;
  const score = pass ? 1 : Math.min(0.999999, Math.round((0.3 * rows.share * (subOk ? 1 : 0.5) + 0.7 * r4.score) * 1e6) / 1e6);
  return { pass, score, details: { dump: { sub_id: world.sub.id, subOk, rowsExact: rows.exact, expected: world.rows.length, got: out.dump.rows.length, matched: rows.matched, missing: rows.missing, extra: rows.extra },
    r4: { pass: r4.pass, details: r4.details } } };
}
