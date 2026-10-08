#!/usr/bin/env node
// Headless verification of tools/run-view with Playwright and the preinstalled Chromium. Development evidence, not a product test suite.
//
//   node tools/run-view/headless-check.mjs --real run.json --fixtures DIR [--scale scale-1000.json] [--shots research/review-20261007] [--report report.json]
//
//   --real       a JSON export of a REAL recorded run (tools/run-view/export-run.mjs on a records-v3 workspace)
//   --fixtures   a directory holding zoo-finished.json, zoo-paused.json, zoo-envfault.json and zoo-nested.json from make-fixtures.mjs (real runtime events, scripted provider)
//   --scale      optional: scale-1000.json from `make-fixtures.mjs --only scale` (a 1000-item map written by the real runtime; 4.6 MB, so not kept in samples/)
//
// It serves the page over loopback http with the SAME Content-Security-Policy shape as src/http.mjs (no inline script or style), steps the replay to three
// timeline points (screenshots ui-1..3), opens a node transcript (ui-4), and fails on: any console error or warning, page error, failed request, CSP
// violation, an unexpected state at a timeline point, or a missed reachability probe. Extra checks: the static rules shared with tests/ui-contract.test.mjs,
// hostile text, reduced motion, keyboard, WCAG contrast of the state palette, the one-file bundle from file://, a 1000-item run for timing and DOM size, and
// the live feed (serve.mjs) following a real run that is being written while the browser watches it, including a corrupted-chain stop.
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { request as httpRequest } from 'node:http';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';
import { bundleHtml } from './export-run.mjs';
import { startServer } from './serve.mjs';
import { registryWith, environment, finishedWorkflow, finishedScript } from './make-fixtures.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const { values: a } = parseArgs({ options: { real: { type: 'string' }, fixtures: { type: 'string' }, scale: { type: 'string' }, shots: { type: 'string' }, report: { type: 'string' }, chromium: { type: 'string', default: '/opt/pw-browsers/chromium' } } });
if (!a.real || !a.fixtures) { console.error('Need --real run.json and --fixtures DIR'); process.exit(2); }
const load = f => JSON.parse(readFileSync(f, 'utf8'));
const real = load(a.real), zoo = Object.fromEntries(['finished', 'paused', 'envfault', 'nested'].map(k => [k, load(path.join(a.fixtures, `zoo-${k}.json`))]));
const scaleFile = [a.scale, path.join(a.fixtures, 'scale-1000.json')].filter(Boolean).find(existsSync);
const shots = a.shots ?? path.join(here, 'shots');
mkdirSync(shots, { recursive: true });
const tmp = mkdtempSync(path.join(tmpdir(), 'run-view-check-'));
const report = { checks: [], measured: {}, errors: [] };
const check = (name, ok, detail = '') => { report.checks.push({ name, ok: !!ok, detail: String(detail) }); if (!ok) report.errors.push(`${name}: ${detail}`); };
const round = (n, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

// ------------------------------------------------------------------------------------------------ static contract
{
  const js = readFileSync(path.join(here, 'run-view.js'), 'utf8'), html = readFileSync(path.join(here, 'index.html'), 'utf8'), css = readFileSync(path.join(here, 'run-view.css'), 'utf8');
  check('static: no innerHTML/outerHTML/insertAdjacentHTML/eval/new Function/document.write', !/\.(?:innerHTML|outerHTML)\s*=|insertAdjacentHTML|\beval\s*\(|new\s+Function\s*\(|document\.write/.test(js));
  check('static: no .style access and no style attribute set from script', !/\.style\b|setAttribute\(\s*['"]style['"]/.test(js));
  check('static: html has no inline style or handler attributes', !/\sstyle\s*=|\son\w+\s*=/i.test(html));
  check('static: no remote URLs in html, css or js', !/(?:src|href)=["']https?:|url\(\s*['"]?https?:|@import|https?:\/\/(?!www\.w3\.org)/.test(html + css + js.replace(/http:\/\/www\.w3\.org\/2000\/svg/g, '')));
  check('static: js has no control or invisible characters (they are written as numbers)', !new RegExp('[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u2028-\\u202e\\u2060-\\u206f\\ufeff]').test(js));
  check('static: the page makes no request except same-origin fetch and EventSource', !/XMLHttpRequest|WebSocket|sendBeacon|importScripts|new Worker/.test(js) && (js.match(/fetch\(/g) ?? []).length <= 2);
  report.measured.sourceBytes = { js: js.length, css: css.length, html: html.length };
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
report.measured.contrast = { checked: contrast.length, failing: contrast.filter(r => !r.ok), minRatio: Math.min(...contrast.map(r => r.ratio)) };
check('contrast: every state colour and text colour meets WCAG (3:1 graphics, 4.5:1 text) in both themes', contrast.every(r => r.ok), JSON.stringify(report.measured.contrast.failing));

// ------------------------------------------------------------------------------------------------ servers
const sources = [];
async function serveData(data, name) {
  const file = path.join(tmp, `${name}.json`); writeFileSync(file, JSON.stringify(data), { mode: 0o600 });
  const server = await startServer({ dataFile: file }); sources.push(server); return server;
}
const browser = await chromium.launch({ executablePath: a.chromium, args: ['--no-sandbox', '--enable-precise-memory-info'] });
const consoleIssues = [];
function watch(page, tag) {
  page.on('console', m => { if (['error', 'warning'].includes(m.type())) consoleIssues.push(`${tag} console.${m.type()}: ${m.text()}`); });
  page.on('pageerror', e => consoleIssues.push(`${tag} pageerror: ${e.message}`));
  // A browser closing its own event stream (a page closed or a stream closed on purpose) is reported as ERR_ABORTED; a server-side failure would not be.
  page.on('requestfailed', r => { if (/\/stream\?/.test(r.url()) && r.failure()?.errorText === 'net::ERR_ABORTED') return; consoleIssues.push(`${tag} requestfailed: ${r.url()} ${r.failure()?.errorText}`); });
  page.on('response', r => { if (r.status() >= 400) consoleIssues.push(`${tag} http ${r.status()}: ${r.url()}`); });
}
const states = page => page.evaluate(() => Object.fromEntries(RunView.state().cards.map(c => [c.label, c.state])));
const lines = page => page.evaluate(() => Object.fromEntries(RunView.state().cards.map(c => [c.label, c.line])));
async function openPage(ctx, server, tag, query = '?data=/data.json&autoplay=0') {
  const page = await ctx.newPage(); watch(page, tag);
  await page.goto(`${server.origin}/${query}`);
  await page.waitForFunction(() => window.RunView?.state().cards.length > 0);
  return page;
}
const indexOf = (events, pred) => events.findIndex(pred);

try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: 'dark' });

  // ---------------------------------------------------------------------------------------------- REAL RUN (records-v3 dev, hand-written workflow)
  const realServer = await serveData(real, 'real');
  const page = await openPage(ctx, realServer, 'real');
  const ev = real.events;
  const at = { calling: indexOf(ev, e => e.type === 'model.called') - 1, escalated: indexOf(ev, e => e.type === 'model.escalated'), end: ev.length - 1 };
  const s0 = await states(page);
  const realDom = await page.evaluate(() => document.querySelectorAll('*').length);
  report.measured.realRun = { domNodesOverview: realDom, events: ev.length, derivedDispatchEvents: ev.filter(e => e.derived).length, calls: Object.keys(real.calls).length, workflowNodes: real.workflow.nodes.length, cardsAtAutoLevel: Object.keys(s0).length, exportBytes: JSON.stringify(real).length };
  check('auto detail: a 13-node workflow opens folded to Simple (at most 10 cards)', Object.keys(s0).length <= 10 && (await page.locator('#detail-label').innerText()) === 'Simple', JSON.stringify(Object.keys(s0)));
  check('t=0: every node is idle and the run reads "Starting"', Object.values(s0).every(v => v === 'idle') && /Starting/.test(await page.locator('#summary').innerText()), JSON.stringify(s0));

  await page.evaluate(i => RunView.seekIndex(i), at.calling);
  const s1 = await states(page);
  check('point 1: a node is waiting on the model and the preparation step is done', Object.values(s1).some(v => ['calling', 'queued'].includes(v)) && Object.values(s1).includes('done'), JSON.stringify(s1));
  check('point 1: the run is reported as Running (not Starting)', /Running/.test(await page.locator('#summary').innerText()));
  await page.screenshot({ path: path.join(shots, 'ui-1-calling.png') });

  await page.evaluate(i => RunView.seekIndex(i), at.escalated);
  const s2 = await states(page), l2 = await lines(page);
  check('point 2: a node shows the escalated state and its live line says why', Object.values(s2).includes('escalated') && Object.values(l2).some(l => /escalated haiku-5-5 to sonnet-5-5/i.test(l)), JSON.stringify({ s2, l2 }));
  await page.screenshot({ path: path.join(shots, 'ui-2-escalation.png') });

  await page.evaluate(i => RunView.seekIndex(i), at.end);
  const s3 = await states(page);
  check('point 3: the run finished; the map that collected a failure is "handled", not green', Object.values(s3).includes('handled'), JSON.stringify(s3));
  check('point 3: the verifier that said pass=false is not plain done', Object.values(s3).includes('checkfailed'), JSON.stringify(s3));
  check('cost reconciliation: reducer total equals the run record to 1e-9', Math.abs((await page.evaluate(() => RunView.app.model.run.cost)) - real.run.cost) < 1e-9, `${await page.evaluate(() => RunView.app.model.run.cost)} vs ${real.run.cost}`);
  const summary = await page.locator('#summary').innerText();
  check('summary separates local success from independent evidence', /Succeeded locally/.test(summary) && /Independent oracle (FAILED|passed)/.test(summary), summary.replace(/\n/g, ' | '));
  await page.screenshot({ path: path.join(shots, 'ui-3-end.png') });

  // Normal detail: every workflow node is its own card (or a chain/prep fold)
  await page.locator('#detail').fill('1');
  const sn = await states(page);
  report.measured.detailLevels = {};
  for (const [v, name] of [[0, 'raw'], [1, 'normal'], [2, 'simple']]) { await page.locator('#detail').fill(String(v)); report.measured.detailLevels[name] = await page.locator('.card').count(); }
  await page.locator('#detail').fill('1');
  check('detail levels fold monotonically (raw >= normal >= simple)', report.measured.detailLevels.raw >= report.measured.detailLevels.normal && report.measured.detailLevels.normal >= report.measured.detailLevels.simple, JSON.stringify(report.measured.detailLevels));
  await page.screenshot({ path: path.join(shots, 'ui-3b-end-normal.png'), fullPage: true });

  // transcript drawer: reachability of the diagnosis questions (clicks counted by this script)
  const reach = [];
  const probe = async (q, clicks, text, region = '#drawer') => { const body = await page.locator(region).innerText(); const ok = text.every(t => body.includes(t)); reach.push({ q, clicks, ok }); check(`reach: ${q} (${clicks} clicks)`, ok, ok ? '' : `missing in ${region}: ${text.filter(t => !body.includes(t)).join(' / ')}`); };
  await probe('Did an independent oracle agree with the run succeeding?', 0, ['Independent oracle'], '#summary');
  await page.locator('.card', { hasText: 'Dates' }).first().click();
  await probe('Which item failed, and with what error?', 1, ['Failed 1', 'MODEL_ESCALATION_EXHAUSTED']);
  await page.locator('#drawer .row', { hasText: 'Item 2' }).click();
  const dateItem = await page.locator('#drawer').innerText();
  await probe('Which node escalated, from which model to which?', 2, ['Escalated haiku-5-5 (M) to sonnet-5-5 (L)']);
  await probe('Why did it escalate?', 2, ['Check failed']);
  await probe('What exactly was the model asked?', 2, ['Prompt sent to haiku-5-5']);
  await probe('What did each model answer and what did it cost?', 2, ['Reply from haiku-5-5', 'Reply from sonnet-5-5', '$0.008']);
  await probe('Which inputs did the model see, and were they untrusted?', 2, ['Trust label']);
  report.measured.reachability = reach;
  await page.screenshot({ path: path.join(shots, 'ui-4-transcript.png') });
  check('drawer shows the failure reason class', /not model behaviour|no larger permitted model/.test(dateItem), dateItem.slice(-300));
  // the same facts through the Simple view cost one more click (the fan card opens a parts list first)
  await page.keyboard.press('Escape'); await page.locator('#detail').fill('2');
  await page.locator('.card', { hasText: 'parallel' }).first().click();
  await page.locator('#drawer .row', { hasText: 'Dates' }).first().click();
  check('reach in Simple: the failing item is 3 clicks away (fan card, part, item list)', /Failed 1/.test(await page.locator('#drawer').innerText()));
  await page.locator('#detail').fill('1'); await page.keyboard.press('Escape');

  // keyboard
  await page.keyboard.press('Escape');
  check('keyboard: Escape closes the drawer', await page.locator('#drawer').isHidden());
  await page.locator('.card').first().focus();
  const before = await page.evaluate(() => document.activeElement.dataset.id);
  await page.keyboard.press('ArrowRight');
  const after = await page.evaluate(() => document.activeElement.dataset.id);
  check('keyboard: ArrowRight moves focus to the next column', before !== after, `${before} -> ${after}`);
  await page.locator('.card').nth(1).focus(); await page.keyboard.press('Enter');
  const inDrawer = await page.evaluate(() => document.getElementById('drawer').contains(document.activeElement));
  const openedId = await page.evaluate(() => RunView.app.semId);
  await page.keyboard.press('Escape');
  const backOnCard = await page.evaluate(id => document.activeElement?.dataset?.id === id, openedId);
  check('keyboard: Enter on a card opens its transcript and moves focus into it; Escape closes it and returns focus to that card', inDrawer && backOnCard, JSON.stringify({ inDrawer, backOnCard, openedId }));
  const unnamed = await page.evaluate(() => [...document.querySelectorAll('button, input, select')].filter(el => !el.hidden && !(el.getAttribute('aria-label') || el.labels?.length || el.textContent.trim())).map(el => el.id || el.className));
  check('a11y: every control has an accessible name', unnamed.length === 0, JSON.stringify(unnamed));
  const cardNames = await page.evaluate(() => [...document.querySelectorAll('.card')].map(c => c.getAttribute('aria-label')));
  check('a11y: every card name carries label, state and live line', cardNames.every(n => n.split('. ').length >= 3), cardNames[0]);
  const landmarks = await page.evaluate(() => ({ h1: document.querySelectorAll('h1').length, main: document.querySelectorAll('[aria-label="Run graph"]').length, live: !!document.querySelector('[role=status][aria-live=polite]'), lang: document.documentElement.lang }));
  check('a11y: one h1, a labelled graph region, a polite live region, a language', landmarks.h1 === 1 && landmarks.main === 1 && landmarks.live && landmarks.lang === 'en', JSON.stringify(landmarks));
  await page.locator('#theme').click();
  await page.locator('.card', { hasText: 'Dates' }).first().click();
  await page.screenshot({ path: path.join(shots, 'ui-5-light-theme.png') });
  await page.locator('#theme').click();

  // real-time replay from the start at 4x
  await page.keyboard.press('Escape');
  await page.evaluate(() => { RunView.seekIndex(-1); RunView.setSpeed(4); RunView.play(); });
  const t0 = Date.now();
  await page.waitForFunction(() => !RunView.state().playing, null, { timeout: 120000 });
  report.measured.replay4x = { wallMs: Date.now() - t0, virtualMs: Math.round(await page.evaluate(() => RunView.state().dur)), recordedMs: ev[ev.length - 1].at - ev[0].at };
  check('replay: plays to the end by itself at 4x', Object.values(await states(page)).every(v => !['idle', 'calling', 'queued'].includes(v)));

  // reduced motion
  const rm = await browser.newContext({ viewport: { width: 1200, height: 800 }, reducedMotion: 'reduce' });
  const rp = await rm.newPage(); watch(rp, 'reduced');
  await rp.goto(`${realServer.origin}/?data=/data.json&autoplay=0`); await rp.waitForFunction(() => window.RunView?.state().cards.length > 0);
  await rp.evaluate(i => RunView.seekIndex(i), at.calling);
  const anim = await rp.evaluate(() => { const d = document.querySelector('.dot.a-breathe .core, .dot.a-slow .core'); return d ? getComputedStyle(d).animationName : 'no-animated-dot'; });
  check('reduced motion: the breathing animation is off', anim === 'none', anim);
  await rm.close();
  const anim2 = await page.evaluate(i => { RunView.seekIndex(i); const d = document.querySelector('.dot.a-breathe .core, .dot.a-slow .core'); return d ? getComputedStyle(d).animationName : 'no-animated-dot'; }, at.calling);
  check('motion on: a calling dot really breathes (a CSS animation is attached)', /breathe/.test(anim2), anim2);
  // The breathing itself: eight clips of one "waiting for the model" dot, 350 ms apart (one cycle is 2.6 s), at 3x so the ring and the pulse are visible.
  {
    const sctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 3, colorScheme: 'dark' });
    const sp = await openPage(sctx, realServer, 'breathing');
    await sp.evaluate(i => RunView.seekIndex(i), at.calling);
    const dot = sp.locator('.card.s-calling .dot').first(), clips = [];
    for (let i = 0; i < 8; i++) { const box = await dot.boundingBox(); clips.push((await sp.screenshot({ clip: { x: box.x - 8, y: box.y - 8, width: box.width + 16, height: box.height + 16 } })).toString('base64')); await sp.waitForTimeout(350); }
    check('breathing: the same dot looks different at different moments of its cycle (at least 4 distinct renderings in 8 clips)', new Set(clips).size >= 4, `${new Set(clips).size} distinct`);
    const mp = await sctx.newPage();
    await mp.setContent(`<body style="margin:0;background:#0d1118;color:#a3b2c6;font:14px system-ui;padding:14px"><div style="margin-bottom:8px">Breathing dot, state "waiting for the model", clips 350 ms apart (one cycle 2.6 s), 3x</div><div style="display:flex;gap:10px">${clips.map((c, i) => `<figure style="margin:0;text-align:center"><img style="width:96px;height:96px;image-rendering:pixelated;border:1px solid #2b3648" src="data:image/png;base64,${c}"><figcaption>${(i * 0.35).toFixed(2)} s</figcaption></figure>`).join('')}</div></body>`);
    await mp.screenshot({ path: path.join(shots, 'ui-16-breathing.png'), clip: { x: 0, y: 0, width: 920, height: 190 } });
    await sctx.close();
  }
  report.measured.dotColours = await page.evaluate(() => { const out = {}; for (const el of document.querySelectorAll('.card .dot')) { const c = getComputedStyle(el.querySelector('.core')).fill; out[[...el.classList].find(c => c.startsWith('s-'))] = c; } return out; });
  check('state colours reach the dots (not all one neutral grey)', new Set(Object.values(report.measured.dotColours)).size >= 3, JSON.stringify(report.measured.dotColours));

  // ---------------------------------------------------------------------------------------------- THE FOUR STATE FIXTURES
  const fin = await serveData(zoo.finished, 'zoo-finished'), fp = await openPage(ctx, fin, 'zoo-finished');
  const fe = zoo.finished.events, firstEsc = indexOf(fe, e => e.type === 'model.escalated');
  check('zoo-finished: authored labels name the nodes ("Visual understanding")', Object.keys(await states(fp)).includes('Visual understanding'));
  await fp.evaluate(i => RunView.seekIndex(i), firstEsc);
  const fl = await lines(fp);
  check('zoo-finished: at the first escalation the node says it was a failed check and which models', /Check failed, escalated haiku-5-5 to sonnet-5-5/.test(fl['Visual understanding']), fl['Visual understanding']);
  await fp.screenshot({ path: path.join(shots, 'ui-6-gameqa-escalation.png') });
  await fp.evaluate(i => RunView.seekIndex(i), fe.length - 1);
  const ff = await states(fp), fline = await lines(fp);
  check('zoo-finished: end states: handled map, loop done in 3 iterations, check-failed verifier, skipped node', ff['Visual understanding'] === 'handled' && ff['Reproduce the glitch'] === 'done' && /3 iterations/.test(fline['Reproduce the glitch']) && ff['Independent QA judge'] === 'checkfailed' && ff['Perf pass'] === 'skipped', JSON.stringify(ff));
  await fp.locator('.card', { hasText: 'Severity call' }).first().click();
  const sev = await fp.locator('#drawer').innerText();
  check('zoo-finished: the retried node shows the rejected reply and the retry as a turn', /retry 1 on the same model/i.test(sev) && /MODEL_SCHEMA/.test(sev) && /untrusted:player-report/.test(sev), sev.slice(0, 400));
  await fp.screenshot({ path: path.join(shots, 'ui-7-gameqa-transcript.png') });

  const pau = await serveData(zoo.paused, 'zoo-paused'), pp = await openPage(ctx, pau, 'zoo-paused');
  await pp.evaluate(i => RunView.seekIndex(i), zoo.paused.events.length - 1);
  const ps = await states(pp), pl = await lines(pp);
  check('zoo-paused: a question and an approval are "needs you"; a timer is "waiting"; done stays done', ps.Triage === 'needsyou' && ps['File bug'] === 'needsyou' && ps.Soak === 'waiting' && ps.Summarise === 'done', JSON.stringify(ps));
  check('zoo-paused: live lines name what is awaited', /Waiting for your answer: Frame f3/.test(pl.Triage) && /Needs your approval: qa\.file_bug/.test(pl['File bug']) && /Waiting until \d\d:\d\d:\d\d UTC/.test(pl.Soak), JSON.stringify(pl));
  check('zoo-paused: the run reads "Needs approval", not Failed or Cancelled', /Needs approval/.test(await pp.locator('#summary').innerText()));
  await pp.screenshot({ path: path.join(shots, 'ui-8-needs-you-waiting.png') });

  const env = await serveData(zoo.envfault, 'zoo-envfault'), ep = await openPage(ctx, env, 'zoo-envfault');
  await ep.evaluate(i => RunView.seekIndex(i), zoo.envfault.events.length - 1);
  const es = await states(ep), el = await lines(ep);
  check('zoo-envfault: a provider rate limit is its own state and is never escalated; the finished sibling stays done', es['Arena check'] === 'envfault' && es['Menu check'] === 'done' && /Not escalated/.test(el['Arena check']), JSON.stringify({ es, el }));
  await ep.locator('.card', { hasText: 'Arena' }).first().click();
  check('zoo-envfault: the drawer says it is not model behaviour', /not model behaviour/i.test(await ep.locator('#drawer').innerText()));
  await ep.screenshot({ path: path.join(shots, 'ui-9-env-fault.png') });

  // nested frames: a loop inside a map, drilled down through item, iteration and step
  const nes = await serveData(zoo.nested, 'zoo-nested'), nsp = await openPage(ctx, nes, 'zoo-nested');
  await nsp.evaluate(i => RunView.seekIndex(i), zoo.nested.events.length - 1);
  const nst = await states(nsp);
  check('zoo-nested: a loop inside a map is three cards (plan, cases, report), all done', Object.keys(nst).length === 3 && Object.values(nst).every(v => v === 'done'), JSON.stringify(nst));
  await nsp.locator('.card', { hasText: 'Cases' }).first().click();
  await nsp.locator('#drawer .row', { hasText: 'Item 1' }).click();
  await nsp.locator('#drawer .row', { hasText: 'Settle' }).click();
  const iterText = await nsp.locator('#drawer').innerText();
  await nsp.locator('#drawer .row', { hasText: 'Iteration 2' }).click();
  const stepText = await nsp.locator('#drawer').innerText();
  check('zoo-nested: the drawer drills map, item 1, loop, iteration 2, step, with breadcrumbs that say where you are', /iterations \(3/i.test(iterText) && /item 1/.test(stepText) && /Settle/.test(stepText) && /iteration 2/.test(stepText) && /Started tool qa\.step/.test(stepText), stepText.slice(0, 300));
  await nsp.screenshot({ path: path.join(shots, 'ui-15-nested-drilldown.png') });
  await nsp.locator('#drawer nav button', { hasText: 'item 1' }).click();
  check('zoo-nested: a breadcrumb jumps back up one level', /item 1: done/i.test(await nsp.locator('#drawer').innerText()));

  // ---------------------------------------------------------------------------------------------- a phone-width window
  {
    const nctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'light' });
    const np = await openPage(nctx, fin, 'narrow');
    await np.evaluate(i => RunView.seekIndex(i), fe.length - 1);
    await np.locator('.card', { hasText: 'Visual understanding' }).first().click();
    const m = await np.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: innerWidth, drawer: document.getElementById('drawer').getBoundingClientRect().width, tooSmall: [...document.querySelectorAll('button, select, input')].filter(el => !el.hidden && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height < 24 && el.type !== 'range' && el.type !== 'checkbox').map(el => el.id || el.textContent.slice(0, 20)) }));
    check('narrow (390 px): the page does not scroll sideways and the drawer takes the full width', m.doc <= m.win && m.drawer >= 380, JSON.stringify(m));
    await np.screenshot({ path: path.join(shots, 'ui-13-narrow.png') });
    await nctx.close();
  }

  // ---------------------------------------------------------------------------------------------- hostile text
  const hostile = structuredClone(real);
  const bad = '<img src=x onerror="window.__pwned=1"><script>window.__pwned=2<\/script> ' + String.fromCharCode(0x202e) + 'evil' + String.fromCharCode(0x202c) + ' zero' + String.fromCharCode(0x200b) + 'width ' + String.fromCharCode(0x1b) + '[31mred' + String.fromCharCode(0x1b) + '[0m';
  const callId = Object.keys(hostile.calls)[0];
  hostile.calls[callId].prompt += `\n${bad}`; hostile.calls[callId].reply = bad; hostile.calls[callId].value = { quote: bad };
  hostile.workflow.title = bad; hostile.workflow.nodes[2].description = bad; hostile.viewHints = { labels: { [hostile.workflow.nodes[2].id]: bad.slice(0, 40) } };
  const hk = hostile.events.find(e => e.type === 'node.failed'); if (hk) hk.error.message = bad;
  const hs = await serveData(hostile, 'hostile'), hp = await openPage(ctx, hs, 'hostile');
  await hp.locator('#detail').fill('1');
  await hp.evaluate(i => RunView.seekIndex(i), hostile.events.length - 1);
  const top = hostile.calls[callId].nodeKey.split('/')[1].split(':')[0];
  await hp.locator('.card', { hasText: top.replace(/_/g, ' ') }).first().click().catch(() => {});
  const rendered = await hp.evaluate(() => ({ pwned: window.__pwned ?? null, imgs: document.querySelectorAll('img').length, scripts: [...document.querySelectorAll('script')].filter(s => s.textContent.includes('__pwned')).length, title: document.getElementById('title').textContent, body: document.body.innerText }));
  check('hostile text: no script ran, no <img> or <script> created from data', rendered.pwned === null && rendered.imgs === 0 && rendered.scripts === 0, JSON.stringify({ pwned: rendered.pwned, imgs: rendered.imgs }));
  check('hostile text: markup is shown as text', rendered.title.includes('<img src=x'), rendered.title.slice(0, 80));
  const sanitized = await hp.evaluate(() => RunViewCore.sanitizeDisplay(`a${String.fromCharCode(0x202e)}b${String.fromCharCode(0x200b)}c${String.fromCharCode(0x1b)}[0m${String.fromCharCode(0xd800)}`).text);
  check('hostile text: bidi, zero-width, escape and lone-surrogate characters are made visible', /U\+202E/.test(sanitized) && /U\+200B/.test(sanitized) && /U\+001B/.test(sanitized) && !new RegExp('[\\u202e\\u200b\\u001b\\ud800]').test(sanitized), sanitized);

  // ---------------------------------------------------------------------------------------------- one-file bundle from file://
  const bundlePath = path.join(tmp, 'bundle.html');
  writeFileSync(bundlePath, bundleHtml(real));
  const bp = await ctx.newPage(); watch(bp, 'bundle');
  await bp.goto(`${pathToFileURL(bundlePath).href}?autoplay=0`); await bp.waitForFunction(() => window.RunView?.state().cards.length > 0);
  await bp.evaluate(i => RunView.seekIndex(i), at.end);
  check('bundle: one HTML file works from file:// under its own CSP', (await bp.evaluate(() => RunView.state().cards.length)) === report.measured.realRun.cardsAtAutoLevel);
  report.measured.bundleBytes = readFileSync(bundlePath).length;

  // ---------------------------------------------------------------------------------------------- 1000 items (real runtime events when a scale fixture exists)
  const scale = scaleFile ? load(scaleFile) : null;
  if (scale) {
    const ss = await serveData(scale, 'scale'), sp = await openPage(ctx, ss, 'scale');
    const m = await sp.evaluate(async () => {
      const d = RunView.app.data, C = RunViewCore, out = {};
      const big = RunView.app.sem.nodes.find(n => n.container)?.id;
      let t = performance.now(); const model = new C.RunModel(d); for (const e of d.events) model.apply(e); out.foldAllMs = performance.now() - t;
      out.events = d.events.length; out.rawNodeInstances = model.insts.size; out.items = model.items.size;
      t = performance.now(); RunView.seekIndex(d.events.length - 1); out.seekToEndMs = performance.now() - t;
      t = performance.now(); RunView.seekIndex(Math.floor(d.events.length / 2)); out.seekBackToMiddleMs = performance.now() - t;
      out.domNodesOverview = document.querySelectorAll('*').length;
      t = performance.now(); RunView.selectSem(big); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); out.openGroupDrawerMs = performance.now() - t;
      out.domNodesWithDrawer = document.querySelectorAll('*').length; out.waffleCells = document.querySelectorAll('.cell').length; out.drawerRows = document.querySelectorAll('#drawer .row').length;
      RunView.closeDrawer(true);
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
    report.measured.scale = { source: 'real runtime events, scripted provider', exportBytes: JSON.stringify(scale).length, ...Object.fromEntries(Object.entries(m).map(([k, v]) => [k, typeof v === 'number' ? round(v, 2) : v])) };
    check('1000-item run: folding every event takes under 500 ms', m.foldAllMs < 500, `${m.foldAllMs.toFixed(1)} ms for ${m.events} events`);
    check('1000-item run: the overview DOM does not grow with the item count (within 1.5x of the 13-node real run) and the group drawer is bounded (<2500)', m.domNodesOverview < 1.5 * report.measured.realRun.domNodesOverview && m.domNodesWithDrawer < 2500, `${m.domNodesOverview} vs ${report.measured.realRun.domNodesOverview} / ${m.domNodesWithDrawer}`);
    check('1000-item run: replay at 16x keeps frames under 50 ms at the 95th percentile', m.replay16x.p95FrameMs < 50, JSON.stringify(m.replay16x));
    await sp.evaluate(() => { RunView.seekIndex(RunView.app.data.events.length - 1); RunView.selectSem(RunView.app.sem.nodes.find(n => n.container).id); });
    await sp.screenshot({ path: path.join(shots, 'ui-10-1000-items.png') });
  } else report.measured.scale = 'no scale fixture supplied';

  // ---------------------------------------------------------------------------------------------- a static graph of 1000 nodes (not items)
  {
    const nodes = [], layers = 25, per = 40;
    for (let l = 0; l < layers; l++) for (let i = 0; i < per; i++) nodes.push({ id: `n${l}_${i}`, kind: i % 5 === 0 ? 'agent' : i % 5 === 1 ? 'verify' : i % 2 ? 'code' : 'task', needs: l === 0 ? [] : [`n${l - 1}_${i}`, `n${l - 1}_${(i + 1) % per}`], description: `Step ${l}.${i}`, ...(i % 5 === 0 ? { model: { class: 'M' } } : {}) });
    let seq = 0, t = 1.8e12; const evs = [{ seq: ++seq, at: t, type: 'run.created' }, { seq: ++seq, at: t, type: 'runner.acquired' }];
    for (const n of nodes.slice(0, 500)) { t += 4; evs.push({ seq: ++seq, at: t, type: 'node.started', nodeKey: `root/${n.id}`, kind: n.kind, reservedCost: 0 }); t += 4; evs.push({ seq: ++seq, at: t, type: 'node.completed', nodeKey: `root/${n.id}`, outputHash: 'h' }); }
    const wide = { schema: 'foundry-run-view/1', exportedAt: new Date(0).toISOString(), source: { workspace: 'synthetic' }, run: { id: '00000000-wide', status: 'running', cost: 0, steps: 0, budget: { maxCost: 1 } }, workflow: { schemaVersion: '1.0', id: 'Wide', version: 1, title: 'Static 1000-node graph (scale test, not a real run)', goal: 'x', budget: { maxConcurrency: 4, maxCost: 1, maxSteps: 100000 }, nodes }, events: evs, outputs: {}, calls: {}, decisions: [], external: [], integrity: { events: evs.length, head: 'x', derivedEvents: 0 }, truncation: {}, redaction: {} };
    const ws = await serveData(wide, 'wide');
    const t0 = Date.now(), wp = await openPage(ctx, ws, 'wide'), ready = Date.now() - t0;
    const m = await wp.evaluate(() => { const o = { cardsAtAutoLevel: RunView.state().cards.length }, t = performance.now(); RunView.seekIndex(RunView.app.data.events.length - 1); o.seekToEndMs = performance.now() - t; o.dom = document.querySelectorAll('*').length; const wf = RunView.app.data.workflow; for (const lvl of [2, 1, 0]) { const a = performance.now(), sem = RunViewCore.buildSemantic(wf, { level: lvl }); o[`semanticMsLevel${lvl}`] = performance.now() - a; o[`cardsLevel${lvl}`] = sem.nodes.length; } return o; });
    report.measured.staticGraph1000 = { nodes: nodes.length, pageReadyMs: ready, ...Object.fromEntries(Object.entries(m).map(([k, v]) => [k, typeof v === 'number' ? round(v, 1) : v])) };
    check('1000-node static graph: Simple folds it to at most 12 stage cards, ready in under 2 s, DOM under 700 nodes', m.cardsAtAutoLevel <= 12 && ready < 2000 && m.dom < 700, JSON.stringify(report.measured.staticGraph1000));
    check('1000-node static graph: the semantic fold takes under 500 ms at every level', Math.max(m.semanticMsLevel0, m.semanticMsLevel1, m.semanticMsLevel2) < 500, JSON.stringify(report.measured.staticGraph1000));
    await wp.screenshot({ path: path.join(shots, 'ui-14-1000-node-graph.png') });
  }

  // ---------------------------------------------------------------------------------------------- LIVE FEED: a real run written while the browser watches
  {
    const root = mkdtempSync(path.join(tmp, 'live-'));
    const registry = registryWith(), wf = finishedWorkflow(), envr = environment(root, finishedScript(), {}, registry);
    envr.store.saveWorkflow(wf);
    const idle = envr.runtime.create(wf, { notes: 'a run nobody executes', perf: false });       // created first: the picker lists the newest run first
    const run = envr.runtime.create(wf, { notes: 'bridge clips through the player', perf: false });
    const server = await startServer({ workspace: root, pollMs: 100 }); sources.push(server);
    const noToken = await fetch(`${server.origin}/api/runs`);
    const badHost = await new Promise(resolve => { const r = httpRequest(`${server.origin}/api/runs?t=${server.token}`, { headers: { Host: 'evil.example' } }, res => { res.resume(); resolve({ status: res.statusCode }); }); r.on('error', () => resolve({ status: 'refused' })); r.end(); });
    check('live: /api refuses a missing token (403)', noToken.status === 403, String(noToken.status));
    check('live: a request with a foreign Host header is refused', badHost.status === 403 || badHost.status === 'refused', String(badHost.status));
    const post = await fetch(`${server.origin}/api/runs?t=${server.token}`, { method: 'POST' });
    check('live: the server is read-only (POST is 405)', post.status === 405, String(post.status));
    const lp = await ctx.newPage(); watch(lp, 'live');
    await lp.goto(`${server.origin}/#t=${server.token}`);
    await lp.waitForSelector('#empty .row');
    check('live: the run picker lists the workspace run', /Game QA, scripted fixture/.test(await lp.locator('#empty').innerText()));
    await lp.locator('#empty .row').first().click();
    await lp.waitForFunction(() => window.RunView?.live.connected);
    check('live: the token is gone from the address bar after load', (await lp.evaluate(() => location.hash)) === '' && !(await lp.evaluate(() => location.href)).includes(server.token));
    envr.store.close();                                                    // the writer is a separate process from here on
    const writer = spawn(process.execPath, [path.join(here, 'live-writer.mjs'), '--workspace', root, '--run', run.id], { stdio: ['ignore', 'pipe', 'inherit'] });
    const execution = new Promise(resolve => writer.on('exit', resolve));
    const seen = [], t1 = Date.now();
    let paused = null;
    while (Date.now() - t1 < 60000) {
      if (!paused && seen.length && seen.at(-1).n >= 14) {            // mid-run: pause the live view, let the writer carry on, then catch up
        await lp.locator('#play').click();
        const idx0 = await lp.evaluate(() => RunView.app.idx);
        await lp.waitForFunction(i => RunView.app.data.events.length > i + 6, idx0, { timeout: 8000 });
        paused = await lp.evaluate(i => ({ idx: RunView.app.idx, buffered: RunView.app.data.events.length - 1 - RunView.app.idx, held: i === RunView.app.idx, label: document.getElementById('play').textContent }), idx0);
        paused.summary = await lp.locator('#summary').innerText();
        await lp.locator('#play').click();
        paused.caughtUp = await lp.evaluate(() => RunView.app.idx === RunView.app.data.events.length - 1);
      }
      const st = await lp.evaluate(() => ({ s: Object.fromEntries(RunView.state().cards.map(c => [c.label, c.state])), run: RunView.state().run.status, n: RunView.app.data.events.length }));
      const key = JSON.stringify(st.s) + st.run; if (seen.at(-1)?.key !== key) seen.push({ key, t: Date.now() - t1, ...st });
      if (st.run === 'succeeded') break;
      await new Promise(r => setTimeout(r, 50));
    }
    await execution;
    check('live: Pause live freezes the view while events keep arriving, says how many are waiting, and Follow live catches up', paused && paused.held && paused.buffered >= 6 && paused.label === 'Follow live' && /Live view paused, \d+ new events? waiting/.test(paused.summary) && paused.caughtUp, JSON.stringify(paused));
    const sawBlue = seen.some(x => Object.values(x.s).some(v => ['calling', 'queued'].includes(v))), sawEsc = seen.some(x => Object.values(x.s).includes('escalated'));
    check('live: the browser saw the run in progress (waiting on a model, then escalated) before it finished', sawBlue && sawEsc && seen.length >= 5, `${seen.length} distinct views; first ${seen[0]?.t} ms, last ${seen.at(-1)?.t} ms`);
    await lp.waitForFunction(() => RunView.live.ended, null, { timeout: 5000 });
    const final = await states(lp);
    check('live: when the run ends the page becomes a replay of what it collected (button reads Replay)', (await lp.locator('#play').innerText()) === 'Replay');
    check('live: the final states match the recorded run (handled map, check-failed verifier, skipped node)', Object.values(final).includes('handled') && Object.values(final).includes('checkfailed') && Object.values(final).includes('skipped'), JSON.stringify(final));
    const rdb = new DatabaseSync(path.join(root, '.foundry', 'foundry.sqlite'), { readOnly: true });
    const checkpoint = JSON.parse(rdb.prepare('SELECT body FROM runs WHERE id=?').get(run.id).body), eventCount = rdb.prepare('SELECT COUNT(*) c FROM events WHERE run_id=?').get(run.id).c; rdb.close();
    check('live: the cost shown equals the runtime checkpoint', Math.abs((await lp.evaluate(() => RunView.app.model.run.cost)) - checkpoint.cost) < 1e-9);
    const lag = (await lp.evaluate(() => RunView.live.lagMs)).sort((x, y) => x - y);
    report.measured.live = { writerProcess: 'separate node process (live-writer.mjs)', events: eventCount, batches: lag.length, commitToBrowserMs: { p50: lag[Math.floor(lag.length / 2)], p95: lag[Math.floor(lag.length * 0.95)], max: lag.at(-1) }, pollMs: 100, serverStats: { ...server.stats } };
    check('live: commit-to-browser lag stays under 600 ms at the 95th percentile (100 ms poll)', report.measured.live.commitToBrowserMs.p95 < 600, JSON.stringify(report.measured.live.commitToBrowserMs));
    // lazily fetched transcript
    await lp.locator('.card', { hasText: 'Severity' }).first().click();
    await lp.waitForFunction(() => /Prompt sent to haiku-5-5/.test(document.getElementById('drawer').innerText), null, { timeout: 5000 });
    check('live: opening a transcript fetches the prompt from the journal on demand', true);
    await lp.screenshot({ path: path.join(shots, 'ui-11-live-feed.png') });
    // a run that goes quiet is called quiet, not left looking busy
    const qp = await ctx.newPage(); watch(qp, 'quiet');
    await qp.goto(`${server.origin}/?run=${idle.id}#t=${server.token}`);
    await qp.waitForFunction(() => RunView.live.connected && RunView.app.data.events.length >= 1);
    await qp.evaluate(() => { RunView.live.lastAt -= 25000; RunView.renderAll(); });
    check('live: a feed that has been silent for 10 s or more says so (a long model call and a dead runner look alike)', Number(/No event for (\d+)(?:\.\d)? s/.exec(await qp.locator('#summary').innerText())?.[1]) >= 25, (await qp.locator('#summary').innerText()).replace(/\n/g, ' | '));
    await qp.evaluate(() => RunView.closeLive?.()); await qp.close();
    // a corrupted chain stops the stream with a visible reason
    const wdb = new DatabaseSync(path.join(root, '.foundry', 'foundry.sqlite'));
    const body = JSON.parse(wdb.prepare('SELECT body FROM events WHERE run_id=? AND seq=12').get(run.id).body); body.reserved = 1;
    wdb.prepare('UPDATE events SET body=? WHERE run_id=? AND seq=12').run(JSON.stringify(body), run.id); wdb.close();
    const cp = await ctx.newPage(); watch(cp, 'tamper');
    await cp.goto(`${server.origin}/?run=${run.id}#t=${server.token}`);
    await cp.waitForFunction(() => RunView.live.integrity, null, { timeout: 8000 });
    const stopped = await cp.evaluate(() => ({ n: RunView.app.data.events.length, integrity: RunView.live.integrity }));
    check('live: a tampered event row stops the stream at that row and the page says so', stopped.integrity.seq === 12 && stopped.n === 11 && /Stream stopped/.test(await cp.locator('#summary').innerText()), JSON.stringify(stopped));
    await cp.screenshot({ path: path.join(shots, 'ui-12-chain-broken.png') });
    await cp.close(); await lp.close();
  }
} finally {
  report.consoleIssues = consoleIssues;
  check('no console errors or warnings, no page errors, no failed requests, no CSP violations', consoleIssues.length === 0, consoleIssues.slice(0, 6).join(' || '));
  await browser.close();
  for (const s of sources) await s.close().catch(() => {});
  rmSync(tmp, { recursive: true, force: true });
}
const failed = report.checks.filter(c => !c.ok);
report.summary = { passed: report.checks.length - failed.length, failed: failed.length, chromium: a.chromium, node: process.version };
if (a.report) writeFileSync(a.report, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report.measured, null, 1));
for (const c of report.checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.ok ? '' : `\n      ${c.detail}`}`);
console.log(`\n${report.summary.passed} passed, ${report.summary.failed} failed`);
process.exit(failed.length ? 1 : 0);
