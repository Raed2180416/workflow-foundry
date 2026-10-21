// Tests for experiments/autobench/sequential.mjs (register A4; FIXES §2 action 7; the 2026-10-21 review fixes; the
// orchestrator's decision D23 on PREREG-AB-v1-AMEND-1 §7). $0: no model is called and run.mjs is never started (the look
// guard is tested with an injected spawn); stored dev60 rows only; temporary directories are removed.
//   nice -n 15 node --test --test-concurrency=1 experiments/autobench/test/sequential.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ALPHA, DRAFT_BONFERRONI_ALPHA, PROCEDURE, STOP_ON, analyzeLooks, assertNoDevCheck, boundariesFor, checkedSplit, computePlan, execLook, exportLook, exposureRoots,
  look1Tasks, loadOutcomes, lookRule, readPlan, scheduleOf, seenTasks, signFlipPSequential, simulateSchedule, verifyLookRuns, RUNS, EXPOSURE, SIDECAR,
  SIDECAR_SCHEMA, FROZEN_PLAN_SHA256,
} from '../sequential.mjs';
import { listSha256, loadSplit } from '../split.mjs';
import { REPO, sha256 } from '../lib.mjs';
import { obrienFlemingBoundary, pairedPermutation } from '../../lib/stats.mjs';
import { rng } from '../../../beds/lib/rng.mjs';

const split = checkedSplit();
const exposureFile = JSON.parse(readFileSync(EXPOSURE, 'utf8'));
const realPlan = (o = {}) => computePlan({ split, exposure: { briefed: exposureFile.dev.exposedNotForced, seen: seenTasks([RUNS]) }, ...o });
const tmpDirs = [];
const tmp = p => { const d = mkdtempSync(path.join(os.tmpdir(), `ab-seq-${p}-`)); tmpDirs.push(d); return d; };
test.after(() => { for (const d of tmpDirs) rmSync(d, { recursive: true, force: true }); });
const planHash = plan => sha256(JSON.stringify({ ...plan, planSha256: undefined, draft: undefined }));
const rehash = q => { q.planSha256 = planHash(q); return q; };
const writePlan = (dir, p) => { const f = path.join(dir, `plan-${Math.random().toString(36).slice(2)}.json`); writeFileSync(f, JSON.stringify(p)); return f; };
const SEQ = path.join(REPO, 'experiments/autobench/sequential.mjs');
const FROZEN_FILE = path.join(REPO, 'research/automationbench-20261014/SEQUENTIAL-PLAN-v1.json');
const LOOK2_FILE = path.join(REPO, 'research/automationbench-20261014/LOOK2-TASKS.json');
const sig3 = a => a.map(v => +v.toPrecision(3));

test('devCheck guard: the split\'s devCheck list carries PREREG-AB-v1\'s hash; a devCheck or test task is refused', () => {
  assert.equal(split.devCheck.length, 60);
  const tampered = { ...split, devCheck: [...split.devCheck.slice(1), split.dev.find(t => !split.devCheck.includes(t))] };
  assert.throws(() => checkedSplit(tampered), /not PREREG-AB-v1's 74cf7615/);
  assert.throws(() => assertNoDevCheck([split.devCheck[0]], split), /devCheck task/);
  assert.throws(() => assertNoDevCheck([split.test[0]], split), /not dev-split/);
  assert.equal(assertNoDevCheck(look1Tasks(), split), true);
});

test('run.mjs and every harness-manifest file are byte-identical to e6a23ca (the A1 and A1-C manifests stay frozen-able)', async t => {
  const git = (...a) => spawnSync('git', ['-C', REPO, ...a], { encoding: 'buffer', maxBuffer: 64 << 20 });
  if (git('cat-file', '-e', 'e6a23ca^{commit}').status !== 0) { t.skip('e6a23ca is not in this checkout'); return; }
  const files = new Set();
  for (const h of ['codeowned', 'foundry']) for (const f of (await import(`../harness/${h}.mjs`)).manifestFiles()) files.add(f);
  assert.ok(files.has('experiments/autobench/run.mjs'), 'run.mjs is in the manifests (why it may not change)');
  assert.ok(!files.has('experiments/autobench/sequential.mjs'), 'the sequential design is outside both manifests');
  const changed = [...files].filter(f => {
    const base = git('cat-file', '-p', `e6a23ca:${f}`);
    return base.status !== 0 || createHash('sha256').update(base.stdout).digest('hex') !== createHash('sha256').update(readFileSync(path.join(REPO, f))).digest('hex');
  });
  assert.deepEqual(changed, [], `harness-manifest files changed since e6a23ca: ${changed.join(', ')} (PREREG-AB-v1 §5, §6.1: a frozen candidate's hash would no longer recompute)`);
});

test('plan: look 1 is dev60; later looks are disjoint, unexposed devTrain batches; one O\'Brien-Fleming schedule per first look', () => {
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
  assert.deepEqual(p.counts, p.looks.map(L => L.n));
  // Per-arm exposure: a schedule from every look. From look 2 (every arm with stored dev60 rows) the statistic starts at
  // look 2 and its boundary is recomputed for its own looks: a 2-look schedule when the plan has 3 looks.
  assert.equal(p.schedules.length, p.looks.length);
  const s1 = scheduleOf(p, 1), s2 = scheduleOf(p, 2);
  assert.deepEqual(s1.cumulative, p.counts.reduce((a, n) => [...a, (a.at(-1) ?? 0) + n], []));
  assert.deepEqual(s2.looks, p.looks.slice(1).map(L => L.look)); assert.equal(s2.cumulative[0], p.looks[1].n);
  const ob = obrienFlemingBoundary(s2.cumulative.length, { alpha: ALPHA.strict, fractions: s2.cumulative });
  assert.deepEqual(s2.nominal.strict, ob.nominal); assert.deepEqual(s2.nominal.partialCredit, ob.nominal);
  assert.ok(s2.nominal.strict.at(-1) < ALPHA.strict);
  assert.ok(s1.nominal.strict.every((x, i, a) => i === 0 || x > a[i - 1]) && s1.nominal.strict.at(-1) < ALPHA.strict);
  assert.throws(() => scheduleOf(p, undefined), /firstLook must be declared/);
  // D23 is written into the plan (and so into its hash).
  assert.deepEqual(p.alpha, { total: 0.05, strict: 0.05, partialCredit: 0.05 }); assert.deepEqual(p.procedure, PROCEDURE); assert.equal(p.procedure.stopOn, 'strict');
  // Teeth: a look-1 list holding a devCheck task is refused before anything is planned.
  assert.throws(() => computePlan({ split, look1: [...look1Tasks().slice(1), split.devCheck[0]], exposure: { briefed: [], seen: new Map() } }), /devCheck task/);
  // Exposure matters: without the record of earlier runs the pool is larger (so the plan must read it).
  const naive = computePlan({ split, exposure: { briefed: [], seen: new Map() } });
  assert.ok(naive.pool.eligible > p.pool.eligible);
});

test('exposure: an unparsable run record stops the plan; task-named run directories count; every worktree (git-listed too) and the live root are scanned', () => {
  const root = tmp('seen');
  mkdirSync(path.join(root, 'r1')); writeFileSync(path.join(root, 'r1', 'launch.json'), JSON.stringify({ tasks: ['sales.x', 'hr.y'] }));
  mkdirSync(path.join(root, 'r2')); writeFileSync(path.join(root, 'r2', SIDECAR), JSON.stringify({ tasks: ['hr.y', 'finance.z'] }));
  // A run that died before writing launch.json or summary.json still left task-named directories (prep/, w/, host/).
  for (const d of ['prep/support.p', 'w/0000-0', 'w/marketing.w', 'host/operations.h']) mkdirSync(path.join(root, 'r5', d), { recursive: true });
  const s = seenTasks([{ label: 'tmp', dir: root }, { label: 'gone', dir: path.join(root, 'missing') }]);
  assert.deepEqual([...s.keys()].sort(), ['finance.z', 'hr.y', 'marketing.w', 'operations.h', 'sales.x', 'support.p']);
  assert.deepEqual(s.scanned, [{ label: 'tmp', runs: 3 }, { label: 'gone', runs: 0, missing: true }]);
  // A half-written summary.json used to drop the run's tasks silently (back into the "unexposed" pool): now it throws.
  mkdirSync(path.join(root, 'r3')); writeFileSync(path.join(root, 'r3', 'summary.json'), '{"tasks": ["sales.');
  assert.throws(() => seenTasks([root]), /unreadable or not JSON/);
  mkdirSync(path.join(root, 'r4')); writeFileSync(path.join(root, 'r4', 'launch.json'), '{"tasks": "sales.x"}');
  rmSync(path.join(root, 'r3'), { recursive: true });
  assert.throws(() => seenTasks([root]), /tasks is not a list/);
  // The roots: the main tree's runs, each worktree's runs (from a worktree path too), any other git worktree (e.g. one under
  // /var/tmp), the live root; a worktree listed both ways is scanned once.
  const fake = tmp('tree'), wt = path.join(fake, '.claude', 'worktrees');
  for (const w of ['wa', 'wb']) mkdirSync(path.join(wt, w), { recursive: true });
  const roots = exposureRoots({ repo: path.join(wt, 'wa'), liveRoot: '/nonexistent/live', worktrees: [fake, path.join(wt, 'wb'), '/elsewhere/kit'] });
  assert.deepEqual(roots.map(r => r.label), ['main:research/automationbench-20261014/runs', 'worktree:wa:research/automationbench-20261014/runs', 'worktree:wb:research/automationbench-20261014/runs',
    'worktree:/elsewhere/kit:research/automationbench-20261014/runs', 'live:/nonexistent/live']);
  assert.equal(roots[0].dir, path.join(fake, 'research/automationbench-20261014/runs'));
  assert.equal(roots[3].dir, '/elsewhere/kit/research/automationbench-20261014/runs');
  const p = computePlan({ split, exposure: { briefed: [], seen: s, roots: s.scanned } });
  assert.deepEqual(p.pool.roots, s.scanned);
});

test('plan file: tampering is refused, including edits with every hash recomputed (devCheck look, nominal level, look 1, status)', () => {
  const p = realPlan(), dir = tmp('plan');
  assert.equal(readPlan(writePlan(dir, p), { frozen: null }).planSha256, p.planSha256);
  assert.equal(readPlan(writePlan(dir, p), { frozen: null }).draft, true);
  const t = JSON.parse(JSON.stringify(p)); t.looks[1].tasks[0] = t.looks[1].tasks[1];
  assert.throws(() => readPlan(writePlan(dir, t), { frozen: null }), /hash mismatch/);
  const u = JSON.parse(JSON.stringify(p)); u.looks[1].tasks[0] = split.devCheck[0]; u.looks[1].sha256 = listSha256(u.looks[1].tasks);
  assert.throws(() => readPlan(writePlan(dir, rehash(u)), { frozen: null }), /devCheck task/);
  const v = JSON.parse(JSON.stringify(p)); v.schedules[1].nominal.strict[0] = 0.02;
  assert.throws(() => readPlan(writePlan(dir, rehash(v)), { frozen: null }), /does not match the boundaries recomputed/);
  const w = JSON.parse(JSON.stringify(p)); [w.looks[0], w.looks[1]] = [{ ...w.looks[1], look: 1 }, { ...w.looks[0], look: 2 }];
  assert.throws(() => readPlan(writePlan(dir, rehash(w)), { frozen: null }), /look 1 is not the dev60 task list/);
  // A FROZEN plan must be the one pinned in FROZEN_PLAN_SHA256; a pinned hash refuses any other plan.
  const f = realPlan({ freeze: true }), ff = writePlan(dir, f);
  assert.throws(() => readPlan(ff, { frozen: null }), /hash is not pinned/);
  assert.equal(readPlan(ff, { frozen: f.planSha256 }).draft, false);
  assert.throws(() => readPlan(writePlan(dir, p), { frozen: f.planSha256 }), /is not the frozen plan/);
  // With the real pin (the plan is frozen), a plan that is not the frozen one is refused by default.
  if (FROZEN_PLAN_SHA256 !== null) assert.throws(() => readPlan(writePlan(dir, p)), /is not the frozen plan/);
});

test('boundaries (D23): strict pass and partial credit each get an O\'Brien-Fleming boundary at the full 0.05; the DRAFT\'s Bonferroni plan is refused', () => {
  // The 60/83 schedule (first look 2) and the 60/120/143 schedule (first look 1): AMEND-1 §2.2's numbers.
  for (const [cum, want] of [[[60, 83], [0.018, 0.0443]], [[60, 120, 143], [0.00173, 0.0267, 0.0424]], [[23], [0.05]]]) {
    const b = boundariesFor(cum);
    for (const k of ['strict', 'partialCredit']) {
      assert.ok(Math.abs(b[k].totalAlpha - 0.05) < 1e-4, `${k} spends the full alpha over ${cum.join('/')}: ${b[k].totalAlpha}`);
      assert.deepEqual(sig3(b[k].nominal), want, `${k} nominal levels over ${cum.join('/')}`);
    }
  }
  const p = realPlan(), s1 = scheduleOf(p, 1), s2 = scheduleOf(p, 2);
  assert.deepEqual(s2.nominal.strict, boundariesFor(s2.cumulative).strict.nominal);
  assert.deepEqual(s2.nominal.partialCredit, boundariesFor(s2.cumulative).partialCredit.nominal);
  // The schedule from look 2 is recomputed, not the tail of the schedule from look 1.
  assert.notDeepEqual(s2.nominal.strict, s1.nominal.strict.slice(1));
  // Each level is above the DRAFT's 0.025-per-metric level at the same look (the strict test is no longer halved).
  const draft = obrienFlemingBoundary(s2.cumulative.length, { alpha: DRAFT_BONFERRONI_ALPHA, fractions: s2.cumulative });
  assert.ok(s2.nominal.strict.every((x, i) => x > draft.nominal[i] + 0.01), `${s2.nominal.strict} vs ${draft.nominal}`);
  // Teeth: the DRAFT's plan (0.025 per metric, Bonferroni) is refused, even with every hash and boundary recomputed.
  const dir = tmp('bonf'), d = JSON.parse(JSON.stringify(p));
  d.alpha = { total: 0.05, perMetric: DRAFT_BONFERRONI_ALPHA };
  for (const s of d.schedules) { const o = obrienFlemingBoundary(s.cumulative.length, { alpha: DRAFT_BONFERRONI_ALPHA, fractions: s.cumulative }); s.nominal = { strict: [...o.nominal], partialCredit: [...o.nominal] }; }
  assert.throws(() => readPlan(writePlan(dir, rehash(d)), { frozen: null }), /does not match the boundaries recomputed/);
  const e = JSON.parse(JSON.stringify(p)); e.alpha = { total: 0.05, perMetric: DRAFT_BONFERRONI_ALPHA };
  assert.throws(() => readPlan(writePlan(dir, rehash(e)), { frozen: null }), /alpha .* is not the amendment's/);
  const g = JSON.parse(JSON.stringify(p)); g.procedure = { ...g.procedure, stopOn: 'either' };
  assert.throws(() => readPlan(writePlan(dir, rehash(g)), { frozen: null }), /fixed sequence with stopping on strict pass/);
  assert.ok(existsSync(RUNS) && seenTasks([RUNS]).size > 60);
  assert.ok(loadSplit().devCheck.length === 60);
});

test('look guard (run.mjs untouched): task list from the plan, never devCheck, sidecar in live and repo copy, DRAFT refused', () => {
  const dir = tmp('look'), f = realPlan({ freeze: true }), frozen = readPlan(writePlan(dir, f), { frozen: f.planSha256 }), draft = readPlan(writePlan(dir, realPlan()), { frozen: null });
  const live = path.join(dir, 'live'), out = path.join(dir, 'out');
  const pass = ['--run-id', 'seq-l2-a1cv2', '--live', live, '--out', out, '--harness', 'codeowned', '--model', 'claude-haiku-5-5', '--cap', '2'];
  const calls = [];
  const spawn = (exe, args) => { calls.push(args); return { status: 0 }; };
  // Refused before anything is written: a task selection, --no-copy, --test-run, a missing --run-id, role/arm/first look.
  for (const k of ['--tasks', '--pool', '--subset', '--seed', '--test-run', '--no-copy', '--dry-run']) assert.throws(() => execLook(frozen, 2, { role: 'treatment', arm: 'A1-C v2', firstLook: 2, passthrough: [...pass, k, 'x'], exec: true, spawn }), new RegExp(`${k} may not be passed`));
  assert.throws(() => execLook(frozen, 2, { role: 'treatment', arm: 'A1-C v2', firstLook: 2, passthrough: ['--live', live], exec: true, spawn }), /--run-id/);
  assert.throws(() => execLook(frozen, 2, { role: 'treatment', arm: 'A1-C v2', passthrough: pass, exec: true, spawn }), /firstLook must be declared/);
  assert.throws(() => execLook(frozen, 1, { role: 'treatment', arm: 'A1-C v2', firstLook: 2, passthrough: pass, exec: true, spawn }), /precedes the arm's declared first look/);
  assert.throws(() => execLook(frozen, 2, { role: 'control', arm: 'A0', firstLook: 2, passthrough: pass, exec: true, spawn }), /belongs to a treatment/);
  assert.throws(() => execLook(frozen, 2, { role: 'x', arm: 'A0', passthrough: pass, exec: true, spawn }), /--role/);
  assert.throws(() => execLook(draft, 2, { role: 'treatment', arm: 'A1-C v2', firstLook: 2, passthrough: pass, exec: true, spawn }), /DRAFT/);
  assert.equal(calls.length, 0); assert.equal(existsSync(live), false);
  // Without --exec: the command and the sidecar, nothing written or started (a DRAFT plan may be printed).
  const dry = execLook(draft, 2, { role: 'treatment', arm: 'A1-C v2', firstLook: 2, passthrough: pass, spawn });
  assert.deepEqual(dry.args.slice(1, 3), ['--tasks', draft.looks[1].tasks.join(',')]); assert.equal(calls.length, 0);
  // With --exec on the frozen plan: the sidecar is written to the live directory and the repo copy, then run.mjs starts.
  const r = execLook(frozen, 2, { role: 'treatment', arm: 'A1-C v2', firstLook: 2, passthrough: pass, exec: true, spawn });
  assert.equal(calls.length, 1); assert.match(calls[0][0], /experiments\/autobench\/run\.mjs$/);
  assert.deepEqual(calls[0].slice(1, 3), ['--tasks', frozen.looks[1].tasks.join(',')]);
  for (const d of [live, out]) {
    const sc = JSON.parse(readFileSync(path.join(d, SIDECAR), 'utf8'));
    assert.deepEqual([sc.schema, sc.plan, sc.look, sc.tasksSha256, sc.role, sc.arm, sc.firstLook, sc.runId], [SIDECAR_SCHEMA, f.planSha256, 2, frozen.looks[1].sha256, 'treatment', 'A1-C v2', 2, 'seq-l2-a1cv2']);
    assert.deepEqual(Object.keys(sc.nominal), ['from look 2']); assert.equal(sc.nominal['from look 2'].strict, scheduleOf(frozen, 2).nominal.strict[0]);
    assert.deepEqual([sc.alpha, sc.stopOn], [ALPHA, 'strict']);
  }
  assert.equal(r.status, 0);
  // A resume must be the same look run; another arm or first look in that directory is refused.
  execLook(frozen, 2, { role: 'treatment', arm: 'A1-C v2', firstLook: 2, passthrough: [...pass, '--resume'], exec: true, spawn });
  assert.throws(() => execLook(frozen, 2, { role: 'treatment', arm: 'A1-C', firstLook: 2, passthrough: pass, exec: true, spawn }), /another look run \(arm differ/);
  // After the run, the repo copy must hold exactly the look's tasks.
  writeFileSync(path.join(out, 'summary.json'), JSON.stringify({ tasks: frozen.looks[1].tasks.slice(1) }));
  assert.throws(() => execLook(frozen, 2, { role: 'treatment', arm: 'A1-C v2', firstLook: 2, passthrough: pass, exec: true, spawn }), /holds tasks other than look 2's/);
});

// Synthetic look rows for the analysis tests: outcomes per task from a seeded generator.
const synth = (tasks, seed, pPass, pc) => { const r = rng(seed); return new Map(tasks.map(t => { const pass = r.next() < pPass ? 1 : 0; return [t, { pass, pc: pass ? 1 : pc * r.next() }]; })); };
// Look rows from a spec over the look's tasks in order: [[count, [passT, pcT], [passC, pcC]], ...]; the rest fail in both at 0.5.
const rowsFrom = (tasks, spec) => {
  const T = new Map(), C = new Map();
  let i = 0;
  for (const [count, [pt, qt], [pc, qc]] of spec) for (let j = 0; j < count; j++, i++) { T.set(tasks[i], { pass: pt, pc: qt }); C.set(tasks[i], { pass: pc, pc: qc }); }
  for (; i < tasks.length; i++) { T.set(tasks[i], { pass: 0, pc: 0.5 }); C.set(tasks[i], { pass: 0, pc: 0.5 }); }
  return { T, C };
};

test('analyze from look 2 (an A1-C v2-style arm): its own 2-look schedule; look 1 rows are not needed and not read', () => {
  const p = realPlan(), L2 = p.looks[1].tasks, L3 = p.looks[2]?.tasks;
  const control = { 2: synth(L2, 'c2', 0.2, 0.5) }, treatment = { 2: synth(L2, 't2', 0.2, 0.5) };
  const r = analyzeLooks(p, control, treatment, { firstLook: 2, permIterations: 4000 });
  assert.equal(r.firstLook, 2); assert.deepEqual(r.schedule, scheduleOf(p, 2).cumulative);
  assert.equal(r.rows[0].look, 2); assert.equal(r.rows[0].n, L2.length);
  assert.equal(r.rows[0].nominal.strict, scheduleOf(p, 2).nominal.strict[0]);
  if (L3) {
    assert.match(r.decision.label, /continue: run look 3/);
    const r3 = analyzeLooks(p, { ...control, 3: synth(L3, 'c3', 0.2, 0.5) }, { ...treatment, 3: synth(L3, 't3', 0.2, 0.5) }, { firstLook: 2, permIterations: 4000 });
    assert.deepEqual(r3.rows.map(x => [x.look, x.n]), [[2, L2.length], [3, L2.length + L3.length]]);
    assert.match(r3.decision.label, /final look: no resolvable difference on strict pass/);
  }
  // Teeth: the same rows analysed from look 1 find no complete look (the old behaviour for such an arm).
  assert.match(analyzeLooks(p, control, treatment, { firstLook: 1, permIterations: 4000 }).decision.label, /no complete look/);
  assert.throws(() => analyzeLooks(p, control, treatment, {}), /firstLook must be declared/);
});

test('gatekeeping order (D23): strict pass is tested first at its 0.05 boundary; partial credit is tested only at a look where strict pass is rejected', () => {
  const p = realPlan(), L2 = p.looks[1].tasks, L3 = p.looks[2].tasks, s2 = scheduleOf(p, 2);
  assert.deepEqual(s2.cumulative, [60, 83], 'the frozen shape: look 2 = 60, look 3 = 23');
  const draft = obrienFlemingBoundary(2, { alpha: DRAFT_BONFERRONI_ALPHA, fractions: s2.cumulative });
  // (a) Strict 12:2 (McNemar p 0.0129) lies between the DRAFT's look-2 level (0.0073) and D23's (0.0180): strict pass is
  // rejected, which opens partial credit (exact sign-flip p 0.0129 < 0.0180): both rejected at look 2, the comparison ends.
  const A = rowsFrom(L2, [[12, [1, 1], [0, 0.5]], [2, [0, 0.5], [1, 1]]]);
  const a = analyzeLooks(p, { 2: A.C }, { 2: A.T }, { firstLook: 2, permIterations: 4000 });
  const ra = a.rows[0];
  assert.deepEqual([ra.strict.b, ra.strict.c], [12, 2]);
  assert.ok(ra.strict.p > draft.nominal[0] && ra.strict.p < s2.nominal.strict[0], `p ${ra.strict.p} between ${draft.nominal[0]} and ${s2.nominal.strict[0]}`);
  assert.deepEqual([ra.tested, ra.rejected], [{ strict: true, partialCredit: true }, { strict: true, partialCredit: true }]);
  assert.equal(a.decision.look, 2); assert.match(a.decision.label, /^effect on strict pass at look 2; partial credit rejected too \(treatment ahead\)/);
  assert.deepEqual([a.decision.strictClaim, a.decision.partialCreditClaim, a.decision.harm], [true, true, false]);
  // (b) Partial credit far beyond its boundary while strict pass is not rejected (3:1): partial credit is not tested and
  // nothing stops; at look 3 strict pass is rejected on the cumulative 83 tasks (11:1), and only then is partial credit
  // tested, on look 3's cumulative rows against look 3's level.
  const B = rowsFrom(L2, [[3, [1, 1], [0, 0.5]], [1, [0, 0.5], [1, 1]], [50, [0, 0.7], [0, 0.5]]]);
  const b2 = analyzeLooks(p, { 2: B.C }, { 2: B.T }, { firstLook: 2, permIterations: 4000 });
  const rb = b2.rows[0];
  assert.ok(rb.partialCredit.p < s2.nominal.partialCredit[0] && rb.partialCredit.meanDiff > 0.1, `partial credit p ${rb.partialCredit.p}`);
  assert.deepEqual([rb.crossed.partialCredit, rb.tested.partialCredit, rb.rejected.partialCredit, rb.rejected.strict], [true, false, false, false]);
  assert.match(rb.note, /not tested: strict pass is not rejected/);
  assert.match(b2.decision.label, /^continue: run look 3$/);
  assert.deepEqual([b2.decision.strictClaim, b2.decision.partialCreditClaim], [false, false]);
  const B3 = rowsFrom(L3, [[8, [1, 1], [0, 0.5]]]);
  const b3 = analyzeLooks(p, { 2: B.C, 3: B3.C }, { 2: B.T, 3: B3.T }, { firstLook: 2, permIterations: 4000 });
  assert.deepEqual(b3.rows.map(r => [r.look, r.tested.partialCredit, r.rejected.strict]), [[2, false, false], [3, true, true]]);
  assert.deepEqual([b3.rows[1].strict.b, b3.rows[1].strict.c], [11, 1]); assert.equal(b3.rows[1].nominal.partialCredit, s2.nominal.partialCredit[1]);
  assert.equal(b3.decision.look, 3); assert.match(b3.decision.label, /^effect on strict pass at look 3; partial credit rejected too/);
  // (c) Strict pass rejected, partial credit tested and not rejected (gap under the floor, p large): a strict claim only.
  const Cc = rowsFrom(L2, [[12, [1, 1], [0, 0.9]], [2, [0, 0.9], [1, 1]], [23, [0, 0.8], [0, 0.5]], [23, [0, 0.5], [0, 0.8]]]);
  const c = analyzeLooks(p, { 2: Cc.C }, { 2: Cc.T }, { firstLook: 2, permIterations: 4000 });
  assert.deepEqual([c.rows[0].tested.partialCredit, c.rows[0].rejected.partialCredit], [true, false]);
  assert.match(c.decision.label, /^effect on strict pass at look 2; partial credit tested, not rejected at its boundary/);
  assert.deepEqual([c.decision.strictClaim, c.decision.partialCreditClaim], [true, false]);
  // (d) Harm: (a) with the arms swapped. Strict pass rejected with the control ahead ends the comparison.
  const d = analyzeLooks(p, { 2: A.T }, { 2: A.C }, { firstLook: 2, permIterations: 4000 });
  assert.match(d.decision.label, /^harm on strict pass at look 2; partial credit rejected too \(control ahead\)/);
  assert.deepEqual([d.decision.strictClaim, d.decision.partialCreditClaim, d.decision.harm], [false, false, true]);
  // The rule itself: partial credit is never rejected without strict pass, whatever its p.
  const nominal = { strict: 0.018, partialCredit: 0.018 };
  assert.deepEqual(lookRule({ strict: { p: 0.5, diff: 0.02 }, partialCredit: { p: 1e-9, diff: 0.4 }, nominal }).partialCredit, { crossed: true, tested: false, dir: 1, rejected: false });
  assert.equal(lookRule({ strict: { p: 0.001, diff: 0.02 }, partialCredit: { p: 1e-9, diff: 0.4 }, nominal }).partialCredit.tested, false, 'a crossing under the 3-point floor is not a rejection, so the gate stays shut');
  assert.equal(lookRule({ strict: { p: 0.001, diff: 0.05 }, partialCredit: { p: 0.01, diff: 0.04 }, nominal }).partialCredit.rejected, true);
});

test('stopping (D23): never on partial credit alone; --stop-on either is refused', () => {
  const p = realPlan(), L2 = p.looks[1].tasks;
  // Partial credit crosses far beyond its boundary with the treatment ahead (and, swapped, with the control ahead):
  // under D23 neither ends the comparison while strict pass is not rejected (the DRAFT's default `either` stopped here).
  const B = rowsFrom(L2, [[3, [1, 1], [0, 0.5]], [1, [0, 0.5], [1, 1]], [50, [0, 0.7], [0, 0.5]]]);
  for (const [C, T] of [[B.C, B.T], [B.T, B.C]]) {
    const r = analyzeLooks(p, { 2: C }, { 2: T }, { firstLook: 2, permIterations: 4000 });
    assert.equal(r.rows[0].crossed.partialCredit, true);
    assert.equal(r.decision.label, 'continue: run look 3');
    assert.equal(r.stopOn, 'strict');
  }
  // On a one-look schedule the same rows end at the final look with nothing decided: partial credit was never tested.
  const one = { ...p, looks: [p.looks[0], p.looks[1]], schedules: [{ firstLook: 2, looks: [2], cumulative: [60], nominal: { strict: [0.05], partialCredit: [0.05] } }] };
  const f = analyzeLooks(one, { 2: B.C }, { 2: B.T }, { firstLook: 2, permIterations: 4000 });
  assert.match(f.decision.label, /^final look: no resolvable difference on strict pass; partial credit not tested/);
  assert.deepEqual([f.decision.strictClaim, f.decision.partialCreditClaim], [false, false]);
  // The DRAFT's `either` rule is refused, in the function and on the command line (before any file is read).
  assert.equal(STOP_ON, 'strict');
  assert.throws(() => analyzeLooks(p, { 2: B.C }, { 2: B.T }, { firstLook: 2, stopOn: 'either', permIterations: 4000 }), /D23.*never ends on partial credit alone/);
  assert.equal(analyzeLooks(p, { 2: B.C }, { 2: B.T }, { firstLook: 2, stopOn: 'strict', permIterations: 4000 }).decision.label, 'continue: run look 3');
  const cli = spawnSync(process.execPath, [SEQ, 'analyze', '--stop-on', 'either', '--first-look', '2'], { encoding: 'utf8' });
  assert.equal(cli.status, 1); assert.match(cli.stderr, /stop-on either is refused: D23/);
});

test('analyze on stored dev60 rows: treatment look-1 rows are in-sample (refused unless an illustration); never-graded rows are listed', () => {
  const p = realPlan();
  // The control on look 1 may be the stored dev60 A0 rows; a treatment's stored dev60 rows may not.
  assert.equal(verifyLookRuns(p, 1, ['a0-dev60-dn'], { role: 'control' }).sources[0].source, 'stored dev60 A0 rows (pre-plan control)');
  assert.throws(() => verifyLookRuns(p, 1, ['a1c-dev60-dn'], { role: 'control' }), /must be a stored A0 model run/);
  assert.throws(() => verifyLookRuns(p, 1, ['a1-dev60-dn', 'a1-dev60-dn-fill'], { role: 'treatment', firstLook: 1 }), /in-sample: the arm was developed on dev60/);
  const ill = verifyLookRuns(p, 1, ['a1-dev60-dn', 'a1-dev60-dn-fill'], { role: 'treatment', firstLook: 1, illustration: true });
  assert.match(ill.sources[0].source, /^ILLUSTRATION/);
  const control = { 1: loadOutcomes(['a0-dev60-dn']) }, treatment = { 1: ill.outcomes };
  const r = analyzeLooks(p, control, treatment, { firstLook: 1, permIterations: 20000 });
  const L1 = r.rows[0];
  assert.equal(L1.n, 60); assert.deepEqual([L1.strict.treatment, L1.strict.control, L1.strict.b, L1.strict.c], [18, 9, 12, 3]);
  assert.ok(Math.abs(L1.strict.p - 0.0352) < 0.0005); assert.equal(+L1.strict.eValue.toFixed(1), 4.5);
  assert.deepEqual(L1.crossed, { strict: false, partialCredit: false });
  assert.deepEqual(L1.neverGraded, { treatment: [], control: [] });
  assert.match(r.decision.label, /continue: run look 2/);
  // The same rows read as a single, final look at D23's 0.05: strict pass crosses (p 0.035), which opens partial credit
  // (p 0.006): both rejected. In-sample (A1 was developed on these tasks): an illustration, never a result.
  const one = { ...p, looks: [p.looks[0]], schedules: [{ firstLook: 1, looks: [1], cumulative: [60], nominal: { strict: [0.05], partialCredit: [0.05] } }] };
  const r1 = analyzeLooks(one, control, treatment, { firstLook: 1, permIterations: 20000 });
  assert.deepEqual(r1.rows[0].rejected, { strict: true, partialCredit: true });
  assert.match(r1.decision.label, /^effect on strict pass at look 1; partial credit rejected too \(treatment ahead\)/); assert.equal(r1.decision.strictClaim, true);
  // Arms swapped: harm.
  assert.match(analyzeLooks(one, treatment, control, { firstLook: 1, permIterations: 20000 }).decision.label, /^harm on strict pass/);
  // The 3-point floor: a uniform +0.01 partial-credit gap crosses the boundary (every sign agrees) but is not tested
  // (strict pass 0 vs 0) and would not decide.
  const tiny = t => new Map(p.looks[0].tasks.map(x => [x, { pass: 0, pc: t }]));
  const rt = analyzeLooks(one, { 1: tiny(0.50) }, { 1: tiny(0.51) }, { firstLook: 1, permIterations: 2000 });
  assert.deepEqual([rt.rows[0].crossed.partialCredit, rt.rows[0].tested.partialCredit, rt.rows[0].rejected.partialCredit], [true, false, false]);
  assert.equal(lookRule({ strict: { p: 0.001, diff: 0.1 }, partialCredit: { p: rt.rows[0].partialCredit.p, diff: 0.01 }, nominal: { strict: 0.05, partialCredit: 0.05 } }).partialCredit.rejected, false);
  assert.match(rt.decision.label, /final look: no resolvable difference/);
  // A sealed run (devCheck) is never read.
  assert.throws(() => loadOutcomes(['a0-devcheck-1']), /sealed run/);
  // T3 at $0: the same arm (A0, date note) run twice on dev60, CLI 2.1.300 and 2.1.306: never significant.
  const aa = analyzeLooks(one, control, { 1: loadOutcomes(['a0-dev60-dn-v306']) }, { firstLook: 1, permIterations: 20000 });
  assert.deepEqual([aa.rows[0].strict.b, aa.rows[0].strict.c], [4, 4]);
  assert.deepEqual(aa.rows[0].crossed, { strict: false, partialCredit: false });
  assert.ok(aa.rows[0].partialCredit.p > 0.3, `A/A partial-credit p ${aa.rows[0].partialCredit.p}`);
  // Never-graded rows (no final grade, no fault flag) score 0 and are listed (PREREG-AB-v1 §6.3).
  const d = tmp('ng'), rows = readFileSync(path.join(RUNS, 'a0-dev60-dn', 'results.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  const victim = rows[0].task; delete rows[0].final;
  writeFileSync(path.join(d, 'results.jsonl'), rows.map(x => JSON.stringify(x)).join('\n') + '\n');
  const ng = analyzeLooks(one, { 1: loadOutcomes([d]) }, treatment, { firstLook: 1, permIterations: 2000 });
  assert.deepEqual(ng.rows[0].neverGraded, { treatment: [], control: [victim] });
});

test('analyze checks each look run\'s sidecar: plan, look, task list, role, declared first look, one arm', () => {
  const p = realPlan(), root = tmp('runs'), L2 = p.looks[1].tasks;
  const mk = (name, sidecar, tasks = L2) => {
    const d = path.join(root, name); mkdirSync(d);
    writeFileSync(path.join(d, 'summary.json'), JSON.stringify({ tasks }));
    writeFileSync(path.join(d, 'results.jsonl'), tasks.map(t => JSON.stringify({ task: t, forks: [{}], final: { task_completed_correctly: 0, partial_credit: 0.5 } })).join('\n') + '\n');
    if (sidecar) writeFileSync(path.join(d, SIDECAR), JSON.stringify({ schema: SIDECAR_SCHEMA, plan: p.planSha256, look: 2, tasksSha256: p.looks[1].sha256, role: 'treatment', arm: 'A1-C v2', firstLook: 2, ...sidecar }));
    return name;
  };
  const ok = mk('ok', {});
  assert.equal(verifyLookRuns(p, 2, [ok], { role: 'treatment', firstLook: 2, runsRoot: root }).arm, 'A1-C v2');
  assert.throws(() => verifyLookRuns(p, 2, [ok], { role: 'treatment', firstLook: 1, runsRoot: root }), /first look \(declared 2, analysed 1\)/);
  assert.throws(() => verifyLookRuns(p, 2, [ok], { role: 'control', runsRoot: root }), /role/);
  assert.throws(() => verifyLookRuns(p, 2, [mk('otherplan', { plan: 'x' })], { role: 'treatment', firstLook: 2, runsRoot: root }), /plan/);
  assert.throws(() => verifyLookRuns(p, 2, [mk('oldschema', { schema: 'foundry.autobench.sequential-look/v1' })], { role: 'treatment', firstLook: 2, runsRoot: root }), /schema/);
  assert.throws(() => verifyLookRuns(p, 2, [ok, mk('otherarm', { arm: 'A1' })], { role: 'treatment', firstLook: 2, runsRoot: root }), /arm/);
  assert.throws(() => verifyLookRuns(p, 2, [mk('nosidecar', null)], { role: 'treatment', firstLook: 2, runsRoot: root }), /no sequential-look\.json/);
  assert.throws(() => verifyLookRuns(p, 2, [mk('nosidecar-c', null)], { role: 'control', runsRoot: root }), /no sequential-look\.json/);
  assert.throws(() => verifyLookRuns(p, 2, [mk('extra', {}, [...L2, p.looks[0].tasks[0]])], { role: 'treatment', firstLook: 2, runsRoot: root }), /outside look 2/);
  assert.throws(() => verifyLookRuns(p, 2, [mk('short', {}, L2.slice(1))], { role: 'treatment', firstLook: 2, runsRoot: root }), /summary's tasks are not look 2's/);
});

test('T2 (D23): under H0 the fixed sequence keeps the family-wise type-I at most 0.05 on every schedule, with the analysis\' permutation test too', t => {
  const p = realPlan(), bound = (a, reps) => a + 3 * Math.sqrt(a * (1 - a) / reps);
  const check = (r, label) => {
    assert.ok(r.familyWise <= bound(0.05, r.reps), `${label}: family-wise type-I ${r.familyWise}`);
    // The gate: every rejection starts with strict pass, so the family-wise error is strict pass's own.
    assert.equal(r.familyWise, r.strictRejected, `${label}: a rejection without strict pass`);
    assert.ok(r.partialCreditRejected <= r.strictRejected);
    // The other half of the closed-testing argument: partial credit's own 0.05 boundary holds its alpha even ungated.
    assert.ok(r.partialCreditUngated <= bound(0.05, r.reps), `${label}: partial credit at its own boundary ${r.partialCreditUngated}`);
  };
  for (const cumulative of [scheduleOf(p, 1).cumulative, scheduleOf(p, 2).cumulative, [60, 120, 180, 240]]) {
    const reps = 20000, r = simulateSchedule({ cumulative, reps, seed: 'test-t2' });
    t.diagnostic(`normal form, looks ${cumulative.join('/')}: family-wise ${r.familyWise}, partial credit through the gate ${r.partialCreditRejected}, partial credit ungated ${r.partialCreditUngated}; DRAFT either ${r.draftEither}, DRAFT strict ${r.draftStrict}`);
    check(r, `normal, looks ${cumulative.join('/')}`);
    assert.ok(r.draftEither <= bound(0.05, reps) && r.draftStrict <= bound(0.025, reps));
  }
  // The analysis' own partial-credit test (sign-flip permutation, Besag-Clifford stopped), not only its normal form.
  for (const cumulative of [scheduleOf(p, 1).cumulative, scheduleOf(p, 2).cumulative]) {
    const reps = 3000, r = simulateSchedule({ cumulative, reps, seed: 'test-t2-perm', pcTest: 'permutation' });
    t.diagnostic(`permutation, looks ${cumulative.join('/')}: family-wise ${r.familyWise}, partial credit ungated ${r.partialCreditUngated} (${reps} reps)`);
    check(r, `permutation, looks ${cumulative.join('/')}`);
  }
  // The Besag-Clifford p is a permutation p: for a fixed sample it tracks the analysis' fixed-B Monte Carlo p.
  const r = rng('bc'), d = Array.from({ length: 60 }, () => (r.next() < 0.8 ? 1 : -1) * r.next() * 0.3);
  const bc = signFlipPSequential(d, rng('bc-p'), { h: 400, max: 400000 }), mc = pairedPermutation(d, d.map(() => 0), { iterations: 200000, seed: 'bc-mc' }).p;
  t.diagnostic(`Besag-Clifford p ${bc} vs fixed-B permutation p ${mc}`);
  assert.ok(mc < 0.05 && Math.abs(Math.log(bc / mc)) < 0.25, `BC p ${bc} vs MC p ${mc}`);
  assert.equal(signFlipPSequential([0, 0], rng('bc0')), 1);
  assert.throws(() => simulateSchedule({ cumulative: [60], reps: 1, pcTest: 'exact' }), /pcTest/);
});

test('power (D23, development evidence): the full alpha on strict pass detects more than the DRAFT\'s 0.025; the simulation stops only on strict pass', t => {
  const alternative = { treatment: outs => outs.slice(2), control: outs => outs.slice(0, 2) };   // A1 vs A0, in-sample (optimistic)
  const r = simulateSchedule({ cumulative: [60, 83], reps: 2000, seed: 'test-power', alternative });
  t.diagnostic(`H1 (A1 in-sample effect), 60/83: strict ${r.strictBenefit}, both ${r.bothBenefit}, DRAFT strict ${r.draftStrict}, DRAFT either ${r.draftEither}, mean tasks ${r.meanTasks}`);
  assert.ok(r.strictBenefit > r.draftStrict, `strict at 0.05 ${r.strictBenefit} vs at 0.025 ${r.draftStrict}`);
  assert.ok(r.bothBenefit <= r.strictBenefit && r.partialCreditRejected <= r.strictRejected);
  assert.ok(r.meanTasks > 60 && r.meanTasks < 83, `mean tasks ${r.meanTasks}`);
});

test('frozen artifacts: SEQUENTIAL-PLAN-v1.json is the pinned plan, and LOOK2-TASKS.json is its look 2 (names and hash)', t => {
  if (FROZEN_PLAN_SHA256 === null) { t.skip('the plan is not frozen yet'); return; }
  const plan = readPlan(FROZEN_FILE);
  assert.equal(plan.planSha256, FROZEN_PLAN_SHA256); assert.equal(plan.draft, false); assert.match(plan.status, /^FROZEN/);
  assert.deepEqual(plan.counts, [60, 60, 23]);
  assert.deepEqual(plan.looks.map(L => L.sha256.slice(0, 8)), ['0358b32e', 'a8c1ed5c', 'ae2200f3']);
  assert.deepEqual(sig3(scheduleOf(plan, 2).nominal.strict), [0.018, 0.0443]); assert.deepEqual(sig3(scheduleOf(plan, 2).nominal.partialCredit), [0.018, 0.0443]);
  assert.deepEqual(plan.procedure, PROCEDURE);
  const exp = JSON.parse(readFileSync(LOOK2_FILE, 'utf8'));
  assert.deepEqual(exp, exportLook(plan, 2));
  assert.equal(listSha256(exp.tasks), exp.tasksSha256); assert.equal(exp.tasksSha256, plan.looks[1].sha256); assert.equal(exp.n, 60);
  assertNoDevCheck(exp.tasks, split);
  assert.throws(() => exportLook(readPlan(writePlan(tmp('exp'), realPlan()), { frozen: null }), 2), /DRAFT/);
});
