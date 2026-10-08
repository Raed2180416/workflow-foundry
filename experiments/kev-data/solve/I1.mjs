// I1 fault_class: state-only solver (JUDGE-PROGRAM.md §2.7 step 1; see incident-lib.mjs).
//   solve({ state, question }, sc) -> { label, evidence } | { label: null, reason, ... }
// The state is { service, window, log_lines }: the root's own first lines after the fault began, names replaced by
// handles. Each line is matched to the catalog's templates; a line counts as evidence for a class when every pool
// that can have written it is emitted only under the origin tags (onset, root, precursor) of an incident of that class
// (a line of a lookalike, a blip, a stray, a rival, a baseline or a routine deploy never is: their pools have other
// tags). The class is the one the evidence names. Reasons it does not decide:
//   malformed-state  the state is not an I1 state
//   no-evidence      no line of the window is evidence of any class (an ordinary window, or an onset worded like a
//                    routine event: the state does not settle the question)
//   conflict         evidence names more than one class
import { makeSolverContext, splitLine, topPools, classOfPool, isEvidencePool } from './incident-lib.mjs';
export { makeSolverContext };
export const PORT = 'I1';
// the evidence of each line of a state: [{ class, weak }] (class null for a line that is no evidence of any class)
export function lineEvidence(state, sc) {
  return state.log_lines.map(text => {
    const l = splitLine(text);
    if (!l) return { class: null, weak: false };
    const pools = topPools(sc, l.message, state.service);
    if (!pools.length) return { class: null, weak: false };
    const evid = pools.filter(isEvidencePool);
    if (evid.length === pools.length) { const classes = [...new Set(evid.map(classOfPool))]; if (classes.length === 1) return { class: classes[0], weak: false }; }
    return { class: null, weak: true };
  });
}
export function solve({ state }, sc) {
  if (!state || typeof state.service !== 'string' || !Array.isArray(state.log_lines)) return { label: null, reason: 'malformed-state' };
  const votes = {}, weak = [];
  for (const text of state.log_lines) {
    const l = splitLine(text);
    if (!l) return { label: null, reason: 'malformed-state' };
    const pools = topPools(sc, l.message, state.service);
    if (!pools.length) continue;
    const evid = pools.filter(isEvidencePool);
    if (evid.length === pools.length) {
      const classes = [...new Set(evid.map(classOfPool))];
      if (classes.length === 1) votes[classes[0]] = (votes[classes[0]] ?? 0) + 1; else weak.push(...pools);
    } else weak.push(...pools);
  }
  const classes = Object.keys(votes);
  if (classes.length === 1) return { label: classes[0], evidence: votes[classes[0]] };
  if (classes.length > 1) return { label: null, reason: 'conflict', votes };
  return { label: null, reason: 'no-evidence', weak: [...new Set(weak)].slice(0, 4) };
}
