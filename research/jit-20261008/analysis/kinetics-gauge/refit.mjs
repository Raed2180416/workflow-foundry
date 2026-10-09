// Row 37 (B7-E5): "decision-first comparison": compare the exclusion sets exactly, then refit both answers through ONE
// fitter written from the SOP, and compare the refits.
//
// This module is the one shared fitter: SOP section 5 (unweighted NLLS on all retained wells, shared Vmax for inhibitor
// conditions) as fitters.mjs fitA, with fitB as the cross-check. It needs the cleaned points. An answer {vmax, km,
// excluded_samples} does not contain them, so the caller supplies the points for the data decisions that the two answers
// share (here: the world's displayed values, as the bed's reference solver sees them) and each answer's own exclusion set.
//
//   refitAnswer(world, shown, excludedSet) -> answer object with vmax, km re-estimated from the retained wells
//
// What this can and cannot remove (measured in gauge.mjs):
//   - it removes ALL disagreement that comes from the fitting method or the numerical routine (same exclusions, same data);
//   - it also removes disagreement that comes from wrong UNIT / CORRECTION / DOSE decisions, because those are baked into the
//     "shared points", so it cannot be used on its own to separate right from wrong answers (see README, Row 37).
import { fitA, fitB, fitAnswer } from './fitters.mjs';

export function retainedPoints(world, shown, excludedSet) {
  const by = Object.fromEntries(world.conds.map(c => [c.id, []]));
  for (const w of world.wells) if (!excludedSet.has(w.id)) by[w.condId].push({ S: shown[w.id].S, v: shown[w.id].rate });
  return by;
}

export function refitAnswer(world, shown, excluded, fitter = fitA) {
  return fitAnswer(world.conds, retainedPoints(world, shown, new Set(excluded)), excluded, fitter);
}

// Decision-first comparison of two answers: exact exclusion-set equality, then tolerant equality of the shared refits.
export function decisionFirstSame(world, shown, ansX, ansY, fitter = fitA) {
  const sx = [...new Set(ansX.excluded_samples)].sort(), sy = [...new Set(ansY.excluded_samples)].sort();
  if (sx.length !== sy.length || sx.some((v, i) => v !== sy[i])) return { same: false, why: 'exclusion-set' };
  const idsX = ansX.conditions.map(c => c.condition_id).sort().join(), idsY = ansY.conditions.map(c => c.condition_id).sort().join();
  if (idsX !== idsY) return { same: false, why: 'condition-ids' };
  return { same: true, why: 'same-set-refit-identical', refit: refitAnswer(world, shown, sx, fitter) };
}
export { fitA, fitB };
