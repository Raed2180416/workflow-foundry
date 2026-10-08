#!/usr/bin/env node
// Adversarial browser probe of the run-history page: the checks of the 2026-10-08 review (research/review-20261007/06b-run-history.md, "Review"). Development
// evidence, not a product test suite; the same script measured the page before and after the fixes.
//
//   node tools/run-view/headless-adversarial.mjs --json history.json [--only 1,2,3,4,5] [--out report.json] [--chromium /opt/pw-browsers/chromium]
//
// --json is the .json form of a history bundle (export-history.mjs --json-out). Sections:
//   1 hostile text in every index field, run record field (node ids, model ids, codes, kinds, prompts, replies, outputs, workflow node ids and instructions),
//     the manifest, the model summary, and run keys named like Object members ("__proto__", "constructor"); every route visited, lanes and messages opened
//   2 malformed routes (bad percent-encoding, hostile sort, group and model parameters): nothing may throw
//   3 keyboard and the accessibility tree: lanes exposed as buttons, Space activates a lane, Tab stays in the open drawer, aria-sort on the header (1360 and 390 px)
//   4 contrast of every visible text node (computed colour against the composited background) in both themes
//   5 scale: 10,000 distinct synthetic rows (load, search, group, sort, last page, task matrix) and a synthetic 1,000-node run (timeline, table, drawer,
//     messages search per keystroke, compare of two 1,000-node runs)
// It exits 1 when a check fails. Timings depend on the machine's load: report them with the load average.
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';
import { bundleHistoryHtml } from './export-history.mjs';
const { values: a } = parseArgs({ options: { json: { type: 'string' }, only: { type: 'string' }, out: { type: 'string' }, chromium: { type: 'string', default: '/opt/pw-browsers/chromium' } } });
if (!a.json) { console.error('Need --json history.json (export-history.mjs --json-out)'); process.exit(2); }
const only = a.only ? a.only.split(',') : null, section = n => !only || only.includes(String(n));
const data = JSON.parse(readFileSync(a.json, 'utf8'));
const tmp = mkdtempSync(path.join(tmpdir(), 'history-adversarial-'));
writeFileSync(path.join(tmp, 'plain.html'), bundleHistoryHtml(data));                // sections 2 to 4 open the bundle as it is
const R = { checks: [], measured: {}, issues: [] };
const check = (name, ok, detail = '') => { R.checks.push({ name, ok: !!ok, detail: typeof detail === 'string' ? detail.slice(0, 600) : JSON.stringify(detail).slice(0, 600) }); };
const gz = o => gzipSync(JSON.stringify(o)).toString('base64'), gunz = b => JSON.parse(gunzipSync(Buffer.from(b, 'base64')).toString());
const enc = encodeURIComponent;
const browser = await chromium.launch({ executablePath: a.chromium, args: ['--no-sandbox'] });
function watch(page, tag) {
  page.on('console', m => { if (['error', 'warning'].includes(m.type())) R.issues.push(`${tag} console.${m.type()}: ${m.text().slice(0, 200)}`); });
  page.on('pageerror', e => R.issues.push(`${tag} pageerror: ${e.message.slice(0, 200)}`));
  page.on('requestfailed', r => R.issues.push(`${tag} requestfailed: ${r.url().slice(0, 80)}`));
  page.on('dialog', d => { R.issues.push(`${tag} dialog: ${d.message()}`); d.dismiss(); });
}
async function open(ctx, file, tag, hash) {
  const page = await ctx.newPage(); watch(page, tag);
  await page.addInitScript(() => { window.__csp = []; document.addEventListener('securitypolicyviolation', e => window.__csp.push(`${e.violatedDirective}`)); });
  await page.goto(pathToFileURL(file).href + hash);
  await page.waitForFunction(() => document.querySelector('#view h2, #view .empty'), null, { timeout: 15000 });
  return page;
}
const settle = page => page.waitForFunction(() => !/Loading/.test(document.getElementById('view').innerText), null, { timeout: 15000 }).catch(() => {});
const probe = page => page.evaluate(() => ({
  pwned: window.__pwned ?? null, bad: document.querySelectorAll('img, iframe, object, embed, form:not(.filters), style:not(head style), link[rel=stylesheet], base, meta[http-equiv]:not(head meta), video, audio').length,
  scripts: document.querySelectorAll('script').length, handlers: [...document.querySelectorAll('*')].filter(el => [...el.attributes].some(at => /^on/i.test(at.name))).length,
  links: [...document.querySelectorAll('a[href]')].filter(x => !/^#/.test(x.getAttribute('href'))).length, xlink: document.querySelectorAll('[href^="javascript"], [*|href^="javascript"]').length, csp: window.__csp.length }));
const clean = p => p.pwned === null && p.bad === 0 && p.handlers === 0 && p.links === 0 && p.xlink === 0 && p.csp === 0;

// ---- 1. hostile everything
const EVIL = ['<img src=x onerror="window.__pwned=1">', '"><script>window.__pwned=2</script>', '<svg onload="window.__pwned=3"><a xlink:href="javascript:alert(1)">x</a></svg>', '</script><script>window.__pwned=4</script>', '<!--', '{{constructor.constructor("window.__pwned=5")()}}', 'javascript:alert(1)', '‮evil', '<style>*{display:none}</style>', '<iframe srcdoc="<script>parent.__pwned=6</script>">'];
const ev = i => EVIL[i % EVIL.length];
if (section(1)) {
  const evil = JSON.parse(JSON.stringify(data));
  const targets = evil.index.rows.filter(r => r.fidelity === 'full' && evil.runs[r.key] && !evil.runMeta[r.key]?.withheld).slice(0, 2);
  const jtarget = evil.index.rows.find(r => r.fidelity === 'journal-only' && evil.runs[r.key] && !evil.runMeta[r.key]?.withheld);
  const keyMap = {};
  [...targets, jtarget].filter(Boolean).forEach((r, i) => {
    const oldKey = r.key, newKey = `${ev(i)}${i}`; keyMap[oldKey] = newKey;
    const doc = gunz(evil.runs[oldKey]);
    // node ids, model ids, codes, kinds and task text in the record
    const ren = k => typeof k === 'string' ? k.replace(/root\/([^/:]+)/, (m, id) => `root/${id}${ev(i + 3)}`) : k;
    for (const e of doc.events) { if (e.nodeKey) e.nodeKey = ren(e.nodeKey); if (e.frameKey) e.frameKey = ren(e.frameKey); if (e.modelId) e.modelId = `${e.modelId}${ev(i + 1)}`; if (e.toModel) e.toModel = ev(i + 2); if (e.errorCode) e.errorCode = ev(i + 4); if (e.error) { e.error.code = ev(i + 5); e.error.message = ev(i + 6); } if (e.kind) e.kind = ev(i + 7); if (e.type === 'node.completed') e.output = { text: ev(i) }; }
    for (const c of Object.values(doc.calls ?? {})) { c.nodeKey = ren(c.nodeKey); c.modelId = ev(i + 1); c.prompt = ev(i); c.system = ev(i + 2); c.reply = ev(i + 3); c.value = { v: ev(i + 4) }; c.errorCode = ev(i + 8); c.mode = ev(i + 9); c.error = c.ok ? null : { code: ev(i), message: ev(i + 1) }; }
    if (doc.workflow) { doc.workflow.title = ev(i); for (const n of doc.workflow.nodes ?? []) { n.id = `${n.id}${ev(i + 3)}`; n.needs = (n.needs ?? []).map(x => `${x}${ev(i + 3)}`); n.instruction = ev(i + 5); } }
    doc.run.status = ev(i + 6);
    evil.runs[newKey] = gz(doc); delete evil.runs[oldKey];
    evil.runMeta[newKey] = { ...evil.runMeta[oldKey], reason: ev(i + 2) }; delete evil.runMeta[oldKey];
    Object.assign(r, { key: newKey, arm: ev(i), taskKey: ev(i + 1), experiment: ev(i + 2), labels: [ev(i + 3), ev(i + 4)], status: ev(i + 5), split: ev(i + 6), fidelity: r.fidelity, kind: ev(i + 7),
      joins: [ev(i + 8)], sources: [{ kind: ev(i), label: ev(i + 1), shape: ev(i + 2), headerSource: ev(i + 3) }], engineHash: ev(i + 4), inputHash: ev(i + 5),
      builtBy: { builderModel: ev(i), builderEffort: ev(i + 1), builderCostUsd: 0.1, label: ev(i + 2) }, escalationList: [{ nodeKey: ev(i), from: ev(i + 1), to: ev(i + 2), rule: ev(i + 3), code: ev(i + 4), costSoFar: 0 }], escalations: 1,
      failed: [{ nodeKey: ev(i), kind: ev(i + 1), code: ev(i + 2), class: ev(i + 3), attempts: 1, models: [ev(i + 4)], handledBy: ev(i + 5) }], failedCount: 1, costTop: [{ node: ev(i), usd: 0.1 }],
      verdict: { verdict: 'pass', code: ev(i + 6), authority: ev(i + 7) }, acceptance: { n: 1, ops: [ev(i)], existenceOnly: false },
      integrity: { chain: ev(i), chainReason: ev(i + 1), events: ev(i + 2), head: ev(i + 3), firstSeq: 1, journalRows: ev(i + 4), journalOrphans: ev(i + 5), headerShape: ev(i + 6), workflowMissing: ev(i + 7) },
      calls: { n: 3, errors: 1, byModel: { [ev(i)]: { n: 3, usd: 0.1 } } }, cost: { usd: 0.1, source: ev(i + 8), imputedUsd: 0, unknownCalls: 0 },
      oracle: { pass: false, score: 0.5, details: { [ev(i)]: 1 } }, honesty: 'mismatch-pass-fail' });
    if (r.workflow) Object.assign(r.workflow, { id: ev(i + 9), version: ev(i + 2), hash: ev(i + 1), title: ev(i) });
  });
  // keys that collide with Object.prototype members
  const protoRows = ['__proto__', 'constructor', 'toString', 'hasOwnProperty'].map((k, i) => ({ ...JSON.parse(JSON.stringify(evil.index.rows.find(r => r.fidelity === 'result-only') ?? evil.index.rows[0])), key: k, startedAt: Date.now() + i }));
  evil.index.rows.unshift(...protoRows);
  const k0 = targets[0] ? keyMap[Object.keys(keyMap)[0]] : null;
  evil.modelSummaries = k0 ? { [k0]: { model: ev(0), runDigest: 'x', output: { one_line: ev(1), what_failed: [{ fact: ev(2), note: ev(3) }], likely_cause: { class: ev(4), text: ev(5), evidence: [ev(6)] }, suggested_fix: { kind: ev(7), text: `${ev(8)} https://evil.example/` } }, checks: { unsupported: [ev(2)] }, costUsd: 0, createdAt: ev(9) } } : {};
  evil.manifest = { ...evil.manifest, notice: ev(0), builtAt: ev(1), sources: [ev(2)] }; evil.index.builtAt = ev(3);
  const file = path.join(tmp, 'evil.html'); writeFileSync(file, bundleHistoryHtml(evil));
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const routes = ['#/runs', '#/runs?group=task', '#/runs?group=arm&honesty=mismatch', '#/tasks', ...Object.values(keyMap).flatMap(k => [`#/run/${enc(k)}/timeline`, `#/run/${enc(k)}/messages`, `#/run/${enc(k)}/facts/N1`]),
    ...(Object.values(keyMap).length > 1 ? [`#/compare/${enc(Object.values(keyMap)[0])}/${enc(Object.values(keyMap)[1])}`] : []), '#/run/__proto__', '#/run/constructor', '#/run/toString/timeline', `#/runs?model=constructor`, '#/runs?model=__proto__'];
  const results = [];
  for (const route of routes) {
    const page = await open(ctx, file, `hostile ${route.slice(0, 30)}`, route); await settle(page);
    if (route === '#/runs' || route.startsWith('#/runs?group')) { for (let k = 0; k < 6; k++) { await page.locator('#runtable tbody tr:not(.detail):not(.group) button[aria-expanded="false"]').nth(k).click({ timeout: 2000 }).catch(() => {}); } }
    if (/timeline$/.test(route)) {
      await page.waitForSelector('svg.tl', { timeout: 5000 }).catch(() => {});
      const lanes = await page.locator('svg.tl .lane-label').all();
      for (const l of lanes.slice(0, 4)) { await l.focus().catch(() => {}); await page.keyboard.press('Enter'); await page.waitForTimeout(50); await page.keyboard.press('Escape'); }
      await page.getByRole('button', { name: 'Timeline as table' }).click().catch(() => {});
    }
    if (/messages$/.test(route)) { for (const b of (await page.locator('.nodelist button').all()).slice(0, 6)) { await b.click().catch(() => {}); } for (const d of await page.locator('details:not([open]) > summary').all()) await d.click().catch(() => {}); }
    const p = await probe(page);
    const text = await page.locator('body').innerText();
    results.push({ route: route.slice(0, 60), ...p, ok: clean(p) });
    if (route === '#/runs?model=constructor') R.measured.modelFilterConstructorMatches = (await page.locator('#totals strong').first().innerText().catch(() => '?'));
    if (route === '#/run/constructor') R.measured.constructorRunText = text.slice(0, 3000);
    await page.close();
  }
  check('hostile: every route renders run text as text (no element, handler, script, non-hash link, CSP violation)', results.every(r => r.ok), results.filter(r => !r.ok));
  check('keys named like Object members: a model filter "constructor" matches no run', /^0 runs match/.test(R.measured.modelFilterConstructorMatches ?? ''), R.measured.modelFilterConstructorMatches);
  check('keys named like Object members: run "constructor" shows no phantom model summary', !/Model-written summary/.test(R.measured.constructorRunText ?? ''), (R.measured.constructorRunText ?? '').slice(0, 200));
  R.measured.hostileRoutes = results.length;
  await ctx.close();
}

// ---- 2. malformed routes and lookups
if (section(2)) {
  const file = path.join(tmp, 'plain.html'); writeFileSync(file, bundleHistoryHtml(data));
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const before = R.issues.length;
  for (const route of ['#/run/%', '#/compare/%E0%A4%A/x', '#/runs?page=abc&sort=__proto__&size=0', '#/runs?sort=-constructor', '#/tasks?experiment=%', '#/run/x/%zz', '#/runs?from=notadate&to=2026-99-99']) {
    const page = await ctx.newPage(); watch(page, `route ${route}`);
    await page.goto(pathToFileURL(file).href + route); await page.waitForTimeout(400);
    await page.evaluate(r => { location.hash = r; }, route + '&x=1'); await page.waitForTimeout(200);
    await page.close();
  }
  check('malformed routes: no uncaught error', R.issues.length === before, R.issues.slice(before));
  await ctx.close();
}

// ---- 3. keyboard and accessibility tree
if (section(3)) {
  const file = path.join(tmp, 'plain.html');
  const row = data.index.rows.find(r => r.fidelity === 'full' && data.runMeta[r.key]?.embedded && !data.runMeta[r.key]?.withheld);
  for (const [w, h] of [[1360, 900], [390, 844]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    const page = await open(ctx, file, `kbd ${w}`, `#/run/${enc(row.key)}/timeline`); await page.waitForSelector('svg.tl');
    const snap = await page.locator('svg.tl').ariaSnapshot().catch(e => `ERR ${e.message}`);
    R.measured[`ariaTimeline${w}`] = snap.slice(0, 300);
    check(`a11y (${w}px): timeline lane buttons are exposed to assistive technology (not hidden inside role=img)`, /button/.test(snap), snap.slice(0, 200));
    const lane = page.locator('svg.tl .lane-label').first(); await lane.focus();
    await page.keyboard.press(' '); await page.waitForTimeout(150);
    const spaceOpened = await page.evaluate(() => !document.getElementById('drawer').hidden);
    check(`keyboard (${w}px): Space activates a focused lane (role=button)`, spaceOpened);
    if (!spaceOpened) { await lane.focus(); await page.keyboard.press('Enter'); await page.waitForSelector('#drawer:not([hidden])'); }
    const outside = [];
    for (let i = 0; i < 40; i++) { await page.keyboard.press('Tab'); const inDrawer = await page.evaluate(() => document.getElementById('drawer').contains(document.activeElement)); if (!inDrawer) outside.push(await page.evaluate(() => `${document.activeElement?.tagName}.${document.activeElement?.className?.baseVal ?? document.activeElement?.className}`)); }
    check(`keyboard (${w}px): Tab stays inside the open messages drawer`, outside.length === 0, outside.slice(0, 5));
    const ariaSortOnTh = await (async () => { const p2 = await open(ctx, file, 'sort', '#/runs'); await p2.waitForSelector('#runtable th'); const r = await p2.evaluate(() => ({ th: document.querySelectorAll('#runtable th[aria-sort]').length, btn: document.querySelectorAll('#runtable th button[aria-sort]').length })); await p2.close(); return r; })();
    if (w === 1360) check('a11y: aria-sort sits on the column header (th), not on the button inside it', ariaSortOnTh.th > 0 && ariaSortOnTh.btn === 0, ariaSortOnTh);
    await page.close(); await ctx.close();
  }
}

// ---- 4. contrast of every visible text node, both themes
if (section(4)) {
  const file = path.join(tmp, 'plain.html');
  const mm = data.index.rows.find(r => r.honesty === 'mismatch-pass-fail' && data.runMeta[r.key]?.embedded) ?? data.index.rows[0];
  const pair = data.index.rows.filter(r => r.fidelity === 'full' && data.runMeta[r.key]?.embedded).slice(0, 2);
  const failing = [];
  for (const theme of ['dark', 'light']) {
    const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, colorScheme: theme });
    for (const route of ['#/runs?honesty=mismatch', '#/runs?group=arm', `#/run/${enc(mm.key)}/timeline`, `#/run/${enc(mm.key)}/messages`, `#/run/${enc(mm.key)}/facts`, '#/tasks', ...(pair.length === 2 ? [`#/compare/${enc(pair[0].key)}/${enc(pair[1].key)}`] : [])]) {
      const page = await open(ctx, file, `contrast ${theme}`, route); await settle(page); await page.waitForTimeout(150);
      if (route.startsWith('#/runs')) await page.locator('#runtable tbody button[aria-expanded]').first().click().catch(() => {});
      const bad = await page.evaluate(() => {
        const parse = c => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p[3] ?? 1 }; };
        const lum = ({ r, g, b }) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
        const over = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 });
        const bgOf = el => { const layers = []; for (let e = el; e; e = e.parentElement) { const cs = getComputedStyle(e); const c = parse(cs.backgroundColor); if (c && c.a > 0) { layers.push({ ...c, a: c.a * Number(cs.opacity) }); if (c.a >= 1) break; } } let bg = { r: 255, g: 255, b: 255, a: 1 }; const root = parse(getComputedStyle(document.body).backgroundColor); if (root) bg = root; for (const l of layers.reverse()) bg = over(l, bg); return bg; };
        const out = [];
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        const seen = new Set();
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          if (!n.textContent.trim()) continue;
          const el = n.parentElement; if (!el || seen.has(el)) continue; seen.add(el);
          if (el.closest('[hidden], .sr-only, details:not([open]) > :not(summary), option, select, svg title')) continue;
          const rect = el.getBoundingClientRect(); if (!rect.width || !rect.height) continue;
          const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
          let eff = 1; for (let e = el; e; e = e.parentElement) eff *= Number(getComputedStyle(e).opacity);
          if (el.closest('button:disabled')) continue;
          let fg = el instanceof SVGElement ? parse(cs.fill) : parse(cs.color); if (!fg) continue;
          const bg = el instanceof SVGElement ? bgOf(el.closest('div')) : bgOf(el);
          fg = over({ ...fg, a: fg.a * eff }, bg);
          const [hi, lo] = [lum(fg), lum(bg)].sort((x, y) => y - x), ratio = (hi + 0.05) / (lo + 0.05);
          const size = parseFloat(cs.fontSize), bold = Number(cs.fontWeight) >= 700, large = size >= 24 || (bold && size >= 18.66);
          const need = large ? 3 : 4.5;
          if (ratio < need) out.push({ text: n.textContent.trim().slice(0, 30), cls: (el.className?.baseVal ?? el.className) || el.tagName, ratio: Math.round(ratio * 100) / 100, need, size });
        }
        return out;
      });
      for (const b of bad) failing.push({ theme, route: route.slice(0, 24), ...b });
      await page.close();
    }
    await ctx.close();
  }
  const uniq = [...new Map(failing.map(f => [`${f.theme}|${f.cls}|${f.ratio}`, f])).values()];
  R.measured.contrastFailures = uniq.slice(0, 40);
  check('contrast: every visible text node meets WCAG AA (4.5:1, 3:1 large) in both themes', uniq.length === 0, uniq.slice(0, 12));
}

// ---- 5. scale: 10,000 distinct synthetic rows, and a 1,000-node run
if (section(5)) {
  const big = JSON.parse(JSON.stringify(data)); big.runs = {}; big.runMeta = {}; big.modelSummaries = {};
  const base = big.index.rows, rows = [];
  for (let i = 0; i < 10000; i++) { const r = JSON.parse(JSON.stringify(base[i % base.length])); r.key = `syn-${i}-${r.key}`; r.trial = Math.floor(i / base.length); r.startedAt = 1.79e12 + i * 7919 % 1e9; r.cost = { ...r.cost, usd: (i * 37 % 1000) / 1000 }; rows.push(r); }
  big.index.rows = rows;
  // a 1,000-node run: a chain of 1,000 root nodes, one model call each, every 7th escalated, every 50th failed
  const N = 1000, t0 = 1.79e12, events = [{ seq: 1, at: t0, type: 'run.created', workflowHash: 'w', inputHash: 'i' }], calls = {}, nodes = [];
  let seq = 1, at = t0;
  for (let i = 0; i < N; i++) {
    const id = `n${String(i).padStart(4, '0')}`; nodes.push({ id, kind: 'agent', needs: i ? [`n${String(i - 1).padStart(4, '0')}`] : [], model: { class: 'S' } });
    events.push({ seq: ++seq, at: at += 5, type: 'node.started', nodeKey: `root/${id}`, kind: 'agent' });
    events.push({ seq: ++seq, at: at += 1, type: 'model.dispatched', nodeKey: `root/${id}`, modelId: 'claude-haiku-5-5', journalId: i + 1, derived: true });
    const ok = i % 50 !== 49;
    events.push({ seq: ++seq, at: at += 200, type: 'model.called', nodeKey: `root/${id}`, modelId: i % 7 === 6 ? 'claude-sonnet-5-5' : 'claude-haiku-5-5', ok, errorCode: ok ? null : 'MODEL_SCHEMA', journalId: i + 1, costUsd: 0.001, latencyMs: 200 });
    if (i % 7 === 6) events.push({ seq: ++seq, at: at += 1, type: 'model.escalated', nodeKey: `root/${id}`, fromModel: 'claude-haiku-5-5', toModel: 'claude-sonnet-5-5', rule: 'E2' });
    events.push({ seq: ++seq, at: at += 2, type: ok ? 'node.completed' : 'node.failed', nodeKey: `root/${id}`, ...(ok ? { outputHash: `h${i}` } : { error: { code: 'NODE_CHECK_FAILED' } }) });
    calls[i + 1] = { id: i + 1, nodeKey: `root/${id}`, modelId: 'claude-haiku-5-5', ok, errorCode: ok ? null : 'MODEL_SCHEMA', costUsd: 0.001, latencyMs: 200, createdAt: at, attempt: 0, prompt: `Prompt for ${id}: ${'lorem ipsum '.repeat(400)}`, reply: `Reply ${id} ${'dolor sit '.repeat(300)}`, value: { answer: id } };
  }
  events.push({ seq: ++seq, at: at += 5, type: 'run.succeeded' }, { seq: ++seq, at, type: 'run.verdict', verdict: 'pass' });
  const doc = { schema: 'foundry-run-view/1', fidelity: 'full', run: { id: 'big-1000-node', status: 'succeeded', budget: { maxConcurrency: 4 } }, workflow: { id: 'big', version: 1, nodes, acceptance: [{ op: 'eq' }] }, events, calls, outputs: {}, decisions: [], external: [] };
  const docB = JSON.parse(JSON.stringify(doc)); docB.run.id = 'big-1000-node-b'; docB.events.forEach(e => { if (e.outputHash === 'h500') e.outputHash = 'changed'; });
  const mk = (key, d) => ({ ...JSON.parse(JSON.stringify(base.find(r => r.fidelity === 'full') ?? base[0])), key, fidelity: 'full', workflow: { id: 'big', version: 1, hash: 'w', title: '' }, inputHash: 'i', startedAt: 1.8e12 });
  rows.unshift(mk('big-1000-node', doc), mk('big-1000-node-b', docB));
  big.runs['big-1000-node'] = gz(doc); big.runs['big-1000-node-b'] = gz(docB); big.runMeta['big-1000-node'] = { embedded: true }; big.runMeta['big-1000-node-b'] = { embedded: true };
  const file = path.join(tmp, 'big.html'); writeFileSync(file, bundleHistoryHtml(big));
  R.measured.scaleBundleBytes = readFileSync(file).length;
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  let t = Date.now(); const page = await open(ctx, file, 'scale', '#/runs'); await page.waitForSelector('#runtable tbody tr'); const loadMs = Date.now() - t;
  const timeAction = async (fn, waitFor) => { const t1 = Date.now(); await fn(); if (waitFor) await page.waitForFunction(waitFor, null, { timeout: 60000 }); return Date.now() - t1; };
  const m = { rows: rows.length, loadMs, dom: await page.evaluate(() => document.querySelectorAll('*').length) };
  m.searchKeystrokeMs = await timeAction(() => page.fill('input[name="q"]', 'records'), () => /runs match/.test(document.querySelector('#totals strong')?.innerText ?? ''));
  await page.fill('input[name="q"]', '');
  m.groupByTaskMs = await timeAction(() => page.selectOption('select[name="group"]', 'task'), () => document.querySelectorAll('#runtable tr.group').length > 0);
  m.groupByTaskDom = await page.evaluate(() => document.querySelectorAll('*').length);
  m.sortCostGroupedMs = await timeAction(() => page.getByRole('button', { name: 'Cost', exact: true }).click(), null);
  await page.selectOption('select[name="group"]', 'all');
  m.lastPageMs = await timeAction(async () => { await page.evaluate(() => { location.hash = '#/runs?page=100'; }); }, () => /page 100 of/.test(document.getElementById('pager')?.innerText ?? ''));
  m.tasksMatrixMs = await timeAction(() => page.evaluate(() => { location.hash = '#/tasks'; }), () => !!document.querySelector('table.matrix'));
  m.tasksMatrixDom = await page.evaluate(() => document.querySelectorAll('*').length);
  m.heapMB = await page.evaluate(() => performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null);
  R.measured.tenThousandRows = m;
  // 1,000-node run
  const n = {};
  n.timelineOpenMs = await timeAction(() => page.evaluate(() => { location.hash = '#/run/big-1000-node/timeline'; }), () => !!document.querySelector('svg.tl'));
  n.svgElements = await page.evaluate(() => document.querySelectorAll('svg.tl *').length); n.dom = await page.evaluate(() => document.querySelectorAll('*').length);
  n.note = await page.locator('.tl-note').innerText();
  n.criticalPathLanes = Number((n.note.match(/critical path of (\d+)/) ?? [])[1] ?? NaN);
  check('1,000-node chain: the critical path covers every lane (it is not cut short)', n.criticalPathLanes === 1000, n.note.slice(0, 200));
  n.zoomMs = await timeAction(() => page.getByRole('button', { name: /Zoom in/ }).click(), null);
  n.tableViewMs = await timeAction(() => page.getByRole('button', { name: 'Timeline as table' }).click(), () => document.querySelectorAll('.tl-wrap table.t tbody tr').length > 500);
  n.resizeRedrawMs = await timeAction(async () => { await page.getByRole('button', { name: 'Timeline as table' }).click(); await page.setViewportSize({ width: 1100, height: 900 }); }, null);
  n.drawerOpenMs = await timeAction(async () => { await page.locator('svg.tl .lane-label').nth(10).focus(); await page.keyboard.press('Enter'); }, () => !document.getElementById('drawer').hidden);
  await page.keyboard.press('Escape');
  n.messagesOpenMs = await timeAction(() => page.evaluate(() => { location.hash = '#/run/big-1000-node/messages'; }), () => !!document.querySelector('.nodelist'));
  n.messagesListed = await page.locator('.nodelist button').count();
  const keystrokes = [];
  for (const q of ['l', 'lo', 'lor', 'n09', 'n099']) { const t1 = Date.now(); await page.fill('.msgsearch input', q); await page.waitForTimeout(0); await page.evaluate(() => new Promise(r => requestAnimationFrame(() => r()))); keystrokes.push(Date.now() - t1); }
  n.messageSearchKeystrokeMs = keystrokes;
  n.compareOpenMs = await timeAction(() => page.evaluate(() => { location.hash = '#/compare/big-1000-node/big-1000-node-b'; }), () => !!document.querySelector('.cmp-tl svg.tl') || /Could not/.test(document.getElementById('view').innerText));
  n.compareDivergence = await page.locator('.cmp section').nth(1).innerText().catch(() => '?');
  n.compareDom = await page.evaluate(() => document.querySelectorAll('*').length);
  R.measured.thousandNodeRun = n;
  await page.close(); await ctx.close();
}
await browser.close();
rmSync(tmp, { recursive: true, force: true });
check('zero console errors, page errors, dialogs or failed requests across the probe', R.issues.length === 0, R.issues.slice(0, 12));
R.summary = { passed: R.checks.filter(c => c.ok).length, failed: R.checks.filter(c => !c.ok).length };
if (a.out) writeFileSync(a.out, JSON.stringify(R, null, 1));
for (const c of R.checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.ok ? '' : `  [${c.detail}]`}`);
console.log(JSON.stringify({ measured: R.measured, summary: R.summary }, null, 1));
process.exit(R.summary.failed ? 1 : 0);
