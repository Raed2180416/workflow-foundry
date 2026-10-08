import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { canonical, clone, digest, checkData, FoundryError } from './data.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const same = (a, b) => canonical(a) === canonical(b);
const maxBytes = 512 * 1024;
const pins = Object.freeze({
  'outcome-repair.mjs': '8de15af4b6ce842c3e54039531c651472a9079a231bf31390f4a8f95b924f1fd',
  'data.mjs': '50049ae8819aa022481faafb435f2887d94fa669ceef1b6375c8d4a664e7680c'
});
// Capture the inspected source identities alongside the loaded module. No artifact reads.
const loaded = Object.fromEntries(Object.keys(pins).map(name => [name, sha(readFileSync(new URL(name, import.meta.url)))]));
const implementationHash = sha(readFileSync(new URL(import.meta.url)));
const requireEvidence = (condition, message, code = 'OUTCOME_HISTORY_EVIDENCE') => {
  if (!condition) throw new FoundryError(code, message);
};
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const identifier = value => typeof value === 'string' && value.length > 0 && value.length <= 1000;

/** Inspect retained evidence using SELECTs only. Store may expose only a read-only db.
 * No schema initialization, transaction mutation, live filesystem probe, or authority.
 * The host/DB and source loader remain trusted; hashes are not remote attestation. */
export function inspectOutcomeHistory(store, { receiptId, currentRegistryHash } = {}) {
  requireEvidence(store?.db?.prepare && hash(receiptId) && hash(currentRegistryHash), 'Existing Store and exact receipt/current registry hashes required', 'OUTCOME_HISTORY_ARGUMENT');
  requireEvidence(same(loaded, pins), 'Loaded observer/data sources differ from the supported pinned semantics', 'OUTCOME_HISTORY_EVALUATOR');
  const parse = text => {
    requireEvidence(typeof text === 'string' && Buffer.byteLength(text) <= 16 * 1024 * 1024, 'Historical record exceeds the supported bound');
    const value = JSON.parse(text); checkData(value, { maxBytes: 16 * 1024 * 1024 }); return value;
  };
  const row = (table, id, column = 'id') => {
    requireEvidence(identifier(id), 'Historical record identifier is missing');
    const result = store.db.prepare(`SELECT * FROM ${table} WHERE ${column}=?`).get(id);
    requireEvidence(result, `Missing historical ${table} record`, 'OUTCOME_HISTORY_MISSING'); return result;
  };
  const record = (table, id) => {
    const value = parse(row(table, id).body); requireEvidence(value.id === id, `${table} body/row identity mismatch`); return value;
  };
  const observed = row('outcome_observations', receiptId), r = parse(observed.body);
  requireEvidence(digest(r) === receiptId && r.schemaVersion === 'outcome-observation/2', 'Receipt digest or schema mismatch');
  requireEvidence(hash(r.contractId), 'Invalid historical contract identity');
  const contracted = row('outcome_contracts', r.contractId), c = parse(contracted.body), b = r.binding;
  requireEvidence(digest(c) === r.contractId && c.schemaVersion === 'outcome-contract/1' && c.maxBytes === maxBytes, 'Contract digest, schema or bound mismatch');
  requireEvidence(identifier(c.evaluator?.id) && same(c.evaluator, { id: c.evaluator.id, kind: 'exact-json-artifact/2',
    implementationHash: pins['outcome-repair.mjs'], dataImplementationHash: pins['data.mjs'], node: process.version,
    comparison: 'Foundry canonical JSON: object order ignored, array order retained; bounded finite JS numbers' }), 'Unsupported observer/source/data/node identity', 'OUTCOME_HISTORY_EVALUATOR');
  checkData(c.expected, { maxBytes });
  requireEvidence(b && contracted.scope === digest([c.rootRequestId, c.inputHash, c.artifactName]) &&
    observed.binding_key === digest({ requestId: b.requestId, proposalId: b.proposalId, runId: b.runId, contractId: r.contractId }), 'Ledger scope or binding key mismatch');
  // A run is stored as a header (runs.body) plus per-node rows (see src/run-rows.mjs); a record written by the earlier whole-run store holds
  // `nodes` in runs.body and is used as it is. This inspector reads with SELECTs only and imports nothing else, so it assembles the record itself.
  const runRecord = id => {
    const header = parse(row('runs', id).body);
    requireEvidence(header.id === id, 'runs body/row identity mismatch');
    if (Object.hasOwn(header, 'nodes')) return header;
    const value = { ...header }, input = store.db.prepare('SELECT body FROM run_input WHERE run_id=?').get(id);
    if (input) value.input = parse(input.body);
    value.nodes = {}; value.outputs = {}; value.frames = {};
    for (const frame of store.db.prepare('SELECT frame_key, body FROM run_frames WHERE run_id=? ORDER BY frame_key').all(id)) value.frames[frame.frame_key] = { ...parse(frame.body), nodes: {}, outputs: {} };
    for (const node of store.db.prepare('SELECT frame_key, node_id, body, output FROM run_nodes WHERE run_id=? ORDER BY frame_key, node_id').all(id)) {
      const target = node.frame_key === 'root' ? value : value.frames[node.frame_key];
      if (!target) continue;
      if (node.body !== null) target.nodes[node.node_id] = parse(node.body);
      if (node.output !== null) target.outputs[node.node_id] = parse(node.output);
    }
    return value;
  };
  const request = record('requests', b.requestId), proposal = record('proposals', b.proposalId), run = runRecord(b.runId);
  const workflowRow = row('workflows', run.workflowHash, 'hash'), workflow = parse(workflowRow.body);
  requireEvidence(digest(workflow) === run.workflowHash && workflowRow.id === workflow.id && workflowRow.version === workflow.version, 'Immutable workflow identity mismatch');
  const lineage = [], seen = new Set(); let root = request;
  while (true) {
    requireEvidence(!seen.has(root.id) && lineage.length <= 10, 'Cyclic or over-depth request lineage');
    seen.add(root.id); lineage.push(root);
    if (!root.parentRequestId) break;
    const parent = record('requests', root.parentRequestId), prior = record('proposals', root.appliedProposalId);
    requireEvidence(prior.requestId === parent.id && prior.status === 'applied' && parent.status === 'applied' && prior.baseHash === parent.baseHash &&
      prior.workflowHash === root.baseHash && digest(prior.workflow) === prior.workflowHash &&
      root.goal === prior.workflow.goal && same(root.successCriteria, prior.workflow.envelope.successCriteria) &&
      root.workflowId === prior.workflow.id, 'Parent proposal, base workflow or goal lineage mismatch');
    if (parent.parentRequestId) requireEvidence(parent.goal === prior.workflow.goal && same(parent.successCriteria, prior.workflow.envelope.successCriteria),
      'Ancestor repair intent differs from its own applied proposal');
    const oldWorkflow = parse(row('workflows', prior.workflowHash, 'hash').body);
    requireEvidence(digest(oldWorkflow) === prior.workflowHash, 'Parent immutable workflow mismatch'); root = parent;
  }
  requireEvidence(lineage.every(q => q.text === root.text && (q.rootRequestId ?? q.id) === root.id), 'Root text or root identity mismatch');
  requireEvidence(request.status === 'applied' && proposal.status === 'applied' && proposal.requestId === request.id &&
    proposal.workflowHash === run.workflowHash && proposal.workflow.id === run.workflowId && workflow.id === run.workflowId &&
    digest(proposal.workflow) === run.workflowHash && proposal.baseHash === request.baseHash, 'Applied request/proposal/run linkage mismatch');
  if (request.parentRequestId) requireEvidence(request.goal === workflow.goal && same(request.successCriteria, workflow.envelope.successCriteria), 'Observed repair changed the retained goal or criteria');
  requireEvidence(root.id === c.rootRequestId && digest(root.text) === c.rootTextHash && digest(run.input) === c.inputHash &&
    run.registryHash === c.registryHash && hash(run.registryHash) && hash(run.engineHash), 'Historical root/input/registry/engine binding mismatch');
  requireEvidence(['succeeded', 'failed'].includes(run.status) && !run.owner, 'Historical run is not an unowned supported terminal run');
  const rows = store.db.prepare('SELECT seq,body,hash FROM events WHERE run_id=? ORDER BY seq LIMIT 100001').all(run.id);
  requireEvidence(rows.length > 0 && rows.length <= 100000, 'Missing or oversized historical event chain');
  let previousHash = null, eventBytes = 0;
  const events = rows.map((entry, index) => {
    eventBytes += Buffer.byteLength(entry.body); requireEvidence(eventBytes <= 32 * 1024 * 1024, 'Historical event bytes exceed bound');
    const event = parse(entry.body);
    requireEvidence(entry.seq === index + 1 && event.seq === entry.seq && event.previousHash === previousHash && digest(event) === entry.hash, 'Historical event chain mismatch');
    previousHash = entry.hash; return { ...event, hash: entry.hash };
  });
  const birth = events[0], tail = events.at(-1);
  requireEvidence(same(run.eventHead, { seq: events.length, hash: tail.hash }) && birth.type === 'run.created' &&
    birth.workflowHash === run.workflowHash && birth.registryHash === run.registryHash && birth.engineHash === run.engineHash &&
    birth.inputHash === digest(run.input) && birth.policyHash === digest(run.policy) &&
    (run.status === 'succeeded' ? tail.type === 'run.succeeded' && run.error === null : tail.type === 'run.stopped' && !!run.error), 'Creation/terminal event binding mismatch');
  const binding = { requestId: request.id, proposalId: proposal.id, runId: run.id, rootRequestId: root.id,
    requestHash: digest(request), proposalHash: digest(proposal), rootRequestHash: digest(root), workflowId: run.workflowId,
    workflowHash: run.workflowHash, workflowVersion: workflow.version, registryHash: run.registryHash, engineHash: run.engineHash,
    inputHash: digest(run.input), policyHash: digest(run.policy), eventHead: run.eventHead, eventCount: events.length, runStatus: run.status, runHash: digest(run) };
  requireEvidence(same(b, binding), 'Historical records differ from the complete frozen observation binding');
  const a = r.artifact, intents = new Map(), completedArtifacts = [], producers = [];
  requireEvidence(a && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(c.artifactName) && a.name === c.artifactName, 'Artifact name differs from the contract');
  for (const event of events) {
    if (event.type === 'tool.intent') intents.set(event.nodeKey, event);
    const intent = intents.get(event.nodeKey);
    if (event.type === 'node.completed' && intent?.tool === 'core.artifact') {
      requireEvidence(digest(event.output) === event.outputHash && identifier(event.output.name) && hash(event.output.sha256) &&
        Number.isSafeInteger(event.output.bytes) && event.output.bytes >= 0, 'Completed artifact producer output mismatch');
      const producer = { nodeKey: event.nodeKey, sequence: event.seq, eventHash: event.hash };
      completedArtifacts.push({ ...producer, intentSequence: intent.seq, intentHash: intent.hash, output: clone(event.output), outputHash: event.outputHash });
      if (event.output.name === a.name) producers.push(producer);
    }
  }
  requireEvidence(same(a.producers, producers), 'Recorded producers omit or alter completed artifact evidence');
  let assessment, basis;
  if (a.state === 'present') {
    requireEvidence(typeof a.base64 === 'string' && a.base64.length <= Math.ceil(maxBytes / 3) * 4 && producers.length > 0, 'Present artifact lacks bounded preserved bytes or producer evidence');
    const bytes = Buffer.from(a.base64, 'base64');
    requireEvidence(bytes.toString('base64') === a.base64 && bytes.length <= maxBytes && bytes.length === a.bytes && sha(bytes) === a.sha256, 'Preserved artifact bytes/hash mismatch');
    requireEvidence(completedArtifacts.filter(p => p.output.name === a.name).every(p => p.output.sha256 === a.sha256 && p.output.bytes === a.bytes), 'Preserved bytes contradict a completed producer');
    requireEvidence(same(a, { name: a.name, state: 'present', bytes: a.bytes, sha256: a.sha256, base64: a.base64, producers }), 'Unexpected present artifact fields');
    let value;
    try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); checkData(value, { maxBytes }); }
    catch { assessment = { outcome: 'unsatisfied', reason: 'invalid-or-unsupported-json', observedJsonHash: null }; }
    if (!assessment) {
      const satisfied = same(value, c.expected);
      assessment = { outcome: satisfied ? 'satisfied' : 'unsatisfied', reason: satisfied ? 'exact-json-match' : 'json-content-mismatch', observedJsonHash: digest(value) };
    }
    basis = 'recomputed-from-preserved-bytes';
  } else {
    requireEvidence(a.bytes === null && a.sha256 === null && a.base64 === null, 'Non-present observation contains invented bytes');
    if (a.state === 'absent') {
      const location = a.absence?.location;
      requireEvidence(['artifact', 'run-directory', 'artifacts-directory'].includes(location) && producers.length === 0 &&
        (location === 'artifact' || completedArtifacts.length === 0) && same(a, { name: a.name, state: 'absent', bytes: null, sha256: null, base64: null, producers,
          absence: { method: 'lstat-ENOENT', location, noCompletedProducer: true } }), 'Absence evidence contradicts its producer history or recorded method');
      assessment = { outcome: 'unsatisfied', reason: 'required-artifact-absent', observedJsonHash: null };
    } else {
      requireEvidence(a.state === 'unavailable', 'Unsupported historical artifact state');
      const io = a.reason === 'observer-unavailable';
      requireEvidence(io ? ['ENOENT', 'EACCES', 'EPERM', 'EIO', 'ESTALE', 'EMFILE', 'ENFILE'].includes(a.observationError) :
        a.reason === 'recorded-artifact-missing' ? producers.length > 0 : a.reason === 'recorded-artifact-directory-missing' && producers.length === 0 && completedArtifacts.length > 0, 'Unknown observation reason contradicts historical evidence');
      requireEvidence(same(a, { name: a.name, state: 'unavailable', reason: a.reason, bytes: null, sha256: null, base64: null, producers,
        ...(io ? { observationError: a.observationError } : {}) }), 'Unexpected unavailable observation fields');
      assessment = { outcome: 'unknown', reason: a.reason, observedJsonHash: null };
    }
    basis = 'recorded-observer-evidence-only';
  }
  requireEvidence(Object.entries(assessment).every(([key, value]) => r[key] === value) && Number.isSafeInteger(r.observedAt) && r.observedAt >= 0, 'Recorded assessment disagrees with the pinned historical semantics');
  const result = { schemaVersion: 'outcome-history/1', inspector: { implementationHash, node: process.version },
    source: { observationId: receiptId, contractId: r.contractId }, binding,
    lineage: lineage.map(q => ({ requestId: q.id, requestHash: digest(q), parentRequestId: q.parentRequestId ?? null })),
    historicalAssessment: { ...assessment, basis, observedAt: r.observedAt, evaluator: clone(c.evaluator), expectedJsonHash: digest(c.expected),
      goal: workflow.goal, successCriteria: clone(workflow.envelope.successCriteria), artifact: { name: a.name, state: a.state, bytes: a.bytes, sha256: a.sha256 }, completedArtifacts },
    currentEvidenceCheck: { status: 'unverified', liveArtifactRead: false, suppliedRegistryHash: currentRegistryHash,
      matchesRecordedRegistry: currentRegistryHash === b.registryHash, qualification: 'Registry hash comparison only; no current artifact, policy, capability compatibility or execution check.' },
    currentWorldQualification: false, purpose: 'Historical inspection only; not an outcome receipt, repair request, or promotion permission.' };
  return { id: `outcome-history:${digest(result)}`, ...result };
}
