// Status of one condition for one build, shown to the person and to the builder (research/tracker-20261021/DOSSIER.md §5):
//   met      at least one decided activation and no violation (thin when fewer than 3 decided activations)
//   unmet    only from a grounded template check: a violation, with the evidence and the three-way choice
//            (the build is wrong / the check is wrong / my words are wrong)
//   unknown  with a reason: not-exercised, no-check, check-suspect, unverifiable, needs-answer, not-run, unconfirmed-check
//   waived   the person waived it, for this exact condition version and workflow hash, with a reason
// "Untested" is never "met": a check that no run activated, or whose activations were all undecided, is unknown (not-exercised).
// Declare's vacuous satisfaction (Di Ciccio et al., Inf. Syst. 2018) and BDD's undefined/pending steps are the precedents.
export const STATUS_VERSION = 'tracker-status/1';
export const STATUSES = Object.freeze(['met', 'unmet', 'unknown', 'waived']);
export const UNKNOWN_REASONS = Object.freeze({
  'not-exercised': 'no practice run reached this condition',
  'no-check': 'no check could be made from these words',
  'check-suspect': 'the check itself may be wrong',
  unverifiable: 'a run cannot show this; you check it yourself',
  'needs-answer': 'a detail is missing; answer the question',
  'not-run': 'not checked yet',
});
export const THIN_BELOW = 3;
export const CHOICES = Object.freeze(['the build is wrong', 'the check is wrong', 'my words are wrong']);

/**
 * statusOf(condition, { results, workflowHash, waiver, flags }) → { status, reason?, thin?, decided, violated, notActedOn, evidence }
 * results: [{ view, instances, decided, violated }] from checks.evaluate over every run of THIS build.
 */
export function statusOf(condition, { results = null, workflowHash = null, waiver = null, flags = [] } = {}) {
  const base = { decided: 0, violated: 0, notActedOn: 0, activated: 0, evidence: [] };
  if (waiver && waiver.conditionVersion === condition.version && (waiver.workflowHash === workflowHash || waiver.workflowHash === '*'))
    return { ...base, status: 'waived', reason: null, waived: { by: waiver.by, channel: waiver.channel, why: waiver.why, at: waiver.at } };
  if (condition.verification === 'inspection' || condition.verification === 'unverifiable') return { ...base, status: 'unknown', reason: 'unverifiable', why: condition.why ?? null };
  if (condition.missing?.length) return { ...base, status: 'unknown', reason: 'needs-answer', question: condition.missing[0] };
  if (!condition.check) return { ...base, status: 'unknown', reason: 'no-check', why: condition.why ?? null };
  if (!results) return { ...base, status: 'unknown', reason: 'not-run' };
  const all = results.flatMap(r => r.instances.map(i => ({ ...i, view: r.view })));
  const decided = all.filter(i => i.ok !== null), violated = decided.filter(i => i.ok === false);
  const counts = { decided: decided.length, violated: violated.length, notActedOn: all.filter(i => i.ok === null && i.why === 'not acted on').length, activated: all.length };
  // v2 (./semantics.mjs R-overlap, R-it): an instance can carry a question for the person instead of a verdict.
  const questions = [...new Set(all.filter(i => i.ok === null && i.question).map(i => i.question))].slice(0, 3);
  const asked = questions.length ? { questions } : {};
  if (flags.includes('suspect')) return { ...counts, status: 'unknown', reason: 'check-suspect', flags, evidence: violated.slice(0, 3), ...asked };
  if (violated.length) return { ...counts, status: 'unmet', choices: CHOICES, flags, evidence: violated.slice(0, 3), ...asked };
  if (!decided.length && questions.length) return { ...counts, status: 'unknown', reason: 'needs-answer', question: questions[0], flags, evidence: all.filter(i => i.question).slice(0, 3), ...asked };
  if (!decided.length) return { ...counts, status: 'unknown', reason: 'not-exercised', flags, evidence: all.filter(i => i.ok === null).slice(0, 3) };
  return { ...counts, status: 'met', thin: decided.length < THIN_BELOW, flags, evidence: decided.slice(0, 2), ...asked };
}

/** Counts per status (and per unknown reason) over a list of statuses. */
export function tally(statuses) {
  const out = { met: 0, unmet: 0, unknown: 0, waived: 0, unknownBy: {} };
  for (const s of statuses) { out[s.status]++; if (s.status === 'unknown') out.unknownBy[s.reason] = (out.unknownBy[s.reason] ?? 0) + 1; }
  return out;
}
