import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, lstatSync, realpathSync, chmodSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { canonical, clone, digest, FoundryError, checkData } from './data.mjs';

const processStart = pid => { try { return readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ')[19]; } catch { return null; } };
function liveJobOwner(job) {
  try { process.kill(job.pid, 0); } catch (error) { return error.code !== 'ESRCH'; }
  const observed = processStart(job.pid);
  return !job.processStart || !observed || observed === job.processStart;
}

export class Store {
  constructor(workspace) {
    mkdirSync(workspace, { recursive: true });
    this.workspace = realpathSync(workspace);
    this.directory = path.join(this.workspace, '.foundry');
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    if (lstatSync(this.directory).isSymbolicLink()) throw new FoundryError('STATE_PATH', '.foundry must not be a symlink');
    for (const file of ['foundry.sqlite', 'foundry.sqlite-wal', 'foundry.sqlite-shm']) {
      const target = path.join(this.directory, file);
      try { if (lstatSync(target).isSymbolicLink()) throw new FoundryError('STATE_PATH', 'SQLite files must not be symlinks'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    this.db = new DatabaseSync(path.join(this.directory, 'foundry.sqlite'));
    chmodSync(path.join(this.directory, 'foundry.sqlite'), 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS workflows(hash TEXT PRIMARY KEY, id TEXT NOT NULL, version INTEGER NOT NULL, body TEXT NOT NULL, created TEXT NOT NULL, UNIQUE(id,version));
      CREATE TABLE IF NOT EXISTS heads(id TEXT PRIMARY KEY, hash TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events(run_id TEXT NOT NULL, seq INTEGER NOT NULL, body TEXT NOT NULL, hash TEXT NOT NULL, PRIMARY KEY(run_id,seq));
      CREATE TABLE IF NOT EXISTS requests(id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS proposals(id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS fixtures(run_id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS effects(key TEXT PRIMARY KEY, run_id TEXT NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS generation_jobs(id TEXT PRIMARY KEY, request_id TEXT NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS qualifications(id TEXT PRIMARY KEY, workflow_hash TEXT NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS trials(id TEXT PRIMARY KEY, request_id TEXT NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS diagnostic_repairs(run_id TEXT PRIMARY KEY, request_id TEXT NOT NULL);
    `);
  }
  close() { this.db.close(); }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  #workflow(hash) {
    const row = this.db.prepare('SELECT body FROM workflows WHERE hash=?').get(hash);
    if (!row) throw new FoundryError('NOT_FOUND', 'Workflow version not found');
    return JSON.parse(row.body);
  }
  workflow(idOrHash) {
    // Immutable addressing wins over any legacy head that used a digest-shaped
    // id. New public workflows reject that ambiguous namespace entirely.
    const immutable = /^[0-9a-f]{64}$/.test(idOrHash ?? '') && this.db.prepare('SELECT hash FROM workflows WHERE hash=?').get(idOrHash);
    const head = immutable ? null : this.db.prepare('SELECT hash FROM heads WHERE id=?').get(idOrHash);
    const hash = head?.hash ?? idOrHash;
    const workflow = this.#workflow(hash);
    if (digest(workflow) !== hash) throw new FoundryError('CORRUPT_WORKFLOW', 'Stored workflow hash does not match its content');
    return { hash, workflow };
  }
  workflows() {
    return this.db.prepare('SELECT h.id,h.hash,w.version,w.body FROM heads h JOIN workflows w ON h.hash=w.hash ORDER BY w.created DESC').all().map(row => ({
      id: row.id, hash: row.hash, version: row.version, title: JSON.parse(row.body).title, workflow: JSON.parse(row.body)
    }));
  }
  saveWorkflow(workflow, { expectedHash = null } = {}) {
    return this.transaction(() => this.#saveWorkflow(workflow, expectedHash));
  }
  #saveWorkflow(workflow, expectedHash) {
    checkData(workflow); const hash = digest(workflow);
    const current = this.db.prepare('SELECT hash FROM heads WHERE id=?').get(workflow.id)?.hash ?? null;
    if (current === hash) return { hash, workflow: clone(workflow), unchanged: true };
    if (current !== expectedHash) throw new FoundryError('STALE_WORKFLOW', 'Current workflow differs from the expected base', { expectedHash, currentHash: current });
    if (current && workflow.version !== this.#workflow(current).version + 1) throw new FoundryError('VERSION_CONFLICT', 'Workflow version must increment by exactly one');
    if (!current && workflow.version !== 1) throw new FoundryError('VERSION_CONFLICT', 'The first workflow version must be 1');
    this.db.prepare('INSERT INTO workflows VALUES(?,?,?,?,?)').run(hash, workflow.id, workflow.version, canonical(workflow), new Date().toISOString());
    this.db.prepare('INSERT INTO heads VALUES(?,?) ON CONFLICT(id) DO UPDATE SET hash=excluded.hash').run(workflow.id, hash);
    return { hash, workflow: clone(workflow), unchanged: false };
  }
  stageEvaluationWorkflow(workflow) {
    // Host-only staging preserves the exact candidate hash/version in an isolated
    // evaluation store. It does not advance a reusable workflow head.
    checkData(workflow); const hash = digest(workflow);
    this.db.prepare('INSERT OR IGNORE INTO workflows VALUES(?,?,?,?,?)').run(hash, workflow.id, workflow.version, canonical(workflow), new Date().toISOString());
    const saved = this.workflow(hash);
    if (saved.hash !== hash) throw new FoundryError('EVALUATION_STAGE', 'Candidate staging did not preserve its exact identity');
    return saved;
  }
  createRun(workflowHash, input, registryHash, policy, { fixture = null, extra = {}, engineHash = null } = {}) {
    checkData(input); checkData(policy); const { workflow } = this.workflow(workflowHash);
    const now = Date.now(), id = randomUUID();
    const run = {
      id, workflowHash, workflowId: workflow.id, registryHash, engineHash, input: clone(input),
      policy: clone(policy), createdAt: now, updatedAt: now,
      deadline: now + Math.min(workflow.budget.maxDurationMs, policy.maxDurationMs),
      status: 'ready', steps: 0, cost: 0, nodes: {}, outputs: {}, frames: {},
      approvals: {}, error: null, extra: clone(extra)
    };
    this.transaction(() => {
      this.db.prepare('INSERT INTO runs VALUES(?,?)').run(id, canonical(run));
      if (fixture) this.db.prepare('INSERT INTO fixtures VALUES(?,?)').run(id, canonical({ ...fixture, actions: [], wrongActions: 0 }));
      const event = this.#event(id, { type: 'run.created', workflowHash, registryHash, engineHash, inputHash: digest(input), policyHash: digest(policy) });
      run.eventHead = { seq: event.seq, hash: event.hash };
      this.db.prepare('UPDATE runs SET body=? WHERE id=?').run(canonical(run), id);
    });
    return run;
  }
  run(id) {
    const row = this.db.prepare('SELECT body FROM runs WHERE id=?').get(id);
    if (!row) throw new FoundryError('NOT_FOUND', 'Run not found');
    return JSON.parse(row.body);
  }
  runs() { return this.db.prepare('SELECT body FROM runs ORDER BY rowid DESC LIMIT 100').all().map(r => JSON.parse(r.body)); }
  updateRun(id, mutate, event) {
    return this.transaction(() => {
      const run = this.run(id);
      const tail = this.db.prepare('SELECT seq,hash FROM events WHERE run_id=? ORDER BY seq DESC LIMIT 1').get(id);
      const count = this.db.prepare('SELECT COUNT(*) AS count FROM events WHERE run_id=?').get(id).count;
      if (!run.eventHead || tail?.seq !== run.eventHead.seq || tail?.hash !== run.eventHead.hash || count !== run.eventHead.seq) throw new FoundryError('CORRUPT_EVENTS', 'Refusing to append over missing or truncated checkpoint evidence');
      mutate(run); run.updatedAt = Date.now();
      checkData(run, { maxBytes: 12 * 1024 * 1024 });
      if (event) {
        const receipt = this.#event(id, typeof event === 'function' ? event(run) : event);
        run.eventHead = { seq: receipt.seq, hash: receipt.hash };
      }
      this.db.prepare('UPDATE runs SET body=? WHERE id=?').run(canonical(run), id);
      return clone(run);
    });
  }
  #event(id, data) {
    checkData(data, { maxBytes: 1024 * 1024 });
    const prev = this.db.prepare('SELECT seq,hash FROM events WHERE run_id=? ORDER BY seq DESC LIMIT 1').get(id);
    const event = { seq: (prev?.seq ?? 0) + 1, at: Date.now(), previousHash: prev?.hash ?? null, ...data };
    const hash = digest(event);
    this.db.prepare('INSERT INTO events VALUES(?,?,?,?)').run(id, event.seq, canonical(event), hash);
    return { ...event, hash };
  }
  events(id) {
    let previousHash = null;
    const events = this.db.prepare('SELECT body,hash FROM events WHERE run_id=? ORDER BY seq').all(id).map((row, i) => {
      const event = JSON.parse(row.body);
      if (event.seq !== i + 1 || event.previousHash !== previousHash || digest(event) !== row.hash) throw new FoundryError('CORRUPT_EVENTS', 'Event chain verification failed');
      previousHash = row.hash; return { ...event, hash: row.hash };
    });
    const head = this.run(id).eventHead;
    if (!head || head.seq !== events.length || head.hash !== previousHash) throw new FoundryError('CORRUPT_EVENTS', 'Checkpoint/event head mismatch or truncated event history');
    return events;
  }
  fixture(id) { const row = this.db.prepare('SELECT body FROM fixtures WHERE run_id=?').get(id); return row ? JSON.parse(row.body) : null; }
  fixtureEffect(runId, key, action) {
    return this.transaction(() => {
      const prior = this.db.prepare('SELECT body FROM effects WHERE key=?').get(key);
      if (prior) return JSON.parse(prior.body);
      const world = this.fixture(runId);
      if (!world) throw new FoundryError('NO_FIXTURE', 'No simulator attached');
      world.actions.push(action);
      if (action === world.correctAction) world.healthy = true;
      else if (action !== 'none') world.wrongActions += 1;
      const result = { attempted: action };
      this.db.prepare('UPDATE fixtures SET body=? WHERE run_id=?').run(canonical(world), runId);
      this.db.prepare('INSERT INTO effects VALUES(?,?,?)').run(key, runId, canonical(result));
      return result;
    });
  }
  createRequest({ workflowId = null, baseHash = null, text, source = 'user' }) {
    if (typeof text !== 'string' || !text.trim() || text.length > 30000) throw new FoundryError('REQUEST_TEXT', 'Request text must contain 1–30000 characters');
    if (workflowId) {
      const current = this.workflow(workflowId);
      if (baseHash && baseHash !== current.hash) throw new FoundryError('STALE_WORKFLOW', 'The request targets an obsolete workflow');
      baseHash = current.hash;
    } else if (baseHash) throw new FoundryError('REQUEST_BASE', 'A base hash requires a workflow id');
    const request = { id: randomUUID(), workflowId, baseHash, text, source, status: 'pending', createdAt: Date.now() };
    this.db.prepare('INSERT INTO requests VALUES(?,?)').run(request.id, canonical(request));
    return request;
  }
  createAgentDesignRequest({ task, workflowId = null, expectedHash = null }) {
    return this.transaction(() => {
      const request = this.createRequest({ text: task, workflowId, baseHash: expectedHash, source: 'agent-request' });
      const result = { ...request, status: 'diagnostic', automaticGeneration: false,
        provenance: 'Task relayed or composed by the host agent; not direct user consent or an authority grant' };
      this.db.prepare('UPDATE requests SET body=? WHERE id=?').run(canonical(result), request.id);
      return result;
    });
  }
  requests() { return this.db.prepare('SELECT body FROM requests ORDER BY rowid DESC LIMIT 100').all().map(r => JSON.parse(r.body)); }
  pendingRequests(limit = 100) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new FoundryError('REQUEST_LIMIT', 'Invalid pending request page size');
    return this.db.prepare("SELECT body FROM requests WHERE json_extract(body,'$.status')='pending' ORDER BY rowid ASC LIMIT ?").all(limit).map(row => JSON.parse(row.body));
  }
  request(id) { const row = this.db.prepare('SELECT body FROM requests WHERE id=?').get(id); if (!row) throw new FoundryError('NOT_FOUND', 'Request not found'); return JSON.parse(row.body); }
  createTrial({ requestId, workflow, registryHash, inputHash, policyHash, maxPerRequest, maxTotal }) {
    return this.transaction(() => {
      const request = this.request(requestId);
      if (!['pending', 'diagnostic', 'proposed', 'failed', 'interrupted'].includes(request.status)) throw new FoundryError('TRIAL_REQUEST_STATE', 'Trial requires an open draft or diagnostic request; applied/processing/cancelled requests cannot be reused');
      const base = request.baseHash ? this.workflow(request.baseHash).workflow : null;
      const current = this.db.prepare('SELECT hash FROM heads WHERE id=?').get(request.workflowId ?? workflow.id)?.hash ?? null;
      if (current !== request.baseHash) throw new FoundryError('STALE_WORKFLOW', 'The draft request no longer targets the current workflow head');
      if (workflow.version !== (base?.version ?? 0) + 1 || (request.workflowId && request.workflowId !== workflow.id)) throw new FoundryError('REQUEST_VERSION', 'Draft must preserve the requested identity and next version');
      if (request.source === 'agent-diagnostic' && (workflow.goal !== request.goal || digest(workflow.envelope.successCriteria) !== digest(request.successCriteria))) throw new FoundryError('REPAIR_INTENT', 'A diagnostic draft must preserve its declared goal and success criteria');
      const perRequest = this.db.prepare('SELECT COUNT(*) AS n FROM trials WHERE request_id=?').get(requestId).n;
      const total = this.db.prepare('SELECT COUNT(*) AS n FROM trials').get().n;
      if (perRequest >= maxPerRequest || total >= maxTotal) throw new FoundryError('TRIAL_BUDGET', 'The host diagnostic trial budget is exhausted; no execution was started');
      const trial = { id: randomUUID(), requestId, baseHash: request.baseHash, workflowId: workflow.id,
        workflowVersion: workflow.version, workflowHash: digest(workflow), registryHash, inputHash, policyHash,
        ordinal: perRequest + 1, status: 'running', createdAt: Date.now(), pid: process.pid, processStart: processStart(process.pid),
        runId: null, taskOutcomeQualified: false, qualificationLevel: 'construction',
        qualification: 'Isolated diagnostic execution only. Local acceptance is model-authored; no independent outcome qualification.' };
      this.db.prepare('INSERT INTO trials VALUES(?,?,?)').run(trial.id, requestId, canonical(trial));
      return trial;
    });
  }
  trial(id) {
    const row = this.db.prepare('SELECT body FROM trials WHERE id=?').get(id);
    if (!row) throw new FoundryError('NOT_FOUND', 'Diagnostic trial not found');
    const trial = JSON.parse(row.body);
    if (trial.status === 'running' && !liveJobOwner(trial)) return this.finishTrial(id, {
      status: 'interrupted', error: { code: 'TRIAL_PROCESS_LOST', message: 'Trial owner exited without a final receipt; no automatic retry or qualification.' }
    });
    return trial;
  }
  finishTrial(id, evidence) {
    checkData(evidence);
    return this.transaction(() => {
      const row = this.db.prepare('SELECT body FROM trials WHERE id=?').get(id);
      if (!row) throw new FoundryError('NOT_FOUND', 'Diagnostic trial not found');
      const trial = JSON.parse(row.body);
      if (trial.status !== 'running') throw new FoundryError('TRIAL_CLOSED', 'A diagnostic receipt cannot be overwritten');
      const allowed = new Set(['status', 'error', 'runId', 'runStatus', 'eventHead', 'outputHash', 'steps', 'cost', 'artifactReceipts', 'localAcceptancePassed']);
      if (Object.keys(evidence).some(key => !allowed.has(key)) || !['finished', 'failed', 'interrupted'].includes(evidence.status)) throw new FoundryError('TRIAL_RECEIPT', 'Unsupported trial evidence fields or terminal state');
      const result = { ...trial, ...clone(evidence), finishedAt: Date.now() };
      this.db.prepare('UPDATE trials SET body=? WHERE id=?').run(canonical(result), id);
      return result;
    });
  }
  trials(requestId = null) {
    const rows = requestId ? this.db.prepare('SELECT id FROM trials WHERE request_id=? ORDER BY rowid DESC LIMIT 100').all(requestId)
      : this.db.prepare('SELECT id FROM trials ORDER BY rowid DESC LIMIT 100').all();
    return rows.map(row => this.trial(row.id));
  }
  createDiagnosticRepair({ requestId, failedRunId, expectedHash, diagnostic = '', maxDepth = 3 }) {
    if (typeof diagnostic !== 'string' || diagnostic.length > 4000) throw new FoundryError('REPAIR_DIAGNOSTIC', 'Diagnostic commentary must be a string of at most 4000 characters');
    if (!/^[0-9a-f]{64}$/.test(expectedHash ?? '')) throw new FoundryError('REPAIR_HASH', 'An exact expected workflow hash is required');
    return this.transaction(() => {
      const parent = this.request(requestId), run = this.run(failedRunId);
      const prior = this.db.prepare('SELECT request_id FROM diagnostic_repairs WHERE run_id=?').get(failedRunId);
      if (prior) {
        const existing = this.request(prior.request_id);
        if (existing.parentRequestId !== requestId || existing.baseHash !== expectedHash) throw new FoundryError('REPAIR_CONFLICT', 'This failure already belongs to a different diagnostic request binding');
        return { ...existing, reused: true };
      }
      if (parent.status !== 'applied') throw new FoundryError('REPAIR_REQUEST_STATE', 'The failed run must belong to an already applied request');
      const proposalRow = this.db.prepare("SELECT body FROM proposals WHERE json_extract(body,'$.requestId')=? AND json_extract(body,'$.status')='applied' AND json_extract(body,'$.workflowHash')=?").get(requestId, run.workflowHash);
      if (!proposalRow) throw new FoundryError('REPAIR_PROVENANCE', 'No applied proposal connects this request to the exact failed workflow');
      const proposal = JSON.parse(proposalRow.body);
      if (run.workflowHash !== expectedHash || this.workflow(run.workflowId).hash !== expectedHash || proposal.workflow.id !== run.workflowId) throw new FoundryError('STALE_WORKFLOW', 'Repair must target the current head and exact failed run version');
      if (run.status !== 'failed' || run.owner) throw new FoundryError('REPAIR_RUN_STATE', 'Only a terminal failed run can open an automatic diagnostic repair; paused, cancelled or uncertain effects need explicit reconciliation');
      const events = this.events(failedRunId);
      if (!events.length || !run.error) throw new FoundryError('REPAIR_EVIDENCE', 'A verified failure and event chain are required');
      const depth = (parent.repairDepth ?? 0) + 1;
      if (!Number.isSafeInteger(maxDepth) || maxDepth < 1 || maxDepth > 10 || depth > maxDepth) throw new FoundryError('REPAIR_BUDGET', 'The host diagnostic repair depth is exhausted');
      const rootRequestId = parent.rootRequestId ?? parent.id, root = this.request(rootRequestId);
      const request = {
        id: randomUUID(), workflowId: run.workflowId, baseHash: expectedHash, text: root.text,
        source: 'agent-diagnostic', status: 'diagnostic', createdAt: Date.now(),
        parentRequestId: parent.id, rootRequestId, repairDepth: depth, appliedProposalId: proposal.id,
        failedRunId, failureEventHead: clone(run.eventHead), failure: clone(run.error),
        diagnostic, diagnosticAuthority: 'Untrusted agent commentary; not a new requirement, consent, policy or success oracle',
        goal: proposal.workflow.goal, successCriteria: clone(proposal.workflow.envelope.successCriteria),
        automaticGeneration: false
      };
      this.db.prepare('INSERT INTO requests VALUES(?,?)').run(request.id, canonical(request));
      this.db.prepare('INSERT INTO diagnostic_repairs VALUES(?,?)').run(failedRunId, request.id);
      return { ...request, reused: false };
    });
  }
  createProposal({ requestId, workflow, rationale, validation }) {
    return this.transaction(() => this.#createProposal({ requestId, workflow, rationale, validation }));
  }
  #createProposal({ requestId, workflow, rationale, validation }) {
    const request = this.request(requestId);
    if (request.status === 'applied') throw new FoundryError('REQUEST_CLOSED', 'This request already has an applied proposal');
    if (!validation?.valid || validation.hash !== digest(workflow)) throw new FoundryError('UNVALIDATED_PROPOSAL', 'A matching valid workflow receipt is required');
    if (typeof rationale !== 'string' || !rationale.trim() || rationale.length > 20000) throw new FoundryError('PROPOSAL_RATIONALE', 'A bounded rationale is required');
    if (request.workflowId && workflow.id !== request.workflowId) throw new FoundryError('PROPOSAL_ID', 'A revision cannot silently switch workflow identity');
    const base = request.baseHash ? this.workflow(request.baseHash).workflow : null;
    if (workflow.version !== (base?.version ?? 0) + 1) throw new FoundryError('VERSION_CONFLICT', 'Proposal must increment the base version exactly once');
    if (request.source === 'agent-diagnostic' && (workflow.goal !== request.goal || digest(workflow.envelope.successCriteria) !== digest(request.successCriteria))) throw new FoundryError('REPAIR_INTENT', 'A diagnostic repair cannot change the declared goal or success criteria; ask for a separate user revision');
    const before = new Map((base?.nodes ?? []).map(n => [n.id, digest(n)]));
    const after = new Map(workflow.nodes.map(n => [n.id, digest(n)]));
    const impact = {
      added: [...after.keys()].filter(k => !before.has(k)), removed: [...before.keys()].filter(k => !after.has(k)),
      changed: [...after.keys()].filter(k => before.has(k) && before.get(k) !== after.get(k)),
      acceptanceChanged: base ? digest(base.acceptance) !== digest(workflow.acceptance) : true,
      budgetChanged: base ? digest(base.budget) !== digest(workflow.budget) : true,
      activeRunsMigrated: false
    };
    const proposal = { id: randomUUID(), requestId, baseHash: request.baseHash, workflow: clone(workflow), workflowHash: validation.hash, rationale, impact, validation, status: 'proposed', createdAt: Date.now() };
    this.db.prepare('INSERT INTO proposals VALUES(?,?)').run(proposal.id, canonical(proposal));
    this.db.prepare('UPDATE requests SET body=? WHERE id=?').run(canonical({ ...request, status: 'proposed' }), requestId);
    return proposal;
  }
  proposal(id) { const row = this.db.prepare('SELECT body FROM proposals WHERE id=?').get(id); if (!row) throw new FoundryError('NOT_FOUND', 'Proposal not found'); return JSON.parse(row.body); }
  proposals() { return this.db.prepare('SELECT body FROM proposals ORDER BY rowid DESC LIMIT 100').all().map(r => JSON.parse(r.body)); }
  applyProposal(id) {
    return this.transaction(() => {
      const proposal = this.proposal(id);
      if (proposal.status !== 'proposed') throw new FoundryError('PROPOSAL_CLOSED', 'Proposal is no longer applicable');
      const request = this.request(proposal.requestId);
      if (request.status === 'applied') throw new FoundryError('REQUEST_CLOSED', 'Another proposal already applied this request');
      if (proposal.workflowHash !== digest(proposal.workflow) || request.baseHash !== proposal.baseHash) throw new FoundryError('PROPOSAL_CORRUPT', 'Proposal content or request binding changed');
      // Program insertion, head CAS, proposal state and request consumption form
      // one SQLite commit. A crash cannot publish a new head while leaving the
      // same request available for an unrelated second application.
      const saved = this.#saveWorkflow(proposal.workflow, proposal.baseHash);
      this.db.prepare('UPDATE proposals SET body=? WHERE id=?').run(canonical({ ...proposal, status: 'applied', appliedAt: Date.now() }), id);
      this.db.prepare('UPDATE requests SET body=? WHERE id=?').run(canonical({ ...request, status: 'applied' }), request.id);
      return { ...proposal, status: 'applied', ...saved };
    });
  }
  createGenerationJob(requestId, descriptor, limits) {
    checkData(descriptor); checkData(limits);
    return this.transaction(() => {
      const request = this.request(requestId);
      if (!['pending', 'diagnostic'].includes(request.status)) throw new FoundryError('REQUEST_NOT_PENDING', 'A request is already being processed or has a proposal');
      const job = { id: randomUUID(), requestId, provider: clone(descriptor), limits: clone(limits), status: 'running', createdAt: Date.now(), updatedAt: Date.now(), attempts: [], pid: process.pid, processStart: processStart(process.pid), proposalId: null, error: null };
      this.db.prepare('INSERT INTO generation_jobs VALUES(?,?,?)').run(job.id, requestId, canonical(job));
      this.db.prepare('UPDATE requests SET body=? WHERE id=?').run(canonical({ ...request, status: 'processing', generationJobId: job.id }), requestId);
      return job;
    });
  }
  generationJob(id) {
    const row = this.db.prepare('SELECT body FROM generation_jobs WHERE id=?').get(id);
    if (!row) throw new FoundryError('NOT_FOUND', 'Generation job not found');
    const job = JSON.parse(row.body);
    if (job.status === 'running' && !liveJobOwner(job)) return this.updateGenerationJob(id, current => {
      current.status = 'interrupted'; current.finishedAt = Date.now();
      current.error = { code: 'GENERATOR_PROCESS_LOST', message: 'The owning process exited before committing a terminal generation receipt. No automatic retry is authorized.' };
    });
    return job;
  }
  generationJobs() { return this.db.prepare('SELECT id FROM generation_jobs ORDER BY rowid DESC LIMIT 100').all().map(row => this.generationJob(row.id)); }
  recordQualification(report) {
    checkData(report); const id = digest(report);
    if (!/^[0-9a-f]{64}$/.test(report.workflowHash ?? '') || !/^[0-9a-f]{64}$/.test(report.registryHash ?? '') || typeof report.passed !== 'boolean' || typeof report.evaluatorId !== 'string' || !report.evaluatorId.trim() || report.evaluatorId.length > 1000) throw new FoundryError('QUALIFICATION', 'An identified evaluation report bound to workflow and registry hashes is required');
    if (report.qualificationLevel !== undefined && !['construction', 'task-outcome'].includes(report.qualificationLevel)) throw new FoundryError('QUALIFICATION', 'Evaluation level must explicitly be construction or task-outcome; omitted levels remain unclassified');
    this.db.prepare('INSERT OR IGNORE INTO qualifications VALUES(?,?,?)').run(id, report.workflowHash, canonical(report));
    return { id, ...clone(report) };
  }
  qualifications(workflowHash = null) {
    const rows = workflowHash ? this.db.prepare('SELECT body FROM qualifications WHERE workflow_hash=? ORDER BY rowid DESC LIMIT 100').all(workflowHash) : this.db.prepare('SELECT body FROM qualifications ORDER BY rowid DESC LIMIT 100').all();
    return rows.map(row => ({ id: digest(JSON.parse(row.body)), ...JSON.parse(row.body) }));
  }
  updateGenerationJob(id, mutate) {
    return this.transaction(() => {
      const row = this.db.prepare('SELECT body FROM generation_jobs WHERE id=?').get(id);
      if (!row) throw new FoundryError('NOT_FOUND', 'Generation job not found');
      const job = JSON.parse(row.body); mutate(job); job.updatedAt = Date.now();
      checkData(job); this.db.prepare('UPDATE generation_jobs SET body=? WHERE id=?').run(canonical(job), id);
      if (['failed', 'cancelled', 'interrupted'].includes(job.status)) {
        const request = this.request(job.requestId);
        if (request.status === 'processing' && request.generationJobId === id) this.db.prepare('UPDATE requests SET body=? WHERE id=?').run(canonical({ ...request, status: job.status }), request.id);
      }
      return job;
    });
  }
}
