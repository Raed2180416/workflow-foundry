// Tests for the VL-1 live verifier arm (VERIFIER-LAB.md §5 step 7): synthetic runs and worlds only (no benchmark data).
//   node --test experiments/autobench/verifier/live/live.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs, { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { guardedRead, parsePools, pick, selectAll } from './select.mjs';
import { bootstrap, decide, headlines, mcnemarExact, paired, scoreSelection } from './score.mjs';
import { HP_TYPES, makeLedger, repairBrief, repairCaps, repairPlan, repairTask } from './repair.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../../..');
const GRADE_KEYS = ['task_completed_correctly', 'partial_credit', 'assertion_results'];
const tmp = () => mkdtempSync(path.join(os.tmpdir(), 'vl1-test-'));
const wjson = (f, o) => { mkdirSync(path.dirname(f), { recursive: true }); writeFileSync(f, JSON.stringify(o)); };
const TASKS = ['zeta.first_case', 'zeta.second_case', 'omega.third_case'];

/** A synthetic live root: runs with prep/, host/<task>/fork-0/ (final world, call log, and a grade that must stay unread). */
function syntheticRuns(root, { runs = { 'r-alpha': TASKS, 'r-beta': TASKS }, gradeAsDir = true } = {}) {
  for (const [run, tasks] of Object.entries(runs)) {
    const results = [];
    for (const [i, t] of tasks.entries()) {
      const w0 = { meta: { current_time: '2030-01-10T09:00:00Z', allowed_services: ['gmail'] }, gmail: { messages: [{ id: 'm1', to: ['a@x.test'], subject: 'Rule', body_plain: 'Notify the owner.' }] } };
      const w1 = structuredClone(w0);
      w1.gmail.messages.push({ id: `n-${run}`, to: ['owner@x.test'], subject: 'Done', body_plain: `from ${run}` });
      wjson(path.join(root, run, 'prep', t, 'world0.json'), { task: t, contract_sha256: 'c'.repeat(64), world: w0 });
      wjson(path.join(root, run, 'prep', t, 'prompt.json'), { system: 'You are an agent.', user: `Do the work for ${t.split('.')[1]}.` });
      wjson(path.join(root, run, 'prep', t, 'meta.json'), { example_id: i, contract_sha256: 'c'.repeat(64) });
      const fork = path.join(root, run, 'host', t, 'fork-0');
      wjson(path.join(fork, 'final-world.json'), w1);
      writeFileSync(path.join(fork, 'calls.jsonl'), JSON.stringify({ step: 1, calls: [{ name: 'api_fetch', arguments: JSON.stringify({ method: 'POST', url: '/send', body: { to: 'owner@x.test' } }) }], results: ['{"ok":true}'] }) + '\n');
      // the grade: a directory, so any attempt to open it as a file fails the build
      if (gradeAsDir) mkdirSync(path.join(fork, 'grade.json'), { recursive: true }); else wjson(path.join(fork, 'grade.json'), { task_completed_correctly: 1 });
      results.push({ task: t, domain: t.split('.')[0], forks: [{ fork: 0, task_completed_correctly: 1, partial_credit: 0.987654, n_passed: 3, failed_types: ['CANARYTYPE'], steps: 4 + i, costUsd: 0.01, sessionError: null, harnessError: null, skipped: null, tokens: null }],
        final: { task_completed_correctly: run === 'r-alpha' ? (i % 2) : 1, partial_credit: 0.987654, failed_types: ['CANARYTYPE'] }, costUsd: 0.01 + i / 100 });
    }
    writeFileSync(path.join(root, run, 'results.jsonl'), results.map(r => JSON.stringify(r)).join('\n') + '\n');
    wjson(path.join(root, run, 'launch.json'), { tasks, model: 'm', harness: null, runnerSha256: 'r' });
  }
  const split = path.join(root, '..', 'split.json');
  wjson(split, { dev: [...TASKS, 'zeta.check_case', 'omega.extra_case'], devCheck: ['zeta.check_case'], test: ['zeta.sealed_case'] });
  return split;
}
function build(root, split, out, { arms = ['a=r-alpha', 'b=r-beta'], tasks = TASKS } = {}) {
  const list = path.join(path.dirname(out), `list-${path.basename(out)}.json`);
  wjson(list, { tasks });
  return spawnSync('python3', ['-I', path.join(HERE, 'build-live.py'), '--tasks', list, '--live-root', root, ...arms.flatMap(a => ['--arm', a]), '--out', out, '--split', split], { encoding: 'utf8' });
}

test('1. build-live: label-free output, never opens a grade, refuses non-devTrain tasks and devcheck/test run ids', () => {
  const dir = tmp(), root = path.join(dir, 'live');
  const split = syntheticRuns(root);
  const out = path.join(dir, 'lab');
  const r = build(root, split, out);
  assert.equal(r.status, 0, r.stderr);
  const files = ['dataset.jsonl', 'manifest.json', 'load.mjs'].map(f => readFileSync(path.join(out, f), 'utf8'));
  for (const text of files) {
    for (const k of GRADE_KEYS) assert.ok(!text.includes(k), `lab output carries ${k}`);
    assert.ok(!text.includes('CANARYTYPE') && !text.includes('0.987654'), 'a grade value leaked into the lab');
  }
  const rows = files[0].split('\n').filter(Boolean).map(l => JSON.parse(l));
  assert.equal(rows.length, 6);
  assert.ok(rows.every(x => x.label === null && x.canonical && x.outcome));
  assert.equal(rows[0].tokens, null);
  assert.equal(rows.find(x => x.rowId === `r-alpha/${TASKS[1]}`).steps, 5, 'allowlisted run fields are kept');
  assert.ok(files[2].includes('export const ARM_ORDER = ["a", "b"];'));
  assert.equal(rows[0].diff.nChanges, 1);
  // a run id naming test or devcheck is refused before anything is read
  const r2 = build(root, split, path.join(dir, 'lab2'), { arms: ['a=r-alpha', 'b=r-test-1'] });
  assert.equal(r2.status, 2);
  // a run holding a task outside devTrain is refused
  const root3 = path.join(dir, 'live3');
  const split3 = syntheticRuns(root3, { runs: { 'r-gamma': [...TASKS, 'zeta.check_case'] } });
  const r3 = build(root3, split3, path.join(dir, 'lab3'), { arms: ['a=r-gamma'] });
  assert.equal(r3.status, 2);
  assert.match(r3.stderr, /outside devTrain/);
  // a listed task outside devTrain is refused; an unlisted devTrain task is skipped unread
  assert.equal(build(root, split, path.join(dir, 'lab4'), { tasks: [...TASKS, 'zeta.sealed_case'] }).status, 2);
  const r5 = build(root, split, path.join(dir, 'lab5'), { tasks: TASKS.slice(0, 2) });
  assert.equal(r5.status, 0, r5.stderr);
  const m5 = JSON.parse(readFileSync(path.join(dir, 'lab5', 'manifest.json'), 'utf8'));
  assert.equal(m5.report.skippedNotListed.length, 2);
  rmSync(dir, { recursive: true, force: true });
});

/** A lab plus stored verifier outputs for select.mjs. sig: rowId -> {accept, score, p} */
function selectionFixture(dir, sig) {
  const root = path.join(dir, 'live');
  const split = syntheticRuns(root);
  const lab = path.join(dir, 'lab');
  assert.equal(build(root, split, lab).status, 0);
  const rows = readFileSync(path.join(lab, 'dataset.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  const rl2 = path.join(dir, 'rl2'), dj = path.join(dir, 'dj');
  mkdirSync(rl2, { recursive: true }); mkdirSync(dj, { recursive: true });
  const checks = [], judg = [];
  for (const r of rows) {
    const s = sig(r);
    checks.push({ rowId: r.rowId, task: r.task, version: 'v', readers: 3, judged: [], code: [{ key: 'effect_any', type: 'effect_any', hard: true, support: 3, pass: s.accept, evidence: '' }, { key: 'soft', type: 'msg_has', hard: false, support: 3, pass: s.score >= 0.5, evidence: '' }] });
    judg.push({ key: `dj-v3|world|haiku|${r.rowId}`, version: 'dj-v3', variant: 'world', rowId: r.rowId, ok: true, verdict: { confidence: s.p } });
  }
  writeFileSync(path.join(rl2, 'checks-t.jsonl'), checks.map(c => JSON.stringify(c)).join('\n') + '\n');
  writeFileSync(path.join(dj, 'judgments-haiku-world.jsonl'), judg.map(c => JSON.stringify(c)).join('\n') + '\n');
  return { root, lab, rl2, dj, rows };
}

test('2. select: refuses a labelled row and reads nothing under host/ (file-access spy)', () => {
  const dir = tmp();
  const fx = selectionFixture(dir, () => ({ accept: true, score: 1, p: 0.5 }));
  const seen = [];
  const orig = fs.readFileSync;
  fs.readFileSync = function spy(p, ...rest) { seen.push(String(p)); return orig.call(this, p, ...rest); };
  syncBuiltinESMExports();
  try {
    const res = selectAll({ labDir: fx.lab, rl2Dir: fx.rl2, rl2Tag: 't', djDir: fx.dj, pools: parsePools('P=a,b') });
    assert.equal(res.selections.length, 4);
  } finally { fs.readFileSync = orig; syncBuiltinESMExports(); }
  assert.ok(seen.length >= 4, 'the spy saw the reads');
  assert.ok(seen.every(p => !path.resolve(p).split(path.sep).includes('host')), `read under host/: ${seen.filter(p => p.includes('host'))}`);
  assert.throws(() => guardedRead(path.join(fx.root, 'r-alpha', 'host', TASKS[0], 'fork-0', 'final-world.json')), /host/);
  // a labelled row is refused
  const ds = path.join(fx.lab, 'dataset.jsonl');
  const rows = readFileSync(ds, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  rows[1].label = { task_completed_correctly: 1 };
  writeFileSync(ds, rows.map(r => JSON.stringify(r)).join('\n') + '\n');
  assert.throws(() => selectAll({ labDir: fx.lab, rl2Dir: fx.rl2, rl2Tag: 't', djDir: fx.dj, pools: parsePools('P=a,b') }), /label/);
  rmSync(dir, { recursive: true, force: true });
});

test('3. select: deterministic; rules R0-R3 as declared; ties go to fork order (default first)', () => {
  const sig = { a1: { a: 1, s: 0.9, p: 0.2 }, b1: { a: 1, s: 0.5, p: 0.8 }, a2: { a: 0, s: 1, p: 0.9 }, b2: { a: 1, s: 0.1, p: 0.1 }, a3: { a: 1, s: 0.7, p: 0.6 }, b3: { a: 1, s: 0.7, p: 0.6 } };
  const rows = t => [{ rowId: `a${t}`, arm: 'a', run: 'ra' }, { rowId: `b${t}`, arm: 'b', run: 'rb' }];
  const S = r => sig[r.rowId];
  assert.equal(pick('R0', rows(1), ['a', 'b'], S).arm, 'a');
  assert.equal(pick('R1', rows(1), ['a', 'b'], S).arm, 'a');      // [1, 0.9] > [1, 0.5]
  assert.equal(pick('R2', rows(1), ['a', 'b'], S).arm, 'b');      // p 0.8 > 0.2
  assert.equal(pick('R3', rows(1), ['a', 'b'], S).arm, 'b');      // both accepted: p decides
  assert.equal(pick('R3', rows(2), ['a', 'b'], S).arm, 'b');      // the gate: a rejected, b accepted despite lower p
  assert.equal(pick('R2', rows(2), ['a', 'b'], S).arm, 'a');
  assert.equal(pick('R3', rows(3), ['a', 'b'], S).arm, 'a');      // exact tie -> default first
  assert.equal(pick('R3', rows(3), ['b', 'a'], S).arm, 'b');      // fork order is the pool's order
  assert.equal(pick('R0', [rows(1)[1]], ['a', 'b'], S).arm, 'b'); // default missing: decided among those present
  assert.equal(pick('R3', [], ['a', 'b'], S), null);
  const dir = tmp();
  const fx = selectionFixture(dir, r => ({ accept: true, score: 1, p: r.arm === 'b' && r.task !== TASKS[0] ? 0.9 : 0.4 }));
  const go = () => selectAll({ labDir: fx.lab, rl2Dir: fx.rl2, rl2Tag: 't', djDir: fx.dj, pools: parsePools('P=a,b;Q=b,a') });
  const x = go(), y = go();
  assert.deepEqual(x.selections, y.selections);
  const r3 = x.selections.find(s => s.pool === 'P' && s.rule === 'R3');
  assert.equal(r3.picks[TASKS[0]], 'r-alpha');
  assert.equal(r3.picks[TASKS[1]], 'r-beta');
  assert.equal(x.selections.find(s => s.pool === 'Q' && s.rule === 'R0').picks[TASKS[0]], 'r-beta');
  rmSync(dir, { recursive: true, force: true });
});

test('score: exact McNemar, fixed-seed bootstrap, headline supersession, decision rules, refuses an uncommitted selection', () => {
  assert.equal(mcnemarExact(6, 1), 0.125);
  assert.equal(mcnemarExact(4, 0), 0.125);
  assert.equal(mcnemarExact(0, 0), 1);
  assert.ok(Math.abs(mcnemarExact(9, 4) - 0.266846) < 1e-6);
  const d = [1, 0, 0, -1, 1, 1, 0, 0, 1, 0];
  assert.deepEqual(bootstrap(d), bootstrap(d));
  const p = paired(new Map([['t1', 1], ['t2', 1], ['t3', 0]]), new Map([['t1', 0], ['t2', 1], ['t3', 1]]), ['t1', 't2', 't3']);
  assert.deepEqual([p.passA, p.passB, p.gains, p.losses], [2, 2, 1, 1]);
  const dir = tmp(), root = path.join(dir, 'live');
  syntheticRuns(root, { runs: { 'r-one': TASKS, 'r-two': TASKS.slice(0, 1) } });
  // r-two supersedes r-one on the task it recorded
  writeFileSync(path.join(root, 'r-two', 'results.jsonl'), JSON.stringify({ task: TASKS[0], forks: [{}], final: { task_completed_correctly: 1 }, costUsd: 0.5 }) + '\n');
  const h = headlines(root, ['r-one', 'r-two']);
  assert.equal(h.get(TASKS[0]).run, 'r-two');
  assert.equal(h.get(TASKS[0]).pass, 1);
  const sel = { lab: { arms: { a: ['r-one', 'r-two'] } }, signals: {}, selections: [{ pool: 'P', rule: 'R0', arms: ['a'], default: 'a', picks: Object.fromEntries(TASKS.map(t => [t, h.get(t).run])), rows: Object.fromEntries(TASKS.map(t => [t, `${h.get(t).run}/${t}`])) }] };
  const res = scoreSelection({ selection: sel, liveRoot: root, defaultArm: 'a', ref: null, primary: 'P/R0' });
  assert.equal(res.selections[0].pass, [...h.values()].reduce((s, x) => s + x.pass, 0));
  // the pre-declared decision rules, applied mechanically
  const prim = (diff, losses, pass, usd, prec = 0.8) => ({ id: 'P2/R3', pass, vsDefault: { diff, gains: diff + losses, losses, mcnemarP: 1, bootstrap95: [0, 0] }, cost: { usdPerTask: usd }, hpOnPicks: { precision: prec } });
  assert.equal(decide(prim(3, 2, 30, 0.15), null, null).selection, 'selection works on fresh tasks');
  assert.equal(decide(prim(4, 3, 30, 0.15), null, null).selection, 'inconclusive (neither rule fires)');
  assert.equal(decide(prim(1, 0, 30, 0.15), null, null).selection, 'selection is not the lever');
  assert.equal(decide(prim(2, 0, 30, 0.15), null, null).selection, 'inconclusive (neither rule fires)');
  assert.equal(decide(prim(3, 0, 28, 0.2), { pass: 30, costUsdPerTask: 1 }, null).opus.parity, true);
  assert.equal(decide(prim(3, 0, 27, 0.2), { pass: 30, costUsdPerTask: 1 }, null).opus.parity, false);
  assert.equal(decide(prim(3, 0, 30, 0.21), { pass: 30, costUsdPerTask: 1 }, null).opus.parity, false);
  assert.equal(decide(prim(3, 0, 30, 0.1, 0.7), null, { vsControl: { fixed: 2, broke: 1 } }).repair.carry, true);
  assert.equal(decide(prim(3, 0, 30, 0.1, 0.69), null, { vsControl: { fixed: 2, broke: 1 } }).repair.carry, false);
  assert.equal(decide(prim(3, 0, 30, 0.1, 0.9), null, { vsControl: { fixed: 1, broke: 1 } }).repair.carry, false);
  const f = path.join(dir, 'selection.json');
  writeFileSync(f, JSON.stringify(sel));
  const r = spawnSync(process.execPath, [path.join(HERE, 'score.mjs'), '--selection', f, '--live-root', root, '--default', 'a', '--out', path.join(dir, 'R.json')], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /not committed/);
  rmSync(dir, { recursive: true, force: true });
});

test('5. repair: the scripted session gets no world step beyond its cap; the control path makes no model call', async () => {
  assert.deepEqual(repairCaps({ pickSteps: 12, pickResponses: 20 }), { worldSteps: 10, responses: 30 });
  assert.deepEqual(repairCaps({ pickSteps: 43, pickResponses: 47 }), { worldSteps: 6, responses: 3 });
  const checks = new Map([['r-alpha/zeta.first_case', { code: [{ hard: true, pass: false, type: 'msg_to', statement: 'Email the owner.', evidence: 'no new message' }, { hard: false, pass: false, type: 'msg_has' }] }],
    ['r-alpha/zeta.second_case', { code: [{ hard: true, pass: false, type: 'no_dup' }] }]]);
  const sel = { selections: [{ pool: 'P2', rule: 'R3', rows: { 'zeta.first_case': 'r-alpha/zeta.first_case', 'zeta.second_case': 'r-alpha/zeta.second_case', 'omega.third_case': null } }] };
  const plan = repairPlan(sel, 'P2/R3', checks);
  assert.deepEqual(plan.map(p => p.task), ['zeta.first_case'], 'only failing hard checks of a high-precision type trigger a repair');
  assert.ok(HP_TYPES.includes('msg_to') && !HP_TYPES.includes('no_dup'));
  const brief = repairBrief(plan[0].failing);
  assert.match(brief, /Email the owner\./);
  assert.match(brief, /Do not repeat any effect/);

  const dir = tmp(), root = path.join(dir, 'live');
  syntheticRuns(root);
  const lab = path.join(dir, 'lab');
  const w = JSON.parse(readFileSync(path.join(root, 'r-alpha', 'host', 'zeta.first_case', 'fork-0', 'final-world.json'), 'utf8'));
  mkdirSync(path.join(lab, 'worlds', 'r-alpha'), { recursive: true });
  writeFileSync(path.join(lab, 'worlds', 'r-alpha', 'zeta.first_case.final.json.gz'), gzipSync(JSON.stringify(w)));
  writeFileSync(path.join(root, 'r-alpha', 'prep', 'zeta.first_case', 'catalog.json'), '[]');
  const serves = new Map(), events = [];
  let modelCalls = 0;
  const deps = {
    // a stand-in for bridge serve: it enforces the world-step cap exactly as the bridge does (maxSteps - 1 steps)
    startServe: o => { const s = { o, steps: 0, ready: Promise.resolve(), attempt() { if (this.steps >= o.maxSteps - 1) return false; this.steps++; return true; }, async stop() { events.push(['stop', o.hostDir]); return { steps: s.steps }; } };
      serves.set(o.mailbox, s); events.push(['serve', o.hostDir, o.maxSteps]); mkdirSync(o.hostDir, { recursive: true }); return s; },
    materializeWorkdir: wd => mkdirSync(path.join(wd, '.tools'), { recursive: true }),
    adapterText: (_c, maxSteps) => `tools; at most ${maxSteps - 1} steps`,
    // a scripted session that tries 25 world steps
    runner: async o => { modelCalls++; events.push(['runner', o.maxTurns]); const s = serves.get(path.join(o.workdir, '.tools')); let done = 0; for (let i = 0; i < 25; i++) if (s.attempt()) done++; return { ok: true, costUsd: 0, turns: 25, label: 'scripted', done }; },
    writeCliGuard: (d, { maxTurns }) => ({ dir: d, binary: path.join(d, 'claude-a1'), maxTurns }),
    auditSession: () => ({ violations: [], modelResponses: 0 }), readCalls: () => [], readStream: () => [], keepRo: [],
  };
  const item = { ...plan[0], caps: repairCaps({ pickSteps: 43, pickResponses: 20 }) };
  const ctl = await repairTask(item, { liveRoot: root, labDir: lab, outDir: path.join(dir, 'out'), deps, model: 'claude-haiku-5-5', budgetUsd: 0.1, timeoutMs: 1000, ledger: makeLedger(1), controlOnly: true });
  assert.equal(modelCalls, 0, 'the control path makes no model call');
  assert.equal(ctl.treatment, undefined);
  events.length = 0;
  const rec = await repairTask(item, { liveRoot: root, labDir: lab, outDir: path.join(dir, 'out2'), deps, model: 'claude-haiku-5-5', budgetUsd: 0.1, timeoutMs: 1000, ledger: makeLedger(1) });
  assert.equal(modelCalls, 1);
  assert.equal(rec.treatment.steps, 6, 'world steps stop at min(10, 49 - 43) = 6 of 25 tried');
  assert.deepEqual(events.map(e => e[0]), ['serve', 'stop', 'serve', 'runner', 'stop'], 'the control serve stops before the only session starts');
  assert.ok(String(events[0][1]).endsWith('control') && String(events[2][1]).endsWith('treatment'));
  assert.equal(events[2][2], 7, 'the treatment serve allows maxSteps - 1 = 6 world steps');
  assert.equal(events[3][1], 30, 'model responses capped at 50 - 20');
  // the round's dollar cap: a second session that would exceed it is skipped
  const ledger = makeLedger(0.15);
  ledger.reserve(0.1); ledger.settle(0.1, { costUsd: 0.1 });
  const rec2 = await repairTask(item, { liveRoot: root, labDir: lab, outDir: path.join(dir, 'out3'), deps, model: 'claude-haiku-5-5', budgetUsd: 0.1, timeoutMs: 1000, ledger });
  assert.match(rec2.treatment.skipped, /cap/);
  assert.equal(modelCalls, 1);
  // repair.mjs never opens a grade
  assert.ok(!readFileSync(path.join(HERE, 'repair.mjs'), 'utf8').includes('grade.json'));
  rmSync(dir, { recursive: true, force: true });
});

test('4. hygiene: the new sources carry no task names, grader check names or lab paths', () => {
  const all = ['build-live.py', 'lab-load.mjs', 'select.mjs', 'repair.mjs', 'score.mjs', 'repro-check.mjs', 'repro-dev60.sh', 'run-look2.sh', 'launch-a1s-look2.sh'];
  const noGrades = ['build-live.py', 'lab-load.mjs', 'select.mjs', 'repair.mjs'];
  const taskName = /\b(finance|hr|marketing|operations|sales|support)\.[a-z]+_[a-z_]+\b/;
  const graderChecks = /gmail_message_sent|google_sheets_row_|_with_body_contains|slack_message_in_channel|salesforce_field_equals/;
  const labPaths = /\/tmp\/claude-0|scratchpad|ceiling\.md|dump\.py|strata\.json|judge-eval\.mjs|vlab\/|\/vlab\b/;
  const gradeFields = /task_completed_correctly|partial_credit|assertion_results|grade\.json/;
  const names = new Set(JSON.parse(readFileSync(path.join(REPO, 'research/automationbench-20261014/LOOK2-TASKS.json'), 'utf8')).tasks);
  const extra = process.env.VLAB_TASKS;
  if (extra && existsSync(extra)) for (const n of readFileSync(extra, 'utf8').split(/[\s,]+/).filter(Boolean)) names.add(n);
  for (const f of all) {
    const src = readFileSync(path.join(HERE, f), 'utf8');
    assert.ok(!taskName.test(src), `${f} names a task`);
    assert.ok(!graderChecks.test(src), `${f} names a grader check`);
    assert.ok(!labPaths.test(src), `${f} names a lab path`);
    for (const n of names) assert.ok(!src.includes(n), `${f} names a task`);
    if (noGrades.includes(f)) assert.ok(!gradeFields.test(src), `${f} names a grade field or file`);
  }
});
