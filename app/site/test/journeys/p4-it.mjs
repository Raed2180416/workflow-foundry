// P4, IT on a managed computer (SPEC §7.4, §16): Foundry notices the organisation's Claude Code policy folder, offers a one-page
// brief generated from the automation's own record (2 actions), practice-only mode (1 action), refuses a live run in plain words,
// and shows the exact allowlist entry on the Trust page. Development evidence, scripted, no users.
// nice node --test --test-concurrency=1 app/site/test/journeys/p4-it.mjs
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { journey, closeBrowser, assertBudget, fixturePath } from './harness.mjs';
import { invoiceFlowOn, liveInvoices } from '../../../onboarding/test/helpers.mjs';
import { connectInstructions } from '../../../cli.mjs';

after(closeBrowser);

const text = async (page, sel) => (await page.locator(sel).first().textContent())?.replace(/\s+/g, ' ').trim() ?? '';

test('P4 IT: managed policy noticed; brief in 2 actions; practice-only in 1; a live run refused in plain words; the exact allowlist entry', async () => {
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
    await page.waitForSelector('[data-managed] button');
    mark('beforePracticeOnly');
    await person.click(page.locator('[data-managed] button'));
    await page.waitForSelector('#practice-only:checked');
    mark('practiceOnly');
    assert.equal(app.practiceOnly(), true);
    await shot('practice-only-on', { note: 'one action from the managed card; enforced by the service for the page, the command line and MCP alike' });
    // A live run is refused in plain words; a test still works.
    await person.click(page.locator('[data-nav="automations"]'));
    await person.click(page.locator('main a[href^="#/automations/"]').first());
    await person.click(page.locator('main .actions a.button.primary'));
    await page.waitForSelector('[data-action="make-list"]');
    checks.banner = await text(page, 'main .banner.wait');
    assert.match(checks.banner, /Practice-only mode is on/);
    await person.click(page.locator('[data-action="make-list"]'));
    await page.waitForSelector('main [data-error-panel]');
    checks.refused = await text(page, 'main [data-error-panel]');
    assert.match(checks.refused, /Practice-only mode is on, so nothing runs for real on this computer/);
    assert.equal(await page.locator('main [data-error-panel] [data-error-action] a, main [data-error-panel] [data-error-action] button').count() >= 1, true, 'the refusal says what to do');
    assert.deepEqual(log.refusals.map(r => r.split(' ')[0]), ['409']);
    await shot('run-refused');
    // The Trust page: the same allowlist entry, the honest limit.
    await person.click(page.locator('footer a[href="#/trust"]'));
    await page.waitForSelector('[data-same-user-limit]');
    checks.trustAllowlist = (await page.locator('main pre').allTextContents()).some(p => p.includes(connectInstructions(dir).allowlist.serverCommand[1]));
    assert.equal(checks.trustAllowlist, true);
    await shot('trust');
  });
  assertBudget(log, 'brief', budgets.brief); assertBudget(log, 'practiceOnly', budgets.practiceOnly);
});
