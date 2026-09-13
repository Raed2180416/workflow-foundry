#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { sha256, readJSON, writeJSON, verifyClosure } from './freeze.mjs';

if (process.env.FOUNDRY_UI_RECOVERY !== '1') throw new Error('FOUNDRY_UI_RECOVERY=1 is required for the explicitly synthetic browser recovery controls.');
const campaign = path.resolve(process.argv[2] ?? '');
const closure = readJSON(path.join(campaign, 'closure.json'));
assert.equal(verifyClosure(closure.snapshot, closure, { external: true }).verified, true);
const directory = mkdtempSync(path.join(campaign, 'recovery-'));
const workspace = path.join(directory, 'workspace');
const script = fileURLToPath(import.meta.url);
writeJSON(path.join(directory, 'control-inputs.json'), { synthetic: true, modelCalls: 0, sourceClosureSHA256: closure.closureSHA256, runner: { path: script, sha256: sha256(readFileSync(script)) }, checks: ['manual refresh retains in-memory draft', 'page reload retains durable pending question', 'network reconnect', 'actual CLI server restart', 'old token rejection', 'reload restores write capability', 'typed answer resumes original run'] });
const { Foundry } = await import(pathToFileURL(path.join(closure.snapshot, 'src/foundry.mjs')));
const { chromium } = await import(pathToFileURL(path.join(closure.snapshot, 'node_modules/playwright/index.mjs')));
const fixture = { schemaVersion: '1.0', id: 'SyntheticRecovery', version: 1, title: 'Synthetic control: recover a pending review', goal: 'Exercise refresh and actual CLI restart using a durable human question.', domain: 'diagnostic',
  envelope: { assumptions: ['Synthetic browser control; no model calls'], risks: [], successCriteria: ['A recorded answer resumes the original run'] }, budget: { maxSteps: 10, maxConcurrency: 1, maxDurationMs: 180000, maxCost: 0 },
  nodes: [{ id: 'review', kind: 'human', needs: [], description: 'Pause for a typed review note', question: 'Enter the review note after reconnection.', answerSchema: { type: 'string', minLength: 3 } },
    { id: 'echo', kind: 'task', needs: ['review'], description: 'Preserve the actual operator note', tool: 'core.identity', args: { note: { $ref: 'nodes.review.answer' } }, timeoutMs: 1000, retry: { maxAttempts: 1 } }],
  acceptance: [{ op: 'eq', left: { $ref: 'nodes.echo.note' }, right: 'Ready after reconnect.' }] };
const seeded = new Foundry(workspace); const saved = seeded.save(fixture); await seeded.close();
const report = { synthetic: true, modelCalls: 0, directory, startedAt: new Date().toISOString(), checks: [], passed: false };
const network = [], errors = [], cli = [];
let child, browser, page, context, origin, port = 0, imageNumber = 0, logNumber = 0;
async function start() {
  const index = ++logNumber;
  const argv = [path.join(closure.snapshot, 'bin/foundry.mjs'), 'serve', '--workspace', workspace, '--port', String(port)];
  const logs = { argv: [process.execPath, ...argv], stdout: '', stderr: '' }; cli.push(logs);
  child = spawn(process.execPath, argv, { cwd: closure.snapshot, env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', data => { logs.stdout += data.toString(); });
  child.stderr.on('data', data => { logs.stderr += data.toString(); });
  child.once('exit', (code, signal) => { logs.exitCode = code; logs.signal = signal; });
  const value = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('CLI startup timed out')), 15000);
    const read = () => { try { const parsed = JSON.parse(logs.stdout); if (parsed.ui) { clearTimeout(timer); child.stdout.off('data', read); resolve(parsed); } } catch { /* stdout JSON can arrive in chunks. */ } };
    child.stdout.on('data', read); child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', () => { clearTimeout(timer); reject(new Error(`CLI exited during startup: ${logs.stderr}`)); }); read();
  });
  origin = value.ui; port = Number(new URL(origin).port);
  writeJSON(path.join(directory, `cli-start-${index}.json`), { argv: logs.argv, observed: value });
}
async function stop() {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const ended = once(child, 'exit');
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 10000);
  try { await ended; } finally { clearTimeout(timer); }
}
async function screenshot(name) {
  const stem = `${String(++imageNumber).padStart(2, '0')}-${name}`;
  writeFileSync(path.join(directory, `${stem}.txt`), await page.locator('body').ariaSnapshot(), { flag: 'wx', mode: 0o600 });
  await page.screenshot({ path: path.join(directory, `${stem}.png`), fullPage: true, caret: 'initial' });
}
try {
  await start();
  browser = await chromium.launch({ headless: true, executablePath: '/usr/bin/chromium' });
  context = await browser.newContext({ viewport: { width: 1720, height: 1100 }, colorScheme: 'dark', reducedMotion: 'reduce' });
  await context.route('**/*', route => route.request().url().startsWith(`${origin}/`) ? route.continue() : route.abort());
  page = await context.newPage(); page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { const request = response.request(); if (request.method() === 'POST') network.push({ path: new URL(request.url()).pathname, status: response.status(), authenticated: Boolean(request.headers()['x-foundry-token']), body: request.postDataJSON() }); });
  await page.goto(origin);
  await page.getByRole('heading', { name: fixture.title, exact: true, level: 1 }).waitFor();
  await page.locator('#open-run').click();
  const creation = page.waitForResponse(r => new URL(r.url()).pathname === '/api/runs' && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Start this version', exact: true }).click();
  const started = await (await creation).json(); report.runId = started.id; report.workflowHash = started.workflowHash;
  const card = page.locator('[data-question="root/review"]');
  const answer = card.getByRole('textbox', { name: 'Answer text', exact: true });
  await answer.fill('A draft before refresh.');
  await Promise.all([page.waitForResponse(r => new URL(r.url()).pathname === '/api/state'), page.locator('#refresh').click()]);
  assert.equal(await answer.inputValue(), 'A draft before refresh.');
  report.checks.push({ name: 'manual-refresh-keeps-draft', passed: true });
  await page.reload();
  await page.locator('#run-list').getByRole('button').filter({ hasText: started.id.slice(0, 8) }).click();
  await answer.waitFor();
  report.unsentDraftRestoredAcrossPageReload = (await answer.inputValue()) === 'A draft before refresh.';
  assert.equal(await page.locator('[data-testid="selected-hash"]').getAttribute('title'), saved.hash);
  report.checks.push({ name: 'page-reload-restores-pending-question-and-pin', passed: true });
  await screenshot('reloaded-pending-question');
  await context.setOffline(true);
  await page.getByText('Disconnected · retrying', { exact: true }).waitFor();
  await screenshot('network-disconnected');
  await context.setOffline(false);
  await page.getByText('Local · connected', { exact: true }).waitFor();
  report.checks.push({ name: 'network-reconnects', passed: true });
  await stop();
  await page.getByText('Disconnected · retrying', { exact: true }).waitFor();
  await start();
  await page.getByText('Local · connected', { exact: true }).waitFor();
  await answer.fill('Ready after reconnect.');
  const stale = page.waitForResponse(r => new URL(r.url()).pathname === `/api/runs/${started.id}/answers`);
  await card.getByRole('button', { name: 'Submit answer & continue', exact: true }).click();
  const rejected = await stale;
  report.staleTokenStatus = rejected.status();
  assert.equal(rejected.status(), 403);
  await card.getByRole('alert').getByText(/HTTP_TOKEN/).waitFor();
  await screenshot('restarted-server-requires-page-reload');
  report.checks.push({ name: 'server-restart-retains-question-and-rejects-old-token', passed: true });
  await page.reload();
  await page.locator('#run-list').getByRole('button').filter({ hasText: started.id.slice(0, 8) }).click();
  await answer.fill('Ready after reconnect.');
  await card.getByRole('button', { name: 'Submit answer & continue', exact: true }).click();
  await page.locator('#run-controls .run-summary').getByText('Succeeded', { exact: true }).waitFor();
  const result = await page.evaluate(async id => (await fetch(`/api/runs/${id}`)).json(), started.id);
  assert.equal(result.workflowHash, saved.hash);
  assert.equal(result.outputs.echo.note, 'Ready after reconnect.');
  writeJSON(path.join(directory, 'recovered-run.json'), result);
  await screenshot('recovered-original-run');
  report.checks.push({ name: 'reload-and-answer-complete-original-run', passed: true });
  assert.deepEqual(errors, []);
  assert.ok(network.every(row => row.authenticated));
  report.passed = true;
} catch (error) {
  report.error = { message: error.message, stack: error.stack }; process.exitCode = 1;
  if (page) try { await screenshot('failure'); } catch { /* Keep initial failure. */ }
} finally {
  await browser?.close(); await stop();
  report.finishedAt = new Date().toISOString(); report.sourceIntegrity = verifyClosure(closure.snapshot, closure, { external: true });
  report.errors = errors; report.cleanup = { browserClosed: !browser?.isConnected(), serverStopped: !!child && (child.exitCode !== null || child.signalCode !== null) };
  if (!report.sourceIntegrity.verified) { report.passed = false; process.exitCode = 1; }
  writeJSON(path.join(directory, 'network.json'), network); writeJSON(path.join(directory, 'cli.json'), cli); writeJSON(path.join(directory, 'result.json'), report);
  console.log(JSON.stringify(report, null, 2));
}
