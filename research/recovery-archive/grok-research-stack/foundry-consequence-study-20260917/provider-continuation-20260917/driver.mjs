// Study driver. Import/prepare/check do not instantiate a provider or read suites.
// Only an explicitly invoked run with the reviewed protocol hash can dispatch.
import { readFileSync, writeFileSync, readdirSync, mkdirSync, lstatSync, openSync, fstatSync, readSync, closeSync, constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { digest } from '/home/raed/Projects/workflow-foundry/src/data.mjs';

export const ROOT = path.dirname(fileURLToPath(import.meta.url));
const STUDY = path.dirname(ROOT), BENCHMARK = path.join(STUDY, 'benchmark');
const REPO = '/home/raed/Projects/workflow-foundry';
export const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const json = file => JSON.parse(readFileSync(file, 'utf8'));
const write = (directory, name, value) => writeFileSync(path.join(directory, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
const errorData = error => ({ code: error.code ?? 'CAMPAIGN_FAILED', message: error.message });
const CONFIG_TEXT = JSON.stringify({
  model: 'opencode/big-pickle', providerTimeoutMs: 150000, maxOutputTokens: 8192,
  maxRounds: 2, maxDurationMs: 360000, autoApply: false, domain: 'general',
  policy: { maxSteps: 160, maxConcurrency: 2, maxDurationMs: 30000, maxCost: 0 },
  evaluation: { revision: 'v2', developmentCases: 5, withheldCases: 8, appliedCase: 'first-nonempty-development',
    publicTask: 'unchanged-v1-public-contract', allProcessingBeforePublication: 'non-gating-diagnostic' },
  providerErrors: 'stop; no retry or paid/model fallback', tools: 'output-only provider; native synthetic runtime',
  authority: 'explicit research-only apply after both suites pass',
  visibility: 'public task/schema/capabilities/skills and development feedback only; withheld outcomes never repair input',
  qualification: 'one bounded construction trajectory; unknown model scale; no matched model comparison or general task-success claim',
});
export const configuration = () => JSON.parse(CONFIG_TEXT);
export function publicTask() {
  const p = json(path.join(BENCHMARK, 'PUBLIC.json'));
  return [p.task, 'Public contract:', JSON.stringify({ inputSchema: p.inputSchema, manifestSchema: p.manifestSchema, rules: p.rules, budget: p.budget })].join('\n\n');
}
export function makeProtocol(frozenAt) {
  const sources = ['driver.mjs', 'driver.test.mjs'].map(name => path.join(ROOT, name));
  sources.push(...['foundry', 'generator', 'data', 'dataflow', 'engine', 'evaluation', 'runtime', 'store', 'trials', 'validate', 'capabilities', 'process', 'opencode-v2-free'].map(name => path.join(REPO, `src/${name}.mjs`)));
  sources.push(...['package.json', 'package-lock.json', 'schemas/workflow.schema.json'].map(name => path.join(REPO, name)));
  for (const item of readdirSync(path.join(REPO, 'skills'), { withFileTypes: true }).filter(item => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) sources.push(path.join(REPO, 'skills', item.name, 'SKILL.md'));
  sources.push(...['PUBLIC.json', 'contract.mjs', 'capabilities.mjs', 'oracle.mjs', 'oracle-v2.mjs', 'FREEZE.json', 'FREEZE_V2.json', 'calibration-v2-001/run-001/AUDIT.json'].map(name => path.join(BENCHMARK, name)));
  sources.push('/usr/bin/opencode');
  const calibration = json(path.join(BENCHMARK, 'calibration-v2-001/run-001/AUDIT.json'));
  assert.equal(calibration.passed, true); assert.equal(calibration.positiveControlsPass, true); assert.equal(calibration.allMutantsRejected, true);
  assert.equal(calibration.checks, 18); assert.equal(calibration.checksPassed, 18);
  return { schemaVersion: 'opencode-consequence-continuation-v1', frozenAt, nodeVersion: process.version, platform: process.platform, architecture: process.arch,
    configuration: configuration(), directory: path.join(BENCHMARK, 'campaign-opencode-v2-continuation-001'), taskSHA256: sha(publicTask()),
    calibration: { checks: 18, passed: 18 }, sources: sources.map(file => ({ file, sha256: sha(readFileSync(file)) })),
    authorization: 'Await prime review and separate run instruction. Protocol hash binds bytes; it is not authentication of the operator.' };
}
export function compareProtocol(raw, reviewedSHA256, current) {
  assert.match(reviewedSHA256 ?? '', /^[0-9a-f]{64}$/, 'A reviewed complete protocol SHA256 is required');
  assert.equal(sha(raw), reviewedSHA256, 'The reviewed protocol bytes changed');
  const frozen = JSON.parse(raw); assert.deepEqual(frozen, current, 'Complete frozen configuration/source identity differs'); return frozen;
}
function checkedProtocol(reviewedSHA256) {
  const raw = readFileSync(path.join(ROOT, 'PROTOCOL.json')), frozen = JSON.parse(raw);
  return compareProtocol(raw, reviewedSHA256, makeProtocol(frozen.frozenAt));
}
export function readArtifact(storeDirectory, runId) {
  assert.match(runId, /^[A-Za-z0-9_-]+$/);
  let file = storeDirectory;
  for (const [index, part] of ['artifacts', runId, 'manifest.json'].entries()) {
    file = path.join(file, part); const stat = lstatSync(file);
    assert.ok(!stat.isSymbolicLink() && (index < 2 ? stat.isDirectory() : stat.isFile()), 'Invalid artifact path');
  }
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    assert.ok(fstatSync(fd).size <= 512 * 1024, 'Artifact exceeds 512 KiB');
    const buffer = Buffer.alloc(512 * 1024 + 1); let size = 0, got;
    while (size < buffer.length && (got = readSync(fd, buffer, size, buffer.length - size, null))) size += got;
    assert.ok(size <= 512 * 1024, 'Artifact grew beyond bound');
    const raw = buffer.subarray(0, size), text = raw.toString('utf8');
    return { manifest: JSON.parse(text), text, sha256: sha(raw), bytes: size, argsHash: digest({ name: 'manifest.json', content: text }) };
  } finally { closeSync(fd); }
}
export function requireApplied({ workflow, proposal, requestId, registryHash, engineHash, run, events, artifact, expected, expectedInput, audit, delivery }) {
  assert.equal(run.status, 'succeeded'); assert.equal(delivery.status, 'succeeded'); assert.equal(delivery.localExecutionSucceeded, true);
  const workflowHash = digest(workflow);
  for (const value of [proposal.workflowHash, run.workflowHash, delivery.workflowHash]) assert.equal(value, workflowHash);
  assert.equal(digest(proposal.workflow), workflowHash); assert.equal(run.workflowId, workflow.id); assert.equal(delivery.workflowId, workflow.id); assert.equal(delivery.workflowVersion, workflow.version);
  assert.equal(proposal.requestId, requestId); assert.equal(proposal.status, 'applied');
  assert.equal(delivery.requestId, requestId); assert.equal(delivery.proposalId, proposal.id); assert.equal(delivery.runId, run.id);
  assert.equal(run.registryHash, registryHash); assert.equal(delivery.registryHash, registryHash); assert.equal(run.engineHash, engineHash);
  assert.deepEqual(run.input, expectedInput); assert.equal(delivery.inputHash, digest(run.input)); assert.equal(events[0]?.inputHash, digest(run.input));
  assert.equal(run.eventHead.seq, events.length); assert.equal(run.eventHead.hash, events.at(-1)?.hash); assert.deepEqual(delivery.eventHead, run.eventHead);
  assert.equal(delivery.eventCount, events.length); assert.deepEqual(artifact.manifest, expected);
  assert.deepEqual(JSON.parse(artifact.text), artifact.manifest); assert.equal(sha(Buffer.from(artifact.text)), artifact.sha256); assert.equal(Buffer.byteLength(artifact.text), artifact.bytes);
  assert.equal(artifact.argsHash, digest({ name: 'manifest.json', content: artifact.text }));
  assert.equal(audit.publicationContentBasis, 'independently-read-actual-artifact'); assert.equal(audit.passed, true);
  assert.equal(delivery.independentTaskVerified, false); return true;
}
export function trackedProvider(base, beforeCall, limit = 2) {
  const calls = [], pending = []; let stopped = false, closed = false;
  const provider = { identity: base.identity, generate(args) {
    assert.ok(!closed && !stopped && calls.length < limit, 'No provider dispatch after closure/error or over budget');
    beforeCall(); const call = { number: calls.length + 1, promptSHA256: sha(args.prompt), promptBytes: Buffer.byteLength(args.prompt) }; calls.push(call);
    const work = (async () => {
      try {
        const response = await base.generate(args); call.evidence = response.evidence;
        assert.equal(response.evidence.model, base.identity.model); assert.equal(response.evidence.reportedCost, 0);
        assert.equal(response.evidence.promptSHA256, call.promptSHA256); assert.equal(response.evidence.outputSHA256, sha(response.text));
        assert.equal(response.evidence.transport.forwarded, 1); assert.equal(response.evidence.transport.completed, 1);
        call.status = 'completed'; return response;
      } catch (error) {
        stopped = true; Object.assign(call, { status: 'failed', error: errorData(error), receipts: error.receipts ?? null });
        if (error.receipts) { try { call.transport = json(path.join(error.receipts, 'transport.json')); } catch { call.transport = null; } }
        throw error;
      }
    })(); pending.push(work); return work;
  } };
  return { provider, calls, close: async () => { closed = true; await Promise.allSettled(pending); } };
}
export async function runCampaign(reviewedSHA256, { signal } = {}) {
  const protocol = checkedProtocol(reviewedSHA256), config = protocol.configuration, directory = protocol.directory;
  // v2 output must be under benchmark/. Exclusive creation prevents replay into old evidence.
  assert.equal(path.dirname(directory), BENCHMARK); mkdirSync(directory, { mode: 0o700 });
  const result = { startedAt: new Date().toISOString(), success: false, stage: 'preflight', protocolSHA256: reviewedSHA256, protocol };
  let foundry, tracked;
  try {
    const { Foundry } = await import(`${REPO}/src/foundry.mjs`), { WorkflowGenerator } = await import(`${REPO}/src/generator.mjs`);
    const { OpenCodeV2FreeProvider } = await import(`${REPO}/src/opencode-v2-free.mjs`), { engineHash } = await import(`${REPO}/src/engine.mjs`);
    const { registryFactory, instrumentLog } = await import('../benchmark/capabilities.mjs');
    const oracle = await import('../benchmark/oracle-v2.mjs'); oracle.verifyFreeze();
    const registry = registryFactory(), publicContract = json(path.join(BENCHMARK, 'PUBLIC.json'));
    assert.equal(registry.hash(), publicContract.registryHash);
    const base = new OpenCodeV2FreeProvider({ model: config.model, timeoutMs: config.providerTimeoutMs, maxOutputTokens: config.maxOutputTokens });
    tracked = trackedProvider(base, () => { assert.ok(!signal?.aborted, 'Cancelled'); checkedProtocol(reviewedSHA256); }, config.maxRounds);
    result.provider = base.identity;
    foundry = new Foundry(path.join(directory, 'workspace'), { registry, policy: config.policy });
    const request = foundry.store.createAgentDesignRequest({ task: publicTask() }); write(directory, 'REQUEST.json', request);
    const development = oracle.loadSuite('development'); assert.equal(development.cases.length, config.evaluation.developmentCases);
    const generator = new WorkflowGenerator(foundry, tracked.provider, { maxRounds: config.maxRounds, maxDurationMs: config.maxDurationMs, autoApply: config.autoApply, evaluator: oracle.makeEvaluator(development) });
    result.stage = 'generation';
    const job = await generator.generate(request.id, { domain: config.domain, signal }); await tracked.close(); write(directory, 'GENERATION_JOB.json', job);
    result.job = { id: job.id, status: job.status, attempts: job.attempts.length, error: job.error ?? null };
    if (job.status !== 'proposed') throw Object.assign(new Error(job.error?.message ?? 'NO_QUALIFIED_CANDIDATE'), { code: job.error?.code ?? 'NO_QUALIFIED_CANDIDATE' });
    const proposal = foundry.store.proposal(job.proposalId), workflow = proposal.workflow, workflowHash = digest(workflow);
    assert.equal(job.workflowHash, workflowHash); assert.equal(proposal.workflowHash, workflowHash); assert.equal(proposal.requestId, request.id);
    write(directory, 'CANDIDATE.json', workflow);
    write(directory, 'CANDIDATE_FREEZE.json', { at: new Date().toISOString(), workflowHash, bytesSHA256: sha(readFileSync(path.join(directory, 'CANDIDATE.json'))),
      requestId: request.id, proposalId: proposal.id, generationJobId: job.id, protocolSHA256: reviewedSHA256, beforeWithheldEvaluation: true });
    checkedProtocol(reviewedSHA256); result.stage = 'withheld-evaluation';
    const withheld = oracle.loadSuite('sealed'); assert.equal(withheld.cases.length, config.evaluation.withheldCases);
    const sealed = await oracle.evaluateCandidate(workflow, withheld, { directory: path.join(directory, 'sealed'), signal });
    write(directory, 'SEALED_AGGREGATE.json', oracle.aggregate(sealed)); result.sealed = oracle.aggregate(sealed);
    assert.equal(sealed.workflowHash, workflowHash); assert.equal(sealed.registryHash, registry.hash()); assert.equal(sealed.passed, true);
    assert.equal(sealed.cases.length, config.evaluation.withheldCases); assert.ok(sealed.cases.every(item => item.passed && item.status === 'succeeded'));
    foundry.store.recordQualification(sealed);
    write(directory, 'LOCAL_PROMOTION.json', { at: new Date().toISOString(), requestId: request.id, proposalId: proposal.id, workflowHash, authority: config.authority });
    assert.ok(!signal?.aborted, 'Cancelled before apply'); foundry.apply(proposal.id); result.stage = 'applied-run';
    const sample = development.cases.find(item => item.input.samples.length > 0); assert.ok(sample);
    const created = foundry.runtime.create(workflow, sample.input, { fixture: sample.fixture });
    assert.equal((await foundry.startRun(created.id, { signal })).status, 'succeeded');
    const run = foundry.store.run(created.id), events = foundry.store.events(run.id), artifact = readArtifact(foundry.store.directory, run.id);
    const calls = instrumentLog(registry, run.id), audit = oracle.auditInstruments(sample, calls, events, { run, artifact });
    const delivery = foundry.delivery({ requestId: request.id, proposalId: proposal.id, runId: run.id });
    const evidence = { workflow, proposal: foundry.store.proposal(proposal.id), requestId: request.id, registryHash: registry.hash(), engineHash, run, events,
      artifact, expected: sample.expect.artifacts.find(item => item.name === 'manifest.json').json, expectedInput: sample.input, audit, delivery };
    write(directory, 'APPLIED_RUN.json', { ...evidence, calls }); requireApplied(evidence); checkedProtocol(reviewedSHA256);
    Object.assign(result, { success: true, stage: 'bounded-construction-and-execution', requestId: request.id, proposalId: proposal.id, runId: run.id, workflowHash, outcomeRepairTested: false });
  } catch (error) { result.error = errorData(error); }
  finally {
    await tracked?.close();
    try { await foundry?.close(); } catch (error) { result.success = false; result.closeError = errorData(error); }
    try { checkedProtocol(reviewedSHA256); result.sourceStable = true; } catch (error) { result.success = false; result.sourceStable = false; result.freezeError = errorData(error); }
    const calls = tracked?.calls ?? [], completed = calls.filter(call => call.status === 'completed');
    const accounting = { calls, providerInvocations: calls.length, completedResponses: completed.length, usageUnknownCalls: calls.length - completed.length,
      observedCompletedTokens: completed.map(call => call.evidence.tokens), completedReportedCostSum: completed.reduce((sum, call) => sum + call.evidence.reportedCost, 0),
      scope: 'Native provider receipts, not independent billing; failed-call usage remains unknown. No parameter-scale inference.' };
    write(directory, 'ACCOUNTING.json', accounting); result.accounting = { ...accounting, calls: undefined };
    result.finishedAt = new Date().toISOString(); write(directory, 'RESULTS.json', result);
    write(directory, 'FINALIZED.json', { at: result.finishedAt, success: result.success, resultsSHA256: sha(readFileSync(path.join(directory, 'RESULTS.json'))), accountingSHA256: sha(readFileSync(path.join(directory, 'ACCOUNTING.json'))) });
  }
  return result;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const [phase = 'check', reviewedSHA256] = process.argv.slice(2);
    if (phase === 'prepare') { write(ROOT, 'PROTOCOL.json', makeProtocol(new Date().toISOString())); console.log(JSON.stringify({ status: 'AWAITING_PRIME_REVIEW', protocolSHA256: sha(readFileSync(path.join(ROOT, 'PROTOCOL.json'))), modelCalls: 0 })); }
    else if (phase === 'check') { checkedProtocol(reviewedSHA256); console.log(JSON.stringify({ status: 'FROZEN_CONFIG_AND_SOURCES_MATCH', modelCalls: 0, suitesLoaded: 0 })); }
    else if (phase === 'run') {
      const controller = new AbortController(), stop = () => controller.abort(); process.once('SIGINT', stop); process.once('SIGTERM', stop);
      try { const result = await runCampaign(reviewedSHA256, { signal: controller.signal }); console.log(JSON.stringify(result)); if (!result.success) process.exitCode = 1; }
      finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
    } else throw new Error('Use prepare, check <reviewed-protocol-sha256>, or run <reviewed-protocol-sha256>');
  } catch (error) { console.error(JSON.stringify(errorData(error))); process.exitCode = 1; }
}
