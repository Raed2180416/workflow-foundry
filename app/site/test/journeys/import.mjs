// IMPORT (SPEC §9.14, §16; Preview): drop an n8n export and read which steps Foundry could translate and what it touches. Foundry runs
// nothing, and a ✓ marks only what Foundry did (honesty review M1).
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
    // Honesty review M1: ✓ only for what Foundry did. Translating is not running; calling it in n8n is Planned, with what to do today.
    const marks = await page.locator('[data-import-report] ul.checks li').evaluateAll(lis => lis.map(li => ({ line: li.dataset.line, status: li.dataset.status ?? null,
      tick: li.querySelector('.mark-ok')?.textContent ?? null, cross: li.querySelector('.mark-bad')?.textContent ?? null, chip: li.querySelector('[data-chip]')?.dataset.chip ?? null,
      instead: !!li.querySelector('[data-instead]'), text: li.textContent.replace(/\s+/g, ' ').trim() })));
    log.checks = { report: report.slice(0, 600), lines: marks.map(m => `${m.line}:${m.tick ? 'yes' : m.chip ?? 'no'}`) };
    assert.match(report, /Foundry ran nothing/);
    const wrap = marks.find(m => m.line === 'wrap');
    assert.ok(wrap && wrap.status === 'planned' && wrap.chip === 'planned' && !wrap.tick && wrap.instead, JSON.stringify(wrap));
    assert.equal(marks.some(m => m.tick && /can run|can be called|comes over/i.test(m.text)), false, 'no ✓ for running or calling it');
    const translated = marks.find(m => m.line === 'translated');
    if (translated?.tick) { assert.match(translated.text, /Not run/); assert.ok(marks.find(m => m.line === 'run' && m.cross), 'running it is not offered as done'); }
    const l = app.list();
    assert.equal(l.flows.length + l.proposals.length, 0, 'nothing was created');
    assert.equal(app.foundry.store.runs().length, 0, 'nothing ran');
    await shot('verdict-and-risk');
  });
});
