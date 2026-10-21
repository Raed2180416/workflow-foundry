// IMPORT (SPEC §9.14, §16; Preview): drop an n8n export and read what would come over and what it touches. Foundry runs nothing.
// nice node --test --test-concurrency=1 app/site/test/journeys/import.mjs
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { journey, closeBrowser, fixturePath } from './harness.mjs';

after(closeBrowser);

test('IMPORT: an n8n export gets a verdict per step and a risk card; nothing is created or run', async () => {
  await journey({ name: 'import' }, async ({ page, person, shot, app, log }) => {
    await person.click(page.locator('main a[href="#/import"]'));
    await page.waitForSelector('main input[type=file]');
    await shot('import-page');
    await person.upload(page.locator('main input[type=file]'), fixturePath('n8n-synthetic.json'));
    await page.waitForSelector('[data-import-report]');
    const report = (await page.locator('[data-import-report]').textContent()).replace(/\s+/g, ' ').trim();
    log.checks = { report: report.slice(0, 600) };
    assert.match(report, /Foundry ran nothing/);
    const l = app.list();
    assert.equal(l.flows.length + l.proposals.length, 0, 'nothing was created');
    assert.equal(app.foundry.store.runs().length, 0, 'nothing ran');
    await shot('verdict-and-risk');
  });
});
