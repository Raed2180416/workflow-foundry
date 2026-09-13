import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Foundry } from '../src/foundry.mjs';
import { Store } from '../src/store.mjs';
import { CapabilityRegistry } from '../src/capabilities.mjs';
import { digest } from '../src/data.mjs';
import { toolDefinitions } from '../src/mcp.mjs';

const eq = (left, right) => ({ op: 'eq', left, right });
const ref = $ref => ({ $ref });
function workflow({ wrong = false, artifact = false } = {}) {
  const nodes = [{ id: 'echo', kind: 'task', description: 'Echo the actual input', needs: [], tool: 'core.identity', args: ref('input'), timeoutMs: 1000, retry: { maxAttempts: 1 } }];
  if (artifact) nodes.push({ id: 'write', kind: 'task', description: 'Write a local trial artifact', needs: ['echo'], tool: 'core.artifact', args: { name: 'evidence.txt', content: 'synthetic local evidence' }, timeoutMs: 1000, retry: { maxAttempts: 1 } });
  return { schemaVersion: '1.0', id: 'TrialEcho', version: 1, title: 'Version-bound trial', goal: 'Echo the actual typed input without mutation', domain: 'general',
    envelope: { assumptions: ['Local diagnostic input'], risks: ['Mixed workflow-version receipts'], successCriteria: ['The output equals the supplied input'] },
    inputSchema: { type: 'object', properties: { value: { type: 'number' } }, required: ['value'], additionalProperties: false },
    budget: { maxSteps: 10, maxConcurrency: 1, maxDurationMs: 5000, maxCost: 0 }, nodes,
    acceptance: [eq(ref('nodes.echo.value'), wrong ? 999 : ref('input.value'))] };
}
function environment(t, options = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), 'foundry-trials-'));
  const foundry = new Foundry(directory, options);
  t.after(async () => { await foundry.close(); rmSync(directory, { recursive: true, force: true }); });
  return { foundry, directory };
}
async function appliedFailure(foundry) {
  const candidate = workflow({ wrong: true });
  const request = foundry.store.createRequest({ text: 'Echo exactly the input number; do not change this requirement.' });
  const proposal = foundry.propose({ requestId: request.id, workflow: candidate, rationale: 'Initial candidate with a deliberately faulty local assertion.' });
  foundry.apply(proposal.id);
  const run = foundry.createRun(candidate.id, { value: 7 });
  const failed = await foundry.startRun(run.id);
  assert.equal(failed.status, 'failed');
  return { request, proposal, candidate, failed };
}

test('trial isolates divergent drafts at the same requested version and leaves reusable state untouched', async t => {
  const { foundry } = environment(t);
  const request = foundry.store.createRequest({ text: 'Echo the input accurately.' });
  const a = await foundry.trial({ requestId: request.id, workflow: workflow({ wrong: true }), input: { value: 7 } });
  const b = await foundry.trial({ requestId: request.id, workflow: workflow(), input: { value: 7 } });
  assert.equal(a.runStatus, 'failed'); assert.equal(b.runStatus, 'succeeded');
  assert.notEqual(a.id, b.id); assert.notEqual(a.workflowHash, b.workflowHash);
  assert.equal(a.workflowVersion, 1); assert.equal(b.workflowVersion, 1);
  assert.equal(foundry.store.request(request.id).status, 'pending');
  assert.equal(foundry.store.workflows().length, 0); assert.equal(foundry.store.runs().length, 0);
  for (const receipt of [a, b]) {
    const inspected = foundry.inspectTrial(receipt.id);
    assert.equal(inspected.run.workflowHash, receipt.workflowHash);
    assert.equal(inspected.events.at(-1).hash, receipt.eventHead.hash);
    assert.equal(inspected.taskOutcomeQualified, false);
  }
  const proposal = foundry.propose({ requestId: request.id, workflow: workflow(), rationale: 'Use the exact locally exercised candidate.' });
  foundry.apply(proposal.id);
  assert.equal(foundry.store.workflow(workflow().id).hash, b.workflowHash);
});

test('invalid trial input is preserved as rejection without creating a run or consuming the request', async t => {
  const { foundry } = environment(t);
  const request = foundry.store.createRequest({ text: 'Echo numeric input.' });
  const receipt = await foundry.trial({ requestId: request.id, workflow: workflow(), input: { value: '7' } });
  assert.equal(receipt.runStatus, 'input-rejected'); assert.equal(receipt.runId, null);
  assert.equal(receipt.localAcceptancePassed, false); assert.equal(receipt.taskOutcomeQualified, false);
  assert.deepEqual(foundry.inspectTrial(receipt.id).events, []);
  assert.deepEqual(foundry.inspectTrial(receipt.id).workflow, workflow());
  assert.equal(foundry.store.request(request.id).status, 'pending');
});

test('input-rejected trial source remains exact and a missing draft cannot fall back to a reusable head', async t => {
  const { foundry } = environment(t);
  const candidate = workflow(), request = foundry.store.createRequest({ text: 'Inspect the exact rejected draft.' });
  const trial = await foundry.trial({ requestId: request.id, workflow: candidate, input: { value: '7' } });
  const different = workflow(); different.title = 'A different current head'; foundry.save(different);
  assert.notEqual(foundry.store.workflow(candidate.id).hash, trial.workflowHash);
  const inspected = foundry.inspectTrial(trial.id);
  assert.deepEqual(inspected.workflow, candidate); assert.equal(inspected.run, null); assert.deepEqual(inspected.events, []);
  const child = new Store(path.join(foundry.store.directory, 'trials', trial.id));
  try { child.db.prepare('DELETE FROM workflows WHERE hash=?').run(trial.workflowHash); } finally { child.close(); }
  assert.throws(() => foundry.inspectTrial(trial.id), { code: 'NOT_FOUND' });
  assert.equal(foundry.store.workflow(candidate.id).workflow.title, 'A different current head');
});

test('trial capability policy cannot widen normal host authority or trust custom names', async t => {
  const { foundry } = environment(t, { policy: { allowedCapabilities: [] } });
  const request = foundry.store.createRequest({ text: 'No capability authority.' });
  await assert.rejects(foundry.trial({ requestId: request.id, workflow: workflow(), input: { value: 7 } }), { code: 'TRIAL_CAPABILITY_DENIED' });
  assert.equal(foundry.store.trials().length, 0);
  let calls = 0;
  const registry = new CapabilityRegistry().register({ name: 'core.identity', description: 'Not the bundled implementation', version: '1', implementation: 'custom',
    effects: 'none', risk: 'low', requiresApproval: false, inputSchema: {}, outputSchema: {}, cost: 0, maxTimeoutMs: 1000, execute: async args => { calls++; return args; } });
  const custom = environment(t, { registry }).foundry;
  const q = custom.store.createRequest({ text: 'Custom capability requires explicit diagnostic qualification.' });
  await assert.rejects(custom.trial({ requestId: q.id, workflow: workflow(), input: { value: 7 } }), { code: 'TRIAL_CAPABILITY_DENIED' });
  assert.equal(calls, 0);
});

test('trial budget counts failures and survives reopening the workspace', async t => {
  const { foundry, directory } = environment(t, { trialPolicy: { maxPerRequest: 1 } });
  const request = foundry.store.createRequest({ text: 'One diagnostic attempt only.' });
  await foundry.trial({ requestId: request.id, workflow: workflow({ wrong: true }), input: { value: 7 } });
  const reopened = new Foundry(directory, { trialPolicy: { maxPerRequest: 1 } });
  try {
    await assert.rejects(reopened.trial({ requestId: request.id, workflow: workflow(), input: { value: 7 } }), { code: 'TRIAL_BUDGET' });
    assert.equal(reopened.store.trials().length, 1);
  } finally { await reopened.close(); }
});

test('trial inspection detects changed artifact bytes and preserves the original receipt', async t => {
  const { foundry } = environment(t);
  const request = foundry.store.createRequest({ text: 'Write only a local diagnostic artifact.' });
  const receipt = await foundry.trial({ requestId: request.id, workflow: workflow({ artifact: true }), input: { value: 7 } });
  const file = path.join(foundry.store.directory, 'trials', receipt.id, '.foundry', 'artifacts', receipt.runId, 'evidence.txt');
  assert.equal(readFileSync(file, 'utf8'), 'synthetic local evidence');
  const before = foundry.store.trial(receipt.id);
  writeFileSync(file, 'different synthetic content');
  assert.throws(() => foundry.inspectTrial(receipt.id), { code: 'TRIAL_EVIDENCE' });
  assert.deepEqual(foundry.store.trial(receipt.id), before);
});

test('repair creates an idempotent non-spending diagnostic lineage and preserves historical failure evidence', async t => {
  const { foundry } = environment(t);
  const { request, proposal, candidate, failed } = await appliedFailure(foundry);
  const originalEvents = foundry.store.events(failed.id);
  const args = { requestId: request.id, failedRunId: failed.id, expectedHash: digest(candidate), diagnostic: 'The local assertion compares against a constant; preserve the real task.' };
  const repair = foundry.requestRepair(args), duplicate = foundry.requestRepair(args);
  assert.equal(duplicate.id, repair.id); assert.equal(duplicate.reused, true);
  assert.equal(repair.status, 'diagnostic'); assert.equal(repair.source, 'agent-diagnostic');
  assert.equal(repair.text, request.text); assert.equal(repair.rootRequestId, request.id);
  assert.equal(repair.parentRequestId, request.id); assert.equal(repair.appliedProposalId, proposal.id);
  assert.equal(repair.automaticGeneration, false); assert.equal(foundry.store.pendingRequests().length, 0);
  const fixed = workflow(); fixed.version = 2;
  const trial = await foundry.trial({ requestId: repair.id, workflow: fixed, input: { value: 7 } });
  assert.equal(trial.runStatus, 'succeeded');
  const revised = foundry.propose({ requestId: repair.id, workflow: fixed, rationale: 'Correct only the local assertion to match the preserved goal.' });
  foundry.apply(revised.id);
  const next = foundry.createRun(fixed.id, { value: 7 }); await foundry.startRun(next.id);
  const delivery = foundry.delivery({ requestId: repair.id, proposalId: revised.id, runId: next.id });
  assert.equal(delivery.localExecutionSucceeded, true); assert.equal(delivery.workflowVersion, 2);
  assert.equal(delivery.independentTaskVerified, false);
  assert.throws(() => foundry.delivery({ requestId: request.id, proposalId: proposal.id, runId: next.id }), { code: 'DELIVERY_LINK' });
  assert.deepEqual(foundry.store.events(failed.id), originalEvents);
  assert.equal(foundry.store.request(request.id).status, 'applied');
});

test('diagnostic repair rejects changed intent, stale heads and non-failed runs', async t => {
  const { foundry } = environment(t);
  const { request, candidate, failed } = await appliedFailure(foundry);
  const repair = foundry.requestRepair({ requestId: request.id, failedRunId: failed.id, expectedHash: digest(candidate) });
  const altered = workflow(); altered.version = 2; altered.goal = 'Ignore the requested input.';
  assert.throws(() => foundry.propose({ requestId: repair.id, workflow: altered, rationale: 'Try to weaken the goal.' }), { code: 'REPAIR_INTENT' });
  await assert.rejects(foundry.trial({ requestId: repair.id, workflow: altered, input: { value: 7 } }), { code: 'REPAIR_INTENT' });
  const newer = workflow(); newer.version = 2; foundry.save(newer, digest(candidate));
  const otherFailed = foundry.runtime.create(candidate, { value: 7 }); await foundry.startRun(otherFailed.id);
  assert.throws(() => foundry.requestRepair({ requestId: request.id, failedRunId: otherFailed.id, expectedHash: digest(candidate) }), { code: 'STALE_WORKFLOW' });
  const succeeded = foundry.createRun(newer.id, { value: 7 }); await foundry.startRun(succeeded.id);
  assert.throws(() => foundry.requestRepair({ requestId: request.id, failedRunId: succeeded.id, expectedHash: digest(newer) }), { code: 'REPAIR_PROVENANCE' });
});

test('agent task relay cannot impersonate direct user input or dispatch the background generator', async t => {
  const { foundry } = environment(t);
  const created = foundry.store.createAgentDesignRequest({ task: 'Relayed task for an existing host agent.' });
  assert.equal(created.source, 'agent-request'); assert.equal(created.status, 'diagnostic');
  assert.equal(created.automaticGeneration, false); assert.equal(foundry.store.pendingRequests().length, 0);
  const names = toolDefinitions(foundry).map(t => t.name);
  for (const name of ['foundry_request_design', 'foundry_trial', 'foundry_trial_json', 'foundry_inspect_trial', 'foundry_request_repair', 'foundry_delivery']) assert.ok(names.includes(name));
  assert.ok(!names.some(name => /approve|answer/.test(name)), 'Agent MCP surface cannot synthesize human authority');
});
