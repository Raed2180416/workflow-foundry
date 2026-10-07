// Durable wait timers (DESIGN §5.4): wait nodes register wake times in the workspace store; `tick`
// (Runtime, Foundry, `foundry tick`, the serve scan) resumes runs whose timers are due, across restarts.
// Synthetic local capabilities and a scripted model provider only. Development/diagnostic evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { Store } from '../src/store.mjs';
import { Runtime } from '../src/runtime.mjs';
import { Foundry } from '../src/foundry.mjs';
import { serveHttp } from '../src/http.mjs';
import { createDefaultRegistry } from '../src/capabilities.mjs';
import { loadPolicy } from '../src/models/policy.mjs';
import { ModelPort } from '../src/models/port.mjs';
import { Journal } from '../src/journal.mjs';
import { ScriptedProvider } from '../src/models/providers/scripted.mjs';

const cli = new URL('../bin/foundry.mjs', import.meta.url).pathname;
const ref = $ref => ({ $ref });
const pause = (delayMs, needs = []) => ({ id: 'pause', kind: 'wait', needs, description: 'Pause before echoing', delayMs });
const echo = (needs = ['pause']) => ({ id: 'echo', kind: 'task', needs, description: 'Echo the input', tool: 'core.identity', args: { v: ref('input.v') }, timeoutMs: 1000, retry: { maxAttempts: 1 } });
const workflow = (nodes, acceptance = [{ op: 'eq', left: ref('nodes.echo.v'), right: ref('input.v') }], id = 'TimerProbe') => ({
  schemaVersion: '1.0', id, version: 1, title: 'Timer probe', goal: 'Pause, then echo the input', domain: 'diagnostic',
  envelope: { assumptions: ['Synthetic local input'], risks: [], successCriteria: ['The echo happens after the wait'] },
  budget: { maxSteps: 50, maxConcurrency: 2, maxDurationMs: 60000 }, nodes, acceptance });
const loaded = loadPolicy();
function space(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'foundry-timers-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
function open(t, root, options = {}) {
  const store = new Store(root);
  t.after(() => { try { store.close(); } catch {} });
  return { store, runtime: new Runtime(store, createDefaultRegistry(), {}, options) };
}
const until = async (predicate, timeoutMs = 5000) => {
  const end = Date.now() + timeoutMs;
  while (!predicate()) { if (Date.now() > end) throw new Error('condition not reached'); await delay(20); }
};

test('timers: a wait registers its wake time with its state; tick resumes only once it is due, then the timer is gone', async t => {
  const root = space(t), { store, runtime } = open(t, root), wf = workflow([pause(250), echo()]);
  store.saveWorkflow(wf);
  const created = runtime.create(wf, { v: 7 });
  let run = await runtime.execute(created.id);
  assert.equal(run.status, 'waiting');
  const wakeAt = run.nodes.pause.wakeAt;
  assert.deepEqual(store.timers(run.id), [{ runId: run.id, nodeKey: 'root/pause', wakeAt }]);
  const started = store.events(run.id).find(e => e.type === 'node.started' && e.nodeKey === 'root/pause');
  assert.equal(started.wakeAt, wakeAt, 'the wake time is fixed when the wait starts, so a crash before it pauses keeps it');
  assert.deepEqual(store.dueTimers(wakeAt - 1), []);
  assert.equal(store.dueTimers(wakeAt).length, 1);

  const early = await runtime.tick();
  assert.deepEqual([early.due, early.runs], [0, []], 'nothing is resumed before the wake time');
  assert.equal(store.run(run.id).status, 'waiting');
  await delay(Math.max(0, wakeAt - Date.now()) + 20);
  const due = await runtime.tick();
  assert.deepEqual(due.runs, [{ runId: run.id, status: 'succeeded' }]);
  run = store.run(run.id);
  assert.equal(run.outputs.echo.v, 7);
  assert.deepEqual(store.timers(run.id), [], 'completion clears the timer in the same commit');
  assert.equal((await runtime.tick({ now: wakeAt + 60000 })).due, 0);
});

test('timers: after a restart, a new Store and Runtime instance resumes the due run', async t => {
  const root = space(t), first = open(t, root), wf = workflow([pause(150), echo()]);
  first.store.saveWorkflow(wf);
  const created = first.runtime.create(wf, { v: 'restart' });
  assert.equal((await first.runtime.execute(created.id)).status, 'waiting');
  first.store.close();
  await delay(200);
  const second = open(t, root);
  const result = await second.runtime.tick();
  assert.deepEqual(result.runs, [{ runId: created.id, status: 'succeeded' }]);
  assert.equal(second.store.run(created.id).outputs.echo.v, 'restart');
});

test('timers: `foundry tick` in a new process resumes due runs and reports the rest as not yet due', async t => {
  const root = space(t), { store, runtime } = open(t, root), wf = workflow([pause(60000), echo()]);
  store.saveWorkflow(wf);
  const created = runtime.create(wf, { v: 3 });
  assert.equal((await runtime.execute(created.id)).status, 'waiting');
  store.close();
  const tick = () => {
    const child = spawnSync(process.execPath, [cli, 'tick', '--workspace', root], { encoding: 'utf8', timeout: 20000, env: { PATH: process.env.PATH ?? '' } });
    assert.equal(child.status, 0, child.stderr);
    return JSON.parse(child.stdout);
  };
  assert.equal(tick().due, 0);
  // Advance this run's clock instead of sleeping a minute: the node state and its timer move together.
  const shifted = open(t, root).store, wakeAt = Date.now() - 1;
  shifted.updateRun(created.id, r => { r.nodes.pause.wakeAt = wakeAt; shifted.setTimer(r.id, 'root/pause', wakeAt); }, { type: 'test.clock-advanced' });
  shifted.close();
  const due = tick();
  assert.deepEqual(due.runs, [{ runId: created.id, status: 'succeeded' }]);
  const reopened = open(t, root).store;
  assert.equal(reopened.run(created.id).status, 'succeeded');
  assert.deepEqual(reopened.timers(created.id), []);
});

test('timers: a run interrupted while starting a wait keeps its wake time and is resumed by tick', async t => {
  const root = space(t), { store, runtime } = open(t, root), wf = workflow([pause(150), echo()]);
  store.saveWorkflow(wf);
  const created = runtime.create(wf, { v: 1 });
  await runtime.execute(created.id);
  const { wakeAt } = store.run(created.id).nodes.pause;
  // The state a crash between the wait's start and its pause leaves: a running node and a dead owner.
  store.updateRun(created.id, r => { r.nodes.pause.status = 'running'; r.status = 'running'; r.owner = { token: 'lost', pid: 2 ** 22 + 12345, processStart: null, acquiredAt: Date.now() }; }, { type: 'test.simulated-crash' });
  assert.deepEqual(store.timers(created.id).map(x => x.wakeAt), [wakeAt]);
  await delay(Math.max(0, wakeAt - Date.now()) + 20);
  const result = await runtime.tick();
  assert.deepEqual(result.runs, [{ runId: created.id, status: 'succeeded' }]);
  assert.equal(store.events(created.id).filter(e => e.type === 'node.completed' && e.nodeKey === 'root/pause').length, 1);
});

test('timers: terminal runs drop their timers and tick prunes timers whose node no longer waits', async t => {
  const root = space(t), { store, runtime } = open(t, root), wf = workflow([pause(60000), echo()]);
  store.saveWorkflow(wf);
  const created = runtime.create(wf, { v: 1 });
  assert.equal((await runtime.execute(created.id)).status, 'waiting');
  assert.equal(store.timers(created.id).length, 1);
  const controller = new AbortController(); controller.abort();
  assert.equal((await runtime.execute(created.id, { signal: controller.signal })).status, 'cancelled');
  assert.deepEqual(store.timers(created.id), [], 'a terminal run keeps no timers');

  const done = runtime.create(wf, { v: 2 });
  store.setTimer(done.id, 'root/pause', 1);
  store.setTimer(done.id, 'root/missing', 1);
  const result = await runtime.tick({ now: 10 });
  assert.deepEqual([result.due, result.runs], [0, []], 'a timer for a node that is not waiting is pruned, never resumed');
  assert.deepEqual(store.timers(done.id), []);
  assert.equal(store.run(done.id).status, 'ready');
});

test('timers: tick leaves a model run untouched when the runtime has no ModelPort, and a wired runtime resumes it', async t => {
  const root = space(t), S = 'qwen3.5-2b-q4km';
  const amount = { type: 'object', additionalProperties: false, required: ['amount'], properties: { amount: { type: 'number' } } };
  const agent = { id: 'norm', kind: 'agent', needs: ['pause'], description: 'Read the amount', role: 'extract', instructions: 'Return the amount as a number.',
    context: { inputs: [{ name: 'raw', ref: 'input.v', render: 'text' }] }, returns: amount, model: { class: 'S' } };
  const wf = workflow([pause(150), agent], [{ op: 'gte', left: ref('nodes.norm.amount'), right: 0 }], 'TimerModelProbe');
  const bare = open(t, root, { modelPolicy: loaded });
  bare.store.saveWorkflow(wf);
  const created = bare.runtime.create(wf, { v: 'five' });
  assert.equal((await bare.runtime.execute(created.id)).status, 'waiting');
  await delay(200);
  const skipped = await bare.runtime.tick();
  assert.deepEqual(skipped.runs, [{ runId: created.id, skipped: 'MODEL_PORT_REQUIRED' }]);
  assert.equal(bare.store.run(created.id).status, 'waiting', 'a missing port never fails the run');
  assert.equal(bare.store.timers(created.id).length, 1);

  const provider = new ScriptedProvider({ [S]: [{ value: { amount: 5 } }] });
  const models = new ModelPort({ policy: loaded.policy, providers: { 'llama-server': provider, 'claude-cli': provider }, journal: new Journal(bare.store) });
  const wired = new Runtime(bare.store, createDefaultRegistry(), {}, { models, modelPolicy: loaded });
  assert.deepEqual((await wired.tick()).runs, [{ runId: created.id, status: 'succeeded' }]);
  assert.deepEqual(bare.store.run(created.id).outputs.norm, { amount: 5 });
});

test('timers: waits inside a parallel map get one timer per item and one resume per run', async t => {
  const root = space(t), { store, runtime } = open(t, root);
  const wf = workflow([{ id: 'each', kind: 'map', needs: [], description: 'Pause per item', items: ref('input.items'), maxItems: 4, concurrency: 2,
    body: { nodes: [pause(150), { ...echo(), args: { v: ref('item') } }], acceptance: [{ op: 'eq', left: ref('nodes.echo.v'), right: ref('item') }] } }],
  [{ op: 'eq', left: ref('nodes.each.count'), right: 2 }]);
  store.saveWorkflow(wf);
  const created = runtime.create(wf, { items: ['a', 'b'] });
  assert.equal((await runtime.execute(created.id)).status, 'waiting');
  assert.deepEqual(store.timers(created.id).map(x => x.nodeKey), ['root/each:0/pause', 'root/each:1/pause']);
  await delay(200);
  const result = await runtime.tick();
  assert.deepEqual([result.due, result.runs], [1, [{ runId: created.id, status: 'succeeded' }]]);
  assert.deepEqual(store.run(created.id).outputs.each.items.map(item => item.echo.v), ['a', 'b']);
  assert.deepEqual(store.timers(created.id), []);
});

test('timers: serve scans due timers on its interval', async t => {
  const root = space(t), foundry = new Foundry(root);
  const service = await serveHttp(foundry, { port: 0, tickIntervalMs: 50 });
  t.after(async () => { await service.close(); await foundry.close(); });
  foundry.save(workflow([pause(150), echo()], undefined, 'ServeTimerProbe'));
  const created = foundry.createRun('ServeTimerProbe', { v: 'served' });
  assert.equal((await foundry.startRun(created.id)).status, 'waiting');
  await until(() => foundry.store.run(created.id).status === 'succeeded');
  assert.equal(foundry.store.run(created.id).outputs.echo.v, 'served');
  await assert.rejects(serveHttp(foundry, { port: 0, tickIntervalMs: -1 }), { code: 'HTTP_TICK' });
});

test('timers: setTimer and dueTimers validate their arguments', t => {
  const root = space(t), { store } = open(t, root);
  assert.throws(() => store.setTimer('run', 'root/pause', 1.5), { code: 'TIMER' });
  assert.throws(() => store.dueTimers(Date.now(), 0), { code: 'TIMER' });
});
