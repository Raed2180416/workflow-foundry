import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { Foundry } from '../../../workflow-foundry/src/foundry.mjs';
import { OutcomeRepairCoordinator } from '../../../workflow-foundry/src/outcome-repair.mjs';
import { createDefaultRegistry } from '../../../workflow-foundry/src/capabilities.mjs';
import { digest } from '../../../workflow-foundry/src/data.mjs';

// One native run, then a controlled catalog-only intervention and reversal.
// No historical evidence, registered contract, product source or old study is edited.
const root = path.dirname(fileURLToPath(import.meta.url));
const output = path.join(root, 'run-001');
mkdirSync(output, { mode: 0o700 });
const write = (name, value) => writeFileSync(path.join(output, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const sources = ['foundry', 'outcome-repair', 'store', 'runtime', 'capabilities', 'data'].map(name => fileURLToPath(new URL(`../../../workflow-foundry/src/${name}.mjs`, import.meta.url)));
const hashes = () => Object.fromEntries(sources.map(file => [file, sha(readFileSync(file))]));
const frozen = hashes();
write('PROTOCOL.json', { at: new Date().toISOString(), sourceHashes: frozen,
  sourceSHA256: sha(readFileSync(new URL(import.meta.url))), nativeRuns: 1, modelCalls: 0,
  intervention: 'Add a pure, unused local capability after a terminal green-but-wrong run; no existing descriptor or implementation changes.',
  preregisteredPrediction: 'Raw historical receipt remains readable; verify and repair are blocked by live catalog identity; identical root/input/artifact expectation cannot be re-registered under new catalog; reverting catalog restores verify.',
  distinction: 'Historical content mismatch can remain established while current-world execution remains unqualified.' });
const registryA = createDefaultRegistry(), registryB = createDefaultRegistry();
registryB.register({ name: 'research.unused', version: '1', implementation: 'local-pure-unused-control',
  description: 'Never dispatched in this study.', inputSchema: { type: 'object' }, outputSchema: { type: 'object' },
  effects: 'none', risk: 'low', requiresApproval: false, maxTimeoutMs: 1000, cost: 0,
  cancellation: 'cooperative', execute: async () => ({ unused: true }) });
assert.notEqual(registryA.hash(), registryB.hash());
for (const descriptor of registryA.list()) assert.deepEqual(registryB.list().find(item => item.name === descriptor.name), descriptor);
const workflow = { schemaVersion: '1.0', id: 'dependency-separation-witness', version: 1,
  title: 'Supplied local dependency witness', domain: 'software', goal: 'Write record.json containing exactly input.record.',
  envelope: { assumptions: ['One bounded local JSON artifact'], risks: ['Wrong content'],
    successCriteria: ['Write record.json containing exactly input.record.'], unsupported: ['General business intent'] },
  inputSchema: { type: 'object', required: ['record'], properties: { record: { type: 'object' } }, additionalProperties: false },
  budget: { maxSteps: 5, maxConcurrency: 1, maxDurationMs: 10000, maxCost: 0 },
  nodes: [
    { id: 'encode', kind: 'task', needs: [], description: 'Encode supplied wrong control.', tool: 'core.json', args: { value: { label: 'wrong' } }, timeoutMs: 1000, retry: { maxAttempts: 1 } },
    { id: 'file', kind: 'task', needs: ['encode'], description: 'Write local artifact.', tool: 'core.artifact', args: { name: 'record.json', content: { $ref: 'nodes.encode.text' } }, timeoutMs: 1000, retry: { maxAttempts: 1 } },
  ], acceptance: [{ op: 'exists', value: { $ref: 'nodes.file.sha256' } }] };
const input = { record: { label: 'requested' } };
let request, contract, proposal, run, receipt, artifact, evidence;
const workspace = path.join(output, 'workspace');
const first = new Foundry(workspace, { registry: registryA });
try {
  request = first.store.createRequest({ text: workflow.goal, source: 'research-supplied-control' });
  const coordinator = new OutcomeRepairCoordinator(first);
  contract = coordinator.registerContract({ requestId: request.id, input, artifactName: 'record.json', expected: input.record, evaluatorId: 'supplied-local-exact-json' });
  proposal = first.propose({ requestId: request.id, workflow, rationale: 'Deliberately wrong control to study historical-versus-current registry dependency.' });
  first.apply(proposal.id);
  run = await first.startRun(first.runtime.create(workflow, input).id);
  receipt = coordinator.observe({ requestId: request.id, proposalId: proposal.id, runId: run.id, contractId: contract.id });
  assert.equal(run.status, 'succeeded'); assert.equal(receipt.outcome, 'unsatisfied');
  assert.deepEqual(coordinator.verify(receipt.id), receipt);
  artifact = path.join(first.store.directory, 'artifacts', run.id, 'record.json');
  evidence = { request: first.store.request(request.id), proposal: first.store.proposal(proposal.id),
    workflow, input, contract, run: first.store.run(run.id), events: first.store.events(run.id), receipt,
    artifactSHA256: sha(readFileSync(artifact)), registry: registryA.list() };
  write('ORIGINAL.json', evidence);
} finally { await first.close(); }

const observed = [];
const outcome = (name, fn) => {
  try { const value = fn(); observed.push({ name, accepted: true, value }); return value; }
  catch (error) { observed.push({ name, accepted: false, error: { code: error.code, message: error.message } }); return error; }
};
const changed = new Foundry(workspace, { registry: registryB });
try {
  const coordinator = new OutcomeRepairCoordinator(changed);
  assert.deepEqual(outcome('historical-receipt-readable', () => coordinator.receipt(receipt.id)), receipt);
  assert.equal(outcome('current-verification-after-unused-addition', () => coordinator.verify(receipt.id)).code, 'OUTCOME_CONTRACT_BINDING');
  assert.equal(outcome('new-repair-after-unused-addition', () => coordinator.requestRepair({ receiptId: receipt.id, requestId: request.id, runId: run.id, expectedHash: proposal.workflowHash })).code, 'OUTCOME_CONTRACT_BINDING');
  assert.equal(outcome('unchanged-expectation-new-world-registration', () => coordinator.registerContract({ requestId: request.id, input,
    artifactName: 'record.json', expected: input.record, evaluatorId: contract.evaluator.id })).code, 'OUTCOME_CONTRACT_CONFLICT');
  assert.deepEqual(changed.store.run(run.id), evidence.run);
  assert.deepEqual(changed.store.events(run.id), evidence.events);
  assert.equal(sha(readFileSync(artifact)), evidence.artifactSHA256);
  assert.equal(changed.store.runs().length, 1);
  write('INTERVENTION.json', { registryBefore: registryA.hash(), registryAfter: registryB.hash(),
    existingDescriptorsUnchanged: true, usedCapabilities: ['core.json', 'core.artifact'],
    addedCapabilities: ['research.unused'], unchangedArtifact: true, unchangedHistoricalRunAndEvents: true, observations: observed });
} finally { await changed.close(); }
const restored = new Foundry(workspace, { registry: registryA });
try { assert.deepEqual(new OutcomeRepairCoordinator(restored).verify(receipt.id), receipt); }
finally { await restored.close(); }
assert.deepEqual(hashes(), frozen);
const result = { passed: true, at: new Date().toISOString(), nativeRuns: 1, modelCalls: 0,
  historicalOutcome: receipt.outcome, currentVerificationRejected: true, newRepairRejected: true,
  identicalContractRebindingRejected: true, originalRegistryRestoresVerification: true,
  dataAndSourceUnchanged: true,
  interpretation: 'Conservative current-world verification blocks cross-world continuation even after an unused pure capability addition. Raw history is retained. This is a missing history/current-world distinction and continuation protocol, not authorization to remove promotion or runtime checks.' };
write('RESULTS.json', result); console.log(JSON.stringify(result, null, 2));
