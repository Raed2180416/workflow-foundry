// `foundry cancel` and stop-all (src/control.mjs; R-21, synthesis §3.17), library level. Each test uses two handles on one workspace: the OWNER
// executes the run (a Foundry with a scripted model provider and probe capabilities), the CANCELLER is a second Foundry on the same database,
// as the process that runs `foundry cancel` would be. The cross-process behaviour (real signals, process groups, a killed owner) is in
// tests/cli-cancel.test.mjs. Scripted provider and synthetic capabilities only: no network, no model spend.
// Development/diagnostic evidence, not sealed evaluation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Foundry } from '../src/foundry.mjs';
import { createDefaultRegistry } from '../src/capabilities.mjs';
import { FoundryError } from '../src/data.mjs';
import { loadPolicy } from '../src/models/policy.mjs';
import { ModelPort } from '../src/models/port.mjs';
import { Journal } from '../src/journal.mjs';
import { ScriptedProvider } from '../src/models/providers/scripted.mjs';
import { sandboxStatus } from '../src/sandbox.mjs';
import { verifyRun } from '../src/verify-run.mjs';
import { serveHttp } from '../src/http.mjs';
import { ancestorsOf, descendantsOf, escalationPlan, exitCodeOf } from '../src/control.mjs';
import { exitedPid, groupMembers, processes, until } from './support/processes.mjs';

const loaded = loadPolicy();
const M = loaded.policy.models.find(m => m.class === 'M').id;
const sandbox = await sandboxStatus();
const noSandbox = sandbox.available ? false : `code sandbox unavailable on this host (${sandbox.reason})`;
const ref = $ref => ({ $ref });
const eq = (left, right) => ({ op: 'eq', left, right });
const amount = { type: 'object', additionalProperties: false, required: ['amount'], properties: { amount: { type: 'number' } } };

const base = (nodes, acceptance, { id = 'CancelProbe', budget = {} } = {}) => ({
  schemaVersion: '1.0', id, version: 1, title: 'Cancel probe', domain: 'diagnostic', goal: 'Exercise cancellation with synthetic local capabilities and explicit oracles.',
  envelope: { assumptions: ['Synthetic local capabilities only'], risks: [], successCriteria: ['The asserted cancellation invariant holds.'] },
  budget: { maxSteps: 100, maxConcurrency: 4, maxDurationMs: 120000, maxCost: 5, ...budget }, nodes, acceptance
});
const task = (id, tool, args = {}, needs = []) => ({ id, kind: 'task', needs, description: `Synthetic probe ${id}`, tool, args: { id, ...args }, timeoutMs: 60000, retry: { maxAttempts: 1 } });
const hold = (id, needs = []) => task(id, 'probe.step', { hold: true }, needs);
const agent = id => ({ id, kind: 'agent', needs: [], description: 'Extract the amount', role: 'extract', instructions: 'Return the amount in USD as a number.',
  context: { inputs: [{ name: 'raw', ref: 'input.raw', render: 'text' }] }, returns: amount, model: { id: M }, checks: [{ op: 'gte', left: ref('output.amount'), right: 0 }] });
const code = (id, ms = 120000) => ({ id, kind: 'code', needs: [], description: 'Busy loop', lang: 'js', args: { ms }, timeoutMs: 180000,
  source: 'export default function main(input) { const end = Date.now() + input.ms; while (Date.now() < end) {} return { ok: true }; }' });
const human = (id = 'ask') => ({ id, kind: 'human', needs: [], description: 'A person decides', question: 'Proceed?', answerSchema: { type: 'boolean' } });
const exists = value => ({ op: 'exists', value });
const done = id => eq(ref(`nodes.${id}.id`), id);

// probe.step (no effect) and probe.effect (a non-idempotent effect): `hold` waits until aborted, `fail` throws. probe.gated needs approval.
function probes() {
  const state = { started: [], aborted: [], finished: [] };
  const registry = createDefaultRegistry();
  const execute = async (args, { signal }) => {
    state.started.push(args.id);
    if (args.fail) throw new FoundryError('PROBE_FAILED', `synthetic failure of ${args.id}`);
    if (args.hold) await new Promise((_, reject) => {
      const stop = () => { state.aborted.push(args.id); reject(Object.assign(new Error('aborted'), { name: 'AbortError', code: 'ABORT_ERR' })); };
      if (signal.aborted) stop(); else signal.addEventListener('abort', stop, { once: true });
    });
    state.finished.push(args.id);
    return { id: args.id };
  };
  for (const [name, effects, extra] of [['probe.step', 'none', {}], ['probe.effect', 'non-idempotent', {}], ['probe.gated', 'idempotent', { requiresApproval: true }]]) {
    registry.register({ name, description: 'Synthetic cancellation probe', version: '1', implementation: `cancel-test/${name}`, inputSchema: {}, outputSchema: {}, effects, risk: 'low',
      requiresApproval: false, maxTimeoutMs: 120000, cancellation: 'cooperative', cost: 0, execute, ...extra });
  }
  // probe.deaf / probe.deaf-effect never look at their signal: they settle only when the test releases them.
  state.release = new Map();
  for (const [name, effects] of [['probe.deaf', 'none'], ['probe.deaf-effect', 'non-idempotent']]) {
    registry.register({ name, description: 'Synthetic probe that ignores cancellation', version: '1', implementation: `cancel-test/${name}`, inputSchema: {}, outputSchema: {}, effects, risk: 'low',
      requiresApproval: false, maxTimeoutMs: 120000, cancellation: 'none', cost: 0, execute: args => { state.started.push(args.id); return new Promise(resolve => { state.release.set(args.id, () => resolve({ id: args.id })); }); } });
  }
  return { registry, state };
}
// An owner and a canceller on one fresh workspace.
function pair(t, { script, ownerOptions = {} } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'foundry-cancel-'));
  const provider = new ScriptedProvider(script ?? (() => { throw new Error('no model call expected'); }));
  const { registry, state } = probes();
  const opened = [];
  const open = (options = {}) => {
    const foundry = new Foundry(root, { registry, modelPolicy: loaded, cancelPollMs: 15, cancelGraceMs: 150, policy: { maxCost: 5 }, ...options });
    opened.push(foundry);
    return foundry;
  };
  const owner = open({ models: store => new ModelPort({ policy: loaded.policy, providers: { 'llama-server': provider, 'claude-cli': provider }, journal: new Journal(store) }), ...ownerOptions });
  const other = open();
  t.after(async () => {
    // A failed assertion must not leave an execution hanging: abort what is still active, then close.
    for (const foundry of opened) for (const { controller } of foundry.active.values()) controller.abort();
    for (const foundry of opened) await foundry.close().catch(() => {});
    rmSync(root, { recursive: true, force: true });
  });
  const create = (workflow, input = {}, options = {}) => { owner.save(workflow); return owner.createRun(workflow.id, input, options); };
  const types = id => other.store.events(id).map(e => e.type);
  const verified = id => { const report = verifyRun(other.store, id); assert.equal(report.ok, true, JSON.stringify(report.findings)); return report; };
  return { root, owner, other, provider, registry, state, open, create, types, verified };
}
// A run whose owner died mid-execution: `running` with a dead owner and the given nodes still `running`.
async function crash(foundry, runId, nodes) {
  const pid = await exitedPid();
  foundry.store.updateRun(runId, r => {
    r.status = 'running'; r.owner = { token: 'crashed-owner', pid, processStart: null, acquiredAt: Date.now() };
    for (const [id, state] of Object.entries(nodes)) r.nodes[id] = { attempts: 1, startedAt: Date.now(), ...state, status: 'running' };
  }, { type: 'runner.acquired', token: 'crashed-owner' }, { result: 'header' });
  return pid;
}

test('cancel mid-model-call: the call is aborted and journaled, the owner records the cancelled verdict, the chain verifies', { timeout: 60000 }, async t => {
  const p = pair(t, { script: { [M]: [{ delayMs: 600000, value: { amount: 1 } }] } });
  const run = p.create(base([agent('ask')], [exists(ref('nodes.ask.amount'))]), { raw: 'five dollars' });
  const running = p.owner.startRun(run.id);
  assert.ok(await until(() => p.provider.active === 1), 'the model call is in flight');
  const report = await p.other.cancel(run.id, { actor: 'test', reason: 'stop the model call', graceMs: 20000 });
  assert.equal(report.outcome, 'cancelled', report.message);
  assert.equal(report.noop, false);
  assert.deepEqual(report.stopped.items, [{ nodeKey: 'root/ask', kind: 'agent' }]);
  assert.match(report.message, /cancelled: stopped 1 running node \(root\/ask agent\)/);
  const final = await running; // the owner's own execution wrote the verdict
  assert.equal(final.status, 'cancelled');
  assert.deepEqual({ code: final.error.code, message: final.error.message }, { code: 'CANCELLED', message: 'Run cancelled by test: stop the model call' });
  assert.deepEqual({ verdict: final.verdict.verdict, code: final.verdict.code, authority: final.verdict.authority }, { verdict: 'inconclusive', code: 'CANCELLED', authority: 'unresolved' });
  assert.equal(final.owner, null);
  assert.equal(p.provider.active, 0, 'the provider call ended');
  assert.equal(p.owner.active.size, 0);
  const types = p.types(run.id);
  assert.equal(types.filter(type => type === 'cancel.requested').length, 1);
  assert.ok(types.includes('model.cancelled'), 'the aborted call is charged to the run');
  assert.deepEqual(types.slice(-2), ['run.verdict', 'run.stopped']);
  const stopped = p.other.store.events(run.id).at(-1);
  assert.deepEqual({ actor: stopped.cancel.actor, reason: stopped.cancel.reason }, { actor: 'test', reason: 'stop the model call' });
  const rows = new Journal(p.other.store).forRun(run.id);
  assert.deepEqual(rows.map(row => [row.ok, row.errorCode]), [[false, 'CANCELLED']], 'the cancelled call is journaled');
  assert.equal(p.other.store.run(run.id).cancelRequest.reason, 'stop the model call');
  p.verified(run.id);
});

test('cancel mid-sandbox: the sandboxed code and its process group are killed, the run is cancelled', { skip: noSandbox, timeout: 90000 }, async t => {
  const p = pair(t);
  const run = p.create(base([code('spin')], [eq(ref('nodes.spin.ok'), true)]));
  const running = p.owner.startRun(run.id);
  const group = await until(() => processes().find(x => x.ppid === process.pid && x.pgid === x.pid)?.pid, 30000);
  t.after(() => { try { process.kill(-group, 'SIGKILL'); } catch {} });
  assert.ok(group, 'the sandbox started');
  assert.ok(await until(() => groupMembers(group).length >= 2, 30000), 'the code is running inside the sandbox');
  // The group is on file with the run while it runs (src/children.mjs), so a killed owner's sandbox could be found.
  assert.deepEqual(p.other.store.children(run.id).map(c => [c.pid, c.pgid, c.kind]), [[group, group, 'sandbox']]);
  const report = await p.other.cancel(run.id, { actor: 'test', graceMs: 30000 });
  assert.equal(report.outcome, 'cancelled', report.message);
  assert.deepEqual(report.stopped.items, [{ nodeKey: 'root/spin', kind: 'code' }]);
  assert.equal((await running).status, 'cancelled');
  assert.ok(await until(() => groupMembers(group).length === 0, 10000), `no process of the sandbox group is left: ${JSON.stringify(groupMembers(group))}`);
  assert.deepEqual(p.other.store.children(run.id), [], 'and off the file');
  p.verified(run.id);
});

test('a sandbox that ends on its own leaves nothing on file', { skip: noSandbox, timeout: 90000 }, async t => {
  const p = pair(t);
  const run = p.create(base([code('quick', 1)], [eq(ref('nodes.quick.ok'), true)]));
  assert.equal((await p.owner.startRun(run.id)).status, 'succeeded');
  assert.deepEqual(p.other.store.children(run.id), []);
  assert.deepEqual(p.other.store.childRunIds(), []);
});

test('cancel mid-tool: a tool without effects is stopped (cancelled); one with a non-idempotent effect leaves the run uncertain and is listed', { timeout: 60000 }, async t => {
  await t.test('no effects', async t => {
    const p = pair(t);
    const run = p.create(base([hold('slow'), hold('slower')], [done('slow')]));
    const running = p.owner.startRun(run.id);
    assert.ok(await until(() => p.state.started.length === 2));
    const report = await p.other.cancel(run.id, { actor: 'test', graceMs: 20000 });
    assert.equal(report.outcome, 'cancelled', report.message);
    assert.equal((await running).status, 'cancelled');
    assert.deepEqual(p.state.aborted.sort(), ['slow', 'slower']);
    assert.deepEqual(report.stopped.items.map(x => x.nodeKey).sort(), ['root/slow', 'root/slower']);
    assert.equal(exitCodeOf(report), 0);
    p.verified(run.id);
  });
  await t.test('a non-idempotent effect in flight', async t => {
    const p = pair(t);
    const run = p.create(base([hold('slow'), task('send', 'probe.effect', { hold: true })], [done('slow')]));
    const running = p.owner.startRun(run.id);
    assert.ok(await until(() => p.state.started.length === 2));
    const report = await p.other.cancel(run.id, { actor: 'test', graceMs: 20000 });
    assert.equal(report.outcome, 'uncertain', report.message);
    assert.equal(report.status, 'uncertain');
    assert.equal(report.verdict, 'uncertain');
    assert.deepEqual(report.effectsUnknown.items.map(x => [x.nodeKey, x.tool, x.effects]), [['root/send', 'probe.effect', 'non-idempotent']]);
    assert.match(report.message, /1 effect of unknown outcome \(root\/send probe\.effect\)/);
    assert.equal(exitCodeOf(report), 2);
    assert.equal((await running).status, 'uncertain');
    assert.deepEqual(report.stopped.items.map(x => x.nodeKey), ['root/slow']);
    p.verified(run.id);
  });
});

test('cancel of a run that has finished is a no-op with a clear message: nothing is written', { timeout: 60000 }, async t => {
  const p = pair(t);
  const succeeded = p.create(base([task('a', 'probe.step')], [done('a')], { id: 'DoneOk' }));
  const failed = p.create(base([task('b', 'probe.step', { fail: true })], [done('b')], { id: 'DoneFailed' }));
  const uncertain = p.create(base([task('c', 'probe.effect', { fail: true })], [done('c')], { id: 'DoneUncertain' }));
  const held = p.create(base([hold('d')], [done('d')], { id: 'DoneCancelled' }));
  assert.equal((await p.owner.startRun(succeeded.id)).status, 'succeeded');
  assert.equal((await p.owner.startRun(failed.id)).status, 'failed');
  assert.equal((await p.owner.startRun(uncertain.id)).status, 'uncertain');
  const heldRun = p.owner.startRun(held.id);
  assert.ok(await until(() => p.state.started.includes('d')));
  assert.equal((await p.other.cancel(held.id, { graceMs: 20000 })).outcome, 'cancelled');
  await heldRun;
  for (const [run, status] of [[succeeded, 'succeeded'], [failed, 'failed'], [held, 'cancelled']]) {
    const before = p.other.store.events(run.id).length, headBefore = p.other.store.rows.header(run.id).eventHead;
    const report = await p.other.cancel(run.id, { actor: 'test', reason: 'too late' });
    assert.equal(report.outcome, 'already-finished');
    assert.equal(report.noop, true);
    assert.equal(report.status, status);
    assert.match(report.message, new RegExp(`already ${status}.*nothing to cancel`));
    assert.equal(exitCodeOf(report), 0);
    assert.equal(p.other.store.events(run.id).length, before, 'no event was written');
    assert.deepEqual(p.other.store.rows.header(run.id).eventHead, headBefore);
  }
  assert.equal(p.other.store.rows.header(succeeded.id).cancelRequest, undefined, 'no request is recorded on a finished run');
  // An uncertain run is not executing: nothing to stop, and cancelling does not settle the effect.
  const report = await p.other.cancel(uncertain.id, { actor: 'test' });
  assert.deepEqual([report.outcome, report.noop, report.status], ['uncertain', true, 'uncertain']);
  assert.match(report.message, /Nothing is executing, so there is nothing to cancel/);
  assert.equal(p.other.store.rows.header(uncertain.id).cancelRequest, undefined);
  await assert.rejects(p.other.cancel('no-such-run'), error => error.code === 'NOT_FOUND');
});

test('cancel closes a run that nothing executes: parked on a timer, a question or an approval, or never started', { timeout: 60000 }, async t => {
  const p = pair(t);
  const waiting = p.create(base([{ id: 'pause', kind: 'wait', needs: [], description: 'Pause for an hour', delayMs: 3600000 }], [exists(ref('nodes.pause'))], { id: 'Parked1' }));
  const asking = p.create(base([human()], [exists(ref('nodes.ask'))], { id: 'Parked2' }));
  const gated = p.create(base([task('write', 'probe.gated')], [done('write')], { id: 'Parked3' }));
  const ready = p.create(base([task('a', 'probe.step')], [done('a')], { id: 'Parked4' }));
  assert.equal((await p.owner.startRun(waiting.id)).status, 'waiting');
  assert.equal((await p.owner.startRun(asking.id)).status, 'awaiting_human');
  assert.equal((await p.owner.startRun(gated.id)).status, 'awaiting_approval');
  assert.equal(p.other.store.timers(waiting.id).length, 1);
  const approvalId = Object.keys(p.other.store.rows.header(gated.id).approvals)[0];

  const w = await p.other.cancel(waiting.id, { actor: 'test', reason: 'not needed' });
  assert.equal(w.outcome, 'cancelled', w.message);
  assert.match(w.message, /nothing was running/);
  assert.deepEqual(p.other.store.timers(waiting.id), [], 'the wait timer is gone, so a tick cannot restart the run');
  assert.equal((await p.other.tick({ now: Date.now() + 2 * 3600000 })).due, 0);

  const q = await p.other.cancel(asking.id, { actor: 'test' });
  assert.equal(q.outcome, 'cancelled');
  assert.deepEqual(q.unanswered.questions, ['root/ask']);
  assert.match(q.message, /1 question left unanswered/);
  assert.throws(() => p.other.runtime.answer(asking.id, 'root/ask', true), error => error.code === 'RUN_CLOSED');

  const g = await p.other.cancel(gated.id, { actor: 'test' });
  assert.equal(g.outcome, 'cancelled');
  assert.deepEqual(g.unanswered.approvals.map(a => [a.approvalId, a.tool]), [[approvalId, 'probe.gated']]);
  assert.throws(() => p.other.runtime.approve(gated.id, approvalId, true, 'user'), error => error.code === 'RUN_CLOSED');
  assert.equal(p.state.started.length, 0, 'nothing was run');

  const r = await p.other.cancel(ready.id, { actor: 'test' });
  assert.equal(r.outcome, 'cancelled');
  assert.equal((await p.owner.startRun(ready.id)).status, 'cancelled', 'a closed run is not started');
  assert.equal(p.state.started.length, 0);

  for (const run of [waiting, asking, gated, ready]) {
    const header = p.other.store.rows.header(run.id);
    assert.deepEqual([header.status, header.verdict.verdict, header.owner], ['cancelled', 'inconclusive', null]);
    assert.deepEqual(p.types(run.id).slice(-2), ['run.verdict', 'run.stopped']);
    assert.equal(p.types(run.id).filter(type => type === 'cancel.requested').length, 1);
    p.verified(run.id);
  }
});

test('a run whose owner died is closed by cancel: nodes it left running are settled (uncertain for a possible effect) and the chain verifies', { timeout: 60000 }, async t => {
  await t.test('no effect in flight: cancelled, the running nodes failed with the cancellation', async t => {
    const p = pair(t);
    const run = p.create(base([code('spin'), hold('wait')], [done('wait')]));
    await crash(p.owner, run.id, { spin: { kind: 'code' }, wait: { kind: 'task', tool: 'probe.step', effects: 'none' } });
    const report = await p.other.cancel(run.id, { actor: 'test', graceMs: 5000 });
    assert.equal(report.outcome, 'cancelled', report.message);
    assert.ok(report.waitedMs < 2000, 'closed at once, no grace period for a dead owner');
    const header = p.other.store.run(run.id);
    assert.deepEqual([header.nodes.spin.status, header.nodes.spin.error.code, header.nodes.wait.status], ['failed', 'CANCELLED', 'failed']);
    const swept = p.other.store.events(run.id).filter(e => e.swept);
    assert.deepEqual(swept.map(e => [e.type, e.nodeKey]), [['node.failed', 'root/spin'], ['node.failed', 'root/wait']]);
    assert.deepEqual(p.types(run.id).slice(-2), ['run.verdict', 'run.stopped']);
    assert.equal(p.state.started.length, 0);
    p.verified(run.id);
  });
  await t.test('a non-idempotent effect was in flight: uncertain, never reported cancelled', async t => {
    const p = pair(t);
    const run = p.create(base([task('send', 'probe.effect', { hold: true })], [done('send')]));
    await crash(p.owner, run.id, { send: { kind: 'task', tool: 'probe.effect', effects: 'non-idempotent' } });
    const report = await p.other.cancel(run.id, { actor: 'test' });
    assert.equal(report.outcome, 'uncertain', report.message);
    assert.deepEqual(report.effectsUnknown.items.map(x => x.nodeKey), ['root/send']);
    assert.equal(p.other.store.rows.header(run.id).status, 'uncertain');
    assert.equal(p.other.store.events(run.id).findLast(e => e.type === 'run.verdict').verdict, 'uncertain');
    p.verified(run.id);
  });
  await t.test('crash between the abort and the verdict: the request survives, and resuming the run finishes the cancellation without running anything', async t => {
    const p = pair(t);
    const run = p.create(base([task('step', 'probe.step'), code('spin')], [done('step')]));
    await crash(p.owner, run.id, { step: { kind: 'task', tool: 'probe.step', effects: 'none' } });
    const { created } = p.other.runtime.requestCancel(run.id, { actor: 'test', reason: 'then the owner died' });
    assert.equal(created, true);
    assert.equal(p.other.store.rows.header(run.id).status, 'running', 'the request alone changes nothing else: store consistent, run still open');
    p.verified(run.id);
    const final = await p.owner.startRun(run.id);
    assert.equal(final.status, 'cancelled');
    assert.equal(final.error.message, 'Run cancelled by test: then the owner died');
    assert.equal(p.state.started.length, 0, 'no node ran');
    // No crash recovery for a run whose cancellation stands: the call the dead owner left running is settled as `foundry cancel` settles it.
    assert.deepEqual([final.nodes.step.status, final.nodes.step.error.code], ['failed', 'CANCELLED'], 'the interrupted call is settled, never re-run');
    assert.deepEqual(p.other.store.events(run.id).filter(e => e.swept).map(e => [e.type, e.nodeKey]), [['node.failed', 'root/step']]);
    assert.equal(p.types(run.id).includes('node.recovered'), false, 'recovery did not put it back');
    assert.equal(p.types(run.id).filter(type => type === 'cancel.requested').length, 1);
    p.verified(run.id);
    // ...and another cancel of the finished run is the no-op.
    assert.equal((await p.other.cancel(run.id)).outcome, 'already-finished');
  });
});

test('requests are durable, idempotent and compare-and-swap: the first request stands, concurrent cancels write one event, a live owner is never closed from outside', { timeout: 60000 }, async t => {
  const p = pair(t);
  const run = p.create(base([hold('slow')], [done('slow')]));
  const running = p.owner.startRun(run.id);
  assert.ok(await until(() => p.state.started.includes('slow')));
  assert.throws(() => p.other.runtime.closeCancelled(run.id, { actor: 'test' }), error => error.code === 'RUN_BUSY', 'a live owner refuses an outside close');
  const [first, second] = await Promise.all([p.other.cancel(run.id, { actor: 'first', reason: 'one' }), p.other.cancel(run.id, { actor: 'second', reason: 'two' })]);
  assert.deepEqual([first.outcome, second.outcome], ['cancelled', 'cancelled']);
  assert.equal(p.types(run.id).filter(type => type === 'cancel.requested').length, 1);
  assert.deepEqual([first.cancel.actor, second.cancel.actor], ['first', 'first'], 'the first request stands');
  assert.equal((await running).error.message, 'Run cancelled by first: one');
  assert.throws(() => p.other.runtime.requestCancel(run.id), error => error.code === 'RUN_CLOSED');
  p.verified(run.id);
});

test('cancelling a run by the owner\'s own Foundry also works (the in-process abort), and a three-deep tree stops with its question left open', { timeout: 60000 }, async t => {
  const p = pair(t);
  // root: a human question (left open) and a map of two items, each running a loop whose body holds a tool: map -> loop -> task.
  const tree = base([human('q'), {
    id: 'each', kind: 'map', needs: [], description: 'Two items', items: [1, 2], maxItems: 2, concurrency: 2,
    body: {
      nodes: [{ id: 'repeat', kind: 'loop', needs: [], description: 'Hold until cancelled', maxIterations: 2, initial: { step: { id: 'seed' } }, input: { n: ref('item') },
        until: eq(ref('nodes.step.id'), 'never'), body: { nodes: [hold('step')], acceptance: [exists(ref('nodes.step'))] } }],
      acceptance: [exists(ref('nodes.repeat'))]
    }
  }], [exists(ref('nodes.each'))]);
  const run = p.create(tree);
  const running = p.owner.startRun(run.id);
  assert.ok(await until(() => p.state.started.length === 2), 'both map items hold a tool');
  const report = await p.owner.cancel(run.id, { actor: 'test', graceMs: 20000 });
  assert.equal(report.outcome, 'cancelled', report.message);
  assert.equal((await running).status, 'cancelled');
  assert.equal(p.state.aborted.length, 2);
  assert.deepEqual(report.unanswered.questions, ['root/q'], 'the question that was pending stays open and is reported');
  assert.equal(p.owner.store.rows.withStatus(run.id, 'running').length, 0, 'no node is left running in any frame');
  assert.ok(report.stopped.count >= 2, report.message);
  p.verified(run.id);
});

test('stop-all: every run that has not finished is cancelled whatever it is doing; finished runs, uncertain runs and timers are left right', { timeout: 120000 }, async t => {
  const p = pair(t, { script: { [M]: [{ delayMs: 600000, value: { amount: 1 } }] } });
  const model = p.create(base([agent('ask')], [exists(ref('nodes.ask.amount'))], { id: 'StopModel' }), { raw: 'x' });
  const tool = p.create(base([hold('slow')], [done('slow')], { id: 'StopTool' }));
  const parked = p.create(base([{ id: 'pause', kind: 'wait', needs: [], description: 'Pause', delayMs: 3600000 }], [exists(ref('nodes.pause'))], { id: 'StopWait' }));
  const asking = p.create(base([human()], [exists(ref('nodes.ask'))], { id: 'StopAsk' }));
  const fresh = p.create(base([task('a', 'probe.step')], [done('a')], { id: 'StopFresh' }));
  const crashed = p.create(base([hold('lost')], [done('lost')], { id: 'StopCrashed' }));
  const finished = p.create(base([task('a', 'probe.step')], [done('a')], { id: 'StopDone' }));
  const doubt = p.create(base([task('c', 'probe.effect', { fail: true })], [done('c')], { id: 'StopDoubt' }));
  assert.equal((await p.owner.startRun(finished.id)).status, 'succeeded');
  assert.equal((await p.owner.startRun(doubt.id)).status, 'uncertain');
  assert.equal((await p.owner.startRun(parked.id)).status, 'waiting');
  assert.equal((await p.owner.startRun(asking.id)).status, 'awaiting_human');
  await crash(p.owner, crashed.id, { lost: { kind: 'task', tool: 'probe.step', effects: 'none' } });
  const modelRun = p.owner.startRun(model.id), toolRun = p.owner.startRun(tool.id);
  assert.ok(await until(() => p.provider.active === 1 && p.state.started.includes('slow')), 'a model call and a tool are in flight');

  const result = await p.other.stopAll({ actor: 'test', reason: 'everything stops', graceMs: 20000 });
  assert.deepEqual(result.failed, []);
  assert.deepEqual(result.results.map(r => [r.runId, r.outcome]).sort(), [model, tool, parked, asking, fresh, crashed].map(r => [r.id, 'cancelled']).sort());
  assert.deepEqual(result.skipped.map(s => s.runId), [doubt.id]);
  assert.equal(result.summary.cancelled, 6);
  assert.match(result.message, /6 of 6 runs cancelled; 1 left alone/);
  assert.equal(exitCodeOf(result), 0);
  assert.equal((await modelRun).status, 'cancelled');
  assert.equal((await toolRun).status, 'cancelled');
  for (const run of [model, tool, parked, asking, fresh, crashed]) {
    const header = p.other.store.rows.header(run.id);
    assert.deepEqual([header.status, header.verdict.verdict, header.owner], ['cancelled', 'inconclusive', null], run.workflowId);
    assert.equal(p.types(run.id).filter(type => type === 'cancel.requested').length, 1);
    p.verified(run.id);
  }
  assert.equal(p.other.store.rows.header(finished.id).status, 'succeeded');
  assert.equal(p.other.store.rows.header(doubt.id).status, 'uncertain');
  assert.deepEqual(p.other.store.openRunIds(), [doubt.id], 'only the uncertain run is still open');
  assert.equal((await p.other.tick({ now: Date.now() + 7200000 })).due, 0, 'no timer survives to restart anything');
  assert.equal(p.provider.active, 0);
  assert.equal(p.owner.active.size, 0);
  // Again: nothing left to stop.
  const again = await p.other.stopAll({ actor: 'test' });
  assert.equal(again.summary.requested, 0);
  assert.match(again.message, /0 of 0 runs cancelled/);
});

test('stop-all with executingOnly leaves parked and never-started runs alone', { timeout: 60000 }, async t => {
  const p = pair(t);
  const tool = p.create(base([hold('slow')], [done('slow')], { id: 'OnlyTool' }));
  const parked = p.create(base([{ id: 'pause', kind: 'wait', needs: [], description: 'Pause', delayMs: 3600000 }], [exists(ref('nodes.pause'))], { id: 'OnlyWait' }));
  const fresh = p.create(base([task('a', 'probe.step')], [done('a')], { id: 'OnlyFresh' }));
  assert.equal((await p.owner.startRun(parked.id)).status, 'waiting');
  const toolRun = p.owner.startRun(tool.id);
  assert.ok(await until(() => p.state.started.includes('slow')));
  const result = await p.other.stopAll({ actor: 'test', graceMs: 20000, executingOnly: true });
  assert.deepEqual(result.results.map(r => r.runId), [tool.id]);
  assert.deepEqual(result.skipped.map(s => [s.runId, s.status]).sort(), [[parked.id, 'waiting'], [fresh.id, 'ready']].sort());
  assert.equal((await toolRun).status, 'cancelled');
  assert.equal(p.other.store.rows.header(parked.id).status, 'waiting');
  assert.equal(p.other.store.timers(parked.id).length, 1, 'its timer is untouched');
  assert.equal(p.other.store.rows.header(fresh.id).status, 'ready');
});

test('zero grace: stop-all asks the owners and returns at once; the runs they execute record their own verdicts; exit code 0', { timeout: 60000 }, async t => {
  const p = pair(t);
  const tool = p.create(base([hold('slow')], [done('slow')], { id: 'AskTool' }));
  const parked = p.create(base([human()], [exists(ref('nodes.ask'))], { id: 'AskParked' }));
  assert.equal((await p.owner.startRun(parked.id)).status, 'awaiting_human');
  const running = p.owner.startRun(tool.id);
  assert.ok(await until(() => p.state.started.includes('slow')));
  const result = await p.other.stopAll({ actor: 'test', graceMs: 0, escalate: false });
  assert.deepEqual([result.summary.cancelled, result.summary.pending, result.summary.notStopped], [1, 1, 0]);
  assert.deepEqual(result.results.map(r => [r.workflowId, r.outcome]).sort(), [['AskParked', 'cancelled'], ['AskTool', 'requested']]);
  assert.match(result.message, /1 asked to stop/);
  assert.equal(exitCodeOf(result), 0);
  assert.equal((await running).status, 'cancelled');
});

test('a live owner that does not stop within the grace period is reported, not touched, unless forced; this process is never killed', { timeout: 60000 }, async t => {
  // The owner is this very process (a second Foundry in it) and cannot be stopped: its code runner ignores the signal until the test releases it.
  let release;
  const p = pair(t, { ownerOptions: { codeRunner: () => new Promise(resolve => { release = () => resolve({ value: { ok: true } }); }) } });
  t.after(() => release?.());
  const run = p.create(base([code('spin')], [eq(ref('nodes.spin.ok'), true)], { id: 'Stuck' }));
  const running = p.owner.startRun(run.id);
  assert.ok(await until(() => release !== undefined));
  const report = await p.other.cancel(run.id, { actor: 'test', graceMs: 300 });
  assert.equal(report.outcome, 'not-stopped');
  assert.equal(report.status, 'running');
  assert.equal(exitCodeOf(report), 3);
  assert.match(report.message, /had not stopped after 0\.\d s/);
  assert.match(report.message, /foundry cancel .* --force/);
  assert.equal(report.cancel.actor, 'test', 'the request is recorded and stands');
  const forced = await p.other.cancel(run.id, { actor: 'test', graceMs: 100, force: true });
  assert.equal(forced.outcome, 'not-stopped', 'the owner is this process: it is never signalled');
  assert.match(forced.escalation.skipped, /this process or one of its ancestors/);
  assert.equal(process.kill(process.pid, 0), true, 'still alive');
  // Zero grace: the request is recorded and the owner asked to stop, without waiting.
  assert.equal((await p.other.cancel(run.id, { actor: 'test', graceMs: 0 })).outcome, 'requested');
  release(); // the code finally returns; the run then sees the request
  const final = await running;
  assert.equal(final.status, 'cancelled', JSON.stringify(final.error));
  p.verified(run.id);
});

test('a capability that ignores its abort signal is abandoned after the grace period: no effect: cancelled; a non-idempotent effect: uncertain', { timeout: 60000 }, async t => {
  await t.test('no effects', async t => {
    const p = pair(t);
    const run = p.create(base([task('deaf', 'probe.deaf')], [done('deaf')]));
    const running = p.owner.startRun(run.id);
    assert.ok(await until(() => p.state.release.has('deaf')));
    const started = Date.now();
    const report = await p.other.cancel(run.id, { actor: 'test', graceMs: 20000 });
    assert.equal(report.outcome, 'cancelled', report.message);
    assert.ok(Date.now() - started < 10000, 'it did not wait for the tool\'s own timeout (two minutes)');
    assert.equal((await running).status, 'cancelled');
    p.state.release.get('deaf')(); // the abandoned call settles late: nothing records it
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(p.other.store.run(run.id).nodes.deaf.status, 'failed');
    p.verified(run.id);
  });
  await t.test('a non-idempotent effect', async t => {
    const p = pair(t);
    const run = p.create(base([task('send', 'probe.deaf-effect')], [done('send')]));
    const running = p.owner.startRun(run.id);
    assert.ok(await until(() => p.state.release.has('send')));
    const report = await p.other.cancel(run.id, { actor: 'test', graceMs: 20000 });
    assert.equal(report.outcome, 'uncertain', report.message);
    assert.deepEqual(report.effectsUnknown.items.map(x => x.nodeKey), ['root/send']);
    assert.equal((await running).status, 'uncertain');
    const event = p.other.store.events(run.id).find(e => e.type === 'effect.uncertain');
    assert.equal(event.cancellationConfirmed, false, 'the tool never confirmed that it stopped');
    p.state.release.get('send')();
    p.verified(run.id);
  });
});

test('a run that journals its model calls elsewhere is closed by a canceller only with that journal; one broken run does not stop the others; a broken chain is refused', { timeout: 60000 }, async t => {
  const p = pair(t);
  const external = new DatabaseSync(':memory:');
  t.after(() => external.close());
  const elsewhere = p.open({ models: () => new ModelPort({ policy: loaded.policy, providers: { 'llama-server': p.provider, 'claude-cli': p.provider }, journal: new Journal(external) }) });
  const pause = id => base([{ id: 'pause', kind: 'wait', needs: [], description: 'Pause for an hour', delayMs: 3600000 }], [exists(ref('nodes.pause'))], { id });
  const wf = pause('JournalElsewhere');
  elsewhere.save(wf);
  const remote = elsewhere.createRun(wf.id), plain = p.create(pause('JournalHere')), victim = p.create(pause('ChainBroken'));
  for (const run of [remote, plain, victim]) assert.equal((await p.owner.startRun(run.id)).status, 'waiting');
  assert.equal(p.other.store.events(remote.id)[0].journal, 'external', 'the birth event says where the journal is');
  p.other.store.db.prepare('DELETE FROM events WHERE run_id=? AND seq=(SELECT MAX(seq) FROM events WHERE run_id=?)').run(victim.id, victim.id);

  // Without the journal the seal cannot be made; the request is recorded and the run stays as it was.
  await assert.rejects(p.other.cancel(remote.id), error => error.code === 'JOURNAL_EXTERNAL' && /--journal FILE/.test(error.message));
  assert.equal(p.other.store.rows.header(remote.id).status, 'waiting');
  assert.equal(p.other.store.rows.header(remote.id).cancelRequest.actor, 'cli');
  // A broken chain is not appended to: nothing is written.
  await assert.rejects(p.other.cancel(victim.id), error => error.code === 'CORRUPT_EVENTS');
  assert.equal(p.other.store.rows.header(victim.id).cancelRequest, undefined);

  const result = await p.other.stopAll({ actor: 'test', executingOnly: false, graceMs: 1000 });
  assert.deepEqual(result.results.map(r => [r.runId, r.outcome]), [[plain.id, 'cancelled']], 'the healthy run was stopped');
  assert.deepEqual(result.failed.map(f => [f.runId, f.error.code]).sort(), [[remote.id, 'JOURNAL_EXTERNAL'], [victim.id, 'CORRUPT_EVENTS']].sort());
  assert.equal(exitCodeOf(result), 3);
  assert.match(result.message, /1 of 3 runs cancelled; 2 could not be cancelled/);

  // Given the other journal, the run that needs it is sealed against it; a run that journaled in the workspace is sealed against the workspace.
  const report = await p.other.cancel(remote.id, { actor: 'test', journalDb: external });
  assert.equal(report.outcome, 'cancelled', report.message);
  const verified = verifyRun(p.other.store, remote.id, { journalDb: external });
  assert.equal(verified.ok, true, JSON.stringify(verified.findings));
  p.verified(plain.id);
  const again = p.create(pause('JournalHereThree'));
  assert.equal((await p.owner.startRun(again.id)).status, 'waiting');
  assert.equal((await p.other.cancel(again.id, { actor: 'test', journalDb: external })).outcome, 'cancelled');
  p.verified(again.id);
});

test('escalation targets: the owner\'s sandboxes and model CLIs by process group, never this process, its ancestors or any group they are in', () => {
  const p = (pid, ppid, pgid, state = 'S') => ({ pid, ppid, pgid, state });
  // init(1) > shell(10, group 10) > tester(20, group 10: this process); shell > owner(30, leads group 30) > sandbox(40, group 40) > inner(41, 40);
  // owner > model CLI(50, group 50) > helper(51, 50); owner > a child in the owner's own group (60, group 30); unrelated process (99).
  const table = [p(1, 0, 1), p(10, 1, 10), p(20, 10, 10), p(30, 10, 30), p(40, 30, 40), p(41, 40, 40), p(50, 30, 50), p(51, 50, 50), p(60, 30, 30), p(99, 1, 99)];
  assert.deepEqual(ancestorsOf(table, 20), [20, 10, 1]);
  assert.deepEqual(descendantsOf(table, 30).map(x => x.pid).sort((a, b) => a - b), [40, 41, 50, 51, 60]);
  assert.deepEqual(escalationPlan(table, 30, 20), { owner: 30, groups: [40, 50], pids: [60] }, 'groups for the detached trees, pids for what shares the owner\'s group');
  // The owner shares a group with this process (both started from one shell): that group is never signalled, its members below the owner are killed by pid.
  const shared = [p(1, 0, 1), p(10, 1, 10), p(20, 10, 10), p(31, 10, 10), p(40, 31, 40), p(61, 31, 10), p(62, 61, 62)];
  assert.deepEqual(escalationPlan(shared, 31, 20), { owner: 31, groups: [40, 62], pids: [61] });
  // This process is below the owner (the owner started it): the owner is one of its ancestors, so nothing is signalled; a sibling subtree is fine.
  const nested = [...table, p(70, 30, 70), p(71, 70, 70), p(72, 71, 72)];
  assert.match(escalationPlan(nested, 30, 71).skipped, /this process or one of its ancestors/);
  assert.deepEqual(escalationPlan(nested, 30, 99), { owner: 30, groups: [40, 50, 70, 72], pids: [60] });
  // The owner is this process or an ancestor of it: nothing is signalled.
  assert.match(escalationPlan(table, 20, 20).skipped, /this process or one of its ancestors/);
  assert.match(escalationPlan(table, 10, 20).skipped, /this process or one of its ancestors/);
  assert.match(escalationPlan(table, 12345, 20).skipped, /already exited/);
  assert.match(escalationPlan([...table.filter(x => x.pid !== 30), p(30, 10, 30, 'Z')], 30, 20).skipped, /already exited/);
  // Zombies below the owner are not targets.
  assert.deepEqual(escalationPlan([...table.filter(x => x.pid !== 51), p(51, 50, 50, 'Z')], 30, 20), { owner: 30, groups: [40, 50], pids: [60] });
});

test('reaping what a dead owner left: a recorded group is killed only if it is still the recorded one, and never this process\'s own', async t => {
  const { reapChildren } = await import('../src/children.mjs');
  const p = pair(t);
  const run = p.create(base([task('a', 'probe.step')], [done('a')]));
  const row = (pid, start, kind = 'sandbox') => ({ pid, pgid: pid, start, kind });
  const proc = (pid, ppid, pgid, start, state = 'S') => ({ pid, ppid, pgid, start, state });
  const reap = (rows, table, selfPid = 20) => {
    p.other.store.forgetChildren(run.id);
    for (const r of rows) p.other.store.recordChild(run.id, r);
    const calls = [];
    const reaped = reapChildren(p.other.store, run.id, { table, selfPid, kill: (target, signal) => { calls.push([target, signal]); return true; } });
    assert.deepEqual(p.other.store.children(run.id), [], 'the rows are forgotten whatever happened');
    return { reaped, calls };
  };
  const idle = [proc(1, 0, 1, '1'), proc(10, 1, 10, '2'), proc(20, 10, 10, '3')];
  // The leader is the recorded process: its group is killed.
  assert.deepEqual(reap([row(40, '100')], [...idle, proc(40, 30, 40, '100'), proc(41, 40, 40, '101')]).calls, [[-40, 'SIGKILL']]);
  // The leader's pid now belongs to another process (reused): that group is not the recorded one.
  const reused = reap([row(40, '100')], [...idle, proc(40, 1, 40, '999')]);
  assert.deepEqual([reused.calls, reused.reaped], [[], [{ pid: 40, kind: 'sandbox', killed: false }]]);
  // The leader is gone and nothing of the group remains: nothing to kill.
  assert.deepEqual(reap([row(40, '100')], idle).calls, []);
  // The leader is gone but members remain (a helper that outlived it): the kernel does not reuse a group id while it has members, so they are the recorded group's.
  assert.deepEqual(reap([row(40, '100', 'process')], [...idle, proc(41, 1, 40, '101')]).calls, [[-40, 'SIGKILL']]);
  // A leader that exited but was not reaped yet (a zombie) with a live member.
  assert.deepEqual(reap([row(40, '100')], [...idle, proc(40, 1, 40, '100', 'Z'), proc(41, 1, 40, '101')]).calls, [[-40, 'SIGKILL']]);
  // A live leader whose start time was not recorded cannot be told apart from a process that reused the pid: left alone.
  assert.deepEqual(reap([row(40, null)], [...idle, proc(40, 30, 40, '100'), proc(41, 40, 40, '101')]).calls, []);
  // Never this process's own group or an ancestor's, whatever the file says.
  assert.deepEqual(reap([row(10, '2'), row(20, '3')], idle).calls, []);
  // Nothing on file: nothing to do.
  p.other.store.forgetChildren(run.id);
  assert.deepEqual(reapChildren(p.other.store, run.id, { kill: () => { throw new Error('nothing to kill'); } }), []);
});

test('exit codes: 0 stopped or nothing to stop, 2 an effect of unknown outcome, 3 not stopped', () => {
  assert.equal(exitCodeOf({ outcome: 'cancelled' }), 0);
  assert.equal(exitCodeOf({ outcome: 'already-finished' }), 0);
  assert.equal(exitCodeOf({ outcome: 'requested' }), 0);
  assert.equal(exitCodeOf({ outcome: 'uncertain' }), 2);
  assert.equal(exitCodeOf({ outcome: 'not-stopped' }), 3);
  assert.equal(exitCodeOf({ results: [], failed: [], summary: { notStopped: 0, uncertain: 0 } }), 0);
  assert.equal(exitCodeOf({ results: [], failed: [], summary: { notStopped: 0, uncertain: 1 } }), 2);
  assert.equal(exitCodeOf({ results: [], failed: [], summary: { notStopped: 1, uncertain: 1 } }), 3);
  assert.equal(exitCodeOf({ results: [], failed: [{}], summary: { notStopped: 0, uncertain: 0 } }), 3);
});

test('the run header carries the request: the Runtime refuses a bad poll interval, and a request is visible through the public run', async t => {
  const p = pair(t);
  assert.throws(() => p.open({ cancelPollMs: 0 }), error => error.code === 'POLICY');
  const run = p.create(base([hold('slow')], [done('slow')]));
  const running = p.owner.startRun(run.id);
  assert.ok(await until(() => p.state.started.includes('slow')));
  p.other.runtime.requestCancel(run.id, { actor: 'test', reason: 'visible' });
  assert.equal(p.other.inspectRun(run.id).cancelRequest.reason, 'visible');
  assert.equal((await running).status, 'cancelled', 'the owner found the request by polling');
  assert.equal(p.other.store.cancelRequest(run.id).actor, 'test');
  assert.equal(p.other.store.cancelRequest('no-such-run'), null);
});

test('HTTP: POST /api/runs/:id/cancel records a durable request for a run another handle executes, closes a parked run, and is a clear no-op for a finished one; /api/stop-all stops the rest', { timeout: 60000 }, async t => {
  const p = pair(t);
  const tool = p.create(base([hold('slow')], [done('slow')], { id: 'HttpTool' }));
  const parked = p.create(base([human()], [exists(ref('nodes.ask'))], { id: 'HttpParked' }));
  const finished = p.create(base([task('a', 'probe.step')], [done('a')], { id: 'HttpDone' }));
  const others = [p.create(base([hold('slow')], [done('slow')], { id: 'HttpTool2' })), p.create(base([human()], [exists(ref('nodes.ask'))], { id: 'HttpParked2' }))];
  const server = await serveHttp(p.other, { port: 0 });
  t.after(() => server.close());
  const token = (await (await fetch(`${server.origin}/`)).text()).match(/__FOUNDRY_TOKEN__="([0-9a-f]+)"/)[1];
  const post = async (url, body = {}) => { const response = await fetch(`${server.origin}${url}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-foundry-token': token }, body: JSON.stringify(body) }); return { status: response.status, body: await response.json() }; };
  assert.equal((await p.owner.startRun(parked.id)).status, 'awaiting_human');
  assert.equal((await p.owner.startRun(finished.id)).status, 'succeeded');
  // The control endpoints are mutating routes: no token, a wrong token or another origin is refused before anything is recorded.
  const bare = async (url, headers = {}) => (await fetch(`${server.origin}${url}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: '{}' })).status;
  assert.equal(await bare('/api/stop-all'), 403, 'no token');
  assert.equal(await bare(`/api/runs/${parked.id}/cancel`, { 'x-foundry-token': 'f'.repeat(64) }), 403, 'a wrong token');
  assert.equal(await bare('/api/stop-all', { 'x-foundry-token': token, origin: 'http://evil.example' }), 403, 'another origin');
  assert.equal(await bare(`/api/runs/${parked.id}/cancel`, { 'x-foundry-token': token, 'sec-fetch-site': 'cross-site' }), 403, 'a cross-site request');
  assert.equal(p.other.store.rows.header(parked.id).cancelRequest, undefined, 'nothing was recorded');
  assert.equal(p.other.store.rows.header(parked.id).status, 'awaiting_human');
  const toolRun = p.owner.startRun(tool.id);
  assert.ok(await until(() => p.state.started.includes('slow')));

  const running = await post(`/api/runs/${tool.id}/cancel`, { reason: 'from the page' });
  assert.equal(running.status, 202);
  assert.equal(running.body.outcome, 'requested');
  assert.equal(running.body.cancellationRequested, true);
  assert.equal((await toolRun).status, 'cancelled', 'the owner records the verdict on its own');
  assert.equal(p.other.store.rows.header(tool.id).error.message, 'Run cancelled by ui: from the page');

  const closed = await post(`/api/runs/${parked.id}/cancel`);
  assert.equal(closed.status, 200);
  assert.deepEqual([closed.body.outcome, closed.body.completed], ['cancelled', true]);

  const noop = await post(`/api/runs/${finished.id}/cancel`);
  assert.equal(noop.status, 200);
  assert.deepEqual([noop.body.outcome, noop.body.noop, noop.body.cancellationRequested], ['already-finished', true, false]);
  assert.match(noop.body.message, /already succeeded/);
  assert.equal((await post('/api/runs/no-such-run/cancel')).status, 404);

  const second = p.owner.startRun(others[0].id);
  assert.ok(await until(() => p.state.started.filter(id => id === 'slow').length === 2));
  assert.equal((await p.owner.startRun(others[1].id)).status, 'awaiting_human');
  const all = await post('/api/stop-all', { reason: 'everything' });
  assert.ok([200, 202].includes(all.status));
  assert.equal(all.body.summary.requested, 2);
  assert.equal((await second).status, 'cancelled');
  assert.equal(p.other.store.rows.header(others[1].id).status, 'cancelled');
  assert.equal((await post(`/api/runs/${tool.id}/cancel`)).body.noop, true);
});

// ---- Review regressions (adversarial review of cancel/stop-all, 2026-10-09) --------------------------------------------------------------

test('a cancel that lands while the run is pausing (a question, a timer) is honoured when the owner parks it, never left standing; a run that finished first keeps its result', { timeout: 60000 }, async t => {
  // The owner looks for a request when it takes the run and then only every minute here. The request lands while a tool runs (one that does
  // not watch its signal, so nothing aborts it); the tool then ends and the flow pauses. The canceller did not wait ('requested', as the UI
  // and `--grace 0` do), and a parked run has no owner to see the request: before the fix the run stayed parked with it unanswered.
  const p = pair(t, { ownerOptions: { cancelPollMs: 60000 } });
  const asking = p.create(base([task('gate', 'probe.deaf'), { ...human('ask'), needs: ['gate'] }], [exists(ref('nodes.ask'))], { id: 'RaceAsk' }));
  const pausing = p.create(base([task('gate', 'probe.deaf'), { id: 'pause', kind: 'wait', needs: ['gate'], description: 'Pause for an hour', delayMs: 3600000 }], [exists(ref('nodes.pause'))], { id: 'RaceWait' }));
  const finishing = p.create(base([task('gate', 'probe.deaf')], [done('gate')], { id: 'RaceDone' }));
  const finals = {};
  for (const run of [asking, pausing, finishing]) {
    const running = p.owner.startRun(run.id);
    assert.ok(await until(() => p.state.release.has('gate')));
    const report = await p.other.cancel(run.id, { actor: 'ui', reason: 'stop it', graceMs: 0 });
    assert.equal(report.outcome, 'requested', report.message);
    p.state.release.get('gate')(); p.state.release.delete('gate');
    finals[run.workflowId] = await running;
    p.verified(run.id);
  }
  for (const run of [asking, pausing]) {
    const final = finals[run.workflowId], events = p.other.store.events(run.id);
    assert.deepEqual([final.status, final.verdict.verdict, final.error.code, final.error.message, final.owner], ['cancelled', 'inconclusive', 'CANCELLED', 'Run cancelled by ui: stop it', null], run.workflowId);
    assert.deepEqual(events.slice(-2).map(e => e.type), ['run.verdict', 'run.stopped']);
    assert.equal(events.at(-1).cancel.actor, 'ui');
    assert.equal(final.nodes.gate.status, 'completed', 'the tool that ended on its own keeps its result');
  }
  // orch-20261021 patch 02: a cancel request in the record stops every new start inside the update that would start it, so the question
  // is never asked after the request committed (before the patch it was asked, then left open); the node ends as a stopped node does.
  assert.equal(finals.RaceAsk.nodes.ask.status, 'failed', 'the question is not asked after the cancel');
  assert.equal(finals.RaceAsk.nodes.ask.error?.code, 'CANCELLED');
  assert.throws(() => p.other.runtime.answer(asking.id, 'root/ask', true), error => error.code === 'RUN_CLOSED');
  assert.deepEqual(p.other.store.timers(pausing.id), [], 'the timer is gone: no tick restarts the run');
  assert.equal((await p.other.tick({ now: Date.now() + 2 * 3600000 })).due, 0);
  // Finished first: the result stands, the request stays in the record, and cancelling again is the no-op.
  assert.equal(finals.RaceDone.status, 'succeeded');
  assert.equal(p.other.store.rows.header(finishing.id).cancelRequest.actor, 'ui');
  assert.equal((await p.other.cancel(finishing.id)).outcome, 'already-finished');
});

test('a run whose cancellation was requested takes no answer or approval, even before it is closed; taking it over runs nothing', { timeout: 60000 }, async t => {
  const p = pair(t);
  const asking = p.create(base([human()], [exists(ref('nodes.ask'))], { id: 'NoAnswer' }));
  const gated = p.create(base([task('write', 'probe.gated')], [done('write')], { id: 'NoApproval' }));
  assert.equal((await p.owner.startRun(asking.id)).status, 'awaiting_human');
  assert.equal((await p.owner.startRun(gated.id)).status, 'awaiting_approval');
  const approvalId = Object.keys(p.other.store.rows.header(gated.id).approvals)[0];
  // The canceller recorded its requests and died before it closed the runs.
  for (const run of [asking, gated]) assert.equal(p.other.runtime.requestCancel(run.id, { actor: 'test' }).created, true);
  const heads = [asking, gated].map(run => p.other.store.rows.header(run.id).eventHead);
  assert.throws(() => p.other.runtime.answer(asking.id, 'root/ask', true), error => error.code === 'RUN_CLOSED' && /Cancellation of this run was requested by test/.test(error.message));
  assert.throws(() => p.other.runtime.approve(gated.id, approvalId, true, 'user'), error => error.code === 'RUN_CLOSED');
  assert.throws(() => p.other.runtime.approve(gated.id, approvalId, false, 'user'), error => error.code === 'RUN_CLOSED', 'a rejection would close it as cancelled for another reason');
  assert.deepEqual([asking, gated].map(run => p.other.store.rows.header(run.id).eventHead), heads, 'nothing was written');
  assert.equal((await p.owner.startRun(asking.id)).status, 'cancelled', 'a resume closes it without running anything');
  assert.equal((await p.other.cancel(gated.id)).outcome, 'cancelled');
  assert.equal(p.state.started.length, 0);
  for (const run of [asking, gated]) p.verified(run.id);
});

test('a cancellation that ended uncertain is not taken over again: resume returns it unchanged and writes nothing', { timeout: 60000 }, async t => {
  const p = pair(t);
  const run = p.create(base([hold('slow'), task('send', 'probe.effect', { hold: true })], [done('slow')]));
  const running = p.owner.startRun(run.id);
  assert.ok(await until(() => p.state.started.length === 2));
  assert.equal((await p.other.cancel(run.id, { actor: 'test', graceMs: 20000 })).outcome, 'uncertain');
  assert.equal((await running).status, 'uncertain');
  const before = p.other.store.rows.header(run.id).eventHead;
  const again = await p.owner.startRun(run.id);
  assert.deepEqual([again.status, again.owner], ['uncertain', null]);
  assert.deepEqual(p.other.store.rows.header(run.id).eventHead, before, 'no runner.acquired, no second seal');
  assert.equal((await p.other.cancel(run.id)).noop, true);
  p.verified(run.id);
});

test('a run closed by a canceller while an execution was starting is returned closed by that execution, not thrown as an error', { timeout: 60000 }, async t => {
  const p = pair(t);
  const run = p.create(base([task('a', 'probe.step')], [done('a')], { id: 'StartRace' }));
  const rows = p.owner.store.rows, original = rows.mismatchedRows;
  // The last check before the execution takes the run: the canceller closes it right then (as `stop-all` can while `foundry run` starts).
  rows.mismatchedRows = function (id) { p.other.runtime.closeCancelled(id, { actor: 'test' }); return original.call(this, id); };
  t.after(() => { rows.mismatchedRows = original; });
  const final = await p.owner.startRun(run.id);
  assert.equal(final.status, 'cancelled');
  assert.equal(p.state.started.length, 0);
  assert.equal(p.types(run.id).includes('runner.acquired'), false, 'it never took the run');
  p.verified(run.id);
});

test('settling what a dead owner left running: an idempotent effect is uncertain whether `cancel` or `resume` finishes, and the effects recorded at dispatch count', { timeout: 60000 }, async t => {
  const p = pair(t);
  for (const finish of ['cancel', 'resume']) {
    const run = p.create(base([task('write', 'probe.gated')], [done('write')], { id: `Idempotent${finish}` }));
    await crash(p.owner, run.id, { write: { kind: 'task', tool: 'probe.gated', effects: 'idempotent' } });
    p.other.runtime.requestCancel(run.id, { actor: 'test' });
    const status = finish === 'cancel' ? (await p.other.cancel(run.id)).status : (await p.owner.startRun(run.id)).status;
    assert.equal(status, 'uncertain', finish);
    assert.equal(p.other.store.rows.nodeState(run.id, 'root', 'write').status, 'uncertain', finish);
    p.verified(run.id);
  }
  // The registry now says the tool has no effect, but it was dispatched as non-idempotent (its tool.intent recorded that): still uncertain.
  const drifted = p.create(base([task('send', 'probe.step')], [done('send')], { id: 'EffectsRecorded' }));
  await crash(p.owner, drifted.id, { send: { kind: 'task', tool: 'probe.step', effects: 'non-idempotent' } });
  assert.equal((await p.other.cancel(drifted.id)).outcome, 'uncertain');
  p.verified(drifted.id);
});

test('an owner that exited but that its parent has not reaped (a zombie) is dead: its run is closed at once', { timeout: 60000 }, async t => {
  const { spawn } = await import('node:child_process');
  const { processStartStamp } = await import('../src/runtime.mjs');
  // `true` exits at once; its parent then becomes `sleep`, which never waits for it: a zombie until sleep ends.
  const parent = spawn('sh', ['-c', 'true & exec sleep 30'], { stdio: 'ignore' });
  t.after(() => { try { parent.kill('SIGKILL'); } catch {} });
  const zombie = await until(() => processes().find(x => x.ppid === parent.pid && x.state === 'Z')?.pid, 10000);
  assert.ok(zombie, 'a zombie exists');
  const p = pair(t);
  const run = p.create(base([hold('lost')], [done('lost')], { id: 'ZombieOwner' }));
  p.owner.store.updateRun(run.id, r => { r.status = 'running'; r.owner = { token: 'zombie', pid: zombie, processStart: processStartStamp(zombie), acquiredAt: Date.now() }; },
    { type: 'runner.acquired', token: 'zombie' }, { result: 'header' });
  const report = await p.other.cancel(run.id, { actor: 'test', graceMs: 5000 });
  assert.equal(report.outcome, 'cancelled', report.message);
  assert.ok(report.waitedMs < 2000, 'no grace period for a dead owner');
  p.verified(run.id);
});

test('the escalation never signals an owner it cannot identify: no start time on file means no signal', { timeout: 30000 }, async t => {
  const { spawn } = await import('node:child_process');
  const { killOwnerTree } = await import('../src/control.mjs');
  const child = spawn('sleep', ['30'], { stdio: 'ignore' });
  t.after(() => { try { child.kill('SIGKILL'); } catch {} });
  assert.ok(await until(() => processes().some(x => x.pid === child.pid)));
  const report = await killOwnerTree({ pid: child.pid, processStart: null });
  assert.match(report.skipped, /cannot be identified/);
  assert.equal(report.killed, false);
  assert.ok(processes().some(x => x.pid === child.pid && x.state !== 'Z'), 'still running');
});
