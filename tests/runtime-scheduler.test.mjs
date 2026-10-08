// Work-conserving dispatch (docs/ARCHITECTURE.md "Scheduling"; review 04-efficiency finding 4): a node starts as soon as its
// dependencies resolve and a continuation slot is free, never when a batch it was not part of finishes. Pinned here with gated
// synthetic capabilities (a node finishes when the test releases it or when another node has started), so no assertion depends on timing:
// the old batch barrier shows up as a probe that waits for a node the barrier would never start. The failure, pause, budget, cancel and
// resume semantics the batch dispatcher had are pinned too. The dispatch order is recorded on the chain (`dispatch`).
// Development/diagnostic evidence, not sealed evaluation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Store } from '../src/store.mjs';
import * as runtimeModule from '../src/runtime.mjs';
import { createDefaultRegistry } from '../src/capabilities.mjs';
import { validateWorkflow } from '../src/validate.mjs';
import { FoundryError } from '../src/data.mjs';
import { loadPolicy } from '../src/models/policy.mjs';
import { ModelPort } from '../src/models/port.mjs';
import { Journal } from '../src/journal.mjs';
import { ScriptedProvider } from '../src/models/providers/scripted.mjs';

const { Runtime } = runtimeModule;
const ref = $ref => ({ $ref });
const eq = (left, right) => ({ op: 'eq', left, right });
const base = (nodes, acceptance, budget = {}) => ({
  schemaVersion: '1.0', id: 'SchedulerProbe', version: 1, title: 'Scheduler probe', domain: 'diagnostic',
  goal: 'Exercise node dispatch with synthetic local capabilities and explicit oracles.',
  envelope: { assumptions: ['Synthetic local capabilities only'], risks: [], successCriteria: ['The asserted scheduling invariant holds.'] },
  budget: { maxSteps: 400, maxConcurrency: 4, maxDurationMs: 30000, maxCost: 0, ...budget }, nodes, acceptance
});
// A task node of the probe capability; `probe` is what the capability does (see rig()).
const step = (id, probe = {}, needs = [], extra = {}) => ({ id, kind: 'task', needs, description: `Synthetic scheduler probe ${id}`, tool: 'probe.step',
  args: { id, ...probe }, timeoutMs: 8000, retry: { maxAttempts: 1 }, ...extra });
const effect = (id, probe = {}, needs = []) => step(id, probe, needs, { tool: 'probe.effect' });
const done = id => eq(ref(`nodes.${id}.id`), id);
const abortion = signal => new Promise((_, reject) => {
  const stop = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError', code: 'ABORT_ERR' }));
  if (signal.aborted) stop(); else signal.addEventListener('abort', stop, { once: true });
});

// probe.step: records what started, finished, aborted and how many ran at once. `waitFor` holds the step until another has started
// (bounded: a scheduler that never starts it fails the step instead of hanging the test), `gated` until the test releases it,
// `hold` until it is aborted, `fail` makes it throw after its other waits.
function rig({ cost = 0 } = {}) {
  const state = { started: [], finished: [], aborted: [], active: 0, peak: 0 };
  const waiters = new Set(), gates = new Map();
  const changed = () => { for (const check of [...waiters]) check(); };
  // Resolves true when the predicate holds (checked on every probe event and every 5 ms), false after `ms`.
  const until = (predicate, ms = 4000) => new Promise(resolve => {
    if (predicate()) return resolve(true);
    const finish = value => { clearTimeout(timer); clearInterval(poll); waiters.delete(check); resolve(value); };
    const check = () => { if (predicate()) finish(true); };
    const timer = setTimeout(() => finish(false), ms), poll = setInterval(check, 5);
    waiters.add(check);
  });
  const gate = id => {
    if (!gates.has(id)) { let open; const promise = new Promise(resolve => { open = resolve; }); gates.set(id, { promise, open }); }
    return gates.get(id);
  };
  const execute = async ({ id, ms = 0, gated = false, waitFor = null, hold = false, fail = false }, { signal }) => {
    state.active++; state.peak = Math.max(state.peak, state.active); state.started.push(id); changed();
    try {
      if (waitFor && !(await until(() => state.started.includes(waitFor)))) throw new FoundryError('PROBE_STARVED', `${id} waited for ${waitFor}, which was never started`);
      if (gated) await Promise.race([gate(id).promise, abortion(signal)]);
      if (hold) await abortion(signal);
      if (ms) await delay(ms, undefined, { signal });
      if (fail) throw new FoundryError('PROBE_FAILED', `synthetic failure of ${id}`);
      state.finished.push(id); return { id };
    } catch (error) { if (signal.aborted) state.aborted.push(id); throw error; }
    finally { state.active--; changed(); }
  };
  const registry = createDefaultRegistry();
  // probe.effect is the same probe declared as a non-idempotent effect: a failure leaves its node uncertain.
  for (const [name, effects] of [['probe.step', 'none'], ['probe.effect', 'non-idempotent']]) registry.register({ name, description: 'Synthetic scheduler probe', version: '1',
    implementation: `scheduler-test/${name}`, inputSchema: {}, outputSchema: {}, effects, risk: 'low', requiresApproval: false, maxTimeoutMs: 10000, cancellation: 'cooperative', cost, execute });
  return { registry, state, until, settle: () => delay(5), release: id => { gate(id).open(); } };
}
function harness(t, workflow, { registry, policy = {}, input = {} } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'foundry-sched-'));
  const store = new Store(root);
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  const validation = validateWorkflow(workflow, { registry });
  assert.equal(validation.valid, true, JSON.stringify(validation.errors));
  store.saveWorkflow(workflow);
  const runtime = new Runtime(store, registry, { allowedCapabilities: registry.list().map(c => c.name), maxConcurrency: 4, ...policy });
  const run = runtime.create(workflow, input);
  return { store, runtime, run, events: type => store.events(run.id).filter(e => type === undefined || e.type === type) };
}
// The dispatch numbers on the chain, in dispatch order: [[nodeKey, number], ...].
const dispatches = events => events.filter(e => Number.isInteger(e.dispatch)).map(e => [e.nodeKey, e.dispatch]).sort((a, b) => a[1] - b[1]);

test('a node starts as soon as its dependencies resolve, not when the batch it was not part of finishes', async t => {
  const { registry, state } = rig();
  // slow and fast are ready together; `last` is three steps behind fast. The old dispatcher waited for slow before starting `mid`.
  const h = harness(t, base([step('slow', { waitFor: 'last' }), step('fast'), step('mid', {}, ['fast']), step('last', {}, ['mid'])], [done('slow'), done('last')]), { registry });
  const run = await h.runtime.execute(h.run.id);
  assert.equal(run.status, 'succeeded', JSON.stringify(run.error));
  assert.deepEqual(state.finished.slice(0, 3), ['fast', 'mid', 'last']);
  assert.equal(state.finished.at(-1), 'slow', 'slow finished last, after the chain it did not block');
});

test('a freed slot is refilled at once: with the cap full, the next ready node starts when any node finishes', async t => {
  const { registry, state } = rig();
  // cap 2: `long` holds one slot until s3 has started, so s1, s2 and s3 must run through the other slot one after another.
  const h = harness(t, base([step('long', { waitFor: 's3' }), step('s1'), step('s2'), step('s3')], [done('long'), done('s3')], { maxConcurrency: 2 }), { registry, policy: { maxConcurrency: 2 } });
  const run = await h.runtime.execute(h.run.id);
  assert.equal(run.status, 'succeeded', JSON.stringify(run.error));
  assert.deepEqual(state.started, ['long', 's1', 's2', 's3']);
  assert.equal(state.peak, 2);
});

test('in-flight nodes never exceed the smaller of the run policy and the workflow budget, and reach it', async t => {
  for (const [budget, policy, cap] of [[4, 2, 2], [2, 4, 2], [1, 3, 1], [3, 3, 3]]) {
    await t.test(`budget ${budget}, policy ${policy}`, async t => {
      const { registry, state } = rig();
      const nodes = Array.from({ length: 8 }, (_, i) => step(`n${i}`, { ms: 15 }));
      const h = harness(t, base(nodes, [done('n7')], { maxConcurrency: budget }), { registry, policy: { maxConcurrency: policy } });
      const run = await h.runtime.execute(h.run.id);
      assert.equal(run.status, 'succeeded', JSON.stringify(run.error));
      assert.equal(state.peak, cap);
      assert.equal(state.finished.length, 8);
    });
  }
});

test('ready nodes are dispatched in declaration order, and the dispatch order is recorded on the chain', async t => {
  const { registry, state } = rig();
  // declared c, a, b; b needs a. With one slot the order is fixed by the declaration order alone.
  const h = harness(t, base([step('c'), step('a'), step('b', {}, ['a'])], [done('c'), done('b')], { maxConcurrency: 1 }), { registry, policy: { maxConcurrency: 1 } });
  const run = await h.runtime.execute(h.run.id);
  assert.equal(run.status, 'succeeded', JSON.stringify(run.error));
  assert.deepEqual(state.started, ['c', 'a', 'b']);
  assert.deepEqual(dispatches(h.events()), [['root/c', 1], ['root/a', 2], ['root/b', 3]]);
  const first = new Map();
  for (const e of h.events()) if (e.nodeKey && !first.has(e.nodeKey)) first.set(e.nodeKey, e);
  assert.deepEqual([...first].map(([key, e]) => [key, e.type, e.dispatch]), [['root/c', 'tool.intent', 1], ['root/a', 'tool.intent', 2], ['root/b', 'tool.intent', 3]], 'a node carries its number on its first event');
  assert.equal(h.events().filter(e => e.dispatch !== undefined).length, 3, 'and on no other');
  assert.deepEqual(runtimeModule.dispatchOrder?.(h.events()), ['root/c', 'root/a', 'root/b']);
});

test('the recorded order is a function of the completion order: the same releases give the same chain', async t => {
  const trace = async (order) => {
    const { registry, state, until, release, settle } = rig();
    const nodes = [step('a', { gated: true }), step('b', { gated: true }), step('c', { gated: true }), step('d', { gated: true }, ['a']), step('e', { gated: true }, ['b']), step('f', {}, ['d', 'e'])];
    const h = harness(t, base(nodes, [done('c'), done('f')], { maxConcurrency: 3 }), { registry, policy: { maxConcurrency: 3 } });
    const running = h.runtime.execute(h.run.id);
    await until(() => state.started.length === 3);
    // After each release, wait until the scheduler has reacted (it only awaits microtasks, so a timer tick is enough).
    for (const id of order) { await until(() => state.started.includes(id)); release(id); await until(() => state.finished.includes(id)); await settle(); }
    const run = await running;
    assert.equal(run.status, 'succeeded', JSON.stringify(run.error));
    return { dispatches: dispatches(h.events()).map(([key, n]) => `${key}#${n}`), types: h.events().map(e => `${e.type}:${e.nodeKey ?? ''}`) };
  };
  const one = await trace(['b', 'a', 'e', 'c', 'd']), again = await trace(['b', 'a', 'e', 'c', 'd']), other = await trace(['a', 'b', 'd', 'c', 'e']);
  // cap 3: a, b, c first; after b finishes the freed slot goes to e (b's dependent) before d (a's), because b finished first.
  assert.deepEqual(one.dispatches, ['root/a#1', 'root/b#2', 'root/c#3', 'root/e#4', 'root/d#5', 'root/f#6']);
  assert.deepEqual(again, one, 'a second run with the same completion order has the same chain, event for event');
  assert.deepEqual(other.dispatches, ['root/a#1', 'root/b#2', 'root/c#3', 'root/d#4', 'root/e#5', 'root/f#6']);
});

test('dispatch numbers are run-wide and strictly increasing, across nested frames and across a resume', async t => {
  const { registry } = rig();
  const body = { nodes: [step('work'), step('after', {}, ['work'])], acceptance: [done('after')] };
  const nodes = [step('first'), { id: 'each', kind: 'map', needs: ['first'], description: 'Synthetic map', items: [1, 2, 3], maxItems: 3, concurrency: 2, body },
    { id: 'ask', kind: 'human', needs: ['first'], description: 'Synthetic question', question: 'Continue?', answerSchema: { type: 'boolean' } }, step('last', {}, ['each', 'ask'])];
  const h = harness(t, base(nodes, [done('last'), eq(ref('nodes.each.count'), 3)]), { registry });
  let run = await h.runtime.execute(h.run.id);
  assert.equal(run.status, 'awaiting_human', JSON.stringify(run.error));
  const before = dispatches(h.events());
  assert.ok(before.length >= 9, `first, each, ask and the three items' two nodes were dispatched: ${before.length}`);
  assert.deepEqual(before.map(([, n]) => n), before.map((_, i) => i + 1), 'numbers are consecutive from 1');
  assert.equal(new Set(before.map(([key]) => key)).size, before.length, 'each dispatch of this run is a different node');
  h.runtime.answer(h.run.id, 'root/ask', true);
  run = await h.runtime.execute(h.run.id);
  assert.equal(run.status, 'succeeded', JSON.stringify(run.error));
  const after = dispatches(h.events());
  assert.deepEqual(after.slice(0, before.length), before);
  assert.deepEqual(after.slice(before.length).map(([key]) => key), ['root/last'], 'the resume dispatched what was left, numbered after the earlier ones');
  assert.equal(after.at(-1)[1], before.length + 1);
});

test('work conservation holds inside nested frames: a map item\'s body is not batch-bound either', async t => {
  const { registry, state } = rig();
  // Inside the item, slow waits for `after`, which follows fast: a barrier between slow and fast would starve slow.
  const body = { nodes: [step('slow', { waitFor: 'after' }), step('fast'), step('after', {}, ['fast'])], acceptance: [done('slow'), done('after')] };
  const h = harness(t, base([{ id: 'each', kind: 'map', needs: [], description: 'Synthetic map', items: [1], maxItems: 1, concurrency: 1, body }], [eq(ref('nodes.each.count'), 1)]), { registry });
  const run = await h.runtime.execute(h.run.id);
  assert.equal(run.status, 'succeeded', JSON.stringify(run.error));
  assert.deepEqual(state.finished, ['fast', 'after', 'slow']);
});

test('a failing node stops new dispatch, aborts its running siblings, reports its own error, and leaves nothing running', async t => {
  const { registry, state } = rig();
  const h = harness(t, base([step('bad', { fail: true, ms: 10 }), step('stuck', { hold: true }), step('later', {}, ['bad']), step('also', {}, ['stuck'])], [done('later')]), { registry });
  const run = await h.runtime.execute(h.run.id);
  assert.equal(run.status, 'failed');
  assert.equal(run.error.code, 'PROBE_FAILED', 'the root failure, not the siblings\' cancellation');
  assert.deepEqual(state.started.sort(), ['bad', 'stuck']);
  assert.deepEqual(state.aborted, ['stuck']);
  assert.equal(state.active, 0, 'no node is still running when the run is reported failed');
  assert.deepEqual([...new Set(h.events('node.failed').map(e => e.nodeKey))].sort(), ['root/bad', 'root/stuck']);
  assert.equal(run.nodes.bad.status, 'failed');
  assert.equal(run.nodes.stuck.status, 'failed');
});

test('a failure also aborts nodes that were dispatched after the first wave, and starts none of its dependents', async t => {
  const { registry, state } = rig();
  // a2 is dispatched when a finishes; bad waits for a2 to be running, then fails.
  const h = harness(t, base([step('a'), step('a2', { hold: true }, ['a']), step('bad', { fail: true, waitFor: 'a2' }), step('after_bad', {}, ['bad'])], [done('after_bad')]), { registry });
  const run = await h.runtime.execute(h.run.id);
  assert.equal(run.status, 'failed');
  assert.equal(run.error.code, 'PROBE_FAILED');
  assert.deepEqual(state.aborted, ['a2']);
  assert.ok(!state.started.includes('after_bad'));
  assert.equal(state.active, 0);
});

test('a human question pauses only its own branch: independent work runs to the end, then the run waits for the answer', async t => {
  const { registry, state } = rig();
  const nodes = [{ id: 'ask', kind: 'human', needs: [], description: 'Synthetic question', question: 'Proceed?', answerSchema: { type: 'boolean' } },
    step('side1', { ms: 10 }), step('side2', { ms: 10 }, ['side1']), step('blocked', {}, ['ask'])];
  const h = harness(t, base(nodes, [done('side2'), done('blocked')]), { registry });
  let run = await h.runtime.execute(h.run.id);
  assert.equal(run.status, 'awaiting_human');
  assert.deepEqual(state.finished, ['side1', 'side2']);
  assert.equal(run.nodes.blocked, undefined, 'a dependent of the open question did not start');
  h.runtime.answer(h.run.id, 'root/ask', true);
  run = await h.runtime.execute(h.run.id);
  assert.equal(run.status, 'succeeded', JSON.stringify(run.error));
  assert.deepEqual(state.started, ['side1', 'side2', 'blocked'], 'finished work was not rerun');
});

test('an uncertain effect stops new dispatch; running siblings finish, nothing downstream starts', async t => {
  const { registry, state, release, until } = rig();
  const h = harness(t, base([effect('effect', { fail: true }), step('side', { gated: true }), step('after_side', {}, ['side']), step('after_effect', {}, ['effect'])], [done('after_side')]), { registry });
  const running = h.runtime.execute(h.run.id);
  await until(() => h.events('effect.uncertain').length === 1);
  release('side');
  const run = await running;
  assert.equal(run.status, 'uncertain');
  assert.deepEqual(state.finished, ['side'], 'the running sibling was allowed to finish');
  assert.deepEqual(state.started.sort(), ['effect', 'side']);
  assert.equal(run.nodes.after_side, undefined);
  assert.equal(run.nodes.after_effect, undefined);
});

test('a step budget is reserved atomically under concurrency: the run never charges more steps than its budget', async t => {
  const { registry, state } = rig();
  const nodes = Array.from({ length: 6 }, (_, i) => step(`n${i}`, { ms: 20 }));
  const h = harness(t, base(nodes, [done('n5')], { maxSteps: 3, maxConcurrency: 6 }), { registry, policy: { maxConcurrency: 6 } });
  const run = await h.runtime.execute(h.run.id);
  assert.equal(run.status, 'failed');
  assert.equal(run.error.code, 'STEP_BUDGET');
  assert.equal(run.steps, 3);
  assert.equal(h.events('tool.intent').length, 3, 'one intent per charged step');
  assert.equal(state.active, 0);
});

test('a cost budget is reserved before the call starts: reservations that do not fit are refused', async t => {
  const { registry, state } = rig({ cost: 0.4 });
  const nodes = Array.from({ length: 4 }, (_, i) => step(`n${i}`, { ms: 20 }));
  const h = harness(t, base(nodes, [done('n3')], { maxConcurrency: 4, maxCost: 1 }), { registry, policy: { maxConcurrency: 4, maxCost: 1 } });
  const run = await h.runtime.execute(h.run.id);
  assert.equal(run.status, 'failed');
  assert.equal(run.error.code, 'COST_BUDGET');
  assert.ok(run.cost <= 1 + 1e-9 && run.cost >= 0.8 - 1e-9, `charged ${run.cost}`);
  assert.equal(h.events('tool.intent').length, 2);
  assert.equal(state.active, 0);
});

test('cancelling stops running nodes and starts nothing new', async t => {
  const { registry, state, until } = rig();
  const h = harness(t, base([step('a', { hold: true }), step('b', { hold: true }), step('c', {}, ['a'])], [done('c')]), { registry });
  const controller = new AbortController();
  const running = h.runtime.execute(h.run.id, { signal: controller.signal });
  await until(() => state.started.length === 2);
  controller.abort();
  const run = await running;
  assert.equal(run.status, 'cancelled');
  assert.deepEqual(state.aborted.sort(), ['a', 'b']);
  assert.deepEqual(state.started.sort(), ['a', 'b']);
  assert.equal(state.active, 0);
});

test('the run deadline ends the run with DEADLINE and leaves nothing running', async t => {
  const { registry, state } = rig();
  const h = harness(t, base([step('a', { hold: true }), step('b', { ms: 5 }), step('c', {}, ['b'])], [done('c')], { maxDurationMs: 300 }), { registry });
  const run = await h.runtime.execute(h.run.id);
  assert.equal(run.status, 'failed');
  assert.equal(run.error.code, 'DEADLINE');
  assert.equal(state.active, 0);
});

test('a wide flat frame dispatches every node once, in declaration order, within the cap', async t => {
  const { registry, state } = rig();
  const nodes = Array.from({ length: 150 }, (_, i) => step(`n${String(i).padStart(3, '0')}`));
  const h = harness(t, base(nodes, [done('n149')], { maxConcurrency: 4, maxSteps: 1000 }), { registry, policy: { maxSteps: 1000 } });
  const run = await h.runtime.execute(h.run.id);
  assert.equal(run.status, 'succeeded', JSON.stringify(run.error));
  assert.equal(state.finished.length, 150);
  assert.ok(state.peak <= 4);
  assert.deepEqual(state.started, nodes.map(n => n.id), 'immediate nodes start in declaration order');
  assert.deepEqual(dispatches(h.events()).map(([key]) => key), nodes.map(n => `root/${n.id}`));
});

test('model nodes are scheduled the same way, and a replay of the run records the same dispatch order', async t => {
  const amount = { type: 'object', additionalProperties: false, required: ['amount'], properties: { amount: { type: 'number' } } };
  const agent = (id, instructions, needs = []) => ({ id, kind: 'agent', needs, description: 'Return an amount', role: 'extract', instructions,
    context: { inputs: [{ name: 'raw', ref: 'input.raw', render: 'text' }] }, returns: amount, model: { class: 'S', maxClass: 'M' },
    checks: [{ op: 'gte', left: { $ref: 'output.amount' }, right: 0 }] });
  const workflow = base([agent('slow', 'SLOWNODE Return the amount.'), agent('fast', 'Return the amount.'), agent('next', 'Return the amount.', ['fast'])], [eq(ref('nodes.next.amount'), 1)]);
  const root = mkdtempSync(path.join(tmpdir(), 'foundry-sched-'));
  const store = new Store(root), loaded = loadPolicy();
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  store.saveWorkflow(workflow);
  const runtime = script => {
    const provider = new ScriptedProvider(script, { concurrency: 4 }); // the port's default is one call at a time per provider
    const models = new ModelPort({ policy: loaded.policy, providers: { 'llama-server': provider, 'claude-cli': provider }, journal: new Journal(store) });
    return { provider, runtime: new Runtime(store, createDefaultRegistry(), { maxCost: 1, maxConcurrency: 4 }, { models, modelPolicy: loaded }) };
  };
  const live = runtime(args => ({ value: { amount: 1 }, delayMs: args.system.includes('SLOWNODE') ? 600 : 0 }));
  const first = await live.runtime.execute(live.runtime.create(workflow, { raw: 'one' }, { sampleSalt: 'sched:1' }).id);
  assert.equal(first.status, 'succeeded', JSON.stringify(first.error));
  const completed = id => store.events(first.id).findIndex(e => e.type === 'node.completed' && e.nodeKey === id);
  assert.ok(completed('root/next') > 0 && completed('root/next') < completed('root/slow'), 'next finished while slow was still being asked');
  assert.deepEqual(runtimeModule.dispatchOrder?.(store.events(first.id)), ['root/slow', 'root/fast', 'root/next']);
  const silent = runtime(() => { throw new Error('the provider must not be called'); });
  const second = await silent.runtime.execute(silent.runtime.create(workflow, { raw: 'one' }, { modelMode: 'replay', sampleSalt: 'sched:1' }).id);
  assert.equal(second.status, 'succeeded', JSON.stringify(second.error));
  assert.equal(silent.provider.calls.length, 0);
  assert.deepEqual(runtimeModule.dispatchOrder?.(store.events(second.id)), runtimeModule.dispatchOrder?.(store.events(first.id)));
});
