import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { checkData, clone, condition, digest, errorData, FoundryError, references, resolve } from './data.mjs';
import { modelNodes, requireWorkflow, validateData, validateDecision, validateIdentity, VERIFY_RETURNS } from './validate.mjs';
import { engineHash } from './engine.mjs';
import { compileContext, contextInputs, inheritedLabel, joinLabels } from './context.mjs';
import { verdictOf } from './verdict.mjs';
import { runCode } from './sandbox.mjs';
import { classIndex, modelById, modelsForClass, nextClass, validatePolicy } from './models/policy.mjs';
import { MODES } from './models/port.mjs';

const finished = new Set(['succeeded', 'failed', 'cancelled']);
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
const terminal = new Set(['succeeded', 'failed', 'cancelled', 'uncertain']);
// DESIGN §5.1: outages never escalate; protocol and per-call budget faults are not model behaviour either.
const environmentFaults = new Set(['MODEL_RATE_LIMIT', 'MODEL_UNAVAILABLE', 'MODEL_TIMEOUT']);
const providerFaults = new Set(['MODEL_PROTOCOL', 'MODEL_BUDGET']);
const retryable = new Set(['MODEL_SCHEMA', 'MODEL_TRUNCATED']);
// onError:"continue" never hides an environment fault, a budget stop, a cancellation or a harness integrity failure.
const unhandled = new Set([...environmentFaults, ...providerFaults, 'CANCELLED', 'ABORT_ERR', 'SANDBOX_UNAVAILABLE', 'COST_BUDGET', 'STEP_BUDGET',
  'DEADLINE', 'STATE_BUDGET', 'STALE_RUNNER', 'REPLAY_MISS', 'MODEL_PORT_REQUIRED', 'VERIFY_INDEPENDENCE', 'ASSIGNMENT_INVALID']);
const labelOf = (template, scope) => joinLabels(references(template ?? null).map(ref => inheritedLabel(ref, scope)));
const labelEntry = (key, label) => label === 'trusted' ? {} : { [key]: label };
const labelState = label => label === 'trusted' ? {} : { outputLabel: label };
const inputLabels = scope => Object.fromEntries(Object.entries(scope).filter(([key]) => key === 'input' || key.startsWith('input.')));
// The run verdict (DESIGN §5.2) is sealed in the same commit as the terminal status, with its decision record.
// Its run.verdict event precedes the terminal event, so the chain tail stays run.succeeded/run.stopped.
function seal(run, workflow, store) {
  if (!terminal.has(run.status)) { delete run.verdict; return []; }
  run.verdict = verdictOf(run, { workflow });
  if (run.identity) {
    const decision = { schema: 'foundry-decision/1', id: `${run.id}:verdict:${run.eventHead?.seq ?? 0}`, at: Date.now(), kind: 'verdict', identity: run.identity,
      features: { status: run.status, errorCode: run.error?.code ?? null, discovery: workflow?.discovery === true, findings: (run.findings ?? []).length, steps: run.steps },
      action: run.verdict.verdict, alternatives: [], propensity: 1, rationale: run.verdict.reason, costUsd: run.cost };
    try { store.recordDecision(run.id, validateDecision(decision)); }
    catch (error) { run.verdict.decisionError = errorData(error); }
  }
}
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
    return this.store.createRun(hash, input, registryHash, this.policy, { ...rest, engineHash, id, binding: {
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
  async execute(runId, { signal } = {}) {
    // A Runtime invocation has isolated coordination state. Multiple runs may use
    // the same Store but must not share mutable in-flight fields.
    return new Invocation(this, runId, signal).execute();
  }
  answer(runId, nodeKey, answer) {
    const run = this.store.run(runId);
    if (finished.has(run.status)) throw new FoundryError('RUN_CLOSED', 'A terminal run cannot accept answers');
    const target = locateNode(run, nodeKey);
    if (!target || target.state.status !== 'awaiting_human') throw new FoundryError('NO_QUESTION', 'No pending question exists at this node');
    validateData(target.state.answerSchema, answer, 'human answer');
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
      const approval = r.approvals[approvalId];
      if (!approval || approval.status !== 'pending') throw new FoundryError('APPROVAL_CONFLICT', 'No matching pending approval');
      approval.status = decision ? 'approved' : 'rejected'; approval.actor = actor; approval.decidedAt = Date.now();
      const target = locateNode(r, approval.nodeKey);
      if (!target || target.state.status !== 'awaiting_approval') throw new FoundryError('APPROVAL_CONFLICT', 'The approval no longer matches a waiting operation');
      target.state.status = decision ? 'pending' : 'failed';
      if (!decision) { r.status = 'cancelled'; r.error = { code: 'APPROVAL_REJECTED', message: 'User rejected the operation' }; seal(r, null, this.store); }
      else r.status = 'ready';
    }, run => [...(run.status === 'cancelled' && run.verdict ? [{ type: 'run.verdict', ...run.verdict }] : []), { type: 'approval.decided', approvalId, approved: decision, actor }]);
  }
}

export function locateNode(run, nodeKey) {
  const slash = nodeKey.lastIndexOf('/'), frameKey = nodeKey.slice(0, slash), id = nodeKey.slice(slash + 1);
  const frame = frameOf(run, frameKey); const state = frame?.nodes[id];
  return state ? { frame, state, id, frameKey } : null;
}

class Invocation {
  constructor(runtime, runId, signal) {
    this.store = runtime.store; this.registry = runtime.registry; this.runId = runId; this.runtime = runtime;
    this.abort = new AbortController(); this.token = randomUUID(); this.outerSignal = signal;
    this.flowDefinitions = new Map(); this.frameLabels = new Map();
    this.userCancelled = false;
    this.onAbort = () => { this.userCancelled = true; this.abort.abort(); };
    signal?.addEventListener('abort', this.onAbort, { once: true });
    if (signal?.aborted) this.onAbort();
  }
  current() { return this.store.run(this.runId); }
  update(mutate, event) {
    return this.store.updateRun(this.runId, r => {
      if (r.owner?.token !== this.token) throw new FoundryError('STALE_RUNNER', 'Execution ownership changed');
      mutate(r);
    }, event);
  }
  eventNode(frameKey, nodeId, mutate, type, extra = {}) {
    return this.update(r => mutate(frameOf(r, frameKey), r), { type, nodeKey: `${frameKey}/${nodeId}`, ...extra });
  }
  checkBudget(run = this.current(), cost = 0) {
    if (this.abort.signal.aborted) throw new FoundryError('CANCELLED', 'Execution cancelled');
    if (Date.now() >= run.deadline) throw new FoundryError('DEADLINE', 'Run deadline exhausted');
    if (run.steps >= Math.min(run.policy.maxSteps, this.workflow.budget.maxSteps)) throw new FoundryError('STEP_BUDGET', 'Run step budget exhausted');
    if (run.cost + cost > Math.min(run.policy.maxCost, this.workflow.budget.maxCost ?? run.policy.maxCost) + 1e-12) throw new FoundryError('COST_BUDGET', 'Run cost budget exhausted');
    if (Buffer.byteLength(JSON.stringify(run)) > 10 * 1024 * 1024) throw new FoundryError('STATE_BUDGET', 'Run state budget exhausted; reserved space remains for the failure receipt');
  }
  charge(frameKey, node, cost = 0, intent = {}) {
    this.eventNode(frameKey, node.id, (f, r) => {
      this.checkBudget(r, cost);
      const old = f.nodes[node.id] ?? { attempts: 0 };
      f.nodes[node.id] = { ...old, kind: node.kind, status: 'running', attempts: old.attempts + 1, startedAt: Date.now(), startedSequence: (r.eventHead?.seq ?? 0) + 1, ...intent };
      r.steps++; r.cost += cost;
    }, node.kind === 'task' ? 'tool.intent' : 'node.started', { kind: node.kind, reservedCost: cost, ...intent });
  }
  complete(frameKey, node, output, status = 'completed', { state = {}, run: alsoRun } = {}) {
    checkData(output, { maxBytes: 512 * 1024 });
    this.eventNode(frameKey, node.id, (f, run) => {
      f.nodes[node.id] = { ...f.nodes[node.id], ...state, status, completedAt: Date.now(), completedSequence: (run.eventHead?.seq ?? 0) + 1, outputHash: digest(output) };
      f.outputs[node.id] = clone(output);
      alsoRun?.(run);
    }, status === 'handled_error' ? 'node.handled_error' : 'node.completed', { outputHash: digest(output), output, ...state });
  }
  costLimit(run) { return Math.min(run.policy.maxCost, this.workflow.budget.maxCost ?? run.policy.maxCost); }
  labelScope(frameKey) {
    const scope = { ...(this.frameLabels.get(frameKey) ?? {}) };
    for (const [id, state] of Object.entries(frameOf(this.current(), frameKey).nodes)) if (state.outputLabel && state.outputLabel !== 'trusted') scope[`nodes.${id}`] = state.outputLabel;
    return scope;
  }
  // Every node label recorded in the child frames of one map/loop node (conservative join).
  childLabels(frameKey, nodeId, index = null) {
    const prefix = `${frameKey}/${nodeId}:${index ?? ''}`;
    return joinLabels(Object.entries(this.current().frames).filter(([key]) => index === null ? key.startsWith(prefix) : key === prefix || key.startsWith(`${prefix}/`))
      .flatMap(([, frame]) => Object.values(frame.nodes).map(state => state.outputLabel ?? 'trusted')));
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
      this.store.events(this.runId); // Verify the chain before trusting a checkpoint.
      if (finished.has(run.status)) return run;
      if (!run.engineHash) throw new FoundryError('ENGINE_UNBOUND', 'This historical run has no native engine binding. Inspect it or use its original frozen runtime; do not silently resume it under changed semantics.');
      if (run.engineHash !== engineHash) throw new FoundryError('ENGINE_DRIFT', 'The native execution engine differs from the version that created this run. Resume with the original engine or create a separately reviewed new run.', { recorded: run.engineHash, current: engineHash });
      const birth = this.store.events(this.runId)[0];
      if (birth?.engineHash !== run.engineHash) throw new FoundryError('ENGINE_BINDING_CORRUPT', 'Run engine identity does not match its immutable creation event');
      if (modelBound && (birth?.modelPolicyHash ?? null) !== run.modelPolicyHash) throw new FoundryError('MODEL_POLICY_BINDING_CORRUPT', 'Run model policy binding does not match its immutable creation event');
      this.store.updateRun(this.runId, r => {
        if (r.owner && alive(r.owner)) throw new FoundryError('RUN_BUSY', 'Another live runner owns this run');
        if ((r.resumeCount ?? 0) >= (r.policy.maxResumes ?? 1000)) throw new FoundryError('RESUME_BUDGET', 'Run resume budget exhausted');
        r.resumeCount = (r.resumeCount ?? 0) + 1;
        r.owner = { token: this.token, pid: process.pid, processStart: startStamp(process.pid), acquiredAt: Date.now() };
        r.status = 'running';
      }, { type: 'runner.acquired', token: this.token });
      owned = true;
      if (Date.now() >= run.deadline) throw new FoundryError('DEADLINE', 'Run deadline exhausted before resume');
      this.semaphore = new Semaphore(Math.min(run.policy.maxConcurrency, this.workflow.budget.maxConcurrency));
      this.recover();
      const result = await this.flow(this.workflow, 'root', run.input, {});
      run = this.current();
      const states = [...Object.values(run.nodes), ...Object.values(run.frames).flatMap(f => Object.values(f.nodes))];
      let status = result.done ? 'succeeded' : 'waiting';
      if (states.some(n => n.status === 'awaiting_human')) status = 'awaiting_human';
      if (states.some(n => n.status === 'awaiting_approval')) status = 'awaiting_approval';
      if (states.some(n => n.status === 'uncertain')) status = 'uncertain';
      if (status === 'succeeded' && Date.now() >= run.deadline) throw new FoundryError('DEADLINE', 'Run deadline exhausted before completion was committed');
      return this.update(r => { r.status = status; r.owner = null; seal(r, this.workflow, this.store); }, r => [...(r.verdict ? [{ type: 'run.verdict', ...r.verdict }] : []), { type: `run.${status}` }]);
    } catch (error) {
      this.abort.abort();
      if (!owned) throw error;
      return this.update(r => {
        const all = [...Object.values(r.nodes), ...Object.values(r.frames).flatMap(f => Object.values(f.nodes))];
        r.status = all.some(n => n.status === 'uncertain') ? 'uncertain' : (this.userCancelled || error.code === 'CANCELLED' ? 'cancelled' : 'failed');
        r.error = errorData(error); r.owner = null; seal(r, this.workflow, this.store);
      }, r => [...(r.verdict ? [{ type: 'run.verdict', ...r.verdict }] : []), { type: 'run.stopped', error: errorData(error) }]);
    } finally { this.outerSignal?.removeEventListener('abort', this.onAbort); }
  }
  recover() {
    const run = this.current();
    for (const [frameKey, f] of [['root', run], ...Object.entries(run.frames)]) {
      for (const [id, state] of Object.entries(f.nodes)) {
        if (state.status !== 'running' || state.kind !== 'task') continue;
        const cap = this.registry.get(state.tool);
        if (!cap) throw new FoundryError('CAPABILITY_DRIFT', 'Interrupted operation capability is missing');
        const uncertain = cap.effects === 'non-idempotent';
        this.eventNode(frameKey, id, current => {
          current.nodes[id].status = uncertain ? 'uncertain' : 'pending';
          current.nodes[id].recovered = true;
        }, uncertain ? 'effect.uncertain' : 'node.recovered', { effects: cap.effects });
      }
    }
  }
  context(frameKey, input, locals) {
    return { input: clone(input), nodes: clone(frameOf(this.current(), frameKey).outputs), ...clone(locals) };
  }
  async flow(flow, frameKey, input, locals, labels = frameKey === 'root' ? { ...(this.workflow.labels ?? {}) } : {}) {
    this.flowDefinitions.set(frameKey, flow); this.frameLabels.set(frameKey, labels);
    if (frameKey !== 'root') {
      const old = this.current().frames[frameKey];
      const contextHash = digest({ input, locals });
      if (old && old.contextHash !== contextHash) throw new FoundryError('FRAME_DRIFT', 'Nested execution context changed');
      if (!old) this.update(r => { r.frames[frameKey] = { nodes: {}, outputs: {}, contextHash }; }, { type: 'frame.created', frameKey, contextHash });
    }
    const attempted = new Set();
    while (true) {
      const run = this.current();
      if (this.abort.signal.aborted) throw new FoundryError('CANCELLED', 'Run cancellation was requested; completed effects remain in the evidence ledger');
      if (Date.now() >= run.deadline) throw new FoundryError('DEADLINE', 'Run deadline exhausted');
      if ([...Object.values(run.nodes), ...Object.values(run.frames).flatMap(f => Object.values(f.nodes))].some(n => n.status === 'uncertain')) return { done: false, outputs: clone(frameOf(run, frameKey).outputs) };
      const f = frameOf(run, frameKey);
      if (flow.nodes.every(n => nodeDone.has(f.nodes[n.id]?.status))) {
        const ctx = this.context(frameKey, input, locals);
        if (!flow.acceptance.every(c => condition(c, ctx))) throw new FoundryError('ACCEPTANCE_FAILED', `Acceptance failed for ${frameKey}`);
        if (Date.now() >= this.current().deadline) throw new FoundryError('DEADLINE', 'Run deadline exhausted during acceptance evaluation');
        return { done: true, outputs: clone(f.outputs) };
      }
      const ready = flow.nodes.filter(n => !attempted.has(n.id) && !nodeDone.has(f.nodes[n.id]?.status) && n.needs.every(dep => nodeDone.has(f.nodes[dep]?.status)));
      if (!ready.length) return { done: false, outputs: clone(f.outputs) };
      // Limit concurrent node continuations as well as actual capability calls.
      const batch = ready.slice(0, Math.min(this.workflow.budget.maxConcurrency, this.current().policy.maxConcurrency));
      batch.forEach(n => attempted.add(n.id));
      const results = await Promise.allSettled(batch.map(async n => {
        try { return await this.node(n, frameKey, input, locals); }
        catch (error) {
          this.eventNode(frameKey, n.id, frame => {
            if (frame.nodes[n.id]?.status !== 'uncertain') frame.nodes[n.id] = { ...(frame.nodes[n.id] ?? { kind: n.kind, attempts: 0 }), status: 'failed', error: errorData(error) };
          }, 'node.failed', { error: errorData(error) });
          this.abort.abort();
          throw error;
        }
      }));
      const failure = results.find(x => x.status === 'rejected' && !['CANCELLED', 'ABORT_ERR'].includes(x.reason?.code)) ?? results.find(x => x.status === 'rejected');
      if (failure) throw failure.reason;
    }
  }
  async node(node, frameKey, input, locals) {
    let state = frameOf(this.current(), frameKey).nodes[node.id];
    if (['awaiting_human', 'awaiting_approval', 'uncertain'].includes(state?.status)) return;
    const ctx = this.context(frameKey, input, locals);
    const predecessors = frameOf(this.current(), frameKey).nodes;
    if (!state && (node.join ?? 'all_success') === 'all_success' && node.needs.some(id => predecessors[id]?.status !== 'completed')) {
      this.eventNode(frameKey, node.id, f => { f.nodes[node.id] = { kind: node.kind, status: 'skipped', attempts: 0, reason: 'required predecessor did not succeed' }; }, 'node.skipped', { reason: 'required predecessor did not succeed' });
      return;
    }
    if (!state && node.when && !condition(node.when, ctx)) {
      this.eventNode(frameKey, node.id, f => { f.nodes[node.id] = { kind: node.kind, status: 'skipped', attempts: 0 }; }, 'node.skipped'); return;
    }
    if (node.kind === 'task') return this.task(node, frameKey, ctx);
    const resumed = state?.status === 'running';
    if (!state) { this.charge(frameKey, node); state = frameOf(this.current(), frameKey).nodes[node.id]; }
    if (node.kind === 'agent') return this.agent(node, frameKey, ctx, state, resumed);
    if (node.kind === 'code') return this.code(node, frameKey, ctx);
    if (node.kind === 'verify') return this.verify(node, frameKey, ctx, state, resumed);
    if (node.kind === 'assert') {
      if (!node.checks.every(c => condition(c, ctx))) throw new FoundryError('ASSERTION_FAILED', `Assertion ${node.id} failed`);
      this.complete(frameKey, node, { passed: true }); return;
    }
    if (node.kind === 'human') {
      this.eventNode(frameKey, node.id, f => {
        Object.assign(f.nodes[node.id], { status: 'awaiting_human', question: node.question, answerSchema: clone(node.answerSchema) });
      }, 'human.requested', { question: node.question }); return;
    }
    if (node.kind === 'wait') {
      const wakeAt = state.wakeAt ?? Date.now() + node.delayMs;
      if (Date.now() < wakeAt) {
        this.eventNode(frameKey, node.id, f => { Object.assign(f.nodes[node.id], { status: 'waiting', wakeAt }); }, 'node.waiting', { wakeAt }); return;
      }
      this.complete(frameKey, node, { waitedMs: node.delayMs }); return;
    }
    if (node.kind === 'map') {
      const items = resolve(node.items, ctx);
      if (!Array.isArray(items) || items.length > node.maxItems) throw new FoundryError('MAP_BOUND', 'Map input is not an array or exceeds maxItems');
      const childInput = Object.hasOwn(node, 'input') ? resolve(node.input, ctx) : input;
      const scope = this.labelScope(frameKey), itemLabel = labelOf(node.items, scope);
      const childLabels = { ...(Object.hasOwn(node, 'input') ? labelEntry('input', labelOf(node.input, scope)) : inputLabels(scope)), ...labelEntry('item', itemLabel) };
      const outputs = [];
      for (let index = 0; index < items.length; index++) {
        const result = await this.flow(node.body, `${frameKey}/${node.id}:${index}`, childInput, { item: items[index], index }, childLabels);
        if (!result.done) { this.eventNode(frameKey, node.id, f => { f.nodes[node.id].status = 'waiting_child'; }, 'node.waiting_child'); return; }
        outputs.push(result.outputs);
      }
      this.complete(frameKey, node, { items: outputs, count: outputs.length }, 'completed', { state: labelState(joinLabels([itemLabel, this.childLabels(frameKey, node.id)])) }); return;
    }
    if (node.kind === 'loop') {
      const childInput = Object.hasOwn(node, 'input') ? resolve(node.input, ctx) : input;
      const scope = this.labelScope(frameKey), initialLabel = labelOf(node.initial, scope);
      const inherited = Object.hasOwn(node, 'input') ? labelEntry('input', labelOf(node.input, scope)) : inputLabels(scope);
      let previous = resolve(node.initial, ctx);
      for (let iteration = 0; iteration < node.maxIterations; iteration++) {
        const childKey = `${frameKey}/${node.id}:${iteration}`;
        const childLocals = { iteration, previous };
        const previousLabel = iteration === 0 ? initialLabel : this.childLabels(frameKey, node.id, iteration - 1);
        const result = await this.flow(node.body, childKey, childInput, childLocals, { ...inherited, ...labelEntry('previous', previousLabel) });
        if (!result.done) { this.eventNode(frameKey, node.id, f => { f.nodes[node.id].status = 'waiting_child'; }, 'node.waiting_child'); return; }
        if (condition(node.until, { input: childInput, nodes: result.outputs, ...childLocals })) {
          this.complete(frameKey, node, { iterations: iteration + 1, last: result.outputs }, 'completed', { state: labelState(joinLabels([initialLabel, this.childLabels(frameKey, node.id)])) }); return;
        }
        previous = result.outputs;
      }
      throw new FoundryError('LOOP_EXHAUSTED', `${node.id} exhausted its iteration budget without satisfying until`);
    }
    throw new FoundryError('UNKNOWN_NODE', `Unsupported node kind ${node.kind}`);
  }
  async task(node, frameKey, ctx) {
    const cap = this.registry.get(node.tool), run = this.current();
    if (!cap || !run.policy.allowedCapabilities.includes(node.tool)) throw new FoundryError('CAPABILITY_DENIED', `Capability ${node.tool} is not permitted for this run`);
    const args = resolve(node.args, ctx), argsLabel = labelOf(node.args, this.labelScope(frameKey));
    validateData(cap.inputSchema, args, `${node.tool} input`);
    // DESIGN §4: untrusted-derived arguments reach an effect only through an approval gate.
    if (cap.effects !== 'none' && !(cap.requiresApproval || cap.risk === 'high') && argsLabel !== 'trusted') throw new FoundryError('UNTRUSTED_EFFECT_ARGS', `${node.tool} has effects and no approval gate, but its arguments depend on ${argsLabel} data`);
    this.requireEvidence(cap, args, frameKey, node);
    const nodeKey = `${frameKey}/${node.id}`;
    const idempotencyKey = digest({ runId: this.runId, nodeKey, workflowHash: run.workflowHash, args });
    const approvalId = digest({ workflowHash: run.workflowHash, registryHash: run.registryHash, nodeKey, tool: node.tool, args, idempotencyKey });
    if ((cap.requiresApproval || cap.risk === 'high') && run.approvals[approvalId]?.status !== 'approved') {
      this.eventNode(frameKey, node.id, (f, r) => {
        f.nodes[node.id] = { ...(f.nodes[node.id] ?? { attempts: 0 }), kind: 'task', status: 'awaiting_approval', tool: node.tool, approvalId };
        r.approvals[approvalId] = { id: approvalId, nodeKey, tool: node.tool, args: clone(args), idempotencyKey, status: 'pending', risk: cap.risk };
      }, 'approval.requested', { approvalId, tool: node.tool, argsHash: digest(args) }); return;
    }
    const old = frameOf(run, frameKey).nodes[node.id];
    if ((old?.attempts ?? 0) >= node.retry.maxAttempts) throw new FoundryError('RETRY_EXHAUSTED', `${node.id} exhausted its total attempt budget`);
    while ((frameOf(this.current(), frameKey).nodes[node.id]?.attempts ?? 0) < node.retry.maxAttempts) {
      await this.semaphore.take(this.abort.signal);
      let acquired = true;
      try {
        this.charge(frameKey, node, cap.cost, { tool: node.tool, idempotencyKey, argsHash: digest(args), effects: cap.effects });
        this.requireEvidence(cap, args, frameKey, node);
        const localAbort = new AbortController();
        const stop = () => localAbort.abort(); this.abort.signal.addEventListener('abort', stop, { once: true });
        let settled = false, timeout, timedOut = false;
        const timeoutMs = Math.min(node.timeoutMs, Math.max(1, this.current().deadline - Date.now()));
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
          if (this.current().extra?.crashAfterTool === nodeKey) process.kill(process.pid, 'SIGKILL');
          this.complete(frameKey, node, result, 'completed', { state: labelState(argsLabel) }); return;
        } catch (error) {
          localAbort.abort();
          if (timedOut && !settled) await Promise.race([execution.catch(() => {}), delay(100)]);
          if (cap.effects === 'non-idempotent' || (timedOut && !settled) || (this.userCancelled && cap.effects !== 'none')) {
            this.eventNode(frameKey, node.id, f => { Object.assign(f.nodes[node.id], { status: 'uncertain', error: errorData(error) }); }, 'effect.uncertain', { error: errorData(error), cancellationConfirmed: settled });
            return;
          }
          this.eventNode(frameKey, node.id, f => { Object.assign(f.nodes[node.id], { status: 'pending', error: errorData(error) }); }, 'tool.failed', { error: errorData(error) });
          if (this.abort.signal.aborted) throw new FoundryError('CANCELLED', 'Execution cancelled while an operation was in progress');
          const attempts = frameOf(this.current(), frameKey).nodes[node.id].attempts;
          if (attempts >= node.retry.maxAttempts) {
            if (node.onError === 'continue') { this.complete(frameKey, node, { ok: false, error: errorData(error) }, 'handled_error', { state: labelState(argsLabel) }); return; }
            this.eventNode(frameKey, node.id, f => { f.nodes[node.id].status = 'failed'; }, 'node.failed', { error: errorData(error) });
            throw error;
          }
        } finally { clearTimeout(timeout); this.abort.signal.removeEventListener('abort', stop); }
      } finally { if (acquired) { this.semaphore.release(); acquired = false; } }
      if (node.retry.backoffMs) {
        try { await delay(node.retry.backoffMs, undefined, { signal: this.abort.signal }); }
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
    const run = this.current(), nodeKey = `${frameKey}/${node.id}`, attempt = state.attempts, limits = policy.escalation ?? {};
    const rules = { schemaRetries: node.escalation?.schemaRetries ?? limits.schemaRetriesBeforeEscalation ?? 1, onCheckFail: node.escalation?.onCheckFail ?? 'escalate',
      maxEscalations: Math.min(node.escalation?.maxEscalations ?? 2, limits.maxEscalationsPerNode ?? 2, 2), maxResamples: node.escalation?.maxResamples ?? 1 };
    const declared = node.model.class ?? modelById(policy, node.model.id).class, max = node.model.maxClass ?? declared;
    const assigned = run.assignment?.[nodeKey] ?? run.assignment?.[node.id];
    let entry = assigned ? modelById(policy, assigned) : node.model.id ? modelById(policy, node.model.id) : modelsForClass(policy, declared, { excludeFamily })[0];
    if (!entry || excludeFamily.has(entry.family)) throw new FoundryError('VERIFY_INDEPENDENCE', `${node.id}: no permitted ${declared} model outside the producer famil${excludeFamily.size === 1 ? 'y' : 'ies'} ${[...excludeFamily].join(', ')}`);
    if (classIndex(policy, entry.class) > classIndex(policy, max)) throw new FoundryError('ASSIGNMENT_INVALID', `${entry.id} (class ${entry.class}) exceeds maxClass ${max} of ${node.id}`);
    if (resumed) this.eventNode(frameKey, node.id, () => {}, 'node.resumed', { attempt, source: 'journal' });
    const inputs = [...contextInputs(node, ctx, this.labelScope(frameKey)), ...extraInputs];
    let retries = 0, resamples = 0, sampleIndex = 0, escalations = 0, retryNote = null, recovered = false;
    const escalate = (rule, code, message) => {
      let target = null;
      if (escalations < rules.maxEscalations)
        for (let cls = nextClass(policy, entry.class); cls && !target && classIndex(policy, cls) <= classIndex(policy, max); cls = nextClass(policy, cls)) target = modelsForClass(policy, cls, { excludeFamily })[0] ?? null;
      if (!target) throw new FoundryError('MODEL_ESCALATION_EXHAUSTED', `${node.id}: ${rule} after ${code} on ${entry.id} has no permitted escalation (${escalations}/${rules.maxEscalations} used, maxClass ${max})`,
        { rule, lastError: { code, message: String(message).slice(0, 1000) }, modelId: entry.id, escalations, maxClass: max });
      escalations++;
      const detail = { rule, fromClass: entry.class, toClass: target.class, fromModel: entry.id, toModel: target.id, costSoFar: frameOf(this.current(), frameKey).nodes[node.id].costUsd ?? 0, errorCode: code, escalation: escalations, ...(recovered ? { recovered: true } : {}) };
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
      this.eventNode(frameKey, node.id, (f, r) => { this.preflight(r); Object.assign(f.nodes[node.id], selected); }, 'context.compiled', { ...selected, attempt, retry: retries, receipt: compiled.receipt });
      await this.semaphore.take(this.abort.signal);
      let result;
      try {
        result = await models.call({ runId: this.runId, nodeKey, attempt, sampleIndex, modelId: entry.id, system: compiled.system, prompt: compiled.prompt, schema: returns,
          decoding: node.decoding ?? {}, receiptHash: compiled.receiptHash, signal: this.abort.signal, mode: run.modelMode ?? 'live', salt: run.sampleSalt ?? this.runId,
          timeoutMs: Math.max(1, Math.min(node.timeoutMs ?? 120000, this.current().deadline - Date.now())) });
      } finally { this.semaphore.release(); }
      // Fault injection is explicit, only available to trusted test callers: the journal row is committed, the run is not.
      if (this.current().extra?.crashAfterModel === nodeKey) process.kill(process.pid, 'SIGKILL');
      recovered = result.recovered === true;
      const code = result.ok ? null : result.error?.code ?? 'MODEL_PROTOCOL';
      this.eventNode(frameKey, node.id, (f, r) => {
        const s = f.nodes[node.id], seen = s.journalIds ?? [];
        if (result.journalId != null && seen.includes(result.journalId)) return; // already charged before a crash
        s.journalIds = [...seen, result.journalId]; s.modelCalls = (s.modelCalls ?? 0) + 1;
        s.costUsd = (s.costUsd ?? 0) + result.costUsd; s.imputedUsd = (s.imputedUsd ?? 0) + (result.imputedUsd ?? 0); r.cost += result.costUsd;
      }, recovered ? 'node.recovered_from_journal' : 'model.called', { modelId: result.modelId, provider: result.provider, engineVersion: result.engineVersion, attempt, sampleIndex,
        ok: result.ok, errorCode: code, costUsd: result.costUsd, imputedUsd: result.imputedUsd ?? 0, latencyMs: result.latencyMs, usage: result.usage, finishReason: result.finishReason,
        journalId: result.journalId ?? null, replayed: result.replayed === true && !recovered, ...(result.replayedFrom ? { replayedFrom: result.replayedFrom } : {}) });
      if (this.current().cost > this.costLimit(this.current()) + 1e-12) throw new FoundryError('COST_BUDGET', `Run cost budget exhausted by a model call at ${node.id}`);
      if (!result.ok) {
        const message = result.error?.message ?? code;
        if (environmentFaults.has(code) || providerFaults.has(code)) throw new FoundryError(code, `${node.id}: ${message}`, { journalId: result.journalId ?? null, modelId: entry.id });
        if (retryable.has(code) && retries < rules.schemaRetries) {
          retries++; retryNote = `Retry ${retries} of ${rules.schemaRetries} on this model. ${code}: ${message}`;
          this.eventNode(frameKey, node.id, () => {}, 'model.retry', { rule: 'E1', modelId: entry.id, errorCode: code, retry: retries, ...(recovered ? { recovered: true } : {}) });
          continue;
        }
        entry = escalate('E1', code, message); continue;
      }
      const failed = this.failedCheck(checks, { ...ctx, output: result.value });
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
  preflight(run) {
    if (this.abort.signal.aborted) throw new FoundryError('CANCELLED', 'Execution cancelled');
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
    await this.semaphore.take(this.abort.signal);
    try {
      const timeoutMs = Math.max(1, Math.min(spec.timeoutMs, 600000, this.current().deadline - Date.now()));
      return (await this.runtime.codeRunner({ ...spec, timeoutMs, signal: this.abort.signal })).value;
    } finally { this.semaphore.release(); }
  }
  async code(node, frameKey, ctx) {
    const value = await this.sandboxed({ lang: node.lang, source: node.source, input: resolve(node.args ?? {}, ctx), timeoutMs: node.timeoutMs ?? 10000 });
    if (node.returns) {
      try { validateData(node.returns, value, `${node.id} output`); }
      catch (error) { throw new FoundryError('CODE_OUTPUT', `${node.id} returned a value outside its declared schema`, error.details); }
    }
    this.complete(frameKey, node, value, 'completed', { state: labelState(labelOf(node.args, this.labelScope(frameKey))) });
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
    const definitions = new Map(this.flowDefinitions.get(frameKey).nodes.map(n => [n.id, n])), frame = frameOf(this.current(), frameKey), families = new Set();
    for (const ref of references(node.subject)) {
      const [root, id] = ref.split('.');
      if (root !== 'nodes' || definitions.get(id)?.kind !== 'agent') continue;
      const modelId = frame.nodes[id]?.modelId;
      if (!modelId) throw new FoundryError('VERIFY_INDEPENDENCE', `Producer ${id} has no recorded model; independence cannot be established`);
      families.add(modelById(this.runtime.modelPolicy, modelId).family);
    }
    return families;
  }
  async oracle(node, frameKey, ctx) {
    const cap = this.registry.get(node.tool), run = this.current(), nodeKey = `${frameKey}/${node.id}`;
    if (!cap || !run.policy.allowedCapabilities.includes(node.tool)) throw new FoundryError('CAPABILITY_DENIED', `Capability ${node.tool} is not permitted for this run`);
    if (cap.effects !== 'none') throw new FoundryError('VERIFY_EFFECTS', 'A verification oracle must not have effects');
    const args = resolve(node.args, ctx), local = new AbortController(), stop = () => local.abort();
    await this.semaphore.take(this.abort.signal);
    this.abort.signal.addEventListener('abort', stop, { once: true });
    let timer;
    try {
      const timeoutMs = Math.max(1, Math.min(node.timeoutMs ?? 60000, cap.maxTimeoutMs, run.deadline - Date.now()));
      return await Promise.race([
        this.registry.execute(node.tool, args, { signal: local.signal, runId: this.runId, nodeKey, idempotencyKey: digest({ runId: this.runId, nodeKey, args }), artifactsDir: path.join(this.store.directory, 'artifacts', this.runId), store: this.store }),
        new Promise((_, reject) => { timer = setTimeout(() => { local.abort(); reject(new FoundryError('TOOL_TIMEOUT', `${node.tool} timed out`)); }, timeoutMs); })]);
    } finally { clearTimeout(timer); this.abort.signal.removeEventListener('abort', stop); this.semaphore.release(); }
  }
  async verify(node, frameKey, ctx, state, resumed) {
    const subject = resolve(node.subject, ctx), subjectLabel = labelOf(node.subject, this.labelScope(frameKey));
    let verdict, label = subjectLabel, meta = {};
    if (node.method === 'code') verdict = this.verdictShape(await this.sandboxed({ lang: node.lang, source: node.source, input: { subject }, timeoutMs: node.timeoutMs ?? 60000 }), 'CODE_OUTPUT');
    else if (node.method === 'capability') verdict = this.verdictShape(await this.oracle(node, frameKey, ctx), 'VERIFY_PROTOCOL');
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
    const frame = frameOf(this.current(), frameKey);
    const nodes = new Map(this.flowDefinitions.get(frameKey).nodes.map(n => [n.id, n]));
    const allowed = new Set(), pending = [...node.needs];
    while (pending.length) { const id = pending.pop(); if (allowed.has(id)) continue; allowed.add(id); pending.push(...(nodes.get(id)?.needs ?? [])); }
    for (const requirement of capability.requiresEvidence ?? []) {
      const wantedArgs = resolve(requirement.sourceArgs, { input: args });
      const wantedHash = digest(wantedArgs);
      const matching = Object.entries(frame.nodes).filter(([id, state]) => allowed.has(id) && state.tool === requirement.sourceTool && state.argsHash === wantedHash)
        .sort((a, b) => (b[1].startedSequence ?? b[1].completedSequence ?? 0) - (a[1].startedSequence ?? a[1].completedSequence ?? 0));
      if (!matching.length) throw new FoundryError('EVIDENCE_REQUIRED', `No successful scope-matching evidence for ${requirement.id}`);
      // Never cherry-pick an older valid observation after a newer malformed one.
      const [id, receipt] = matching[0];
      if (receipt.status !== 'completed') throw new FoundryError('EVIDENCE_INVALID', `The newest scope-matching observation for ${requirement.id} did not succeed; older evidence cannot replace it`);
      if (!Number.isFinite(receipt.completedAt) || Date.now() - receipt.completedAt > requirement.maxAgeMs || Date.now() < receipt.completedAt) throw new FoundryError('EVIDENCE_STALE', `Evidence ${requirement.id} is outside its freshness contract`);
      const output = frame.outputs[id];
      if (digest(output) !== receipt.outputHash) throw new FoundryError('EVIDENCE_CORRUPT', `Evidence ${requirement.id} does not match its receipt`);
      try {
        const value = requirement.path ? resolve({ $ref: `input.${requirement.path}` }, { input: output }) : output;
        validateData(requirement.schema, value, `evidence ${requirement.id}`);
      }
      catch (error) { throw new FoundryError('EVIDENCE_INVALID', `Evidence ${requirement.id} violates its host-owned data contract`, { cause: errorData(error) }); }
    }
  }
}
