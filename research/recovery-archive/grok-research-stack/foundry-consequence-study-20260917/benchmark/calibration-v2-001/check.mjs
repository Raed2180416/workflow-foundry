// Exposed additive evaluator calibration. No network/provider calls or source edits.
// Run after prepare.mjs: node calibration-v2-001/check.mjs run-001
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { Foundry } from '/home/raed/Projects/workflow-foundry/src/foundry.mjs';
import { WorkflowGenerator } from '/home/raed/Projects/workflow-foundry/src/generator.mjs';
import { validateWorkflow } from '/home/raed/Projects/workflow-foundry/src/validate.mjs';
import { digest } from '/home/raed/Projects/workflow-foundry/src/data.mjs';
import { registryFactory, instrumentLog } from '../capabilities.mjs';
import { INPUT_SCHEMA, TASK } from '../contract.mjs';
import { suppliedWorkflow, renamedEquivalent, MUTANTS } from '../supplied.mjs';
import { evaluateCandidate as evaluateV1 } from '../oracle.mjs';
import { verifyFreeze, loadSuite, validateFixtures, makeEvaluator, evaluateCandidate, auditInstruments, aggregate, PUBLICATION_POLICY } from '../oracle-v2.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.dirname(HERE);
const witnessRoot = path.join(ROOT, '../benchmark-independent/run-001');
const label = process.argv[2] ?? 'run-001';
assert.match(label, /^run-[0-9]{3}$/);
const out = path.join(HERE, label); mkdirSync(out, { mode: 0o700 });
const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const read = file => JSON.parse(readFileSync(file, 'utf8'));
const save = (file, value) => writeFileSync(path.join(out, file), JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
const freeze = verifyFreeze(), results = [], matrix = [];
const development = loadSuite('development');
const controls = [['positive', suppliedWorkflow()], ['equivalent', renamedEquivalent()], ...MUTANTS.map(name => [name, suppliedWorkflow(name)])];
save('CONTROL_FREEZE.json', { at: new Date().toISOString(), sourceSha256: hash(fileURLToPath(import.meta.url)),
  v2FreezeSha256: hash(path.join(ROOT, 'FREEZE_V2.json')), controls: controls.map(([name, workflow]) => ({ name, workflowHash: digest(workflow) })),
  qualification: 'Supplied calibration only; no model synthesis or external provider invocation.' });

async function check(name, run) {
  try { const evidence = await run(); results.push({ name, passed: true, evidence }); }
  catch (error) { results.push({ name, passed: false, error: { code: error.code ?? null, message: error.message, stack: error.stack } }); }
  console.log(JSON.stringify({ name, passed: results.at(-1).passed }));
}
async function evaluate(name, workflow, suite) {
  const validation = validateWorkflow(workflow, { registry: registryFactory() });
  assert.equal(validation.valid, true, JSON.stringify(validation.errors));
  save(`${name}-WORKFLOW.json`, workflow);
  return evaluateCandidate(workflow, suite, { directory: path.join(out, name) });
}
await check('original-two-positives-and-six-mutants', async () => {
  for (const [name, workflow] of controls) {
    const row = { name, supplied: true };
    for (const split of ['development', 'sealed']) {
      const report = await evaluate(`original-${name}-${split}`, workflow, loadSuite(split));
      row[split] = aggregate(report);
      assert.equal(report.passed, ['positive', 'equivalent'].includes(name), `${name}/${split}`);
    }
    matrix.push(row); save(`${name}-AGGREGATE.json`, row);
    console.log(JSON.stringify({ control: name, development: row.development.metrics.passedCount,
      sealed: row.sealed.metrics.passedCount, accepted: row.development.passed && row.sealed.passed }));
  }
  return { positiveControls: 2, mutantsRejectedByEachWholeSuite: 6 };
});

for (const [name, expectedV1, expectedV2] of [
  ['early-confirmation', true, false], ['early-confirmation-counterfactual', false, false],
  ['observed-positive-control', true, true], ['single-screen-error', true, true],
  ['failure-isolation', true, true], ['missing-evidence-inconclusive', true, true],
]) await check(`independent-${name}`, async () => {
  const source = path.join(witnessRoot, name), workflow = read(path.join(source, 'WORKFLOW.json')), suite = read(path.join(source, 'SUITE.json'));
  const report = await evaluate(`witness-${name}`, workflow, suite);
  assert.equal(report.v1Passed, expectedV1); assert.equal(report.passed, expectedV2);
  if (name === 'early-confirmation') assert.ok(report.metrics.prematureConfirmations > 0);
  return { source, sourceWorkflowSha256: hash(path.join(source, 'WORKFLOW.json')), ...aggregate(report) };
});

for (const name of ['raw-invalid-reproduction-confirmed', 'raw-invalid-screen']) await check(`independent-${name}`, async () => {
  const source = path.join(witnessRoot, name), workflow = read(path.join(source, 'WORKFLOW.json')), suite = read(path.join(source, 'SUITE.json'));
  const v1 = await evaluateV1(workflow, suite, { directory: path.join(out, `invalid-${name}-v1`) });
  assert.equal(v1.passed, true, 'Keep the original exposed false-positive behavior reproducible');
  assert.throws(() => validateFixtures(suite), { code: 'BENCHMARK_FIXTURE_SCHEMA' });
  const rejectedDirectory = path.join(out, `invalid-${name}-v2`);
  await assert.rejects(evaluateCandidate(workflow, suite, { directory: rejectedDirectory }), { code: 'BENCHMARK_FIXTURE_SCHEMA' });
  assert.equal(existsSync(rejectedDirectory), false, 'Invalid fixtures must be rejected before runtime/store creation');
  const completion = auditInstruments(suite.cases[0], read(path.join(source, 'LOG-0.json')), read(path.join(source, 'TRACE-0.json')),
    { run: read(path.join(source, 'RUN-0.json')) });
  assert.equal(completion.v1Passed, true); assert.equal(completion.passed, false); assert.ok(completion.completionErrors > 0);
  return { source, v1Passed: v1.passed, v2FixtureRejection: 'BENCHMARK_FIXTURE_SCHEMA', runtimeCreatedByV2: false,
    archivedCompletionAudit: completion, classification: 'Invalid evaluator input, excluded from candidate success denominators.' };
});

await check('overlapping-instruments-require-screen-completion', async () => {
  const source = path.join(witnessRoot, 'observed-positive-control');
  const workflow = read(path.join(source, 'WORKFLOW.json')), suite = read(path.join(source, 'SUITE.json'));
  workflow.id = 'OverlappingInstruments'; workflow.budget.maxConcurrency = 2;
  const reproduction = workflow.nodes.find(node => node.tool === 'lab.reproduce');
  reproduction.needs = [];
  workflow.nodes.find(node => node.kind === 'assert').needs.push(workflow.nodes.find(node => node.tool === 'lab.screen').id);
  const report = await evaluate('overlapping-instruments', workflow, suite);
  assert.equal(report.v1Passed, true); assert.equal(report.passed, false); assert.ok(report.metrics.evidenceOrderErrors > 0);
  return aggregate(report);
});

// These cases explicitly document a stronger possible final-publication rule.
// The default v2 confirmation gate does not retroactively impose it on v1.
for (const disposition of ['clear', 'error', 'inconclusive', 'not_reproduced']) await check(`early-${disposition}-is-diagnostic-only`, async () => {
  const sampleId = 'v2-public-sample';
  const screen = disposition === 'error' ? { error: 'SCREEN_ERROR' }
    : { returned: { sampleId, ok: true, ...(disposition === 'inconclusive' ? {} : { suspicious: disposition === 'not_reproduced' }) } };
  const reproduce = { returned: { sampleId, ok: true, independent: true, evidenceId: 'v2-public-evidence', reproduced: false } };
  const manifest = { samples: [{ sampleId, disposition }] };
  const suite = { schemaVersion: '1.0', id: `v2-early-${disposition}`, split: 'diagnostic', task: TASK,
    cases: [{ id: 'public-case', input: { samples: [{ id: sampleId }] }, fixture: { observations: { [sampleId]: { screen, reproduce } } },
      expect: { statuses: ['succeeded'], checks: [], artifacts: [{ name: 'manifest.json', json: manifest }] } }] };
  const node = (id, tool, args, needs = []) => ({ id, tool, args, needs, kind: 'task', description: 'Exposed diagnostic',
    timeoutMs: 1000, retry: { maxAttempts: 1 }, onError: 'continue', join: 'all_resolved' });
  const workflow = { schemaVersion: '1.0', id: `Early_${disposition}`, version: 1, title: 'Early non-confirmed publication',
    goal: TASK, domain: 'diagnostic', envelope: { assumptions: ['Supplied diagnostic'], risks: ['Early report'], successCriteria: ['Expose publication policy'] },
    inputSchema: INPUT_SCHEMA, budget: { maxSteps: 20, maxConcurrency: 1, maxDurationMs: 5000, maxCost: 0 },
    nodes: [node('publish', 'core.artifact', { name: 'manifest.json', content: JSON.stringify(manifest) }),
      node('screen', 'lab.screen', { sampleId }, ['publish']),
      ...(disposition === 'not_reproduced' ? [node('reproduce', 'lab.reproduce', { sampleId }, ['screen'])] : [])],
    acceptance: [{ op: 'exists', value: { $ref: 'nodes.publish.sha256' } }] };
  save(`early-${disposition}-SUITE.json`, suite);
  const report = await evaluate(`early-${disposition}`, workflow, suite);
  assert.equal(report.v1Passed, true); assert.equal(report.passed, true);
  assert.equal(report.cases[0].instrumentAudit.allProcessingBeforePublication.passed, false);
  return aggregate(report);
});

await check('forged-log-ordinals-and-event-chain-are-rejected', async () => {
  const reverse = path.join(witnessRoot, 'reproduction-before-screen');
  const item = read(path.join(reverse, 'SUITE.json')).cases[0], entries = read(path.join(reverse, 'LOG-0.json'));
  for (const entry of entries) entry.ordinal = entry.instrument === 'screen' ? 1 : 2;
  const forged = auditInstruments(item, entries, read(path.join(reverse, 'TRACE-0.json')), { run: read(path.join(reverse, 'RUN-0.json')) });
  assert.equal(forged.v1Passed, true); assert.equal(forged.passed, false); assert.ok(forged.logBindingErrors > 0);
  const positive = path.join(witnessRoot, 'observed-positive-control');
  const events = read(path.join(positive, 'TRACE-0.json'));
  events.find(event => event.type === 'node.completed').outputHash = '0'.repeat(64);
  const corrupt = auditInstruments(read(path.join(positive, 'SUITE.json')).cases[0], read(path.join(positive, 'LOG-0.json')), events);
  assert.equal(corrupt.passed, false); assert.ok(corrupt.problems.includes('event_chain_invalid'));
  return { forged, corrupt, authorityBoundary: 'Host-only copies; workflow JSON cannot replace logs or event chains.' };
});

await check('frozen-suite-and-generator-feedback-boundaries', async () => {
  assert.throws(() => makeEvaluator({ ...development, split: 'heldout' }), { code: 'HOLDOUT_LEAKAGE' });
  return { development: validateFixtures(development), sealed: validateFixtures(loadSuite('sealed')), freezeFiles: verifyFreeze().files.length };
});

await check('actual-WorkflowGenerator-with-supplied-callback', async () => {
  const foundry = new Foundry(path.join(out, 'generator'), { registry: registryFactory() });
  let callbacks = 0;
  const provider = { identity: { id: 'v2-supplied-test-callback', model: 'none', externalCalls: 0 }, async generate({ prompt }) {
    callbacks++; assert.ok(prompt.includes(TASK));
    assert.ok(!prompt.includes('sealed/SUITE.json')); assert.ok(!prompt.includes('physicalDefects'));
    return { text: JSON.stringify({ workflow: suppliedWorkflow(), rationale: 'Supplied API compatibility test; zero model synthesis.' }) };
  } };
  try {
    const request = foundry.store.createRequest({ text: TASK });
    const generator = new WorkflowGenerator(foundry, provider, { maxRounds: 1, maxDurationMs: 180000, evaluator: makeEvaluator(development) });
    const job = await generator.generate(request.id);
    assert.equal(job.status, 'proposed', JSON.stringify(job.error)); assert.equal(job.taskOutcomeQualified, true);
    assert.equal(callbacks, 1); assert.equal(job.workflowHash, digest(suppliedWorkflow()));
    return { jobId: job.id, callbacks, externalModelCalls: 0, workflowHash: job.workflowHash,
      qualification: 'Real Generator/evaluator/Runtime plumbing with supplied workflow and deterministic callback.' };
  } finally { await foundry.close(); }
});

await check('actual-TrialRunner-with-public-fixture-only', async () => {
  const registry = registryFactory({ trialCases: development.cases });
  const foundry = new Foundry(path.join(out, 'trials'), { registry,
    trialPolicy: { allowedCapabilities: registry.list().map(cap => cap.name), maxSteps: 160, maxDurationMs: 30000 } });
  try {
    const item = development.cases.find(value => value.input.samples.length > 0);
    const request = foundry.store.createRequest({ text: TASK });
    const trial = await foundry.trial({ requestId: request.id, workflow: suppliedWorkflow(), input: item.input });
    assert.equal(trial.runStatus, 'succeeded');
    const inspected = foundry.inspectTrial(trial.id);
    const manifest = read(path.join(foundry.store.directory, 'trials', trial.id, '.foundry', 'artifacts', trial.runId, 'manifest.json'));
    assert.deepEqual(manifest, item.expect.artifacts[0].json);
    const audit = auditInstruments(item, instrumentLog(registry, trial.runId), inspected.events, { run: inspected.run });
    assert.equal(audit.passed, true);
    return { trialId: trial.id, runId: trial.runId, audit, independentlyComparedActualManifest: true };
  } finally { await foundry.close(); }
});

const finalFreeze = verifyFreeze();
const audit = { schemaVersion: 'sample-consequence-calibration-v2', finishedAt: new Date().toISOString(),
  passed: results.every(result => result.passed), externalModelCalls: 0,
  positiveControlsPass: matrix.length === 8 && matrix.slice(0, 2).every(row => row.development.passed && row.sealed.passed),
  allMutantsRejected: matrix.length === 8 && matrix.slice(2).every(row => !row.development.passed && !row.sealed.passed),
  checks: results.length, checksPassed: results.filter(result => result.passed).length,
  v2FreezeSha256: hash(path.join(ROOT, 'FREEZE_V2.json')), sourceFilesUnchanged: finalFreeze.files.length,
  independentReviewSha256: freeze.independentReview.sha256, publicationPolicy: PUBLICATION_POLICY,
  matrix, results, qualification: 'Finite exposed controls and fixed provider-hidden scenarios, not population performance or learned construction.' };
save('AUDIT.json', audit);
console.log(JSON.stringify({ path: path.join(out, 'AUDIT.json'), sha256: hash(path.join(out, 'AUDIT.json')),
  passed: audit.passed, checks: audit.checks, checksPassed: audit.checksPassed, externalModelCalls: 0 }, null, 2));
if (!audit.passed) process.exitCode = 1;
