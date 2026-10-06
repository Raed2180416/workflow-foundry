// Bounded independent review: in-memory supplied records and two existing observations.
// No Foundry/Store construction, workflow execution, artifact reads, or model calls.
// Usage: node check.mjs [--synthetic-only] [--write] --expected-source=SHA256
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const own = path.dirname(fileURLToPath(import.meta.url));
const study = path.dirname(own);
const product = path.resolve(study, '../../workflow-foundry');
const source = path.join(product, 'src/outcome-history.mjs');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const sorted = value => Array.isArray(value) ? value.map(sorted) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])])) : value;
const canonical = value => JSON.stringify(sorted(value));
const digest = value => sha(canonical(value));
const copy = value => JSON.parse(JSON.stringify(value));
const options = process.argv.slice(2);
assert.ok(options.every(arg => ['--synthetic-only', '--write'].includes(arg) || /^--expected-source=[a-f0-9]{64}$/.test(arg)));
const expectedSource = options.find(arg => arg.startsWith('--expected-source='))?.slice(18);
assert.match(expectedSource ?? '', /^[a-f0-9]{64}$/);
const inputHashes = new Map();
function bytes(filename) {
  const value = readFileSync(filename);
  inputHashes.set(filename, sha(value));
  return value;
}
const sourceHash = sha(bytes(source));
assert.equal(sourceHash, expectedSource, 'The exact reviewed source must be selected explicitly');
const startedAt = new Date().toISOString();
const { inspectOutcomeHistory } = await import(source);
const { OutcomeRepairCoordinator } = await import(path.join(product, 'src/outcome-repair.mjs'));
const evaluator = {
  id: 'independent-finite-record-control', kind: 'exact-json-artifact/2',
  implementationHash: sha(bytes(path.join(product, 'src/outcome-repair.mjs'))),
  dataImplementationHash: sha(bytes(path.join(product, 'src/data.mjs'))), node: process.version,
  comparison: 'Foundry canonical JSON: object order ignored, array order retained; bounded finite JS numbers'
};
const checks = [];
function check(name, fn) {
  try { checks.push({ name, passed: true, detail: fn() ?? null }); }
  catch (error) { checks.push({ name, passed: false, error: error.message.slice(0, 1200), code: error.code ?? null }); }
}

// This is a small supplied relational fixture, never a claimed native execution.
function fixture({ producers = ['record.json'], state = 'present', reason, location = 'artifact', observationError, ancestorIntentDrift } = {}) {
  const goal = 'Preserve the same requested JSON output across revisions.';
  const criteria = ['record.json equals the registered expected JSON'];
  const workflow = version => ({ id: 'finite-history-control', version, goal, envelope: { successCriteria: criteria },
    nodes: [{ id: 'publish', tool: 'core.artifact' }] });
  const workflows = [1, 2, 3].map(workflow);
  if (ancestorIntentDrift) for (const w of workflows.slice(1)) {
    if (ancestorIntentDrift === 'goal') w.goal = 'A different intermediate goal inherited by the final repair.';
    else if (ancestorIntentDrift === 'successCriteria') w.envelope = { successCriteria: ['Weaker intermediate criterion inherited by the final repair'] };
    else assert.fail('Unknown supplied intent-drift case');
  }
  const hashes = workflows.map(digest);
  const request = (id, version) => ({ id, text: goal, status: 'applied', workflowId: version ? workflows[0].id : null,
    baseHash: version ? hashes[version - 1] : null, ...(version ? { parentRequestId: `q${version - 1}`,
      rootRequestId: 'q0', appliedProposalId: `p${version - 1}`, goal: workflows[version - 1].goal,
      successCriteria: workflows[version - 1].envelope.successCriteria } : {}) });
  const requests = [0, 1, 2].map(i => request(`q${i}`, i));
  const proposals = workflows.map((w, i) => ({ id: `p${i}`, requestId: `q${i}`, status: 'applied',
    baseHash: i ? hashes[i - 1] : null, workflow: w, workflowHash: hashes[i] }));
  const data = Buffer.from('{"ok":true}');
  const run = { id: 'finite-run', workflowId: workflows[2].id, workflowHash: hashes[2], status: 'succeeded', owner: null,
    error: null, input: { ok: true }, registryHash: '1'.repeat(64), engineHash: '2'.repeat(64), policy: { maxSteps: 12 } };
  const events = [];
  const add = body => {
    const event = { seq: events.length + 1, at: 1000 + events.length,
      previousHash: events.at(-1)?.hash ?? null, ...body };
    events.push({ ...event, hash: digest(event) });
  };
  add({ type: 'run.created', workflowHash: run.workflowHash, registryHash: run.registryHash, engineHash: run.engineHash,
    inputHash: digest(run.input), policyHash: digest(run.policy) });
  producers.forEach((name, i) => {
    const nodeKey = `root/publish${i}`, args = { name, content: data.toString('utf8') };
    add({ type: 'tool.intent', nodeKey, tool: 'core.artifact', argsHash: digest(args),
      idempotencyKey: digest({ runId: run.id, nodeKey, workflowHash: run.workflowHash, args }) });
    const output = { name, bytes: data.length, sha256: sha(data) };
    add({ type: 'node.completed', nodeKey, output, outputHash: digest(output) });
  });
  add({ type: 'run.succeeded' });
  run.eventHead = { seq: events.length, hash: events.at(-1).hash };
  const contract = { schemaVersion: 'outcome-contract/1', rootRequestId: 'q0', rootTextHash: digest(goal),
    inputHash: digest(run.input), registryHash: run.registryHash, artifactName: 'record.json', expected: { ok: true },
    evaluator, maxBytes: 512 * 1024 };
  const contractId = digest(contract);
  const completed = events.filter(e => e.type === 'node.completed' && e.output.name === 'record.json')
    .map(e => ({ nodeKey: e.nodeKey, sequence: e.seq, eventHash: e.hash }));
  const binding = { requestId: 'q2', proposalId: 'p2', runId: run.id, rootRequestId: 'q0', requestHash: digest(requests[2]),
    proposalHash: digest(proposals[2]), rootRequestHash: digest(requests[0]), workflowId: run.workflowId,
    workflowHash: run.workflowHash, workflowVersion: 3, registryHash: run.registryHash, engineHash: run.engineHash,
    inputHash: digest(run.input), policyHash: digest(run.policy), eventHead: run.eventHead,
    eventCount: events.length, runStatus: run.status, runHash: digest(run) };
  const artifact = state === 'present'
    ? { name: 'record.json', state, bytes: data.length, sha256: sha(data), base64: data.toString('base64'), producers: completed }
    : { name: 'record.json', state, ...(reason ? { reason } : {}), bytes: null, sha256: null, base64: null, producers: completed,
      ...(state === 'absent' ? { absence: { method: 'lstat-ENOENT', location, noCompletedProducer: true } } : {}),
      ...(observationError ? { observationError } : {}) };
  const receipt = { schemaVersion: 'outcome-observation/2', contractId, binding, artifact,
    outcome: state === 'present' ? 'satisfied' : state === 'absent' ? 'unsatisfied' : 'unknown',
    reason: state === 'present' ? 'exact-json-match' : state === 'absent' ? 'required-artifact-absent' : reason,
    observedJsonHash: state === 'present' ? digest(contract.expected) : null, observedAt: 2000 };
  const tables = {
    requests: requests.map(r => ({ id: r.id, body: canonical(r) })),
    proposals: proposals.map(p => ({ id: p.id, body: canonical(p) })),
    runs: [{ id: run.id, body: canonical(run) }],
    workflows: workflows.map((w, i) => ({ id: w.id, hash: hashes[i], version: w.version, body: canonical(w) })),
    outcome_contracts: [{ id: contractId, body: canonical(contract), scope: digest(['q0', contract.inputHash, contract.artifactName]) }],
    outcome_observations: [{ id: digest(receipt), body: canonical(receipt), binding_key: digest({ requestId: 'q2', proposalId: 'p2', runId: run.id, contractId }) }],
    events: events.map(({ hash, ...e }) => ({ seq: e.seq, hash, body: canonical(e) }))
  };
  return { tables, queries: [], currentRegistryHash: run.registryHash };
}
function inspect(f, currentRegistryHash = f.currentRegistryHash) {
  const before = digest(f.tables);
  const db = { prepare(sql) {
    f.queries.push(sql);
    if (sql === 'SELECT seq,body,hash FROM events WHERE run_id=? ORDER BY seq LIMIT 100001') {
      return { all: id => { assert.equal(id, 'finite-run'); return copy(f.tables.events); } };
    }
    const m = /^SELECT \* FROM ([a-z_]+) WHERE (id|hash)=\?$/.exec(sql);
    assert.ok(m && Object.hasOwn(f.tables, m[1]), `Unexpected SQL: ${sql}`);
    return { get: id => copy(f.tables[m[1]].find(r => r[m[2]] === id) ?? null) };
  } };
  try { return inspectOutcomeHistory({ db }, { receiptId: f.tables.outcome_observations[0].id, currentRegistryHash }); }
  finally { assert.equal(digest(f.tables), before, 'Inspection mutated supplied rows'); }
}
function mutate(f, table, id, fn) {
  const row = f.tables[table].find(r => r.id === id), value = JSON.parse(row.body);
  fn(value); row.body = canonical(value);
}
function reseal(f, fn) {
  const row = f.tables.outcome_observations[0], value = JSON.parse(row.body);
  fn(value); row.body = canonical(value); row.id = digest(value);
}
const rejected = (fn, code = 'OUTCOME_HISTORY_EVIDENCE') => assert.throws(fn, e => e.code === code);

check('finite-three-request-lineage-positive-and-registry-scope', () => {
  const f = fixture(), first = inspect(f), changed = inspect(f, '0'.repeat(64));
  assert.equal(first.lineage.length, 3);
  assert.deepEqual(first.historicalAssessment, changed.historicalAssessment);
  assert.equal(changed.historicalAssessment.outcome, 'satisfied');
  assert.equal(first.currentEvidenceCheck.matchesRecordedRegistry, true);
  assert.equal(changed.currentEvidenceCheck.matchesRecordedRegistry, false);
  for (const result of [first, changed]) {
    assert.equal(result.currentWorldQualification, false);
    assert.equal(result.currentEvidenceCheck.status, 'unverified');
    assert.equal(result.currentEvidenceCheck.liveArtifactRead, false);
  }
  return { eventsPerInvocation: f.tables.events.length, recordOrigin: 'supplied in memory; never executed' };
});
check('ancestor-proposal-base-mismatch-must-be-rejected', () => {
  const f = fixture(); mutate(f, 'proposals', 'p1', p => { p.baseHash = '9'.repeat(64); });
  rejected(() => inspect(f));
});
check('current-proposal-base-mismatch-is-rejected', () => {
  const f = fixture(); mutate(f, 'proposals', 'p2', p => { p.baseHash = '9'.repeat(64); });
  rejected(() => inspect(f));
});
check('ancestor-applied-workflow-must-preserve-its-own-request-intent', () => {
  const dispositions = [];
  for (const field of ['goal', 'successCriteria']) {
    const f = fixture({ ancestorIntentDrift: field });
    try { inspect(f); dispositions.push({ field, rejected: false }); }
    catch (error) {
      assert.equal(error.code, 'OUTCOME_HISTORY_EVIDENCE');
      dispositions.push({ field, rejected: true });
    }
  }
  assert.ok(dispositions.every(d => d.rejected), JSON.stringify(dispositions));
  return dispositions;
});
check('history-id-is-rejected-by-existing-receipt-reader', () => {
  const h = inspect(fixture());
  assert.match(h.id, /^outcome-history:[a-f0-9]{64}$/);
  assert.equal(Object.hasOwn(h, 'outcomeReceiptId'), false);
  const inert = { store: { db: { prepare(sql) {
    assert.match(sql, /^SELECT /);
    return { get() { assert.fail('History ID executed a receipt SELECT'); } };
  } } } };
  assert.throws(() => OutcomeRepairCoordinator.prototype.receipt.call(inert, h.id), e => e.code === 'OUTCOME_ARGUMENT');
  return { scope: 'Existing receipt identifier gate; no coordinator constructor or repair operation invoked' };
});
check('repeated-and-different-filename-producers-are-retained', () => {
  const f = fixture({ producers: ['record.json', 'other.json', 'record.json'] }), h = inspect(f);
  assert.deepEqual(h.historicalAssessment.completedArtifacts.map(p => p.output.name), ['record.json', 'other.json', 'record.json']);
  reseal(f, r => { r.artifact.producers.pop(); }); rejected(() => inspect(f));
});
check('absent-target-with-other-producer-is-recorded-only', () => {
  const f = fixture({ producers: ['other.json'], state: 'absent' }), h = inspect(f);
  assert.equal(h.historicalAssessment.outcome, 'unsatisfied');
  assert.equal(h.historicalAssessment.basis, 'recorded-observer-evidence-only');
  assert.equal(h.historicalAssessment.completedArtifacts[0].output.name, 'other.json');
  reseal(f, r => { r.artifact.absence.location = 'run-directory'; }); rejected(() => inspect(f));
});
check('lost-directory-after-other-producer-stays-unknown', () => {
  const f = fixture({ producers: ['other.json'], state: 'unavailable', reason: 'recorded-artifact-directory-missing' });
  const h = inspect(f); assert.equal(h.historicalAssessment.outcome, 'unknown');
  assert.equal(h.historicalAssessment.basis, 'recorded-observer-evidence-only');
  reseal(f, r => { r.outcome = 'unsatisfied'; }); rejected(() => inspect(f));
});
check('lost-target-and-observer-access-error-stay-unknown', () => {
  for (const f of [fixture({ state: 'unavailable', reason: 'recorded-artifact-missing' }),
    fixture({ producers: [], state: 'unavailable', reason: 'observer-unavailable', observationError: 'EACCES' })]) {
    assert.equal(inspect(f).historicalAssessment.outcome, 'unknown');
  }
});
check('rehashed-preserved-bytes-contradiction-is-rejected', () => {
  const f = fixture(); reseal(f, r => { r.artifact.base64 = Buffer.from('{}').toString('base64'); });
  rejected(() => inspect(f));
});
check('rehashed-evaluator-source-data-node-and-kind-drift-is-rejected', () => {
  for (const field of ['implementationHash', 'dataImplementationHash', 'node', 'kind', 'comparison']) {
    const f = fixture(), row = f.tables.outcome_contracts[0], c = JSON.parse(row.body);
    c.evaluator[field] = 'unsupported'; row.id = digest(c); row.body = canonical(c);
    reseal(f, r => { r.contractId = row.id; });
    const r = JSON.parse(f.tables.outcome_observations[0].body);
    f.tables.outcome_observations[0].binding_key = digest({ requestId: r.binding.requestId, proposalId: r.binding.proposalId, runId: r.binding.runId, contractId: r.contractId });
    rejected(() => inspect(f), 'OUTCOME_HISTORY_EVALUATOR');
  }
});
check('truncated-event-chain-is-rejected', () => {
  const f = fixture(); f.tables.events.pop(); rejected(() => inspect(f));
});

const actual = [];
if (!options.includes('--synthetic-only')) check('two-existing-wrong-right-observations-read-only', () => {
  const base = path.join(study, 'benchmark/outcome-model-001');
  const db = new DatabaseSync(path.join(base, 'workspace/.foundry/foundry.sqlite'), { readOnly: true });
  const queries = [];
  try {
    const store = { db: { prepare(sql) {
      assert.match(sql, /^SELECT\b/); queries.push(sql);
      const q = db.prepare(sql); return { get: (...args) => q.get(...args), all: (...args) => q.all(...args) };
    } } };
    for (const [filename, outcome, changedRegistry] of [['WRONG_OBSERVATION.json', 'unsatisfied', true], ['SATISFIED_OBSERVATION.json', 'satisfied', false]]) {
      const r = JSON.parse(bytes(path.join(base, filename)));
      const currentRegistryHash = changedRegistry ? '0'.repeat(64) : r.binding.registryHash;
      const h = inspectOutcomeHistory(store, { receiptId: r.id, currentRegistryHash });
      assert.equal(h.historicalAssessment.outcome, outcome);
      assert.deepEqual(h.binding, r.binding);
      assert.equal(h.currentWorldQualification, false);
      assert.equal(h.currentEvidenceCheck.status, 'unverified');
      assert.equal(h.currentEvidenceCheck.matchesRecordedRegistry, !changedRegistry);
      actual.push({ filename, observationId: r.id, resultId: h.id, outcome, eventCount: h.binding.eventCount,
        lineageLength: h.lineage.length, resultDigest: digest(h), currentRegistryChangedOnlyAsSuppliedMetadata: changedRegistry });
    }
    assert.equal(db.prepare('SELECT total_changes() AS n').get().n, 0);
    return { observations: actual, inspectorSelects: queries.length, readOnly: true,
      liveArtifactReads: 0, newWorkflowRuns: 0 };
  } finally { db.close(); }
});
check('reviewed-source-and-inputs-still-identical', () => {
  for (const [filename, expected] of inputHashes) assert.equal(sha(readFileSync(filename)), expected, filename);
});
const failed = checks.filter(c => !c.passed);
const result = {
  schemaVersion: 'independent-outcome-history-review/1', reviewer: 'worker-6', startedAt, finishedAt: new Date().toISOString(),
  verdict: failed.length ? 'BLOCKED_BY_FINITE_EVIDENCE_CHECK' : 'PASS_BOUNDED_HISTORY_REVIEW',
  source: { path: source, sha256: sourceHash }, node: process.version, checks, checkCount: checks.length,
  passedChecks: checks.length - failed.length, failedChecks: failed.length, actual,
  originalReleaseFindings: {
    sourceSha256: '023921bb5bd99982c821b9fc9ec28e68763f8344ea53e57c824e6e0608f75610', lines: 151,
    provenance: 'Observed checker output before the source-author correction; not inferred from the revised source.',
    firstRun: { checkCount: 12, passedChecks: 10,
      sourceFailure: 'ancestor-proposal-base-mismatch-must-be-rejected: Missing expected exception.',
      harnessFailure: 'History ID reached receipt SQL: the independent checker incorrectly prohibited prepare, rather than get execution.' },
    correctedOriginalRun: { checkCount: 13, passedChecks: 11,
      failures: [
        { id: 'H1', check: 'ancestor-proposal-base-mismatch-must-be-rejected', observed: 'Missing expected exception.' },
        { id: 'H2', check: 'ancestor-applied-workflow-must-preserve-its-own-request-intent',
          observed: [{ field: 'goal', rejected: false }, { field: 'successCriteria', rejected: false }] }
      ] },
    claimBoundary: 'Supplied in-memory relational counterexamples. No actual campaign corruption or repair-authority bypass is asserted.'
  },
  operations: { nativeRuns: 0, modelCalls: 0, trainingUpdates: 0, oldEdits: 0,
    artifactFilesystemReads: 0, database: 'SELECT-only through readOnly connection when saved observations are enabled',
    finiteFixtures: 'Supplied relational records in memory; not observations of executed workflows' },
  limitations: ['The host, database and source loader remain trusted.', 'Current evidence and qualification remain unverified.',
    'Finite checks do not prove arbitrary record correctness or DB-administrator resistance.'],
  tooling: { serena: 'initial_instructions failed HTTP 404 tunnel_client_not_seen',
    initialInlineProbe: 'Two dispatches blocked before execution: tool could not determine safety status' },
  inputHashes: [...inputHashes].map(([path, sha256]) => ({ path, sha256 })), checkerSha256: sha(readFileSync(fileURLToPath(import.meta.url)))
};
if (options.includes('--write')) writeFileSync(path.join(own, 'AUDIT.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ verdict: result.verdict, sourceSha256: sourceHash, checkCount: checks.length,
  passedChecks: result.passedChecks, failures: failed, actual, auditWritten: options.includes('--write') }, null, 2));
if (failed.length) process.exitCode = 1;
