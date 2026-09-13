import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { Store } from '../src/store.mjs';
import { Runtime } from '../src/runtime.mjs';
import { CapabilityRegistry, createDefaultRegistry } from '../src/capabilities.mjs';
import { validateData, validateWorkflow } from '../src/validate.mjs';

// Independent local regression cases. No corpus code, network, credentials,
// scanners, production assets, or paid models are used by these tests.
function task(id, tool, args = {}, needs = []) {
  return { id, kind: 'task', description: `Audit operation ${id}`, tool, args,
    needs, timeoutMs: 1000, retry: { maxAttempts: 1 } };
}
function workflow(nodes, acceptance, extra = {}) {
  return { schemaVersion: '1.0', id: `audit-${randomUUID()}`, version: 1,
    title: 'Independent security regression', goal: 'Preserve the declared safety and outcome contract',
    domain: 'security-audit', envelope: { assumptions: ['Only local mock tools exist'], risks: [],
      successCriteria: ['Independent assertions match observed effects and terminal state'] },
    budget: { maxSteps: 20, maxConcurrency: 2, maxDurationMs: 5000, maxCost: 0 },
    nodes, acceptance, ...extra };
}
function equals(reference, right) { return { op: 'eq', left: { $ref: reference }, right }; }
function mockRegistry(execute, extra = {}) {
  return new CapabilityRegistry().register({ name: 'audit.operation', version: '1',
    implementation: 'security-audit-local-fixture', description: 'Local mock operation',
    inputSchema: { type: 'object' }, outputSchema: { type: 'object' }, effects: 'none',
    risk: 'low', requiresApproval: false, maxTimeoutMs: 1000, cost: 0,
    cancellation: 'cooperative', execute, ...extra });
}
function environment(t, registry = createDefaultRegistry(), policy = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), 'foundry-security-audit-'));
  const store = new Store(directory);
  t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  return { directory, store, registry, runtime: new Runtime(store, registry, policy) };
}
function create(env, flow, input = {}, options = {}) {
  env.store.saveWorkflow(flow);
  return env.runtime.create(flow, input, options);
}

test('security: asynchronous schemas cannot accept invalid input or create an unhandled rejection', () => {
  // Run the validator probe in a child so an implementation bug producing an
  // unhandled rejection cannot contaminate unrelated node:test cases.
  const moduleURL = new URL('../src/validate.mjs', import.meta.url).href;
  const source = `
    import { validateData } from ${JSON.stringify(moduleURL)};
    const result = { accepted: false, unhandled: false };
    process.on('unhandledRejection', () => { result.unhandled = true; });
    try { validateData({ $async: true, type: 'integer' }, 'invalid-integer'); result.accepted = true; }
    catch (error) { result.error = error.code || error.name; }
    setTimeout(() => process.stdout.write(JSON.stringify(result)), 20);
  `;
  const child = spawnSync(process.execPath, ['--input-type=module', '--eval', source], {
    encoding: 'utf8', timeout: 3000, maxBuffer: 100000,
    env: { PATH: process.env.PATH, NODE_NO_WARNINGS: '1' },
  });
  assert.equal(child.error, undefined, child.error?.message);
  assert.equal(child.status, 0, child.stderr);
  const observed = JSON.parse(child.stdout);
  assert.equal(observed.accepted, false, `Invalid data was accepted: ${JSON.stringify(observed)}`);
  assert.equal(observed.unhandled, false, 'Rejected schemas must not leave an unhandled validation promise');
});

test('security: equivalent schemas remain usable after JSON persistence despite a repeated $id', () => {
  const schema = { $id: `urn:foundry:audit:${randomUUID()}`, type: 'object',
    required: ['count'], properties: { count: { type: 'integer' } }, additionalProperties: false };
  validateData(schema, { count: 1 });
  assert.doesNotThrow(() => validateData(JSON.parse(JSON.stringify(schema)), { count: 2 }));
});

test('security: one task cannot resolve a schema identifier introduced by another task', () => {
  const id = `urn:foundry:other-task:${randomUUID()}`;
  validateData({ $id: id, type: 'string' }, 'first-task');
  assert.throws(() => validateData({ $ref: id }, 'second-task'),
    'Unbundled schema references must not depend on validation order in other tasks');
});

test('security: dangling SQLite symlinks are rejected before any outside file is created', t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'foundry-security-audit-path-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const workspace = path.join(directory, 'workspace');
  mkdirSync(path.join(workspace, '.foundry'), { recursive: true });
  const outside = path.join(directory, 'outside.sqlite');
  symlinkSync(outside, path.join(workspace, '.foundry', 'foundry.sqlite'));
  let store, error;
  try { store = new Store(workspace); } catch (caught) { error = caught; }
  finally { store?.close(); }
  assert.equal(existsSync(outside), false, 'Opening a dangling symlink created a database outside .foundry');
  assert.ok(error, 'A dangling SQLite symlink must be refused explicitly');
});

test('security: a skipped guard cannot admit its dependent effect', async t => {
  let effects = 0;
  const registry = mockRegistry(async () => { effects++; return { committed: true }; }, { effects: 'idempotent' });
  const env = environment(t, registry);
  const flow = workflow([
    { id: 'guard', kind: 'assert', description: 'This prerequisite must run before the effect', needs: [],
      when: equals('input.allowed', true), checks: [equals('input.allowed', true)] },
    task('effect', 'audit.operation', {}, ['guard']),
  ], [equals('nodes.effect.committed', true)]);
  const run = create(env, flow, { allowed: false });
  const result = await env.runtime.execute(run.id);
  assert.equal(effects, 0, `The guard was skipped but the effect ran; terminal=${result.status}`);
  assert.notEqual(result.status, 'succeeded');
});

test('security: cancellation during a final non-cancellable operation cannot become success', async t => {
  let entered, release;
  const started = new Promise(resolve => { entered = resolve; });
  const settled = new Promise(resolve => { release = resolve; });
  const registry = mockRegistry(async () => { entered(); await settled; return { observed: true }; },
    { cancellation: 'not-supported' });
  const env = environment(t, registry);
  const run = create(env, workflow([task('read', 'audit.operation')], [equals('nodes.read.observed', true)]));
  const controller = new AbortController();
  const executing = env.runtime.execute(run.id, { signal: controller.signal });
  await started;
  controller.abort();
  release();
  const result = await executing;
  assert.notEqual(result.status, 'succeeded', 'The cancellation request was lost after the tool returned');
  assert.ok(['cancelled', 'uncertain'].includes(result.status), `Unexpected terminal status ${result.status}`);
});

test('security: non-idempotent effects reject automatic retries before execution', t => {
  let effects = 0;
  const env = environment(t, mockRegistry(async () => { effects++; return {}; }, { effects: 'non-idempotent' }));
  const effect = task('effect', 'audit.operation'); effect.retry.maxAttempts = 2;
  const result = validateWorkflow(workflow([effect], [{ op: 'exists', value: { $ref: 'nodes.effect' } }]), { registry: env.registry });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(error => error.code === 'UNSAFE_RETRY'));
  assert.equal(effects, 0);
});

test('security: lost acknowledgement of a non-idempotent effect remains uncertain and is not repeated', async t => {
  let effects = 0;
  const registry = mockRegistry(async () => { effects++; throw new Error('Synthetic acknowledgement lost after commit'); },
    { effects: 'non-idempotent' });
  const env = environment(t, registry);
  const run = create(env, workflow([task('effect', 'audit.operation')], [{ op: 'exists', value: { $ref: 'nodes.effect' } }]));
  assert.equal((await env.runtime.execute(run.id)).status, 'uncertain');
  assert.equal((await env.runtime.execute(run.id)).status, 'uncertain');
  assert.equal(effects, 1);
});

test('security: high-risk approval is bound to the exact run and completed effects do not replay', async t => {
  let effects = 0;
  const registry = mockRegistry(async () => { effects++; return { committed: true }; },
    { effects: 'idempotent', risk: 'high', requiresApproval: true });
  const env = environment(t, registry, { allowedCapabilities: ['audit.operation'] });
  const flow = workflow([task('effect', 'audit.operation', { target: 'mock-east' })], [equals('nodes.effect.committed', true)]);
  const first = create(env, flow);
  const paused = await env.runtime.execute(first.id);
  assert.equal(paused.status, 'awaiting_approval'); assert.equal(effects, 0);
  const approval = Object.keys(paused.approvals)[0];
  assert.throws(() => env.runtime.approve(first.id, approval, true, 'model'));
  const second = env.runtime.create(flow);
  const other = await env.runtime.execute(second.id);
  assert.notEqual(Object.keys(other.approvals)[0], approval);
  assert.throws(() => env.runtime.approve(second.id, approval, true));
  env.runtime.approve(first.id, approval, true);
  assert.equal((await env.runtime.execute(first.id)).status, 'succeeded');
  assert.equal((await env.runtime.execute(first.id)).status, 'succeeded');
  assert.equal(effects, 1);
});

test('security: an idempotent operation that ignores timeout cancellation blocks further admission', async t => {
  let effects = 0;
  const registry = mockRegistry(async () => { await delay(160); effects++; return { committed: true }; },
    { effects: 'idempotent', cancellation: 'not-supported' });
  const env = environment(t, registry);
  const effect = task('effect', 'audit.operation'); effect.timeoutMs = 1; effect.retry.maxAttempts = 2;
  const run = create(env, workflow([effect], [equals('nodes.effect.committed', true)]));
  const result = await env.runtime.execute(run.id);
  assert.equal(result.status, 'uncertain');
  await delay(100); // Settle the bounded mock before its temporary store is closed.
  assert.equal(effects, 1);
  assert.equal((await env.runtime.execute(run.id)).status, 'uncertain');
});

test('security: an artifact parent symlink is rejected before creating any outside directory', async t => {
  const env = environment(t);
  const outside = path.join(env.directory, 'outside-artifacts');
  mkdirSync(outside);
  symlinkSync(outside, path.join(env.store.directory, 'artifacts'));
  const flow = workflow([task('write', 'core.artifact', { name: 'audit.txt', content: 'benign fixture' })],
    [equals('nodes.write.name', 'audit.txt')]);
  const run = create(env, flow);
  const result = await env.runtime.execute(run.id);
  assert.equal(result.status, 'failed');
  assert.equal(existsSync(path.join(outside, run.id)), false,
    'Rejecting the path after recursive mkdir still created a directory outside the permitted tree');
});

test('security: an artifact target symlink is rejected without creating its absent destination', async t => {
  const env = environment(t);
  const flow = workflow([task('write', 'core.artifact', { name: 'audit.txt', content: 'benign fixture' })],
    [equals('nodes.write.name', 'audit.txt')]);
  const run = create(env, flow);
  const artifacts = path.join(env.store.directory, 'artifacts', run.id);
  mkdirSync(artifacts, { recursive: true });
  const outside = path.join(env.directory, 'outside-audit.txt');
  symlinkSync(outside, path.join(artifacts, 'audit.txt'));
  const result = await env.runtime.execute(run.id);
  assert.equal(result.status, 'failed');
  assert.equal(existsSync(outside), false);
});

test('security: conflicting artifact contents cannot be reported as a successful idempotent replay', async t => {
  const env = environment(t);
  const first = task('first', 'core.artifact', { name: 'audit.txt', content: 'first-version' });
  const second = task('second', 'core.artifact', { name: 'audit.txt', content: 'changed-version' }, ['first']);
  const run = create(env, workflow([first, second], [equals('nodes.second.name', 'audit.txt')]));
  const result = await env.runtime.execute(run.id);
  assert.equal(result.status, 'failed');
  assert.equal(result.nodes.first.status, 'completed');
  assert.equal(result.nodes.second.error.code, 'ARTIFACT_CONFLICT');
});
