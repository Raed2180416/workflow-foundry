import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdirSync, readFileSync, writeFileSync, readdirSync, chmodSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Foundry } from '../../src/foundry.mjs';
import { CapabilityRegistry } from '../../src/capabilities.mjs';
import { WorkflowGenerator } from '../../src/generator.mjs';
import { OpenCodeFreeProvider } from '../../src/opencode-free.mjs';
import { runProcess } from '../../src/process.mjs';
import { digest } from '../../src/data.mjs';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '../..');
export const UPSTREAM = path.join(ROOT, 'corpus/SWE-agent--mini-swe-agent');
export const MODEL = 'opencode/ling-3.0-flash-fin-free';
export const sha = x => createHash('sha256').update(x).digest('hex');
export const json = x => JSON.stringify(x, null, 2) + '\n';
const cleanEnv = { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', PYTHONDONTWRITEBYTECODE: '1' };
export const SYSTEM = 'Repair the supplied tiny Python module. Return exactly one JSON operation per turn, without Markdown. Operations: {"op":"read"}, {"op":"write","content":"complete replacement Python module"}, {"op":"test"}, {"op":"finish"}. Only write accepts content. No other keys, paths, shell, tools or operations exist. Each response consumes one of five model calls. Test runs fixed public cases; finish submits the current module. Hidden cases independently assess correctness. Preserve the required function interface and general behavior. Use at most five calls and finish explicitly.';

export const TASKS = [
  { id: 'bucket', fn: 'bucket_count', description: 'bucket_count(count, size) takes a nonnegative integer count and positive integer size. Return the minimum integer number of buckets with capacity size needed to hold count items. Zero items need zero buckets.',
    source: 'def bucket_count(count, size):\n    return count // size\n',
    public: [{ args: [7, 3], expected: 3 }, { args: [6, 3], expected: 2 }],
    hidden: Array.from({ length: 70 }, (_, i) => { const count = i * 17 % 113; const size = i % 11 + 1; return { args: [count, size], expected: Math.ceil(count / size) }; }) },
  { id: 'last-occurrence', fn: 'retain_last', description: 'retain_last(values) takes a list of integers. Return each distinct value once, ordered by where its LAST occurrence appears in the input, from left to right. Do not mutate the input.',
    source: 'def retain_last(values):\n    return list(dict.fromkeys(values))\n',
    public: [{ args: [[1, 2, 1]], expected: [2, 1] }, { args: [[]], expected: [] }],
    hidden: Array.from({ length: 60 }, (_, i) => { const v = Array.from({ length: i % 15 }, (_, j) => (i * 3 + j * j) % 9 - 4); return { args: [v], expected: v.filter((x, j) => v.lastIndexOf(x) === j) }; }) }
];

export function initialMessages(task) {
  return [{ role: 'system', content: SYSTEM }, { role: 'user', content: json({ task: task.description, file: 'candidate.py', source: task.source, publicCases: task.public }) }];
}
export function writeNew(file, value) {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, typeof value === 'string' ? value : json(value), { flag: 'wx', mode: 0o600 });
}
function noNetworkBase() {
  return ['--die-with-parent', '--new-session', '--unshare-all', '--cap-drop', 'ALL',
    '--ro-bind', '/usr', '/usr', '--symlink', 'usr/bin', '/bin', '--symlink', 'usr/lib', '/lib', '--symlink', 'usr/lib', '/lib64',
    '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp', '--dir', '/home', '--dir', '/empty'];
}
export function candidateCommand(candidate) {
  return [...noNetworkBase(),
    '--ro-bind', candidate, '/candidate.py', '--ro-bind', path.join(HERE, 'oracle_runner.py'), '/oracle.py',
    '--chdir', '/empty', '/usr/bin/prlimit', '--cpu=2', '--as=268435456', '--fsize=1048576', '--nproc=64', '--nofile=64', '/usr/bin/python', '-I', '-B', '/oracle.py'];
}
export async function assess(candidate, task, cases, directory, name, signal) {
  let processResult, transportError = null;
  try {
    processResult = await runProcess('/usr/bin/bwrap', candidateCommand(candidate), {
      env: cleanEnv, timeoutMs: 4000, maxBytes: 65536, input: JSON.stringify({ function: task.fn, args: cases.map(x => x.args) }), signal
    });
  } catch (error) { processResult = error.processResult ?? null; transportError = { code: error.code, message: error.message }; }
  let values = null;
  if (!transportError) {
    try { const output = JSON.parse(processResult.stdout); assert.deepEqual(Object.keys(output), ['values', 'argsAfter']); assert.ok(Array.isArray(output.values)); assert.deepEqual(output.argsAfter, cases.map(x => x.args)); values = output.values; }
    catch { transportError = { code: 'ORACLE_OUTPUT', message: 'Output must be exactly the oracle JSON object' }; }
  }
  const checks = cases.map((c, i) => {
    let passed = false;
    try { assert.deepEqual(values?.[i], c.expected); passed = true; } catch {}
    return { args: c.args, expected: c.expected, actual: values?.[i] ?? null, passed };
  });
  const result = { passed: !transportError && values.length === cases.length && checks.every(x => x.passed), passedCases: checks.filter(x => x.passed).length, total: cases.length, transportError, checks, processResult };
  if (directory) writeNew(path.join(directory, `${name}.json`), result);
  return result;
}
export function parseAction(text) {
  try {
    const a = JSON.parse(text);
    assert.ok(a && typeof a === 'object' && !Array.isArray(a));
    assert.ok(['read', 'write', 'test', 'finish'].includes(a.op));
    assert.deepEqual(Object.keys(a).sort(), a.op === 'write' ? ['content', 'op'] : ['op']);
    if (a.op === 'write') assert.ok(typeof a.content === 'string' && Buffer.byteLength(a.content) <= 16384 && !a.content.includes('\0'));
    return a;
  } catch { return { op: 'invalid', error: 'Return exactly one allowed JSON operation with only its permitted keys.' }; }
}
const normalized = messages => messages.map(m => ({ role: m.role, content: m.content }));

export class Trial {
  constructor(task, directory, provider, { messages = initialMessages(task), deadline = Date.now() + 300000 } = {}) {
    this.task = task; this.directory = directory; this.provider = provider; this.deadline = deadline;
    this.deadlineSignal = AbortSignal.timeout(Math.max(1, deadline - Date.now()));
    this.messages = structuredClone(messages); this.calls = 0; this.operations = 0; this.done = false; this.pending = null;
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.candidate = path.join(directory, 'candidate.py'); writeNew(this.candidate, task.source);
    writeNew(path.join(directory, 'input.json'), { messages: this.messages });
  }
  async query(messages, signal) {
    if (this.done || this.pending || this.calls >= 5 || Date.now() >= this.deadline) throw Error('EXECUTOR_BUDGET_OR_SEQUENCE');
    assert.deepEqual(normalized(messages), normalized(this.messages), 'Native history must preserve exactly the shared conversation');
    this.calls++;
    const directory = path.join(this.directory, `call-${this.calls}`); mkdirSync(directory, { mode: 0o700 });
    const prompt = `Continue this conversation. Follow its system instructions and return the next assistant response only.\n${JSON.stringify(normalized(messages))}`;
    writeNew(path.join(directory, 'prompt.txt'), prompt);
    const response = await this.provider.generate({ prompt, directory, signal: signal ? AbortSignal.any([signal, this.deadlineSignal]) : this.deadlineSignal });
    writeNew(path.join(directory, 'response.json'), response);
    const action = parseAction(response.text);
    const message = { role: 'assistant', content: response.text, extra: { actions: [action], cost: 0 } };
    this.messages.push(message); this.pending = message;
    return { message: structuredClone(message), messages: structuredClone(this.messages) };
  }
  async act(action, signal) {
    if (!this.pending || this.done || Date.now() >= this.deadline) throw Error('ACTION_SEQUENCE');
    assert.deepEqual(action, this.pending.extra.actions[0], 'Only the actual executor-proposed action can run');
    let observation;
    if (action.op === 'read') observation = { content: readFileSync(this.candidate, 'utf8') };
    else if (action.op === 'write') { writeFileSync(this.candidate, action.content, { mode: 0o600 }); observation = { written: true, bytes: Buffer.byteLength(action.content) }; }
    else if (action.op === 'test') {
      const r = await assess(this.candidate, this.task, this.task.public, this.directory, `public-${this.operations}`, signal ? AbortSignal.any([signal, this.deadlineSignal]) : this.deadlineSignal);
      observation = { passed: r.passed, checks: r.checks, error: r.transportError };
    } else if (action.op === 'finish') { this.done = true; observation = { submitted: true }; }
    else observation = { error: action.error };
    this.operations++;
    const observationText = JSON.stringify(observation);
    this.messages.push({ role: 'user', content: observationText }); this.pending = null;
    const result = { messages: structuredClone(this.messages), done: this.done, observation, observationText };
    writeNew(path.join(this.directory, `operation-${this.operations}.json`), { action, result });
    return result;
  }
}

export function makeRegistry(getTrial) {
  const registry = new CapabilityRegistry();
  const messages = { type: 'array', maxItems: 20, items: { type: 'object' } };
  const spec = { version: '1', effects: 'non-idempotent', risk: 'low', cost: 0, requiresApproval: false, maxTimeoutMs: 180000, cancellation: 'cooperative', outputSchema: { type: 'object' } };
  registry.register({ ...spec, name: 'reference.query', description: 'Exactly one Ling executor model call; preserve provided conversation history. Returns message and messages including the new assistant message. Caller owns the loop.',
    inputSchema: { type: 'object', required: ['messages'], additionalProperties: false, properties: { messages } },
    execute: async ({ messages }, ctx) => getTrial().query(messages, ctx.signal) });
  registry.register({ ...spec, name: 'reference.act', description: 'Exactly one read/write/test/finish operation from the preceding model message, appending one observation. Returns messages, done boolean and observation. No agent loop or model call is inside this operation.',
    inputSchema: { type: 'object', required: ['message', 'messages'], additionalProperties: false, properties: { message: { type: 'object' }, messages } },
    execute: async ({ message, messages }, ctx) => {
      const trial = getTrial(); assert.deepEqual(message, trial.pending); assert.deepEqual(messages, trial.messages);
      return trial.act(message.extra.actions[0], ctx.signal);
    } });
  return registry;
}

export async function runOriginal(trial, { signal } = {}) {
  const args = [...noNetworkBase(), '--ro-bind', UPSTREAM, '/upstream', '--ro-bind', path.join(HERE, '.venv'), '/venv',
    '--ro-bind', path.join(HERE, 'original_agent.py'), '/adapter.py', '--setenv', 'MSWEA_GLOBAL_CONFIG_DIR', '/tmp/mswe-empty',
    '--setenv', 'MSWEA_SILENT_STARTUP', '1', '--chdir', '/empty', '/venv/bin/python', '-I', '-B', '/adapter.py'];
  const child = spawn('/usr/bin/bwrap', args, { env: cleanEnv, stdio: ['pipe', 'pipe', 'pipe'], detached: true });
  const stop = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} };
  const timer = setTimeout(stop, Math.max(1, Math.min(300000, trial.deadline - Date.now())));
  signal?.addEventListener('abort', stop, { once: true });
  let stderr = '', bytes = 0, result = null, failure = null;
  const raw = []; let chain = Promise.resolve();
  child.stderr.on('data', x => { bytes += x.length; stderr += x.toString(); if (bytes > 262144) stop(); });
  child.stdin.on('error', () => {});
  const lines = createInterface({ input: child.stdout });
  lines.on('line', line => {
    bytes += Buffer.byteLength(line); if (bytes > 4 * 1024 * 1024) { failure = Error('REFERENCE_OUTPUT_LIMIT'); stop(); return; }
    raw.push(line);
    chain = chain.then(async () => {
      const request = JSON.parse(line);
      if (request.method === 'result') { result = request; return; }
      let value;
      if (request.method === 'query') value = await trial.query(request.params.messages, signal);
      else if (request.method === 'act') value = await trial.act(request.params.action, signal);
      else throw Error('Unknown reference RPC method');
      child.stdin.write(JSON.stringify({ result: value }) + '\n');
    }).catch(error => { failure = error; child.stdin.write(JSON.stringify({ error: error.message }) + '\n'); });
  });
  const closed = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal })); });
  child.stdin.write(JSON.stringify({ system: SYSTEM, task: initialMessages(trial.task)[1].content }) + '\n');
  let processResult;
  try { processResult = await closed; await chain; }
  finally { clearTimeout(timer); signal?.removeEventListener('abort', stop); lines.close(); }
  const record = { ...processResult, result, error: failure?.message ?? null, stderr, args, stdout: raw.join('\n') };
  writeNew(path.join(trial.directory, 'original-agent.json'), record);
  return record;
}

const architectureTask = `Construct a generic serial bug-repair conversation workflow. Concrete tasks and solutions will only be provided AFTER architecture generation through input.messages, an array containing system and user messages. Use a native loop of at most five iterations with separate reference.query and reference.act nodes. Each iteration sends the carried messages to reference.query, then sends its message and messages to reference.act, and stops when that action returns done=true. Carry the action's returned messages into the next iteration using previous. The initial loop state must have the same structure as a completed body output, with action messages bound to input.messages. Native scheduling and stopping must remain visible. No retries, human pauses, mock results, hardcoded fixes, hidden orchestration, task-specific code or extra capabilities. Both task node retries must be maxAttempts=1. Budget maxSteps <= 20, maxConcurrency=1, maxDurationMs=300000, maxCost=0. Use schema-supported references/conditions; body acceptance should depend on observed action output availability, root acceptance on observed submission. Domain general. This is one reusable workflow; it will receive unseen synthetic Python tasks later.`;

export function architectureErrors(workflow) {
  const errors = [];
  const loops = workflow.nodes.filter(n => n.kind === 'loop');
  if (loops.length !== 1 || workflow.nodes.length !== 1) errors.push('Exactly one native root loop is required');
  const loop = loops[0];
  if (!loop || loop.maxIterations > 5 || loop.body.nodes.length !== 2) errors.push('Loop must have <=5 iterations and exactly two task nodes');
  else {
    const tools = loop.body.nodes.map(n => n.tool).sort();
    if (JSON.stringify(tools) !== JSON.stringify(['reference.act', 'reference.query'])) errors.push('Body must contain separate reference.query and reference.act tasks');
    if (loop.body.nodes.some(n => n.kind !== 'task' || n.retry.maxAttempts !== 1)) errors.push('Each body task requires one attempt');
  }
  if (workflow.budget.maxSteps > 20 || workflow.budget.maxConcurrency !== 1 || workflow.budget.maxDurationMs > 300000 || workflow.budget.maxCost !== 0) errors.push('Architecture budgets exceed protocol');
  return errors;
}

function sourcePaths() {
  const walk = (dir, prefix) => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name), `${prefix}/${e.name}`) : [`${prefix}/${e.name}`]);
  return [...walk(path.join(ROOT, 'src'), 'src'), ...walk(path.join(ROOT, 'skills'), 'skills'), 'schemas/workflow.schema.json', 'package.json', 'package-lock.json',
    ...['PROTOCOL.md', 'harness.mjs', 'original_agent.py', 'oracle_runner.py', 'requirements.txt'].map(x => `research/reference-swe/${x}`),
    ...['src/minisweagent/agents/default.py', 'src/minisweagent/__init__.py', 'src/minisweagent/exceptions.py', 'src/minisweagent/utils/log.py', 'src/minisweagent/utils/serialize.py', 'LICENSE.md'].map(x => `corpus/SWE-agent--mini-swe-agent/${x}`)];
}
export function freeze(directory) {
  const revision = spawnSync('/usr/bin/git', ['rev-parse', 'HEAD'], { cwd: UPSTREAM, env: cleanEnv, encoding: 'utf8', timeout: 5000 });
  assert.equal(revision.status, 0); assert.equal(revision.stdout.trim(), '04d809ceab9df28f9adaed044884180159172930');
  const paths = sourcePaths();
  const files = Object.fromEntries(paths.map(p => [p, sha(readFileSync(path.join(ROOT, p)))]));
  for (const p of paths) writeNew(path.join(directory, 'source', p), readFileSync(path.join(ROOT, p), 'utf8'));
  const testPath = 'tests/reference-swe-contract.test.mjs';
  files[testPath] = sha(readFileSync(path.join(ROOT, testPath)));
  writeNew(path.join(directory, 'source', testPath), readFileSync(path.join(ROOT, testPath), 'utf8'));
  const dependencies = {};
  const dependencyWalk = dir => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory() && e.name !== '__pycache__') dependencyWalk(p);
      else if (e.isFile()) dependencies[path.relative(path.join(HERE, '.venv'), p)] = sha(readFileSync(p));
    }
  };
  dependencyWalk(path.join(HERE, '.venv/lib'));
  writeNew(path.join(directory, 'dependency-files.sha256.json'), dependencies);
  writeNew(path.join(directory, 'upstream-revision.json'), revision);
  const freeze = { createdAt: new Date().toISOString(), upstream: '04d809ceab9df28f9adaed044884180159172930', model: MODEL, tasks: TASKS, architectureTask, system: SYSTEM, files,
    dependencyManifestHash: sha(json(dependencies)), limits: { tasks: 2, architectCalls: 3, executorCallsPerTaskArm: 5, taskArmMs: 300000, overallDeadline: '2026-09-13T12:06:37Z' } };
  writeNew(path.join(directory, 'freeze.json'), freeze);
  chmodSync(path.join(directory, 'freeze.json'), 0o400);
  return freeze;
}

export async function campaign(directory, { deadline = Date.parse('2026-09-13T12:06:37Z') } = {}) {
  if (Date.now() >= deadline) throw Error('CAMPAIGN_DEADLINE');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const frozen = freeze(directory);
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), deadline - Date.now());
  let activeTrial;
  const registry = makeRegistry(() => { if (!activeTrial) throw Error('NO_EXECUTION_DURING_ARCHITECTURE'); return activeTrial; });
  const foundry = new Foundry(path.join(directory, 'foundry'), { registry, policy: { maxSteps: 20, maxConcurrency: 1, maxDurationMs: 300000, maxCost: 0 } });
  const provider = new OpenCodeFreeProvider({ model: MODEL, timeoutMs: 150000 });
  const result = { protocol: 'constrained-original-defaultagent-v1', freezeHash: sha(readFileSync(path.join(directory, 'freeze.json'))), arms: [], architecture: null, limitations: ['Two diagnostic tasks; no parity inference', 'Noninteractive product bridge, no TUI evidence', 'Custom narrow tools and model formatting; upstream default configuration changed'] };
  try {
    const request = foundry.store.createRequest({ text: architectureTask });
    const evaluator = { id: 'reference-generic-structure-v1', evaluate: async ({ workflow }) => ({ evaluatorId: 'reference-generic-structure-v1', workflowHash: digest(workflow), registryHash: registry.hash(), passed: architectureErrors(workflow).length === 0, errors: architectureErrors(workflow), envelope: 'Generic loop structure only; no concrete task execution or task qualification' }) };
    const generator = new WorkflowGenerator(foundry, provider, { maxRounds: 3, maxDurationMs: Math.min(300000, Math.max(1, deadline - Date.now())), autoApply: true, evaluator });
    const job = await generator.generate(request.id, { domain: 'general', signal: controller.signal });
    result.architecture = job; writeNew(path.join(directory, 'architecture-job.json'), job);
    if (job.status !== 'applied') throw Error(`ARCHITECTURE_${job.status}`);
    const workflow = foundry.store.proposal(job.proposalId).workflow;
    writeNew(path.join(directory, 'candidate-workflow.json'), workflow);
    result.workflowHash = digest(workflow);
    for (let index = 0; index < TASKS.length; index++) {
      const task = TASKS[index];
      for (const arm of index ? ['foundry', 'reference'] : ['reference', 'foundry']) {
        if (controller.signal.aborted || Date.now() >= deadline) throw Error('CAMPAIGN_DEADLINE');
        console.log(JSON.stringify({ stage: 'arm-start', task: task.id, arm }));
        const dir = path.join(directory, `${task.id}-${arm}`);
        activeTrial = new Trial(task, dir, provider, { deadline: Math.min(deadline, Date.now() + 300000) });
        let execution;
        if (arm === 'reference') execution = await runOriginal(activeTrial, { signal: controller.signal });
        else {
          const run = foundry.createRun(workflow.id, { messages: initialMessages(task) });
          execution = await foundry.startRun(run.id, { signal: controller.signal });
          writeNew(path.join(dir, 'native-run.json'), foundry.inspectRun(run.id));
        }
        const hidden = await assess(activeTrial.candidate, task, task.hidden, dir, 'hidden', controller.signal);
        const outcome = { task: task.id, arm, calls: activeTrial.calls, operations: activeTrial.operations, submitted: activeTrial.done, hiddenPassed: hidden.passed, passedCases: hidden.passedCases, totalCases: hidden.total,
          success: activeTrial.done && hidden.passed && (arm === 'reference' ? execution.code === 0 && execution.result?.result?.exit_status === 'Submitted' && !execution.error : execution.status === 'succeeded'), runtimeStatus: arm === 'reference' ? execution.result?.result?.exit_status ?? execution.error : execution.status, candidateHash: sha(readFileSync(activeTrial.candidate)) };
        result.arms.push(outcome); writeNew(path.join(dir, 'outcome.json'), outcome);
        console.log(JSON.stringify({ stage: 'arm-result', ...outcome }));
      }
    }
  } catch (error) { result.blocker = { message: error.message, code: error.code ?? null }; }
  finally {
    clearTimeout(timer); controller.abort(); await foundry.close();
    result.finishedAt = new Date().toISOString();
    result.sourceDrift = Object.entries(frozen.files).filter(([p, hash]) => sha(readFileSync(path.join(ROOT, p))) !== hash).map(([p]) => p);
    if (result.sourceDrift.length) result.claimBlocked = 'Relevant sources changed during the campaign; inspect the exact source-bound records';
    writeNew(path.join(directory, 'result.json'), result);
    seal(directory);
  }
  return result;
}

export function seal(directory) {
  const hashes = {};
  const walk = dir => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (!e.name.startsWith('isolated-')) walk(p); }
      else if (e.isFile() && !p.endsWith('SHA256SUMS.json')) hashes[path.relative(directory, p)] = sha(readFileSync(p));
    }
  };
  walk(directory); writeNew(path.join(directory, 'SHA256SUMS.json'), hashes);
  for (const relative of Object.keys(hashes)) chmodSync(path.join(directory, relative), 0o400);
  chmodSync(path.join(directory, 'SHA256SUMS.json'), 0o400);
  return hashes;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, directory] = process.argv.slice(2);
  if (command !== 'campaign' || !directory) throw Error('Usage: node research/reference-swe/harness.mjs campaign RUN_DIRECTORY');
  console.log(json(await campaign(path.resolve(directory))));
}
