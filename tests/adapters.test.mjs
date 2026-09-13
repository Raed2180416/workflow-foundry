import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join, resolve as pathResolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import { exportWorkflow } from '../adapters/index.mjs';
import { portableHelpers, schemaSubset } from '../adapters/n8n/portable.mjs';
import { condition, resolve, clone } from '../src/data.mjs';
import { validateData } from '../src/validate.mjs';

const root = pathResolve(dirname(fileURLToPath(import.meta.url)), '..');
const ref = name => ({ $ref: name });
const eq = (left, right) => ({ op: 'eq', left, right });
const fixtureCode = `import time\nimport uuid\n\ndef echo(arguments, context):\n    return arguments\n\ndef pause(arguments, context):\n    time.sleep(20)\n    return arguments\n\ndef invalid(arguments, context):\n    return []\n\ndef stamp(arguments, context):\n    return {"value": arguments["value"], "stamp": uuid.uuid4().hex}\n`;
const codeHash = createHash('sha256').update(fixtureCode).digest('hex');

function task(id = 'sample', needs = [], args = { value: ref('input.value') }) {
  return { id, kind: 'task', description: 'Execute a trusted pure fixture', needs, tool: 'test.echo', args, timeoutMs: 1000, retry: { maxAttempts: 1, backoffMs: 0 } };
}
function workflow() {
  return { schemaVersion: '1.0', id: 'adapter-fixture', version: 1, title: 'Adapter fixture',
    goal: 'Preserve a typed input value and prove the returned value agrees', domain: 'software',
    envelope: { assumptions: ['Pure deterministic capability binding'], risks: [], successCriteria: ['Returned value equals the supplied input'], unsupported: ['External effects'] },
    inputSchema: { type: 'object', properties: { value: { type: 'integer' } }, required: ['value'], additionalProperties: false },
    budget: { maxSteps: 10, maxDurationMs: 5000, maxConcurrency: 1, maxCost: 0 },
    nodes: [task(), { id: 'verify', kind: 'assert', description: 'Verify task output', needs: ['sample'], checks: [eq(ref('nodes.sample.value'), ref('input.value'))] }],
    acceptance: [eq(ref('nodes.verify.passed'), true)] };
}
function binding(target = 'n8n', extra = {}) {
  const base = { effects: 'pure', cost: 0, risk: 'low', requiresApproval: false,
    maxTimeoutMs: 1000, inputSchema: { type: 'object' }, outputSchema: { type: 'object' } };
  return target === 'n8n' ? { ...base, workflowId: 'echo-fixture', timeoutContract: 'deadline-and-cancellation-v1', ...extra } :
    { ...base, entrypoint: 'capabilities.py:echo', codeSha256: codeHash, ...extra };
}
const options = (target = 'n8n', extra = {}) => ({ bindings: { 'test.echo': binding(target, extra) } });
function exported(wf = workflow(), target = 'n8n', opts = options(target)) {
  return exportWorkflow(wf, target, opts);
}
function n8n(wf = workflow(), opts = options()) {
  return JSON.parse(exported(wf, 'n8n', opts).files.find(f => f.path === 'workflow.n8n.json').content);
}

// Execute only our generated JSON Code bodies with a tiny explicit n8n API
// substitute. This is NOT an n8n engine, import test or hosted-service test.
function simulate(plan, input, capability = request => [{ json: { ok: true, operationKey: request.operationKey, output: request.args, cost: 0 } }], acceptanceDelayMs = 0) {
  let current = plan.nodes.find(n => n.type.endsWith('.executeWorkflowTrigger')).name;
  let items = [{ json: { input } }], calls = 0, clock = 100000;
  const outputs = {};
  for (let step = 0; step < 1000; step++) {
    const node = plan.nodes.find(n => n.name === current);
    let port = 0;
    if (node.type.endsWith('.code')) {
      const script = `const entries = JSON.parse(__entries); const outputs = JSON.parse(__outputs);\n` +
        `const $input = {all: () => entries}; const $execution = {id: 'fixture-run'}; const $ = name => ({first: () => outputs[name][0]});\n` +
        `const Date = {now: () => __now()}; JSON.stringify((function(){${node.parameters.jsCode}\n})());`;
      let reads = 0;
      const serialized = vm.runInNewContext(script, { __entries: JSON.stringify(items), __outputs: JSON.stringify(outputs),
        __now: () => { if (node.name === 'Foundry Acceptance' && reads++ > 0) clock += acceptanceDelayMs; return clock; }
      }, { timeout: 1000 });
      items = JSON.parse(serialized);
    } else if (node.type.endsWith('.if')) {
      port = items[0].json.dispatch === true ? 0 : 1;
    } else if (node.type.endsWith('.executeWorkflow')) {
      calls++;
      const request = clone(items[0].json.request);
      const result = capability(request, { advance: milliseconds => { clock += milliseconds; } });
      items = result.length ? result : [{ json: {} }]; // alwaysOutputData makes absence observable.
    }
    outputs[current] = clone(items);
    const outgoing = plan.connections[current]?.main[port] ?? [];
    if (!outgoing.length) return { items, calls, outputs };
    assert.equal(outgoing.length, 1, 'The qualified profile never fans out');
    current = outgoing[0].node;
  }
  throw new Error('Simulation exceeded its bound');
}

test('qualified exports declare missing bindings and preserve workflow identity', () => {
  for (const target of ['n8n', 'langgraph']) {
    const result = exportWorkflow(workflow(), target);
    assert.equal(result.supported.ready, false);
    assert.equal(result.supported.runtimeParity, false);
    assert.ok(result.warnings.some(w => w.code === 'UNBOUND_CAPABILITIES'));
    assert.equal(new Set(result.files.map(f => f.path)).size, result.files.length);
    assert.ok(result.files.every(f => !f.path.includes('..') && !f.path.startsWith('/')));
  }
  assert.throws(() => simulate(n8n(workflow(), {}), { value: 3 }), /UNBOUND_CAPABILITIES/);
});

test('unsupported or unsafe export contracts are rejected instead of flattened', () => {
  for (const target of ['n8n', 'langgraph']) {
    for (const mutation of [
      w => { w.budget.maxConcurrency = 2; },
      w => { w.nodes[0].retry.maxAttempts = 2; },
      w => { w.nodes[0].onError = 'continue'; },
      w => {
        w.nodes[0] = { id: 'sample', kind: 'wait', description: 'Wait fixture', needs: [], delayMs: 1 };
        // Keep the native dataflow valid so this specifically exercises the
        // adapter's unsupported wait semantics, rather than a missing value field.
        w.nodes[1].checks = [eq(ref('nodes.sample.waitedMs'), 1)];
      }
    ]) {
      const wf = workflow(); mutation(wf);
      assert.throws(() => exported(wf, target), e => e.code === 'UNSUPPORTED_EXPORT');
    }
    for (const extra of [{ effects: 'idempotent' }, { cost: 1 }, { risk: 'high' }, { requiresApproval: true },
      { outputSchema: { type: 'not-a-type' } }, { inputSchema: { items: [] } }, { maxTimeoutMs: 5 }]) {
      assert.throws(() => exported(workflow(), target, options(target, extra)), e => e.code === 'UNSUPPORTED_EXPORT');
    }
    assert.throws(() => exported(workflow(), target, null), e => e.code === 'UNSUPPORTED_EXPORT');
  }
  assert.throws(() => exported(workflow(), 'n8n', options('n8n', { timeoutContract: 'assumed' })), /cannot be exported/);
  assert.throws(() => exported(workflow(), 'langgraph', options('langgraph', { entrypoint: '../escape.py:run' })), /cannot be exported/);
  assert.throws(() => exportWorkflow(workflow(), 'constructor'), /Unknown export target/);
});

test('human exports reject partial orders and n8n export rejects human semantics', () => {
  const wf = workflow();
  wf.nodes.push({ id: 'question', kind: 'human', description: 'Request a human answer', needs: [], question: 'Continue?', answerSchema: { type: 'boolean' } });
  assert.throws(() => exported(wf, 'langgraph'), e => e.code === 'UNSUPPORTED_EXPORT' && e.details.reasons.some(r => r.includes('totally ordered')));
  assert.throws(() => exported(wf, 'n8n'), e => e.code === 'UNSUPPORTED_EXPORT');
});

test('n8n topology and bindings remain explicit and versioned', () => {
  const plan = n8n();
  assert.equal(plan.active, false);
  assert.equal(plan.meta.foundry.targetRuntimeVerified, false);
  const names = new Set(plan.nodes.map(n => n.name));
  assert.equal(names.size, plan.nodes.length);
  for (const outputs of Object.values(plan.connections)) for (const ports of outputs.main) for (const edge of ports) assert.ok(names.has(edge.node));
  const execution = plan.nodes.find(n => n.type.endsWith('.executeWorkflow'));
  assert.equal(execution.parameters.workflowId.value, 'echo-fixture');
  assert.equal(execution.parameters.options.waitForSubWorkflow, true);
  assert.equal(execution.retryOnFail, false);
  assert.equal(execution.alwaysOutputData, true);
  assert.ok(!Object.hasOwn(execution.parameters, 'workflowInputs'));
  assert.ok(plan.nodes.every(n => !Object.hasOwn(n, 'credentials')));
});

test('n8n generated code executes acceptance and rejects a plausible wrong result', () => {
  const success = simulate(n8n(), { value: 7 });
  assert.equal(success.items[0].json.state.status, 'succeeded');
  assert.deepEqual(success.items[0].json.state.outputs.sample, { value: 7 });
  assert.equal(success.items[0].json.state.steps, 2);
  assert.equal(success.calls, 1);
  assert.throws(() => simulate(n8n(), { value: 7 }, request => [{ json: { ok: true, operationKey: request.operationKey, cost: 0, output: { value: 8 } } }]), /ASSERTION_FAILED/);
  assert.throws(() => simulate(n8n(), { value: '7' }), /SCHEMA_MISMATCH/);
  assert.throws(() => simulate(n8n(), { value: 7 }, undefined, 6000), /DEADLINE/);
});

function conditional(joinMode) {
  const wf = workflow();
  wf.nodes[0].when = eq(ref('input.value'), 999);
  wf.nodes[1] = { id: 'verify', kind: 'assert', description: 'Verify default after a skipped branch', needs: ['sample'], checks: [eq({ $ref: 'nodes.sample.value', default: 7 }, ref('input.value'))] };
  if (joinMode) wf.nodes[1].join = joinMode;
  wf.acceptance = [joinMode ? eq(ref('nodes.verify.passed'), true) : { op: 'not', condition: { op: 'exists', value: ref('nodes.verify') } }];
  return wf;
}

test('default joins propagate skip while explicit all_resolved joins admit fallback', () => {
  for (const joinMode of [undefined, 'all_resolved']) {
    const result = simulate(n8n(conditional(joinMode)), { value: 7 });
    const state = result.items[0].json.state;
    assert.equal(result.calls, 0);
    assert.equal(state.statuses.sample, 'skipped');
    assert.ok(!Object.hasOwn(state.outputs, 'sample'));
    assert.equal(state.statuses.verify, joinMode ? 'completed' : 'skipped');
    assert.equal(state.steps, joinMode ? 1 : 0);
    assert.equal(state.status, 'succeeded');
  }
});

test('n8n result correlation, cardinality, output schemas and deadlines fail closed', () => {
  const result = (request, output = { value: 7 }) => ({ json: { ok: true, operationKey: request.operationKey, output, cost: 0 } });
  for (const child of [() => [], request => [result(request), result(request)], () => [{ json: { ok: true, operationKey: 'wrong', output: {}, cost: 0 } }],
    request => [result(request, [])], (request, context) => { context.advance(1001); return [result(request)]; }]) {
    assert.throws(() => simulate(n8n(), { value: 7 }, child), /ITEM_CARDINALITY|BINDING_RESULT|SCHEMA_MISMATCH|TOOL_TIMEOUT/);
  }
  const wf = workflow(); wf.budget.maxSteps = 1;
  assert.throws(() => simulate(n8n(wf), { value: 7 }), /STEP_BUDGET/);
});

test('template-like text stays data through code generation', () => {
  const wf = workflow();
  const value = '`; throw new Error("injected"); // ${globalThis.secret} $(not-a-command)';
  wf.nodes[0].args = { text: value };
  wf.nodes[1].checks = [eq(ref('nodes.sample.text'), value)];
  assert.equal(simulate(n8n(wf), { value: 0 }).items[0].json.state.outputs.sample.text, value);
});

test('portable references and conditions agree with native JSON semantics', () => {
  const p = portableHelpers(), context = { input: { rows: [false, null, 3], name: '🧪' }, nodes: { x: { value: 7 } } };
  for (const template of [ref('input.rows.length'), ref('input.rows.0'), ref('input.rows.1'), { $ref: 'input.absent', default: false }, { nested: ref('nodes.x.value') }]) assert.deepEqual(p.resolve(template, context), resolve(template, context));
  for (const check of [eq(true, 1), eq({ a: 1, b: 2 }, { b: 2, a: 1 }), { op: 'contains', left: [true], right: 1 }, { op: 'exists', value: ref('input.rows.1') }, { op: 'exists', value: ref('input.absent') }, { op: 'gt', left: 7, right: 3 }]) assert.equal(p.condition(check, context), condition(check, context));
  assert.throws(() => p.condition({ op: 'gt', left: true, right: 0 }, context));
  assert.throws(() => p.data({ value: Number.MAX_SAFE_INTEGER + 1 }), /DATA_NUMBER/);
  assert.throws(() => p.data('\ud800'), /DATA_STRING/);
});

test('portable schema checks agree with native validators on discriminating cases', () => {
  const p = portableHelpers();
  const cases = [
    [{ enum: [true] }, 1], [{ const: { a: 1, b: 2 } }, { b: 2, a: 1 }],
    [{ type: 'array', items: { type: 'integer' }, uniqueItems: true }, [1, 1]],
    [{ type: 'object', properties: { v: { type: ['boolean', 'null'] } }, required: ['v'], additionalProperties: false }, { v: null }],
    [{ type: 'object', properties: { v: false } }, { v: null }],
    [{ type: 'string', minLength: 1, maxLength: 1 }, '🧪'],
    [{ oneOf: [{ type: 'integer' }, { type: 'number' }] }, 1],
    [{ not: { type: 'boolean' } }, true], [{ type: 'number', exclusiveMinimum: 2 }, 2]
  ];
  for (const [schema, value] of cases) {
    let native = true;
    try { validateData(schema, value); } catch (e) { if (e.code === 'SCHEMA_MISMATCH') native = false; else throw e; }
    assert.equal(p.valid(schema, value), native, JSON.stringify({ schema, value }));
  }
  assert.ok(schemaSubset({ $ref: '#/definitions/value' }).length);
  assert.ok(schemaSubset({ pattern: '.*' }).length);
});

test('real LangGraph fixtures: execution, human resume, timeout and tamper rejection', t => {
  const python = pathResolve(root, '.foundry/adapter-eval/.venv/bin/python');
  if (!existsSync(python)) { t.skip('Isolated LangGraph wheel environment is unavailable; no target-runtime verification'); return; }
  const base = pathResolve(root, '.foundry/adapter-eval');
  mkdirSync(base, { recursive: true });
  const directory = mkdtempSync(join(base, 'fixtures-'));
  function save(name, wf, overrides = {}) {
    const destination = join(directory, name); mkdirSync(destination);
    for (const file of exported(wf, 'langgraph', options('langgraph', overrides)).files) writeFileSync(join(destination, file.path), file.content);
    writeFileSync(join(destination, 'capabilities.py'), fixtureCode);
  }
  try {
    save('basic', workflow());
    save('skip', conditional());
    save('fallback', conditional('all_resolved'));
    const human = workflow();
    human.nodes.splice(1, 0, { id: 'question', kind: 'human', description: 'Request a human answer', needs: ['sample'], question: 'Continue?', answerSchema: { type: 'boolean' } });
    human.nodes[2].needs = ['question'];
    human.nodes[2].checks.push(eq(ref('nodes.question.answer'), true));
    save('human', human, { entrypoint: 'capabilities.py:stamp' });
    const expiring = clone(human); expiring.budget.maxDurationMs = 1000;
    save('human-deadline', expiring, { entrypoint: 'capabilities.py:stamp' });
    const acceptanceDeadline = workflow(); acceptanceDeadline.budget.maxDurationMs = 1000;
    save('acceptance-deadline', acceptanceDeadline);
    const step = workflow(); step.budget.maxSteps = 1; save('step', step);
    const timeout = workflow(); timeout.nodes[0].timeoutMs = 50; save('timeout', timeout, { entrypoint: 'capabilities.py:pause' });
    save('output', workflow(), { entrypoint: 'capabilities.py:invalid' });
    save('tamper', workflow()); writeFileSync(join(directory, 'tamper/capabilities.py'), fixtureCode + '\n# changed\n');
    const result = spawnSync(python, ['-I', join(root, 'adapters/langgraph/smoke.py'), directory], {
      cwd: root, timeout: 30000, encoding: 'utf8', maxBuffer: 1024 * 1024,
      env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', LANGCHAIN_TRACING_V2: 'false', LANGSMITH_TRACING: 'false' }
    });
    assert.equal(result.status, 0, `${result.error ?? ''}\n${result.stdout}\n${result.stderr}`);
    const receipt = JSON.parse(result.stdout.trim());
    assert.equal(receipt.passed, 16);
    assert.equal(receipt.langgraph, '1.2.11');
    writeFileSync(join(base, 'latest-langgraph.json'), JSON.stringify({ observedAt: new Date().toISOString(), ...receipt }, null, 2) + '\n');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
