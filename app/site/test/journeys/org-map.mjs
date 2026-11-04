// ORG, "Who decides what" (SPEC §8, §16): a small team's authority map to version 1 in at most 12 actions; the rule a rule owner
// set then refuses a wider limit on the expense card ("Set by Dana"); a later change that flips one confirmed example is blocked
// until the person re-confirms it, then saved as version 2. 1280 light and 390 dark. Development evidence, scripted, no users.
// The map is checked when an automation is made; it is not enforced while automations run (the page says so).
// nice node --test --test-concurrency=1 app/site/test/journeys/org-map.mjs
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { journey, closeBrowser, assertBudget } from './harness.mjs';

after(closeBrowser);

const text = async (page, sel) => (await page.locator(sel).first().textContent())?.replace(/\s+/g, ' ').trim() ?? '';
const BUDGETS = { v1: { steps: 12 } };

async function org(opts) {
  return journey({ name: 'org', budgets: BUDGETS, ...opts }, async ({ page, person, shot, mark, app, log }) => {
    const checks = log.checks = {};
    person.precondition('opened "Who decides what" (Settings, then the link; or #/org)');
    await page.goto(`${new URL(page.url()).origin}/#/org`);
    await page.waitForSelector('[data-action="start-small-team"]');
    checks.notEnforced = await text(page, '[data-not-enforced]');
    assert.match(checks.notEnforced, /not/i);
    await shot('start', { note: 'four starters; the banner says the map is checked when an automation is made, not while it runs' });
    await person.click(page.locator('[data-action="start-small-team"]'));
    await person.fill(page.locator('#person-name'), 'Dana');
    await person.click(page.locator('[data-action="add-person"]'));
    await person.fill(page.locator('#person-name'), 'Sam');
    await person.choose(page.locator('#person-role'), 'auditor');
    await person.click(page.locator('[data-action="add-person"]'));
    await shot('people');
    await person.fill(page.locator('[data-amount="money-out"]'), '250');
    await person.choose(page.locator('[data-currency="money-out"]'), 'EUR'); // the browser says en-US, so dollars are offered first
    await person.choose(page.locator('[data-approver="money-out"]'), { label: 'Dana' });
    assert.equal(await page.locator('[data-action="money-out"] [data-paid]').count(), 1, 'the Team plan badge sits at the approver it applies to');
    await shot('money-out-row', { note: 'money out above €250 needs Dana: the Team plan badge sits here, at the one field it applies to' });
    await person.click(page.locator('[data-action="money-out"] [data-action="make-rule"]'));
    await page.waitForSelector('[data-rule] [data-example="6"]');
    checks.examples = await page.locator('[data-rule] li[data-example]').evaluateAll(li => li.map(x => x.textContent.replace(/\s+/g, ' ').trim().slice(0, 90)));
    assert.equal(checks.examples.length, 6);
    await shot('six-examples', { note: 'the rule, its six examples (they become its tests), force and mode (Preview)' });
    await person.click(page.locator('[data-action="confirm-examples"]'));
    await person.click(page.locator('[data-action="save-map"]'));
    await page.waitForSelector('[data-saved-version="1"]');
    mark('v1');
    checks.bootstrap = await text(page, '[data-bootstrap]');
    assert.match(checks.bootstrap, /Only you have saved these rules\. A second person can confirm them once the Team plan exists\./);
    await shot('v1-saved', { note: 'version 1, with the bootstrap warning: one person signed it' });
    // The expense card: the limit arrives answered ("Set by Dana"), and a wider one is refused in words.
    await person.click(page.locator('main a[href="#/make/expense-approval"]'));
    await page.waitForSelector('[data-set-by="autoApproveUpTo"]');
    checks.setBy = await text(page, '[data-set-by="autoApproveUpTo"]');
    assert.equal(checks.setBy, "€250 · set by you for Dana (Org policy). Dana hasn't confirmed it");
    await shot('expense-set-by');
    await person.fill(page.locator('[data-field="autoApproveUpTo"] input'), '2000');
    await person.fill(page.locator('[data-field="approver"] input'), 'dana@example.com');
    await person.click(page.locator('[data-action="test"]'));
    await page.waitForSelector('main [data-error-panel]');
    checks.refused = await text(page, 'main [data-error-panel]');
    assert.match(checks.refused, /Not allowed here\. The rule written down for Dana \(Org policy\) caps this at €250\. This automation can only make it stricter\./);
    assert.equal(app.list().proposals.length, 0, 'nothing was made');
    await shot('expense-refused');
    // A change that flips a confirmed example is blocked until the person says the new answer is right.
    await page.goto(`${new URL(page.url()).origin}/#/org`);
    await page.waitForSelector('[data-action="change-map"]');
    await person.click(page.locator('[data-action="change-map"]'));
    await person.fill(page.locator('[data-amount="money-out"]'), '300');
    await person.click(page.locator('[data-action="save-map"]'));
    await page.waitForSelector('[data-flips="1"]');
    checks.flip = await text(page, '[data-flips]');
    assert.match(checks.flip, /case 4/);
    assert.equal((await page.evaluate(async () => (await fetch('/api/org/map', { headers: { 'x-foundry-token': sessionStorage.getItem('foundry-token') } })).json())).current.version, 1, 'save blocked');
    await shot('flip-blocks-save', { note: 'one example now answers differently: the save stops and shows it' });
    await person.click(page.locator('[data-action="confirm-flip-4"]'));
    await person.click(page.locator('[data-action="save-map"]'));
    await page.waitForSelector('[data-saved-version="2"]');
    mark('v2');
    await shot('v2-saved');
  });
}

test('ORG, 1280 light: v1 in at most 12 actions; "Set by Dana" refuses a wider limit; a flip blocks the save until re-confirmed', async () => {
  assertBudget(await org({}), 'v1', BUDGETS.v1);
});
test('ORG, 390 dark', async () => {
  assertBudget(await org({ theme: 'dark', width: 390, height: 844 }), 'v1', BUDGETS.v1);
});
