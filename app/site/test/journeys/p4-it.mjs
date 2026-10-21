// P4, IT on a managed computer (SPEC §7.4, §16): Foundry notices the organisation's Claude Code policy folder, offers a one-page
// brief generated from the automation's own record (2 actions), practice-only mode (1 action), tests the person's own list instead
// of running it, and shows the exact allowlist entry on the Trust page. A second journey: practice-only set by an organisation
// policy file (FOUNDRY_POLICY_FILE stands in for /etc/foundry/policy.json), which Settings cannot turn off. Development evidence, scripted, no users.
// nice node --test --test-concurrency=1 app/site/test/journeys/p4-it.mjs
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { journey, closeBrowser, assertBudget, fixturePath } from './harness.mjs';
import { invoiceFlowOn, liveInvoices } from '../../../onboarding/test/helpers.mjs';
import { connectInstructions } from '../../../cli.mjs';

after(closeBrowser);

const text = async (page, sel) => (await page.locator(sel).first().textContent())?.replace(/\s+/g, ' ').trim() ?? '';

test('P4 IT: managed policy noticed; brief in 2 actions; practice-only in 1; a test on the real list instead of a run; the exact allowlist entry', async () => {
  const budgets = { brief: { steps: 2 }, practiceOnly: { steps: 1, since: 'beforePracticeOnly' } };
  const log = await journey({ name: 'p4-it', budgets, env: { FOUNDRY_MANAGED_DIR: fixturePath('managed/etc-claude-code') },
    before: async app => { await invoiceFlowOn(app); liveInvoices(app); } }, async ({ page, person, shot, mark, app, dir, log }) => {
    const checks = log.checks = {};
    person.precondition('the operator made "Chase unpaid invoices", tested it and turned it on (as in P2); their invoice list is in Foundry');
    person.precondition('the organisation manages Claude Code on this computer (a stand-in managed-settings.json in FOUNDRY_MANAGED_DIR)');
    await page.waitForSelector('[data-managed]');
    checks.managed = await text(page, '[data-managed] h2');
    await shot('home-managed', { note: 'Foundry noticed the managed policy folder (read-only: it lists the folder, it does not change it)' });
    await person.click(page.locator('[data-managed] a.button'));
    await page.waitForSelector('[data-brief-section="Allowlist entry (exact)"]');
    const head = app.list().flows[0];
    const brief = await text(page, 'main');
    assert.ok(brief.includes(head.workflowHash), 'the brief names the exact workflow hash');
    const allow = JSON.parse(await page.locator('[data-brief-section="Allowlist entry (exact)"] pre').textContent());
    assert.deepEqual(allow.allowedMcpServers[0].serverCommand, connectInstructions(dir).allowlist.serverCommand, 'the allowlist argv is the one the connect line starts');
    assert.equal(await page.locator('[data-brief-section="Suggested pilot terms"]').count(), 1);
    assert.match(brief, /could do what you can do, including approve/);
    await shot('it-brief', { note: 'generated on this computer from the automation\'s own record' });
    const [download] = await Promise.all([page.waitForEvent('download'), person.click(page.locator('[data-action="brief-md"]'))]);
    const md = readFileSync(await download.path(), 'utf8');
    assert.ok(md.includes(head.workflowHash)); assert.match(md, /Suggested pilot terms/); assert.match(md, /including approve/);
    mark('brief');
    checks.briefFile = download.suggestedFilename();
    await shot('brief-downloaded');
    await person.click(page.locator('[data-nav="home"]'));
    await page.waitForSelector('[data-managed] [data-action="practice-only"]');
    mark('beforePracticeOnly');
    await person.click(page.locator('[data-managed] [data-action="practice-only"]'));
    await page.waitForSelector('#practice-only:checked');
    mark('practiceOnly');
    assert.equal(app.practiceOnly(), true);
    await shot('practice-only-on', { note: 'one action from the managed card; enforced by the service for the page, the command line and MCP alike' });
    // Practice-only: the go-live page tests the person's own list and makes nothing; a neutral note, not a red error (P4 walkthrough M8).
    await person.click(page.locator('[data-nav="automations"]'));
    await person.click(page.locator('main a[href^="#/automations/"]').first());
    await person.click(page.locator('main .actions a.button.primary'));
    await page.waitForSelector('[data-action="test-on-list"]');
    checks.banner = await text(page, 'main [data-practice-only]');
    assert.match(checks.banner, /Practice-only mode is on for this pilot/);
    assert.equal(await page.locator('[data-action="make-list"]').count(), 0, 'no button that would be refused');
    await shot('practice-only-go-live', { note: 'a test on the person\'s list instead of a run; nothing is made' });
    await person.click(page.locator('[data-action="test-on-list"]'));
    await page.waitForSelector('[data-turn-on], main .pretend');
    checks.testedOn = await text(page, 'main .pretend');
    assert.match(checks.testedOn, /your own list/);
    assert.equal(log.refusals.length, 0, 'nothing was refused: nothing was attempted');
    assert.equal(app.list().flows[0].runs?.some?.(r => r.live) ?? false, false);
    await shot('tested-on-list', { note: 'what a run would make on the real list, made in a practice folder' });
    // The Trust page: the same allowlist entry, the honest limit.
    await person.click(page.locator('footer a[href="#/trust"]'));
    await page.waitForSelector('[data-same-user-limit]');
    checks.trustAllowlist = (await page.locator('main pre').allTextContents()).some(p => p.includes(connectInstructions(dir).allowlist.serverCommand[1]));
    assert.equal(checks.trustAllowlist, true);
    await shot('trust');
  });
  assertBudget(log, 'brief', budgets.brief); assertBudget(log, 'practiceOnly', budgets.practiceOnly);
});

test('P4 IT, organisation policy file: practice-only and Allowed AI are locked in Settings, and the brief says so', async () => {
  const policyDir = mkdtempSync(path.join(tmpdir(), 'foundry-policy-'));
  const policyFile = path.join(policyDir, 'policy.json');
  writeFileSync(policyFile, JSON.stringify({ mode: 'practice-only', allowedAI: 'none' }));
  try {
    await journey({ name: 'p4-policy', env: { FOUNDRY_POLICY_FILE: policyFile }, before: async app => { await invoiceFlowOn(app); liveInvoices(app); } }, async ({ page, person, shot, app, log }) => {
      const checks = log.checks = {};
      person.precondition('IT placed a policy file (here FOUNDRY_POLICY_FILE; on a real computer /etc/foundry/policy.json, owned by root)');
      assert.equal(app.practiceOnly(), true);
      await person.click(page.locator('footer a[href="#/settings"]'));
      await page.waitForSelector('#practice-only');
      checks.locked = { practiceOnly: await page.locator('#practice-only').isDisabled(), checked: await page.locator('#practice-only').isChecked() };
      assert.deepEqual(checks.locked, { practiceOnly: true, checked: true });
      checks.managedNote = await text(page, 'main [data-managed-setting]');
      assert.match(checks.managedNote, /organisation/i);
      await shot('settings-locked', { note: 'set by the organisation: shown, not changeable here' });
      const status = await page.evaluate(async () => (await fetch('/api/settings', { method: 'POST', headers: { 'content-type': 'application/json', 'x-foundry-token': sessionStorage.getItem('foundry-token') }, body: JSON.stringify({ mode: 'normal' }) })).status);
      assert.equal(status >= 400, true, 'the API refuses to lift it too');
      checks.apiRefused = status;
      const flowId = app.list().flows[0].flowId;
      await page.goto(`${new URL(page.url()).origin}/#/it-brief/${flowId}`);
      await page.waitForSelector('[data-brief-section="What leaves this computer"]');
      checks.allowedAI = await text(page, '[data-brief-section="What leaves this computer"]');
      assert.match(checks.allowedAI, /set by your organisation/);
      await shot('brief-policy', { note: 'the brief names the organisation setting' });
    });
  } finally { rmSync(policyDir, { recursive: true, force: true }); }
});
