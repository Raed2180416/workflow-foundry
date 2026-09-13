import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createDefaultRegistry } from '../src/capabilities.mjs';
import { Store } from '../src/store.mjs';
import { Runtime } from '../src/runtime.mjs';
import { validateWorkflow } from '../src/validate.mjs';
import { incidentCases, inspectIncident } from '../evals/incident-oracle.mjs';

// Hand-written reference/mutants ONLY for checking the oracle against real runtime
// behavior. Never supplied to architect models or counted as model generations.
const task = (id, tool, args, needs = []) => ({ id, kind: 'task', description: `Oracle unit fixture ${id}`, needs, tool, args, timeoutMs: 1000, retry: { maxAttempts: 1 } });
const equality = (reference, right) => ({ op: 'eq', left: { $ref: reference }, right });
function base(nodes, acceptance) {
  return {
    schemaVersion: '1.0', id: 'OracleUnitOnly', version: 1, title: 'Oracle integration unit fixture',
    domain: 'diagnostic', goal: 'Probe oracle validity, not model construction.',
    envelope: { assumptions: ['Synthetic fixed rollback case only'], risks: [], successCriteria: ['Independent oracle rejects deliberate wrong implementations.'] },
    budget: { maxSteps: 24, maxConcurrency: 3, maxDurationMs: 5000, maxCost: 0 }, nodes, acceptance,
  };
}
const rollbackFixture = () => base([
  task('metrics', 'fixture.observe', { probe: 'metrics' }),
  task('deployment', 'fixture.observe', { probe: 'deployment' }),
  task('logs', 'fixture.observe', { probe: 'logs' }),
  task('apply', 'fixture.remediate', { action: 'rollback' }, ['metrics', 'deployment', 'logs']),
  task('verify', 'fixture.verify', {}, ['apply']),
], [equality('nodes.verify.healthy', true)]);

async function runFixture(workflow) {
  const runs = fileURLToPath(new URL('../evals/runs/', import.meta.url));
  mkdirSync(runs, { recursive: true, mode: 0o700 });
  const workspace = mkdtempSync(runs + 'oracle-unit-');
  const store = new Store(workspace), registry = createDefaultRegistry();
  try {
    assert.equal(validateWorkflow(workflow, { registry }).valid, true, 'Mutant must reach real runtime execution.');
    store.saveWorkflow(workflow);
    const runtime = new Runtime(store, registry, { maxSteps: 24, maxConcurrency: 3, maxDurationMs: 5000, maxCost: 0 });
    const instance = runtime.create(workflow, {}, { fixture: incidentCases[0].fixture });
    const run = await runtime.execute(instance.id);
    return { run, oracle: inspectIncident({ taskCase: incidentCases[0], run, world: store.fixture(instance.id), events: store.events(instance.id) }) };
  } finally { store.close(); rmSync(workspace, { recursive: true }); }
}

test('real runtime self-attestation passes local acceptance but fails independent task oracle', async () => {
  const workflow = base([task('claim', 'core.identity', { healthy: true })], [equality('nodes.claim.healthy', true)]);
  const { run, oracle } = await runFixture(workflow);
  assert.equal(run.status, 'succeeded');
  assert.equal(oracle.passed, false);
  assert.ok(oracle.errors.some(error => error.includes('health')));
});

test('real rollback fixture passes; duplicate effect mutant is rejected despite healthy final state', async () => {
  const reference = await runFixture(rollbackFixture());
  assert.equal(reference.oracle.passed, true, JSON.stringify(reference.oracle.errors));
  const workflow = rollbackFixture();
  workflow.nodes.splice(4, 0, task('duplicate', 'fixture.remediate', { action: 'rollback' }, ['apply']));
  workflow.nodes.at(-1).needs = ['duplicate'];
  const { run, oracle } = await runFixture(workflow);
  assert.equal(run.status, 'succeeded');
  assert.equal(oracle.simulatorHealthy, true);
  assert.equal(oracle.passed, false);
  assert.equal(oracle.actions.length, 2);
});

test('real runtime recovery without independent verification cannot pass external oracle', async () => {
  const workflow = rollbackFixture();
  workflow.nodes.pop();
  workflow.acceptance = [equality('nodes.apply.attempted', 'rollback')];
  const { run, oracle } = await runFixture(workflow);
  assert.equal(run.status, 'succeeded');
  assert.equal(oracle.simulatorHealthy, true);
  assert.equal(oracle.passed, false);
  assert.ok(oracle.errors.some(error => error.includes('verification')));
});
