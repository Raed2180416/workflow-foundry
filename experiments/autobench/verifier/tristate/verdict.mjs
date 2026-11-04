// Move 3 (ATTACK §6, D28 (1)): the three-valued verdict. Pure functions; no I/O, no model, no label.
//
// Every obligation of a candidate run is SUPPORTED, FAILED or UNKNOWN under a closed-world reading:
//   SUPPORTED  a code- or diff-decided check of an established obligation passed (for a positive check, with a content
//              constraint unless the policy also accepts existence-only checks);
//   FAILED     a code- or diff-decided check of an established obligation failed;
//   UNKNOWN    everything else, by kind: 'judged-only' (a model's verdict, never consumed as a decision), 'self-report'
//              (the actor's own checker), 'undecided' (the check could not be evaluated: a pointer that does not resolve),
//              'soft' (a check of an obligation the readers did not establish, which failed), 'existence-only' (strict
//              policy), 'labelled-null' (a value the rules do not determine), 'unobservable', and 'unexplained-effect'
//              (a change in the world that no SUPPORTED positive obligation accounts for: the closed-world complement).
// Nothing maps UNKNOWN to pass. A run is released only when FAILED is empty; its UNKNOWN set is the assumption list.
// Selection ranks candidates by (FAILED asc, SUPPORTED desc, UNKNOWN asc); repair would consume FAILED only.
//
// Policies are fixed here, before any result was read (2026-11-04), and are compared by leave-one-task-out:
//   T1 lenient   existence-only positives count as SUPPORTED; unexplained effects are UNKNOWN
//   T2 strict    existence-only positives are UNKNOWN; unexplained effects are UNKNOWN
//   T0 open      T1 without the unexplained-effect obligations (the ablation of the closed-world complement)
//   TJ veto      T1, and a judged hard 'not_met' is FAILED (the one place a model verdict may block, never release)
// Added AFTER the first result was read (2026-11-04, exploratory, labelled post hoc wherever it is reported):
//   T3 established-only   T1, but an obligation the readers did not establish (soft) neither supports nor is assumed:
//                         it leaves the count (the first result showed soft and judged-only items dominate UNKNOWN)
export const TRI_VERSION = 'tristate-v1';
export const SUPPORTED = 'SUPPORTED', FAILED = 'FAILED', UNKNOWN = 'UNKNOWN';

export const POLICIES = Object.freeze({
  T1: Object.freeze({ name: 'T1', existenceOnly: SUPPORTED, unexplained: true, judgeVeto: false, softPass: SUPPORTED }),
  T2: Object.freeze({ name: 'T2', existenceOnly: UNKNOWN, unexplained: true, judgeVeto: false, softPass: SUPPORTED }),
  T0: Object.freeze({ name: 'T0', existenceOnly: SUPPORTED, unexplained: false, judgeVeto: false, softPass: SUPPORTED }),
  TJ: Object.freeze({ name: 'TJ', existenceOnly: SUPPORTED, unexplained: true, judgeVeto: true, softPass: SUPPORTED }),
  T3: Object.freeze({ name: 'T3', existenceOnly: SUPPORTED, unexplained: true, judgeVeto: false, softPass: SUPPORTED, establishedOnly: true, postHoc: true }),
});

/**
 * Status of one obligation.
 *   o = { id, source, decidedBy: 'code' | 'diff' | 'judge' | 'self' | 'none', polarity: 'must' | 'must_not',
 *         established: bool (hard: the readers agree it is an obligation), pass: true | false | null,
 *         content: bool (a positive check that constrains content, not only existence), unknownKind?: string }
 */
export function obligationStatus(o, policy = POLICIES.T1) {
  if (o.unknownKind) return { status: UNKNOWN, kind: o.unknownKind };
  if (o.decidedBy === 'self') return { status: UNKNOWN, kind: 'self-report' };
  if (o.decidedBy === 'judge') {
    if (policy.judgeVeto && o.established && o.pass === false) return { status: FAILED, kind: 'judge-veto' };
    return { status: UNKNOWN, kind: 'judged-only' };
  }
  if (o.decidedBy !== 'code' && o.decidedBy !== 'diff') return { status: UNKNOWN, kind: 'undecided' };
  if (o.pass === null || o.pass === undefined) return { status: UNKNOWN, kind: 'undecided' };
  if (!o.established) return o.pass ? { status: policy.softPass, kind: policy.softPass === SUPPORTED ? 'soft-pass' : 'soft' } : { status: UNKNOWN, kind: 'soft' };
  if (o.pass === false) return { status: FAILED, kind: 'decided' };
  if (o.polarity === 'must' && !o.content && policy.existenceOnly !== SUPPORTED) return { status: UNKNOWN, kind: 'existence-only' };
  return { status: SUPPORTED, kind: 'decided' };
}

/**
 * The verdict of one candidate: obligations plus the closed-world complement.
 *   effects = [{ key, explained: bool }]  every meaningful change in the candidate's diff; an unexplained one is an
 *             UNKNOWN obligation of kind 'unexplained-effect' (policy.unexplained).
 * Returns { S, F, U, statuses: [{ id, source, status, kind }], assumptions: [UNKNOWN items], failed: [FAILED items],
 *           release: F === 0, row: SUPPORTED | FAILED | UNKNOWN }.
 */
export function verdictOf(obligations, effects = [], policy = POLICIES.T1) {
  const counted = policy.establishedOnly ? obligations.filter(o => o.established || o.unknownKind) : obligations;
  const statuses = counted.map(o => ({ id: o.id, source: o.source, ...obligationStatus(o, policy) }));
  if (policy.unexplained) for (const e of effects) if (!e.explained) statuses.push({ id: `effect:${e.key}`, source: 'diff', status: UNKNOWN, kind: 'unexplained-effect' });
  const S = statuses.filter(s => s.status === SUPPORTED).length, F = statuses.filter(s => s.status === FAILED).length, U = statuses.filter(s => s.status === UNKNOWN).length;
  return {
    S, F, U, statuses,
    failed: statuses.filter(s => s.status === FAILED), assumptions: statuses.filter(s => s.status === UNKNOWN),
    release: F === 0, row: F > 0 ? FAILED : U > 0 ? UNKNOWN : S > 0 ? SUPPORTED : UNKNOWN,
    unknownShare: S + U ? U / (S + U) : 1,
  };
}

/** Release at a coverage threshold: no FAILED, and the UNKNOWN share at most theta (theta 0: fully SUPPORTED only). */
export const releasedAt = (v, theta) => v.F === 0 && v.S + v.U > 0 && v.unknownShare <= theta + 1e-12;

/** Lexicographic selection key: fewer FAILED, then more SUPPORTED, then fewer UNKNOWN (lower sorts first). */
export const selectionKey = v => [v.F, -v.S, v.U];
export function compareVerdicts(a, b) {
  const ka = selectionKey(a), kb = selectionKey(b);
  for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
  return 0;
}
/** Pick one candidate: [{ id, verdict }] in fork order; ties keep fork order (the default fork first). */
export function select(cands) {
  let best = null;
  for (const c of cands) if (!best || compareVerdicts(c.verdict, best.verdict) < 0) best = c;
  return best;
}
