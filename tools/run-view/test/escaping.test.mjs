// Untrusted text is data: every field that came from a file or a run is rendered as text and can create no element, run no script and make no link.
//   node --test tools/run-view/test/escaping.test.mjs
// Static rules always run. The browser half drives the real page in the preinstalled Chromium (skipped, with the reason, when it or Playwright is missing).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { bundleHistoryHtml } from '../export-history.mjs';
import { tempDir } from './fixtures.mjs';
await import('../history-core.js');
const H = globalThis.HistoryCore;
const here = path.dirname(fileURLToPath(import.meta.url)), dir = path.join(here, '..');
const src = f => readFileSync(path.join(dir, f), 'utf8');

test('static: the page and its core have no markup sink, no eval, no inline style or handler, no remote URL, no request but one named same-origin fetch', () => {
  const all = src('history.js') + src('history-core.js'), html = src('history.html'), css = src('history.css');
  assert.ok(!/\.(?:innerHTML|outerHTML)\s*=|insertAdjacentHTML|\beval\s*\(|new\s+Function\s*\(|document\.write|\.srcdoc|createContextualFragment|DOMParser/.test(all), 'no markup sink');
  assert.ok(!/\.style\b|setAttribute\(\s*['"]style['"]/.test(all), 'no inline style from script');
  assert.ok(!/\sstyle\s*=|\son\w+\s*=/i.test(html), 'no inline style or handler attribute in the page');
  assert.ok(!/https?:\/\/(?!www\.w3\.org)/.test(all.replace(/http:\/\/www\.w3\.org\/2000\/svg/g, '') + html + css), 'no remote URL');
  assert.ok(!/XMLHttpRequest|WebSocket|sendBeacon|importScripts|new Worker|EventSource/.test(all));
  assert.ok((all.match(/fetch\(/g) ?? []).length <= 1, 'one fetch, of a relative data file');
  // every href the script writes is a hash route
  for (const m of src('history.js').matchAll(/href: ?`([^`]*)`|href: ?'([^']*)'/g)) assert.match(m[1] ?? m[2], /^#\//, `href ${m[0]} is a hash route`);
});
test('every string from a file or a run goes through sanitizeDisplay before it becomes a text node', () => {
  const js = src('history.js');
  assert.match(js, /const txt = value => sanitizeDisplay\(value\)\.text;/);
  assert.match(js, /document\.createTextNode\(txt\(kid\)\)/);
  assert.ok(!/createTextNode\((?!txt)/.test(js) && !/\.textContent\s*=\s*(?!txt)[^;]*(?:data|row|doc|run|\bm\.)/.test(js.replace(/\$\('source'\)\.textContent = txt\(/, '')), 'no text node or textContent assignment bypasses txt()');
  assert.equal(H.sanitizeDisplay('a\u202eb').text, 'a⟦U+202E⟧b');
});

async function browser(t) {
  let chromium;
  try { ({ chromium } = await import('playwright')); } catch { t.skip('Playwright is not installed'); return null; }
  const exe = '/opt/pw-browsers/chromium';
  if (!existsSync(exe)) { t.skip(`no Chromium at ${exe}`); return null; }
  const b = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
  t.after(() => b.close());
  return b;
}
const EVIL = { img: '<img src=x onerror="window.__pwned=1">', script: '"><script>window.__pwned=2<\/script>', svg: '<svg onload="window.__pwned=3">', bidi: 'evil\u202etxt', link: '[x](javascript:alert(1)) https://evil.example/', md: '**bold** `code` <b>b</b>' };
function hostileData() {
  const sample = JSON.parse(readFileSync(path.join(dir, 'samples', 'records-v3-dev-d4-s108.json'), 'utf8'));
  for (const c of Object.values(sample.calls)) { c.prompt = EVIL.img; c.system = EVIL.svg; c.reply = EVIL.script; c.value = { x: EVIL.md }; }
  sample.events.forEach(e => { if (e.type === 'node.failed') e.error.message = EVIL.link; if (e.type === 'node.completed' && e.output !== undefined) e.output = EVIL.img; });
  sample.workflow.title = EVIL.img;
  const f = H.foldFacts(sample.events.filter(e => !e.derived), sample.workflow), key = sample.run.id;
  const row = { key, kind: 'run', fidelity: 'full', sources: [{ kind: 'store', label: EVIL.script, shape: 'blob-v1' }], joins: ['J1'], workflow: { id: EVIL.svg, version: 1, hash: 'h', title: EVIL.img }, experiment: EVIL.svg, arm: EVIL.img, taskKey: EVIL.script, trial: 0, split: 'dev', inspected: false,
    startedAt: f.startedAt, endedAt: f.endedAt, durationMs: f.durationMs, status: EVIL.link, verdict: { verdict: 'pass', code: null, authority: 'supported' }, engineHash: 'e', oracle: { pass: false, score: 0.5, details: { entities: 3 } }, honesty: 'mismatch-pass-fail', cost: { usd: f.cost, source: 'run', unknownCalls: 0 },
    calls: f.calls, escalations: f.escalations.length, escalationList: f.escalations, retries: 0, checkFails: f.checkFails, failed: f.failed, failedCount: f.failed.length, acceptance: f.acceptance, costTop: f.costTop, integrity: { chain: 'ok', events: f.events, head: 'abc' }, labels: [EVIL.bidi, EVIL.md] };
  return { index: { schema: 'foundry-run-index/1', builtAt: EVIL.img, roots: [EVIL.svg], report: {}, constructions: [], rows: [row] }, runs: { [key]: gzipSync(JSON.stringify(sample)).toString('base64') }, runMeta: { [key]: { embedded: true } },
    modelSummaries: { [key]: { model: EVIL.img, output: { one_line: EVIL.img, what_failed: [{ fact: 'N1', note: EVIL.link }], likely_cause: { class: 'unknown', text: EVIL.svg, evidence: ['N1'] }, suggested_fix: { kind: 'none', text: EVIL.link } }, checks: {}, costUsd: 0, createdAt: EVIL.img } },
    manifest: { builtAt: EVIL.img, sources: [EVIL.svg], notice: EVIL.script, counts: {} } };
}

test('browser: hostile text in the index fields, the run record and the model summary renders as text; no element, no script, no link, no dialog, no console error', async t => {
  const b = await browser(t); if (!b) return;
  const file = path.join(tempDir(t), 'evil.html'); writeFileSync(file, bundleHistoryHtml(hostileData()));
  const page = await (await b.newContext({ viewport: { width: 1300, height: 900 } })).newPage();
  const issues = [];
  page.on('console', m => { if (['error', 'warning'].includes(m.type())) issues.push(`console.${m.type()}: ${m.text()}`); }); page.on('pageerror', e => issues.push(`pageerror: ${e.message}`)); page.on('dialog', d => { issues.push(`dialog: ${d.message()}`); d.dismiss(); });
  await page.addInitScript(() => { window.__csp = []; document.addEventListener('securitypolicyviolation', e => window.__csp.push(e.violatedDirective)); });
  const probe = () => page.evaluate(() => ({ pwned: window.__pwned, imgs: document.querySelectorAll('img').length, handlers: document.querySelectorAll('[onerror],[onload],[onclick]').length, scripts: document.querySelectorAll('script').length, svgs: document.querySelectorAll('svg[onload]').length,
    links: [...document.querySelectorAll('a[href]')].filter(a => !/^#/.test(a.getAttribute('href'))).length, csp: window.__csp }));
  const expected = { pwned: undefined, imgs: 0, handlers: 0, scripts: 3, svgs: 0, links: 0, csp: [] };
  await page.goto(pathToFileURL(file).href + '#/runs');
  await page.waitForSelector('#runtable tbody tr');
  assert.deepEqual(await probe(), expected, 'list');
  const list = await page.locator('#runtable').innerText();
  assert.ok(list.includes('<img src=x') && list.includes('<script>window.__pwned=2'), 'the hostile values are visible as text');
  await page.getByRole('button', { name: /Show the summary/ }).first().click();
  assert.deepEqual(await probe(), expected, 'expanded summary card');
  const key = hostileData().index.rows[0].key;
  await page.goto(pathToFileURL(file).href + `#/run/${encodeURIComponent(key)}/timeline`);
  await page.waitForSelector('svg.tl');
  await page.locator('svg.tl .lane-label[aria-label*="model calls"]:not([aria-label*=" 0 model calls"])').first().focus();
  await page.keyboard.press('Enter');
  await page.waitForSelector('#drawer:not([hidden]) .turn');
  assert.deepEqual(await probe(), expected, 'messages drawer with hostile prompt, reply and typed output');
  assert.ok((await page.locator('#drawer').innerText()).includes('<img src=x'), 'the prompt is shown as text');
  await page.goto(pathToFileURL(file).href + `#/run/${encodeURIComponent(key)}/messages`);
  await page.waitForSelector('.msgs');
  await page.locator('details > summary', { hasText: 'Model-written summary' }).click();
  assert.deepEqual(await probe(), expected, 'model summary shown as text, its URL is not a link');
  assert.ok((await page.locator('details.modelsum').innerText()).includes('https://evil.example/'), 'the URL is visible as plain text');
  assert.equal(await page.locator('a[href^="http"]').count(), 0, 'and is not a link');
  const text = await page.locator('#view').innerText();
  assert.match(text, /U\+202E/, 'bidi override characters are made visible');
  assert.deepEqual(issues, []);
});
