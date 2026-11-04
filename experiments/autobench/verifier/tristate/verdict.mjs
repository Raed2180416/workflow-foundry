// Move 3 (ATTACK §6, D28 (1)): the three-valued verdict. Pure functions; no I/O, no model, no label.
//
// Every obligation of a candidate run is SUPPORTED, FAILED or UNKNOWN under a closed-world reading:
//   SUPPORTED  a code- or diff-decided check of an established obligation passed (for a positive check, with a content
//              constraint unless the policy also accepts existence-only checks);
//   FAILED     a code- or diff-decided check of an established obligation failed;
//   UNKNOWN    everything else, by kind: 'judged-only' (a model's verdict, never consumed as a decision), 'self-report'
//              (the actor's own checker), 'undecided' (the check could not be evaluated: a pointer that does not resolve),
//              'soft' (a check of an obligation the readers did not establish, WHETHER IT PASSED OR FAILED), 'existence-only'
//              (strict policy), 'labelled-null' (a value the rules do not determine, e.g. a "today" the request and the
//              work items do not establish: D28 (2)), 'unobservable', 'unexplained-effect' (a change in the world that no
//              passing positive check accounts for: the closed-world complement) and 'duplicate-effect' (a further change
//              matched by the same check with the same content: an effect without identity, RC5).
// Nothing maps UNKNOWN to pass. A run is released only when FAILED is empty AND it has at least one obligation: a verdict
// with no obligation at all is vacuous (RC3's "vacuous all-pass") and is held. Its UNKNOWN set is the assumption list.
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
//   TC code-decided       T1, but a check of an unestablished obligation decides both ways (pass SUPPORTED, fail FAILED):
//                         ATTACK §6 Move 3's literal "a code-decided or diff-decided check" (added in review, 2026-11-04)
//
// Review fix (tristate-v2, 2026-11-04). v1 let an unestablished check SUPPORT when it passed and only assume when it
// failed (an undeclared, asymmetric `softPass: SUPPORTED` in every policy), contrary to the definition above, and
// released a verdict with no obligation at all. v2 implements the definition as declared: 'soft' is UNKNOWN both ways
// (TC is the symmetric alternative, labelled post hoc), and an empty verdict is held. v1's numbers are superseded.
export const TRI_VERSION = 'tristate-v2';
export const SUPPORTED = 'SUPPORTED', FAILED = 'FAILED', UNKNOWN = 'UNKNOWN';

// soft: 'unknown' (an unestablished obligation's check is an assumption either way) | 'decide' (it decides either way)
export const POLICIES = Object.freeze({
  T1: Object.freeze({ name: 'T1', existenceOnly: SUPPORTED, unexplained: true, judgeVeto: false, soft: 'unknown' }),
  T2: Object.freeze({ name: 'T2', existenceOnly: UNKNOWN, unexplained: true, judgeVeto: false, soft: 'unknown' }),
  T0: Object.freeze({ name: 'T0', existenceOnly: SUPPORTED, unexplained: false, judgeVeto: false, soft: 'unknown' }),
  TJ: Object.freeze({ name: 'TJ', existenceOnly: SUPPORTED, unexplained: true, judgeVeto: true, soft: 'unknown' }),
  T3: Object.freeze({ name: 'T3', existenceOnly: SUPPORTED, unexplained: true, judgeVeto: false, soft: 'unknown', establishedOnly: true, postHoc: true }),
  TC: Object.freeze({ name: 'TC', existenceOnly: SUPPORTED, unexplained: true, judgeVeto: false, soft: 'decide', postHoc: true }),
});

// Observability of an UNKNOWN kind, for ATTACK's Move 3 kill clause ("the UNKNOWN set is dominated by unobservable
// kinds"): 'observable' kinds are decided on the world state (the doubt is about the spec, the actor or identity, not
// about what the verifier can see); 'unobservable' cannot be read from the world; 'unclassified' kinds (a model's
// verdict, a pointer that did not resolve) are not classified by any adapter here and are bounded instead (killClause).
export const OBSERVABILITY = Object.freeze({
  soft: 'observable', 'existence-only': 'observable', 'unexplained-effect': 'observable', 'duplicate-effect': 'observable',
  'self-report': 'observable', 'labelled-null': 'observable', unobservable: 'unobservable', 'judged-only': 'unclassified',
  undecided: 'unclassified', 'no-evidence': 'unclassified',
});
export const observabilityOf = kind => OBSERVABILITY[kind] ?? 'unclassified';

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
  const kind = o.established ? 'decided' : 'soft-decided';
  if (!o.established && policy.soft !== 'decide') return { status: UNKNOWN, kind: 'soft' };
  if (o.pass === false) return { status: FAILED, kind };
  if (o.polarity === 'must' && !o.content && policy.existenceOnly !== SUPPORTED) return { status: UNKNOWN, kind: 'existence-only' };
  return { status: SUPPORTED, kind };
}

/**
 * The verdict of one candidate: obligations plus the closed-world complement.
 *   effects = [{ key, explained: bool, duplicate?: bool }]  every meaningful change in the candidate's diff; an
 *             unexplained one is an UNKNOWN 'unexplained-effect', a duplicate one an UNKNOWN 'duplicate-effect'
 *             (policy.unexplained).
 * Returns { S, F, U, statuses: [{ id, source, status, kind }], assumptions: [UNKNOWN items], failed: [FAILED items],
 *           release: F === 0 and at least one obligation, vacuous: no obligation at all, row: SUPPORTED | FAILED | UNKNOWN }.
 */
export function verdictOf(obligations, effects = [], policy = POLICIES.T1) {
  const counted = policy.establishedOnly ? obligations.filter(o => o.established || o.unknownKind) : obligations;
  const statuses = counted.map(o => ({ id: o.id, source: o.source, ...obligationStatus(o, policy) }));
  if (policy.unexplained) for (const e of effects) {
    if (e.duplicate) statuses.push({ id: `effect:${e.key}`, source: 'diff', status: UNKNOWN, kind: 'duplicate-effect' });
    else if (!e.explained) statuses.push({ id: `effect:${e.key}`, source: 'diff', status: UNKNOWN, kind: 'unexplained-effect' });
  }
  const S = statuses.filter(s => s.status === SUPPORTED).length, F = statuses.filter(s => s.status === FAILED).length, U = statuses.filter(s => s.status === UNKNOWN).length;
  const vacuous = S + F + U === 0;
  return {
    S, F, U, statuses, vacuous,
    failed: statuses.filter(s => s.status === FAILED), assumptions: statuses.filter(s => s.status === UNKNOWN),
    release: F === 0 && !vacuous, row: F > 0 ? FAILED : U > 0 ? UNKNOWN : S > 0 ? SUPPORTED : UNKNOWN,
    unknownShare: S + U ? U / (S + U) : 1,
  };
}

/**
 * ATTACK Move 3's kill clause over a set of verdicts, evaluated honestly: UNKNOWN items of an 'unobservable' kind count
 * for it, 'observable' kinds against it, and 'unclassified' kinds are bounded both ways. "Dominated" = more than half
 * (share > 0.5). Returns { U, byObservability, shareLower, shareUpper, decision: 'triggered' | 'not triggered' |
 * 'not evaluable', basis }.
 */
export function killClause(verdicts) {
  const by = { observable: 0, unobservable: 0, unclassified: 0 };
  for (const v of verdicts) for (const s of v.assumptions ?? []) by[observabilityOf(s.kind)]++;
  const U = by.observable + by.unobservable + by.unclassified;
  const shareLower = U ? by.unobservable / U : 0, shareUpper = U ? (by.unobservable + by.unclassified) / U : 0;
  const decision = shareLower > 0.5 ? 'triggered' : shareUpper <= 0.5 ? 'not triggered' : 'not evaluable';
  const basis = decision === 'triggered' ? 'unobservable kinds alone exceed half of UNKNOWN'
    : decision === 'not triggered' ? (by.unclassified ? 'bound: even if every unclassified item were unobservable, they and the unobservable ones are at most half of UNKNOWN' : 'every UNKNOWN item is classified and the unobservable ones are at most half')
      : 'the unclassified items could make unobservable kinds dominate: classify them first';
  return { U, byObservability: by, shareLower, shareUpper, decision, basis };
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
