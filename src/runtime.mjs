import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { checkData, clone, condition, digest, errorData, FoundryError, references, resolve } from './data.mjs';
import { approvalGated, bindOutput, controlPolicyMessage, labelPolicyMessage, modelNodes, OUTPUT_KEY, requireWorkflow, validateData, validateDecision, validateIdentity, VERIFY_RETURNS } from './validate.mjs';
import { engineHash } from './engine.mjs';
import { compileContext, contextInputs, inheritedLabel, joinLabels } from './context.mjs';
import { verdictOf } from './verdict.mjs';
import { runCode } from './sandbox.mjs';
import { classIndex, modelById, modelsForClass, nextClass, validatePolicy } from './models/policy.mjs';
import { MODES } from './models/port.mjs';
import { AUDIT, identityChanges, journalSeal } from './audit.mjs';
import { MATERIALIZE, STATE_BYTES, STATE_ITEMS } from './run-rows.mjs';

const finished = new Set(['succeeded', 'failed', 'cancelled']);
// Is the ModelPort's journal the store's database? The same handle, or another handle on the same database file (an in-memory database
// has no file, so only its own handle is the same).
const sameDatabase = (a, b) => {
  if (!a || !b) return false;
  if (a === b) return true;
  try { const file = a.location?.(); return typeof file === 'string' && file.length > 0 && file === b.location?.(); } catch { return false; }
};
// Events that charge one journaled model call (chargeModel) and bind its row (src/audit.mjs).
const CALL_EVENTS = new Set(['model.called', 'node.recovered_from_journal', 'model.cancelled']);
const nodeDone = new Set(['completed', 'skipped', 'handled_error']);
const startStamp = pid => {
  try { return readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ')[19]; }
  catch { return null; }
};
function alive(owner) {
  try { process.kill(owner.pid, 0); }
  catch (error) { return error.code !== 'ESRCH'; }
  const current = startStamp(owner.pid);
  return !owner.processStart || !current || current === owner.processStart;
}
class Semaphore {
  constructor(limit) { this.limit = limit; this.active = 0; this.queue = []; }
  async take(signal) {
    if (signal.aborted) throw new FoundryError('CANCELLED', 'Execution was cancelled');
    if (this.active < this.limit) { this.active++; return; }
    await new Promise((yes, no) => {
      const entry = { yes: () => { signal.removeEventListener('abort', abort); yes(); }, no };
      const abort = () => { this.queue = this.queue.filter(x => x !== entry); no(new FoundryError('CANCELLED', 'Execution was cancelled')); };
      signal.addEventListener('abort', abort, { once: true }); this.queue.push(entry);
    });
  }
  release() { const next = this.queue.shift(); if (next) next.yes(); else this.active--; }
}
const frameOf = (run, key) => key === 'root' ? run : run.frames[key];
// The outputs of one frame as a read-only object that fetches an output when a reference reads it (resolve() looks up only what a
// template names), so building a node's context costs what the node reads, not the number of nodes before it.
function lazyOutputs(rows, runId, frameKey) {
  const cache = new Map(), load = id => { if (!cache.has(id)) cache.set(id, rows.nodeOutput(runId, frameKey, id)); return cache.get(id); };
  return new Proxy({}, {
    get: (_, id) => typeof id === 'string' ? load(id) : undefined,
    has: (_, id) => typeof id === 'string' && load(id) !== undefined,
    ownKeys: () => rows.outputKeys(runId, frameKey),
    getOwnPropertyDescriptor: (_, id) => { const value = typeof id === 'string' ? load(id) : undefined; return value === undefined ? undefined : { value, writable: false, enumerable: true, configurable: true }; },
    set: () => false, deleteProperty: () => false, defineProperty: () => false, getPrototypeOf: () => Object.prototype
  });
}
// The context of an agent node's checks: the context with the node's own output added under nodes._output.
const withOutput = (ctx, value) => ({ ...ctx, nodes: new Proxy(ctx.nodes, {
  get: (target, id) => id === OUTPUT_KEY ? value : target[id],
  has: (target, id) => id === OUTPUT_KEY || Reflect.has(target, id),
  ownKeys: target => [...new Set([...Reflect.ownKeys(target), OUTPUT_KEY])],
  getOwnPropertyDescriptor: (target, id) => id === OUTPUT_KEY ? { value, writable: false, enumerable: true, configurable: true } : Reflect.getOwnPropertyDescriptor(target, id),
  set: () => false, deleteProperty: () => false, defineProperty: () => false, getPrototypeOf: () => Object.prototype
}) });
const splitKey = nodeKey => { const slash = nodeKey.lastIndexOf('/'); return [nodeKey.slice(0, slash), nodeKey.slice(slash + 1)]; };
const terminal = new Set(['succeeded', 'failed', 'cancelled', 'uncertain']);
// DESIGN §5.1: outages never escalate; protocol and per-call budget faults are not model behaviour either.
const environmentFaults = new Set(['MODEL_RATE_LIMIT', 'MODEL_UNAVAILABLE', 'MODEL_TIMEOUT']);
const providerFaults = new Set(['MODEL_PROTOCOL', 'MODEL_BUDGET']);
const retryable = new Set(['MODEL_SCHEMA', 'MODEL_TRUNCATED']);
// onError:"continue" and map failure:"collect" never hide an environment fault, a budget stop, a cancellation,
// a policy violation or a harness integrity failure.
const unhandled = new Set([...environmentFaults, ...providerFaults, 'CANCELLED', 'ABORT_ERR', 'SANDBOX_UNAVAILABLE', 'COST_BUDGET', 'STEP_BUDGET',
  'DEADLINE', 'STATE_BUDGET', 'STATE_CONFLICT', 'STALE_RUNNER', 'REPLAY_MISS', 'MODEL_PORT_REQUIRED', 'VERIFY_INDEPENDENCE', 'ASSIGNMENT_INVALID',
  'LABEL_POLICY', 'FRAME_DRIFT', 'CORRUPT_EVENTS', 'MODEL_POLICY_DRIFT', 'JOURNAL_TAMPERED', 'APPROVAL_TAMPERED']);
const cancelled = error => ['CANCELLED', 'ABORT_ERR'].includes(error?.code);
// A call cut short because the run deadline, not its own timeout, set its limit is the deadline's outcome.
const deadlineStop = (what, details) => new FoundryError('DEADLINE', `Run deadline exhausted while ${what} was running`, details);
// The E1 retry note sits outside every untrusted fence, so it carries only the port's model-safe feedback (fixed text
// and schema paths), never a provider message or an instance path that model output (steerable by input) can fill.
const RETRY_FEEDBACK = { MODEL_SCHEMA: 'Model output did not satisfy its schema', MODEL_TRUNCATED: 'Generation stopped at the token limit' };
// Sum of spend bounds; null (unbounded) once any part has none.
const addBound = (total = 0, bound) => total === null || typeof bound !== 'number' ? null : total + bound;
const unknownOf = call => call.costUnknown === true ? { costUnknown: true, costUpperUsd: call.costUpperUsd ?? null, costEstimateUsd: call.costEstimateUsd ?? null } : {};
// Abort scopes (one per flow frame and per map) follow async continuations, so a failure cancels only its own
// scope; the invocation-wide controller remains the root. A scope belongs to exactly one Invocation.
const scopes = new AsyncLocalStorage();
const labelOf = (template, scope) => joinLabels(references(template ?? null).map(ref => inheritedLabel(ref, scope)));
const labelEntry = (key, label) => label === 'trusted' ? {} : { [key]: label };
const labelState = label => label === 'trusted' ? {} : { outputLabel: label };
// A node's control label (program-counter taint, ROADMAP §2.9) is the join of the labels that decided whether it runs: the control
// label of its frame (the enclosing map's items, the enclosing loop's until), its `when`, and the control of every predecessor whose
// skip would skip it. What a reference to the node sees (outputLabel) is its data label joined with its control label, as in validate.mjs.
const controlState = label => label === 'trusted' ? {} : { controlLabel: label, outputLabel: label };
const inputLabels = scope => Object.fromEntries(Object.entries(scope).filter(([key]) => key === 'input' || key.startsWith('input.')));
// The run verdict (DESIGN §5.2) is sealed in the same commit as the terminal status, with its decision record.
// Its run.verdict event precedes the terminal event, so the chain tail stays run.succeeded/run.stopped.
function seal(run, workflow, store) {
  if (!terminal.has(run.status)) { delete run.verdict; return; }
  store.clearTimers(run.id);
  run.verdict = verdictOf(run[MATERIALIZE]?.() ?? run, { workflow });
  if (run.identity) {
    const decision = { schema: 'foundry-decision/1', id: `${run.id}:verdict:${run.eventHead?.seq ?? 0}`, at: Date.now(), kind: 'verdict', identity: run.identity,
      features: { status: run.status, errorCode: run.error?.code ?? null, discovery: workflow?.discovery === true, findings: (run.findings ?? []).length, steps: run.steps, ...(run.verdict.acceptance ? { acceptance: run.verdict.acceptance } : {}) },
      action: run.verdict.verdict, alternatives: [], propensity: 1, rationale: run.verdict.reason, costUsd: run.cost };
    try { store.recordDecision(run.id, validateDecision(decision)); }
    catch (error) { run.verdict.decisionError = errorData(error); }
  }
}
// A human answer is the user's, like an approval: the answer a human node holds in the run record must be the one its human.answered event
// recorded. The record is a checkpoint any writer to the workspace can edit; resume would otherwise feed an answer nobody gave downstream.
function forgedAnswers(workflow, run, log) {
  const humans = new Set(), walk = nodes => { for (const n of nodes ?? []) { if (n.kind === 'human') humans.add(n.id); if (n.body) walk(n.body.nodes); } };
  walk(workflow.nodes);
  if (!humans.size) return [];
  const answered = new Map(log.filter(e => e.type === 'human.answered').map(e => [e.nodeKey, e.answerHash])), forged = [];
  for (const [frameKey, frame] of [['root', run], ...Object.entries(run.frames ?? {})]) {
    for (const id of humans) {
      const held = !!frame?.outputs && Object.hasOwn(frame.outputs, id);
      if (!held && frame?.nodes?.[id]?.status !== 'completed') continue;
      if (!held || answered.get(`${frameKey}/${id}`) !== digest(frame.outputs[id]?.answer ?? null)) forged.push(`${frameKey}/${id}`);
    }
  }
  return forged;
}
// The seal that closed a run for good: a final verdict (anything but 'uncertain', which reconciliation may resume). Once the chain holds
// one, the run is never resumed, answered or approved again, whatever its record says (an edited status cannot reopen it).
const closingSeal = events => events.find(e => e.type === 'run.verdict' && e.verdict !== 'uncertain') ?? null;
const closedError = (seal, status) => new FoundryError('RUN_CLOSED', `The run's chain closed it with a final verdict (${seal.verdict}) at event ${seal.seq}, but its record says ${status}: the record was edited. A closed run is never reopened.`, { seq: seal.seq });
const policyDefaults = registry => ({
  allowedCapabilities: registry.list().filter(c => c.risk === 'low').map(c => c.name),
  maxSteps: 5000, maxConcurrency: 4, maxDurationMs: 3600000, maxCost: 0, maxResumes: 1000
});

export class Runtime {
  // models: a ModelPort; modelPolicy: the owner policy (loadPolicy() result or the policy object);
  // codeRunner: the sandbox (tests may inject a double). None of these enter the stored run policy.
  constructor(store, registry, policy = {}, { models = null, modelPolicy = null, codeRunner = runCode } = {}) {
    this.store = store; this.registry = registry; this.policy = { ...policyDefaults(registry), ...clone(policy) };
    for (const k of ['maxSteps', 'maxConcurrency', 'maxDurationMs', 'maxResumes']) if (!Number.isSafeInteger(this.policy[k]) || this.policy[k] < 1) throw new FoundryError('POLICY', `${k} must be a positive integer`);
    if (!Array.isArray(this.policy.allowedCapabilities) || this.policy.allowedCapabilities.some(x => !registry.get(x))) throw new FoundryError('POLICY', 'Allowed capabilities must be registered');
    if (!Number.isFinite(this.policy.maxCost) || this.policy.maxCost < 0) throw new FoundryError('POLICY', 'maxCost must be nonnegative');
    const owner = modelPolicy?.policy ?? modelPolicy;
    this.modelPolicy = owner ? validatePolicy(owner) : null; this.modelPolicyHash = owner ? digest(owner) : null;
    if (models !== null && typeof models?.call !== 'function') throw new FoundryError('POLICY', 'models must be a ModelPort with call()');
    if (models && !owner) throw new FoundryError('POLICY', 'A ModelPort requires the runtime model policy');
    if (models?.policyHash && models.policyHash !== this.modelPolicyHash) throw new FoundryError('POLICY', 'The ModelPort and the runtime were given different model policies');
    if (typeof codeRunner !== 'function') throw new FoundryError('POLICY', 'codeRunner must be a function');
    this.models = models; this.codeRunner = codeRunner;
  }
  create(workflow, input = {}, options = {}) {
    const { modelMode = 'live', sampleSalt = null, assignment = null, identity = null, ...rest } = options;
    const { hash } = requireWorkflow(workflow, { registry: this.registry, modelPolicy: this.modelPolicy });
    if (workflow.inputSchema) validateData(workflow.inputSchema, input, 'workflow input'); else checkData(input);
    this.store.workflow(hash); // The exact immutable version must already be saved.
    if (!MODES.includes(modelMode)) throw new FoundryError('RUN_OPTIONS', `modelMode must be one of ${MODES.join('|')}`);
    if (sampleSalt !== null && (typeof sampleSalt !== 'string' || !sampleSalt || sampleSalt.length > 256)) throw new FoundryError('RUN_OPTIONS', 'sampleSalt must be a string of 1-256 characters');
    if (identity !== null && (!identity || typeof identity !== 'object' || Array.isArray(identity) || Object.keys(identity).some(k => !['arc', 'amp'].includes(k)))) throw new FoundryError('RUN_OPTIONS', 'identity may carry only arc and amp parts; the foundry part is runtime-owned');
    const assigned = this.assignment(workflow, assignment), id = randomUUID(), registryHash = this.registry.hash();
    const envelope = validateIdentity({ foundry: { workflowHash: hash, runId: id, engineHash, policyHash: digest(this.policy), registryHash }, ...clone(identity ?? {}) });
    const journal = this.models ? (sameDatabase(this.models.journal?.db, this.store.db) ? 'workspace' : 'external') : null;
    return this.store.createRun(hash, input, registryHash, this.policy, { ...rest, engineHash, id, journal, binding: {
      modelPolicyHash: modelNodes(workflow).length ? this.modelPolicyHash : null, modelMode, sampleSalt: sampleSalt ?? id,
      assignment: assigned, assignmentHash: digest(assigned), identity: envelope } });
  }
  // nodeId or nodeKey -> policy model id (DESIGN §5.1). Every key must name a model node and stay within its maxClass.
  assignment(workflow, assignment) {
    if (assignment === null || assignment === undefined) return {};
    if (typeof assignment !== 'object' || Array.isArray(assignment)) throw new FoundryError('RUN_OPTIONS', 'assignment must map node ids or keys to policy model ids');
    checkData(assignment);
    const entries = Object.entries(assignment), nodes = modelNodes(workflow);
    if (entries.length && !this.modelPolicy) throw new FoundryError('MODEL_POLICY_REQUIRED', 'A model assignment needs the owner model policy');
    for (const [key, modelId] of entries) {
      const entry = modelById(this.modelPolicy, modelId), targets = nodes.filter(n => key === n.id || key.endsWith(`/${n.id}`));
      if (key.length > 512 || !targets.length) throw new FoundryError('ASSIGNMENT_INVALID', `Assignment key ${key.slice(0, 80)} names no agent or model-verifier node`);
      for (const node of targets) {
        const max = node.model.maxClass ?? node.model.class ?? modelById(this.modelPolicy, node.model.id).class;
        if (classIndex(this.modelPolicy, entry.class) > classIndex(this.modelPolicy, max)) throw new FoundryError('ASSIGNMENT_INVALID', `${modelId} (class ${entry.class}) exceeds maxClass ${max} of ${node.id}`);
      }
    }
    return clone(assignment);
  }
  // The run.verdict chain event, sealed against the journal this runtime's ModelPort writes to (which may not be the store's database).
  verdictEvent(run) { return { type: 'run.verdict', ...run.verdict, ...this.store.sealBinding(run.id, run, this.models?.journal?.db) }; }
  async execute(runId, { signal } = {}) {
    // A Runtime invocation has isolated coordination state. Multiple runs may use
    // the same Store but must not share mutable in-flight fields.
    return new Invocation(this, runId, signal).execute();
  }
  answer(runId, nodeKey, answer) {
    const run = this.store.rows.header(runId); // NOT_FOUND; the run's own fields are enough here
    if (finished.has(run.status)) throw new FoundryError('RUN_CLOSED', 'A terminal run cannot accept answers');
    const closed = closingSeal(this.store.events(runId));
    if (closed) throw closedError(closed, run.status);
    const state = this.store.rows.nodeState(runId, ...splitKey(nodeKey));
    if (!state || state.status !== 'awaiting_human') throw new FoundryError('NO_QUESTION', 'No pending question exists at this node');
    validateData(state.answerSchema, answer, 'human answer');
    return this.store.updateRun(runId, r => {
      const current = locateNode(r, nodeKey);
      if (current.state.status !== 'awaiting_human') throw new FoundryError('ANSWER_CONFLICT', 'This question was already answered');
      current.state.status = 'completed'; current.state.completedAt = Date.now();
      current.frame.outputs[current.id] = { answer: clone(answer) }; r.status = 'ready';
    }, { type: 'human.answered', nodeKey, answerHash: digest(answer) });
  }
  approve(runId, approvalId, decision, actor = 'user') {
    if (typeof decision !== 'boolean' || actor !== 'user') throw new FoundryError('APPROVAL_AUTHORITY', 'An explicit user approval decision is required');
    return this.store.updateRun(runId, r => {
      if (finished.has(r.status)) throw new FoundryError('RUN_CLOSED', 'The run is already terminal');
      const closed = closingSeal(this.store.events(runId));
      if (closed) throw closedError(closed, r.status);
      const approval = r.approvals[approvalId];
      if (!approval || approval.status !== 'pending') throw new FoundryError('APPROVAL_CONFLICT', 'No matching pending approval');
      // What the approver is shown is the record's copy of the request; it must be the request the chain holds (tool, arguments, and the
      // taint labels that make the approval a declassification), or an edited record could show benign arguments for a harmful approvalId.
      const requested = this.store.events(runId).findLast(e => e.type === 'approval.requested' && e.approvalId === approvalId);
      // (Requests written before the labels entered the event carry no argsLabel; their tool and arguments are still checked.)
      if (!requested || requested.tool !== approval.tool || requested.argsHash !== digest(approval.args)
        || (Object.hasOwn(requested, 'argsLabel') && (requested.argsLabel !== (approval.argsLabel ?? 'trusted') || requested.controlLabel !== (approval.controlLabel ?? 'trusted'))))
        throw new FoundryError('APPROVAL_TAMPERED', 'The pending approval in the run record differs from the request its chain holds: the record was edited', { approvalId });
      approval.status = decision ? 'approved' : 'rejected'; approval.actor = actor; approval.decidedAt = Date.now();
      const target = locateNode(r, approval.nodeKey);
      if (!target || target.state.status !== 'awaiting_approval') throw new FoundryError('APPROVAL_CONFLICT', 'The approval no longer matches a waiting operation');
      target.state.status = decision ? 'pending' : 'failed';
      if (!decision) { r.status = 'cancelled'; r.error = { code: 'APPROVAL_REJECTED', message: 'User rejected the operation' }; seal(r, null, this.store); }
      else r.status = 'ready';
    }, run => [...(run.status === 'cancelled' && run.verdict ? [this.verdictEvent(run)] : []), { type: 'approval.decided', approvalId, approved: decision, actor }], { final: !decision });
  }
  // DESIGN §5.4: resume every run that has a due wait timer. Timers live in the store, so any Runtime instance
  // (a new process after a restart included) can do this. A timer whose node no longer waits is pruned; a run
  // that needs a ModelPort this runtime lacks is left untouched rather than failed. `start` lets a host route
  // through its own execution registry (Foundry.startRun) instead of this.execute.
  async tick({ now = Date.now(), limit = 100, signal, start = runId => this.execute(runId, { signal }) } = {}) {
    const due = new Map();
    for (const timer of this.store.dueTimers(now, limit)) {
      let run = null;
      try { run = this.store.rows.header(timer.runId); } catch (error) { if (error.code !== 'NOT_FOUND') throw error; }
      const state = run && this.store.rows.nodeState(timer.runId, ...splitKey(timer.nodeKey));
      if (!run || terminal.has(run.status) || !state || !['waiting', 'running'].includes(state.status)) { this.store.clearTimer(timer.runId, timer.nodeKey); continue; }
      due.set(run.id, run);
    }
    const runs = [];
    for (const [runId, run] of due) {
      if (signal?.aborted) { runs.push({ runId, skipped: 'CANCELLED' }); continue; }
      if (!this.models && modelNodes(this.store.workflow(run.workflowHash).workflow).length) { runs.push({ runId, skipped: 'MODEL_PORT_REQUIRED' }); continue; }
      try { const after = await start(runId); runs.push({ runId, status: after.status, ...(after.error ? { error: after.error } : {}) }); }
      catch (error) { runs.push({ runId, error: errorData(error) }); }
    }
    return { at: now, due: due.size, runs };
  }
}

export function locateNode(run, nodeKey) {
  const slash = nodeKey.lastIndexOf('/'), frameKey = nodeKey.slice(0, slash), id = nodeKey.slice(slash + 1);
  const frame = frameOf(run, frameKey); const state = frame?.nodes[id];
  return state ? { frame, state, id, frameKey } : null;
}

class Invocation {
  constructor(runtime, runId, signal) {
    this.store = runtime.store; this.registry = runtime.registry; this.runId = runId; this.runtime = runtime; this.rows = runtime.store.rows;
    this.abort = new AbortController(); this.token = randomUUID(); this.outerSignal = signal;
    this.flowDefinitions = new Map(); this.frameLabels = new Map(); this.frameControl = new Map(); this.nodeControl = new Map();
    this.userCancelled = false; this.replaySources = new Map();
    this.onAbort = () => { this.userCancelled = true; this.abort.abort(); };
    signal?.addEventListener('abort', this.onAbort, { once: true });
    if (signal?.aborted) this.onAbort();
  }
  // The whole record (every row): for the checks when a run is resumed. Everything else reads the rows it needs (store.rows).
  current() { return this.store.run(this.runId); }
  // The run's own fields: status, steps, cost, deadline, policy, approvals, assignment, owner, eventHead ... without its input, nodes or frames.
  head() { return this.rows.header(this.runId); }
  stateOf(frameKey, nodeId) { return this.rows.nodeState(this.runId, frameKey, nodeId); }
  // The run deadline stops a model call or code through its own signal, so the stop is never mistaken for the
  // operation's own timeout or a provider fault: reached() is true only when the deadline (not the caller) aborted it.
  untilDeadline(signal) {
    // Node clamps timers above 2^31-1 ms to 1 ms, so a far deadline is capped (a run never lives that long in one process).
    const deadline = AbortSignal.timeout(Math.min(2 ** 31 - 1, Math.max(1, this.head().deadline - Date.now())));
    return { signal: AbortSignal.any([signal, deadline]), reached: () => deadline.aborted && !signal.aborted };
  }
  // The abort signal of the current continuation's scope (a flow frame, a map, or the whole invocation).
  signal() { const scope = scopes.getStore(); return scope?.owner === this ? scope.controller.signal : this.abort.signal; }
  async scoped(fn) {
    const parent = this.signal(), controller = new AbortController(), forward = () => controller.abort();
    if (parent.aborted) controller.abort(); else parent.addEventListener('abort', forward, { once: true });
    try { return await scopes.run({ owner: this, controller }, () => fn(controller)); }
    finally { parent.removeEventListener('abort', forward); }
  }
  // `result: 'run'` returns the whole record afterwards (only the run's final update needs it); `final` marks that terminal update (the
  // seal or failure receipt may use the headroom the store keeps below its absolute state bounds).
  update(mutate, event, { result = 'header', final = false } = {}) {
    return this.store.updateRun(this.runId, r => {
      if (r.owner?.token !== this.token) throw new FoundryError('STALE_RUNNER', 'Execution ownership changed');
      mutate(r);
    }, event, { result, final });
  }
  eventNode(frameKey, nodeId, mutate, type, extra = {}) {
    return this.update(r => mutate(frameOf(r, frameKey), r), { type, nodeKey: `${frameKey}/${nodeId}`, ...extra });
  }
  checkBudget(run = this.head(), cost = 0) {
    if (this.signal().aborted) throw new FoundryError('CANCELLED', 'Execution cancelled');
    if (Date.now() >= run.deadline) throw new FoundryError('DEADLINE', 'Run deadline exhausted');
    if (run.steps >= Math.min(run.policy.maxSteps, this.workflow.budget.maxSteps)) throw new FoundryError('STEP_BUDGET', 'Run step budget exhausted');
    if (run.cost + cost > Math.min(run.policy.maxCost, this.workflow.budget.maxCost ?? run.policy.maxCost) + 1e-12) throw new FoundryError('COST_BUDGET', 'Run cost budget exhausted');
    // The stored size and JSON value count of the run (kept by the store as rows change), not a re-serialisation of it.
    let bytes = run[STATE_BYTES], items = run[STATE_ITEMS];
    if (bytes === undefined || items === undefined) ({ bytes, items } = this.rows.raw(this.runId));
    if (bytes > this.store.limits.budgetBytes || (items ?? 0) > this.store.limits.budgetItems) throw new FoundryError('STATE_BUDGET', 'Run state budget exhausted; reserved space remains for the failure receipt');
  }
  charge(frameKey, node, cost = 0, intent = {}) {
    this.eventNode(frameKey, node.id, (f, r) => {
      this.checkBudget(r, cost);
      const old = f.nodes[node.id] ?? { attempts: 0 };
      f.nodes[node.id] = { ...old, kind: node.kind, status: 'running', attempts: old.attempts + 1, startedAt: Date.now(), startedSequence: (r.eventHead?.seq ?? 0) + 1, ...intent };
      r.steps++; r.cost += cost;
      // A wait node's wake time is fixed and its timer registered when it starts, so a crash before it pauses keeps both.
      if (node.kind === 'wait') this.store.setTimer(r.id, `${frameKey}/${node.id}`, intent.wakeAt);
    }, node.kind === 'task' ? 'tool.intent' : 'node.started', { kind: node.kind, reservedCost: cost, ...intent });
  }
  complete(frameKey, node, output, status = 'completed', { state = {}, run: alsoRun } = {}) {
    checkData(output, { maxBytes: 512 * 1024 });
    const control = this.nodeControl.get(`${frameKey}/${node.id}`) ?? 'trusted';
    if (control !== 'trusted') state = { ...state, ...controlState(control), outputLabel: joinLabels([state.outputLabel ?? 'trusted', control]) };
    this.eventNode(frameKey, node.id, (f, run) => {
      f.nodes[node.id] = { ...f.nodes[node.id], ...state, status, completedAt: Date.now(), completedSequence: (run.eventHead?.seq ?? 0) + 1, outputHash: digest(output) };
      f.outputs[node.id] = clone(output);
      alsoRun?.(run);
    }, status === 'handled_error' ? 'node.handled_error' : 'node.completed', { outputHash: digest(output), output, ...state });
  }
  costLimit(run) { return Math.min(run.policy.maxCost, this.workflow.budget.maxCost ?? run.policy.maxCost); }
  // The integrity labels a reference in `templates` can inherit (inheritedLabel): the frame's own labels plus the non-trusted output label of each
  // node a reference names (`nodes.X...`; a bare `nodes` reads them all). Only those nodes' labels are fetched.
  labelScope(frameKey, ...templates) {
    const scope = { ...(this.frameLabels.get(frameKey) ?? {}) }, named = new Set();
    let every = false;
    for (const ref of templates.flatMap(template => typeof template === 'string' ? [template] : references(template ?? null))) {
      const [root, id] = ref.split('.');
      if (root !== 'nodes') continue;
      if (id === undefined) every = true; else named.add(id);
    }
    if (every || named.size) for (const [id, label] of this.rows.labels(this.runId, frameKey, every ? null : named)) scope[`nodes.${id}`] = label;
    return scope;
  }
  // The control label of a node about to run or be skipped (see controlState). onError "continue" lets a predecessor's data decide
  // whether it completes, so its whole output label counts. A predecessor joined with all_resolved never changes whether this node runs.
  // `states` holds the states of the node's predecessors.
  controlLabel(node, frameKey, states) {
    const parts = [this.frameControl.get(frameKey) ?? 'trusted'];
    if (node.when) parts.push(labelOf(node.when, this.labelScope(frameKey, node.when)));
    if ((node.join ?? 'all_success') === 'all_success' && node.needs.length) {
      const definitions = this.flowDefinitions.get(frameKey).nodes;
      for (const dep of node.needs) {
        parts.push(states[dep]?.controlLabel ?? 'trusted');
        if (definitions.find(n => n.id === dep)?.onError === 'continue') parts.push(states[dep]?.outputLabel ?? 'trusted');
      }
    }
    return joinLabels(parts);
  }
  // Every node label recorded in the child frames of one map/loop node (conservative join).
  childLabels(frameKey, nodeId, index = null) {
    return joinLabels(this.rows.frameLabels(this.runId, `${frameKey}/${nodeId}:${index ?? ''}`, { exact: index !== null }));
  }
  async execute() {
    let owned = false;
    try {
      let run = this.current();
      this.workflow = this.store.workflow(run.workflowHash).workflow;
      const modelBound = !!run.modelPolicyHash || modelNodes(this.workflow).length > 0;
      if (modelBound && !this.runtime.modelPolicyHash) throw new FoundryError('MODEL_POLICY_REQUIRED', 'This run uses models; supply the owner model policy to resume it');
      if (modelBound && run.modelPolicyHash !== this.runtime.modelPolicyHash) throw new FoundryError('MODEL_POLICY_DRIFT', 'The model policy changed since this run was created; resume is blocked', { recorded: run.modelPolicyHash ?? null, current: this.runtime.modelPolicyHash });
      requireWorkflow(this.workflow, { registry: this.registry, modelPolicy: this.runtime.modelPolicy });
      if (run.registryHash !== this.registry.hash()) throw new FoundryError('CAPABILITY_DRIFT', 'Capabilities changed since run creation');
      const log = this.store.events(this.runId); // Verify the chain before trusting a checkpoint.
      if (finished.has(run.status)) return run;
      const closed = closingSeal(log);
      if (closed) throw closedError(closed, run.status);
      if (!run.engineHash) throw new FoundryError('ENGINE_UNBOUND', 'This historical run has no native engine binding. Inspect it or use its original frozen runtime; do not silently resume it under changed semantics.');
      if (run.engineHash !== engineHash) throw new FoundryError('ENGINE_DRIFT', 'The native execution engine differs from the version that created this run. Resume with the original engine or create a separately reviewed new run.', { recorded: run.engineHash, current: engineHash });
      const birth = log[0];
      if (birth?.engineHash !== run.engineHash) throw new FoundryError('ENGINE_BINDING_CORRUPT', 'Run engine identity does not match its immutable creation event');
      if (modelBound && (birth?.modelPolicyHash ?? null) !== run.modelPolicyHash) throw new FoundryError('MODEL_POLICY_BINDING_CORRUPT', 'Run model policy binding does not match its immutable creation event');
      // The rest of the run's identity, against the same event: the record is a checkpoint any writer to the workspace can edit, and the
      // runtime executes the workflow, input and policy (allowed capabilities, budgets) it names, so an edit there would widen the run.
      const changed = identityChanges(run, birth);
      if (changed.length) throw new FoundryError('RUN_BINDING_CORRUPT', `The run record no longer matches its immutable creation event (${changed.join(', ')}): the record was edited, so the run is not resumed`, { changed });
      const forged = forgedAnswers(this.workflow, run, log);
      if (forged.length) throw new FoundryError('CHECKPOINT_TAMPERED', `The run record holds human answers its chain did not record (${forged.slice(0, 5).join(', ')}): the record was edited, so the run is not resumed`, { nodeKeys: forged });
      // The node rows' status and label columns decide what runs and what taint a reference inherits; they must still repeat the node states.
      const mismatched = this.rows.mismatchedRows(this.runId);
      if (mismatched.length) throw new FoundryError('CHECKPOINT_TAMPERED', `The run's node rows were edited (${mismatched.slice(0, 3).map(m => `${m.nodeKey}: ${m.reason}`).join('; ')}), so the run is not resumed`, { nodeKeys: mismatched.map(m => m.nodeKey) });
      this.store.updateRun(this.runId, r => {
        if (r.owner && alive(r.owner)) throw new FoundryError('RUN_BUSY', 'Another live runner owns this run');
        if ((r.resumeCount ?? 0) >= (r.policy.maxResumes ?? 1000)) throw new FoundryError('RESUME_BUDGET', 'Run resume budget exhausted');
        r.resumeCount = (r.resumeCount ?? 0) + 1;
        r.owner = { token: this.token, pid: process.pid, processStart: startStamp(process.pid), acquiredAt: Date.now() };
        r.status = 'running';
      }, { type: 'runner.acquired', token: this.token }, { result: 'header' });
      owned = true;
      if (Date.now() >= run.deadline) throw new FoundryError('DEADLINE', 'Run deadline exhausted before resume');
      this.semaphore = new Semaphore(Math.min(run.policy.maxConcurrency, this.workflow.budget.maxConcurrency));
      this.recover();
      const result = await this.flow(this.workflow, 'root', run.input, {});
      let status = result.done ? 'succeeded' : 'waiting';
      if (this.rows.anyWithStatus(this.runId, 'awaiting_human')) status = 'awaiting_human';
      if (this.rows.anyWithStatus(this.runId, 'awaiting_approval')) status = 'awaiting_approval';
      if (this.rows.anyWithStatus(this.runId, 'uncertain')) status = 'uncertain';
      if (status === 'succeeded' && Date.now() >= this.head().deadline) throw new FoundryError('DEADLINE', 'Run deadline exhausted before completion was committed');
      return this.update(r => { r.status = status; r.owner = null; seal(r, this.workflow, this.store); }, r => [...(r.verdict ? [this.runtime.verdictEvent(r)] : []), { type: `run.${status}` }], { result: 'run', final: true });
    } catch (error) {
      this.abort.abort();
      if (!owned) throw error;
      return this.update(r => {
        r.status = this.rows.anyWithStatus(this.runId, 'uncertain') ? 'uncertain' : (this.userCancelled || error.code === 'CANCELLED' ? 'cancelled' : 'failed');
        r.error = errorData(error); r.owner = null; seal(r, this.workflow, this.store);
      }, r => [...(r.verdict ? [this.runtime.verdictEvent(r)] : []), { type: 'run.stopped', error: errorData(error) }], { result: 'run', final: true });
    } finally { this.outerSignal?.removeEventListener('abort', this.onAbort); }
  }
  recover() {
    for (const { frameKey, nodeId: id, state } of this.rows.withStatus(this.runId, 'running')) {
      if (state.kind !== 'task') continue;
      const cap = this.registry.get(state.tool);
      if (!cap) throw new FoundryError('CAPABILITY_DRIFT', 'Interrupted operation capability is missing');
      const uncertain = cap.effects === 'non-idempotent';
      this.eventNode(frameKey, id, current => {
        current.nodes[id].status = uncertain ? 'uncertain' : 'pending';
        current.nodes[id].recovered = true;
      }, uncertain ? 'effect.uncertain' : 'node.recovered', { effects: cap.effects });
    }
  }
  context(frameKey, input, locals) {
    return { input: clone(input), nodes: lazyOutputs(this.rows, this.runId, frameKey), ...clone(locals) };
  }
  async flow(flow, frameKey, input, locals, labels = frameKey === 'root' ? { ...(this.workflow.labels ?? {}) } : {}, control = 'trusted') {
    this.flowDefinitions.set(frameKey, flow); this.frameLabels.set(frameKey, labels); this.frameControl.set(frameKey, control);
    if (frameKey !== 'root') {
      const old = this.rows.frame(this.runId, frameKey);
      const contextHash = digest({ input, locals });
      if (old && old.contextHash !== contextHash) throw new FoundryError('FRAME_DRIFT', 'Nested execution context changed');
      if (!old) this.update(r => { r.frames[frameKey] = { nodes: {}, outputs: {}, contextHash }; }, { type: 'frame.created', frameKey, contextHash });
    }
    // A failing node cancels its own frame's in-flight siblings; its caller (a parent flow or a map) decides what else stops.
    return this.scoped(async scope => {
      const attempted = new Set();
      while (true) {
        const run = this.head();
        if (scope.signal.aborted) throw new FoundryError('CANCELLED', 'Run cancellation was requested; completed effects remain in the evidence ledger');
        if (Date.now() >= run.deadline) throw new FoundryError('DEADLINE', 'Run deadline exhausted');
        if (this.rows.anyWithStatus(this.runId, 'uncertain')) return { done: false, outputs: this.rows.frameOutputs(this.runId, frameKey) };
        const statuses = this.rows.statuses(this.runId, frameKey);
        if (flow.nodes.every(n => nodeDone.has(statuses.get(n.id)))) {
          const ctx = this.context(frameKey, input, locals);
          if (!flow.acceptance.every(c => condition(c, ctx))) throw new FoundryError('ACCEPTANCE_FAILED', `Acceptance failed for ${frameKey}`);
          if (Date.now() >= this.head().deadline) throw new FoundryError('DEADLINE', 'Run deadline exhausted during acceptance evaluation');
          return { done: true, outputs: this.rows.frameOutputs(this.runId, frameKey) };
        }
        const ready = flow.nodes.filter(n => !attempted.has(n.id) && !nodeDone.has(statuses.get(n.id)) && n.needs.every(dep => nodeDone.has(statuses.get(dep))));
        if (!ready.length) return { done: false, outputs: this.rows.frameOutputs(this.runId, frameKey) };
        // Limit concurrent node continuations as well as actual capability calls.
        const batch = ready.slice(0, Math.min(this.workflow.budget.maxConcurrency, run.policy.maxConcurrency));
        batch.forEach(n => attempted.add(n.id));
        const results = await Promise.allSettled(batch.map(async n => {
          try { return await this.node(n, frameKey, input, locals); }
          catch (error) {
            this.eventNode(frameKey, n.id, frame => {
              if (frame.nodes[n.id]?.status !== 'uncertain') frame.nodes[n.id] = { ...(frame.nodes[n.id] ?? { kind: n.kind, attempts: 0 }), status: 'failed', error: errorData(error) };
            }, 'node.failed', { error: errorData(error) });
            scope.abort();
            throw error;
          }
        }));
        const failure = results.find(x => x.status === 'rejected' && !cancelled(x.reason)) ?? results.find(x => x.status === 'rejected');
        if (failure) throw failure.reason;
      }
    });
  }
  async node(node, frameKey, input, locals) {
    let state = this.stateOf(frameKey, node.id);
    if (['awaiting_human', 'awaiting_approval', 'uncertain'].includes(state?.status)) return;
    const ctx = this.context(frameKey, input, locals);
    const predecessors = this.rows.nodeStates(this.runId, frameKey, node.needs);
    const control = this.controlLabel(node, frameKey, predecessors);
    this.nodeControl.set(`${frameKey}/${node.id}`, control);
    if (!state && (node.join ?? 'all_success') === 'all_success' && node.needs.some(id => predecessors[id]?.status !== 'completed')) {
      this.eventNode(frameKey, node.id, f => { f.nodes[node.id] = { kind: node.kind, status: 'skipped', attempts: 0, reason: 'required predecessor did not succeed', ...controlState(control) }; }, 'node.skipped', { reason: 'required predecessor did not succeed' });
      return;
    }
    if (!state && node.when && !condition(node.when, ctx)) {
      this.eventNode(frameKey, node.id, f => { f.nodes[node.id] = { kind: node.kind, status: 'skipped', attempts: 0, ...controlState(control) }; }, 'node.skipped'); return;
    }
    if (node.kind === 'task') return this.task(node, frameKey, ctx);
    const resumed = state?.status === 'running';
    if (!state) { this.charge(frameKey, node, 0, node.kind === 'wait' ? { wakeAt: Date.now() + node.delayMs } : {}); state = this.stateOf(frameKey, node.id); }
    if (node.kind === 'agent') return this.agent(node, frameKey, ctx, state, resumed);
    if (node.kind === 'code') return this.code(node, frameKey, ctx);
    if (node.kind === 'verify') return this.verify(node, frameKey, ctx, state, resumed);
    if (node.kind === 'assert') {
      if (!node.checks.every(c => condition(c, ctx))) throw new FoundryError('ASSERTION_FAILED', `Assertion ${node.id} failed`);
      this.complete(frameKey, node, { passed: true }); return;
    }
    if (node.kind === 'human') {
      this.eventNode(frameKey, node.id, f => {
        Object.assign(f.nodes[node.id], { status: 'awaiting_human', question: node.question, answerSchema: clone(node.answerSchema), ...controlState(control) });
      }, 'human.requested', { question: node.question }); return;
    }
    if (node.kind === 'wait') {
      // DESIGN §5.4: the timer row commits with the waiting state; a tick (any process) resumes the run when it is due.
      const wakeAt = state.wakeAt ?? Date.now() + node.delayMs, nodeKey = `${frameKey}/${node.id}`;
      if (Date.now() < wakeAt) {
        this.eventNode(frameKey, node.id, (f, r) => { Object.assign(f.nodes[node.id], { status: 'waiting', wakeAt }); this.store.setTimer(r.id, nodeKey, wakeAt); }, 'node.waiting', { wakeAt }); return;
      }
      this.complete(frameKey, node, { waitedMs: node.delayMs }, 'completed', { run: r => this.store.clearTimer(r.id, nodeKey) }); return;
    }
    if (node.kind === 'map') return this.map(node, frameKey, ctx, input);
    if (node.kind === 'loop') {
      const childInput = Object.hasOwn(node, 'input') ? resolve(node.input, ctx) : input;
      const scope = this.labelScope(frameKey, node.initial, node.input), initialLabel = labelOf(node.initial, scope);
      const inherited = Object.hasOwn(node, 'input') ? labelEntry('input', labelOf(node.input, scope)) : inputLabels(scope);
      let previous = resolve(node.initial, ctx), exits = 'trusted';
      for (let iteration = 0; iteration < node.maxIterations; iteration++) {
        const childKey = `${frameKey}/${node.id}:${iteration}`;
        const childLocals = { iteration, previous };
        const previousLabel = iteration === 0 ? initialLabel : this.childLabels(frameKey, node.id, iteration - 1);
        // Whether this iteration runs at all was decided by the until of every earlier iteration.
        const result = await this.flow(node.body, childKey, childInput, childLocals, { ...inherited, ...labelEntry('previous', previousLabel) }, joinLabels([control, exits]));
        if (!result.done) { this.eventNode(frameKey, node.id, f => { f.nodes[node.id].status = 'waiting_child'; }, 'node.waiting_child'); return; }
        exits = joinLabels([exits, labelOf(node.until, this.labelScope(childKey, node.until))]);
        if (condition(node.until, { input: childInput, nodes: result.outputs, ...childLocals })) {
          this.complete(frameKey, node, { iterations: iteration + 1, last: result.outputs }, 'completed', { state: labelState(joinLabels([initialLabel, this.childLabels(frameKey, node.id), exits])) }); return;
        }
        previous = result.outputs;
      }
      throw new FoundryError('LOOP_EXHAUSTED', `${node.id} exhausted its iteration budget without satisfying until`);
    }
    throw new FoundryError('UNKNOWN_NODE', `Unsupported node kind ${node.kind}`);
  }
  // DESIGN §1.4. Up to `concurrency` items run at once (capped by the run's concurrency); outputs are ordered by index.
  // An item that settles is recorded on its frame, so a resumed map re-enters only incomplete items. fail_fast
  // cancels in-flight siblings on the first failure. collect records {$error} for the item and lets siblings run,
  // unless the failure stops the whole run (budget, environment, cancellation, policy, integrity). An item that
  // pauses (human, approval, wait, uncertain effect) stops new items from starting; in-flight items still finish.
  async map(node, frameKey, ctx, input) {
    const control = this.nodeControl.get(`${frameKey}/${node.id}`) ?? 'trusted';
    const items = resolve(node.items, ctx);
    if (!Array.isArray(items) || items.length > node.maxItems) throw new FoundryError('MAP_BOUND', 'Map input is not an array or exceeds maxItems');
    const childInput = Object.hasOwn(node, 'input') ? resolve(node.input, ctx) : input;
    const scope = this.labelScope(frameKey, node.items, node.input), itemLabel = labelOf(node.items, scope);
    const childLabels = { ...(Object.hasOwn(node, 'input') ? labelEntry('input', labelOf(node.input, scope)) : inputLabels(scope)), ...labelEntry('item', itemLabel) };
    const run = this.head(), nodeKey = `${frameKey}/${node.id}`, collect = node.failure === 'collect';
    const limit = Math.max(1, Math.min(node.concurrency ?? 1, this.workflow.budget.maxConcurrency, run.policy.maxConcurrency));
    const results = new Array(items.length), pending = [], failures = [];
    items.forEach((item, index) => {
      const frame = this.rows.frame(this.runId, `${nodeKey}:${index}`);
      if (!frame?.result) { pending.push(index); return; }
      if (frame.contextHash !== digest({ input: childInput, locals: { item, index } })) throw new FoundryError('FRAME_DRIFT', 'Nested execution context changed');
      results[index] = frame.result === 'failed' ? { $error: clone(frame.error) } : this.rows.frameOutputs(this.runId, `${nodeKey}:${index}`);
    });
    let next = 0, halted = false;
    await this.scoped(async siblings => {
      const worker = async () => {
        while (!halted && !failures.length && next < pending.length) {
          const index = pending[next++], key = `${nodeKey}:${index}`;
          try {
            // How many items run (and so how often an effect in the body fires) is decided by the items array.
            const result = await this.flow(node.body, key, childInput, { item: items[index], index }, childLabels, joinLabels([control, itemLabel]));
            if (!result.done) { halted = true; return; }
            this.update(r => { r.frames[key].result = 'completed'; }, { type: 'map.item.completed', nodeKey, index });
            results[index] = result.outputs;
          } catch (error) {
            let failure = error;
            if (collect && !siblings.signal.aborted && !unhandled.has(error.code)) {
              const data = errorData(error);
              try {
                this.update(r => { Object.assign(r.frames[key], { result: 'failed', error: data }); }, { type: 'map.item.failed', nodeKey, index, error: data });
                results[index] = { $error: data }; continue;
              } catch (recording) { failure = recording; }
            }
            failures.push(failure); siblings.abort();
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(limit, pending.length) }, worker));
    });
    if (failures.length) throw failures.find(error => !cancelled(error)) ?? failures[0];
    if (halted) { this.eventNode(frameKey, node.id, f => { f.nodes[node.id].status = 'waiting_child'; }, 'node.waiting_child'); return; }
    const failed = results.filter(item => Object.hasOwn(item, '$error')).length;
    // A collected $error carries the item's error text, which can quote anything the item could read: its inputs and item.
    const failedLabel = failed ? joinLabels(Object.values(childLabels)) : 'trusted';
    this.complete(frameKey, node, { items: results, count: results.length, ...(collect ? { failed } : {}) }, 'completed',
      { state: { ...labelState(joinLabels([itemLabel, failedLabel, this.childLabels(frameKey, node.id)])), ...(collect ? { failedItems: failed } : {}) } });
  }
  async task(node, frameKey, ctx) {
    const cap = this.registry.get(node.tool), run = this.head();
    if (!cap || !run.policy.allowedCapabilities.includes(node.tool)) throw new FoundryError('CAPABILITY_DENIED', `Capability ${node.tool} is not permitted for this run`);
    const args = resolve(node.args, ctx), argsLabel = labelOf(node.args, this.labelScope(frameKey, node.args)), signal = this.signal();
    validateData(cap.inputSchema, args, `${node.tool} input`);
    // DESIGN §4: untrusted-derived arguments reach an effect only through an approval gate (the validator rejects this statically).
    if (cap.effects !== 'none' && !approvalGated(cap) && argsLabel !== 'trusted') throw new FoundryError('LABEL_POLICY', labelPolicyMessage(node.tool, argsLabel), { rule: 'UNTRUSTED_EFFECT_ARGS', label: argsLabel });
    // ...and the same for whether the effect fires at all (control-flow taint).
    const control = this.nodeControl.get(`${frameKey}/${node.id}`) ?? 'trusted';
    if (cap.effects !== 'none' && !approvalGated(cap) && control !== 'trusted') throw new FoundryError('LABEL_POLICY', controlPolicyMessage(node.tool, control), { rule: 'UNTRUSTED_CONTROL', label: control });
    this.requireEvidence(cap, args, frameKey, node);
    const nodeKey = `${frameKey}/${node.id}`;
    const idempotencyKey = digest({ runId: this.runId, nodeKey, workflowHash: run.workflowHash, args });
    const approvalId = digest({ workflowHash: run.workflowHash, registryHash: run.registryHash, nodeKey, tool: node.tool, args, idempotencyKey });
    const gated = cap.requiresApproval || cap.risk === 'high';
    // The grant is the user's decision in the hash chain (approval.decided), not the run record's copy of it: the record is a checkpoint any
    // writer to the workspace can edit, and an approval planted there (or flipped from pending) would otherwise fire the effect unasked.
    if (gated && run.approvals[approvalId]?.status === 'approved' && !this.approvedInChain(approvalId))
      throw new FoundryError('APPROVAL_TAMPERED', `The run record says approval ${approvalId.slice(0, 12)} for ${node.id} was granted, but the run's chain holds no user decision granting it: the record was edited`, { approvalId, nodeKey });
    if (gated && run.approvals[approvalId]?.status !== 'approved') {
      this.eventNode(frameKey, node.id, (f, r) => {
        f.nodes[node.id] = { ...(f.nodes[node.id] ?? { attempts: 0 }), kind: 'task', status: 'awaiting_approval', tool: node.tool, approvalId };
        r.approvals[approvalId] = { id: approvalId, nodeKey, tool: node.tool, args: clone(args), idempotencyKey, status: 'pending', risk: cap.risk,
          // The approver sees that untrusted data shaped this request, which is what makes the approval a declassification step.
          ...(argsLabel !== 'trusted' ? { argsLabel } : {}), ...(control !== 'trusted' ? { controlLabel: control } : {}) };
      }, 'approval.requested', { approvalId, tool: node.tool, argsHash: digest(args), argsLabel, controlLabel: control }); return;
    }
    const old = this.stateOf(frameKey, node.id);
    if ((old?.attempts ?? 0) >= node.retry.maxAttempts) throw new FoundryError('RETRY_EXHAUSTED', `${node.id} exhausted its total attempt budget`);
    while ((this.stateOf(frameKey, node.id)?.attempts ?? 0) < node.retry.maxAttempts) {
      await this.semaphore.take(signal);
      let acquired = true;
      try {
        this.charge(frameKey, node, cap.cost, { tool: node.tool, idempotencyKey, argsHash: digest(args), effects: cap.effects });
        this.requireEvidence(cap, args, frameKey, node);
        const localAbort = new AbortController();
        const stop = () => localAbort.abort(); signal.addEventListener('abort', stop, { once: true });
        let settled = false, timeout, timedOut = false;
        const remaining = this.head().deadline - Date.now(), deadlineBound = remaining <= node.timeoutMs;
        const timeoutMs = Math.min(node.timeoutMs, Math.max(1, remaining));
        const execution = this.registry.execute(node.tool, args, {
          signal: localAbort.signal, runId: this.runId, nodeKey, idempotencyKey,
          artifactsDir: path.join(this.store.directory, 'artifacts', this.runId), store: this.store
        }).finally(() => { settled = true; });
        const timer = new Promise((_, reject) => {
          timeout = setTimeout(() => { timedOut = true; localAbort.abort(); reject(new FoundryError('TOOL_TIMEOUT', `${node.tool} timed out`)); }, timeoutMs);
        });
        try {
          const result = await Promise.race([execution, timer]);
          // Fault injection is explicit, only available to trusted test callers.
          if (this.head().extra?.crashAfterTool === nodeKey) process.kill(process.pid, 'SIGKILL');
          this.complete(frameKey, node, result, 'completed', { state: labelState(argsLabel) }); return;
        } catch (error) {
          localAbort.abort();
          if (timedOut && deadlineBound) error = deadlineStop(node.tool);
          if (timedOut && !settled) await Promise.race([execution.catch(() => {}), delay(100)]);
          if (cap.effects === 'non-idempotent' || (timedOut && !settled) || (this.userCancelled && cap.effects !== 'none')) {
            this.eventNode(frameKey, node.id, f => { Object.assign(f.nodes[node.id], { status: 'uncertain', error: errorData(error) }); }, 'effect.uncertain', { error: errorData(error), cancellationConfirmed: settled });
            return;
          }
          this.eventNode(frameKey, node.id, f => { Object.assign(f.nodes[node.id], { status: 'pending', error: errorData(error) }); }, 'tool.failed', { error: errorData(error) });
          if (signal.aborted) throw new FoundryError('CANCELLED', 'Execution cancelled while an operation was in progress');
          if (error.code === 'DEADLINE') throw error; // never retried, never handled by onError
          const attempts = this.stateOf(frameKey, node.id).attempts;
          if (attempts >= node.retry.maxAttempts) {
            if (node.onError === 'continue') { this.complete(frameKey, node, { ok: false, error: errorData(error) }, 'handled_error', { state: labelState(argsLabel) }); return; }
            this.eventNode(frameKey, node.id, f => { f.nodes[node.id].status = 'failed'; }, 'node.failed', { error: errorData(error) });
            throw error;
          }
        } finally { clearTimeout(timeout); signal.removeEventListener('abort', stop); }
      } finally { if (acquired) { this.semaphore.release(); acquired = false; } }
      if (node.retry.backoffMs) {
        try { await delay(node.retry.backoffMs, undefined, { signal }); }
        catch (error) {
          if (error.code === 'ABORT_ERR') throw new FoundryError('CANCELLED', 'Execution cancelled during retry backoff');
          throw error;
        }
      }
    }
  }

  async agent(node, frameKey, ctx, state, resumed) {
    try {
      const { value, compiled, entry, escalations } = await this.modelLoop(node, frameKey, ctx, state, resumed, { returns: node.returns, checks: node.checks ?? [] });
      this.complete(frameKey, node, value, 'completed', { state: { ...labelState(compiled.outputLabel), modelId: entry.id, modelClass: entry.class, escalations, receiptHash: compiled.receiptHash } });
    } catch (error) {
      if (node.onError !== 'continue' || unhandled.has(error.code)) throw error;
      this.complete(frameKey, node, { ok: false, error: errorData(error) }, 'handled_error');
    }
  }
  // DESIGN §5.1. The journal is the loop's memory: a resumed attempt recompiles the same requests,
  // and ModelPort serves already-journaled calls of this (run, node, attempt) without a provider call.
  async modelLoop(node, frameKey, ctx, state, resumed, { returns, checks, excludeFamily = new Set(), extraInputs = [] }) {
    const models = this.runtime.models, policy = this.runtime.modelPolicy;
    if (!models) throw new FoundryError('MODEL_PORT_REQUIRED', `${node.id} needs a ModelPort; this runtime was created without one`);
    const run = this.head(), nodeKey = `${frameKey}/${node.id}`, attempt = state.attempts, limits = policy.escalation ?? {};
    const rules = { schemaRetries: node.escalation?.schemaRetries ?? limits.schemaRetriesBeforeEscalation ?? 1, onCheckFail: node.escalation?.onCheckFail ?? 'escalate',
      maxEscalations: Math.min(node.escalation?.maxEscalations ?? 2, limits.maxEscalationsPerNode ?? 2, 2), maxResamples: node.escalation?.maxResamples ?? 1 };
    const declared = node.model.class ?? modelById(policy, node.model.id).class, max = node.model.maxClass ?? declared;
    const assigned = run.assignment?.[nodeKey] ?? run.assignment?.[node.id];
    let entry = assigned ? modelById(policy, assigned) : node.model.id ? modelById(policy, node.model.id) : modelsForClass(policy, declared, { excludeFamily })[0];
    if (!entry || excludeFamily.has(entry.family)) throw new FoundryError('VERIFY_INDEPENDENCE', `${node.id}: no permitted ${declared} model outside the producer famil${excludeFamily.size === 1 ? 'y' : 'ies'} ${[...excludeFamily].join(', ')}`);
    if (classIndex(policy, entry.class) > classIndex(policy, max)) throw new FoundryError('ASSIGNMENT_INVALID', `${entry.id} (class ${entry.class}) exceeds maxClass ${max} of ${node.id}`);
    if (resumed) this.eventNode(frameKey, node.id, () => {}, 'node.resumed', { attempt, source: 'journal' });
    const inputs = [...contextInputs(node, ctx, this.labelScope(frameKey, ...(node.context?.inputs ?? []).map(spec => spec.ref).filter(ref => typeof ref === 'string'))), ...extraInputs];
    let retries = 0, resamples = 0, sampleIndex = 0, escalations = 0, retryNote = null, recovered = false;
    const escalate = (rule, code, message) => {
      let target = null;
      if (escalations < rules.maxEscalations)
        for (let cls = nextClass(policy, entry.class); cls && !target && classIndex(policy, cls) <= classIndex(policy, max); cls = nextClass(policy, cls)) target = modelsForClass(policy, cls, { excludeFamily })[0] ?? null;
      if (!target) throw new FoundryError('MODEL_ESCALATION_EXHAUSTED', `${node.id}: ${rule} after ${code} on ${entry.id} has no permitted escalation (${escalations}/${rules.maxEscalations} used, maxClass ${max})`,
        { rule, lastError: { code, message: String(message).slice(0, 1000) }, modelId: entry.id, escalations, maxClass: max });
      escalations++;
      const detail = { rule, fromClass: entry.class, toClass: target.class, fromModel: entry.id, toModel: target.id, costSoFar: this.stateOf(frameKey, node.id).costUsd ?? 0, errorCode: code, escalation: escalations, ...(recovered ? { recovered: true } : {}) };
      this.eventNode(frameKey, node.id, (f, r) => {
        f.nodes[node.id].escalations = escalations;
        this.decide(r, 'escalation', { nodeKey, attempt, escalation: escalations, fromModel: entry.id, toModel: target.id }, {
          features: { nodeKey, rule, errorCode: code, fromClass: entry.class, toClass: target.class, fromModel: entry.id, toModel: target.id, escalation: escalations, maxEscalations: rules.maxEscalations, maxClass: max },
          action: { escalateTo: target.id, toClass: target.class }, rationale: `${rule}: ${code} on ${entry.id}; escalating ${entry.class} to ${target.class}`, costUsd: detail.costSoFar });
      }, 'model.escalated', detail);
      retries = 0; resamples = 0; sampleIndex = 0; retryNote = null;
      return target;
    };
    while (true) {
      const compiled = compileContext({ node, workflow: this.workflow, inputs, classBudget: policy.inputBudgetTokensByClass?.[entry.class], retryNote, schema: returns });
      const selected = { modelId: entry.id, modelClass: entry.class, sampleIndex, escalations, receiptHash: compiled.receiptHash };
      // journalMark: the journal's highest row id before this call, so a row this attempt "recovers" can be shown to postdate the attempt.
      const journalMark = typeof models.journal?.highWater === 'function' ? models.journal.highWater() : undefined;
      this.eventNode(frameKey, node.id, (f, r) => { this.preflight(r); Object.assign(f.nodes[node.id], selected); }, 'context.compiled', { ...selected, attempt, retry: retries, receipt: compiled.receipt, ...(journalMark === undefined ? {} : { journalMark }) });
      const signal = this.signal(), stop = this.untilDeadline(signal);
      await this.semaphore.take(signal);
      let result;
      try {
        result = await models.call({ runId: this.runId, nodeKey, attempt, sampleIndex, modelId: entry.id, system: compiled.system, prompt: compiled.prompt, schema: returns,
          decoding: node.decoding ?? {}, receiptHash: compiled.receiptHash, signal: stop.signal, mode: run.modelMode ?? 'live', salt: run.sampleSalt ?? this.runId,
          // Default per-call timeout: the ModelPort's own (300 s by default, the same as a B1 script's gateway calls).
          timeoutMs: node.timeoutMs ?? (Number.isInteger(models.timeoutMs) ? models.timeoutMs : 120000) });
      } catch (error) {
        // A cancelled call is journaled with what it consumed; charge that before the cancellation propagates.
        const spent = error.code === 'CANCELLED' ? error.details : null;
        if (spent?.journalId != null) this.chargeModel(frameKey, node, spent, 'model.cancelled', { modelId: entry.id, attempt, sampleIndex, errorCode: 'CANCELLED',
          costUsd: spent.costUsd, imputedUsd: spent.imputedUsd ?? 0, latencyMs: spent.latencyMs, usage: spent.usage, journalId: spent.journalId, ...unknownOf(spent) });
        throw stop.reached() ? deadlineStop(`${node.id}'s model call`, { journalId: spent?.journalId ?? null, modelId: entry.id }) : error;
      } finally { this.semaphore.release(); }
      // Fault injection is explicit, only available to trusted test callers: the journal row is committed, the run is not.
      if (this.head().extra?.crashAfterModel === nodeKey) process.kill(process.pid, 'SIGKILL');
      recovered = result.recovered === true;
      const code = result.ok ? null : result.error?.code ?? 'MODEL_PROTOCOL';
      this.chargeModel(frameKey, node, result, recovered ? 'node.recovered_from_journal' : 'model.called', { modelId: result.modelId, provider: result.provider, engineVersion: result.engineVersion, attempt, sampleIndex,
        ok: result.ok, errorCode: code, costUsd: result.costUsd, imputedUsd: result.imputedUsd ?? 0, latencyMs: result.latencyMs, usage: result.usage, finishReason: result.finishReason,
        journalId: result.journalId ?? null, replayed: result.replayed === true && !recovered, ...(result.replayedFrom ? { replayedFrom: result.replayedFrom } : {}), ...unknownOf(result) });
      const spent = this.head();
      if (spent.cost > this.costLimit(spent) + 1e-12) throw new FoundryError('COST_BUDGET', `Run cost budget exhausted by a model call at ${node.id}`);
      if (!result.ok) {
        const message = result.error?.message ?? code;
        if (environmentFaults.has(code) || providerFaults.has(code)) throw new FoundryError(code, `${node.id}: ${message}`, { journalId: result.journalId ?? null, modelId: entry.id });
        if (retryable.has(code) && retries < rules.schemaRetries) {
          retries++; retryNote = `Retry ${retries} of ${rules.schemaRetries} on this model. ${code}: ${result.error?.feedback ?? RETRY_FEEDBACK[code]}`;
          this.eventNode(frameKey, node.id, () => {}, 'model.retry', { rule: 'E1', modelId: entry.id, errorCode: code, retry: retries, ...(recovered ? { recovered: true } : {}) });
          continue;
        }
        entry = escalate('E1', code, message); continue;
      }
      const failed = this.failedCheck(checks.map(bindOutput), withOutput(ctx, result.value));
      if (!failed) return { value: result.value, compiled, entry, escalations };
      if (rules.onCheckFail === 'fail') throw new FoundryError('NODE_CHECK_FAILED', `${node.id}: ${failed}`);
      if (rules.onCheckFail === 'resample' && resamples < rules.maxResamples) {
        resamples++; sampleIndex++; retryNote = null;
        this.eventNode(frameKey, node.id, () => {}, 'model.resampled', { rule: 'E2', modelId: entry.id, sampleIndex, reason: failed, ...(recovered ? { recovered: true } : {}) });
        continue;
      }
      entry = escalate('E2', 'NODE_CHECK_FAILED', failed);
    }
  }
  // Charges one journaled model call to its node and the run, once per journal row (a crash may replay the commit).
  // run.cost is known spend; a call whose spend is unknown adds its bound to costUnknownUpperUsd (DESIGN §2).
  chargeModel(frameKey, node, call, type, event) {
    // A replayed response carries the outcome of its provenance check into the event, so verify-run can flag one nothing vouched for.
    if (call.replayed === true && call.recovered !== true) event = { ...event, replaySource: this.checkReplay(call) };
    if (call.recovered === true && call.journalId != null) this.checkRecovered(`${frameKey}/${node.id}`, event.attempt, call.journalId);
    // The event binds the journal row as persisted (request and response hashes, row digest), so editing the row later is detectable.
    const { journalRowHash, requestHash, responseHash } = (call.journalId != null ? this.runtime.models?.journal?.binding?.(call.journalId) : null) ?? {};
    if (journalRowHash) event = { ...event, journalRowHash, requestHash, responseHash };
    this.eventNode(frameKey, node.id, (f, r) => {
      const s = f.nodes[node.id], seen = s.journalIds ?? [];
      if (call.journalId != null && seen.includes(call.journalId)) return; // already charged before a crash
      s.journalIds = [...seen, call.journalId]; s.modelCalls = (s.modelCalls ?? 0) + 1;
      const cost = call.costUsd ?? 0;
      s.costUsd = (s.costUsd ?? 0) + cost; s.imputedUsd = (s.imputedUsd ?? 0) + (call.imputedUsd ?? 0); r.cost += cost;
      if (call.costUnknown === true) for (const t of [s, r]) { t.costUnknownCalls = (t.costUnknownCalls ?? 0) + 1; t.costUnknownUpperUsd = addBound(t.costUnknownUpperUsd, call.costUpperUsd); }
    }, type, event);
  }
  // A replayed call must reproduce what an earlier run's hash chain committed to (src/audit.mjs), or replay would launder an edited
  // response into this run's evidence. The copy journaled for this call must equal the original row, and the original must be what its
  // run's chain bound (an event naming the row: check 'bound') or, failing that, still match its run's sealed journal root. A mismatch stops
  // the run before the response is used. A recording that cannot be shown to be its run's (its row or run is gone or in another store, its
  // run predates the binding, or no event of its run charged the row, sealed or not) is served as recorded, and the event says so:
  // {check: 'unverified', reason}. verify-run flags it.
  checkReplay(call) {
    const journal = this.runtime.models?.journal, from = call.replayedFrom ?? null;
    const unverified = (reason, runId = null) => ({ journalId: from, runId, check: 'unverified', reason });
    if (from == null) return unverified('the replayed call names no recording');
    if (typeof journal?.binding !== 'function' || typeof journal?.get !== 'function') return unverified('the journal cannot bind rows');
    const original = journal.get(from), served = call.journalId == null ? null : journal.get(call.journalId);
    if (!original) return unverified(`journal row ${from} it was replayed from is gone`);
    const tampered = reason => new FoundryError('JOURNAL_TAMPERED', `Replay refused: journal row ${from} ${reason}`, { journalId: from, runId: original.runId });
    if (served) {
      const { replayedFrom, ...copy } = served.response ?? {}, { replayedFrom: _, ...first } = original.response ?? {};
      if (served.ok !== original.ok || served.errorCode !== original.errorCode || digest(copy) !== digest(first)) throw tampered(`differs from the copy replayed from it (row ${call.journalId})`);
    }
    const origin = this.replaySource(original.runId);
    if (!origin) return unverified(`run ${original.runId} that recorded it is not in this store, or predates audit binding`, original.runId);
    const bound = origin.rows.get(from), row = journal.binding(from);
    if (bound !== undefined) {
      if (bound !== row.journalRowHash) throw tampered(`was edited after run ${original.runId} bound it`);
      return { journalId: from, runId: original.runId, check: 'bound' };
    }
    // Not named by any event of its run: that run never charged (used) this response. Only its sealed journal root covers it, and only if
    // it predates the seal. The root shows the row was not edited after the seal; it does not show who wrote it: a row planted under a run
    // while it was still open is sealed with it. So a sealed-only row is served as recorded, not as verified provenance (verify-run flags
    // it in both runs: JOURNAL_ROW_UNREFERENCED there, REPLAY_UNVERIFIED here).
    const seal = origin.seal;
    if (!seal || from > seal.journalMaxId) {
      if (origin.closed) throw tampered(`was written after run ${original.runId} was sealed and no event of it binds the row`);
      return unverified(`run ${original.runId} is still open and no event of it binds the row`, original.runId);
    }
    if (!origin.rootChecked) {
      // The root is recomputed in the database the rows live in: the ModelPort's journal, which may not be the store's.
      const now = journalSeal(journal.db ?? this.store.db, original.runId, seal.journalMaxId);
      if (now.root !== seal.journalRoot || now.calls !== seal.journalCalls) throw tampered(`belongs to a run whose sealed journal (event ${seal.seq}) no longer matches its rows`);
      origin.rootChecked = true;
    }
    return { ...unverified(`run ${original.runId} sealed the row (event ${seal.seq}) but no event of it charged it, so nothing shows the run wrote it`, original.runId), sealed: true };
  }
  // Was this approval requested and then granted by the user, according to the run's verified chain?
  approvedInChain(approvalId) {
    const log = this.store.events(this.runId), requested = log.findIndex(e => e.type === 'approval.requested' && e.approvalId === approvalId);
    return requested >= 0 && log.slice(requested + 1).some(e => e.type === 'approval.decided' && e.approvalId === approvalId && e.approved === true && e.actor === 'user');
  }
  // Crash recovery serves a row this (run, node, attempt) journaled before a crash. Such a row was written after the attempt's first
  // context.compiled event, whose journalMark is the journal's high-water mark at that moment; a row at or below it existed before the
  // attempt began, so this attempt did not write it (a forged answer seeded while the run was paused). Runs without marks are not checked.
  checkRecovered(nodeKey, attempt, journalId) {
    const first = this.store.events(this.runId).find(e => e.type === 'context.compiled' && e.nodeKey === nodeKey && e.attempt === attempt);
    if (Number.isSafeInteger(first?.journalMark) && journalId <= first.journalMark)
      throw new FoundryError('JOURNAL_TAMPERED', `Recovery refused: journal row ${journalId} predates attempt ${attempt} of ${nodeKey} (event ${first.seq}), so that attempt did not write it`, { journalId, nodeKey, attempt });
  }
  // What a replay source run's verified chain says about its journal rows; null when the run is gone or predates the binding.
  // `closed`: its latest seal is final (or it is terminal and was not resumed since), so no further row of it can be legitimate.
  // This run's own rows (a replay-or-live call can hit an earlier identical call of the same run) are re-read each time: its chain grows.
  replaySource(runId) {
    if (runId !== this.runId && this.replaySources.has(runId)) return this.replaySources.get(runId);
    let source = null;
    try { this.store.run(runId); } catch (error) { if (error.code === 'NOT_FOUND') { this.replaySources.set(runId, null); return null; } throw error; }
    const log = this.store.events(runId); // a corrupt source chain stops the run (CORRUPT_EVENTS) rather than feeding it
    if (log[0]?.audit === AUDIT) {
      // A run closed by a final seal charges nothing after it: an event appended past the close is not the run's (verify-run: RUN_EXTENDED),
      // so neither its bindings nor a later seal count. Before any final seal, the latest seal is the one in force.
      const closing = closingSeal(log), upTo = closing ? log.indexOf(closing) + 1 : log.length, own = log.slice(0, upTo);
      const seal = closing ?? own.findLast(e => e.type === 'run.verdict') ?? null;
      const closed = !!seal && (seal.verdict !== 'uncertain' || !own.slice(own.indexOf(seal) + 1).some(e => e.type === 'runner.acquired'));
      source = { rows: new Map(own.filter(e => CALL_EVENTS.has(e.type) && e.journalId != null && e.journalRowHash).map(e => [e.journalId, e.journalRowHash])), seal, closed, rootChecked: false };
    }
    this.replaySources.set(runId, source);
    return source;
  }
  preflight(run) {
    if (this.signal().aborted) throw new FoundryError('CANCELLED', 'Execution cancelled');
    if (Date.now() >= run.deadline) throw new FoundryError('DEADLINE', 'Run deadline exhausted');
    if (run.cost > this.costLimit(run) + 1e-12) throw new FoundryError('COST_BUDGET', 'Run cost budget exhausted');
  }
  // A check that cannot be evaluated fails closed.
  failedCheck(checks, context) {
    for (const [index, check] of checks.entries()) {
      try { if (!condition(check, context)) return `check ${index} failed`; }
      catch (error) { return `check ${index} could not be evaluated (${error.code ?? 'ERROR'})`; }
    }
    return null;
  }
  decide(run, kind, key, { features, action, alternatives = [], propensity = 1, rationale, costUsd = 0 }) {
    if (!run.identity) return;
    this.store.recordDecision(run.id, validateDecision({ schema: 'foundry-decision/1', id: `${run.id}:${kind}:${digest(key).slice(0, 32)}`, at: Date.now(), kind,
      identity: run.identity, features, action, alternatives, propensity, rationale, costUsd }));
  }
  async sandboxed(spec) {
    const signal = this.signal(), stop = this.untilDeadline(signal);
    await this.semaphore.take(signal);
    try { return (await this.runtime.codeRunner({ ...spec, timeoutMs: Math.min(spec.timeoutMs, 600000), signal: stop.signal })).value; }
    catch (error) { throw stop.reached() ? deadlineStop('code') : error; }
    finally { this.semaphore.release(); }
  }
  async code(node, frameKey, ctx) {
    const value = await this.sandboxed({ lang: node.lang, source: node.source, input: resolve(node.args ?? {}, ctx), timeoutMs: node.timeoutMs ?? 10000 });
    if (node.returns) {
      try { validateData(node.returns, value, `${node.id} output`); }
      catch (error) { throw new FoundryError('CODE_OUTPUT', `${node.id} returned a value outside its declared schema`, error.details); }
    }
    this.complete(frameKey, node, value, 'completed', { state: labelState(labelOf(node.args, this.labelScope(frameKey, node.args))) });
  }
  verdictShape(value, code) {
    const valid = value && typeof value === 'object' && !Array.isArray(value) && typeof value.pass === 'boolean' && Object.keys(value).every(k => ['pass', 'score', 'reasons'].includes(k))
      && (value.score === undefined || Number.isFinite(value.score))
      && (value.reasons === undefined || (Array.isArray(value.reasons) && value.reasons.length <= 32 && value.reasons.every(r => typeof r === 'string' && r.length <= 1000)));
    if (!valid) throw new FoundryError(code, 'A verifier must return {pass: boolean, score?: number, reasons?: string[] (at most 32 of 1000 characters)}');
    return { pass: value.pass, score: value.score ?? (value.pass ? 1 : 0), reasons: value.reasons ?? [] };
  }
  // DESIGN §1.3: different-model means the verifier family differs from every agent node the subject reads directly.
  producerFamilies(node, frameKey) {
    const definitions = new Map(this.flowDefinitions.get(frameKey).nodes.map(n => [n.id, n])), families = new Set();
    for (const ref of references(node.subject)) {
      const [root, id] = ref.split('.');
      if (root !== 'nodes' || definitions.get(id)?.kind !== 'agent') continue;
      const modelId = this.stateOf(frameKey, id)?.modelId;
      if (!modelId) throw new FoundryError('VERIFY_INDEPENDENCE', `Producer ${id} has no recorded model; independence cannot be established`);
      families.add(modelById(this.runtime.modelPolicy, modelId).family);
    }
    return families;
  }
  async oracle(node, frameKey, ctx) {
    const cap = this.registry.get(node.tool), run = this.head(), nodeKey = `${frameKey}/${node.id}`;
    if (!cap || !run.policy.allowedCapabilities.includes(node.tool)) throw new FoundryError('CAPABILITY_DENIED', `Capability ${node.tool} is not permitted for this run`);
    if (cap.effects !== 'none') throw new FoundryError('VERIFY_EFFECTS', 'A verification oracle must not have effects');
    const args = resolve(node.args, ctx), local = new AbortController(), stop = () => local.abort(), signal = this.signal();
    await this.semaphore.take(signal);
    signal.addEventListener('abort', stop, { once: true });
    let timer;
    try {
      // Every dispatch reserves the oracle's cost against the run budget, as a task dispatch does (the node's step was already taken).
      this.eventNode(frameKey, node.id, (f, r) => {
        this.preflight(r);
        if (r.cost + cap.cost > this.costLimit(r) + 1e-12) throw new FoundryError('COST_BUDGET', 'Run cost budget exhausted');
        r.cost += cap.cost; f.nodes[node.id].costUsd = (f.nodes[node.id].costUsd ?? 0) + cap.cost;
      }, 'oracle.dispatched', { tool: node.tool, reservedCost: cap.cost, argsHash: digest(args) });
      const limit = Math.min(node.timeoutMs ?? 60000, cap.maxTimeoutMs), remaining = this.head().deadline - Date.now();
      return await Promise.race([
        this.registry.execute(node.tool, args, { signal: local.signal, runId: this.runId, nodeKey, idempotencyKey: digest({ runId: this.runId, nodeKey, args }), artifactsDir: path.join(this.store.directory, 'artifacts', this.runId), store: this.store }),
        new Promise((_, reject) => { timer = setTimeout(() => { local.abort(); reject(remaining <= limit ? deadlineStop(node.tool) : new FoundryError('TOOL_TIMEOUT', `${node.tool} timed out`)); }, Math.max(1, Math.min(limit, remaining))); })]);
    } finally { clearTimeout(timer); signal.removeEventListener('abort', stop); this.semaphore.release(); }
  }
  async verify(node, frameKey, ctx, state, resumed) {
    const subject = resolve(node.subject, ctx), subjectLabel = labelOf(node.subject, this.labelScope(frameKey, node.subject));
    let verdict, label = subjectLabel, meta = {};
    if (node.method === 'code') verdict = this.verdictShape(await this.sandboxed({ lang: node.lang, source: node.source, input: { subject }, timeoutMs: node.timeoutMs ?? 60000 }), 'CODE_OUTPUT');
    else if (node.method === 'capability') {
      verdict = this.verdictShape(await this.oracle(node, frameKey, ctx), 'VERIFY_PROTOCOL');
      label = joinLabels([subjectLabel, labelOf(node.args, this.labelScope(frameKey, node.args))]);
    }
    else {
      const excludeFamily = node.independence === 'different-model' ? this.producerFamilies(node, frameKey) : new Set();
      const sourceRef = node.subject && typeof node.subject === 'object' && Object.keys(node.subject).length === 1 && typeof node.subject.$ref === 'string' ? node.subject.$ref : null;
      const { value, compiled, entry, escalations } = await this.modelLoop(node, frameKey, ctx, state, resumed, {
        returns: VERIFY_RETURNS, checks: [], excludeFamily, extraInputs: [{ name: 'subject', value: subject, label: subjectLabel, render: 'json', sourceRef }] });
      verdict = value; label = compiled.outputLabel;
      meta = { modelId: entry.id, modelClass: entry.class, modelFamily: entry.family, escalations, receiptHash: compiled.receiptHash, excludedFamilies: [...excludeFamily].sort() };
    }
    const output = { ...verdict, independence: node.independence };
    if (!output.pass && node.gate !== false) {
      this.eventNode(frameKey, node.id, f => { Object.assign(f.nodes[node.id], { verdict: output, ...meta }); }, 'verify.failed', { output, ...meta });
      // Reasons may derive from untrusted data, so they stay in node state and never enter the error text.
      throw new FoundryError('VERIFY_FAILED', `${node.id}: gate verification failed (score ${output.score})`);
    }
    const finding = output.pass && this.workflow.discovery === true;
    this.complete(frameKey, node, output, 'completed', { state: { ...labelState(label), ...meta },
      run: finding ? r => { r.findings = [...(r.findings ?? []), { nodeKey: `${frameKey}/${node.id}`, confirmed: true, independence: node.independence, subjectHash: digest(subject) }]; } : undefined });
  }

  requireEvidence(capability, args, frameKey, node) {
    if (!(capability.requiresEvidence ?? []).length) return;
    const nodes = new Map(this.flowDefinitions.get(frameKey).nodes.map(n => [n.id, n]));
    const allowed = new Set(), pending = [...node.needs];
    while (pending.length) { const id = pending.pop(); if (allowed.has(id)) continue; allowed.add(id); pending.push(...(nodes.get(id)?.needs ?? [])); }
    const states = this.rows.nodeStates(this.runId, frameKey, allowed);
    for (const requirement of capability.requiresEvidence) {
      const wantedArgs = resolve(requirement.sourceArgs, { input: args });
      const wantedHash = digest(wantedArgs);
      const matching = Object.entries(states).filter(([, state]) => state.tool === requirement.sourceTool && state.argsHash === wantedHash)
        .sort((a, b) => (b[1].startedSequence ?? b[1].completedSequence ?? 0) - (a[1].startedSequence ?? a[1].completedSequence ?? 0));
      if (!matching.length) throw new FoundryError('EVIDENCE_REQUIRED', `No successful scope-matching evidence for ${requirement.id}`);
      // Never cherry-pick an older valid observation after a newer malformed one.
      const [id, receipt] = matching[0];
      if (receipt.status !== 'completed') throw new FoundryError('EVIDENCE_INVALID', `The newest scope-matching observation for ${requirement.id} did not succeed; older evidence cannot replace it`);
      if (!Number.isFinite(receipt.completedAt) || Date.now() - receipt.completedAt > requirement.maxAgeMs || Date.now() < receipt.completedAt) throw new FoundryError('EVIDENCE_STALE', `Evidence ${requirement.id} is outside its freshness contract`);
      const output = this.rows.nodeOutput(this.runId, frameKey, id);
      if (digest(output) !== receipt.outputHash) throw new FoundryError('EVIDENCE_CORRUPT', `Evidence ${requirement.id} does not match its receipt`);
      try {
        const value = requirement.path ? resolve({ $ref: `input.${requirement.path}` }, { input: output }) : output;
        validateData(requirement.schema, value, `evidence ${requirement.id}`);
      }
      catch (error) { throw new FoundryError('EVIDENCE_INVALID', `Evidence ${requirement.id} violates its host-owned data contract`, { cause: errorData(error) }); }
    }
  }
}
