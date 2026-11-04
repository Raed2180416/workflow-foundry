// Consumer-side conformance for a reused workflow (research/reuse-20261021/PREREG-C2-2.md). C2-1 measured a PRODUCER-side
// gate: profiles of the inputs and runs the entry was proven on in program A (gate.mjs). Its wrong reuse came from drift
// that profiles cannot see (scores that mean the opposite, or sit on another offset, inside the proven range). The
// consumer, program B, already holds labelled history for each of its suppliers (B's own past classifications). This
// module turns that history into the second half of "reused once proven to work":
//
//   G0  (per supplier, $0 for a code-only entry): run the entry on the supplier's labelled history; admit the entry for
//       that supplier only if it reproduces the labels. Two rules: 'all' (every history label reproduced; C2-1's post-hoc
//       rule) and 'm3' (the M3 bound of ATTACK-20261014 §3 on the history decisions: one-sided exact 95% upper bound on the
//       wrong rate ≤ 5% with at least 60 decisions; with 0 failures that needs 59–60 history items).
//   b3c (per item, $0): C2-1's G2 ∧ G3 (gate.mjs, unchanged options) against the entry's profiles WIDENED with the
//       supplier's conforming history (its inputs and its runs): what the entry was proven on, by A or by B. A branch A's
//       proof never reached but B's history did (missing scores, malformed ids) is then in profile; a run whose shape left
//       everything proven (a service that now answers strings) is still refused.
//
// Pure functions; the driver is c22.mjs.
import { checkProfile, widenProfile } from '../jit/profile.mjs';
import { clustersOf, reuseBoundRule } from '../lib/stats.mjs';
import { GATE_OPTIONS, inputDoc } from './gate.mjs';

export const CONFORMANCE_VERSION = 'c2-conformance/1';
/** The M3 rule's parameters (experiments/lib/stats.mjs reuseBoundRule defaults, method exact: the M3 choice "aE"). */
export const M3_OPTS = Object.freeze({ method: 'exact', bound: 0.05, level: 0.95, minN: 60 });

/**
 * Admission of an entry for one supplier from its conformance decisions.
 * decisions: [{ id, conform: boolean }] (one per labelled history product, each its own cluster).
 * rule: 'all' | 'm3'. Returns { admit, pass, of, rule, m3? }.
 */
export function admitByConformance(decisions, { rule = 'all' } = {}) {
  const of = decisions.length, pass = decisions.filter(d => d.conform).length;
  if (rule === 'all') return { rule, admit: of > 0 && pass === of, pass, of };
  if (rule === 'm3') {
    const m = reuseBoundRule(clustersOf(decisions.map(d => ({ parent: d.id, wrong: !d.conform }))), M3_OPTS);
    return { rule, admit: m.decision === 'serve', pass, of, m3: { decision: m.decision, upper: m.upper, nEff: m.nEff } };
  }
  throw new Error(`admitByConformance: unknown rule ${rule}`);
}

/**
 * The entry's profiles widened with a supplier's conforming history: { input, trace }. history: [{ task, doc, conform }]
 * (doc = gate.mjs traceDoc of the history run). Only conforming runs widen: a run that missed its label proves nothing.
 */
export function widenedProfiles(profiles, history) {
  let input = profiles.input, trace = profiles.trace;
  for (const h of history) {
    if (!h.conform) continue;
    input = widenProfile(input, inputDoc(h.task));
    trace = widenProfile(trace, h.doc);
  }
  return { input, trace };
}

/** b3c: C2-1's primary per-item check (G2 tolerant ∧ G3 ignoring added fields) against given (widened) profiles. */
export function gateItem(profiles, task, doc) {
  const g2 = checkProfile(profiles.input, inputDoc(task), GATE_OPTIONS.input);
  const g3 = checkProfile(profiles.trace, doc, GATE_OPTIONS.trace);
  return { accept: !g2.novel && !g3.novel, g2: !g2.novel, g3: !g3.novel,
    reasons: [...(g2.reasons ?? []), ...(g3.reasons ?? [])].slice(0, 3).map(x => ({ path: x.path, feature: x.feature })) };
}
