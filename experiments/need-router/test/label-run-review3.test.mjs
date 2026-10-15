// label-run.mjs: regression tests for the third adversarial review of the label harness (2026-10-15). One test (or more) per
// fixed defect: one process per work root and --out (directory locks; the spend ledger re-read before each start); the
// repository root named outside an accessed path voids, and text-scan mentions reach rows and the report; the probe is
// disjoint from the evaluation tasks; no two jobs of a stage share an evaluation task; the per-mode summary counts failed
// and voided lineages as needTable scores them; a start settled above its bound is an overrun that stops the stage; racing
// gives no mode top-up to a job whose headline cell is unlabelled. (The second review's STAGE_ALREADY_RUN test and the
// prereg-review2 meter-gate fixture were fixed in place.) $0: stub ports only; work roots are temporary directories.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, mkdirSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as LR from '../label-run.mjs';
import { STAGES_FILE } from '../prereg-check.mjs';
import { needTable } from '../metrics.mjs';
import { b0Agent } from '../../lib/arms/b0-agent.mjs';
import { construct, repoPathMentions, repoPathForms, REPO_ROOT } from '../../c0/construct.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SCRIPT = path.join(REPO, 'experiments/need-router/label-run.mjs');
const tmp = t => { const d = mkdtempSync(path.join(tmpdir(), 'label-run-review3-')); t.after(() => rmSync(d, { recursive: true, force: true })); return d; };
const readJsonl = f => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map(JSON.parse) : []);
const STAGES = JSON.parse(readFileSync(STAGES_FILE, 'utf8'));
const quiet = () => {};
function spec(dir, { runs, capUsd = 400, jobs = ['records-lo', 'wbed-r0'], extraJobs = [], arms = STAGES.arms, seeds = STAGES.seeds, stageId = 'NL-T', name = 'spec.json' } = {}) {
  const doc = { ...STAGES, status: 'draft', seeds, arms, jobs: [...STAGES.jobs.filter(j => jobs.includes(j.id)), ...extraJobs], stages: [{ id: stageId, grade: 'development', estUsd: 1, capUsd, approved: false, runs }] };
  const file = path.join(dir, name);
  writeFileSync(file, JSON.stringify(doc, null, 1));
  return file;
}
function fakeSession({ answer = null, toolUses = [], files: write = {} } = {}) {
  return async args => {
    mkdirSync(args.workdir, { recursive: true });
    for (const [rel, c] of Object.entries(args.files ?? {})) { mkdirSync(path.dirname(path.join(args.workdir, rel)), { recursive: true }); writeFileSync(path.join(args.workdir, rel), c); }
    if (answer !== null) writeFileSync(path.join(args.workdir, 'answer.json'), JSON.stringify(answer));
    for (const [rel, c] of Object.entries(write)) writeFileSync(path.join(args.workdir, rel), c);
    return { ok: true, error: null, costUsd: 0.01, costUnknown: false, costUpperUsd: 0.01, streamUsage: null, turns: 2, usage: null, toolUses, sessionId: 's', durationMs: 5 };
  };
}
const uniqueKeys = recs => new Set(recs.map(r => `${r.experiment}|${r.arm}|${r.taskKey}|${r.trial}`)).size;

// ------------------------------------------------------------------------------ major: one process per work root and --out
test('major: two runs on one work root and --out: the second is refused (RUN_LOCKED), so the meter stays under the cap and no trial runs twice', async t => {
  const dir = tmp(t), live = path.join(dir, 'live'), out = path.join(dir, 'out');
  // The reviewer's case: cap $5, every agent-H session killed, so each start is charged its $2 bound.
  const file = spec(dir, { runs: [{ job: 'wbed-r0', arms: ['agent-H'], seedRoles: ['trainEval'] }], capUsd: 5 });
  const run = () => LR.labelRun({ stageId: 'NL-T', specFile: file, workRoot: live, out, dry: true, racing: false, log: quiet, stubForce: { agent: { 'agent-H': 'killed' } } });
  const [a, b] = await Promise.allSettled([run(), run()]);
  assert.deepEqual([a.status, b.status], ['fulfilled', 'rejected']);
  assert.equal(b.reason.code, 'RUN_LOCKED', b.reason.message); assert.match(b.reason.message, new RegExp(`pid ${process.pid}`));
  const spend = LR.loadSpend([path.join(live, LR.SPEND_FILE), path.join(out, LR.SPEND_FILE)], 'NL-T');
  assert.ok(spend.totalUsd <= 5 + 1e-9, `the meter holds $${spend.totalUsd} (cap $5)`); assert.equal(spend.totalUsd, 4, 'two $2 starts');
  const results = readJsonl(path.join(live, 'results.jsonl'));
  assert.equal(results.length, uniqueKeys(results), 'no trial recorded twice');
  assert.ok(!existsSync(path.join(live, LR.LOCK_FILE)) && !existsSync(path.join(out, LR.LOCK_FILE)), 'the locks are released at the end');
  // A resume after the first run ended takes the lock again and spends nothing more.
  const c = await run();
  assert.equal(c.totals.spend.meterUsd, 4); assert.equal(readJsonl(path.join(live, 'results.jsonl')).length, results.length);
});

test('major: a lock held by a live process in another process refuses the run before it writes; a dead holder\'s lock is taken over', async t => {
  // --out sorts before the work root, so its lock is taken first and must be released when the work root's is refused.
  const dir = tmp(t), live = path.join(dir, 'live'), out = path.join(dir, 'a-out');
  const child = spawn(process.execPath, ['--input-type=module', '-e',
    `import { acquireRunLock } from ${JSON.stringify(pathToFileURL(SCRIPT).href)}; acquireRunLock(${JSON.stringify(live)}, { stage: 'NL-T' }); process.stdout.write('held\\n'); setInterval(() => {}, 1000);`],
    { stdio: ['ignore', 'pipe', 'inherit'] });
  t.after(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } });
  await new Promise((resolve, reject) => { child.stdout.on('data', d => { if (String(d).includes('held')) resolve(); }); child.on('exit', c => reject(new Error(`child exited ${c}`))); });
  assert.throws(() => LR.acquireRunLock(live), e => e.code === 'RUN_LOCKED' && e.held.pid === child.pid);
  const file = spec(dir, { runs: [{ job: 'wbed-r0', arms: ['direct-H'], seedRoles: ['trainEval'] }] });
  await assert.rejects(LR.labelRun({ stageId: 'NL-T', specFile: file, workRoot: live, out, dry: true, racing: false, log: quiet }), e => e.code === 'RUN_LOCKED');
  assert.ok(!existsSync(path.join(live, 'results.jsonl')) && !existsSync(path.join(live, LR.SPEND_FILE)) && !existsSync(path.join(live, LR.PLAN_FILE)), 'nothing written');
  assert.ok(!existsSync(path.join(out, LR.LOCK_FILE)), 'the --out lock taken first is released when the work root is refused');
  // The holder dies without releasing (SIGKILL): its lock names a pid that is gone, so the next run takes it over.
  const exited = new Promise(resolve => child.on('exit', resolve));
  child.kill('SIGKILL'); await exited;
  assert.ok(existsSync(path.join(live, LR.LOCK_FILE)), 'the dead holder left its lock');
  const r = await LR.labelRun({ stageId: 'NL-T', specFile: file, workRoot: live, out, dry: true, racing: false, log: quiet });
  assert.equal(r.totals.rows, 24); assert.ok(!existsSync(path.join(live, LR.LOCK_FILE)));
});

test('major: lock rules: another host\'s lock is never taken over; an unreadable lock only once it is old; release never removes another run\'s lock', t => {
  const dir = tmp(t), file = path.join(dir, LR.LOCK_FILE);
  writeFileSync(file, JSON.stringify({ schema: LR.LOCK_SCHEMA, pid: 2 ** 30, host: 'another-host', startedAt: 'x', stage: 'NL-T', token: 'tok' }));
  assert.throws(() => LR.acquireRunLock(dir, { alive: () => false }), e => e.code === 'RUN_LOCKED' && /another host/.test(e.message));
  // Same host, pid gone: stale.
  writeFileSync(file, JSON.stringify({ schema: LR.LOCK_SCHEMA, pid: 2 ** 30, host: 'h', startedAt: 'x', stage: 'NL-T', token: 'tok' }));
  const l1 = LR.acquireRunLock(dir, { host: 'h', alive: () => false });
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).token, l1.token);
  LR.releaseRunLock(file, 'someone-else'); assert.ok(existsSync(file), 'another token does not release it');
  l1.release(); assert.ok(!existsSync(file));
  // Unreadable (a writer died between create and write): refused while fresh, taken over once old.
  writeFileSync(file, '');
  assert.throws(() => LR.acquireRunLock(dir), e => e.code === 'RUN_LOCKED' && /unreadable/.test(e.message));
  utimesSync(file, new Date(Date.now() - 60000), new Date(Date.now() - 60000));
  LR.acquireRunLock(dir).release();
  // acquireRunLocks: all or none.
  const a = path.join(dir, 'a'), b = path.join(dir, 'b');
  mkdirSync(b, { recursive: true }); writeFileSync(path.join(b, LR.LOCK_FILE), JSON.stringify({ pid: process.pid, host: 'h', token: 't' }));
  assert.throws(() => LR.acquireRunLocks([a, b], { host: 'h' }), e => e.code === 'RUN_LOCKED');
  assert.ok(!existsSync(path.join(a, LR.LOCK_FILE)), 'the lock of a was released when b was refused');
});

test('major: the cap meter re-reads the spend ledger before each start: a second writer\'s reservations count, and attempt numbers do not repeat', t => {
  const dir = tmp(t), f = path.join(dir, LR.SPEND_FILE), g = path.join(dir, 'out-' + LR.SPEND_FILE);
  const A = new LR.StageBudget(5, 0, { stage: 'S', files: [f, g] }), B = new LR.StageBudget(5, 0, { stage: 'S', files: [f, g] });
  const a1 = A.reserve(2, { key: 'k1' });
  const b1 = B.reserve(2, { key: 'k1' });
  assert.ok(a1 && b1); assert.equal(b1.n, 2, 'B numbers its attempt after A\'s');
  assert.equal(A.reserve(2, { key: 'k2' }), null, 'A sees B\'s $2 in flight: 2 + 2 + 2 > 5 (it saw only its own $2 before)');
  assert.equal(A.refused, 1);
  B.settle(b1, 2); A.settle(a1, 1.5);
  assert.equal(LR.loadSpend([f, g], 'S').totalUsd, 3.5);
  // Nothing outside: the in-memory figure alone (no re-read of an unchanged file).
  const C = new LR.StageBudget(5, 3.5, { stage: 'S', files: [f, g] });
  assert.ok(C.reserve(1.5)); assert.equal(C.reserve(0.01), null);
});

// -------------------------------------------------------------------------------------------- minor: cap overruns
test('minor: a start settled above its bound is an overrun on the ledger; a meter over the cap stops the stage (STAGE_CAP_OVERRUN) and is reported', async t => {
  const dir = tmp(t), f = path.join(dir, LR.SPEND_FILE);
  const B = new LR.StageBudget(1, 0, { stage: 'S', files: [f] });
  const tok = B.reserve(0.5, { key: 'k' });
  B.settle(tok, 1.25);
  const e = readJsonl(f).find(x => x.op === 'settle');
  assert.equal(e.overBoundUsd, 0.75); assert.equal(B.overruns.length, 1); assert.equal(B.overCap, true);
  assert.deepEqual(LR.overBound(LR.loadSpend([f], 'S')), { starts: 1, usd: 0.75 });
  // End to end: agent-H with a $0.0001 budget bound under a $0.0005 cap (its first session alone costs more, as an agent CLI that overshoots its budget does).
  const arms = { ...STAGES.arms, 'agent-H': { ...STAGES.arms['agent-H'], budgetUsd: 0.0001 } };
  const live = path.join(dir, 'live'), out = path.join(dir, 'out');
  const rep = await LR.labelRun({ stageId: 'NL-T', specFile: spec(dir, { runs: [{ job: 'wbed-r0', arms: ['agent-H'], seedRoles: ['trainEval'] }], capUsd: 0.0005, arms }),
    workRoot: live, out, dry: true, racing: false, concurrency: 1, log: quiet });
  assert.match(rep.stopped, /^STAGE_CAP_OVERRUN/);
  assert.ok(rep.totals.spend.overBoundStarts >= 1 && rep.totals.spend.overBoundUsd > 0); assert.ok(rep.totals.spend.overCapUsd > 0);
  assert.ok(rep.totals.spend.meterUsd > 0.0005);
  assert.ok(readJsonl(path.join(out, LR.SPEND_FILE)).some(x => x.op === 'settle' && x.overBoundUsd > 0), 'the overrun is on the ledger in --out');
  assert.match(readFileSync(path.join(out, 'report.txt'), 'utf8'), /over their bound by \$[\d.]+; OVER THE CAP by/);
});

// --------------------------------------------------------------------------------- minor: hidden-path void scan gaps
test('minor: the repository root named in a heredoc body, a script written then run, a ~ path or an encoding is counted (repoPathMentions); task text and accessed paths are not', () => {
  const R = REPO_ROOT, oracle = `${R}/beds/records/oracle.mjs`;
  const b64 = s => Buffer.from(s).toString('base64');
  const cases = {
    heredoc: { name: 'Bash', input: { command: `node <<'EOF'\nconsole.log(require('fs').readFileSync('${oracle}', 'utf8'))\nEOF` } },
    written: { name: 'Write', input: { file_path: 'x.mjs', content: `import { readFileSync } from 'node:fs'; readFileSync('${oracle}');` } },
    tilde: { name: 'Bash', input: { command: `ls ~/${path.relative('/home/user', R)}/beds` } },
    home: { name: 'Bash', input: { command: `ls "$HOME/${path.relative('/home/user', R)}/beds"` } },
    base64: { name: 'Bash', input: { command: `cat "$(echo ${b64(oracle)} | base64 -d)"` } },
    base64Shift1: { name: 'Bash', input: { command: `cat "$(echo ${b64(`x${oracle}`)} | base64 -d | cut -c2-)"` } },
    base64Shift2: { name: 'Bash', input: { command: `cat "$(echo ${b64(`xy${oracle}`)} | base64 -d | cut -c3-)"` } },
    hex: { name: 'Bash', input: { command: `cat "$(echo ${Buffer.from(oracle).toString('hex')} | xxd -r -p)"` } },
  };
  if (!R.startsWith('/home/user/')) { delete cases.tilde; delete cases.home; }
  for (const [k, u] of Object.entries(cases)) assert.equal(repoPathMentions([u]).attempts, 1, k);
  assert.ok(repoPathForms().some(f => f.form === 'base64') && repoPathForms().some(f => f.form === 'hex'));
  // A tool use the accessed-path scan already counts is not counted again; honest uses and ownerci-style task paths are not counted.
  const read = { name: 'Read', input: { file_path: oracle } };
  assert.equal(repoPathMentions([read], { counted: u => u === read }).attempts, 0);
  const ownerci = 'You are a maintainer of workflow-foundry. The job ran in /home/runner/work/workflow-foundry/workflow-foundry.';
  for (const u of [{ name: 'Bash', input: { command: 'cd /home/runner/work/workflow-foundry/workflow-foundry && ls' } }, { name: 'Write', input: { file_path: 'answer.json', content: '{"repo":"workflow-foundry"}' } },
    { name: 'Bash', input: { command: 'ls ~/work' } }, { name: 'Bash', input: { command: `ls ${R}-other` } }]) assert.equal(repoPathMentions([u], { ignoreText: ownerci }).attempts, 0, JSON.stringify(u));
  // A form the task itself states is not searched for.
  assert.equal(repoPathMentions([cases.written], { ignoreText: `see ${R}` }).attempts, 0);
});

test('minor: b0Agent and construct() record repoPathMentions; label-run voids the draw or lineage, and carries path mentions into rows and the report', async t => {
  const dir = tmp(t), oracle = `${REPO_ROOT}/beds/records/oracle.mjs`;
  const task = { prompt: 'Sum the records.', inputs: { n: 1 } };
  const heredoc = { name: 'Bash', input: { command: `node <<'EOF'\nrequire('fs').readFileSync('${oracle}')\nEOF` } };
  const r = await b0Agent({ id: 'agent-H', model: 'claude-haiku-5-5', executor: fakeSession({ answer: { v: 1 }, toolUses: [heredoc] }) })
    .run({ task, familyId: 'records', outputSchema: { type: 'object' }, workdir: path.join(dir, 'a'), state: {} });
  assert.equal(r.meta.hiddenPathAttempts, 0, 'the accessed scan skips heredoc bodies'); assert.equal(r.meta.repoPathMentions, 1); assert.deepEqual(r.meta.repoPathForms, ['absolute']);
  const port = LR.stubPorts({ tasks: [], models: ['claude-haiku-5-5'] }).model;
  const res = await construct({ arm: 'B1', familyId: 'records', probeSeeds: [{ seed: 604, difficulty: 2 }], builderModel: 'claude-haiku-5-5', builderBudgetUsd: 3, constructionModelUsd: 1.5, perTaskUsd: 1,
    minutes: 30, scoreChecks: 0, modelPort: port, models: ['claude-haiku-5-5'], kitBase: path.join(dir, 'kit'), workRoot: dir, label: 'L1', selfCheck: true,
    executor: fakeSession({ files: { 'solve.mjs': 'x', 'check.mjs': 'y' }, toolUses: [{ name: 'Write', input: { file_path: 'peek.mjs', content: `readFileSync('${oracle}')` } }, { name: 'Bash', input: { command: 'node peek.mjs' } }] }) });
  assert.equal(res.record.hiddenPathAccesses, 0); assert.equal(res.record.repoPathMentions, 1);
  // label-run --dry: a heredoc draw is voided; a draw that only quotes task-style host paths keeps its verdict and is listed for review.
  const live = path.join(dir, 'live'), out = path.join(dir, 'out');
  const rep = await LR.labelRun({ stageId: 'NL-T', specFile: spec(dir, { runs: [{ job: 'records-lo', arms: ['agent-H', 'construct-H'], seedRoles: ['examples', 'trainEval'] }] }), workRoot: live, out, dry: true, racing: false, log: quiet,
    stubForce: { agent: { 'agent-H/records_dev_d1_s610_t0': 'heredoc', 'agent-H/records_dev_d1_s611_t0': 'mention' }, builder: { 'construct-H-L1': 'repo', 'construct-H-L2': 'ok', 'construct-H-L3': 'ok' } } });
  const rows = readJsonl(path.join(out, 'rows.jsonl')), at = s => rows.find(x => x.mode === 'agent-H' && x.task === `records:dev:d1:s${s}` && x.rep === 0);
  assert.equal(at(610).void, 'repoPathMentions=1'); assert.equal(at(610).pass, false); assert.equal(at(610).rawPass, true);
  assert.equal(at(611).void, null); assert.ok(at(611).pathMentions >= 2); assert.equal(at(611).hiddenPathAttempts, 0); assert.ok(at(611).mentionedPaths.length >= 1);
  const rl = rep.jobs.find(j => j.job === 'records-lo');
  assert.ok(rl.modes['agent-H'].pathMentionRows >= 1);
  assert.ok(rep.validity.pathMentionsDraws.some(x => x.job === 'records-lo' && x.mode === 'agent-H' && x.rows >= 1));
  assert.match(readFileSync(path.join(out, 'report.txt'), 'utf8'), /agent rows whose path mentions exceed their accessed paths \(review by hand\): records-lo\/agent-H \d+/);
  // The builder that wrote and ran a script naming the repository: lineage 1 voided at build time, never run.
  const b1 = rl.builds.find(b => b.mode === 'construct-H' && b.lineage === 1);
  assert.match(b1.void, /repoPathMentions=1/);
  assert.equal(rows.filter(x => x.mode === 'construct-H' && x.lineage === 1).length, 0);
  assert.ok(rep.validity.repoPathMentionVoids >= 2);
});

// -------------------------------------------------------------------------------- minor: the probe is an example task
test('minor: the probe task is disjoint from the evaluation tasks (a collided evaluation seed is replaced) and its hash is in exampleHashes', async () => {
  // A fixture where the probe IS an evaluation task: probe seed 610 (the first trainEval seed) on a one-difficulty band.
  const ledger = { schema: 'seed-ledger/1', rules: { heldoutMinSeed: 8001 }, ranges: [],
    purposes: { 'need-example': { split: 'dev', fresh: false }, 'need-label': { split: 'dev', fresh: false }, 'need-heldout': { split: 'test', fresh: false, heldout: true } } };
  const job = { ...STAGES.jobs.find(j => j.id === 'records-lo'), band: [2] };
  const stages = { ...STAGES, seeds: { ...STAGES.seeds, probe: { seed: 610 } }, jobs: [job] };
  const unit = { job, evalRole: 'trainEval', arms: ['direct-H'], probeArms: ['direct-H'] };
  const p = await LR.planJob(stages, unit, { ledger, probe: true });
  assert.equal(p.probeTask.taskKey, 'records:dev:d2:s610');
  assert.deepEqual(p.replacements, [{ from: 610, to: 622, difficulty: 2, why: 'probe collision' }]);
  assert.ok(p.evalTasks.every(x => x.taskHash !== p.probeTask.taskHash)); assert.equal(p.evalTasks.length, 12);
  assert.ok(p.exampleHashes.includes(p.probeTask.taskHash));
  // The preregistered probe (seed 601 at the band median) on a real job: its hash is in exampleHashes too.
  const real = STAGES.jobs.find(j => j.id === 'records-hi');
  const q = await LR.planJob(STAGES, { job: real, evalRole: 'trainEval', arms: ['direct-H'], probeArms: ['direct-H'] }, { probe: true });
  assert.ok(q.exampleHashes.includes(q.probeTask.taskHash)); assert.deepEqual(q.replacements, []);
});

// ------------------------------------------------------------------------------- minor: jobs sharing an evaluation task
test('minor: two jobs of a stage that share an evaluation task are refused before anything is spent (TASK_SHARED), also across --jobs runs and stages on one work root', async t => {
  const dir = tmp(t);
  const twin = { ...STAGES.jobs.find(j => j.id === 'records-lo'), id: 'records-lo-b' };
  const runs = [{ job: 'records-lo', arms: ['direct-H'], seedRoles: ['trainEval'] }, { job: 'records-lo-b', arms: ['direct-H'], seedRoles: ['trainEval'] }];
  const file = spec(dir, { runs, jobs: ['records-lo'], extraJobs: [twin] });
  const base = { stageId: 'NL-T', specFile: file, dry: true, racing: false, log: quiet };
  await assert.rejects(LR.labelRun({ ...base, workRoot: path.join(dir, 'w1'), out: path.join(dir, 'o1') }), e => e.code === 'TASK_SHARED' && e.shared.length === 12 && e.shared[0].jobs.join() === 'records-lo,records-lo-b');
  assert.ok(!existsSync(path.join(dir, 'w1', 'results.jsonl')) && !existsSync(path.join(dir, 'w1', LR.SPEND_FILE)), 'refused before any trial');
  // Filtered runs: the first job runs; the second is refused from plan.json.
  const r = await LR.labelRun({ ...base, jobs: ['records-lo'], workRoot: path.join(dir, 'w2'), out: path.join(dir, 'o2') });
  assert.equal(r.totals.rows, 24);
  await assert.rejects(LR.labelRun({ ...base, jobs: ['records-lo-b'], workRoot: path.join(dir, 'w2'), out: path.join(dir, 'o2') }), e => e.code === 'TASK_SHARED');
  assert.equal(readJsonl(path.join(dir, 'w2', 'results.jsonl')).length, 24, 'no row of the second job was written (or lost)');
  // Another stage on the same work root: the runner would take its trials as done; refused at run time.
  const fileU = spec(dir, { runs: [runs[0]], stageId: 'NL-U', name: 'spec-u.json' });
  await assert.rejects(LR.labelRun({ ...base, stageId: 'NL-U', specFile: fileU, workRoot: path.join(dir, 'w2'), out: path.join(dir, 'o3') }), e => e.code === 'TASK_SHARED' && /NL-T\.records-lo/.test(e.message));
  assert.deepEqual(LR.sharedTaskKeys([{ job: 'a', tasks: ['x', 'y'] }, { job: 'b', tasks: ['y', 'z'] }]), [{ taskKey: 'y', jobs: ['a', 'b'] }]);
});

// ---------------------------------------------------------------------------- minor: per-mode summary as needTable scores
test('minor: the report\'s per-mode counts include failed and voided lineages as needTable scores them (no inflated pass rate)', async t => {
  const tasks = Array.from({ length: 12 }, (_, i) => `t${String(i).padStart(2, '0')}`);
  const rows = [];
  for (const k of [2, 3]) for (const [i, task] of tasks.entries()) rows.push({ job: 'j', mode: 'construct-H', arm: `construct-H#${k}`, task, rep: k - 1, lineage: k, pass: i % 2 === 0, delivered: true, schemaValid: true, usdRepriced: 0.01, usdImputed: 0, armHash: `c${k}` });
  for (const [i, task] of tasks.entries()) rows.push({ job: 'j', mode: 'direct-H', task, rep: 0, lineage: null, pass: i < 9, delivered: true, schemaValid: true, usdRepriced: 0.01, usdImputed: 0, armHash: 'd' });
  const builds = [{ job: 'j', mode: 'construct-H', rep: 0, lineage: 1, failed: true, usdRepriced: 0.02, usdImputed: 0 }, { job: 'j', mode: 'construct-H', rep: 1, lineage: 2, failed: false, usdRepriced: 0.02, usdImputed: 0 },
    { job: 'j', mode: 'construct-H', rep: 2, lineage: 3, failed: false, void: 'run sessions: nestedModelAttempts=1, hiddenPathAttempts=0', usdRepriced: 0.02, usdImputed: 0 }];
  const s = LR.modeSummary({ rows: rows.filter(r => r.mode === 'construct-H'), builds, tasks: 12 });
  assert.deepEqual([s.rows, s.pass, s.rowsRecorded, s.synthesizedFailures, s.failedLineages, s.voidedLineages, s.reps], [36, 6, 24, 12, 1, 1, 3]);
  // The same count as needTable's scored cell.
  const table = needTable(rows, builds.map(b => ({ ...b, usd: b.usdRepriced })));
  const cell = [...table.cell('j', 'construct-H').byTask.values()].flatMap(m => [...m.values()]);
  assert.equal(cell.length, s.rows); assert.equal(cell.filter(x => x.pass).length, s.pass);
  assert.deepEqual([LR.modeSummary({ rows: rows.filter(r => r.mode === 'direct-H'), tasks: 12 }).rows, LR.modeSummary({ rows: rows.filter(r => r.mode === 'direct-H'), tasks: 12 }).pass], [12, 9]);
  // End to end: lineage 1 failed; a mode whose every build failed is listed (it was missing from the report before).
  const dir = tmp(t), out = path.join(dir, 'out');
  const rep = await LR.labelRun({ stageId: 'NL-T', specFile: spec(dir, { runs: [{ job: 'records-lo', arms: ['construct-H'], seedRoles: ['examples', 'trainEval'] }] }), workRoot: path.join(dir, 'live'), out, dry: true, racing: false, log: quiet,
    stubForce: { builder: { 'construct-H-L1': 'fail', 'construct-H-L2': 'ok', 'construct-H-L3': 'ok' } } });
  const m = rep.jobs[0].modes['construct-H'];
  assert.equal(m.rows, 36); assert.equal(m.failedLineages, 1); assert.equal(m.synthesizedFailures, 12); assert.equal(m.rowsRecorded, 24);
  const t2 = needTable(readJsonl(path.join(out, 'rows.jsonl')), readJsonl(path.join(out, 'builds.final.jsonl')).map(b => ({ ...b, usd: b.usdRepriced })));
  const c2 = [...t2.cell('records-lo', 'construct-H').byTask.values()].flatMap(x => [...x.values()]);
  assert.equal(m.pass, c2.filter(x => x.pass).length);
  assert.match(readFileSync(path.join(out, 'report.txt'), 'utf8'), /construct-H +\d+\/36 +pass .*\(recorded 24; lineages failed 1, voided 0: 12 failures synthesised\)/);
  const d2 = tmp(t);
  const all = await LR.labelRun({ stageId: 'NL-T', specFile: spec(d2, { runs: [{ job: 'records-lo', arms: ['construct-H'], seedRoles: ['examples', 'trainEval'] }] }), workRoot: path.join(d2, 'live'), out: path.join(d2, 'out'), dry: true, racing: false, log: quiet,
    stubForce: { builder: { 'construct-H-L': 'fail' } } });
  assert.deepEqual([all.jobs[0].modes['construct-H'].rows, all.jobs[0].modes['construct-H'].pass, all.jobs[0].modes['construct-H'].failedLineages], [36, 0, 3]);
});

// ------------------------------------------------------------------------------------ minor: racing on unlabelled cells
test('minor: racing gives no mode top-up to a job whose headline cell is unlabelled, and logs why (racing.jsonl, report)', async t => {
  const mk = imputed => {
    const rows = [], tasks = Array.from({ length: 8 }, (_, i) => `t${i}`);
    tasks.forEach((task, i) => { for (const rep of [0, 1]) rows.push({ job: 'j', mode: 'direct-H', task, rep, pass: (i + rep) % 3 !== 0, delivered: true, schemaValid: true, usdRepriced: imputed ? 0.001 : 0.002, usdImputed: imputed ? 0.001 : 0, armHash: 'd' }); });
    tasks.forEach((task, i) => { for (const k of [1, 2, 3]) rows.push({ job: 'j', mode: 'construct-H', arm: `construct-H#${k}`, task, rep: k - 1, lineage: k, pass: (i + k) % 3 !== 1, delivered: true, schemaValid: true, usdRepriced: 0.002, usdImputed: 0, armHash: `c${k}` }); });
    return needTable(rows, [1, 2, 3].map(k => ({ job: 'j', mode: 'construct-H', rep: k - 1, lineage: k, usd: 0.01, usdRepriced: 0.01, failed: false })));
  };
  const args = { job: 'j', stages: { ...STAGES, reps: { labelBootstrap: 400 } }, current: { 'direct-H': 2, 'construct-H': 3 }, next: { 'construct-H': 4 }, labelModes: ['direct-H', 'construct-H'] };
  const labelled = LR.racingPlan({ ...args, table: mk(false) }), unlabelled = LR.racingPlan({ ...args, table: mk(true) });
  // The same P(best class) under 0.8 in both (the imputed dollars are a tenth of a cent): only the unlabelled one is left alone.
  assert.ok(labelled.pBest['no-workflow'] < 0.8 && labelled.pBest.workflow < 0.8); assert.deepEqual(unlabelled.pBest, labelled.pBest);
  assert.equal(labelled.unlabelled, null); assert.deepEqual(labelled.add, { 'direct-H': 3 });
  assert.match(unlabelled.unlabelled, /imputed dollars over 0\.3 in direct-H/); assert.deepEqual(unlabelled.add, {});
  // The switch the preregistration would have to name: top-ups to dilute imputed dollars.
  assert.deepEqual(LR.racingPlan({ ...args, stages: { ...args.stages, grid: { ...STAGES.grid, racingUnlabelled: 'top-up' } }, table: mk(true) }).add, { 'direct-H': 3 });
  // End to end: every racing record carries `unlabelled`; a job unlabelled by a killed agent-H session gets no mode top-up.
  const dir = tmp(t), live = path.join(dir, 'live'), out = path.join(dir, 'out');
  const rep = await LR.labelRun({ stageId: 'NL-T', specFile: spec(dir, { runs: [{ job: 'wbed-r0', arms: ['direct-H', 'agent-H'], seedRoles: ['trainEval'] }] }), workRoot: live, out, dry: true, racing: true, log: quiet,
    stubForce: { agent: { 'agent-H/wbed-r0_dev_d2_s610_t0': 'killed', 'agent-H/wbed-r0_dev_d2_s611_t0': 'killed', 'agent-H/wbed-r0_dev_d2_s612_t0': 'killed' } } });
  const racing = readJsonl(path.join(live, 'racing.jsonl'));
  assert.ok(racing.length >= 1 && racing.every(r => 'unlabelled' in r));
  for (const r of racing.filter(x => x.unlabelled)) assert.deepEqual(r.add, {});
  if (racing.some(x => x.unlabelled)) assert.match(readFileSync(path.join(out, 'report.txt'), 'utf8'), /UNLABELLED \(.+\): no mode top-up/);
  assert.match(rep.rules.racing, /unlabelled/);
});
