#!/usr/bin/env node
// Opt-in browser check of the dashboard (needs Playwright's Chromium): builds a workspace with a finished run, a refused send, a paused
// send and a version-2 draft, opens the page, fails on any console or page error, and writes two screenshots.
//   node app/dashboard/browser-check.mjs OUT_DIR [CHROMIUM=/opt/pw-browsers/chromium]
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import { FoundryApp } from '../core/service.mjs';
import { createDashboard } from './server.mjs';
const app = new FoundryApp({ workspace: mkdtempSync(path.join(tmpdir(), 'shot-')) });
const M = 'can you send my boss a weekly summary of what the Platform team finished? only to her: boss@example.com';
const WEEK = { weekOf: '2026-10-19', items: [{ title: 'Ship login fix', status: 'done', owner: 'Sam' }, { title: 'Billing table', status: 'open' }, { title: 'Vendor contract', status: 'blocked' }] };
const p = await app.propose({ request: M }); await app.dryRun({ proposalId: p.proposalId });
const a = app.requestApproval({ proposalId: p.proposalId }); app.decideActivation(a.approvalId, true, { channel: 'cli' });
const r1 = await app.run({ flowId: p.flowId, input: WEEK }); await app.decideAction(r1.runId, r1.pendingApprovals[0].approvalId, true, { channel: 'cli' });
const r2 = await app.run({ flowId: p.flowId, input: WEEK }); await app.decideAction(r2.runId, r2.pendingApprovals[0].approvalId, false, { channel: 'cli' });
await app.run({ flowId: p.flowId, input: WEEK });
const p2 = await app.propose({ request: M.replace('boss@', 'cto@'), flowId: p.flowId }); await app.dryRun({ proposalId: p2.proposalId }); app.requestApproval({ proposalId: p2.proposalId });
const dash = createDashboard(app); const { url } = await dash.listen(0);
const browser = await chromium.launch({ executablePath: process.argv[3] ?? '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 1500 } });
const errors = []; page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); page.on('pageerror', e => errors.push(String(e)));
await page.goto(url); await page.waitForSelector('#inbox .card');
await page.screenshot({ path: process.argv[2] + '/dash-overview.png', fullPage: true });
await page.click('#runs tbody tr:nth-child(3) button'); await page.waitForSelector('#detail-body .card');
await page.screenshot({ path: process.argv[2] + '/dash-run.png', fullPage: true });
const texts = await page.locator('#inbox .card h3').allTextContents();
console.log(JSON.stringify({ errors, inbox: texts, url: page.url() }));
process.exitCode = errors.length ? 1 : 0;
await browser.close(); await dash.close(); await app.close();
