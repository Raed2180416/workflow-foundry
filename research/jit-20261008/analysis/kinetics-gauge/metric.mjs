// The kinetics gauge's answer metric, shared by gauge.mjs (Stage A) and stage-b-analyze.mjs (Stage B) so both stages score
// pairs with the same code. Moved verbatim out of gauge.mjs (2026-10-09); gauge.mjs imports it, and its CLI output and
// out/ files are byte-identical before and after the move.
//
//   same(a, b, relTol)  compare.mjs tolerantEqual with tolerantKeys ['vmax','km'], absTol 1e-9; condition_id and
//                       excluded_samples compared exactly (the exclusion list as a multiset). relTol > 0.05 sets
//                       allowLooseTolerance (recorded by compare.mjs).
//   dist(a, b)          |a-b| / max(|a|,|b|) per number (maxSym, what compare.mjs thresholds against), |a-b|/|a| (maxRel,
//                       a = the "correct" one), worst Vmax / Km, exclusion-set equality, per-condition detail.
import { tolerantEqual } from '../../../../experiments/jit/compare.mjs';

export const TK = ['vmax', 'km'];
export const same = (a, b, relTol) => tolerantEqual(a, b, { relTol, absTol: 1e-9, tolerantKeys: TK, ...(relTol > 0.05 ? { allowLooseTolerance: true } : {}) });

// per-answer distance, as compare.mjs measures it: |a-b| / max(|a|,|b|) per number; also relative to a (the "correct" one)
export function dist(a, b) {
  const mb = new Map(b.conditions.map(c => [c.condition_id, c]));
  let maxSym = 0, maxRel = 0, nBad = 0, perCond = [];
  for (const c of a.conditions) {
    const o = mb.get(c.condition_id);
    if (!o) { maxSym = Infinity; maxRel = Infinity; nBad++; continue; }
    for (const k of TK) {
      const d = Math.abs(c[k] - o[k]);
      const sym = d / Math.max(Math.abs(c[k]), Math.abs(o[k]), 1e-300), rel = d / Math.abs(c[k]);
      maxSym = Math.max(maxSym, sym); maxRel = Math.max(maxRel, rel);
      perCond.push({ id: c.condition_id, k, sym, rel });
    }
  }
  const sa = new Set(a.excluded_samples), sb = new Set(b.excluded_samples);
  const setSame = sa.size === sb.size && [...sa].every(x => sb.has(x));
  const vmaxMax = Math.max(0, ...perCond.filter(p => p.k === 'vmax').map(p => p.rel));
  const kmMax = Math.max(0, ...perCond.filter(p => p.k === 'km').map(p => p.rel));
  return { maxSym, maxRel, vmaxMax, kmMax, setSame, nOnlyIn: [...sa].filter(x => !sb.has(x)).length + [...sb].filter(x => !sa.has(x)).length, perCond };
}
export const quant = (xs, q) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b), i = (s.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i); return s[lo] + (s[hi] - s[lo]) * (i - lo); };
