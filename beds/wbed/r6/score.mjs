// Output schema and end-to-end scorer for W-bed R6 (W-BED §3.6: synth's exact accepted-table oracle on the
// discovered entity set; missing or extra rows fail).
//
// Pass rule. Exactly one row per (in-scope compound, requested property), the compound named by its code, its name or
// "name (CODE)" (case and surrounding spaces ignored); value exact at the property's stated precision (round(value * 10^dec) equals
// the true integer); source_doc_id equal to the winning document's id. No row for any other compound or property, no
// duplicate row. excluded_doc_ids equal, as a set, to the void research documents that mention an in-scope compound.
// Details carry counts only (synth 3.0.0 rule): the true values, sources and compound list are never in `details`.
import { validate } from '../lib/contracts.mjs';
import { PROPS, PROP_IDS } from './vocab.mjs';

export const LIMITS = { rows: 400, excluded: 400 };
const str = n => ({ type: 'string', maxLength: n });
export const outputSchema = {
  type: 'object',
  required: ['table', 'excluded_doc_ids'],
  properties: {
    table: { type: 'array', maxItems: LIMITS.rows, items: { type: 'object', required: ['entity', 'property', 'value', 'source_doc_id'],
      properties: { entity: str(80), property: { type: 'string', enum: PROP_IDS }, value: { type: 'number' }, source_doc_id: str(20) } } },
    excluded_doc_ids: { type: 'array', maxItems: LIMITS.excluded, items: str(20) },
  },
};

const PAIR_RE = /^(.+?)\s*\(\s*([A-Za-z]{2,3}-\d{3,4})\s*\)$/;
/**
 * Resolve an entity string through `lookup` (upper-cased code or lower-cased name -> value): the code, the name, or
 * "name (CODE)" when both halves name the same compound (the form the corpus itself uses; review 2026-10-14, finding 8).
 * A pair whose halves name different compounds resolves to nothing.
 */
export function resolveWith(lookup, s) {
  const t = String(s ?? '').trim();
  const direct = lookup.get(t.toUpperCase()) ?? lookup.get(t.toLowerCase());
  if (direct !== undefined) return direct;
  const m = t.match(PAIR_RE);
  if (!m) return null;
  const a = lookup.get(m[2].toUpperCase()), b = lookup.get(m[1].trim().toLowerCase());
  return a !== undefined && a === b ? a : null;
}

function snapshot(output) {
  try {
    if (output && typeof output === 'object' && ((Array.isArray(output.table) && output.table.length > LIMITS.rows) || (Array.isArray(output.excluded_doc_ids) && output.excluded_doc_ids.length > LIMITS.excluded))) return { oversized: true };
    return structuredClone(output);
  } catch { return undefined; }
}

/**
 * truth = { cells: Map(`${code}|${prop}` -> { canon, source }), props: [...], entities: [{ code, name }] (every compound
 * of the world, for name resolution), excluded: [ids] }.
 */
export function scoreTable(truth, raw) {
  const out = snapshot(raw);
  const errors = out === undefined ? ['$: not plain JSON-like data'] : out?.oversized ? ['$: oversized'] : validate(outputSchema, out);
  if (errors.length) return { pass: false, score: 0, details: { reason: 'schema-invalid', errors: errors.slice(0, 8) } };
  const byString = new Map();
  for (const e of truth.entities) { byString.set(e.code.toUpperCase(), e.code); byString.set(e.name.toLowerCase(), e.code); }
  const resolve = s => resolveWith(byString, s);
  const seen = new Set();
  let correct = 0, extraRows = 0, dupRows = 0, valueWrong = 0, sourceWrong = 0, unknownEntity = 0;
  const extraEntities = new Set();
  for (const row of out.table) {
    const code = resolve(row.entity);
    if (!code) { unknownEntity++; extraRows++; continue; }
    const key = `${code}|${row.property}`;
    const t = truth.cells.get(key);
    if (!t) { extraRows++; extraEntities.add(code); continue; }
    if (seen.has(key)) { dupRows++; continue; }
    seen.add(key);
    const scale = 10 ** PROPS[row.property].dec;
    const vOk = Math.round(row.value * scale) === t.canon;
    const sOk = String(row.source_doc_id).trim().toUpperCase() === t.source;
    if (!vOk) valueWrong++;
    if (!sOk) sourceWrong++;
    if (vOk && sOk) correct++;
  }
  const missingCells = [...truth.cells.keys()].filter(k => !seen.has(k)).length;
  const truthCodes = new Set([...truth.cells.keys()].map(k => k.split('|')[0]));
  const seenCodes = new Set([...seen].map(k => k.split('|')[0]));
  const missingEntities = [...truthCodes].filter(c => !seenCodes.has(c)).length;
  const got = new Set(out.excluded_doc_ids.map(x => String(x).trim().toUpperCase()));
  const want = new Set(truth.excluded);
  const missingExcluded = [...want].filter(x => !got.has(x)).length, extraExcluded = [...got].filter(x => !want.has(x)).length;
  const excludedOk = !missingExcluded && !extraExcluded;
  const n = truth.cells.size;
  const pass = correct === n && !extraRows && !dupRows && excludedOk;
  const score = pass ? 1 : Math.min(0.999999, Math.round((0.85 * correct / Math.max(1, n + extraRows + dupRows) + (excludedOk ? 0.15 : 0)) * 1e6) / 1e6);
  return { pass, score, details: { cells: n, correct, missingCells, missingEntities, extraRows, extraEntities: extraEntities.size, unknownEntity, dupRows, valueWrong, sourceWrong,
    excludedOk, missingExcluded, extraExcluded } };
}
