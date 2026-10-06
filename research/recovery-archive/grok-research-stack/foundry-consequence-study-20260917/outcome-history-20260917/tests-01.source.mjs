import test from 'node:test';
import assert from 'node:assert/strict';
import fs, { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
import { Foundry } from '../src/foundry.mjs';
import { OutcomeRepairCoordinator } from '../src/outcome-repair.mjs';
import { inspectOutcomeHistory } from '../src/outcome-history.mjs';
import { canonical, clone, digest } from '../src/data.mjs';

const task = 'Write record.json containing the exact input record.';
const input = { record: { label: 'requested', count: 3 } };
function workflow({ version = 1, correct = false, name = 'record.json', content, writes = true, repeat = false, failed = false } = {}) {
  const result = { schemaVersion: '1.0', id: 'history-control', version, title: 'Supplied historical observation control', goal: task, domain: 'software',
    envelope: { assumptions: ['Local JSON output'], risks: ['Wrong values'], successCriteria: [task], unsupported: ['External outcomes'] },
    inputSchema: { type: 'object', required: ['record'], properties: { record: {} }, additionalProperties: false },
    budget: { maxSteps: 8, maxConcurrency: 1, maxDurationMs: 15000, maxCost: 0 },
    nodes: [
      { id: 'encode', kind: 'task', needs: [], description: 'Encode the selected data.', tool: 'core.json',
        args: { value: correct ? { $ref: 'input.record' } : { label: 'wrong', count: 0 } }, timeoutMs: 1000, retry: { maxAttempts: 1 } },
      { id: 'file', kind: 'task', needs: ['encode'], description: 'Write a run artifact.', tool: 'core.artifact',
        args: { name, content: content ?? { $ref: 'nodes.encode.text' } }, timeoutMs: 1000, retry: { maxAttempts: 1 } }
    ], acceptance: [{ op: 'exists', value: { $ref: 'nodes.encode.text' } }] };
  if (!writes) result.nodes.pop();
  if (repeat) result.nodes.push({ ...clone(result.nodes[1]), id: 'again', needs: ['encode', 'file'] });
  if (failed) result.acceptance = [{ op: 'eq', left: { $ref: 'nodes.encode.text' }, right: 'deliberate failure' }];
  return result;
}
const evidenceRoot = process.env.FOUNDRY_HISTORY_EVIDENCE;
async function fixture(t, options = {}) {
  if (evidenceRoot) mkdirSync(evidenceRoot, { recursive: true });
  const workspace = mkdtempSync(path.join(evidenceRoot ?? tmpdir(), 'foundry-history-'));
  const foundry = new Foundry(workspace), store = foundry.store, coordinator = new OutcomeRepairCoordinator(foundry);
  t.after(async () => { await foundry.close(); if (!evidenceRoot) rmSync(workspace, { recursive: true, force: true }); });
  const request = store.createRequest({ text: task }), sample = options.input ?? input;
  const contractArgs = { requestId: request.id, input: sample, artifactName: 'record.json', expected: sample.record, evaluatorId: 'supplied-history-control' };
  const contract = coordinator.registerContract(contractArgs), program = workflow(options);
  const proposal = foundry.propose({ requestId: request.id, workflow: program, rationale: 'Explicit supplied control; no model.' });
  foundry.apply(proposal.id);
  const run = await foundry.startRun(foundry.createRun(program.id, sample).id);
  assert.equal(run.status, options.failed ? 'failed' : 'succeeded');
  const observeArgs = { requestId: request.id, proposalId: proposal.id, runId: run.id, contractId: contract.id };
  const h = { workspace, foundry, store, coordinator, request, contract, contractArgs, proposal, run, program, observeArgs,
    file: path.join(store.directory, 'artifacts', run.id, 'record.json') };
  if (options.observe !== false) h.receipt = coordinator.observe(observeArgs);
  h.inspect = (receiptId = h.receipt.id, currentRegistryHash = foundry.registry.hash()) => inspectOutcomeHistory(store, { receiptId, currentRegistryHash });
  h.repairArgs = () => ({ receiptId: h.receipt.id, requestId: request.id, runId: run.id, expectedHash: proposal.workflowHash });
  return h;
}
function addUnused(h) {
  h.foundry.registry.register({ name: 'history.unused', description: 'Unused pure local control', version: '1', inputSchema: {}, outputSchema: {},
    effects: 'none', risk: 'low', requiresApproval: false, maxTimeoutMs: 1000, cost: 0, execute: async args => args });
}
function snapshot(db) {
  const schema = db.prepare("SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all();
  return { schema, tables: Object.fromEntries(schema.filter(r => r.type === 'table').map(r =>
    [r.name, db.prepare(`SELECT * FROM ${r.name} ORDER BY rowid`).all()])) };
}
function mutate(h, table, id, change, key = 'id') {
  if (table.startsWith('outcome_')) h.store.db.exec(`DROP TRIGGER IF EXISTS ${table}_no_update`);
  const saved = h.store.db.prepare(`SELECT body FROM ${table} WHERE ${key}=?`).get(id);
  const body = JSON.parse(saved.body); change(body);
  h.store.db.prepare(`UPDATE ${table} SET body=? WHERE ${key}=?`).run(canonical(body), id);
}
// Rehashed corruptions test semantic cross-checks beyond a trivial changed digest.
// The disposable test DB is deliberately writable; this is not DB-admin resistance.
function rehashReceipt(h, change, contractChange) {
  const body = JSON.parse(h.store.db.prepare('SELECT body FROM outcome_observations WHERE id=?').get(h.receipt.id).body);
  if (contractChange) {
    const c = JSON.parse(h.store.db.prepare('SELECT body FROM outcome_contracts WHERE id=?').get(body.contractId).body);
    contractChange(c); const id = digest(c);
    h.store.db.exec('DROP TRIGGER IF EXISTS outcome_contracts_no_update');
    h.store.db.prepare('UPDATE outcome_contracts SET id=?,body=?,scope=? WHERE id=?').run(id, canonical(c), digest([c.rootRequestId, c.inputHash, c.artifactName]), body.contractId);
    body.contractId = id;
  }
  change(body); const id = digest(body), b = body.binding;
  h.store.db.exec('DROP TRIGGER IF EXISTS outcome_observations_no_update');
  h.store.db.prepare('UPDATE outcome_observations SET id=?,body=?,binding_key=? WHERE id=?').run(id, canonical(body),
    digest({ requestId: b.requestId, proposalId: b.proposalId, runId: b.runId, contractId: body.contractId }), h.receipt.id);
  return id;
}
const evidenceError = { code: 'OUTCOME_HISTORY_EVIDENCE' };

test('historical negative survives unused registry addition while existing verification and repair stay blocked', async t => {
  const h = await fixture(t), before = h.inspect(); addUnused(h);
  const state = snapshot(h.store.db), total = h.store.db.prepare('SELECT total_changes() AS n').get().n;
  const history = h.inspect();
  assert.deepEqual(history.historicalAssessment, before.historicalAssessment);
  assert.equal(history.historicalAssessment.outcome, 'unsatisfied');
  assert.equal(history.historicalAssessment.basis, 'recomputed-from-preserved-bytes');
  assert.equal(history.currentEvidenceCheck.matchesRecordedRegistry, false);
  assert.equal(history.currentEvidenceCheck.status, 'unverified');
  assert.equal(history.currentWorldQualification, false);
  assert.deepEqual(history.binding, h.receipt.binding);
  assert.equal(h.coordinator.receipt(h.receipt.id).id, h.receipt.id);
  assert.throws(() => h.coordinator.verify(h.receipt.id), { code: 'OUTCOME_CONTRACT_BINDING' });
  assert.throws(() => h.coordinator.requestRepair(h.repairArgs()), { code: 'OUTCOME_CONTRACT_BINDING' });
  assert.throws(() => h.coordinator.registerContract(h.contractArgs), { code: 'OUTCOME_CONTRACT_CONFLICT' });
  assert.deepEqual(snapshot(h.store.db), state);
  assert.equal(h.store.db.prepare('SELECT total_changes() AS n').get().n, total);
  if (evidenceRoot) writeFileSync(path.join(h.workspace, 'HISTORY.json'), JSON.stringify(history, null, 2) + '\n', { flag: 'wx' });
});

test('history has an inspection-only namespaced ID, repeatable result and no repair receipt field', async t => {
  const h = await fixture(t), report = h.inspect();
  assert.match(report.id, /^outcome-history:[a-f0-9]{64}$/);
  const { id, ...body } = report; assert.equal(id, `outcome-history:${digest(body)}`);
  assert.deepEqual(h.inspect(), report); assert.equal(JSON.stringify(report).includes('outcomeReceiptId'), false);
  assert.throws(() => h.coordinator.requestRepair({ ...h.repairArgs(), receiptId: id }), { code: 'OUTCOME_ARGUMENT' });
  assert.throws(() => h.coordinator.requestRepair({ ...h.repairArgs(), receiptId: report }), { code: 'OUTCOME_ARGUMENT' });
  assert.throws(() => h.coordinator.requestRepair({ ...h.repairArgs(), receiptId: digest(body) }), { code: 'OUTCOME_RECEIPT' });
  report.historicalAssessment.goal = 'Changed output object';
  assert.equal(h.inspect().historicalAssessment.goal, task);
  assert.equal(h.store.db.prepare('SELECT COUNT(*) AS n FROM outcome_repairs').get().n, 0);
});

test('SELECT-only inspector works through an actual read-only SQLite connection with no Store constructor', async t => {
  const h = await fixture(t), db = new DatabaseSync(path.join(h.store.directory, 'foundry.sqlite'), { readOnly: true });
  try {
    const sql = [], store = { db: { prepare: query => { sql.push(query); assert.match(query, /^SELECT /); return db.prepare(query); } } };
    const before = snapshot(db), report = inspectOutcomeHistory(store, { receiptId: h.receipt.id, currentRegistryHash: h.foundry.registry.hash() });
    assert.equal(report.historicalAssessment.outcome, 'unsatisfied'); assert.ok(sql.length > 5);
    assert.deepEqual(snapshot(db), before);
    assert.equal(db.prepare('SELECT total_changes() AS n').get().n, 0);
  } finally { db.close(); }
});

test('missing outcome tables or records do not initialize a schema or manufacture an observation', async t => {
  const workspace = mkdtempSync(path.join(tmpdir(), 'history-empty-')), foundry = new Foundry(workspace);
  try {
    const before = snapshot(foundry.store.db);
    assert.throws(() => inspectOutcomeHistory(foundry.store, { receiptId: '0'.repeat(64), currentRegistryHash: foundry.registry.hash() }));
    assert.deepEqual(snapshot(foundry.store.db), before);
  } finally { await foundry.close(); rmSync(workspace, { recursive: true, force: true }); }
  const h = await fixture(t);
  assert.throws(() => h.inspect('0'.repeat(64)), { code: 'OUTCOME_HISTORY_MISSING' });
});

test('live artifact edits or deletion leave historical predicate valid with current evidence unverified', async t => {
  const h = await fixture(t), original = h.inspect();
  writeFileSync(h.file, JSON.stringify(input.record));
  assert.deepEqual(h.inspect(), original);
  assert.throws(() => h.coordinator.verify(h.receipt.id), { code: 'OUTCOME_EVIDENCE' });
  unlinkSync(h.file); assert.deepEqual(h.inspect(), original);
  assert.equal(original.currentEvidenceCheck.liveArtifactRead, false);
  assert.equal(original.currentEvidenceCheck.matchesRecordedRegistry, true);
  assert.equal(original.currentWorldQualification, false);
});

test('inspector never probes current artifacts even when all filesystem artifact operations throw', async t => {
  const h = await fixture(t), mocks = [];
  for (const name of ['readFileSync', 'lstatSync', 'realpathSync', 'openSync']) {
    mocks.push(t.mock.method(fs, name, () => { assert.fail(`Unexpected live filesystem call: ${name}`); }));
  }
  syncBuiltinESMExports();
  try { assert.equal(h.inspect().historicalAssessment.outcome, 'unsatisfied'); }
  finally { for (const mock of mocks) mock.mock.restore(); syncBuiltinESMExports(); }
});

test('historical assessments retain v2 JSON equality and invalid/unsupported data semantics', async t => {
  for (const [label, options, outcome, reason] of [
    ['key order', { content: '{ "count": 3, "label": "requested" }' }, 'satisfied', 'exact-json-match'],
    ['array order', { input: { record: [1, 2] }, content: '[2,1]' }, 'unsatisfied', 'json-content-mismatch'],
    ['null', { input: { record: null }, content: 'null' }, 'satisfied', 'exact-json-match'],
    ['invalid JSON', { content: '{broken' }, 'unsatisfied', 'invalid-or-unsupported-json'],
    ['unsupported key', { content: '{"constructor":true}' }, 'unsatisfied', 'invalid-or-unsupported-json'],
    ['overflow JSON number', { content: '1e999' }, 'unsatisfied', 'invalid-or-unsupported-json'],
    ['terminal failed', { failed: true }, 'unsatisfied', 'json-content-mismatch']
  ]) await t.test(label, async t => {
    const h = await fixture(t, options), result = h.inspect().historicalAssessment;
    assert.equal(result.outcome, outcome); assert.equal(result.reason, reason);
    assert.equal(result.observedJsonHash, h.receipt.observedJsonHash);
    assert.equal(h.inspect().currentWorldQualification, false);
  });
});

test('all repeated completed producers are retained and checked against preserved bytes', async t => {
  const h = await fixture(t, { repeat: true }), history = h.inspect();
  assert.equal(history.historicalAssessment.completedArtifacts.length, 2);
  const id = rehashReceipt(h, r => { r.artifact.producers.pop(); });
  assert.throws(() => h.inspect(id), evidenceError);
});

test('confirmed absence is reported only as recorded evidence, including the different-filename distinction', async t => {
  for (const options of [{ writes: false }, { name: 'different.json' }]) await t.test(options.name ?? 'no producers', async t => {
    const h = await fixture(t, options), report = h.inspect();
    assert.equal(report.historicalAssessment.outcome, 'unsatisfied');
    assert.equal(report.historicalAssessment.basis, 'recorded-observer-evidence-only');
    assert.equal(report.historicalAssessment.artifact.state, 'absent');
    assert.equal(report.historicalAssessment.completedArtifacts.length, options.writes === false ? 0 : 1);
    if (options.name) {
      assert.equal(report.historicalAssessment.completedArtifacts[0].output.name, 'different.json');
      const id = rehashReceipt(h, r => { r.artifact.absence.location = 'run-directory'; });
      assert.throws(() => h.inspect(id), evidenceError);
    } else {
      mkdirSync(path.dirname(h.file), { recursive: true }); writeFileSync(h.file, JSON.stringify(input.record));
      assert.deepEqual(h.inspect(), report);
    }
  });
});

test('lost producer bytes and lost directory after another producer remain unknown when physical files change', async t => {
  for (const name of ['record.json', 'different.json']) await t.test(name, async t => {
    const h = await fixture(t, { name, observe: false });
    rmSync(path.dirname(h.file), { recursive: true }); h.receipt = h.coordinator.observe(h.observeArgs);
    const report = h.inspect(); assert.equal(report.historicalAssessment.outcome, 'unknown');
    assert.equal(report.historicalAssessment.basis, 'recorded-observer-evidence-only');
    assert.equal(report.historicalAssessment.completedArtifacts.length, 1);
    assert.equal(report.historicalAssessment.reason, name === 'record.json' ? 'recorded-artifact-missing' : 'recorded-artifact-directory-missing');
    mkdirSync(path.dirname(h.file)); writeFileSync(h.file, JSON.stringify(input.record));
    assert.deepEqual(h.inspect(), report);
    const id = rehashReceipt(h, r => { r.outcome = 'unsatisfied'; r.reason = 'required-artifact-absent';
      r.artifact = { name: 'record.json', state: 'absent', bytes: null, sha256: null, base64: null, producers: [],
        absence: { method: 'lstat-ENOENT', location: 'run-directory', noCompletedProducer: true } }; });
    assert.throws(() => h.inspect(id), evidenceError);
  });
});

test('unavailable filesystem observer stays unknown after accessibility returns', async t => {
  const h = await fixture(t, { observe: false }), lstat = fs.lstatSync;
  const mock = t.mock.method(fs, 'lstatSync', (target, ...args) => {
    if (target === h.file) throw Object.assign(new Error('Supplied access failure'), { code: 'EACCES' });
    return lstat(target, ...args);
  });
  syncBuiltinESMExports();
  try { h.receipt = h.coordinator.observe(h.observeArgs); }
  finally { mock.mock.restore(); syncBuiltinESMExports(); }
  const report = h.inspect();
  assert.equal(report.historicalAssessment.outcome, 'unknown'); assert.equal(report.historicalAssessment.reason, 'observer-unavailable');
  assert.equal(report.currentEvidenceCheck.status, 'unverified');
  const id = rehashReceipt(h, r => { r.artifact.observationError = 'INVENTED'; });
  assert.throws(() => h.inspect(id), evidenceError);
});

test('full same-goal repair lineage remains inspectable after later versions and registry changes', async t => {
  const h = await fixture(t), rootHistory = h.inspect(), repair = h.coordinator.requestRepair(h.repairArgs());
  const p = h.coordinator.propose({ requestId: repair.id, workflow: workflow({ version: 2, correct: true }), rationale: 'Supplied correction.' });
  h.coordinator.apply(p.id);
  const run = await h.foundry.startRun(h.foundry.createRun(h.program.id, input).id);
  const receipt = h.coordinator.observe({ requestId: repair.id, proposalId: p.id, runId: run.id, contractId: h.contract.id });
  addUnused(h);
  assert.deepEqual(h.inspect().historicalAssessment, rootHistory.historicalAssessment);
  const report = h.inspect(receipt.id);
  assert.equal(report.historicalAssessment.outcome, 'satisfied'); assert.equal(report.lineage.length, 2);
  assert.equal(report.lineage[0].parentRequestId, h.request.id); assert.equal(report.binding.rootRequestId, h.request.id);
  mutate(h, 'requests', repair.id, r => { r.goal = 'Changed goal'; });
  assert.throws(() => h.inspect(receipt.id), evidenceError);
});

test('tampered receipt, contract, request, proposal, workflow, run and event identities are rejected', async t => {
  const cases = [
    ['receipt bytes', h => mutate(h, 'outcome_observations', h.receipt.id, r => { r.artifact.base64 = Buffer.from('{}').toString('base64'); })],
    ['contract expectation', h => mutate(h, 'outcome_contracts', h.contract.id, c => { c.expected = {}; })],
    ['request goal text', h => mutate(h, 'requests', h.request.id, q => { q.text = 'Changed task'; })],
    ['request ID', h => mutate(h, 'requests', h.request.id, q => { q.id = 'forged'; })],
    ['proposal goal', h => mutate(h, 'proposals', h.proposal.id, p => { p.workflow.goal = 'Different goal'; })],
    ['workflow criteria', h => mutate(h, 'workflows', h.proposal.workflowHash, w => { w.envelope.successCriteria = ['weaker']; }, 'hash')],
    ['run input', h => mutate(h, 'runs', h.run.id, r => { r.input.record.count = 100; })],
    ['run status', h => mutate(h, 'runs', h.run.id, r => { r.status = 'waiting'; })],
    ['event bytes', h => h.store.db.prepare("UPDATE events SET body='{}' WHERE run_id=? AND seq=2").run(h.run.id)],
    ['event truncation', h => h.store.db.prepare('DELETE FROM events WHERE run_id=? AND seq=?').run(h.run.id, h.run.eventHead.seq)],
    ['receipt row binding', h => { h.store.db.exec('DROP TRIGGER outcome_observations_no_update'); h.store.db.prepare('UPDATE outcome_observations SET binding_key=? WHERE id=?').run('wrong', h.receipt.id); }],
    ['contract scope', h => { h.store.db.exec('DROP TRIGGER outcome_contracts_no_update'); h.store.db.prepare('UPDATE outcome_contracts SET scope=? WHERE id=?').run('wrong', h.contract.id); }]
  ];
  for (const [name, modify] of cases) await t.test(name, async t => {
    const h = await fixture(t); modify(h); const before = snapshot(h.store.db);
    assert.throws(() => h.inspect(), evidenceError); assert.deepEqual(snapshot(h.store.db), before);
  });
});

test('rehashing a changed receipt cannot hide byte, assessment, producer, or cross-run contradictions', async t => {
  for (const [name, change] of [
    ['assessment', r => { r.outcome = 'satisfied'; }],
    ['JSON hash', r => { r.observedJsonHash = '0'.repeat(64); }],
    ['noncanonical base64', r => { r.artifact.base64 += '\n'; }],
    ['forged matching bytes', r => { const bytes = Buffer.from(JSON.stringify(input.record)); r.artifact.base64 = bytes.toString('base64'); r.artifact.bytes = bytes.length; r.artifact.sha256 = '0'.repeat(64); }],
    ['producer output omitted', r => { r.artifact.producers = []; }],
    ['event head', r => { r.binding.eventHead.hash = '0'.repeat(64); }],
    ['workflow version', r => { r.binding.workflowVersion++; }],
    ['unknown changed to success', r => { r.artifact.state = 'unavailable'; r.artifact.reason = 'recorded-artifact-missing'; r.artifact.bytes = null; r.artifact.sha256 = null; r.artifact.base64 = null; r.outcome = 'satisfied'; }]
  ]) await t.test(name, async t => {
    const h = await fixture(t), id = rehashReceipt(h, change); assert.throws(() => h.inspect(id), evidenceError);
  });
  await t.test('cross run', async t => {
    const h = await fixture(t), other = await h.foundry.startRun(h.foundry.createRun(h.program.id, input).id);
    const id = rehashReceipt(h, r => { r.binding.runId = other.id; }); assert.throws(() => h.inspect(id), evidenceError);
  });
});

test('historical source/data/node and comparison identity must exactly match the pinned observer', async t => {
  for (const field of ['implementationHash', 'dataImplementationHash', 'node', 'kind', 'comparison']) await t.test(field, async t => {
    const h = await fixture(t), id = rehashReceipt(h, () => {}, c => { c.evaluator[field] = 'changed'; });
    assert.throws(() => h.inspect(id), { code: 'OUTCOME_HISTORY_EVALUATOR' });
  });
});

test('changed local observer source is rejected by a fresh isolated import without running a workflow', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'history-source-'));
  try {
    for (const name of ['outcome-history.mjs', 'outcome-repair.mjs', 'data.mjs']) {
      writeFileSync(path.join(directory, name), readFileSync(new URL(`../src/${name}`, import.meta.url)));
    }
    writeFileSync(path.join(directory, 'outcome-repair.mjs'), '\n// changed observer source\n', { flag: 'a' });
    const code = `import {inspectOutcomeHistory} from ${JSON.stringify(new URL(`file://${directory}/outcome-history.mjs`).href)};
      try { inspectOutcomeHistory({db:{prepare(){throw Error('unexpected database access')}}},{receiptId:'0'.repeat(64),currentRegistryHash:'0'.repeat(64)}); process.exitCode=1; }
      catch(error){ console.log(error.code); if(error.code!=='OUTCOME_HISTORY_EVALUATOR')process.exitCode=2; }`;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', timeout: 5000, env: { PATH: '/usr/bin:/bin', NODE_NO_WARNINGS: '1' } });
    assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout.trim(), 'OUTCOME_HISTORY_EVALUATOR');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('invalid or history IDs and absent current registry hashes are rejected before database access', () => {
  const store = { db: { prepare() { assert.fail('Unexpected database access'); } } };
  for (const args of [{}, { receiptId: 'outcome-history:' + '0'.repeat(64), currentRegistryHash: '0'.repeat(64) },
    { receiptId: '0'.repeat(64) }, { receiptId: {}, currentRegistryHash: '0'.repeat(64) }]) {
    assert.throws(() => inspectOutcomeHistory(store, args), { code: 'OUTCOME_HISTORY_ARGUMENT' });
  }
});
