import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadLedger, seedRefusals } from '../../jit/seeds.mjs';
import {
  STAGES_FILE, PREREG_FILE, POLICY_FILE, EVAL_TASKS, checkStages, armSha, canonicalJson, evalDifficulty, exampleDifficulty, planTasks,
  exampleSet, e2eDraw, expandRuns, hashCollisions, span, probeDifficulty, namesToken, sectionOf, stamp, stampDiff, bedClosure,
  importedNames,
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
  // D9: NL0-owner adds $15 / $40; committedUsd counts M1 at its recorded $62.92; the soft-cap check adds M1-R ($25.89).
  assert.deepEqual(res.summary.totals, { estUsd: 966, capUsd: 1275, coreEstUsd: 663, coreCapUsd: 855, committedUsd: 1322.92, recurringCapUsd: 24, externalCommittedUsd: 25.89, softCapCheckUsd: 1372.81 });
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
  assert.ok(hasError(check(mutate(s => { s.stages.find(x => x.id === 'NL1').runs.push({ job: 'r3p', arms: ['agent-H'], seedRoles: ['heldoutEval'] }); })), /heldoutEval seeds \(test split\) before Freeze for r3p/));
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
  // M1 runs on the W-bed attack seeds under jit-dev, the purpose triviality.mjs refuses against: tag m1 (8 rungs at d3,
  // 192 calls) and tag m1-d5 (R2, R3, R3', R6 at d5, 96 calls).
  const m1 = runs.filter(x => x.stage === 'M1');
  const calls = tag => m1.filter(x => x.run.tag === tag).reduce((n, x) => n + x.seeds.length * x.run.arms.length, 0);
  assert.equal(m1.length, 12);
  assert.equal(calls('m1'), 192);
  assert.equal(calls('m1-d5'), 96);
  assert.ok(m1.filter(x => x.run.tag === 'm1-d5').every(x => x.run.difficulty === 5));
  assert.deepEqual(m1.filter(x => x.bed === 'wbed-r3p').map(x => x.seeds), [span({ from: 479, to: 490 }), span({ from: 479, to: 490 })]);
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
  assert.deepEqual(planTasks(STAGES, 'wbed-r0', 'probe'), [{ seed: 601, split: 'dev', difficulty: 4 }], 'the probe task sits at the band\'s median level (band [2..5])');
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
  assert.equal(r.tasks, 3 * 22 + 34, 'TRAIN: 9 examples + the probe task + 12; held-out need-constraint: 9 + 1 + 12 + 12 E2E');
  assert.deepEqual(r.refused, []);
  assert.equal(r.heldoutInChild, true);
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

// ------------------------------------------------------------------------------------- review fixes (2026-10-14)
const frozen = (s, text = TEXT) => { s.status = 'frozen'; return check(s, text.replace('Status: **DRAFT', 'Status: **FROZEN')); };
// The freeze-time placeholders filled, as the orchestrator would before freezing (for tests that freeze a copy).
const FILLED = TEXT.replace('| TBD at NL0 launch |', '| (stamp pasted at freeze) |').replace('**TBD-M0**', '**(simulation numbers)**');

test('review M4: before Freeze every test-split role is refused for every job; forced jobs never touch TRAIN seeds', () => {
  // The reviewer's scratch copy: frozen, plus four leaking runs. The first draft's checker printed OK.
  const leaky = mutate(s => {
    s.stages.find(x => x.id === 'NL0').runs.push({ job: 'incident', arms: ['agent-H'], seedRoles: ['e2e'] }, { job: 'runbook', arms: ['agent-H'], seedRoles: ['heldoutEval'] });
    s.stages.find(x => x.id === 'NL1').runs.push({ job: 'r3p', arms: ['agent-H'], seedRoles: ['heldoutReserve'] }, { job: 'synth-lo', arms: ['direct-H'], seedRoles: ['drift'] });
  });
  const res = frozen(leaky, FILLED);
  for (const re of [/NL0\.runs\[\d+\] \(incident\): e2e seeds \(test split\) before Freeze/, /NL0\.runs\[\d+\] \(runbook\): heldoutEval seeds \(test split\) before Freeze/,
    /NL1\.runs\[\d+\] \(r3p\): heldoutReserve seeds \(test split\) before Freeze/, /NL1\.runs\[\d+\] \(synth-lo\): drift seeds \(test split\) before Freeze/]) assert.ok(hasError(res, re), String(re));
  // A TRAIN job on a test reserve role after Freeze, and a forced job on TRAIN evaluation seeds, are refused too.
  assert.ok(hasError(check(mutate(s => { s.stages.find(x => x.id === 'NL2').runs.push({ job: 'records-hi', arms: ['agent-H'], seedRoles: ['heldoutReserve'] }); })), /TRAIN job records-hi on heldoutReserve seeds/));
  assert.ok(hasError(check(mutate(s => { s.stages.find(x => x.id === 'NL2b').runs.push({ job: 'runbook', arms: ['agent-H'], seedRoles: ['trainEval'] }); })), /held-out job runbook on TRAIN evaluation seeds \(trainEval\)/));
  assert.ok(hasError(check(mutate(s => { s.stages.find(x => x.id === 'E2E').runs.push({ job: 'runbook', arms: ['router-choice'], seedRoles: ['e2e'] }); })), /E2E lane runs held-out non-forced jobs only \(runbook is forced\)/));
  // An explicit-seed run on the test split before Freeze (an M1-style run) is refused.
  assert.ok(hasError(check(mutate(s => { s.stages.find(x => x.id === 'M1').runs[0].split = 'test'; })), /test-split seeds before Freeze/));
});

test('review M4: a frozen preregistration may not keep TBD-M0 or "TBD at ... launch" in §4.4 or §11', () => {
  const res = frozen(structuredClone(STAGES));
  assert.ok(hasError(res, /frozen, but PREREG §11 still carries TBD-M0/));
  assert.ok(hasError(res, /frozen, but PREREG §4\.4 still carries "TBD at NL0 launch"/));
  assert.deepEqual(frozen(structuredClone(STAGES), FILLED).errors, [], 'filled placeholders freeze cleanly; TBD-FREEZE and TBD-NL1 may stay');
  assert.match(sectionOf(TEXT, /^## 11\./m), /^## 11\. Power[\s\S]*TBD-M0[\s\S]*$/);
  assert.ok(!sectionOf(TEXT, /^## 11\./m).includes('## 12.'), 'a section ends at the next heading of its level');
  assert.ok(sectionOf(TEXT, /^### 4\.4\b/m).includes('TBD at NL0 launch') && !sectionOf(TEXT, /^### 4\.4\b/m).includes('## 5.'));
});

test('review M4: stage ids are matched as whole tokens (NL2 inside NL2b, M1 inside M1e do not count)', () => {
  assert.equal(namesToken('only NL2b and M1e here', 'NL2'), false);
  assert.equal(namesToken('only NL2b and M1e here', 'M1'), false);
  assert.equal(namesToken('the judge-H stage, then NL2.', 'NL2'), true);
  assert.equal(namesToken('see `judge-H`', 'judge-H'), true);
  // Remove every whole-token NL2p from the text: NL2bp still contains the letters, but the stage is no longer named.
  const text = TEXT.replace(/(^|[^A-Za-z0-9_-])NL2p(?=$|[^A-Za-z0-9_-])/gm, '$1NL-two-p');
  assert.ok(text.includes('NL2bp'));
  assert.ok(hasError(check(STAGES, text), /does not name stage NL2p \(as a whole token\)/));
});

test('review m1 (minor): held-out probe and judge rows run in an envelope stage committed before any matrix stage needs it', () => {
  const nl2p = STAGES.stages.find(s => s.id === 'NL2p'), nl2 = STAGES.stages.find(s => s.id === 'NL2');
  assert.equal(nl2p.commitsEnvelope, true);
  assert.ok(nl2p.runs.every(r => r.seedRoles.every(x => x === 'probe')));
  assert.ok(nl2.runs.every(r => !r.seedRoles.includes('probe')), 'NL2 holds no probe rows');
  assert.deepEqual(nl2.requiresEnvelope, ['NL2p']);
  const order = STAGES.stages.map(s => s.id);
  for (const [env, mat] of [['NL2p', 'NL2'], ['NL2bp', 'NL2b'], ['NL2p', 'E2E'], ['NL2bp', 'E2E']]) assert.ok(order.indexOf(env) < order.indexOf(mat), `${env} before ${mat}`);
  // Merging the probe rows back into the matrix stage (the first draft's NL2) is refused.
  assert.ok(hasError(check(mutate(s => { const p = s.stages.find(x => x.id === 'NL2p'); s.stages.find(x => x.id === 'NL2').runs.push(...p.runs); p.runs = []; })), /probe or judge rows of held-out job incident outside an envelope stage/));
  assert.ok(hasError(check(mutate(s => { delete s.stages.find(x => x.id === 'NL2').requiresEnvelope; })), /NL2: held-out job incident joins the matrix with no committed decisions envelope/));
  assert.ok(hasError(check(mutate(s => { s.stages.find(x => x.id === 'NL2p').runs.push({ job: 'incident', arms: ['agent-H'], seedRoles: ['heldoutEval'] }); })), /an envelope stage runs probe-task rows only/));
  assert.ok(hasError(check(mutate(s => { s.stages.find(x => x.id === 'NL2bp').decides = ['runbook']; })), /E2E: held-out job gameqa joins the matrix with no committed decisions envelope|NL2b: held-out job gameqa/));
  assert.ok(hasError(check(mutate(s => { const st = s.stages; const i = st.findIndex(x => x.id === 'NL2p'), j = st.findIndex(x => x.id === 'NL2'); [st[i], st[j]] = [st[j], st[i]]; })), /NL2: its envelope NL2p must come before it/));
});

test('review B2 and M7: M1 is recorded (both tags, one cap shared by tag); DRIFT is capped in the soft-cap check', () => {
  const m1 = STAGES.stages.find(s => s.id === 'M1');
  assert.deepEqual(m1.capShares, { m1: 5, 'm1-d5': 10 });
  assert.equal(m1.observed.m1.calls, 192);
  assert.equal(m1.observed.m1.timeoutRowsAtZero, 26);
  assert.ok(Math.abs(m1.observed.m1.meterUsd - (m1.observed.m1.reportedUsd + 26 * 1)) < 1e-9, 'the §12 meter charges each $0 timeout at its $1 bound');
  assert.equal(m1.observed.m1.m1RunSha256, '478744664b95accf016fe7ea628ee856b3ab7bdb559081a0b7ac261d4c8a58e7');
  assert.equal(m1.observed['m1-d5'].m1RunSha256, '7916277c5cae0d70181228d582547ffec47fca54d5c353890f95b4a1980d5692');
  for (const sha of [m1.observed.m1.m1RunSha256, m1.observed['m1-d5'].m1RunSha256]) assert.ok(TEXT.includes(sha), 'the runner sha per tag is in the text');
  assert.match(sectionOf(TEXT, /^### 0\.1\b/m), /M1-d5/);
  assert.match(sectionOf(TEXT, /^## 13\./m), /D1\. M1 ran without its launch stamp[\s\S]*D2\. M1-d5 was an unregistered run[\s\S]*D3\. M1's spend, re-metered/);
  assert.ok(hasError(check(mutate(s => { delete s.stages.find(x => x.id === 'M1').capShares; })), /M1: run tag m1 has no cap share/));
  assert.ok(hasError(check(mutate(s => { s.stages.find(x => x.id === 'M1').capShares['m1-d5'] = 15; })), /M1: cap shares \$20 exceed the stage cap \$15/));
  // DRIFT recurs: its cumulative cap enters the soft-cap check; a stage outside the totals without a run limit is refused.
  assert.ok(hasError(check(mutate(s => { delete s.stages.find(x => x.id === 'DRIFT').recurring; })), /DRIFT is outside the totals with no recurring run limit/));
  assert.ok(hasError(check(mutate(s => { s.stages.find(x => x.id === 'DRIFT').recurring.cumulativeCapUsd = 8; })), /DRIFT: recurring needs/));
  assert.ok(hasError(check(mutate(s => { s.stages.find(x => x.id === 'DRIFT').recurring = { maxRuns: 40, cumulativeCapUsd: 320 }; })), /plus recurring caps \$320 plus externally budgeted stages \$25\.89 is over the \$1500 session soft cap/));
});

test('review B2: r3p is near and dev-observed; its original hypothesis row stays, the M1-informed revision is logged; a drop sensitivity is mandatory', () => {
  const r3p = STAGES.jobs.find(j => j.id === 'r3p');
  assert.ok(r3p.near && r3p.devObserved.length >= 2);
  assert.equal(r3p.hypothesis.n1.class, 'workflow', 'the row written before M1 was read is kept');
  assert.equal(r3p.hypothesis.revisions[0].n1.class, 'either');
  assert.match(r3p.hypothesis.revisions[0].informedBy, /M1/);
  assert.deepEqual(r3p.band, [3, 4, 5], 'bands are not changed by one-call outcomes (DESIGN §6)');
  for (const id of ['wbed-r2-hi', 'wbed-r6', 'r3p']) assert.match(STAGES.jobs.find(j => j.id === id).bandDecision, /kept d3 after M1/);
  assert.ok(STAGES.analysis.mandatorySensitivities.some(m => m.drop?.includes('r3p') && m.appliesTo.includes('C7a') && m.appliesTo.includes('C7b')));
  assert.ok(hasError(check(mutate(s => { s.analysis.mandatorySensitivities = []; })), /job r3p is dev-observed: analysis.mandatorySensitivities must drop it for both C7a and C7b/));
  assert.ok(hasError(check(mutate(s => { delete s.jobs.find(j => j.id === 'r3p').hypothesis.revisions[0].informedBy; })), /r3p: hypothesis.revisions\[0\] needs a date and informedBy/));
  assert.ok(hasError(check(STAGES, TEXT.replaceAll('dev-observed', 'observed')), /does not flag the dev-observed job/));
});

test('review m4 (minor): the probe and judge-H read the band\'s median level; judge-H breaks ties without label data', () => {
  for (const j of STAGES.jobs.filter(x => x.band)) {
    const [p] = planTasks(STAGES, j.id, 'probe');
    assert.equal(p.seed, 601);
    assert.equal(p.difficulty, j.band[Math.floor(j.band.length / 2)], j.id);
    if (j.band.length > 1) assert.notEqual(p.difficulty, j.band[0], `${j.id}: not the band's easiest level`);
  }
  assert.equal(probeDifficulty([4, 5]), 5);
  assert.equal(probeDifficulty([3, 4, 5]), 4);
  assert.equal(probeDifficulty([2, 3, 4, 5]), 4);
  const jh = STAGES.arms['judge-H'];
  assert.doesNotMatch(jh.vote, /TRAIN/);
  assert.match(jh.vote, /fixed order direct-H, agent-H, agent-H\+proc, construct-H, agent-O/);
  assert.equal(armSha(jh), jh.settingsSha);
  assert.ok(TEXT.includes(jh.settingsSha));
});

test('review m6 (minor): --hashes checks every seed against the ledger and hashes held-out families only in a child process', async () => {
  // The child prints one line: counts and task ids, never task content or a hash.
  const out = execFileSync(process.execPath, [path.join(here, '..', 'prereg-check.mjs'), '--hash-child'], { input: JSON.stringify({ stages: STAGES, jobs: ['need-constraint'] }), encoding: 'utf8' });
  const lines = out.trim().split('\n');
  assert.equal(lines.length, 1);
  const r = JSON.parse(lines[0]);
  assert.deepEqual(Object.keys(r).sort(), ['evalRepeats', 'exampleEval', 'refused', 'tasks']);
  assert.equal(r.tasks, 34);
  assert.doesNotMatch(out, /[0-9a-f]{64}/, 'no task hash leaves the child');
  // The child's counts equal an in-process run of the same function on a TRAIN anchor (dev seeds only); child: false is
  // refused for a held-out job (second review, D9: the suite no longer hashes held-out tasks in-process).
  const outQa = execFileSync(process.execPath, [path.join(here, '..', 'prereg-check.mjs'), '--hash-child'], { input: JSON.stringify({ stages: STAGES, jobs: ['need-qa'] }), encoding: 'utf8' });
  const here2 = await hashCollisions(STAGES, { jobs: ['need-qa'], child: false });
  assert.equal(here2.heldoutJobs, 0);
  assert.equal(here2.tasks, JSON.parse(outQa.trim()).tasks);
  await assert.rejects(hashCollisions(STAGES, { jobs: ['need-constraint'], child: false }), e => e.code === 'HELDOUT_IN_PROCESS');
  // A seed the ledger refuses is reported and never generated (held-out evaluation moved onto the JIT reservation).
  const bad = mutate(s => { s.seeds.heldoutEval = { from: 8001, to: 8012 }; });
  const rb = await hashCollisions(bad, { jobs: ['need-constraint'] });
  assert.equal(rb.refused.length, 12);
  assert.equal(rb.tasks, 34 - 12);
});

test('review M6: label-engine stamps per paid stage; a first-used bed is allowed, any other engine change is a deviation', () => {
  assert.deepEqual(bedClosure(['wbed-r2']), ['lib', 'records', 'wbed', 'wbed-r2'], 'r2 reaches the W-bed library and records pools');
  const nl0 = stamp(STAGES, { stage: 'NL0' }).labelEngine, nl1 = stamp(STAGES, { stage: 'NL1' }).labelEngine;
  assert.equal(nl0.stage, 'NL0');
  assert.ok(nl0.files['experiments/need-router/label-run.mjs'] && !('experiments/need-router/router.mjs' in nl0.files), 'router code is in the analysis stamp, not the label engine');
  assert.ok(!('experiments/need-router' in nl0.trees), 'the whole need-router tree is no longer stamped');
  const d = stampDiff(nl0, nl1);
  assert.equal(d.ok, true);
  assert.ok(d.allowed.some(x => x.key === 'beds.kinetics'), 'TRAIN families first run in NL1 are first uses');
  // Changes that are deviations: a label-engine file, a bed used earlier, the preregistered prices, Node.
  const edit = (x, f) => { const y = structuredClone(x); f(y); return y; };
  assert.ok(stampDiff(nl0, edit(nl1, y => { y.files['experiments/need-router/label-run.mjs'] = 'changed'; })).deviations.some(x => x.key === 'files.experiments/need-router/label-run.mjs'));
  assert.ok(stampDiff(nl0, edit(nl1, y => { y.beds.wbed = 'changed'; })).deviations.some(x => x.key === 'beds.wbed' && x.since === 'NL0'));
  assert.ok(stampDiff(nl0, edit(nl1, y => { y.prereg.priceTable = 'changed'; })).deviations.some(x => x.key === 'prereg.priceTable'));
  assert.ok(stampDiff(nl0, edit(nl1, y => { y.node = 'v0'; })).deviations.some(x => x.key === 'node'));
  // A bed used in NL0 but not in NL1 is compared again when a later stage uses it (against every earlier stamp).
  const later = edit(nl1, y => { y.beds['wbed-r0'] = 'changed'; });
  assert.ok(stampDiff([nl0, nl1], later).deviations.some(x => x.key === 'beds.wbed-r0' && x.since === 'NL0'));
  // The analysis stamp lists the router and evaluation code that Freeze pins.
  const an = stamp(STAGES).analysis.files;
  for (const f of ['router.mjs', 'evaluate.mjs', 'card.mjs', 'prereg-rules.mjs']) assert.ok(`experiments/need-router/${f}` in an, f);
});

// ------------------------------------------------------------------------- review fixes, refreshed (2026-10-15)
const s01 = sectionOf(TEXT, /^### 0\.1\b/m), s13 = sectionOf(TEXT, /^## 13\./m);
const renameIn = (text, sec, ids, to) => text.replace(sec, sec.replace(new RegExp(`(^|[^A-Za-z0-9_-])(${ids.join('|')})(?=$|[^A-Za-z0-9_-])`, 'gm'), `$1${to}`));

test('review B2 refresh: a recorded run still in flight blocks the freeze; every recorded run is named in §0.1; an overrun is named in §13', () => {
  // M1-d5 was in flight at the first revision; the freeze must wait until its results are in §0.1.
  const inflight = mutate(s => { s.stages.find(x => x.id === 'M1').observed['m1-d5'] = { status: 'in-flight' }; });
  assert.ok(!hasError(check(inflight), /in-flight/), 'a draft may carry a run in flight');
  assert.ok(hasError(frozen(inflight, FILLED), /frozen, but stage M1: observed\.m1-d5 is in-flight: record its results in PREREG §0\.1 first/));
  assert.ok(hasError(check(mutate(s => { s.stages.find(x => x.id === 'M1').observed['m1-d5'].status = 'running'; })), /observed\.m1-d5: status must be complete or in-flight/));
  // §0.1 must name every recorded run and its stage (the first draft's §0 did not mention M1 at all).
  assert.ok(hasError(check(STAGES, renameIn(TEXT, s01, ['M1-R', 'm1-r'], 'the-rerun')), /PREREG §0\.1 does not name the recorded run M1-R \(stage M1-R\)/));
  assert.ok(hasError(check(STAGES, renameIn(TEXT, s01, ['m1-d5', 'M1-d5'], 'the-d5-run')), /PREREG §0\.1 does not name the recorded run m1-d5 \(stage M1\)/));
  // A recorded overrun of a cap share (on the §12 meter) must be a §13 deviation.
  assert.ok(hasError(check(STAGES, renameIn(TEXT, s13, ['m1-r'], 'the-rerun')), /stage M1-R: observed\.m1-r is \$25\.89 on the meter against its \$25 cap, and PREREG §13 does not name m1-r/));
  assert.ok(hasError(check(STAGES, renameIn(TEXT, s13, ['m1-d5'], 'the-d5-run')), /stage M1: observed\.m1-d5 is \$33\.92 on the meter against its \$10 cap/));
  // A complete record carries its figures and its runner's sha, and keys a run tag of its stage.
  assert.ok(hasError(check(mutate(s => { delete s.stages.find(x => x.id === 'M1').observed.m1.meterUsd; })), /observed\.m1: a complete record needs meterUsd/));
  assert.ok(hasError(check(mutate(s => { s.stages.find(x => x.id === 'M1').observed['m1-d5'].meterUsd = 1; })), /observed\.m1-d5: meterUsd 1 below reportedUsd 5\.9199/));
  assert.ok(hasError(check(mutate(s => { delete s.stages.find(x => x.id === 'M1-R').observed['m1-r'].m1RerunSha256; })), /observed\.m1-r: a complete record needs its runner's sha256/));
  assert.ok(hasError(check(mutate(s => { const m = s.stages.find(x => x.id === 'M1'); m.observed['m1-d7'] = m.observed['m1-d5']; })), /stage M1: observed\.m1-d7 names no run tag of the stage/));
  // The committed records: M1 closed with both tags complete, M1-R its own stage.
  const m1 = STAGES.stages.find(s => s.id === 'M1'), m1r = STAGES.stages.find(s => s.id === 'M1-R');
  assert.deepEqual(Object.values(m1.observed).map(o => o.status), ['complete', 'complete']);
  assert.equal(m1r.observed['m1-r'].status, 'complete');
  assert.deepEqual(frozen(structuredClone(STAGES), FILLED).errors, [], 'every recorded run is complete and named: the records do not block a freeze');
});

test('review M7 refresh: a stage outside the totals needs a recurring limit or an external budget whose plan names it', () => {
  const m1r = STAGES.stages.find(s => s.id === 'M1-R');
  assert.equal(m1r.inTotals, false);
  assert.equal(m1r.externalBudget.capUsd, m1r.capUsd);
  // M1-R is counted once, outside the stage totals, in the soft-cap check (externalCommittedUsd, D9).
  assert.deepEqual(check(STAGES).summary.totals, { estUsd: 966, capUsd: 1275, coreEstUsd: 663, coreCapUsd: 855, committedUsd: 1322.92, recurringCapUsd: 24, externalCommittedUsd: 25.89, softCapCheckUsd: 1372.81 }, 'M1-R is not double-counted');
  const edit = f => check(mutate(s => f(s.stages.find(x => x.id === 'M1-R'))));
  assert.ok(hasError(edit(st => { delete st.externalBudget; }), /M1-R is outside the totals with no recurring run limit and cumulative cap, and no externalBudget/));
  assert.ok(hasError(edit(st => { st.externalBudget.plan = 'research/need-router-20261014/DESIGN.md'; }), /M1-R: externalBudget plan research\/need-router-20261014\/DESIGN\.md does not name the stage/));
  assert.ok(hasError(edit(st => { st.externalBudget.plan = 'research/nowhere.md'; }), /externalBudget plan research\/nowhere\.md does not exist/));
  assert.ok(hasError(edit(st => { st.externalBudget.capUsd = 40; }), /M1-R: externalBudget capUsd 40 differs from the stage cap 25/));
  // M1-R's runs are checked against the ledger like M1's (dev attack seeds under jit-dev), and before Freeze.
  assert.ok(expandRuns(STAGES).filter(x => x.stage === 'M1-R').every(x => x.split === 'dev' && x.purpose === 'jit-dev'));
  assert.ok(hasError(edit(st => { st.runs[0].split = 'test'; }), /M1-R\.runs\[0\]: test-split seeds before Freeze/));
  // Its set-aside attempts (an invalid attempt, rate-limit rows re-run later) are on the meter like rows (§12).
  assert.match(STAGES.spendMeter.setAside, /counts like a row/);
  assert.match(sectionOf(TEXT, /^## 12\./m), /\*\*Set-aside attempts\*\* \(2026-10-15\)\. An attempt kept out of the results counts like a row/);
});

test('review §14 refresh: the analysis must import the preregistered rules from prereg-rules.mjs once the Freeze addendum pins it', () => {
  const rr = STAGES.analysis.requiredRules;
  assert.equal(rr.module, 'experiments/need-router/prereg-rules.mjs');
  for (const n of ['balancedAccuracyInterval', 'c7aReading', 'g1Reading', 'harmfulPositions', 'withDropAgreement', 'signFlipFloor', 'thetaFitStatus', 'locoFolds', 'fitOrRule']) assert.ok(rr.rules.includes(n), n);
  const [ev, ro] = rr.readers;
  const src = (evText, roText = '') => ({ [ev]: evText, [ro]: roText });
  const run = (sources, text = TEXT) => checkStages(STAGES, { ledger, policy, preregText: text, sources });
  const partial = src(`import { balancedAccuracyInterval, c7aReading as readC7a,\n  thetaFitStatus } from './prereg-rules.mjs';`, "import { locoFolds, fitOrRule } from './prereg-rules.mjs';");
  // While the A-Freeze row is TBD-FREEZE: a warning naming what is missing, no error.
  const draft = run(partial);
  assert.ok(!draft.errors.some(e => /do not import/.test(e)));
  const w = draft.warnings.find(x => /do not import/.test(x));
  assert.match(w, /g1Reading, harmfulPositions, withDropAgreement, signFlipFloor, missingDataRule, powerGate from prereg-rules\.mjs/);
  assert.doesNotMatch(w, /c7aReading|locoFolds/, '`x as y` and the router\'s imports count');
  // Once the Freeze addendum pins the analysis (A-Freeze filled), a missing rule is an error.
  const pinned = TEXT.replace('| A-Freeze (analysis stamp) | TBD-FREEZE (the Freeze addendum, §6) |', '| A-Freeze (analysis stamp) | (shas pasted at Freeze) |');
  assert.notEqual(pinned, TEXT);
  assert.ok(hasError(run(partial, pinned), /the Freeze addendum pins the analysis, but .* do not import g1Reading/));
  // Every rule imported (across the two readers, a namespace import included): neither a warning nor an error.
  const full = src(`import { ${rr.rules.slice(0, 5).join(', ')} } from './prereg-rules.mjs';`, `import * as P from './prereg-rules.mjs';\n${rr.rules.slice(5).map(n => `P.${n}(x);`).join('\n')}`);
  const ok = run(full, pinned);
  assert.ok(!ok.errors.some(e => /do not import/.test(e)) && !ok.warnings.some(x => /do not import/.test(x)));
  // A required rule the module does not export is refused (a typo in stages.json would otherwise pass silently).
  assert.ok(hasError(checkStages(mutate(s => { s.analysis.requiredRules.rules.push('c7aReadingz'); }), { ledger, policy, preregText: TEXT }), /requiredRules: c7aReadingz is not exported by experiments\/need-router\/prereg-rules\.mjs/));
  assert.deepEqual([...importedNames("import { a, b as c } from '../need-router/prereg-rules.mjs';\nimport { d } from './other.mjs';", 'prereg-rules.mjs')], ['a', 'b']);
});

test('review B2 refresh: M1-d5 informs a second logged r3p revision; the earlier rows stay; the printed r3p drop covers d3 and d5', () => {
  const r3p = STAGES.jobs.find(j => j.id === 'r3p');
  assert.equal(r3p.hypothesis.n1.class, 'workflow', 'the row written before M1 stays');
  assert.equal(r3p.hypothesis.revisions[0].n1.class, 'either', 'the first revision stays');
  const r2 = r3p.hypothesis.revisions[1];
  assert.equal(r2.date, '2026-10-15');
  assert.match(r2.informedBy, /m1-d5.*10\/12 and 11\/12/);
  assert.deepEqual([r2.n1.class, r2.n10.class], ['no-workflow', 'either']);
  assert.deepEqual(r3p.band, [3, 4, 5], 'the band rule was fixed before M1-d5 was read');
  assert.ok(r3p.devObserved.some(x => /m1-d5.*10\/12/.test(x)) && r3p.devObserved.some(x => /J-NEED-2/.test(x)));
  assert.ok(!r3p.devObserved.some(x => /in flight/.test(x)), 'no record still says in flight');
  assert.deepEqual(STAGES.analysis.mandatorySensitivities.find(m => m.dropTasks).dropTasks, { r3p: ['d3', 'd5'] });
  // The text carries the revision and the expectation it implies (no held-out N = 1 positive hypothesised).
  assert.match(sectionOf(TEXT, /^### 1\.1\b/m), /M1 tag `m1-d5`: one call passed 10\/12 and 11\/12 at d5[^\n]*\| no-workflow \/ direct-H \| either \/ direct-H \|/);
  assert.match(TEXT, /No held-out positive is hypothesised/);
});
