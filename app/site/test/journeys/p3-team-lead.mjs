// P3, the team lead (SPEC §7.3, §16): "Approve small expenses" with the three honest answers to "who decides the bigger ones",
// the Team plan as a disclosure at the one field it applies to (never a wall or a modal), and a way to keep going free.
// 1280 light and 390 dark. Development evidence, scripted, no users.
// nice node --test --test-concurrency=1 app/site/test/journeys/p3-team-lead.mjs
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { journey, closeBrowser, assertBudget, fixturePath } from './harness.mjs';

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
    assert.match(checks.who, /maria@example\.com, by replying to an e-mail; you record their answer here/);
    await shot('checked', { note: 'first verified; "Who decides: maria, by replying to an e-mail; you record their answer here"' });
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

// The P3 walkthrough, after the fixes: the refunds request is not passed off as an expense card; the person's own refunds export
// (no receipt column, headers that are not Foundry's words) is matched with two choices; the exact list goes to the approver; the
// approver's answer is recorded on "Waiting for you"; and the next list says what was already sent and answered. 1280 light.
test('P3 refunds export: no false match, a file without receipts, the approver e-mail, and the answer recorded', async () => {
  const budgets = { firstLive: { steps: 12, asks: 5 } };
  const log = await journey({ name: 'p3-refunds', budgets }, async ({ page, person, shot, mark, log }) => {
    const checks = log.checks = {};
    await person.fill(page.locator('#describe-box'), 'Refunds over $500 need my approval before we pay them back');
    await person.key('Enter');
    await page.waitForFunction(() => !/^Foundry/.test(document.querySelector('main h1')?.textContent ?? 'Foundry') && document.querySelectorAll('main [data-template]').length > 0);
    checks.refundRequest = await text(page, 'main h1');
    assert.doesNotMatch(checks.refundRequest, /This sounds like/);
    await shot('refunds-request', { note: 'no "this sounds like" for a refund; the cards are offered' });
    await person.click(page.locator('main [data-template="expense-approval"] a.button'));
    await page.waitForSelector('[data-action="test"]');
    await person.fill(page.locator('[data-field="autoApproveUpTo"] input'), '100');
    await person.fill(page.locator('[data-field="approver"] input'), 'maria@example.com');
    await person.click(page.locator('[data-action="test"]'));
    await page.waitForSelector('[data-turn-on]');
    await person.click(page.locator('[data-action="turn-on"]'));
    await page.waitForSelector('[data-sheet="expenses"] input[type=file]');
    await person.upload(page.locator('[data-sheet="expenses"] input[type=file]'), fixturePath('refunds-no-receipt.csv'));
    await page.waitForSelector('[data-column="id"]');
    await shot('refunds-columns', { note: 'two columns to choose; receipt, category and description may be missing' });
    await person.choose(page.locator('[data-column="id"]'), 'Refund ID');
    await person.choose(page.locator('[data-column="employee"]'), 'Customer');
    await person.click(page.locator('[data-action="use-columns"]'));
    await page.waitForSelector('[data-action="batch-approve"]', { timeout: 30000 });
    checks.receiptNote = await text(page, 'main .banner.wait');
    assert.match(checks.receiptNote, /receipt/i);
    checks.exactList = await page.locator('[data-decision-card][data-batch] li[data-item]').evaluateAll(li => li.map(x => x.textContent.replace(/\s+/g, ' ').trim().slice(0, 200)));
    assert.ok(checks.exactList.some(i => /maria@example\.com/.test(i)), 'the approver e-mail is on the list');
    await shot('refunds-exact-list', { note: 'no receipt column: every claim goes to the approver, and the page says so' });
    await person.click(page.locator('[data-action="batch-approve"]'));
    await page.waitForSelector('[data-draft]');
    mark('firstLive');
    await shot('refunds-drafts');
    await person.click(page.locator('header nav a[href="#/waiting"]'));
    await page.waitForSelector('[data-answers] [data-claim]');
    checks.toRecord = await page.locator('[data-answers] [data-claim]').evaluateAll(l => l.map(x => x.dataset.claim));
    assert.deepEqual(checks.toRecord.sort(), ['R-1042', 'R-1043', 'R-1044']);
    await shot('answers-to-record', { note: 'Maria answers by e-mail; the person records each answer here' });
    await person.click(page.locator('[data-claim="R-1042"] [data-action="answer-approved"]'));
    await page.waitForSelector('[data-claim="R-1042"] .ok-text');
    checks.recorded = await text(page, '[data-claim="R-1042"] .ok-text');
    await shot('answer-recorded');
    await person.click(page.locator('header nav a[href="#/automations"]'));
    await person.click(page.locator('main a[href^="#/automations/expense-approval"]').first());
    await page.waitForSelector('[data-decisions]');
    checks.decisions = await text(page, '[data-decisions]');
    assert.match(checks.decisions, /@/);
    await shot('automation-decisions', { note: 'who decided each list, how and when' });
  });
  assertBudget(log, 'firstLive', budgets.firstLive);
});
