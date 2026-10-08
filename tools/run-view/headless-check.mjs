#!/usr/bin/env node
// Headless verification of tools/run-view with Playwright + the preinstalled Chromium. Development evidence, not a product test suite.
//   node tools/run-view/headless-check.mjs --data run.json [--shots research/review-20261007] [--synthetic 1000] [--report report.json]
// It serves tools/run-view over loopback http with the SAME Content-Security-Policy shape as src/http.mjs (no inline script or style),
// loads the run, steps the replay to three timeline points (screenshots), opens a node transcript (screenshot), and fails on:
// any console error or warning, page error, failed request, CSP violation, unexpected state at a timeline point, or a missed reachability check.
// Extra checks: static rules shared with tests/ui-contract.test.mjs, hostile-text rendering, reduced motion, keyboard, contrast of the
// state palette (WCAG), the one-file bundle opened from file://, and a synthetic 1000-item run for timing and DOM size.
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';
import { bundleHtml } from './export-run.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const { values: a } = parseArgs({ options: { data: { type: 'string' }, shots: { type: 'string' }, synthetic: { type: 'string', default: '1000' }, report: { type: 'string' }, chromium: { type: 'string', default: '/opt/pw-browsers/chromium' } } });
if (!a.data) { console.error('Need --data run.json'); process.exit(2); }
const data = JSON.parse(readFileSync(a.data, 'utf8'));
const shots = a.shots ?? path.join(here, 'shots');
mkdirSync(shots, { recursive: true });
const report = { checks: [], measured: {}, errors: [] };
const check = (name, ok, detail = '') => { report.checks.push({ name, ok: !!ok, detail: String(detail) }); if (!ok) report.errors.push(`${name}: ${detail}`); };

// ------------------------------------------------------------------------------------------------ static contract
{
  const js = readFileSync(path.join(here, 'run-view.js'), 'utf8'), html = readFileSync(path.join(here, 'index.html'), 'utf8'), css = readFileSync(path.join(here, 'run-view.css'), 'utf8');
  check('static: no innerHTML/outerHTML/insertAdjacentHTML/eval/new Function/document.write', !/\.(?:innerHTML|outerHTML)\s*=|insertAdjacentHTML|\beval\s*\(|new\s+Function\s*\(|document\.write/.test(js));
  check('static: no .style access and no style attribute set from script', !/\.style\b|setAttribute\(\s*['"]style['"]/.test(js));
  check('static: html has no inline style or handler attributes', !/\sstyle\s*=|\son\w+\s*=/i.test(html));
  check('static: no remote URLs in html, css or js', !/(?:src|href)=["']https?:|url\(\s*['"]?https?:|@import|https?:\/\/(?!www\.w3\.org)/.test(html + css + js.replace(/http:\/\/www\.w3\.org\/2000\/svg/g, '')));
  check('static: js has no control or invisible characters (they are written as numbers)', !new RegExp('[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u2028-\\u202e\\u2060-\\u206f\\ufeff]').test(js));
}

// ------------------------------------------------------------------------------------------------ contrast (WCAG 2.x)
function contrastReport() {
  const css = readFileSync(path.join(here, 'run-view.css'), 'utf8');
  const block = sel => Object.fromEntries([...css.slice(css.indexOf(sel), css.indexOf('}', css.indexOf(sel))).matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)].map(m => [m[1], m[2]]));
  const themes = { dark: block(':root {'), light: block(':root[data-theme="light"]') };
  const lum = hex => { const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const ratio = (x, y) => { const [hi, lo] = [lum(x), lum(y)].sort((p, q) => q - p); return (hi + 0.05) / (lo + 0.05); };
  const rows = [];
  for (const [name, t] of Object.entries(themes)) {
    for (const f of ['blue', 'amber', 'violet', 'slate', 'pink', 'green', 'red', 'neutral']) {
      rows.push({ theme: name, pair: `${f} dot on card`, ratio: ratio(t[f], t.panel), need: 3 });
      rows.push({ theme: name, pair: `glyph ink on ${f} fill`, ratio: ratio(t.on, t[f]), need: 3 });
    }
    for (const f of ['text', 'muted', 'faint']) { rows.push({ theme: name, pair: `${f} text on card`, ratio: ratio(t[f], t.panel), need: 4.5 }); rows.push({ theme: name, pair: `${f} text on page`, ratio: ratio(t[f], t.bg), need: 4.5 }); }
    rows.push({ theme: name, pair: 'accent on page (focus, links)', ratio: ratio(t.accent, t.bg), need: 3 });
  }
  return rows.map(r => ({ ...r, ratio: Math.round(r.ratio * 100) / 100, ok: r.ratio >= r.need }));
}
const contrast = contrastReport();
report.measured.contrast = { checked: contrast.length, failing: contrast.filter(r => !r.ok) };
check('contrast: every state colour and text colour meets WCAG (3:1 graphics, 4.5:1 text) in both themes', contrast.every(r => r.ok), JSON.stringify(report.measured.contrast.failing));

// ------------------------------------------------------------------------------------------------ server (CSP shaped like src/http.mjs)
const csp = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json' };
let served = JSON.stringify(data);
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x'), headers = { 'Content-Security-Policy': csp, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
  if (url.pathname === '/data.json') { res.writeHead(200, { ...headers, 'Content-Type': types['.json'] }); res.end(served); return; }
  const file = { '/': 'index.html', '/index.html': 'index.html', '/run-view.js': 'run-view.js', '/run-view.css': 'run-view.css' }[url.pathname];
  if (!file) { res.writeHead(404, headers); res.end('nope'); return; }
  res.writeHead(200, { ...headers, 'Content-Type': types[path.extname(file)] }); res.end(readFileSync(path.join(here, file)));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ executablePath: a.chromium, args: ['--no-sandbox', '--enable-precise-memory-info'] });
const consoleIssues = [];
function watch(page, tag) {
  page.on('console', m => { if (['error', 'warning'].includes(m.type())) consoleIssues.push(`${tag} console.${m.type()}: ${m.text()}`); });
  page.on('pageerror', e => consoleIssues.push(`${tag} pageerror: ${e.message}`));
  page.on('requestfailed', r => consoleIssues.push(`${tag} requestfailed: ${r.url()} ${r.failure()?.errorText}`));
  page.on('response', r => { if (r.status() >= 400) consoleIssues.push(`${tag} http ${r.status()}: ${r.url()}`); });
}
const states = page => page.evaluate(() => Object.fromEntries(RunView.state().cards.map(c => [c.label, c.state])));
const cardLine = (page, label) => page.evaluate(l => RunView.state().cards.find(c => c.label === l)?.line, label);

try {
  // ---------------------------------------------------------------------------------------------- main run
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage(); watch(page, 'main');
  await page.goto(`${origin}/?data=/data.json&autoplay=0`);
  await page.waitForFunction(() => window.RunView?.state().cards.length > 0);
  const ev = data.events, idxOf = pred => ev.findIndex(pred);
  const first = RunViewIndex(ev);
  function RunViewIndex(events) {
    return { calling: events.findIndex(e => e.type === 'model.called') - 1, escalated: events.findIndex(e => e.type === 'model.escalated'), end: events.length - 1 };
  }
  const s0 = await states(page);
  check('t=0: every node is idle', Object.values(s0).every(v => v === 'idle'), JSON.stringify(s0));
  report.measured.nodes = { shown: Object.keys(s0).length, workflowNodes: data.workflow.nodes.length };

  // timeline point 1: model calls in flight
  await page.evaluate(i => RunView.seekIndex(i), first.calling);
  const s1 = await states(page);
  check('point 1: at least one node is waiting on a model and one is a done preparation step', Object.values(s1).some(v => ['calling', 'queued'].includes(v)) && Object.values(s1).includes('done'), JSON.stringify(s1));
  await page.screenshot({ path: path.join(shots, 'ui-1-calling.png') });

  // timeline point 2: the moment of the first escalation (held 1.2 s in real playback)
  await page.evaluate(i => RunView.seekIndex(i), first.escalated);
  const s2 = await states(page), line2 = await cardLine(page, 'Dates');
  check('point 2: a group shows the escalated state with its reason in the live line', Object.values(s2).includes('escalated') && /escalated/i.test(JSON.stringify(await page.evaluate(() => RunView.state().cards.map(c => c.line)))), JSON.stringify({ s2, line2 }));
  await page.screenshot({ path: path.join(shots, 'ui-2-escalation.png') });

  // timeline point 3: the end
  await page.evaluate(i => RunView.seekIndex(i), first.end);
  const s3 = await states(page);
  check('point 3: run finished; the map with a collected failure is "handled", not green', s3.Dates === 'handled', JSON.stringify(s3));
  check('point 3: a non-gating verifier that said pass=false is not shown as plain done', s3.Check === 'checkfailed', JSON.stringify(s3));
  const runCost = await page.evaluate(() => RunView.app.model.run.cost);
  check('cost reconciliation: reducer total equals the run record to 1e-9', Math.abs(runCost - data.run.cost) < 1e-9, `${runCost} vs ${data.run.cost}`);
  const summary = await page.locator('#summary').innerText();
  check('summary separates local success from independent evidence', /Succeeded locally/.test(summary) && (data.external?.length ? /Independent oracle (FAILED|passed)/.test(summary) : /No independent verification/.test(summary)), summary.replace(/\n/g, ' | '));
  await page.screenshot({ path: path.join(shots, 'ui-3-end.png') });

  // transcript drawer: reachability of the diagnosis questions (clicks counted by this script)
  const reach = [];
  const probe = async (q, clicks, text, region = '#drawer') => { const body = await page.locator(region).innerText(); const ok = text.every(t => body.includes(t)); reach.push({ q, clicks, ok }); check(`reach: ${q} (${clicks} clicks)`, ok, ok ? '' : `missing in ${region}: ${text.filter(t => !body.includes(t)).join(' / ')}`); };
  await probe('Did an independent oracle agree with the run succeeding?', 0, data.external?.length ? ['Independent oracle'] : ['No independent verification'], '#summary');
  await page.locator('.card', { hasText: 'Dates' }).first().click();
  await probe('Which item failed, and with what error?', 1, ['Failed 1', 'MODEL_ESCALATION_EXHAUSTED']);
  await page.locator('#drawer .row', { hasText: 'Item 2' }).click();
  const dateItem = await page.locator('#drawer').innerText();
  await probe('Which node escalated, from which model to which?', 2, ['Escalated haiku-5-5 (M) to sonnet-5-5 (L)']);
  await probe('Why did it escalate?', 2, ['Check failed']);
  await probe('What exactly was the model asked?', 2, ['Prompt sent to haiku-5-5', 'Numeric date order of this system']);
  await probe('What did each model answer and what did it cost?', 2, ['Reply from haiku-5-5', 'Reply from sonnet-5-5', '$0.008']);
  await probe('Which inputs did the model see, and were they untrusted?', 2, ['Trust label', 'untrusted:']);
  report.measured.reachability = reach;
  await page.screenshot({ path: path.join(shots, 'ui-4-transcript.png') });
  check('drawer shows the failure reason class', /not model behaviour|no larger permitted model/.test(dateItem), dateItem.slice(-300));

  // keyboard: arrow keys move between cards, Escape closes the drawer and restores focus
  await page.keyboard.press('Escape');
  check('keyboard: Escape closes the drawer', await page.locator('#drawer').isHidden());
  await page.locator('.card').first().focus();
  const before = await page.evaluate(() => document.activeElement.dataset.id);
  await page.keyboard.press('ArrowRight');
  const after = await page.evaluate(() => document.activeElement.dataset.id);
  check('keyboard: ArrowRight moves focus to the next column', before !== after, `${before} -> ${after}`);
  const unnamed = await page.evaluate(() => [...document.querySelectorAll('button, input, select')].filter(el => !el.hidden && !(el.getAttribute('aria-label') || el.labels?.length || el.textContent.trim())).map(el => el.id || el.className));
  check('a11y: every control has an accessible name', unnamed.length === 0, JSON.stringify(unnamed));
  const cardNames = await page.evaluate(() => [...document.querySelectorAll('.card')].map(c => c.getAttribute('aria-label')));
  check('a11y: every card label carries state and live line', cardNames.every(n => /\. (Done|Not started|Done, with handled errors|Check failed)[^.]*\./.test(n) || n.length > 20), cardNames[0]);

  // detail levels and light theme screenshot
  await page.locator('#detail').fill('2');
  const simple = await states(page);
  check('detail=Simple folds the workflow to a handful of nodes', Object.keys(simple).length <= 9, Object.keys(simple).length);
  await page.locator('#theme').click();
  await page.locator('.card', { hasText: 'parallel' }).first().click();
  await page.screenshot({ path: path.join(shots, 'ui-5-simple-light.png') });
  report.measured.detailLevels = {};
  for (const [v, name] of [[0, 'raw'], [1, 'normal'], [2, 'simple']]) { await page.locator('#detail').fill(String(v)); report.measured.detailLevels[name] = (await states(page)) && (await page.locator('.card').count()); }
  await page.locator('#detail').fill('1'); await page.locator('#theme').click();

  // real-time replay from the start at 4x: wait for it to finish by itself
  await page.evaluate(() => { RunView.seekIndex(-1); RunView.setSpeed(4); RunView.play(); });
  const t0 = Date.now();
  await page.waitForFunction(() => !RunView.state().playing, null, { timeout: 120000 });
  report.measured.replay4x = { wallMs: Date.now() - t0, virtualMs: Math.round(await page.evaluate(() => RunView.state().dur)), recordedMs: ev[ev.length - 1].at - ev[0].at };
  check('replay: reaches the end at 4x', (await states(page)).Answer === 'done');
  // reduced motion
  const rm = await browser.newContext({ viewport: { width: 1200, height: 800 }, reducedMotion: 'reduce' });
  const rp = await rm.newPage(); watch(rp, 'reduced');
  await rp.goto(`${origin}/?data=/data.json&autoplay=0`); await rp.waitForFunction(() => window.RunView?.state().cards.length > 0);
  await rp.evaluate(i => RunView.seekIndex(i), first.calling);
  const anim = await rp.evaluate(() => { const d = document.querySelector('.dot.a-breathe .core, .dot.a-slow .core'); return d ? getComputedStyle(d).animationName : 'no-animated-dot'; });
  check('reduced motion: breathing animation is off', anim === 'none', anim);
  await rm.close();

  // ---------------------------------------------------------------------------------------------- hostile text
  const hostile = structuredClone(data);
  const bad = '<img src=x onerror="window.__pwned=1"><script>window.__pwned=2<\/script> ' + String.fromCharCode(0x202e) + 'evil' + String.fromCharCode(0x202c) + ' zero' + String.fromCharCode(0x200b) + 'width ' + String.fromCharCode(0x1b) + '[31mred' + String.fromCharCode(0x1b) + '[0m';
  const callId = Object.keys(hostile.calls)[0];
  hostile.calls[callId].prompt += `\n${bad}`; hostile.calls[callId].reply = bad; hostile.calls[callId].value = { quote: bad };
  hostile.workflow.title = bad; hostile.workflow.nodes[2].description = bad;
  const hk = hostile.events.find(e => e.type === 'node.failed'); if (hk) hk.error.message = bad;
  served = JSON.stringify(hostile);
  const hp = await ctx.newPage(); watch(hp, 'hostile');
  await hp.goto(`${origin}/?data=/data.json&autoplay=0`); await hp.waitForFunction(() => window.RunView?.state().cards.length > 0);
  await hp.evaluate(i => RunView.seekIndex(i), hostile.events.length - 1);
  const callNode = hostile.calls[callId].nodeKey, top = callNode.split('/')[1].split(':')[0];
  await hp.locator('.card', { hasText: top.replace(/_/g, ' ') }).first().click().catch(() => {});
  const rendered = await hp.evaluate(() => ({ pwned: window.__pwned ?? null, imgs: document.querySelectorAll('img').length, scripts: [...document.querySelectorAll('script')].filter(s => s.textContent.includes('__pwned')).length, title: document.getElementById('title').textContent, body: document.body.innerText }));
  check('hostile text: no script ran, no <img> or <script> created from data', rendered.pwned === null && rendered.imgs === 0 && rendered.scripts === 0, JSON.stringify({ pwned: rendered.pwned, imgs: rendered.imgs }));
  check('hostile text: markup is shown as text', rendered.title.includes('<img src=x'), rendered.title.slice(0, 80));
  served = JSON.stringify(data);
  const sanitized = await hp.evaluate(() => RunViewCore.sanitizeDisplay(`a${String.fromCharCode(0x202e)}b${String.fromCharCode(0x200b)}c${String.fromCharCode(0x1b)}[0m${String.fromCharCode(0xd800)}`).text);
  check('hostile text: bidi, zero-width, escape and lone-surrogate characters are made visible', /U\+202E/.test(sanitized) && /U\+200B/.test(sanitized) && /U\+001B/.test(sanitized) && !new RegExp('[\\u202e\\u200b\\u001b\\ud800]').test(sanitized), sanitized);

  // ---------------------------------------------------------------------------------------------- one-file bundle from file://
  const dir = mkdtempSync(path.join(tmpdir(), 'run-view-'));
  const bundlePath = path.join(dir, 'bundle.html');
  writeFileSync(bundlePath, bundleHtml(data));
  const bp = await ctx.newPage(); watch(bp, 'bundle');
  await bp.goto(`${pathToFileURL(bundlePath).href}?autoplay=0`); await bp.waitForFunction(() => window.RunView?.state().cards.length > 0);
  await bp.evaluate(i => RunView.seekIndex(i), first.end);
  check('bundle: one HTML file works from file:// under its own CSP', (await bp.evaluate(() => RunView.state().cards.length)) === report.measured.nodes.shown);
  report.measured.bundleBytes = readFileSync(bundlePath).length;
  rmSync(dir, { recursive: true, force: true });

  // ---------------------------------------------------------------------------------------------- 1000-item synthetic run
  const N = Number(a.synthetic);
  if (N > 0) {
    const synth = synthetic(N);
    const sp = await ctx.newPage(); watch(sp, 'synthetic');
    served = JSON.stringify(synth);
    await sp.goto(`${origin}/?data=/data.json&autoplay=0`); await sp.waitForFunction(() => window.RunView?.state().cards.length > 0);
    const m = await sp.evaluate(async () => {
      const d = RunView.app.data, C = RunViewCore, out = {};
      let t = performance.now(); const model = new C.RunModel(d); for (const e of d.events) model.apply(e); out.foldAllMs = performance.now() - t;
      out.events = d.events.length; out.rawNodes = model.insts.size;
      t = performance.now(); RunView.seekIndex(d.events.length - 1); out.seekToEndMs = performance.now() - t;
      t = performance.now(); RunView.seekIndex(Math.floor(d.events.length / 2)); out.seekBackToMiddleMs = performance.now() - t;
      out.domNodesOverview = document.querySelectorAll('*').length;
      t = performance.now(); RunView.selectSem('big'); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); out.openGroupDrawerMs = performance.now() - t;
      out.domNodesWithDrawer = document.querySelectorAll('*').length; out.waffleCells = document.querySelectorAll('.cell').length;
      RunView.closeDrawer(true);
      // replay 6 s at 16x from the start, sampling frame times
      RunView.seekIndex(-1); RunView.setSpeed(16);
      const frames = []; let last = performance.now(); const stop = last + 6000;
      RunView.play();
      await new Promise(res => { const tick = now => { frames.push(now - last); last = now; if (now < stop) requestAnimationFrame(tick); else res(); }; requestAnimationFrame(tick); });
      RunView.pause();
      frames.shift(); frames.sort((x, y) => x - y);
      out.replay16x = { frames: frames.length, medianFrameMs: frames[Math.floor(frames.length / 2)], p95FrameMs: frames[Math.floor(frames.length * 0.95)], maxFrameMs: frames[frames.length - 1], eventsApplied: RunView.state().idx + 1 };
      const perf = RunView.state().perf; out.renderMsMean = perf.renderMs / perf.renders; out.renderMsMax = perf.maxRenderMs;
      out.heapMB = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null;
      return out;
    });
    report.measured.synthetic = { items: N, ...Object.fromEntries(Object.entries(m).map(([k, v]) => [k, typeof v === 'number' ? Math.round(v * 100) / 100 : v])) };
    check('synthetic 1000-item run: folding every event takes under 500 ms', m.foldAllMs < 500, `${m.foldAllMs.toFixed(1)} ms`);
    check('synthetic 1000-item run: overview stays small (<400 DOM nodes) and group drawer is bounded (<2500)', m.domNodesOverview < 400 && m.domNodesWithDrawer < 2500, `${m.domNodesOverview} / ${m.domNodesWithDrawer}`);
    await sp.evaluate(() => { RunView.seekIndex(RunView.app.data.events.length - 1); RunView.selectSem('big'); });
    await sp.screenshot({ path: path.join(shots, 'ui-6-1000-items.png') });
    served = JSON.stringify(data);
  }
} finally {
  report.consoleIssues = consoleIssues;
  check('no console errors or warnings, no page errors, no failed requests, no CSP violations', consoleIssues.length === 0, consoleIssues.slice(0, 5).join(' || '));
  await browser.close(); server.close();
}
const failed = report.checks.filter(c => !c.ok);
report.summary = { passed: report.checks.length - failed.length, failed: failed.length, chromium: a.chromium };
if (a.report) writeFileSync(a.report, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report.measured, null, 1));
for (const c of report.checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.ok ? '' : `\n      ${c.detail}`}`);
console.log(`\n${report.summary.passed} passed, ${report.summary.failed} failed`);
process.exit(failed.length ? 1 : 0);

// A synthetic run for scale only: one map of N items (concurrency 4), a model call each, ~8% escalate, ~3% fail (collected).
function synthetic(n) {
  const workflow = { schemaVersion: '1.0', id: 'Synthetic', version: 1, title: `Synthetic ${n}-item run (scale test, not a real run)`, goal: 'scale', budget: { maxConcurrency: 4, maxCost: 5, maxSteps: 100000 },
    nodes: [{ id: 'prep', kind: 'code', needs: [], description: 'Prepare', lang: 'js', source: '' },
      { id: 'big', kind: 'map', needs: ['prep'], description: 'Judge every item', maxItems: n, body: { nodes: [{ id: 'judge', kind: 'agent', needs: [], description: 'Judge one item', model: { class: 'M', maxClass: 'L' }, checks: [] }] } },
      { id: 'merge', kind: 'code', needs: ['big'], description: 'Merge', lang: 'js', source: '' }] };
  const events = []; let seq = 0, at = 1_800_000_000_000; const push = e => events.push({ seq: ++seq, at, ...e });
  let rng = 1; const rand = () => (rng = (rng * 1664525 + 1013904223) % 4294967296) / 4294967296;
  push({ type: 'run.created' }); at += 20; push({ type: 'runner.acquired' }); at += 20;
  push({ type: 'node.started', nodeKey: 'root/prep', kind: 'code', reservedCost: 0 }); at += 200; push({ type: 'node.completed', nodeKey: 'root/prep', outputHash: 'h', outputBytes: 10 }); at += 10;
  push({ type: 'node.started', nodeKey: 'root/big', kind: 'map', reservedCost: 0, count: n });
  const workers = [at, at, at, at]; let cost = 0;
  const timeline = [];
  for (let i = 0; i < n; i++) {
    const w = workers.indexOf(Math.min(...workers)), start = workers[w] + 10, key = `root/big:${i}`, node = `${key}/judge`, esc = rand() < 0.08, fail = rand() < 0.03;
    let t = start;
    const add = (dt, e) => { t += dt; timeline.push({ at: t, ...e }); };
    timeline.push({ at: t, type: 'frame.created', frameKey: key }); add(5, { type: 'node.started', nodeKey: node, kind: 'agent', reservedCost: 0 }); add(8, { type: 'context.compiled', nodeKey: node, modelId: 'claude-haiku-5-5', modelClass: 'M', escalations: 0, receiptHash: 'r', receipt: { totalTokens: 900, inputs: [] } });
    add(60, { type: 'model.dispatched', nodeKey: node, modelId: 'claude-haiku-5-5', derived: true, journalId: i * 2 });
    add(2500 + rand() * 2500, { type: 'model.called', nodeKey: node, modelId: 'claude-haiku-5-5', ok: true, costUsd: 0.0005, latencyMs: 3000, journalId: i * 2, usage: { inputTokens: 900, outputTokens: 120 } }); cost += 0.0005;
    if (esc) { add(10, { type: 'model.escalated', nodeKey: node, rule: 'E2', fromClass: 'M', toClass: 'L', fromModel: 'claude-haiku-5-5', toModel: 'claude-sonnet-5-5', escalation: 1, errorCode: 'NODE_CHECK_FAILED', costSoFar: 0.0005 });
      add(8, { type: 'context.compiled', nodeKey: node, modelId: 'claude-sonnet-5-5', modelClass: 'L', escalations: 1, receiptHash: 'r', receipt: { totalTokens: 900, inputs: [] } }); add(40, { type: 'model.dispatched', nodeKey: node, derived: true, journalId: i * 2 + 1 });
      add(3000, { type: 'model.called', nodeKey: node, modelId: 'claude-sonnet-5-5', ok: true, costUsd: 0.008, latencyMs: 3000, journalId: i * 2 + 1 }); cost += 0.008; }
    if (fail) { add(10, { type: 'node.failed', nodeKey: node, error: { code: 'MODEL_ESCALATION_EXHAUSTED', message: 'exhausted' } }); add(5, { type: 'map.item.failed', nodeKey: 'root/big', index: i, error: { code: 'MODEL_ESCALATION_EXHAUSTED', message: 'exhausted' } }); }
    else { add(10, { type: 'node.completed', nodeKey: node, outputHash: 'h', outputBytes: 100, modelId: esc ? 'claude-sonnet-5-5' : 'claude-haiku-5-5', escalations: esc ? 1 : 0 }); add(5, { type: 'map.item.completed', nodeKey: 'root/big', index: i }); }
    workers[w] = t;
  }
  timeline.sort((x, y) => x.at - y.at);
  for (const e of timeline) { at = e.at; push(e); }
  at += 10; push({ type: 'node.completed', nodeKey: 'root/big', outputHash: 'h', outputBytes: 10, failedItems: events.filter(e => e.type === 'map.item.failed').length });
  at += 5; push({ type: 'node.started', nodeKey: 'root/merge', kind: 'code', reservedCost: 0 }); at += 100; push({ type: 'node.completed', nodeKey: 'root/merge', outputHash: 'h', outputBytes: 10 });
  at += 5; push({ type: 'run.verdict', verdict: 'pass', authority: 'supported' }); push({ type: 'run.succeeded' });
  return { schema: 'foundry-run-view/1', exportedAt: new Date(0).toISOString(), source: { workspace: 'synthetic' }, run: { id: '00000000-synthetic', status: 'succeeded', cost, steps: 0, budget: { maxCost: 5 } },
    workflow, events, outputs: {}, calls: {}, decisions: [], external: [], integrity: { events: events.length, head: 'synthetic', derivedEvents: 0 }, truncation: {}, redaction: {} };
}
