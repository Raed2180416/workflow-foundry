// DUR-1 J2 validity gate ($0; PREREG-DUR-1 §8.3). A red-team scenario is VALID iff the world generates, both reference
// timings pass 100% with 0 oracle errors, the world-contract assertions of the host hold (it loads), and every transform
// is from the in-spec list. A scenario that breaks the oracle against the reference AND all of S1-S3 is a BED FINDING:
// reported, excluded from arm scores. A scenario the reference fails but some S passes is invalid (not a finding).
import { checkVector } from '../knobs.mjs';
import { vectorBundle } from '../knobs.mjs';
import { registerRedTeam } from '../heal-adapter.mjs';
import { referencePools, gradeRun } from '../oracle.mjs';
import { runBundle, programVersion, REF_SOLVERS } from '../arms.mjs';
import { MAX_ORDERS } from './probe.mjs';

export async function validateScenario(scenario, { targetId = 'rt', sealed = null, checkSolvers = true } = {}) {
  const v = { base: 1301, salt: 0, difficulty: 3, mix: 'tail', size: 12, transforms: [], fault: 'none', overlays: [], ...scenario };
  try { checkVector(v); } catch (e) { return { valid: false, reason: `rejected: ${e.message}` }; }
  if (v.size > MAX_ORDERS) return { valid: false, reason: `rejected: more than ${MAX_ORDERS} arriving orders` };
  let b;
  try { b = await vectorBundle(`rt-${targetId}`, v, { sealed }); } catch (e) { return { valid: false, reason: `the world does not generate: ${String(e.message).slice(0, 200)}` }; }
  registerRedTeam(b.key);
  const ref = await referencePools(b);
  if (ref.control.ok) return { valid: true, key: b.key, vector: v, ooc: b.ooc };
  if (!checkSolvers) return { valid: false, reason: 'the reference fails it', problems: ref.control.problems.slice(0, 3) };
  // Does any blind solver pass where the reference fails? Then the oracle and the reference disagree with a solver: invalid.
  let allFail = true;
  for (const spec of Object.values(REF_SOLVERS)) {
    const r = await runBundle(b, { version: programVersion(spec) });
    const g = gradeRun(b, r.rows, ref.pools);
    if (g.completed && g.passed === g.completed) { allFail = false; break; }
  }
  return allFail ? { valid: false, bedFinding: true, key: b.key, vector: v, reason: 'the oracle fails the reference and every blind solver: a bed finding', problems: ref.control.problems.slice(0, 3) }
    : { valid: false, reason: 'the reference fails but a blind solver passes', problems: ref.control.problems.slice(0, 3) };
}
