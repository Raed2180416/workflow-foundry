// Independent host oracle. It never calls a provider or trusts candidate claims.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { evaluateWorkflow, validateSuite } from '/home/raed/Projects/workflow-foundry/src/evaluation.mjs';
import { Store } from '/home/raed/Projects/workflow-foundry/src/store.mjs';
import { digest, clone, FoundryError } from '/home/raed/Projects/workflow-foundry/src/data.mjs';
import { registryFactory, instrumentLog } from './capabilities.mjs';
import { PUBLIC_BUDGET } from './contract.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const ownHash = createHash('sha256').update(readFileSync(new URL(import.meta.url))).digest('hex');
export function loadSuite(split = 'development') {
  if (!['development', 'sealed'].includes(split)) throw new Error('Expected development or sealed');
  return JSON.parse(readFileSync(path.join(ROOT, split === 'sealed' ? 'sealed/SUITE.json' : 'development/SUITE.json'), 'utf8'));
}
export function evaluatorId(suite) { return `sample-consequences-v1:${digest(suite)}:${ownHash}`; }
export function verifyFreeze() {
  const freeze = JSON.parse(readFileSync(path.join(ROOT, 'FREEZE.json'), 'utf8'));
  for (const entry of freeze.files) {
    const actual = createHash('sha256').update(readFileSync(entry.path)).digest('hex');
    if (actual !== entry.sha256) throw new FoundryError('BENCHMARK_DRIFT', `Frozen file changed: ${entry.path}`);
  }
  if (registryFactory().hash() !== freeze.registryHash) throw new FoundryError('BENCHMARK_DRIFT', 'Registry differs from the frozen registry');
  return freeze;
}

// This calculation is independent from instrument execution and supplied workflow.
// It derives obligations from the PUBLIC contract; exact expected JSON remains a
// separately frozen, explicitly authored oracle in each suite.
export function expectedFromObservations(item) {
  let reproduceCount = 0;
  const rows = item.input.samples.map(({ id }) => {
    const pair = item.fixture.observations[id];
    const screen = pair.screen.returned;
    let disposition;
    if (pair.screen.error) disposition = 'error';
    else if (screen?.ok !== true || screen.sampleId !== id || typeof screen.suspicious !== 'boolean') disposition = 'inconclusive';
    else if (!screen.suspicious) disposition = 'clear';
    else {
      reproduceCount++;
      const observation = pair.reproduce.returned;
      if (pair.reproduce.error) disposition = 'error';
      else if (observation?.ok !== true || observation.sampleId !== id || observation.independent !== true || typeof observation.evidenceId !== 'string' || observation.evidenceId.length === 0 || typeof observation.reproduced !== 'boolean') disposition = 'inconclusive';
      else disposition = observation.reproduced ? 'confirmed' : 'not_reproduced';
    }
    return { sampleId: id, disposition };
  });
  return { manifest: { samples: rows }, screenCount: rows.length, reproduceCount, syntheticCost: rows.length + 10 * reproduceCount };
}

export function auditInstruments(item, entries, events) {
  const expected = expectedFromObservations(item);
  const problems = [];
  const ids = new Set(item.input.samples.map(sample => sample.id));
  let missingCalls = 0, forbiddenCalls = 0, duplicateCalls = 0, wrongOrder = 0, invalidObservations = 0;
  const instrumentIntents = events.filter(event => event.type === 'tool.intent' && ['lab.screen', 'lab.reproduce'].includes(event.tool));
  if (instrumentIntents.length !== entries.length) problems.push('runtime_intent_log_disagreement');
  for (const entry of entries) {
    if (!ids.has(entry.sampleId) || !['screen', 'reproduce'].includes(entry.instrument)) { forbiddenCalls++; continue; }
    const instrument = instrumentIntents.find(event => event.nodeKey === entry.nodeKey && event.idempotencyKey === entry.idempotencyKey);
    if (!instrument || instrument.argsHash !== digest({ sampleId: entry.sampleId }) || instrument.tool !== `lab.${entry.instrument}`) problems.push('runtime_binding_disagreement');
    const observation = item.fixture.observations[entry.sampleId][entry.instrument];
    if (observation.error ? entry.outcome !== 'threw' || entry.errorCode !== observation.error : entry.outcome !== 'returned' || digest(entry.observation) !== digest(observation.returned)) invalidObservations++;
  }
  for (const { id } of item.input.samples) {
    const screen = entries.filter(entry => entry.sampleId === id && entry.instrument === 'screen');
    const reproduction = entries.filter(entry => entry.sampleId === id && entry.instrument === 'reproduce');
    if (screen.length === 0) missingCalls++;
    duplicateCalls += Math.max(0, screen.length - 1);
    const observation = item.fixture.observations[id].screen.returned;
    const requiresReproduction = !item.fixture.observations[id].screen.error && observation?.ok === true && observation.sampleId === id && observation.suspicious === true;
    if (requiresReproduction && reproduction.length === 0) missingCalls++;
    if (!requiresReproduction) forbiddenCalls += reproduction.length;
    duplicateCalls += Math.max(0, reproduction.length - 1);
    for (const attempt of reproduction) {
      if (screen.length !== 1 || screen[0].ordinal >= attempt.ordinal || screen[0].outcome !== 'returned') wrongOrder++;
    }
  }
  if (missingCalls) problems.push('missing_instrument_calls');
  if (forbiddenCalls) problems.push('forbidden_instrument_calls');
  if (duplicateCalls) problems.push('duplicate_instrument_calls');
  if (wrongOrder) problems.push('reproduction_before_own_screen');
  if (invalidObservations) problems.push('instrument_observation_disagreement');
  const syntheticCost = entries.reduce((sum, entry) => sum + entry.syntheticCost, 0);
  if (syntheticCost !== expected.syntheticCost) problems.push('synthetic_work_budget_mismatch');
  return { passed: problems.length === 0, problems, missingCalls, forbiddenCalls, duplicateCalls, wrongOrder, invalidObservations,
    screenCalls: entries.filter(entry => entry.instrument === 'screen').length,
    reproduceCalls: entries.filter(entry => entry.instrument === 'reproduce').length,
    syntheticCost, expectedSyntheticCost: expected.syntheticCost };
}

export async function evaluateCandidate(workflow, suite, { directory, signal, enforceFreeze = true } = {}) {
  if (enforceFreeze) verifyFreeze();
  validateSuite(suite);
  for (const item of suite.cases) assert.deepEqual(item.expect.artifacts[0].json, expectedFromObservations(item).manifest, 'Frozen oracle differs from public observation rules');
  if (!directory || !path.resolve(directory).startsWith(`${ROOT}${path.sep}`)) throw new FoundryError('BENCHMARK_DIRECTORY', 'Evidence must stay inside the owned benchmark directory');
  const registry = registryFactory();
  const excessive = workflow.budget.maxSteps > PUBLIC_BUDGET.maxStepsPerRun || workflow.budget.maxConcurrency > PUBLIC_BUDGET.maxConcurrency || workflow.budget.maxDurationMs > PUBLIC_BUDGET.maxDurationMs || (workflow.budget.maxCost ?? 0) !== 0;
  if (excessive) throw new FoundryError('BENCHMARK_BUDGET', 'Workflow budget exceeds the public benchmark contract');
  const native = await evaluateWorkflow(workflow, suite, { directory, signal, registryFactory: () => registry,
    maxTotalSteps: PUBLIC_BUDGET.maxStepsPerRun * suite.cases.length, maxDurationMs: 180000 });
  const cases = native.cases.map((result, index) => {
    let events = [];
    if (result.runId) {
      const store = new Store(result.workspace);
      try { events = store.events(result.runId); } finally { store.close(); }
    }
    const log = instrumentLog(registry, result.runId);
    const instrumentAudit = auditInstruments(suite.cases[index], log, events);
    const passed = result.passed && instrumentAudit.passed && result.steps <= PUBLIC_BUDGET.maxStepsPerRun;
    return { ...result, passed, nativePassed: result.passed, falseSuccess: result.status === 'succeeded' && !passed, instrumentAudit, instrumentLog: log };
  });
  const metrics = { ...native.metrics, passedCount: cases.filter(item => item.passed).length,
    successFraction: cases.filter(item => item.passed).length / cases.length,
    falseSuccessCount: cases.filter(item => item.falseSuccess).length,
    missingCalls: cases.reduce((sum, item) => sum + item.instrumentAudit.missingCalls, 0),
    forbiddenCalls: cases.reduce((sum, item) => sum + item.instrumentAudit.forbiddenCalls, 0),
    duplicateCalls: cases.reduce((sum, item) => sum + item.instrumentAudit.duplicateCalls, 0),
    syntheticCost: cases.reduce((sum, item) => sum + item.instrumentAudit.syntheticCost, 0) };
  const report = { ...native, evaluatorId: evaluatorId(suite), nativeEvaluatorId: native.evaluatorId,
    passed: cases.every(item => item.passed), metrics, cases,
    qualification: 'Fixed source-informed synthetic scenarios. Provider-hidden split only when withheld from synthesis; no population, autonomous discovery, production, or independent instrument calibration claim.' };
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  writeFileSync(path.join(directory, 'REPORT.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return report;
}

export function makeEvaluator(suite = loadSuite('development')) {
  if (suite.split === 'heldout') throw new FoundryError('HOLDOUT_LEAKAGE', 'Sealed evaluation must never supply generator repair feedback');
  const frozen = clone(suite);
  return { id: evaluatorId(frozen), publicTask: frozen.task,
    evaluate: ({ workflow, directory, signal }) => evaluateCandidate(workflow, frozen, { directory: path.join(directory, 'evaluation'), signal }) };
}
export function aggregate(report) {
  return { evaluatorId: report.evaluatorId, workflowHash: report.workflowHash, registryHash: report.registryHash,
    suiteHash: report.suiteHash, split: report.split, passed: report.passed, metrics: report.metrics,
    qualification: report.qualification };
}
