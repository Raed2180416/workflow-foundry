// `foundry cancel` and `foundry stop-all` across processes (bin/foundry.mjs, src/control.mjs). The run is executed by one `foundry run` process
// (sandboxed code in a detached process group, or a model call through a fake `claude` binary whose process and helper ignore SIGTERM), and
// cancelled from another: the cancel request goes through the store, the owner aborts its work and records the verdict, a dead owner's run is
// closed by the canceller, and an owner that does not respond is killed with its process tree. Every test checks the process groups afterwards:
// nothing the run started may still be running. Synthetic code and a fake model binary only: no network, no model spend.
// Development/diagnostic evidence, not sealed evaluation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../src/store.mjs';
import { Foundry } from '../src/foundry.mjs';
import { createDefaultRegistry } from '../src/capabilities.mjs';
import { loadPolicy } from '../src/models/policy.mjs';
import { ModelPort } from '../src/models/port.mjs';
import { Journal } from '../src/journal.mjs';
import { ScriptedProvider } from '../src/models/providers/scripted.mjs';
import { sandboxStatus } from '../src/sandbox.mjs';
import { groupMembers, isRunning, processes, until } from './support/processes.mjs';

const cli = new URL('../bin/foundry.mjs', import.meta.url).pathname;
const policyFile = new URL('../policy/models.json', import.meta.url).pathname;
const sandbox = await sandboxStatus();
const skip = sandbox.available ? false : `code sandbox unavailable on this host (${sandbox.reason})`;

const workflow = (id, nodes, acceptance, budget = {}) => ({
  schemaVersion: '1.0', id, version: 1, title: 'Cancel probe', domain: 'diagnostic', goal: 'Hold work in flight until it is cancelled.',
  envelope: { assumptions: ['Synthetic code only'], risks: [], successCriteria: ['The cancellation stops the work.'] },
  budget: { maxSteps: 20, maxConcurrency: 4, maxDurationMs: 300000, maxCost: 5, ...budget }, nodes, acceptance
});
const spin = (id = 'spin') => ({ id, kind: 'code', needs: [], description: 'Busy loop', lang: 'js', args: { ms: 120000 }, timeoutMs: 180000,
  source: 'export default function main(input) { const end = Date.now() + input.ms; while (Date.now() < end) {} return { ok: true }; }' });
const spinning = id => workflow(id, [spin()], [{ op: 'eq', left: { $ref: 'nodes.spin.ok' }, right: true }]);
const parked = {
  wait: id => workflow(id, [{ id: 'pause', kind: 'wait', needs: [], description: 'Pause for an hour', delayMs: 3600000 }], [{ op: 'exists', value: { $ref: 'nodes.pause' } }]),
  human: id => workflow(id, [{ id: 'ask', kind: 'human', needs: [], description: 'A person decides', question: 'Proceed?', answerSchema: { type: 'boolean' } }], [{ op: 'exists', value: { $ref: 'nodes.ask' } }])
};

function scratch(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'foundry-cli-cancel-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const write = (name, value) => { const file = path.join(dir, name); writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value)); return file; };
  return { dir, workspace: path.join(dir, 'ws'), write };
}
const baseEnv = { PATH: process.env.PATH ?? '', NODE_NO_WARNINGS: '1' };
// A long-lived `foundry` process (the owner of a run).
function launch(t, args, env = {}) {
  const child = spawn(process.execPath, [cli, ...args], { env: { ...baseEnv, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '', err = '';
  child.stdout.on('data', chunk => { out += chunk; }); child.stderr.on('data', chunk => { err += chunk; });
  const exited = new Promise(resolve => child.once('exit', (status, signal) => resolve({ status, signal })));
  t.after(() => { try { child.kill('SIGCONT'); child.kill('SIGKILL'); } catch {} });
  return { child, exited, out: () => out, err: () => err, json: () => JSON.parse(out) };
}
// A `foundry` command that runs to its end.
function run(args, env = {}) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [cli, ...args], { env: { ...baseEnv, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('close', (status, signal) => resolve({ status, signal, stdout, stderr, json: () => JSON.parse(stdout), error: () => JSON.parse(stderr.trim().split('\n').at(-1)).error }));
  });
}
const openStore = async (t, workspace) => {
  assert.ok(await until(() => existsSync(path.join(workspace, '.foundry', 'foundry.sqlite')), 20000), 'the workspace exists');
  const store = new Store(workspace); t.after(() => store.close());
  return store;
};
const runOf = (store, workflowId) => store.runs().find(r => r.workflowId === workflowId);
// The detached process group a run's sandbox runs in: a child of the owner that leads its own group. Waits until code is running in it.
async function sandboxGroup(t, owner) {
  const group = await until(() => processes().find(p => p.ppid === owner.child.pid && p.pgid === p.pid)?.pid, 30000);
  assert.ok(group, `the sandbox started: ${owner.err()}`);
  t.after(() => { try { process.kill(-group, 'SIGKILL'); } catch {} });
  assert.ok(await until(() => groupMembers(group).length >= 2, 30000), 'the code is running inside the sandbox');
  return group;
}
const gone = async group => (await until(() => groupMembers(group).length === 0, 10000)) === true || groupMembers(group).length === 0;
const verify = async (workspace, runId) => {
  const verified = await run(['verify-run', runId, '--workspace', workspace]);
  assert.equal(verified.status, 0, verified.stdout.slice(0, 2000));
  return verified.json();
};

test('foundry cancel stops a run executed by another process: sandbox killed, cancelled verdict recorded by the owner, owner exits 3, chain verifies', { skip, timeout: 120000 }, async t => {
  const { workspace, write } = scratch(t);
  const owner = launch(t, ['run', write('wf.json', spinning('CancelSandbox')), '--workspace', workspace]);
  const group = await sandboxGroup(t, owner);
  const store = await openStore(t, workspace);
  const record = await until(() => runOf(store, 'CancelSandbox'));
  const cancelled = await run(['cancel', record.id, '--reason', 'owner said stop', '--workspace', workspace]);
  assert.equal(cancelled.status, 0, cancelled.stderr);
  const report = cancelled.json();
  assert.deepEqual([report.outcome, report.status, report.verdict, report.noop], ['cancelled', 'cancelled', 'inconclusive', false]);
  assert.deepEqual(report.stopped.items, [{ nodeKey: 'root/spin', kind: 'code' }]);
  assert.equal(report.cancel.reason, 'owner said stop');
  assert.equal(report.cancel.actor, 'cli');
  assert.match(report.message, /cancelled: stopped 1 running node \(root\/spin code\)\. The run is closed and will not be resumed/);
  assert.ok(await gone(group), `no process of the sandbox group is still running: ${JSON.stringify(groupMembers(group))}`);
  // The owner recorded the verdict itself and exited 3 (stopped, not completed), printing the cancelled run.
  const { status } = await owner.exited;
  assert.equal(status, 3, owner.err());
  const printed = owner.json();
  assert.deepEqual([printed.status, printed.verdict.verdict, printed.error.code], ['cancelled', 'inconclusive', 'CANCELLED']);
  assert.deepEqual(printed.events.map(e => e.type).filter(type => type.startsWith('run.')), ['run.created', 'run.cancel_requested', 'run.verdict', 'run.stopped']);
  assert.equal(printed.events.at(-1).closedBy, undefined, 'the owner wrote the verdict, not the canceller');
  const verified = await verify(workspace, record.id);
  assert.equal(verified.status, 'cancelled');
  // A closed run is never resumed.
  const resumed = await run(['resume', record.id, '--workspace', workspace]);
  assert.equal(resumed.status, 3);
  assert.equal(resumed.json().status, 'cancelled');
});

test('foundry cancel stops a model call: the model CLI and the helper it started (both ignoring SIGTERM) are killed, the call is journaled as cancelled', { timeout: 120000 }, async t => {
  const { workspace, write } = scratch(t);
  // The fake CLI answers --version, then ignores SIGTERM, starts a helper in its group that ignores it too, and never answers.
  const fake = write('claude', String.raw`#!/usr/bin/env node
const fs = require('node:fs'), { spawn } = require('node:child_process');
if (process.argv[2] === '--version') { console.log('9.9.9 (Claude Code)'); process.exit(0); }
process.on('SIGTERM', () => {});
const helper = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);"], { stdio: 'ignore' });
process.stdin.resume();
process.stdin.on('end', () => { fs.appendFileSync(process.env.FAKE_CLAUDE_LOG, JSON.stringify({ pid: process.pid, helper: helper.pid }) + '\n'); setInterval(() => {}, 1000); });
`);
  chmodSync(fake, 0o755);
  const log = write('claude.log', '');
  const policy = JSON.parse(readFileSync(policyFile, 'utf8'));
  policy.providers['claude-cli'].binary = fake;
  const policyPath = write('policy.json', policy);
  const model = policy.models.find(m => m.class === 'M').id;
  const wf = workflow('CancelModel', [{ id: 'ask', kind: 'agent', needs: [], description: 'Extract the amount', role: 'extract', instructions: 'Return the amount.',
    context: { inputs: [{ name: 'raw', ref: 'input.raw', render: 'text' }] }, model: { id: model },
    returns: { type: 'object', additionalProperties: false, required: ['amount'], properties: { amount: { type: 'number' } } }, checks: [{ op: 'gte', left: { $ref: 'output.amount' }, right: 0 }] }],
  [{ op: 'exists', value: { $ref: 'nodes.ask.amount' } }]);
  const owner = launch(t, ['run', write('wf.json', wf), '--input', '{"raw":"five dollars"}', '--policy', policyPath, '--max-cost', '1', '--workspace', workspace], { FAKE_CLAUDE_LOG: log });
  const pids = await until(() => readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse)[0], 30000);
  assert.ok(pids, `the fake model CLI is running a call: ${owner.err()}`);
  t.after(() => { for (const pid of [pids.pid, pids.helper]) try { process.kill(pid, 'SIGKILL'); } catch {} });
  assert.ok(isRunning(pids.pid) && isRunning(pids.helper));
  const store = await openStore(t, workspace);
  const record = await until(() => runOf(store, 'CancelModel'));
  const cancelled = await run(['cancel', record.id, '--workspace', workspace]);
  assert.equal(cancelled.status, 0, cancelled.stderr);
  assert.deepEqual(cancelled.json().stopped.items, [{ nodeKey: 'root/ask', kind: 'agent' }]);
  assert.ok(await until(() => !isRunning(pids.pid) && !isRunning(pids.helper), 10000), 'the model CLI and its helper are gone');
  const { status } = await owner.exited;
  assert.equal(status, 3, owner.err());
  const calls = await run(['calls', '--run', record.id, '--workspace', workspace]);
  assert.deepEqual(calls.json().calls.map(c => [c.ok, c.errorCode]), [[false, 'CANCELLED']]);
  assert.equal(calls.json().calls[0].provider, 'claude-cli');
  await verify(workspace, record.id);
});

test('crash between the abort and the verdict write: the store stays consistent, and `cancel` or `resume` finishes the job', { skip, timeout: 180000 }, async t => {
  for (const finish of ['cancel', 'resume']) {
    await t.test(`finished by ${finish}`, async t => {
      const { workspace, write } = scratch(t);
      // The run is created through the library with the fault injection: the first execution dies by SIGKILL right before it writes the verdict.
      const foundry = new Foundry(workspace, { registry: createDefaultRegistry() });
      const wf = spinning('CancelCrash');
      foundry.save(wf);
      const created = foundry.runtime.create(wf, {}, { extra: { crashBeforeCancelVerdict: 1 } });
      await foundry.close();
      const owner = launch(t, ['resume', created.id, '--workspace', workspace]);
      const group = await sandboxGroup(t, owner);
      const store = await openStore(t, workspace);
      const request = await run(['cancel', created.id, '--grace', finish === 'cancel' ? '30' : '0', '--workspace', workspace]);
      if (finish === 'cancel') {
        // The canceller sees the owner die with the verdict unwritten and closes the run itself.
        assert.equal(request.status, 0, request.stderr);
        assert.equal(request.json().outcome, 'cancelled');
        assert.match(request.json().message, /cancelled/);
      } else {
        assert.equal(request.status, 0, request.stderr);
        assert.equal(request.json().outcome, 'requested', 'grace 0: recorded, the owner asked, nobody waited');
      }
      const dead = await owner.exited;
      assert.equal(dead.signal, 'SIGKILL', 'the owner died before writing the verdict');
      assert.ok(await gone(group), 'its sandbox group was killed by the abort before the crash');
      if (finish === 'resume') {
        // Store consistent, run still open with its request recorded and a dead owner; nothing else changed.
        const open = store.rows.header(created.id);
        assert.equal(open.status, 'running');
        assert.equal(open.cancelRequest.actor, 'cli');
        assert.equal((await verify(workspace, created.id)).status, 'running');
        const resumed = await run(['resume', created.id, '--workspace', workspace]);
        assert.equal(resumed.status, 3, resumed.stderr);
        const printed = resumed.json();
        assert.deepEqual([printed.status, printed.error.code], ['cancelled', 'CANCELLED']);
        assert.equal(printed.nodes.spin.status, 'failed', 'the node the dead owner left running is settled');
      }
      const final = store.rows.header(created.id);
      assert.deepEqual([final.status, final.verdict.verdict, final.owner], ['cancelled', 'inconclusive', null]);
      const events = store.events(created.id);
      assert.equal(events.filter(e => e.type === 'run.cancel_requested').length, 1);
      assert.deepEqual(events.slice(-2).map(e => e.type), ['run.verdict', 'run.stopped']);
      if (finish === 'cancel') assert.equal(events.at(-1).closedBy, 'canceller');
      assert.equal((await verify(workspace, created.id)).status, 'cancelled');
    });
  }
});

test('SIGTERM leaves a resumable run; an explicit cancel then closes it for good', { skip, timeout: 120000 }, async t => {
  const { workspace, write } = scratch(t);
  const owner = launch(t, ['run', write('wf.json', spinning('CancelAfterTerm')), '--workspace', workspace]);
  const group = await sandboxGroup(t, owner);
  const store = await openStore(t, workspace);
  const record = await until(() => runOf(store, 'CancelAfterTerm'));
  owner.child.kill('SIGTERM');
  assert.equal((await owner.exited).status, 143);
  assert.ok(await gone(group));
  assert.equal(store.rows.header(record.id).status, 'running', 'interrupted like a crash: open, resumable');
  const cancelled = await run(['cancel', record.id, '--workspace', workspace]);
  assert.equal(cancelled.status, 0, cancelled.stderr);
  assert.equal(cancelled.json().outcome, 'cancelled');
  assert.equal(store.rows.header(record.id).status, 'cancelled');
  const resumed = await run(['resume', record.id, '--workspace', workspace]);
  assert.equal(resumed.json().status, 'cancelled', 'a cancelled run is not resumed');
  await verify(workspace, record.id);
});

test('foundry stop-all: executing runs of several processes, a run parked on a timer and one waiting for a person are all cancelled; nothing is left running or scheduled', { skip, timeout: 180000 }, async t => {
  const { workspace, write } = scratch(t);
  const first = launch(t, ['run', write('a.json', spinning('StopAllA')), '--workspace', workspace]);
  const groups = [await sandboxGroup(t, first)];
  const store = await openStore(t, workspace);
  const second = launch(t, ['run', write('b.json', spinning('StopAllB')), '--workspace', workspace]);
  groups.push(await sandboxGroup(t, second));
  // Parked runs: each `run` command parks the run and exits.
  assert.equal((await run(['run', write('w.json', parked.wait('StopAllWait')), '--workspace', workspace])).json().status, 'waiting');
  assert.equal((await run(['run', write('h.json', parked.human('StopAllHuman')), '--workspace', workspace])).json().status, 'awaiting_human');
  const finishedFile = write('f.json', workflow('StopAllDone', [{ id: 'a', kind: 'assert', needs: [], description: 'Nothing to hold', checks: [{ op: 'eq', left: 1, right: 1 }] }], [{ op: 'exists', value: { $ref: 'nodes.a' } }]));
  assert.equal((await run(['run', finishedFile, '--workspace', workspace])).json().status, 'succeeded');
  assert.equal(store.runs().length, 5);
  await until(() => ['StopAllA', 'StopAllB'].every(id => runOf(store, id)?.status === 'running'));

  const stopped = await run(['stop-all', '--reason', 'end of the day', '--workspace', workspace]);
  assert.equal(stopped.status, 0, stopped.stderr);
  const result = stopped.json();
  assert.deepEqual(result.results.map(r => r.outcome), ['cancelled', 'cancelled', 'cancelled', 'cancelled']);
  assert.deepEqual(result.results.map(r => r.workflowId).sort(), ['StopAllA', 'StopAllB', 'StopAllHuman', 'StopAllWait']);
  assert.equal(result.summary.cancelled, 4);
  assert.deepEqual(result.killed, [], 'both owners answered the request; nobody was killed');
  assert.match(result.message, /4 of 4 runs cancelled/);
  for (const group of groups) assert.ok(await gone(group), 'sandbox gone');
  for (const owner of [first, second]) { assert.equal((await owner.exited).status, 3, owner.err()); assert.equal(owner.json().status, 'cancelled'); }
  for (const record of store.runs()) {
    const header = store.rows.header(record.id);
    assert.equal(header.status, record.workflowId === 'StopAllDone' ? 'succeeded' : 'cancelled', record.workflowId);
    if (header.status === 'cancelled') assert.equal(header.cancelRequest.reason, 'end of the day');
    await verify(workspace, record.id);
  }
  assert.deepEqual(store.openRunIds(), []);
  // No timer survives: a tick (even far in the future) resumes nothing.
  const tick = await run(['tick', '--workspace', workspace]);
  assert.equal(tick.json().due, 0);
  assert.equal(store.dueTimers(Date.now() + 7200000).length, 0);
  // Nothing left to stop.
  const again = await run(['stop-all', '--workspace', workspace]);
  assert.equal(again.status, 0);
  assert.match(again.json().message, /0 of 0 runs cancelled/);
});

test('an owner that does not answer (stopped with SIGSTOP): cancel reports it and exit 3; --force kills it and its sandbox, closes the run, leaves nothing running', { skip, timeout: 180000 }, async t => {
  const { workspace, write } = scratch(t);
  const owner = launch(t, ['run', write('wf.json', spinning('CancelStuck')), '--workspace', workspace]);
  const group = await sandboxGroup(t, owner);
  const store = await openStore(t, workspace);
  const record = await until(() => runOf(store, 'CancelStuck'));
  owner.child.kill('SIGSTOP');
  assert.ok(await until(() => processes().find(p => p.pid === owner.child.pid)?.state === 'T'), 'the owner is stopped');
  const waiting = await run(['cancel', record.id, '--grace', '0.4', '--workspace', workspace]);
  assert.equal(waiting.status, 3, waiting.stderr);
  const report = waiting.json();
  assert.deepEqual([report.outcome, report.status], ['not-stopped', 'running']);
  assert.equal(report.owner.pid, owner.child.pid);
  assert.match(report.message, new RegExp(`its owner \\(pid ${owner.child.pid}\\) had not stopped after 0\\.\\d s`));
  assert.match(report.message, /--force/);
  assert.ok(isRunning(owner.child.pid) && groupMembers(group).length >= 2, 'nothing was killed without --force');
  assert.equal(store.rows.header(record.id).cancelRequest.actor, 'cli', 'the request is recorded and stands');

  const forced = await run(['cancel', record.id, '--grace', '0.4', '--force', '--workspace', workspace]);
  assert.equal(forced.status, 0, forced.stderr);
  const done = forced.json();
  assert.equal(done.outcome, 'cancelled', done.message);
  assert.equal(done.escalation.pid, owner.child.pid);
  assert.equal(done.escalation.killed, true);
  assert.ok(done.escalation.groups.includes(group), 'the sandbox group is among what was killed');
  assert.match(done.message, /did not stop within the grace period and was killed with 1 process below it/);
  assert.equal((await owner.exited).signal, 'SIGKILL');
  assert.ok(await gone(group), 'no process of the sandbox group is left');
  assert.ok(!isRunning(owner.child.pid));
  const header = store.rows.header(record.id);
  assert.deepEqual([header.status, header.verdict.verdict, header.owner], ['cancelled', 'inconclusive', null]);
  assert.equal(store.events(record.id).at(-1).closedBy, 'canceller');
  assert.equal(store.run(record.id).nodes.spin.status, 'failed', 'the node the killed owner left running is settled');
  await verify(workspace, record.id);
});

test('stop-all escalates by default: an owner that does not answer is killed with its sandbox, and the run is closed', { skip, timeout: 180000 }, async t => {
  const { workspace, write } = scratch(t);
  const owner = launch(t, ['run', write('wf.json', spinning('StopStuck')), '--workspace', workspace]);
  const group = await sandboxGroup(t, owner);
  const store = await openStore(t, workspace);
  const record = await until(() => runOf(store, 'StopStuck'));
  owner.child.kill('SIGSTOP');
  assert.ok(await until(() => processes().find(p => p.pid === owner.child.pid)?.state === 'T'));
  const stopped = await run(['stop-all', '--grace', '0.4', '--workspace', workspace]);
  assert.equal(stopped.status, 0, stopped.stderr);
  const result = stopped.json();
  assert.equal(result.summary.cancelled, 1);
  assert.equal(result.killed.length, 1);
  assert.equal(result.killed[0].pid, owner.child.pid);
  assert.match(result.message, /killed 1 owner process \(pid \d+\) with everything below it/);
  assert.equal((await owner.exited).signal, 'SIGKILL');
  assert.ok(await gone(group));
  assert.equal(store.rows.header(record.id).status, 'cancelled');
  await verify(workspace, record.id);
});

test('cancel and stop-all argument checks, finished and unknown runs, and no workspace is created just to look for runs', { timeout: 120000 }, async t => {
  const { dir, workspace, write } = scratch(t);
  // No state: refused before anything is created.
  const nothing = await run(['cancel', 'some-run', '--workspace', path.join(dir, 'never')]);
  assert.equal(nothing.status, 1);
  assert.equal(nothing.error().code, 'NO_STATE');
  assert.equal((await run(['stop-all', '--workspace', path.join(dir, 'never')])).error().code, 'NO_STATE');
  assert.equal(existsSync(path.join(dir, 'never')), false, 'the workspace was not created');
  // A workspace with one finished run.
  const finished = await run(['run', write('f.json', workflow('CancelDone', [{ id: 'a', kind: 'assert', needs: [], description: 'Nothing to hold', checks: [{ op: 'eq', left: 1, right: 1 }] }], [{ op: 'exists', value: { $ref: 'nodes.a' } }])), '--workspace', workspace]);
  const id = finished.json().id;
  const noop = await run(['cancel', id, '--workspace', workspace]);
  assert.equal(noop.status, 0, noop.stderr);
  assert.deepEqual([noop.json().outcome, noop.json().noop, noop.json().status], ['already-finished', true, 'succeeded']);
  assert.match(noop.json().message, /already succeeded.*nothing to cancel/);
  const store = await openStore(t, workspace);
  assert.equal(store.rows.header(id).cancelRequest, undefined);
  assert.equal((await run(['stop-all', '--workspace', workspace])).json().summary.requested, 0);
  // Unknown run, bad arguments.
  const unknown = await run(['cancel', 'no-such-run', '--workspace', workspace]);
  assert.equal(unknown.status, 1);
  assert.equal(unknown.error().code, 'NOT_FOUND');
  for (const [args, code, pattern] of [
    [['cancel', '--workspace', workspace], 'CLI_ARGUMENT', /exactly one RUN_ID/],
    [['cancel', id, 'extra', '--workspace', workspace], 'CLI_ARGUMENT', /exactly one RUN_ID/],
    [['stop-all', id, '--workspace', workspace], 'CLI_ARGUMENT', /no argument/],
    [['cancel', id, '--grace', 'soon', '--workspace', workspace], 'CLI_ARGUMENT', /--grace must be a number of seconds/],
    [['stop-all', '--force', '--workspace', workspace], 'CLI_ARGUMENT', /--force is not supported by stop-all/],
    [['cancel', id, '--executing-only', '--workspace', workspace], 'CLI_ARGUMENT', /--executing-only is not supported by cancel/],
    [['run', write('g.json', spinning('Misplaced')), '--reason', 'x', '--workspace', workspace], 'CLI_ARGUMENT', /--reason is not supported by run/],
    [['cancel', id, '--journal', path.join(dir, 'missing.sqlite'), '--workspace', workspace], 'JOURNAL_FILE', /not found/]
  ]) {
    const result = await run(args);
    assert.equal(result.status, 1, args.join(' '));
    assert.equal(result.error().code, code, args.join(' '));
    assert.match(result.error().message, pattern);
  }
  const help = await run(['--help']);
  assert.match(help.stdout, /foundry cancel RUN_ID/);
  assert.match(help.stdout, /foundry stop-all/);
});

test('--journal: a run that journaled its model calls in another database is closed by a canceller that is given that journal', { timeout: 120000 }, async t => {
  const { dir, workspace } = scratch(t);
  const journalFile = path.join(dir, 'journal.sqlite'), loaded = loadPolicy();
  // Created through the library, as an experiment would: the ModelPort's journal is a file of its own, so the run is sealed against that file.
  const external = new DatabaseSync(journalFile);
  const provider = new ScriptedProvider(() => { throw new Error('no model call expected'); });
  const foundry = new Foundry(workspace, { registry: createDefaultRegistry(), modelPolicy: loaded,
    models: () => new ModelPort({ policy: loaded.policy, providers: { 'llama-server': provider, 'claude-cli': provider }, journal: new Journal(external) }) });
  const wf = parked.wait('CancelJournal');
  foundry.save(wf);
  const created = foundry.createRun(wf.id);
  assert.equal((await foundry.startRun(created.id)).status, 'waiting');
  await foundry.close(); external.close();
  const refused = await run(['cancel', created.id, '--workspace', workspace]);
  assert.equal(refused.status, 1);
  assert.equal(refused.error().code, 'JOURNAL_EXTERNAL');
  assert.match(refused.error().message, /--journal FILE/);
  const cancelled = await run(['cancel', created.id, '--journal', journalFile, '--workspace', workspace]);
  assert.equal(cancelled.status, 0, cancelled.stderr);
  assert.equal(cancelled.json().outcome, 'cancelled');
  const verified = await run(['verify-run', created.id, '--journal', journalFile, '--workspace', workspace]);
  assert.equal(verified.status, 0, verified.stdout.slice(0, 2000));
  assert.equal(verified.json().status, 'cancelled');
});
