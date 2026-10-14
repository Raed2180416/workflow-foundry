// Shared helpers of the need-stage bed: schema validation (the W-bed / records validator, imported unchanged), a
// plain-data snapshot of caller output, deterministic item selection by an ambiguity score, and near-miss bookkeeping.
import { validate } from '../wbed/lib/contracts.mjs';
import { canonical } from '../lib/canonical.mjs';

export { validate, canonical };

/** Plain-data copy of caller output (accessors, proxies and prototypes cannot show the validator one value and the
 *  scorer another); undefined when it is not plain data. */
export function snapshot(value) {
  try { return structuredClone(value); } catch { return undefined; }
}

/** [] when `output` satisfies `schema`, else up to 8 error strings. */
export function schemaErrors(schema, output) {
  const v = snapshot(output);
  if (v === undefined) return ['$: not plain JSON-like data'];
  return validate(schema, v).slice(0, 8);
}

/**
 * Pick one item deterministically. `items` are candidates with a numeric ambiguity `score`; the pool is the items whose
 * score is in `want` (a set) or, if none, the items nearest to the mean of `want`. Within the pool the order is a seeded
 * shuffle; the first item for which `accept(item)` returns a truthy value wins and that value is returned.
 */
export function pickByScore(r, items, want, accept) {
  const wanted = new Set(want);
  const target = [...wanted].reduce((a, b) => a + b, 0) / wanted.size;
  const byDistance = [...items].sort((a, b) => {
    const da = wanted.has(a.score) ? 0 : 1 + Math.abs(a.score - target), db = wanted.has(b.score) ? 0 : 1 + Math.abs(b.score - target);
    return da - db;
  });
  // group by distance, shuffle inside each group, try groups in order
  const groups = [];
  for (const it of byDistance) {
    const d = wanted.has(it.score) ? 0 : 1 + Math.abs(it.score - target);
    if (!groups.length || groups[groups.length - 1].d !== d) groups.push({ d, xs: [] });
    groups[groups.length - 1].xs.push(it);
  }
  for (const g of groups) for (const it of r.shuffle(g.xs)) { const got = accept(it); if (got) return got; }
  return null;
}

/** Keep the named near misses whose output differs from the truth under `same`, first occurrence of each output. */
export function distinctMisses(truth, misses, same) {
  const out = [], seen = new Set();
  for (const m of misses) {
    if (!m || m.output === undefined || m.output === null) continue;
    if (same(truth, m.output)) continue;
    const k = canonical(m.output);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(m);
  }
  return out;
}

export const str = (maxLength = 200) => ({ type: 'string', maxLength });
export const int = { type: 'integer' };
export const bool = { type: 'boolean' };
