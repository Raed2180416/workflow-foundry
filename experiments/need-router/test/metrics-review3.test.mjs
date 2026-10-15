// Regression tests for the third adversarial review of the need-router metrics and evaluator (2026-10-15): one test or
// more per fixed defect, each failing on the code before the fix. $0: synthetic matrices only, no model calls, no
// held-out task generated; the git checks run in a temporary repository.
//   node --test experiments/need-router/test/metrics-review3.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  evaluate, commitDecisions, verifyEnvelope, validatePolicies, loadRouterPolicies, defaultPolicies, sbsTrain, peekRouter, routingChecks, readingOf, importPurity,
  heldoutRowsGit, routerModuleRecord, analysisClosure, splitIntegrity, renderReport, syntheticWorld, ROUTER_FILES, CONTROL_POLICIES, PREREG_RNG, PREREG_REPS, PAIRED_ALPHA,
} from '../evaluate.mjs';
import { needTable, needLabels, cellStats, withCascades, signFlipTest, SIGN_FLIP_MC, clusterBootstrapDelta, rng, DELTA, HEADLINE, makeCell, GRID } from '../metrics.mjs';
import { matrixRow } from '../label-run.mjs';
import { canonical, sha256 } from '../../../beds/lib/canonical.mjs';
import { plantedWorld, judgeAlwaysAgent, features } from './worlds.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '../../..');
const FAST = { reps: 60, bootReps: 0, l2Perms: 0, randomDraws: 20, attacks: false, leak: false };
const trainOnly = W => ({ rows: W.rows.filter(r => W.meta[r.job].split === 'train'), builds: W.builds.filter(b => W.meta[b.job].split === 'train') });
const STAGES = JSON.parse(readFileSync(path.join(REPO, 'research/need-router-20261014/prereg/stages.json'), 'utf8'));

// ---------------------------------------------------------------------------- major 1: a peek-flagged co-primary
test('major 1: a policy that declares peek is refused unless it is a fixed control; no route lets a co-primary read held-out labels', async () => {
  // The reviewer's case: a null world (structure carries no signal) and a --router policy named NR-static with peek: true.
  const W = plantedWorld({ informative: false });
  const recorded = judgeAlwaysAgent(W.meta);
  const rogue = { name: 'NR-static', role: 'primary', peek: true, fit: ctx => (view, cell) => ({ mode: ctx.peek ? ctx.peek(view, cell).top : view.modes[0], pred: { p: 0.9, usd: 0.1 } }) };
  const policies = defaultPolicies().map(p => (p.name === 'NR-static' ? rogue : p));
  assert.throws(() => validatePolicies(policies), /policy NR-static \(role primary\) declares peek: only the fixed controls peek \(control\) and SBS-test \(optimistic\)/);
  // Before the fix the envelope sealed 0 NR-static decisions and the evaluation scored Δ 0.088 (lower bound 0.047) with F6 clear.
  assert.throws(() => commitDecisions({ ...trainOnly(W), meta: W.meta, recorded, policies, reps: 60, createdAt: '2026-10-24T00:00:00Z' }), /declares peek/);
  assert.throws(() => evaluate({ ...W, recorded, policies, split: 'heldout', ...FAST }), /declares peek/);
  // A --router module is validated on load.
  const dir = mkdtempSync(path.join(tmpdir(), 'nr-rogue-'));
  writeFileSync(path.join(dir, 'rogue.mjs'), "export const policies = [{ name: 'NR-static', role: 'primary', peek: true, fit: () => () => ({ mode: 'direct-H' }) }];\n");
  await assert.rejects(loadRouterPolicies(path.join(dir, 'rogue.mjs')), /declares peek/);
  writeFileSync(path.join(dir, 'ok.mjs'), "export const policies = [{ name: 'NR-static', role: 'primary', fit: () => (view) => ({ mode: view.modes[0] }) }];\n");
  assert.equal((await loadRouterPolicies(path.join(dir, 'ok.mjs'))).find(p => p.name === 'NR-static').peek, undefined);
  // The other doors: a control role under another name, a co-primary under another role, a shortcut primary, a peek under
  // the right name but the wrong role, a recorded policy with a fitted policy's name.
  const fit = () => () => ({ mode: 'direct-H' });
  assert.throws(() => validatePolicies([{ name: 'mine', role: 'control', fit }]), /role control is reserved/);
  assert.throws(() => validatePolicies([{ name: 'NR-probe', role: 'baseline', fit }]), /co-primary: its role must be primary/);
  assert.throws(() => validatePolicies([{ name: 'NR-static', role: 'primary', shortcut: true, fit }]), /declared shortcut/);
  assert.throws(() => validatePolicies([{ name: 'peek', role: 'primary', peek: true, fit }]), /declares peek/);
  assert.throws(() => validatePolicies([{ name: 'x', role: 'baseline', fit }, { name: 'x', role: 'baseline', fit }]), /two policies are named x/);
  assert.throws(() => validatePolicies(defaultPolicies(), { recordedNames: ['NR-static'] }), /collide with a fitted policy/);
  assert.deepEqual(CONTROL_POLICIES, { peek: 'control', 'SBS-test': 'optimistic' });
  assert.doesNotThrow(() => validatePolicies(defaultPolicies(), { recordedNames: ['judge-H', 'NR-probe'] }));
  // The fixed controls still read the labels (L1 positive control).
  const R = evaluate({ ...plantedWorld({ seed: 31 }), split: 'heldout', ...FAST });
  assert.ok(Math.abs(R.scores.peek[HEADLINE.key].closedGapVBS - 1) < 1e-12);
});

test('major 1: L6 requires a sealed decision for every scored non-control policy, every evaluated job and every cell', () => {
  const W = plantedWorld({ train: 3, heldout: 3, jobs: 1, seed: 32 });
  const env = commitDecisions({ ...trainOnly(W), meta: W.meta, reps: 60, createdAt: '2026-10-24T00:00:00Z' });
  const jobs = Object.keys(W.meta).filter(j => W.meta[j].split === 'heldout'), cells = GRID.map(c => c.key);
  assert.equal(verifyEnvelope(env, env, { required: { policies: ['NR-static', 'SBS-train'], jobs, cells } }).ok, true);
  // A policy the envelope left out (the old peek path) is a problem once it is scored.
  const v = verifyEnvelope(env, env, { required: { policies: ['NR-static', 'unsealed'], jobs, cells } });
  assert.ok(v.problems.some(p => new RegExp(`scored policy unsealed has no sealed decision for ${jobs.length * cells.length} \\(job, cell\\) pair`).test(p)), v.problems.join('\n'));
  // End to end: evaluate passes every scored policy but the fixed controls; a clean evaluation stays clean.
  const R = evaluate({ ...W, committed: env, split: 'heldout', ...FAST, leak: true, l2Perms: 5 });
  assert.equal(R.leaks.L6.ok, true, R.leaks.L6.problems.join('\n'));
});

// -------------------------------------------------------------------------------------- major 2: racing bias
test('major 2: a planted agent-O success rate is recovered under the per-task racing top-up rule (PREREG §4.3)', () => {
  // Tasks of two kinds (agent-O passes 20% or 90%: mean 0.55); direct-H passes 30% at $0.02; agent-O costs $0.60. agent-O's
  // second draw is run only where its first draw put it in the per-task acceptable set (label-run racingPlan).
  const r = rng(11), rows = [], T = 2000;
  let truth = 0, oldS = 0;
  const u = (pass, c) => (pass ? 1 : 0) - c;
  for (let i = 0; i < T; i++) {
    const t = `t${i}`, seed = 610 + (i % 41), pO = i % 2 ? 0.9 : 0.2;
    truth += pO;
    const d = [r() < 0.3, r() < 0.3], o0 = r() < pO;
    d.forEach((p, k) => rows.push({ job: 'J', mode: 'direct-H', task: t, rep: k, seed, pass: p, delivered: p, usdRepriced: 0.02 }));
    rows.push({ job: 'J', mode: 'agent-O', task: t, rep: 0, seed, pass: o0, delivered: o0, usdRepriced: 0.6 });
    if (u(o0, 0.6) >= Math.max(u(d[0], 0.02), u(o0, 0.6)) - DELTA - 1e-12) { const o1 = r() < pO; rows.push({ job: 'J', mode: 'agent-O', task: t, rep: 1, seed, pass: o1, delivered: o1, usdRepriced: 0.6 }); oldS += (o0 + o1) / 2; }
    else oldS += o0;
  }
  truth /= T; oldS /= T;
  const se = Math.sqrt(truth * (1 - truth) / T);
  const tab = needTable(rows, [], { requireRepriced: true }), st = cellStats(tab, 'J', 'agent-O');
  assert.ok(Math.abs(st.s - truth) < 3 * se, `scored s ${st.s} vs planted ${truth} (se ${se})`);
  assert.ok(truth - oldS > 3 * se, `the old per-task average ${oldS} was biased down from ${truth} (se ${se})`);
  // The top-ups are counted, never silently dropped; the scored replicates are the first draws; the label bootstrap and
  // the cross-fit read the same (needLabels' point stats are cellStats').
  assert.equal(tab.topUps.length, 1); assert.equal(tab.topUps[0].mode, 'agent-O'); assert.deepEqual(tab.topUps[0].scoredReps, [0]);
  assert.equal(tab.cell('J', 'agent-O').extraDraws, tab.topUps[0].draws);
  const L = needLabels(tab, { cells: [HEADLINE], reps: 20 });
  assert.equal(L.stats('J', 'agent-O').s, st.s);
  // A job-level top-up (every task) is averaged: rep 1 everywhere enters the scored set.
  const full = needTable([...rows.filter(x => !(x.mode === 'agent-O' && x.rep === 1)), ...rows.filter(x => x.mode === 'agent-O' && x.rep === 0).map(x => ({ ...x, rep: 1, pass: !x.pass, delivered: !x.pass }))]);
  assert.deepEqual(full.cell('J', 'agent-O').scoredReps.get('t0'), [0, 1]); assert.equal(full.topUps.length, 0);
  assert.ok(Math.abs(cellStats(full, 'J', 'agent-O').s - 0.5) < 1e-12, 'each task holds one pass and one fail');
});

test('major 2: the cascade pairs with the fallback\'s scored draw, never its per-task top-up', () => {
  const row = (mode, t, rep, pass, extra = {}) => ({ job: 'J', mode, task: `t${t}`, rep, seed: 610 + t, pass, delivered: pass || mode !== 'agent-H', schemaValid: true, usdRepriced: 0.01, ...extra });
  // agent-H delivers nothing on t0; agent-O's first draw fails there and its top-up passes.
  const rows = [row('agent-H', 0, 0, false), row('agent-H', 1, 0, true), row('agent-O', 0, 0, false), row('agent-O', 1, 0, true), row('agent-O', 0, 1, true)];
  const T = withCascades(rows, [], [{ id: 'agent-H->agent-O', primary: 'agent-H', fallback: 'agent-O', on: ['null'] }]);
  assert.equal(T.cell('J', 'agent-H->agent-O').byTask.get('t0').get(0).pass, false, 'paired with agent-O\'s first draw (before: rep 0 % 2 picked it too, but rep 1 of a 2-draw primary picked the top-up)');
  const rows2 = [...rows, row('agent-H', 0, 1, false), row('agent-H', 1, 1, true)];
  const T2 = withCascades(rows2, [], [{ id: 'agent-H->agent-O', primary: 'agent-H', fallback: 'agent-O', on: ['null'] }]);
  assert.equal(T2.cell('J', 'agent-H->agent-O').byTask.get('t0').get(1).pass, false, 'agent-H draw 2 falls back to agent-O\'s scored draw, not to its top-up');
});

// --------------------------------------------------------------------- major 3: the envelope pins the analysis
test('major 3: the envelope seals the A-Freeze files, the import closure and the --router module; L5 scans the module', () => {
  const W = plantedWorld({ train: 3, heldout: 3, jobs: 1, seed: 33 });
  const env = commitDecisions({ ...trainOnly(W), meta: W.meta, reps: 60, createdAt: '2026-10-24T00:00:00Z' });
  assert.deepEqual(Object.keys(env.payload.routerShas).sort(), [...ROUTER_FILES].sort());
  for (const f of ['card.mjs', 'prereg-rules.mjs']) assert.ok(ROUTER_FILES.includes(f), `${f} in the A-Freeze list`);
  for (const f of ['experiments/jit/stats.mjs', 'experiments/lib/stats-ebed.mjs', 'experiments/lib/stats.mjs', 'experiments/need-router/prereg-rules.mjs', 'experiments/need-router/card.mjs',
    'experiments/need-router/evaluate.mjs', 'beds/lib/canonical.mjs']) assert.match(env.payload.closureShas[f] ?? '', /^[0-9a-f]{64}$/, f);
  assert.equal(env.payload.routerModule, null);
  // A dependency edited after the commit (here: the recomputed closure differs) fails L6, file by file.
  const moved = structuredClone(env); moved.payload.closureShas['experiments/jit/stats.mjs'] = 'f'.repeat(64);
  assert.ok(verifyEnvelope(env, moved).problems.some(p => /frozen dependency experiments\/jit\/stats\.mjs changed after commit/.test(p)));
  // The --router module: path and sha sealed, its closure too; another module (or none) at reading time fails L6.
  const dir = mkdtempSync(path.join(tmpdir(), 'nr-mod-'));
  writeFileSync(path.join(dir, 'mod.mjs'), "import { HEADLINE } from './helper.mjs';\nexport const policies = [{ name: 'NR-static', role: 'primary', fit: () => (view) => ({ mode: view.modes[0] }) }];\nexport { HEADLINE };\n");
  writeFileSync(path.join(dir, 'helper.mjs'), 'export const HEADLINE = 1;\n');
  const mod = routerModuleRecord(path.join(dir, 'mod.mjs'));
  assert.equal(mod.path, path.join(dir, 'mod.mjs')); assert.match(mod.sha256, /^[0-9a-f]{64}$/);
  const withMod = commitDecisions({ ...trainOnly(W), meta: W.meta, reps: 60, createdAt: '2026-10-24T00:00:00Z', routerModule: mod });
  assert.deepEqual(withMod.payload.routerModule, mod);
  assert.ok(Object.keys(withMod.payload.closureShas).includes(path.join(dir, 'helper.mjs')), 'the module\'s own imports are pinned');
  assert.ok(verifyEnvelope(withMod, env).problems.some(p => /router module changed after commit: sealed .*mod\.mjs/.test(p)));
  assert.deepEqual(Object.keys(analysisClosure()).filter(k => k.startsWith('/')), [], 'repository files are recorded by repository path');
  // L5 scans the module (and its neighbours): an oracle import there is caught.
  writeFileSync(path.join(dir, 'leaky.mjs'), "import { oracle } from './helper.mjs';\nexport const policies = [];\n");
  const bad = importPurity({ files: [path.join(dir, 'leaky.mjs')] });
  assert.ok(bad.problems.some(p => /imports oracle from \.\/helper\.mjs/.test(p)), bad.problems.join('\n'));
  const R = evaluate({ ...W, split: 'train', ...FAST, leak: true, routerModule: routerModuleRecord(path.join(dir, 'leaky.mjs')) });
  assert.equal(R.leaks.L5.ok, false); assert.equal(R.leaks.f6, true);
  assert.equal(evaluate({ ...W, split: 'train', ...FAST, leak: true }).leaks.L5.ok, true);
});

// ------------------------------------------------------------------------------- major 4: L6 ordering in time
test('major 4: createdAt is hashed; a held-out reading needs timestamped rows, a launch record and the commit graph', () => {
  const W = plantedWorld({ train: 3, heldout: 3, jobs: 1, seed: 34 });
  const env = commitDecisions({ ...trainOnly(W), meta: W.meta, reps: 60, createdAt: '2026-10-24T00:00:00Z' });
  assert.equal(env.payload.createdAt, '2026-10-24T00:00:00Z');
  // Editing the outer createdAt no longer moves the envelope; editing the sealed one breaks the hash.
  const outer = { ...env, createdAt: '2026-10-01T00:00:00Z' };
  assert.ok(verifyEnvelope(outer, env).problems.some(p => /outside the hashed payload differs/.test(p)));
  const inner = structuredClone(env); inner.payload.createdAt = '2026-10-01T00:00:00Z';
  assert.ok(verifyEnvelope(inner, env, { firstHeldoutRowAt: '2026-10-20T00:00:00Z' }).problems.some(p => /does not match its sha256/.test(p)));
  assert.ok(verifyEnvelope(env, env, { firstHeldoutRowAt: '2026-10-23T00:00:00Z' }).problems.some(p => /envelope created 2026-10-24T00:00:00Z, not before/.test(p)));
  const legacy = { createdAt: '2026-10-01T00:00:00Z', sha256: sha256(canonical({ decisions: [] })), payload: { decisions: [] } };
  assert.ok(verifyEnvelope(legacy, { payload: { decisions: [] } }, { firstHeldoutRowAt: '2026-10-20T00:00:00Z' }).problems.some(p => /outside its hashed payload/.test(p)));
  // Under provenance: rows without `at`, no launch record, and the git order are each problems.
  const pv = { committedAt: '2026-10-25T08:00:00Z', commits: 1, aFreeze: env.payload.routerShas, firstHeldoutAt: '2026-10-25T10:00:00Z', launched: [] };
  const vp = (over = {}) => verifyEnvelope(env, env, { provenance: pv, ...over });
  assert.equal(vp().ok, true, vp().problems.join('\n'));
  assert.ok(vp({ heldoutRows: { total: 36, timestamped: 30 } }).problems.some(p => /6 of 36 held-out row\(s\) carry no record time/.test(p)));
  assert.ok(vp({ heldoutRows: { total: 0, timestamped: 0 } }).problems.some(p => /no held-out row/.test(p)));
  assert.ok(verifyEnvelope(env, env, { provenance: { ...pv, firstHeldoutAt: null }, firstHeldoutRowAt: '2026-10-26T00:00:00Z' }).problems.some(p => /no launch time for the held-out matrix/.test(p)),
    'a timestamped row does not stand in for the launch record');
  assert.ok(vp({ firstHeldoutRowAt: '2026-10-25T07:00:00Z' }).problems.some(p => /not before the first held-out launch or row 2026-10-25T07:00:00Z/.test(p)));
  const g = rows => ({ envelopeCommit: 'e'.repeat(40), rows });
  assert.equal(vp({ rowsGit: g([{ file: 'r/nl2/rows.jsonl', adds: [{ commit: 'a'.repeat(40), ancestor: true }] }]) }).ok, true);
  assert.ok(vp({ rowsGit: g([{ file: 'r/nl2/rows.jsonl', adds: [{ commit: 'a'.repeat(40), ancestor: false }] }]) }).problems.some(p => /is not a strict ancestor of aaaaaaaaaaaa, which adds r\/nl2\/rows\.jsonl/.test(p)));
  assert.ok(vp({ rowsGit: g([{ file: 'r/nl2/rows.jsonl', adds: [{ commit: 'e'.repeat(40), ancestor: true }] }]) }).problems.some(p => /not a strict ancestor/.test(p)), 'committed together is not before');
  assert.ok(vp({ rowsGit: g([{ file: 'r/nl2/rows.jsonl', adds: [] }]) }).problems.some(p => /are in no commit/.test(p)));
  assert.ok(vp({ rowsGit: g([]) }).problems.some(p => /no held-out rows file/.test(p)));
  assert.ok(vp({ rowsGit: { envelopeCommit: null, rows: [] } }).problems.some(p => /was not found/.test(p)));
  // evaluate: held-out rows without `at` fail L6 under provenance; with provenance but no git record, L6 is not passed.
  const noAt = W.rows.map(r => (W.meta[r.job].split === 'heldout' ? { ...r, at: undefined } : r));
  const R = evaluate({ ...W, rows: noAt, committed: env, split: 'heldout', ...FAST, leak: true, envelopeProvenance: pv, rowsProvenance: g([{ file: 'x', adds: [{ commit: 'a'.repeat(40), ancestor: true }] }]) });
  const nHeld = W.rows.filter(r => W.meta[r.job].split === 'heldout').length;
  assert.ok(R.leaks.L6.problems.some(p => p.startsWith(`${nHeld} of ${nHeld} held-out row(s) carry no record time`)), R.leaks.L6.problems.join('\n'));
  const R2 = evaluate({ ...W, committed: env, split: 'heldout', ...FAST, leak: true, envelopeProvenance: pv });
  assert.ok(R2.leaks.L6.problems.some(p => /git history was not checked/.test(p)) && R2.leaks.L6.ok === false);
  // label-run writes the trial record's time on every row.
  const rec = { arm: 'direct-H', taskKey: 'records:dev:d3:s610', trial: 0, costUsd: 0.01, taskHash: 'h', pass: true, error: null, at: '2026-10-26T01:02:03.000Z', meta: { delivered: true, callSeq: [0, 0] } };
  const row = matrixRow(rec, { stage: 'NL2', job: { id: 'j', cluster: 'c', split: 'heldout', family: 'records' }, armDef: { factory: 'b0Call' }, priceTable: STAGES.priceTable,
    book: { attempt: () => [] }, taskInfo: { seed: 8801, difficulty: 3 } });
  assert.equal(row.at, '2026-10-26T01:02:03.000Z');
});

test('major 4: heldoutRowsGit reads the real commit graph (a temporary repository)', () => {
  const repo = mkdtempSync(path.join(tmpdir(), 'nr-git-'));
  const git = (...a) => { const r = spawnSync('git', ['-c', 'user.email=t@example.invalid', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...a], { cwd: repo, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
  git('init', '-q');
  mkdirSync(path.join(repo, 'env')); mkdirSync(path.join(repo, 'runs', 'nl2'), { recursive: true }); mkdirSync(path.join(repo, 'runs', 'nl2b'), { recursive: true });
  writeFileSync(path.join(repo, 'runs', 'nl2b', 'rows.jsonl'), '{}\n'); git('add', '.'); git('commit', '-q', '-m', 'rows before the envelope');
  writeFileSync(path.join(repo, 'env', 'NL2p.json'), '{}\n'); git('add', '.'); git('commit', '-q', '-m', 'envelope');
  const envCommit = git('rev-parse', 'HEAD');
  writeFileSync(path.join(repo, 'runs', 'nl2', 'rows.jsonl'), '{}\n'); git('add', '.'); git('commit', '-q', '-m', 'held-out rows');
  const rowsCommit = git('rev-parse', 'HEAD');
  const stageInfo = [{ stage: 'nl2', splits: ['heldout'], rowsFile: 'runs/nl2/rows.jsonl' }, { stage: 'nl2b', splits: ['heldout'], rowsFile: 'runs/nl2b/rows.jsonl' }, { stage: 'nl1', splits: ['train'], rowsFile: 'runs/nl1/rows.jsonl' }];
  const g = heldoutRowsGit({ decFile: path.join(repo, 'env', 'NL2p.json'), stageInfo, split: 'heldout', repo });
  assert.equal(g.envelopeCommit, envCommit);
  assert.deepEqual(g.rows.map(r => [r.file, r.adds.map(a => [a.commit === rowsCommit, a.ancestor])]), [['runs/nl2/rows.jsonl', [[true, true]]], ['runs/nl2b/rows.jsonl', [[false, false]]]]);
  const v = verifyEnvelope({ sha256: sha256(canonical({ decisions: [] })), payload: { decisions: [] } }, { payload: { decisions: [] } },
    { provenance: { committedAt: '2026-10-25T08:00:00Z', commits: 1, aFreeze: {}, firstHeldoutAt: '2026-10-25T10:00:00Z' }, rowsGit: g });
  assert.deepEqual(v.problems.filter(p => /ancestor/.test(p)).length, 1, v.problems.join('\n'));
  assert.ok(v.problems.some(p => /which adds runs\/nl2b\/rows\.jsonl/.test(p)), 'the rows committed before the envelope are caught');
});

// --------------------------------------------------------------------------------- major 5: arm versions
test('major 5: one arm setting per mode across jobs; the strict meter is stamped all or none; TRAIN and evaluated arms must agree', () => {
  const stamp = settingsSha => ({ stageSha: 's', settingsSha, prompts: {}, priceTable: 'p' });
  const row = (job, mode, t, st) => ({ job, mode, task: `t${t}`, rep: 0, seed: 610 + t, pass: true, delivered: true, schemaValid: true, usdRepriced: 0.01, ...(st ? { stamp: stamp(st) } : {}) });
  const two = (a, b) => [0, 1].flatMap(t => [row('A', 'agent-H', t, a), row('B', 'agent-H', t, b)]);
  // The reviewer's case: agent-H under settings SA on job A and SB on job B was accepted.
  assert.throws(() => needTable(two('SA', 'SB'), [], { requireRepriced: true }), /agent-H: rows or builds under 2 arm settings across jobs \(stamp.settingsSha SA on A; stamp.settingsSha SB on B\)/);
  assert.throws(() => needTable(two('SA', 'SB')), /across jobs/, 'outside the strict meter too');
  assert.deepEqual(needTable(two('SA', 'SA'), [], { requireRepriced: true }).settingsByMode, { 'agent-H': 'SA' });
  // Stamped all or none under the strict meter; none is flagged (claims blocked by evaluate).
  assert.throws(() => needTable(two('SA', null), [], { requireRepriced: true }), /2 row\(s\) or build\(s\) without a label-run stamp \(stamp.settingsSha\) among 2 stamped ones/);
  assert.doesNotThrow(() => needTable(two('SA', null)), 'the non-strict v0 path keeps working');
  assert.deepEqual(needTable(two(null, null), [], { requireRepriced: true }).unstamped, { count: 4 });
  // evaluate: an evaluated mode under another settingsSha than TRAIN's blocks claims; unstamped rows block them too.
  const W = plantedWorld({ train: 3, heldout: 3, jobs: 1, seed: 35 });
  const edited = W.rows.map(r => (r.mode === 'agent-H' && W.meta[r.job].split === 'heldout' ? { ...r, stamp: { settingsSha: 'agent-H-edited' } } : r));
  const R = evaluate({ ...W, rows: edited, split: 'heldout', ...FAST });
  assert.deepEqual(R.validity.armVersions.differ, [{ mode: 'agent-H', train: 'synthetic:agent-H', eval: 'agent-H-edited' }]);
  assert.ok(R.blocked.some(b => /arm versions: agent-H was fitted under stamp.settingsSha synthetic:agent-H on TRAIN and scored under agent-H-edited/.test(b)), R.blocked.join('\n'));
  const strip = x => { const { stamp: _s, ...y } = x; return y; };
  const U = evaluate({ ...W, rows: W.rows.map(strip), builds: W.builds.map(strip), split: 'heldout', ...FAST });
  assert.ok(U.blocked.some(b => /arm versions: \d+ row\(s\) and build\(s\) of TRAIN and heldout carry no label-run stamp/.test(b)), U.blocked.join('\n'));
  assert.equal(evaluate({ ...W, split: 'heldout', ...FAST }).blocked.length, 0, 'stamped and agreeing: nothing blocked');
});

// ------------------------------------------------------------------------------------ minor 6: routing dollars
test('minor 6: probe and judge rows are on the one meter; an unprobed card says so; judge-H is reconciled with its call rows', () => {
  // The reviewer's case: routingUsd 0, no probe object, the job has a paid probe row and a probe row with no dollars.
  const r = routingChecks([{ policy: 'NR-probe', job: 'j', routingUsd: 0 }], [{ job: 'j', mode: 'direct-H', draw: 0, usdRepriced: 0.03 }, { job: 'j', mode: 'direct-H', draw: 1 }]);
  assert.equal(r.ok, false); assert.equal(r.unprobed, 0);
  assert.ok(r.problems.some(p => /probe row j\/direct-H\/1: no finite usdRepriced/.test(p)));
  assert.ok(r.problems.some(p => /has probe rows \(\$0\.030000\) but the card charges \$0 with no probe object/.test(p)));
  // A usdReported-only row is not charged at its reported figure.
  const rep = routingChecks([{ policy: 'NR-probe', job: 'j', routingUsd: 0.05, probe: { ran: true, modes: ['direct-H', 'agent-H'] } }], [{ job: 'j', mode: 'agent-H', draw: 0, usdReported: 0.04 }, { job: 'j', mode: 'direct-H', draw: 0, usdRepriced: 0.03 }]);
  assert.ok(rep.problems.some(p => /probe row j\/agent-H\/0: no finite usdRepriced/.test(p)));
  // An explicit "not probed" card is counted, not charged.
  const no = routingChecks([{ policy: 'NR-probe', job: 'j', routingUsd: 0, probe: { ran: false } }], [{ job: 'j', mode: 'direct-H', draw: 0, usdRepriced: 0.03 }]);
  assert.equal(no.ok, true); assert.equal(no.unprobed, 1);
  // judge-H: charged below its call rows, charged $0 with none, cell-specific rows.
  const judges = [0, 1, 2].map(d => ({ job: 'j', draw: d, usdRepriced: 0.03 }));
  assert.ok(routingChecks([{ policy: 'judge-H', job: 'j', routingUsd: 0.05 }], [], { judges }).problems.some(p => /judge-H\/j\/\*: charged \$0\.05 < \$0\.090000 measured on its judge rows/.test(p)));
  assert.equal(routingChecks([{ policy: 'judge-H', job: 'j', routingUsd: 0.09 }], [], { judges }).ok, true);
  assert.ok(routingChecks([{ policy: 'judge-H', job: 'k', routingUsd: 0 }], [], { judges }).problems.some(p => /judge-H charged \$0 with no judge call rows/.test(p)));
  const unrec = routingChecks([{ policy: 'judge-H', job: 'k', routingUsd: 0.09 }], [], { judges });
  assert.equal(unrec.ok, true); assert.equal(unrec.judgeUnreconciled, 1);
  const perCell = [...judges.map(x => ({ ...x, cell: HEADLINE.key })), { job: 'j', draw: 0, cell: makeCell(10, 10).key, usdRepriced: 0.5 }];
  assert.equal(routingChecks([{ policy: 'judge-H', job: 'j', cell: HEADLINE.key, routingUsd: 0.09 }], [], { judges: perCell }).ok, true, 'a cell is charged its own calls');
  assert.equal(routingChecks([{ policy: 'judge-H', job: 'j', cell: null, routingUsd: 0.09 }], [], { judges: perCell }).ok, false, 'an every-cell decision covers every call');
  assert.ok(routingChecks([{ policy: 'judge-H', job: 'j', routingUsd: 1 }], [], { judges: [{ job: 'j', draw: 0, usdReported: 0.03 }] }).problems.some(p => /judge row j\/judge-H\/0: no finite usdRepriced/.test(p)));
  // evaluate reads the judge rows and blocks claims on a charge below them.
  const W = plantedWorld({ train: 3, heldout: 3, jobs: 1, seed: 36 }), recorded = judgeAlwaysAgent(W.meta);
  const jr = Object.keys(W.meta).filter(j => W.meta[j].split === 'heldout').flatMap(job => [0, 1, 2].map(draw => ({ job, draw, usdRepriced: 0.04 })));
  const R = evaluate({ ...W, recorded, judges: jr, split: 'heldout', ...FAST });
  assert.ok(R.blocked.some(b => /routing dollars/.test(b)) && R.validity.routing.judgeChecked === 3, JSON.stringify(R.validity.routing));
});

// --------------------------------------------------------------------------------------- minor 7: levels, seeds
test('minor 7: paired comparisons and REFUTED read one-sided 95%; the seeds and draw counts are the preregistered ones', () => {
  assert.deepEqual(Object.fromEntries(Object.keys(PREREG_RNG).map(k => [k, STAGES.rng[k]])), { ...PREREG_RNG });
  for (const k of Object.keys(PREREG_REPS)) assert.equal(PREREG_REPS[k], STAGES.reps[k], k);
  assert.deepEqual({ ...SIGN_FLIP_MC }, { draws: STAGES.reps.permutationMonteCarlo, seed: STAGES.rng.permutationMonteCarlo });
  assert.equal(PAIRED_ALPHA, 0.05);
  // The Monte Carlo sign-flip test (n > 20) runs at the preregistered draws and seed by default.
  const d = Array.from({ length: 22 }, (_, i) => (i % 3 ? 0.02 : -0.01));
  assert.deepEqual(signFlipTest(d), signFlipTest(d, { draws: 100000, seed: 20261020 }));
  assert.notDeepEqual(signFlipTest(d), signFlipTest(d, { draws: 200000, seed: 29 }), 'the old defaults gave another p');
  // REFUTED reads the one-sided 95% per-V upper bounds, not the Holm-level ones.
  const base = { headline: { mean: 0.0, lo: -0.05, hi: 0.04 }, perV: [0.1, 1, 10].map(V => ({ V, hi: 0.035 })), perVRefute: [0.1, 1, 10].map(V => ({ V, hi: 0.025 })) };
  assert.equal(readingOf(base).reading, 'REFUTED');
  assert.equal(readingOf({ ...base, perVRefute: null }).reading, 'INCONCLUSIVE', 'at the Holm level the bounds reach 0.03');
  // End to end: the paired comparisons carry alpha 0.05 whatever the Holm level; the bootstraps run at their seeds.
  const W = plantedWorld({ seed: 37 });
  const R = evaluate({ ...W, recorded: judgeAlwaysAgent(W.meta), split: 'heldout', ...FAST, bootReps: 50, randomDraws: 30 });
  const p = R.primary['NR-static'];
  assert.equal(p.vsTuned.alpha, 0.05); assert.equal(p.vsJudge.alpha, 0.05); assert.equal(p.perV95.length, 3);
  assert.ok(p.holmLevel === 0.025 || p.holmLevel === 0.05);
  assert.equal(p.clusterBootstrap.seed, 20261015); assert.equal(p.random.seed, 20261016);
  assert.deepEqual(R.seeds, { labelBootstrap: 20261014, fit: 20261014, clusterBootstrap: 20261015, randomRouting: 20261016, shuffledLabelNull: 20261017, g1Bootstrap: 20261021 });
  const one = needTable(W.rows.filter(r => r.job === 'H0-j0'), W.builds.filter(b => b.job === 'H0-j0'));
  assert.equal(clusterBootstrapDelta(one, [{ job: 'H0-j0', cluster: 'H0', a: 'direct-H', b: 'agent-H' }], HEADLINE, { reps: 5 }).seed, 20261015, 'the preregistered default');
});

// ------------------------------------------------------------------------------------ minor 8: the 30% rule
test('minor 8: the imputed-dollar rule is the literal preregistered one; the narrower rule is a printed sensitivity', () => {
  const rows = [], row = (mode, t, pass, usd, extra = {}) => ({ job: 'j', mode, task: `t${t}`, rep: 0, seed: 610 + t, pass, delivered: true, schemaValid: true, usdRepriced: usd, usdImputed: 0, ...extra });
  // agent-O is 80% imputed but far out of reach of the acceptable set (direct-H leads).
  for (let t = 0; t < 12; t++) { rows.push(row('direct-H', t, true, 0.01)); rows.push(row('agent-O', t, t < 3, 0.1, { usdImputed: 0.4 })); }
  const T = needTable(rows), c = makeCell(1, 10);
  assert.match(needLabels(T, { cells: [c], reps: 0 }).at('j', c).unlabelled, /imputed dollars over 0\.3 in agent-O/, 'literal (PREREG §5)');
  assert.equal(needLabels(T, { cells: [c], reps: 0, imputedRule: 'reachable' }).at('j', c).unlabelled, null, 'reachable: a sensitivity');
  assert.throws(() => needLabels(T, { cells: [c], reps: 0, imputedRule: 'loose' }), /imputedRule must be literal or reachable/);
  const W = plantedWorld({ train: 3, heldout: 3, jobs: 1, seed: 38 });
  const R = evaluate({ ...W, split: 'heldout', ...FAST });
  assert.equal(R.report.imputedRuleSensitivity.primary.rule, 'literal');
  assert.match(renderReport(R), /imputed-dollar rule: primary literal leaves 0 job\(s\) unlabelled at the headline; the narrower reachable \(not primary\) rule 0/);
});

// ------------------------------------------------------------------------------------- minor 9: the report
test('minor 9: the cannot-separate flag and the partial readings sit in the reading block; latency, dollars and two-way VBS* are reported', () => {
  // A world where a workflow mode and a no-workflow mode tie on every job: every label is `either`, none confident.
  const TIE = { 'direct-H': { p: 0.7, q: 0.1, c: 0.02 }, 'agent-H': { p: 0.7, q: 0.1, c: 0.1 }, 'agent-O': { p: 0.75, q: 0.1, c: 0.6 }, 'agent-H+proc': { p: 0.7, q: 0.1, c: 0.1, B: 0.03 }, 'construct-H': { p: 0.7, q: 0.1, c: 0.02, B: 0.0 } };
  const W = syntheticWorld({ seed: 39, clusters: [...[0, 1, 2, 3].map(i => ({ id: `T${i}`, split: 'train', jobs: 1 })), ...[0, 1, 2, 3, 4, 5].map(i => ({ id: `H${i}`, split: 'heldout', jobs: 1 }))], features, truth: () => TIE });
  const rows = W.rows.map((r, i) => ({ ...r, ms: 1000 + (i % 7) * 100, usdImputed: r.mode === 'agent-O' ? 0.01 : 0 }));
  const R = evaluate({ ...W, rows, recorded: judgeAlwaysAgent(W.meta), split: 'heldout', ...FAST, reps: 40 });
  const cs = R.readings.cannotSeparate;
  assert.equal(cs.flag, true, JSON.stringify(cs)); assert.equal(cs.flag, R.validity.benchmarkCannotSeparate);
  assert.equal(R.primary['NR-static'].benchmarkCannotSeparate, true);
  assert.ok(R.readings.partial.some(x => /the benchmark cannot separate routers/.test(x)) && R.primary['NR-static'].partialReadings.length >= 1);
  assert.match(renderReport(R), /NR-static: Δ .* -> [A-Z ,]+ \[THE BENCHMARK CANNOT SEPARATE ROUTERS\]/);
  assert.match(renderReport(R), /partial reading: the benchmark cannot separate routers/);
  assert.deepEqual(Object.keys(R.report.latencyByMode.eval).sort(), ['agent-H', 'agent-H+proc', 'agent-O', 'construct-H', 'direct-H']);
  assert.ok(R.report.latencyByMode.eval['direct-H'].medianMs >= 1000 && R.report.latencyByMode.eval['direct-H'].medianMs <= 1600);
  assert.ok(R.report.dollarsByMode.eval['agent-O'].imputed > 0 && R.report.dollarsByMode.eval['direct-H'].imputed === 0);
  assert.ok(R.report.dollarsByMode.train['construct-H'].builds > 0);
  assert.ok(Number.isFinite(R.report.vbsStarTwoWay.twoWay) && Number.isFinite(R.report.vbsStarTwoWay.primary));
  const txt = renderReport(R);
  for (const re of [/^READINGS: /m, /median latency per mode: TRAIN /, /dollars per mode: TRAIN /, /VBS\* at V=1 N=10 W=1V: primary cross-fit .* two-direction /]) assert.match(txt, re);
  // The partial readings themselves (DESIGN §5), from a planted world where C7a holds and C7b is not SUPPORTED (no judge-H).
  const P = evaluate({ ...plantedWorld({ seed: 40 }), split: 'heldout', ...FAST });
  assert.equal(P.c7a.reading, 'SUPPORTED-DIAGNOSTIC'); assert.notEqual(P.primary['NR-static'].reading, 'SUPPORTED', 'no judge-H decisions: SUPPORTED is out of reach');
  assert.ok(P.readings.partial.some(x => /need is detectable, but routing on it does not pay/.test(x)), P.readings.partial.join('\n'));
  assert.equal(P.readings.cannotSeparate.flag, false);
});

// ---------------------------------------------------------------------------------- minor 10: split integrity
test('minor 10: a cluster or family stays in one split; L4 checks the seeds of jobs that pairable set aside', () => {
  const W = plantedWorld({ train: 3, heldout: 3, jobs: 2, seed: 41 });
  const mixedCluster = { ...W.meta, 'H0-j1': { ...W.meta['H0-j1'], cluster: 'T0' } };
  assert.throws(() => evaluate({ ...W, meta: mixedCluster, split: 'heldout', ...FAST }), /split integrity: cluster T0 spans splits heldout \(H0-j1\) and train/);
  assert.throws(() => commitDecisions({ ...trainOnly(W), meta: mixedCluster, reps: 30 }), /split integrity/);
  const mixedFamily = { ...W.meta, 'H1-j0': { ...W.meta['H1-j0'], family: 'T1' } };
  assert.match(splitIntegrity(mixedFamily).join('\n'), /family T1 spans splits heldout \(H1-j0\) and train/);
  assert.deepEqual(splitIntegrity({ a: { cluster: 'c', family: 'f', split: 'heldout' }, b: { cluster: 'c', family: 'f', split: 'e2e' } }), [], 'the E2E lane reuses held-out families');
  assert.deepEqual(splitIntegrity(W.meta), []);
  // A held-out job set aside by pairable (three tasks of a lineage missing) with a seed outside the held-out range.
  const rows = W.rows.filter(r => !(r.job === 'H1-j1' && r.mode === 'construct-H' && r.rep === 2 && ['t09', 't10', 't11'].includes(r.task)))
    .map(r => (r.job === 'H1-j1' && r.task === 't00' ? { ...r, seed: 610 } : r));
  const R = evaluate({ ...W, rows, split: 'heldout', ...FAST, leak: true });
  assert.ok(R.validity.dropped.eval.some(d => d.job === 'H1-j1'));
  assert.deepEqual(R.leaks.L4.droppedJobsChecked, ['H1-j1']);
  assert.ok(R.leaks.L4.problems.some(p => /H1-j1\/t00: seed 610 outside the heldout range/.test(p)), R.leaks.L4.problems.join('\n'));
  assert.equal(R.leaks.L4.ok, false);
});
