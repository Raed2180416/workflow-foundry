import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadLedger, seedRefusals } from '../../jit/seeds.mjs';
import {
  STAGES_FILE, PREREG_FILE, POLICY_FILE, EVAL_TASKS, checkStages, armSha, canonicalJson, evalDifficulty, exampleDifficulty, planTasks,
  exampleSet, e2eDraw, expandRuns, hashCollisions, span,
} from '../prereg-check.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const STAGES = JSON.parse(readFileSync(STAGES_FILE, 'utf8'));
const TEXT = readFileSync(PREREG_FILE, 'utf8');
const ledger = loadLedger();
const policy = JSON.parse(readFileSync(POLICY_FILE, 'utf8'));
const check = (s, text = TEXT) => checkStages(s, { ledger, policy, preregText: text });
const mutate = fn => { const s = structuredClone(STAGES); fn(s); return s; };
const hasError = (res, re) => res.errors.some(e => re.test(e));

test('the committed stages.json and PREREG-NEED-V1.md pass every check (ledger, policy, caps, text)', () => {
  const res = check(STAGES);
  assert.deepEqual(res.errors, []);
  assert.equal(res.summary.status, 'draft');
  assert.ok(res.summary.seedChecks > 900, `seed checks ${res.summary.seedChecks}`);
  assert.deepEqual(res.summary.totals, { estUsd: 951, capUsd: 1235, coreEstUsd: 663, coreCapUsd: 855 });
  assert.deepEqual(res.summary.clusters.train, ['W', 'kinetics', 'codefix', 'need-qa']);
  assert.match(TEXT, /Status: \*\*DRAFT/);
});

test('the ledger refuses what the checker refuses: wrong split, reserved range, held-out floor', () => {
  // A held-out job moved onto TRAIN evaluation seeds.
  assert.ok(hasError(check(mutate(s => { s.stages.find(x => x.id === 'NL2').runs[0].seedRoles = ['trainEval']; })), /held-out job incident on TRAIN evaluation seeds/));
  // Held-out evaluation moved onto the JIT held-out reservation (8001-8012, allow jit-heldout only).
  assert.ok(hasError(check(mutate(s => { s.seeds.heldoutEval = { from: 8001, to: 8012 }; })), /SEED_REFUSED \(range jit-heldout-a .*reserved for jit-heldout/));
  // Held-out seeds below heldoutMinSeed.
  assert.ok(hasError(check(mutate(s => { s.seeds.heldoutEval = { from: 7210, to: 7221 }; })), /held-out seeds must be >= 8001/));
  // TRAIN evaluation moved into the W-bed's own dev rows (reserved for jit-dev).
  assert.ok(hasError(check(mutate(s => { s.seeds.trainEval = { from: 379, to: 390 }; })), /SEED_REFUSED/));
  // An example purpose that is not in the ledger.
  assert.ok(hasError(check(mutate(s => { s.seeds.purposes.example = 'need-examples'; })), /purpose need-examples is not in the ledger/));
});

test('seed roles stay disjoint; example sets partition the examples; the probe is an example', () => {
  assert.ok(hasError(check(mutate(s => { s.seeds.trainReserve = { from: 615, to: 650 }; })), /seed roles trainEval and trainReserve share/));
  assert.ok(hasError(check(mutate(s => { s.seeds.exampleSets['3'] = [606, 607, 608]; })), /exampleSets must partition/));
  assert.ok(hasError(check(mutate(s => { s.seeds.probe = { seed: 610 }; })), /probe seed must be an example seed/));
  assert.ok(hasError(check(mutate(s => { s.seeds.trainEval = { from: 610, to: 620 }; s.seeds.trainReserve = { from: 621, to: 650 }; })), /must hold 12 seeds/));
});

test('held-out evaluation never precedes Freeze, and a TRAIN job never runs on held-out seeds', () => {
  assert.ok(hasError(check(mutate(s => { s.stages.find(x => x.id === 'NL1').runs.push({ job: 'r3p', arms: ['agent-H'], seedRoles: ['heldoutEval'] }); })), /held-out evaluation of r3p before Freeze/));
  assert.ok(hasError(check(mutate(s => { s.stages.find(x => x.id === 'NL2').runs.push({ job: 'records-hi', arms: ['agent-H'], seedRoles: ['heldoutEval'] }); })), /TRAIN job records-hi on heldoutEval seeds/));
});

test('spend: a cap over the $500 pause, a cap below its estimate and totals that drift are refused', () => {
  assert.ok(hasError(check(mutate(s => { s.stages.find(x => x.id === 'NL1').capUsd = 600; })), /over the \$500 pause/));
  assert.ok(hasError(check(mutate(s => { s.stages.find(x => x.id === 'NL1').capUsd = 600; })), /totals\.capUsd/));
  assert.ok(hasError(check(mutate(s => { s.stages.find(x => x.id === 'NL0').estUsd = 150; })), /NL0: cap 140 below estimate 150/));
  assert.ok(hasError(check(mutate(s => { s.policy.perExperimentPauseAboveUsd = 900; })), /differs from policy 500/));
});

test('arms: settings hash, model ids and base prices come from the definitions and the policy file', () => {
  assert.ok(hasError(check(mutate(s => { s.arms['agent-H'].budgetUsd = 3; })), /arm agent-H: settingsSha .* != computed/));
  const badModel = mutate(s => { s.arms['agent-H'].model = 'claude-haiku-9'; s.arms['agent-H'].settingsSha = armSha(s.arms['agent-H']); });
  assert.ok(hasError(check(badModel, null), /model claude-haiku-9 is not in policy/));
  assert.ok(hasError(check(mutate(s => { s.priceTable.models['claude-opus-5-5'].tiers[0].input = 5; })), /base tier 5\/20 differs from policy 4\/20/));
  assert.ok(hasError(check(mutate(s => { s.stages.find(x => x.id === 'NL0').runs[0].arms.push('agent-S'); })), /unknown arm agent-S/));
  assert.ok(hasError(check(mutate(s => { s.stages.find(x => x.id === 'NL0').runs[0].arms.push('build-O'); })), /arm build-O is not a mode or ceiling arm of job records-hi/));
  // The hash ignores key order and its own field.
  const a = STAGES.arms['construct-H'];
  const shuffled = Object.fromEntries(Object.entries(a).reverse());
  assert.equal(armSha(shuffled), a.settingsSha);
  assert.equal(armSha({ ...a, settingsSha: 'x' }), a.settingsSha);
  assert.equal(canonicalJson({ b: [2, { d: 1, c: 0 }], a: null }), '{"a":null,"b":[2,{"c":0,"d":1}]}');
});

test('jobs: one family per cluster, even bands, masked direct-H, agent-O budget follows the example census', () => {
  assert.ok(hasError(check(mutate(s => { s.jobs.find(j => j.id === 'synth-lo').cluster = 'kinetics'; s.jobs.find(j => j.id === 'synth-lo').split = 'train'; })), /family synth is in two clusters/));
  assert.ok(hasError(check(mutate(s => { s.jobs.find(j => j.id === 'need-qa').band = [1, 2, 3, 4, 5]; })), /cannot spread evenly over a band of 5/));
  assert.ok(hasError(check(mutate(s => { s.jobs.find(j => j.id === 'gameqa').modes.push('direct-H'); })), /direct-H is masked on interactive/));
  assert.ok(hasError(check(mutate(s => { s.jobs.find(j => j.id === 'r3p').agentOBudgetUsd = 4; })), /r3p: agentOBudgetUsd 4 != 8/));
  assert.ok(hasError(check(mutate(s => { s.jobs.find(j => j.id === 'r3p').split = 'train'; })), /split train differs from its cluster r3p/));
  for (const j of STAGES.jobs.filter(x => x.maxExampleTokens != null)) assert.equal(j.agentOBudgetUsd, j.maxExampleTokens > 30000 ? 8 : 4, j.id);
});

test('the preregistration text must carry the status, every job, stage and arm hash', () => {
  assert.ok(hasError(check(STAGES, TEXT.replace('Status: **DRAFT', 'Status: **FROZEN')), /does not say DRAFT/));
  assert.ok(hasError(check(STAGES, TEXT.replaceAll(STAGES.arms['construct-H'].settingsSha, '0000000000000000')), /construct-H's settings hash/));
  assert.ok(hasError(check(STAGES, TEXT.replaceAll('`need-constraint`', 'need-constraint')), /does not name job `need-constraint`/));
  assert.ok(hasError(check(mutate(s => { s.status = 'frozen'; })), /does not say FROZEN/));
});

test('every expanded run resolves to ledger-allowed seeds; example and evaluation seeds never meet', () => {
  const runs = expandRuns(STAGES);
  assert.ok(runs.length > 50);
  for (const x of runs) {
    if (x.job?.split === 'sealed') continue;
    assert.ok(x.bed, x.where);
    for (const seed of x.seeds) assert.deepEqual(seedRefusals(ledger, { bed: x.bed, split: x.split, seed, purpose: x.purpose }), [], `${x.where} s${seed}`);
  }
  const ex = new Set(span(STAGES.seeds.examples));
  for (const r of ['trainEval', 'trainReserve']) assert.ok(span(STAGES.seeds[r]).every(s => !ex.has(s)), r);
  // M1 runs on the W-bed attack seeds under jit-dev, the purpose triviality.mjs refuses against.
  const m1 = runs.filter(x => x.stage === 'M1');
  assert.equal(m1.length, 8);
  assert.equal(m1.reduce((n, x) => n + x.seeds.length, 0) * STAGES.stages.find(s => s.id === 'M1').runs[0].arms.length, 192);
  assert.deepEqual(m1.find(x => x.bed === 'wbed-r3p').seeds, span({ from: 479, to: 490 }));
});

test('per-seed difficulty: even blocks over the band, parity-balanced halves, examples cover the band', () => {
  for (const band of [[3], [1, 2], [3, 4, 5], [2, 3, 4, 5]]) {
    const ds = Array.from({ length: EVAL_TASKS }, (_, i) => evalDifficulty(band, i));
    for (const d of band) assert.equal(ds.filter(x => x === d).length, EVAL_TASKS / band.length, `band ${band} level ${d}`);
    if (band.length <= 3) for (const d of band) assert.equal(ds.filter((x, i) => x === d && i % 2 === 0).length, ds.filter((x, i) => x === d && i % 2 === 1).length);
    for (const k of [1, 2, 3]) {
      const lv = new Set(exampleSet(STAGES, k).map(s => exampleDifficulty(band, s)));
      assert.equal(lv.size, Math.min(3, band.length), `set ${k} band ${band}`);
    }
  }
  assert.deepEqual(exampleSet(STAGES, 4), exampleSet(STAGES, 1));
  assert.throws(() => evalDifficulty([3], 12));
  const stage = planTasks(STAGES, 'wbed-stage', 'trainEval');
  const kinds = STAGES.jobs.find(j => j.id === 'wbed-stage').stageKinds;
  for (const k of kinds) {
    assert.equal(stage.filter(t => t.stage === k).length, 3);
    assert.deepEqual(stage.filter(t => t.stage === k).map(t => t.difficulty), [3, 4, 5]);
  }
  const held = planTasks(STAGES, 'need-constraint', 'heldoutEval');
  assert.deepEqual(held.map(t => t.seed), span({ from: 8801, to: 8812 }));
  assert.ok(held.every(t => t.split === 'test'));
  assert.deepEqual(planTasks(STAGES, 'wbed-r0', 'probe'), [{ seed: 601, split: 'dev', difficulty: 2 }]);
  assert.throws(() => planTasks(STAGES, 'gameqa', 'heldoutEval'), /no frozen band/);
});

test('the E2E draw is seeded, order-independent and drawn from the eligible set', () => {
  const eligible = STAGES.stages.find(s => s.id === 'E2E').runs[0].eligible;
  const seed = STAGES.rng.e2eDraw;
  const a = e2eDraw(eligible, seed);
  assert.equal(a.length, 6);
  assert.deepEqual(e2eDraw([...eligible].reverse(), seed), a);
  assert.ok(a.every(x => eligible.includes(x)));
  assert.deepEqual(a, ['ownerci', 'r3p', 'need-constraint', 'far-1', 'gameqa', 'synth-lo']); // the draw printed in PREREG §12
  assert.equal(e2eDraw(['x', 'y'], seed).length, 2);
});

test('L4 pre-check: example and evaluation tasks of small anchor jobs never share a taskHash ($0)', async () => {
  const r = await hashCollisions(STAGES, { jobs: ['wbed-r0', 'need-qa', 'need-constraint', 'records-lo'] });
  assert.equal(r.tasks, 3 * 21 + 33);
  assert.deepEqual(r.exampleEval, []);
  assert.deepEqual(r.evalRepeats, []);
});

test('the checker imports no bed, oracle or sealed code at load time, and its CLI exits 0 on the committed files', () => {
  const src = readFileSync(path.join(here, '..', 'prereg-check.mjs'), 'utf8');
  const imports = [...src.matchAll(/^import .* from '([^']+)';$/gm)].map(m => m[1]);
  assert.deepEqual(imports.filter(p => !p.startsWith('node:')), ['../jit/seeds.mjs']);
  assert.ok(!/import\([^)]*sealed/.test(src));
  const out = execFileSync(process.execPath, [path.join(here, '..', 'prereg-check.mjs')], { encoding: 'utf8' });
  assert.match(out, /\nOK\n?$/);
});
