import { mkdirSync, mkdtempSync, readFileSync, lstatSync, openSync, closeSync, fstatSync, readSync, constants } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Store } from './store.mjs';
import { Runtime } from './runtime.mjs';
import { createDefaultRegistry } from './capabilities.mjs';
import { requireWorkflow, validateData, workflowSchema } from './validate.mjs';
import { condition, clone, digest, errorData, FoundryError, references } from './data.mjs';

export const suiteSchema = {
  type: 'object', additionalProperties: false,
  required: ['schemaVersion', 'id', 'split', 'task', 'cases'],
  definitions: workflowSchema.definitions,
  properties: {
    schemaVersion: { const: '1.0' }, id: { type: 'string', minLength: 1, maxLength: 100 },
    split: { enum: ['development', 'diagnostic', 'heldout'] }, task: { type: 'string', minLength: 1, maxLength: 20000 },
    envelope: { type: 'array', maxItems: 100, items: { type: 'string' } },
    cases: { type: 'array', minItems: 1, maxItems: 100, items: {
      type: 'object', additionalProperties: false, required: ['id', 'input', 'expect'],
      properties: {
        id: { type: 'string', minLength: 1, maxLength: 100 }, input: {}, fixture: { type: 'object' },
        expect: { type: 'object', additionalProperties: false, required: ['statuses', 'checks'], properties: {
          statuses: { type: 'array', minItems: 1, uniqueItems: true, items: { enum: ['succeeded', 'failed', 'cancelled', 'uncertain', 'waiting', 'awaiting_human', 'awaiting_approval', 'input-rejected'] } },
          checks: { type: 'array', maxItems: 100, items: { $ref: '#/definitions/condition' } },
          artifacts: { type: 'array', maxItems: 100, items: { type: 'object', additionalProperties: false, required: ['name'], properties: {
            name: { type: 'string', minLength: 1, maxLength: 100 }, content: { type: 'string', maxLength: 400000 }, json: {}, absent: { type: 'boolean' }
          } } }
        } }
      }
    } }
  }
};

export function validateSuite(suite) {
  validateData(suiteSchema, suite, 'host evaluation suite', { trustedSchema: true });
  if (new Set(suite.cases.map(c => c.id)).size !== suite.cases.length) throw new FoundryError('EVALUATION_CASE_IDS', 'Case ids must be unique');
  for (const item of suite.cases) {
    if (!item.expect.checks.length && !item.expect.artifacts?.length) throw new FoundryError('WEAK_EVALUATOR', `Case ${item.id} checks only status, not an independent outcome`);
    if (!item.expect.artifacts?.length && !item.expect.checks.some(check => references(check).some(ref => ref.startsWith('nodes.') || ref.startsWith('input.world.')))) throw new FoundryError('WEAK_EVALUATOR', `Case ${item.id} must inspect an actual output or external world state, not constants, input or status alone`);
    if (!item.expect.artifacts?.length) {
      if (item.expect.checks.every(check => constantTruth(check) === true)) throw new FoundryError('WEAK_EVALUATOR', `Case ${item.id} uses a tautological outcome check`);
      try {
        if (item.expect.checks.every(check => condition(check, { nodes: {}, input: { task: item.input, world: {}, run: {} } }))) throw new FoundryError('WEAK_EVALUATOR', `Case ${item.id} passes without any observed output or world evidence`);
      } catch (error) { if (error.code !== 'MISSING_REFERENCE') throw error; }
    }
    for (const artifact of item.expect.artifacts ?? []) {
      if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(artifact.name) || ['.', '..'].includes(artifact.name)) throw new FoundryError('EVALUATION_ARTIFACT_PATH', 'Artifact expectations use safe basenames only');
      if (!artifact.absent && !Object.hasOwn(artifact, 'content') && !Object.hasOwn(artifact, 'json')) throw new FoundryError('WEAK_EVALUATOR', 'File existence alone does not qualify content correctness');
      if (artifact.absent && (Object.hasOwn(artifact, 'content') || Object.hasOwn(artifact, 'json'))) throw new FoundryError('EVALUATION_CONTRADICTION', 'An artifact cannot be both absent and required to contain a value');
    }
  }
  return { suiteHash: digest(suite), caseCount: suite.cases.length };
}

// Reject obvious vacuity; this is not a proof of semantic oracle quality. Real
// mutation tests and task-level review remain mandatory for a new evaluator.
function constantTruth(check) {
  if (!references(check).length) { try { return condition(check, {}); } catch { return undefined; } }
  if (['eq', 'gte', 'lte'].includes(check.op) && digest(check.left) === digest(check.right)) return true;
  if (['ne', 'gt', 'lt'].includes(check.op) && digest(check.left) === digest(check.right)) return false;
  if (check.op === 'not') { const value = constantTruth(check.condition); return typeof value === 'boolean' ? !value : undefined; }
  if (check.op === 'any' || check.op === 'all') {
    const values = check.conditions.map(constantTruth);
    if (check.op === 'any') return values.includes(true) ? true : values.every(v => v === false) ? false : undefined;
    return values.includes(false) ? false : values.every(v => v === true) ? true : undefined;
  }
  return undefined;
}

function inspectArtifact(store, run, expected) {
  if (!run) return { name: expected.name, passed: !!expected.absent, reason: 'No run artifact exists because input was rejected' };
  const relative = ['artifacts', run.id, expected.name];
  let target = store.directory;
  for (let index = 0; index < relative.length; index++) {
    target = path.join(target, relative[index]);
    let stat;
    try { stat = lstatSync(target); }
    catch (error) {
      if (error.code === 'ENOENT') return { name: expected.name, passed: !!expected.absent, reason: 'Artifact absent' };
      return { name: expected.name, passed: false, error: errorData(error) };
    }
    if (stat.isSymbolicLink() || (index < relative.length - 1 ? !stat.isDirectory() : !stat.isFile())) return { name: expected.name, passed: false, reason: 'Artifact or an ancestor is a symlink or has an invalid file type' };
  }
  if (expected.absent) return { name: expected.name, passed: false, reason: 'Artifact exists despite an absence requirement' };
  let fd;
  try {
    fd = openSync(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(fd), limit = 512 * 1024;
    if (!stat.isFile() || stat.size > limit) return { name: expected.name, passed: false, reason: 'Artifact exceeds limit or is not a regular file' };
    const storage = Buffer.alloc(limit + 1); let bytes = 0;
    while (bytes < storage.length) { const got = readSync(fd, storage, bytes, storage.length - bytes, null); if (!got) break; bytes += got; }
    if (bytes > limit) return { name: expected.name, passed: false, reason: 'Artifact grew beyond the permitted size' };
    const data = storage.subarray(0, bytes); let passed = true;
    if (Object.hasOwn(expected, 'content')) passed &&= data.toString('utf8') === expected.content;
    if (Object.hasOwn(expected, 'json')) { try { passed &&= digest(JSON.parse(data.toString('utf8'))) === digest(expected.json); } catch { passed = false; } }
    return { name: expected.name, passed, sha256: createHash('sha256').update(data).digest('hex') };
  } catch (error) { return { name: expected.name, passed: false, error: errorData(error) }; }
  finally { if (fd !== undefined) closeSync(fd); }
}

export async function evaluateWorkflow(workflow, suite, { directory, registryFactory = createDefaultRegistry, signal, maxTotalSteps = 10000, maxDurationMs = 180000 } = {}) {
  const { suiteHash } = validateSuite(suite);
  if (!Number.isSafeInteger(maxTotalSteps) || maxTotalSteps < 1 || maxTotalSteps > 100000 || !Number.isSafeInteger(maxDurationMs) || maxDurationMs < 1 || maxDurationMs > 3600000) throw new FoundryError('EVALUATION_BUDGET', 'Evaluation budgets must be positive bounded integers');
  const registry = registryFactory();
  requireWorkflow(workflow, { registry });
  if (!directory) throw new FoundryError('EVALUATION_DIRECTORY', 'An explicit isolated evidence directory is required');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const startedAt = Date.now(), workflowHash = digest(workflow), results = [];
  let totalSteps = 0, totalCost = 0;
  for (const item of suite.cases) {
    if (signal?.aborted || Date.now() - startedAt >= maxDurationMs || totalSteps >= maxTotalSteps) {
      results.push({ id: item.id, passed: false, status: 'not-run', reason: 'Evaluation budget or cancellation prevented execution' }); continue;
    }
    const workspace = mkdtempSync(path.join(directory, 'case-'));
    const store = new Store(workspace); const began = Date.now();
    let run = null, exception = null, charged = false;
    try {
      store.stageEvaluationWorkflow(workflow);
      const runtime = new Runtime(store, registry, { maxSteps: Math.min(2000, maxTotalSteps - totalSteps), maxDurationMs: Math.min(30000, maxDurationMs - (Date.now() - startedAt)), maxConcurrency: 2, maxCost: 0 });
      try { run = runtime.create(workflow, item.input, item.fixture ? { fixture: item.fixture } : {}); }
      catch (error) { exception = errorData(error); }
      if (run) run = await runtime.execute(run.id, { signal });
      totalSteps += run?.steps ?? 0; totalCost += run?.cost ?? 0; charged = true;
      const status = run?.status ?? (exception?.code === 'SCHEMA_MISMATCH' ? 'input-rejected' : 'evaluation-error');
      const world = run ? store.fixture(run.id) : item.fixture ?? null;
      const context = { input: { task: item.input, run: run ? { status, steps: run.steps, cost: run.cost, error: run.error } : { status, error: exception }, world }, nodes: run?.outputs ?? {} };
      const checks = item.expect.checks.map((check, index) => {
        try { return { index, passed: condition(check, context) }; }
        catch (error) { return { index, passed: false, error: errorData(error) }; }
      });
      const artifacts = (item.expect.artifacts ?? []).map(expected => inspectArtifact(store, run, expected));
      const passed = item.expect.statuses.includes(status) && checks.every(c => c.passed) && artifacts.every(a => a.passed);
      const failedNodes = run ? [['root', run], ...Object.entries(run.frames)].flatMap(([frame, state]) => Object.entries(state.nodes)
        .filter(([, node]) => node.error || ['failed', 'uncertain', 'handled_error'].includes(node.status))
        .map(([id, node]) => ({ nodeKey: `${frame}/${id}`, status: node.status, tool: node.tool ?? null, error: node.error ?? null }))).slice(-30) : [];
      results.push({ id: item.id, passed, status, falseSuccess: status === 'succeeded' && !passed, checks, artifacts, steps: run?.steps ?? 0, cost: run?.cost ?? 0, elapsedMs: Date.now() - began, runId: run?.id ?? null, workspace, exception, runError: run?.error ?? null, failedNodes, eventCount: run ? store.events(run.id).length : 0,
        ...(suite.split === 'heldout' ? {} : { diagnostic: { input: item.input, expected: item.expect } }) });
    } catch (error) {
      results.push({ id: item.id, passed: false, status: 'evaluation-error', error: errorData(error), workspace });
    } finally {
      if (!charged && run) { const observed = store.run(run.id); totalSteps += observed.steps; totalCost += observed.cost; }
      store.close();
    }
  }
  const passedCount = results.filter(r => r.passed).length;
  return {
    evaluatorId: `suite:${suite.id}:${suiteHash}`, workflowHash, registryHash: registry.hash(), suiteHash,
    split: suite.split, qualificationLevel: 'task-outcome', passed: passedCount === suite.cases.length,
    metrics: { passedCount, caseCount: suite.cases.length, successFraction: passedCount / suite.cases.length, falseSuccessCount: results.filter(r => r.falseSuccess).length, totalSteps, totalCost, elapsedMs: Date.now() - startedAt },
    envelope: suite.envelope ?? [], cases: results,
    qualification: 'Only this explicitly enumerated suite, capability registry and budget; not arbitrary deployment or commercial parity'
  };
}

export function suiteEvaluator(suite, options = {}) {
  const { suiteHash } = validateSuite(suite);
  if (suite.split === 'heldout') throw new FoundryError('HOLDOUT_LEAKAGE', 'A held-out suite cannot drive iterative generation or supply repair feedback');
  const frozen = clone(suite);
  return {
    id: `suite:${suite.id}:${suiteHash}`,
    publicTask: suite.task,
    async evaluate({ workflow, signal, directory }) {
      const report = await evaluateWorkflow(workflow, frozen, { ...options, signal, directory: path.join(directory, 'evaluation') });
      return report;
    }
  };
}
