// tokens.mjs: the library's token counter (LIBRARY.md §4.1 index lines, §5.2 cap table). No tokenizer for Claude
// models is installed in this repository (node_modules has none; src/context.mjs estimates bytes / 4), so this is a
// documented, calibrated heuristic.
//
// CALIBRATION (2026-10-09, $0, tools/calibrate-tokens.mjs; numbers in fixtures/token-calibration.json):
//   data   1,243 successful claude-haiku-5-5 calls through the claude CLI provider, with the provider's own input-token
//          counts (input + cache read + cache write): research/jit-20261008/runs/jit-r0-records/... journal.jsonl
//          (1,085 compile-time judge calls; ledger/records prose with numbers and JSON), and the Kev independence
//          (120) and J1 (38) Haiku journals (prose states in JSON). Prompt sizes 615-12,625 chars, i.e. about 320-5,000
//          content tokens: the range of every cap in LIBRARY §5.2.
//   fit    least squares with one intercept per journal (the CLI's own system prompt, about 1,000 tokens, fitted
//          990-998) and four text features:
//            tokens ~= 0.939 * letterRuns + 0.224 * letterChars + 0.873 * digitChars + 0.605 * punctuationChars
//          rmse 18.7 tokens. A plain chars-only fit gives 2.73 chars/token (rmse 37.8); prose-heavy journals 2.89.
//   bound  the counter uses rounded coefficients (1.0, 0.22, 0.9, 0.65) times a safety factor of 1.15. On the 1,243
//          calibration rows it undercounts 1 (min ratio 0.982), median ratio 1.186, max 1.272 (test/tokens.test.mjs).
//   note   LIBRARY-TESTS T1 names "chars / 3.5, conservative". On this data chars / 3.5 undercounts EVERY row (median
//          ratio 0.74, min 0.54), so it is not conservative for Haiku 5.5; this counter replaces it (BUILD-ORDER
//          "Implementation status"). Caveat: code-heavy text (the L0 card's examples) is outside the calibration
//          content; the punctuation coefficient is the one to re-check if a live tokenizer count ever becomes available.
export const COEFFICIENTS = Object.freeze({ lRuns: 1.0, lChars: 0.22, dChars: 0.9, punct: 0.65 });
export const SAFETY = 1.15;

// The counter's features (also what the calibration fixture stores per call).
export function featuresOf(text) {
  const t = String(text ?? '');
  const letters = t.match(/\p{L}+/gu) ?? [];
  return {
    lRuns: letters.length,
    lChars: letters.reduce((n, w) => n + w.length, 0),
    dChars: (t.match(/\p{N}/gu) ?? []).length,
    punct: (t.match(/[^\p{L}\p{N}\s]/gu) ?? []).length,
  };
}
const raw = f => COEFFICIENTS.lRuns * f.lRuns + COEFFICIENTS.lChars * f.lChars + COEFFICIENTS.dChars * f.dChars + COEFFICIENTS.punct * f.punct;
// The point estimate (no safety factor): reporting only.
export const estimateTokens = text => Math.ceil(raw(featuresOf(text)));
// The conservative bound every cap is checked against.
export const countTokens = text => (text == null || text === '' ? 0 : Math.ceil(SAFETY * raw(featuresOf(text))));
// From precomputed features (calibration rows).
export const countFromFeatures = f => Math.ceil(SAFETY * raw(f));
