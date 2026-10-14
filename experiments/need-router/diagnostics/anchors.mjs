// Features of the anchor beds (need-r0pad, need-r3mini, need-stage, need-codefix-noverifier, need-qa, need-constraint) computed now
// with experiments/need-router/features.mjs, for D1's second table: they have no entry in the committed census. $0, code only (task
// generation reads no oracle, no reference, no label). Example seeds 601-603 at difficulty 3 and 5, the census's own recipe. A bed that
// fails to load is reported, never guessed. The anchor beds were still being written (task #56) when this ran: the values are of the
// bed files as they stood, not a frozen artefact.
import { familyFeatures } from '../features.mjs';
import { ANCHOR_BEDS } from './d1-shortcut.mjs';

export async function computeAnchorFeatures({ beds = [...new Set(Object.values(ANCHOR_BEDS))], difficulties = [3, 5], seeds = [601, 602, 603] } = {}) {
  const features = {}, errors = [];
  for (const bed of beds) for (const d of difficulties) {
    try { (features[bed] ??= {})[d] = await familyFeatures(bed, { seeds, difficulty: d }); }
    catch (e) { errors.push({ bed, difficulty: d, error: String(e?.message ?? e).slice(0, 200) }); }
  }
  return { features, errors, seeds, difficulties };
}
