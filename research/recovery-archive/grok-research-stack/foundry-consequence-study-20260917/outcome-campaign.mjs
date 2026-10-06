import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { Foundry } from '../../workflow-foundry/src/foundry.mjs';
import { WorkflowGenerator } from '../../workflow-foundry/src/generator.mjs';
import { OutcomeRepairCoordinator } from '../../workflow-foundry/src/outcome-repair.mjs';
import { digest, clone } from '../../workflow-foundry/src/data.mjs';
import { registryFactory, instrumentLog } from './benchmark/capabilities.mjs';
import { TASK, RULES, MANIFEST_SCHEMA, PUBLIC_BUDGET } from './benchmark/contract.mjs';
import { loadSuite, makeEvaluator, evaluateCandidate, aggregate, verifyFreeze, auditInstruments, PUBLIC_V2_RULES } from './benchmark/oracle-v2.mjs';
import { CosRelayProvider } from './relay-provider.mjs';

// A controlled fault injected into an actual model-authored construction.
// This is NOT a naturally occurring model mistake or a new objective benchmark.
const root = fileURLToPath(new URL('./', import.meta.url));
const directory = path.join(root, 'benchmark/outcome-model-001');
const file = name => path.join(directory, name);
const read = name => JSON.parse(readFileSync(file(name), 'utf8'));
const sha = value => createHash('sha256').update(value).digest('hex');
const write = (name, value) => writeFileSync(file(name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
const source = path.join(root, 'benchmark/campaign-cos-001/CANDIDATE.json');
const policy = { maxSteps: PUBLIC_BUDGET.maxStepsPerRun, maxConcurrency: PUBLIC_BUDGET.maxConcurrency,
  maxDurationMs: PUBLIC_BUDGET.maxDurationMs, maxCost: PUBLIC_BUDGET.maxCost };
const dependencies = [fileURLToPath(import.meta.url), path.join(root, 'relay-provider.mjs'), source,
  path.resolve(root, '../../workflow-foundry/src/outcome-repair.mjs'),
  path.resolve(root, '../../workflow-foundry/skills/human-steering/SKILL.md'),
  path.join(root, 'benchmark/FREEZE_V2.json')];
const protocol = () => ({ schemaVersion: 'outcome-model-repair-control/1',
  author: 'worker-5', model: '6', reasoningEffort: 'pro', maxRounds: 2, maxDurationMs: 900000,
  runtimePolicy: policy, artifactName: 'manifest.json', developmentObservation: 'dev-basic',
  candidateOrigin: 'Exact actual COS-authored candidate from campaign-cos-001; original bytes retained.',
  fault: { path: '/nodes/0/body/nodes/6/args/disposition', before: 'confirmed', after: 'inconclusive',
    origin: 'Researcher-injected single-leaf defect. No claim of a natural model error.' },
  feedback: 'Host-registered development expected JSON, preserved observed bytes, bounded differences and current faulty workflow. No sealed scenarios.',
  modelContinuity: 'Same original builder retains its prior construction context. Restoration may use that memory; this is not evidence-only novel diagnosis.',
  authority: 'Explicit host execution of local synthetic instruments and isolated artifact writes. No external effects or deployment.',
  qualification: 'One actual model repair plus fixed development and provider-withheld regression scenarios, not population generalization, learning, or cheap-model performance.',
  sourceHashes: dependencies.map(p => ({ path: p, sha256: sha(readFileSync(p)) })) });
function checkProtocol() {
  verifyFreeze();
  const frozen = read('PROTOCOL.json');
  assert.deepEqual(protocol(), frozen.configuration, 'Entire frozen configuration must agree');
  assert.equal(frozen.configurationSha256, digest(frozen.configuration));
  return frozen.configuration;
}
function artifact(f, run) {
  const bytes = readFileSync(path.join(f.store.directory, 'artifacts', run.id, 'manifest.json'));
  const text = bytes.toString('utf8');
  return { manifest: JSON.parse(text), text, sha256: sha(bytes), bytes: bytes.length,
    argsHash: digest({ name: 'manifest.json', content: text }) };
}
function checkedRun(f, run, sample, registry) {
  assert.equal(run.status, 'succeeded', 'Applied native execution must actually succeed');
  const events = f.store.events(run.id), actual = artifact(f, run), calls = instrumentLog(registry, run.id);
  const audit = auditInstruments(sample, calls, events, { run, artifact: actual });
  return { run, events, artifact: actual, calls, audit };
}
function faultCandidate(original) {
  const faulty = clone(original);
  const target = faulty.nodes[0].body.nodes[6];
  assert.equal(target.id, 'confirmedRow'); assert.equal(target.args.disposition, 'confirmed');
  target.args.disposition = 'inconclusive';
  const restored = clone(faulty); restored.nodes[0].body.nodes[6].args.disposition = 'confirmed';
  assert.deepEqual(restored, original, 'Fault must alter exactly one scalar, including unchanged acceptance and goal');
  return faulty;
}

const phase = process.argv[2] ?? 'prepare';
if (phase === 'prepare') {
  verifyFreeze();
  mkdirSync(directory, { recursive: false, mode: 0o700 });
  mkdirSync(file('packet'), { mode: 0o700 });
  const configuration = protocol();
  write('PROTOCOL.json', { frozenAt: new Date().toISOString(), configuration, configurationSha256: digest(configuration) });
  const original = JSON.parse(readFileSync(source, 'utf8')), faulty = faultCandidate(original);
  write('ORIGINAL_MODEL_CANDIDATE.json', original); write('FAULTY_CANDIDATE.json', faulty);
  const registry = registryFactory(), f = new Foundry(file('workspace'), { registry, policy });
  try {
    assert.ok(f.validate(faulty).valid);
    const text = `${TASK}\n\nPublic semantic rules:\n${RULES.join('\n')}\n\nPublication rules:\n${PUBLIC_V2_RULES.join('\n')}\n\nRequired manifest schema:\n${JSON.stringify(MANIFEST_SCHEMA)}\n\nBudget:\n${JSON.stringify(PUBLIC_BUDGET)}`;
    const request = f.store.createRequest({ text, source: 'host-local-fault-control' });
    const sample = loadSuite('development').cases.find(c => c.id === configuration.developmentObservation);
    assert.ok(sample);
    const outcomes = new OutcomeRepairCoordinator(f);
    const contract = outcomes.registerContract({ requestId: request.id, input: sample.input,
      artifactName: 'manifest.json', expected: sample.expect.artifacts.find(x => x.name === 'manifest.json').json,
      evaluatorId: 'frozen-development-manifest/1' });
    // The expected outcome is registered before execution, not inferred from the faulty output.
    write('CONTRACT.json', contract); write('DEVELOPMENT_CASE.json', sample);
    const proposal = f.propose({ requestId: request.id, workflow: faulty,
      rationale: 'Host-injected one-field fault in an otherwise exact model construction; explicit research control, not a model-authored new solution.' });
    f.apply(proposal.id);
    const run = await f.startRun(f.runtime.create(faulty, sample.input, { fixture: sample.fixture }).id);
    const execution = checkedRun(f, run, sample, registry);
    assert.ok(execution.audit.passed, 'Instruments and publication still correctly bound');
    assert.notDeepEqual(execution.artifact.manifest, contract.expected, 'Fault must cause a real wrong artifact');
    const observation = outcomes.observe({ requestId: request.id, proposalId: proposal.id, runId: run.id, contractId: contract.id });
    assert.equal(observation.outcome, 'unsatisfied');
    assert.equal(observation.binding.runStatus, 'succeeded');
    const repair = outcomes.requestRepair({ receiptId: observation.id, requestId: request.id,
      runId: run.id, expectedHash: proposal.workflowHash,
      diagnostic: 'The host observation found an incorrect required artifact despite successful execution. Use the bound comparison; preserve the objective and other cases.' });
    assert.equal(repair.text, request.text); assert.equal(repair.rootRequestId, request.id);
    assert.equal(repair.failedRunId, undefined);
    const context = outcomes.designContext({ requestId: repair.id });
    assert.deepEqual(context.outcomeRepair.comparison.expected.value, contract.expected);
    assert.deepEqual(context.outcomeRepair.comparison.observed.value, execution.artifact.manifest);
    write('INITIAL_REQUEST.json', request); write('FAULT_PROPOSAL.json', proposal);
    write('WRONG_EXECUTION.json', execution); write('WRONG_OBSERVATION.json', observation);
    write('REPAIR_REQUEST.json', repair); write('REPAIR_CONTEXT.json', context);
    write('READY.json', { readyAt: new Date().toISOString(), requestId: request.id, repairId: repair.id,
      workflowHash: proposal.workflowHash, originalWorkflowHash: digest(original), runId: run.id,
      contractId: contract.id, observationId: observation.id,
      runtimeStatus: run.status, outcome: observation.outcome,
      artifactSha256: execution.artifact.sha256, externalCalls: 0, actualModelRepair: 'not-started' });
    console.log(JSON.stringify({ phase, directory, ...read('READY.json') }, null, 2));
  } finally { await f.close(); }
} else if (phase === 'run') {
  const configuration = checkProtocol(), ready = read('READY.json');
  const registry = registryFactory(), f = new Foundry(file('workspace'), { registry, policy });
  const result = { startedAt: new Date().toISOString(), success: false, stage: 'generation', qualification: configuration.qualification };
  try {
    const outcomes = new OutcomeRepairCoordinator(f), originalObservation = outcomes.verify(ready.observationId);
    assert.equal(originalObservation.outcome, 'unsatisfied');
    const provider = new CosRelayProvider({ packet: file('packet'), author: configuration.author });
    const generator = new WorkflowGenerator(outcomes.generationHost(), provider, {
      maxRounds: configuration.maxRounds, maxDurationMs: configuration.maxDurationMs,
      autoApply: false, evaluator: makeEvaluator(loadSuite('development')) });
    const job = await generator.generate(ready.repairId, { domain: 'general' });
    write('GENERATION_JOB.json', job);
    result.job = { id: job.id, status: job.status, attempts: job.attempts.length, error: job.error ?? null };
    assert.equal(job.status, 'proposed', 'No actual model candidate qualified');
    const proposal = f.store.proposal(job.proposalId), candidate = proposal.workflow;
    write('REPAIRED_CANDIDATE.json', candidate);
    write('CANDIDATE_FREEZE.json', { frozenAt: new Date().toISOString(), workflowHash: digest(candidate),
      byteHash: sha(readFileSync(file('REPAIRED_CANDIDATE.json'))), proposalId: proposal.id,
      requestId: ready.repairId, beforeSealedEvaluation: true });
    assert.equal(candidate.id, read('FAULTY_CANDIDATE.json').id); assert.equal(candidate.version, 2);
    result.stage = 'withheld-regression';
    const sealed = await evaluateCandidate(candidate, loadSuite('sealed'), { directory: file('sealed') });
    write('SEALED_AGGREGATE.json', aggregate(sealed)); f.store.recordQualification(sealed);
    result.sealed = aggregate(sealed);
    assert.ok(sealed.passed, 'Withheld regression consequences failed');
    const mutantDevelopment = await evaluateCandidate(read('FAULTY_CANDIDATE.json'), loadSuite('development'), { directory: file('mutant-development') });
    const mutantSealed = await evaluateCandidate(read('FAULTY_CANDIDATE.json'), loadSuite('sealed'), { directory: file('mutant-sealed') });
    write('MUTANT_DEVELOPMENT_AGGREGATE.json', aggregate(mutantDevelopment));
    write('MUTANT_SEALED_AGGREGATE.json', aggregate(mutantSealed));
    assert.equal(mutantDevelopment.passed, false); assert.equal(mutantSealed.passed, false);
    result.mutant = { development: aggregate(mutantDevelopment), sealed: aggregate(mutantSealed) };
    checkProtocol();
    write('LOCAL_PROMOTION.json', { at: new Date().toISOString(), proposalId: proposal.id,
      workflowHash: proposal.workflowHash, authority: configuration.authority });
    outcomes.apply(proposal.id);
    const sample = read('DEVELOPMENT_CASE.json');
    const run = await f.startRun(f.runtime.create(candidate, sample.input, { fixture: sample.fixture }).id);
    const execution = checkedRun(f, run, sample, registry);
    assert.ok(execution.audit.passed); assert.deepEqual(execution.artifact.manifest, outcomes.contract(ready.contractId).expected);
    const observation = outcomes.observe({ requestId: ready.repairId, proposalId: proposal.id, runId: run.id, contractId: ready.contractId });
    assert.equal(observation.outcome, 'satisfied');
    assert.deepEqual(outcomes.verify(ready.observationId), originalObservation, 'Prior evidence must remain byte-for-byte historically valid');
    assert.equal(f.store.run(ready.runId).status, 'succeeded', 'Never relabel the earlier green run');
    const delivery = f.delivery({ requestId: ready.repairId, proposalId: proposal.id, runId: run.id });
    assert.equal(delivery.independentTaskVerified, false);
    write('REPAIRED_EXECUTION.json', execution); write('SATISFIED_OBSERVATION.json', observation); write('DELIVERY.json', delivery);
    Object.assign(result, { success: true, stage: 'observed-model-repair-and-native-reexecution',
      requestId: ready.requestId, repairRequestId: ready.repairId, proposalId: proposal.id,
      workflowHash: proposal.workflowHash, runId: run.id, contractId: ready.contractId,
      initialStatus: 'succeeded', initialOutcome: 'unsatisfied', finalStatus: run.status, finalOutcome: observation.outcome,
      preservedWrongArtifact: true, modelAttribution: configuration.modelContinuity });
  } catch (error) {
    result.error = { name: error.name, code: error.code ?? null, message: error.message };
  } finally {
    result.finishedAt = new Date().toISOString(); write('RESULTS.json', result); await f.close();
  }
  console.log(JSON.stringify(result, null, 2)); if (!result.success) process.exitCode = 1;
} else throw new Error('Use prepare or run; each phase is write-once');
