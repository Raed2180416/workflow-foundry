import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { Store } from '../src/store.mjs';
import { Runtime } from '../src/runtime.mjs';
import { createDefaultRegistry } from '../src/capabilities.mjs';
import { validateWorkflow } from '../src/validate.mjs';
import { FoundryError } from '../src/data.mjs';

// Independent, hand-authored contract probes. All capabilities are pure local
// computations or synthetic effects. These are development tests, not model runs,
// upstream-product tests, robotics deployment tests or a sealed benchmark.
const audit = (name, fn) => test(`control audit: ${name}`, { timeout: 5000 }, fn);
const ref = ($ref, ...fallback) => ({ $ref, ...(fallback.length ? { default: fallback[0] } : {}) });
const eq = (left, right) => ({ op: 'eq', left, right });
const exists = value => ({ op: 'exists', value });
const task = (id, tool, args = {}, needs = [], extra = {}) => ({
  id, kind: 'task', needs, description: `Synthetic contract probe ${id}`,
  tool, args, timeoutMs: 1000, retry: { maxAttempts: 1 }, ...extra
});
const base = (nodes, acceptance, budget = {}) => ({
  schemaVersion: '1.0', id: 'ControlAudit', version: 1,
  title: 'Independent control contract probe', domain: 'diagnostic',
  goal: 'Exercise control behavior with synthetic local inputs and explicit oracles.',
  envelope: { assumptions: ['Synthetic local capabilities only'], risks: [], successCriteria: ['The asserted control invariant holds.'] },
  budget: { maxSteps: 100, maxConcurrency: 3, maxDurationMs: 4000, maxCost: 0, ...budget },
  nodes, acceptance
});
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
function register(registry, name, execute, extra = {}) {
  registry.register({
    name, description: 'Local synthetic audit capability', version: '1',
    implementation: `control-audit/${name}`, inputSchema: {}, outputSchema: {},
    effects: 'none', risk: 'low', requiresApproval: false, maxTimeoutMs: 2000,
    cancellation: 'cooperative', cost: 0, execute, ...extra
  });
}
function harness(t, workflow, { registry = createDefaultRegistry(), policy = {}, input = {}, runOptions = {} } = {}) {
  const root = fileURLToPath(new URL('../evals/runs/', import.meta.url));
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const workspace = mkdtempSync(`${root}control-audit-`);
  const h = { workspace, registry, store: new Store(workspace) };
  h.policy = { allowedCapabilities: registry.list().map(x => x.name), maxSteps: 100, maxConcurrency: 3, maxDurationMs: 4000, maxCost: 0, ...policy };
  t.after(() => { h.store.close(); rmSync(workspace, { recursive: true }); });
  const validation = validateWorkflow(workflow, { registry });
  assert.equal(validation.valid, true, JSON.stringify(validation.errors));
  h.saved = h.store.saveWorkflow(workflow);
  h.runtime = new Runtime(h.store, registry, h.policy);
  h.run = h.runtime.create(workflow, input, runOptions);
  h.reopen = () => { h.store.close(); h.store = new Store(workspace); h.runtime = new Runtime(h.store, registry, h.policy); };
  return h;
}
function nestedWorkflow() {
  return base([{
    id: 'each', kind: 'map', needs: [], description: 'Map two synthetic limits',
    items: [2, 3], maxItems: 2,
    body: {
      nodes: [{
        id: 'repeat', kind: 'loop', needs: [], description: 'Increment to the bound',
        maxIterations: 4, initial: { step: { value: 0 } }, input: { limit: ref('item') },
        until: { op: 'gte', left: ref('nodes.step.value'), right: ref('input.limit') },
        body: {
          nodes: [task('step', 'audit.increment', { value: ref('previous.step.value') })],
          acceptance: [exists(ref('nodes.step.value'))]
        }
      }],
      acceptance: [eq(ref('nodes.repeat.last.step.value'), ref('item'))]
    }
  }], [eq(ref('nodes.each.count'), 2), eq(ref('nodes.each.items.0.repeat.last.step.value'), 2), eq(ref('nodes.each.items.1.repeat.last.step.value'), 3)]);
}

audit('nested map/loop dataflow is namespaced, charged and not replayed on completed resume', async t => {
  let calls = 0;
  const registry = createDefaultRegistry();
  register(registry, 'audit.increment', async ({ value }) => { calls++; return { value: value + 1 }; });
  const h = harness(t, nestedWorkflow(), { registry });
  const run = await h.runtime.execute(h.run.id);
  assert.equal(run.status, 'succeeded', JSON.stringify(run.error));
  assert.equal(run.steps, 8);
  assert.equal(calls, 5);
  assert.equal(Object.keys(run.frames).length, 7);
  h.reopen();
  assert.equal((await h.runtime.execute(run.id)).status, 'succeeded');
  assert.equal(calls, 5, 'Completed nested work must not be re-dispatched.');
});

audit('the shared step budget covers nested map and loop work', async t => {
  let calls = 0;
  const registry = createDefaultRegistry();
  register(registry, 'audit.increment', async ({ value }) => { calls++; return { value: value + 1 }; });
  const workflow = nestedWorkflow(); workflow.budget.maxSteps = 5;
  const h = harness(t, workflow, { registry });
  const run = await h.runtime.execute(h.run.id);
  assert.equal(run.status, 'failed');
  assert.equal(run.error.code, 'STEP_BUDGET');
  assert.equal(run.steps, 5);
  assert.equal(calls, 2, 'A parent loop charge must also consume the shared budget.');
});

audit('exhausting a loop without its until predicate is failure', async t => {
  const registry = createDefaultRegistry();
  register(registry, 'audit.increment', async ({ value }) => ({ value: value + 1 }));
  const workflow = nestedWorkflow();
  workflow.nodes[0].body.nodes[0].maxIterations = 1;
  const h = harness(t, workflow, { registry });
  const run = await h.runtime.execute(h.run.id);
  assert.equal(run.status, 'failed');
  assert.equal(run.error.code, 'LOOP_EXHAUSTED');
  assert.equal(run.outputs.each, undefined);
});

audit('map input cardinality is enforced before child tool dispatch', async t => {
  let calls = 0;
  const registry = createDefaultRegistry();
  register(registry, 'audit.increment', async ({ value }) => { calls++; return { value: value + 1 }; });
  const workflow = nestedWorkflow(); workflow.nodes[0].maxItems = 1;
  // The independent static checker now rejects index 1 for a maxItems=1 output.
  // Retain a structurally valid acceptance to exercise the earlier runtime
  // cardinality guard on the two supplied items, before any child dispatch.
  workflow.acceptance = [exists(ref('nodes.each.count'))];
  const h = harness(t, workflow, { registry });
  const run = await h.runtime.execute(h.run.id);
  assert.equal(run.error.code, 'MAP_BOUND');
  assert.equal(calls, 0);
});

audit('nested and top-level undeclared data dependencies are rejected', () => {
  const registry = createDefaultRegistry();
  const workflow = base([
    task('a', 'core.identity', { value: 1 }),
    task('b', 'core.identity', { value: ref('nodes.a.value') })
  ], [exists(ref('nodes.b'))]);
  const result = validateWorkflow(workflow, { registry });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(e => e.code === 'UNDECLARED_DATA_DEPENDENCY'));
  const nested = nestedWorkflow();
  register(registry, 'audit.increment', async args => args);
  nested.nodes[0].body.nodes[0].body.nodes[0].args = { value: ref('item') };
  const invalidLocal = validateWorkflow(nested, { registry });
  assert.equal(invalidLocal.valid, false);
  assert.ok(invalidLocal.errors.some(e => e.code === 'INVALID_LOCAL_REFERENCE'));
});

audit('skipped branches resolve ordering but cannot invent outputs', async t => {
  const skipped = task('optional', 'core.identity', { value: 'invented' }, [], { when: eq(ref('input.enabled'), true) });
  const workflow = base([skipped, task('consume', 'core.identity', { value: ref('nodes.optional.value') }, ['optional'], { join: 'all_resolved' })], [exists(ref('nodes.consume.value'))]);
  const h = harness(t, workflow, { input: { enabled: false } });
  const run = await h.runtime.execute(h.run.id);
  assert.equal(run.status, 'failed');
  assert.equal(run.error.code, 'MISSING_REFERENCE');
  assert.equal(run.nodes.optional.status, 'skipped');
  assert.equal(run.outputs.optional, undefined);
});

audit('an explicit default makes an intentionally skipped branch usable', async t => {
  const workflow = base([
    task('optional', 'core.identity', { value: 'unused' }, [], { when: eq(ref('input.enabled'), true) }),
    task('consume', 'core.identity', { value: ref('nodes.optional.value', 'fallback') }, ['optional'], { join: 'all_resolved' })
  ], [eq(ref('nodes.consume.value'), 'fallback')]);
  const h = harness(t, workflow, { input: { enabled: false } });
  const run = await h.runtime.execute(h.run.id);
  assert.equal(run.status, 'succeeded');
  assert.equal(run.steps, 1);
});

audit('a skipped prerequisite cannot admit a downstream synthetic effect by default', async t => {
  let effects = 0;
  const registry = createDefaultRegistry();
  register(registry, 'audit.effect', async () => { effects++; return { applied: true }; }, { effects: 'idempotent' });
  register(registry, 'audit.effectCount', async () => ({ effects }));
  const workflow = base([
    task('guard', 'core.identity', { approved: true }, [], { when: eq(ref('input.enabled'), true) }),
    task('effect', 'audit.effect', {}, ['guard']),
    task('observe', 'audit.effectCount', {}, ['effect'], { join: 'all_resolved' })
  ], [eq(ref('nodes.observe.effects'), 0)]);
  const h = harness(t, workflow, { registry, input: { enabled: false } });
  const run = await h.runtime.execute(h.run.id);
  assert.equal(run.status, 'succeeded');
  assert.equal(run.nodes.guard.status, 'skipped');
  assert.equal(run.nodes.effect.status, 'skipped');
  assert.equal(effects, 0);
  assert.equal(h.store.events(run.id).some(e => e.type === 'tool.intent' && e.tool === 'audit.effect'), false);
});

audit('handled errors remain distinct and cannot satisfy a successful prerequisite', async t => {
  let effects = 0;
  const registry = createDefaultRegistry();
  register(registry, 'audit.effect', async () => { effects++; return { applied: true }; }, { effects: 'idempotent' });
  register(registry, 'audit.effectCount', async () => ({ effects }));
  const workflow = base([
    task('guard', 'core.fail', { message: 'Synthetic failed prerequisite' }, [], { onError: 'continue' }),
    task('effect', 'audit.effect', {}, ['guard']),
    task('observe', 'audit.effectCount', {}, ['effect'], { join: 'all_resolved' })
  ], [eq(ref('nodes.observe.effects'), 0), eq(ref('nodes.guard.ok'), false)]);
  const h = harness(t, workflow, { registry });
  const run = await h.runtime.execute(h.run.id);
  assert.equal(run.status, 'succeeded');
  assert.equal(run.nodes.guard.status, 'handled_error');
  assert.equal(run.nodes.effect.status, 'skipped');
  assert.equal(effects, 0);
});

audit('nested human answers survive store reopen without replaying prior tasks', async t => {
  let calls = 0;
  const registry = createDefaultRegistry();
  register(registry, 'audit.record', async ({ value }) => { calls++; return { value }; });
  const workflow = base([{
    id: 'each', kind: 'map', description: 'Ask about two synthetic records', needs: [], items: ['a', 'b'], maxItems: 2,
    body: {
      nodes: [
        task('before', 'audit.record', { value: ref('item') }),
        { id: 'ask', kind: 'human', needs: ['before'], description: 'Explicit synthetic answer', question: 'Continue this synthetic case?', answerSchema: { type: 'boolean' } },
        task('after', 'core.identity', { answer: ref('nodes.ask.answer') }, ['ask'])
      ], acceptance: [eq(ref('nodes.after.answer'), true)]
    }
  }], [eq(ref('nodes.each.count'), 2)]);
  const h = harness(t, workflow, { registry });
  assert.equal((await h.runtime.execute(h.run.id)).status, 'awaiting_human');
  assert.equal(calls, 1);
  h.reopen();
  assert.throws(() => h.runtime.answer(h.run.id, 'root/each:0/ask', 'yes'), { code: 'SCHEMA_MISMATCH' });
  h.runtime.answer(h.run.id, 'root/each:0/ask', true);
  assert.throws(() => h.runtime.answer(h.run.id, 'root/each:0/ask', true), { code: 'NO_QUESTION' });
  assert.equal((await h.runtime.execute(h.run.id)).status, 'awaiting_human');
  assert.equal(calls, 2);
  h.reopen();
  h.runtime.answer(h.run.id, 'root/each:1/ask', true);
  const run = await h.runtime.execute(h.run.id);
  assert.equal(run.status, 'succeeded', JSON.stringify(run.error));
  assert.equal(calls, 2);
  assert.equal(run.steps, 7);
});

audit('concurrent nested flows obey the run-wide capability concurrency limit', async t => {
  let active = 0, peak = 0, calls = 0;
  const registry = createDefaultRegistry();
  register(registry, 'audit.concurrent', async ({ value }, { signal }) => {
    active++; calls++; peak = Math.max(peak, active);
    try { await delay(5, undefined, { signal }); return { value }; }
    finally { active--; }
  });
  const map = id => ({ id, kind: 'map', needs: [], description: 'Synthetic concurrent map', items: [1, 2, 3], maxItems: 3,
    body: { nodes: [task('a', 'audit.concurrent', { value: ref('item') }), task('b', 'audit.concurrent', { value: ref('item') })], acceptance: [eq(ref('nodes.a.value'), ref('nodes.b.value'))] } });
  const workflow = base([map('left'), map('right')], [eq(ref('nodes.left.count'), 3), eq(ref('nodes.right.count'), 3)], { maxConcurrency: 2 });
  const h = harness(t, workflow, { registry, policy: { maxConcurrency: 2 } });
  const run = await h.runtime.execute(h.run.id);
  assert.equal(run.status, 'succeeded');
  assert.equal(calls, 12);
  assert.equal(peak, 2);
  assert.equal(active, 0);
});

audit('cost reservations prevent excess dispatch under concurrency', async t => {
  let calls = 0;
  const registry = createDefaultRegistry();
  register(registry, 'audit.cost', async () => { calls++; return { ok: true }; }, { cost: 0.25 });
  const workflow = base(['a', 'b', 'c'].map(id => task(id, 'audit.cost')), [exists(ref('nodes.c.ok'))], { maxCost: 0.5 });
  const h = harness(t, workflow, { registry, policy: { maxCost: 0.5 } });
  const run = await h.runtime.execute(h.run.id);
  assert.equal(run.status, 'failed');
  assert.equal(run.error.code, 'COST_BUDGET');
  assert.equal(run.cost, 0.5);
  assert.equal(calls, 2);
});

audit('tool output schemas reject fabricated success-shaped results', async t => {
  const registry = createDefaultRegistry();
  register(registry, 'audit.wrongOutput', async () => ({ ok: 'true' }), { outputSchema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } }, additionalProperties: false } });
  const h = harness(t, base([task('bad', 'audit.wrongOutput')], [eq(ref('nodes.bad.ok'), true)]), { registry });
  const run = await h.runtime.execute(h.run.id);
  assert.equal(run.status, 'failed');
  assert.equal(run.error.code, 'SCHEMA_MISMATCH');
  assert.equal(run.outputs.bad, undefined);
});

audit('non-idempotent errors preserve intent and uncertainty and never auto-retry', async t => {
  let calls = 0, sawIntent = false;
  const registry = createDefaultRegistry();
  register(registry, 'audit.uncertain', async (_, ctx) => {
    calls++;
    sawIntent = ctx.store.events(ctx.runId).some(e => e.type === 'tool.intent' && e.nodeKey === ctx.nodeKey);
    throw new FoundryError('SYNTHETIC_LOST_RECEIPT', 'Synthetic acceptance receipt lost');
  }, { effects: 'non-idempotent' });
  const h = harness(t, base([task('effect', 'audit.uncertain')], [exists(ref('nodes.effect'))]), { registry });
  const run = await h.runtime.execute(h.run.id);
  assert.equal(run.status, 'uncertain');
  assert.equal(run.nodes.effect.status, 'uncertain');
  assert.equal(sawIntent, true);
  h.reopen();
  assert.equal((await h.runtime.execute(run.id)).status, 'uncertain');
  assert.equal(calls, 1);
});

audit('unconfirmed timeout stays uncertain even when the handler later returns', async t => {
  let calls = 0;
  const gate = deferred(), registry = createDefaultRegistry();
  register(registry, 'audit.late', async () => { calls++; await gate.promise; return { accepted: true }; }, { effects: 'idempotent' });
  const workflow = base([task('late', 'audit.late', {}, [], { timeoutMs: 10, retry: { maxAttempts: 2 } })], [exists(ref('nodes.late.accepted'))]);
  const h = harness(t, workflow, { registry });
  let run;
  try { run = await h.runtime.execute(h.run.id); }
  finally { gate.resolve(); await delay(0); }
  assert.equal(run.status, 'uncertain');
  assert.equal(run.nodes.late.attempts, 1);
  assert.equal((await h.runtime.execute(run.id)).status, 'uncertain');
  assert.equal(calls, 1);
});

audit('actual worker process loss does not duplicate an idempotent simulator effect', async t => {
  const workflow = base([
    task('effect', 'fixture.remediate', { action: 'rollback' }, [], { retry: { maxAttempts: 2 } }),
    task('verify', 'fixture.verify', {}, ['effect'])
  ], [eq(ref('nodes.verify.healthy'), true), eq(ref('nodes.verify.actionCount'), 1)]);
  const h = harness(t, workflow, { runOptions: { fixture: { correctAction: 'rollback', healthy: false, observations: {} }, extra: { crashAfterTool: 'root/effect' } } });
  const childCode = `import {Store} from ${JSON.stringify(new URL('../src/store.mjs', import.meta.url).href)};\nimport {Runtime} from ${JSON.stringify(new URL('../src/runtime.mjs', import.meta.url).href)};\nimport {createDefaultRegistry} from ${JSON.stringify(new URL('../src/capabilities.mjs', import.meta.url).href)};\nconst store=new Store(process.argv[1]);await new Runtime(store,createDefaultRegistry()).execute(process.argv[2]);`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', childCode, h.workspace, h.run.id], { encoding: 'utf8', timeout: 3000, env: { PATH: process.env.PATH ?? '' } });
  assert.equal(child.signal, 'SIGKILL', child.stderr);
  assert.equal(h.store.fixture(h.run.id).actions.length, 1);
  h.store.updateRun(h.run.id, run => { delete run.extra.crashAfterTool; }, { type: 'audit.crash-injection-disabled' });
  const run = await h.runtime.execute(h.run.id);
  assert.equal(run.status, 'succeeded', JSON.stringify(run.error));
  assert.equal(run.nodes.effect.attempts, 2);
  assert.equal(h.store.fixture(run.id).actions.length, 1);
  assert.ok(h.store.events(run.id).some(e => e.type === 'node.recovered'));
});

audit('a live runner excludes a second invocation of the same run', async t => {
  let calls = 0;
  const entered = deferred(), release = deferred(), registry = createDefaultRegistry();
  register(registry, 'audit.held', async () => { calls++; entered.resolve(); await release.promise; return { ok: true }; });
  const h = harness(t, base([task('held', 'audit.held')], [eq(ref('nodes.held.ok'), true)]), { registry });
  const first = h.runtime.execute(h.run.id);
  await entered.promise;
  try { await assert.rejects(h.runtime.execute(h.run.id), { code: 'RUN_BUSY' }); }
  finally { release.resolve(); }
  assert.equal((await first).status, 'succeeded');
  assert.equal(calls, 1);
});

audit('workflow revisions preserve active run pins and cannot reuse another run approval', async t => {
  let calls = 0;
  const registry = createDefaultRegistry();
  register(registry, 'audit.approved', async args => { calls++; return args; }, { risk: 'high', requiresApproval: true });
  const workflow = base([task('act', 'audit.approved', { value: 'old' })], [eq(ref('nodes.act.value'), 'old')]);
  const h = harness(t, workflow, { registry });
  const oldRun = await h.runtime.execute(h.run.id);
  assert.equal(oldRun.status, 'awaiting_approval');
  const oldApproval = Object.keys(oldRun.approvals)[0];
  h.runtime.approve(oldRun.id, oldApproval, true);
  const next = structuredClone(workflow); next.version = 2; next.nodes[0].args.value = 'new'; next.acceptance[0].right = 'new';
  const request = h.store.createRequest({ workflowId: workflow.id, baseHash: h.saved.hash, text: 'Change the synthetic value for future runs.' });
  const proposal = h.store.createProposal({ requestId: request.id, workflow: next, rationale: 'Synthetic revision probe', validation: validateWorkflow(next, { registry }) });
  h.store.applyProposal(proposal.id);
  assert.equal(h.store.run(oldRun.id).workflowHash, h.saved.hash);
  const newRun = await h.runtime.execute(h.runtime.create(next).id);
  assert.equal(newRun.status, 'awaiting_approval');
  assert.throws(() => h.runtime.approve(newRun.id, oldApproval, true), { code: 'APPROVAL_CONFLICT' });
  assert.equal((await h.runtime.execute(oldRun.id)).outputs.act.value, 'old');
  assert.equal(calls, 1);
});

audit('stale proposals cannot replace a newer workflow head', async t => {
  const workflow = base([task('value', 'core.identity', { n: 1 })], [eq(ref('nodes.value.n'), 1)]);
  const h = harness(t, workflow);
  const proposals = [2, 3].map(n => {
    const next = structuredClone(workflow); next.version = 2; next.nodes[0].args.n = n; next.acceptance[0].right = n;
    const request = h.store.createRequest({ workflowId: workflow.id, baseHash: h.saved.hash, text: `Synthetic value ${n}` });
    return h.store.createProposal({ requestId: request.id, workflow: next, rationale: 'Independent competing proposal', validation: validateWorkflow(next, { registry: h.registry }) });
  });
  h.store.applyProposal(proposals[0].id);
  assert.throws(() => h.store.applyProposal(proposals[1].id), { code: 'STALE_WORKFLOW' });
  assert.equal(h.store.workflow(workflow.id).workflow.nodes[0].args.n, 2);
});

audit('a capability change blocks resuming an existing human-paused run', async t => {
  const registry = createDefaultRegistry();
  register(registry, 'audit.versioned', async () => ({ value: 'original' }));
  const workflow = base([
    { id: 'ask', kind: 'human', needs: [], description: 'Pause before the versioned capability', question: 'Proceed with the synthetic case?', answerSchema: { type: 'boolean' } },
    task('value', 'audit.versioned', {}, ['ask'])
  ], [eq(ref('nodes.value.value'), 'original')]);
  const h = harness(t, workflow, { registry });
  assert.equal((await h.runtime.execute(h.run.id)).status, 'awaiting_human');
  h.runtime.answer(h.run.id, 'root/ask', true);
  let changedCalls = 0;
  const changed = createDefaultRegistry();
  register(changed, 'audit.versioned', async () => { changedCalls++; return { value: 'changed' }; }, { version: '2' });
  const changedRuntime = new Runtime(h.store, changed, h.policy);
  await assert.rejects(changedRuntime.execute(h.run.id), { code: 'CAPABILITY_DRIFT' });
  assert.equal(changedCalls, 0);
  assert.equal((await h.runtime.execute(h.run.id)).status, 'succeeded');
});

audit('cancellation requested before a late pure result is not reported as success', async t => {
  const entered = deferred(), release = deferred(), registry = createDefaultRegistry();
  register(registry, 'audit.cancelledLate', async () => { entered.resolve(); await release.promise; return { ok: true }; });
  const h = harness(t, base([task('late', 'audit.cancelledLate')], [eq(ref('nodes.late.ok'), true)]), { registry });
  const controller = new AbortController();
  const running = h.runtime.execute(h.run.id, { signal: controller.signal });
  await entered.promise;
  controller.abort(); release.resolve();
  const run = await running;
  assert.equal(run.status, 'cancelled', 'Cancellation was requested before the handler returned.');
});

audit('cancellation during retry backoff is cancellation, not ordinary failure', async t => {
  const entered = deferred(), release = deferred(), registry = createDefaultRegistry();
  register(registry, 'audit.backoff', async () => { entered.resolve(); await release.promise; throw new FoundryError('SYNTHETIC_UNAVAILABLE', 'Synthetic retryable failure'); });
  const h = harness(t, base([task('retry', 'audit.backoff', {}, [], { retry: { maxAttempts: 2, backoffMs: 5 } })], [exists(ref('nodes.retry'))]), { registry });
  const controller = new AbortController();
  const running = h.runtime.execute(h.run.id, { signal: controller.signal });
  await entered.promise;
  controller.abort(); release.resolve();
  const run = await running;
  assert.equal(run.status, 'cancelled');
  assert.equal(run.nodes.retry.attempts, 1);
});

audit('a pure handler confirming abort is cancellation without another dispatch', async t => {
  let calls = 0;
  const entered = deferred(), registry = createDefaultRegistry();
  register(registry, 'audit.cooperative', async (_, { signal }) => {
    calls++; entered.resolve();
    await delay(1500, undefined, { signal });
    return { ok: true };
  });
  const h = harness(t, base([task('work', 'audit.cooperative', {}, [], { timeoutMs: 1900 })], [eq(ref('nodes.work.ok'), true)]), { registry });
  const controller = new AbortController();
  const running = h.runtime.execute(h.run.id, { signal: controller.signal });
  await entered.promise;
  controller.abort();
  const run = await running;
  assert.equal(run.status, 'cancelled');
  assert.equal(calls, 1);
  assert.equal(run.outputs.work, undefined);
});

audit('a real failure remains the cause when it cancels an earlier sibling', async t => {
  const entered = deferred(), registry = createDefaultRegistry();
  register(registry, 'audit.sibling', async (_, { signal }) => {
    entered.resolve(); await delay(1500, undefined, { signal }); return { ok: true };
  });
  register(registry, 'audit.cause', async () => {
    await entered.promise;
    throw new FoundryError('SYNTHETIC_ROOT_CAUSE', 'The originating failure must survive sibling cancellation');
  });
  const workflow = base([
    task('earlierSibling', 'audit.sibling', {}, [], { timeoutMs: 1900 }),
    task('origin', 'audit.cause')
  ], [exists(ref('nodes.origin'))]);
  const h = harness(t, workflow, { registry });
  const run = await h.runtime.execute(h.run.id);
  assert.equal(run.status, 'failed');
  assert.equal(run.error.code, 'SYNTHETIC_ROOT_CAUSE');
  assert.equal(run.nodes.origin.status, 'failed');
});

audit('caller cancellation cannot downgrade an ambiguous effect to confirmed cancellation', async t => {
  let calls = 0;
  const entered = deferred(), registry = createDefaultRegistry();
  register(registry, 'audit.effectAbort', async (_, { signal }) => {
    calls++; entered.resolve(); await delay(1500, undefined, { signal }); return { ok: true };
  }, { effects: 'non-idempotent' });
  const h = harness(t, base([task('effect', 'audit.effectAbort', {}, [], { timeoutMs: 1900 })], [eq(ref('nodes.effect.ok'), true)]), { registry });
  const controller = new AbortController();
  const running = h.runtime.execute(h.run.id, { signal: controller.signal });
  await entered.promise;
  controller.abort();
  const run = await running;
  assert.equal(run.status, 'uncertain');
  assert.equal(run.nodes.effect.status, 'uncertain');
  assert.equal((await h.runtime.execute(run.id)).status, 'uncertain');
  assert.equal(calls, 1);
});
