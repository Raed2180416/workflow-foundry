import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync, copyFileSync, existsSync, lstatSync } from 'node:fs';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// Explicit offline protocol qualification, using hand-authored neutral controls.
// FOUNDRY_MCP_REPAIR_AUDIT=1 node --test tests/mcp-repair-lifecycle-audit.test.mjs
// No provider, model, TUI, upstream installer, global settings or historical edits.
const enabled = process.env.FOUNDRY_MCP_REPAIR_AUDIT === '1';
const root = path.resolve(import.meta.dirname, '..');
const hashBytes = data => createHash('sha256').update(data).digest('hex');
const canonical = item => JSON.stringify((function ordered(value) {
  return Array.isArray(value) ? value.map(ordered) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value;
})(item));
const digest = item => hashBytes(canonical(item));
const json = item => JSON.stringify(item, null, 2) + '\n';
const write = (file, value) => { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, value, { flag: 'wx', mode: 0o600 }); };
const ref = $ref => ({ $ref });
const eq = (left, right) => ({ op: 'eq', left, right });
const task = (id, tool, args, needs = []) => ({ id, kind: 'task', needs, description: 'Neutral offline lifecycle control.', tool, args, timeoutMs: 1000, retry: { maxAttempts: 1 } });
const originalTask = 'Preserve the exact JSON object in input.record in a UTF-8 artifact record.json. Reject absent or nonobject records. Use at most 8 steps, concurrency 1, duration 5000 ms and cost 0. These requirements remain in force during diagnostic repairs.';
const sample = { record: { label: 'alpha', active: false, size: 4 } };

function workflow(id = 'AuditRecord', version = 1, broken = false) {
  return {
    schemaVersion: '1.0', id, version, title: 'Neutral record preservation control',
    goal: originalTask, domain: 'general',
    envelope: { assumptions: ['Synthetic local JSON only'], risks: ['Mixed-version evidence'], successCriteria: ['Actual artifact equals the supplied record'] },
    inputSchema: { type: 'object', required: ['record'], additionalProperties: false, properties: { record: { type: 'object' } } },
    budget: { maxSteps: 8, maxConcurrency: 1, maxDurationMs: 5000, maxCost: 0 },
    nodes: [task('echo', 'core.identity', ref('input.record')), task('encode', 'core.json', { value: ref('nodes.echo') }, ['echo']), task('file', 'core.artifact', { name: 'record.json', content: ref('nodes.encode.text') }, ['encode'])],
    acceptance: [eq(ref('nodes.echo'), broken ? { deliberateMismatch: true } : ref('input.record')), eq(ref('nodes.file.name'), 'record.json')]
  };
}

function inventory(directory, prefix = '') {
  const entries = {};
  for (const item of readdirSync(path.join(directory, prefix), { withFileTypes: true })) {
    const relative = path.posix.join(prefix, item.name), file = path.join(directory, relative);
    if (item.isSymbolicLink()) { entries[relative] = { symlink: true }; continue; }
    if (item.isDirectory()) Object.assign(entries, inventory(directory, relative));
    else if (item.isFile()) entries[relative] = hashBytes(readFileSync(file));
  }
  return entries;
}
function sourceFiles() {
  return [
    ...Object.keys(inventory(path.join(root, 'src'))).map(name => `src/${name}`),
    ...Object.keys(inventory(path.join(root, 'skills'))).map(name => `skills/${name}`),
    'bin/foundry.mjs', 'schemas/workflow.schema.json', 'package.json', 'package-lock.json',
    'tests/mcp-repair-lifecycle-audit.test.mjs'
  ].filter(name => lstatSync(path.join(root, name)).isFile()).sort();
}
function historicalHashes() {
  const names = [
    ...['mcp-typed-r1-20260913', 'mcp-typed-r2-20260913', 'mcp-typed-r3-20260913'].flatMap(id => ['typed-score.json', 'session-export-local.stdout.txt'].map(name => `evals/runs/${id}/${name}`)),
    'evals/runs/mcp-typed-r1-20260913/partial-independent-mcp.json',
    ...['mcp-installed-v2-20260913', 'mcp-retry-20260913'].flatMap(id => ['mcp-integration-score.json', 'session-export-local.stdout.txt'].map(name => `evals/runs/${id}/${name}`))
  ];
  return Object.fromEntries(names.filter(name => existsSync(path.join(root, name))).map(name => [name, hashBytes(readFileSync(path.join(root, name)))]));
}
function state(workspace) {
  const db = new DatabaseSync(path.join(workspace, '.foundry/foundry.sqlite'), { readOnly: true });
  try {
    const records = table => db.prepare(`SELECT body FROM ${table} ORDER BY rowid`).all().map(row => JSON.parse(row.body));
    return { heads: db.prepare('SELECT * FROM heads ORDER BY id').all().map(row => ({ ...row })), workflows: records('workflows'), runs: records('runs'), requests: records('requests'), proposals: records('proposals'), qualifications: records('qualifications'), jobs: records('generation_jobs') };
  } finally { db.close(); }
}
function verifyEvents(run) {
  assert.ok(Array.isArray(run.events) && run.events.length > 0, 'Actual persisted events are required');
  let previousHash = null;
  for (const [index, event] of run.events.entries()) {
    const { hash, ...body } = event;
    assert.equal(event.seq, index + 1); assert.equal(event.previousHash, previousHash); assert.equal(hash, digest(body)); previousHash = hash;
  }
  assert.deepEqual(run.eventHead, { seq: run.events.length, hash: previousHash });
}

test('offline MCP draft and diagnostic repair lifecycle through actual stdio', { skip: !enabled, timeout: 120000 }, async t => {
  assert.equal(process.platform, 'linux', 'This opt-in audit requires Linux bubblewrap');
  assert.ok(existsSync('/usr/bin/bwrap'), 'Networking-disabled actual subprocess controls require bubblewrap');
  const evidenceRoot = path.join(root, '.foundry/verification'); mkdirSync(evidenceRoot, { recursive: true });
  const evidence = mkdtempSync(path.join(evidenceRoot, 'mcp-repair-lifecycle-audit-'));
  const snapshot = path.join(evidence, 'snapshot'), cases = [], calls = [], processes = [], clients = new Set();
  const sourceBefore = Object.fromEntries(sourceFiles().map(name => [name, hashBytes(readFileSync(path.join(root, name)))]));
  const dependenciesBefore = digest(inventory(path.join(root, 'node_modules'))), historyBefore = historicalHashes();
  for (const name of Object.keys(sourceBefore)) { mkdirSync(path.dirname(path.join(snapshot, name)), { recursive: true }); copyFileSync(path.join(root, name), path.join(snapshot, name)); }
  mkdirSync(path.join(snapshot, 'node_modules'));
  write(path.join(evidence, 'source-before.json'), json({ at: new Date().toISOString(), files: sourceBefore, dependencies: dependenciesBefore, historicalReceipts: historyBefore, nodeVersion: process.version, modelCalls: 0 }));
  t.diagnostic(`Preserved offline receipt directory: ${evidence}`);

  const sandbox = (workspace, command) => ['--die-with-parent', '--new-session', '--unshare-all', '--cap-drop', 'ALL', '--ro-bind', '/usr', '/usr', '--symlink', 'usr/bin', '/bin', '--symlink', 'usr/lib', '/lib', '--symlink', 'usr/lib', '/lib64', '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp', '--ro-bind', snapshot, '/server', '--ro-bind', path.join(root, 'node_modules'), '/server/node_modules', '--bind', workspace, '/task', '--chdir', '/task', ...command];
  const prefix = (workspace, command) => ['-i', 'PATH=/usr/bin:/bin', 'LANG=C.UTF-8', 'NODE_NO_WARNINGS=1', '/usr/bin/bwrap', ...sandbox(workspace, command)];
  const cli = (workspace, args) => {
    const command = ['/usr/bin/node', '/server/bin/foundry.mjs', ...args, '--workspace', '/task'];
    const result = spawnSync('/usr/bin/env', prefix(workspace, command), { encoding: 'utf8', timeout: 10000, maxBuffer: 8 * 1024 * 1024 });
    processes.push({ command, exitCode: result.status, signal: result.signal, error: result.error?.message ?? null, stdout: result.stdout, stderr: result.stderr });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    return JSON.parse(result.stdout);
  };
  const script = (workspace, code) => {
    const command = ['/usr/bin/node', '--input-type=module', '--eval', code];
    const result = spawnSync('/usr/bin/env', prefix(workspace, command), { encoding: 'utf8', timeout: 10000, maxBuffer: 8 * 1024 * 1024 });
    processes.push({ command, classification: 'offline-scripted-host-control', exitCode: result.status, signal: result.signal, error: result.error?.message ?? null, stdout: result.stdout, stderr: result.stderr });
    assert.equal(result.status, 0, result.stderr || result.error?.message); return JSON.parse(result.stdout);
  };
  const connect = async (workspace, hostMode = null) => {
    const client = new Client({ name: 'offline-lifecycle-audit', version: '1' });
    const hostCode = hostMode ? `
      import { writeFileSync } from 'node:fs';
      import { Foundry } from '/server/src/foundry.mjs';
      import { createDefaultRegistry } from '/server/src/capabilities.mjs';
      import { serveMcp } from '/server/src/mcp.mjs';
      const registry = createDefaultRegistry();
      registry.register({ name: 'audit.externalWrite', description: 'Synthetic external-effect boundary control.', version: '1', implementation: 'offline-audit-only', inputSchema: { type: 'object', additionalProperties: false }, outputSchema: { type: 'object' }, effects: 'idempotent', risk: 'low', requiresApproval: false, maxTimeoutMs: 1000, cost: 0, cancellation: 'cooperative', execute: async () => { writeFileSync('/task/external-effect-observed.txt', 'A synthetic effect executed'); return { observed: true }; } });
      const policy = ${hostMode === 'restricted' ? "{ allowedCapabilities: ['core.identity'], maxSteps: 1, maxDurationMs: 1000, maxConcurrency: 1 }" : '{}'};
      const foundry = new Foundry('/task', { registry, policy });
      const server = await serveMcp(foundry);
      const close = async () => { await server.close(); await foundry.close(); process.exit(0); };
      process.once('SIGTERM', close); process.once('SIGINT', close); process.stdin.once('end', close);
    ` : null;
    const command = hostCode ? ['/usr/bin/node', '--input-type=module', '--eval', hostCode] : ['/usr/bin/node', '/server/bin/foundry.mjs', 'mcp', '--workspace', '/task'];
    const transport = new StdioClientTransport({ command: '/usr/bin/env', args: prefix(workspace, command), env: { PATH: '/usr/bin:/bin' }, stderr: 'pipe' });
    let stderr = ''; transport.stderr?.on('data', chunk => { if (stderr.length < 200000) stderr += chunk; });
    await client.connect(transport, { timeout: 5000 });
    const handle = {
      client, workspace,
      async close() { if (!clients.has(handle)) return; await client.close(); clients.delete(handle); processes.push({ command, hostMode, workspace, closed: true, stderr }); },
      async call(name, args = {}) {
        const startedAt = new Date().toISOString();
        const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 15000 });
        const value = JSON.parse(result.content.find(item => item.type === 'text').text);
        const response = { isError: result.isError === true, value };
        calls.push({ workspace, name, arguments: args, startedAt, ...response }); return response;
      },
      async ok(name, args = {}) { const response = await handle.call(name, args); assert.equal(response.isError, false, json(response)); return response.value; },
      async rejects(name, args = {}, code) { const response = await handle.call(name, args); assert.equal(response.isError, true, json(response)); assert.ok(typeof response.value.error?.code === 'string'); if (code) assert.equal(response.value.error.code, code); return response.value; }
    };
    clients.add(handle); return handle;
  };
  const harness = async label => {
    const workspace = path.join(evidence, 'workspaces', label); mkdirSync(workspace, { recursive: true, mode: 0o700 });
    const request = cli(workspace, ['request', '--text', originalTask]);
    return { ...(await connect(workspace)), request };
  };
  const apply = async (h, w, requestId = h.request.id) => {
    const validation = await h.ok('foundry_validate', { workflow: w }); assert.equal(validation.valid, true, json(validation));
    const proposed = await h.ok('foundry_propose', { requestId, workflow: w, rationale: 'Hand-authored offline lifecycle control; no model evidence.' });
    assert.equal(proposed.workflowHash, digest(w));
    const applied = await h.ok('foundry_apply_proposal', { proposalId: proposed.id });
    assert.equal(applied.status, 'applied'); return applied;
  };
  const failedApplied = async label => {
    const h = await harness(label), w = workflow(`Record${label.replace(/[^A-Za-z0-9]/g, '')}`, 1, true);
    const proposal = await apply(h, w), run = await h.ok('foundry_run', { workflowId: w.id, input: sample });
    assert.equal(run.status, 'failed'); assert.equal(run.workflowHash, digest(w));
    const inspected = await h.ok('foundry_inspect', { runId: run.id }); verifyEvents(inspected);
    return { h, w, proposal, run, inspected, repairArgs: { requestId: h.request.id, failedRunId: run.id, expectedHash: digest(w), diagnostic: 'Observed local acceptance failure. Preserve the original task and diagnose the candidate.' } };
  };
  const control = async (name, fn) => t.test(name, async () => {
    const receipt = { name, startedAt: new Date().toISOString(), passed: false }; cases.push(receipt);
    const previousClients = new Set(clients);
    try { await fn(); receipt.passed = true; } catch (error) { receipt.error = { name: error.name, message: error.message, stack: error.stack }; throw error; }
    finally { for (const handle of [...clients]) if (!previousClients.has(handle)) await handle.close(); receipt.finishedAt = new Date().toISOString(); }
  });

  t.after(async () => {
    for (const handle of [...clients]) await handle.close();
    const sourceAfter = Object.fromEntries(sourceFiles().map(name => [name, hashBytes(readFileSync(path.join(root, name)))]));
    const dependenciesAfter = digest(inventory(path.join(root, 'node_modules'))), historyAfter = historicalHashes();
    const sourceStable = digest(sourceBefore) === digest(sourceAfter), dependencyStable = dependenciesBefore === dependenciesAfter, historyStable = digest(historyBefore) === digest(historyAfter);
    const snapshotMatchesSource = Object.entries(sourceBefore).every(([name, hash]) => hashBytes(readFileSync(path.join(snapshot, name))) === hash);
    write(path.join(evidence, 'protocol-calls.json'), json(calls)); write(path.join(evidence, 'processes.json'), json(processes));
    write(path.join(evidence, 'results.json'), json({ at: new Date().toISOString(), modelCalls: 0, classification: 'scripted-offline-actual-stdio-controls', sourceIdentity: digest(sourceBefore), dependencyIdentity: dependenciesBefore, sourceStable, dependencyStable, historyStable, snapshotMatchesSource, sourceAfter, cases, passed: cases.length > 0 && cases.every(item => item.passed) && sourceStable && dependencyStable && historyStable && snapshotMatchesSource, limitations: ['Scripted controls are not model behavior or a completed TUI campaign.', 'Project source bytes frozen; installed dependency bytes hash-checked before/after, operating system libraries not frozen.', 'Declared task preservation is checked; semantic satisfaction requires an independent host oracle.'] }));
    assert.ok(snapshotMatchesSource, 'Frozen executable source must match its declared hash inventory');
    assert.ok(sourceStable, 'Shared source changed during qualification; retain this diagnostic and repeat on a stable snapshot');
    assert.ok(dependencyStable, 'Dependency bytes changed during qualification'); assert.ok(historyStable, 'Historical TUI receipt bytes must remain unchanged');
  });

  const catalogHarness = await harness('catalog');
  const catalog = await catalogHarness.client.listTools();
  write(path.join(evidence, 'catalog.json'), json(catalog));
  const requiredNames = ['foundry_trial', 'foundry_trial_json', 'foundry_inspect_trial', 'foundry_request_repair', 'foundry_request_design', 'foundry_delivery'];
  const missing = requiredNames.filter(name => !catalog.tools.some(tool => tool.name === name));
  await control('catalog exposes explicit diagnostic APIs without task or authority override fields', async () => {
    assert.deepEqual(missing, [], 'Lifecycle APIs are absent; no implementation qualification can be claimed');
    for (const name of requiredNames) {
      const spec = catalog.tools.find(tool => tool.name === name);
      assert.equal(spec.inputSchema.additionalProperties, false);
      for (const field of ['policy', 'registry', 'approved', 'actor', 'source', 'suite', 'text', 'directory']) assert.ok(!Object.hasOwn(spec.inputSchema.properties, field), `${name} must not accept authority/task override ${field}`);
    }
    assert.equal(catalog.tools.find(tool => tool.name === 'foundry_trial').inputSchema.properties.input.type, 'object');
  });
  await catalogHarness.close();
  if (missing.length) return;

  await control('agent-relayed designs preserve provenance, version binding and excluded automatic dispatch', async () => {
    const workspace = path.join(evidence, 'workspaces/agent-design'); mkdirSync(workspace, { recursive: true, mode: 0o700 });
    const h = await connect(workspace), request = await h.ok('foundry_request_design', { task: originalTask });
    assert.equal(request.source, 'agent-request'); assert.equal(request.status, 'diagnostic'); assert.equal(request.automaticGeneration, false);
    assert.equal(request.text, originalTask); assert.equal(request.workflowId, null); assert.equal(request.baseHash, null);
    const context = await h.ok('foundry_design_context', { requestId: request.id }); assert.equal(context.task, originalTask);
    const before = state(workspace);
    for (const key of ['source', 'actor', 'approved', 'policy', 'suite']) await h.rejects('foundry_request_design', { task: originalTask, [key]: 'forged authority' }, 'SCHEMA_MISMATCH');
    assert.deepEqual(state(workspace), before);
    const w = workflow('AgentRelayed'), trial = await h.ok('foundry_trial', { requestId: request.id, workflow: w, input: sample });
    assert.equal(trial.runStatus, 'succeeded'); await apply(h, w, request.id);
    const revision = await h.ok('foundry_request_design', { task: originalTask, workflowId: w.id, expectedHash: digest(w) });
    assert.equal(revision.baseHash, digest(w)); assert.equal(revision.source, 'agent-request'); assert.equal(revision.status, 'diagnostic');
    const current = state(workspace);
    await h.rejects('foundry_request_design', { task: originalTask, workflowId: w.id, expectedHash: '0'.repeat(64) }, 'STALE_WORKFLOW');
    assert.deepEqual(state(workspace), current); await h.close();
    const probe = script(workspace, `
      import { Foundry } from '/server/src/foundry.mjs';
      import { WorkflowGenerator, startRequestProcessor } from '/server/src/generator.mjs';
      const foundry = new Foundry('/task'); let sentinelCalls = 0;
      const provider = { identity: { provider: 'offline-agent-request-sentinel', model: 'none' }, async generate() { sentinelCalls++; throw new Error('Unexpected synthetic dispatch'); } };
      const processor = startRequestProcessor(new WorkflowGenerator(foundry, provider), { intervalMs: 5, onError: () => {} });
      await new Promise(resolve => setTimeout(resolve, 40)); await processor.close();
      console.log(JSON.stringify({ sentinelCalls, realModelCalls: 0 })); await foundry.close();
    `);
    assert.equal(probe.sentinelCalls, 0); assert.deepEqual(state(workspace), current);
  });

  // Controls below use returned trial/run identities and the exact persisted state.
  // Receipt field adapters are kept explicit when the implemented API is agreed.
  await control('failed draft then changed draft at the same version preserve the pending request and main store', async () => {
    const h = await harness('drafts'), before = state(h.workspace), bad = workflow('DraftRecord', 1, true), good = workflow('DraftRecord');
    const failed = await h.ok('foundry_trial', { requestId: h.request.id, workflow: bad, input: sample });
    assert.equal(failed.workflowHash, digest(bad)); assert.equal(failed.runStatus, 'failed');
    const passed = await h.ok('foundry_trial', { requestId: h.request.id, workflow: good, input: sample });
    assert.equal(passed.workflowHash, digest(good)); assert.equal(passed.runStatus, 'succeeded');
    assert.notEqual(failed.id, passed.id);
    assert.deepEqual(state(h.workspace), before, 'Draft trials cannot create reusable versions or consume the parent request');
    const inspected = await h.ok('foundry_inspect_trial', { trialId: passed.id });
    assert.equal(inspected.workflowHash, digest(good)); verifyEvents({ ...inspected.run, events: inspected.events });
    assert.deepEqual(inspected.run.outputs.echo, sample.record);
    const files = Object.keys(inventory(h.workspace)).filter(name => name.includes(inspected.run.id) && name.endsWith('/record.json'));
    assert.equal(files.length, 1, 'A single actual trial-scoped artifact is required');
    const artifact = readFileSync(path.join(h.workspace, files[0]));
    assert.deepEqual(JSON.parse(artifact), sample.record); assert.equal(inspected.run.outputs.file.sha256, hashBytes(artifact));
    assert.equal(existsSync(path.join(h.workspace, '.foundry/artifacts')), false, 'Draft files cannot enter reusable run storage');
    assert.notEqual(inspected.taskOutcomeQualified, true); assert.notEqual(inspected.independentTaskVerified, true);
    await h.close(); const reopened = await connect(h.workspace);
    assert.deepEqual(await reopened.ok('foundry_inspect_trial', { trialId: passed.id }), inspected, 'Trial evidence must remain inspectable after server restart');
  });

  await control('draft schema rejects serialized input and caller authority/task overrides before state changes', async () => {
    const h = await harness('draft-validation'), w = workflow('StrictDraft'), before = state(h.workspace);
    const args = { requestId: h.request.id, workflow: w, input: sample };
    for (const invalid of [
      { ...args, input: JSON.stringify(sample) }, { ...args, input: null },
      { requestId: h.request.id, workflow: w },
      ...['policy', 'registry', 'approved', 'actor', 'source', 'suite', 'text', 'directory'].map(key => ({ ...args, [key]: key === 'approved' ? true : {} }))
    ]) await h.rejects('foundry_trial', invalid, 'SCHEMA_MISMATCH');
    assert.deepEqual(state(h.workspace), before);
    await h.rejects('foundry_inspect_trial', { trialId: '../outside' });
  });

  await control('explicit JSON trial transport preserves root types and records invalid input without effects', async () => {
    const h = await harness('json-trial'), before = state(h.workspace);
    for (const [index, input] of [null, false, 17, ['x', 2]].entries()) {
      const candidate = workflow(`JsonRoot${index}`);
      candidate.inputSchema = { type: input === null ? 'null' : Array.isArray(input) ? 'array' : typeof input };
      candidate.nodes = [task('echo', 'core.identity', ref('input'))]; candidate.acceptance = [eq(ref('nodes.echo'), ref('input'))];
      const trial = await h.ok('foundry_trial_json', { requestId: h.request.id, workflow: candidate, inputJson: JSON.stringify(input) });
      assert.equal(trial.runStatus, 'succeeded'); assert.deepEqual(trial.outputs.echo, input);
      const inspected = await h.ok('foundry_inspect_trial', { trialId: trial.id });
      assert.deepEqual(inspected.run.input, input); assert.equal(inspected.inputHash, digest(input));
      verifyEvents({ ...inspected.run, events: inspected.events });
    }
    for (const input of [{}, { record: [] }, { record: 'text' }]) {
      const trial = await h.ok('foundry_trial', { requestId: h.request.id, workflow: workflow('RejectedRecord'), input });
      assert.equal(trial.runStatus, 'input-rejected'); assert.equal(trial.runId, null); assert.equal(trial.steps, 0);
      assert.equal(trial.localAcceptancePassed, false); assert.equal(trial.taskOutcomeQualified, false); assert.deepEqual(trial.artifactReceipts, []);
      const inspected = await h.ok('foundry_inspect_trial', { trialId: trial.id }); assert.equal(inspected.run, null); assert.deepEqual(inspected.events, []);
    }
    const doubleEncoded = await h.ok('foundry_trial_json', { requestId: h.request.id, workflow: workflow('DoubleEncoded'), inputJson: JSON.stringify(JSON.stringify(sample)) });
    assert.equal(doubleEncoded.runStatus, 'input-rejected', 'The explicit text route must parse once, without recursive coercion');
    await h.rejects('foundry_trial_json', { requestId: h.request.id, workflow: workflow('InvalidJson'), inputJson: '{broken' }, 'INPUT_JSON');
    assert.deepEqual(state(h.workspace), before);
    assert.equal(Object.keys(inventory(h.workspace)).filter(name => name.endsWith('/record.json')).length, 0);
  });

  await control('closed trial inspection rejects changed artifact bytes and truncated events', async () => {
    const h = await harness('trial-corruption'), w = workflow('TrialIntegrity');
    const artifactTrial = await h.ok('foundry_trial', { requestId: h.request.id, workflow: w, input: sample });
    const eventTrial = await h.ok('foundry_trial', { requestId: h.request.id, workflow: w, input: sample });
    const artifactOriginal = await h.ok('foundry_inspect_trial', { trialId: artifactTrial.id });
    const eventOriginal = await h.ok('foundry_inspect_trial', { trialId: eventTrial.id });
    write(path.join(evidence, 'before-trial-corruption.json'), json({ artifactOriginal, eventOriginal }));
    const artifactFiles = Object.keys(inventory(h.workspace)).filter(name => name.includes(artifactTrial.runId) && name.endsWith('/record.json'));
    assert.equal(artifactFiles.length, 1);
    writeFileSync(path.join(h.workspace, artifactFiles[0]), '{"changed":true}', { mode: 0o600 });
    await h.rejects('foundry_inspect_trial', { trialId: artifactTrial.id }, 'TRIAL_EVIDENCE');
    assert.deepEqual(await h.ok('foundry_inspect_trial', { trialId: eventTrial.id }), eventOriginal, 'A different trial must remain intact');
    await h.close();
    const databasePaths = Object.keys(inventory(h.workspace)).filter(name => name.includes(eventTrial.id) && name.endsWith('/foundry.sqlite'));
    assert.equal(databasePaths.length, 1);
    const db = new DatabaseSync(path.join(h.workspace, databasePaths[0]));
    try { db.prepare('DELETE FROM events WHERE run_id=? AND seq=(SELECT MAX(seq) FROM events WHERE run_id=?)').run(eventTrial.runId, eventTrial.runId); }
    finally { db.close(); }
    const reopened = await connect(h.workspace);
    await reopened.rejects('foundry_inspect_trial', { trialId: eventTrial.id }, 'CORRUPT_EVENTS');
    assert.equal(state(h.workspace).requests[0].status, 'pending');
  });

  await control('per-request trial quota rejects excess work without reserving another trial or changing the request', async () => {
    const h = await harness('trial-budget'), w = workflow('BoundedTrials');
    w.nodes = [task('echo', 'core.identity', ref('input.record'))]; w.acceptance = [eq(ref('nodes.echo'), ref('input.record'))];
    const context = await h.ok('foundry_design_context', { requestId: h.request.id });
    assert.equal(context.trialPolicy.limits.maxPerRequest, 12); assert.equal(context.trialPolicy.limits.maxTotal, 200);
    const before = state(h.workspace);
    for (let ordinal = 1; ordinal <= 12; ordinal++) {
      const trial = await h.ok('foundry_trial', { requestId: h.request.id, workflow: w, input: sample });
      assert.equal(trial.ordinal, ordinal); assert.equal(trial.runStatus, 'succeeded');
    }
    await h.rejects('foundry_trial', { requestId: h.request.id, workflow: w, input: sample }, 'TRIAL_BUDGET');
    const db = new DatabaseSync(path.join(h.workspace, '.foundry/foundry.sqlite'), { readOnly: true });
    try { assert.equal(db.prepare('SELECT COUNT(*) AS n FROM trials').get().n, 12); }
    finally { db.close(); }
    assert.deepEqual(state(h.workspace), before);
  });

  await control('trial validates request identity and required next version without consuming the request', async () => {
    const h = await harness('draft-version'), w = workflow('BoundDraft');
    const saved = await h.ok('foundry_save', { workflow: w });
    const revisionRequest = cli(h.workspace, ['request', '--workflow', w.id, '--expected-hash', saved.hash, '--text', originalTask]);
    const before = state(h.workspace);
    for (const candidate of [workflow(w.id, 1), workflow(w.id, 3), workflow('DifferentIdentity', 2)]) {
      await h.rejects('foundry_trial', { requestId: revisionRequest.id, workflow: candidate, input: sample });
    }
    const valid = await h.ok('foundry_trial', { requestId: revisionRequest.id, workflow: workflow(w.id, 2), input: sample });
    assert.equal(valid.runStatus, 'succeeded'); assert.deepEqual(state(h.workspace), before);
  });

  await control('trial does not dispatch a custom external effect at top level or in a nested body', async () => {
    const h = await harness('external-trial'); await h.close(); const probe = await connect(h.workspace, 'external');
    const capabilities = await probe.ok('foundry_capabilities');
    assert.ok(capabilities.capabilities.some(item => item.name === 'audit.externalWrite'), 'The control effect must exist in the actual host registry');
    const effect = workflow('ExternalDraft'); effect.nodes = [task('external', 'audit.externalWrite', {})]; effect.acceptance = [{ op: 'exists', value: ref('nodes.external') }];
    const nested = workflow('NestedExternalDraft'); nested.nodes = [{ id: 'batch', kind: 'map', needs: [], description: 'Nested external boundary control.', items: [{}], maxItems: 1, body: { nodes: [task('external', 'audit.externalWrite', {})], acceptance: [{ op: 'exists', value: ref('nodes.external') }] } }]; nested.acceptance = [{ op: 'exists', value: ref('nodes.batch') }];
    for (const candidate of [effect, nested]) {
      const result = await probe.call('foundry_trial', { requestId: h.request.id, workflow: candidate, input: sample });
      assert.ok(result.isError || result.value.runStatus !== 'succeeded', 'An unconfigured external effect cannot qualify as a safe draft');
      assert.equal(existsSync(path.join(h.workspace, 'external-effect-observed.txt')), false, 'Isolating the database does not authorize external effects');
    }
  });

  await control('trial cannot increase existing host capability or execution budgets', async () => {
    const h = await harness('restricted-trial'); await h.close(); const probe = await connect(h.workspace, 'restricted');
    const result = await probe.call('foundry_trial', { requestId: h.request.id, workflow: workflow('RestrictedDraft'), input: sample });
    assert.ok(result.isError || result.value.runStatus !== 'succeeded');
    if (result.value.steps !== undefined) assert.ok(result.value.steps <= 1, 'Trial must retain the stricter host step budget');
    assert.equal(Object.keys(inventory(h.workspace)).filter(name => name.endsWith('/record.json')).length, 0);
  });

  await control('applied failure creates an agent diagnostic request while preserving original evidence and exact task', async () => {
    const { h, w, proposal, run, inspected, repairArgs } = await failedApplied('RepairRoot');
    const before = state(h.workspace);
    const repair = await h.ok('foundry_request_repair', repairArgs);
    assert.notEqual(repair.id, h.request.id); assert.equal(repair.baseHash, digest(w)); assert.equal(repair.workflowId, w.id);
    assert.equal(repair.text, originalTask, 'Agent diagnostic text cannot replace the original requirements');
    assert.equal(repair.source, 'agent-diagnostic');
    assert.equal(repair.status, 'diagnostic'); assert.equal(repair.parentRequestId, h.request.id); assert.equal(repair.rootRequestId, h.request.id);
    assert.equal(repair.failedRunId, run.id); assert.equal(repair.appliedProposalId, proposal.id);
    assert.deepEqual(repair.failureEventHead, inspected.eventHead); assert.deepEqual(repair.failure, run.error);
    assert.equal(repair.automaticGeneration, false); assert.equal(repair.repairDepth, 1);
    const after = state(h.workspace);
    assert.deepEqual(after.heads, before.heads); assert.deepEqual(after.workflows, before.workflows);
    assert.deepEqual(after.runs, before.runs); assert.deepEqual(after.proposals, before.proposals);
    assert.deepEqual(after.qualifications, before.qualifications); assert.deepEqual(after.jobs, before.jobs);
    assert.deepEqual(after.requests.filter(item => item.id !== repair.id), before.requests);
    assert.deepEqual(await h.ok('foundry_inspect', { runId: run.id }), inspected);
    const context = await h.ok('foundry_design_context', { requestId: repair.id });
    assert.equal(context.task, originalTask); assert.equal(context.baseHash, digest(w)); assert.equal(context.currentWorkflow.version, 1);
    const fixed = workflow(w.id, 2), trial = await h.ok('foundry_trial', { requestId: repair.id, workflow: fixed, input: sample });
    assert.equal(trial.runStatus, 'succeeded');
    const next = await apply(h, fixed, repair.id), nextRun = await h.ok('foundry_run', { workflowId: fixed.id, input: sample });
    assert.equal(nextRun.status, 'succeeded'); assert.equal(nextRun.workflowHash, next.workflowHash); assert.notEqual(next.workflowHash, proposal.workflowHash);
    const nextEvidence = await h.ok('foundry_inspect', { runId: nextRun.id }); verifyEvents(nextEvidence);
    const artifact = readFileSync(path.join(h.workspace, '.foundry/artifacts', nextRun.id, 'record.json'));
    assert.deepEqual(JSON.parse(artifact), sample.record); assert.equal(nextEvidence.outputs.file.sha256, hashBytes(artifact));
    assert.deepEqual(await h.ok('foundry_inspect', { runId: run.id }), inspected, 'Repair never rewrites the failed original run');
  });

  await control('delivery rejects mixed versions and reports host task evidence separately from linked local execution', async () => {
    const { h, w, proposal, run, repairArgs } = await failedApplied('Delivery');
    const failedDelivery = await h.ok('foundry_delivery', { requestId: h.request.id, proposalId: proposal.id, runId: run.id });
    assert.equal(failedDelivery.status, 'failed'); assert.equal(failedDelivery.localExecutionSucceeded, false);
    assert.equal(failedDelivery.independentTaskVerified, false); assert.deepEqual(failedDelivery.matchedTaskEvidence, []);
    const repair = await h.ok('foundry_request_repair', repairArgs), fixed = workflow(w.id, 2), nextProposal = await apply(h, fixed, repair.id);
    const nextRun = await h.ok('foundry_run', { workflowId: fixed.id, input: sample }); assert.equal(nextRun.status, 'succeeded');
    const args = { requestId: repair.id, proposalId: nextProposal.id, runId: nextRun.id };
    const linked = await h.ok('foundry_delivery', args);
    assert.equal(linked.workflowHash, digest(fixed)); assert.equal(linked.workflowVersion, 2); assert.equal(linked.inputHash, digest(sample));
    assert.equal(linked.localExecutionSucceeded, true); assert.equal(linked.independentTaskVerified, false); assert.deepEqual(linked.matchedTaskEvidence, []);
    await h.rejects('foundry_delivery', { requestId: h.request.id, proposalId: proposal.id, runId: nextRun.id }, 'DELIVERY_LINK');
    await h.rejects('foundry_delivery', { ...args, requestId: h.request.id }, 'DELIVERY_LINK');
    await h.rejects('foundry_delivery', { ...args, runId: run.id }, 'DELIVERY_LINK');
    await h.rejects('foundry_delivery', { ...args, workflowHash: digest(w) }, 'SCHEMA_MISMATCH');
    const suite = { schemaVersion: '1.0', id: 'offline-record-task-evidence', split: 'diagnostic', task: originalTask, envelope: ['Only the two declared synthetic record inputs'], cases: [sample, { record: { label: 'changed', active: true } }].map((input, index) => ({ id: `record-${index}`, input, expect: { statuses: ['succeeded'], checks: [], artifacts: [{ name: 'record.json', json: input.record }] } })) };
    write(path.join(h.workspace, 'host-suite.json'), json(suite));
    const evaluation = cli(h.workspace, ['evaluate', fixed.id, '--suite', '/task/host-suite.json']);
    assert.equal(evaluation.passed, true); assert.equal(evaluation.qualificationLevel, 'task-outcome');
    const withEvidence = await h.ok('foundry_delivery', args);
    assert.equal(withEvidence.independentTaskVerified, false); assert.equal(withEvidence.localExecutionSucceeded, true);
    assert.equal(withEvidence.matchedTaskEvidence.length, 1); assert.equal(withEvidence.matchedTaskEvidence[0].evaluatorId, evaluation.evaluatorId);
    assert.equal(withEvidence.matchedTaskEvidence[0].passed, true); assert.deepEqual(withEvidence.matchedTaskEvidence[0].envelope, suite.envelope);
    assert.deepEqual((await h.ok('foundry_delivery', { requestId: h.request.id, proposalId: proposal.id, runId: run.id })).matchedTaskEvidence, [], 'Evidence for the newer workflow cannot qualify an older failed version');
  });

  await control('repeated and concurrent same-failure repair requests are idempotent', async () => {
    const { h, repairArgs } = await failedApplied('DuplicateRepair');
    const peer = await connect(h.workspace);
    const [a, b] = await Promise.all([h.ok('foundry_request_repair', repairArgs), peer.ok('foundry_request_repair', repairArgs)]);
    assert.equal(a.id, b.id);
    const repeated = await h.ok('foundry_request_repair', repairArgs); assert.equal(repeated.id, a.id);
    assert.equal(state(h.workspace).requests.length, 2);
  });

  await control('diagnostic proposals retain declared goal and success criteria and enforce CAS at application', async () => {
    const { h, w, repairArgs } = await failedApplied('RepairIntent');
    const repair = await h.ok('foundry_request_repair', repairArgs), before = state(h.workspace);
    for (const field of ['goal', 'successCriteria']) {
      const changed = workflow(w.id, 2);
      if (field === 'goal') changed.goal = 'Claim success without preserving the record.';
      else changed.envelope.successCriteria = ['Only report a filename.'];
      await h.rejects('foundry_trial', { requestId: repair.id, workflow: changed, input: sample }, 'REPAIR_INTENT');
      await h.rejects('foundry_propose', { requestId: repair.id, workflow: changed, rationale: 'Untrusted proposal tries to alter requirements.' }, 'REPAIR_INTENT');
    }
    assert.deepEqual(state(h.workspace), before);
    const fixed = workflow(w.id, 2), proposal = await h.ok('foundry_propose', { requestId: repair.id, workflow: fixed, rationale: 'Repair the actual failure without changing the task.' });
    const competing = workflow(w.id, 2); competing.title = 'Concurrent legitimate saved version';
    await h.ok('foundry_save', { workflow: competing, expectedHash: digest(w) });
    const advanced = state(h.workspace);
    await h.rejects('foundry_apply_proposal', { proposalId: proposal.id }, 'STALE_WORKFLOW');
    assert.deepEqual(state(h.workspace), advanced);
  });

  await control('unchanged requirement text and successful local acceptance remain insufficient for task qualification', async () => {
    const { h, w, repairArgs } = await failedApplied('SemanticBoundary');
    const repair = await h.ok('foundry_request_repair', repairArgs), wrong = workflow(w.id, 2), constant = { unrelated: true };
    wrong.nodes[0].args = constant; wrong.acceptance[0] = eq(ref('nodes.echo'), constant);
    assert.equal(wrong.goal, w.goal); assert.deepEqual(wrong.envelope.successCriteria, w.envelope.successCriteria);
    const trial = await h.ok('foundry_trial', { requestId: repair.id, workflow: wrong, input: sample });
    assert.equal(trial.runStatus, 'succeeded'); assert.equal(trial.localAcceptancePassed, true);
    assert.equal(trial.taskOutcomeQualified, false, 'Preserved strings and self-authored checks cannot establish task success');
    const inspected = await h.ok('foundry_inspect_trial', { trialId: trial.id });
    assert.equal(inspected.taskOutcomeQualified, false); assert.equal(inspected.run.independentTaskVerified, false);
    const files = Object.keys(inventory(h.workspace)).filter(name => name.includes(trial.runId) && name.endsWith('/record.json'));
    assert.equal(files.length, 1); const bytes = readFileSync(path.join(h.workspace, files[0]));
    assert.deepEqual(JSON.parse(bytes), constant); assert.notDeepEqual(JSON.parse(bytes), sample.record, 'The independent task comparison must reject the wrong artifact');
    const proposal = await h.ok('foundry_propose', { requestId: repair.id, workflow: wrong, rationale: 'Deliberate semantic counterexample for checking qualification boundaries.' });
    assert.equal(proposal.status, 'proposed'); assert.notEqual(proposal.taskOutcomeQualified, true);
    write(path.join(evidence, 'semantic-boundary.json'), json({ modelCalls: 0, trialId: trial.id, workflowHash: digest(wrong), originalRequirementsUnchanged: true, localAcceptancePassed: true, taskOutcomeQualified: false, independentArtifactComparisonPassed: false, proposedButNotApplied: proposal.id, expected: sample.record, actual: JSON.parse(bytes), limitation: 'The API protects provenance and declared intent. A fixed host-owned evaluator is still required to gate semantic task qualification.' }));
  });

  await control('a subsequent failed diagnostic version retains the original root task and full parent lineage', async () => {
    const { h, w, run, repairArgs } = await failedApplied('RepairLineage');
    const first = await h.ok('foundry_request_repair', repairArgs);
    const revision = workflow(w.id, 2, true); revision.title = 'Second diagnostic version with preserved failure';
    const secondProposal = await apply(h, revision, first.id), secondRun = await h.ok('foundry_run', { workflowId: revision.id, input: sample });
    assert.equal(secondRun.status, 'failed');
    const second = await h.ok('foundry_request_repair', { requestId: first.id, failedRunId: secondRun.id, expectedHash: digest(revision), diagnostic: 'Preserve both failures and investigate again.' });
    assert.equal(second.rootRequestId, h.request.id); assert.equal(second.parentRequestId, first.id);
    assert.equal(second.failedRunId, secondRun.id); assert.equal(second.appliedProposalId, secondProposal.id);
    assert.equal(second.baseHash, digest(revision)); assert.equal(second.repairDepth, 2); assert.equal(second.text, originalTask);
    assert.notEqual(second.failedRunId, run.id); assert.equal(second.source, 'agent-diagnostic');
    assert.equal(state(h.workspace).requests.find(item => item.id === h.request.id).text, originalTask);
    const thirdVersion = workflow(w.id, 3, true); await apply(h, thirdVersion, second.id);
    const thirdRun = await h.ok('foundry_run', { workflowId: w.id, input: sample });
    const third = await h.ok('foundry_request_repair', { requestId: second.id, failedRunId: thirdRun.id, expectedHash: digest(thirdVersion) });
    assert.equal(third.repairDepth, 3);
    const fourthVersion = workflow(w.id, 4, true); await apply(h, fourthVersion, third.id);
    const fourthRun = await h.ok('foundry_run', { workflowId: w.id, input: sample });
    const beforeExcess = state(h.workspace);
    await h.rejects('foundry_request_repair', { requestId: third.id, failedRunId: fourthRun.id, expectedHash: digest(fourthVersion) }, 'REPAIR_BUDGET');
    assert.deepEqual(state(h.workspace), beforeExcess);
  });

  await control('repair rejects stale/cross-request/fabricated evidence and provenance overrides', async () => {
    const { h, w, repairArgs } = await failedApplied('RejectRepair');
    const unrelated = cli(h.workspace, ['request', '--text', 'An unrelated host-authored task.']);
    const before = state(h.workspace);
    const invalid = [
      { ...repairArgs, expectedHash: '0'.repeat(64) }, { ...repairArgs, failedRunId: '00000000-0000-4000-8000-000000000000' },
      { ...repairArgs, requestId: unrelated.id },
      ...['text', 'source', 'actor', 'rootRequestId', 'policy', 'suite', 'approved'].map(key => ({ ...repairArgs, [key]: key === 'approved' ? true : 'caller override' }))
    ];
    for (const args of invalid) await h.rejects('foundry_request_repair', args);
    assert.deepEqual(state(h.workspace), before);
    await h.ok('foundry_save', { workflow: workflow(w.id, 2), expectedHash: digest(w) });
    const advanced = state(h.workspace);
    await h.rejects('foundry_request_repair', repairArgs);
    assert.deepEqual(state(h.workspace), advanced, 'A new head cannot authorize repairing an obsolete failure');
  });

  await control('successful or merely paused runs are not forged into failed-run repair requests', async () => {
    const h = await harness('successful'), w = workflow('SuccessEvidence'); await apply(h, w);
    const run = await h.ok('foundry_run', { workflowId: w.id, input: sample }), before = state(h.workspace);
    assert.equal(run.status, 'succeeded');
    await h.rejects('foundry_request_repair', { requestId: h.request.id, failedRunId: run.id, expectedHash: digest(w), diagnostic: 'Pretend the successful run failed.' });
    assert.deepEqual(state(h.workspace), before);
    const paused = await harness('paused'), waiting = workflow('PausedEvidence');
    waiting.nodes = [{ id: 'question', kind: 'human', needs: [], description: 'Wait for a real human.', question: 'Choose a value.', answerSchema: { type: 'string' } }];
    waiting.acceptance = [{ op: 'exists', value: ref('nodes.question.answer') }];
    await apply(paused, waiting);
    const pausedRun = await paused.ok('foundry_run', { workflowId: waiting.id, input: sample }), pausedBefore = state(paused.workspace);
    assert.equal(pausedRun.status, 'awaiting_human');
    await paused.rejects('foundry_request_repair', { requestId: paused.request.id, failedRunId: pausedRun.id, expectedHash: digest(waiting), diagnostic: 'Treat the unanswered question as failure.' });
    assert.deepEqual(state(paused.workspace), pausedBefore);
  });

  await control('corrupted failure history cannot authorize a diagnostic repair', async () => {
    const { h, run, repairArgs } = await failedApplied('CorruptEvidence');
    await h.close();
    const db = new DatabaseSync(path.join(h.workspace, '.foundry/foundry.sqlite'));
    try { db.prepare('DELETE FROM events WHERE run_id=? AND seq=(SELECT MAX(seq) FROM events WHERE run_id=?)').run(run.id, run.id); }
    finally { db.close(); }
    const before = state(h.workspace), reopened = await connect(h.workspace);
    await reopened.rejects('foundry_request_repair', repairArgs, 'CORRUPT_EVENTS');
    assert.deepEqual(state(h.workspace), before, 'Invalid provenance must not create a repair record');
  });

  await control('agent-created diagnostic request cannot silently dispatch the automatic generator queue', async () => {
    const { h, repairArgs } = await failedApplied('NoAutomaticSpend');
    const repair = await h.ok('foundry_request_repair', repairArgs), before = state(h.workspace);
    await h.close();
    const probe = script(h.workspace, `
      import { Foundry } from '/server/src/foundry.mjs';
      import { WorkflowGenerator, startRequestProcessor } from '/server/src/generator.mjs';
      const foundry = new Foundry('/task'); let sentinelCalls = 0;
      const provider = { identity: { provider: 'offline-dispatch-sentinel', model: 'none' }, async generate() { sentinelCalls++; throw new Error('Unexpected synthetic dispatch'); } };
      const generator = new WorkflowGenerator(foundry, provider), errors = [];
      const processor = startRequestProcessor(generator, { intervalMs: 5, onError: error => errors.push(error.message) });
      await new Promise(resolve => setTimeout(resolve, 40)); await processor.close();
      console.log(JSON.stringify({ sentinelCalls, realModelCalls: 0, jobs: foundry.store.generationJobs(), request: foundry.store.request(${JSON.stringify(repair.id)}), errors }));
      await foundry.close();
    `);
    assert.equal(probe.sentinelCalls, 0, 'Creating an agent diagnostic is not permission for another model campaign');
    assert.deepEqual(probe.jobs, before.jobs); assert.deepEqual(state(h.workspace), before);
  });
});
