#!/usr/bin/env node
import assert from 'node:assert/strict';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { Foundry, parseCandidate } from '../../src/foundry.mjs';
import { WorkflowGenerator, startRequestProcessor } from '../../src/generator.mjs';
import { OpenCodeFreeProvider, parseOpenCodeEvents, parseFreeCatalog, requireFreeModel } from '../../src/opencode-free.mjs';
import { suiteEvaluator } from '../../src/evaluation.mjs';
import { serveHttp } from '../../src/http.mjs';
import { digest } from '../../src/data.mjs';
import { sha256, readJSON, writeJSON, verifyClosure } from './freeze.mjs';
import { assertDemoContract } from './contract.mjs';

if (process.env.FOUNDRY_UI_LIVE !== '1') throw new Error('Explicit opt-in required: FOUNDRY_UI_LIVE=1. This run may make at most six catalog-verified free calls.');
const directory = path.resolve(process.argv[2] ?? '');
const manifest = readJSON(path.join(directory, 'closure.json'));
const snapshot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
assert.equal(snapshot, manifest.snapshot, 'Run the copied harness inside the frozen snapshot');
assert.equal(existsSync(path.join(directory, 'result.json')), false, 'Completed receipts are immutable; do not rerun a campaign directory');
assert.equal(existsSync(path.join(directory, 'started.json')), false, 'An interrupted campaign must retain its call budget; never silently restart it');
assert.equal(sha256(readFileSync(path.join(directory, 'inputs.json'))), manifest.inputsSHA256);
const inputs = readJSON(path.join(directory, 'inputs.json'));
const integrity = () => { const result = verifyClosure(snapshot, manifest, { external: true }); assert.equal(result.verified, true, JSON.stringify(result)); return result; };
integrity();
writeJSON(path.join(directory, 'started.json'), { at: new Date().toISOString(), mode: inputs.experiment });
const workspace = path.join(directory, 'workspace');
const artifacts = path.join(directory, 'browser');
mkdirSync(artifacts, { recursive: true, mode: 0o700 });
const report = { mode: 'actual-browser/noninteractive-free-model/diagnostic', startedAt: new Date().toISOString(), model: inputs.model, closureSHA256: manifest.closureSHA256, inputsSHA256: manifest.inputsSHA256, stages: [], controls: [], passed: false, browserPassed: false, limitations: [manifest.scope, 'The independent oracle is host-authored and diagnostic.', 'Noninteractive provider transport is separate from the required actual-TUI comparison.', 'The CLI binds one suite per server invocation; this harness explicitly switches the host evaluator before revision.'] };
let foundry = new Foundry(workspace), http, processor, browser, context, page, phase = 'initial';
let sequence = 0, calls = { initial: 0, revision: 0 }, offlineExpected = false;
const network = [], pendingNetwork = [], scriptErrors = [], consoleErrors = [], blocked = [], processorErrors = [];
const event = (name, detail = {}) => { const value = { at: new Date().toISOString(), phase, name, ...detail }; appendFileSync(path.join(directory, 'events.ndjson'), JSON.stringify(value) + '\n', { mode: 0o600 }); console.log(JSON.stringify(value)); };
const progress = (kind, detail = {}) => event(kind, detail);
const record = (name, value) => writeJSON(path.join(directory, name), value);
const capture = async name => {
  const stem = `${String(++sequence).padStart(2, '0')}-${name}`;
  const state = foundry.state();
  writeJSON(path.join(artifacts, `${stem}-state.json`), state);
  writeFileSync(path.join(artifacts, `${stem}.txt`), await page.locator('body').ariaSnapshot(), { mode: 0o600, flag: 'wx' });
  await page.screenshot({ path: path.join(artifacts, `${stem}.png`), caret: 'initial', fullPage: true });
  return stem;
};
const refresh = async () => {
  await Promise.all([page.waitForResponse(r => new URL(r.url()).pathname === '/api/state'), page.locator('#refresh').click()]);
};
const queue = async (text, newWorkflow) => {
  await page.locator(newWorkflow ? '#new-workflow' : '#tab-canvas').click();
  await page.locator('#request-text').fill(text);
  const response = page.waitForResponse(r => new URL(r.url()).pathname === '/api/requests' && r.request().method() === 'POST');
  await page.locator('#submit-request').click();
  const actual = await response;
  assert.equal(actual.status(), 201);
  const request = await actual.json();
  assert.equal(request.source, 'user-ui');
  return request;
};
const selectWorkflow = async title => page.locator('#workflow-list').getByRole('button').filter({ hasText: title }).click();
const waitJob = async request => {
  const card = page.locator(`[data-request-id="${request.id}"] [data-generation-status]`);
  await card.waitFor();
  await capture(`${phase}-generating`);
  await page.waitForFunction(id => {
    const element = document.querySelector(`[data-request-id="${id}"] [data-generation-status]`);
    return element && element.dataset.generationStatus !== 'running';
  }, request.id, { timeout: 310000 });
  const job = foundry.store.generationJobs().find(entry => entry.requestId === request.id);
  record(`${phase}-job.json`, job);
  await capture(`${phase}-${job.status}`);
  return job;
};

function verifyProvenance(job, phaseName) {
  const verified = [];
  for (const attempt of job.attempts) {
    const base = path.join(workspace, '.foundry/generation', job.id, String(attempt.round).padStart(2, '0'));
    const response = readJSON(path.join(base, 'response.json'));
    const generated = readJSON(path.join(base, 'generation.json'));
    const streamed = parseOpenCodeEvents(generated.stdout);
    const catalog = readJSON(path.join(base, 'catalog.json'));
    const selected = requireFreeModel(parseFreeCatalog(catalog.stdout), inputs.model);
    const exported = JSON.parse(readJSON(path.join(base, 'session-export.json')).stdout);
    const assistant = exported.messages.filter(message => message.info.role === 'assistant');
    assert.equal(`${exported.info.model.providerID}/${exported.info.model.id}`, inputs.model);
    assert.equal(exported.info.id, streamed.sessionId);
    assert.equal(exported.info.cost, 0);
    assert.ok(assistant.length);
    assert.ok(assistant.every(message => message.info.cost === 0 && `${message.info.providerID}/${message.info.modelID}` === inputs.model));
    assert.equal(response.evidence.reportedCost, 0);
    assert.equal(response.evidence.binarySHA256, manifest.executables.find(item => item.path === response.evidence.binary).sha256);
    assert.equal(response.text, streamed.text);
    assert.equal(assistant.flatMap(message => message.parts.filter(part => part.type === 'text').map(part => part.text)).join('\n'), response.text);
    assert.equal(sha256(generated.stdout), response.evidence.rawOutputSHA256);
    assert.equal(sha256(response.text), response.evidence.outputSHA256);
    assert.equal(sha256(readFileSync(path.join(base, 'prompt.txt'))), response.evidence.promptSHA256);
    if (attempt.assessment) assert.equal(digest(parseCandidate(response.text).workflow), attempt.workflowHash);
    verified.push({ round: attempt.round, sessionId: streamed.sessionId, model: inputs.model, cost: 0, catalogCost: selected.metadata.cost, outputSHA256: sha256(response.text), status: attempt.status });
  }
  record(`${phaseName}-model-provenance.json`, verified);
  return verified;
}

async function executeFromUI(workflow, input, expected, label) {
  await selectWorkflow(workflow.workflow.title);
  await page.locator('#open-run').click();
  await page.locator('#run-input').fill(JSON.stringify(input));
  const created = page.waitForResponse(r => new URL(r.url()).pathname === '/api/runs' && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Start this version', exact: true }).click();
  const response = await created;
  assert.equal(response.status(), 202);
  const started = await response.json();
  await page.locator('#run-controls .run-summary').getByText('Succeeded', { exact: true }).waitFor();
  const execution = foundry.inspectRun(started.id);
  assert.equal(execution.workflowHash, workflow.hash);
  const artifact = readJSON(path.join(foundry.store.directory, 'artifacts', execution.id, 'summary.json'));
  assert.deepEqual(artifact, expected);
  record(`${label}-run.json`, execution);
  record(`${label}-summary.json`, artifact);
  assert.equal(await page.locator('.graph-node').count(), workflow.workflow.nodes.length);
  assert.equal(await page.locator('.edge').count(), workflow.workflow.nodes.reduce((count, node) => count + node.needs.length, 0));
  await page.locator('.graph-node').first().click();
  assert.ok((await page.locator('#inspector-content').textContent()).includes(workflow.workflow.nodes[0].id));
  await page.locator('#zoom-fit').click();
  await capture(`${label}-graph`);
  const nested = workflow.workflow.nodes.find(node => node.body);
  if (nested) {
    await page.locator(`.graph-node[data-node-id="${nested.id}"]`).click();
    await page.getByRole('button', { name: 'Open nested flow ↳', exact: true }).click();
    assert.equal(await page.locator('.graph-node').count(), nested.body.nodes.length);
    assert.equal(await page.locator('#iteration-select').inputValue(), '0');
    await page.locator('.graph-node').first().click();
    await capture(`${label}-nested-graph`);
    await page.getByRole('button', { name: 'Root graph', exact: true }).click();
  }
  await page.locator('#tab-evidence').click();
  assert.ok((await page.locator('#evidence-content').textContent()).includes(workflow.hash));
  await capture(`${label}-run-evidence`);
  return { id: execution.id, workflowHash: execution.workflowHash, status: execution.status, artifactMatches: true, storedRunHash: digest(foundry.store.run(execution.id)) };
}

async function modelStage(kind, suite, text, input, expected) {
  phase = kind;
  const stage = { kind, calls: 0, model: inputs.model, suiteHash: digest(suite) };
  report.stages.push(stage);
  foundry.generator.options.evaluator = suiteEvaluator(suite);
  event('host-evaluator-selected', { evaluator: foundry.generator.options.evaluator.id });
  const request = await queue(text, kind === 'initial');
  stage.requestId = request.id; stage.requestSource = request.source;
  const job = await waitJob(request);
  stage.status = job.status; stage.calls = calls[kind]; stage.jobId = job.id;
  try { const verified = verifyProvenance(job, kind); stage.modelProvenanceVerified = verified.length === job.attempts.length; stage.reportedCost = verified.reduce((total, item) => total + item.cost, 0); }
  catch (error) { stage.provenanceError = error.message; }
  event('model-stage-finished', { stage: kind, status: job.status, calls: stage.calls, error: job.error ?? null });
  assert.equal(job.status, 'proposed', `Model stage ${kind} did not qualify within its fixed budget: ${JSON.stringify(job.error)}`);
  assert.equal(stage.modelProvenanceVerified, true, stage.provenanceError ?? 'Missing model provenance');
  const proposal = foundry.store.proposal(job.proposalId);
  stage.workflowHash = proposal.workflowHash;
  stage.evaluation = job.attempts.at(-1).assessment.evaluation;
  assert.equal(stage.evaluation.passed, true);
  assert.equal(stage.evaluation.metrics.passedCount, 7);
  assert.equal(foundry.store.qualifications().some(entry => entry.workflowHash === stage.workflowHash && entry.passed), true);
  await page.locator(`[data-request-id="${request.id}"]`).getByRole('button', { name: 'Review proposal', exact: true }).click();
  assert.ok((await page.locator('#proposal-review').textContent()).includes(stage.workflowHash));
  await capture(`${kind}-proposal-review`);
  const applied = page.waitForResponse(r => new URL(r.url()).pathname === `/api/proposals/${proposal.id}/apply`);
  await page.getByRole('button', { name: 'Apply this revision', exact: true }).click();
  assert.equal((await applied).status(), 200);
  stage.appliedThroughUI = true;
  const workflow = foundry.store.workflow(stage.workflowHash);
  stage.uiRun = await executeFromUI(workflow, input, expected, kind);
  event('model-workflow-executed', { stage: kind, hash: workflow.hash, runId: stage.uiRun.id, artifactMatches: true });
  return workflow;
}

async function controls() {
  phase = 'synthetic-controls';
  await processor.close(); processor = null;
  await http.close(); await foundry.close();
  foundry = new Foundry(path.join(directory, 'synthetic-controls/workspace'));
  const ref = $ref => ({ $ref });
  const flow = { schemaVersion: '1.0', id: 'SyntheticTypedAnswers', version: 1, domain: 'diagnostic', title: 'Synthetic control: typed human answers', goal: 'Verify UI answer validation and immutable revision controls without model calls.',
    envelope: { assumptions: ['Explicit synthetic UI controls'], risks: [], successCriteria: ['Actual typed answers are validated and recorded'] }, budget: { maxSteps: 20, maxConcurrency: 1, maxDurationMs: 60000, maxCost: 0 },
    nodes: [
      { id: 'text', kind: 'human', needs: [], description: 'Record an operator sentence', question: 'Enter a review note with at least three characters.', answerSchema: { type: 'string', minLength: 3 } },
      { id: 'count', kind: 'human', needs: ['text'], description: 'Record an integer answer', question: 'How many items were reviewed? Enter an integer from one to ten.', answerSchema: { type: 'integer', minimum: 1, maximum: 10 } },
      { id: 'echo', kind: 'task', needs: ['text', 'count'], description: 'Preserve typed operator responses', tool: 'core.identity', args: { note: ref('nodes.text.answer'), count: ref('nodes.count.answer') }, timeoutMs: 1000, retry: { maxAttempts: 1 } }
    ], acceptance: [{ op: 'eq', left: ref('nodes.echo.note'), right: 'Reviewed the synthetic control.' }, { op: 'eq', left: ref('nodes.echo.count'), right: 3 }] };
  const saved = foundry.save(flow);
  http = await serveHttp(foundry, { port: 0 });
  await page.goto(http.origin);
  await page.getByRole('heading', { name: flow.title, exact: true, level: 1 }).waitFor();
  await page.locator('#open-run').click();
  await page.getByRole('button', { name: 'Start this version', exact: true }).click();
  const textCard = page.locator('[data-question="root/text"]');
  await textCard.waitFor();
  await textCard.getByRole('textbox', { name: 'Answer text', exact: true }).fill('x');
  await textCard.getByRole('button', { name: 'Submit answer & continue', exact: true }).click();
  await textCard.getByRole('alert').getByText(/SCHEMA_MISMATCH/).waitFor();
  const note = 'Reviewed the synthetic control.';
  await textCard.getByRole('textbox', { name: 'Answer text', exact: true }).fill(note);
  await refresh();
  assert.equal(await textCard.getByRole('textbox', { name: 'Answer text', exact: true }).inputValue(), note);
  await textCard.getByRole('button', { name: 'Submit answer & continue', exact: true }).click();
  const numberCard = page.locator('[data-question="root/count"]');
  await numberCard.waitFor();
  await numberCard.locator('input').fill('3');
  await numberCard.getByRole('button', { name: 'Submit answer & continue', exact: true }).click();
  await page.locator('#run-controls .run-summary').getByText('Succeeded', { exact: true }).waitFor();
  const run = foundry.store.runs()[0];
  assert.deepEqual(run.outputs.echo, { note, count: 3 });
  assert.equal(typeof run.outputs.echo.count, 'number');
  record('synthetic-typed-answers-run.json', foundry.inspectRun(run.id));
  await capture('synthetic-typed-answers');
  report.controls.push({ name: 'typed-human-answers', passed: true, synthetic: true, invalidStringRejected: true, pollingPreservesDraft: true, integerTypePreserved: true });

  await selectWorkflow(flow.title);
  await page.locator('#request-text').fill('Synthetic stale draft: clarify the task description.');
  const revised = structuredClone(flow); revised.version = 2; revised.goal += ' Concurrent host revision.';
  foundry.save(revised, saved.hash);
  await refresh();
  await page.locator('#request-hint').getByText(/newer head/).waitFor();
  assert.equal(await page.locator('#submit-request').isDisabled(), true);
  await capture('synthetic-stale-draft');
  const before = foundry.store.requests().length;
  await page.locator('#rebind-request').click();
  assert.equal(await page.locator('#submit-request').isEnabled(), true);
  assert.ok((await page.locator('#request-hint').textContent()).includes('v2'));
  assert.equal(foundry.store.requests().length, before);
  await capture('synthetic-explicit-rebind');
  await page.locator('#request-text').fill('');
  report.controls.push({ name: 'stale-draft-explicit-rebind', passed: true, synthetic: true, oldRunPinned: foundry.store.run(run.id).workflowHash === saved.hash });

  const syntheticProvider = { identity: { provider: 'synthetic-cancellation-control', model: 'local-abort-only', synthetic: true, externalCalls: 0 },
    async generate({ signal }) { await new Promise((resolve, reject) => { const abort = () => reject(new Error('Synthetic provider observed cancellation')); if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true }); }); } };
  foundry.generator = new WorkflowGenerator(foundry, syntheticProvider, { maxRounds: 1, maxDurationMs: 30000, autoApply: false });
  processor = startRequestProcessor(foundry.generator, { intervalMs: 100, onError: error => processorErrors.push(error.message) });
  await refresh();
  const request = await queue('Synthetic cancellation control: wait for an explicit cancellation. No model service is used.', true);
  const card = page.locator(`[data-request-id="${request.id}"] [data-generation-status]`);
  await card.getByRole('button', { name: 'Cancel generation', exact: true }).waitFor();
  await capture('synthetic-generation-running');
  await card.getByRole('button', { name: 'Cancel generation', exact: true }).click();
  await page.locator(`[data-request-id="${request.id}"] [data-generation-status="cancelled"]`).waitFor();
  assert.equal(foundry.store.proposals().length, 0);
  assert.equal(foundry.store.generationJobs()[0].status, 'cancelled');
  await capture('synthetic-generation-cancelled');
  record('synthetic-generation-job.json', foundry.store.generationJobs()[0]);
  report.controls.push({ name: 'cancelled-job-display', passed: true, synthetic: true, proposals: 0, externalCalls: 0 });
}

try {
  const provider = new OpenCodeFreeProvider({ model: inputs.model });
  const bounded = { identity: provider.identity, async generate(args) {
    assert.ok(['initial', 'revision'].includes(phase));
    assert.ok(calls[phase] < inputs.maxCallsPerStage, 'Per-stage call budget exhausted');
    integrity(); calls[phase]++;
    event('free-provider-dispatch', { call: calls[phase], model: inputs.model, promptSHA256: sha256(args.prompt) });
    return provider.generate(args);
  } };
  report.registryHash = foundry.registry.hash();
  foundry.generator = new WorkflowGenerator(foundry, bounded, { maxRounds: 3, maxDurationMs: 300000, autoApply: false, evaluator: suiteEvaluator(inputs.initialSuite) });
  http = await serveHttp(foundry, { port: 0 });
  processor = startRequestProcessor(foundry.generator, { intervalMs: 150, onError: error => processorErrors.push(error.message) });
  browser = await chromium.launch({ headless: true, executablePath: '/usr/bin/chromium' });
  report.browser = await browser.version();
  context = await browser.newContext({ viewport: { width: 1720, height: 1100 }, colorScheme: 'dark', reducedMotion: 'reduce' });
  await context.route('**/*', route => {
    if (route.request().url().startsWith(`${http.origin}/`)) return route.continue();
    blocked.push(route.request().url()); return route.abort();
  });
  page = await context.newPage(); page.setDefaultTimeout(20000);
  page.on('pageerror', error => scriptErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push({ phase, expectedOffline: offlineExpected, text: message.text() }); });
  page.on('response', response => {
    const url = new URL(response.url());
    if (!url.pathname.startsWith('/api/')) return;
    const request = response.request();
    const row = { at: new Date().toISOString(), phase, method: request.method(), path: url.pathname, status: response.status(), ...(request.method() === 'POST' ? { authenticated: Boolean(request.headers()['x-foundry-token']), requestBody: request.postDataJSON() } : {}) };
    network.push(row);
    pendingNetwork.push(response.text().then(text => { row.responseSHA256 = sha256(text); if (request.method() === 'POST') row.responseBody = JSON.parse(text); }).catch(error => { row.captureError = error.message; }));
  });
  await page.goto(http.origin);
  await page.getByText('Local · connected', { exact: true }).waitFor();
  await capture('empty-workspace');
  let modelError;
  try {
    const initial = await modelStage('initial', inputs.initialSuite, inputs.initialText, inputs.initialRunInput, inputs.initialRunExpected);
    const oldRun = report.stages[0].uiRun;
    const revised = await modelStage('revision', inputs.revisionSuite, inputs.revisionText, inputs.revisionRunInput, inputs.revisionRunExpected);
    report.history = { oldVersion: initial.workflow.version, newVersion: revised.workflow.version, oldRunId: oldRun.id, oldRunUnchanged: digest(foundry.store.run(oldRun.id)) === oldRun.storedRunHash, oldVersionAddressable: foundry.store.workflow(initial.hash).hash === initial.hash };
    assert.equal(report.history.oldRunUnchanged, true);
    await page.locator('#run-list').getByRole('button').filter({ hasText: oldRun.id.slice(0, 8) }).click();
    assert.ok((await page.locator('[data-testid="selected-hash"]').textContent()).includes(initial.hash.slice(0, 12)));
    await page.locator('#view-head').waitFor();
    await capture('old-run-remains-pinned');
    record('model-final-state.json', foundry.state());
    const countBefore = foundry.store.runs().length;
    await page.reload();
    await page.getByText('Local · connected', { exact: true }).waitFor();
    assert.equal(Number(await page.locator('#run-count').textContent()), countBefore);
    await page.locator('#tab-changes').click();
    assert.equal(await page.locator('[data-generation-status="proposed"]').count(), 2);
    await capture('refresh-restored-history');
    report.controls.push({ name: 'refresh-restores-recorded-history', passed: true, synthetic: false });
    offlineExpected = true;
    // Routing remains real HTTP; network loss is a deliberate browser control.
    await context.setOffline(true);
    await page.getByText('Disconnected · retrying', { exact: true }).waitFor();
    await context.setOffline(false);
    await page.getByText('Local · connected', { exact: true }).waitFor();
    offlineExpected = false;
    assert.equal(foundry.store.runs().length, countBefore);
    await capture('reconnected');
    report.controls.push({ name: 'reconnect-retains-history', passed: true, synthetic: true, mechanism: 'Playwright network-offline toggle against the real local HTTP server' });
    report.sourceIntegrity = integrity();
    assertDemoContract(report);
    report.modelPassed = true;
    report.passed = true;
  } catch (error) {
    modelError = error;
    report.modelError = { message: error.message, stack: error.stack };
    record('model-blocked-state.json', foundry.state());
    await context.setOffline(false);
    offlineExpected = false;
    await capture('model-stage-blocker');
    event('model-demo-blocked', { error: error.message });
  }
  // These controls are explicitly independent synthetic evidence, even when a
  // real model fails its bounded campaign. They cannot repair or promote it.
  await controls();
  assert.deepEqual(scriptErrors, []);
  assert.deepEqual(blocked, []);
  assert.ok(network.filter(row => row.method === 'POST').every(row => row.authenticated));
  report.browserPassed = true;
  if (modelError) process.exitCode = 1;
} catch (error) {
  report.passed = false;
  report.error = { message: error.message, stack: error.stack };
  progress('browser-demo-blocked', { error: error.message });
  if (page) try { await capture('browser-blocker'); } catch { /* Retain the original failure. */ }
  process.exitCode = 1;
} finally {
  await processor?.close();
  for (const [id] of foundry.active) foundry.cancelRun(id);
  await Promise.allSettled(pendingNetwork);
  await browser?.close();
  await http?.close();
  await foundry.close();
  report.calls = calls;
  report.sourceIntegrity = verifyClosure(snapshot, manifest, { external: true });
  report.finishedAt = new Date().toISOString();
  report.scriptErrors = scriptErrors; report.consoleErrors = consoleErrors; report.blockedExternalRequests = blocked; report.processorErrors = processorErrors;
  report.unexpectedConsoleErrors = consoleErrors.filter(error => !error.expectedOffline && !/\b400\b|\b409\b/.test(error.text));
  report.cleanup = { browserClosed: !browser?.isConnected(), modelServicesStopped: true, httpStopped: !http?.server.listening };
  if (!report.sourceIntegrity.verified || scriptErrors.length || processorErrors.length || report.unexpectedConsoleErrors.length) { report.passed = false; process.exitCode = 1; }
  record('network.json', network);
  record('result.json', report);
  console.log(JSON.stringify({ result: path.join(directory, 'result.json'), passed: report.passed, browserPassed: report.browserPassed, calls, error: report.error ?? report.modelError ?? null }, null, 2));
}
