import test from 'node:test';
import assert from 'node:assert/strict';
import fs, { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync, unlinkSync, symlinkSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Foundry } from '../src/foundry.mjs';
import { OutcomeRepairCoordinator } from '../src/outcome-repair.mjs';
import { WorkflowGenerator } from '../src/generator.mjs';
import { canonical, clone, digest } from '../src/data.mjs';

const task = 'Write record.json containing exactly input.record, preserving every key and value.';
const input = { record: { label: 'requested', active: true, count: 3 } };
function candidate({ version = 1, correct = false, id = 'outcome-test', content, writes = true, artifactName = 'record.json' } = {}) {
  const workflow = {
    schemaVersion: '1.0', id, version, title: 'Supplied outcome development control', goal: task, domain: 'software',
    envelope: { assumptions: ['A local JSON file is sufficient.'], risks: ['Existing files can contain wrong data.'],
      successCriteria: [task], unsupported: ['External effects and general intent inference'] },
    inputSchema: { type: 'object', required: ['record'], properties: { record: { type: 'object' } }, additionalProperties: false },
    budget: { maxSteps: 8, maxConcurrency: 1, maxDurationMs: 15000, maxCost: 0 },
    nodes: [
      { id: 'encode', kind: 'task', needs: [], description: 'Serialize the selected value.', tool: 'core.json',
        args: { value: correct ? { $ref: 'input.record' } : { label: 'wrong', active: false, count: 0 } }, timeoutMs: 1000, retry: { maxAttempts: 1 } },
      { id: 'file', kind: 'task', needs: ['encode'], description: 'Write the actual run artifact.', tool: 'core.artifact',
        args: { name: artifactName, content: content ?? { $ref: 'nodes.encode.text' } }, timeoutMs: 1000, retry: { maxAttempts: 1 } }
    ],
    acceptance: [{ op: 'exists', value: { $ref: 'nodes.file.sha256' } }]
  };
  if (!writes) { workflow.nodes.pop(); workflow.acceptance = [{ op: 'exists', value: { $ref: 'nodes.encode.text' } }]; }
  return workflow;
}
const file = (foundry, id) => path.join(foundry.store.directory, 'artifacts', id, 'record.json');
const count = (store, table) => store.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
function unchangedState(store) {
  return Object.fromEntries(['workflows', 'heads', 'runs', 'events', 'proposals', 'generation_jobs', 'qualifications', 'trials', 'effects', 'fixtures', 'diagnostic_repairs'].map(table =>
    [table, clone(store.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all())]));
}
function mutateBody(store, table, id, change) {
  const row = store.db.prepare(`SELECT body FROM ${table} WHERE id=?`).get(id);
  const body = JSON.parse(row.body); change(body);
  store.db.prepare(`UPDATE ${table} SET body=? WHERE id=?`).run(canonical(body), id);
}
async function harness(t, options = {}) {
  const workspace = mkdtempSync(path.join(tmpdir(), 'foundry-outcome-'));
  const foundry = new Foundry(workspace);
  t.after(async () => { await foundry.close(); rmSync(workspace, { recursive: true, force: true }); });
  const api = new OutcomeRepairCoordinator(foundry), store = foundry.store;
  const request = store.createRequest({ text: task });
  const sample = options.input ?? input;
  const contractArgs = { requestId: request.id, input: sample, artifactName: 'record.json', expected: sample.record, evaluatorId: 'host-record-development-v1' };
  const contract = api.registerContract(contractArgs);
  const workflow = candidate(options);
  const proposal = foundry.propose({ requestId: request.id, workflow, rationale: 'Supplied synthetic development control; no model invocation.' });
  foundry.apply(proposal.id);
  const run = await foundry.startRun(foundry.createRun(workflow.id, sample).id);
  assert.equal(run.status, 'succeeded');
  const observeArgs = { requestId: request.id, proposalId: proposal.id, runId: run.id, contractId: contract.id };
  const observation = options.observe === false ? null : api.observe(observeArgs);
  return { workspace, foundry, store, api, request, proposal, run, workflow, sample, contract, contractArgs, observeArgs, observation,
    repairArgs: observation ? { receiptId: observation.id, requestId: request.id, runId: run.id, expectedHash: proposal.workflowHash } : null };
}
function repair(h) { return h.api.requestRepair({ ...h.repairArgs, diagnostic: 'Localize the record source defect without changing the task.' }); }

test('native green-but-wrong witness: host observation fails while legacy repair rejects REPAIR_RUN_STATE', async t => {
  const h = await harness(t);
  assert.notDeepEqual(JSON.parse(readFileSync(file(h.foundry, h.run.id))), input.record);
  assert.throws(() => h.foundry.requestRepair({ requestId: h.request.id, failedRunId: h.run.id, expectedHash: h.proposal.workflowHash }), { code: 'REPAIR_RUN_STATE' });
  assert.equal(h.observation.outcome, 'unsatisfied');
  assert.equal(h.observation.reason, 'json-content-mismatch');
  assert.equal(h.observation.binding.runStatus, 'succeeded');
  assert.equal(h.observation.binding.requestId, h.request.id);
  assert.equal(h.observation.binding.proposalId, h.proposal.id);
  assert.equal(h.observation.binding.runHash, digest(h.store.run(h.run.id)));
  assert.deepEqual(h.observation.binding.eventHead, h.run.eventHead);
});

test('native full trajectory: wrong bytes -> observed repair -> proposal v2 -> apply -> execution -> independently matching bytes', async t => {
  const h = await harness(t), before = unchangedState(h.store), original = readFileSync(file(h.foundry, h.run.id));
  const q = repair(h);
  assert.deepEqual(unchangedState(h.store), before);
  assert.equal(q.status, 'diagnostic'); assert.equal(q.source, 'agent-diagnostic');
  assert.equal(q.parentRequestId, h.request.id); assert.equal(q.rootRequestId, h.request.id);
  assert.equal(q.goal, h.workflow.goal); assert.deepEqual(q.successCriteria, h.workflow.envelope.successCriteria);
  assert.equal(q.text, task); assert.equal(q.observedRunId, h.run.id);
  assert.equal(q.observedRunStatus, 'succeeded'); assert.equal(Object.hasOwn(q, 'failedRunId'), false);
  assert.equal(Object.hasOwn(q, 'failure'), false); assert.equal(q.automaticGeneration, false);
  const next = h.api.propose({ requestId: q.id, workflow: candidate({ version: 2, correct: true }), rationale: 'Supplied localized fix: encode the actual input record.' });
  const applied = h.api.apply(next.id);
  assert.equal(applied.workflow.version, 2);
  const run = await h.foundry.startRun(h.foundry.createRun(next.workflow.id, input).id);
  const observation = h.api.observe({ requestId: q.id, proposalId: next.id, runId: run.id, contractId: h.contract.id });
  assert.equal(run.status, 'succeeded'); assert.equal(observation.outcome, 'satisfied');
  assert.deepEqual(JSON.parse(readFileSync(file(h.foundry, run.id))), input.record);
  assert.deepEqual(readFileSync(file(h.foundry, h.run.id)), original);
  assert.deepEqual(h.store.run(h.run.id), h.run);
  assert.equal(h.api.observe(h.observeArgs).id, h.observation.id);
  assert.equal(h.api.requestRepair(h.repairArgs).id, q.id);
  assert.equal(h.api.requestRepair(h.repairArgs).reused, true);
  assert.equal(h.api.registerContract({ ...h.contractArgs, requestId: q.id }).id, h.contract.id);
});

test('completed run with no producer and a proven absent required file opens observed-outcome repair', async t => {
  const h = await harness(t, { writes: false });
  assert.equal(h.observation.outcome, 'unsatisfied');
  assert.equal(h.observation.reason, 'required-artifact-absent');
  assert.equal(h.observation.artifact.state, 'absent');
  assert.equal(h.observation.artifact.absence.method, 'lstat-ENOENT');
  assert.equal(h.observation.artifact.absence.noCompletedProducer, true);
  assert.deepEqual(h.observation.artifact.producers, []);
  assert.equal(h.observation.artifact.sha256, null);
  assert.equal(repair(h).observedRunStatus, 'succeeded');
});

test('native wrong filename -> observed required-file absence -> repair v2 -> validated required file; original bytes retained', async t => {
  const h = await harness(t, { artifactName: 'different.json', correct: true });
  const originalPath = path.join(path.dirname(file(h.foundry, h.run.id)), 'different.json');
  const original = readFileSync(originalPath);
  assert.equal(h.observation.outcome, 'unsatisfied');
  assert.equal(h.observation.reason, 'required-artifact-absent');
  assert.equal(h.observation.artifact.absence.location, 'artifact');
  const q = repair(h), context = h.api.designContext({ requestId: q.id, includeSkills: false });
  assert.deepEqual(context.outcomeRepair.comparison.expected.value, input.record);
  assert.equal(context.outcomeRepair.comparison.observed.state, 'absent');
  assert.equal(context.outcomeRepair.comparison.differences, null);
  const proposal = h.api.propose({ requestId: q.id, workflow: candidate({ version: 2, correct: true }), rationale: 'Supplied filename correction.' });
  h.api.apply(proposal.id);
  const run = await h.foundry.startRun(h.foundry.createRun(h.workflow.id, input).id);
  const observed = h.api.observe({ requestId: q.id, proposalId: proposal.id, runId: run.id, contractId: h.contract.id });
  assert.equal(observed.outcome, 'satisfied');
  assert.deepEqual(JSON.parse(readFileSync(file(h.foundry, run.id))), input.record);
  assert.deepEqual(readFileSync(originalPath), original);
  assert.equal(h.store.run(h.run.id).status, 'succeeded');
});

test('missing bytes after a completed producer are unknown and cannot open repair', async t => {
  const h = await harness(t, { observe: false });
  unlinkSync(file(h.foundry, h.run.id));
  const observed = h.api.observe(h.observeArgs);
  assert.equal(observed.outcome, 'unknown');
  assert.equal(observed.reason, 'recorded-artifact-missing');
  assert.equal(observed.artifact.state, 'unavailable');
  assert.equal(observed.artifact.producers.length, 1);
  assert.equal(h.api.observe(h.observeArgs).id, observed.id);
  assert.throws(() => h.api.requestRepair({ receiptId: observed.id, requestId: h.request.id, runId: h.run.id, expectedHash: h.proposal.workflowHash }), { code: 'OUTCOME_NOT_UNSATISFIED' });
  assert.equal(count(h.store, 'requests'), 1); assert.equal(count(h.store, 'outcome_repairs'), 0);
  assert.equal(count(h.store, 'generation_jobs'), 0); assert.equal(count(h.store, 'runs'), 1);
});

test('lost artifact namespace after another successful producer is unknown, not required-file absence', async t => {
  const h = await harness(t, { artifactName: 'different.json', observe: false });
  rmSync(path.dirname(file(h.foundry, h.run.id)), { recursive: true });
  const observed = h.api.observe(h.observeArgs);
  assert.equal(observed.outcome, 'unknown');
  assert.equal(observed.reason, 'recorded-artifact-directory-missing');
  assert.throws(() => h.api.requestRepair({ receiptId: observed.id, requestId: h.request.id, runId: h.run.id, expectedHash: h.proposal.workflowHash }), { code: 'OUTCOME_NOT_UNSATISFIED' });
});

test('fault-injected unavailable filesystem observer records unknown and dispatches no repair', async t => {
  const h = await harness(t, { observe: false }), target = file(h.foundry, h.run.id);
  const realLstat = fs.lstatSync;
  const mocked = t.mock.method(fs, 'lstatSync', (name, ...args) => {
    if (name === target) throw Object.assign(new Error('Synthetic observer access failure'), { code: 'EACCES' });
    return realLstat(name, ...args);
  });
  syncBuiltinESMExports();
  let observed;
  try {
    observed = h.api.observe(h.observeArgs);
    assert.equal(observed.outcome, 'unknown'); assert.equal(observed.reason, 'observer-unavailable');
    assert.equal(observed.artifact.observationError, 'EACCES');
    assert.throws(() => h.api.requestRepair({ receiptId: observed.id, requestId: h.request.id, runId: h.run.id, expectedHash: h.proposal.workflowHash }), { code: 'OUTCOME_NOT_UNSATISFIED' });
    assert.equal(count(h.store, 'requests'), 1); assert.equal(count(h.store, 'generation_jobs'), 0);
    assert.equal(count(h.store, 'outcome_repairs'), 0); assert.equal(count(h.store, 'runs'), 1);
  } finally { mocked.mock.restore(); syncBuiltinESMExports(); }
  assert.equal(h.api.receipt(observed.id).outcome, 'unknown');
  assert.throws(() => h.api.observe(h.observeArgs), { code: 'OUTCOME_EVIDENCE' });
});

test('deleting already observed bytes preserves historical evidence and blocks subsequent repair', async t => {
  const h = await harness(t), original = readFileSync(file(h.foundry, h.run.id));
  unlinkSync(file(h.foundry, h.run.id));
  assert.throws(() => h.api.verify(h.observation.id), { code: 'OUTCOME_EVIDENCE' });
  assert.throws(() => repair(h), { code: 'OUTCOME_EVIDENCE' });
  assert.deepEqual(Buffer.from(h.api.receipt(h.observation.id).artifact.base64, 'base64'), original);
});

test('matching JSON is satisfied, including reordered keys; no repair authority follows', async t => {
  const h = await harness(t, { content: '{ "count": 3, "active": true, "label": "requested" }' });
  assert.equal(h.observation.outcome, 'satisfied');
  assert.throws(() => repair(h), { code: 'OUTCOME_NOT_UNSATISFIED' });
});

test('observed malformed JSON is unsatisfied, distinct from unknown', async t => {
  const h = await harness(t, { content: '{not-json}' });
  assert.equal(h.observation.outcome, 'unsatisfied');
  assert.equal(h.observation.reason, 'invalid-or-unsupported-json');
  assert.equal(repair(h).observedRunStatus, 'succeeded');
});

test('frozen oracle cannot be replaced by changed expectation or evaluator; returned objects are copies', async t => {
  const h = await harness(t);
  h.contract.expected.label = 'wrong';
  assert.equal(h.api.contract(h.contract.id).expected.label, 'requested');
  assert.equal(h.api.registerContract(h.contractArgs).id, h.contract.id);
  assert.throws(() => h.api.registerContract({ ...h.contractArgs, expected: { label: 'wrong' } }), { code: 'OUTCOME_CONTRACT_CONFLICT' });
  assert.throws(() => h.api.registerContract({ ...h.contractArgs, evaluatorId: 'agent-claims-success' }), { code: 'OUTCOME_CONTRACT_CONFLICT' });
  assert.match(h.api.contract(h.contract.id).provenance, /does not establish independent correctness/);
});

test('same-root later requests cannot supersede their frozen contract', async t => {
  const h = await harness(t), q = repair(h);
  assert.equal(h.api.registerContract({ ...h.contractArgs, requestId: q.id }).id, h.contract.id);
  assert.throws(() => h.api.registerContract({ ...h.contractArgs, requestId: q.id, expected: { anything: 'passes' } }), { code: 'OUTCOME_CONTRACT_CONFLICT' });
  assert.throws(() => h.api.registerContract({ ...h.contractArgs, requestId: q.id, evaluatorId: 'replacement-oracle' }), { code: 'OUTCOME_CONTRACT_CONFLICT' });
  assert.equal(count(h.store, 'outcome_contracts'), 1);
});

test('historical observer implementation cannot qualify a new run through a stale contract', async t => {
  const h = await harness(t), { id, ...body } = h.api.contract(h.contract.id);
  // Seed a historical ledger record in this disposable DB; the public API has
  // no contract supersession/override operation.
  body.evaluator.implementationHash = '0'.repeat(64);
  const staleId = digest(body);
  h.store.db.prepare('INSERT INTO outcome_contracts VALUES(?,?,?)').run(staleId, digest(['historical-test-contract', staleId]), canonical(body));
  const run = await h.foundry.startRun(h.foundry.createRun(h.workflow.id, input).id);
  assert.throws(() => h.api.observe({ ...h.observeArgs, runId: run.id, contractId: staleId }), { code: 'OUTCOME_EVALUATOR_DRIFT' });
  assert.equal(count(h.store, 'outcome_observations'), 1);
});

test('stale observed version cannot create a new repair', async t => {
  const h = await harness(t);
  h.foundry.save(candidate({ version: 2, correct: true }), h.proposal.workflowHash);
  assert.throws(() => repair(h), { code: 'STALE_WORKFLOW' });
  assert.equal(count(h.store, 'outcome_repairs'), 0);
});

test('stale repair cannot propose, and existing apply CAS rejects a competing head', async t => {
  const h = await harness(t), q = repair(h);
  const pending = h.api.propose({ requestId: q.id, workflow: candidate({ version: 2, correct: true }), rationale: 'Supplied first contender.' });
  const other = candidate({ version: 2 }); other.title = 'Independent competing revision';
  h.foundry.save(other, h.proposal.workflowHash);
  assert.throws(() => h.api.apply(pending.id), { code: 'STALE_WORKFLOW' });
  assert.throws(() => h.foundry.apply(pending.id), { code: 'STALE_WORKFLOW' });
  assert.throws(() => h.api.propose({ requestId: q.id, workflow: candidate({ version: 2 }), rationale: 'Obsolete.' }), { code: 'STALE_WORKFLOW' });
  assert.equal(h.store.workflow(other.id).hash, digest(other));
});

test('cross-run and cross-request repair bindings cannot reuse an unrelated receipt', async t => {
  const h = await harness(t);
  const anotherRun = await h.foundry.startRun(h.foundry.createRun(h.workflow.id, input).id);
  assert.throws(() => h.api.requestRepair({ ...h.repairArgs, runId: anotherRun.id }), { code: 'OUTCOME_LINK' });
  const otherRequest = h.store.createRequest({ text: 'An unrelated task' });
  assert.throws(() => h.api.requestRepair({ ...h.repairArgs, requestId: otherRequest.id }), { code: 'OUTCOME_LINK' });
  assert.throws(() => h.api.observe({ ...h.observeArgs, requestId: otherRequest.id }), { code: 'OUTCOME_LINK' });
  assert.throws(() => h.api.requestRepair({ ...h.repairArgs, expectedHash: '0'.repeat(64) }), { code: 'OUTCOME_LINK' });
});

test('observation rejects input and root contract substitution', async t => {
  const h = await harness(t);
  const run = await h.foundry.startRun(h.foundry.createRun(h.workflow.id, { record: { label: 'other' } }).id);
  assert.throws(() => h.api.observe({ ...h.observeArgs, runId: run.id }), { code: 'OUTCOME_CONTRACT_BINDING' });
  const other = h.store.createRequest({ text: task });
  const contract = h.api.registerContract({ ...h.contractArgs, requestId: other.id });
  assert.throws(() => h.api.observe({ ...h.observeArgs, contractId: contract.id }), { code: 'OUTCOME_CONTRACT_BINDING' });
});

test('tampered live artifact is rejected; original byte receipt remains inspectable', async t => {
  const h = await harness(t), original = readFileSync(file(h.foundry, h.run.id));
  writeFileSync(file(h.foundry, h.run.id), JSON.stringify(input.record));
  assert.throws(() => h.api.verify(h.observation.id), { code: 'OUTCOME_EVIDENCE' });
  assert.throws(() => h.api.observe(h.observeArgs), { code: 'OUTCOME_EVIDENCE' });
  assert.throws(() => repair(h), { code: 'OUTCOME_EVIDENCE' });
  assert.deepEqual(Buffer.from(h.api.receipt(h.observation.id).artifact.base64, 'base64'), original);
});

test('pre-observation artifact tampering cannot turn a false success into host evidence', async t => {
  const h = await harness(t, { observe: false });
  writeFileSync(file(h.foundry, h.run.id), JSON.stringify(input.record));
  assert.throws(() => h.api.observe(h.observeArgs), { code: 'OUTCOME_EVIDENCE' });
  assert.equal(count(h.store, 'outcome_observations'), 0);
});

test('a manually planted artifact with no completed producer evidence is rejected', async t => {
  const h = await harness(t, { writes: false, observe: false });
  mkdirSync(path.dirname(file(h.foundry, h.run.id)), { recursive: true });
  writeFileSync(file(h.foundry, h.run.id), JSON.stringify(input.record));
  assert.throws(() => h.api.observe(h.observeArgs), { code: 'OUTCOME_EVIDENCE' });
});

test('tampered event chain and silent checkpoint edits fail independently', async t => {
  await t.test('event chain', async t => {
    const h = await harness(t);
    h.store.db.prepare("UPDATE events SET body='{}' WHERE run_id=? AND seq=2").run(h.run.id);
    assert.throws(() => repair(h), { code: 'CORRUPT_EVENTS' });
  });
  await t.test('checkpoint', async t => {
    const h = await harness(t);
    h.store.updateRun(h.run.id, run => { run.outputs.encode.text = 'forged claim'; });
    h.store.events(h.run.id);
    assert.throws(() => repair(h), { code: 'OUTCOME_EVIDENCE' });
  });
});

test('immutable ledger rejects updates/deletes, and receipt hash detects deliberately corrupted stored evidence', async t => {
  const h = await harness(t); repair(h);
  for (const table of ['outcome_contracts', 'outcome_observations', 'outcome_repairs']) {
    assert.throws(() => h.store.db.exec(`UPDATE ${table} SET body='{}'`), /immutable outcome/);
    assert.throws(() => h.store.db.exec(`DELETE FROM ${table}`), /immutable outcome/);
  }
  // Deliberate corruption in this disposable test DB, not a claimed DB-admin defense.
  h.store.db.exec('DROP TRIGGER outcome_observations_no_update');
  mutateBody(h.store, 'outcome_observations', h.observation.id, body => { body.outcome = 'satisfied'; });
  assert.throws(() => h.api.receipt(h.observation.id), { code: 'OUTCOME_EVIDENCE' });
});

test('model-supplied receipt objects and made-up passing receipt IDs confer no authority', async t => {
  const h = await harness(t);
  const forged = { ...h.observation, outcome: 'satisfied' };
  assert.throws(() => h.api.requestRepair({ ...h.repairArgs, receiptId: forged }), { code: 'OUTCOME_ARGUMENT' });
  const { id, ...body } = forged;
  assert.throws(() => h.api.requestRepair({ ...h.repairArgs, receiptId: digest(body) }), { code: 'OUTCOME_RECEIPT' });
  assert.equal(count(h.store, 'outcome_repairs'), 0);
});

test('goal and success-criteria changes are rejected by adapter and the unchanged Store path', async t => {
  const h = await harness(t), q = repair(h);
  for (const mutate of [w => { w.goal = 'A different goal'; }, w => { w.envelope.successCriteria = ['File merely exists']; }]) {
    const changed = candidate({ version: 2, correct: true }); mutate(changed);
    const args = { requestId: q.id, workflow: changed, rationale: 'Adversarial goal drift control.' };
    assert.throws(() => h.api.propose(args), { code: 'REPAIR_INTENT' });
    assert.throws(() => h.foundry.propose(args), { code: 'REPAIR_INTENT' });
  }
  const p = h.api.propose({ requestId: q.id, workflow: candidate({ version: 2, correct: true }), rationale: 'Supplied valid fix.' });
  mutateBody(h.store, 'proposals', p.id, body => { body.workflow.goal = 'Tampered goal'; body.workflowHash = digest(body.workflow); });
  assert.throws(() => h.api.apply(p.id), { code: 'REPAIR_INTENT' });
});

test('repair idempotence persists across independent Store connections with no new provider or runtime work', async t => {
  const h = await harness(t), before = unchangedState(h.store), q = repair(h);
  const otherFoundry = new Foundry(h.workspace);
  try {
    const other = new OutcomeRepairCoordinator(otherFoundry);
    assert.equal(other.observe(h.observeArgs).id, h.observation.id);
    assert.equal(other.requestRepair(h.repairArgs).id, q.id);
    assert.equal(other.requestRepair(h.repairArgs).reused, true);
    assert.equal(count(h.store, 'outcome_observations'), 1);
    assert.equal(count(h.store, 'outcome_repairs'), 1);
    assert.deepEqual(unchangedState(h.store), before);
    assert.deepEqual(h.store.pendingRequests(), []);
    assert.equal(count(h.store, 'generation_jobs'), 0); assert.equal(count(h.store, 'runs'), 1);
  } finally { await otherFoundry.close(); }
});

test('further outcome repair preserves root/parent continuity and enforces bounded depth', async t => {
  const h = await harness(t), first = repair(h);
  const p = h.api.propose({ requestId: first.id, workflow: candidate({ version: 2 }), rationale: 'Supplied intentionally still-wrong control.' });
  h.api.apply(p.id);
  const run = await h.foundry.startRun(h.foundry.createRun(p.workflow.id, input).id);
  const observed = h.api.observe({ requestId: first.id, proposalId: p.id, runId: run.id, contractId: h.contract.id });
  const args = { receiptId: observed.id, requestId: first.id, runId: run.id, expectedHash: p.workflowHash };
  assert.throws(() => h.api.requestRepair({ ...args, maxDepth: 1 }), { code: 'REPAIR_BUDGET' });
  const second = h.api.requestRepair(args);
  assert.equal(second.rootRequestId, h.request.id); assert.equal(second.parentRequestId, first.id);
  assert.equal(second.repairDepth, 2); assert.equal(second.text, task);
  assert.equal(h.api.requestRepair(h.repairArgs).id, first.id);
});

test('cancelled, waiting, uncertain and owned run states cannot qualify as observed terminal outcomes', async t => {
  for (const status of ['cancelled', 'waiting', 'uncertain']) {
    await t.test(status, async t => {
      const h = await harness(t, { observe: false });
      h.store.updateRun(h.run.id, run => { run.status = status; });
      assert.throws(() => h.api.observe(h.observeArgs), { code: 'OUTCOME_RUN_STATE' });
    });
  }
  await t.test('owned', async t => {
    const h = await harness(t, { observe: false });
    h.store.updateRun(h.run.id, run => { run.owner = { token: 'owned-control' }; });
    assert.throws(() => h.api.observe(h.observeArgs), { code: 'OUTCOME_RUN_STATE' });
  });
});

test('registry implementation drift invalidates observation bindings', async t => {
  const h = await harness(t);
  h.foundry.registry.register({ name: 'audit.unused', description: 'Unused synthetic capability.', version: '1',
    inputSchema: {}, outputSchema: {}, effects: 'none', risk: 'low', requiresApproval: false,
    maxTimeoutMs: 1000, cost: 0, execute: async () => ({}) });
  assert.throws(() => repair(h), { code: 'OUTCOME_CONTRACT_BINDING' });
});

test('artifact symlinks, traversal basenames and oversize files are rejected', async t => {
  const h = await harness(t), target = file(h.foundry, h.run.id);
  assert.throws(() => h.api.registerContract({ ...h.contractArgs, artifactName: '../record.json' }), { code: 'OUTCOME_PATH' });
  const other = path.join(h.workspace, 'synthetic-other.json');
  writeFileSync(other, JSON.stringify(input.record)); unlinkSync(target); symlinkSync(other, target);
  assert.throws(() => h.api.verify(h.observation.id), { code: 'OUTCOME_PATH' });
  unlinkSync(target); writeFileSync(target, Buffer.alloc(512 * 1024 + 1));
  assert.throws(() => h.api.verify(h.observation.id), { code: 'OUTCOME_PATH' });
});

test('outcome-aware design context and generation facade retain exact task and current version without failedRunId', async t => {
  const h = await harness(t), q = repair(h);
  const context = h.api.designContext({ requestId: q.id, includeSkills: false });
  assert.equal(context.task, task); assert.equal(context.currentWorkflow.version, 1);
  assert.equal(context.baseHash, h.proposal.workflowHash); assert.equal(context.diagnosticRepair, null);
  assert.equal(context.outcomeRepair.observedRunId, h.run.id); assert.equal(context.outcomeRepair.observedRunStatus, 'succeeded');
  assert.equal(Object.hasOwn(context.outcomeRepair, 'failedRunId'), false);
  assert.equal(Object.hasOwn(context.outcomeRepair, 'failure'), false);
  assert.deepEqual(context.outcomeRepair.preserveSuccessCriteria, h.workflow.envelope.successCriteria);
  const comparison = context.outcomeRepair.comparison;
  assert.match(comparison.usage, /Data only/);
  assert.equal(comparison.contractId, h.contract.id); assert.equal(comparison.receiptId, h.observation.id);
  assert.deepEqual(comparison.expected.value, input.record);
  assert.deepEqual(comparison.observed.value, JSON.parse(Buffer.from(h.observation.artifact.base64, 'base64')));
  assert.equal(comparison.observed.jsonHash, h.observation.observedJsonHash);
  assert.deepEqual(comparison.differences.entries.map(entry => entry.path), ['/active', '/count', '/label']);
  const label = comparison.differences.entries.find(entry => entry.path === '/label');
  assert.equal(label.expected.value, 'requested'); assert.equal(label.observed.value, 'wrong');
  assert.equal(comparison.differences.truncated, false);
  // Returned prompt data cannot modify the frozen expectation or saved bytes.
  comparison.expected.value.label = 'tampered'; comparison.observed.value.label = 'tampered';
  assert.equal(h.api.designContext({ requestId: q.id, includeSkills: false }).outcomeRepair.comparison.expected.value.label, 'requested');
  comparison.expected.value.label = 'requested'; comparison.observed.value.label = 'wrong';
  const { contextHash, ...body } = context; assert.equal(contextHash, digest(body));
  const facade = h.api.generationHost();
  assert.equal(facade.store, h.store); assert.equal(facade.registry, h.foundry.registry);
  assert.match(facade.generationPrompt({ requestId: q.id, includeSkills: false }).prompt, /observed-outcome/);
  assert.equal(h.store.request(q.id).source, 'agent-diagnostic');
  assert.equal(count(h.store, 'generation_jobs'), 0);
});

test('bounded comparison keeps actionable differences when full JSON values require truncation', async t => {
  const record = { text: 'x'.repeat(20000), count: 3 };
  const h = await harness(t, { input: { record }, content: JSON.stringify({ ...record, count: 0 }) });
  const q = repair(h), comparison = h.api.designContext({ requestId: q.id, includeSkills: false }).outcomeRepair.comparison;
  assert.equal(comparison.expected.truncated, true); assert.equal(comparison.observed.truncated, true);
  assert.equal(Object.hasOwn(comparison.expected, 'value'), false);
  assert.equal(Object.hasOwn(comparison.observed, 'value'), false);
  assert.deepEqual(comparison.differences.entries.map(entry => entry.path), ['/count']);
  assert.equal(comparison.differences.entries[0].expected.value, 3);
  assert.equal(comparison.differences.entries[0].observed.value, 0);
  assert.equal(h.api.contract(h.contract.id).expected.text.length, 20000);
  assert.ok(Buffer.byteLength(JSON.stringify(comparison)) < 6000);
});

test('comparison encodes missing keys and array differences with bounded escaped JSON pointers', async t => {
  const record = { 'a/b~': [1, 2], missing: null };
  const h = await harness(t, { input: { record }, content: JSON.stringify({ 'a/b~': [1, 4], extra: true }) });
  const comparison = h.api.designContext({ requestId: repair(h).id, includeSkills: false }).outcomeRepair.comparison;
  assert.deepEqual(comparison.differences.entries.map(entry => entry.path), ['/a~1b~0/1', '/extra', '/missing']);
  assert.equal(comparison.differences.entries[0].expected.value, 2);
  assert.equal(comparison.differences.entries[0].observed.value, 4);
  assert.equal(comparison.differences.entries[1].expected.present, false);
  assert.equal(comparison.differences.entries[2].observed.present, false);
  const many = await harness(t, { input: { record: Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`k${i}`, i])) }, content: '{}' });
  const limited = many.api.designContext({ requestId: repair(many).id, includeSkills: false }).outcomeRepair.comparison;
  assert.equal(limited.differences.entries.length, 16); assert.equal(limited.differences.truncated, true);
});

test('malformed observed JSON is exposed as bounded data while the expected value stays explicit', async t => {
  const h = await harness(t, { content: '{broken-json' }), q = repair(h);
  const comparison = h.api.designContext({ requestId: q.id, includeSkills: false }).outcomeRepair.comparison;
  assert.deepEqual(comparison.expected.value, input.record);
  assert.equal(comparison.observed.state, 'invalid-or-unsupported-json');
  assert.equal(comparison.observed.textPreview, '{broken-json');
  assert.equal(comparison.observed.sha256, h.observation.artifact.sha256);
  assert.equal(comparison.differences, null);
});

test('existing generator works only when explicitly invoked, with a supplied offline candidate and no model service', async t => {
  const h = await harness(t), q = repair(h); let calls = 0;
  const provider = { identity: { id: 'supplied-development-control-no-model' }, generate: async ({ prompt }) => {
    calls++; assert.match(prompt, /observed-outcome/); assert.match(prompt, /"observedRunStatus": "succeeded"/);
    const generatedContext = JSON.parse(prompt.slice(prompt.indexOf('\n\n') + 2, prompt.lastIndexOf('\n\nReturn exactly one JSON object')));
    assert.deepEqual(generatedContext.outcomeRepair.comparison.expected.value, input.record);
    assert.equal(generatedContext.outcomeRepair.comparison.observed.value.label, 'wrong');
    assert.equal(generatedContext.outcomeRepair.comparison.differences.entries.find(entry => entry.path === '/label').expected.value, 'requested');
    return { text: JSON.stringify({ workflow: candidate({ version: 2, correct: true }), rationale: 'Supplied deterministic generation adapter control; no model.' }) };
  } };
  const generator = new WorkflowGenerator(h.api.generationHost(), provider, { maxRounds: 1, autoApply: false });
  assert.equal(calls, 0); assert.deepEqual(h.store.pendingRequests(), []);
  const job = await generator.generate(q.id);
  assert.equal(calls, 1); assert.equal(job.status, 'proposed');
  assert.equal(h.store.workflow(h.workflow.id).hash, h.proposal.workflowHash);
  assert.equal(count(h.store, 'runs'), 1);
});

test('tampered repair metadata is rejected before candidate acceptance', async t => {
  const h = await harness(t), q = repair(h);
  mutateBody(h.store, 'requests', q.id, body => { body.rootRequestId = 'forged-root'; });
  assert.throws(() => h.api.designContext({ requestId: q.id }), { code: 'OUTCOME_EVIDENCE' });
  assert.throws(() => h.api.propose({ requestId: q.id, workflow: candidate({ version: 2 }), rationale: 'Adversarial repair metadata.' }), { code: 'OUTCOME_EVIDENCE' });
});
