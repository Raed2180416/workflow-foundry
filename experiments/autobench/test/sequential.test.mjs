// Tests for experiments/autobench/sequential.mjs and run.mjs --sequential-look (register A4; FIXES §2 action 7). $0: no
// model is called; stored dev60 rows only; temporary directories are removed.
//   nice -n 15 node --test --test-concurrency=1 experiments/autobench/test/sequential.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ALPHA_PER_METRIC, analyzeLooks, assertNoDevCheck, checkedSplit, computePlan, look1Tasks, lookDescriptor, loadOutcomes, readPlan,
  seenTasks, simulateSchedule, RUNS, EXPOSURE,
} from '../sequential.mjs';
import { listSha256, loadSplit } from '../split.mjs';
import { scriptedRunner, sha256 } from '../lib.mjs';
import { runTasks } from '../run.mjs';

const split = checkedSplit();
const exposureFile = JSON.parse(readFileSync(EXPOSURE, 'utf8'));
const realPlan = () => computePlan({ split, exposure: { briefed: exposureFile.dev.exposedNotForced, seen: seenTasks([RUNS]) } });
const tmpDirs = [];
const tmp = p => { const d = mkdtempSync(path.join(os.tmpdir(), `ab-seq-${p}-`)); tmpDirs.push(d); return d; };
test.after(() => { for (const d of tmpDirs) rmSync(d, { recursive: true, force: true }); });

test('devCheck guard: the split\'s devCheck list carries PREREG-AB-v1\'s hash; a devCheck or test task is refused', () => {
  assert.equal(split.devCheck.length, 60);
  const tampered = { ...split, devCheck: [...split.devCheck.slice(1), split.dev.find(t => !split.devCheck.includes(t))] };
  assert.throws(() => checkedSplit(tampered), /not PREREG-AB-v1's 74cf7615/);
  assert.throws(() => assertNoDevCheck([split.devCheck[0]], split), /devCheck task/);
  assert.throws(() => assertNoDevCheck([split.test[0]], split), /not dev-split/);
  assert.equal(assertNoDevCheck(look1Tasks(), split), true);
});

test('plan: look 1 is dev60; later looks are disjoint, unexposed devTrain batches; never devCheck; deterministic', () => {
  const p = realPlan(), q = realPlan();
  assert.equal(p.planSha256, q.planSha256);
  assert.deepEqual(p.looks[0].tasks, [...look1Tasks()].sort());
  const dc = new Set(split.devCheck), forced = new Set(split.forcedSources.flatMap(f => f.tasks)), briefed = new Set(exposureFile.dev.exposedNotForced);
  const all = p.looks.flatMap(L => L.tasks);
  assert.equal(new Set(all).size, all.length, 'looks are disjoint');
  assert.ok(all.every(t => !dc.has(t)), 'no devCheck task in any look');
  for (const L of p.looks.slice(1)) {
    assert.ok(L.tasks.every(t => !forced.has(t) && !briefed.has(t)), `look ${L.look} holds no exposed task`);
    assert.ok(L.n >= p.minLook);
  }
  assert.equal(p.looks[1].n, 60); assert.deepEqual(Object.values(p.looks[1].perDomain), [10, 10, 10, 10, 10, 10]);
  // The FIXES schedule assumed 137 unexposed devTrain tasks; dev60, the AM-2 briefings and earlier runs leave fewer.
  assert.ok(p.pool.eligible < 137 && p.pool.eligible >= 60, `eligible ${p.pool.eligible}`);
  assert.equal(p.cumulative.at(-1), p.looks.reduce((s, L) => s + L.n, 0));
  assert.ok(p.nominal.strict.every((x, i, a) => i === 0 || x > a[i - 1]) && p.nominal.strict.at(-1) < ALPHA_PER_METRIC);
  // Teeth: a look-1 list holding a devCheck task is refused before anything is planned.
  assert.throws(() => computePlan({ split, look1: [...look1Tasks().slice(1), split.devCheck[0]], exposure: { briefed: [], seen: new Map() } }), /devCheck task/);
  // Exposure matters: without the record of earlier runs the pool is larger (so the plan must read it).
  const naive = computePlan({ split, exposure: { briefed: [], seen: new Map() } });
  assert.ok(naive.pool.eligible > p.pool.eligible);
});

test('plan file: a tampered plan, or a look edited to hold a devCheck task (hashes recomputed), is refused', () => {
  const p = realPlan(), dir = tmp('plan');
  const f = path.join(dir, 'plan.json');
  writeFileSync(f, JSON.stringify(p));
  assert.equal(readPlan(f).planSha256, p.planSha256);
  const t = JSON.parse(JSON.stringify(p)); t.looks[1].tasks[0] = t.looks[1].tasks[1];
  writeFileSync(f, JSON.stringify(t)); assert.throws(() => readPlan(f), /hash mismatch/);
  const u = JSON.parse(JSON.stringify(p)); u.looks[1].tasks[0] = split.devCheck[0]; u.looks[1].sha256 = listSha256(u.looks[1].tasks);
  u.planSha256 = planHash(u);
  writeFileSync(f, JSON.stringify(u)); assert.throws(() => readPlan(f), /devCheck task/);
});
const planHash = plan => sha256(JSON.stringify({ ...plan, planSha256: undefined }));

test('run.mjs --sequential-look: refuses devCheck tasks and tasks other than the look\'s; records look and boundary in launch.json', async () => {
  const p = realPlan(), d = lookDescriptor(p, 1);
  assert.equal(d.look, 1); assert.equal(d.tasks.length, 60); assert.equal(d.nominal.strict, p.nominal.strict[0]);
  const base = { runner: scriptedRunner(() => []), outDir: null, log: () => {} };
  // devCheck tasks with a sequential descriptor: refused before anything is prepared.
  const dcTasks = split.devCheck.slice(0, 2);
  await assert.rejects(runTasks({ ...base, tasks: dcTasks, liveRoot: tmp('dc'), sequential: { ...d, tasks: dcTasks } }), /never runs devCheck/);
  // Tasks other than the look's: refused.
  await assert.rejects(runTasks({ ...base, tasks: d.tasks.slice(0, 2), liveRoot: tmp('mismatch'), sequential: d }), /not look 1's planned tasks/);
  // A matching (two-task) descriptor: launch.json carries the look. Without the AutomationBench venv the bridge then fails
  // to prepare; with it, the two tasks run scripted at $0. Either way launch.json is written first.
  const two = { ...d, tasks: d.tasks.slice(0, 2) }, live = tmp('ok');
  try { await runTasks({ ...base, tasks: two.tasks, liveRoot: live, sequential: two }); } catch { /* no venv: prepare fails after launch.json */ }
  const launch = JSON.parse(readFileSync(path.join(live, 'launch.json'), 'utf8'));
  assert.deepEqual(launch.sequential, { design: d.design, plan: p.planSha256, look: 1, looks: p.looks.length, tasksSha256: d.tasksSha256, nominal: d.nominal, alphaPerMetric: ALPHA_PER_METRIC });
  // Without --sequential-look the launch object is unchanged (no key), so earlier runs still resume.
  const live2 = tmp('plain');
  try { await runTasks({ ...base, tasks: two.tasks, liveRoot: live2 }); } catch { /* as above */ }
  assert.equal('sequential' in JSON.parse(readFileSync(path.join(live2, 'launch.json'), 'utf8')), false);
});

test('analyze on stored dev60 rows: look 1 of the plan does not cross O\'Brien-Fleming; a one-look schedule crosses on partial credit only', () => {
  const p = realPlan();
  const control = { 1: loadOutcomes(['a0-dev60-dn']) }, treatment = { 1: loadOutcomes(['a1-dev60-dn', 'a1-dev60-dn-fill']) };
  const r = analyzeLooks(p, control, treatment, { permIterations: 20000 });
  const L1 = r.rows[0];
  assert.equal(L1.n, 60); assert.deepEqual([L1.strict.treatment, L1.strict.control, L1.strict.b, L1.strict.c], [18, 9, 12, 3]);
  assert.ok(Math.abs(L1.strict.p - 0.0352) < 0.0005); assert.equal(+L1.strict.eValue.toFixed(1), 4.5);
  assert.deepEqual(L1.crossed, { strict: false, partialCredit: false });
  assert.match(r.decision.label, /continue: run look 2/);
  // The same rows read as a single, final look (alpha 0.025 per metric): partial credit crosses, strict does not, so the
  // decision is an effect without a strict-pass claim.
  const one = { ...p, looks: [p.looks[0]], cumulative: [60], nominal: { strict: [0.025], partialCredit: [0.025] } };
  const r1 = analyzeLooks(one, control, treatment, { permIterations: 20000 });
  assert.deepEqual(r1.rows[0].crossed, { strict: false, partialCredit: true });
  assert.match(r1.decision.label, /effect at look 1 \(partialCredit\)/); assert.equal(r1.decision.strictClaim, false);
  // Arms swapped: harm.
  assert.match(analyzeLooks(one, treatment, control, { permIterations: 20000 }).decision.label, /^harm/);
  // A sealed run (devCheck) is never read.
  assert.throws(() => loadOutcomes(['a0-devcheck-1']), /sealed run/);
});

test('T2: under H0 (A/A from stored dev60 outcomes) the co-primary schedule keeps two-sided type-I at most 0.05', t => {
  const reps = 20000, bound = 0.05 + 3 * Math.sqrt(0.05 * 0.95 / reps);
  for (const cumulative of [realPlan().cumulative, [60, 120, 180, 240]]) {
    const r = simulateSchedule({ cumulative, reps, seed: 'test-t2' });
    t.diagnostic(`looks ${cumulative.join('/')}: co-primary ${r.combined}, strict at 0.025 ${r.strictAtHalfAlpha}, partial credit at 0.025 ${r.partialCreditAtHalfAlpha}, strict alone at 0.05 ${r.strictAtFullAlpha}, partial credit alone at 0.05 ${r.partialCreditAtFullAlpha}`);
    assert.ok(r.combined <= bound, `looks ${cumulative.join('/')}: type-I ${r.combined}`);
    assert.ok(r.strictAtHalfAlpha <= 0.025 + 3 * Math.sqrt(0.025 * 0.975 / reps) && r.partialCreditAtHalfAlpha <= 0.025 + 3 * Math.sqrt(0.025 * 0.975 / reps));
  }
});

test('live directories are scanned by name only and a missing root is skipped', () => {
  const dir = tmp('seen');
  writeFileSync(path.join(dir, 'x.json'), '{}');
  assert.equal(seenTasks([dir, path.join(dir, 'missing')]).size, 0);
  assert.ok(existsSync(RUNS) && seenTasks([RUNS]).size > 60);
  assert.ok(loadSplit().devCheck.length === 60);
});
