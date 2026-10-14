// G21 tier 0 (tools/ui) in a real browser: the pre-installed Chromium fills and submits a rendered form served from
// 127.0.0.1, and the host gets the typed answer. Offline: every request that is not to the loopback host is aborted
// and counted. Skips, with the reason, when Playwright or Chromium is missing. $0, no model.
//   node --test tests/ui-form-browser.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { chromiumExecutable, playwrightPackage } from './support/gates.mjs';
import { compileForm, createFormHandler } from '../tools/ui/index.mjs';

let playwright = null, why = playwrightPackage();
if (!why) { try { playwright = await import('playwright'); } catch (error) { why = `playwright is not resolvable from the repo (${error.code ?? error.message})`; } }
const executable = chromiumExecutable() ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : null);
if (!why && !executable) why = 'requires /usr/bin/chromium, a Playwright chromium under PLAYWRIGHT_BROWSERS_PATH, or /opt/pw-browsers/chromium (none found)';
const skip = why || false;

const SCHEMA = { type: 'object', additionalProperties: false, required: ['decision', 'amount', 'reason'], properties: {
  decision: { enum: ['release', 'keep-hold', 'reduce-limit'], description: 'What happens to the credit hold' },
  amount: { type: 'number', minimum: 0, maximum: 1000000, title: 'Amount to release (EUR)' },
  reason: { type: 'string', minLength: 1, maxLength: 500 },
  tags: { type: 'array', items: { enum: ['urgent', 'vip', 'fraud-check'] }, maxItems: 2 },
  notify: { type: 'boolean', title: 'Notify the customer' },
  reference: { type: 'string', pattern: '^INV-[0-9]{6}$', maxLength: 10 },
} };
const HOSTILE_QUESTION = 'Release the hold on SO-1042? <img src=x onerror="window.__pwned=1"> "><script>window.__pwned=2</script> '
  + `${'W'.repeat(300)} evil${String.fromCodePoint(0x202E)}txt`;

async function harness(t, { question = 'Release the credit hold on order SO-1042?', viewport = { width: 640, height: 900 } } = {}) {
  const spec = compileForm({ answerSchema: SCHEMA, question, formName: 'hold' });
  const answers = [];
  const server = createServer(createFormHandler({ spec, token: 'tok-browser', onAnswer: a => answers.push(a) }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await playwright.chromium.launch({ executablePath: executable, args: ['--no-sandbox'] });
  t.after(async () => { await browser.close(); await new Promise(resolve => server.close(resolve)); });
  const context = await browser.newContext({ viewport, reducedMotion: 'reduce', locale: 'en-US', timezoneId: 'UTC', serviceWorkers: 'block' });
  const seen = { blocked: [], console: [], pageErrors: [], failed: [], requests: [] };
  await context.route('**/*', route => {
    const url = route.request().url();
    seen.requests.push(`${route.request().method()} ${url}`);
    if (url.startsWith(`${origin}/`)) return route.continue();
    seen.blocked.push(url);
    return route.abort();
  });
  const page = await context.newPage();
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') seen.console.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', e => seen.pageErrors.push(String(e)));
  page.on('requestfailed', r => seen.failed.push(`${r.url()} ${r.failure()?.errorText}`));
  return { spec, answers, origin, page, seen };
}
// Chromium logs any 4xx document as "Failed to load resource"; the host answers a rejected submission with 422 on
// purpose (machine-readable for the bed host), so exactly that line is expected once per rejection and nothing else.
const REJECTED_LINE = 'error: Failed to load resource: the server responded with a status of 422 (Unprocessable Entity)';
const clean = (seen, { rejections = 0 } = {}) => {
  assert.deepEqual(seen.blocked, [], 'no request left the loopback host');
  assert.deepEqual(seen.console, Array(rejections).fill(REJECTED_LINE), 'no other console error or warning (CSP violations are console errors)');
  assert.deepEqual(seen.pageErrors, []);
  assert.deepEqual(seen.failed, []);
};

test('browser: a person fills the form with the pointer, a planted "12abc" is rejected with a linked error summary, the corrected form yields the typed answer', { skip, timeout: 60000 }, async t => {
  const { answers, origin, page, seen } = await harness(t);
  await page.goto(`${origin}/`);
  assert.equal(await page.title(), 'Release the credit hold on order SO-1042?');
  assert.equal(await page.evaluate(() => document.querySelectorAll('script, img, iframe, link, object, embed').length), 0);
  // labels drive every control (getByLabel fails if a control has no accessible name)
  await page.getByLabel('release', { exact: true }).check();
  await page.getByLabel('Amount to release (EUR)').fill('12abc');
  const reason = '\nPaid in full </textarea><script>window.__pwned=3</script>\nsecond line';
  await page.getByLabel('Reason').fill(reason);
  await page.getByLabel('vip').check();
  await page.getByLabel('urgent').check();
  await page.getByLabel('Yes').check();
  await page.getByLabel('Reference').fill('INV-123456');
  const [rejected] = await Promise.all([page.waitForNavigation(), page.getByRole('button', { name: 'Submit answer' }).click()]);
  assert.equal(rejected.status(), 422);
  assert.equal(answers.length, 0, 'nothing reached the host callback');
  assert.match(await page.title(), /^Error: /);
  // the summary is announced and focused, and its entry links to the field
  const summary = page.getByRole('alert');
  assert.match(await summary.innerText(), /There is a problem[\s\S]*Amount to release \(EUR\): enter a number, like 1250\.50/);
  assert.equal(await page.evaluate(() => document.activeElement?.className), 'error-summary');
  const amount = page.getByLabel('Amount to release (EUR)');
  assert.equal(await amount.getAttribute('aria-invalid'), 'true');
  assert.match(await amount.getAttribute('aria-describedby'), /f1-error/);
  assert.equal(await amount.inputValue(), '12abc', 'what the person typed is kept');
  assert.equal(await page.getByLabel('Reason').inputValue(), reason, 'the leading newline and the hostile text survive the re-render');
  assert.equal(await page.getByLabel('vip').isChecked(), true);
  await summary.getByRole('link').click();
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'f1', 'the summary link moves focus to the field');
  await amount.fill('1250.50');
  const [accepted] = await Promise.all([page.waitForNavigation(), page.getByRole('button', { name: 'Submit answer' }).click()]);
  assert.equal(accepted.status(), 200);
  assert.deepEqual(answers, [{ decision: 'release', amount: 1250.5, reason, tags: ['urgent', 'vip'], notify: true, reference: 'INV-123456' }]);
  assert.match(await page.locator('#answer').innerText(), /"amount": 1250.5/);
  assert.equal(await page.evaluate(() => window.__pwned), undefined);
  clean(seen, { rejections: 1 });
});

test('browser: keyboard only, in spec order (radio groups are one Tab stop), and the ARIA tree matches the declared fields', { skip, timeout: 60000 }, async t => {
  const { spec, answers, origin, page, seen } = await harness(t);
  await page.goto(`${origin}/`);
  // Tab order equals spec order: one stop per text control and radio group, one per checkbox, then the button
  const order = [];
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => { const e = document.activeElement; return e?.tagName === 'BUTTON' ? 'button' : e?.getAttribute('name'); });
    order.push(focused);
    if (focused === 'button') break;
  }
  const expected = spec.fields.flatMap(f => f.componentType === 'CheckBoxGroup' ? f.options.map(() => f.name) : [f.name]).concat('button');
  assert.deepEqual(order, expected);
  // the accessible tree: one group or textbox per declared field, named by its label
  const snapshot = await page.locator('form').ariaSnapshot();
  for (const line of ['- heading "Release the credit hold on order SO-1042?" [level=1]', '- group "Decision (required)"', '- radio "release"',
    '- textbox "Amount to release (EUR) (required)"', '- textbox "Reason (required)"', '- group "Tags (optional)"', '- checkbox "fraud-check"',
    '- group "Notify the customer (optional)"', '- textbox "Reference (optional)"', '- button "Submit answer"']) assert.ok(snapshot.includes(line), `ARIA snapshot has ${line}\n${snapshot}`);
  // complete it with the keyboard alone
  await page.goto(`${origin}/`);
  await page.keyboard.press('Tab'); // decision: first radio
  await page.keyboard.press('ArrowDown'); // selects keep-hold
  await page.keyboard.press('Tab'); await page.keyboard.type('0');
  await page.keyboard.press('Tab'); await page.keyboard.type('Customer asked to wait');
  await page.keyboard.press('Tab'); // tags: urgent
  await page.keyboard.press('Tab'); await page.keyboard.press('Space'); // vip
  await page.keyboard.press('Tab'); // fraud-check
  await page.keyboard.press('Tab'); await page.keyboard.press('ArrowDown'); // notify: radio "No" (ArrowDown from the first radio selects the second)
  await page.keyboard.press('Tab'); // reference stays blank
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement?.tagName), 'BUTTON');
  await Promise.all([page.waitForNavigation(), page.keyboard.press('Enter')]);
  assert.deepEqual(answers, [{ decision: 'keep-hold', amount: 0, reason: 'Customer asked to wait', tags: ['vip'], notify: false }]);
  clean(seen);
});

test('browser: hostile workflow text stays text, adds no element, loads nothing, and the page reflows at 320 px without horizontal scrolling', { skip, timeout: 60000 }, async t => {
  const { origin, page, seen } = await harness(t, { question: HOSTILE_QUESTION, viewport: { width: 320, height: 640 } });
  await page.goto(`${origin}/`);
  const h1 = await page.locator('h1').innerText();
  assert.ok(h1.includes('<img src=x onerror="window.__pwned=1">') && h1.includes('<script>'), 'the markup is shown as text');
  assert.ok(h1.includes(`evil${String.fromCodePoint(0x27E6)}U+202E${String.fromCodePoint(0x27E7)}txt`), 'the bidi override is shown as a marker');
  assert.equal(await page.evaluate(() => document.querySelectorAll('img, script').length), 0);
  assert.equal(await page.evaluate(() => window.__pwned), undefined);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no horizontal scroll at 320 px');
  assert.deepEqual(seen.requests, [`GET ${origin}/`], 'the page made no request but itself');
  clean(seen);
  // the policy is enforced, not just declared: an injected inline script does not run and is reported as a violation
  await page.evaluate(() => { const s = document.createElement('script'); s.textContent = 'window.__csp = 1'; document.body.append(s); });
  assert.equal(await page.evaluate(() => window.__csp), undefined);
  await page.waitForTimeout(100);
  assert.ok(seen.console.length >= 1 && seen.console.every(line => /Content Security Policy/.test(line)), seen.console.join('\n'));
});
