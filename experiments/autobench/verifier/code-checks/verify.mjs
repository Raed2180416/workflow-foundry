// code-checks verifier: entry point.
//
//   import { verify } from './verify.mjs';
//   const r = verify({ view, world0, hf });   // view = vlab verifierView(row) (prompt, today, services, diff)
//   r.accept   true when no hard check fails
//   r.score    1 - sum of failed-check weights (higher = more likely correct); for ranking and selection
//   r.checks   [{id, family, hard, status, evidence}]
//
// Inputs are the request, the initial world and the world diff only. Optional hf = facts a cheap model extracted from
// the request text alone (facts.mjs); the model never sees a world or an outcome and never judges pass/fail.
import { deterministicFacts, groundFacts, FACTS_VERSION } from './facts.mjs';
import { indexWorld } from './lib.mjs';
import { runChecks, CHECKS_VERSION } from './checks.mjs';

export const VERSION = `code-checks-v1 (${CHECKS_VERSION}, ${FACTS_VERSION})`;
// Fixed before any held-out evaluation: a hard failure costs 1, a soft one 0.3.
export const DEFAULT_WEIGHTS = Object.freeze({ hard: 1, soft: 0.3 });

export function verify({ view, world0, hf = null, weights = null }) {
  const det = deterministicFacts(view.prompt.user);
  const idx = indexWorld(world0, view.prompt.user);
  const grounded = groundFacts(hf, view.prompt.user);
  const { checks, outputs } = runChecks({ view, idx, det, hf: grounded, world0 });
  const failed = checks.filter(c => c.status === 'fail');
  const w = c => (weights && weights[c.id] !== undefined ? weights[c.id] : c.hard ? DEFAULT_WEIGHTS.hard : DEFAULT_WEIGHTS.soft);
  const score = 1 - failed.reduce((a, c) => a + w(c), 0);
  return { version: VERSION, accept: !failed.some(c => c.hard), score, failed: failed.map(c => c.id), checks, outputs, usedModelFacts: Boolean(grounded) };
}
