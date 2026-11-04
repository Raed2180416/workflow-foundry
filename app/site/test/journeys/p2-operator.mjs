// P2, the operator (SPEC §7.1, §16): "Chase unpaid invoices" from the cards to drafts in their own mail app, in three variants
// (1280 light, 390 dark, keyboard only at 1280); the optional test on their own list; and the edges (no match, a suggestion,
// nothing to chase, statuses Foundry doesn't know). Development evidence, scripted, no users.
// nice node --test --test-concurrency=1 app/site/test/journeys/p2-operator.mjs
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, utimesSync } from 'node:fs';
import path from 'node:path';
import { journey, closeBrowser, assertBudget, fixturePath, browser, NOW } from './harness.mjs';
import { invoiceFlowOn, liveInvoices } from '../../../onboarding/test/helpers.mjs';
import { Batches, listDigest } from '../../../onboarding/batch.mjs';
import { rememberAnswers } from '../../../onboarding/data-answers.mjs';
import { preview as csvPreview } from '../../../onboarding/csv.mjs';

after(closeBrowser);

const BUDGETS = { firstVerified: { steps: 3, asks: 1 }, firstLive: { steps: 8, asks: 4 } };
const text = async (page, sel) => (await page.locator(sel).first().textContent())?.replace(/\s+/g, ' ').trim() ?? '';

async function invoice(opts) {
  return journey({ name: 'p2-invoice', budgets: BUDGETS, ...opts }, async ({ page, person, shot, mark, app, log }) => {
    const checks = log.checks = {};
    // A real cost the counts leave out (UX review M9): today someone technical installs Node 24 and starts Foundry (Quickstart, "I don't code").
    person.precondition('Foundry is installed (Node 24) and started, today by someone technical (Quickstart: "I don\'t code"); not counted');
    await shot('home', { note: 'cards first; nothing asked yet' });
    await person.click(page.locator('[data-template="invoice-chase"] a.button'));
    await page.waitForSelector('[data-action="test"]');
    await page.waitForFunction(() => document.querySelectorAll('#will-do li').length > 0);
    checks.restatement = await text(page, '#will-do');
    await shot('make', { note: 'the restatement, the defaults as chips, one question' });
    assert.equal(await page.locator('main [data-ask]').count() >= 1, true);
    await person.fill(page.locator('[data-field="summaryTo"] input[type=email]'), 'me@example.com');
    await shot('summary-address');
    await person.click(page.locator('[data-action="test"]'));
    await page.waitForSelector('[data-turn-on]');
    mark('firstVerified', { accounts: 0, keys: 0, connections: 0 });
    checks.checked = await text(page, 'main p.lead');
    assert.match(checks.checked, /3 e-mails to customers and 1 e-mail to me@example\.com/);
    assert.match(await text(page, 'main .pretend'), /pretend customers/);
    await shot('checked', { note: 'first verified' });
    await page.locator('[data-turn-on]').scrollIntoViewIfNeeded();
    await shot('turn-on-card', { fullPage: false });
    await person.click(page.locator('[data-action="turn-on"]'));
    await page.waitForSelector('[data-sheet="invoices"] input[type=file]');
    checks.on = await text(page, 'main .banner.ok');
    assert.match(checks.on, /It won't run by itself/);
    await shot('on');
    await person.upload(page.locator('[data-sheet="invoices"] input[type=file]'), fixturePath('invoices-accounting-export.csv'));
    await page.waitForSelector('[data-question="dateOrder:due"]');
    checks.mapping = await page.locator('[data-column]').evaluateAll(s => Object.fromEntries(s.map(x => [x.dataset.column, x.value])));
    assert.deepEqual(checks.mapping, { invoice: 'Invoice No.', customer: 'Client', email: 'Contact email', amount: 'Amount due (EUR)', due: 'Due date', status: 'Status' });
    await shot('columns', { note: 'columns matched by name, with sample values; the date order is asked, not guessed' });
    await person.choose(page.locator('[data-question="dateOrder:due"] input[value="dmy"]'));
    await shot('date-order');
    await person.click(page.locator('[data-action="use-columns"]'));
    await page.waitForSelector('[data-action="batch-approve"]', { timeout: 30000 });
    const items = await page.locator('[data-decision-card][data-batch] li[data-item]').evaluateAll(li => li.map(x => x.querySelector('.head')?.textContent.replace(/\s+/g, ' ').trim()));
    checks.exactList = items;
    assert.equal(items.length, 4, 'three reminders and one summary');
    assert.equal(items.filter(i => /To: me@example\.com/.test(i)).length, 1);
    assert.equal(items.some(i => /willow\.example/.test(i)), false, 'INV-2046 is not due yet when read day first');
    await shot('exact-list', { note: 'every item in full before the yes' });
    await person.click(page.locator('[data-action="batch-approve"]'));
    await page.waitForSelector('[data-draft]');
    mark('firstLive', { accounts: 0, keys: 0, connections: 0 });
    checks.drafts = await text(page, 'main h1');
    assert.match(checks.drafts, /4 drafts ready\. Foundry didn't send anything\./);
    await shot('drafts', { note: 'first live: drafts the person sends' });
    const first = page.locator('[data-draft]').first();
    const to = (await first.locator('.head span').first().textContent()).replace(/^To:?\s*/, '').trim();
    const subject = (await first.locator('.head span').nth(1).textContent()).replace(/^Subject:?\s*/, '').trim();
    const mailto = await first.locator('a[data-action="mailto"]').getAttribute('href');
    assert.ok(mailto.startsWith(`mailto:${encodeURIComponent(to).replace(/%40/g, '@')}`) || mailto.startsWith(`mailto:${to}`), mailto);
    assert.ok(decodeURIComponent(mailto).includes(subject));
    const [download] = await Promise.all([page.waitForEvent('download'), person.click(first.locator('[data-action="eml"]'))]);
    const eml = readFileSync(await download.path(), 'utf8');
    assert.match(eml, /^X-Unsent: 1\r$/m); assert.match(eml, new RegExp(`^To: ${to.replace(/[.]/g, '\\.')}\\r$`, 'm'));
    checks.eml = { file: download.suggestedFilename(), xUnsent: true, to, subject };
    await shot('eml-downloaded');
    // Nothing left the computer: the run's sends went to the drafts outbox; no account, key or connection exists.
    const keys = await page.evaluate(async () => (await fetch('/api/keys', { headers: { 'x-foundry-token': sessionStorage.getItem('foundry-token') ?? '' } })).json());
    checks.keysSaved = (keys.providers ?? []).filter(p => p.saved).length;
    assert.equal(checks.keysSaved, 0);
  });
}

test('P2 invoice, 1280 light: first verified in 3 actions and 1 ask, first live in 8 and 4, then drafts and a .eml', async () => {
  const log = await invoice({});
  assertBudget(log, 'firstVerified', BUDGETS.firstVerified); assertBudget(log, 'firstLive', BUDGETS.firstLive);
});
test('P2 invoice, 390 dark: the same journey on a phone-width screen in dark mode', async () => {
  const log = await invoice({ theme: 'dark', width: 390, height: 844 });
  assertBudget(log, 'firstVerified', BUDGETS.firstVerified); assertBudget(log, 'firstLive', BUDGETS.firstLive);
});
test('P2 invoice, keyboard only at 1280: Tab, arrows, Space and Enter reach every control', async () => {
  const log = await invoice({ keyboard: true });
  assertBudget(log, 'firstVerified', BUDGETS.firstVerified); assertBudget(log, 'firstLive', BUDGETS.firstLive);
});

test('P2 own data: test on my own list before turning on (A4), labelled "Tested on: your own list"', async () => {
  const budgets = { ownTested: { steps: 7, asks: 3 } };
  const log = await journey({ name: 'p2-own-data', budgets }, async ({ page, person, shot, mark }) => {
    await person.click(page.locator('[data-template="invoice-chase"] a.button'));
    await person.fill(page.locator('[data-field="summaryTo"] input[type=email]'), 'me@example.com');
    await person.click(page.locator('[data-action="test"]'));
    await page.waitForSelector('[data-turn-on]');
    await shot('checked-pretend');
    await person.click(page.locator('[data-action="own-list"]'));
    await shot('own-list-open');
    await person.upload(page.locator('[data-own-data] input[type=file]'), fixturePath('invoices-accounting-export.csv'));
    await page.waitForSelector('[data-question="dateOrder:due"]');
    await shot('own-columns');
    await person.choose(page.locator('[data-question="dateOrder:due"] input[value="dmy"]'));
    await person.click(page.locator('[data-action="test-own"]'));
    await page.waitForFunction(() => /your own list/.test(document.querySelector('main .pretend')?.textContent ?? ''));
    mark('ownTested');
    assert.match(await text(page, 'main p.lead'), /3 e-mails to customers and 1 e-mail to me@example\.com/);
    assert.match(await text(page, '[data-turn-on]'), /your own list, passed/);
    await shot('tested-on-yours');
  });
  assertBudget(log, 'ownTested', budgets.ownTested);
});

test('P2 edges at 390 light: no match creates nothing; a suggestion; nothing to chase; statuses Foundry does not know are asked', async () => {
  await journey({ name: 'p2-edges', width: 390, height: 844 }, async ({ page, person, shot, app, log }) => {
    const checks = log.checks = {};
    const created = () => { const l = app.list(); return l.flows.length + l.proposals.length; };
    // (a) Something Foundry can't make: nothing is created and the cards are right there.
    await person.fill(page.locator('#describe-box'), 'book me a flight to Lisbon');
    await person.key('Enter');
    await page.waitForSelector('main h1:has-text("Foundry can\'t make that yet")');
    checks.noMatch = await text(page, 'main h1');
    assert.equal(await page.locator('main [data-template]').count() >= 5, true, 'every card is offered');
    assert.equal(created(), 0, 'nothing was created');
    await shot('a-no-match');
    // (b) Plain words that match a card: a suggestion, then "Use this".
    await person.fill(page.locator('#describe-box'), "remind customers who haven't paid");
    await person.key('Enter');
    await page.waitForSelector('main h1:has-text("This sounds like")');
    checks.suggestion = await text(page, 'main h1');
    assert.match(checks.suggestion, /Chase unpaid invoices/);
    await shot('b-suggestion');
    await person.click(page.getByRole('link', { name: 'Use this', exact: true }));
    await page.waitForSelector('[data-action="test"]');
    await shot('b-make');
    await person.fill(page.locator('[data-field="summaryTo"] input[type=email]'), 'me@example.com');
    await person.click(page.locator('[data-action="test"]'));
    await page.waitForSelector('[data-turn-on]');
    // (c) Nothing to chase: the person's own list is all paid. The test passes, nothing would go to a customer, and it says so.
    await person.click(page.locator('[data-action="own-list"]'));
    await person.upload(page.locator('[data-own-data] input[type=file]'), fixturePath('invoices-all-paid.csv'));
    await page.waitForSelector('[data-action="test-own"]');
    await person.click(page.locator('[data-action="test-own"]'));
    await page.waitForFunction(() => /Nothing to chase/.test(document.querySelector('main')?.textContent ?? ''));
    checks.nothingToChase = await text(page, 'main .banner[role=status]');
    assert.match(await text(page, 'main h1'), /Test passed/);
    await shot('c-nothing-to-chase');
    // (d) Statuses Foundry doesn't know ("Overdue", "Part paid", "Sent"): it asks which ones mean "still open".
    await person.click(page.locator('[data-action="own-list"]'));
    await person.upload(page.locator('[data-own-data] input[type=file]'), fixturePath('invoices-odd-statuses.csv'));
    await page.waitForSelector('[data-question="values:status"]');
    checks.unknownStatuses = await text(page, '[data-question="values:status"] legend');
    assert.match(checks.unknownStatuses, /Overdue/); assert.match(checks.unknownStatuses, /Part paid/);
    await shot('d-unknown-statuses');
    // Skipping the question is refused in plain words; nothing is imported.
    await person.click(page.locator('[data-action="test-own"]'));
    await page.waitForSelector('[data-own-data] [data-unanswered]');
    checks.unanswered = await text(page, '[data-own-data] [data-unanswered]');
    assert.equal(await page.evaluate(() => document.activeElement?.closest('[data-question]')?.dataset.question), 'values:status', 'focus moves to the open question');
    await shot('d-unanswered');
    await person.choose(page.locator('[data-question="values:status"] input[value="Overdue"]'));
    await person.choose(page.locator('[data-question="values:status"] input[value="Part paid"]'));
    const before = await text(page, 'main p.lead');
    await person.click(page.locator('[data-action="test-own"]'));
    await page.waitForFunction(b => (document.querySelector('main p.lead')?.textContent ?? '').replace(/\s+/g, ' ').trim() !== b, before);
    checks.oddTested = await text(page, 'main p.lead');
    assert.match(checks.oddTested, /2 e-mails to customers/);
    await shot('d-tested');
  });
});

// The P2 walkthrough's blockers B2 and B3, after the fixes and the security review (2026-10-21, H2): the next morning the bookmark
// opens the page that says the one command that lets this browser in (a key no longer outlives its tab, so nothing on that port can
// take it); the person runs it and Foundry opens; the list from yesterday is flagged and replacing it comes first; the new list does
// not repeat yesterday's reminders; and a browser that never had a key gets the same command, not a dead end. 1280 light.
test('P2 the next day: the bookmark says the one command, which opens Foundry; yesterday\'s list replaced first; no reminder made twice; another browser is told how to open', async () => {
  const DAY = 24 * 3600 * 1000;
  await journey({ name: 'p2-next-day', siteOptions: { asOf: () => NOW + DAY, now: () => NOW + DAY },
    before: async app => {
      await invoiceFlowOn(app); liveInvoices(app);
      // Yesterday's upload went through the page, which keeps the answers given about the file (UX review m4): day first.
      const pv = csvPreview({ template: 'invoice-chase', sheet: 'invoices', text: readFileSync(fixturePath('invoices-accounting-export.csv'), 'utf8') });
      rememberAnswers(app.root, { template: 'invoice-chase', sheet: 'invoices', header: pv.columns, questions: pv.questions, answers: { 'dateOrder:due': 'dmy' }, now: () => NOW });
      const yesterday = new Date(NOW); utimesSync(path.join(app.worldDir, 'sheets', 'invoices.json'), yesterday, yesterday);
      const batches = new Batches(app, { now: () => NOW });
      const b = await batches.preview('invoice-chase');
      await batches.approve(b.batchId, { channel: 'dashboard', listDigest: listDigest(b) });
    } }, async ({ page, person, shot, base, site, log }) => {
    const checks = log.checks = {};
    person.precondition('yesterday they turned on "Chase unpaid invoices", dropped their list and made 4 drafts (as in P2), in this browser');
    // The next morning, a new tab from a bookmark: no key in the address, and none kept for the port (P2 walkthrough B2; review H2).
    // A closed tab's sessionStorage is gone; clearing it here stands in for the new tab.
    await page.evaluate(() => sessionStorage.clear());
    await page.goto(`${base}/`);
    await page.waitForFunction(() => /cli\.mjs" open --workspace|cli\.mjs open/.test(document.querySelector('main pre')?.textContent ?? ''));
    checks.bookmark = { title: (await page.locator('main h1').textContent()).trim(), command: (await page.locator('main pre').textContent()).replace(/\/tmp\/[^"]+/g, '<ws>') };
    assert.match(checks.bookmark.title, /Open Foundry from its link/);
    await shot('bookmark-says-command', { note: 'the bookmark: no key kept for this port, so the page says the one command that opens Foundry' });
    // The person runs that command in their terminal; Foundry opens this browser with a one-time code (what the opener would do).
    person.external('runs the command in their own terminal (node app/cli.mjs open); Foundry opens the page');
    await page.goto(site.openUrl()); // same tab, so a hash change: the page trades the code without a reload
    await page.waitForFunction(() => !document.querySelector('main [data-no-key]') && document.querySelector('main h1'));
    checks.openedWithCommand = (await page.locator('main h1').first().textContent()).replace(/\s+/g, ' ').trim();
    assert.doesNotMatch(checks.openedWithCommand, /Open Foundry from its link/);
    assert.equal(await page.evaluate(() => { try { return localStorage.getItem('foundry-token'); } catch { return 'unreadable'; } }), null, 'no key is kept for the port');
    assert.equal(/[?&]c=/.test(new URL(page.url()).hash), false, 'the code left the address bar');
    await person.click(page.locator('[data-nav="automations"]'));
    await person.click(page.locator('main a[href^="#/automations/invoice-chase"]').first());
    await person.click(page.locator('main .actions a.button.primary'));
    await page.waitForSelector('[data-stale]');
    checks.stale = await text(page, '[data-stale]');
    assert.match(checks.stale, /Your list is from 21 Oct 2026/); // the journey plays the morning of 22 Oct
    await shot('stale-list', { note: 'yesterday\'s list no longer says who paid: replacing it comes first' });
    await person.click(page.locator('[data-action="replace-stale"]'));
    await person.upload(page.locator('[data-sheet="invoices"] input[type=file]'), fixturePath('invoices-accounting-export.csv'));
    await page.waitForSelector('[data-question="dateOrder:due"]');
    // The same export as yesterday: its date order is already chosen and says so; it is not asked again (UX review m4, WCAG 3.3.7).
    assert.equal(await page.locator('[data-question="dateOrder:due"] input[value="dmy"]').isChecked(), true, 'yesterday\'s answer is already chosen');
    checks.remembered = await text(page, '[data-remembered="dateOrder:due"]');
    await shot('date-order-remembered', { note: 'the date order answered yesterday is already chosen, and the page says so; it can be changed' });
    await person.click(page.locator('[data-action="use-columns"]'));
    await page.waitForSelector('[data-action="batch-approve"]', { timeout: 30000 });
    checks.secondList = await page.locator('[data-decision-card][data-batch] li[data-item]').evaluateAll(li => li.map(x => x.querySelector('.head')?.textContent.replace(/\s+/g, ' ').trim()));
    assert.equal(checks.secondList.length, 1, 'only the summary: no customer is reminded twice');
    assert.match(checks.secondList[0], /To: me@example\.com/);
    checks.secondSummary = await text(page, '[data-decision-card][data-batch] li[data-item] pre');
    assert.match(checks.secondSummary, /Reminder drafts made this run: 0/);
    await shot('no-repeats', { note: 'the reminders made yesterday are remembered; today\'s list has only the summary' });
    // Another browser (or a cleared one) on the same computer: the page says the one command that opens Foundry.
    const other = await (await browser()).newContext({ viewport: { width: 1280, height: 900 } });
    try {
      const tab = await other.newPage();
      await tab.goto(`${base}/`);
      await tab.waitForFunction(() => /cli\.mjs" open --workspace|cli\.mjs open/.test(document.querySelector('main pre')?.textContent ?? ''));
      checks.otherBrowser = { title: (await tab.locator('main h1').textContent()).trim(), command: (await tab.locator('main pre').textContent()).replace(/\/tmp\/[^"]+/g, '<ws>') };
      assert.equal(/#t=|c=[A-Za-z0-9_-]{43}/.test(await tab.locator('main').textContent()), false, 'the page without a key never shows a key or a code');
      await shot('other-browser', { of: tab, note: 'no key in this browser: the exact command to open Foundry (no key shown)' });
    } finally { await other.close(); }
  });
});
