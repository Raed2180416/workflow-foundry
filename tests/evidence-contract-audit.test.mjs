import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { Store } from '../src/store.mjs';
import { Runtime } from '../src/runtime.mjs';
import { CapabilityRegistry } from '../src/capabilities.mjs';
import { validateWorkflow } from '../src/validate.mjs';
import { FoundryError } from '../src/data.mjs';

// Independent development probes, never model/comparator artifacts. Every tool
// below is a synthetic host registration. No external calls, corpus execution or
// physical effects. The authoritative effect counter lives outside run outputs.
const audit = (name, fn) => test(`evidence contract: ${name}`, { timeout: 5000 }, fn);
const copy = value => structuredClone(value);
const ref = ($ref, ...fallback) => ({ $ref, ...(fallback.length ? { default: fallback[0] } : {}) });
const eq = (left, right) => ({ op: 'eq', left, right });
const exists = value => ({ op: 'exists', value });
const task = (id, tool, args = {}, needs = [], extra = {}) => ({
  id, kind: 'task', needs, description: `Synthetic evidence probe ${id}`,
  tool, args, timeoutMs: 1000, retry: { maxAttempts: 1 }, ...extra
});
const human = (id, needs) => ({
  id, kind: 'human', needs, description: 'Pause the local fixture',
  question: 'Continue this synthetic test?', answerSchema: { type: 'boolean' }
});
const workflow = (nodes, acceptance = [eq(ref('nodes.act.applied'), true)]) => ({
  schemaVersion: '1.0', id: 'EvidenceContractAudit', version: 1,
  title: 'Independent evidence contract audit', domain: 'diagnostic',
  goal: 'Admit a synthetic effect only with required source evidence.',
  envelope: { assumptions: ['Synthetic host tools only'], risks: [], successCriteria: ['Independent dispatch counters satisfy the test invariant.'] },
  budget: { maxSteps: 50, maxConcurrency: 1, maxDurationMs: 60000, maxCost: 0 },
  nodes, acceptance
});
const validOutput = () => ({ measurement: { approved: true, value: 7 } });
const requirement = (overrides = {}) => ({
  id: 'qualifiedMeasurement', sourceTool: 'audit.observe',
  sourceArgs: { scope: ref('input.scope') }, path: 'measurement',
  schema: {
    type: 'object', additionalProperties: false, required: ['approved', 'value'],
    properties: { approved: { const: true }, value: { type: 'number' } }
  },
  maxAgeMs: 10000, ...overrides
});
function register(registry, name, execute, extra = {}) {
  registry.register({
    name, description: 'Synthetic local evidence-audit tool', version: '1',
    implementation: `evidence-contract-audit/${name}`, inputSchema: {}, outputSchema: {},
    effects: 'none', risk: 'low', requiresApproval: false,
    cancellation: 'cooperative', maxTimeoutMs: 2000, cost: 0, execute, ...extra
  });
}
function tools({ observation = validOutput, requirements = [requirement()], beforeEffect, effectDescriptor = {} } = {}) {
  const registry = new CapabilityRegistry();
  const reads = [], dispatches = [], actions = [], applied = new Map();
  register(registry, 'audit.observe', async (args, ctx) => {
    reads.push({ args: copy(args), nodeKey: ctx.nodeKey, runId: ctx.runId });
    return copy(await observation(reads.length, args, ctx));
  });
  register(registry, 'audit.identity', async args => args);
  register(registry, 'audit.effect', async (args, ctx) => {
    dispatches.push({ args: copy(args), nodeKey: ctx.nodeKey, runId: ctx.runId, key: ctx.idempotencyKey });
    if (beforeEffect) await beforeEffect(dispatches.length, args, ctx);
    if (!applied.has(ctx.idempotencyKey)) {
      actions.push({ scope: args.scope, key: ctx.idempotencyKey });
      applied.set(ctx.idempotencyKey, { applied: true });
    }
    return applied.get(ctx.idempotencyKey);
  }, { effects: 'idempotent', requiresEvidence: requirements, ...effectDescriptor });
  return { registry, reads, dispatches, actions };
}
function harness(t, program, kit, input = {}) {
  const root = fileURLToPath(new URL('../evals/runs/', import.meta.url));
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const workspace = mkdtempSync(`${root}evidence-contract-audit-`);
  const h = { kit, workspace, store: new Store(workspace) };
  t.after(() => { h.store.close(); rmSync(workspace, { recursive: true }); });
  const validation = validateWorkflow(program, { registry: kit.registry });
  assert.equal(validation.valid, true, JSON.stringify(validation.errors));
  h.saved = h.store.saveWorkflow(program);
  h.policy = { allowedCapabilities: kit.registry.list().map(c => c.name), maxConcurrency: program.budget.maxConcurrency, maxDurationMs: 60000 };
  h.runtime = new Runtime(h.store, kit.registry, h.policy);
  h.run = h.runtime.create(program, input);
  h.reopen = () => {
    h.store.close(); h.store = new Store(workspace);
    h.runtime = new Runtime(h.store, kit.registry, h.policy);
  };
  return h;
}
const basic = (readArgs = { scope: 'alpha' }, effectArgs = { scope: 'alpha' }) => workflow([
  task('read', 'audit.observe', readArgs),
  task('act', 'audit.effect', effectArgs, ['read'])
]);
const paused = (extra = []) => workflow([
  task('read', 'audit.observe', { scope: 'alpha' }), human('ask', ['read']),
  ...extra, task('act', 'audit.effect', { scope: 'alpha' }, [extra.at(-1)?.id ?? 'ask'])
]);
function clock(t) {
  let now = 2000000000000;
  t.mock.method(Date, 'now', () => now);
  return { advance: ms => { now += ms; }, current: () => now };
}
function noDispatch(kit, run, code) {
  assert.equal(kit.dispatches.length, 0, `Effect handler ran despite rejected evidence; run=${JSON.stringify({ status: run.status, error: run.error })}`);
  assert.equal(kit.actions.length, 0);
  assert.equal(run.status, 'failed');
  if (code) assert.equal(run.error?.code, code);
}

audit('valid scope-bound evidence admits exactly one effect and persists its completion sequence', async t => {
  const kit = tools(), h = harness(t, basic(), kit);
  const run = await h.runtime.execute(h.run.id);
  assert.equal(run.status, 'succeeded', JSON.stringify(run.error));
  assert.equal(kit.dispatches.length, 1);
  assert.equal(kit.actions.length, 1);
  const events = h.store.events(run.id), receipt = events.find(e => e.type === 'node.completed' && e.nodeKey === 'root/read');
  assert.equal(run.nodes.read.completedSequence, receipt.seq);
  assert.equal(run.eventHead.seq, events.length);
  assert.equal(run.eventHead.hash, events.at(-1).hash);
  h.reopen();
  assert.equal((await h.runtime.execute(run.id)).status, 'succeeded');
  assert.equal(kit.dispatches.length, 1, 'A completed run does not replay its effect.');
});

audit('missing source dependency is rejected before creating an executable run', () => {
  const kit = tools(), result = validateWorkflow(workflow([task('act', 'audit.effect', { scope: 'alpha' })]), { registry: kit.registry });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(e => e.code === 'MISSING_EVIDENCE_DEPENDENCY'));
  assert.equal(kit.dispatches.length, 0);
});

audit('a skipped source is absent evidence even with an all-resolved join', async t => {
  const kit = tools(), program = basic();
  program.nodes[0].when = eq(ref('input.collect'), true);
  program.nodes[1].join = 'all_resolved';
  const h = harness(t, program, kit, { collect: false });
  noDispatch(kit, await h.runtime.execute(h.run.id), 'EVIDENCE_REQUIRED');
});

for (const [name, output] of [
  ['whole null', null], ['whole string', 'approved'], ['whole array', [validOutput()]],
  ['absent selected path', {}], ['null selected path', { measurement: null }],
  ['wrong selected-path type', { measurement: 7 }],
  ['missing required approval', { measurement: { value: 7 } }],
  ['missing required measurement', { measurement: { approved: true } }],
  ['string approval', { measurement: { approved: 'true', value: 7 } }],
  ['numeric approval', { measurement: { approved: 1, value: 7 } }],
  ['string measurement', { measurement: { approved: true, value: '7' } }],
  ['null measurement', { measurement: { approved: true, value: null } }],
  ['negative approval', { measurement: { approved: false, value: 7 } }],
  ['extra disallowed field', { measurement: { approved: true, value: 7, bypass: true } }]
]) {
  audit(`${name} cannot pass the host evidence schema`, async t => {
    const kit = tools({ observation: () => output }), h = harness(t, basic(), kit);
    const run = await h.runtime.execute(h.run.id);
    assert.equal(run.nodes.read.status, 'completed', 'The broad source schema must admit this fixture so the evidence gate is exercised.');
    noDispatch(kit, run, 'EVIDENCE_INVALID');
  });
}

audit('omitting path validates the entire source output', async t => {
  const req = requirement(); delete req.path;
  const kit = tools({ requirements: [req], observation: () => ({ approved: true, value: 7 }) });
  const h = harness(t, basic(), kit);
  assert.equal((await h.runtime.execute(h.run.id)).status, 'succeeded');
  assert.equal(kit.actions.length, 1);
});

audit('sourceArgs resolves input from effect arguments rather than workflow input', async t => {
  const kit = tools(), h = harness(t, basic(), kit, { scope: 'wrong-workflow-scope' });
  assert.equal((await h.runtime.execute(h.run.id)).status, 'succeeded');
  assert.equal(kit.actions[0].scope, 'alpha');
});

audit('workflow-scoped evidence cannot authorize different effect arguments', async t => {
  const kit = tools(), h = harness(t, basic({ scope: 'alpha' }, { scope: 'beta' }), kit, { scope: 'alpha' });
  noDispatch(kit, await h.runtime.execute(h.run.id), 'EVIDENCE_REQUIRED');
});

audit('nested effect-argument bindings and canonical source-argument ordering match', async t => {
  const kit = tools({ requirements: [requirement({ sourceArgs: { probe: 'status', scope: ref('input.target.tenant') } })] });
  const h = harness(t, basic({ scope: 'alpha', probe: 'status' }, { target: { tenant: 'alpha' } }), kit, { target: { tenant: 'wrong' } });
  assert.equal((await h.runtime.execute(h.run.id)).status, 'succeeded');
  assert.equal(kit.dispatches.length, 1);
});

audit('partial source-argument equality cannot authorize a differently scoped receipt', async t => {
  const kit = tools(), h = harness(t, basic({ scope: 'alpha', probe: 'other' }), kit);
  noDispatch(kit, await h.runtime.execute(h.run.id), 'EVIDENCE_REQUIRED');
});

audit('an absent effect-argument binding cannot borrow the workflow scope', async t => {
  const kit = tools(), h = harness(t, basic({ scope: 'alpha' }, {}), kit, { scope: 'alpha' });
  noDispatch(kit, await h.runtime.execute(h.run.id), 'MISSING_REFERENCE');
});

audit('a transitive source ancestor qualifies through a data-only bridge', async t => {
  const kit = tools(), h = harness(t, workflow([
    task('read', 'audit.observe', { scope: 'alpha' }),
    task('bridge', 'audit.identity', { seen: true }, ['read']),
    task('act', 'audit.effect', { scope: 'alpha' }, ['bridge'])
  ]), kit);
  assert.equal((await h.runtime.execute(h.run.id)).status, 'succeeded');
  assert.equal(kit.actions.length, 1);
});

audit('a completed nonancestor cannot rescue a wrong-scope ancestor', async t => {
  const kit = tools(), h = harness(t, workflow([
    task('unrelated', 'audit.observe', { scope: 'alpha' }),
    task('ancestor', 'audit.observe', { scope: 'beta' }),
    task('act', 'audit.effect', { scope: 'alpha' }, ['ancestor'])
  ]), kit);
  const run = await h.runtime.execute(h.run.id);
  assert.equal(run.nodes.unrelated.status, 'completed');
  noDispatch(kit, run, 'EVIDENCE_REQUIRED');
});

audit('a human answer or copied output cannot replace an executed source receipt', async t => {
  const kit = tools(), program = workflow([
    task('absent', 'audit.observe', { scope: 'alpha' }, [], { when: eq(ref('input.collect'), true) }),
    human('ask', []), task('copied', 'audit.identity', validOutput(), ['ask']),
    task('act', 'audit.effect', { scope: 'alpha' }, ['absent', 'copied'], { join: 'all_resolved' })
  ]);
  const h = harness(t, program, kit, { collect: false });
  assert.equal((await h.runtime.execute(h.run.id)).status, 'awaiting_human');
  h.runtime.answer(h.run.id, 'root/ask', true);
  noDispatch(kit, await h.runtime.execute(h.run.id), 'EVIDENCE_REQUIRED');
});

audit('receipts from another run cannot authorize this run', async t => {
  const kit = tools(), program = basic();
  program.nodes[0].when = eq(ref('input.collect'), true); program.nodes[1].join = 'all_resolved';
  const h = harness(t, program, kit, { collect: true });
  assert.equal((await h.runtime.execute(h.run.id)).status, 'succeeded');
  const next = h.runtime.create(program, { collect: false });
  const run = await h.runtime.execute(next.id);
  assert.equal(run.error.code, 'EVIDENCE_REQUIRED');
  assert.equal(kit.dispatches.filter(d => d.runId === next.id).length, 0);
  assert.equal(kit.actions.length, 1);
});

audit('newest malformed completed receipt wins even when completion timestamps tie', async t => {
  clock(t);
  const kit = tools({ observation: count => count === 1 ? validOutput() : { measurement: { approved: true, value: 'wrong' } } });
  const h = harness(t, workflow([
    task('newer', 'audit.observe', { scope: 'alpha' }, ['older']),
    task('older', 'audit.observe', { scope: 'alpha' }),
    task('act', 'audit.effect', { scope: 'alpha' }, ['newer'])
  ]), kit);
  const run = await h.runtime.execute(h.run.id);
  assert.equal(run.nodes.newer.completedAt, run.nodes.older.completedAt);
  assert.ok(run.nodes.newer.completedSequence > run.nodes.older.completedSequence);
  noDispatch(kit, run, 'EVIDENCE_INVALID');
});

audit('newest valid receipt supersedes an older malformed observation', async t => {
  clock(t);
  const kit = tools({ observation: count => count === 1 ? { measurement: null } : validOutput() });
  const h = harness(t, workflow([
    task('old', 'audit.observe', { scope: 'alpha' }),
    task('fresh', 'audit.observe', { scope: 'alpha' }, ['old']),
    task('act', 'audit.effect', { scope: 'alpha' }, ['fresh'])
  ]), kit);
  assert.equal((await h.runtime.execute(h.run.id)).status, 'succeeded');
  assert.equal(kit.actions.length, 1);
});

audit('a newer failed observation cannot silently fall back to older valid evidence', async t => {
  const kit = tools({ observation: count => {
    if (count === 2) throw new FoundryError('SYNTHETIC_UNAVAILABLE', 'Fresh observation failed');
    return validOutput();
  } });
  const h = harness(t, workflow([
    task('old', 'audit.observe', { scope: 'alpha' }),
    task('fresh', 'audit.observe', { scope: 'alpha' }, ['old'], { onError: 'continue' }),
    task('act', 'audit.effect', { scope: 'alpha' }, ['fresh'], { join: 'all_resolved' })
  ]), kit);
  const run = await h.runtime.execute(h.run.id);
  assert.equal(run.nodes.fresh.status, 'handled_error');
  noDispatch(kit, run);
});

audit('a newer malformed receipt in another scope does not invalidate the requested scope', async t => {
  const kit = tools({ observation: (_, args) => args.scope === 'alpha' ? validOutput() : { measurement: null } });
  const h = harness(t, workflow([
    task('requested', 'audit.observe', { scope: 'alpha' }),
    task('different', 'audit.observe', { scope: 'beta' }, ['requested']),
    task('act', 'audit.effect', { scope: 'alpha' }, ['different'])
  ]), kit);
  assert.equal((await h.runtime.execute(h.run.id)).status, 'succeeded');
  assert.equal(kit.actions.length, 1);
});

audit('a successful explicit refresh after a handled source failure can qualify', async t => {
  const kit = tools({ observation: count => {
    if (count === 2) throw new FoundryError('SYNTHETIC_UNAVAILABLE', 'Intermediate observation failed');
    return validOutput();
  } });
  const h = harness(t, workflow([
    task('old', 'audit.observe', { scope: 'alpha' }),
    task('failedRefresh', 'audit.observe', { scope: 'alpha' }, ['old'], { onError: 'continue' }),
    task('goodRefresh', 'audit.observe', { scope: 'alpha' }, ['failedRefresh'], { join: 'all_resolved' }),
    task('act', 'audit.effect', { scope: 'alpha' }, ['goodRefresh'])
  ]), kit);
  const run = await h.runtime.execute(h.run.id);
  assert.equal(run.status, 'succeeded', JSON.stringify(run.error));
  assert.equal(run.nodes.failedRefresh.status, 'handled_error');
  assert.equal(kit.reads.length, 3); assert.equal(kit.actions.length, 1);
});

for (const [name, older, newer, shouldPass] of [
  ['a late older valid observation cannot replace a newer invalid attempt', validOutput(), { measurement: null }, false],
  ['a late older invalid observation does not replace a newer valid attempt', { measurement: null }, validOutput(), true]
]) {
  audit(name, async t => {
    clock(t);
    const kit = tools({ observation: async count => {
      if (count === 1) { await nextTurn(); return older; }
      return newer;
    } });
    const program = workflow([
      task('older', 'audit.observe', { scope: 'alpha' }),
      task('newer', 'audit.observe', { scope: 'alpha' }),
      task('act', 'audit.effect', { scope: 'alpha' }, ['older', 'newer'])
    ]);
    program.budget.maxConcurrency = 2;
    const h = harness(t, program, kit), run = await h.runtime.execute(h.run.id);
    assert.ok(run.nodes.newer.startedSequence > run.nodes.older.startedSequence);
    assert.ok(run.nodes.older.completedSequence > run.nodes.newer.completedSequence, 'The older attempt must actually finish last.');
    if (shouldPass) { assert.equal(run.status, 'succeeded'); assert.equal(kit.actions.length, 1); }
    else noDispatch(kit, run, 'EVIDENCE_INVALID');
  });
}

for (const [name, elapsed, expected] of [
  ['exact maximum age', 100, 'succeeded'],
  ['past maximum age', 101, 'failed'],
  ['receipt timestamp in the future', -1, 'failed']
]) {
  audit(`${name} is checked after human pause and store reopen`, async t => {
    const time = clock(t), kit = tools({ requirements: [requirement({ maxAgeMs: 100 })] });
    const h = harness(t, paused(), kit);
    assert.equal((await h.runtime.execute(h.run.id)).status, 'awaiting_human');
    h.reopen(); time.advance(elapsed); h.runtime.answer(h.run.id, 'root/ask', true);
    const run = await h.runtime.execute(h.run.id);
    assert.equal(run.status, expected, JSON.stringify(run.error));
    if (expected === 'failed') noDispatch(kit, run, 'EVIDENCE_STALE');
    else assert.equal(kit.actions.length, 1);
    assert.equal(kit.reads.length, 1, 'Resume must not secretly manufacture a fresh observation.');
  });
}

audit('an explicit observation after a human pause refreshes expired evidence', async t => {
  const time = clock(t), kit = tools({ requirements: [requirement({ maxAgeMs: 100 })] });
  const h = harness(t, paused([task('refresh', 'audit.observe', { scope: 'alpha' }, ['ask'])]), kit);
  assert.equal((await h.runtime.execute(h.run.id)).status, 'awaiting_human');
  h.reopen(); time.advance(101); h.runtime.answer(h.run.id, 'root/ask', true);
  const run = await h.runtime.execute(h.run.id);
  assert.equal(run.status, 'succeeded', JSON.stringify(run.error));
  assert.equal(kit.reads.length, 2); assert.equal(kit.actions.length, 1);
});

audit('approval does not preserve evidence freshness indefinitely', async t => {
  const time = clock(t), kit = tools({ requirements: [requirement({ maxAgeMs: 100 })], effectDescriptor: { risk: 'high', requiresApproval: true } });
  const h = harness(t, basic(), kit);
  const pausedRun = await h.runtime.execute(h.run.id);
  assert.equal(pausedRun.status, 'awaiting_approval');
  const approvalId = Object.keys(pausedRun.approvals)[0];
  time.advance(101); h.runtime.approve(h.run.id, approvalId, true);
  noDispatch(kit, await h.runtime.execute(h.run.id), 'EVIDENCE_STALE');
});

audit('changing only a host evidence requirement invalidates an existing paused run registry pin', async t => {
  const kit = tools(), h = harness(t, paused(), kit);
  assert.equal((await h.runtime.execute(h.run.id)).status, 'awaiting_human');
  const changed = tools({ requirements: [requirement({ maxAgeMs: 5000 })] });
  const resumedRuntime = new Runtime(h.store, changed.registry, h.policy);
  assert.notEqual(changed.registry.hash(), kit.registry.hash());
  h.runtime.answer(h.run.id, 'root/ask', true);
  await assert.rejects(resumedRuntime.execute(h.run.id), { code: 'CAPABILITY_DRIFT' });
  assert.equal(changed.dispatches.length, 0);
});

audit('every required source must qualify, not merely one successful observation', async t => {
  const kit = tools({ requirements: [requirement(), requirement({ id: 'secondSource', sourceArgs: { scope: 'missing' } })] });
  const h = harness(t, basic(), kit);
  noDispatch(kit, await h.runtime.execute(h.run.id), 'EVIDENCE_REQUIRED');
});

audit('retry within freshness reuses the same idempotency key without duplicating the effect', async t => {
  clock(t);
  const kit = tools({ beforeEffect: count => {
    if (count === 1) throw new FoundryError('SYNTHETIC_TRANSIENT', 'Failed before synthetic effect');
  } });
  const program = basic(); program.nodes[1].retry = { maxAttempts: 2, backoffMs: 1 };
  const h = harness(t, program, kit), run = await h.runtime.execute(h.run.id);
  assert.equal(run.status, 'succeeded', JSON.stringify(run.error));
  assert.equal(kit.dispatches.length, 2); assert.equal(kit.actions.length, 1);
  assert.equal(kit.dispatches[0].key, kit.dispatches[1].key);
  assert.equal(kit.reads.length, 1);
});

audit('expiry before retry blocks a second effect-handler dispatch', async t => {
  const time = clock(t), kit = tools({ requirements: [requirement({ maxAgeMs: 100 })], beforeEffect: count => {
    if (count === 1) { time.advance(101); throw new FoundryError('SYNTHETIC_TRANSIENT', 'Retry after evidence expired'); }
  } });
  const program = basic(); program.nodes[1].retry = { maxAttempts: 2, backoffMs: 1 };
  const h = harness(t, program, kit), run = await h.runtime.execute(h.run.id);
  assert.equal(run.status, 'failed'); assert.equal(run.error.code, 'EVIDENCE_STALE');
  assert.equal(kit.dispatches.length, 1); assert.equal(kit.actions.length, 0);
});

audit('a bounded loop refreshes evidence before a new attempt instead of reusing an earlier frame', async t => {
  const time = clock(t), kit = tools({ requirements: [requirement({ maxAgeMs: 100 })], beforeEffect: count => {
    if (count === 1) { time.advance(101); throw new FoundryError('SYNTHETIC_TRANSIENT', 'Explicit refresh required'); }
  } });
  const h = harness(t, workflow([{
    id: 'retryLoop', kind: 'loop', description: 'Refresh before each synthetic attempt', needs: [],
    initial: {}, maxIterations: 2, until: eq(ref('nodes.act.applied', false), true),
    body: { nodes: [
      task('read', 'audit.observe', { scope: 'alpha' }),
      task('act', 'audit.effect', { scope: 'alpha' }, ['read'], { onError: 'continue' })
    ], acceptance: [exists(ref('nodes.act'))] }
  }], [eq(ref('nodes.retryLoop.last.act.applied'), true)]), kit);
  const run = await h.runtime.execute(h.run.id);
  assert.equal(run.status, 'succeeded', JSON.stringify(run.error));
  assert.equal(run.outputs.retryLoop.iterations, 2);
  assert.equal(kit.reads.length, 2); assert.equal(kit.dispatches.length, 2); assert.equal(kit.actions.length, 1);
  assert.notEqual(kit.dispatches[0].nodeKey, kit.dispatches[1].nodeKey);
});

audit('each map item obtains evidence in its own frame and scope', async t => {
  const kit = tools(), h = harness(t, workflow([{
    id: 'each', kind: 'map', description: 'Two independently scoped synthetic effects', needs: [], items: ['alpha', 'beta'], maxItems: 2,
    body: { nodes: [
      task('read', 'audit.observe', { scope: ref('item') }),
      task('act', 'audit.effect', { scope: ref('item') }, ['read'])
    ], acceptance: [eq(ref('nodes.act.applied'), true)] }
  }], [eq(ref('nodes.each.count'), 2)]), kit);
  assert.equal((await h.runtime.execute(h.run.id)).status, 'succeeded');
  assert.deepEqual(kit.actions.map(a => a.scope), ['alpha', 'beta']);
});

audit('an earlier map frame cannot satisfy a skipped source in the next frame', async t => {
  const kit = tools(), h = harness(t, workflow([{
    id: 'each', kind: 'map', description: 'Attempt cross-frame evidence reuse', needs: [], items: [true, false], maxItems: 2,
    body: { nodes: [
      task('read', 'audit.observe', { scope: 'alpha' }, [], { when: eq(ref('item'), true) }),
      task('act', 'audit.effect', { scope: 'alpha' }, ['read'], { join: 'all_resolved' })
    ], acceptance: [eq(ref('nodes.act.applied'), true)] }
  }], [eq(ref('nodes.each.count'), 2)]), kit);
  const run = await h.runtime.execute(h.run.id);
  assert.equal(run.status, 'failed'); assert.equal(run.error.code, 'EVIDENCE_REQUIRED');
  assert.equal(kit.dispatches.length, 1); assert.equal(kit.actions.length, 1);
  assert.equal(kit.dispatches[0].nodeKey, 'root/each:0/act');
});

audit('tampering with checkpoint output without its receipt hash blocks dispatch', async t => {
  const kit = tools(), h = harness(t, paused(), kit);
  assert.equal((await h.runtime.execute(h.run.id)).status, 'awaiting_human');
  h.store.updateRun(h.run.id, r => { r.outputs.read.measurement.value = 999; }, { type: 'audit.synthetic-output-corruption' });
  h.runtime.answer(h.run.id, 'root/ask', true);
  noDispatch(kit, await h.runtime.execute(h.run.id), 'EVIDENCE_CORRUPT');
});

audit('deleting checkpoint output cannot turn a missing value into valid evidence', async t => {
  const kit = tools(), h = harness(t, paused(), kit);
  assert.equal((await h.runtime.execute(h.run.id)).status, 'awaiting_human');
  h.store.updateRun(h.run.id, r => { delete r.outputs.read; }, { type: 'audit.synthetic-output-deletion' });
  h.runtime.answer(h.run.id, 'root/ask', true);
  noDispatch(kit, await h.runtime.execute(h.run.id));
});

audit('missing or malformed evidence is not bypassed by onError continuation', async t => {
  const kit = tools({ observation: () => ({ measurement: null }) }), program = basic();
  program.nodes[1].onError = 'continue';
  program.acceptance = [exists(ref('nodes.read'))];
  const h = harness(t, program, kit);
  noDispatch(kit, await h.runtime.execute(h.run.id), 'EVIDENCE_INVALID');
});

function truncate(h, fromSequence) {
  // Deliberate corruption only of this test's disposable SQLite database.
  h.store.db.prepare('DELETE FROM events WHERE run_id=? AND seq>=?').run(h.run.id, fromSequence);
}

audit('event-tail truncation is rejected before a paused run can execute', async t => {
  const kit = tools(), h = harness(t, paused(), kit);
  const run = await h.runtime.execute(h.run.id);
  assert.equal(run.status, 'awaiting_human');
  truncate(h, run.eventHead.seq);
  assert.throws(() => h.store.events(run.id), { code: 'CORRUPT_EVENTS' });
  h.reopen();
  await assert.rejects(h.runtime.execute(run.id), { code: 'CORRUPT_EVENTS' });
  assert.equal(kit.dispatches.length, 0);
});

audit('deleting the entire event history cannot leave an executable checkpoint', async t => {
  const kit = tools(), h = harness(t, paused(), kit);
  await h.runtime.execute(h.run.id); truncate(h, 1);
  assert.throws(() => h.store.events(h.run.id), { code: 'CORRUPT_EVENTS' });
  await assert.rejects(h.runtime.execute(h.run.id), { code: 'CORRUPT_EVENTS' });
  assert.equal(kit.dispatches.length, 0);
});

audit('editing an event body without its hash is detected independently of tail length', async t => {
  const kit = tools(), h = harness(t, paused(), kit);
  const run = await h.runtime.execute(h.run.id);
  const row = h.store.db.prepare('SELECT body FROM events WHERE run_id=? AND seq=?').get(run.id, run.nodes.read.completedSequence);
  const event = JSON.parse(row.body); event.output.measurement.value = 999;
  h.store.db.prepare('UPDATE events SET body=? WHERE run_id=? AND seq=?').run(JSON.stringify(event), run.id, event.seq);
  await assert.rejects(h.runtime.execute(run.id), { code: 'CORRUPT_EVENTS' });
  assert.equal(kit.dispatches.length, 0);
});

audit('an event-bearing Store update must not repair a truncated history by replacing eventHead', async t => {
  const kit = tools(), h = harness(t, paused(), kit);
  const run = await h.runtime.execute(h.run.id); truncate(h, run.eventHead.seq);
  let rejected = false;
  try { h.store.updateRun(run.id, r => { r.extra.synthetic = true; }, { type: 'audit.append-after-truncation' }); }
  catch (error) { assert.equal(error.code, 'CORRUPT_EVENTS'); rejected = true; }
  assert.equal(rejected, true, 'Append must reject the prior checkpoint/head mismatch, not silently establish a new head.');
  assert.throws(() => h.store.events(run.id), { code: 'CORRUPT_EVENTS' });
});

audit('a human answer cannot conceal deleted evidence completion events and authorize an effect', async t => {
  const kit = tools(), h = harness(t, paused(), kit);
  const run = await h.runtime.execute(h.run.id);
  truncate(h, run.nodes.read.completedSequence);
  let integrityError = null, resumed;
  try { h.runtime.answer(run.id, 'root/ask', true); resumed = await h.runtime.execute(run.id); }
  catch (error) { integrityError = error; }
  assert.equal(kit.dispatches.length, 0, `Deleted completion evidence authorized ${kit.dispatches.length} dispatches; resumed=${resumed?.status}`);
  assert.equal(integrityError?.code ?? resumed?.error?.code, 'CORRUPT_EVENTS');
});

audit('an approval cannot conceal event-tail truncation before effect admission', async t => {
  const kit = tools({ effectDescriptor: { requiresApproval: true, risk: 'high' } }), h = harness(t, basic(), kit);
  const run = await h.runtime.execute(h.run.id);
  assert.equal(run.status, 'awaiting_approval');
  const approvalId = Object.keys(run.approvals)[0]; truncate(h, run.nodes.read.completedSequence);
  let integrityError = null, resumed;
  try { h.runtime.approve(run.id, approvalId, true); resumed = await h.runtime.execute(run.id); }
  catch (error) { integrityError = error; }
  assert.equal(kit.dispatches.length, 0, `Approval concealed a missing event tail; resumed=${resumed?.status}`);
  assert.equal(integrityError?.code ?? resumed?.error?.code, 'CORRUPT_EVENTS');
});
