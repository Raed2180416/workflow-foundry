// Regression tests for the UX review of 2026-10-21 (onboarding workflow, review:UX; M1-M9, minors m1-m21). Each test names the finding it
// holds. The behavioural ones drive the real site in Chromium (in-process server over a temp workspace, ephemeral keychain, $0, no model,
// loopback only: any other host is refused) and fail on the code before the fix (commit 699f1412); the rest read the modules or call
// them. The journeys (app/site/test/journeys) hold the rest: focus after every action, the fallback checks on every page, step counts
// with tabs, screens and decisions beside them. Development evidence, scripted, no users.
// nice -n 15 node --test --test-concurrency=1 app/site/test/review-ux.test.mjs
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, readdirSync, utimesSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createSite, siteApp } from '../server.mjs';
import { Keychain } from '../../onboarding/keychain.mjs';
import { invoiceFlowOn, liveInvoices, fixture, withApp, NOW } from '../../onboarding/test/helpers.mjs';
import { Batches, listDigest } from '../../onboarding/batch.mjs';
import { recordDecisions } from '../../onboarding/decisions.mjs';
import { evidenceBundle, checkEvidence } from '../../onboarding/evidence.mjs';
import { rememberAnswers, recallAnswers, headerSignature } from '../../onboarding/data-answers.mjs';
import { preview as csvPreview } from '../../onboarding/csv.mjs';
import { saveSettings } from '../../onboarding/settings.mjs';
import { a11y } from './journeys/harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(here, '..', 'public');
const copy = JSON.parse(readFileSync(path.join(PUBLIC, 'copy', 'en.json'), 'utf8'));
const source = f => readFileSync(path.join(PUBLIC, f), 'utf8');
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const IN = { now: new Date(NOW).toISOString() };

let browserPromise = null;
const browser = () => (browserPromise ??= chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox', '--disable-background-networking', '--disable-sync', '--proxy-server=http://127.0.0.1:9'] }));
after(async () => { if (browserPromise) await (await browserPromise).close(); });

/**
 * A site over a fresh workspace and a page opened with its one-time code. setup(app, dir) prepares the workspace; fn({ page, app, site,
 * base, go }) drives it. go(route) changes the route and waits for the new page.
 */
async function withSite({ setup = null, viewport = { width: 1280, height: 900 }, context: ctxOptions = {}, siteOptions = {}, init = null } = {}, fn) {
  const dir = mkdtempSync(path.join(tmpdir(), 'ux-'));
  const app = await siteApp({ workspace: dir });
  const ids = (await setup?.(app, dir)) ?? {};
  let site = createSite(app, { workspace: dir, now: () => NOW, keychain: new Keychain({ backend: 'ephemeral' }), ...siteOptions });
  const { port } = await site.listen(0);
  const base = `http://127.0.0.1:${port}`;
  const context = await (await browser()).newContext({ viewport, reducedMotion: 'reduce', ...ctxOptions });
  const errors = [];
  await context.route('**/*', route => { const u = new URL(route.request().url()); return ['blob:', 'data:'].includes(u.protocol) || u.hostname === '127.0.0.1' ? route.continue() : route.abort(); });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  if (init) await page.addInitScript(init);
  const hop = async route => {
    await page.evaluate(() => document.querySelectorAll('main h1').forEach(h => h.setAttribute('data-old', '')));
    await page.evaluate(r => { location.hash = r; }, route);
    await page.waitForFunction(() => document.querySelector('main h1:not([data-old])') && !document.getElementById('view').hasAttribute('aria-busy'), null, { timeout: 15000 });
    await page.waitForTimeout(80);
  };
  // Setting location.hash to the route already shown fires no hashchange: go by way of the glossary (a page that needs no key).
  const go = async route => { if (await page.evaluate(r => location.hash === r, route)) await hop('#/glossary'); await hop(route); };
  try {
    await page.goto(site.openUrl());
    await page.waitForSelector('main h1');
    await fn({ page, app, site, base, go, ids, dir, port, restart: async () => { await site.close(); site = createSite(app, { workspace: dir, now: () => NOW, keychain: new Keychain({ backend: 'ephemeral' }), ...siteOptions }); await site.listen(port); return site; } });
    assert.deepEqual(errors, [], 'no page errors');
  } finally { await context.close(); await site.close(); await app.close(); rmSync(dir, { recursive: true, force: true }); }
}
const focusInfo = page => page.evaluate(() => { const a = document.activeElement; return { tag: a?.tagName.toLowerCase() ?? null, body: !a || a === document.body || a === document.documentElement, text: (a?.textContent ?? '').trim().slice(0, 60), inPanel: !!a?.closest('[data-error-panel]') }; });

// ------------------------------------------------------------------------------------------------ Major
test('M1: changing a setting on the make page keeps its editor open and the focus on its control (keyboard)', async () => withSite({}, async ({ page, go }) => {
  // The on-call digest card has all three kinds of setting: a yes/no box, a choice and a number.
  await go('#/make/oncall-digest');
  const settings = await page.$$eval('[data-setting]', ls => ls.map(l => ({ name: l.dataset.setting, kind: l.querySelector('input[type=checkbox]') ? 'box' : l.querySelector('input[type=number]') ? 'number' : l.querySelector('select') ? 'select' : 'text' })));
  const kinds = ['box', 'select', 'number'].map(k => settings.find(s => s.kind === k));
  assert.ok(kinds.every(Boolean), JSON.stringify(settings));
  for (const s of kinds) {
    const before = await page.locator(`[data-setting="${s.name}"] [data-value]`).textContent();
    await page.locator(`[data-setting="${s.name}"] button.link`).focus();
    await page.keyboard.press('Enter');
    if (s.kind === 'box') await page.keyboard.press('Space');
    else if (s.kind === 'select') await page.keyboard.press('ArrowDown');
    else { await page.keyboard.press('Control+A'); await page.keyboard.type('9'); await page.keyboard.press('Enter'); }
    await page.waitForTimeout(400);
    const f = await focusInfo(page);
    assert.equal(f.body, false, `${s.name}: focus went to the page`);
    assert.equal(await page.locator(`[data-setting="${s.name}"] [id^="edit-"]`).isHidden(), false, `${s.name}: the editor stays open`);
    assert.equal(await page.evaluate(() => document.activeElement?.closest('[data-setting]')?.dataset.setting), s.name, `${s.name}: focus stays on its control`);
    assert.notEqual(await page.locator(`[data-setting="${s.name}"] [data-value]`).textContent(), before, `${s.name}: the shown value follows the change`);
  }
}));

test('M1: "Who decides what" moves the focus to what replaced the button (start from a starter, discard changes)', async () => withSite({}, async ({ page, go }) => {
  await go('#/org');
  await page.locator('[data-action="start-small-team"]').focus();
  await page.keyboard.press('Enter');
  await page.waitForSelector('[data-panel="people"]');
  await page.waitForTimeout(200);
  let f = await focusInfo(page);
  assert.equal(f.body, false, 'after "Start from this" the focus is not on the page');
  assert.equal(await page.evaluate(() => !!document.activeElement?.closest('[data-panel="people"]')), true, f.text);
  await page.locator('[data-action="discard"]').focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  f = await focusInfo(page);
  assert.equal(f.body, false, 'after "Discard changes" the focus is not on the page');
}));

test('M1: a refusal or an error puts the focus on what went wrong (make: Test it; checked: Turn it on)', async () => withSite({}, async ({ page, go }) => {
  await go('#/make/invoice-chase');
  await page.fill('[data-field="summaryTo"] input', 'me@example.com');
  await page.route('**/api/propose', r => r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'ERROR', message: 'boom' }, problem: { what: 'Something went wrong inside Foundry.' } }) }));
  await page.locator('[data-action="test"]').focus();
  await page.keyboard.press('Enter');
  await page.waitForSelector('main [data-error-panel]');
  await page.waitForTimeout(150);
  let f = await focusInfo(page);
  assert.equal(f.inPanel, true, `make: focus on the error, not ${f.tag} "${f.text}"`);
  assert.equal(await page.locator('[data-action="test"]').getAttribute('aria-busy'), null, 'make: not busy after the error');
  await page.unroute('**/api/propose');
  await page.locator('[data-action="test"]').click();
  await page.waitForSelector('[data-turn-on]');
  await page.route('**/api/request-approval', r => r.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: { code: 'NEEDS_DRY_RUN' }, problem: { what: 'Refused for this test.' } }) }));
  await page.locator('[data-action="turn-on"]').focus();
  await page.keyboard.press('Enter');
  await page.waitForSelector('[data-turn-on] [data-error-panel]');
  await page.waitForTimeout(150);
  f = await focusInfo(page);
  assert.equal(f.inPanel, true, `turn on: focus on the error, not ${f.tag} "${f.text}"`);
}));

test('M1: a decision that opens another page keeps the focus on something while that page loads, then on its heading', async () => withSite({
  setup: async app => { const p = await invoiceFlowOn(app); liveInvoices(app); await new Batches(app, { now: () => NOW }).preview(p.flowId); }
}, async ({ page, go }) => {
  await go('#/waiting');
  // The drafts page answers slowly, so the moment between the yes and the next page can be seen (found by the journeys' focus check).
  await page.route('**/api/drafts', async r => { await new Promise(x => setTimeout(x, 1500)); return r.continue(); });
  await page.locator('[data-action="batch-approve"]').focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.getElementById('view').hasAttribute('aria-busy'), null, { timeout: 15000 });
  const during = await focusInfo(page);
  assert.equal(during.body, false, 'while the next page loads the focus is not on the page itself');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'loading', 'it waits on the "Loading" line');
  await page.waitForFunction(() => !document.getElementById('view').hasAttribute('aria-busy'), null, { timeout: 15000 });
  assert.equal(await page.evaluate(() => document.activeElement?.tagName), 'H1', 'then the new page\'s heading has it');
}));

test('M2: the "something waiting" notice is not a live region and does not change while nothing changes', async () => withSite({
  setup: async app => { const p = await app.propose({ template: 'invoice-chase', settings: { sendSummary: true, summaryTo: 'me@example.com' }, origin: 'site-form' }); await app.dryRun({ proposalId: p.proposalId }); app.requestApproval({ proposalId: p.proposalId }); }
}, async ({ page, go }) => {
  await go('#/runs');
  await page.waitForFunction(() => !document.getElementById('notice').hidden, null, { timeout: 15000 });
  assert.equal(await page.evaluate(() => { const n = document.getElementById('notice'); return n.getAttribute('role') ?? n.getAttribute('aria-live'); }), null, 'no role=status or aria-live on the notice');
  await page.evaluate(() => { window.__mut = 0; new MutationObserver(m => { window.__mut += m.length; }).observe(document.getElementById('notice'), { childList: true, subtree: true, characterData: true, attributes: true }); });
  await page.waitForTimeout(11000); // two polls of the badge
  assert.equal(await page.evaluate(() => window.__mut), 0, 'the notice was rewritten by a poll');
}));

test('M3: "Turn it on" is reached from the top of the test result: a strip under the result, the e-mails folded', async () => {
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    await withSite({ viewport }, async ({ page, go }) => {
      await go('#/make/invoice-chase');
      await page.fill('[data-field="summaryTo"] input', 'me@example.com');
      await page.locator('[data-action="test"]').click();
      await page.waitForSelector('[data-turn-on]');
      await page.waitForTimeout(150);
      const strip = await page.evaluate(() => { const a = document.querySelector('[data-action="to-turn-on"]'); return a ? a.getBoundingClientRect().bottom + scrollY : null; });
      assert.ok(strip !== null && strip < viewport.height, `${viewport.width}: the way to Turn it on is in the first screen (${strip})`);
      // Before the fix: 3.75 screens down at 1280 and 6 at 390 (the review's probe). The checks are shown once, on the card.
      const turnOnY = await page.evaluate(() => document.querySelector('[data-action="turn-on"]').getBoundingClientRect().top + scrollY);
      const limit = viewport.width > 700 ? 2.5 : 3.9; // measured 2.19 and 3.55 after the fix
      assert.ok(turnOnY < limit * viewport.height, `${viewport.width}: Turn it on at ${Math.round(turnOnY)} px, ${(turnOnY / viewport.height).toFixed(2)} screens down`);
      assert.equal(await page.locator('main ul.checks').count(), 1, 'the checks are not shown twice');
      await page.locator('[data-action="to-turn-on"]').click();
      await page.waitForTimeout(150);
      assert.equal(await page.evaluate(() => document.activeElement?.id), 'turn-on-h', 'the strip moves the focus to the turn-on card');
      assert.equal(await page.locator('[data-would-do]').evaluate(d => d.open), false, 'every e-mail in full is one click away, folded');
    });
  }
});

test('M4: the run timeline says a no is a no, and credits only list-applied yeses to the person who approved the list', async () => withSite({
  setup: async app => {
    recordDecisions(app);
    const p = await invoiceFlowOn(app); liveInvoices(app);
    const r = await app.run({ flowId: p.flowId, input: IN });
    const pending = r.pendingApprovals[0];
    await app.decideAction(r.runId, pending.approvalId, false, { channel: 'dashboard' });
    const batches = new Batches(app, { now: () => NOW });
    const b = await batches.preview(p.flowId);
    const done = await batches.approve(b.batchId, { channel: 'dashboard', listDigest: listDigest(b) });
    return { rejected: r.runId, listRun: done.runId, items: b.items.length };
  }
}, async ({ page, go, ids }) => {
  await go(`#/runs/${ids.rejected}`);
  const rows = await page.locator('tr[data-event="approval.decided"]').evaluateAll(t => t.map(r => [...r.cells].map(c => c.textContent.trim())));
  assert.equal(rows.length, 1);
  assert.equal(rows[0][2], copy.run.decidedNo, 'a rejected action reads as a no');
  assert.doesNotMatch(rows[0][4], /from the yes to the list/, 'a single decision is not credited to a list approver');
  assert.match(rows[0][4], /through this page/);
  await go(`#/runs/${ids.listRun}`);
  const listRows = await page.locator('tr[data-event="approval.decided"]').evaluateAll(t => t.map(r => [...r.cells].map(c => c.textContent.trim())));
  assert.equal(listRows.length, ids.items, 'one decision per item on the approved list');
  assert.ok(listRows.every(r => r[2] === copy.run.decidedYes && /from the yes to the list/.test(r[4])), JSON.stringify(listRows));
}));

test('M5: removing an AI key redraws the card: the paste field is back and nothing says the key is saved', async () => {
  const provider = createServer((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[]}'); });
  await new Promise(r => provider.listen(0, '127.0.0.1', r));
  try {
    await withSite({ setup: app => saveSettings(app.root, { allowedAI: 'mercury' }), siteOptions: { keyCheckBaseUrl: `http://127.0.0.1:${provider.address().port}/v1` } }, async ({ page, go }) => {
      await go('#/keys');
      await page.fill('#key-inception', 'TESTKEY-ux-review-0000-abcd');
      await page.locator('[data-provider="inception"] button.primary').click();
      await page.waitForSelector('[data-provider="inception"] .ok-text');
      await go('#/settings'); await go('#/keys');
      await page.waitForSelector('[data-action="remove-key"]');
      await page.locator('[data-action="remove-key"]').click();
      await page.waitForSelector('#key-inception', { timeout: 10000 });
      assert.equal(await page.locator('[data-action="remove-key"]').count(), 0);
      assert.doesNotMatch(await page.locator('[data-provider="inception"]').textContent(), /abcd/);
    });
  } finally { await new Promise(r => provider.close(r)); }
});

test('M6: every claim\'s "(source)" link is named with the word it shows (WCAG 2.5.3)', async () => withSite({}, async ({ page, go }) => {
  let seen = 0;
  for (const route of ['#/trust', '#/pricing']) {
    await go(route);
    const links = await page.locator('main [data-claim] a').evaluateAll(as => as.map(a => ({ shown: a.textContent.replace(/[()]/g, '').trim().toLowerCase(), name: (a.getAttribute('aria-label') ?? '').toLowerCase() })));
    for (const l of links) assert.ok(l.name.includes(l.shown), `"${l.name}" does not contain "${l.shown}"`);
    seen += links.length;
  }
  assert.ok(seen >= 2, `claims checked: ${seen}`);
}));

test('M7: an automation can be turned off (its open list closes, a waiting run is cancelled) and on again; a draft can be removed', async () => withSite({
  setup: async app => {
    recordDecisions(app);
    const p = await invoiceFlowOn(app); liveInvoices(app);
    await new Batches(app, { now: () => NOW }).preview(p.flowId);
    const waiting = await app.run({ flowId: p.flowId, input: IN });
    const draft = await app.propose({ template: 'weekly-report', settings: { recipient: 'me@example.com' }, origin: 'site-form' });
    return { flowId: p.flowId, waiting: waiting.runId, draft: draft.proposalId };
  }
}, async ({ page, go, app, ids }) => {
  await go(`#/automations/${ids.flowId}`);
  await page.locator('[data-action="turn-off"]').click();
  await page.waitForSelector('[data-on-off="off"]');
  assert.equal(app.list().flows.find(f => f.flowId === ids.flowId).active, false, 'it is off');
  assert.equal(app.foundry.store.run(ids.waiting).status, 'cancelled', 'the run waiting for a yes was cancelled');
  assert.equal(new Batches(app, { now: () => NOW }).open().length, 0, 'its open list closed');
  const run = await app.run({ flowId: ids.flowId, input: IN });
  assert.equal(run.problem?.code, 'TURNED_OFF'); assert.match(run.problem.what, /turned off/);
  await page.locator('[data-action="turn-on-again"]').click();
  await page.waitForSelector('[data-on-off="on"]');
  assert.equal(app.list().flows.find(f => f.flowId === ids.flowId).active, true, 'on again, with a new yes');
  assert.equal(app.ledger.forFlow(ids.flowId).filter(a => a.status === 'approved').length, 2, 'the first yes stays in the history beside the new one');
  await go('#/automations');
  await page.locator(`[data-draft="${ids.draft}"] [data-action="remove-draft"]`).click();
  await page.waitForFunction(id => !document.querySelector(`[data-draft="${id}"]`), ids.draft);
  assert.equal(app.list().proposals.some(p => p.proposalId === ids.draft), false, 'the draft no longer waits');
  const lines = app.decisions.lines().map(l => l.kind);
  assert.ok(lines.includes('turn-off') && lines.includes('draft-removed'), lines.join(','));
}));

test('M7: turning off is a person\'s decision, kept apart from the yes, and an evidence file carries it and is checked against the log', async () => withApp(async app => {
  recordDecisions(app);
  const p = await invoiceFlowOn(app); liveInvoices(app);
  const batches = new Batches(app, { now: () => NOW });
  const b = await batches.preview(p.flowId);
  const done = await batches.approve(b.batchId, { channel: 'dashboard', listDigest: listDigest(b) });
  await assert.rejects(() => app.turnOff({ flowId: p.flowId, channel: 'mcp' }), /Only a person/);
  const off = await app.turnOff({ flowId: p.flowId, channel: 'dashboard' });
  assert.equal(off.status, 'off');
  assert.equal((await app.turnOff({ flowId: p.flowId, channel: 'dashboard' })).problem.code, 'NOT_ON');
  assert.throws(() => app.ledger.turnOff(off.approvalId, { channel: 'dashboard' }), /already turned off/);
  const bundle = JSON.parse(JSON.stringify(evidenceBundle(app, done.runId, { batches })));
  assert.ok(bundle.turnedOn, 'the run keeps the yes it was made under');
  assert.ok(bundle.ledger.some(r => r.turnedOff?.channel === 'dashboard'));
  const good = checkEvidence(bundle);
  assert.equal(good.ok, true, good.problems.join('; '));
  assert.ok(good.checked.sections.some(s => /^turn-off history \(1\)/.test(s)), good.checked.sections.join('\n'));
  const hidden = structuredClone(bundle); delete hidden.ledger.find(r => r.turnedOff).turnedOff;
  assert.ok(checkEvidence(hidden).problems.some(x => /leaves out the turn-off/.test(x)), 'a turn-off left out of the file is found');
  const forged = structuredClone(bundle); forged.ledger.find(r => r.turnedOff).turnedOff.by = 'Mallory';
  assert.ok(checkEvidence(forged).problems.some(x => /does not match its line/.test(x)), 'a rewritten turn-off is found');
  // A removed draft can't be asked about or turned on.
  const d = await app.propose({ template: 'weekly-report', settings: { recipient: 'me@example.com' }, origin: 'site-form' });
  await app.dryRun({ proposalId: d.proposalId });
  const req = app.requestApproval({ proposalId: d.proposalId });
  assert.equal(app.withdraw({ proposalId: d.proposalId, channel: 'dashboard' }).status, 'removed');
  assert.equal(app.inbox().activations.some(a => a.approvalId === req.approvalId), false, 'its request stops waiting');
  assert.throws(() => app.decideActivation(req.approvalId, true, { channel: 'dashboard' }), /removed/);
  assert.equal(app.requestApproval({ proposalId: d.proposalId }).problem.code, 'DRAFT_REMOVED');
}));

test('M8: the fallback checks are named as such, and catch what the review found they missed', async () => {
  const runAll = readFileSync(path.join(here, 'journeys', 'run-all.mjs'), 'utf8'), harness = readFileSync(path.join(here, 'journeys', 'harness.mjs'), 'utf8');
  assert.match(runAll, /Fallback a11y issues \(not axe-core\)/);
  assert.doesNotMatch(runAll, /\| A11y issues \|/);
  assert.match(harness, /focus lost after/);
  const context = await (await browser()).newContext();
  try {
    const page = await context.newPage();
    const shell = body => `<!doctype html><html lang="en"><body><a class="skip" href="#v">Skip</a><header><nav><a data-nav="help" href="#">Help</a></nav></header><main id="v"><h1>T</h1>${body}</main><footer></footer></body></html>`;
    const issuesOf = async body => { await page.setContent(shell(body)); return a11y(page); };
    assert.deepEqual(await issuesOf('<p>fine</p><a href="#" aria-label="Source: the claim">(source)</a>'), []);
    assert.ok((await issuesOf('<a href="#" aria-label="Where this comes from: the claim">(source)</a>')).some(x => /label not in name/.test(x)), 'M6');
    assert.ok((await issuesOf('<a href="#"><span>Waiting for you</span><span aria-label="1 waiting for you">1</span></a>')).some(x => /repeats itself/.test(x)), 'm16');
    assert.ok((await issuesOf('<div role="list"><article role="listitem"><h2>x</h2></article></div>')).some(x => /not allowed on article/.test(x)), 'm11');
    assert.ok((await issuesOf('<ol><li>€300, asked for by Dana (who would also approve it): <select aria-label="Case 1: what should happen"><option>Allowed</option></select></li></ol>')).some(x => /without its item's words/.test(x)), 'm17');
  } finally { await context.close(); }
});

// ------------------------------------------------------------------------------------------------ minor
test('m1: a key that went out of date while the tab was open shows the page with the one command, not "couldn\'t load"', async () => withSite({ viewport: { width: 390, height: 844 } }, async ({ page, restart }) => {
  await restart(); // Foundry started again: every start makes new keys
  await page.evaluate(() => { location.hash = '#/automations'; });
  await page.waitForSelector('main [data-no-key]', { timeout: 10000 });
  await page.waitForTimeout(500);
  assert.equal(await page.locator('main [data-no-key]').getAttribute('data-no-key'), 'stale');
  assert.doesNotMatch(await page.locator('main h1').textContent(), new RegExp(copy.errors.pageTitle));
  assert.equal(await page.locator('main [data-error-panel]').count(), 0);
}));

test('m2: a copy the browser refuses selects the text it says to copy; toasts are said in the live region; "too big" stays next to the file button', async () => withSite({
  setup: async app => { const p = await invoiceFlowOn(app); liveInvoices(app); const b = new Batches(app, { now: () => NOW }); const x = await b.preview(p.flowId); await b.approve(x.batchId, { channel: 'dashboard', listDigest: listDigest(x) }); },
  init: () => { Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('denied')) }, configurable: true }); }
}, async ({ page, go }) => {
  await go('#/drafts');
  const first = page.locator('[data-draft]').first();
  await first.getByRole('button', { name: copy.drafts.copyText }).click();
  await page.waitForTimeout(100);
  const body = (await first.locator('pre').textContent()).trim();
  assert.equal((await page.evaluate(() => getSelection().toString())).trim(), body, 'the text is selected before "press Ctrl+C" is said');
  await page.waitForFunction(t => document.getElementById('live-polite').textContent === t, copy.snippet.selected);
  assert.equal(await page.locator('#toast').getAttribute('aria-hidden'), 'true', 'the toast is a visual echo only');
  await go('#/import');
  await page.locator('main input[type=file]').setInputFiles({ name: 'big.json', mimeType: 'application/json', buffer: Buffer.alloc(5 * 1024 * 1024 + 10, 32) });
  await page.waitForSelector('.drop .field-error:not([hidden])');
  assert.equal(await page.locator('.drop .field-error').textContent(), copy.drop.tooBig);
  await page.waitForTimeout(4300);
  assert.equal(await page.locator('.drop .field-error').isVisible(), true, 'still there after a toast would have gone');
}));

test('m3: the page heading comes first; the policy notice, the waiting banner and the step marker follow it', async () => {
  const saved = process.env.FOUNDRY_MANAGED_DIR;
  process.env.FOUNDRY_MANAGED_DIR = path.join(here, 'fixtures', 'managed', 'etc-claude-code'); // the organisation manages Claude Code here
  try {
    await withSite({
      setup: async app => { const p = await app.propose({ template: 'invoice-chase', settings: { sendSummary: true, summaryTo: 'me@example.com' }, origin: 'site-form' }); await app.dryRun({ proposalId: p.proposalId }); app.requestApproval({ proposalId: p.proposalId }); return { proposalId: p.proposalId }; }
    }, async ({ page, go, ids }) => {
      // The first of these in the page's order: before the fix, the policy notice, the waiting banner or the step marker came before the h1.
      const order = () => page.evaluate(() => [...document.querySelectorAll('main > div *')].filter(e => e.matches('h1, h2, .stepper, .banner, [data-managed]')).slice(0, 3).map(e => e.matches('h1') ? 'h1' : e.matches('[data-managed]') ? 'managed' : e.matches('.stepper') ? 'stepper' : e.matches('.banner') ? 'banner' : e.tagName.toLowerCase()));
      await go('#/');
      await page.waitForSelector('main [data-managed]');
      const home = await order();
      assert.equal(home[0], 'h1', `home: ${home}`);
      assert.ok(home.includes('managed') && home.includes('banner'), `home shows the policy notice and the waiting banner after the h1: ${home}`);
      for (const route of ['#/make/invoice-chase', `#/checked/${ids.proposalId}`]) {
        await go(route);
        const o = await order();
        assert.equal(o[0], 'h1', `${route}: ${o}`);
        assert.ok(o.includes('stepper'), `${route}: the step marker follows: ${o}`);
      }
    });
  } finally { if (saved === undefined) delete process.env.FOUNDRY_MANAGED_DIR; else process.env.FOUNDRY_MANAGED_DIR = saved; }
});

test('m4: an answer about a file is remembered for the next file of the same kind, offered (not applied) only when it still fits', () => withApp(async app => {
  const text = fixture('invoices-accounting-export.csv');
  const pv = csvPreview({ template: 'invoice-chase', sheet: 'invoices', text });
  assert.ok(pv.questions.some(q => q.id === 'dateOrder:due'));
  assert.equal(recallAnswers(app.root, { template: 'invoice-chase', sheet: 'invoices', header: pv.columns, questions: pv.questions }).some(q => q.remembered), false, 'nothing before the first answer');
  rememberAnswers(app.root, { template: 'invoice-chase', sheet: 'invoices', header: pv.columns, questions: pv.questions, answers: { 'dateOrder:due': 'dmy', 'bogus:x': 'y' }, now: () => NOW });
  const again = recallAnswers(app.root, { template: 'invoice-chase', sheet: 'invoices', header: [...pv.columns].reverse(), questions: pv.questions });
  assert.deepEqual(again.find(q => q.id === 'dateOrder:due').remembered, { value: 'dmy', at: new Date(NOW).toISOString() }, 'a reordered export still matches');
  assert.equal(recallAnswers(app.root, { template: 'invoice-chase', sheet: 'invoices', header: [...pv.columns, 'Extra'], questions: pv.questions }).some(q => q.remembered), false, 'another export is asked afresh');
  assert.notEqual(headerSignature(['A', 'b']), headerSignature(['A', 'c']));
  // A "which values" answer is offered only if the new file has no value the person was not asked about.
  const many = [{ id: 'values:status', kind: 'many', choices: [{ value: 'Overdue' }, { value: 'Part paid' }] }];
  rememberAnswers(app.root, { template: 'invoice-chase', sheet: 'invoices', header: ['s'], questions: many, answers: { 'values:status': ['Overdue'] }, now: () => NOW });
  assert.deepEqual(recallAnswers(app.root, { template: 'invoice-chase', sheet: 'invoices', header: ['s'], questions: many })[0].remembered.value, ['Overdue']);
  const wider = [{ ...many[0], choices: [...many[0].choices, { value: 'Disputed' }] }];
  assert.equal(recallAnswers(app.root, { template: 'invoice-chase', sheet: 'invoices', header: ['s'], questions: wider })[0].remembered, undefined, 'a new value means asking again');
}));

test('m4: in the page, the date order answered once is already chosen for the next upload, and says so', async () => withSite({
  setup: async app => { const p = await invoiceFlowOn(app); return { flowId: p.flowId }; }
}, async ({ page, go, ids }) => {
  await go(`#/go-live/${ids.flowId}`);
  await page.locator('[data-sheet="invoices"] input[type=file]').setInputFiles(path.join(here, 'fixtures', 'invoices-accounting-export.csv'));
  await page.waitForSelector('[data-question="dateOrder:due"]');
  assert.equal(await page.locator('[data-question="dateOrder:due"] input:checked').count(), 0, 'the first time it is asked');
  await page.locator('[data-question="dateOrder:due"] input[value="dmy"]').check();
  await page.locator('[data-action="use-columns"]').click();
  await page.waitForSelector('[data-action="batch-approve"]', { timeout: 30000 });
  await go(`#/automations/${ids.flowId}`); await go(`#/go-live/${ids.flowId}`);
  await page.locator('[data-action="replace-list"]').click();
  await page.locator('[data-sheet="invoices"] input[type=file]').setInputFiles(path.join(here, 'fixtures', 'invoices-accounting-export.csv'));
  await page.waitForSelector('[data-question="dateOrder:due"]');
  assert.equal(await page.locator('[data-question="dateOrder:due"] input[value="dmy"]').isChecked(), true, 'the second time it is already chosen');
  assert.match(await page.locator('[data-remembered="dateOrder:due"]').textContent(), /last file like this/);
}));

test('m5, m6: a setting that was not saved is put back, with the message at its own section; a refused delete says nothing was deleted', async () => withSite({}, async ({ page, go }) => {
  await go('#/settings');
  await page.route('**/api/settings', r => r.request().method() === 'POST' ? r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'ERROR' }, problem: { what: 'Something went wrong inside Foundry.' } }) }) : r.continue());
  await page.locator('#practice-only').click();
  await page.waitForSelector('[data-saved="practice"] [data-error-panel]');
  assert.equal(await page.locator('#practice-only').isChecked(), false, 'the box shows the setting in force');
  assert.equal(await page.evaluate(() => document.querySelector('[data-saved="practice"]').closest('section').contains(document.getElementById('practice-only'))), true, 'the message sits in the same section');
  await page.unroute('**/api/settings');
  await page.fill('#forget-confirm', 'please');
  await page.locator('[data-action="forget-lists"]').click();
  await page.waitForSelector('[data-forget] [data-error-panel]');
  const notDone = await page.locator('[data-forget] [data-error-panel] dd').nth(1).textContent();
  assert.equal(notDone.trim(), copy.settings.nothingDeleted);
}));

test('m7: every error panel in the pages says what was not done for its own action (no "Nothing was sent." where nothing could be sent)', () => {
  const files = ['site.js', 'components/ui.js', ...readdirSync(path.join(PUBLIC, 'views')).map(f => `views/${f}`)];
  const missing = [];
  for (const f of files) {
    const src = source(f);
    // Calls of the shared errorPanel() and showError() (not a field's own .showError() method, nor their definitions).
    for (const m of src.matchAll(/(?<![.\w])(errorPanel|showError)\((?!container, error|error, \{ action|error, options\))/g)) {
      let depth = 0, i = m.index + m[0].length - 1, end = i;
      for (; i < src.length; i++) { if (src[i] === '(') depth += 1; else if (src[i] === ')') { depth -= 1; if (depth === 0) { end = i; break; } } }
      if (!/notDone:/.test(src.slice(m.index, end))) missing.push(`${f}: ${src.slice(m.index, m.index + 80)}`);
    }
  }
  assert.deepEqual(missing, []);
  assert.equal(copy.errors.nothingSent, undefined, 'no blanket default left in the copy');
});

test('m8: a file dropped beside the drop zone does not leave Foundry, and the same file can be picked again', async () => withSite({ setup: async app => ({ flowId: (await invoiceFlowOn(app)).flowId }) }, async ({ page, go, ids }) => {
  await go(`#/go-live/${ids.flowId}`);
  const prevented = await page.evaluate(() => ['dragover', 'drop'].map(type => { const dt = new DataTransfer(); dt.items.add(new File(['a,b'], 'x.csv', { type: 'text/csv' })); const e = new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }); document.querySelector('footer').dispatchEvent(e); return e.defaultPrevented; }));
  assert.deepEqual(prevented, [true, true]);
  await page.locator('[data-sheet="invoices"] input[type=file]').setInputFiles(path.join(here, 'fixtures', 'invoices-accounting-export.csv'));
  await page.waitForSelector('[data-question="dateOrder:due"]');
  assert.equal(await page.locator('[data-sheet="invoices"] input[type=file]').inputValue(), '', 'emptied after reading');
}));

test('m9: a loading page says so and can\'t be used; "Test it now" is not left busy after an error; a decision can\'t be pressed twice', async () => withSite({
  setup: async app => {
    const p = await app.propose({ template: 'invoice-chase', settings: { sendSummary: true, summaryTo: 'me@example.com' }, origin: 'site-form' });
    const q = await app.propose({ template: 'weekly-report', settings: { recipient: 'me@example.com' }, origin: 'site-form' });
    await app.dryRun({ proposalId: q.proposalId }); app.requestApproval({ proposalId: q.proposalId });
    return { untested: p.proposalId };
  }
}, async ({ page, go, ids }) => {
  await page.route('**/api/automations', async r => { await new Promise(x => setTimeout(x, 1200)); return r.continue(); });
  await page.evaluate(() => { location.hash = '#/automations'; });
  await page.waitForTimeout(300);
  assert.deepEqual(await page.evaluate(() => { const l = document.getElementById('loading'); return { loading: !!l && !l.hidden && !!l.offsetHeight, inert: document.getElementById('view').inert }; }), { loading: true, inert: true });
  await page.waitForFunction(() => !document.getElementById('view').hasAttribute('aria-busy'));
  assert.equal(await page.evaluate(() => document.getElementById('loading').hidden), true);
  await page.unroute('**/api/automations');
  await go(`#/checked/${ids.untested}`);
  await page.route('**/api/practice', r => r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'ERROR' }, problem: { what: 'Something went wrong inside Foundry.' } }) }));
  await page.locator('[data-action="run-test"]').click();
  await page.waitForSelector('main [data-error-panel]');
  assert.equal(await page.locator('[data-action="run-test"]').getAttribute('aria-busy'), null);
  await page.unroute('**/api/practice');
  await go('#/waiting');
  let decides = 0;
  await page.route('**/api/decide', async r => { decides += 1; await new Promise(x => setTimeout(x, 400)); return r.continue(); });
  await page.locator('[data-action="activation-yes"]').dblclick();
  await page.waitForTimeout(1500);
  assert.equal(decides, 1, 'one press decides');
}));

test('m10: the timeline toggle keeps its words and says its state through aria-pressed', async () => withSite({
  setup: async app => { const p = await invoiceFlowOn(app); const r = await app.run({ flowId: p.flowId, input: IN }); return { runId: r.runId }; }
}, async ({ page, go, ids }) => {
  await go(`#/runs/${ids.runId}`);
  const toggle = page.locator('[data-action="every-event"]');
  const before = await toggle.textContent();
  await toggle.click();
  assert.equal(await toggle.textContent(), before);
  assert.equal(await toggle.getAttribute('aria-pressed'), 'true');
}));

test('m11, m12, m14, m16: cards are a real list; done steps say "(done)"; .h3 is a real size; the Waiting link says its count once', async () => withSite({
  setup: async app => { const p = await app.propose({ template: 'invoice-chase', settings: { sendSummary: true, summaryTo: 'me@example.com' }, origin: 'site-form' }); await app.dryRun({ proposalId: p.proposalId }); app.requestApproval({ proposalId: p.proposalId }); return { proposalId: p.proposalId }; }
}, async ({ page, go, ids }) => {
  await go('#/');
  assert.equal(await page.locator('article[role]').count(), 0, 'no role on an article');
  assert.ok(await page.locator('main ul.grid > li > article[data-template]').count() >= 5);
  await page.waitForFunction(() => !document.getElementById('waiting-count').hidden, null, { timeout: 15000 });
  const name = await page.evaluate(() => { const a = document.querySelector('[data-nav="waiting"]'); return [...a.childNodes].filter(n => n.nodeType !== 1 || n.getAttribute('aria-hidden') !== 'true').map(n => n.textContent).join(' ').replace(/\s+/g, ' ').trim(); });
  assert.equal(name, 'Waiting for you (1)');
  await go(`#/checked/${ids.proposalId}`);
  assert.equal(await page.locator('.stepper li.done .sr-only').first().textContent(), ` ${copy.steps.done}`);
  await go('#/help');
  assert.equal(await page.locator('main h2.h3').first().evaluate(e => getComputedStyle(e).fontSize), '20px');
}));

test('m13: repeated buttons say which item they are for (drafts, recorded answers, settings)', async () => withSite({
  setup: async app => { const p = await invoiceFlowOn(app); liveInvoices(app); const b = new Batches(app, { now: () => NOW }); const x = await b.preview(p.flowId); await b.approve(x.batchId, { channel: 'dashboard', listDigest: listDigest(x) }); }
}, async ({ page, go }) => {
  const described = sel => page.locator(sel).evaluateAll(es => es.map(e => (e.getAttribute('aria-describedby') ?? '').split(/\s+/).map(id => document.getElementById(id)?.textContent ?? '').join(' ').trim()));
  await go('#/drafts');
  for (const sel of [`main button:text-is("${copy.drafts.copyText}")`, 'main [data-draft] input[type=checkbox]']) {
    const d = await described(sel);
    assert.ok(d.length >= 2 && d.every(Boolean), `${sel}: ${JSON.stringify(d)}`);
    assert.equal(new Set(d).size, d.length, `${sel}: each one is described by its own draft`);
  }
  await go('#/make/invoice-chase');
  const changes = await described('[data-setting] button.link');
  assert.ok(changes.length >= 2 && new Set(changes).size === changes.length && changes.every(Boolean), JSON.stringify(changes));
}));

test('m15: a link to one claim shows that claim and puts the focus on it', async () => {
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    await withSite({ viewport }, async ({ page, go }) => {
      await go('#/claims?claim=C13');
      await page.waitForTimeout(200);
      const r = await page.evaluate(() => ({ y: scrollY, top: document.getElementById('claim-C13').getBoundingClientRect().top, focus: document.activeElement?.id }));
      assert.ok(r.y > 0 && r.top >= -2 && r.top < 200, JSON.stringify(r));
      assert.equal(r.focus, 'claim-C13');
    });
  }
});

test('m17, m18: an example\'s answer is named by its case; a missing name, a wrong address and an unknown currency are said, not dropped', async () => withSite({ context: { locale: 'en-IN' } }, async ({ page, go }) => {
  await go('#/org');
  await page.locator('[data-action="start-small-team"]').click();
  await page.waitForSelector('#person-name');
  await page.locator('[data-action="add-person"]').click();
  assert.equal(await page.locator('#person-name').getAttribute('aria-invalid'), 'true');
  assert.equal((await page.locator('#person-name-error').textContent()).trim(), copy.org.nameMissing);
  await page.fill('#person-name', 'Dana'); await page.fill('#person-email', 'dana-at-example');
  await page.locator('[data-action="add-person"]').click();
  assert.equal((await page.locator('#person-email-error').textContent()).trim(), copy.org.emailBad);
  assert.equal(await page.locator('[data-person]').filter({ hasText: 'Dana' }).count(), 0, 'not added with a bad address');
  await page.fill('#person-email', 'dana@example.com');
  await page.locator('[data-action="add-person"]').click();
  await page.waitForSelector('[data-person]:has-text("Dana")');
  assert.equal(await page.locator('[data-currency="money-out"]').inputValue(), 'INR', 'en-IN is offered rupees, not euros');
  const currencies = await page.evaluate(async () => { const { defaultCurrency } = await import('/views/org.js'); return ['ja-JP', 'en-GB', 'de-DE', 'en', 'en-US', 'fr-CA', 'xx-ZZ'].map(l => defaultCurrency(l)); });
  assert.deepEqual(currencies, ['JPY', 'GBP', 'EUR', 'USD', 'USD', 'CAD', null]);
  await page.fill('[data-amount="money-out"]', '250'); await page.locator('[data-amount="money-out"]').dispatchEvent('change');
  await page.locator('[data-approver="money-out"]').selectOption({ label: 'Dana' });
  await page.locator('[data-action="money-out"] [data-action="make-rule"]').click();
  await page.waitForSelector('[data-rule] [data-example="1"] select');
  const named = await page.locator('[data-rule] [data-example] select').evaluateAll(ss => ss.map(s => (s.getAttribute('aria-labelledby') ?? '').split(' ').map(id => document.getElementById(id)?.textContent ?? '').join(' ')));
  const labels = await page.locator('[data-rule] [data-example] > span:first-child').allTextContents();
  assert.ok(named.length === 6 && named.every((n, i) => n.includes(labels[i]) && /what should happen/i.test(n)), JSON.stringify(named));
  assert.match(labels[0], /₹|INR/);
}));

test('m19: "your list is from an earlier day" counts days where the person is, not in UTC', async () => withSite({
  context: { timezoneId: 'Pacific/Auckland' },
  setup: async app => {
    const p = await invoiceFlowOn(app); liveInvoices(app);
    // 12:00 UTC on 20 Oct is 01:00 on 21 Oct in Auckland; Foundry's "today" is 09:00 UTC on 21 Oct, 22:00 the same day there.
    const at = new Date('2026-10-20T12:00:00Z'); utimesSync(path.join(app.worldDir, 'sheets', 'invoices.json'), at, at);
    return { flowId: p.flowId };
  }
}, async ({ page, go, ids }) => {
  await go(`#/go-live/${ids.flowId}`);
  await page.waitForSelector('[data-action="make-list"]');
  assert.equal(await page.locator('[data-stale]').count(), 0, 'the same day in Auckland is not "an earlier day"');
  assert.deepEqual(await page.evaluate(async () => { const { sameDay } = await import('/views/go-live.js'); return [sameDay('2026-10-20T12:00:00Z', '2026-10-21T09:00:00Z'), sameDay('2026-10-20T10:00:00Z', '2026-10-21T09:00:00Z')]; }), [true, false]);
}));

test('m20: a toast never covers the control that has the focus', async () => withSite({
  viewport: { width: 390, height: 844 },
  setup: async app => { const p = await app.propose({ template: 'invoice-chase', settings: { sendSummary: true, summaryTo: 'me@example.com' }, origin: 'site-form' }); await app.dryRun({ proposalId: p.proposalId }); return { proposalId: p.proposalId }; }
}, async ({ page, go, ids }) => {
  await go(`#/checked/${ids.proposalId}`);
  await page.waitForLoadState('networkidle'); await page.waitForTimeout(500);
  // At phone width the decision buttons span the page, under where the toast appears; Turn it on is placed at the bottom edge.
  const button = page.locator('[data-action="turn-on"]');
  await button.focus();
  await button.evaluate(b => { const bottom = b.getBoundingClientRect().bottom + scrollY; window.scrollTo(0, bottom - innerHeight + 4); });
  // The setup itself is checked, so the test can't pass because the button sat somewhere else or lost the focus.
  assert.deepEqual(await button.evaluate(b => [document.activeElement === b, b.getBoundingClientRect().bottom > innerHeight - 40]), [true, true], 'the focused button sits at the bottom edge');
  await page.evaluate(async t => { const { toast } = await import('/site.js'); toast(t); }, copy.snippet.copied);
  assert.equal(await button.evaluate(b => document.activeElement === b), true, 'the button still has the focus');
  const r = await page.evaluate(() => { const a = document.activeElement.getBoundingClientRect(), t = document.getElementById('toast').getBoundingClientRect(); return { overlap: a.left < t.right && t.left < a.right && a.top < t.bottom && t.top < a.bottom, a: [a.left, a.top, a.right, a.bottom], t: [t.left, t.top, t.right, t.bottom] }; });
  assert.equal(r.overlap, false, JSON.stringify(r));
}));

test('m21: plain words and short lines: no address in the footer, four ways in, no "highlighted", one voice, notes in the copy file, lines of at most 68 characters', async () => {
  assert.doesNotMatch(copy.footer.local, /127\.0\.0\.1/);
  assert.match(copy.docs.lead, /^Four ways in/);
  assert.equal(Object.keys(copy.docs).filter(k => /^(dev|op|team|audit)Title$/.test(k)).length, 4);
  assert.doesNotMatch(copy.make.answerFirstSay, /highlight/i);
  assert.doesNotMatch(JSON.stringify([copy.make.willTitle, copy.checked.checksTitle, copy.describe.none, copy.describe.noneLead, copy.ask.why]), /\bI('ll|'m)?\b/);
  for (const f of ['views/checked.js', 'views/waiting.js']) assert.doesNotMatch(source(f), /gets an e-mail; you record|The person named/, f);
  assert.notEqual(copy.turnon.done_means, 'Done means');
  await withSite({ setup: async app => { const p = await invoiceFlowOn(app); return { flowId: p.flowId, proposalId: p.proposalId }; } }, async ({ page, go, ids }) => {
    for (const route of ['#/make/invoice-chase', `#/checked/${ids.proposalId}`, `#/automations/${ids.flowId}`, '#/trust', '#/']) {
      await go(route);
      const wide = await page.evaluate(() => {
        return [...document.querySelectorAll('main p')].filter(p => p.offsetWidth && p.textContent.trim().length > 80).map(p => {
          const s = getComputedStyle(p), c = document.createElement('canvas').getContext('2d'); c.font = `${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
          const ch = c.measureText('0').width; return { chars: p.clientWidth / ch, text: p.textContent.slice(0, 40) };
        }).filter(x => x.chars > 69);
      });
      assert.deepEqual(wide, [], route);
    }
  });
});
