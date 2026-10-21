// lib/rules.mjs: the SOP's decision rules as plain code (sop.txt 5.1, 5.2-5.5 validation, 5.6, 5.7). No model, no tools.
export const PRODUCT_ID_FORMAT = /^P_\d{5}$/;          // the format the catalog's tools accept: P_XXXXX
export const COMPONENTS = ['sds', 'handling', 'transportation', 'disposal'];
export const UNABLE = 'Unable to Decide';

// 5.2-5.5: a component score is usable when it is a number from 1 to 5. Anything else (0, blank, out of range) is missing.
export function usableScore(v) {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && n >= 1 && n <= 5 ? n : null;
}

// 5.6: a missing component takes the max of the other scores; more than two missing means no decision.
// The total must land in 4-20, else there is no decision either.
export function hazardScore(scores) {
  const present = COMPONENTS.map(c => scores[c]).filter(s => s != null);
  const missing = COMPONENTS.length - present.length;
  if (missing > 2) return { decidable: false, hazard_score: 0, reason: 'more than two component scores missing' };
  const fill = Math.max(...present);
  const total = COMPONENTS.reduce((sum, c) => sum + (scores[c] ?? fill), 0);
  if (total < 4 || total > 20) return { decidable: false, hazard_score: 0, reason: 'total outside 4-20' };
  return { decidable: true, hazard_score: total, reason: missing ? `${missing} component(s) imputed with max of others` : 'all components scored' };
}

// 5.7: four bands over the 4-20 range, higher score = higher severity: A 4-8, B 9-12, C 13-16, D 17-20.
// The examples fix A (4, 7), C (16) and D (17, 20); the B bounds are the even split between them.
export function hazardClass(score) {
  if (score <= 8) return 'Hazard Class A';
  if (score <= 12) return 'Hazard Class B';
  if (score <= 16) return 'Hazard Class C';
  return 'Hazard Class D';
}
