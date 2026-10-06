import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { checkData, clone, condition, digest, errorData, FoundryError, resolve } from './data.mjs';
import { requireWorkflow, validateData } from './validate.mjs';
import { engineHash } from './engine.mjs';

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
const policyDefaults = registry => ({
  allowedCapabilities: registry.list().filter(c => c.risk === 'low').map(c => c.name),
  maxSteps: 5000, maxConcurrency: 4, maxDurationMs: 3600000, maxCost: 0, maxResumes: 1000
});

export class Runtime {
  constructor(store, registry, policy = {}) {
    this.store = store; this.registry = registry; this.policy = { ...policyDefaults(registry), ...clone(policy) };
    for (const k of ['maxSteps', 'maxConcurrency', 'maxDurationMs', 'maxResumes']) if (!Number.isSafeInteger(this.policy[k]) || this.policy[k] < 1) throw new FoundryError('POLICY', `${k} must be a positive integer`);
    if (!Array.isArray(this.policy.allowedCapabilities) || this.policy.allowedCapabilities.some(x => !registry.get(x))) throw new FoundryError('POLICY', 'Allowed capabilities must be registered');
    if (!Number.isFinite(this.policy.maxCost) || this.policy.maxCost < 0) throw new FoundryError('POLICY', 'maxCost must be nonnegative');
  }
  create(workflow, input = {}, options = {}) {
    const { hash } = requireWorkflow(workflow, { registry: this.registry });
    if (workflow.inputSchema) validateData(workflow.inputSchema, input, 'workflow input'); else checkData(input);
    this.store.workflow(hash); // The exact immutable version must already be saved.
    return this.store.createRun(hash, input, this.registry.hash(), this.policy, { ...options, engineHash });
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
      if (!decision) { r.status = 'cancelled'; r.error = { code: 'APPROVAL_REJECTED', message: 'User rejected the operation' }; }
      else r.status = 'ready';
    }, { type: 'approval.decided', approvalId, approved: decision, actor });
  }
}

export function locateNode(run, nodeKey) {
  const slash = nodeKey.lastIndexOf('/'), frameKey = nodeKey.slice(0, slash), id = nodeKey.slice(slash + 1);
  const frame = frameOf(run, frameKey); const state = frame?.nodes[id];
  return state ? { frame, state, id, frameKey } : null;
}

class Invocation {
  constructor(runtime, runId, signal) {
    this.store = runtime.store; this.registry = runtime.registry; this.runId = runId;
    this.abort = new AbortController(); this.token = randomUUID(); this.outerSignal = signal;
    this.flowDefinitions = new Map();
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
  complete(frameKey, node, output, status = 'completed') {
    checkData(output, { maxBytes: 512 * 1024 });
    this.eventNode(frameKey, node.id, (f, run) => {
      f.nodes[node.id] = { ...f.nodes[node.id], status, completedAt: Date.now(), completedSequence: (run.eventHead?.seq ?? 0) + 1, outputHash: digest(output) };
      f.outputs[node.id] = clone(output);
    }, status === 'handled_error' ? 'node.handled_error' : 'node.completed', { outputHash: digest(output), output });
  }
  async execute() {
    let owned = false;
    try {
      let run = this.current();
      this.workflow = this.store.workflow(run.workflowHash).workflow;
      requireWorkflow(this.workflow, { registry: this.registry });
      if (run.registryHash !== this.registry.hash()) throw new FoundryError('CAPABILITY_DRIFT', 'Capabilities changed since run creation');
      this.store.events(this.runId); // Verify the chain before trusting a checkpoint.
      if (finished.has(run.status)) return run;
      if (!run.engineHash) throw new FoundryError('ENGINE_UNBOUND', 'This historical run has no native engine binding. Inspect it or use its original frozen runtime; do not silently resume it under changed semantics.');
      if (run.engineHash !== engineHash) throw new FoundryError('ENGINE_DRIFT', 'The native execution engine differs from the version that created this run. Resume with the original engine or create a separately reviewed new run.', { recorded: run.engineHash, current: engineHash });
      const birth = this.store.events(this.runId)[0];
      if (birth?.engineHash !== run.engineHash) throw new FoundryError('ENGINE_BINDING_CORRUPT', 'Run engine identity does not match its immutable creation event');
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
      return this.update(r => { r.status = status; r.owner = null; }, { type: `run.${status}` });
    } catch (error) {
      this.abort.abort();
      if (!owned) throw error;
      return this.update(r => {
        const all = [...Object.values(r.nodes), ...Object.values(r.frames).flatMap(f => Object.values(f.nodes))];
        r.status = all.some(n => n.status === 'uncertain') ? 'uncertain' : (this.userCancelled || error.code === 'CANCELLED' ? 'cancelled' : 'failed');
        r.error = errorData(error); r.owner = null;
      }, { type: 'run.stopped', error: errorData(error) });
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
  async flow(flow, frameKey, input, locals) {
    this.flowDefinitions.set(frameKey, flow);
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
    if (!state) { this.charge(frameKey, node); state = frameOf(this.current(), frameKey).nodes[node.id]; }
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
      const outputs = [];
      for (let index = 0; index < items.length; index++) {
        const result = await this.flow(node.body, `${frameKey}/${node.id}:${index}`, childInput, { item: items[index], index });
        if (!result.done) { this.eventNode(frameKey, node.id, f => { f.nodes[node.id].status = 'waiting_child'; }, 'node.waiting_child'); return; }
        outputs.push(result.outputs);
      }
      this.complete(frameKey, node, { items: outputs, count: outputs.length }); return;
    }
    if (node.kind === 'loop') {
      const childInput = Object.hasOwn(node, 'input') ? resolve(node.input, ctx) : input;
      let previous = resolve(node.initial, ctx);
      for (let iteration = 0; iteration < node.maxIterations; iteration++) {
        const childKey = `${frameKey}/${node.id}:${iteration}`;
        const childLocals = { iteration, previous };
        const result = await this.flow(node.body, childKey, childInput, childLocals);
        if (!result.done) { this.eventNode(frameKey, node.id, f => { f.nodes[node.id].status = 'waiting_child'; }, 'node.waiting_child'); return; }
        if (condition(node.until, { input: childInput, nodes: result.outputs, ...childLocals })) {
          this.complete(frameKey, node, { iterations: iteration + 1, last: result.outputs }); return;
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
    const args = resolve(node.args, ctx);
    validateData(cap.inputSchema, args, `${node.tool} input`);
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
          this.complete(frameKey, node, result); return;
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
            if (node.onError === 'continue') { this.complete(frameKey, node, { ok: false, error: errorData(error) }, 'handled_error'); return; }
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
