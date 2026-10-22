// P5, the auditor (SPEC §7.4, §16): from the runs list to a checked record and an evidence file in at most 3 actions. The file is
// checked against the page (chain head), against the ledger (who turned it on, through which channel) and for its stated gaps.
// Development evidence, scripted, no users. nice node --test --test-concurrency=1 app/site/test/journeys/p5-auditor.mjs
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { journey, closeBrowser, assertBudget, NOW } from './harness.mjs';
import { invoiceFlowOn, liveInvoices } from '../../../onboarding/test/helpers.mjs';
import { Batches, listDigest } from '../../../onboarding/batch.mjs';
import { recordDecisions } from '../../../onboarding/decisions.mjs';
import { spawnSync } from 'node:child_process';
import { CLI } from '../../../cli.mjs';

after(closeBrowser);

test('P5 auditor: runs -> a run -> "Record consistent" -> evidence download, in 3 actions; the file matches the page, the ledger and its own check', async () => {
  const budgets = { evidence: { steps: 3 } };
  const log = await journey({ name: 'p5-auditor', budgets, before: async app => {
    recordDecisions(app);
    const p = await invoiceFlowOn(app); liveInvoices(app);
    const batches = new Batches(app, { now: () => NOW });
    const b = await batches.preview(p.flowId);
    await batches.approve(b.batchId, { channel: 'dashboard', listDigest: listDigest(b) });
  } }, async ({ page, person, shot, mark, app, log }) => {
    const checks = log.checks = {};
    person.precondition('the operator ran "Chase unpaid invoices" once and approved its exact list of 4 drafts in the page (as in P2)');
    await shot('home');
    await person.click(page.locator('[data-nav="runs"]'));
    await page.waitForSelector('main a[href^="#/runs/"]');
    await shot('runs');
    await person.click(page.locator('main a[href^="#/runs/"]').first());
    await page.waitForSelector('[data-record="verified"]');
    checks.record = (await page.locator('[data-record]').textContent()).replace(/\s+/g, ' ').trim();
    assert.match(checks.record, /Record consistent: \d+ entries, each linked to the one before\./);
    const headOnPage = (await page.locator('[data-record] details p').textContent()).split(': ').pop().trim();
    await shot('run-record-checked');
    const [download] = await Promise.all([page.waitForEvent('download'), person.click(page.locator('[data-action="evidence"]'))]);
    mark('evidence');
    const ev = JSON.parse(readFileSync(await download.path(), 'utf8'));
    assert.equal(ev.chain.verified, true); assert.equal(ev.chain.head, headOnPage, 'the file and the page name the same chain head');
    assert.equal(ev.chain.events, Number(checks.record.match(/(\d+) entries/)[1]));
    assert.ok(ev.ledger.some(r => r.status === 'approved' && r.channel === 'dashboard'), 'who turned it on, and through which channel');
    checks.decisionEvents = [...new Set(ev.actionDecisions.map(d => d.type))];
    const decided = ev.actionDecisions.filter(d => d.type === 'approval.decided');
    assert.equal(decided.length, 4, 'one decision per draft on the list'); assert.equal(new Set(decided.map(d => d.approvalId)).size, 4);
    assert.equal(decided.every(d => d.approved === true), true);
    assert.equal(ev.batch?.decision?.channel, 'dashboard'); assert.match(ev.batch?.decision?.by ?? '', /^\S+@\S+$|\(\S+@\S+\)$/, 'the list decision names the account that made it');
    assert.equal(decided.every(d => d.fromList?.batchId === ev.batch.batchId), true, 'each applied yes names the list it came from');
    assert.equal(ev.personDecisions?.check?.ok, true);
    assert.ok(ev.personDecisions.lines.some(l => l.kind === 'list' && l.decision === 'approved'), 'the list decision is in the chained decision log');
    // An auditor re-checks the file on their own, without the page (P5 walkthrough: "the file should be checkable by itself").
    const file = await download.path();
    person.external('runs: node app/cli.mjs check-evidence <file>');
    const cli = spawnSync(process.execPath, [CLI, 'check-evidence', file], { encoding: 'utf8' });
    checks.cliCheck = cli.stdout.trim().slice(0, 300);
    assert.equal(cli.status, 0, cli.stderr); assert.match(cli.stdout, /^Consistent: /);
    assert.ok(Array.isArray(ev.gaps) && ev.gaps.length >= 3, 'the file states what it does not hold');
    checks.evidence = { file: download.suggestedFilename(), events: ev.chain.events, head: ev.chain.head.slice(0, 12), ledger: ev.ledger.map(r => `${r.status} via ${r.channel}`), actionDecisions: decided.length, listDecidedBy: ev.batch.decision.by, personDecisions: ev.personDecisions.lines.length, gaps: ev.gaps.length };
    await shot('evidence-downloaded');
    assert.equal(app.list().flows.length, 1);
  });
  assertBudget(log, 'evidence', budgets.evidence);
});
