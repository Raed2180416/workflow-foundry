// PREREG-WBED-SLICE1 §8.1 item 1 (T2): a `static:` arm ran its script on run-compiled's default SDK (flow.mjs v1), because
// only JitRun defined `flowPath`. The W-bed reference workflows (arm c) are written on flow-v3 (`flow.phase`, `flow.flag`,
// `flow.wide`), so on v1 they crash and every task fell back to the Haiku interpreter: arm (c) would silently have been a
// second Haiku agent. `static@v3:<solve.mjs>` now runs the script on flow-v3; a plain `static:` arm is unchanged (no
// flowPath, the same definition and hash). $0: fakes and the references' stub gateway; no model is called.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runStream, normalizeConfig, parseArm, POLICY_MODELS } from '../stream.mjs';
import { FLOW_V3 } from '../run-compiled.mjs';
import { sandboxAvailable } from '../../../src/executors/claude-code.mjs';

const tmp = t => { const d = mkdtempSync(path.join(tmpdir(), 'jit-static-flow-')); t.after(() => rmSync(d, { recursive: true, force: true })); return d; };
const R1_REF = 'beds/wbed/references/r1-reference.mjs', R3_REF = 'beds/wbed/references/r3-reference.mjs';
const B1 = 'static:research/construction-20261006/artifacts/B1-haiku-records-k1/solve.mjs';

test('T2: static@v3 is a static arm on flow-v3 with its own definition; a plain static arm keeps its definition and hash', () => {
  // The live dev config's static arm, pinned in stream.test.mjs V1_HASHES and slice2-review T5.
  const raw = JSON.parse(readFileSync(new URL('../configs/dev-records-1.json', import.meta.url), 'utf8'));
  const c = normalizeConfig(raw);
  const plain = parseArm(B1, c, { policyIds: [...POLICY_MODELS] });
  assert.equal(plain.hash, 'ca4f763d5d03568e', 'the R0/dev static arm hash is unchanged');
  assert.equal('sdk' in plain, false); assert.equal('sdk' in plain.def, false);
  const v3 = parseArm(B1.replace('static:', 'static@v3:'), c, { policyIds: [...POLICY_MODELS] });
  assert.equal(v3.kind, 'static'); assert.equal(v3.sdk, 'v3'); assert.equal(v3.def.sdk, 'v3');
  assert.equal(v3.slug, `${plain.slug}-v3`, 'its own directory, so the two never share rows');
  assert.notEqual(v3.hash, plain.hash, 'a resume can never mix the two');
  assert.deepEqual({ ...v3.def, sdk: undefined, spec: undefined }, { ...plain.def, sdk: undefined, spec: undefined }, 'only spec and sdk differ');
  for (const bad of ['static@v2:x.mjs', 'static@V3:x.mjs', 'static@:x.mjs', 'agent@v3:claude-haiku-5-5']) assert.throws(() => parseArm(bad, c, { policyIds: [...POLICY_MODELS] }), /unknown arm kind/);
  // An arm cap may name the new spec (armSpendStopUsd keys are specs).
  const spec = `static@v3:${R1_REF}`;
  const cc = normalizeConfig({ ...raw, arms: [spec], armSpendStopUsd: { [spec]: 3 } });
  assert.equal(cc.armSpendStopUsd[spec], 3);
});

test('T2: a static@v3 arm passes flowPath = flow-v3 to runCompiled; a plain static arm passes none (run-compiled default)', async t => {
  const root = tmp(t);
  const solve = path.join(root, 'S', 'solve.mjs'); mkdirSync(path.dirname(solve)); writeFileSync(solve, '// static\n');
  const seen = [];
  const deps = {
    policyIds: [...POLICY_MODELS], outputSchema: { type: 'object' },
    makeTasks: async (familyId, { split, seeds, difficulty }) => seeds.map(seed => ({ familyId, task: { id: `fake:${seed}`, seed, split, difficulty, prompt: 'p', inputs: { seed } }, taskKey: `fake:${split}:d${difficulty}:s${seed}`, taskHash: `h${seed}` })),
    createModelPort: () => ({ port: { fake: true } }),
    score: async (f, task, output) => ({ pass: output?.v === task.seed, score: 1 }),
    interpret: async () => { throw new Error('no fallback expected'); },
    runCompiled: async a => { seen.push({ label: a.label, flowPath: a.flowPath }); return { status: 'ok', output: { v: a.task.seed }, trace: [], costUsd: 0.01, costUnknown: false, latencyMs: 1, meta: { errors: {} } }; },
  };
  const config = { experiment: 'static-flow', familyId: 'fake', split: 'dev', segments: [{ difficulty: 3, seeds: [1, 2] }], arms: [`static:${solve}`, `static@v3:${solve}`],
    perTaskUsd: 1, agentBudgetUsd: 1, agentMinutes: 1, concurrency: 2 };
  const res = await runStream({ config, deps, runRoot: path.join(root, 'runs'), workRoot: path.join(root, 'work'), log: () => {} });
  assert.ok(res.arms.every(a => a.errors.length === 0 && a.done === 2), JSON.stringify(res.arms));
  const by = slug => seen.filter(s => s.label.includes(`:${slug}:`));
  assert.equal(by('static-S-solve').length, 2); assert.ok(by('static-S-solve').every(s => s.flowPath === undefined), 'plain static: nothing passed (flow.mjs v1)');
  assert.equal(by('static-S-solve-v3').length, 2); assert.ok(by('static-S-solve-v3').every(s => s.flowPath === FLOW_V3), 'static@v3: flow-v3');
  assert.ok(res.rows.every(r => r.kind === 'static' && r.delivered === 'compiled'));
});

// End to end with the real runCompiled (sandboxed), the real W-bed task generator and oracle, and the references' $0 stub
// gateway (policy A: first enum value, first quoted sentence). Under v1 the R1 reference crashes (`flow.phase is not a
// function`) and the R3 reference too (`flow.wide`), so the task goes to the fallback; under v3 both run `ok`. Stub
// readings are wrong by construction, so the oracle's verdict is not asserted. Seed: the author fixture 373 (already
// read by references.test.mjs), d3.
const skip = sandboxAvailable() ? false : 'no user namespaces';
for (const [familyId, ref] of [['wbed-r1', R1_REF], ['wbed-r3', R3_REF]]) {
  test(`T2 end to end: the ${familyId} reference crashes as a plain static arm and runs ok as static@v3`, { skip }, async t => {
    const root = tmp(t);
    const beds = await import('../../lib/beds.mjs');
    const { stubPort } = await import('../../../beds/wbed/references/validate.mjs');
    const { runCompiled } = await import('../run-compiled.mjs');
    const fallbacks = [];
    const deps = {
      makeTasks: beds.makeTasks, score: beds.score, loadFamily: beds.loadFamily,
      createModelPort: () => ({ port: stubPort('A', []) }),
      interpret: async a => { fallbacks.push(a.traceId); return { traceId: a.traceId, answer: null, costUsd: 0, costUnknown: false, error: { code: 'NO_ANSWER' }, scripts: [], commands: [] }; },
      runCompiled,
    };
    const config = { experiment: `t2-${familyId}`, familyId, split: 'dev', segments: [{ difficulty: 3, seeds: [373] }], arms: [`static:${ref}`, `static@v3:${ref}`],
      gatewayModels: ['claude-haiku-5-5', 'claude-sonnet-5-5'], perTaskUsd: 1, agentBudgetUsd: 1, agentMinutes: 1, compiledMinutes: 5, concurrency: 2 };
    const res = await runStream({ config, deps, runRoot: path.join(root, 'runs'), workRoot: path.join(root, 'work'), log: () => {} });
    assert.ok(res.arms.every(a => a.errors.length === 0 && a.done === 1), JSON.stringify(res.arms));
    const row = slugEnd => res.rows.find(r => r.armSlug.endsWith(slugEnd));
    const v1 = row('-reference'), v3 = row('-reference-v3');
    assert.equal(v1.compiledStatus, 'crash', 'flow.mjs v1 lacks the primitives the reference uses');
    assert.equal(v1.delivered, 'interpreter', 'so the plain static arm measures its fallback, not the reference');
    assert.equal(v3.compiledStatus, 'ok'); assert.equal(v3.delivered, 'compiled', 'flow-v3: the reference itself delivers');
    assert.equal(fallbacks.length, 1, 'one fallback, from the plain arm');
    assert.ok(v3.costUsd > 0 && v3.costUsd < 0.1, `stub judge cost booked: ${v3.costUsd}`);
  });
}
