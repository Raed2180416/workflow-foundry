// KEYS (SPEC §9.13, §15.4-5, §16): you don't need a key. With no keychain on the computer, the page says so and saves nothing;
// with one, a pasted key is checked against the provider (here a fake provider on 127.0.0.1) and kept only in the keychain: the
// page shows its last four characters, and the key is absent from the page, every response, the workspace files and the log.
// nice node --test --test-concurrency=1 app/site/test/journeys/keys.mjs
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { journey, closeBrowser } from './harness.mjs';

after(closeBrowser);

const CANARY = 'CANARY-journey-7777-8888-wxyz';
const files = dir => readdirSync(dir).flatMap(f => statSync(path.join(dir, f)).isDirectory() ? files(path.join(dir, f)) : [path.join(dir, f)]);
const text = async (page, sel) => (await page.locator(sel).first().textContent())?.replace(/\s+/g, ' ').trim() ?? '';

test('KEYS without a keychain: the page says where a key could go, and offers nothing to paste into', async () => {
  await journey({ name: 'keys-none', env: { FOUNDRY_KEYCHAIN: 'none' } }, async ({ page, shot, log }) => {
    await page.goto(`${new URL(page.url()).origin}/#/keys`);
    await page.waitForSelector('[data-no-keychain]');
    log.checks = { refusal: await text(page, '[data-no-keychain]') };
    assert.equal(await page.locator('[data-provider="inception"] button.primary').isDisabled(), true);
    await shot('no-keychain');
  });
});

test('KEYS with a keychain: a pasted canary key is checked on 127.0.0.1, saved, shown as its last four, and found nowhere else', async () => {
  const seen = [];
  const provider = createServer((req, res) => { seen.push(req.url); res.writeHead(req.headers.authorization === `Bearer ${CANARY}` ? 200 : 401, { 'content-type': 'application/json' }); res.end('{"data":[]}'); });
  await new Promise(r => provider.listen(0, '127.0.0.1', r));
  const logs = [];
  try {
    await journey({ name: 'keys', siteOptions: { keyCheckBaseUrl: `http://127.0.0.1:${provider.address().port}/v1`, log: l => logs.push(l) } }, async ({ page, person, shot, dir, log }) => {
      const bodies = [];
      page.on('response', async r => { if (new URL(r.url()).pathname.startsWith('/api/')) bodies.push(await r.text().catch(() => '')); });
      await page.goto(`${new URL(page.url()).origin}/#/keys`);
      await page.waitForSelector('#key-inception');
      await shot('keys-page', { note: 'you do not need a key; the cards work without AI' });
      await person.fill(page.locator('#key-inception'), CANARY);
      await person.click(page.locator('[data-provider="inception"] button.primary'));
      await page.waitForSelector('[data-provider="inception"] .ok-text');
      const saved = await text(page, '[data-provider="inception"] .ok-text');
      assert.match(saved, /wxyz/);
      await shot('saved-last-four');
      await page.goto(`${new URL(page.url()).origin}/#/settings`);
      await page.waitForSelector('#practice-only');
      await page.goto(`${new URL(page.url()).origin}/#/keys`);
      await page.waitForSelector('[data-provider="inception"] .actions button');
      await shot('saved-view');
      const dom = await page.evaluate(() => document.documentElement.outerHTML + [...document.querySelectorAll('input')].map(i => i.value).join('\n'));
      log.checks = { saved, providerCalls: seen.length, domHasKey: dom.includes(CANARY), responsesHaveKey: bodies.some(b => b.includes(CANARY)),
        filesHaveKey: files(dir).some(f => readFileSync(f).includes(CANARY)), logHasKey: JSON.stringify(logs).includes(CANARY), responses: bodies.length };
      assert.equal(seen.length, 1, 'one check, only on the person\'s click'); assert.equal(log.checks.domHasKey, false);
      assert.equal(log.checks.responsesHaveKey, false); assert.equal(log.checks.filesHaveKey, false); assert.equal(log.checks.logHasKey, false);
    });
  } finally { await new Promise(r => provider.close(r)); }
});
