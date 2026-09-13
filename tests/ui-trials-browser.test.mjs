import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Foundry } from '../src/foundry.mjs';
import { serveHttp } from '../src/http.mjs';
import { digest } from '../src/data.mjs';
import { appliedRunLinks } from '../web/app.js';

// FOUNDRY_UI_TRIALS_E2E=1 node --test tests/ui-trials-browser.test.mjs
// One Chromium/context/page, real HTTP/Store/Runtime, handwritten neutral inputs.
// No provider is constructed or called. Every invocation gets a fresh receipt
// directory, including failures. The synthetic workspace is kept with evidence.
const enabled = process.env.FOUNDRY_UI_TRIALS_E2E === '1';
const ref = $ref => ({ $ref });
const eq = (left, right) => ({ op: 'eq', left, right });
const task = (id, tool, args, needs = []) => ({ id, kind: 'task', description: `Neutral ${id} control`, needs, tool, args, timeoutMs: 1000, retry: { maxAttempts: 1 } });
const program = (id, nodes, acceptance) => ({ schemaVersion: '1.0', id, version: 1, title: `Neutral ${id} workflow`, domain: 'general',
  goal: 'Preserve the supplied values and inspect their actual execution.',
  envelope: { assumptions: ['Handwritten local integration controls'], risks: ['Mixing trial and applied workflow evidence'], successCriteria: ['The output preserves the supplied values.'] },
  budget: { maxSteps: 30, maxConcurrency: 1, maxDurationMs: 5000, maxCost: 0 }, nodes, acceptance });
function nested(wrong = false) {
  const workflow = program('UITrialNested', [{ id: 'each', kind: 'map', description: 'Inspect each neutral input', needs: [], items: ref('input.items'), maxItems: 2,
    body: { nodes: [task('echo', 'core.identity', { value: ref('item') })], acceptance: [eq(ref('nodes.echo.value'), ref('item'))] } },
  task('receipt', 'core.artifact', { name: 'neutral.txt', content: 'Handwritten local trial evidence.' }, ['each'])],
  [eq(ref('nodes.each.count'), wrong ? 99 : ref('input.count'))]);
  workflow.inputSchema = { type: 'object', additionalProperties: false, required: ['items', 'count'], properties: { items: { type: 'array', maxItems: 2, items: { type: 'string' } }, count: { type: 'integer' } } };
  return workflow;
}
const input = { items: ['violet', 'indigo'], count: 2 };
const root = fileURLToPath(new URL('../', import.meta.url));
const sha256 = value => createHash('sha256').update(value).digest('hex');
function sourceIdentity() {
  const files = ['web/app.js', 'web/index.html', 'web/style.css', 'tests/ui-trials-browser.test.mjs', 'package.json', 'package-lock.json', 'schemas/workflow.schema.json',
    ...readdirSync(path.join(root, 'src')).filter(name => name.endsWith('.mjs')).map(name => `src/${name}`)];
  return files.sort().map(file => ({ path: file, sha256: sha256(readFileSync(path.join(root, file))) }));
}

test('UI linkage selection refuses unrelated, unapplied and missing request identities', () => {
  const run = { id: 'run-observed', workflowHash: 'hash-observed', workflowId: 'WorkflowObserved' };
  const request = { id: 'request-observed', status: 'applied' };
  const proposal = { id: 'proposal-observed', requestId: request.id, status: 'applied', workflowHash: run.workflowHash, workflow: { id: run.workflowId } };
  assert.deepEqual(appliedRunLinks({ requests: [request], proposals: [proposal] }, run), [{ request, proposal }]);
  for (const change of [{ workflowHash: 'another-version' }, { workflow: { id: 'AnotherWorkflow' } }, { requestId: 'another-request' }, { status: 'proposed' }]) {
    assert.deepEqual(appliedRunLinks({ requests: [request], proposals: [{ ...proposal, ...change }] }, run), []);
  }
  assert.deepEqual(appliedRunLinks({ requests: [{ ...request, status: 'diagnostic' }], proposals: [proposal] }, run), []);
  assert.deepEqual(appliedRunLinks({ requests: [], proposals: [proposal] }, run), []);
  assert.deepEqual(appliedRunLinks({}, null), []);
});

test('UI draft trials and diagnostic repair through real local HTTP', { skip: !enabled, timeout: 120000 }, async t => {
  const artifactRoot = path.resolve(process.env.FOUNDRY_UI_ARTIFACTS ?? tmpdir());
  mkdirSync(artifactRoot, { recursive: true });
  const artifacts = mkdtempSync(path.join(artifactRoot, 'ui-trials-'));
  const workspace = path.join(artifacts, 'workspace');
  const beforeSources = sourceIdentity(), checks = [], errors = [], external = [], mutations = [], reads = [], setup = {};
  const foundry = new Foundry(workspace);
  let browser, http, page, browserVersion, fatal;
  const save = (name, value) => writeFileSync(path.join(artifacts, name), JSON.stringify(value, null, 2));
  async function check(name, fn) {
    const outcome = { name, passed: false }; checks.push(outcome);
    await t.test(name, async () => {
      try { await fn(); outcome.passed = true; }
      catch (error) {
        outcome.error = error.stack ?? error.message;
        if (page) await page.screenshot({ path: path.join(artifacts, `failure-${checks.length}.png`), caret: 'initial' }).catch(() => {});
        throw error;
      }
    });
  }
  async function failure(id) {
    const workflow = program(id, [task('echo', 'core.identity', { value: 'observed' })], [eq(ref('nodes.echo.value'), 'different')]);
    const request = foundry.store.createRequest({ text: `Preserve neutral values for ${id}; this is a handwritten integration fixture.` });
    const proposal = foundry.propose({ requestId: request.id, workflow, rationale: 'Handwritten failing acceptance control for diagnostic UI verification.' });
    const saved = foundry.apply(proposal.id), run = foundry.createRun(saved.hash, {});
    await foundry.startRun(run.id);
    assert.equal(foundry.store.run(run.id).status, 'failed');
    return { request: foundry.store.request(request.id), proposal: foundry.store.proposal(proposal.id), workflow, saved, run: foundry.inspectRun(run.id) };
  }
  try {
    const request = foundry.store.createAgentDesignRequest({ task: 'Relay a neutral request to preserve the ordered input values.' });
    const bad = nested(true), good = nested();
    const failedTrial = await foundry.trial({ requestId: request.id, workflow: bad, input });
    const passedTrial = await foundry.trial({ requestId: request.id, workflow: good, input });
    const rejectedTrial = await foundry.trial({ requestId: request.id, workflow: good, input: { items: false, count: 2 } });
    assert.equal(failedTrial.runStatus, 'failed'); assert.equal(passedTrial.runStatus, 'succeeded'); assert.equal(rejectedTrial.runStatus, 'input-rejected');
    assert.equal(foundry.store.request(request.id).status, 'diagnostic');
    assert.equal(foundry.store.workflows().length + foundry.store.runs().length, 0);
    const proposal = foundry.propose({ requestId: request.id, workflow: bad, rationale: 'Apply a deliberately different draft than the successful trial to expose any head substitution.' });
    const applied = foundry.apply(proposal.id);
    assert.notEqual(applied.hash, passedTrial.workflowHash);
    const humanRequest = foundry.store.createAgentDesignRequest({ task: 'Neutral paused draft for inspection only.' });
    const human = program('UITrialQuestion', [{ id: 'ask', kind: 'human', needs: [], description: 'A real answer would be needed', question: 'Inspect this neutral pause?', answerSchema: { type: 'boolean' } }], [eq(ref('nodes.ask.answer'), true)]);
    const pausedTrial = await foundry.trial({ requestId: humanRequest.id, workflow: human, input: {} });
    assert.equal(pausedTrial.runStatus, 'awaiting_human');
    const actualFailure = await failure('UIRepairObserved'), staleFailure = await failure('UIRepairStale');
    const originalRun = digest(foundry.store.run(actualFailure.run.id)), originalEvents = digest(foundry.store.events(actualFailure.run.id));
    Object.assign(setup, { request, failedTrial, passedTrial, rejectedTrial, pausedTrial, actualFailure, staleFailure, originalRun, originalEvents });
    save('fixtures-and-receipts.json', setup);
    save('original-failure-events.json', foundry.store.events(actualFailure.run.id));
    http = await serveHttp(foundry, { port: 0 });
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ headless: true, executablePath: '/usr/bin/chromium' });
    browserVersion = await browser.version();
    const context = await browser.newContext({ viewport: { width: 1720, height: 1100 }, colorScheme: 'dark', reducedMotion: 'reduce' });
    await context.route('**/*', route => {
      if (new URL(route.request().url()).origin === http.origin) return route.continue();
      external.push(route.request().url()); return route.abort();
    });
    page = await context.newPage(); page.setDefaultTimeout(8000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error' && !/\b(?:400|404|409)\b/.test(message.text())) errors.push(message.text()); });
    page.on('request', request => {
      const pathname = new URL(request.url()).pathname;
      if (request.method() === 'POST') mutations.push({ path: pathname, body: request.postDataJSON(), authenticated: Boolean(request.headers()['x-foundry-token']) });
      else if (pathname.startsWith('/api/')) reads.push(pathname);
    });
    const refresh = async () => {
      await Promise.all([page.waitForResponse(response => response.url() === `${http.origin}/api/state`), page.locator('#refresh').click()]);
    };
    const selectTrial = async id => {
      await page.locator('#trial-id').fill(id);
      await page.locator('#inspect-trial').click();
      await page.getByTestId('inspected-trial-id').filter({ hasText: id }).waitFor();
    };
    const selectRun = async id => {
      await page.getByRole('navigation', { name: 'Recent runs', exact: true }).getByRole('button').filter({ hasText: id.slice(0, 8) }).click();
      await page.locator('#run-controls').waitFor();
    };
    const noTrialControls = async () => {
      assert.equal(await page.locator('#open-run').isVisible(), false);
      assert.equal(await page.locator('#view-head').isVisible(), false);
      assert.equal(await page.locator('#run-controls').isVisible(), false);
      for (const name of ['Resume run', 'Approve operation', 'Reject operation', 'Cancel execution', 'Submit answer & continue', 'Open diagnostic repair']) {
        assert.equal(await page.getByRole('button', { name, exact: true }).count(), 0, `Trial must not expose ${name}`);
      }
    };
    await page.goto(http.origin);
    await page.locator('#connection[data-connected="true"]').waitFor();

    await check('successful draft graph and nested execution stay bound to exact trial hash', async () => {
      await page.locator(`#trial-list [data-trial-id="${passedTrial.id}"]`).click();
      await page.getByTestId('trial-source-hash').waitFor();
      assert.equal(await page.getByTestId('trial-source-hash').textContent(), passedTrial.workflowHash);
      assert.equal(await page.locator('#graph svg').getAttribute('data-workflow-hash'), passedTrial.workflowHash);
      assert.equal(await page.locator('#graph svg').getAttribute('data-trial-id'), passedTrial.id);
      assert.notEqual(passedTrial.workflowHash, foundry.store.workflow(good.id).hash);
      assert.match(await page.locator('#inspector-content').textContent(), /Isolated draft trial/);
      await page.locator('.graph-node[data-node-id="each"]').click();
      await page.getByRole('button', { name: 'Open nested flow ↳', exact: true }).click();
      assert.equal(await page.locator('.graph-node').count(), 1);
      await page.locator('.graph-node[data-node-id="echo"]').click();
      assert.match(await page.locator('#inspector-content').textContent(), /violet/);
      await page.locator('#iteration-select').selectOption('1');
      await page.locator('.graph-node[data-node-id="echo"]').click();
      assert.match(await page.locator('#inspector-content').textContent(), /indigo/);
      assert.equal(await page.locator('#graph svg').getAttribute('data-workflow-hash'), passedTrial.workflowHash);
      await refresh();
      assert.equal(await page.getByTestId('trial-source-hash').textContent(), passedTrial.workflowHash);
      await noTrialControls();
      assert.equal(await page.locator('#request-scope option[value="selected"]').isDisabled(), true);
      assert.match(await page.getByTestId('trial-qualification').textContent(), /Independent task unqualified/);
      await page.locator('#trial-inspection').scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(artifacts, 'trial-nested-dark.png'), caret: 'initial' });
      assert.equal(mutations.length, 0);
    });

    await check('opaque-ID lookup and returned artifact receipts preserve sibling failure evidence', async () => {
      await selectTrial(failedTrial.id);
      assert.equal(await page.getByTestId('trial-source-hash').textContent(), failedTrial.workflowHash);
      assert.match(await page.locator('#trial-inspection').textContent(), /Local acceptance not passed/);
      assert.equal(foundry.inspectTrial(failedTrial.id).run.status, 'failed');
      await selectTrial(passedTrial.id);
      await page.getByRole('button', { name: 'Inspect trial evidence', exact: true }).click();
      const shown = await page.locator(`[data-detail="trial-artifacts:${passedTrial.id}"] pre`).textContent();
      const inspection = foundry.inspectTrial(passedTrial.id);
      assert.deepEqual(JSON.parse(shown), inspection.artifactReceipts);
      assert.equal(inspection.artifactReceipts[0].sha256, sha256('Handwritten local trial evidence.'));
      assert.equal(inspection.taskOutcomeQualified, false);
      save('passed-trial-inspected.json', inspection);
      await noTrialControls();
    });

    await check('input rejection keeps a no-run receipt and never substitutes a saved graph', async () => {
      await selectTrial(rejectedTrial.id);
      const inspection = foundry.inspectTrial(rejectedTrial.id);
      save('input-rejected-inspected.json', inspection);
      assert.equal(inspection.run, null); assert.deepEqual(inspection.events, []);
      assert.match(await page.locator('#trial-inspection').textContent(), /Input rejected before execution/);
      assert.equal(await page.getByTestId('trial-source-hash').textContent(), rejectedTrial.workflowHash);
      setup.inputRejectedSourceAvailable = Boolean(inspection.workflow);
      if (inspection.workflow) {
        assert.equal(digest(inspection.workflow), rejectedTrial.workflowHash);
        assert.equal(await page.locator('#graph svg').getAttribute('data-workflow-hash'), rejectedTrial.workflowHash);
        assert.match(await page.locator('.graph-node').first().getAttribute('aria-label'), /Not executed/);
      } else {
        assert.equal(await page.locator('.graph-node').count(), 0);
        assert.match(await page.locator('#graph').textContent(), /Trial source unavailable/);
      }
      await noTrialControls();
    });

    await check('paused draft exposes inspection without human answers, approvals or resume', async () => {
      await selectTrial(pausedTrial.id);
      assert.match(await page.locator('.graph-node[data-node-id="ask"]').getAttribute('aria-label'), /Needs an answer/);
      await page.locator('.graph-node[data-node-id="ask"]').click();
      assert.match(await page.locator('#inspector-content').textContent(), /Inspect this neutral pause/);
      await noTrialControls();
      assert.equal(mutations.length, 0);
      await page.getByRole('button', { name: 'Load trial request context', exact: true }).click();
      const card = page.locator(`[data-request-id="${humanRequest.id}"]`);
      await card.getByText('Agent design request', { exact: true }).waitFor();
      assert.match(await card.getByTestId('diagnostic-provenance').textContent(), /Automatic generation is off/);
      assert.doesNotMatch(await card.textContent(), /Pending ·|Queued · automatic provider/);
    });

    let repair;
    await check('failed applied run opens diagnostic lineage and loads its real host context', async () => {
      await selectRun(actualFailure.run.id);
      const response = page.waitForResponse(result => result.url() === `${http.origin}/api/repair-requests` && result.request().method() === 'POST');
      await page.locator('#run-controls').getByRole('button', { name: 'Open diagnostic repair', exact: true }).click();
      const reply = await response; assert.equal(reply.status(), 201); repair = await reply.json();
      const card = page.locator(`[data-request-id="${repair.id}"]`);
      await card.locator(`[data-detail="context:${repair.id}"] pre`).waitFor();
      const hostContext = JSON.parse(await card.locator(`[data-detail="context:${repair.id}"] pre`).textContent());
      assert.equal(repair.source, 'agent-diagnostic'); assert.equal(repair.status, 'diagnostic'); assert.equal(repair.automaticGeneration, false);
      assert.equal(repair.parentRequestId, actualFailure.request.id); assert.equal(repair.rootRequestId, actualFailure.request.id);
      assert.equal(repair.appliedProposalId, actualFailure.proposal.id); assert.equal(repair.failedRunId, actualFailure.run.id);
      assert.equal(repair.baseHash, actualFailure.saved.hash); assert.equal(repair.text, actualFailure.request.text);
      assert.equal(hostContext.requestId, repair.id); assert.equal(hostContext.diagnosticRepair.failedRunId, actualFailure.run.id);
      assert.equal(hostContext.diagnosticRepair.automaticGeneration, false);
      assert.equal(hostContext.diagnosticRepair.preserveGoal, actualFailure.workflow.goal);
      assert.deepEqual(hostContext.diagnosticRepair.preserveSuccessCriteria, actualFailure.workflow.envelope.successCriteria);
      assert.ok(reads.includes(`/api/context/${repair.id}`));
      assert.deepEqual(mutations.find(item => item.path === '/api/repair-requests').body, { requestId: actualFailure.request.id, failedRunId: actualFailure.run.id, expectedHash: actualFailure.saved.hash });
      assert.equal(digest(foundry.store.run(actualFailure.run.id)), originalRun);
      assert.equal(digest(foundry.store.events(actualFailure.run.id)), originalEvents);
      assert.equal(foundry.store.pendingRequests().length, 0); assert.equal(foundry.store.generationJobs().length, 0);
      save('diagnostic-context.json', hostContext); save('diagnostic-request.json', repair);
      await card.screenshot({ path: path.join(artifacts, 'diagnostic-context-dark.png'), caret: 'initial' });
      await selectRun(actualFailure.run.id);
      assert.equal(await page.locator('#run-controls').getByRole('button', { name: 'Open diagnostic repair', exact: true }).count(), 0);
      await page.locator('#run-controls').getByRole('button', { name: 'Inspect diagnostic repair', exact: true }).click();
      assert.equal(foundry.store.requests().filter(item => item.failedRunId === actualFailure.run.id).length, 1);
    });

    await check('global automatic configuration cannot relabel diagnostic requests as a spending queue', async () => {
      // Configuration presentation only. There is no provider function or processor.
      foundry.generator = { provider: { identity: { name: 'Offline configuration control', model: 'none' } }, options: { autoApply: true } };
      await refresh();
      await page.locator('#tab-changes').click();
      const card = page.locator(`[data-request-id="${repair.id}"]`);
      assert.match(await page.locator('#agent-status').textContent(), /Automatic apply/);
      assert.match(await card.getByTestId('diagnostic-provenance').textContent(), /Automatic generation is off/);
      assert.doesNotMatch(await card.textContent(), /Pending ·|Queued · automatic provider/);
      assert.equal(foundry.store.generationJobs().length, 0);
      foundry.generator = null;
    });

    await check('delivery inspection keeps exact IDs and separately scoped suite evidence unqualified for the run', async () => {
      foundry.store.recordQualification({ workflowHash: actualFailure.saved.hash, registryHash: foundry.registry.hash(), evaluatorId: 'handwritten-local-suite-control', qualificationLevel: 'task-outcome', passed: true, split: 'development', envelope: ['A separate neutral suite; not this run input'] });
      await selectRun(actualFailure.run.id);
      await page.locator('#run-controls').getByRole('button', { name: 'Inspect delivery linkage', exact: true }).click();
      const key = `${actualFailure.request.id}:${actualFailure.proposal.id}:${actualFailure.run.id}`;
      const details = page.locator(`#run-controls [data-detail="delivery:${key}"] pre`);
      await details.waitFor();
      const receipt = JSON.parse(await details.textContent());
      assert.equal(receipt.requestId, actualFailure.request.id); assert.equal(receipt.proposalId, actualFailure.proposal.id); assert.equal(receipt.runId, actualFailure.run.id);
      assert.equal(receipt.workflowHash, actualFailure.saved.hash); assert.equal(receipt.localExecutionSucceeded, false);
      assert.equal(receipt.independentTaskVerified, false); assert.equal(receipt.matchedTaskEvidence[0].passed, true);
      assert.match(await page.locator('#run-controls').getByTestId('delivery-qualification').textContent(), /Independent task verification is not established for this run/);
      save('delivery-inspected.json', receipt);
      assert.deepEqual(mutations.find(item => item.path === '/api/delivery').body, { requestId: actualFailure.request.id, proposalId: actualFailure.proposal.id, runId: actualFailure.run.id });
    });

    await check('current-head race returns a visible stale error without creating or rebinding a repair', async () => {
      await selectRun(staleFailure.run.id);
      const requestsBefore = foundry.store.requests().length;
      const routePattern = `${http.origin}/api/repair-requests`;
      await context.route(routePattern, async route => {
        const newer = structuredClone(staleFailure.workflow); newer.version = 2; newer.title = 'Neutral concurrent head';
        foundry.save(newer, staleFailure.saved.hash);
        await route.continue();
      }, { times: 1 });
      const response = page.waitForResponse(result => result.url() === routePattern);
      await page.locator('#run-controls').getByRole('button', { name: 'Open diagnostic repair', exact: true }).click();
      assert.equal((await response).status(), 409);
      await page.locator('#error-notice').getByText(/STALE_WORKFLOW/).waitFor();
      assert.equal(foundry.store.requests().length, requestsBefore);
      assert.equal(foundry.store.run(staleFailure.run.id).workflowHash, staleFailure.saved.hash);
      assert.equal(await page.locator('#run-controls').getByRole('button', { name: 'Open diagnostic repair', exact: true }).count(), 0);
      assert.match(await page.getByTestId('selected-hash').getAttribute('title'), new RegExp(staleFailure.saved.hash));
    });

    await check('artifact verification error and missing opaque ID retain an explicitly historical snapshot', async () => {
      await selectTrial(passedTrial.id);
      const original = foundry.store.trial(passedTrial.id);
      const file = path.join(foundry.store.directory, 'trials', passedTrial.id, '.foundry', 'artifacts', passedTrial.runId, 'neutral.txt');
      writeFileSync(file, 'Deliberately modified local test artifact.');
      const rejected = page.waitForResponse(result => result.url() === `${http.origin}/api/trials/${passedTrial.id}`);
      await refresh(); assert.equal((await rejected).status(), 400);
      await page.locator('#trial-inspection').getByText(/Last inspected snapshot; refresh failed/).waitFor();
      assert.equal(await page.locator('#graph svg').getAttribute('data-workflow-hash'), passedTrial.workflowHash);
      assert.deepEqual(foundry.store.trial(passedTrial.id), original);
      await page.locator('#trial-id').fill('missing-neutral-trial');
      await page.locator('#inspect-trial').click();
      await page.locator('#error-notice').getByText(/NOT_FOUND/).waitFor();
      assert.equal(await page.getByTestId('inspected-trial-id').textContent(), passedTrial.id);
      await noTrialControls();
      save('preserved-trial-after-verification-error.json', original);
    });

    await check('responsive UI uses authenticated local actions and records no browser or external errors', async () => {
      await selectTrial(failedTrial.id);
      await page.locator('#theme-toggle').click();
      await page.setViewportSize({ width: 390, height: 844 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await page.locator('#trial-inspection').screenshot({ path: path.join(artifacts, 'trial-mobile-light.png'), caret: 'initial' });
      assert.equal(await page.evaluate(() => document.querySelectorAll('[style], style').length), 0);
      assert.ok(mutations.length >= 3); assert.ok(mutations.every(item => item.authenticated));
      assert.ok(mutations.every(item => ['/api/repair-requests', '/api/delivery'].includes(item.path)));
      assert.deepEqual(errors, []); assert.deepEqual(external, []);
      assert.equal(foundry.store.generationJobs().length, 0);
      assert.equal(digest(foundry.store.events(actualFailure.run.id)), originalEvents);
      save('preserved-failure-events.json', foundry.store.events(actualFailure.run.id));
    });
  } catch (error) { fatal = error.stack ?? error.message; throw error; }
  finally {
    const afterSources = sourceIdentity();
    save('ui-trials-browser-evidence.json', { kind: 'Offline handwritten UI integration controls; no model-quality evidence', recordedAt: new Date().toISOString(),
      browser: browserVersion ?? null, externalModelCalls: 0, workspace, sourceBefore: beforeSources, sourceAfter: afterSources,
      sourcesStable: JSON.stringify(beforeSources) === JSON.stringify(afterSources), inputRejectedSourceAvailable: setup.inputRejectedSourceAvailable ?? null,
      checks, allChecksPassed: !fatal && checks.length === 10 && checks.every(item => item.passed), fatal: fatal ?? null, browserErrors: errors, blockedExternalRequests: external, mutations, reads });
    console.log(`UI trial evidence: ${artifacts}`);
    await browser?.close(); await http?.close(); await foundry.close();
  }
});
