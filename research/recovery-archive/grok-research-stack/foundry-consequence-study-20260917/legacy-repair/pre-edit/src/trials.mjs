import { mkdirSync, lstatSync, realpathSync, readdirSync, openSync, fstatSync, closeSync, readSync, constants } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Store } from './store.mjs';
import { Runtime } from './runtime.mjs';
import { createDefaultRegistry } from './capabilities.mjs';
import { requireWorkflow } from './validate.mjs';
import { checkData, clone, digest, FoundryError, errorData } from './data.mjs';

function directory(parent, name, create = false) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,100}$/.test(name)) throw new FoundryError('TRIAL_PATH', 'Invalid host-generated trial directory identifier');
  const target = path.join(parent, name);
  if (create) { try { mkdirSync(target, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; } }
  const stat = lstatSync(target);
  if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(target) !== target) throw new FoundryError('TRIAL_PATH', 'Trial storage must be a real directory inside the configured workspace');
  return target;
}

/** Each draft gets its own Store; competing drafts may retain the same id/version.
 * This does not sandbox arbitrary external tools: only explicitly safe host
 * capabilities can be selected, and normal host limits are intersected. */
export class TrialRunner {
  constructor(foundry, { allowedCapabilities, maxPerRequest = 12, maxTotal = 200, maxSteps = 200, maxDurationMs = 15000 } = {}) {
    this.foundry = foundry; this.active = new Map();
    const defaults = new Map(createDefaultRegistry().list().filter(c => c.name.startsWith('core.')).map(c => [c.name, digest(c)]));
    const selected = allowedCapabilities ?? foundry.registry.list().filter(c => defaults.get(c.name) === digest(c)).map(c => c.name);
    if (!Array.isArray(selected) || selected.some(name => typeof name !== 'string' || !foundry.registry.get(name))) throw new FoundryError('TRIAL_POLICY', 'Trial capabilities must be an explicit host-selected registered list');
    for (const [key, value, upper] of [['maxPerRequest', maxPerRequest, 100], ['maxTotal', maxTotal, 10000], ['maxSteps', maxSteps, 5000], ['maxDurationMs', maxDurationMs, 120000]]) {
      if (!Number.isSafeInteger(value) || value < 1 || value > upper) throw new FoundryError('TRIAL_POLICY', `${key} is outside its bounded host limit`);
    }
    const normal = foundry.runtime.policy;
    this.policy = {
      allowedCapabilities: [...new Set(selected)].filter(name => {
        const cap = foundry.registry.get(name);
        return normal.allowedCapabilities.includes(name) && cap.risk === 'low' && !cap.requiresApproval && cap.effects !== 'non-idempotent' && cap.cost === 0;
      }),
      maxSteps: Math.min(maxSteps, normal.maxSteps), maxDurationMs: Math.min(maxDurationMs, normal.maxDurationMs),
      maxConcurrency: Math.min(2, normal.maxConcurrency), maxCost: 0, maxResumes: 1
    };
    this.limits = { maxPerRequest, maxTotal };
  }
  descriptor() { return { policy: clone(this.policy), limits: clone(this.limits), qualification: 'Diagnostic capability allowlist, never automatic production access' }; }
  async execute({ requestId, workflow, input }, { signal } = {}) {
    requireWorkflow(workflow, { registry: this.foundry.registry }); checkData(input, { maxBytes: 512 * 1024 });
    const inspect = flow => {
      for (const node of flow.nodes) {
        if (node.kind === 'task' && !this.policy.allowedCapabilities.includes(node.tool)) throw new FoundryError('TRIAL_CAPABILITY_DENIED', `Capability ${node.tool} is not permitted for isolated draft execution; it requires explicit host qualification`);
        if (node.body) inspect(node.body);
      }
    };
    inspect(workflow);
    if (signal?.aborted) throw new FoundryError('TRIAL_CANCELLED', 'Trial cancelled before reservation');
    const trial = this.foundry.store.createTrial({ requestId, workflow, registryHash: this.foundry.registry.hash(), inputHash: digest(input), policyHash: digest(this.policy), ...this.limits });
    const controller = new AbortController(), abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const promise = this.#run(trial, workflow, input, controller.signal).finally(() => {
      this.active.delete(trial.id); signal?.removeEventListener('abort', abort);
    });
    this.active.set(trial.id, { controller, promise });
    promise.catch(() => {});
    return promise;
  }
  async #run(trial, workflow, input, signal) {
    let child, run;
    try {
      const root = directory(this.foundry.store.directory, 'trials', true);
      const workspace = directory(root, trial.id, true);
      child = new Store(workspace); child.stageEvaluationWorkflow(workflow);
      const runtime = new Runtime(child, this.foundry.registry, this.policy);
      try { run = runtime.create(workflow, input); }
      catch (error) {
        if (error.code !== 'SCHEMA_MISMATCH') throw error;
        return this.foundry.store.finishTrial(trial.id, { status: 'finished', runId: null, runStatus: 'input-rejected', error: errorData(error), localAcceptancePassed: false, steps: 0, cost: 0, artifactReceipts: [] });
      }
      run = await runtime.execute(run.id, { signal });
      child.events(run.id);
      const artifactReceipts = artifacts(child, run.id);
      const evidence = this.foundry.store.finishTrial(trial.id, {
        status: 'finished', runId: run.id, runStatus: run.status, error: run.error,
        eventHead: run.eventHead, outputHash: digest(run.outputs), steps: run.steps, cost: run.cost,
        localAcceptancePassed: run.status === 'succeeded', artifactReceipts
      });
      return { ...evidence, outputs: clone(run.outputs) };
    } catch (error) {
      return this.foundry.store.finishTrial(trial.id, { status: 'failed', error: errorData(error), runId: run?.id ?? null, localAcceptancePassed: false });
    } finally { child?.close(); }
  }
  inspect(id) {
    const trial = this.foundry.store.trial(id);
    if (!trial.runId && trial.runStatus !== 'input-rejected') return { ...trial, run: null, events: [] };
    const root = directory(this.foundry.store.directory, 'trials');
    const workspace = directory(root, trial.id);
    const child = new Store(workspace);
    try {
      const workflow = child.workflow(trial.workflowHash).workflow;
      if (workflow.id !== trial.workflowId || workflow.version !== trial.workflowVersion) throw new FoundryError('TRIAL_EVIDENCE', 'Trial source identity differs from its preserved reservation');
      // The exact candidate was staged before input validation. Preserve its
      // inspectable graph even when no run was created; never substitute a
      // current reusable head or invent execution events for a rejected input.
      if (!trial.runId) {
        if (child.runs().length !== 0) throw new FoundryError('TRIAL_EVIDENCE', 'An input-rejected trial unexpectedly contains execution state');
        return { ...trial, workflow, run: null, events: [] };
      }
      const run = child.run(trial.runId), events = child.events(run.id);
      if (run.workflowHash !== trial.workflowHash || run.registryHash !== trial.registryHash || digest(run.input) !== trial.inputHash || digest(run.policy) !== trial.policyHash) throw new FoundryError('TRIAL_EVIDENCE', 'Trial run identity differs from its preserved reservation');
      if (trial.status === 'finished' && (digest(run.eventHead) !== digest(trial.eventHead) || digest(run.outputs) !== trial.outputHash || run.status !== trial.runStatus)) throw new FoundryError('TRIAL_EVIDENCE', 'Final trial evidence changed after the receipt was closed');
      const currentArtifacts = artifacts(child, run.id);
      if (trial.status === 'finished' && digest(currentArtifacts) !== digest(trial.artifactReceipts)) throw new FoundryError('TRIAL_EVIDENCE', 'Trial artifacts changed after the receipt was closed');
      return { ...trial, workflow, run: this.foundry.publicRun(run), events, artifactReceipts: currentArtifacts };
    } finally { child.close(); }
  }
  async close() { for (const value of this.active.values()) value.controller.abort(); await Promise.allSettled([...this.active.values()].map(value => value.promise)); }
}

function artifacts(store, runId) {
  let folder;
  try { folder = directory(directory(store.directory, 'artifacts'), runId); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const names = readdirSync(folder).sort();
  if (names.length > 1000) throw new FoundryError('TRIAL_ARTIFACT_LIMIT', 'Too many trial artifacts');
  return names.filter(name => !name.startsWith('.tmp-')).map(name => {
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(name)) throw new FoundryError('TRIAL_ARTIFACT_PATH', 'Invalid artifact basename');
    const file = path.join(folder, name), stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 512 * 1024) throw new FoundryError('TRIAL_ARTIFACT_PATH', 'Trial artifacts must be bounded regular files');
    const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      if (!fstatSync(fd).isFile()) throw new FoundryError('TRIAL_ARTIFACT_PATH', 'Artifact type changed while opening');
      const buffer = Buffer.alloc(512 * 1024 + 1); let length = 0;
      while (length < buffer.length) { const count = readSync(fd, buffer, length, buffer.length - length, null); if (!count) break; length += count; }
      if (length > 512 * 1024) throw new FoundryError('TRIAL_ARTIFACT_LIMIT', 'Artifact exceeds its byte limit');
      const bytes = buffer.subarray(0, length);
      return { name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
    } finally { closeSync(fd); }
  });
}
