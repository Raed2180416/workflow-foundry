// Agent node execution and escalation (DESIGN §1.1, §4, §5.1, §5.2, §6). Scripted provider only:
// no network, no model spend. Development/diagnostic evidence, not sealed evaluation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.mjs';
import { Runtime } from '../src/runtime.mjs';
import { createDefaultRegistry } from '../src/capabilities.mjs';
import { validateWorkflow, validateDecision, validateIdentity } from '../src/validate.mjs';
import { loadPolicy } from '../src/models/policy.mjs';
import { ModelPort } from '../src/models/port.mjs';
import { Journal } from '../src/journal.mjs';
import { ScriptedProvider } from '../src/models/providers/scripted.mjs';
import { UNTRUSTED_PREAMBLE, compileContext } from '../src/context.mjs';

const S = 'qwen3.5-2b-q4km', S2 = 'granite-4.2-3b-q4km', M = loadPolicy().policy.models.find(m => m.class === 'M').id, L = 'claude-sonnet-5-5', F = 'claude-opus-5-5';
const loaded = loadPolicy();
const amount = { type: 'object', additionalProperties: false, required: ['amount'], properties: { amount: { type: 'number' } } };
const base = (nodes, acceptance, extra = {}) => ({ schemaVersion: '1.0', id: 'AgentProbe', version: 1, title: 'Agent probe', goal: 'Normalise one synthetic record',
  domain: 'general', envelope: { assumptions: ['Synthetic local record'], risks: ['Model error'], successCriteria: ['A non-negative typed amount'] },
  budget: { maxSteps: 50, maxConcurrency: 2, maxDurationMs: 60000 }, nodes, acceptance, ...extra });
// `field: undefined` in extra removes a default field.
const agent = (id, extra = {}) => Object.fromEntries(Object.entries({ id, kind: 'agent', needs: [], description: 'Extract the amount', role: 'extract', instructions: 'Return the amount in USD as a number.',
  context: { inputs: [{ name: 'raw', ref: 'input.raw', render: 'text' }] }, returns: amount, model: { class: 'S', maxClass: 'M' },
  checks: [{ op: 'gte', left: { $ref: 'output.amount' }, right: 0 }], ...extra }).filter(([, value]) => value !== undefined));
const accept = id => [{ op: 'gte', left: { $ref: `nodes.${id}.amount` }, right: 0 }];

function harness(t, workflow, { script, policy = {}, input = { raw: 'five dollars' }, runOptions = {}, registry = createDefaultRegistry() } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'foundry-agent-'));
  const store = new Store(root), provider = new ScriptedProvider(script ?? (() => { throw new Error('no provider call expected'); }));
  const models = new ModelPort({ policy: loaded.policy, providers: { 'llama-server': provider, 'claude-cli': provider }, journal: new Journal(store) });
  const runtime = new Runtime(store, registry, { maxCost: 0, ...policy }, { models, modelPolicy: loaded });
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  const validation = validateWorkflow(workflow, { registry, modelPolicy: loaded });
  assert.equal(validation.valid, true, JSON.stringify(validation.errors));
  store.saveWorkflow(workflow);
  const run = runtime.create(workflow, input, runOptions);
  return { store, provider, models, runtime, run, registry, events: () => store.events(run.id), of: type => store.events(run.id).filter(e => e.type === type) };
}
const codes = (workflow, options = {}) => validateWorkflow(workflow, { registry: createDefaultRegistry(), modelPolicy: loaded, ...options }).errors.map(e => e.code);

test('agent: E1 schema retry with the validator error, then one logged escalation S -> M', async t => {
  const h = harness(t, base([agent('norm')], accept('norm')), { script: { [S]: [{ text: 'five' }, { value: { amount: 'five' } }], [M]: [{ value: { amount: 5 } }] } });
  const run = await h.runtime.execute(h.run.id);
  assert.equal(run.status, 'succeeded', JSON.stringify(run.error));
  assert.deepEqual(run.outputs.norm, { amount: 5 });
  assert.deepEqual(h.provider.calls.map(c => c.modelId), [S, S, M]);
  assert.doesNotMatch(h.provider.calls[0].prompt, /Previous attempt was rejected/);
  assert.match(h.provider.calls[1].prompt, /## Previous attempt was rejected\nRetry 1 of 1 on this model\. MODEL_SCHEMA: Model output is not a JSON value/);
  assert.doesNotMatch(h.provider.calls[2].prompt, /Previous attempt was rejected/, 'escalation starts the stronger model without the weaker model\'s retry note');
  const types = h.events().map(e => e.type).filter(type => ['context.compiled', 'model.called', 'model.retry', 'model.escalated', 'node.completed'].includes(type));
  assert.deepEqual(types, ['context.compiled', 'model.called', 'model.retry', 'context.compiled', 'model.called', 'model.escalated', 'context.compiled', 'model.called', 'node.completed']);
  const [retry] = h.of('model.retry'), [escalated] = h.of('model.escalated');
  assert.deepEqual([retry.rule, retry.errorCode, retry.retry], ['E1', 'MODEL_SCHEMA', 1]);
  assert.deepEqual({ rule: escalated.rule, fromClass: escalated.fromClass, toClass: escalated.toClass, fromModel: escalated.fromModel, toModel: escalated.toModel, errorCode: escalated.errorCode, costSoFar: escalated.costSoFar },
    { rule: 'E1', fromClass: 'S', toClass: 'M', fromModel: S, toModel: M, errorCode: 'MODEL_SCHEMA', costSoFar: 0 });
  // Journal-before-observe: the receipt event precedes the call and its hash is in the journal row.
  const compiled = h.of('context.compiled'), rows = new Journal(h.store).forRun(run.id);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map(r => r.receiptHash), compiled.map(e => e.receiptHash));
  assert.deepEqual(rows.map(r => [r.ok, r.errorCode]), [[false, 'MODEL_SCHEMA'], [false, 'MODEL_SCHEMA'], [true, null]]);
  assert.equal(compiled[0].receipt.compiler, 'foundry-context/1');
  assert.deepEqual(Object.fromEntries(['modelId', 'modelClass', 'escalations', 'modelCalls'].map(k => [k, run.nodes.norm[k]])), { modelId: M, modelClass: 'M', escalations: 1, modelCalls: 3 });
  // Verdict and decision records.
  assert.deepEqual({ verdict: run.verdict.verdict, authority: run.verdict.authority, grants: run.verdict.grantsActionAuthority }, { verdict: 'pass', authority: 'supported', grants: false });
  const tail = h.events().slice(-2).map(e => e.type);
  assert.deepEqual(tail, ['run.verdict', 'run.succeeded'], 'the verdict is committed with, and just before, the terminal event');
  const decisions = h.store.decisions(run.id);
  assert.deepEqual(decisions.map(d => d.kind), ['escalation', 'verdict']);
  for (const decision of decisions) validateDecision(decision);
  assert.deepEqual(decisions[0].action, { escalateTo: M, toClass: 'M' });
  assert.equal(decisions[0].features.rule, 'E1');
  assert.deepEqual(decisions[0].identity, run.identity);
});

test('agent: E2 check failure escalates; resample draws a new sample index; onCheckFail=fail stops inconclusive', async t => {
  await t.test('escalate (default)', async t => {
    const h = harness(t, base([agent('norm')], accept('norm')), { script: { [S]: [{ value: { amount: -3 } }], [M]: [{ value: { amount: 3 } }] } });
    const run = await h.runtime.execute(h.run.id);
    assert.equal(run.status, 'succeeded', JSON.stringify(run.error));
    const [escalated] = h.of('model.escalated');
    assert.deepEqual([escalated.rule, escalated.errorCode, escalated.fromModel, escalated.toModel], ['E2', 'NODE_CHECK_FAILED', S, M]);
    assert.equal(h.of('model.retry').length, 0, 'a check failure is not a schema retry');
  });
  await t.test('resample', async t => {
    const h = harness(t, base([agent('norm', { escalation: { onCheckFail: 'resample', maxResamples: 1 } })], accept('norm')),
      { script: { [S]: [{ value: { amount: -1 } }, { value: { amount: 2 } }] } });
    const run = await h.runtime.execute(h.run.id);
    assert.equal(run.status, 'succeeded', JSON.stringify(run.error));
    assert.deepEqual(h.of('model.resampled').map(e => [e.rule, e.sampleIndex]), [['E2', 1]]);
    assert.deepEqual(new Journal(h.store).forRun(run.id).map(r => [r.modelId, r.sampleIndex]), [[S, 0], [S, 1]]);
    assert.equal(h.of('model.escalated').length, 0);
  });
  await t.test('fail', async t => {
    const h = harness(t, base([agent('norm', { escalation: { onCheckFail: 'fail' } })], accept('norm')), { script: { [S]: [{ value: { amount: -1 } }] } });
    const run = await h.runtime.execute(h.run.id);
    assert.equal(run.status, 'failed');
    assert.equal(run.error.code, 'NODE_CHECK_FAILED');
    assert.equal(run.verdict.verdict, 'inconclusive');
    assert.equal(h.provider.calls.length, 1);
  });
});

test('agent: E7 caps escalation at two even when maxClass allows more; maxClass bounds the ladder', async t => {
  await t.test('cap', async t => {
    const bad = { text: 'not json' };
    const h = harness(t, base([agent('norm', { model: { class: 'S', maxClass: 'F' } })], accept('norm')), { script: { [S]: [bad, bad], [M]: [bad, bad], [L]: [bad, bad], [F]: [{ value: { amount: 1 } }] } });
    const run = await h.runtime.execute(h.run.id);
    assert.equal(run.status, 'failed');
    assert.equal(run.error.code, 'MODEL_ESCALATION_EXHAUSTED');
    assert.deepEqual(h.of('model.escalated').map(e => `${e.fromClass}>${e.toClass}`), ['S>M', 'M>L']);
    assert.ok(!h.provider.calls.some(c => c.modelId === F), 'the third escalation never happens');
    assert.equal(h.provider.calls.length, 6, 'one schema retry per model before each escalation');
    assert.equal(run.verdict.verdict, 'harness_fault');
    assert.equal(h.store.decisions(run.id).filter(d => d.kind === 'escalation').length, 2);
  });
  await t.test('maxClass', async t => {
    const h = harness(t, base([agent('norm', { model: { class: 'S' }, escalation: { schemaRetries: 0 } })], accept('norm')), { script: { [S]: [{ text: 'x' }] } });
    const run = await h.runtime.execute(h.run.id);
    assert.equal(run.error.code, 'MODEL_ESCALATION_EXHAUSTED');
    assert.equal(h.of('model.escalated').length, 0);
    assert.equal(h.provider.calls.length, 1);
  });
  await t.test('node maxEscalations', async t => {
    const h = harness(t, base([agent('norm', { model: { class: 'S', maxClass: 'L' }, escalation: { maxEscalations: 1, schemaRetries: 0 } })], accept('norm')),
      { script: { [S]: [{ text: 'x' }], [M]: [{ text: 'x' }], [L]: [{ value: { amount: 1 } }] } });
    const run = await h.runtime.execute(h.run.id);
    assert.equal(run.error.code, 'MODEL_ESCALATION_EXHAUSTED');
    assert.deepEqual(h.provider.calls.map(c => c.modelId), [S, M]);
  });
});

test('agent: outages and provider faults are environment/harness faults and never escalate', async t => {
  // An outage (orch-20261021 patch 04) is retried inline on the same model, honouring the provider's retry-after (10 ms here), at most 3
  // times; past that the agent node parks (status waiting, a timer at retryAt) instead of ending the run. It never escalates and no other
  // model is tried. A provider (harness) fault is still terminal at once.
  const outage = code => ({ error: { code, message: `${code}: overloaded, retry after 0.01 s` } });
  for (const code of ['MODEL_UNAVAILABLE', 'MODEL_RATE_LIMIT', 'MODEL_TIMEOUT']) {
    await t.test(code, async t => {
      const h = harness(t, base([agent('norm')], accept('norm')), { script: { [S]: [outage(code), outage(code), outage(code), outage(code), { value: { amount: 1 } }], [M]: [{ value: { amount: 1 } }] } });
      const run = await h.runtime.execute(h.run.id);
      assert.equal(run.status, 'waiting', JSON.stringify(run.error));
      assert.equal(run.nodes.norm.status, 'waiting');
      assert.equal(run.nodes.norm.parked.code, code);
      assert.ok(run.nodes.norm.parked.retryAt > Date.now() - 1000 && run.nodes.norm.parked.retryAt < Date.now() + 60000, 'parked until the retry-after');
      assert.deepEqual(h.of('model.env_retry').map(e => [e.errorCode, e.retry, e.modelId]), [1, 2, 3].map(n => [code, n, S]));
      assert.equal(h.of('model.parked').length, 1);
      assert.equal(h.of('model.escalated').length, 0);
      assert.deepEqual(h.provider.calls.map(c => c.modelId), [S, S, S, S], 'no other model is tried');
      assert.equal(new Journal(h.store).forRun(run.id)[0].errorCode, code, 'the failure is journaled with the call');
      // The outage ends: the parked node runs on, on the same model, within the same attempt, and the run succeeds.
      const resumed = await h.runtime.execute(h.run.id);
      assert.equal(resumed.status, 'succeeded', JSON.stringify(resumed.error));
      assert.deepEqual(h.provider.calls.map(c => c.modelId), [S, S, S, S, S]);
      assert.equal(h.of('model.unparked').length, 1);
      assert.equal(resumed.nodes.norm.attempts, 1);
    });
  }
  await t.test('a single transient outage is absorbed by one same-model retry', async t => {
    const h = harness(t, base([agent('norm')], accept('norm')), { script: { [S]: [outage('MODEL_RATE_LIMIT'), { value: { amount: 1 } }] } });
    const run = await h.runtime.execute(h.run.id);
    assert.equal(run.status, 'succeeded', JSON.stringify(run.error));
    assert.deepEqual(h.provider.calls.map(c => c.modelId), [S, S]);
    assert.equal(h.of('model.env_retry').length, 1); assert.equal(h.of('model.escalated').length, 0);
  });
  await t.test('MODEL_PROTOCOL', async t => {
    const h = harness(t, base([agent('norm')], accept('norm')), { script: { [S]: [{ error: 'MODEL_PROTOCOL' }], [M]: [{ value: { amount: 1 } }] } });
    const run = await h.runtime.execute(h.run.id);
    assert.equal(run.status, 'failed');
    assert.equal(run.error.code, 'MODEL_PROTOCOL');
    assert.equal(run.verdict.verdict, 'harness_fault');
    assert.equal(h.of('model.escalated').length, 0);
    assert.deepEqual(h.provider.calls.map(c => c.modelId), [S], 'no other model is tried');
    assert.equal(new Journal(h.store).forRun(run.id)[0].errorCode, 'MODEL_PROTOCOL', 'the failure is journaled with the call');
  });
  await t.test('onError continue does not hide an outage', async t => {
    const h = harness(t, base([agent('norm', { onError: 'continue' })], [{ op: 'exists', value: { $ref: 'nodes.norm' } }]), { script: { [S]: Array.from({ length: 4 }, () => outage('MODEL_UNAVAILABLE')) } });
    const run = await h.runtime.execute(h.run.id);
    assert.equal(run.status, 'waiting');
    assert.equal(run.nodes.norm.status, 'waiting', 'parked, not completed as a handled error');
    assert.equal(run.nodes.norm.parked.code, 'MODEL_UNAVAILABLE');
  });
  await t.test('onError continue records an exhausted model judgment as a handled error', async t => {
    const h = harness(t, base([agent('norm', { onError: 'continue', model: { class: 'S' } })], [{ op: 'eq', left: { $ref: 'nodes.norm.ok' }, right: false }]), { script: { [S]: [{ text: 'x' }, { text: 'y' }] } });
    const run = await h.runtime.execute(h.run.id);
    assert.equal(run.status, 'succeeded', JSON.stringify(run.error));
    assert.equal(run.nodes.norm.status, 'handled_error');
    assert.equal(run.outputs.norm.error.code, 'MODEL_ESCALATION_EXHAUSTED');
  });
});

test('agent: model spend is charged to run.cost and a budget overrun stops the run as inconclusive', async t => {
  const workflow = base([agent('norm', { model: { id: M } }), agent('again', { needs: ['norm'], model: { id: M } })], accept('again'));
  const h = harness(t, workflow, { policy: { maxCost: 0.003 }, script: { [M]: [{ value: { amount: 1 }, costUsd: 0.002 }, { value: { amount: 2 }, costUsd: 0.002 }] } });
  const run = await h.runtime.execute(h.run.id);
  assert.equal(run.status, 'failed');
  assert.equal(run.error.code, 'COST_BUDGET');
  assert.equal(run.verdict.verdict, 'inconclusive');
  assert.equal(run.cost, 0.004, 'money already spent is still recorded');
  assert.equal(new Journal(h.store).costForRun(run.id).costUsd, 0.004);
  assert.equal(run.nodes.norm.status, 'completed');
  assert.equal(run.nodes.again.status, 'failed');
  await t.test('the default maxCost of 0 forbids any paid call', async t => {
    const h0 = harness(t, base([agent('norm', { model: { id: M } })], accept('norm')), { script: { [M]: [{ value: { amount: 1 }, usage: { inputTokens: 1000, outputTokens: 10 } }] } });
    const stopped = await h0.runtime.execute(h0.run.id);
    assert.equal(stopped.error.code, 'COST_BUDGET');
    assert.ok(stopped.cost > 0, 'list price from usage is charged when the provider reports no cost');
  });
});

test('agent: validation rejects model ids outside the policy, bad classes, non-portable schemas and stray output refs', () => {
  assert.ok(codes(base([agent('norm', { model: { id: 'gpt-4o' } })], accept('norm'))).includes('MODEL_NOT_IN_POLICY'));
  assert.ok(codes(base([agent('norm', { model: { class: 'XL' } })], accept('norm'))).includes('MODEL_CLASS_UNKNOWN'));
  assert.ok(codes(base([agent('norm', { model: { class: 'M', maxClass: 'S' } })], accept('norm'))).includes('MODEL_CLASS_ORDER'));
  assert.ok(codes(base([agent('norm', { model: { id: M, class: 'S' } })], accept('norm'))).includes('MODEL_CLASS_MISMATCH'));
  assert.deepEqual(codes(base([agent('norm')], accept('norm')), { modelPolicy: null }), ['MODEL_POLICY_REQUIRED']);
  const patterned = { ...amount, properties: { amount: { type: 'string', pattern: '^[0-9]+$' } } };
  assert.ok(codes(base([agent('norm', { returns: patterned, checks: undefined })], [{ op: 'exists', value: { $ref: 'nodes.norm.amount' } }])).includes('SCHEMA_NOT_PORTABLE'));
  assert.ok(codes(base([agent('norm', { returns: { type: 'array', items: {} } })], accept('norm'))).includes('SCHEMA_NOT_PORTABLE'));
  // output.* is a local root only inside an agent's own checks.
  assert.ok(codes(base([agent('norm'), { id: 'a', kind: 'assert', needs: ['norm'], description: 'Stray', checks: [{ op: 'gte', left: { $ref: 'output.amount' }, right: 0 }] }], accept('norm'))).includes('INVALID_REFERENCE'));
  assert.ok(codes(base([agent('norm', { checks: [{ op: 'gte', left: { $ref: 'output.total' }, right: 0 }] })], accept('norm'))).includes('IMPOSSIBLE_REFERENCE'), 'checks are typed against returns');
  assert.ok(codes(base([agent('norm', { context: { inputs: [{ name: 'other', ref: 'nodes.later.amount' }] } }), agent('later')], accept('norm'))).includes('UNDECLARED_DATA_DEPENDENCY'));
  assert.ok(codes(base([agent('norm', { context: { inputs: [{ name: 'a', value: 1 }, { name: 'a', value: 2 }] } })], accept('norm'))).includes('CONTEXT_INPUT'));
  assert.ok(codes(base([agent('norm', { context: { inputs: [{ name: 'a', ref: 'input.raw', value: 2 }] } })], accept('norm'))).includes('SCHEMA'));
  assert.ok(codes(base([agent('norm', { tool: 'core.echo' })], accept('norm'))).includes('WRONG_NODE_FIELD'));
  assert.ok(codes(base([agent('norm', { context: { history: 'full' } })], accept('norm'))).includes('SCHEMA'));
  assert.ok(codes(base([agent('norm', { escalation: { maxEscalations: 3 } })], accept('norm'))).includes('SCHEMA'), 'E7: at most two escalations');
  // Runtime create refuses the same workflow; assignments are policy-checked and class-bounded.
  const root = mkdtempSync(path.join(tmpdir(), 'foundry-agent-'));
  try {
    const store = new Store(root), registry = createDefaultRegistry(), runtime = new Runtime(store, registry, {}, { modelPolicy: loaded });
    const bad = base([agent('norm', { model: { id: 'gpt-4o' } })], accept('norm'));
    assert.throws(() => runtime.create(bad, { raw: 'x' }), e => e.code === 'INVALID_WORKFLOW' && e.details.some(d => d.code === 'MODEL_NOT_IN_POLICY'));
    const good = base([agent('norm', { model: { class: 'S' } })], accept('norm'));
    store.saveWorkflow(good);
    assert.throws(() => runtime.create(good, { raw: 'x' }, { assignment: { norm: 'gpt-4o' } }), { code: 'MODEL_NOT_IN_POLICY' });
    assert.throws(() => runtime.create(good, { raw: 'x' }, { assignment: { norm: M } }), { code: 'ASSIGNMENT_INVALID' });
    assert.throws(() => runtime.create(good, { raw: 'x' }, { assignment: { other: S2 } }), { code: 'ASSIGNMENT_INVALID' });
    assert.throws(() => runtime.create(good, { raw: 'x' }, { modelMode: 'record' }), { code: 'RUN_OPTIONS' });
    assert.throws(() => new Runtime(store, registry, {}, { models: { call() {} } }), { code: 'POLICY' }, 'a ModelPort without the policy is refused');
    store.close();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('agent: assignment picks the policy model for a node and is bound into the run', async t => {
  const h = harness(t, base([agent('norm', { model: { class: 'S' } })], accept('norm')), { runOptions: { assignment: { norm: S2 } }, script: { [S2]: [{ value: { amount: 7 } }] } });
  const run = await h.runtime.execute(h.run.id);
  assert.equal(run.status, 'succeeded', JSON.stringify(run.error));
  assert.equal(run.nodes.norm.modelId, S2);
  assert.deepEqual(run.assignment, { norm: S2 });
  assert.equal(h.events()[0].assignmentHash, run.assignmentHash);
  assert.equal(h.events()[0].modelPolicyHash, loaded.hash);
  assert.equal(run.modelPolicyHash, loaded.hash);
});

test('agent: labels taint context, quarantine declassifies, and untrusted data cannot reach an ungated effect', async t => {
  const labels = { 'input.raw': 'untrusted:upload' };
  const verdictSchema = { type: 'object', additionalProperties: false, required: ['action'], properties: { action: { type: 'string', enum: ['rollback', 'none'] } } };
  const quarantined = agent('pick', { returns: verdictSchema, quarantined: true, checks: undefined });
  const open = agent('pick', { returns: { type: 'object', additionalProperties: false, required: ['action'], properties: { action: { type: 'string', maxLength: 20 } } }, checks: undefined });
  const effect = { id: 'act', kind: 'task', needs: ['pick'], description: 'Apply the chosen synthetic action', tool: 'fixture.remediate', args: { action: { $ref: 'nodes.pick.action' } }, timeoutMs: 2000, retry: { maxAttempts: 1 } };
  const acceptance = [{ op: 'exists', value: { $ref: 'nodes.act.attempted' } }];
  assert.ok(codes(base([open, effect], acceptance, { labels })).includes('UNTRUSTED_EFFECT_ARGS'), 'free text from untrusted input cannot drive an ungated effect');
  assert.deepEqual(codes(base([open, effect], acceptance)), [], 'the same graph over trusted input is valid');
  assert.ok(codes(base([agent('pick', { returns: { ...amount, properties: { amount: { type: 'number' } } }, quarantined: true, checks: undefined })], [{ op: 'exists', value: { $ref: 'nodes.pick.amount' } }])).includes('QUARANTINE_SCHEMA'), 'unbounded numbers are not quarantinable');
  assert.ok(codes(base([agent('pick', { returns: open.returns, quarantined: true })], accept('pick'))).includes('QUARANTINE_SCHEMA'));

  const h = harness(t, base([quarantined, effect], acceptance, { labels }), { runOptions: { fixture: { correctAction: 'rollback', healthy: false, observations: {} } }, script: { [S]: [{ value: { action: 'rollback' } }] } });
  const run = await h.runtime.execute(h.run.id);
  assert.equal(run.status, 'succeeded', JSON.stringify(run.error));
  assert.ok(h.provider.calls[0].prompt.includes(`${UNTRUSTED_PREAMBLE}\n<input name="raw" label="untrusted:upload">`));
  const [compiled] = h.of('context.compiled');
  assert.deepEqual([compiled.receipt.outputLabel, compiled.receipt.declassifiedFrom], ['trusted', 'untrusted:upload']);
  assert.equal(run.nodes.pick.outputLabel, undefined, 'a quarantined judgment is trusted');

  const plain = harness(t, base([agent('norm')], accept('norm'), { labels }), { script: { [S]: [{ value: { amount: 5 } }] } });
  const tainted = await plain.runtime.execute(plain.run.id);
  assert.equal(tainted.nodes.norm.outputLabel, 'untrusted:upload');
});

test('agent: identity envelope is runtime-owned and validated; model policy drift blocks resume without a provider call', async t => {
  const arc = { taskId: 'task-1', taskSpecDigest: `sha256:${'a'.repeat(64)}`, eventCursor: 3 };
  const workflow = base([{ id: 'gate', kind: 'human', needs: [], description: 'Pause before the model step', question: 'Proceed?', answerSchema: { type: 'boolean' } },
    agent('norm', { needs: ['gate'] })], accept('norm'));
  const h = harness(t, workflow, { runOptions: { identity: { arc } }, script: { [S]: [{ value: { amount: 1 } }] } });
  validateIdentity(h.run.identity);
  assert.deepEqual(h.run.identity.arc, arc);
  assert.equal(h.run.identity.foundry.runId, h.run.id);
  assert.equal(h.run.identity.foundry.workflowHash, h.run.workflowHash);
  assert.equal(h.run.sampleSalt, h.run.id, 'fresh samples per run by default');
  assert.throws(() => h.runtime.create(workflow, { raw: 'x' }, { identity: { foundry: { runId: 'forged' } } }), { code: 'RUN_OPTIONS' });
  assert.equal((await h.runtime.execute(h.run.id)).status, 'awaiting_human');
  h.runtime.answer(h.run.id, 'root/gate', true);
  const changed = { ...structuredClone(loaded.policy), policyVersion: 'changed-for-test' };
  const drifted = new Runtime(h.store, h.registry, {}, { models: new ModelPort({ policy: changed, providers: { 'llama-server': h.provider }, journal: new Journal(h.store) }), modelPolicy: changed });
  await assert.rejects(drifted.execute(h.run.id), { code: 'MODEL_POLICY_DRIFT' });
  await assert.rejects(new Runtime(h.store, h.registry).execute(h.run.id), { code: 'MODEL_POLICY_REQUIRED' });
  assert.equal(h.provider.calls.length, 0);
  const resumed = await h.runtime.execute(h.run.id);
  assert.equal(resumed.status, 'succeeded', JSON.stringify(resumed.error));
});

test('agent: inside a map body each item is its own journaled node key and the item label reaches the receipt', async t => {
  const workflow = base([{ id: 'each', kind: 'map', needs: [], description: 'Normalise each row', items: { $ref: 'input.rows' }, maxItems: 4,
    body: { nodes: [agent('norm', { context: { inputs: [{ name: 'row', ref: 'item', render: 'text' }] } })], acceptance: [{ op: 'gte', left: { $ref: 'nodes.norm.amount' }, right: 0 }] } }],
  [{ op: 'eq', left: { $ref: 'nodes.each.count' }, right: 2 }], { labels: { 'input.rows': 'untrusted:csv' } });
  const h = harness(t, workflow, { input: { rows: ['one', 'two'] }, script: { [S]: [{ value: { amount: 1 } }, { value: { amount: 2 } }] } });
  const run = await h.runtime.execute(h.run.id);
  assert.equal(run.status, 'succeeded', JSON.stringify(run.error));
  assert.deepEqual(new Journal(h.store).forRun(run.id).map(r => r.nodeKey), ['root/each:0/norm', 'root/each:1/norm']);
  assert.deepEqual(h.of('context.compiled').map(e => e.receipt.inputs[0].label), ['untrusted:csv', 'untrusted:csv']);
  assert.equal(run.nodes.each.outputLabel, 'untrusted:csv');
  assert.deepEqual(run.outputs.each.items.map(x => x.norm.amount), [1, 2]);
});

test('agent: Foundry validates against the committed owner policy and never wires a ModelPort implicitly', async t => {
  const { Foundry } = await import('../src/foundry.mjs');
  const root = mkdtempSync(path.join(tmpdir(), 'foundry-agent-facade-'));
  const foundry = new Foundry(root);
  t.after(async () => { await foundry.close(); rmSync(root, { recursive: true, force: true }); });
  const workflow = base([agent('norm')], accept('norm'));
  assert.equal(foundry.validate(workflow).valid, true, JSON.stringify(foundry.validate(workflow).errors));
  assert.ok(foundry.validate(base([agent('norm', { model: { id: 'gpt-4o' } })], accept('norm'))).errors.some(e => e.code === 'MODEL_NOT_IN_POLICY'));
  foundry.save(workflow);
  const created = foundry.createRun(workflow.id, { raw: 'x' }, { sampleSalt: 'trial:0', modelMode: 'replay-or-live' });
  assert.deepEqual([created.sampleSalt, created.modelMode, created.modelPolicyHash], ['trial:0', 'replay-or-live', loaded.hash]);
  assert.equal(created.extra, undefined);
  const run = await foundry.startRun(created.id);
  assert.equal(run.error.code, 'MODEL_PORT_REQUIRED');
  assert.equal(run.verdict.verdict, 'harness_fault');
});

// P0 (research/architecture-20261014/MEMORY-ROUTING-RECURSION.md §2 change 1, §5 row 1): the hosted classes' input budget is
// 100,000 tokens, so a Haiku agent node given a 60K-token input compiles it whole, under either overflow policy: not refused
// (CONTEXT_OVERFLOW), not truncated. The class-M budget before 2026-10-15 (8,000) refused the same node before any call.
test('agent: a Haiku node with a 60K-token input is neither refused nor truncated under the committed policy', async t => {
  const haiku = 'claude-haiku-5-5';
  let raw = '';
  for (let i = 0; Buffer.byteLength(raw) < 60000 * 4; i++) raw += `row ${String(i).padStart(6, '0')}: amount 5 USD, reference ${'x'.repeat(40)}\n`;
  const haikuAgent = onOverflow => agent('norm', { model: { id: haiku },
    context: { inputs: [{ name: 'raw', ref: 'input.raw', render: 'text' }], ...(onOverflow ? { budget: { onOverflow } } : {}) } });
  for (const onOverflow of [undefined, 'truncate']) await t.test(`onOverflow ${onOverflow ?? 'fail (default)'}`, async t => {
    const h = harness(t, base([haikuAgent(onOverflow)], accept('norm')), { input: { raw }, script: { [haiku]: [{ value: { amount: 5 } }] } });
    const run = await h.runtime.execute(h.run.id);
    assert.equal(run.status, 'succeeded', JSON.stringify(run.error));
    assert.deepEqual(h.provider.calls.map(c => c.modelId), [haiku], 'one call, on Haiku');
    assert.ok(h.provider.calls[0].prompt.includes(raw), 'the whole input reaches the model');
    const compiled = h.of('context.compiled');
    assert.equal(compiled.length, 1);
    assert.equal(compiled[0].receipt.budget.maxInputTokens, 100000);
    assert.ok(compiled[0].receipt.totalTokens > 60000 && compiled[0].receipt.totalTokens < 100000, `totalTokens ${compiled[0].receipt.totalTokens}`);
    assert.deepEqual(compiled[0].receipt.inputs.map(i => [i.name, i.truncated]), [['raw', false]]);
    assert.equal(h.of('model.escalated').length, 0);
  });
  // Control: the same node and input under the old class-M budget is refused.
  assert.throws(() => compileContext({ node: haikuAgent(), inputs: [{ name: 'raw', value: raw, label: 'trusted' }], classBudget: 8000 }),
    e => e.code === 'CONTEXT_OVERFLOW' && /budget is 8000/.test(e.message));
});
