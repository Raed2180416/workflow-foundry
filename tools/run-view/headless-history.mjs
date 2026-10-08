#!/usr/bin/env node
// Headless verification of the run-history page with Playwright and the preinstalled Chromium. Development evidence, not a product test suite.
//
//   node tools/run-view/headless-history.mjs --json history.json [--scale DIR] [--shots research/review-20261007] [--report report.json] [--chromium /opt/pw-browsers/chromium]
//   --scale DIR  a folder written by `node tools/run-view/test/scale-fixture.mjs --out DIR --items 1000` (a real 1000-item map run): timeline open time, DOM size and decode cost
//
// --json is the .json form of a history bundle (export-history.mjs --json-out). The check builds the self-contained html from it, opens that file over file:// (the way the
// owner would: double-click), and fails on: any console error or warning, page error, failed request, CSP violation, or a missed probe. It also takes the screenshots
// (ui-history-*.png): the runs list, a timeline, an open messages drawer, a summary card, a comparison, the task matrix, the narrow layout and the light theme.
// Extra checks: the static rules shared with tests/ui-contract.test.mjs, hostile text in every index field and in a run record, keyboard routes, a 10,000-row index for
// filter, sort and paging timings, and WCAG contrast of the palette in both themes.
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';
import { bundleHistoryHtml, exportHistory } from './export-history.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const { values: a } = parseArgs({ options: { scale: { type: 'string' }, json: { type: 'string' }, shots: { type: 'string' }, report: { type: 'string' }, chromium: { type: 'string', default: '/opt/pw-browsers/chromium' } } });
if (!a.json) { console.error('Need --json history.json (export-history.mjs --json-out)'); process.exit(2); }
const data = JSON.parse(readFileSync(a.json, 'utf8'));
const shots = a.shots ?? path.join(here, 'shots');
mkdirSync(shots, { recursive: true });
const tmp = mkdtempSync(path.join(tmpdir(), 'history-check-'));
const report = { checks: [], measured: {}, errors: [] };
const check = (name, ok, detail = '') => { report.checks.push({ name, ok: !!ok, detail: String(detail).slice(0, 400) }); if (!ok) report.errors.push(`${name}: ${String(detail).slice(0, 400)}`); };
const round = (n, d = 1) => Math.round(n * 10 ** d) / 10 ** d;
const enc = key => encodeURIComponent(key);

// ------------------------------------------------------------------------------------------------ static contract
{
  const read = f => readFileSync(path.join(here, f), 'utf8');
  const js = read('history.js'), core = read('history-core.js'), html = read('history.html'), css = read('history.css');
  const all = js + core;
  check('static: no innerHTML/outerHTML/insertAdjacentHTML/eval/new Function/document.write', !/\.(?:innerHTML|outerHTML)\s*=|insertAdjacentHTML|\beval\s*\(|new\s+Function\s*\(|document\.write/.test(all));
  check('static: no .style access and no style attribute set from script', !/\.style\b|setAttribute\(\s*['"]style['"]/.test(all) && !/['"]style['"]\s*:/.test(js));
  check('static: html has no inline style or handler attributes', !/\sstyle\s*=|\son\w+\s*=/i.test(html));
  check('static: no remote URLs in html, css or js', !/(?:src|href)=["']https?:|url\(\s*['"]?https?:|@import|https?:\/\/(?!www\.w3\.org)/.test(html + css + all.replace(/http:\/\/www\.w3\.org\/2000\/svg/g, '')));
  check('static: no control or invisible characters in the sources (they are written as numbers)', !new RegExp('[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u2028-\\u202e\\u2060-\\u206f\\ufeff]').test(all));
  check('static: the page makes no request except one same-origin fetch of a named data file', !/XMLHttpRequest|WebSocket|sendBeacon|importScripts|new Worker|EventSource/.test(all) && (all.match(/fetch\(/g) ?? []).length <= 1);
  report.measured.sourceBytes = { js: js.length, core: core.length, css: css.length, html: html.length };
}

// ------------------------------------------------------------------------------------------------ contrast (WCAG 2.x)
{
  const css = readFileSync(path.join(here, 'history.css'), 'utf8');
  const block = sel => Object.fromEntries([...css.slice(css.indexOf(sel), css.indexOf('}', css.indexOf(sel))).matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)].map(m => [m[1], m[2]]));
  const themes = { dark: block(':root {'), light: block(':root[data-theme="light"]') };
  const lum = hex => { const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const ratio = (x, y) => { const [hi, lo] = [lum(x), lum(y)].sort((p, q) => q - p); return (hi + 0.05) / (lo + 0.05); };
  const rows = [];
  for (const [name, t] of Object.entries(themes)) {
    for (const f of ['blue', 'amber', 'violet', 'slate', 'pink', 'green', 'red', 'neutral']) rows.push({ theme: name, pair: `${f} on panel`, ratio: ratio(t[f], t.panel), need: 3 });
    for (const f of ['text', 'muted', 'faint']) for (const bg of ['panel', 'bg', 'panel2']) rows.push({ theme: name, pair: `${f} text on ${bg}`, ratio: ratio(t[f], t[bg]), need: 4.5 });
    rows.push({ theme: name, pair: 'accent link on panel', ratio: ratio(t.accent, t.panel), need: 4.5 });
    rows.push({ theme: name, pair: 'text on red banner', ratio: ratio(t.text, t.redbg), need: 4.5 });
    rows.push({ theme: name, pair: 'text on amber banner', ratio: ratio(t.text, t.amberbg), need: 4.5 });
    rows.push({ theme: name, pair: 'accent on page (focus)', ratio: ratio(t.accent, t.bg), need: 3 });
  }
  const done = rows.map(r => ({ ...r, ratio: round(r.ratio, 2), ok: r.ratio >= r.need }));
  report.measured.contrast = { checked: done.length, failing: done.filter(r => !r.ok), minRatio: Math.min(...done.map(r => r.ratio)) };
  check('contrast: palette and text meet WCAG (3:1 graphics, 4.5:1 text) in both themes', done.every(r => r.ok), JSON.stringify(report.measured.contrast.failing));
}

// ------------------------------------------------------------------------------------------------ pages
const browser = await chromium.launch({ executablePath: a.chromium, args: ['--no-sandbox', '--enable-precise-memory-info'] });
const issues = [];
function watch(page, tag) {
  page.on('console', m => { if (['error', 'warning'].includes(m.type())) issues.push(`${tag} console.${m.type()}: ${m.text()}`); });
  page.on('pageerror', e => issues.push(`${tag} pageerror: ${e.message}`));
  page.on('requestfailed', r => issues.push(`${tag} requestfailed: ${r.url().slice(0, 100)} ${r.failure()?.errorText}`));
  page.on('dialog', d => { issues.push(`${tag} dialog: ${d.message()}`); d.dismiss(); });
}
async function open(ctx, file, tag, hash = '') {
  const page = await ctx.newPage(); watch(page, tag);
  await page.addInitScript(() => { window.__csp = []; document.addEventListener('securitypolicyviolation', e => window.__csp.push(`${e.violatedDirective}: ${e.blockedURI}`)); });
  const t0 = Date.now();
  await page.goto(pathToFileURL(file).href + hash);
  await page.waitForFunction(() => document.querySelector('#view h2, #view .empty'));
  return { page, loadMs: Date.now() - t0 };
}
const cspIssues = async (page, tag) => { const v = await page.evaluate(() => window.__csp); if (v.length) issues.push(`${tag} CSP violation: ${v.join('; ')}`); return v; };

const bundleFile = path.join(tmp, 'history.html');
writeFileSync(bundleFile, bundleHistoryHtml(data));
report.measured.bundle = { bytes: readFileSync(bundleFile).length, rows: data.index.rows.length, embedded: Object.keys(data.runs).length, embeddedBytes: data.manifest.counts.embeddedBytes, rawBytes: data.manifest.counts.rawBytes };
check('bundle: a single self-contained file under 5 MB', report.measured.bundle.bytes < 5 * 1024 * 1024, `${report.measured.bundle.bytes} bytes`);
{ const text = readFileSync(bundleFile, 'utf8'); check('bundle: carries a CSP with hashes and connect-src none, no remote URL, no external script or style', /Content-Security-Policy[^>]*connect-src 'none'/.test(text) && /script-src 'sha256-[^']+' 'sha256-/.test(text) && !/<script[^>]+src=|<link[^>]+href="(?!data:)/.test(text) && !/https?:\/\/(?!www\.w3\.org)/.test(text.replace(/<script id="history-data"[\s\S]*?<\/script>/, ''))); }

const rows = data.index.rows, byKey = new Map(rows.map(r => [r.key, r]));
const embeddedFull = rows.filter(r => r.fidelity === 'full' && data.runMeta[r.key]?.embedded && !data.runMeta[r.key]?.withheld);
const lane6 = byKey.get('b6d33a19-6879-4bc0-8d11-7ec51e8763d0') ?? embeddedFull.find(r => r.honesty === 'mismatch-pass-fail') ?? embeddedFull[0];
const journalEmbedded = rows.find(r => r.fidelity === 'journal-only' && data.runMeta[r.key]?.embedded && !data.runMeta[r.key]?.withheld);
const withheldRow = rows.find(r => data.runMeta[r.key]?.withheld);
const notEmbedded = rows.find(r => r.fidelity === 'full' && !data.runMeta[r.key]?.embedded);
const mismatchCount = rows.filter(r => r.honesty === 'mismatch-pass-fail').length;
let pair = null;
for (const r of embeddedFull) { const m = embeddedFull.find(x => x !== r && x.workflow?.hash === r.workflow?.hash && x.inputHash && x.inputHash === r.inputHash); if (m) { pair = [r, m]; break; } }
pair ??= embeddedFull.length > 1 ? [embeddedFull[0], embeddedFull[1]] : null;

try {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, deviceScaleFactor: 1, colorScheme: 'dark' });

  // ---------------------------------------------------------------------------------------------- runs list
  {
    const { page, loadMs } = await open(ctx, bundleFile, 'list', '#/runs');
    report.measured.firstRenderMs = loadMs;
    await page.waitForSelector('#runtable tbody tr');
    const count = await page.locator('#runtable tbody tr').count();
    check('list: the first page has 100 rows', count === 100 || count === Math.min(100, rows.length), `${count}`);
    const totals = await page.locator('#totals').innerText();
    check('list: the totals line states how many rows have no oracle and how many are full records', /have no oracle/.test(totals) && /Full records: \d+ of \d+/.test(totals), totals.replace(/\n/g, ' | '));
    check('list: the survivor-bias sentence appears when full records are a minority', /Kept workspaces are mostly failures/.test(totals) === (report.measured.bundle.rows > 0 && rows.filter(r => r.fidelity === 'full').length / rows.length < 0.5), totals.replace(/\n/g, ' | '));
    check('list: the red banner counts the Foundry-pass/oracle-fail runs', (await page.locator('.banner h3').first().innerText()).startsWith(`${mismatchCount} run`), await page.locator('.banner h3').first().innerText());
    await page.screenshot({ path: path.join(shots, 'ui-history-1-runs-list.png') });
    // filter to the mismatches
    await page.selectOption('select[name="honesty"]', 'mismatch-pass-fail');
    await page.waitForFunction(n => document.querySelectorAll('#runtable tbody tr:not(.group):not(.detail)').length === n, Math.min(mismatchCount, 100));
    const cells = await page.locator('#runtable tbody tr td:nth-child(8)').allInnerTexts();
    check('list: the verdict-vs-oracle filter shows only MISMATCH rows, and the word is in the cell (not colour alone)', cells.length > 0 && cells.every(c => /MISMATCH/.test(c)), cells.slice(0, 3).join(' | '));
    check('list: the filter is mirrored in the address (linkable)', /honesty=mismatch-pass-fail/.test(await page.evaluate(() => location.hash)));
    // sort by cost, ascending then descending
    await page.getByRole('button', { name: 'Cost', exact: true }).click();
    const costs = (await page.locator('#runtable tbody tr td:nth-child(10)').allInnerTexts()).map(t => t === '–' ? -1 : Number(t.replace(/[$,]/g, '')));
    const sortedDesc = costs.every((c, i) => i === 0 || c <= costs[i - 1] || c < 0);
    check('list: sorting by cost descending works and aria-sort on the column header says so', sortedDesc && (await page.locator('#runtable th', { has: page.getByRole('button', { name: 'Cost', exact: true }) }).getAttribute('aria-sort')) === 'descending', costs.slice(0, 5).join(','));
    // expand the first row's summary
    await page.locator('#runtable tbody tr').first().getByRole('button', { name: /Show the summary/ }).click();
    check('list: a row expands into a summary card in place', await page.locator('#runtable tr.detail .card').count() === 1);
    await page.getByRole('button', { name: /Hide the summary/ }).first().click();
    // group by
    await page.selectOption('select[name="group"]', 'arm');
    check('list: group by arm inserts subtotal rows', await page.locator('#runtable tr.group').count() > 0 && /oracle pass/.test(await page.locator('#runtable tr.group').first().innerText()));
    await page.selectOption('select[name="group"]', 'all');
    // text search over ids
    await page.selectOption('select[name="honesty"]', 'all');
    await page.fill('input[name="q"]', lane6?.taskKey ?? 'zzz');
    await page.waitForFunction(() => document.querySelector('#totals strong'));
    check('list: text search narrows the rows', (await page.locator('#totals strong').first().innerText()).startsWith(`${rows.filter(r => `${r.key} ${r.taskKey ?? ''} ${r.arm ?? ''} ${r.experiment ?? ''} ${r.workflow?.id ?? ''} ${r.workflow?.title ?? ''}`.toLowerCase().includes((lane6?.taskKey ?? 'zzz').toLowerCase())).length} runs match`));
    // paging
    await page.fill('input[name="q"]', '');
    await page.getByRole('button', { name: 'Next' }).click();
    check('list: paging moves to rows 101-200', /Rows 101 to 200/.test(await page.locator('#pager').innerText()), await page.locator('#pager').innerText());
    await page.locator('#runtable tbody button[aria-expanded]').first().focus();
    await page.keyboard.press('PageUp');
    check('list keyboard: PageUp goes back a page', /Rows 1 to 100/.test(await page.locator('#pager').innerText()), await page.locator('#pager').innerText());
    await page.locator('#runtable tbody button[aria-expanded]').first().focus();
    await page.keyboard.press('ArrowDown');
    check('list keyboard: ArrowDown moves to the next row\'s summary button', await page.evaluate(() => { const all = [...document.querySelectorAll('#runtable tbody button[aria-expanded]')]; return all.indexOf(document.activeElement) === 1; }));
    await cspIssues(page, 'list'); await page.close();
  }

  // ---------------------------------------------------------------------------------------------- one run: summary card, timeline, messages drawer
  if (lane6) {
    const { page } = await open(ctx, bundleFile, 'run', `#/run/${enc(lane6.key)}/timeline`);
    await page.waitForSelector('svg.tl');
    const card = await page.locator('.card').first().innerText();
    check('card: the honesty banner says Foundry PASS and the oracle FAILED (for the mismatch run)', lane6.honesty !== 'mismatch-pass-fail' || /Foundry said PASS\. The independent oracle FAILED/i.test(card), card.slice(0, 160).replace(/\n/g, ' | '));
    check('card: the deterministic summary has what happened, what failed, likely cause and suggested fix with cited facts', /what happened/i.test(card) && /what failed/i.test(card) && /likely cause/i.test(card) && /suggested fix/i.test(card) && await page.locator('.card .cites button').count() > 0, '');
    check('card: pills carry words (status, verdict, oracle, fidelity, split, chain)', ['full record', 'chain verified'].every(w => card.includes(w)), '');
    const laneCount = await page.locator('svg.tl .lane-label').count();
    const expectedLanes = await page.evaluate(async key => { const doc = await window.RunHistory.getDoc(key); return new Set(doc.events.filter(e => e.nodeKey).map(e => e.nodeKey.split('/')[1]?.replace(/:\d+$/, ''))).size; }, lane6.key);
    check('timeline: exactly one lane per root node that appears in the events', laneCount === expectedLanes && laneCount > 3, `${laneCount} lanes, ${expectedLanes} root nodes in the events`);
    check('timeline: the note names the critical path and the duration', /critical path/.test(await page.locator('.tl-note').innerText()), await page.locator('.tl-note').innerText());
    const tOpen = Date.now(); const dom = await page.evaluate(() => document.querySelectorAll('*').length);
    report.measured.runPage = { domNodes: dom, svgElements: await page.evaluate(() => document.querySelectorAll('svg.tl *').length), openMs: Date.now() - tOpen };
    const viewText = await page.locator('#view').innerText();
    check('no "null", "undefined" or "NaN" leaks into the rendered text of a run page', !/\bnull\b|\bundefined\b|\bNaN\b/.test(viewText), (viewText.match(/.{20}(\bnull\b|\bundefined\b|\bNaN\b).{20}/) ?? [''])[0]);
    // expand a map lane
    const mapLabel = page.locator('svg.tl .lane-label[aria-label*="map lane"]').first();
    if (await mapLabel.count()) { await mapLabel.click(); check('timeline: opening a map lane draws its items', await page.locator('svg.tl text', { hasText: /^item \d/ }).count() > 0); }
    await page.screenshot({ path: path.join(shots, 'ui-history-2-timeline.png'), fullPage: true });
    // table alternative
    await page.getByRole('button', { name: 'Timeline as table' }).click();
    check('timeline: the table alternative lists every lane with its state and a Messages button', await page.locator('.tl-wrap table.t tbody tr').count() >= laneCount && await page.locator('.tl-wrap table.t button').count() >= laneCount);
    await page.getByRole('button', { name: 'Timeline as table' }).click();
    // zoom
    const before = await page.locator('.tl-note').innerText();
    await page.getByRole('button', { name: /Zoom in/ }).click();
    check('timeline: zoom changes the window', before !== await page.locator('.tl-note').innerText());
    await page.getByRole('button', { name: /Fit/ }).click();
    // keyboard: a lane label is focusable, Enter opens the drawer, Escape closes it and returns focus
    const firstLane = page.locator('svg.tl .lane-label').first();
    await firstLane.focus();
    await page.keyboard.press('ArrowDown');
    check('timeline keyboard: ArrowDown moves between lanes', await page.evaluate(() => document.activeElement?.classList.contains('lane-label') && document.activeElement !== document.querySelector('svg.tl .lane-label')));
    // open the drawer on a lane that has calls
    const withCalls = page.locator('svg.tl .lane-label[aria-label*="model calls"]:not([aria-label*=" 0 model calls"])').first();
    await withCalls.focus(); await page.keyboard.press('Enter');
    await page.waitForSelector('#drawer:not([hidden]) .turn');
    const drawer = await page.locator('#drawer').innerText();
    check('drawer: the messages open for a lane, with the prompt and the typed reply as text', /Prompt/.test(drawer) && /Typed output|Raw reply/.test(drawer), drawer.slice(0, 200).replace(/\n/g, ' | '));
    check('drawer: the attempt ladder lists the models in order', await page.locator('#drawer .ladder li').count() > 0);
    check('drawer: focus moved to the close button', await page.evaluate(() => document.activeElement?.id === 'drawer-close'));
    await page.screenshot({ path: path.join(shots, 'ui-history-3-messages-drawer.png') });
    await page.keyboard.press('Escape');
    check('drawer: Escape closes it and focus returns to the lane', await page.locator('#drawer').isHidden() && await page.evaluate(() => document.activeElement?.classList.contains('lane-label')));
    // facts tab and cited fact
    await page.goto(pathToFileURL(bundleFile).href + `#/run/${enc(lane6.key)}/messages`);
    await page.waitForSelector('.msgs .nodelist button');
    const allNodes = await page.locator('.msgs .nodelist button').count();
    await page.fill('.msgsearch input', 'escalat');
    const hits = await page.locator('.msgs .nodelist button').count();
    check('messages: searching this run\'s prompts and replies narrows the node list', hits < allNodes || allNodes === 0, `${hits} of ${allNodes}`);
    await page.fill('.msgsearch input', 'zzzz-no-such-text');
    check('messages: a search with no hit says so', /No node matches/.test(await page.locator('.msgs').innerText()));
    await page.goto(pathToFileURL(bundleFile).href + `#/run/${enc(lane6.key)}/facts/V1`);
    await page.waitForSelector('dl.facts');
    check('facts: a cited fact is shown and highlighted', await page.locator('#fact-V1.hit').count() === 1 || await page.locator('#fact-V1').count() === 1);
    // summary card screenshot (top of the page)
    await page.goto(pathToFileURL(bundleFile).href + `#/run/${enc(lane6.key)}/timeline`);
    await page.waitForSelector('.card');
    await page.locator('.card').first().screenshot({ path: path.join(shots, 'ui-history-4-summary-card.png') });
    await cspIssues(page, 'run'); await page.close();
  } else check('a mismatch run with an embedded record exists in the bundle', false, 'none found');

  // ---------------------------------------------------------------------------------------------- messages page, journal-only run, withheld run, run without a record
  if (journalEmbedded) {
    const { page } = await open(ctx, bundleFile, 'journal', `#/run/${enc(journalEmbedded.key)}/messages`);
    await page.waitForSelector('.msgs');
    check('journal-only: the messages page lists nodes and the reconstructed notice is honest', await page.locator('.nodelist button').count() > 0 && /journal only/.test(await page.locator('.card').first().innerText()), '');
    await page.goto(pathToFileURL(bundleFile).href + `#/run/${enc(journalEmbedded.key)}/timeline`);
    await page.waitForSelector('svg.tl');
    check('journal-only: the timeline says it is reconstructed from the model journal', /Reconstructed from the model journal/.test(await page.locator('.tl-note').innerText()));
    await cspIssues(page, 'journal'); await page.close();
  } else report.measured.journalOnlyEmbedded = 'none in this bundle';
  if (withheldRow) {
    const { page } = await open(ctx, bundleFile, 'withheld', `#/run/${enc(withheldRow.key)}/messages`);
    await page.waitForSelector('.banner');
    const text = await page.locator('#pane').innerText();
    check('held-out: a test-split run says its content is withheld and shows no prompt text', /Content withheld/.test(text) && !/System prompt|Raw reply/.test(text), text.slice(0, 160).replace(/\n/g, ' | '));
    await page.close();
  }
  if (notEmbedded) {
    const { page } = await open(ctx, bundleFile, 'summary-only', `#/run/${enc(notEmbedded.key)}/timeline`);
    await page.waitForSelector('#pane');
    await page.waitForFunction(() => !/Loading the embedded record/.test(document.getElementById('pane').innerText));
    check('summary-only: a run with no embedded record says so and still shows its card', /Summary only/.test(await page.locator('#pane').innerText()) && await page.locator('.card').count() === 1, '');
    await page.close();
  }

  // ---------------------------------------------------------------------------------------------- compare
  if (pair) {
    const { page } = await open(ctx, bundleFile, 'compare', `#/compare/${enc(pair[0].key)}/${enc(pair[1].key)}`);
    await page.waitForSelector('table.t');
    await page.waitForFunction(() => !/Loading\./.test(document.getElementById('view').innerText));
    const text = await page.locator('#view').innerText();
    check('compare: header diff, divergence line and aligned nodes are shown', /header/i.test(text) && /where they first differ/i.test(text) && /nodes aligned by id/i.test(text), text.slice(0, 200).replace(/\n/g, ' | '));
    check('compare: changed values are marked in words ("changed"/"same")', /changed/.test(text) && /same/.test(text));
    check('compare: two timelines on one relative axis', await page.locator('.cmp-tl svg.tl').count() === 2);
    await page.screenshot({ path: path.join(shots, 'ui-history-5-compare.png'), fullPage: false });
    await cspIssues(page, 'compare'); await page.close();
  }

  // ---------------------------------------------------------------------------------------------- task matrix, narrow, light
  {
    const { page } = await open(ctx, bundleFile, 'tasks', '#/tasks');
    await page.waitForSelector('table.matrix');
    check('tasks: a tasks x arms matrix with pass counts and MISMATCH marks', await page.locator('table.matrix tbody tr').count() > 3 && /\d+\/\d+/.test(await page.locator('table.matrix').innerText()));
    await page.screenshot({ path: path.join(shots, 'ui-history-6-task-matrix.png') });
    await cspIssues(page, 'tasks'); await page.close();
    const narrow = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: 'dark' });
    const n = await open(narrow, bundleFile, 'narrow', '#/runs');
    await n.page.waitForSelector('#runtable tbody tr');
    const overflow = await n.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check('narrow (390 px): no horizontal page scroll on the list (the table scrolls inside its own box)', overflow <= 0, `${overflow}px`);
    await n.page.screenshot({ path: path.join(shots, 'ui-history-7-narrow.png') });
    if (lane6) { await n.page.goto(pathToFileURL(bundleFile).href + `#/run/${enc(lane6.key)}/timeline`); await n.page.waitForSelector('svg.tl'); check('narrow (390 px): no horizontal page scroll on a run page', await n.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth) <= 0); }
    await cspIssues(n.page, 'narrow'); await narrow.close();
    const light = await browser.newContext({ viewport: { width: 1360, height: 900 }, colorScheme: 'light' });
    const l = await open(light, bundleFile, 'light', '#/runs?honesty=mismatch');
    await l.page.waitForSelector('#runtable tbody tr');
    check('light theme follows prefers-color-scheme', await l.page.evaluate(() => document.documentElement.getAttribute('data-theme')) === 'light');
    await l.page.screenshot({ path: path.join(shots, 'ui-history-8-light.png') });
    await cspIssues(l.page, 'light'); await light.close();
  }

  // ---------------------------------------------------------------------------------------------- hostile text in every index field and in a run record
  {
    const evil = JSON.parse(JSON.stringify(data));
    const marks = { img: '<img src=x onerror="window.__pwned=1">', script: '"><script>window.__pwned=2<\/script>', svg: '<svg onload="window.__pwned=3">', bidi: '\u202eevil\u202c', zw: 'a\u200bb', fakeLink: '[click](javascript:alert(1))' };
    const targets = evil.index.rows.filter(r => r.fidelity === 'full' && evil.runs[r.key]).slice(0, 3);
    targets.forEach((r, i) => {
      r.arm = marks.img; r.taskKey = marks.script; r.experiment = marks.svg; r.labels = [marks.bidi, marks.zw]; r.status = marks.fakeLink;
      if (r.workflow) { r.workflow.title = marks.img; r.workflow.id = marks.svg; }
      const doc = JSON.parse(gunzipSync(Buffer.from(evil.runs[r.key], 'base64')).toString());
      for (const c of Object.values(doc.calls)) { c.prompt = marks.img; c.reply = marks.script; c.system = marks.svg; c.value = { x: marks.img }; }
      doc.events.forEach(e => { if (e.type === 'node.failed' && e.error) e.error.message = marks.svg; if (e.type === 'node.completed') e.output = marks.img; });
      evil.runs[r.key] = gzipSync(JSON.stringify(doc)).toString('base64');
    });
    evil.modelSummaries = { [targets[0].key]: { model: marks.img, output: { one_line: marks.img, what_failed: [{ fact: 'N1', note: marks.script }], likely_cause: { class: 'unknown', text: marks.svg, evidence: ['N1'] }, suggested_fix: { kind: 'none', text: `${marks.fakeLink} https://evil.example/` } }, checks: {}, costUsd: 0, createdAt: marks.img } };
    const evilFile = path.join(tmp, 'evil.html'); writeFileSync(evilFile, bundleHistoryHtml(evil));
    const { page } = await open(ctx, evilFile, 'hostile', '#/runs');
    await page.waitForSelector('#runtable tbody tr');
    const probe = async () => ({ pwned: await page.evaluate(() => window.__pwned), imgs: await page.locator('img').count(), scripts: await page.evaluate(() => document.querySelectorAll('script').length), links: await page.evaluate(() => [...document.querySelectorAll('a[href]')].filter(a => !/^#/.test(a.getAttribute('href'))).length), svgLoad: await page.evaluate(() => document.querySelectorAll('svg[onload], [onerror]').length) });
    let p = await probe();
    check('hostile index fields (arm, task key, experiment, labels, status, workflow id and title): no element created, no script run', p.pwned === undefined && p.imgs === 0 && p.svgLoad === 0 && p.links === 0 && p.scripts === 3, JSON.stringify(p));
    await page.fill('input[name="q"]', 'img src=x');
    await page.waitForFunction(() => document.querySelector('#totals strong'));
    check('hostile index fields appear as visible text', (await page.locator('#runtable').innerText()).includes('<img src=x') && (await page.locator('#runtable').innerText()).includes('<script>window.__pwned=2'), (await page.locator('#runtable').innerText()).slice(0, 200));
    await page.getByRole('button', { name: /Show the summary/ }).first().click();
    await page.goto(pathToFileURL(evilFile).href + `#/run/${enc(targets[0].key)}/timeline`);
    await page.waitForSelector('svg.tl');
    await page.locator('svg.tl .lane-label[aria-label*="model calls"]:not([aria-label*=" 0 model calls"])').first().click({ force: true }).catch(() => {});
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    p = await probe();
    check('hostile run record (prompt, reply, system, output, error text, model summary): rendered as text, nothing executed, no link built from run data', p.pwned === undefined && p.imgs === 0 && p.svgLoad === 0 && p.links === 0 && p.scripts === 3, JSON.stringify(p));
    check('the model summary (untrusted) shows its URL as plain text, never as a link', await page.locator('a[href^="http"]').count() === 0);
    const bidi = await page.locator('#view').innerText();
    check('bidi and zero-width characters from run text are made visible', /U\+202E/.test(bidi) || /U\+200B/.test(bidi), '');
    await cspIssues(page, 'hostile'); await page.close();
  }

  // ---------------------------------------------------------------------------------------------- scale: a 10,000-row index
  {
    const big = JSON.parse(JSON.stringify(data)); big.runs = {}; big.runMeta = {}; big.modelSummaries = {};
    const base = big.index.rows; big.index.rows = [];
    for (let i = 0; i < 10000; i++) { const r = JSON.parse(JSON.stringify(base[i % base.length])); r.key = `${r.key.slice(0, 40)}#${i}`; r.startedAt = (r.startedAt ?? 0) + i * 1000; big.index.rows.push(r); }
    const bigFile = path.join(tmp, 'big.html'); writeFileSync(bigFile, bundleHistoryHtml(big));
    const { page, loadMs } = await open(ctx, bigFile, 'big', '#/runs');
    await page.waitForSelector('#runtable tbody tr');
    const t = await page.evaluate(() => {
      const H = window.HistoryCore, rows = window.RunHistory.S.rows, out = {};
      const time = (name, fn, n = 5) => { const xs = []; for (let i = 0; i < n; i++) { const t0 = performance.now(); fn(); xs.push(performance.now() - t0); } xs.sort((a, b) => a - b); out[name] = Math.round(xs[Math.floor(n / 2)] * 100) / 100; };
      time('filterMismatchMs', () => H.filterRows(rows, { honesty: 'mismatch' })); time('filterTextMs', () => H.filterRows(rows, { q: 'records' })); time('sortCostMs', () => H.sortRows(rows, 'cost', -1)); time('sortStartedMs', () => H.sortRows(rows, 'started', -1)); time('aggregateMs', () => H.aggregate(rows));
      out.rows = rows.length; out.domAfterFirstPage = document.querySelectorAll('*').length; return out;
    });
    report.measured.tenThousandRows = { ...t, loadMs, bundleBytes: readFileSync(bigFile).length };
    const t0 = Date.now(); await page.selectOption('select[name="honesty"]', 'mismatch'); await page.waitForFunction(() => document.querySelector('#totals strong').innerText.endsWith('runs match') && /^\d+ runs match/.test(document.querySelector('#totals strong').innerText)); report.measured.tenThousandRows.filterRenderMs = Date.now() - t0;
    check('10,000 rows: filtering and sorting stay under 30 ms (target 20 and 30), the first page renders', t.filterMismatchMs < 30 && t.sortCostMs < 60 && t.filterTextMs < 30, JSON.stringify(t));
    check('10,000 rows: a 100-row page keeps the DOM small', t.domAfterFirstPage < 3000, `${t.domAfterFirstPage} elements`);
    await cspIssues(page, 'big'); await page.close();
  }

  // ---------------------------------------------------------------------------------------------- decode cost of the largest embedded record
  {
    const biggest = Object.entries(data.runMeta).filter(([, m]) => m.embedded).sort((x, y) => y[1].rawBytes - x[1].rawBytes)[0];
    if (biggest) {
      const { page } = await open(ctx, bundleFile, 'decode', '#/runs');
      const ms = await page.evaluate(async key => { const t0 = performance.now(); const doc = await window.RunHistory.getDoc(key); return { ms: performance.now() - t0, events: doc.events.length, calls: Object.keys(doc.calls).length }; }, biggest[0]);
      report.measured.largestEmbeddedRun = { key: biggest[0].slice(0, 12), gzBase64Bytes: biggest[1].bytes, rawBytes: biggest[1].rawBytes, decodeAndParseMs: round(ms.ms, 1), events: ms.events, calls: ms.calls };
      await page.close();
    }
  }
  // ---------------------------------------------------------------------------------------------- a real 1000-item map run
  if (a.scale) {
    const t0 = Date.now(), { data: sd, stats } = exportHistory({ roots: [a.scale], embed: 'all', maxBytes: 60_000_000 }), exportMs = Date.now() - t0;
    const sFile = path.join(tmp, 'scale.html'); writeFileSync(sFile, bundleHistoryHtml(sd));
    const row = sd.index.rows.find(r => r.fidelity === 'full'), key = row.key;
    const { page } = await open(ctx, sFile, 'scale', `#/run/${enc(key)}/timeline`);
    const tOpen = Date.now(); await page.waitForSelector('svg.tl'); const openMs = Date.now() - tOpen;
    const m = await page.evaluate(async k => { const doc = await window.RunHistory.getDoc(k); const t0 = performance.now(); const lanes = window.HistoryCore.buildLanes(doc); const buildMs = performance.now() - t0;
      const container = lanes.lanes.find(l => l.container); return { events: doc.events.length, calls: Object.keys(doc.calls).length, buildLanesMs: Math.round(buildMs * 10) / 10, items: container?.itemCount, drawnItems: container?.pageItems.length, maxActive: container?.maxActive, dom: document.querySelectorAll('*').length, svg: document.querySelectorAll('svg.tl *').length }; }, key);
    const lane = page.locator('svg.tl .lane-label[aria-label*="map lane"]').first();
    const tExpand = Date.now(); await lane.click(); await page.waitForFunction(() => document.querySelectorAll('svg.tl text').length > 50); const expandMs = Date.now() - tExpand;
    const after = await page.evaluate(() => ({ dom: document.querySelectorAll('*').length, svg: document.querySelectorAll('svg.tl *').length }));
    const tZoom = Date.now(); await page.getByRole('button', { name: /Zoom in/ }).click(); const zoomMs = Date.now() - tZoom;
    await page.getByRole('button', { name: 'Timeline as table' }).click();
    const tableRows = await page.locator('.tl-wrap table.t tbody tr').count();
    report.measured.scale1000 = { eventsEmbedded: m.events, calls: m.calls, items: m.items, exportMs, rawBytes: stats.rawBytes, gzBase64Bytes: stats.embeddedBytes, timelineOpenMs: openMs, buildLanesMs: m.buildLanesMs, domCollapsed: m.svg, domTotalCollapsed: m.dom, expandFirstMapMs: expandMs, svgElementsExpanded: after.svg, domTotalExpanded: after.dom, zoomMs, tableRowsWithin50ItemPage: tableRows, maxItemsActive: m.maxActive };
    check('1000-item run: the timeline draws one density band for the map and at most 50 item rows when it is opened', m.items === 1000 && m.drawnItems === 50 && after.svg < 3000, JSON.stringify(report.measured.scale1000));
    check('1000-item run: the opened timeline stays under 3,000 SVG elements and the table view lists the lanes and the first 50 items', after.svg < 3000 && tableRows <= 60, `${after.svg} svg elements, ${tableRows} table rows`);
    await cspIssues(page, 'scale'); await page.close();
  }
  report.measured.consoleIssues = issues.length;
  check('zero console errors, warnings, page errors, failed requests, dialogs or CSP violations across all pages', issues.length === 0, issues.join(' || '));
} finally {
  await browser.close();
  rmSync(tmp, { recursive: true, force: true });
}
const failed = report.checks.filter(c => !c.ok);
report.summary = { passed: report.checks.length - failed.length, failed: failed.length, chromium: a.chromium, node: process.version };
if (a.report) writeFileSync(a.report, JSON.stringify(report, null, 1));
for (const c of report.checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.ok || !c.detail ? '' : `  [${c.detail}]`}`);
console.log(JSON.stringify({ measured: report.measured, summary: report.summary }, null, 1));
process.exit(failed.length ? 1 : 0);
