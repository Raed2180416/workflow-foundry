// Test helper: the rule phrases of the records task (its prompt and its written spec) that a no-spec task must not contain.
// Every phrase is checked against records' own text (so the list is not vacuous) and against this family's text.
// Matching is case-insensitive substring search. The records source notes are kept by this family (they describe how each
// system writes its data), so no phrase here may occur in them; the test asserts that too.

/** Phrases from the records PROMPT (beds/records/render.mjs buildPrompt): what inputs.spec is said to define. */
export const PROMPT_PHRASES = [
  'canonical schema',
  'which rows are the same person',
  'which value wins on conflict',
  'phone normalisation',
  'USD conversion',
  'rates included',
  'exactly one record per real person',
  'inputs.spec',
];

/** Phrases from the records SPEC (buildSpec): the rules themselves. */
export const SPEC_PHRASES = [
  'one master record per real-world person',
  'smallest row id among the rows you merged',
  'void rows never appear here',
  'Rows that do not count',
  'never merge or split people',
  'Two rows describe the same person',
  'chains count',
  'namesakes exist',
  'household line',
  'Names match when',
  'formal name',
  'typing error',
  'most recently updated',
  'first row in this order that supplies a usable value wins',
  'Accent restoration',
  'ASCII renderings',
  'trunk prefix',
  'Calling codes and trunk prefixes',
  'Italian numbers keep their leading 0',
  'rounded half away from zero',
  'round once',
  'never round the rate',
  'A credit stays negative',
  'USD balances are not converted',
  'Appendix A',
  'nicknames and the formal given name',
  'E.164 form',
  'that field is null',
];

export const RULE_PHRASES = [...PROMPT_PHRASES, ...SPEC_PHRASES];

/** Split text into sentence-like units (at ". ", "; " ": " boundaries and newlines) and keep those with at least minWords words. */
export function sentencesOf(text, minWords = 6) {
  return text.split(/\n|(?<=[.!?;])\s+/).map(s => s.trim()).filter(s => s.split(/\s+/).length >= minWords);
}
