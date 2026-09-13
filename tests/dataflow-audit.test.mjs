import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateWorkflow } from '../src/validate.mjs';
import { CapabilityRegistry } from '../src/capabilities.mjs';
import { Foundry } from '../src/foundry.mjs';
import { condition, resolve } from '../src/data.mjs';

// Independent offline contract tests. No provider import, candidate editing,
// external process, coding answer, or historical run execution is needed.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ref = ($ref, ...fallback) => ({ $ref, ...(fallback.length ? { default: fallback[0] } : {}) });
const eq = (left, right) => ({ op: 'eq', left, right });
const exists = value => ({ op: 'exists', value });
const closed = properties => ({ type: 'object', additionalProperties: false, properties });
const number = { type: 'number' };
const sourceShape = closed({ value: number, done: { type: 'boolean' }, nested: closed({ allowed: number }) });
const task = (id, tool = 'audit.source', args = {}, needs = [], extra = {}) => ({
  id, kind: 'task', description: `Neutral dataflow probe ${id}`, needs,
  tool, args, timeoutMs: 1000, retry: { maxAttempts: 1 }, ...extra
});
const base = (nodes, acceptance) => ({
  schemaVersion: '1.0', id: 'DataflowAudit', version: 1,
  title: 'Offline dataflow contract', goal: 'Check structural paths without inferring task success.',
  domain: 'general', envelope: { assumptions: ['Neutral local operations'], risks: [], successCriteria: ['Declared paths obey the runtime contract'] },
  budget: { maxSteps: 100, maxConcurrency: 1, maxDurationMs: 3000, maxCost: 0 }, nodes, acceptance
});

function registry(shape = sourceShape) {
  const r = new CapabilityRegistry();
  const common = { version: '1', effects: 'none', risk: 'low', cost: 0,
    requiresApproval: false, maxTimeoutMs: 1000, cancellation: 'cooperative', inputSchema: {} };
  r.register({ ...common, name: 'audit.source', description: 'Pure neutral observation', outputSchema: shape,
    execute: async () => ({ value: 7, done: true, nested: { allowed: 7 } }) });
  r.register({ ...common, name: 'audit.sink', description: 'Pure observed-value forwarding',
    outputSchema: closed({ received: {} }), execute: async args => ({ received: args.value }) });
  return r;
}
function accepted(workflow, r = registry()) {
  const result = validateWorkflow(workflow, { registry: r });
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  return result;
}
function rejectedPath(workflow, reference, r = registry()) {
  const result = validateWorkflow(workflow, { registry: r });
  assert.equal(result.valid, false, `Known absent path was accepted: ${reference}`);
  assert.ok(result.errors.some(error => JSON.stringify(error).includes(reference)),
    `Diagnostic must identify ${reference}: ${JSON.stringify(result.errors)}`);
  assert.ok(!result.errors.some(error => ['SCHEMA', 'INVALID_REFERENCE', 'UNKNOWN_TOOL', 'UNDECLARED_DATA_DEPENDENCY'].includes(error.code)),
    `Fixture failed for an unrelated reason: ${JSON.stringify(result.errors)}`);
  return result;
}
const outputProbe = reference => base([task('source')], [eq(ref(reference), 7)]);
function loopProbe({ initial = { step: { value: 0 } }, carried = 'previous.step.value', iterations = 2 } = {}) {
  return base([{
    id: 'repeat', kind: 'loop', description: 'Carry a neutral value between frames', needs: [],
    maxIterations: iterations, initial,
    body: { nodes: [task('step', 'audit.source', { carry: ref(carried) })], acceptance: [eq(ref('nodes.step.value'), 7)] },
    until: eq(ref('iteration'), iterations - 1)
  }], [eq(ref('nodes.repeat.last.step.value'), 7)]);
}
function mapProbe() {
  return base([{
    id: 'batch', kind: 'map', description: 'Observe one neutral item', needs: [], items: [7], maxItems: 1,
    body: { nodes: [task('measure')], acceptance: [eq(ref('nodes.measure.value'), 7)] }
  }], [eq(ref('nodes.batch.items.0.measure.value'), 7)]);
}
async function runNeutral(t, workflow, r = registry()) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'foundry-dataflow-audit-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const foundry = new Foundry(directory, { registry: r });
  try {
    foundry.save(workflow);
    const run = foundry.createRun(workflow.id);
    return await foundry.startRun(run.id);
  } finally { await foundry.close(); }
}

const HISTORICAL = [
  { id: '01', job: '1a812965-1a81-4d80-8c13-a0b387064148', fileHash: 'b34efdc97bdee8d23a2469cac5bfb9ade3c178da2500281601ca6621c26abaec' },
  { id: '02', job: '70d2aca0-dab9-4b20-8bde-92c8378a0169', fileHash: '152f8e25b22db8f5f84975221343fb2d4628065eba636d6af3074bb2d52daf15' }
].map(item => {
  const directory = path.join(ROOT, `research/reference-swe/runs/20260913-reference-${item.id}`);
  return { ...item, candidate: path.join(directory, 'candidate-workflow.json'),
    context: path.join(directory, `foundry/.foundry/generation/${item.job}/context.json`) };
});
function historical(item) {
  const bytes = readFileSync(item.candidate);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), item.fileHash, 'Frozen graph bytes changed');
  const context = JSON.parse(readFileSync(item.context, 'utf8'));
  const capabilities = new Map(context.capabilities.map(cap => [cap.name, cap]));
  return { workflow: JSON.parse(bytes), registry: { get: name => capabilities.get(name) } };
}
for (const item of HISTORICAL) {
  test(`historical reference-${item.id} graph with its actual open capability catalog`,
    { skip: !existsSync(item.candidate) || !existsSync(item.context) }, () => {
      const fixture = historical(item);
      assert.deepEqual(fixture.registry.get('reference.act').outputSchema, { type: 'object' });
      if (item.id === '01') {
        const result = rejectedPath(fixture.workflow, 'nodes.repair-loop.last.done', fixture.registry);
        // The historical until reads an unknown capability field and might stop
        // first. Its recurrence gap must be diagnosed, but is not proved reached.
        assert.ok([...result.errors, ...result.warnings].some(error =>
          error.code === 'RECURRENCE_PATH_GAP' && JSON.stringify(error).includes('previous.messages')));
      } else accepted(fixture.workflow, fixture.registry);
      assert.equal(createHash('sha256').update(readFileSync(item.candidate)).digest('hex'), item.fileHash);
    });
}

test('closed capability object rejects an undeclared top-level property', () => {
  rejectedPath(outputProbe('nodes.source.typo'), 'nodes.source.typo');
});
test('closed nested capability object rejects a missing descendant', () => {
  rejectedPath(outputProbe('nodes.source.nested.typo'), 'nodes.source.nested.typo');
});
test('declared optional properties remain possible, not guaranteed', () => {
  accepted(outputProbe('nodes.source.nested.allowed'));
});
for (const [name, shape] of [
  ['unconstrained schema', {}], ['boolean true schema', true], ['object with omitted additionalProperties', { type: 'object' }],
  ['declared properties on an open object', { type: 'object', properties: { value: number } }],
  ['explicitly open object', { type: 'object', additionalProperties: true }]
]) test(`${name} does not prove an undeclared path absent`, () => {
  accepted(outputProbe('nodes.source.dynamic.deep'), registry(shape));
});
test('closed parent preserves an intentionally unknown descendant schema', () => {
  accepted(outputProbe('nodes.source.payload.dynamic'), registry(closed({ payload: {} })));
});
test('schema-valued additionalProperties preserves dynamic keys and known descendants', () => {
  accepted(outputProbe('nodes.source.dynamic.allowed'), registry({ type: 'object', additionalProperties: closed({ allowed: number }) }));
});
test('union containing an open branch cannot prove a field absent', () => {
  accepted(outputProbe('nodes.source.dynamic'), registry({ anyOf: [sourceShape, { type: 'object' }] }));
});
test('union containing a branch that declares the field must remain possible', () => {
  accepted(outputProbe('nodes.source.alternate'), registry({ oneOf: [sourceShape, closed({ alternate: number })] }));
});
test('patternProperties prevents falsely closing all undeclared names', () => {
  accepted(outputProbe('nodes.source.x-observed'), registry({ type: 'object', additionalProperties: false, patternProperties: { '^x-': number } }));
});
test('schema local refs are not runtime refs or proof that a payload field is absent', () => {
  accepted(outputProbe('nodes.source.payload.value'), registry({
    ...closed({ payload: { $ref: '#/definitions/payload' } }), definitions: { payload: closed({ value: number }) }
  }));
});
test('independent capability schemas retain their own local reference roots', () => {
  const r = registry({ ...closed({ payload: { $ref: '#/definitions/shared' } }), definitions: { shared: closed({ first: number }) } });
  r.register({ ...r.get('audit.source'), name: 'audit.other',
    outputSchema: { ...closed({ payload: { $ref: '#/definitions/shared' } }), definitions: { shared: closed({ second: number }) } },
    execute: async () => ({ payload: { second: 7 } }) });
  const workflow = base([task('source'), task('other', 'audit.other')],
    [eq(ref('nodes.source.payload.first'), 7), eq(ref('nodes.other.payload.second'), 7)]);
  accepted(workflow, r);
  workflow.acceptance = [eq(ref('nodes.source.payload.second'), 7)];
  rejectedPath(workflow, 'nodes.source.payload.second', r);
});
test('allOf preserves a field admitted by its constraints and excludes a closed-object typo', () => {
  const r = registry({ allOf: [closed({ payload: { type: 'object' } }), { type: 'object', properties: { payload: closed({ value: number }) } }] });
  accepted(outputProbe('nodes.source.payload.value'), r);
  rejectedPath(outputProbe('nodes.source.typo'), 'nodes.source.typo', r);
});
test('array length is an own property but is not an object to descend through', () => {
  const r = registry({ type: 'array', items: number });
  accepted(outputProbe('nodes.source.length'), r);
  rejectedPath(outputProbe('nodes.source.length.value'), 'nodes.source.length.value', r);
});

test('explicit defaults preserve supported missing-path behavior', () => {
  const workflow = outputProbe('nodes.source.absent');
  workflow.acceptance = [eq(ref('nodes.source.absent', 7), 7)];
  accepted(workflow);
  assert.equal(resolve(ref('nodes.source.absent', 7), { nodes: { source: { value: 1 } } }), 7);
});
test('nested reference-looking default data stays literal during actual execution', async t => {
  const fallback = { $ref: 'input.never' };
  const workflow = base([task('source'), task('sink', 'audit.sink', { value: ref('nodes.source.absent', fallback) }, ['source'])],
    [exists(ref('nodes.sink.received'))]);
  workflow.inputSchema = closed({});
  accepted(workflow);
  const run = await runNeutral(t, workflow);
  assert.equal(run.status, 'succeeded', JSON.stringify(run.error));
  assert.deepEqual(run.outputs.sink.received, fallback);
});
test('exists can intentionally observe a known-absent field without an exception', () => {
  const workflow = outputProbe('nodes.source.absent');
  workflow.acceptance = [{ op: 'not', condition: exists(ref('nodes.source.absent')) }];
  accepted(workflow);
  assert.equal(condition(workflow.acceptance[0], { nodes: { source: { value: 1 } } }), true);
});
test('operation-looking capability data does not acquire condition short-circuit semantics', () => {
  for (const args of [
    { op: 'exists', value: ref('nodes.source.typo') },
    { op: 'all', conditions: [ref('nodes.source.value'), ref('nodes.source.typo')] }
  ]) {
    const workflow = base([task('source'), task('sink', 'audit.sink', args, ['source'])],
      [exists(ref('nodes.sink.received'))]);
    rejectedPath(workflow, 'nodes.source.typo');
  }
});
test('continued-error output is an alternative to the nominal capability shape', () => {
  const workflow = outputProbe('nodes.source.error.code');
  workflow.nodes[0].onError = 'continue';
  accepted(workflow);
});

test('loop previous binding preserves the initializer and recurrence node wrapper', () => {
  accepted(loopProbe());
});
test('initializer success must not conceal an absent recurrence path', () => {
  rejectedPath(loopProbe({ initial: { value: 0 }, carried: 'previous.value' }), 'previous.value');
});
test('recurrence success must not conceal an absent initializer path', () => {
  rejectedPath(loopProbe({ initial: { value: 0 } }), 'previous.step.value');
});
test('a single-iteration loop has no recurrence obligation', () => {
  accepted(loopProbe({ initial: { value: 0 }, carried: 'previous.value', iterations: 1 }));
});
test('a loop that provably stops after its first iteration has no reached recurrence read', async t => {
  const workflow = loopProbe({ initial: { seed: 0 }, carried: 'previous.seed', iterations: 5 });
  workflow.nodes[0].until = eq(ref('iteration'), 0);
  assert.equal(condition(workflow.nodes[0].until, { iteration: 0 }), true);
  accepted(workflow);
  const run = await runNeutral(t, workflow);
  assert.equal(run.status, 'succeeded', JSON.stringify(run.error));
  assert.equal(run.outputs.repeat.iterations, 1);
});
test('initializer-only read guarded by iteration zero is a valid executable loop', async t => {
  const workflow = loopProbe({ initial: { seed: 0 }, carried: 'previous.seed' });
  workflow.nodes[0].body.nodes[0].when = eq(ref('iteration'), 0);
  workflow.nodes[0].body.acceptance = [{ op: 'gte', left: ref('iteration'), right: 0 }];
  workflow.acceptance = [eq(ref('nodes.repeat.iterations'), 2)];
  accepted(workflow);
  const run = await runNeutral(t, workflow);
  assert.equal(run.status, 'succeeded', JSON.stringify(run.error));
  assert.equal(run.outputs.repeat.iterations, 2);
});
test('recurrence-only read guarded by positive iteration is a valid executable loop', async t => {
  const workflow = loopProbe({ initial: {} });
  workflow.nodes[0].body = {
    nodes: [task('produce'), task('consume', 'audit.sink', { value: ref('previous.produce.value') }, [],
      { when: { op: 'gt', left: ref('iteration'), right: 0 } })],
    acceptance: [eq(ref('nodes.produce.value'), 7)]
  };
  workflow.acceptance = [eq(ref('nodes.repeat.last.consume.received'), 7)];
  accepted(workflow);
  const run = await runNeutral(t, workflow);
  assert.equal(run.status, 'succeeded', JSON.stringify(run.error));
  assert.equal(run.outputs.repeat.last.consume.received, 7);
});
test('loop until checks previous in the current iteration context', () => {
  const workflow = loopProbe();
  workflow.nodes[0].until = eq(ref('previous.typo'), 0);
  rejectedPath(workflow, 'previous.typo');
});
test('loop body acceptance checks previous paths too', () => {
  const workflow = loopProbe();
  workflow.nodes[0].body.acceptance = [eq(ref('previous.typo'), 0)];
  rejectedPath(workflow, 'previous.typo');
});
test('loop last output preserves the body-node wrapper', () => {
  const workflow = loopProbe();
  workflow.acceptance = [eq(ref('nodes.repeat.last.value'), 7)];
  rejectedPath(workflow, 'nodes.repeat.last.value');
});
test('control wrappers remain closed even when body capability schemas are open', () => {
  const workflow = loopProbe();
  workflow.acceptance = [eq(ref('nodes.repeat.last.value'), 7)];
  rejectedPath(workflow, 'nodes.repeat.last.value', registry({ type: 'object' }));
});

test('map items preserve each iteration body wrapper', () => accepted(mapProbe()));
test('map extraction rejects omitting its body-node name', () => {
  const workflow = mapProbe();
  workflow.acceptance = [eq(ref('nodes.batch.items.0.value'), 7)];
  rejectedPath(workflow, 'nodes.batch.items.0.value');
});
test('map does not have the loop-only last output', () => {
  const workflow = mapProbe();
  workflow.acceptance = [eq(ref('nodes.batch.last.measure.value'), 7)];
  rejectedPath(workflow, 'nodes.batch.last.measure.value');
});
test('nested map and loop preserve both output wrappers', () => {
  const workflow = mapProbe();
  workflow.nodes[0].body = { nodes: loopProbe().nodes, acceptance: [eq(ref('nodes.repeat.last.step.value'), 7)] };
  workflow.acceptance = [eq(ref('nodes.batch.items.0.repeat.last.step.value'), 7)];
  accepted(workflow);
});
test('a skipped parent control does not make unreachable child reads unconditional', async t => {
  const workflow = mapProbe();
  workflow.nodes[0].when = eq(0, 1);
  workflow.nodes[0].body.nodes[0].args = { value: ref('input.typo') };
  workflow.inputSchema = closed({});
  workflow.acceptance = [{ op: 'not', condition: exists(ref('nodes.batch')) }];
  accepted(workflow);
  const run = await runNeutral(t, workflow);
  assert.equal(run.status, 'succeeded', JSON.stringify(run.error));
  assert.equal(run.nodes.batch.status, 'skipped');
});
test('map item fields follow the declared item schema', () => {
  const workflow = mapProbe();
  workflow.inputSchema = closed({ rows: { type: 'array', items: closed({ allowed: number }) } });
  workflow.nodes[0].items = ref('input.rows');
  workflow.nodes[0].body.nodes[0].args = { value: ref('item.typo') };
  rejectedPath(workflow, 'item.typo');
});
test('unknown map items do not acquire a closed invented schema', () => {
  const workflow = mapProbe();
  workflow.nodes[0].items = ref('input.rows');
  workflow.nodes[0].body.nodes[0].args = { value: ref('item.dynamic') };
  accepted(workflow);
});

test('human output preserves answer while applying the nested answer schema', () => {
  const node = { id: 'review', kind: 'human', description: 'Neutral review', needs: [], question: 'A neutral choice?', answerSchema: closed({ approved: { type: 'boolean' } }) };
  accepted(base([node], [eq(ref('nodes.review.answer.approved'), true)]));
  rejectedPath(base([node], [eq(ref('nodes.review.approved'), true)]), 'nodes.review.approved');
});
test('human answer can remain intentionally unknown within its closed wrapper', () => {
  accepted(base([{ id: 'review', kind: 'human', description: 'Neutral review', needs: [], question: 'A neutral value?', answerSchema: {} }],
    [eq(ref('nodes.review.answer.dynamic'), true)]));
});
test('wait and assertion output wrappers are structurally known', () => {
  const nodes = [task('source'), { id: 'guard', kind: 'assert', description: 'Check neutral output', needs: ['source'], checks: [eq(ref('nodes.source.value'), 7)] },
    { id: 'pause', kind: 'wait', description: 'Neutral wait', needs: [], delayMs: 1 }];
  accepted(base(nodes, [eq(ref('nodes.guard.passed'), true), eq(ref('nodes.pause.waitedMs'), 1)]));
  rejectedPath(base(nodes, [eq(ref('nodes.guard.ok'), true)]), 'nodes.guard.ok');
  rejectedPath(base(nodes, [eq(ref('nodes.pause.elapsed'), 1)]), 'nodes.pause.elapsed');
});

test('control input rebinding changes the child input shape', () => {
  const workflow = mapProbe();
  workflow.inputSchema = closed({ payload: closed({ allowed: number }) });
  workflow.nodes[0].input = { selection: ref('input.payload') };
  workflow.nodes[0].body.nodes[0].args = { value: ref('input.selection.allowed') };
  accepted(workflow);
  workflow.nodes[0].body.nodes[0].args = { value: ref('input.payload.allowed') };
  rejectedPath(workflow, 'input.payload.allowed');
});
test('control nodes without explicit input inherit the parent input schema', () => {
  const workflow = mapProbe();
  workflow.inputSchema = closed({ payload: closed({ allowed: number }) });
  workflow.nodes[0].body.nodes[0].args = { value: ref('input.payload.allowed') };
  accepted(workflow);
});
test('static acceptance of an unknown field is not successful execution evidence', async t => {
  const r = registry({ type: 'object' });
  const workflow = outputProbe('nodes.source.dynamic');
  accepted(workflow, r);
  const result = await runNeutral(t, workflow, r);
  assert.equal(result.status, 'failed');
  assert.equal(result.error.code, 'MISSING_REFERENCE');
});
