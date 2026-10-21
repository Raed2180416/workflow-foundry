// Plain-code decision rules for the dangerous goods SOP (sections 5.1, 5.6 and 5.7). No tools, no model.
export const UNABLE = 'Unable to Decide';

// 5.1: product ID format P_XXXXX (the tools' own pattern). A non-resolvable ID shows up as a tool error (no product found),
// which leaves every component missing and so ends in 5.6.
export const isProductId = s => /^P_\d{5}$/.test(s);

// A component score is a whole number 1-5 (5.2-5.5 "validate that it is between 1 and 5").
export const isScore = v => Number.isInteger(v) && v >= 1 && v <= 5;

// The score a component tool returned, or null when the tool errored or the value is not a whole number 0-5.
// A 0 is kept, because 5.6 treats 0 as missing.
export function scoreFromTool(value, key) {
  const v = value?.[key];
  return Number.isInteger(v) && v >= 0 && v <= 5 ? v : null;
}

// 5.6: hazard_score = safety + handling + transportation + disposal. A component that is missing or 0 takes the max of
// the other scores; more than two missing gives Unable to Decide with a score of 0; the total must lie within 4-20.
export function computeHazardScore(components, productIdValid) {
  const names = Object.keys(components);
  const present = names.filter(n => isScore(components[n]));
  const missing = names.filter(n => !present.includes(n));
  const unable = (reason) => ({ unable: true, hazard_score: 0, missing, imputed: [], reason });
  if (!productIdValid) return unable('product id fails the format check');
  if (missing.length > 2) return unable('more than two component scores missing');
  const fill = Math.max(...present.map(n => components[n]));
  const score = names.reduce((sum, n) => sum + (isScore(components[n]) ? components[n] : fill), 0);
  if (score < 4 || score > 20) return unable(`total ${score} outside 4-20`);
  return { unable: false, hazard_score: score, missing, imputed: missing, reason: missing.length ? 'imputed from the max of the other scores' : null };
}

// 5.7: bands over the 4-20 total, each the ceiling of its class: A 4-8, B 9-12, C 13-16, D 17-20. Higher is more severe.
const BANDS = [[8, 'Hazard Class A'], [12, 'Hazard Class B'], [16, 'Hazard Class C'], [20, 'Hazard Class D']];
export function hazardClassOf(score) {
  const band = BANDS.find(([max]) => score <= max);
  return band ? band[1] : UNABLE;
}
