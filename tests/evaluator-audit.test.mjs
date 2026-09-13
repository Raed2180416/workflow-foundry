import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateWorkflow, suiteEvaluator, validateSuite } from '../src/evaluation.mjs';
import { createDefaultRegistry } from '../src/capabilities.mjs';
import { Foundry } from '../src/foundry.mjs';
import { WorkflowGenerator } from '../src/generator.mjs';
import { Store } from '../src/store.mjs';
import { digest } from '../src/data.mjs';
import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { syncBuiltinESMExports } from 'node:module';
import { runProcess } from '../src/process.mjs';
import { OpenCodeFreeProvider, parseFreeCatalog, requireFreeModel, parseOpenCodeEvents } from '../src/opencode-free.mjs';

// Independent, hand-authored CONTROL cases and synthetic local host tools.
// These are evaluator/runtime regressions, not generated-model or TUI results.
const audit = (name, fn) => test(`evaluator audit: ${name}`, { timeout: 20000 }, fn);
const ref = ($ref, ...fallback) => ({ $ref, ...(fallback.length ? { default: fallback[0] } : {}) });
const eq = (left, right) => ({ op: 'eq', left, right });
const exists = value => ({ op: 'exists', value });
const task = (id, tool, args, needs = [], extra = {}) => ({ id, kind: 'task', description: `Synthetic audit ${id}`, needs, tool, args, timeoutMs: 1000, retry: { maxAttempts: 1 }, ...extra });
function base(nodes = [task('result', 'core.identity', { answer: 42 })], acceptance = [exists(ref('nodes.result'))]) {
  return { schemaVersion: '1.0', id: 'EvaluatorAudit', version: 1, title: 'Independent evaluator control fixture', domain: 'diagnostic',
    goal: 'Exercise an independently defined outcome under the real native runner.',
    envelope: { assumptions: ['Synthetic local fixture'], risks: [], successCriteria: ['External outcome matches.'] },
    budget: { maxSteps: 400, maxConcurrency: 2, maxDurationMs: 15000, maxCost: 0 }, nodes, acceptance };
}
function suite(expect = { statuses: ['succeeded'], checks: [eq(ref('nodes.result.answer'), 42)] }, input = {}) {
  return { schemaVersion: '1.0', id: 'evaluator-audit', split: 'diagnostic', task: 'Independent synthetic outcome.', envelope: ['Explicit synthetic cases only'], cases: [{ id: 'case-one', input, expect }] };
}
function directory(t) {
  const root = fileURLToPath(new URL('../evals/runs/', import.meta.url)); mkdirSync(root, { recursive: true, mode: 0o700 });
  const location = mkdtempSync(path.join(root, 'evaluator-audit-'));
  t.after(() => rmSync(location, { recursive: true, force: true })); return location;
}
const evaluate = (t, workflow, cases, options = {}) => evaluateWorkflow(workflow, cases, { directory: directory(t), ...options });
function register(registry, name, execute) {
  registry.register({ name, description: 'Synthetic local evaluator audit tool', version: '1', implementation: `evaluator-audit/${name}`,
    inputSchema: {}, outputSchema: {}, effects: 'none', risk: 'low', requiresApproval: false, cancellation: 'cooperative', maxTimeoutMs: 1000, cost: 0, execute });
  return registry;
}

audit('self-attested success is rejected by the real evaluator on an independently wrong output', async t => {
  const report = await evaluate(t, base(), suite({ statuses: ['succeeded'], checks: [eq(ref('nodes.result.answer'), 43)] }));
  assert.equal(report.passed, false); assert.equal(report.cases[0].status, 'succeeded');
  assert.equal(report.metrics.falseSuccessCount, 1); assert.equal(report.metrics.passedCount, 0);
});

audit('evaluation stages an exact revision without silently changing its version or hash', async t => {
  const candidate = { ...base(), version: 7 }, original = structuredClone(candidate);
  const report = await evaluate(t, candidate, suite());
  assert.equal(report.passed, true, JSON.stringify(report.cases));
  assert.equal(report.workflowHash, digest(original)); assert.deepEqual(candidate, original);
  const saved = new Store(report.cases[0].workspace);
  try { assert.equal(saved.workflow(report.workflowHash).workflow.version, 7); assert.equal(saved.workflows().length, 0); }
  finally { saved.close(); }
});

audit('suite snapshot remains unchanged after caller mutation and refuses heldout repair', async t => {
  const cases = suite(), frozenHash = digest(cases), evaluator = suiteEvaluator(cases);
  cases.cases[0].expect.checks[0].right = -1;
  const report = await evaluator.evaluate({ workflow: base(), directory: directory(t) });
  assert.equal(report.passed, true); assert.equal(report.suiteHash, frozenHash);
  cases.split = 'heldout'; assert.throws(() => suiteEvaluator(cases), { code: 'HOLDOUT_LEAKAGE' });
});

for (const [label, expect] of [
  ['status only', { statuses: ['succeeded'], checks: [] }],
  ['constants only', { statuses: ['succeeded'], checks: [eq(1, 1)] }],
  ['input only', { statuses: ['succeeded'], checks: [eq(ref('input.task'), {})] }],
  ['existence-only artifact', { statuses: ['succeeded'], checks: [], artifacts: [{ name: 'result.json' }] }]
]) audit(`weak oracle is rejected: ${label}`, () => {
  assert.throws(() => validateSuite(suite(expect)), { code: 'WEAK_EVALUATOR' });
});

for (const [label, check] of [
  ['same reference on both sides', eq(ref('nodes.result.answer'), ref('nodes.result.answer'))],
  ['unconditional true branch', { op: 'any', conditions: [eq(1, 1), eq(ref('nodes.result.answer'), 43)] }],
  ['default makes an absent result pass', eq(ref('nodes.neverExecuted.answer', 42), 42)]
]) audit(`vacuous output reference cannot qualify an independent oracle: ${label}`, async t => {
  let report;
  try { report = await evaluate(t, base(), suite({ statuses: ['succeeded'], checks: [check] })); }
  catch (error) { assert.equal(error.code, 'WEAK_EVALUATOR'); return; }
  assert.equal(report.passed, false, 'Merely mentioning a node must not make an unconditional assertion an independent task oracle.');
});

audit('duplicate case ids, empty cases, malformed checks and traversal basenames are rejected', () => {
  const duplicates = suite(); duplicates.cases.push(structuredClone(duplicates.cases[0]));
  assert.throws(() => validateSuite(duplicates), { code: 'EVALUATION_CASE_IDS' });
  assert.throws(() => validateSuite({ ...suite(), cases: [] }));
  assert.throws(() => validateSuite(suite({ statuses: ['succeeded'], checks: [{ op: 'eq', left: 1 }] })));
  for (const name of ['../result', '/tmp/result', '..', 'sub/result', 'x\\y']) {
    assert.throws(() => validateSuite(suite({ statuses: ['succeeded'], checks: [], artifacts: [{ name, content: 'x' }] })), { code: 'EVALUATION_ARTIFACT_PATH' });
  }
});

audit('a missing or wrong-type result reference cannot become a true evaluator check', async t => {
  for (const check of [eq(ref('nodes.absent.answer'), 42), { op: 'gt', left: ref('nodes.result.answer'), right: '40' }]) {
    const report = await evaluate(t, base(), suite({ statuses: ['succeeded'], checks: [check] }));
    assert.equal(report.passed, false); assert.equal(report.cases[0].checks[0].passed, false);
    assert.ok(report.cases[0].checks[0].error); assert.equal(report.metrics.falseSuccessCount, 1);
  }
});

audit('unsafe reference syntax is rejected before evaluation', () => {
  for (const value of ['nodes.result.__proto__', 'nodes.result[0]', 'nodes.result.constructor']) {
    assert.throws(() => validateSuite(suite({ statuses: ['succeeded'], checks: [eq(ref(value), 1)] })), { code: 'INVALID_REFERENCE' });
  }
});

audit('JSON scalar, null, false and hyphenated-key inputs preserve their exact meaning', async t => {
  const w = base([task('result', 'core.identity', ref('input'))]);
  for (const input of [null, false, 0, 'zero', [0, false, null], { 'hyphen-key': 1 }]) {
    const report = await evaluate(t, w, suite({ statuses: ['succeeded'], checks: [eq(ref('nodes.result'), input)] }, input));
    assert.equal(report.passed, true, JSON.stringify({ input, cases: report.cases }));
  }
});

audit('explicit input rejection is evaluated independently without inventing a run or artifact', async t => {
  const w = { ...base(), inputSchema: { type: 'object', required: ['value'], properties: { value: { type: 'number' } }, additionalProperties: false } };
  const cases = suite({ statuses: ['input-rejected'], checks: [eq(ref('input.run.error.code'), 'SCHEMA_MISMATCH')], artifacts: [{ name: 'result.json', absent: true }] }, { value: 'wrong type' });
  const report = await evaluate(t, w, cases);
  assert.equal(report.passed, true); assert.equal(report.cases[0].status, 'input-rejected');
  assert.equal(report.cases[0].runId, null); assert.equal(report.metrics.totalSteps, 0);
});

audit('public artifact oracle distinguishes exact bytes from semantic JSON equality', async t => {
  const content = '{"b":2,"a":1}\n', w = base([task('result', 'core.artifact', { name: 'result.json', content })]);
  const expected = suite({ statuses: ['succeeded'], checks: [], artifacts: [{ name: 'result.json', json: { a: 1, b: 2 }, content }] });
  assert.equal((await evaluate(t, w, expected)).passed, true);
  expected.cases[0].expect.artifacts[0].content = '{"a":1,"b":2}';
  const wrongBytes = await evaluate(t, w, expected);
  assert.equal(wrongBytes.passed, false); assert.equal(wrongBytes.metrics.falseSuccessCount, 1);
});

audit('artifact absence, malformed JSON and UTF-8 content are checked from actual files', async t => {
  const w = base([task('result', 'core.artifact', { name: 'result.json', content: 'π 😀 not JSON\n' })]);
  const correct = suite({ statuses: ['succeeded'], checks: [], artifacts: [{ name: 'result.json', content: 'π 😀 not JSON\n' }, { name: 'absent.txt', absent: true }] });
  assert.equal((await evaluate(t, w, correct)).passed, true);
  const invalid = suite({ statuses: ['succeeded'], checks: [], artifacts: [{ name: 'result.json', json: {} }] });
  assert.equal((await evaluate(t, w, invalid)).passed, false);
  const missing = suite({ statuses: ['succeeded'], checks: [], artifacts: [{ name: 'missing.txt', content: '' }] });
  assert.equal((await evaluate(t, w, missing)).passed, false);
});

audit('contradictory artifact content and absence expectations are rejected', () => {
  assert.throws(() => validateSuite(suite({ statuses: ['succeeded'], checks: [], artifacts: [{ name: 'result.json', absent: true, content: 'required content' }] })));
});

for (const ancestor of [false, true]) audit(`symlinked ${ancestor ? 'artifact ancestor' : 'artifact file'} cannot qualify`, async t => {
  const registry = register(createDefaultRegistry(), 'audit.linkArtifact', async (_args, ctx) => {
    const local = mkdtempSync(path.join(ctx.store.workspace, 'synthetic-link-target-'));
    writeFileSync(path.join(local, 'result.txt'), 'Synthetic expected bytes');
    if (ancestor) { mkdirSync(path.dirname(ctx.artifactsDir), { recursive: true }); symlinkSync(local, ctx.artifactsDir, 'dir'); }
    else { mkdirSync(ctx.artifactsDir, { recursive: true }); symlinkSync(path.join(local, 'result.txt'), path.join(ctx.artifactsDir, 'result.txt')); }
    return { attempted: true };
  });
  const report = await evaluate(t, base([task('result', 'audit.linkArtifact', {})]), suite({ statuses: ['succeeded'], checks: [], artifacts: [{ name: 'result.txt', content: 'Synthetic expected bytes' }] }), { registryFactory: () => registry });
  assert.equal(report.passed, false, 'Artifact containment includes the path ancestors.');
});

audit('artifact-inspection errors still charge executed steps to the total evaluation budget', async t => {
  let calls = 0;
  const registry = register(createDefaultRegistry(), 'audit.directoryArtifact', async (_args, ctx) => {
    calls++; mkdirSync(path.join(ctx.artifactsDir, 'result.txt'), { recursive: true }); return { attempted: true };
  });
  const cases = suite({ statuses: ['succeeded'], checks: [], artifacts: [{ name: 'result.txt', content: 'not a directory' }] });
  cases.cases.push({ ...structuredClone(cases.cases[0]), id: 'second-case' });
  const report = await evaluate(t, base([task('result', 'audit.directoryArtifact', {})]), cases, { registryFactory: () => registry, maxTotalSteps: 1 });
  assert.equal(report.passed, false); assert.equal(calls, 1, 'The first actual dispatch exhausted the shared step budget even though artifact inspection failed.');
  assert.equal(report.metrics.totalSteps, 1); assert.equal(report.cases[1].status, 'not-run');
});

audit('total step budget and pre-cancellation prevent unexecuted cases from qualifying', async t => {
  const cases = suite(); cases.cases.push({ ...structuredClone(cases.cases[0]), id: 'second-case' });
  const limited = await evaluate(t, base(), cases, { maxTotalSteps: 1 });
  assert.equal(limited.passed, false); assert.equal(limited.metrics.totalSteps, 1); assert.equal(limited.cases[1].status, 'not-run');
  const c = new AbortController(); c.abort();
  const cancelled = await evaluate(t, base(), cases, { signal: c.signal });
  assert.equal(cancelled.passed, false); assert.equal(cancelled.metrics.totalSteps, 0);
  assert.ok(cancelled.cases.every(item => item.status === 'not-run'));
});

for (const [label, report] of [
  ['numeric evaluator identity', { evaluatorId: 7, passed: true, workflowHash: 'a'.repeat(64), registryHash: 'b'.repeat(64) }],
  ['malformed workflow hash', { evaluatorId: 'synthetic-host', passed: true, workflowHash: 'not-a-digest', registryHash: 'b'.repeat(64) }],
  ['missing registry binding', { evaluatorId: 'synthetic-host', passed: true, workflowHash: 'a'.repeat(64) }]
]) audit(`Store rejects malformed qualification: ${label}`, t => {
  const store = new Store(directory(t));
  try { assert.throws(() => store.recordQualification(report), { code: 'QUALIFICATION' }); assert.equal(store.qualifications().length, 0); }
  finally { store.close(); }
});

function nestedProgram() {
  const repeat = { id: 'repeat', kind: 'loop', needs: [], description: 'Count to one cell limit', maxIterations: 6,
    initial: { step: { value: 0 } }, input: { limit: ref('item') },
    until: { op: 'gte', left: ref('nodes.step.value'), right: ref('input.limit') },
    body: { nodes: [task('step', 'core.aggregate', { operation: 'sum', values: [ref('previous.step.value'), 1] })], acceptance: [exists(ref('nodes.step.value'))] } };
  const rows = { id: 'rows', kind: 'map', needs: [], description: 'Count every cell in a group', items: ref('item'), maxItems: 8,
    body: { nodes: [repeat], acceptance: [eq(ref('nodes.repeat.last.step.value'), ref('item'))] } };
  const groups = { id: 'groups', kind: 'map', needs: [], description: 'Independent nested groups', items: ref('input.groups'), maxItems: 8,
    body: { nodes: [rows, task('subtotal', 'core.aggregate', { operation: 'sum', values: ref('nodes.rows.items'), field: 'repeat.last.step.value' }, ['rows'])], acceptance: [exists(ref('nodes.subtotal.value'))] } };
  return base([
    groups,
    task('total', 'core.aggregate', { operation: 'sum', values: ref('nodes.groups.items'), field: 'subtotal.value' }, ['groups']),
    { id: 'manual', kind: 'human', needs: ['groups'], description: 'Explicit synthetic preference', when: eq(ref('input.review'), true), question: 'Approve this synthetic total?', answerSchema: { type: 'boolean' } },
    task('automatic', 'core.identity', { approved: true }, ['groups'], { when: eq(ref('input.review'), false) }),
    task('result', 'core.identity', { total: ref('nodes.total.value'), manual: ref('nodes.manual.answer', false), automatic: ref('nodes.automatic.approved', false) }, ['total', 'manual', 'automatic'], { join: 'all_resolved' })
  ], [exists(ref('nodes.result.total'))]);
}

audit('generated-program-shaped nested maps, loops, branch joins and human resume execute independently', async t => {
  const f = new Foundry(directory(t));
  try {
    const candidate = nestedProgram();
    const provider = { identity: { provider: 'deterministic-audit-stub', model: 'none', measuredModelPerformance: false }, async generate() { return { text: JSON.stringify({ workflow: candidate, rationale: 'Hand-authored nested program control.' }) }; } };
    const r = f.store.createRequest({ text: 'Count grouped limits and pause for a synthetic preference.' });
    const job = await new WorkflowGenerator(f, provider, { autoApply: true }).generate(r.id);
    assert.equal(job.status, 'applied', JSON.stringify(job.error)); assert.equal(job.deploymentQualified, false);
    const input = { groups: [[2, 3], [1, 4]], review: true }, expectedTotal = input.groups.flat().reduce((sum, value) => sum + value, 0);
    const created = f.createRun(candidate.id, input), paused = await f.startRun(created.id);
    assert.equal(paused.status, 'awaiting_human'); assert.equal(paused.outputs.total.value, expectedTotal);
    assert.equal(paused.outputs.result, undefined, 'A join cannot fabricate the missing human answer.');
    assert.throws(() => f.runtime.answer(created.id, 'root/manual', 'true'), { code: 'SCHEMA_MISMATCH' });
    f.runtime.answer(created.id, 'root/manual', true);
    const done = await f.startRun(created.id);
    assert.equal(done.status, 'succeeded', JSON.stringify(done.error));
    assert.deepEqual(done.outputs.result, { total: expectedTotal, manual: true, automatic: false });
    const steps = done.steps, completedEvents = f.store.events(created.id).filter(event => event.type === 'node.completed').length;
    await f.startRun(created.id);
    assert.equal(f.store.run(created.id).steps, steps);
    assert.equal(f.store.events(created.id).filter(event => event.type === 'node.completed').length, completedEvents);
    t.diagnostic(JSON.stringify({ kind: 'synthetic-nested-human-control', cells: input.groups.flat().length, steps, frames: Object.keys(done.frames).length, eventCount: f.store.events(done.id).length }));
  } finally { await f.close(); }
});

audit('two nested-program scales have independent outputs and measured resource receipts', async t => {
  const w = nestedProgram(), cases = suite(); cases.cases = [];
  for (const count of [2, 6]) {
    const input = { groups: Array.from({ length: count }, () => [1, 2, 3, 4]), review: false };
    const expectedTotal = input.groups.flat().reduce((sum, value) => sum + value, 0);
    cases.cases.push({ id: `groups-${count}`, input, expect: { statuses: ['succeeded'], checks: [eq(ref('nodes.result'), { total: expectedTotal, manual: false, automatic: true })] } });
  }
  const report = await evaluate(t, w, cases, { maxDurationMs: 18000 });
  assert.equal(report.passed, true, JSON.stringify(report.cases));
  assert.ok(report.cases[1].steps > report.cases[0].steps);
  t.diagnostic(JSON.stringify({ kind: 'synthetic-nested-scale-control', cases: report.cases.map(item => ({ id: item.id, steps: item.steps, elapsedMs: item.elapsedMs, eventCount: item.eventCount })), totalSteps: report.metrics.totalSteps, totalElapsedMs: report.metrics.elapsedMs }));
});

const scopedEnv = { PATH: '/usr/bin:/bin', AUDIT_MARKER: 'synthetic-control' };
audit('real subprocess uses literal argv and only its deliberately supplied environment', async () => {
  const literal = '$(not-a-command) `also-not-a-command` ; quoted argument';
  const result = await runProcess(process.execPath, ['-e', 'process.stdout.write(JSON.stringify({args:process.argv.slice(1),keys:Object.keys(process.env).sort(),marker:process.env.AUDIT_MARKER}))', '--', literal], { env: scopedEnv, timeoutMs: 2000 });
  assert.deepEqual(JSON.parse(result.stdout), { args: [literal], keys: ['AUDIT_MARKER', 'PATH'], marker: 'synthetic-control' });
  assert.equal(result.code, 0);
});

audit('real subprocess nonzero exit and launch failure retain their correct failure classifications', async () => {
  await assert.rejects(runProcess(process.execPath, ['-e', 'process.stdout.write("partial");process.stderr.write("synthetic failure");process.exitCode=7'], { env: scopedEnv, timeoutMs: 2000 }), error => {
    assert.equal(error.code, 'PROCESS_FAILED'); assert.equal(error.processResult.code, 7);
    assert.equal(error.processResult.stdout, 'partial'); assert.equal(error.processResult.stderr, 'synthetic failure'); return true;
  });
  await assert.rejects(runProcess('/definitely-absent-foundry-audit-binary', [], { env: scopedEnv, timeoutMs: 1000 }), { code: 'PROCESS_LAUNCH' });
});

audit('real subprocess deadline terminates a child that ignores SIGTERM', async () => {
  const began = Date.now();
  await assert.rejects(runProcess(process.execPath, ['-e', 'process.on("SIGTERM",()=>{});process.stdout.write("synthetic child ready");setInterval(()=>{},1000)'], { env: scopedEnv, timeoutMs: 100 }), { code: 'PROCESS_TIMEOUT' });
  assert.ok(Date.now() - began < 2500, 'Deadline plus forced termination must remain bounded.');
});

audit('real subprocess cancellation and pre-cancellation are bounded and distinct from success', async () => {
  const c = new AbortController(), timer = setTimeout(() => c.abort(), 100), began = Date.now();
  try {
    await assert.rejects(runProcess(process.execPath, ['-e', 'process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'], { env: scopedEnv, timeoutMs: 2000, signal: c.signal }), { code: 'CANCELLED' });
  } finally { clearTimeout(timer); }
  assert.ok(Date.now() - began < 2500);
  await assert.rejects(runProcess('/definitely-absent-foundry-audit-binary', [], { env: scopedEnv, signal: c.signal }), { code: 'CANCELLED' });
});

audit('subprocess stdout and stderr share one bounded retained-output budget', async () => {
  await assert.rejects(runProcess(process.execPath, ['-e', 'process.stdout.write("o".repeat(300));process.stderr.write("e".repeat(300))'], { env: scopedEnv, timeoutMs: 2000, maxBytes: 512 }), error => {
    assert.equal(error.code, 'PROCESS_OUTPUT_LIMIT');
    assert.ok(Buffer.byteLength(error.processResult.stdout) + Buffer.byteLength(error.processResult.stderr) <= 512); return true;
  });
});

for (const limit of [NaN, Infinity, -1]) audit(`invalid subprocess output bound is rejected before launch: ${String(limit)}`, async () => {
  await assert.rejects(runProcess(process.execPath, ['-e', 'process.exitCode=0'], { env: scopedEnv, timeoutMs: 2000, maxBytes: limit }), error => /^PROCESS_/.test(error.code));
});

// Replace only Node's spawn binding inside this isolated test process. These
// protocol fixtures NEVER execute the selected binary, bubblewrap, or a model.
function syntheticSpawn(t, respond) {
  const calls = [];
  const replacement = t.mock.method(childProcess, 'spawn', (command, args, options) => {
    calls.push({ command, args, options });
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough(); child.stdin.resume();
    queueMicrotask(() => {
      try {
        const output = respond({ command, args, options, index: calls.length - 1 });
        for (const chunk of Array.isArray(output) ? output : [Buffer.from(output)]) child.stdout.write(chunk);
        child.stdout.end(); child.stderr.end(); child.emit('close', 0, null);
      } catch (error) { child.emit('error', error); child.stdout.end(); child.stderr.end(); child.emit('close', 1, null); }
    });
    return child;
  });
  syncBuiltinESMExports();
  t.after(() => { replacement.mock.restore(); syncBuiltinESMExports(); });
  return calls;
}

audit('subprocess UTF-8 decoding preserves characters split across transport chunks', async t => {
  const encoded = Buffer.from('π 😀 final');
  syntheticSpawn(t, () => [encoded.subarray(0, 1), encoded.subarray(1, 5), encoded.subarray(5)]);
  const result = await runProcess('/synthetic-process-not-executed', [], { env: scopedEnv, timeoutMs: 1000 });
  assert.equal(result.stdout, 'π 😀 final');
});

const eventStream = events => events.map(event => JSON.stringify(event)).join('\n') + '\n';
const modelEvents = () => [
  { type: 'step_start', sessionID: 'synthetic-session', part: { type: 'step-start' } },
  { type: 'text', sessionID: 'synthetic-session', part: { type: 'text', text: 'synthetic-response' } },
  { type: 'step_finish', sessionID: 'synthetic-session', part: { type: 'step-finish', reason: 'stop', cost: 0, tokens: { input: 2, output: 2 } } }
];

audit('free model catalog accepts observed zero prices and rejects unknown or nonzero pricing', () => {
  const records = parseFreeCatalog('opencode/audit-free\n{"cost":{"input":0,"output":0,"cache":{"read":0,"write":0}}}\n');
  assert.equal(requireFreeModel(records, 'opencode/audit-free').id, 'opencode/audit-free');
  assert.throws(() => requireFreeModel(records, 'opencode/not-observed'), { code: 'MODEL_UNAVAILABLE' });
  for (const price of [0.1, '0', 'free', null]) {
    const mutated = structuredClone(records); mutated[0].metadata.cost.cache.read = price;
    assert.throws(() => requireFreeModel(mutated, 'opencode/audit-free'), { code: 'MODEL_NOT_FREE' });
  }
  for (const cost of [undefined, { input: 0 }, { output: 0 }]) {
    assert.throws(() => requireFreeModel([{ id: 'opencode/audit-free', metadata: { cost } }], 'opencode/audit-free'), { code: 'MODEL_NOT_FREE' });
  }
});

audit('conflicting duplicate model IDs cannot cherry-pick the free catalog record', () => {
  assert.throws(() => requireFreeModel(parseFreeCatalog('opencode/audit-free\n{"cost":{"input":0,"output":0}}\nopencode/audit-free\n{"cost":{"input":2,"output":3}}\n'), 'opencode/audit-free'));
});

audit('an empty nested pricing object does not establish its explicitly zero cost', () => {
  assert.throws(() => requireFreeModel([{ id: 'opencode/audit-free', metadata: { cost: { input: 0, output: 0, cache: {} } } }], 'opencode/audit-free'), { code: 'MODEL_NOT_FREE' });
});

audit('complete zero-cost event stream has one session and exact text', () => {
  const result = parseOpenCodeEvents(eventStream(modelEvents()));
  assert.equal(result.text, 'synthetic-response'); assert.equal(result.sessionId, 'synthetic-session'); assert.equal(result.cost, 0);
});

for (const [label, mutate] of [
  ['missing final event', events => events.slice(0, -1)],
  ['error event', events => [...events, { type: 'error', sessionID: 'synthetic-session' }]],
  ['tool attempt', events => [...events, { type: 'tool_use', sessionID: 'synthetic-session' }]],
  ['unfinished completion', events => { events[2].part.reason = 'length'; return events; }],
  ['unknown cost', events => { delete events[2].part.cost; return events; }],
  ['nonzero cost', events => { events[2].part.cost = 1; return events; }],
  ['mixed sessions', events => { events[2].sessionID = 'different'; return events; }]
]) audit(`output protocol rejects ${label}`, () => {
  assert.throws(() => parseOpenCodeEvents(eventStream(mutate(modelEvents()))), error => /^MODEL_/.test(error.code));
});

audit('output protocol rejects non-JSON lines', () => {
  assert.throws(() => parseOpenCodeEvents('not JSON\n' + eventStream(modelEvents())), { code: 'MODEL_PROTOCOL' });
});

for (const [label, mutate] of [
  ['identity omitted from final event', events => { delete events[2].sessionID; return events; }],
  ['text after the claimed final stop', events => [...events, { ...events[1], part: { type: 'text', text: 'uncommitted trailing text' } }]],
  ['a null event in an otherwise valid stream', events => [null, ...events]],
  ['an array event in an otherwise valid stream', events => [[], ...events]]
]) audit(`output protocol fails closed on ${label}`, () => {
  assert.throws(() => parseOpenCodeEvents(eventStream(mutate(modelEvents()))), error => /^MODEL_/.test(error.code), 'Malformed protocol needs a structured provider failure.');
});

function syntheticSession() {
  return { info: { id: 'synthetic-session', model: { providerID: 'opencode', id: 'audit-free' }, cost: 0, tokens: { input: 2, output: 2 } }, messages: [
    { info: { role: 'user' }, parts: [{ type: 'text', text: 'Synthetic audit prompt' }] },
    { info: { role: 'assistant', providerID: 'opencode', modelID: 'audit-free', cost: 0, finish: 'stop' }, parts: [{ type: 'text', text: 'synthetic-response' }] }
  ] };
}
async function simulatedProvider(t, mutate = () => {}) {
  const session = syntheticSession(); mutate(session);
  const calls = syntheticSpawn(t, ({ command, args }) => {
    assert.equal(command, '/usr/bin/bwrap', 'Unexpected subprocess in synthetic adapter control');
    if (args.includes('--version')) return 'synthetic-version\n';
    if (args.includes('models')) return 'opencode/audit-free\n{"cost":{"input":0,"output":0}}\n';
    if (args.includes('export')) return JSON.stringify(session);
    if (args.includes('run')) return eventStream(modelEvents());
    throw new Error('Unexpected synthetic provider operation');
  });
  const provider = new OpenCodeFreeProvider({ model: 'opencode/audit-free', binary: '/usr/bin/true', timeoutMs: 1000 });
  const result = await provider.generate({ prompt: 'Synthetic audit prompt', directory: directory(t) });
  assert.ok(calls.length >= 4); return result;
}

audit('adapter transport simulation accepts internally consistent synthetic export evidence', async t => {
  const result = await simulatedProvider(t);
  assert.equal(result.text, 'synthetic-response'); assert.equal(result.evidence.reportedCost, 0);
  assert.equal(result.evidence.sessionId, 'synthetic-session');
});

for (const [label, mutate] of [
  ['session model drift', session => { session.info.model.id = 'another-model'; }],
  ['session nonzero cost', session => { session.info.cost = 1; }],
  ['assistant model drift', session => { session.messages[1].info.modelID = 'another-model'; }],
  ['assistant nonzero cost', session => { session.messages[1].info.cost = 1; }],
  ['exported session identity mismatch', session => { session.info.id = 'different-session'; }],
  ['exported response mismatch', session => { session.messages[1].parts[0].text = 'different-output'; }]
]) audit(`adapter transport simulation rejects ${label}`, async t => {
  await assert.rejects(simulatedProvider(t, mutate), error => /^MODEL_/.test(error.code));
});
