import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { TASKS, HERE, UPSTREAM, parseAction, assess, Trial, runOriginal, candidateCommand, initialMessages, makeRegistry, architectureErrors, sha } from '../research/reference-swe/harness.mjs';
import { constructionGate, challengeGate } from '../research/reference-swe/construction-v2.mjs';
import { inventory, verifyInventory } from '../research/reference-swe/freeze-v2.mjs';

const temp = t => { const d = mkdtempSync(path.join(os.tmpdir(), 'foundry-reference-swe-')); t.after(() => rmSync(d, { recursive: true, force: true })); return d; };
const fake = responses => ({ identity: { provider: 'scripted-conformance-only', model: 'no-model-called' }, generate: async () => ({ text: responses.shift() ?? '{"op":"read"}', evidence: { conformanceOnly: true } }) });

test('action contract accepts only one narrow operation and exact keys', () => {
  for (const op of ['read', 'test', 'finish']) assert.equal(parseAction(JSON.stringify({ op })).op, op);
  assert.equal(parseAction('{"op":"write","content":"def f(): return 1"}').op, 'write');
  for (const bad of [null, [], { op: 'exec', command: 'true' }, { op: 'write', content: 1 }, { op: 'write', content: 'x', path: '/oracle.py' }, { op: 'test', command: 'true' }, { op: 'write', content: 'x'.repeat(16385) }]) assert.equal(parseAction(JSON.stringify(bad)).op, 'invalid');
  assert.equal(parseAction('```json\n{"op":"finish"}\n```').op, 'invalid');
});

test('candidate command has network namespace, read-only files and fixed resource ceilings', t => {
  const command = candidateCommand(path.join(temp(t), 'candidate.py'));
  for (const value of ['--unshare-all', '--cpu=2', '--as=268435456', '--fsize=1048576', '--nproc=64', '--nofile=64']) assert.ok(command.includes(value));
  assert.ok(!command.includes('--bind')); assert.ok(!command.includes(os.homedir()));
});

test('independent oracle rejects both initial bugs and wrong constant fixes', async t => {
  const dir = temp(t), candidate = path.join(dir, 'candidate.py');
  for (const task of TASKS) {
    writeFileSync(candidate, task.source);
    const initial = await assess(candidate, task, task.hidden);
    assert.equal(initial.transportError, null, initial.processResult?.stderr);
    assert.equal(initial.passed, false);
    writeFileSync(candidate, `def ${task.fn}(*args):\n    return 0\n`);
    assert.equal((await assess(candidate, task, task.hidden)).passed, false);
  }
});

test('correct controls pass all fixed hidden cases inside bubblewrap', async t => {
  const candidate = path.join(temp(t), 'candidate.py');
  const controls = ['def bucket_count(count, size):\n    return (count + size - 1) // size\n', 'def retain_last(values):\n    return [v for i, v in enumerate(values) if v not in values[i+1:]]\n'];
  for (let i = 0; i < TASKS.length; i++) {
    writeFileSync(candidate, controls[i]);
    const r = await assess(candidate, TASKS[i], TASKS[i].hidden);
    assert.equal(r.passed, true, JSON.stringify({ error: r.transportError, stderr: r.processResult?.stderr }));
    assert.equal(r.passedCases, TASKS[i].hidden.length);
  }
});

test('oracle tampering and successful early process exit cannot create a pass', async t => {
  const candidate = path.join(temp(t), 'candidate.py');
  const before = sha(readFileSync(path.join(HERE, 'oracle_runner.py')));
  for (const source of ['open("/oracle.py", "w").write("tampered")\n', 'import os\nos._exit(0)\n', 'import os\nos.write(1, b"{\\"values\\":[0]}")\nos._exit(0)\n']) {
    writeFileSync(candidate, source);
    assert.equal((await assess(candidate, TASKS[0], TASKS[0].hidden)).passed, false);
  }
  assert.equal(sha(readFileSync(path.join(HERE, 'oracle_runner.py'))), before);
});

test('infinite candidate loop is stopped by CPU/wall limits', async t => {
  const candidate = path.join(temp(t), 'candidate.py'); writeFileSync(candidate, 'while True: pass\n');
  const started = Date.now(); const result = await assess(candidate, TASKS[0], TASKS[0].public);
  assert.equal(result.passed, false); assert.ok(result.transportError); assert.ok(Date.now() - started < 6500);
  assert.ok(result.processResult.signal || result.processResult.code === 137 || result.transportError.code === 'PROCESS_TIMEOUT', JSON.stringify(result.processResult));
});

test('input mutation is independently rejected even with correct returned values', async t => {
  const candidate = path.join(temp(t), 'candidate.py');
  writeFileSync(candidate, 'def retain_last(values):\n    result = [v for i,v in enumerate(values) if v not in values[i+1:]]\n    values.clear()\n    return result\n');
  const result = await assess(candidate, TASKS[1], TASKS[1].hidden);
  assert.equal(result.passed, false); assert.equal(result.transportError.code, 'ORACLE_OUTPUT');
});

test('candidate sees empty home and a different network namespace', async t => {
  const candidate = path.join(temp(t), 'candidate.py');
  writeFileSync(candidate, 'import os\ndef probe():\n    return {"home": os.listdir("/home"), "network": os.readlink("/proc/self/ns/net")}\n');
  const result = await assess(candidate, { fn: 'probe' }, [{ args: [], expected: null }]);
  assert.equal(result.transportError, null, result.processResult?.stderr);
  assert.deepEqual(result.checks[0].actual.home, []);
  const { readlinkSync } = await import('node:fs');
  assert.notEqual(result.checks[0].actual.network, readlinkSync('/proc/self/ns/net'));
});

test('original DefaultAgent owns actual loop/history/stopping with custom interfaces', async t => {
  const source = readFileSync(path.join(UPSTREAM, 'src/minisweagent/agents/default.py'), 'utf8');
  const expectedSource = sha(source);
  const trial = new Trial(TASKS[0], path.join(temp(t), 'run'), fake(['{"op":"read"}', '{"op":"finish"}']));
  const r = await runOriginal(trial);
  assert.equal(r.code, 0, r.stderr); assert.equal(r.error, null);
  assert.equal(r.result.result.exit_status, 'Submitted'); assert.equal(trial.calls, 2);
  assert.equal(r.result.trajectory.info.config.agent_type, 'minisweagent.agents.default.DefaultAgent');
  assert.equal(r.result.trajectory.info.model_stats.api_calls, 2);
  assert.deepEqual(r.result.trajectory.messages.slice(0, 2), initialMessages(TASKS[0]));
  assert.equal(sha(readFileSync(path.join(UPSTREAM, 'src/minisweagent/agents/default.py'))), expectedSource);
});

test('original DefaultAgent itself enforces the fifth-call stopping budget', async t => {
  const trial = new Trial(TASKS[0], path.join(temp(t), 'run'), fake([]));
  const r = await runOriginal(trial);
  assert.equal(r.code, 0, r.stderr); assert.equal(r.error, null);
  assert.equal(r.result.result.exit_status, 'LimitsExceeded'); assert.equal(trial.calls, 5);
  assert.equal(r.result.trajectory.info.model_stats.api_calls, 5); assert.equal(trial.operations, 5);
});

test('malformed executor action consumes one original-agent call and remains visible', async t => {
  const trial = new Trial(TASKS[0], path.join(temp(t), 'run'), fake(['{"op":"exec","command":"false"}', '{"op":"finish"}']));
  const r = await runOriginal(trial);
  assert.equal(r.code, 0, r.stderr); assert.equal(trial.calls, 2);
  assert.match(r.result.trajectory.messages[3].content, /error/);
});

test('native capability history rejects erased observations and fabricated actions', async t => {
  const trial = new Trial(TASKS[0], path.join(temp(t), 'run'), fake(['{"op":"read"}']));
  const registry = makeRegistry(() => trial);
  const ctx = { signal: new AbortController().signal };
  const response = await registry.execute('reference.query', { messages: initialMessages(TASKS[0]) }, ctx);
  await assert.rejects(registry.execute('reference.act', { message: { ...response.message, content: 'fake' }, messages: response.messages }, ctx));
  const output = await registry.execute('reference.act', response, ctx);
  await assert.rejects(registry.execute('reference.query', { messages: initialMessages(TASKS[0]) }, ctx));
  assert.equal(output.messages.length, 4); assert.equal(trial.calls, 1);
});

test('structure evaluator rejects hidden whole-agent capability and excess budgets', () => {
  const errors = architectureErrors({ nodes: [{ kind: 'task', tool: 'hidden.agent' }], budget: { maxSteps: 99, maxConcurrency: 2, maxDurationMs: 400000, maxCost: 1 } });
  assert.ok(errors.length >= 3);
});

// This manually authored graph is solely an evaluator positive control. Actual
// campaign candidates must come from WorkflowGenerator and remain unchanged.
function conformanceControl() {
  const task = (id, tool, args, needs) => ({ id, kind: 'task', description: 'Protocol control', needs,
    tool, args, timeoutMs: 180000, retry: { maxAttempts: 1 } });
  return { schemaVersion: '1.0', id: 'NeutralControl', version: 1, title: 'Neutral control',
    goal: 'Exercise message handoff only', domain: 'general',
    envelope: { assumptions: [], risks: [], successCriteria: ['Explicit submission'] },
    budget: { maxSteps: 20, maxConcurrency: 1, maxDurationMs: 300000, maxCost: 0 },
    nodes: [{ id: 'conversation', kind: 'loop', description: 'Neutral control loop', needs: [],
      maxIterations: 5, initial: { act: { messages: { $ref: 'input.messages' } } },
      body: { nodes: [
        task('query', 'reference.query', { messages: { $ref: 'previous.act.messages' } }, []),
        task('act', 'reference.act', { message: { $ref: 'nodes.query.message' }, messages: { $ref: 'nodes.query.messages' } }, ['query'])
      ], acceptance: [{ op: 'exists', value: { $ref: 'nodes.act.done' } }] },
      until: { op: 'eq', left: { $ref: 'nodes.act.done' }, right: true } }],
    acceptance: [{ op: 'eq', left: { $ref: 'nodes.conversation.last.act.done' }, right: true }] };
}

test('neutral execution gate proves five control cases but remains explicitly partial', async t => {
  const report = await constructionGate(conformanceControl(), path.join(temp(t), 'gate'));
  assert.equal(report.constructionPassed, true, JSON.stringify(report));
  assert.equal(report.status, 'partial'); assert.equal(report.deploymentQualified, false);
  assert.equal(report.taskQualified, false); assert.equal(report.actualModelCalls, 0);
  assert.equal(Object.hasOwn(report, 'passed'), false);
  assert.equal(report.cases.length, 5);
});

test('counterexample gate rejects all six message-wrapper and stopping mutations', async t => {
  const result = await challengeGate(conformanceControl(), path.join(temp(t), 'mutations'));
  assert.equal(result.evaluatorSoundOnMutations, true, JSON.stringify(result));
  assert.equal(result.mutations.length, 6);
});

test('original generated reference-01 graph still fails the neutral executable gate', async t => {
  const file = path.join(HERE, 'runs/20260913-reference-01/candidate-workflow.json');
  const bytes = readFileSync(file), workflow = JSON.parse(bytes);
  assert.deepEqual(architectureErrors(workflow), []);
  const report = await constructionGate(workflow, path.join(temp(t), 'historical'));
  assert.equal(report.constructionPassed, false);
  assert.ok(report.cases.every(c => c.operations === 0));
  assert.equal(sha(readFileSync(file)), sha(bytes));
});

test('frozen-closure verifier detects modifications and additions independently of live files', t => {
  const dir = temp(t); writeFileSync(path.join(dir, 'dependency.mjs'), 'export default 1;');
  const records = inventory(dir); assert.deepEqual(verifyInventory(dir, records), []);
  writeFileSync(path.join(dir, 'dependency.mjs'), 'export default 2;');
  assert.deepEqual(verifyInventory(dir, records), ['dependency.mjs']);
  writeFileSync(path.join(dir, 'dependency.mjs'), 'export default 1;');
  writeFileSync(path.join(dir, 'injected.mjs'), 'export default 3;');
  assert.deepEqual(verifyInventory(dir, records), ['injected.mjs']);
});
