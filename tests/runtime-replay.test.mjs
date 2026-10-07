// Record/replay and crash recovery through the journal (DESIGN §3, §5.1). Scripted provider only;
// crash tests kill a real child process. Development/diagnostic evidence, not sealed evaluation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { Store } from '../src/store.mjs';
import { Runtime } from '../src/runtime.mjs';
import { createDefaultRegistry } from '../src/capabilities.mjs';
import { canonical } from '../src/data.mjs';
import { loadPolicy } from '../src/models/policy.mjs';
import { ModelPort } from '../src/models/port.mjs';
import { Journal } from '../src/journal.mjs';
import { ScriptedProvider } from '../src/models/providers/scripted.mjs';

const S = 'qwen3.5-2b-q4km', M = loadPolicy().policy.models.find(m => m.class === 'M').id;
const loaded = loadPolicy();
const amount = { type: 'object', additionalProperties: false, required: ['amount'], properties: { amount: { type: 'number' } } };
const agent = (id, extra = {}) => ({ id, kind: 'agent', needs: [], description: 'Extract the amount', role: 'extract', instructions: 'Return the amount in USD as a number.',
  context: { inputs: [{ name: 'raw', ref: 'input.raw', render: 'text' }] }, returns: amount, model: { class: 'S', maxClass: 'M' },
  checks: [{ op: 'gte', left: { $ref: 'output.amount' }, right: 0 }], ...extra });
const workflow = { schemaVersion: '1.0', id: 'ReplayProbe', version: 1, title: 'Replay probe', goal: 'Normalise and double one synthetic amount', domain: 'general',
  envelope: { assumptions: ['Synthetic record'], risks: ['Model error'], successCriteria: ['Typed amounts'] }, budget: { maxSteps: 50, maxConcurrency: 1, maxDurationMs: 60000 },
  nodes: [agent('norm'), agent('twice', { needs: ['norm'], instructions: 'Return twice the amount.', context: { inputs: [{ name: 'prior', ref: 'nodes.norm.amount', render: 'json' }], recite: { goal: true } } })],
  acceptance: [{ op: 'gt', left: { $ref: 'nodes.twice.amount' }, right: { $ref: 'nodes.norm.amount' } }] };
const policy = { maxCost: 1, maxDurationMs: 60000 };

function workspace(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'foundry-replay-'));
  const store = new Store(root);
  store.saveWorkflow(workflow);
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  return { root, store };
}
function runtime(store, script) {
  const provider = new ScriptedProvider(script);
  const models = new ModelPort({ policy: loaded.policy, providers: { 'llama-server': provider, 'claude-cli': provider }, journal: new Journal(store) });
  return { provider, runtime: new Runtime(store, createDefaultRegistry(), policy, { models, modelPolicy: loaded }) };
}
const silent = () => { throw new Error('the provider must not be called'); };
const events = (store, runId, type) => store.events(runId).filter(e => e.type === type);
const receipts = (store, runId) => events(store, runId, 'context.compiled').map(e => canonical(e.receipt));

test('replay: a second run with the same salt reproduces outputs with zero provider calls and byte-identical receipts', async t => {
  const { store } = workspace(t);
  const live = runtime(store, { [S]: [{ text: 'five' }, { text: 'still five' }, { value: { amount: 10 }, costUsd: 0 }], [M]: [{ value: { amount: 5 }, costUsd: 0.01 }] });
  const first = await live.runtime.execute(live.runtime.create(workflow, { raw: 'five dollars' }, { sampleSalt: 'trial:1' }).id);
  assert.equal(first.status, 'succeeded', JSON.stringify(first.error));
  assert.deepEqual(first.outputs, { norm: { amount: 5 }, twice: { amount: 10 } });
  assert.equal(live.provider.calls.length, 4);
  assert.equal(first.cost, 0.01);

  const replay = runtime(store, silent);
  const second = await replay.runtime.execute(replay.runtime.create(workflow, { raw: 'five dollars' }, { modelMode: 'replay', sampleSalt: 'trial:1' }).id);
  assert.equal(second.status, 'succeeded', JSON.stringify(second.error));
  assert.equal(replay.provider.calls.length, 0, 'zero provider calls');
  assert.deepEqual(second.outputs, first.outputs);
  assert.deepEqual(receipts(store, second.id), receipts(store, first.id), 'receipts are byte-identical');
  assert.equal(receipts(store, first.id).length, 4);
  assert.deepEqual(events(store, second.id, 'context.compiled').map(e => e.receiptHash), events(store, first.id, 'context.compiled').map(e => e.receiptHash));
  assert.ok(events(store, second.id, 'model.called').every(e => e.replayed === true && e.costUsd === 0));
  const path = (id) => events(store, id, 'model.escalated').map(e => [e.rule, e.fromModel, e.toModel]);
  assert.deepEqual(path(second.id), path(first.id), 'the replayed loop takes the recorded escalation path');
  assert.deepEqual(path(first.id), [['E1', S, M]]);
  assert.equal(second.cost, 0, 'replays cost nothing');
  assert.deepEqual(['modelId', 'escalations'].map(k => second.nodes.norm[k]), ['modelId', 'escalations'].map(k => first.nodes.norm[k]));
  assert.equal(new Journal(store).forRun(second.id).length, 4, 'each replay hit is journaled for the replaying run');

  await t.test('a different salt misses and stops as a harness fault, still without a provider call', async () => {
    const miss = runtime(store, silent);
    const run = await miss.runtime.execute(miss.runtime.create(workflow, { raw: 'five dollars' }, { modelMode: 'replay', sampleSalt: 'trial:2' }).id);
    assert.equal(run.error.code, 'REPLAY_MISS');
    assert.equal(run.verdict.verdict, 'harness_fault');
    assert.equal(miss.provider.calls.length, 0);
  });
  await t.test('replay-or-live reuses recorded samples; the default per-run salt draws fresh ones', async () => {
    const mixed = runtime(store, silent);
    const reused = await mixed.runtime.execute(mixed.runtime.create(workflow, { raw: 'five dollars' }, { modelMode: 'replay-or-live', sampleSalt: 'trial:1' }).id);
    assert.equal(reused.status, 'succeeded', JSON.stringify(reused.error));
    assert.equal(mixed.provider.calls.length, 0);
    const fresh = runtime(store, { [S]: [{ value: { amount: 6 } }, { value: { amount: 12 } }] });
    const sampled = await fresh.runtime.execute(fresh.runtime.create(workflow, { raw: 'five dollars' }).id);
    assert.equal(sampled.status, 'succeeded', JSON.stringify(sampled.error));
    assert.equal(fresh.provider.calls.length, 2, 'a new run is a new sample, not a cache hit');
    assert.deepEqual(sampled.outputs, { norm: { amount: 6 }, twice: { amount: 12 } });
  });
});

const src = name => JSON.stringify(new URL(`../src/${name}`, import.meta.url).href);
const childCode = script => `
import { Store } from ${src('store.mjs')};
import { Runtime } from ${src('runtime.mjs')};
import { createDefaultRegistry } from ${src('capabilities.mjs')};
import { loadPolicy } from ${src('models/policy.mjs')};
import { ModelPort } from ${src('models/port.mjs')};
import { Journal } from ${src('journal.mjs')};
import { ScriptedProvider } from ${src('models/providers/scripted.mjs')};
const [workspace, runId] = process.argv.slice(1);
const store = new Store(workspace), loaded = loadPolicy(), provider = new ScriptedProvider(${JSON.stringify(script)});
const models = new ModelPort({ policy: loaded.policy, providers: { 'llama-server': provider, 'claude-cli': provider }, journal: new Journal(store) });
await new Runtime(store, createDefaultRegistry(), ${JSON.stringify(policy)}, { models, modelPolicy: loaded }).execute(runId);`;
const childEnv = { PATH: process.env.PATH ?? '/usr/bin:/bin', NODE_NO_WARNINGS: '1' };

test('crash: a process killed after a model call resumes from the journal without calling the provider again', async t => {
  const { root, store } = workspace(t);
  const created = runtime(store, silent).runtime.create(workflow, { raw: 'five dollars' }, { extra: { crashAfterModel: 'root/norm' } });
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', childCode({ [S]: [{ text: 'five', costUsd: 0.1 }] }), root, created.id], { encoding: 'utf8', timeout: 20000, env: childEnv });
  assert.equal(child.signal, 'SIGKILL', child.stderr);
  const journal = new Journal(store);
  assert.deepEqual(journal.forRun(created.id).map(r => [r.nodeKey, r.attempt, r.errorCode, r.costUsd]), [['root/norm', 1, 'MODEL_SCHEMA', 0.1]], 'the response was committed before the crash');
  const crashed = store.run(created.id);
  assert.deepEqual([crashed.nodes.norm.status, crashed.cost], ['running', 0], 'the run never observed the call');
  store.updateRun(created.id, run => { delete run.extra.crashAfterModel; }, { type: 'test.crash-injection-disabled' });

  const resumed = runtime(store, { [S]: [{ value: { amount: 5 }, costUsd: 0.2 }, { value: { amount: 10 } }] });
  const run = await resumed.runtime.execute(created.id);
  assert.equal(run.status, 'succeeded', JSON.stringify(run.error));
  assert.equal(resumed.provider.calls.length, 2, 'only the retry and the second node reach the provider');
  assert.match(resumed.provider.calls[0].prompt, /Retry 1 of 1 on this model\. MODEL_SCHEMA/, 'the recovered failure drove the retry');
  const [recovered] = events(store, created.id, 'node.recovered_from_journal');
  assert.deepEqual([recovered.nodeKey, recovered.journalId, recovered.errorCode, recovered.attempt], ['root/norm', journal.forRun(created.id)[0].id, 'MODEL_SCHEMA', 1]);
  assert.equal(events(store, created.id, 'node.resumed').length, 1);
  assert.equal(run.nodes.norm.attempts, 1, 'recovery continues the same attempt');
  assert.ok(Math.abs(run.cost - 0.3) < 1e-9, `charged once per call: ${run.cost}`);
  assert.equal(journal.forRun(created.id).length, 3, 'the recovered call adds no journal row');
});

test('crash: a call already charged before the crash is not charged twice on recovery', async t => {
  const { root, store } = workspace(t);
  const created = runtime(store, silent).runtime.create(workflow, { raw: 'five dollars' });
  // The second call hangs, so the child dies mid-flight after the first call was charged.
  const child = spawn(process.execPath, ['--input-type=module', '-e', childCode({ [S]: [{ text: 'five', costUsd: 0.1 }, { value: { amount: 5 }, costUsd: 0.2, delayMs: 60000 }] }), root, created.id], { env: childEnv, stdio: 'ignore' });
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve(signal)));
  t.after(() => { try { child.kill('SIGKILL'); } catch {} });
  const types = () => store.db.prepare('SELECT body FROM events WHERE run_id=? ORDER BY seq').all(created.id).map(row => JSON.parse(row.body).type);
  for (let i = 0; i < 400 && types().filter(type => type === 'context.compiled').length < 2; i++) await delay(25);
  assert.equal(types().filter(type => type === 'context.compiled').length, 2, 'the retry call started');
  child.kill('SIGKILL');
  assert.equal(await exited, 'SIGKILL');
  assert.equal(store.run(created.id).cost, 0.1, 'the first call was charged before the crash');
  assert.equal(new Journal(store).forRun(created.id).length, 1, 'the in-flight call was never journaled');

  const resumed = runtime(store, { [S]: [{ value: { amount: 5 }, costUsd: 0.2 }, { value: { amount: 10 } }] });
  const run = await resumed.runtime.execute(created.id);
  assert.equal(run.status, 'succeeded', JSON.stringify(run.error));
  assert.equal(resumed.provider.calls.length, 2);
  assert.ok(Math.abs(run.cost - 0.3) < 1e-9, `no double charge: ${run.cost}`);
  assert.deepEqual(run.nodes.norm.journalIds.length, 2);
  assert.equal(events(store, created.id, 'node.recovered_from_journal').length, 1);
});
