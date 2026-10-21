// The paid arms' wiring at $0: W-C's build inputs and overlay smoke loop, A-F's and A-HV's constitution prompt and files
// (a scripted session, no model call), the CLIs' refusals, the environment-fault stop and resume (PREREG-OT0-AMEND-1:
// a stub executor returns a rate limit; the run exits 3, scores nothing for that tick and resumes to the end) and the
// prereg check with its amendment. Nothing here calls a model: no test spawns a CLI that could start a paid session
// (the frozen prereg passes preregCheck, so a paid-capable spawn would be a paid run), and spawned CLIs get no PATH.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync, mkdirSync, writeFileSync, existsSync, copyFileSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHost } from '../../../beds/ebed/host/host.mjs';
import { wcFiles, overlaySmokeReport, TASK_ADDENDUM } from '../build-wc.mjs';
import { makeAgentArm, SIZED, runAgents, dryRunner, envFaultOf, envFaultRunner, checkLaunch, EXIT } from '../run-agents.mjs';
import { preregCheck, table, FROZEN, PREREG_FILE } from '../freeze.mjs';
import { baseWorld, overlayWorld, overlayBinding } from '../overlay.mjs';
import { buildRegistry, practiceRegistry } from '../registry.mjs';
import { CONSTITUTION_ARM_TEXT, withConstitutionFiles, constitutionRunner } from '../arms.mjs';
import { solverPath } from '../run.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const reg = buildRegistry();

test('W-C build inputs: B1L-H\'s files plus CONSTITUTION.md, the TASK section and the registry as of the period start only', () => {
  const f = wcFiles();
  for (const k of ['SPEC-E.md', 'CONTRACT.md', 'TASK.md', 'smoke.mjs', 'CONSTITUTION.md', 'constitution/log.json']) assert.ok(f[k], k);
  assert.equal(f['CONSTITUTION.md'], CONSTITUTION_ARM_TEXT);
  assert.ok(f['TASK.md'].endsWith(TASK_ADDENDUM));
  const versions = Object.keys(f).filter(k => k.startsWith('constitution/versions/') && k.endsWith('.json'));
  assert.equal(versions.length, 1, 'only v1 at the period start: the builder never sees v2 or the planted v3');
  for (const v of [reg.byVersion(2).hash, reg.byVersion(3).hash]) assert.ok(!Object.values(f).some(t => t.includes(v)));
});

test('the constitution reaches an arm time-gated through ctx.files, and the prompt through the runner', async () => {
  const seen = [];
  const arm = withConstitutionFiles({ id: 'x', tick: (input, ctx) => { seen.push(Object.keys(ctx.files).filter(p => p.startsWith('constitution/versions/') && p.endsWith('.json')).length); return null; } }, reg);
  await arm.tick({ now: '2026-03-04T00:00:00+01:00' }, { files: { a: '1' } });
  await arm.tick({ now: '2026-03-12T00:00:00+01:00' }, { files: { a: '1' } });
  assert.deepEqual(seen, [1, 3]);
  let got = null;
  await constitutionRunner(o => { got = o.prompt; return {}; })({ prompt: 'TICK' });
  assert.ok(got.startsWith(CONSTITUTION_ARM_TEXT) && got.endsWith('TICK'));
});

test('the overlay smoke report runs a solver on a practice world under the practice registry', async () => {
  const { text, summary } = await overlaySmokeReport(readFileSync(solverPath('b1lh-e8-1'), 'utf8'), { practice: { seeds: [1235], difficulties: [2] }, registry: practiceRegistry() });
  assert.match(text, /== practice world 1235 \(difficulty 2\): complete/);
  assert.match(text, /human-task events your solver received/);
  assert.equal(summary.worlds[0].armErrors, 0);
});

for (const armName of ['A-F', 'A-HV']) {
  test(`${armName} dry: a scripted session sees the constitution in its prompt and the registry in its files; the run completes`, async () => {
    const root = path.join('/var/tmp/foundry-work/ot0-dry', `test-${armName}-${process.pid}`);
    rmSync(root, { recursive: true, force: true }); mkdirSync(root, { recursive: true });
    try {
      const W = overlayWorld(baseWorld(SIZED), { registry: reg });
      const arm = makeAgentArm({ arm: armName, model: armName === 'A-F' ? 'claude-sonnet-5-5' : 'claude-haiku-5-5', label: `dry-${armName}`, workRoot: path.join(root, 'work'), journal: path.join(root, 'ticks.jsonl'),
        dry: true, tickBudget: 0.01, tickMinutes: 1, registry: reg });
      const host = createHost({ item: overlayBinding, world: W, arm, concurrency: 2, callTimeoutMs: 60_000 });
      const { status } = await host.run();
      assert.equal(status, 'complete');
      const rows = host.journal.contentRows();
      assert.equal(rows.filter(r => r.type === 'arm.error').length, 0);
      assert.ok(rows.filter(r => r.type === 'call').length > 10);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}


// --- environment faults (PREREG-OT0-AMEND-1) ---------------------------------------------------------------------------
const SCRATCH = '/var/tmp/foundry-work/ot0-dry';
const scratch = () => { mkdirSync(SCRATCH, { recursive: true }); return mkdtempSync(path.join(SCRATCH, 'test-')); };
const jsonl = f => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
/** The session end the 2026-10-21 runs saw 20-21 times each: $0, one turn, exit 1, empty stderr. */
const LIMIT = Object.freeze({ costUsd: 0, turns: 1, error: { code: 'MODEL_RATE_LIMIT', exitCode: 1, stderr: '' }, result: null });
/** A stub executor: the scripted dry session, except session `at` of this invocation returns `fault`, once per run (`marker`: the limit has reset when the run resumes). */
const limitStub = ({ at, marker, fault = LIMIT }) => {
  let n = 0;
  return async opts => { n += 1; if (n === at && !existsSync(marker)) { writeFileSync(marker, 'fired\n'); return structuredClone(fault); } return dryRunner(opts); };
};
const NO_MODEL_ENV = root => ({ PATH: '/nonexistent', HOME: root });   // a spawned CLI cannot reach the claude binary or any credential

test('envFaultOf: limits, 429/529, overload, unavailable model and no sandbox are environment faults; budget stops, timeouts and E8\'s own "rate-limited" text are not', () => {
  const root = scratch();
  try {
    const at = (r, workdir = null) => envFaultOf(r, { workdir })?.code ?? null;
    assert.equal(at(LIMIT), 'MODEL_RATE_LIMIT');
    assert.equal(at({ error: 'MODEL_RATE_LIMIT' }), 'MODEL_RATE_LIMIT');
    assert.equal(at({ error: { code: 'MODEL_UNAVAILABLE', exitCode: 1, stderr: '' } }), 'MODEL_UNAVAILABLE');
    assert.equal(at({ error: { code: 'SANDBOX_UNAVAILABLE' } }), 'SANDBOX_UNAVAILABLE');
    assert.equal(at({ error: { code: 'EXECUTOR_PROTOCOL', exitCode: 1, stderr: 'API Error: 429 Too Many Requests' } }), 'MODEL_RATE_LIMIT');
    assert.equal(at({ error: { code: 'EXECUTOR_PROTOCOL', exitCode: 1, stderr: 'API Error: 529 {"type":"overloaded_error"}' } }), 'MODEL_RATE_LIMIT');
    assert.equal(at({ error: { code: 'EXECUTOR_ERROR', exitCode: 1, stderr: '' }, result: 'Session limit reached ∙ resets 11pm' }), 'MODEL_RATE_LIMIT');
    assert.equal(at({ costUsd: 0, turns: 1, error: null, result: 'Claude AI usage limit reached|1792620000' }), 'MODEL_RATE_LIMIT');
    assert.equal(at({ costUsd: 0.2, turns: 7, error: null, result: "You've hit your weekly limit · resets Mon 9am" }), 'MODEL_RATE_LIMIT');
    // not faults
    assert.equal(at({ costUsd: 0.02, turns: 8, error: null, result: 'The carrier call was rate-limited (retryAfter 60); output.json schedules the retry.' }), null);
    assert.equal(at({ costUsd: 1, turns: 30, error: { code: 'EXECUTOR_BUDGET', exitCode: 1, stderr: '' }, result: 'usage limit reached' }), null, 'a budget stop is the arm\'s');
    assert.equal(at({ costUsd: null, error: { code: 'EXECUTOR_TIMEOUT', exitCode: null, stderr: '' } }), null);
    assert.equal(at({ costUsd: 0.01, error: null, result: 'done' }), null);
    // a limit notice from a session that did write its output is the arm's output, not a fault
    writeFileSync(path.join(root, 'output.json'), '{}');
    assert.equal(at({ costUsd: 0, error: null, result: 'Claude AI usage limit reached|1792620000' }, root), null);
    rmSync(path.join(root, 'output.json'));
    // a timeout whose stream ends in a 529 API error (nothing after it) is a fault; one that went on after the error is not
    const tr = path.join(root, '.executor-transcript.jsonl');
    writeFileSync(tr, [{ type: 'system', subtype: 'init' }, { type: 'assistant', message: { id: 'm1' } }, { type: 'system', subtype: 'api_error', status: 529, retry: true }].map(x => JSON.stringify(x)).join('\n') + '\n');
    assert.equal(at({ costUsd: null, error: { code: 'EXECUTOR_TIMEOUT', exitCode: null, stderr: '' } }, root), 'MODEL_RATE_LIMIT');
    writeFileSync(tr, [{ type: 'system', subtype: 'api_error', status: 429 }, { type: 'assistant', message: { id: 'm2' } }].map(x => JSON.stringify(x)).join('\n') + '\n');
    assert.equal(at({ costUsd: null, error: { code: 'EXECUTOR_TIMEOUT', exitCode: null, stderr: '' } }, root), null);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('envFaultRunner: a faulted session raises a host QuotaStop carrying its cost; a runner that throws an environment code is a fault at $0 before launch; any other throw is unchanged', async () => {
  const opts = { workdir: null, budgetUsd: 0.4, prompt: 'p' };
  await assert.rejects(envFaultRunner(async () => ({ costUsd: 0.0084, turns: 9, error: { code: 'MODEL_RATE_LIMIT', exitCode: 1, stderr: '' } }))(opts),
    e => e.quota === true && e.envFault === 'MODEL_RATE_LIMIT' && e.session.costUsd === 0.0084 && e.session.turns === 9);
  await assert.rejects(envFaultRunner(async () => { throw Object.assign(new Error('no namespaces'), { code: 'SANDBOX_UNAVAILABLE' }); })(opts),
    e => e.quota === true && e.envFault === 'SANDBOX_UNAVAILABLE' && e.session.costUsd === 0);
  await assert.rejects(envFaultRunner(async () => { throw new Error('boom'); })(opts), e => !e.quota && e.message === 'boom');
  const ok = { costUsd: 0.01, turns: 3, error: null };
  assert.equal(await envFaultRunner(async () => ok)(opts), ok);
});

for (const [armName, model, fault, why] of [
  ['A-F', 'claude-sonnet-5-5', LIMIT, 'MODEL_RATE_LIMIT (as on 2026-10-21)'],
  ['A-HV', 'claude-haiku-5-5', { costUsd: 0.0084, turns: 9, error: null, result: "You've hit your session limit · resets 2am (UTC)" }, 'a session-limit notice after 9 paid turns'],
]) {
  test(`${armName}: a stub executor returning ${why} stops the run with exit 3, scores nothing for that tick and writes no result.json; the same command resumes to the uninterrupted result`, async () => {
    const root = scratch(), marker = path.join(root, 'limit.fired');
    const opts = { arm: armName, model, dry: true, liveRoot: root, tickBudget: 0.01, tickMinutes: 1, log: () => {} };
    try {
      const ref = await runAgents({ ...opts, label: `dry-ref-${armName}` });     // the same scripted sessions, no fault
      assert.equal(ref.exitCode, EXIT.ok); assert.equal(ref.status, 'complete'); assert.equal(ref.result.armErrors, 0);
      const label = `dry-fault-${armName}`, live = path.join(root, label);
      const first = await runAgents({ ...opts, label, runner: limitStub({ at: 4, marker, fault }) });
      assert.equal(first.exitCode, EXIT.envFault); assert.equal(first.status, 'frozen');
      assert.ok(!existsSync(path.join(live, 'result.json')), 'no result.json after an environment fault');
      const J = jsonl(path.join(live, 'journal.jsonl')), F = jsonl(path.join(live, 'faults.jsonl')), T = jsonl(path.join(live, 'ticks.jsonl'));
      assert.equal(J.at(-1).type, 'clock.freeze'); assert.match(J.at(-1).reason, /environment fault MODEL_RATE_LIMIT/);
      assert.equal(F.length, 1); assert.equal(F[0].code, 'MODEL_RATE_LIMIT'); assert.equal(F[0].late, false); assert.equal(F[0].costUsd, fault.costUsd);
      assert.equal(J.filter(r => r.type === 'arm.error').length, 0, 'the faulted tick is no arm error');
      assert.equal(J.filter(r => r.type === 'carry.lost').length, 0, 'no carry is lost');
      assert.ok(!J.some(r => r.type === 'call' && r.target === F[0].instance && r.at === F[0].now), 'no call row (no outcome) for the faulted tick');
      assert.ok(!T.some(r => r.error), 'ticks.jsonl has no row for the faulted session');
      assert.ok(J.at(-1).discardedCalls.some(c => c.costs.some(x => x.envFault === 'MODEL_RATE_LIMIT' && x.costUsd === fault.costUsd)), 'the faulted session\'s cost is in the freeze record');
      // The same command (a fresh stub: the limit has reset) resumes from the last commit.
      const second = await runAgents({ ...opts, label, runner: limitStub({ at: 4, marker, fault }) });
      assert.equal(second.exitCode, EXIT.ok); assert.equal(second.status, 'complete');
      const R = second.result, X = ref.result;
      assert.equal(R.armErrors, 0); assert.equal(R.contaminated, null); assert.equal(R.invocations, 2);
      assert.deepEqual([R.envFaults.sessions, R.envFaults.freezes, R.envFaults.resumes, R.envFaults.late], [1, 1, 1, 0]);
      assert.ok(Math.abs(R.envFaults.costUsd - fault.costUsd) < 1e-12 && Math.abs(R.spentUsd - fault.costUsd) < 1e-12, 'the faulted session\'s spend stays on the run');
      for (const k of ['e8', 'overlay', 'ticks']) assert.deepEqual(R[k], X[k], k);
      for (const k of ['C1', 'C2', 'C3', 'staleWindow']) assert.deepEqual(R.observer[k], X.observer[k], `observer ${k}`);
      assert.deepEqual(Object.fromEntries(Object.entries(R.auditor).map(([k, v]) => [k, v.pass])), Object.fromEntries(Object.entries(X.auditor).map(([k, v]) => [k, v.pass])), 'auditor');
      const J2 = jsonl(path.join(live, 'journal.jsonl'));
      assert.equal(J2.filter(r => r.type === 'run.resume').length, 1);
      const calls = J2.filter(r => r.type === 'call' && r.target === F[0].instance && r.at === F[0].now);
      assert.ok(calls.length >= 1 && calls.every(c => c.outcome === 'ok'), 'the faulted tick ran again after the resume and was scored once, as an ordinary tick');
      await assert.rejects(runAgents({ ...opts, label }), /result\.json exists/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}

test('a resume with other settings is refused (launch.jsonl)', async () => {
  const root = scratch();
  try {
    const f = path.join(root, 'launch.jsonl'), code = { a: '1' };
    checkLaunch(f, { settings: { cap: 5 }, code });
    checkLaunch(f, { settings: { cap: 5 }, code });
    assert.throws(() => checkLaunch(f, { settings: { cap: 6 }, code }), /other settings/);
    assert.throws(() => checkLaunch(f, { settings: { cap: 5 }, code: { a: '2' } }), /code changed since the first launch: a/);
    assert.equal(jsonl(f).length, 2);
    const opts = { arm: 'A-F', model: 'claude-sonnet-5-5', dry: true, liveRoot: root, tickMinutes: 1, log: () => {} };
    const marker = path.join(root, 'm');
    assert.equal((await runAgents({ ...opts, label: 'dry-launch', tickBudget: 0.01, runner: limitStub({ at: 2, marker }) })).exitCode, EXIT.envFault);
    await assert.rejects(runAgents({ ...opts, label: 'dry-launch', tickBudget: 0.02 }), /other settings/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the CLI: refusals before any session, and a dry run with --dry-env-fault-at exits 3, then resumes with the same command (exit 0)', () => {
  const root = scratch(), label = `dry-cli-fault-${process.pid}`;
  const node = (file, args) => spawnSync(process.execPath, [path.join(here, '..', file), ...args], { encoding: 'utf8', timeout: 120_000, env: NO_MODEL_ENV(root) });
  try {
    assert.match(node('run-agents.mjs', ['--arm', 'A-F', '--model', 'claude-haiku-5-5', '--label', 'x']).stderr, /--model for A-F must be one of/);
    assert.match(node('run-agents.mjs', ['--arm', 'A-F', '--model', 'claude-sonnet-5-5', '--label', 'x']).stderr, /--cap \(USD, at most 50 per arm\) is required/);
    assert.match(node('run-agents.mjs', ['--arm', 'A-F', '--model', 'claude-sonnet-5-5', '--label', 'x', '--dry']).stderr, /must start with dry-/);
    assert.match(node('run-agents.mjs', ['--arm', 'A-F', '--model', 'claude-sonnet-5-5', '--label', 'x', '--cap', '20', '--dry-env-fault-at', '3']).stderr, /for --dry only/);
    assert.match(node('build-wc.mjs', ['--model', 'claude-sonnet-5-5', '--label', 'wc-x']).stderr, /B1L-H conditions: --model claude-haiku-5-5/);
    const cmd = ['--arm', 'A-F', '--model', 'claude-sonnet-5-5', '--label', label, '--dry', '--tick-budget', '0.01', '--tick-minutes', '1', '--dry-env-fault-at', '3'];
    const a = node('run-agents.mjs', cmd);
    assert.equal(a.status, 3, a.stderr + a.stdout); assert.match(a.stdout, /STOPPED on an environment fault \(MODEL_RATE_LIMIT/);
    assert.ok(!existsSync(path.join(SCRATCH, label, 'result.json')));
    const b = node('run-agents.mjs', cmd);
    assert.equal(b.status, 0, b.stderr + b.stdout); assert.match(b.stdout, /resuming \(invocation 2\)/); assert.match(b.stdout, /: complete; .* 1 environment-fault session\(s\) over 2 invocation\(s\)/);
    const R = JSON.parse(readFileSync(path.join(SCRATCH, label, 'result.json'), 'utf8'));
    assert.equal(R.armErrors, 0); assert.equal(R.envFaults.sessions, 1);
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(path.join(SCRATCH, label), { recursive: true, force: true }); }
});

// --- the prereg check and its amendment ----------------------------------------------------------------------------------
test('the frozen-file table covers files that exist; the frozen prereg passes only through its adopted amendment', () => {
  const rows = table();
  assert.equal(rows.length, FROZEN.length);
  assert.ok(rows.every(r => /^[0-9a-f]{64}  /.test(r)), rows.find(r => !/^[0-9a-f]{64}  /.test(r)));
  const p = preregCheck();
  assert.equal(p.files, 40);
  assert.deepEqual(p.amendments.map(a => [path.basename(a.file), a.supersedes]), [['PREREG-OT0-AMEND-1.md', ['experiments/constitution/run-agents.mjs']]]);
});

test('preregCheck refuses: no amendment, a draft amendment, a forged old sha256, a path outside the table, an amendment of another prereg, a wrong new sha256, a draft prereg', () => {
  const root = scratch();
  try {
    const prereg = path.join(root, 'PREREG-OT0.md'), amend = path.join(root, 'PREREG-OT0-AMEND-1.md');
    const AMEND = readFileSync(path.join(path.dirname(PREREG_FILE), 'PREREG-OT0-AMEND-1.md'), 'utf8');
    copyFileSync(PREREG_FILE, prereg);
    assert.throws(() => preregCheck(prereg), /frozen files changed since the prereg: experiments\/constitution\/run-agents\.mjs$/);
    const line = AMEND.match(/^supersedes (\S+) -> (\S+)  (\S+)$/m);
    const variants = [
      [AMEND.replace('**Status: ADOPTED', '**Status: DRAFT'), /not adopted/],
      [AMEND.replace(line[0], `supersedes ${'0'.repeat(64)} -> ${line[2]}  ${line[3]}`), /supersedes experiments\/constitution\/run-agents\.mjs at 000000000000…, but the frozen/],
      [AMEND.replace(line[0], `${line[0]}\nsupersedes ${'1'.repeat(64)} -> ${'2'.repeat(64)}  experiments/constitution/not-frozen.mjs`), /not in the frozen table/],
      [AMEND.replace(/^amends (\S+) [0-9a-f]{64}$/m, `amends $1 ${'3'.repeat(64)}`), /does not amend this prereg/],
      [AMEND.replace(line[0], `supersedes ${line[1]} -> ${'4'.repeat(64)}  ${line[3]}`), /frozen files changed since the prereg and its amendments: experiments\/constitution\/run-agents\.mjs$/],
    ];
    for (const [text, re] of variants) { writeFileSync(amend, text); assert.throws(() => preregCheck(prereg), re); }
    writeFileSync(amend, AMEND);
    assert.equal(preregCheck(prereg).amendments.length, 1, 'the copy passes with the amendment as adopted');
    writeFileSync(prereg, readFileSync(PREREG_FILE, 'utf8').replace('**Status: FROZEN', '**Status: DRAFT'));
    assert.throws(() => preregCheck(prereg), /is a draft/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
