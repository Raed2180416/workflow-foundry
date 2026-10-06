import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { Foundry } from '../../workflow-foundry/src/foundry.mjs';
import { WorkflowGenerator } from '../../workflow-foundry/src/generator.mjs';
import { digest } from '../../workflow-foundry/src/data.mjs';
import { registryFactory, instrumentLog } from './benchmark/capabilities.mjs';
import { loadSuite, auditInstruments } from './benchmark/oracle.mjs';
import { CosRelayProvider } from './relay-provider.mjs';

const root = fileURLToPath(new URL('./', import.meta.url));
const directory = path.join(root, 'benchmark/campaign-cos-001');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const write = (name, value) => writeFileSync(path.join(directory, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
const phase = process.argv[2] ?? 'prepare';
const protocol = {
  createdAt: new Date().toISOString(), schemaVersion: 'cos-construction-control-v1',
  model: '6', reasoningEffort: 'pro', author: 'worker-5', maxRounds: 3, maxDurationMs: 900000,
  packetFreezeSha256: sha(readFileSync(path.join(directory, 'PACKET_FREEZE.json'))),
  driverSha256: sha(readFileSync(fileURLToPath(import.meta.url))),
  relaySha256: sha(readFileSync(path.join(root, 'relay-provider.mjs'))),
  evaluationRevision: 'Additive oracle-v2, commissioned from independent pre-generation witnesses; original v1 preserved.',
  hiddenness: 'Constructor restricted to exact packet by instruction; has COS filesystem tools. Procedural withholding, not OS isolation.',
  contribution: 'Actual COS model authors workflow. Researchers supply semantics, schema, generic capabilities, development oracle, hidden scenarios and tool mediation.',
  nonclaims: ['No cheap-model or Jev performance claim', 'No autonomous learning claim', 'No population/general process-engineering qualification', 'No provider token/cost accounting'],
  gates: ['v2 evaluator calibration and source freeze before evaluation', 'native validation', 'development consequences', 'candidate freeze before sealed evaluation', 'explicit isolated promotion', 'actual artifact and instrument checks'],
};
if (phase === 'prepare') {
  write('PROTOCOL.json', protocol);
  console.log(JSON.stringify(protocol, null, 2));
} else if (phase === 'run') {
  const frozen = JSON.parse(readFileSync(path.join(directory, 'PROTOCOL.json')));
  for (const key of ['packetFreezeSha256', 'driverSha256', 'relaySha256']) assert.equal(protocol[key], frozen[key]);
  const { makeEvaluator, evaluateCandidate, aggregate, verifyFreeze } = await import('./benchmark/oracle-v2.mjs');
  verifyFreeze();
  const request = JSON.parse(readFileSync(path.join(directory, 'REQUEST.json')));
  const provider = new CosRelayProvider({ packet: path.join(directory, 'packet') });
  const registry = registryFactory();
  const f = new Foundry(path.join(directory, 'workspace'), { registry,
    policy: { maxSteps: 160, maxConcurrency: 2, maxDurationMs: 30000, maxCost: 0 } });
  const result = { startedAt: new Date().toISOString(), stage: 'generation', success: false, protocol: frozen, provider: provider.identity };
  try {
    const generator = new WorkflowGenerator(f, provider, { maxRounds: frozen.maxRounds,
      maxDurationMs: frozen.maxDurationMs, autoApply: false, evaluator: makeEvaluator(loadSuite('development')) });
    const job = await generator.generate(request.id, { domain: 'general' });
    write('GENERATION_JOB.json', job);
    result.job = { id: job.id, status: job.status, attempts: job.attempts.length, error: job.error ?? null };
    if (job.status !== 'proposed') throw new Error('NO_QUALIFIED_CANDIDATE');
    const proposal = f.store.proposal(job.proposalId), workflow = proposal.workflow;
    write('CANDIDATE.json', workflow);
    write('CANDIDATE_FREEZE.json', { at: new Date().toISOString(), workflowHash: digest(workflow),
      candidateBytesSha256: sha(readFileSync(path.join(directory, 'CANDIDATE.json'))), proposalId: proposal.id,
      requestId: request.id, generationJobId: job.id, beforeSealedEvaluation: true });
    result.stage = 'sealed-evaluation';
    const sealed = await evaluateCandidate(workflow, loadSuite('sealed'), { directory: path.join(directory, 'sealed') });
    write('SEALED_AGGREGATE.json', aggregate(sealed));
    result.sealed = aggregate(sealed);
    f.store.recordQualification(sealed);
    if (!sealed.passed) throw new Error('SEALED_CONSEQUENCES_FAILED');
    write('LOCAL_PROMOTION.json', { at: new Date().toISOString(), proposalId: proposal.id,
      workflowHash: proposal.workflowHash, authority: 'Host-authored research-only synthetic execution, not production deployment or human review claim.' });
    f.apply(proposal.id);
    const development = loadSuite('development'), sample = development.cases.find(item => item.input.samples.length > 0);
    const created = f.runtime.create(workflow, sample.input, { fixture: sample.fixture });
    const run = await f.startRun(created.id), events = f.store.events(run.id);
    const actual = JSON.parse(readFileSync(path.join(f.store.directory, 'artifacts', run.id, 'manifest.json'), 'utf8'));
    const expected = sample.expect.artifacts.find(item => item.name === 'manifest.json').json;
    assert.deepEqual(actual, expected);
    const calls = instrumentLog(registry, run.id), audit = auditInstruments(sample, calls, events);
    assert.ok(audit.passed);
    const delivery = f.delivery({ requestId: request.id, proposalId: proposal.id, runId: run.id });
    assert.equal(delivery.independentTaskVerified, false);
    write('APPLIED_RUN.json', { run, events, actual, expected, calls, audit, delivery });
    Object.assign(result, { success: true, stage: 'bounded-model-construction-and-execution', workflowHash: proposal.workflowHash,
      workflowId: workflow.id, requestId: request.id, proposalId: proposal.id, runId: run.id });
  } catch (error) {
    result.error = { name: error.name, code: error.code ?? null, message: error.message };
  } finally {
    result.finishedAt = new Date().toISOString();
    write('RESULTS.json', result);
    await f.close();
  }
  console.log(JSON.stringify(result, null, 2));
  if (!result.success) process.exitCode = 1;
} else throw new Error('Use prepare or run');
