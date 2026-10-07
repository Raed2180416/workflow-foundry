// Parallel map (DESIGN §1.4): bounded concurrency, index-ordered outputs, fail_fast and collect with per-item
// isolation, and resume of incomplete items only. Synthetic local capabilities and a scripted model provider:
// no network, no model spend. Development/diagnostic evidence, not sealed evaluation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { Store } from '../src/store.mjs';
import { Runtime } from '../src/runtime.mjs';
import { createDefaultRegistry } from '../src/capabilities.mjs';
import { validateWorkflow } from '../src/validate.mjs';
import { FoundryError } from '../src/data.mjs';
import { loadPolicy } from '../src/models/policy.mjs';
import { ModelPort } from '../src/models/port.mjs';
import { Journal } from '../src/journal.mjs';
import { ScriptedProvider } from '../src/models/providers/scripted.mjs';

const ref = $ref => ({ $ref });
const eq = (left, right) => ({ op: 'eq', left, right });
const exists = value => ({ op: 'exists', value });
const base = (nodes, acceptance, budget = {}) => ({
  schemaVersion: '1.0', id: 'MapProbe', version: 1, title: 'Parallel map probe', domain: 'diagnostic',
  goal: 'Exercise parallel map semantics with synthetic local inputs and explicit oracles.',
  envelope: { assumptions: ['Synthetic local capabilities only'], risks: [], successCriteria: ['The asserted map invariant holds.'] },
  budget: { maxSteps: 200, maxConcurrency: 4, maxDurationMs: 20000, maxCost: 0, ...budget }, nodes, acceptance
});
const task = (id, tool, args, needs = []) => ({ id, kind: 'task', needs, description: `Synthetic probe ${id}`, tool, args, timeoutMs: 5000, retry: { maxAttempts: 1 } });
const map = (extra = {}, body = { nodes: [task('work', 'probe.work', { value: ref('item') })], acceptance: [exists(ref('nodes.work.value'))] }) => ({
  id: 'each', kind: 'map', needs: [], description: 'Synthetic parallel map', items: ref('input.items'), maxItems: 20, body, ...extra });
const values = output => output.items.map(item => item.work?.value ?? item);

// probe.work: records in-flight concurrency, start/completion order and cancellations.
function probe({ delayFor = () => 20, fails = () => false } = {}) {
  const state = { active: 0, peak: 0, started: [], completed: [], aborted: 0 };
  const registry = createDefaultRegistry();
  const execute = async ({ value }, { signal }) => {
    state.active++; state.peak = Math.max(state.peak, state.active); state.started.push(value);
    try {
      try { await delay(delayFor(value), undefined, { signal }); }
      catch (error) { state.aborted++; throw error; }
      if (fails(value)) throw new FoundryError('PROBE_FAILED', `synthetic failure for ${value}`);
      state.completed.push(value); return { value: typeof value === 'number' ? value * 10 : value };
    } finally { state.active--; }
  };
  for (const name of ['probe.work', 'probe.other']) registry.register({ name, description: 'Synthetic map probe', version: '1', implementation: `map-test/${name}`,
    inputSchema: {}, outputSchema: {}, effects: 'none', risk: 'low', requiresApproval: false, maxTimeoutMs: 10000, cancellation: 'cooperative', cost: 0, execute });
  return { registry, state };
}
function harness(t, workflow, { registry, policy = {}, input = {}, models = null } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'foundry-map-'));
  const store = new Store(root);
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  const loaded = models ? loadPolicy() : null;
  const validation = validateWorkflow(workflow, { registry, ...(loaded ? { modelPolicy: loaded } : {}) });
  assert.equal(validation.valid, true, JSON.stringify(validation.errors));
  store.saveWorkflow(workflow);
  const runtime = new Runtime(store, registry, { allowedCapabilities: registry.list().map(c => c.name), maxConcurrency: 4, ...policy }, models ? { models: models(store, loaded), modelPolicy: loaded } : {});
  const run = runtime.create(workflow, input);
  return { root, store, runtime, run, validation, events: type => store.events(run.id).filter(e => e.type === type) };
}

test('map: in-flight items never exceed concurrency and reach it; outputs stay index-ordered', async t => {
  const { registry, state } = probe();
  const h = harness(t, base([map({ concurrency: 3 })], [eq(ref('nodes.each.count'), 8)]), { registry, input: { items: [1, 2, 3, 4, 5, 6, 7, 8] } });
  const run = await h.runtime.execute(h.run.id);
  assert.equal(run.status, 'succeeded', JSON.stringify(run.error));
  assert.equal(state.peak, 3, 'observed in-flight items equal the declared concurrency');
  assert.deepEqual(values(run.outputs.each), [10, 20, 30, 40, 50, 60, 70, 80]);
  assert.equal(h.events('map.item.completed').length, 8);
  assert.equal(run.outputs.each.failed, undefined, 'fail_fast output keeps the {items, count} shape');
});

test('map: the default is one item at a time', async t => {
  const { registry, state } = probe();
  const h = harness(t, base([map()], [eq(ref('nodes.each.count'), 4)]), { registry, input: { items: [1, 2, 3, 4] } });
  const run = await h.runtime.execute(h.run.id);
  assert.equal(run.status, 'succeeded', JSON.stringify(run.error));
  assert.equal(state.peak, 1);
  assert.deepEqual(state.started, [1, 2, 3, 4]);
});

test('map: completion order is shuffled but outputs are ordered by index, never by completion', async t => {
  const { registry, state } = probe({ delayFor: value => (6 - value) * 60 });
  const h = harness(t, base([map({ concurrency: 6 })], [eq(ref('nodes.each.count'), 6)], { maxConcurrency: 6 }), { registry, policy: { maxConcurrency: 6 }, input: { items: [0, 1, 2, 3, 4, 5] } });
  const run = await h.runtime.execute(h.run.id);
  assert.equal(run.status, 'succeeded', JSON.stringify(run.error));
  assert.deepEqual(state.completed, [5, 4, 3, 2, 1, 0], 'later items finished first');
  assert.deepEqual(h.events('map.item.completed').map(e => e.index), [5, 4, 3, 2, 1, 0]);
  assert.deepEqual(values(run.outputs.each), [0, 10, 20, 30, 40, 50]);
});

test('map: the run semaphore still bounds concurrent capability calls inside parallel items', async t => {
  const { registry, state } = probe();
  const body = { nodes: [task('work', 'probe.work', { value: ref('item') }), task('other', 'probe.other', { value: ref('item') })], acceptance: [exists(ref('nodes.other.value'))] };
  const h = harness(t, base([map({ concurrency: 4 }, body)], [eq(ref('nodes.each.count'), 8)]), { registry, policy: { maxConcurrency: 3 }, input: { items: [1, 2, 3, 4, 5, 6, 7, 8] } });
  const run = await h.runtime.execute(h.run.id);
  assert.equal(run.status, 'succeeded', JSON.stringify(run.error));
  assert.equal(state.started.length, 16);
  assert.equal(state.peak, 3, 'two calls per item, at most three items, but only three calls at once');
});

test('map: the run semaphore bounds concurrent model calls inside parallel items', async t => {
  const M = 'claude-haiku-4-5-20251001';
  const amount = { type: 'object', additionalProperties: false, required: ['amount'], properties: { amount: { type: 'number' } } };
  const agent = id => ({ id, kind: 'agent', needs: [], description: 'Read the amount', role: 'extract', instructions: 'Return the amount as a number.',
    context: { inputs: [{ name: 'row', ref: 'item', render: 'json' }] }, returns: amount, model: { id: M } });
  const body = { nodes: [agent('a'), agent('b')], acceptance: [exists(ref('nodes.b.amount'))] };
  const provider = new ScriptedProvider(() => ({ value: { amount: 1 }, delayMs: 15 }));
  const { registry } = probe();
  const h = harness(t, base([map({ concurrency: 4 }, body)], [eq(ref('nodes.each.count'), 6)]), { registry, policy: { maxConcurrency: 2 }, input: { items: [1, 2, 3, 4, 5, 6] },
    models: (store, loaded) => new ModelPort({ policy: loaded.policy, providers: { 'claude-cli': provider, 'llama-server': provider }, journal: new Journal(store) }) });
  const run = await h.runtime.execute(h.run.id);
  assert.equal(run.status, 'succeeded', JSON.stringify(run.error));
  assert.equal(provider.calls.length, 12);
  assert.equal(provider.maxActive, 2, 'the ModelPort would allow six claude-cli calls; the run semaphore allows two');
  assert.equal(new Journal(h.store).forRun(run.id).length, 12);
});

test('map: collect records {$error} per failed item, counts failures and never cancels siblings', async t => {
  const { registry, state } = probe({ fails: value => value % 2 === 0, delayFor: value => value * 10 });
  const workflow = base([map({ concurrency: 2, failure: 'collect' })], [eq(ref('nodes.each.failed'), 2), eq(ref('nodes.each.count'), 5)]);
  const h = harness(t, workflow, { registry, input: { items: [1, 2, 3, 4, 5] } });
  assert.ok(h.validation.warnings.some(w => w.code === 'ERROR_COLLECTION'), 'collection is flagged for independent acceptance');
  const run = await h.runtime.execute(h.run.id);
  assert.equal(run.status, 'succeeded', JSON.stringify(run.error));
  assert.equal(state.aborted, 0, 'no sibling was cancelled');
  assert.deepEqual(state.started.sort(), [1, 2, 3, 4, 5]);
  const { items, count, failed } = run.outputs.each;
  assert.deepEqual([count, failed], [5, 2]);
  assert.deepEqual(items.map(item => item.$error?.code ?? item.work.value), [10, 'PROBE_FAILED', 30, 'PROBE_FAILED', 50]);
  assert.match(items[1].$error.message, /synthetic failure for 2/);
  assert.deepEqual(h.events('map.item.failed').map(e => [e.index, e.error.code]).sort(), [[1, 'PROBE_FAILED'], [3, 'PROBE_FAILED']]);
  assert.equal(run.nodes.each.failedItems, 2);
  assert.deepEqual([run.frames['root/each:1'].result, run.frames['root/each:1'].error.code, run.frames['root/each:0'].result], ['failed', 'PROBE_FAILED', 'completed']);
  assert.equal(run.verdict.verdict, 'pass', 'acceptance inspected the failed count');
});

test('map: fail_fast cancels in-flight siblings on the first item failure', async t => {
  const { registry, state } = probe({ fails: value => value === 1, delayFor: value => value === 1 ? 10 : 5000 });
  const h = harness(t, base([map({ concurrency: 4 })], [eq(ref('nodes.each.count'), 4)]), { registry, input: { items: [1, 2, 3, 4] } });
  const started = Date.now();
  const run = await h.runtime.execute(h.run.id);
  assert.ok(Date.now() - started < 3000, 'siblings did not run to completion');
  assert.equal(run.status, 'failed');
  assert.equal(run.error.code, 'PROBE_FAILED', 'the real failure, not the sibling cancellations, is reported');
  assert.equal(state.aborted, 3);
  assert.equal(h.events('map.item.completed').length, 0);
  assert.equal(run.verdict.verdict, 'harness_fault');
});

test('map: collect never hides a run-wide stop (step budget, user cancellation)', async t => {
  await t.test('step budget', async t => {
    const { registry } = probe();
    const h = harness(t, base([map({ concurrency: 2, failure: 'collect' })], [eq(ref('nodes.each.failed'), 0)], { maxSteps: 4 }), { registry, input: { items: [1, 2, 3, 4, 5, 6] } });
    const run = await h.runtime.execute(h.run.id);
    assert.equal(run.status, 'failed');
    assert.equal(run.error.code, 'STEP_BUDGET');
    assert.equal(h.events('map.item.failed').length, 0);
    assert.equal(run.verdict.verdict, 'inconclusive');
  });
  await t.test('cancellation', async t => {
    const { registry, state } = probe({ delayFor: () => 5000 });
    const h = harness(t, base([map({ concurrency: 3, failure: 'collect' })], [eq(ref('nodes.each.failed'), 0)]), { registry, input: { items: [1, 2, 3] } });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50);
    const run = await h.runtime.execute(h.run.id, { signal: controller.signal });
    assert.equal(run.status, 'cancelled');
    assert.equal(state.aborted, 3);
    assert.equal(h.events('map.item.failed').length, 0, 'cancelled items are not collected as item failures');
  });
});

test('map: a paused item stops new items from starting; resume re-enters only incomplete items and never re-runs a collected failure', async t => {
  const { registry, state } = probe({ fails: value => value === 'bad', delayFor: value => value === 'bad' ? 80 : 10 });
  const body = { nodes: [task('work', 'probe.work', { value: ref('item') }),
    { id: 'ask', kind: 'human', needs: ['work'], description: 'Synthetic confirmation', question: 'Keep this synthetic item?', answerSchema: { type: 'boolean' } }],
    acceptance: [eq(ref('nodes.ask.answer'), true)] };
  const h = harness(t, base([map({ concurrency: 2, failure: 'collect' }, body)], [eq(ref('nodes.each.failed'), 1)]), { registry, input: { items: ['bad', 'good', 'late'] } });
  let run = await h.runtime.execute(h.run.id);
  assert.equal(run.status, 'awaiting_human');
  assert.deepEqual(state.started, ['bad', 'good'], 'the third item does not start while an item is paused');
  assert.equal(run.frames['root/each:2'], undefined);
  assert.equal(run.frames['root/each:0'].result, 'failed');
  h.runtime.answer(h.run.id, 'root/each:1/ask', true);
  run = await h.runtime.execute(h.run.id);
  assert.equal(run.status, 'awaiting_human');
  assert.deepEqual(state.started, ['bad', 'good', 'late'], 'the failed item was not re-run; the completed one was not re-dispatched');
  h.runtime.answer(h.run.id, 'root/each:2/ask', true);
  run = await h.runtime.execute(h.run.id);
  assert.equal(run.status, 'succeeded', JSON.stringify(run.error));
  assert.deepEqual(state.started, ['bad', 'good', 'late']);
  assert.deepEqual(run.outputs.each.items.map(item => item.$error?.code ?? item.ask.answer), ['PROBE_FAILED', true, true]);
  assert.equal(h.events('map.item.failed').length, 1);
  assert.deepEqual(h.events('map.item.completed').map(e => e.index), [1, 2]);
});

// The child registers the same capability from the same source text, so the registry hash matches.
const RECORD = 'async ({ value }, { signal }) => { deps.appendFileSync(deps.log, `${value}\\n`); await deps.delay(30, undefined, { signal }); return { value: value * 10 }; }';
const recordCapability = (registry, deps) => registry.register({ name: 'probe.record', description: 'Synthetic logging probe', version: '1', implementation: 'map-test/probe.record',
  inputSchema: {}, outputSchema: {}, effects: 'none', risk: 'low', requiresApproval: false, maxTimeoutMs: 10000, cancellation: 'cooperative', cost: 0,
  execute: new Function('deps', `return ${RECORD}`)(deps) });
const childCode = `
import { appendFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { Store } from ${JSON.stringify(new URL('../src/store.mjs', import.meta.url).href)};
import { Runtime } from ${JSON.stringify(new URL('../src/runtime.mjs', import.meta.url).href)};
import { createDefaultRegistry } from ${JSON.stringify(new URL('../src/capabilities.mjs', import.meta.url).href)};
const [workspace, runId, log] = process.argv.slice(1);
const registry = createDefaultRegistry();
registry.register({ name: 'probe.record', description: 'Synthetic logging probe', version: '1', implementation: 'map-test/probe.record',
  inputSchema: {}, outputSchema: {}, effects: 'none', risk: 'low', requiresApproval: false, maxTimeoutMs: 10000, cancellation: 'cooperative', cost: 0,
  execute: new Function('deps', 'return ' + ${JSON.stringify(RECORD)})({ appendFileSync, delay, log }) });
await new Runtime(new Store(workspace), registry).execute(runId);
`;

test('map: resume after a crash mid-map re-enters only the incomplete items', async t => {
  const root = mkdtempSync(path.join(tmpdir(), 'foundry-map-crash-'));
  const log = path.join(root, 'calls.log');
  writeFileSync(log, '');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const registry = createDefaultRegistry();
  recordCapability(registry, { appendFileSync, delay, log });
  // Two attempts: the interrupted attempt counts, and an effect-free task is re-dispatched after recovery.
  const body = { nodes: [{ ...task('work', 'probe.record', { value: ref('item') }), retry: { maxAttempts: 2 } }], acceptance: [exists(ref('nodes.work.value'))] };
  const workflow = base([map({ concurrency: 2 }, body)], [eq(ref('nodes.each.count'), 6)], { maxConcurrency: 2 });
  let store = new Store(path.join(root, 'ws'));
  assert.equal(validateWorkflow(workflow, { registry }).valid, true);
  store.saveWorkflow(workflow);
  const created = new Runtime(store, registry).create(workflow, { items: [0, 1, 2, 3, 4, 5] }, { extra: { crashAfterTool: 'root/each:3/work' } });
  store.close();

  const child = spawnSync(process.execPath, ['--input-type=module', '-e', childCode, path.join(root, 'ws'), created.id, log], { encoding: 'utf8', timeout: 20000, env: { PATH: process.env.PATH ?? '' } });
  assert.equal(child.signal, 'SIGKILL', child.stderr);
  store = new Store(path.join(root, 'ws'));
  t.after(() => store.close());
  const before = store.events(created.id).filter(e => e.type === 'map.item.completed').map(e => e.index);
  assert.ok(before.includes(0) && before.includes(1), `items 0 and 1 completed before item 3 could start (${before})`);
  assert.ok(!before.includes(3), 'the crash happened before item 3 was recorded');
  store.updateRun(created.id, run => { delete run.extra.crashAfterTool; }, { type: 'test.crash-injection-disabled' });

  const run = await new Runtime(store, registry).execute(created.id);
  assert.equal(run.status, 'succeeded', JSON.stringify(run.error));
  assert.deepEqual(values(run.outputs.each), [0, 10, 20, 30, 40, 50]);
  const calls = readFileSync(log, 'utf8').trim().split('\n').map(Number).reduce((n, v) => (n[v] = (n[v] ?? 0) + 1, n), {});
  for (const index of before) assert.equal(calls[index], 1, `item ${index} completed before the crash and was not re-entered`);
  assert.equal(calls[3], 2, 'the interrupted effect-free item was re-run once');
  for (const index of [0, 1, 2, 3, 4, 5]) assert.ok(calls[index] >= 1 && calls[index] <= 2);
  const completed = store.events(created.id).filter(e => e.type === 'map.item.completed').map(e => e.index);
  assert.deepEqual([...completed].sort(), [0, 1, 2, 3, 4, 5], 'each item is recorded complete exactly once');
  assert.ok(store.events(created.id).some(e => e.type === 'node.recovered' && e.nodeKey === 'root/each:3/work'));
});

test('map: concurrency and failure are validated', () => {
  const { registry } = probe();
  const codes = workflow => validateWorkflow(workflow, { registry }).errors.map(e => e.code);
  for (const extra of [{ concurrency: 0 }, { concurrency: 17 }, { concurrency: 1.5 }, { failure: 'ignore' }]) assert.ok(codes(base([map(extra)], [exists(ref('nodes.each.count'))])).includes('SCHEMA'), JSON.stringify(extra));
  assert.ok(codes(base([{ ...task('lone', 'probe.work', { value: 1 }), concurrency: 2 }], [exists(ref('nodes.lone.value'))])).includes('WRONG_NODE_FIELD'));
  assert.ok(codes(base([map()], [eq(ref('nodes.each.failed'), 0)])).includes('IMPOSSIBLE_REFERENCE'), 'fail_fast output has no failed count');
  assert.deepEqual(codes(base([map({ failure: 'collect' })], [eq(ref('nodes.each.failed'), 0)])), []);
  const capped = validateWorkflow(base([map({ concurrency: 8 })], [exists(ref('nodes.each.count'))]), { registry });
  assert.equal(capped.valid, true);
  assert.ok(capped.warnings.some(w => w.code === 'MAP_CONCURRENCY_CAPPED'));
});
