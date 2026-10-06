import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { Foundry } from '../../workflow-foundry/src/foundry.mjs';
import { WorkflowGenerator } from '../../workflow-foundry/src/generator.mjs';
import { digest } from '../../workflow-foundry/src/data.mjs';
import { registryFactory, instrumentLog } from './benchmark/capabilities.mjs';
import { makeEvaluator, evaluateCandidate, aggregate, loadSuite, verifyFreeze, auditInstruments } from './benchmark/oracle.mjs';

const root = fileURLToPath(new URL('./', import.meta.url));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const write = (directory, name, value) => writeFileSync(path.join(directory, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
const model = process.argv[2] ?? 'opencode/big-pickle';
const phase = process.argv[3] ?? 'prepare';
const publicContract = JSON.parse(readFileSync(path.join(root, 'benchmark/PUBLIC.json')));
verifyFreeze();
const calibrationPath = path.join(root, 'benchmark/calibration-001/AUDIT.json');
const calibration = JSON.parse(readFileSync(calibrationPath));
assert.ok(calibration.passed === true && calibration.positiveControlsPass === true && calibration.allMutantsRejected === true,
  'Evaluator must pass positive controls and reject every registered mutant before synthesis');
const task = [publicContract.task, 'Public contract:', JSON.stringify({
  inputSchema: publicContract.inputSchema, manifestSchema: publicContract.manifestSchema,
  rules: publicContract.rules, budget: publicContract.budget,
})].join('\n\n');
const protocol = {
  schemaVersion: 'foundry-synthesis-consequences-v1', model,
  createdAt: new Date().toISOString(), maxRounds: 3, maxGenerationDurationMs: 600000,
  providerTimeoutMs: 150000, autoApply: false,
  taskSha256: sha(task), publicContractSha256: sha(readFileSync(path.join(root, 'benchmark/PUBLIC.json'))),
  driverSha256: sha(readFileSync(fileURLToPath(import.meta.url))),
  calibrationReceiptSha256: sha(readFileSync(calibrationPath)),
  evaluation: 'Native runtime, exact manifest JSON, instrument attempt ledger, frozen researcher-authored scenarios.',
  constructionEvidence: 'Model supplies workflow JSON and rationale. Task semantics, capabilities, schema, skills and independent evaluator are supplied by researchers.',
  qualification: 'Single source-informed synthetic domain, not general goal identification, calibration or architecture invention.',
  providerVisibility: ['original objective', 'public contracts', 'actual capability descriptors', 'generic Foundry schema and skills', 'previous candidate and development evaluation only'],
  excludedFromProvider: ['sealed cases', 'sealed fixture truth', 'supplied positive workflow', 'mutants', 'oracle implementation'],
  controls: 'Evaluator independently calibrated using supplied positive and renamed/reordered equivalent graphs plus six mutants. No treatment-effect or model-scale conclusion from a single generation trajectory.',
  authority: 'Only isolated synthetic executions and run-scoped artifacts. No production deployment, external effect, account change, or automatic promotion.',
};
if (phase === 'prepare') {
  write(root, 'CAMPAIGN_PROTOCOL.json', protocol);
  console.log(JSON.stringify(protocol, null, 2));
} else if (phase === 'run') {
  const precommit = JSON.parse(readFileSync(path.join(root, 'CAMPAIGN_PROTOCOL.json')));
  for (const key of ['model', 'taskSha256', 'publicContractSha256', 'driverSha256', 'calibrationReceiptSha256']) assert.equal(protocol[key], precommit[key], `Changed precommitted ${key}`);
  const auditPath = path.join(root, 'benchmark/calibration-001/AUDIT.json');
  assert.ok(existsSync(auditPath), 'Independent evaluator calibration receipt required');
  const directory = path.join(root, 'benchmark', `campaign-${Date.now()}`);
  mkdirSync(directory, { recursive: false, mode: 0o700 });
  const { OpenCodeV2FreeProvider } = await import('../../workflow-foundry/src/opencode-v2-free.mjs');
  const provider = new OpenCodeV2FreeProvider({ model, timeoutMs: precommit.providerTimeoutMs });
  const registry = registryFactory();
  assert.equal(registry.hash(), publicContract.registryHash);
  const foundry = new Foundry(path.join(directory, 'workspace'), { registry,
    policy: { maxSteps: 160, maxConcurrency: 2, maxDurationMs: 30000, maxCost: 0 } });
  const development = loadSuite('development');
  const result = { startedAt: new Date().toISOString(), directory, provider: provider.identity,
    protocol: precommit, calibrationReceiptSha256: sha(readFileSync(auditPath)),
    stage: 'generation', success: false };
  try {
    const request = foundry.store.createAgentDesignRequest({ task });
    write(directory, 'REQUEST.json', request);
    const generator = new WorkflowGenerator(foundry, provider, {
      maxRounds: precommit.maxRounds, maxDurationMs: precommit.maxGenerationDurationMs,
      autoApply: false, evaluator: makeEvaluator(development),
    });
    const job = await generator.generate(request.id, { domain: 'general' });
    write(directory, 'GENERATION_JOB.json', job);
    result.job = { id: job.id, status: job.status, attempts: job.attempts.length, error: job.error };
    if (job.status !== 'proposed') throw new Error('NO_QUALIFIED_CANDIDATE');
    const proposal = foundry.store.proposal(job.proposalId);
    const workflow = proposal.workflow;
    write(directory, 'CANDIDATE.json', workflow);
    write(directory, 'CANDIDATE_FREEZE.json', { frozenAt: new Date().toISOString(), workflowHash: digest(workflow),
      workflowBytesSha256: sha(readFileSync(path.join(directory, 'CANDIDATE.json'))), requestId: request.id,
      proposalId: proposal.id, generationJobId: job.id, noSealedEvaluationBeforeThisReceipt: true });
    result.stage = 'sealed-evaluation';
    const sealed = await evaluateCandidate(workflow, loadSuite('sealed'), { directory: path.join(directory, 'sealed') });
    write(directory, 'SEALED_AGGREGATE.json', aggregate(sealed));
    result.sealed = aggregate(sealed);
    foundry.store.recordQualification(sealed);
    if (!sealed.passed) throw new Error('SEALED_CONSEQUENCES_FAILED');
    // Explicit host promotion only to this disposable, synthetic local workspace.
    write(directory, 'LOCAL_PROMOTION.json', { at: new Date().toISOString(), proposalId: proposal.id,
      workflowHash: proposal.workflowHash, basis: ['development and sealed enumerated consequence checks'],
      authority: 'Research-only isolated synthetic execution; no deployment or human approval claimed.' });
    foundry.apply(proposal.id);
    const sample = development.cases.find(item => item.input.samples.length > 0);
    assert.ok(sample);
    const created = foundry.runtime.create(workflow, sample.input, { fixture: sample.fixture });
    const run = await foundry.startRun(created.id);
    const events = foundry.store.events(run.id);
    const actual = JSON.parse(readFileSync(path.join(foundry.store.directory, 'artifacts', run.id, 'manifest.json'), 'utf8'));
    const expected = sample.expect.artifacts.find(artifact => artifact.name === 'manifest.json').json;
    assert.deepEqual(actual, expected);
    const calls = instrumentLog(registry, run.id), audit = auditInstruments(sample, calls, events);
    assert.ok(audit.passed);
    const delivery = foundry.delivery({ requestId: request.id, proposalId: proposal.id, runId: run.id });
    assert.equal(delivery.independentTaskVerified, false, 'Local and scoped evidence must remain separate');
    write(directory, 'APPLIED_RUN.json', { run, events, calls, audit, actual, expected, delivery });
    result.stage = 'completed-bounded-synthesis-and-execution';
    result.success = true;
    result.workflowHash = proposal.workflowHash;
    result.workflowId = workflow.id;
    result.requestId = request.id;
    result.proposalId = proposal.id;
    result.runId = run.id;
    result.outcomeRepairNotYetTested = true;
  } catch (error) {
    result.error = { name: error.name, code: error.code ?? null, message: error.message };
  } finally {
    result.finishedAt = new Date().toISOString();
    write(directory, 'RESULTS.json', result);
    await foundry.close();
  }
  console.log(JSON.stringify(result, null, 2));
  if (!result.success) process.exitCode = 1;
} else {
  throw new Error('Use prepare or run');
}
