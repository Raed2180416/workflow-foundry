import { readFileSync, lstatSync, realpathSync, openSync, fstatSync, readSync, closeSync, constants } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { canonical, clone, digest, checkData, FoundryError } from './data.mjs';

const byteHash = bytes => createHash('sha256').update(bytes).digest('hex');
const maxBytes = 512 * 1024;
const evaluator = Object.freeze({
  kind: 'exact-json-artifact/1',
  implementationHash: byteHash(readFileSync(new URL(import.meta.url))),
  dataImplementationHash: byteHash(readFileSync(new URL('./data.mjs', import.meta.url))),
  node: process.version,
  comparison: 'Foundry canonical JSON: object order ignored, array order retained; bounded finite JS numbers'
});
const fail = (code, message) => { throw new FoundryError(code, message); };
const same = (left, right) => canonical(left) === canonical(right);
function text(value, label, maximum = 1000) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) fail('OUTCOME_ARGUMENT', `${label} must be a bounded nonempty string`);
  return value;
}
function hash(value) {
  if (!/^[a-f0-9]{64}$/.test(value ?? '')) fail('OUTCOME_ARGUMENT', 'An exact SHA-256 identifier is required');
  return value;
}

/** Host-only coordinator. No provider, runtime, policy or approval dispatch.
 * The host supplies the oracle; model workflow/acceptance/claims never do.
 * Store access and local filesystem administration are trusted boundaries.
 */
export class OutcomeRepairCoordinator {
  constructor(foundry) {
    if (!foundry?.store?.db || !foundry.registry || typeof foundry.propose !== 'function') fail('OUTCOME_HOST', 'An existing Foundry instance is required');
    this.foundry = foundry;
    this.store = foundry.store;
    this.store.db.exec(`
      CREATE TABLE IF NOT EXISTS outcome_contracts(id TEXT PRIMARY KEY, scope TEXT NOT NULL UNIQUE, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS outcome_observations(id TEXT PRIMARY KEY, binding_key TEXT NOT NULL UNIQUE, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS outcome_repairs(receipt_id TEXT PRIMARY KEY, run_id TEXT NOT NULL UNIQUE, request_id TEXT NOT NULL UNIQUE, body TEXT NOT NULL);
      CREATE TRIGGER IF NOT EXISTS outcome_contracts_no_update BEFORE UPDATE ON outcome_contracts BEGIN SELECT RAISE(ABORT,'immutable outcome contract'); END;
      CREATE TRIGGER IF NOT EXISTS outcome_contracts_no_delete BEFORE DELETE ON outcome_contracts BEGIN SELECT RAISE(ABORT,'immutable outcome contract'); END;
      CREATE TRIGGER IF NOT EXISTS outcome_observations_no_update BEFORE UPDATE ON outcome_observations BEGIN SELECT RAISE(ABORT,'immutable outcome observation'); END;
      CREATE TRIGGER IF NOT EXISTS outcome_observations_no_delete BEFORE DELETE ON outcome_observations BEGIN SELECT RAISE(ABORT,'immutable outcome observation'); END;
      CREATE TRIGGER IF NOT EXISTS outcome_repairs_no_update BEFORE UPDATE ON outcome_repairs BEGIN SELECT RAISE(ABORT,'immutable outcome repair binding'); END;
      CREATE TRIGGER IF NOT EXISTS outcome_repairs_no_delete BEFORE DELETE ON outcome_repairs BEGIN SELECT RAISE(ABORT,'immutable outcome repair binding'); END;
    `);
  }

  #root(request) {
    const visited = new Set();
    let current = request;
    while (current.parentRequestId) {
      if (visited.has(current.id) || visited.size >= 10) fail('OUTCOME_LINEAGE', 'Repair lineage is cyclic or exceeds the supported depth');
      visited.add(current.id);
      current = this.store.request(current.parentRequestId);
    }
    if (visited.has(current.id) || (request.rootRequestId ?? request.id) !== current.id || request.text !== current.text) fail('OUTCOME_LINEAGE', 'The request does not preserve its root task and parent lineage');
    return current;
  }

  registerContract({ requestId, input, artifactName, expected, evaluatorId }) {
    text(requestId, 'requestId'); text(evaluatorId, 'evaluatorId');
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(artifactName ?? '')) fail('OUTCOME_PATH', 'Artifact name must be one safe basename');
    checkData(input, { maxBytes }); checkData(expected, { maxBytes });
    return this.store.transaction(() => {
      const request = this.store.request(requestId), root = this.#root(request);
      const body = { schemaVersion: 'outcome-contract/1', rootRequestId: root.id, rootTextHash: digest(root.text),
        inputHash: digest(input), registryHash: this.foundry.registry.hash(), artifactName,
        expected: clone(expected), evaluator: { id: evaluatorId, ...evaluator }, maxBytes };
      const id = digest(body), scope = digest([root.id, body.inputHash, artifactName]);
      const old = this.store.db.prepare('SELECT id FROM outcome_contracts WHERE scope=?').get(scope);
      if (old) {
        if (old.id !== id) fail('OUTCOME_CONTRACT_CONFLICT', 'This root/input/artifact already has a different frozen host oracle');
        return this.contract(id);
      }
      this.store.db.prepare('INSERT INTO outcome_contracts VALUES(?,?,?)').run(id, scope, canonical(body));
      return { id, ...clone(body) };
    });
  }

  contract(id) {
    const row = this.store.db.prepare('SELECT body FROM outcome_contracts WHERE id=?').get(hash(id));
    if (!row) fail('OUTCOME_CONTRACT', 'Host outcome contract not found');
    const body = JSON.parse(row.body);
    if (digest(body) !== id) fail('OUTCOME_EVIDENCE', 'Stored contract no longer matches its immutable identifier');
    if (!same(body.evaluator, { id: body.evaluator.id, ...evaluator })) fail('OUTCOME_EVALUATOR_DRIFT', 'Use the original observer implementation and execution platform');
    return { id, ...body };
  }

  #binding({ requestId, proposalId, runId }, contract) {
    const request = this.store.request(text(requestId, 'requestId'));
    const proposal = this.store.proposal(text(proposalId, 'proposalId'));
    const run = this.store.run(text(runId, 'runId'));
    const root = this.#root(request), events = this.store.events(run.id);
    const saved = this.store.workflow(run.workflowHash);
    if (request.status !== 'applied' || proposal.status !== 'applied' || proposal.requestId !== request.id ||
        proposal.workflowHash !== run.workflowHash || proposal.workflow.id !== run.workflowId ||
        digest(proposal.workflow) !== proposal.workflowHash || saved.hash !== proposal.workflowHash ||
        proposal.baseHash !== request.baseHash) fail('OUTCOME_LINK', 'Request, applied proposal and run must identify the same immutable workflow');
    if (root.id !== contract.rootRequestId || digest(root.text) !== contract.rootTextHash ||
        digest(run.input) !== contract.inputHash || run.registryHash !== contract.registryHash ||
        this.foundry.registry.hash() !== contract.registryHash) fail('OUTCOME_CONTRACT_BINDING', 'The frozen oracle belongs to a different root, input or registry');
    if (!['succeeded', 'failed'].includes(run.status) || run.owner) fail('OUTCOME_RUN_STATE', 'Only an unowned terminal succeeded/failed run may be observed');
    const birth = events[0], tail = events.at(-1);
    if (!birth || birth.type !== 'run.created' || birth.workflowHash !== run.workflowHash ||
        birth.registryHash !== run.registryHash || birth.engineHash !== run.engineHash ||
        birth.inputHash !== digest(run.input) || birth.policyHash !== digest(run.policy) ||
        (run.status === 'succeeded' ? tail.type !== 'run.succeeded' || run.error !== null : tail.type !== 'run.stopped' || !run.error)) {
      fail('OUTCOME_EVIDENCE', 'Terminal state or creation bindings contradict the verified event chain');
    }
    return { request, proposal, run, root, events, binding: {
      requestId, proposalId, runId, rootRequestId: root.id, requestHash: digest(request),
      proposalHash: digest(proposal), rootRequestHash: digest(root), workflowId: run.workflowId,
      workflowHash: run.workflowHash, workflowVersion: proposal.workflow.version,
      registryHash: run.registryHash, engineHash: run.engineHash, inputHash: digest(run.input),
      policyHash: digest(run.policy), eventHead: clone(run.eventHead), eventCount: events.length,
      runStatus: run.status, runHash: digest(run)
    } };
  }

  #artifact(run, events, name) {
    if (!/^[A-Za-z0-9-]{1,100}$/.test(run.id)) fail('OUTCOME_PATH', 'Invalid stored run directory identifier');
    const folder = path.join(this.store.directory, 'artifacts', run.id);
    const target = path.join(folder, name);
    try {
      for (const directory of [this.store.directory, path.join(this.store.directory, 'artifacts'), folder]) {
        const stat = lstatSync(directory);
        if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(directory) !== directory) fail('OUTCOME_PATH', 'Artifact ancestors must be real directories inside the Store');
      }
      const initial = lstatSync(target);
      if (!initial.isFile() || initial.isSymbolicLink() || initial.size > maxBytes) fail('OUTCOME_PATH', 'Artifact must be a bounded regular file');
      const fd = openSync(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      let bytes;
      try {
        const before = fstatSync(fd);
        if (!before.isFile() || before.size > maxBytes || before.dev !== initial.dev || before.ino !== initial.ino) fail('OUTCOME_EVIDENCE', 'Artifact changed while opening');
        const buffer = Buffer.alloc(maxBytes + 1); let length = 0;
        while (length < buffer.length) {
          const count = readSync(fd, buffer, length, buffer.length - length, null);
          if (!count) break;
          length += count;
        }
        const after = fstatSync(fd), current = lstatSync(target);
        if (length > maxBytes || length !== after.size || before.size !== after.size ||
            before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs ||
            current.dev !== after.dev || current.ino !== after.ino || current.isSymbolicLink() || realpathSync(folder) !== folder) {
          fail('OUTCOME_EVIDENCE', 'Artifact changed during its bounded read');
        }
        bytes = buffer.subarray(0, length);
      } finally { closeSync(fd); }
      const sha256 = byteHash(bytes), intents = new Map(), producers = [];
      for (const event of events) {
        if (event.type === 'tool.intent') intents.set(event.nodeKey, event);
        if (event.type === 'node.completed' && intents.get(event.nodeKey)?.tool === 'core.artifact' && event.output?.name === name) {
          if (digest(event.output) !== event.outputHash || event.output.sha256 !== sha256 || event.output.bytes !== bytes.length) fail('OUTCOME_EVIDENCE', 'Observed artifact bytes contradict their completed runtime receipt');
          producers.push({ nodeKey: event.nodeKey, sequence: event.seq, eventHash: event.hash });
        }
      }
      if (!producers.length) fail('OUTCOME_EVIDENCE', 'No completed core.artifact event binds these bytes to this run');
      return { name, state: 'present', bytes: bytes.length, sha256, base64: bytes.toString('base64'), producers };
    } catch (error) {
      if (error.code === 'ENOENT') return { name, state: 'missing', bytes: null, sha256: null, base64: null, producers: [] };
      throw error;
    }
  }

  #assessment(artifact, contract) {
    if (artifact.state === 'missing') return { outcome: 'unknown', reason: 'artifact-not-observed', observedJsonHash: null };
    let value;
    try {
      // Fatal UTF-8 rejects replacement-character decoding as a false content match.
      value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(artifact.base64, 'base64')));
      checkData(value, { maxBytes });
    } catch { return { outcome: 'unsatisfied', reason: 'invalid-or-unsupported-json', observedJsonHash: null }; }
    const observedJsonHash = digest(value), satisfied = same(value, contract.expected);
    return { outcome: satisfied ? 'satisfied' : 'unsatisfied', reason: satisfied ? 'exact-json-match' : 'json-content-mismatch', observedJsonHash };
  }

  observe({ requestId, proposalId, runId, contractId }) {
    return this.store.transaction(() => {
      const contract = this.contract(contractId);
      const linked = this.#binding({ requestId, proposalId, runId }, contract);
      const bindingKey = digest({ requestId, proposalId, runId, contractId });
      const old = this.store.db.prepare('SELECT id FROM outcome_observations WHERE binding_key=?').get(bindingKey);
      if (old) return this.verify(old.id);
      const artifact = this.#artifact(linked.run, linked.events, contract.artifactName);
      const body = { schemaVersion: 'outcome-observation/1', contractId, binding: linked.binding,
        artifact, ...this.#assessment(artifact, contract), observedAt: Date.now(),
        qualification: 'One host-bound JSON artifact observation; no general intent or deployment qualification' };
      const id = digest(body);
      this.store.db.prepare('INSERT INTO outcome_observations VALUES(?,?,?)').run(id, bindingKey, canonical(body));
      return { id, ...clone(body) };
    });
  }

  /** Historical immutable evidence remains readable even if live bytes later change. */
  receipt(id) {
    const row = this.store.db.prepare('SELECT body FROM outcome_observations WHERE id=?').get(hash(id));
    if (!row) fail('OUTCOME_RECEIPT', 'Host observation receipt not found');
    const body = JSON.parse(row.body);
    if (digest(body) !== id) fail('OUTCOME_EVIDENCE', 'Observation no longer matches its immutable identifier');
    if (body.artifact.state === 'present') {
      const bytes = Buffer.from(body.artifact.base64, 'base64');
      if (byteHash(bytes) !== body.artifact.sha256 || bytes.length !== body.artifact.bytes) fail('OUTCOME_EVIDENCE', 'Preserved artifact bytes contradict the observation');
    }
    return { id, ...body };
  }

  verify(id) {
    const receipt = this.receipt(id), contract = this.contract(receipt.contractId);
    const linked = this.#binding(receipt.binding, contract);
    if (!same(linked.binding, receipt.binding)) fail('OUTCOME_EVIDENCE', 'Run, request, proposal or event binding changed after observation');
    const artifact = this.#artifact(linked.run, linked.events, contract.artifactName);
    if (!same(artifact, receipt.artifact)) fail('OUTCOME_EVIDENCE', 'Live artifact observation changed after the receipt was frozen');
    const assessment = this.#assessment(artifact, contract);
    for (const [key, value] of Object.entries(assessment)) if (receipt[key] !== value) fail('OUTCOME_EVIDENCE', 'Recorded assessment contradicts its frozen oracle');
    return receipt;
  }

  #repairRecord(requestId) {
    const row = this.store.db.prepare('SELECT body FROM outcome_repairs WHERE request_id=?').get(requestId);
    if (!row) fail('OUTCOME_REPAIR', 'Request was not created by this outcome coordinator');
    const record = JSON.parse(row.body), request = this.store.request(requestId);
    if (digest(record.request) !== record.requestHash) fail('OUTCOME_EVIDENCE', 'Repair binding changed');
    // Store legitimately changes status/generationJobId as the existing lifecycle runs.
    for (const [key, value] of Object.entries(record.request)) {
      if (key !== 'status' && (!Object.hasOwn(request, key) || !same(request[key], value))) fail('OUTCOME_EVIDENCE', 'Immutable repair request intent or evidence changed');
    }
    const receipt = this.verify(record.receiptId);
    if (receipt.outcome !== 'unsatisfied' || request.outcomeReceiptId !== receipt.id) fail('OUTCOME_EVIDENCE', 'Repair lost its unsatisfied host observation');
    return { request, receipt };
  }

  requestRepair({ receiptId, requestId, runId, expectedHash, diagnostic = '', maxDepth = 3 }) {
    hash(expectedHash);
    if (typeof diagnostic !== 'string' || diagnostic.length > 4000) fail('REPAIR_DIAGNOSTIC', 'Diagnostic commentary must be a string of at most 4000 characters');
    if (!Number.isSafeInteger(maxDepth) || maxDepth < 1 || maxDepth > 10) fail('REPAIR_BUDGET', 'Repair depth must be between one and ten');
    return this.store.transaction(() => {
      const receipt = this.verify(receiptId), binding = receipt.binding;
      if (binding.requestId !== requestId || binding.runId !== runId || binding.workflowHash !== expectedHash) fail('OUTCOME_LINK', 'Repair arguments do not match the exact observed request and run');
      if (receipt.outcome !== 'unsatisfied') fail('OUTCOME_NOT_UNSATISFIED', 'Only an observed unsatisfied outcome can open this repair path; unknown and satisfied cannot');
      const prior = this.store.db.prepare('SELECT receipt_id,request_id FROM outcome_repairs WHERE run_id=?').get(runId);
      if (prior) {
        if (prior.receipt_id !== receiptId) fail('OUTCOME_REPAIR_CONFLICT', 'This run already has a repair for another observation');
        return { ...this.#repairRecord(prior.request_id).request, reused: true };
      }
      if (this.store.workflow(binding.workflowId).hash !== expectedHash) fail('STALE_WORKFLOW', 'Repair must target the current observed workflow head');
      const parent = this.store.request(requestId), root = this.#root(parent);
      const depth = (parent.repairDepth ?? 0) + 1;
      if (!Number.isSafeInteger(depth) || depth < 1 || depth > maxDepth) fail('REPAIR_BUDGET', 'The host repair depth is exhausted');
      const proposal = this.store.proposal(binding.proposalId);
      const base = this.store.createRequest({ workflowId: binding.workflowId, baseHash: expectedHash, text: root.text, source: 'agent-diagnostic' });
      const request = { ...base, status: 'diagnostic', parentRequestId: parent.id, rootRequestId: root.id,
        repairDepth: depth, appliedProposalId: proposal.id, observedRunId: runId,
        observedRunStatus: binding.runStatus, observationEventHead: clone(binding.eventHead),
        outcomeReceiptId: receipt.id, outcomeContractId: receipt.contractId, repairCause: 'observed-outcome',
        goal: proposal.workflow.goal, successCriteria: clone(proposal.workflow.envelope.successCriteria),
        localization: { artifactName: receipt.artifact.name, producers: clone(receipt.artifact.producers), reason: receipt.reason },
        diagnostic, diagnosticAuthority: 'Untrusted commentary; not a new requirement, consent, policy or success oracle',
        automaticGeneration: false };
      this.store.db.prepare('UPDATE requests SET body=? WHERE id=?').run(canonical(request), request.id);
      const record = { receiptId: receipt.id, requestHash: digest(request), request };
      this.store.db.prepare('INSERT INTO outcome_repairs VALUES(?,?,?,?)').run(receipt.id, runId, request.id, canonical(record));
      return { ...clone(request), reused: false };
    });
  }

  #currentRepair(requestId) {
    const { request, receipt } = this.#repairRecord(requestId);
    if (this.store.workflow(request.workflowId).hash !== request.baseHash) fail('STALE_WORKFLOW', 'The outcome repair no longer targets the current workflow');
    return { request, receipt };
  }

  designContext({ requestId, ...options }) {
    const { request, receipt } = this.#currentRepair(requestId);
    // Reuse the real design-context builder with a read-only source projection.
    // Legacy agent-diagnostic serialization expects failedRunId/failure. The new
    // request has neither; never label a succeeded run as a runtime failure.
    const view = Object.create(this.foundry);
    view.store = { workflow: id => this.store.workflow(id), request: id => {
      if (id !== requestId) fail('OUTCOME_LINK', 'Unexpected design-context request');
      return { ...request, source: 'host-outcome-repair' };
    } };
    const base = this.foundry.designContext.call(view, { ...options, requestId });
    const { contextHash: ignored, ...context } = base;
    context.diagnosticRepair = null;
    context.outcomeRepair = {
      cause: 'observed-outcome', parentRequestId: request.parentRequestId, rootRequestId: request.rootRequestId,
      observedRunId: request.observedRunId, observedRunStatus: request.observedRunStatus,
      receiptId: receipt.id, contractId: receipt.contractId, outcome: receipt.outcome,
      reason: receipt.reason, artifact: { name: receipt.artifact.name, sha256: receipt.artifact.sha256, bytes: receipt.artifact.bytes },
      input: clone(this.store.run(request.observedRunId).input), localization: clone(request.localization),
      diagnostic: request.diagnostic, diagnosticAuthority: request.diagnosticAuthority,
      preserveGoal: request.goal, preserveSuccessCriteria: clone(request.successCriteria), automaticGeneration: false,
      instruction: 'Repair the computation responsible for the observed artifact defect. Preserve the task and frozen host oracle. A new proposal and explicit execution are required.'
    };
    return { ...context, contextHash: digest(context) };
  }

  #intent(workflow, request) {
    if (workflow.goal !== request.goal || !workflow.envelope?.successCriteria || !same(workflow.envelope.successCriteria, request.successCriteria)) fail('REPAIR_INTENT', 'Outcome repair cannot change the declared goal or success criteria');
  }

  propose({ requestId, workflow, rationale }) {
    const { request } = this.#currentRepair(requestId);
    this.#intent(workflow, request);
    return this.foundry.propose({ requestId, workflow, rationale });
  }

  apply(proposalId) {
    const proposal = this.store.proposal(proposalId);
    const { request } = this.#currentRepair(proposal.requestId);
    this.#intent(proposal.workflow, request);
    return this.foundry.apply(proposalId);
  }

  /** Explicitly pass this facade to WorkflowGenerator. Constructing it does not
   * start a request processor or make a provider call; autoApply remains host-owned. */
  generationHost() {
    const view = Object.create(this.foundry);
    view.designContext = options => this.designContext(options);
    view.propose = options => this.propose(options);
    view.apply = id => this.apply(id);
    return view;
  }
}
