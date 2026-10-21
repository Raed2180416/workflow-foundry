// P3, the team lead (SPEC §7.3, §16): "Approve small expenses" with the three honest answers to "who decides the bigger ones",
// the Team plan as a disclosure at the one field it applies to (never a wall or a modal), and a way to keep going free.
// 1280 light and 390 dark. Development evidence, scripted, no users.
// nice node --test --test-concurrency=1 app/site/test/journeys/p3-team-lead.mjs
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { journey, closeBrowser, assertBudget } from './harness.mjs';

after(closeBrowser);

const BUDGETS = { firstVerified: { steps: 4, asks: 2 } };
const text = async (page, sel) => (await page.locator(sel).first().textContent())?.replace(/\s+/g, ' ').trim() ?? '';

async function expense(opts) {
  return journey({ name: 'p3-expense', budgets: BUDGETS, ...opts }, async ({ page, person, shot, mark, log }) => {
    const checks = log.checks = {};
    await person.click(page.locator('[data-template="expense-approval"] a.button'));
    await page.waitForSelector('[data-action="test"]');
    await shot('make', { note: 'two questions; "who decides" sits right below the second' });
    checks.questions = await page.locator('main [data-field] > label').allTextContents();
    // The Team plan badge appears once, inside the "who decides" control, and nowhere else on the page.
    checks.paidBadges = await page.locator('main [data-paid]').count();
    assert.equal(checks.paidBadges, 1);
    assert.equal(await page.locator('[data-who] [data-paid]').count(), 1);
    await person.fill(page.locator('[data-field="autoApproveUpTo"] input'), '100');
    await person.fill(page.locator('[data-field="approver"] input'), 'maria@example.com');
    await shot('answered');
    await person.click(page.locator('[data-action="test"]'));
    await page.waitForSelector('[data-turn-on]');
    mark('firstVerified');
    checks.checked = await text(page, 'main p.lead');
    assert.match(checks.checked, /maria@example\.com/);
    checks.who = await text(page, '[data-turn-on] dl.facts');
    assert.match(checks.who, /you \(maria@example\.com gets an e-mail\)/);
    await shot('checked', { note: 'first verified; "Who decides: you (maria gets an e-mail)"' });
    // The Team plan option: a disclosure, then the free way on. No dialog anywhere.
    await person.click(page.locator('[data-turn-on] dd button.link'));
    await person.choose(page.locator('[data-turn-on] [data-who] input[value="team"]'));
    await person.click(page.locator('[data-turn-on] [data-who] [data-paid]'));
    checks.disclosure = await text(page, '[data-turn-on] [data-who] .paid-note');
    assert.match(checks.disclosure, /isn't available yet/);
    checks.teamButtons = await page.locator('[data-turn-on] .decision button').allTextContents();
    assert.deepEqual(checks.teamButtons, ['Turn it on with you recording decisions', 'Keep it in practice']);
    assert.equal(await page.locator('dialog, [role=dialog], [aria-modal=true]').count(), 0, 'no modal');
    await page.locator('[data-turn-on]').scrollIntoViewIfNeeded();
    await shot('team-plan-disclosure', { fullPage: false });
    await person.choose(page.locator('[data-turn-on] [data-who] input[value="inform"]'));
    await shot('keep-going-free', { fullPage: false });
    await person.click(page.locator('[data-action="turn-on"]'));
    await page.waitForSelector('main .banner.ok');
    mark('turnedOn');
    await shot('on');
    const main = (await page.locator('main').textContent()).toLowerCase();
    assert.equal(/maria(@example\.com)? approved|approved by maria/.test(main), false, 'never says the e-mail recipient approved');
  });
}

test('P3 expense, 1280 light: first verified in at most 4 actions and 2 asks; the Team plan is a disclosure, not a wall', async () => {
  assertBudget(await expense({}), 'firstVerified', BUDGETS.firstVerified);
});
test('P3 expense, 390 dark', async () => {
  assertBudget(await expense({ theme: 'dark', width: 390, height: 844 }), 'firstVerified', BUDGETS.firstVerified);
});
