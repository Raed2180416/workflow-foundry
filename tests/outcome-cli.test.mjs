import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, unlinkSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { digest } from '../src/data.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const cli = path.join(root, 'bin/foundry.mjs');
const task = 'Write record.json containing exactly input.record, preserving every key and value.';
const input = { record: { label: 'requested', active: true, count: 3 } };
const wrong = { label: 'wrong', active: false, count: 0 };
const sha = value => createHash('sha256').update(value).digest('hex');

function workflow({ version = 1, correct = false, artifactName = 'record.json' } = {}) {
  return {
    schemaVersion: '1.0', id: 'outcome-cli-control', version, title: 'Supplied CLI development control', goal: task, domain: 'software',
    envelope: { assumptions: ['A local JSON artifact is sufficient.'], risks: ['A file may contain incorrect data.'],
      successCriteria: [task], unsupported: ['General intent inference and external effects'] },
    inputSchema: { type: 'object', required: ['record'], properties: { record: { type: 'object' } }, additionalProperties: false },
    budget: { maxSteps: 5, maxConcurrency: 1, maxDurationMs: 10000, maxCost: 0 },
    nodes: [
      { id: 'encode', kind: 'task', needs: [], description: 'Serialize the record.', tool: 'core.json',
        args: { value: correct ? { $ref: 'input.record' } : wrong }, timeoutMs: 1000, retry: { maxAttempts: 1 } },
      { id: 'file', kind: 'task', needs: ['encode'], description: 'Write the run artifact.', tool: 'core.artifact',
        args: { name: artifactName, content: { $ref: 'nodes.encode.text' } }, timeoutMs: 1000, retry: { maxAttempts: 1 } }
    ], acceptance: [{ op: 'exists', value: { $ref: 'nodes.file.sha256' } }]
  };
}

function harness(t) {
  const evidenceRoot = process.env.FOUNDRY_OUTCOME_CLI_EVIDENCE;
  if (evidenceRoot) mkdirSync(evidenceRoot, { recursive: true });
  const workspace = mkdtempSync(path.join(evidenceRoot ?? tmpdir(), 'foundry-outcome-cli-'));
  const steps = [], env = { PATH: '/usr/bin:/bin', HOME: workspace, NODE_NO_WARNINGS: '1' };
  const save = (name, value) => {
    const file = path.join(workspace, name);
    writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    return file;
  };
  t.after(() => {
    if (evidenceRoot) save('CLI-TRANSCRIPT.json', { test: t.name, qualification: 'Supplied offline subprocess development controls; zero live model calls.', steps });
    else rmSync(workspace, { recursive: true, force: true });
  });
  const invoke = (args, { expectedStatus = 0, errorCode, preload, raw = false } = {}) => {
    const argv = [...(preload ? ['--import', preload] : []), cli, ...args, '--workspace', workspace];
    const result = spawnSync(process.execPath, argv, { cwd: root, env, encoding: 'utf8', timeout: 15000, maxBuffer: 2 * 1024 * 1024 });
    steps.push({ argv, exitCode: result.status, signal: result.signal, error: result.error?.message ?? null,
      stdout: result.stdout, stderr: result.stderr, stdoutSha256: sha(result.stdout ?? ''), stderrSha256: sha(result.stderr ?? '') });
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.signal, null);
    assert.equal(result.status, expectedStatus, `${args[0]}: ${result.stderr}\n${result.stdout}`);
    if (errorCode) assert.equal(JSON.parse(result.stderr).error.code, errorCode);
    if (raw) return result;
    return result.stdout.trim() ? JSON.parse(result.stdout) : null;
  };
  const database = read => {
    const db = new DatabaseSync(path.join(workspace, '.foundry/foundry.sqlite'), { readOnly: true });
    try { return read(db); } finally { db.close(); }
  };
  return { workspace, env, save, invoke, database,
    ok: (args, options) => invoke(args, options),
    refuse: (args, errorCode, options) => invoke(args, { ...options, expectedStatus: 1, errorCode }),
    counts: () => database(db => Object.fromEntries(['requests', 'proposals', 'runs', 'generation_jobs'].map(table =>
      [table, db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n]))),
    artifact: (runId, name = 'record.json') => path.join(workspace, '.foundry/artifacts', runId, name)
  };
}

function setup(t, { correct = false, artifactName = 'record.json', observe = true } = {}) {
  const h = harness(t);
  h.inputFile = h.save('input.json', input);
  h.expectedFile = h.save('expected.json', input.record);
  h.first = workflow({ correct, artifactName });
  h.firstFile = h.save('initial.json', h.first);
  h.nextFile = h.save('candidate-v2.json', { workflow: workflow({ version: 2, correct: true }), rationale: 'Supplied localized development repair.' });
  h.request = h.ok(['request', '--text', task]);
  h.contractArgs = ['outcome-contract', '--request', h.request.id, '--input', h.inputFile,
    '--artifact-name', 'record.json', '--expected', h.expectedFile, '--evaluator-id', 'host-cli-json-development-v1'];
  h.contract = h.ok(h.contractArgs);
  h.proposal = h.ok(['propose', h.firstFile, '--request', h.request.id, '--rationale', 'Supplied initial control.']);
  h.ok(['apply', h.proposal.id]);
  h.run = h.ok(['run', h.first.id, '--input', h.inputFile]);
  assert.equal(h.run.status, 'succeeded');
  h.observeArgs = ['outcome-observe', h.run.id, '--request', h.request.id, '--proposal', h.proposal.id, '--contract', h.contract.id];
  h.repairArgs = receipt => ['outcome-repair-request', '--receipt', receipt.id, '--request', h.request.id,
    '--run', h.run.id, '--expected-hash', h.proposal.workflowHash];
  h.observation = observe ? h.ok(h.observeArgs) : null;
  h.repair = () => h.ok(h.repairArgs(h.observation));
  return h;
}

function advanceOrdinarily(h) {
  const request = h.ok(['request', '--workflow', h.first.id, '--expected-hash', h.proposal.workflowHash, '--text', 'Explicit competing user revision.']);
  const proposal = h.ok(['propose', h.nextFile, '--request', request.id]);
  return h.ok(['apply', proposal.id]);
}

// Node's test preload replaces only provider modules. The real CLI, generator,
// coordinator, Store, validator and runtime execute unchanged. No public mock flag.
function offlineProvider(h, candidateFile = h.nextFile, { damageArtifact = false } = {}) {
  const providerPaths = Object.fromEntries([
    ['opencode-free.mjs', 'OpenCodeFreeProvider'], ['opencode-v2-free.mjs', 'OpenCodeV2FreeProvider']
  ].map(([file, name]) => [new URL(`../src/${file}`, import.meta.url).href, name]));
  const callsFile = path.join(h.workspace, 'offline-provider-calls.jsonl');
  const providerSources = Object.fromEntries(Object.entries(providerPaths).map(([url, name]) => [url, `
import { readFileSync, appendFileSync, writeFileSync } from 'node:fs';
export class ${name} {
  constructor({ model }) { this.identity = { provider: 'supplied-offline-cli-control', model }; }
  async generate({ prompt }) {
    appendFileSync(${JSON.stringify(callsFile)}, JSON.stringify({ prompt }) + '\\n');
    ${damageArtifact ? `writeFileSync(${JSON.stringify(h.artifact(h.run.id))}, '{}');` : ''}
    return { text: readFileSync(${JSON.stringify(candidateFile)}, 'utf8') };
  }
}
`]));
  const source = `
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import child from 'node:child_process';
const blocked = () => { throw new Error('Offline CLI test forbids network and child-provider dispatch'); };
globalThis.fetch = blocked;
net.Socket.prototype.connect = blocked;
http.request = http.get = https.request = https.get = blocked;
for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) child[name] = blocked;
syncBuiltinESMExports();
const providers = ${JSON.stringify(providerSources)};
registerHooks({ load(url, context, next) {
  if (!Object.hasOwn(providers, url)) return next(url, context);
  return { format: 'module', shortCircuit: true, source: providers[url] };
} });
`;
  const preload = path.join(h.workspace, 'offline-provider.mjs');
  writeFileSync(preload, source, { flag: 'wx', mode: 0o600 });
  return { preload, callsFile };
}

test('CLI performs green-but-wrong -> observed repair -> v2 apply/run -> satisfied and retains original bytes', t => {
  const h = setup(t), original = readFileSync(h.artifact(h.run.id));
  assert.deepEqual(JSON.parse(original), wrong);
  assert.equal(h.observation.outcome, 'unsatisfied');
  assert.equal(h.observation.reason, 'json-content-mismatch');
  assert.equal(h.observation.artifact.sha256, sha(original));
  assert.equal(h.observation.binding.workflowHash, h.proposal.workflowHash);
  h.refuse(['repair-request', '--request', h.request.id, '--failed-run', h.run.id, '--expected-hash', h.proposal.workflowHash], 'REPAIR_RUN_STATE');
  assert.equal(h.ok(h.observeArgs).id, h.observation.id);
  const repair = h.repair();
  assert.equal(h.repair().id, repair.id); assert.equal(h.repair().reused, true);
  assert.equal(repair.parentRequestId, h.request.id); assert.equal(repair.rootRequestId, h.request.id);
  assert.equal(repair.text, task); assert.equal(repair.observedRunStatus, 'succeeded');
  assert.equal(Object.hasOwn(repair, 'failedRunId'), false); assert.equal(repair.automaticGeneration, false);
  const context = h.ok(['outcome-context', '--request', repair.id, '--no-skills']);
  assert.equal(context.task, task); assert.equal(context.currentWorkflow.version, 1);
  assert.equal(context.baseHash, h.proposal.workflowHash); assert.equal(context.diagnosticRepair, null);
  assert.deepEqual(context.outcomeRepair.comparison.expected.value, input.record);
  assert.deepEqual(context.outcomeRepair.comparison.observed.value, wrong);
  assert.deepEqual(context.outcomeRepair.comparison.differences.entries.map(x => x.path), ['/active', '/count', '/label']);
  const { contextHash, ...contextBody } = context; assert.equal(contextHash, digest(contextBody));
  assert.deepEqual(h.counts(), { requests: 2, proposals: 1, runs: 1, generation_jobs: 0 });
  const next = h.ok(['outcome-propose', h.nextFile, '--request', repair.id, '--rationale', 'Explicit supplied CLI repair.']);
  assert.equal(next.rationale, 'Explicit supplied CLI repair.');
  h.ok(['outcome-apply', next.id]);
  assert.equal(h.counts().runs, 1);
  const run = h.ok(['run', h.first.id, '--input', h.inputFile]);
  const receipt = h.ok(['outcome-observe', run.id, '--request', repair.id, '--proposal', next.id, '--contract', h.contract.id]);
  assert.equal(run.status, 'succeeded'); assert.equal(receipt.outcome, 'satisfied');
  assert.equal(receipt.binding.workflowVersion, 2); assert.equal(receipt.binding.contractId, undefined);
  assert.equal(receipt.contractId, h.contract.id);
  assert.deepEqual(JSON.parse(readFileSync(h.artifact(run.id))), input.record);
  assert.deepEqual(readFileSync(h.artifact(h.run.id)), original);
  assert.deepEqual(h.ok(['inspect', h.run.id]), h.run);
  assert.equal(h.ok(h.contractArgs.map(value => value === h.request.id ? repair.id : value)).id, h.contract.id);
  h.refuse(['outcome-repair-request', '--receipt', receipt.id, '--request', repair.id, '--run', run.id, '--expected-hash', next.workflowHash], 'OUTCOME_NOT_UNSATISFIED');
  assert.equal(h.counts().generation_jobs, 0);
  h.save('TRAJECTORY.json', { initial: h.observation, repairRequest: repair, appliedProposal: next.id, final: receipt,
    originalBytesRetained: true, suppliedCandidate: true, liveModelCalls: 0 });
});

test('CLI distinguishes confirmed required-file absence from loss of recorded producer bytes', async t => {
  await t.test('wrong filename supports explicit repair', t => {
    const h = setup(t, { correct: true, artifactName: 'different.json' });
    const original = readFileSync(h.artifact(h.run.id, 'different.json'));
    assert.equal(h.observation.outcome, 'unsatisfied'); assert.equal(h.observation.reason, 'required-artifact-absent');
    const repair = h.repair(), context = h.ok(['outcome-context', '--request', repair.id, '--no-skills']);
    assert.equal(context.outcomeRepair.comparison.observed.state, 'absent');
    const proposal = h.ok(['outcome-propose', h.nextFile, '--request', repair.id]);
    h.ok(['outcome-apply', proposal.id]);
    const run = h.ok(['run', h.first.id, '--input', h.inputFile]);
    assert.equal(h.ok(['outcome-observe', run.id, '--request', repair.id, '--proposal', proposal.id, '--contract', h.contract.id]).outcome, 'satisfied');
    assert.deepEqual(readFileSync(h.artifact(h.run.id, 'different.json')), original);
  });
  await t.test('missing recorded bytes remain unknown and do not open repair', t => {
    const h = setup(t, { observe: false });
    unlinkSync(h.artifact(h.run.id));
    const receipt = h.ok(h.observeArgs);
    assert.equal(receipt.outcome, 'unknown'); assert.equal(receipt.reason, 'recorded-artifact-missing');
    assert.equal(h.ok(h.observeArgs).id, receipt.id);
    h.refuse(h.repairArgs(receipt), 'OUTCOME_NOT_UNSATISFIED');
    assert.deepEqual(h.counts(), { requests: 1, proposals: 1, runs: 1, generation_jobs: 0 });
  });
});

test('CLI rejects stale repair creation and stale context/proposal/apply after a competing ordinary revision', async t => {
  await t.test('repair creation', t => {
    const h = setup(t); advanceOrdinarily(h);
    h.refuse(h.repairArgs(h.observation), 'STALE_WORKFLOW');
    assert.equal(h.counts().generation_jobs, 0);
  });
  await t.test('existing repair and pending proposal', t => {
    const h = setup(t), repair = h.repair();
    const pending = h.ok(['outcome-propose', h.nextFile, '--request', repair.id]);
    const current = advanceOrdinarily(h);
    h.refuse(['outcome-context', '--request', repair.id], 'STALE_WORKFLOW');
    h.refuse(['outcome-propose', h.nextFile, '--request', repair.id], 'STALE_WORKFLOW');
    h.refuse(['outcome-apply', pending.id], 'STALE_WORKFLOW');
    assert.equal(h.ok(['state']).workflows[0].hash, current.hash);
  });
});

test('CLI refuses tampered artifact evidence at observe, repair, context, propose and apply', t => {
  const h = setup(t), original = readFileSync(h.artifact(h.run.id)), repair = h.repair();
  const pending = h.ok(['outcome-propose', h.nextFile, '--request', repair.id]);
  writeFileSync(h.artifact(h.run.id), JSON.stringify(input.record));
  h.refuse(h.observeArgs, 'OUTCOME_EVIDENCE');
  h.refuse(h.repairArgs(h.observation), 'OUTCOME_EVIDENCE');
  h.refuse(['outcome-context', '--request', repair.id], 'OUTCOME_EVIDENCE');
  h.refuse(['outcome-propose', h.nextFile, '--request', repair.id], 'OUTCOME_EVIDENCE');
  h.refuse(['outcome-apply', pending.id], 'OUTCOME_EVIDENCE');
  h.refuse(['apply', pending.id], 'OUTCOME_CLI_ROUTE');
  h.refuse(['propose', h.nextFile, '--request', repair.id], 'OUTCOME_CLI_ROUTE');
  h.refuse(['prompt', '--request', repair.id], 'OUTCOME_CLI_ROUTE');
  h.refuse(['generate', '--request', repair.id], 'OUTCOME_CLI_ROUTE');
  const saved = h.database(db => JSON.parse(db.prepare('SELECT body FROM outcome_observations WHERE id=?').get(h.observation.id).body));
  assert.deepEqual(Buffer.from(saved.artifact.base64, 'base64'), original);
  assert.equal(h.ok(['state']).workflows[0].hash, h.proposal.workflowHash);
  assert.equal(h.counts().generation_jobs, 0);
});

test('CLI rejects cross-run receipts, frozen expectation changes and goal/success-criteria drift', t => {
  const h = setup(t), otherRun = h.ok(['run', h.first.id, '--input', h.inputFile]);
  h.refuse(h.repairArgs(h.observation).map(value => value === h.run.id ? otherRun.id : value), 'OUTCOME_LINK');
  h.refuse(h.contractArgs.map(value => value === h.expectedFile ? JSON.stringify(wrong) : value), 'OUTCOME_CONTRACT_CONFLICT');
  const repair = h.repair();
  for (const field of ['goal', 'successCriteria']) {
    const candidate = workflow({ version: 2, correct: true });
    if (field === 'goal') candidate.goal = 'Replace the task.';
    else candidate.envelope.successCriteria = ['A file exists.'];
    const file = h.save(`drift-${field}.json`, candidate);
    h.refuse(['outcome-propose', file, '--request', repair.id, '--rationale', 'Adversarial changed intent.'], 'REPAIR_INTENT');
  }
  assert.equal(h.counts().proposals, 1); assert.equal(h.counts().generation_jobs, 0);
});

test('CLI ordinary propose/apply still accepts explicit user revisions and creates no outcome ledger', t => {
  const h = harness(t), first = workflow();
  const file = h.save('ordinary-v1.json', first), request = h.ok(['request', '--text', task]);
  const proposal = h.ok(['propose', file, '--request', request.id, '--rationale', 'Ordinary initial proposal.']);
  h.ok(['apply', proposal.id]);
  const nextRequest = h.ok(['request', '--workflow', first.id, '--expected-hash', proposal.workflowHash, '--text', 'Explicitly change the objective.']);
  const changed = workflow({ version: 2, correct: true });
  changed.goal = 'A user-directed new goal'; changed.envelope.successCriteria = ['A user-directed new criterion'];
  const nextFile = h.save('ordinary-v2.json', { workflow: changed, rationale: 'Explicit user revision.' });
  const next = h.ok(['propose', nextFile, '--request', nextRequest.id]);
  assert.equal(h.ok(['apply', next.id]).workflow.goal, changed.goal);
  assert.deepEqual(h.database(db => db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'outcome_%'").all()), []);
});

test('CLI outcome entry points require coordinator-created requests and cannot treat an ordinary proposal as a repair', t => {
  const h = setup(t);
  h.refuse(['outcome-context', '--request', h.request.id], 'OUTCOME_REPAIR');
  h.refuse(['outcome-propose', h.nextFile, '--request', h.request.id], 'OUTCOME_REPAIR');
  h.refuse(['outcome-apply', h.proposal.id], 'OUTCOME_REPAIR');
  assert.equal(h.counts().generation_jobs, 0);
});

test('CLI outcome argument validation prevents implicit input, provider setup, mixed task and service dispatch', t => {
  const h = harness(t);
  const bad = [
    ['outcome-contract', '--request', 'r', '--artifact-name', 'record.json', '--expected', '{}', '--evaluator-id', 'host'],
    ['outcome-contract', '--request', 'r', '--input', '{}', '--artifact-name', 'record.json', '--evaluator-id', 'host'],
    ['outcome-observe', '--request', 'r', '--proposal', 'p', '--contract', 'c'],
    ['outcome-apply', 'p', '--auto-apply'],
    ['generate', '--outcome-repair', '--task', 'A replacement task'],
    ['generate', '--outcome-repair', '--request', 'r', '--text', 'A replacement task'],
    ['generate', '--outcome-repair', '--request', 'r', '--workflow', 'other'],
    ['generate', '--outcome-repair', '--request', 'r', '--auto-apply'],
    ['serve', '--outcome-repair', '--request', 'r'],
    ['apply', 'p', '--outcome-repair']
  ];
  for (const command of ['outcome-contract', 'outcome-observe', 'outcome-repair-request', 'outcome-context', 'outcome-propose', 'outcome-apply']) {
    bad.push([command, '--agent', 'opencode-v2-free', '--model', 'opencode/big-pickle']);
  }
  for (const args of bad) h.refuse(args, 'OUTCOME_CLI_ARGUMENT');
  assert.equal(existsSync(path.join(h.workspace, '.foundry')), false);
  const help = h.ok(['--help'], { raw: true }).stdout;
  assert.match(help, /generate --outcome-repair --request/);
  assert.match(help, /--agent opencode-v2-free --model opencode\/big-pickle/);
});

test('CLI contract accepts explicitly supplied null and preserves the default repair depth bound', t => {
  const h = setup(t);
  h.refuse([...h.repairArgs(h.observation), '--max-depth', '0'], 'REPAIR_BUDGET');
  h.refuse([...h.repairArgs(h.observation), '--max-depth', 'invalid'], 'REPAIR_BUDGET');
  assert.equal(h.counts().requests, 1);
  const request = h.ok(['request', '--text', 'Write JSON null.']);
  const contract = h.ok(['outcome-contract', '--request', request.id, '--input', '{}', '--artifact-name', 'null.json', '--expected', 'null', '--evaluator-id', 'explicit-null-control']);
  assert.equal(contract.expected, null);
  assert.match(contract.provenance, /does not establish independent correctness/);
});

test('CLI generate --outcome-repair uses the real generator and facade with isolated supplied provider doubles', async t => {
  for (const agent of ['opencode-free', 'opencode-v2-free']) {
    await t.test(agent, t => {
      const h = setup(t), repair = h.repair(), provider = offlineProvider(h);
      assert.equal(existsSync(provider.callsFile), false);
      const job = h.ok(['generate', '--outcome-repair', '--request', repair.id, '--agent', agent, '--model', 'opencode/big-pickle', '--rounds', '1'], provider);
      assert.equal(job.status, 'proposed'); assert.equal(job.provider.provider, 'supplied-offline-cli-control');
      const calls = readFileSync(provider.callsFile, 'utf8').trim().split('\n').map(line => JSON.parse(line));
      assert.equal(calls.length, 1);
      const context = JSON.parse(readFileSync(path.join(h.workspace, '.foundry/generation', job.id, 'context.json')));
      assert.deepEqual(context.outcomeRepair.comparison.expected.value, input.record);
      assert.deepEqual(context.outcomeRepair.comparison.observed.value, wrong);
      assert.equal(context.outcomeRepair.observedRunStatus, 'succeeded');
      assert.match(calls[0].prompt, /"outcomeRepair"/);
      assert.equal(h.counts().runs, 1); assert.equal(h.ok(['state']).workflows[0].hash, h.proposal.workflowHash);
      h.ok(['outcome-apply', job.proposalId]);
      assert.equal(h.counts().runs, 1);
    });
  }
});

test('CLI outcome generation refuses stale context before provider dispatch and rechecks changed evidence before proposal', async t => {
  await t.test('stale before dispatch', t => {
    const h = setup(t), repair = h.repair(), provider = offlineProvider(h);
    advanceOrdinarily(h);
    h.refuse(['generate', '--outcome-repair', '--request', repair.id, '--agent', 'opencode-v2-free', '--model', 'opencode/big-pickle'], 'STALE_WORKFLOW', provider);
    assert.equal(existsSync(provider.callsFile), false); assert.equal(h.counts().generation_jobs, 0);
  });
  await t.test('evidence changes during supplied callback', t => {
    const h = setup(t), repair = h.repair(), provider = offlineProvider(h, h.nextFile, { damageArtifact: true });
    const job = h.invoke(['generate', '--outcome-repair', '--request', repair.id, '--agent', 'opencode-v2-free', '--model', 'opencode/big-pickle', '--rounds', '1'],
      { ...provider, expectedStatus: 1 });
    assert.equal(job.status, 'failed'); assert.equal(job.error.code, 'OUTCOME_EVIDENCE');
    assert.equal(h.counts().proposals, 1); assert.equal(h.counts().runs, 1);
    assert.equal(h.ok(['state']).workflows[0].hash, h.proposal.workflowHash);
  });
});

test('CLI uses the immutable repair ledger to prevent ordinary-route bypass after request markers are removed', t => {
  const h = setup(t), repair = h.repair();
  const db = new DatabaseSync(path.join(h.workspace, '.foundry/foundry.sqlite'));
  try {
    const body = JSON.parse(db.prepare('SELECT body FROM requests WHERE id=?').get(repair.id).body);
    delete body.repairCause; delete body.outcomeReceiptId;
    db.prepare('UPDATE requests SET body=? WHERE id=?').run(JSON.stringify(body), repair.id);
  } finally { db.close(); }
  h.refuse(['propose', h.nextFile, '--request', repair.id], 'OUTCOME_CLI_ROUTE');
  h.refuse(['prompt', '--request', repair.id], 'OUTCOME_CLI_ROUTE');
  h.refuse(['generate', '--request', repair.id], 'OUTCOME_CLI_ROUTE');
  h.refuse(['outcome-context', '--request', repair.id], 'OUTCOME_EVIDENCE');
  assert.equal(h.counts().proposals, 1); assert.equal(h.counts().generation_jobs, 0);
});

test('documented offline shell example executes the supplied repair and retains both artifact versions', t => {
  const h = harness(t);
  const text = readFileSync(path.join(root, 'docs/OUTCOME-REPAIR.md'), 'utf8');
  const script = text.match(/```bash\n([\s\S]*?)\n```/)?.[1];
  assert.ok(script, 'The runnable offline example is present.');
  // The documented example invokes `node` by name. The harness PATH is the
  // minimal /usr/bin:/bin, so prepend the directory of the Node running this
  // test (e.g. a non-system Node 24) instead of depending on a system node.
  const shellPath = [path.dirname(process.execPath), h.env.PATH].join(path.delimiter);
  const result = spawnSync('/bin/bash', ['-s'], { input: script, cwd: root, env: { ...h.env, PATH: shellPath, TMPDIR: h.workspace },
    // A correctness check, not a speed one: the example takes about 36 s at load 32 on a shared 4-CPU host (2026-11-04),
    // where the earlier 15 s limit failed it while it succeeded.
    encoding: 'utf8', timeout: 180000, maxBuffer: 2 * 1024 * 1024 });
  h.save('DOCUMENTATION-RUN.json', { exitCode: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr });
  assert.equal(result.error, undefined); assert.equal(result.status, 0, result.stderr);
  const directory = result.stdout.match(/Evidence directory: (.+)/)?.[1];
  assert.ok(directory?.startsWith(`${h.workspace}${path.sep}`));
  const first = JSON.parse(readFileSync(path.join(directory, 'observed-v1.json')));
  const second = JSON.parse(readFileSync(path.join(directory, 'observed-v2.json')));
  assert.equal(first.binding.runStatus, 'succeeded'); assert.equal(first.outcome, 'unsatisfied');
  assert.equal(second.binding.runStatus, 'succeeded'); assert.equal(second.outcome, 'satisfied');
  assert.equal(first.contractId, second.contractId);
  for (const receipt of [first, second]) {
    const bytes = readFileSync(path.join(directory, '.foundry/artifacts', receipt.binding.runId, receipt.artifact.name));
    assert.equal(sha(bytes), receipt.artifact.sha256);
  }
});
