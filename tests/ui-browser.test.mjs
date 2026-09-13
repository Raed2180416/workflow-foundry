import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Foundry } from '../src/foundry.mjs';
import { serveHttp } from '../src/http.mjs';
import { createDefaultRegistry } from '../src/capabilities.mjs';
import { WorkflowGenerator, startRequestProcessor } from '../src/generator.mjs';
import { FoundryError } from '../src/data.mjs';

// Opt-in because this is the only test that starts a browser. One isolated
// Chromium and one context are reused throughout; no model or external service
// is called. Host proposals are scripted fixtures. Automatic generation uses
// the actual processor/generator/HTTP/Store with an identified local fake provider.
// FOUNDRY_UI_E2E=1 node --test tests/ui-browser.test.mjs
const enabled = process.env.FOUNDRY_UI_E2E === '1';
const ref = $ref => ({ $ref });
const eq = (left, right) => ({ op: 'eq', left, right });
const exists = value => ({ op: 'exists', value });
const task = (id, tool, args = {}, needs = [], extra = {}) => ({ id, kind: 'task', needs, description: `Local ${id} step`, tool, args, timeoutMs: 15000, retry: { maxAttempts: 1 }, ...extra });
const program = (id, title, nodes, acceptance) => ({ schemaVersion: '1.0', id, version: 1, title, domain: 'diagnostic', goal: 'Inspect a local, explicitly synthetic workflow from intent through execution evidence.', envelope: { assumptions: ['Synthetic local capabilities only'], risks: [], successCriteria: ['The requested local contract checks pass.'] }, budget: { maxSteps: 80, maxConcurrency: 3, maxDurationMs: 180000, maxCost: 0 }, nodes, acceptance });
const injection = '<img src=x onerror="window.__injected=1">';
function reviewWorkflow() {
  return program('UIReview', 'Review a release brief', [
    task('draft', 'core.identity', { text: injection }, [], { description: 'Prepare the brief from source material' }),
    task('sources', 'core.identity', { checked: true }, ['draft'], { description: 'Check the sources and supporting evidence' }),
    task('risks', 'core.identity', { checked: true }, ['draft'], { description: 'Review constraints and known risks', when: eq(true, true) }),
    task('combine', 'core.collect', { items: [ref('nodes.sources'), ref('nodes.risks')] }, ['sources', 'risks'], { description: 'Combine independent review results' }),
    { id: 'review', kind: 'map', needs: ['combine'], description: 'Review two local items with explicit answers', items: ['first', 'second'], maxItems: 2,
      body: { nodes: [{ id: 'repeat', kind: 'loop', needs: [], description: 'Inspect one bounded review iteration', maxIterations: 1, initial: {}, until: eq(ref('nodes.echo.answer'), true),
        body: { nodes: [{ id: 'ask', kind: 'human', needs: [], description: 'A human supplies the actual decision', question: 'Does this local review item pass?', answerSchema: { type: 'boolean' } }, task('echo', 'core.identity', { answer: ref('nodes.ask.answer') }, ['ask'])], acceptance: [eq(ref('nodes.echo.answer'), true)] }
      }], acceptance: [eq(ref('nodes.repeat.last.echo.answer'), true)] }
    },
    task('record', 'ui.approved', { count: ref('nodes.review.count') }, ['review'], { description: 'Approve an inert local recording operation' }),
    { id: 'check', kind: 'assert', needs: ['record'], description: 'Check that both items were reviewed', checks: [eq(ref('nodes.record.count'), 2)] }
  ], [eq(ref('nodes.record.count'), 2)]);
}

test('UI browser: real local HTTP workflows, revision pins and human controls', { skip: !enabled, timeout: 180000 }, async t => {
  const { chromium } = await import('playwright');
  const workspace = mkdtempSync(path.join(tmpdir(), 'foundry-ui-'));
  const registry = createDefaultRegistry();
  registry.register({ name: 'ui.approved', version: '1', description: 'Inert approval UI fixture; returns input without an external effect.', implementation: 'ui-browser-fixture/1', inputSchema: {}, outputSchema: {}, effects: 'none', risk: 'high', requiresApproval: true, maxTimeoutMs: 30000, cancellation: 'cooperative', cost: 0, execute: async args => args });
  const foundry = new Foundry(workspace, { registry, policy: { allowedCapabilities: registry.list().map(item => item.name) } });
  const workflow = reviewWorkflow(), saved = foundry.save(workflow);
  const http = await serveHttp(foundry, { port: 0 });
  let browser, processor;
  const gates = [], generationScripts = [], generationCalls = [], processorErrors = [];
  const makeGate = () => {
    let release;
    const promise = new Promise(resolve => { release = resolve; });
    gates.push(release); return { promise, release };
  };
  const syntheticProvider = {
    identity: { name: 'Synthetic UI provider', kind: 'deterministic-local-fixture', model: 'ui-fixture/1', externalCalls: false },
    async generate({ prompt, signal }) {
      const script = generationScripts.shift();
      assert.ok(script, 'Unexpected provider call; tests must supply every response explicitly.');
      assert.ok(prompt.includes(script.requestText), 'The real generator must pass the queued user request to the provider.');
      const call = { requestText: script.requestText, aborted: false, synthetic: true };
      generationCalls.push(call);
      if (script.waitForAbort) await new Promise(resolve => {
        const abort = () => { call.aborted = true; resolve(); };
        if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
      });
      if (script.gate) await script.gate.promise;
      if (script.error) throw new FoundryError(script.error.code, script.error.message);
      return { text: script.text, evidence: { provider: 'deterministic-local-fixture', synthetic: true, externalCalls: 0 } };
    }
  };
  const artifacts = process.env.FOUNDRY_UI_ARTIFACTS ? path.resolve(process.env.FOUNDRY_UI_ARTIFACTS) : fileURLToPath(new URL('../web/artifacts/', import.meta.url));
  mkdirSync(artifacts, { recursive: true });
  t.after(async () => {
    for (const release of gates) release();
    await processor?.close();
    await browser?.close();
    for (const execution of foundry.active.values()) execution.controller.abort();
    await http.close(); await foundry.close(); rmSync(workspace, { recursive: true, force: true });
  });
  browser = await chromium.launch({ headless: true, executablePath: process.env.FOUNDRY_CHROMIUM ?? '/usr/bin/chromium' });
  const context = await browser.newContext({ viewport: { width: 1720, height: 1100 }, colorScheme: 'dark', reducedMotion: 'reduce' });
  const blockedRequests = [];
  await context.route('**/*', route => {
    if (route.request().url().startsWith(`${http.origin}/`)) return route.continue();
    blockedRequests.push(route.request().url()); return route.abort();
  });
  const page = await context.newPage();
  const errors = [], mutations = [], outcomes = [];
  const check = async (name, fn) => {
    const outcome = { name, passed: false };
    await t.test(name, async () => {
      try { await fn(); outcome.passed = true; }
      catch (error) { outcome.error = error.message; throw error; }
    });
    outcomes.push(outcome);
  };
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && !message.text().includes('400') && !message.text().includes('409')) errors.push(message.text()); });
  page.on('request', request => {
    if (request.method() === 'POST') mutations.push({ path: new URL(request.url()).pathname, data: request.postDataJSON(), authenticated: Boolean(request.headers()['x-foundry-token']) });
  });
  page.setDefaultTimeout(12000);
  const refresh = async () => { await Promise.all([page.waitForResponse(response => response.url() === `${http.origin}/api/state`), page.locator('#refresh').click()]); };
  const clickWorkflow = async title => { await page.getByRole('navigation', { name: 'Workflows', exact: true }).getByRole('button').filter({ hasText: title }).click(); };
  const start = async (input = {}) => {
    await page.locator('#open-run').click(); await page.locator('#run-input').fill(JSON.stringify(input));
    await page.getByRole('button', { name: 'Start this version', exact: true }).click();
    await page.locator('#run-dialog').waitFor({ state: 'hidden' });
  };
  const queueRequest = async (text, { newWorkflow = true } = {}) => {
    if (newWorkflow) await page.locator('#new-workflow').click();
    else await page.locator('#tab-canvas').click();
    await page.locator('#request-text').fill(text);
    const response = page.waitForResponse(result => result.url() === `${http.origin}/api/requests` && result.request().method() === 'POST');
    await page.locator('#submit-request').click();
    const created = await (await response).json();
    assert.ok(created.id, JSON.stringify(created));
    return created;
  };
  const generationCard = requestId => page.locator(`[data-request-id="${requestId}"] .generation-job`);
  const recordedJob = requestId => foundry.store.generationJobs().find(job => job.requestId === requestId);
  // Playwright's default caret hiding writes then clears inline style properties
  // on every input. Keep the initial caret so strict-CSP DOM checks measure the UI.
  const screenshot = async name => {
    await page.locator('#panel-changes').evaluate(element => element.scrollIntoView({ block: 'start' }));
    await page.screenshot({ path: path.join(artifacts, name), caret: 'initial' });
  };
  let request, proposal, competing, firstRun;

  await check('loads the strict-CSP graph, safe text and keyboard node inspection', async () => {
    await page.goto(http.origin);
    await page.getByRole('heading', { name: 'Review a release brief', exact: true, level: 1 }).waitFor();
    assert.equal(await page.locator('.graph-node').count(), 7);
    assert.equal(await page.locator('.edge').count(), 7);
    const first = page.locator('.graph-node').first();
    await first.focus(); await page.keyboard.press('Enter');
    assert.equal(await page.locator('#inspector-content h2').textContent(), 'draft');
    const argumentsJSON = await page.locator('#inspector-content details').filter({ has: page.getByText('Arguments & references', { exact: true }) }).locator('pre').textContent();
    assert.equal(JSON.parse(argumentsJSON).text, injection);
    assert.equal(await page.locator('img').count(), 0);
    assert.equal(await page.evaluate(() => window.__injected), undefined);
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.locator('.graph-node:focus').getAttribute('data-node-id'), 'sources');
    await page.locator('#zoom-in').click();
    assert.equal(await page.locator('#zoom-label').textContent(), '110%');
    await page.locator('#zoom-fit').click();
    const noInline = await page.evaluate(() => document.querySelectorAll('[style], style').length);
    assert.equal(noInline, 0);
  });

  await check('queues actual version-bound agent requests and leaves pending state explicit', async () => {
    await page.locator('#request-text').fill('Improve the draft description and keep the success checks intact.');
    await page.locator('#submit-request').click();
    await page.getByText('Pending · host agent needed', { exact: true }).waitFor();
    request = foundry.store.requests()[0];
    assert.equal(request.baseHash, saved.hash);
    assert.equal(request.status, 'pending');
    assert.equal(foundry.store.proposals().length, 0);
    await page.getByRole('button', { name: 'Load host-agent context', exact: true }).click();
    await page.getByText('Context for the actual host agent', { exact: true }).waitFor();
    const candidate = structuredClone(workflow); candidate.version = 2; candidate.nodes[0].description = 'Prepare a clearer brief with source context';
    proposal = foundry.propose({ requestId: request.id, workflow: candidate, rationale: 'Scripted test host-agent proposal: clarify one node description while retaining task acceptance.' });
    const otherRequest = foundry.store.createRequest({ workflowId: workflow.id, baseHash: saved.hash, text: 'An independent competing revision for the version conflict test.' });
    const other = structuredClone(candidate); other.title = 'Competing brief revision';
    competing = foundry.propose({ requestId: otherRequest.id, workflow: other, rationale: 'Scripted competing proposal against the same original source hash.' });
    await refresh();
    await page.locator(`[data-request-id="${request.id}"]`).getByRole('button', { name: 'Review proposal', exact: true }).click();
    await page.getByText('/nodes/0/description', { exact: true }).waitFor();
    assert.match(await page.locator('#proposal-review').textContent(), /Prepare a clearer brief/);
  });

  await check('starts a pinned run and answers full nested map/loop node paths', async () => {
    await clickWorkflow(workflow.title); await start();
    const firstKey = 'root/review:0/repeat:0/ask';
    await page.locator(`[data-question="${firstKey}"]`).waitFor();
    firstRun = foundry.store.runs()[0];
    assert.equal(firstRun.workflowHash, saved.hash);
    const question = page.locator(`[data-question="${firstKey}"]`);
    await question.getByRole('button', { name: 'Inspect this node', exact: true }).click();
    assert.equal(await page.locator('#inspector-content h2').textContent(), 'ask');
    assert.match(await page.locator('#inspector-content').textContent(), /root\/review:0\/repeat:0\/ask/);
    await page.locator('#iteration-select').selectOption('definition');
    assert.equal(await page.locator('.graph-node').count(), 2);
    assert.match(await page.locator('.graph-node').first().getAttribute('aria-label'), /Definition only/);
    await page.locator('#iteration-select').selectOption('0');
    const answer = page.locator(`[data-question="${firstKey}"] select`);
    await answer.selectOption('true'); await answer.focus();
    await page.waitForResponse(response => response.url() === `${http.origin}/api/state`);
    assert.equal(await answer.inputValue(), 'true', 'Polling must preserve a drafted answer.');
    await page.locator(`[data-question="${firstKey}"]`).getByRole('button', { name: 'Submit answer & continue', exact: true }).click();
    const secondKey = 'root/review:1/repeat:0/ask';
    await page.locator(`[data-question="${secondKey}"]`).waitFor();
    await page.locator(`[data-question="${secondKey}"] select`).selectOption('true');
    await page.locator(`[data-question="${secondKey}"]`).getByRole('button', { name: 'Submit answer & continue', exact: true }).click();
    await page.getByRole('button', { name: 'Approve operation', exact: true }).waitFor();
    const approval = Object.values(foundry.store.run(firstRun.id).approvals)[0];
    assert.equal(approval.nodeKey, 'root/record');
    assert.match(await page.locator('[data-approval]').textContent(), new RegExp(saved.hash));
    await page.getByRole('button', { name: 'Approve operation', exact: true }).click();
    await page.locator('#run-controls .run-summary').getByText('Succeeded', { exact: true }).waitFor();
    const completed = foundry.store.run(firstRun.id);
    assert.equal(completed.outputs.review.count, 2);
    assert.equal(completed.frames['root/review:0/repeat:0'].outputs.ask.answer, true);
    assert.equal(completed.frames['root/review:1/repeat:0'].outputs.ask.answer, true);
    assert.ok(mutations.some(mutation => mutation.path.endsWith('/answers') && mutation.data.nodeId === secondKey));
  });

  await check('applies CAS proposals, keeps historical run source pinned and blocks stale proposals', async () => {
    await page.locator('#request-text').fill('A draft that remains bound to the original run version.');
    await page.locator('#tab-changes').click();
    await page.locator(`[data-request-id="${request.id}"]`).getByRole('button', { name: 'Review proposal', exact: true }).click();
    await page.getByRole('button', { name: 'Apply this revision', exact: true }).click();
    await page.locator('#proposal-review').getByText('Applied', { exact: true }).waitFor();
    assert.equal(foundry.store.workflow(workflow.id).workflow.version, 2);
    assert.equal(foundry.store.run(firstRun.id).workflowHash, saved.hash);
    await page.locator('#tab-canvas').click();
    assert.match(await page.locator('[data-testid="selected-hash"]').textContent(), new RegExp(short(saved.hash)));
    await page.locator('#view-head').waitFor();
    assert.equal(await page.locator('#submit-request').isDisabled(), true, 'A draft bound to the old head cannot silently rebase.');
    await page.locator('#tab-changes').click();
    await page.locator(`[data-request-id="${competing.requestId}"]`).getByRole('button', { name: 'Review proposal', exact: true }).click();
    await page.locator('#proposal-review').getByText('Version conflict', { exact: true }).waitFor();
    assert.equal(await page.locator('#proposal-review').getByRole('button', { name: 'Apply this revision', exact: true }).count(), 0);
    await page.locator('#tab-canvas').click();
    await start();
    await page.locator('[data-question]').first().waitFor();
    assert.equal(foundry.store.runs()[0].workflowHash, saved.hash, 'Starting from the historical view must execute that exact hash, not the newer head.');
    await page.locator('#view-head').click();
    await page.locator('#rebind-request').click();
    assert.equal(await page.locator('#submit-request').isEnabled(), true);
    assert.match(await page.locator('#request-hint').textContent(), /v2/);
  });

  await check('renders root/nested outputs and event evidence with dark and light screenshots', async () => {
    await page.getByRole('navigation', { name: 'Recent runs', exact: true }).getByRole('button').filter({ hasText: firstRun.id.slice(0, 8) }).click();
    await page.locator('#tab-evidence').click();
    await page.getByText('Runtime acceptance passed for this pinned program. Independent task verification is not established by this run.', { exact: true }).waitFor();
    assert.ok(await page.locator('.state-table tbody tr').count() > 7);
    await page.locator('#event-search').fill('human.answered');
    assert.equal(await page.locator('.event').count(), 2);
    await page.locator('.event summary').first().click();
    assert.match(await page.locator('.event[open] pre').textContent(), /answerHash/);
    await page.screenshot({ path: path.join(artifacts, 'ui-evidence-dark.png'), fullPage: true, caret: 'initial' });
    await page.locator('#tab-canvas').click();
    await page.locator('#zoom-fit').click();
    await page.screenshot({ path: path.join(artifacts, 'ui-canvas-overview-dark.png'), fullPage: true, caret: 'initial' });
    while (Number.parseInt(await page.locator('#zoom-label').textContent(), 10) < 100) await page.locator('#zoom-in').click();
    await page.locator('.graph-node[data-node-id="risks"]').click();
    await page.screenshot({ path: path.join(artifacts, 'ui-canvas-dark.png'), fullPage: true, caret: 'initial' });
    await page.locator('#theme-toggle').click();
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
    await page.screenshot({ path: path.join(artifacts, 'ui-canvas-light.png'), fullPage: true, caret: 'initial' });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'The mobile document should not overflow horizontally.');
    await page.screenshot({ path: path.join(artifacts, 'ui-mobile-light.png'), fullPage: true, caret: 'initial' });
    await page.setViewportSize({ width: 1720, height: 1100 });
    await page.locator('#theme-toggle').click();
  });

  await check('validates and imports JSON; rejects an explicit operation without inventing success', async () => {
    await page.locator('#open-import').click(); await page.locator('#import-json').fill('{');
    await page.getByRole('button', { name: 'Import workflow', exact: true }).click();
    await page.locator('#import-result').getByText(/not valid JSON/).waitFor();
    const imported = program('UIApproval', 'Approval decision fixture', [task('act', 'ui.approved', { value: 'synthetic' })], [eq(ref('nodes.act.value'), 'synthetic')]);
    await page.locator('#import-file').setInputFiles({ name: 'approval.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(imported)) });
    await page.waitForFunction(() => document.getElementById('import-json').value.includes('UIApproval'));
    await page.getByRole('button', { name: 'Validate', exact: true }).click();
    await page.getByText('Valid workflow contract', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Import workflow', exact: true }).click();
    await page.getByRole('heading', { name: imported.title, exact: true, level: 1 }).waitFor();
    await start();
    await page.getByRole('button', { name: 'Reject operation', exact: true }).click();
    await page.locator('#run-controls .run-summary').getByText('Cancelled', { exact: true }).waitFor();
    assert.equal(foundry.store.runs()[0].error.code, 'APPROVAL_REJECTED');
  });

  await check('keeps validation errors visible; resumes waits and cancels active execution', async () => {
    const waiting = program('UIWait', 'Durable wait fixture', [{ id: 'pause', kind: 'wait', needs: [], description: 'A durable short delay', delayMs: 20 }, task('done', 'core.identity', { ok: true }, ['pause'])], [eq(ref('nodes.done.ok'), true)]);
    waiting.inputSchema = { type: 'object', required: ['enabled'], properties: { enabled: { type: 'boolean' } }, additionalProperties: false };
    foundry.save(waiting); await refresh(); await clickWorkflow(waiting.title);
    await page.locator('#open-run').click();
    await page.locator('#run-input').fill('{"enabled":"yes"}');
    await page.getByRole('button', { name: 'Start this version', exact: true }).click();
    await page.locator('#run-form-error').getByText(/SCHEMA_MISMATCH/).waitFor();
    await page.locator('#run-input').fill('{"enabled":true}');
    await page.getByRole('button', { name: 'Start this version', exact: true }).click();
    await page.locator('#run-controls .run-summary').getByText('Waiting', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Resume run', exact: true }).click();
    await page.locator('#run-controls .run-summary').getByText('Succeeded', { exact: true }).waitFor();
    const sleeping = program('UICancel', 'Cancellation fixture', [task('sleep', 'core.sleep', { ms: 10000 })], [exists(ref('nodes.sleep.sleptMs'))]);
    foundry.save(sleeping); await refresh(); await clickWorkflow(sleeping.title); await start();
    await page.getByRole('button', { name: 'Cancel execution', exact: true }).click();
    await page.locator('#run-controls .run-summary').getByText('Cancelled', { exact: true }).waitFor();
    assert.notEqual(foundry.store.runs()[0].status, 'succeeded');
  });

  await check('catalogs installed contracts, keeps all mutations authenticated and records no CSP or script errors', async () => {
    await page.locator('#tab-catalog').click();
    await page.getByRole('heading', { name: 'ui.approved', exact: true }).waitFor();
    assert.ok(await page.locator('.catalog-card').count() >= registry.list().length);
    assert.ok(mutations.length >= 10);
    assert.ok(mutations.every(mutation => mutation.authenticated));
    assert.deepEqual(blockedRequests, []);
    assert.deepEqual(errors, []);
  });

  const bridgeWorkflow = program('UIBridge', 'Summarize a local release brief', [task('draft', 'core.identity', { text: 'A local release summary' }, [], { description: 'Prepare the requested bounded summary' })], [eq(ref('nodes.draft.text'), 'A local release summary')]);
  let bridgeRequest, bridgeJob, bridgeRun;
  const candidateText = workflow => JSON.stringify({ workflow, rationale: 'Identified synthetic provider fixture: preserve the requested task and expose all source changes. This is deterministic UI integration evidence.' });

  await check('automatic bridge processes real UI requests and proposes without silently applying', async () => {
    foundry.generator = new WorkflowGenerator(foundry, syntheticProvider, { maxRounds: 2, maxDurationMs: 45000, autoApply: false });
    processor = startRequestProcessor(foundry.generator, { intervalMs: 30, onError: error => processorErrors.push({ code: error.code, message: error.message }) });
    await refresh();
    const gate = makeGate(), requestText = 'Draft a bounded local release summary with an explicit acceptance check.';
    generationScripts.push({ requestText, text: candidateText(bridgeWorkflow), gate });
    try {
      bridgeRequest = await queueRequest(requestText);
      const card = generationCard(bridgeRequest.id);
      await page.locator(`[data-request-id="${bridgeRequest.id}"] [data-generation-status="running"]`).waitFor();
      bridgeJob = recordedJob(bridgeRequest.id);
      assert.equal(foundry.state().agent.automaticBackgroundGeneration, true);
      assert.deepEqual(bridgeJob.provider, syntheticProvider.identity);
      assert.equal(foundry.store.request(bridgeRequest.id).status, 'processing');
      assert.match(await page.locator('#agent-status').textContent(), /Synthetic UI provider · ui-fixture\/1/);
      assert.match(await page.locator('#agent-status').textContent(), /Model responds automatically/);
      assert.match(await page.locator('#agent-status').textContent(), /proposed for review/);
      assert.match(await card.textContent(), /Round 1 · Generating/);
      await card.getByRole('button', { name: 'Cancel generation', exact: true }).waitFor();
      assert.equal(foundry.store.workflows().some(item => item.id === bridgeWorkflow.id), false);
      await screenshot('ui-generation-running-dark.png');
    } finally { gate.release(); }
    await page.locator(`[data-request-id="${bridgeRequest.id}"] [data-generation-status="proposed"]`).waitFor();
    assert.equal(foundry.store.workflows().some(item => item.id === bridgeWorkflow.id), false, 'Proposal mode must not save a new head.');
    assert.equal(recordedJob(bridgeRequest.id).deploymentQualified, false);
    await page.locator(`[data-request-id="${bridgeRequest.id}"]`).getByRole('button', { name: 'Review proposal', exact: true }).click();
    assert.match(await page.locator('#proposal-review').textContent(), /Identified synthetic provider fixture/);
    await screenshot('ui-generation-proposed-dark.png');
    await page.getByRole('button', { name: 'Apply this revision', exact: true }).click();
    await generationCard(bridgeRequest.id).getByText('Proposed · subsequently applied', { exact: true }).waitFor();
    assert.equal(foundry.store.workflow(bridgeWorkflow.id).workflow.version, 1);
  });

  await check('automatic apply is explicit and retains old generation settings and pinned run source', async () => {
    await clickWorkflow(bridgeWorkflow.title); await start();
    await page.locator('#run-controls .run-summary').getByText('Succeeded', { exact: true }).waitFor();
    bridgeRun = foundry.store.runs().find(run => run.workflowId === bridgeWorkflow.id);
    foundry.generator.options.autoApply = true;
    await refresh();
    await page.locator('#request-hint').getByText(/applied automatically/).waitFor();
    assert.match(await page.locator('#request-hint').textContent(), /applied automatically/);
    assert.match(await page.locator('#request-hint').textContent(), /Independent task qualification is not implied/);
    const revised = structuredClone(bridgeWorkflow); revised.version = 2; revised.nodes[0].description = 'Prepare a clearer bounded summary with source context';
    const requestText = 'Clarify the summary step and retain its existing acceptance check.';
    generationScripts.push({ requestText, text: candidateText(revised) });
    const request = await queueRequest(requestText, { newWorkflow: false });
    const card = generationCard(request.id);
    await page.locator(`[data-request-id="${request.id}"] [data-generation-status="applied"]`).waitFor();
    await card.getByText('Applied automatically', { exact: true }).waitFor();
    assert.equal(recordedJob(request.id).limits.autoApply, true);
    assert.equal(recordedJob(bridgeRequest.id).limits.autoApply, false);
    assert.equal(await generationCard(bridgeRequest.id).getByText('Applied automatically', { exact: true }).count(), 0);
    assert.equal(foundry.store.workflow(bridgeWorkflow.id).workflow.version, 2);
    assert.equal(foundry.store.run(bridgeRun.id).workflowHash, bridgeRun.workflowHash);
    assert.equal(foundry.store.runs().filter(run => run.workflowId === bridgeWorkflow.id).length, 1, 'Applying a candidate must not silently start a run.');
    await page.locator(`[data-request-id="${request.id}"]`).getByRole('button', { name: 'Review proposal', exact: true }).click();
    await page.getByText('/nodes/0/description', { exact: true }).waitFor();
    assert.equal(await page.locator('#proposal-review').getByRole('button', { name: 'Apply this revision', exact: true }).count(), 0);
    await screenshot('ui-generation-auto-applied-dark.png');
    await page.locator('#tab-canvas').click();
    assert.match(await page.locator('[data-testid="selected-hash"]').textContent(), new RegExp(short(bridgeRun.workflowHash)));
    await page.locator('#view-head').waitFor();
  });

  await check('bounded repair preserves a malformed candidate attempt and its actual host feedback', async () => {
    const requestText = 'Create a local candidate that repairs its first malformed response.';
    const repaired = structuredClone(bridgeWorkflow); repaired.id = 'UIRepaired'; repaired.title = 'A repaired local candidate';
    generationScripts.push({ requestText, text: '{invalid response' }, { requestText, text: candidateText(repaired) });
    const request = await queueRequest(requestText), card = generationCard(request.id);
    await page.locator(`[data-request-id="${request.id}"] [data-generation-status="applied"]`).waitFor();
    const job = recordedJob(request.id);
    assert.deepEqual(job.attempts.map(attempt => attempt.status), ['failed-attempt', 'accepted-candidate']);
    assert.equal(job.attempts[0].error.code, 'CANDIDATE_FORMAT');
    assert.equal(job.attempts[1].assessment.readyForProposal, true);
    assert.equal(job.attempts[1].assessment.deploymentQualified, false);
    assert.match(await card.locator('details[open]').first().textContent(), /CANDIDATE_FORMAT/);
    assert.match(await card.textContent(), /Round 1 · Attempt failed/);
    assert.match(await card.textContent(), /Round 2 · Candidate accepted/);
    await screenshot('ui-generation-repair-dark.png');
  });

  await check('provider errors render as safe text and failed jobs never silently retry or create proposals', async () => {
    const requestText = 'Record a deterministic provider failure for the local error display.';
    const beforeProposals = foundry.store.proposals().length;
    generationScripts.push({ requestText, error: { code: 'SYNTHETIC_PROVIDER_FAILURE', message: `Provider fixture failed: ${injection}` } });
    const request = await queueRequest(requestText), card = generationCard(request.id);
    await page.locator(`[data-request-id="${request.id}"] [data-generation-status="failed"]`).waitFor();
    assert.equal(foundry.store.request(request.id).status, 'failed');
    assert.equal(recordedJob(request.id).attempts.length, 1);
    assert.equal(foundry.store.proposals().length, beforeProposals);
    assert.match(await card.locator('[data-testid="generation-error"]').textContent(), /SYNTHETIC_PROVIDER_FAILURE/);
    assert.ok((await card.textContent()).includes(injection));
    assert.equal(await page.locator('img').count(), 0);
    assert.equal(await page.evaluate(() => window.__injected), undefined);
    assert.equal(await page.locator('#proposal-review .badge').count(), 0, 'A failed new request must not leave an older applied result selected beside it.');
    const calls = generationCalls.length;
    await page.waitForResponse(response => response.url() === `${http.origin}/api/state`);
    assert.equal(generationCalls.length, calls);
    assert.equal(await card.getByRole('button', { name: 'Cancel generation', exact: true }).count(), 0);
    await screenshot('ui-generation-error-dark.png');
  });

  await check('generation cancellation uses the real token route and waits for a recorded terminal result', async () => {
    const gate = makeGate(), requestText = 'Hold this local generation until its user cancellation is recorded.';
    const cancelledCandidate = structuredClone(bridgeWorkflow); cancelledCandidate.id = 'UINeverApplied';
    generationScripts.push({ requestText, text: candidateText(cancelledCandidate), waitForAbort: true, gate });
    let request;
    try {
      request = await queueRequest(requestText);
      const card = generationCard(request.id);
      await page.locator(`[data-request-id="${request.id}"] [data-generation-status="running"]`).waitFor();
      const job = recordedJob(request.id), cancellation = page.waitForResponse(response => response.url() === `${http.origin}/api/generation/${job.id}/cancel`);
      await card.getByRole('button', { name: 'Cancel generation', exact: true }).focus();
      await page.keyboard.press('Enter');
      const response = await cancellation;
      assert.equal(response.status(), 202);
      assert.equal((await response.json()).cancellationRequested, true);
      // The host races cancellation against an uncooperative provider. A real
      // terminal receipt may therefore precede the next UI render; do not demand
      // a transient state remain visible after cancellation has actually finished.
      await card.locator('.badge').getByText(/^(Cancellation requested|Cancelled)$/).waitFor();
      const displayed = (await card.locator('.badge').first().textContent()).trim();
      const actual = recordedJob(request.id).status;
      assert.ok(['running', 'cancelled'].includes(actual), `Unexpected backend cancellation state: ${actual}`);
      if (displayed === 'Cancelled') assert.equal(actual, 'cancelled', 'A terminal label requires an actual terminal backend receipt.');
      assert.equal(generationCalls.at(-1).aborted, true);
      assert.equal(await card.getByRole('button', { name: 'Cancel generation', exact: true }).count(), 0, 'Repeated cancellation must not remain an enabled action.');
      await screenshot('ui-generation-cancelling-dark.png');
    } finally { gate.release(); }
    await page.locator(`[data-request-id="${request.id}"] [data-generation-status="cancelled"]`).waitFor();
    assert.equal(foundry.store.request(request.id).status, 'cancelled');
    assert.equal(foundry.store.proposals().some(proposal => proposal.requestId === request.id), false);
    assert.equal(foundry.store.workflows().some(workflow => workflow.id === cancelledCandidate.id), false);
    assert.ok(mutations.some(mutation => mutation.path === `/api/generation/${recordedJob(request.id).id}/cancel` && mutation.authenticated));
    await page.locator('#theme-toggle').click();
    await screenshot('ui-generation-cancelled-light.png');
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.locator('#agent-status').screenshot({ path: path.join(artifacts, 'ui-generation-mobile-light.png'), caret: 'initial' });
    await generationCard(request.id).getByText('Cancelled', { exact: true }).waitFor();
    await generationCard(request.id).screenshot({ path: path.join(artifacts, 'ui-generation-mobile-job-light.png'), caret: 'initial' });
    await page.setViewportSize({ width: 1720, height: 1100 });
    await page.locator('#theme-toggle').click();
  });

  await check('automatic-apply conflicts show failed job evidence and the unapplied source diff', async () => {
    const base = foundry.store.workflow(bridgeWorkflow.id), candidate = structuredClone(base.workflow);
    candidate.version++; candidate.nodes[0].description = 'The generated candidate must not overwrite a concurrent version';
    const gate = makeGate(), requestText = 'Generate a source-bound revision while another local revision is applied.';
    generationScripts.push({ requestText, text: candidateText(candidate), gate });
    let request, concurrentHash;
    try {
      await clickWorkflow(base.workflow.title);
      request = await queueRequest(requestText, { newWorkflow: false });
      await page.locator(`[data-request-id="${request.id}"] [data-generation-status="running"]`).waitFor();
      const concurrent = structuredClone(base.workflow); concurrent.version++; concurrent.title = 'A concurrently saved local version';
      concurrentHash = foundry.save(concurrent, base.hash).hash;
    } finally { gate.release(); }
    await page.locator(`[data-request-id="${request.id}"] [data-generation-status="failed"]`).waitFor();
    const job = recordedJob(request.id);
    assert.equal(job.error.code, 'STALE_WORKFLOW');
    assert.equal(foundry.store.workflow(bridgeWorkflow.id).hash, concurrentHash);
    assert.match(await generationCard(request.id).textContent(), /STALE_WORKFLOW/);
    await page.locator(`[data-request-id="${request.id}"]`).getByRole('button', { name: 'Review proposal', exact: true }).click();
    await page.locator('#proposal-review').getByText('Version conflict', { exact: true }).waitFor();
    assert.equal(await page.locator('#proposal-review').getByRole('button', { name: 'Apply this revision', exact: true }).count(), 0);
    await screenshot('ui-generation-conflict-dark.png');
  });

  await check('an inactive generation cancellation reports the backend error without falsifying status', async () => {
    const request = foundry.store.createRequest({ text: 'Persisted synthetic generation with no live controller.' });
    const job = foundry.store.createGenerationJob(request.id, syntheticProvider.identity, { maxRounds: 1, maxDurationMs: 1000, autoApply: false });
    await refresh();
    const card = generationCard(request.id);
    await card.getByRole('button', { name: 'Cancel generation', exact: true }).click();
    await page.locator('#error-notice').getByText(/GENERATOR_NOT_ACTIVE/).waitFor();
    await card.getByText(/Cancellation request failed/).waitFor();
    assert.equal(recordedJob(request.id).status, 'running');
    assert.equal(await card.getByRole('button', { name: 'Cancellation requested', exact: true }).count(), 0);
    foundry.store.updateGenerationJob(job.id, current => { current.status = 'interrupted'; current.error = { code: 'SYNTHETIC_INTERRUPTED', message: 'Local fixture reconciliation identified a missing owner.' }; });
    await refresh();
    await page.locator(`[data-generation-id="${job.id}"][data-generation-status="interrupted"]`).waitFor();
    assert.equal(await card.getByRole('button', { name: 'Cancel generation', exact: true }).count(), 0);
  });

  await check('automatic UI integration has no external requests, unauthed writes, inline styles or script/CSP failures', async () => {
    const inlineStyles = await page.evaluate(() => [...document.querySelectorAll('[style], style')].map(element => ({ tag: element.tagName, id: element.id, className: element.getAttribute('class'), style: element.getAttribute('style'), text: element.tagName === 'STYLE' ? element.textContent.slice(0, 500) : undefined })));
    assert.deepEqual(inlineStyles, [], JSON.stringify(inlineStyles));
    assert.ok(generationCalls.length >= 7);
    assert.equal(generationScripts.length, 0);
    assert.ok(mutations.every(mutation => mutation.authenticated));
    assert.deepEqual(processorErrors, []);
    assert.deepEqual(blockedRequests, []);
    assert.deepEqual(errors, []);
  });
  const sources = ['web/app.js', 'web/index.html', 'web/style.css', 'tests/ui-browser.test.mjs', 'tests/ui-contract.test.mjs', 'src/generator.mjs', 'src/foundry.mjs', 'src/http.mjs', 'src/store.mjs'].map(file => ({ path: file, sha256: createHash('sha256').update(readFileSync(new URL(`../${file}`, import.meta.url))).digest('hex') }));
  writeFileSync(path.join(artifacts, 'ui-browser-evidence.json'), JSON.stringify({ kind: 'local development UI evidence; actual HTTP/Store/generator/processor with scripted host proposals and identified deterministic fake provider; no model quality evaluation', recordedAt: new Date().toISOString(), sources, browser: await browser.version(), origin: 'ephemeral loopback server', provider: syntheticProvider.identity, providerCalls: generationCalls.length, checks: outcomes, allChecksPassed: outcomes.every(outcome => outcome.passed), mutationCount: mutations.length, generationCancellationRequests: mutations.filter(mutation => mutation.path.startsWith('/api/generation/') && mutation.path.endsWith('/cancel')).length, processorErrors, scriptOrCspErrors: errors, blockedExternalRequestCount: blockedRequests.length }, null, 2));
});

function short(value) { return String(value).slice(0, 12); }
