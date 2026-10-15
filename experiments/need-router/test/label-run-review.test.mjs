// label-run.mjs: regression tests for the adversarial review of the label harness (2026-10-15). One test (or more) per
// fixed defect: the hidden-path scan, K4 per arm, the cap meter on resume, report totals, procedure-writer faults, paid-run
// checks, resume version stamps, K2 before spend, self-check infrastructure faults, deployable gaps, filters, reserve seeds
// across stages, --concurrency. $0: stub ports only (no model, no claude binary); work roots are temporary directories.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as LR from '../label-run.mjs';
import { STAGES_FILE, PREREG_FILE, armSha } from '../prereg-check.mjs';
import { b0Agent, outsidePaths, mentionedPaths } from '../../lib/arms/b0-agent.mjs';
import { construct, accessedOutsidePaths, taskHostPaths, withoutHeredocs } from '../../c0/construct.mjs';
import { loadHiddenPathDetector } from '../../kev-data/ports/crossfamily-baselines.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SCRIPT = path.join(REPO, 'experiments/need-router/label-run.mjs');
const tmp = t => { const d = mkdtempSync(path.join(tmpdir(), 'label-run-review-')); t.after(() => rmSync(d, { recursive: true, force: true })); return d; };
const readJsonl = f => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map(JSON.parse) : []);
const STAGES = JSON.parse(readFileSync(STAGES_FILE, 'utf8'));
const FIVE = ['direct-H', 'agent-H', 'agent-O', 'agent-H+proc', 'construct-H'];
const quiet = () => {};
const sha256 = s => createHash('sha256').update(s).digest('hex');
function spec(dir, { runs, capUsd = 400, approved = false, status = 'draft', seeds = STAGES.seeds, jobs = ['records-lo', 'wbed-r0'], arms = STAGES.arms, name = 'spec.json' } = {}) {
  const doc = { ...STAGES, status, seeds, arms, jobs: STAGES.jobs.filter(j => jobs.includes(j.id)), stages: [{ id: 'NL-T', grade: 'development', estUsd: 1, capUsd, approved, runs }] };
  const file = path.join(dir, name);
  writeFileSync(file, JSON.stringify(doc, null, 1));
  return file;
}
const dry = (dir, runs, extra = {}) => LR.labelRun({ stageId: 'NL-T', specFile: spec(dir, { runs, ...(extra.spec ?? {}) }), workRoot: path.join(dir, 'live'), out: path.join(dir, 'out'),
  dry: true, racing: false, log: quiet, ...Object.fromEntries(Object.entries(extra).filter(([k]) => k !== 'spec')) });

// ------------------------------------------------------------------------------------------ major: hidden-path scan
test('hidden-path scan: only accessed paths count (file-tool paths, Bash without heredoc bodies); Write/Edit content, Grep patterns and task-stated paths never do', () => {
  const data = [
    { name: 'Write', input: { file_path: 'answer.json', content: '{"root_cause_volume":"/var/lib/postgresql/data"}' } },
    { name: 'Edit', input: { file_path: 'answer.json', old_string: '/srv/objects', new_string: '/var/lib/backup' } },
    { name: 'Grep', input: { pattern: '/var/log', path: 'files' } },
    { name: 'Bash', input: { command: "cat > notes.md <<'EOF'\ncache in /opt/hostedtoolcache\nEOF" } },
    { name: 'Bash', input: { command: 'ls files/var/log https://example.com/var/x' } },
  ];
  assert.deepEqual(outsidePaths(data, ['/w']), { attempts: 0, paths: [], ignored: [] }, 'data that names host paths is not an access');
  assert.equal(mentionedPaths(data, ['/w']).attempts, 5, 'the older scan of every string flags them all (kept for review by hand, never voids)');
  const access = [
    { name: 'Read', input: { file_path: '/etc/passwd' } }, { name: 'Glob', input: { pattern: '/home/**/oracle*.mjs' } }, { name: 'Grep', input: { pattern: 'x', path: '/opt/corpus' } },
    { name: 'Bash', input: { command: 'cat ../../../../etc/shadow' } }, { name: 'LS', input: { path: '/root' } }, { name: 'Write', input: { file_path: '/var/tmp/other/x', content: 'y' } },
    { name: 'Bash', input: { command: "cat > a.txt <<EOF\nok\nEOF\ncat /home/user/workflow-foundry/beds/records/score.mjs" } },
  ];
  const r = outsidePaths(access, ['/w']);
  assert.equal(r.attempts, access.length, JSON.stringify(r.paths));
  // A path the task states is not an attempt; the same command on another path is.
  const ignore = taskHostPaths([{ prompt: 'The data volume is /var/lib/postgresql/data.', inputs: { logs: ['/var/log/syslog: disk full'] } }]);
  assert.deepEqual([...ignore].sort(), ['/var/lib/postgresql/data', '/var/log/syslog']);
  assert.equal(outsidePaths([{ name: 'Bash', input: { command: 'grep -c full /var/log/syslog' } }], ['/w'], { ignore }).attempts, 0);
  assert.equal(outsidePaths([{ name: 'Bash', input: { command: 'cat /var/log/auth.log' } }], ['/w'], { ignore }).attempts, 1);
  assert.equal(withoutHeredocs("cat > a <<-'X'\n\t/etc/x\n\tX\nls /opt/y"), "cat > a <<X\nls /opt/y");
  // the workdir itself is allowed (and only it: a sibling with the same prefix is not)
  assert.equal(accessedOutsidePaths([{ name: 'Read', input: { file_path: '/var/tmp/w/answer.json' } }, { name: 'Read', input: { file_path: '/var/tmp/w2/x' } }], ['/var/tmp/w']).attempts, 1);
});

test('hidden-path scan over the incident and ownerci example tasks (child process, counts only): honest answers that quote task paths are never attempts', () => {
  // Held-out families are generated only inside a child process that prints counts (PREREG §13 D4 discipline); every seed is
  // checked against the ledger first. The simulated session writes, greps and heredocs every host path the task states.
  const child = `
    import { readFileSync } from 'node:fs';
    const R = ${JSON.stringify(REPO)};
    const { planTasks, STAGES_FILE, ROLES } = await import(R + '/experiments/need-router/prereg-check.mjs');
    const { loadFamily, solverView } = await import(R + '/experiments/lib/beds.mjs');
    const { accessedOutsidePaths, taskHostPaths } = await import(R + '/experiments/c0/construct.mjs');
    const { mentionedPaths } = await import(R + '/experiments/lib/arms/b0-agent.mjs');
    const { loadLedger, seedRefusals } = await import(R + '/experiments/jit/seeds.mjs');
    const stages = JSON.parse(readFileSync(STAGES_FILE, 'utf8')), ledger = loadLedger(), out = {};
    for (const jobId of ['incident', 'ownerci']) {
      const job = stages.jobs.find(j => j.id === jobId), fam = await loadFamily(job.family);
      const o = { tasks: 0, refused: 0, withPaths: 0, broad: 0, narrow: 0, control: 0 };
      for (const t of planTasks(stages, jobId, 'examples')) {
        if (seedRefusals(ledger, { bed: job.ledgerBed ?? job.family, split: t.split, seed: t.seed, purpose: stages.seeds.purposes[ROLES.examples.purposeKey] }).length) { o.refused++; continue; }
        const task = fam.generate({ seed: t.seed, split: t.split, difficulty: t.difficulty }), view = solverView(task), ignore = taskHostPaths([view.prompt, view.files]), ps = [...ignore];
        o.tasks++; if (ps.length) o.withPaths++;
        const uses = [{ name: 'Write', input: { file_path: 'answer.json', content: JSON.stringify({ paths: ps }) } }, ...ps.map(p => ({ name: 'Grep', input: { pattern: p, path: 'files' } })),
          ...ps.map(p => ({ name: 'Bash', input: { command: "grep -rn '" + p + "' files/ inputs.json | head" } })), { name: 'Bash', input: { command: "cat > answer.json <<'EOF'\\n" + JSON.stringify({ paths: ps }) + "\\nEOF" } }];
        o.broad += mentionedPaths(uses, ['/w']).attempts;
        o.narrow += accessedOutsidePaths(uses, ['/w'], { ignore }).attempts;
        o.control += accessedOutsidePaths([...uses, { name: 'Read', input: { file_path: '/home/user/workflow-foundry/beds/' + job.family + '/score.mjs' } }], ['/w'], { ignore }).attempts;
      }
      out[jobId] = o;
    }
    process.stdout.write(JSON.stringify(out) + '\\n');`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', child], { cwd: REPO, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const res = JSON.parse(r.stdout.trim().split('\n').pop());
  for (const [job, o] of Object.entries(res)) {
    assert.equal(o.refused, 0, `${job}: example seeds allowed by the ledger`);
    assert.ok(o.tasks === 9 && o.withPaths >= 5, `${job}: the example tasks state host paths (${o.withPaths}/9): the test is not vacuous`);
    assert.ok(o.broad > 0, `${job}: the old scan voided these sessions`);
    assert.equal(o.narrow, 0, `${job}: the accessed-path scan finds no attempt`);
    assert.equal(o.control, o.tasks, `${job}: reading the repository is still one attempt per session`);
  }
});

function fakeSession(calls, { answer = null, toolUses = [], files: write = {} } = {}) {
  return async args => {
    calls.push(args);
    mkdirSync(args.workdir, { recursive: true });
    for (const [rel, c] of Object.entries(args.files ?? {})) { mkdirSync(path.dirname(path.join(args.workdir, rel)), { recursive: true }); writeFileSync(path.join(args.workdir, rel), c); }
    if (answer !== null) writeFileSync(path.join(args.workdir, 'answer.json'), JSON.stringify(answer));
    for (const [rel, c] of Object.entries(write)) writeFileSync(path.join(args.workdir, rel), c);
    return { ok: true, error: null, costUsd: 0.01, costUnknown: false, costUpperUsd: 0.01, streamUsage: null, turns: 2, usage: null, toolUses, sessionId: 's', durationMs: 5 };
  };
}

test('hidden-path scan in b0Agent and construct(): task paths in answers are not attempts; repository reads are; C0 fields unchanged', async t => {
  const dir = tmp(t);
  const task = { prompt: 'Which volume filled up? The database keeps its files in /var/lib/postgresql/data.', inputs: { log: '/srv/objects: 99% used' } };
  const honest = [{ name: 'Write', input: { file_path: 'answer.json', content: '{"v":"/var/lib/postgresql/data"}' } }, { name: 'Bash', input: { command: 'grep -n /srv/objects inputs.json' } },
    { name: 'Grep', input: { pattern: '/var/log', path: '.' } }];
  const r1 = await b0Agent({ id: 'agent-H', model: 'claude-haiku-5-5', executor: fakeSession([], { answer: { v: 1 }, toolUses: honest }) }).run({ task, familyId: 'records', outputSchema: { type: 'object' }, workdir: path.join(dir, 'a'), state: {} });
  assert.equal(r1.meta.hiddenPathAttempts, 0); assert.ok(r1.meta.pathMentions >= 2, 'mentions are recorded for review'); assert.ok(r1.meta.taskPathsIgnored >= 1);
  const r2 = await b0Agent({ id: 'agent-H', model: 'claude-haiku-5-5', executor: fakeSession([], { answer: { v: 1 }, toolUses: [...honest, { name: 'Read', input: { file_path: '/home/user/workflow-foundry/beds/records/score.mjs' } }] }) })
    .run({ task, familyId: 'records', outputSchema: { type: 'object' }, workdir: path.join(dir, 'b'), state: {} });
  assert.equal(r2.meta.hiddenPathAttempts, 1); assert.deepEqual(r2.meta.outsidePaths, ['/home/user/workflow-foundry/beds/records/score.mjs']);
  // construct(): hiddenPathAccesses is the voiding scan; hiddenPathAttempts / outsidePaths keep the C0 text scan.
  const port = LR.stubPorts({ tasks: [], models: ['claude-haiku-5-5'] }).model;
  const res = await construct({ arm: 'B1', familyId: 'records', probeSeeds: [{ seed: 604, difficulty: 2 }], builderModel: 'claude-haiku-5-5', builderBudgetUsd: 3, constructionModelUsd: 1.5, perTaskUsd: 1,
    minutes: 30, scoreChecks: 0, modelPort: port, models: ['claude-haiku-5-5'], kitBase: path.join(dir, 'kit'), workRoot: dir, label: 'L1', selfCheck: true,
    executor: fakeSession([], { files: { 'solve.mjs': 'x', 'check.mjs': 'y' }, toolUses: [{ name: 'Write', input: { file_path: 'solve.mjs', content: "const LOG = '/var/log/app.log';" } },
      { name: 'Grep', input: { pattern: '/srv/objects' } }, { name: 'Bash', input: { command: 'cat /etc/passwd' } }] }) });
  assert.equal(res.record.hiddenPathAccesses, 1); assert.deepEqual(res.record.accessedOutsidePaths, ['/etc/passwd']);
  assert.equal(res.record.hiddenPathAttempts, 3, 'the C0 text scan is unchanged (it reads every string)');
  assert.doesNotThrow(() => loadHiddenPathDetector(), 'the kev-data baseline still finds construct()\'s `outside` closure');
});

test('label-run: an agent draw quoting task paths in its answer is not voided; one that reads the repository is', async t => {
  const dir = tmp(t);
  await dry(dir, [{ job: 'records-lo', arms: ['agent-H'], seedRoles: ['trainEval'] }], { stubForce: { agent: { 'agent-H/records_dev_d1_s610_t0': 'mention', 'agent-H/records_dev_d1_s611_t0': 'hidden' } } });
  const rows = readJsonl(path.join(dir, 'out', 'rows.jsonl')), at = s => rows.find(r => r.task === `records:dev:d1:s${s}` && r.rep === 0);
  assert.equal(at(610).void, null); assert.equal(at(610).pass, true, 'the honest answer keeps its oracle verdict');
  assert.equal(at(611).void, 'hiddenPathAttempts=1'); assert.equal(at(611).pass, false);
  const results = readJsonl(path.join(dir, 'out', 'results.jsonl'));
  assert.ok(results.find(r => r.taskKey === 'records:dev:d1:s610' && r.trial === 0).meta.pathMentions >= 2);
});

// --------------------------------------------------------------------------------- major: K4 per arm, faulted dollars
test('K4: an arm with more than 25% environment faults is invalid, also after its faulted trials were retried; faulted dollars are in the totals', async t => {
  const dir = tmp(t), out = path.join(dir, 'out');
  const runs = [{ job: 'records-lo', arms: ['direct-H', 'agent-H'], seedRoles: ['trainEval'] }];
  const force = { call: Object.fromEntries([617, 618, 619, 620, 621].map(s => [`direct-H:records:dev:d2:s${s}:`, 'ratelimit'])) };
  const rep = await dry(dir, runs, { stubForce: force });
  assert.equal(rep.stopped, null, 'the pooled stall rule (all arms of one call) does not trip: 10 of 58 attempts');
  const dh = rep.armFaults.find(x => x.job === 'records-lo' && x.mode === 'direct-H'), ah = rep.armFaults.find(x => x.mode === 'agent-H');
  assert.deepEqual([dh.trialAttempts, dh.trialFaults, dh.invalid], [24, 10, true]); assert.equal(ah.invalid, false);
  assert.deepEqual(rep.validity.invalidArms, ['records-lo/direct-H']);
  assert.deepEqual(readJsonl(path.join(out, 'arm-faults.jsonl')).filter(x => x.invalid).map(x => `${x.job}/${x.mode}`), ['records-lo/direct-H'], 'the fault table is copied out for evaluate.mjs');
  assert.equal(readJsonl(path.join(out, 'rows.jsonl')).some(r => r.error === 'MODEL_RATE_LIMIT'), false, 'rows never carry the faults (survivorship): hence the table');
  // Totals: the faulted attempts' dollars are part of the charge (they spent tokens).
  const T = rep.totals;
  assert.ok(T.usdFaultedTrials.usdRepriced > 0);
  const parts = ['usdTaskRows', 'usdBuilds', 'usdProbes', 'usdFaultedTrials', 'usdConstructionFaults', 'usdUnrecorded'];
  assert.equal(T.usdCharged, Math.round(parts.reduce((a, k) => a + T[k].usdRepriced + T[k].usdImputed, 0) * 1e6) / 1e6);
  assert.equal(rep.jobs[0].usdCharged, T.usdCharged, 'K7 per job includes the faulted dollars');
  // Resume (the environment is back): the faulted trials are retried and recorded; the arm stays invalid (10 of 34).
  const rep2 = await LR.labelRun({ stageId: 'NL-T', specFile: path.join(dir, 'spec.json'), workRoot: path.join(dir, 'live'), out, dry: true, racing: false, log: quiet });
  const dh2 = rep2.armFaults.find(x => x.mode === 'direct-H');
  assert.deepEqual([dh2.trialAttempts, dh2.trialFaults, dh2.invalid], [34, 10, true]);
  // A retried row is charged its own call only (calls.jsonl holds both attempts under one run id).
  const book = readJsonl(path.join(out, 'calls.jsonl')).filter(c => c.runId === 'direct-H:records:dev:d2:s617:t0');
  assert.equal(book.length, 2);
  const row = readJsonl(path.join(out, 'rows.jsonl')).find(r => r.arm === 'direct-H' && r.task === 'records:dev:d2:s617' && r.rep === 0);
  assert.equal(row.usdRepriced, Math.round(LR.priceUsage(STAGES.priceTable, 'claude-haiku-5-5', book[1].usage) * 1e6) / 1e6);
});

// ---------------------------------------------------------------------------------- major: the cap meter on resume (K5)
test('K5: a resume starts from the spend ledger (timeouts at their bound), refuses a new work root over the same --out, and carries a legacy work root\'s spend', async t => {
  const dir = tmp(t), out = path.join(dir, 'out'), live = path.join(dir, 'live');
  const file = spec(dir, { runs: [{ job: 'wbed-r0', arms: ['direct-H', 'agent-H'], seedRoles: ['trainEval'] }], capUsd: 7 });
  const run = (extra = {}) => LR.labelRun({ stageId: 'NL-T', specFile: file, workRoot: live, out, dry: true, racing: false, concurrency: 1, log: quiet, ...extra });
  // Run 1: direct-H only; four timed-out calls, each on the meter at its $1 bound (reported $0).
  const r1 = await run({ arms: ['direct-H'], stubForce: { call: { 'direct-H:wbed-r0:dev:d2:s610:': 'timeout', 'direct-H:wbed-r0:dev:d2:s611:': 'timeout' } } });
  const timeouts = readJsonl(path.join(live, 'results.jsonl')).filter(r => r.error?.code === 'MODEL_TIMEOUT').length;
  assert.ok(timeouts >= 4 && r1.totals.spend.meterUsd >= timeouts && r1.totals.spend.meterUsd < timeouts + 0.1, `${timeouts} timeouts, meter ${r1.totals.spend.meterUsd}`);
  assert.ok(readJsonl(path.join(live, 'results.jsonl')).reduce((a, r) => a + r.costUsd, 0) < 0.1, 'the runner records the timeouts at $0');
  assert.equal(readJsonl(path.join(out, 'spend.jsonl')).length, readJsonl(path.join(live, 'spend.jsonl')).length, 'the ledger is in --out too');
  assert.equal(r1.stopped, null, 'run 1 fits under the $7 cap');
  // Run 2 (resume, every arm): the timed-out calls already hold $1 each on the meter (the old meter read them as $0), so no
  // $2 agent-H start fits under the $7 cap.
  const r2 = await run();
  assert.equal(r2.jobs[0].modes['agent-H'], undefined); assert.equal(r2.jobs[0].notRunCap, 24); assert.match(r2.stopped, /^STAGE_CAP/);
  assert.equal(r2.jobs[0].modes['direct-H'].rows, 24); assert.ok(r2.totals.spend.meterUsd <= 7);
  // A new work root over the same --out would restart the meter at $0: refused before anything runs.
  await assert.rejects(LR.labelRun({ stageId: 'NL-T', specFile: file, workRoot: path.join(dir, 'live2'), out, dry: true, racing: false, log: quiet }), e => e.code === 'SPEND_ELSEWHERE');
  assert.equal(existsSync(path.join(dir, 'live2', 'results.jsonl')), false);
  // A work root from before the ledger: its files' spend is carried (timeouts at their bound) and still stops agent-H.
  const d2 = tmp(t), live3 = path.join(d2, 'live'), out3 = path.join(d2, 'out'), f3 = spec(d2, { runs: [{ job: 'wbed-r0', arms: ['direct-H', 'agent-H'], seedRoles: ['trainEval'] }], capUsd: 7 });
  await LR.labelRun({ stageId: 'NL-T', specFile: f3, workRoot: live3, out: out3, dry: true, racing: false, concurrency: 1, log: quiet, arms: ['direct-H'],
    stubForce: { call: { 'direct-H:wbed-r0:dev:d2:s610:': 'timeout', 'direct-H:wbed-r0:dev:d2:s611:': 'timeout' } } });
  unlinkSync(path.join(live3, 'spend.jsonl')); unlinkSync(path.join(out3, 'spend.jsonl'));
  const r3 = await LR.labelRun({ stageId: 'NL-T', specFile: f3, workRoot: live3, out: out3, dry: true, racing: false, concurrency: 1, log: quiet });
  assert.ok(r3.totals.spend.carriedUsd >= 4, `${r3.totals.spend.carriedUsd}`); assert.equal(r3.jobs[0].modes['agent-H'], undefined);
});

// ------------------------------------------------------------------------- major: procedure-writer environment faults
test('agent-H+proc: an environment fault on the writer call is kept aside and retried on resume (K4), not a failed build; a writer timeout costs its $1 bound', async t => {
  const dir = tmp(t), out = path.join(dir, 'out');
  const runs = [{ job: 'records-lo', arms: ['agent-H+proc'], seedRoles: ['examples', 'trainEval'] }];
  const rep = await dry(dir, runs, { stubForce: { writer: { 'agent-H+proc-L1': 'envfault', 'agent-H+proc-L2': 'timeout' } } });
  const cf = readJsonl(path.join(dir, 'live', 'construction-faults.jsonl'));
  assert.deepEqual(cf.map(f => [f.mode, f.lineage, f.factory, f.error.code]), [['agent-H+proc', 1, 'procedureWriter', 'MODEL_RATE_LIMIT']]);
  const builds = readJsonl(path.join(out, 'builds.final.jsonl'));
  assert.deepEqual(builds.map(b => [b.lineage, b.failed, b.error]), [[2, true, 'MODEL_TIMEOUT']], 'no failed L1 build row; the timed-out L2 is a failed build');
  assert.equal(readJsonl(path.join(out, 'rows.jsonl')).filter(r => r.arm === 'agent-H+proc#1').length, 0);
  const pf = rep.armFaults.find(x => x.mode === 'agent-H+proc');
  assert.deepEqual([pf.buildAttempts, pf.buildFaults, pf.invalid], [2, 1, true]);
  const l2 = readJsonl(path.join(out, 'spend.jsonl')).find(e => e.op === 'settle' && e.kind === 'build' && e.lineage === 2);
  assert.equal(l2.charged, 1, 'a timed-out writer call is charged at its $1 bound, never $0');
  // Resume with the environment back: L1 is built and run.
  await LR.labelRun({ stageId: 'NL-T', specFile: path.join(dir, 'spec.json'), workRoot: path.join(dir, 'live'), out, dry: true, racing: false, log: quiet });
  assert.deepEqual(readJsonl(path.join(out, 'builds.final.jsonl')).map(b => b.lineage), [1, 2]);
  assert.equal(readJsonl(path.join(out, 'rows.jsonl')).filter(r => r.arm === 'agent-H+proc#1').length, 12);
});

// ---------------------------------------------------------------------------------------- major: paid-run checks
// The D6 cost-meter gate (meter-gate.mjs) is another check of paidRunChecks; these tests pin it open so they do not read the
// diagnostics file on disk.
const NO_METER_GATE = { meterGate: () => null, meterVerification: () => null };
const cleanStamp = (files = {}) => ({ labelEngine: { stage: 'NL0', commit: 'c0ffee', dirty: 0, files, trees: {}, beds: {}, prereg: {}, ledgerNeed: null, node: process.version }, analysis: { files: {} }, documents: {} });
test('paid runs: the plan, checkStages, arm hashes, the frozen preregistration and a clean engine stamp are checked before anything is spent', async t => {
  const dir = tmp(t);
  const preregText = readFileSync(PREREG_FILE, 'utf8');
  const deps = { stampOf: () => cleanStamp(), frozenSha: () => sha256(preregText), ...NO_METER_GATE };
  const plan = LR.loadPlan({ stageId: 'NL0', stagesFile: STAGES_FILE });
  const { units } = LR.stageUnits(plan.stages, plan.stage);
  const ok = LR.paidRunChecks({ plan, units, prereg: PREREG_FILE, allowDraft: true, deps });
  assert.deepEqual(ok.errors, [], 'the canonical plan passes (with --allow-draft on today\'s draft)');
  assert.deepEqual(ok.deviations.map(d => d.kind), ['allow-draft']);
  // A spec file: its own approved/status fields never suffice; it must be listed in the preregistration.
  const sp = LR.loadPlan({ stageId: 'NL-T', specFile: spec(dir, { runs: [{ job: 'wbed-r0', arms: ['direct-H'], seedRoles: ['trainEval'] }], approved: true, status: 'frozen' }) });
  const e1 = LR.paidRunChecks({ plan: sp, units: LR.stageUnits(sp.stages, sp.stage).units, prereg: PREREG_FILE, deps }).errors;
  assert.ok(e1.some(e => /neither the canonical stages.json nor a spec/.test(e)), e1.join('\n'));
  assert.ok(e1.some(e => /^prereg-check: /.test(e)), 'checkStages runs on the spec (no Freeze stage, totals, held-out rules...)');
  // An edited arm whose settingsSha was not recomputed.
  const edited = { ...plan, stages: { ...plan.stages, arms: { ...plan.stages.arms, 'direct-H': { ...plan.stages.arms['direct-H'], maxTokens: 8000 } } } };
  assert.ok(LR.paidRunChecks({ plan: edited, units, prereg: PREREG_FILE, allowDraft: true, deps }).errors.some(e => /arm direct-H: settingsSha .* != armSha/.test(e)));
  // The preregistration must equal its frozen text; the engine stamp must be clean; filters need a deviation.
  assert.ok(LR.paidRunChecks({ plan, units, prereg: PREREG_FILE, allowDraft: true, deps: { ...deps, frozenSha: () => 'f'.repeat(64) } }).errors.some(e => /differs from its frozen text/.test(e)));
  assert.ok(LR.paidRunChecks({ plan, units, prereg: null, allowDraft: true, deps }).errors.some(e => /needs --prereg/.test(e)));
  assert.ok(LR.paidRunChecks({ plan, units, prereg: PREREG_FILE, allowDraft: true, deps: { ...deps, stampOf: () => ({ labelEngine: { commit: 'x', dirty: 3 } }) } }).errors.some(e => /3 uncommitted change/.test(e)));
  assert.ok(LR.paidRunChecks({ plan, units, prereg: PREREG_FILE, allowDraft: true, filters: { jobs: ['wbed-r0'], arms: null }, deps }).errors.some(e => /--jobs wbed-r0 .*--deviation/.test(e)));
  assert.ok(LR.paidRunChecks({ plan, units, prereg: PREREG_FILE, deps }).errors.some(e => /not frozen/.test(e)), 'a draft plan without --allow-draft');
  // labelRun refuses before anything is written.
  await assert.rejects(LR.labelRun({ stageId: 'NL-T', specFile: spec(dir, { runs: [{ job: 'wbed-r0', arms: ['direct-H'], seedRoles: ['trainEval'] }], approved: true, status: 'frozen', name: 's2.json' }),
    prereg: PREREG_FILE, workRoot: path.join(dir, 'w'), out: path.join(dir, 'o'), ports: 'stub', paidDeps: deps, log: quiet }), e => e.code === 'PAID_RUN_REFUSED');
  assert.equal(existsSync(path.join(dir, 'w')), false);
});

test('paid runs: --allow-draft and --jobs/--arms are recorded in report.deviations; STAMP.json is written before the first call and a changed engine refuses the resume', async t => {
  const dir = tmp(t), out = path.join(dir, 'out'), live = path.join(dir, 'live');
  const preregText = readFileSync(PREREG_FILE, 'utf8');
  const deps = { stampOf: () => cleanStamp({ 'experiments/need-router/label-run.mjs': 'a' }), frozenSha: () => sha256(preregText), ...NO_METER_GATE };
  const opts = { stageId: 'NL0', stagesFile: STAGES_FILE, prereg: PREREG_FILE, workRoot: live, out, ports: 'stub', allowDraft: true, jobs: ['wbed-r0'], arms: ['direct-H'], racing: false,
    enforceGates: false, log: quiet, paidDeps: deps };
  await assert.rejects(LR.labelRun(opts), e => e.code === 'PAID_RUN_REFUSED' && /--deviation/.test(e.message), 'filters on a paid run need a recorded deviation');
  const rep = await LR.labelRun({ ...opts, deviation: 'K2 control only (test)' });
  assert.equal(rep.dry, false); assert.equal(rep.ports, 'stub');
  assert.deepEqual(rep.deviations.map(d => d.kind), ['allow-draft', 'filter']);
  assert.deepEqual(rep.deviations[1].jobs, ['wbed-r0']);
  assert.ok(rep.skipped.some(s => /filtered by --jobs\/--arms/.test(s.reason)), 'filtered jobs and arms are listed');
  assert.match(readFileSync(path.join(out, 'report.txt'), 'utf8'), /DEVIATION \(allow-draft\)/);
  assert.ok(existsSync(path.join(out, 'STAMP.json'))); assert.ok(rep.engine.stampSha);
  await assert.rejects(LR.labelRun({ ...opts, deviation: 'K2 control only (test)', paidDeps: { ...deps, stampOf: () => cleanStamp({ 'experiments/need-router/label-run.mjs': 'b' }) } }), e => e.code === 'ENGINE_CHANGED');
});

// ------------------------------------------------------------------------------------- major: resume version stamps
test('resume: build, probe and racing records carry a stamp; a resume after a build setting changed is refused', async t => {
  const dir = tmp(t);
  const runs = [{ job: 'records-lo', arms: ['construct-H'], seedRoles: ['examples', 'trainEval'] }, { job: 'records-lo', arms: ['direct-H'], seedRoles: ['probe'] }];
  await dry(dir, runs, { stubForce: { builder: { 'construct-H-L': 'ok' } } });
  const b = readJsonl(path.join(dir, 'live', 'builds.jsonl'))[0];
  assert.match(b.stamp.stageSha, /^[0-9a-f]{16}$/); assert.equal(b.stamp.settingsSha, armSha(STAGES.arms['construct-H'])); assert.equal(b.stamp.priceTable, STAGES.priceTable.id);
  assert.deepEqual(Object.keys(b.stamp.prompts).sort(), Object.keys(LR.promptShas()).sort()); assert.match(b.builderPromptSha256, /^[0-9a-f]{64}$/);
  assert.ok(readJsonl(path.join(dir, 'live', 'probes.jsonl')).every(p => p.stamp?.stageSha === b.stamp.stageSha));
  // The same stage, resumed with one build setting edited (its declared settingsSha left as it was): refused.
  const arms = { ...STAGES.arms, 'construct-H': { ...STAGES.arms['construct-H'], build: { ...STAGES.arms['construct-H'].build, minutes: 31 } } };
  const file = spec(dir, { runs, arms });
  await assert.rejects(LR.labelRun({ stageId: 'NL-T', specFile: file, workRoot: path.join(dir, 'live'), out: path.join(dir, 'out'), dry: true, racing: false, log: quiet }), e => e.code === 'RESUME_MIXES_VERSIONS' && /build records-lo\/construct-H#1/.test(e.message));
  // An edit that does not touch this stage's inputs (a job hypothesis note) leaves the stage sha alone.
  const plan = LR.loadPlan({ stageId: 'NL-T', specFile: spec(dir, { runs, name: 'a.json' }) });
  const jobs2 = plan.stages.jobs.map(j => (j.id === 'records-lo' ? { ...j, hypothesis: { ...j.hypothesis, note: 'revised' } } : j));
  assert.equal(LR.stageSha({ ...plan.stages, jobs: jobs2 }, plan.stage), LR.stageSha(plan.stages, plan.stage));
  assert.notEqual(LR.stageSha({ ...plan.stages, arms }, plan.stage), LR.stageSha(plan.stages, plan.stage));
});

// ------------------------------------------------------------------------------------------- minor: K2 before spend
test('K2: on wbed-r0 direct-H (both draws) runs alone first; below 10/12 no build, no other mode and no other job starts', async t => {
  const dir = tmp(t), out = path.join(dir, 'out');
  const runs = [{ job: 'wbed-r0', arms: FIVE, seedRoles: ['examples', 'trainEval'] }, { job: 'records-lo', arms: ['direct-H'], seedRoles: ['trainEval'] }];
  const rep = await dry(dir, runs, { enforceGates: true, stubForce: { call: { 'direct-H:wbed-r0:': 'wrong' } } });
  assert.match(rep.stopped, /^K2: direct-H on wbed-r0 0\/12, 0\/12/);
  assert.deepEqual([...new Set(readJsonl(path.join(out, 'results.jsonl')).map(r => r.arm))], ['direct-H']);
  assert.equal(readJsonl(path.join(out, 'results.jsonl')).length, 24);
  assert.equal(readJsonl(path.join(dir, 'live', 'builds.jsonl')).length, 0, 'no build was paid for');
  assert.equal(readJsonl(path.join(dir, 'live', 'spend.jsonl')).filter(e => e.op === 'reserve' && e.kind !== 'trial').length, 0);
  // An incomplete control (environment faults on its last task) is not evaluable: nothing else starts either.
  const d2 = tmp(t);
  const r2 = await dry(d2, runs, { enforceGates: true, stubForce: { call: { 'direct-H:wbed-r0:dev:d5:s621:': 'ratelimit', 'direct-H:wbed-r0:': 'right' } } });
  assert.match(r2.stopped, /^K2 not evaluable: .*incomplete \(11\/11, 11\/11/);
  assert.deepEqual([...new Set(readJsonl(path.join(d2, 'out', 'results.jsonl')).map(r => r.arm))], ['direct-H']);
});

// ------------------------------------------------------------------------------- minor: self-check infrastructure
test('self-check infrastructure failures are environment faults (failed trials retried), counted when the oracle passes; lineages without check.mjs are a validity item', async t => {
  const dir = tmp(t), out = path.join(dir, 'out');
  const runs = [{ job: 'records-lo', arms: ['construct-H'], seedRoles: ['examples', 'trainEval'] }];
  const rep = await dry(dir, runs, { stubForce: { builder: { 'construct-H-L1': 'ok', 'construct-H-L2': 'nocheck', 'construct-H-L3': 'ok' }, selfcheck: { 'construct-H#1/': 'sandbox', 'construct-H#3/': 'launch' } } });
  const results = readJsonl(path.join(out, 'results.jsonl')), faults = readJsonl(path.join(out, 'results.faults.jsonl'));
  const l1 = results.filter(r => r.arm === 'construct-H#1' && r.meta?.delivered);
  assert.ok(l1.length > 0 && l1.every(r => r.pass && r.meta.selfVerdict === null && r.meta.selfCheck.error === 'SANDBOX_UNAVAILABLE' && r.meta.errors.SANDBOX_UNAVAILABLE === 1),
    'a recorded L1 answer whose check could not run passed the oracle (the failing ones were kept aside)');
  assert.ok(faults.filter(f => f.arm === 'construct-H#1').every(f => f.metaErrors?.SANDBOX_UNAVAILABLE === 1));
  assert.ok(faults.filter(f => f.arm === 'construct-H#3').every(f => f.metaErrors?.EXECUTOR_LAUNCH === 1), 'a launch failure maps to an environment fault code');
  assert.ok(faults.length > 0, 'some wrong answers met the outage: kept aside, a resume retries them');
  const rows = readJsonl(path.join(out, 'rows.jsonl'));
  assert.ok(rows.filter(r => r.arm === 'construct-H#3' && r.delivered).every(r => r.selfCheckError === 'SELF_CHECK_LAUNCH'));
  assert.equal(rep.validity.selfCheckErrors, rows.filter(r => r.selfCheckError).length); assert.ok(rep.validity.selfCheckErrors > 0);
  assert.deepEqual(rep.validity.noSelfCheck, ['records-lo/construct-H#2']);
  assert.match(readFileSync(path.join(out, 'report.txt'), 'utf8'), /construct-H lineages without check\.mjs: records-lo\/construct-H#2/);
});

// ------------------------------------------------------------------------------------ minor: deployable-check gaps
test('deployableVerdict: a job whose family DESIGN names handed tests for, but which exports no deployableCheck, is reported as a gap', async t => {
  const dir = tmp(t);
  const rep = await dry(dir, [{ job: 'codefix', arms: ['direct-H'], seedRoles: ['trainEval'] }], { spec: { jobs: ['codefix'] } });
  assert.deepEqual(rep.validity.deployableGaps, [{ job: 'codefix', family: 'codefix', named: 'visible tests', used: 'schema validity only' }]);
});

// ------------------------------------------------------------------------------------------------ minor: filters
test('--jobs and --arms: what they drop is listed in report.skipped', async t => {
  const dir = tmp(t);
  const runs = [{ job: 'records-lo', arms: ['direct-H', 'agent-H'], seedRoles: ['trainEval'] }, { job: 'wbed-r0', arms: ['direct-H'], seedRoles: ['trainEval'] }];
  const rep = await dry(dir, runs, { jobs: ['records-lo'], arms: ['direct-H'] });
  assert.deepEqual(rep.skipped.filter(s => /filtered/.test(s.reason)).map(s => [s.where, s.filtered]), [['NL-T.runs[0] (records-lo)', 'arm'], ['NL-T.runs[1] (wbed-r0)', 'job']]);
  assert.match(rep.skipped[0].reason, /^agent-H: filtered by --jobs\/--arms/);
});

// ------------------------------------------------------------------------------------- minor: reserve across stages
test('reserve seeds: a replacement never reuses a seed another stage (its report beside --out) or another job of the stage took', async t => {
  const dir = tmp(t);
  // Example seeds on the evaluation range make collisions on purpose (same seed, same difficulty: the same task).
  const seeds = { ...STAGES.seeds, purposes: { ...STAGES.seeds.purposes, example: 'need-label' }, examples: { from: 610, to: 618 }, exampleSets: { 1: [610, 611, 612], 2: [613, 614, 615], 3: [616, 617, 618] }, probe: { seed: 610 } };
  const plan = LR.loadPlan({ stageId: 'NL-T', specFile: spec(dir, { runs: [{ job: 'records-lo', arms: ['direct-H'], seedRoles: ['trainEval'] }], seeds }) });
  const [unit] = LR.stageUnits(plan.stages, plan.stage).units;
  const ledger = (await import('../../jit/seeds.mjs')).loadLedger();
  const a = await LR.planJob(plan.stages, unit, { ledger });
  assert.deepEqual(a.replacements.map(r => [r.from, r.to]), [[610, 622], [612, 623], [614, 624], [617, 625]]);
  // Another stage's report took 622 and 623 for the same family (records): this stage starts at 624.
  mkdirSync(path.join(dir, 'runs', 'other'), { recursive: true }); mkdirSync(path.join(dir, 'runs', 'self'), { recursive: true });
  writeFileSync(path.join(dir, 'runs', 'other', 'report.json'), JSON.stringify({ schema: LR.REPORT_SCHEMA, stage: 'NL-X', jobs: [{ job: 'j', family: 'records', bed: 'records', replacements: [{ from: 1, to: 622 }, { from: 2, to: 623 }] },
    { job: 'k', family: 'kinetics', bed: 'kinetics', replacements: [{ from: 1, to: 624 }] }] }));
  writeFileSync(path.join(dir, 'runs', 'self', 'report.json'), JSON.stringify({ schema: LR.REPORT_SCHEMA, stage: 'NL-T', jobs: [{ job: 'j', family: 'records', bed: 'records', replacements: [{ from: 1, to: 630 }] }] }));
  const taken = LR.priorReplacementSeeds(path.join(dir, 'runs'), 'NL-T');
  assert.deepEqual([...taken.get('records')].sort(), [622, 623], 'the stage\'s own earlier report does not count against it');
  const b = await LR.planJob(plan.stages, unit, { ledger, taken });
  assert.deepEqual(b.replacements.map(r => r.to), [624, 625, 626, 627]);
  // A second job of the same family in the same stage continues after the first.
  const c = await LR.planJob(plan.stages, unit, { ledger, taken });
  assert.deepEqual(c.replacements.map(r => r.to), [628, 629, 630, 631]);
});

// ---------------------------------------------------------------------------------------------- minor: concurrency
test('--concurrency must be an integer from 1 to 4', async t => {
  const dir = tmp(t), file = spec(dir, { runs: [{ job: 'wbed-r0', arms: ['direct-H'], seedRoles: ['trainEval'] }] });
  for (const c of [0, 5, 2.5, NaN, '2']) await assert.rejects(LR.labelRun({ stageId: 'NL-T', specFile: file, workRoot: path.join(dir, 'w'), dry: true, concurrency: c, log: quiet }), /integer from 1 to 4/, String(c));
  assert.equal(existsSync(path.join(dir, 'w')), false);
  const r = spawnSync(process.execPath, [SCRIPT, '--stage-spec', file, '--stage', 'NL-T', '--dry', '--work-root', path.join(dir, 'w'), '--concurrency', 'abc'], { encoding: 'utf8', cwd: REPO });
  assert.equal(r.status, 2); assert.match(r.stderr, /--concurrency must be an integer from 1 to 4, got abc/);
});

// ------------------------------------------------------------------------ major: evaluate.mjs reads the K4 fault table
test('evaluate.mjs: an arm that label-run\'s fault table marks invalid is an invalid arm of the reading (loadLabels reads arm-faults.jsonl)', async t => {
  const { evaluate, loadLabels } = await import('../evaluate.mjs');
  const { plantedWorld } = await import('./worlds.mjs');
  const W = plantedWorld({ near: 7 });
  const fault = { schema: 'need-arm-faults/1', stage: 'NL-T', job: 'T0-j0', mode: 'agent-H', trialAttempts: 34, trialFaults: 10, buildAttempts: 0, buildFaults: 0, share: 0.294118, buildShare: 0, limit: 0.25, invalid: true };
  const clean = { ...fault, job: 'T0-j1', trialFaults: 1, share: 0.029412, invalid: false };
  const FAST = { reps: 200, bootReps: 0, l2Perms: 0, randomDraws: 100, attacks: false, leak: false };
  const D = evaluate({ ...W, split: 'train', ...FAST, armFaults: [fault, clean, { ...fault, job: 'no-such-job' }] });
  assert.deepEqual(D.validity.invalidArms.filter(x => x.source === 'arm-faults').map(x => `${x.job}/${x.mode}`), ['T0-j0/agent-H'], 'only invalid arms of jobs in the reading');
  // loadLabels: the stage directory's arm-faults.jsonl (the trainOnly read keeps TRAIN jobs only).
  const dir = tmp(t), st = path.join(dir, 'nl-t');
  mkdirSync(st, { recursive: true });
  writeFileSync(path.join(st, 'jobs.json'), JSON.stringify({ 'T0-j0': W.meta['T0-j0'], 'H0-j0': W.meta['H0-j0'] }));
  writeFileSync(path.join(st, 'rows.jsonl'), W.rows.filter(r => r.job === 'T0-j0').map(r => JSON.stringify(r)).join('\n') + '\n');
  writeFileSync(path.join(st, 'arm-faults.jsonl'), [fault, { ...fault, job: 'H0-j0' }].map(x => JSON.stringify(x)).join('\n') + '\n');
  assert.deepEqual(loadLabels(dir).armFaults.map(x => x.job), ['T0-j0', 'H0-j0']);
  assert.deepEqual(loadLabels(dir, { trainOnly: true }).armFaults.map(x => x.job), ['T0-j0']);
});

// ------------------------------------------------------------------------------- resume follow-up (2026-10-15, later)
test('hidden-path scan: a directory above a stated path (two or more segments) is not an attempt; a bare root, a sibling or a path below one is', () => {
  const ignore = taskHostPaths([{ prompt: 'Logs: /var/log/syslog. Runner: /home/runner/work/app/app.' }]);
  const bash = command => ({ name: 'Bash', input: { command } });
  assert.equal(accessedOutsidePaths([bash('grep -rn /var/log files/'), bash('grep -c /home/runner/work inputs.json'), bash('ls /home/runner')], ['/w'], { ignore }).attempts, 0);
  for (const c of ['ls /var', 'ls /home', 'cat /var/log/auth.log', 'cat /var/log/syslog/x', 'cat /home/user/workflow-foundry/beds/records/score.mjs', 'ls /home/runner/.ssh'])
    assert.equal(accessedOutsidePaths([bash(c)], ['/w'], { ignore }).attempts, 1, c);
});

test('hidden-path scan over the incident and ownerci example tasks: grepping the directories above stated paths is not an attempt (child process, counts only)', () => {
  const child = `
    import { readFileSync } from 'node:fs';
    const R = ${JSON.stringify(REPO)};
    const { planTasks, STAGES_FILE, ROLES } = await import(R + '/experiments/need-router/prereg-check.mjs');
    const { loadFamily, solverView } = await import(R + '/experiments/lib/beds.mjs');
    const { accessedOutsidePaths, taskHostPaths, statedAncestors } = await import(R + '/experiments/c0/construct.mjs');
    const { loadLedger, seedRefusals } = await import(R + '/experiments/jit/seeds.mjs');
    const stages = JSON.parse(readFileSync(STAGES_FILE, 'utf8')), ledger = loadLedger(), out = {};
    for (const jobId of ['incident', 'ownerci']) {
      const job = stages.jobs.find(j => j.id === jobId), fam = await loadFamily(job.family);
      const o = { tasks: 0, refused: 0, ancestors: 0, unstated: 0, narrow: 0, roots: 0 };
      for (const t of planTasks(stages, jobId, 'examples')) {
        if (seedRefusals(ledger, { bed: job.ledgerBed ?? job.family, split: t.split, seed: t.seed, purpose: stages.seeds.purposes[ROLES.examples.purposeKey] }).length) { o.refused++; continue; }
        const task = fam.generate({ seed: t.seed, split: t.split, difficulty: t.difficulty }), view = solverView(task), ignore = taskHostPaths([view.prompt, view.files]);
        const up = [...statedAncestors(ignore)];
        o.tasks++; o.ancestors += up.length; o.unstated += up.filter(p => !ignore.has(p)).length;
        o.narrow += accessedOutsidePaths(up.map(p => ({ name: 'Bash', input: { command: "grep -rln '" + p + "' files/ inputs.json" } })), ['/w'], { ignore }).attempts;
        o.roots += accessedOutsidePaths([...new Set([...ignore].map(p => '/' + p.split('/')[1]))].map(p => ({ name: 'Bash', input: { command: 'ls ' + p } })), ['/w'], { ignore }).attempts;
      }
      out[jobId] = o;
    }
    process.stdout.write(JSON.stringify(out) + '\\n');`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', child], { cwd: REPO, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const res = JSON.parse(r.stdout.trim().split('\n').pop());
  for (const [job, o] of Object.entries(res)) {
    assert.equal(o.refused, 0, `${job}: example seeds allowed by the ledger`);
    assert.ok(o.unstated > 0, `${job}: directories above stated paths that the task does not state itself (${o.unstated} of ${o.ancestors}): exact matching alone counted them`);
    assert.equal(o.narrow, 0, `${job}: grepping them is no attempt`);
    assert.ok(o.roots > 0, `${job}: listing a bare host root still is`);
  }
});

test('b0Agent: a path PROCEDURE.md states is not an attempt; one only notes.md (model-written) states still is', async t => {
  const dir = tmp(t), proc = path.join(dir, 'PROCEDURE.md');
  writeFileSync(proc, '# Procedure\n\nThe service logs are under /srv/app/logs; check them.\n');
  const task = { prompt: 'Summarise the incident.', inputs: { n: 1 } };
  const uses = [{ name: 'Bash', input: { command: 'ls /srv/app/logs' } }];
  const a = await b0Agent({ id: 'agent-H+proc#1', model: 'claude-haiku-5-5', procedureFile: proc, executor: fakeSession([], { answer: { v: 1 }, toolUses: uses }) })
    .run({ task, familyId: 'records', outputSchema: { type: 'object' }, workdir: path.join(dir, 'a'), state: {} });
  assert.equal(a.meta.hiddenPathAttempts, 0);
  const b = await b0Agent({ id: 'agent-H', model: 'claude-haiku-5-5', notes: true, executor: fakeSession([], { answer: { v: 1 }, toolUses: uses }) })
    .run({ task, familyId: 'records', outputSchema: { type: 'object' }, workdir: path.join(dir, 'b'), state: { notes: 'logs are under /srv/app/logs' } });
  assert.equal(b.meta.hiddenPathAttempts, 1);
});

test('resume: trial records and rows carry the stamp; a resume after an arm setting the runtime armHash does not cover changed is refused', async t => {
  const dir = tmp(t), runs = [{ job: 'wbed-r0', arms: ['direct-H'], seedRoles: ['trainEval'] }];
  await dry(dir, runs);
  const rows = readJsonl(path.join(dir, 'out', 'rows.jsonl'));
  assert.ok(rows.length === 24 && rows.every(r => r.stamp?.settingsSha === armSha(STAGES.arms['direct-H']) && r.stamp.priceTable === STAGES.priceTable.id && /^[0-9a-f]{16}$/.test(r.stamp.stageSha)));
  assert.ok(readJsonl(path.join(dir, 'live', 'results.jsonl')).every(r => r.meta?.stamp?.settingsSha === rows[0].stamp.settingsSha));
  // providerTimeoutMs lives in the metered port, not in b0Call's definition: the runtime armHash is unchanged.
  const arms = { ...STAGES.arms, 'direct-H': { ...STAGES.arms['direct-H'], providerTimeoutMs: 300000 } };
  const file = spec(dir, { runs, arms, name: 'edited.json' });
  await assert.rejects(LR.labelRun({ stageId: 'NL-T', specFile: file, workRoot: path.join(dir, 'live'), out: path.join(dir, 'out'), dry: true, racing: false, log: quiet }),
    e => e.code === 'RESUME_MIXES_VERSIONS' && /trial wbed-r0\/direct-H\//.test(e.message));
  // The same plan resumes (nothing left to run) to the same rows.
  await LR.labelRun({ stageId: 'NL-T', specFile: path.join(dir, 'spec.json'), workRoot: path.join(dir, 'live'), out: path.join(dir, 'out'), dry: true, racing: false, log: quiet });
  assert.deepEqual(readJsonl(path.join(dir, 'out', 'rows.jsonl')), rows);
});

test('reserve seeds: plan.json is written before anything is spent; another stage counts it without a report; a resume that would change the replacements is refused', async t => {
  const dir = tmp(t), runsDir = path.join(dir, 'runs');
  const seeds = { ...STAGES.seeds, purposes: { ...STAGES.seeds.purposes, example: 'need-label' }, examples: { from: 610, to: 618 }, exampleSets: { 1: [610, 611, 612], 2: [613, 614, 615], 3: [616, 617, 618] }, probe: { seed: 610 } };
  const file = spec(dir, { runs: [{ job: 'records-lo', arms: ['direct-H'], seedRoles: ['trainEval'] }], seeds, capUsd: 0 });
  // Stage A stops at its cap before any trial; its plan is on record anyway.
  const a = await LR.labelRun({ stageId: 'NL-T', specFile: file, workRoot: path.join(dir, 'live-a'), out: path.join(runsDir, 'a'), dry: true, racing: false, log: quiet });
  assert.match(a.stopped, /^STAGE_CAP/);
  const pa = JSON.parse(readFileSync(path.join(runsDir, 'a', LR.PLAN_FILE), 'utf8'));
  assert.equal(pa.schema, LR.PLAN_SCHEMA); assert.deepEqual(pa.jobs[0].replacements.map(r => r.to), [622, 623, 624, 625]);
  unlinkSync(path.join(runsDir, 'a', 'report.json'));
  assert.deepEqual([...LR.priorReplacementSeeds(runsDir, 'NL-U').get('records')].sort(), [622, 623, 624, 625], 'plan.json alone reserves them');
  // A resume of A after another stage's plan took 622: its replacements would move, so it is refused.
  mkdirSync(path.join(runsDir, 'b'), { recursive: true });
  writeFileSync(path.join(runsDir, 'b', LR.PLAN_FILE), JSON.stringify({ schema: LR.PLAN_SCHEMA, stage: 'NL-U', jobs: [{ job: 'x', bed: 'records', replacements: [{ from: 1, to: 622 }] }] }));
  await assert.rejects(LR.labelRun({ stageId: 'NL-T', specFile: file, workRoot: path.join(dir, 'live-a'), out: path.join(runsDir, 'a'), dry: true, racing: false, log: quiet }),
    e => e.code === 'PLAN_CHANGED' && /records-lo: \[622,623,624,625\] -> \[623,624,625,626\]/.test(e.message));
  rmSync(path.join(runsDir, 'b'), { recursive: true });
  const a2 = await LR.labelRun({ stageId: 'NL-T', specFile: file, workRoot: path.join(dir, 'live-a'), out: path.join(runsDir, 'a'), dry: true, racing: false, log: quiet });
  assert.deepEqual(a2.jobs[0].replacements.map(r => r.to), [622, 623, 624, 625], 'the unchanged plan resumes');
});

test('hidden-path scan: the node install the sandbox runs (run-solver\'s PATH) is not outside; a bare /opt runtime root is never used', async () => {
  const { RUNTIME_ROOTS } = await import('../../c0/construct.mjs');
  const bin = path.join(RUNTIME_ROOTS[0], 'bin');
  const uses = [{ name: 'Bash', input: { command: `cd probes/probe-0 && env -i PATH=${bin}:/usr/local/bin:/usr/bin:/bin HOME=$PWD ${bin}/node ../../solve.mjs task.json` } }];
  assert.equal(accessedOutsidePaths(uses, ['/w']).attempts, 0);
  assert.equal(accessedOutsidePaths([{ name: 'Bash', input: { command: 'ls /opt/node24/bin' } }], ['/w'], { runtimeRoots: ['/opt/node24'] }).attempts, 0);
  assert.equal(accessedOutsidePaths([{ name: 'Bash', input: { command: 'ls /opt/corpus' } }], ['/w'], { runtimeRoots: ['/opt/node24'] }).attempts, 1);
  assert.equal(accessedOutsidePaths([{ name: 'Bash', input: { command: 'ls /opt/corpus' } }], ['/w'], { runtimeRoots: ['/opt', '/'] }).attempts, 1, 'a runtime root one segment deep (or /) is ignored');
});
