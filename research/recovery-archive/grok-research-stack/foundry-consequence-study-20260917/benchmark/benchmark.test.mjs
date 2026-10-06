import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Foundry } from '/home/raed/Projects/workflow-foundry/src/foundry.mjs';
import { WorkflowGenerator } from '/home/raed/Projects/workflow-foundry/src/generator.mjs';
import { digest } from '/home/raed/Projects/workflow-foundry/src/data.mjs';
import { TASK, INPUT_SCHEMA, MANIFEST_SCHEMA } from './contract.mjs';
import { registryFactory, instrumentLog } from './capabilities.mjs';
import { verifyFreeze, loadSuite, makeEvaluator, evaluateCandidate, auditInstruments } from './oracle.mjs';
import { suppliedWorkflow } from './supplied.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const runRoot = mkdtempSync(path.join(root, 'integration-'));
const dev = loadSuite('development');
const save = (file, value) => writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });

test('frozen public contracts and registry identity remain exact', () => {
  const freeze = verifyFreeze();
  const publicData = JSON.parse(readFileSync(path.join(root, 'PUBLIC.json'), 'utf8'));
  assert.equal(publicData.task, TASK);
  assert.deepEqual(publicData.inputSchema, INPUT_SCHEMA);
  assert.deepEqual(publicData.manifestSchema, MANIFEST_SCHEMA);
  assert.doesNotMatch(TASK, /\b(?:map|branch|verification)\b/i);
  assert.equal(registryFactory().hash(), freeze.registryHash);
  assert.equal(registryFactory({ trialCases: dev.cases }).hash(), freeze.registryHash);
  assert.ok(registryFactory().list().every(cap => cap.risk === 'low' && !cap.requiresApproval && cap.cost === 0));
  assert.ok(!registryFactory().get('fixture.observe'));
});

test('sealed suite cannot become generator feedback', () => {
  assert.throws(() => makeEvaluator({ ...dev, split: 'heldout' }), { code: 'HOLDOUT_LEAKAGE' });
});

test('changing fixture truth cannot change an instrument observation', async () => {
  const entry = dev.cases.find(item => item.input.samples.length > 0);
  const sampleId = entry.input.samples[0].id;
  const registry = registryFactory();
  const context = truth => ({ runId: `fixture-${truth}`, nodeKey: 'test/screen', idempotencyKey: `test-${truth}`,
    store: { run: () => ({ input: entry.input }), fixture: () => ({ ...entry.fixture, truth: { [sampleId]: truth } }) } });
  assert.deepEqual(await registry.execute('lab.screen', { sampleId }, context(false)),
    await registry.execute('lab.screen', { sampleId }, context(true)));
});

test('actual TrialRunner supports instrument fixtures without exposing fixture truth', async () => {
  const registry = registryFactory({ trialCases: dev.cases });
  const foundry = new Foundry(path.join(runRoot, 'trials'), { registry,
    trialPolicy: { allowedCapabilities: registry.list().map(cap => cap.name), maxSteps: 160, maxDurationMs: 30000 } });
  try {
    const request = foundry.store.createRequest({ text: TASK });
    const receipts = [];
    for (const item of dev.cases.slice(1, 3)) {
      const result = await foundry.trial({ requestId: request.id, workflow: suppliedWorkflow(), input: item.input });
      assert.equal(result.runStatus, 'succeeded');
      const inspected = foundry.inspectTrial(result.id);
      const file = path.join(foundry.store.directory, 'trials', result.id, '.foundry', 'artifacts', result.runId, 'manifest.json');
      assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), item.expect.artifacts[0].json);
      const entries = instrumentLog(registry, result.runId);
      const audit = auditInstruments(item, entries, inspected.events);
      assert.equal(audit.passed, true);
      assert.ok(!Object.hasOwn(inspected.run, 'fixture'));
      assert.ok(!Object.hasOwn(inspected.run, 'extra'));
      const altered = structuredClone(entries);
      const reproduction = altered.find(event => event.instrument === 'reproduce');
      reproduction.ordinal = -1;
      assert.equal(auditInstruments(item, altered, inspected.events).passed, false);
      receipts.push({ trialId: result.id, runStatus: result.runStatus, workflowHash: result.workflowHash, instrumentAudit: audit });
    }
    save(path.join(runRoot, 'TRIAL_INTEGRATION.json'), { passed: true, receipts });
  } finally { await foundry.close(); }
});

test('actual WorkflowGenerator accepts the independent evaluator with a supplied fixture callback', async () => {
  const registry = registryFactory();
  const foundry = new Foundry(path.join(runRoot, 'generator'), { registry });
  let fixtureCallbacks = 0;
  const provider = { identity: { id: 'supplied-fixture-callback', model: 'none', externalCalls: 0 },
    async generate({ prompt }) {
      fixtureCallbacks++;
      assert.ok(prompt.includes(TASK));
      assert.ok(!prompt.includes('sealed/SUITE.json'));
      assert.ok(!prompt.includes('physicalDefects'));
      return { text: JSON.stringify({ workflow: suppliedWorkflow(), rationale: 'Supplied integration fixture only; no model construction.' }) };
    } };
  try {
    const request = foundry.store.createRequest({ text: TASK });
    const generator = new WorkflowGenerator(foundry, provider, { maxRounds: 1, maxDurationMs: 180000, evaluator: makeEvaluator(dev) });
    const result = await generator.generate(request.id);
    assert.equal(result.status, 'proposed', JSON.stringify(result.error));
    assert.equal(result.taskOutcomeQualified, true);
    assert.equal(fixtureCallbacks, 1);
    assert.equal(result.workflowHash, digest(suppliedWorkflow()));
    save(path.join(runRoot, 'GENERATOR_INTEGRATION.json'), { passed: true, jobId: result.id, workflowHash: result.workflowHash,
      fixtureCallbacks, externalModelCalls: 0, qualification: 'Plumbing test with supplied candidate, not model synthesis.' });
  } finally { await foundry.close(); }
});

test('even an exact forged manifest fails without the required instrument attempts', async () => {
  const item = dev.cases[1];
  const workflow = suppliedWorkflow();
  workflow.nodes = [
    { id: 'serialize', kind: 'task', needs: [], description: 'Forged supplied answer', tool: 'core.json',
      args: { value: item.expect.artifacts[0].json }, timeoutMs: 1000, retry: { maxAttempts: 1 } },
    { id: 'manifest', kind: 'task', needs: ['serialize'], description: 'Write forged manifest', tool: 'core.artifact',
      args: { name: 'manifest.json', content: { $ref: 'nodes.serialize.text' } }, timeoutMs: 1000, retry: { maxAttempts: 1 } }
  ];
  const report = await evaluateCandidate(workflow, { ...dev, id: 'public-forged-manifest-control', cases: [item] },
    { directory: path.join(runRoot, 'forged-manifest') });
  assert.equal(report.cases[0].nativePassed, true);
  assert.equal(report.passed, false);
  assert.ok(report.metrics.missingCalls > 0);
});

test('calibration receipts show two equivalent positive controls and six rejected mutants', () => {
  const audit = JSON.parse(readFileSync(path.join(root, 'calibration-001/AUDIT.json'), 'utf8'));
  assert.equal(audit.passed, true);
  assert.equal(audit.matrix.length, 8);
  assert.ok(audit.matrix.slice(0, 2).every(row => row.development.passed && row.sealed.passed));
  assert.ok(audit.matrix.slice(2).every(row => !row.development.passed && !row.sealed.passed));
  save(path.join(runRoot, 'INTEGRATION_RECEIPT.json'), { evidenceDirectory: runRoot, calibrationPassed: true,
    modelsCalled: 0, note: 'See TAP exit status for full integration test result.' });
});
