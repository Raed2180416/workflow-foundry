// The keyword baseline for R2's judged conditions. A router that decides a document's kind from keywords in its subject
// and body, checked in a fixed order, and a reason rule that takes the first reason keyword found. Both are written the
// way a reasonable dev-era rule would be (English keywords, the obvious word per kind). They are bad controls of the bed
// (`keyword-router`, `dispute-reason-keyword`) and the measured "keyword rule failure fraction" in W-BED-R2R3-NOTES.md.
// The keyword router never escalates: a rule has no notion of "both readings fit".
export const KEYWORD_RULES = [
  ['injection', /\b(system|assistant|automated|automation|override)\b|ignore (the|all|previous)/i],
  ['credit_note', /credit note|credit memo|\bcredited\b/i],
  ['remittance', /remittance|payment advice|we have paid|has been paid|paid today|payment of/i],
  ['dispute', /disput|incorrect|\bwrong\b|\bquery\b|complaint/i],
  ['bank_change', /bank details|\bIBAN\b|bank account/i],
  ['statement_request', /statement/i],
  ['invoice', /invoice|\bbill\b/i],
];
export function keywordRoute(text) {
  for (const [kind, re] of KEYWORD_RULES) if (re.test(text)) return kind;
  return 'unrelated';
}
export const REASON_RULES = [
  ['DAMAGED', /damag|broken|crushed/i],
  ['NOT_RECEIVED', /never (received|arrived|came)|not received|did not arrive/i],
  ['DUPLICATE', /twice|duplicate|same delivery/i],
  ['PRICE', /price|quoted/i],
  ['QUANTITY', /only \d+|short|missing/i],
];
export function keywordReason(text) {
  for (const [code, re] of REASON_RULES) if (re.test(text)) return code;
  return 'QUANTITY';
}
