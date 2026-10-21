// BUILDER-1's simulated person (frozen with the cases). It answers a builder's question from the case's answer key and nothing else:
// a question matches a required question when it names the same slot (template arms) or when its text matches one of the required
// question's patterns (any arm; case-insensitive). A question that matches none gets the fixed fallback and counts as unnecessary.
// One question may match several required questions (it is then answered with all of their answers).
export const FALLBACK = "I don't mind - use whatever you think is sensible.";

export function matches(required, question) {
  const text = String(question.question ?? '');
  return (question.slot && required.slot && question.slot === required.slot) || (required.match ?? []).some(rx => new RegExp(rx, 'i').test(text));
}
/** { text, matched: [required ids] } for one question of one case. */
export function respond(caseDef, question, fallback = FALLBACK) {
  const hits = (caseDef.questions ?? []).filter(r => matches(r, question));
  return hits.length ? { text: hits.map(h => h.answer).join(' '), matched: hits.map(h => h.id) } : { text: fallback, matched: [] };
}
