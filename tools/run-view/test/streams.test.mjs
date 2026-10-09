// The JIT streams view: the model (index-streams.mjs) against report.mjs, versions and their outcomes, live-file tolerance, held-out withholding, read-only use
// of the stream folders, the self-contained export, and the page in a real browser. $0: a synthetic fixture (test/streams-fixture/), no model call.
//   node --test tools/run-view/test/streams.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, cpSync, mkdirSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildReport, renderMarkdown } from '../../../experiments/jit/report.mjs';
import { buildStreams, buildExperiment, listExperiments, planOf, oracleNumbers, armLabel, shortSpec, STREAMS_SCHEMA } from '../index-streams.mjs';
import { bundleStreamsHtml, exportStreams, outputsFor } from '../export-streams.mjs';
import { tempDir } from './fixtures.mjs';

const here = path.dirname(fileURLToPath(import.meta.url)), dir = path.join(here, '..');
const FIX = path.join(here, 'streams-fixture'), ROOT = path.join(FIX, 'runs'), CONFIGS = path.join(FIX, 'configs');
const JIT = 'jit-claude-haiku-5-5--claude-haiku-5-5';
const model = (opts = {}) => buildStreams({ root: ROOT, configsDir: CONFIGS, now: Date.parse('2026-10-09T00:00:00Z'), ...opts });
const exp = (m, name = 'jit-fix-1') => m.experiments.find(e => e.name === name);
const arm = (e, slug) => e.arms.find(a => a.slug === slug);
const src = f => readFileSync(path.join(dir, f), 'utf8');
/** Every file under a folder with its hash, size and mtime: a read-only tool leaves this unchanged. */
function snapshot(folder) {
  const out = {};
  const walk = d => { for (const e of readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else { const st = statSync(f); out[path.relative(folder, f)] = `${createHash('sha256').update(readFileSync(f)).digest('hex')}:${st.size}:${st.mtimeMs}`; } } };
  walk(folder);
  return out;
}

test('discovery: experiment folders are those holding arm folders; logs/ and smoke/ are skipped and listed; the plan comes from the config', () => {
  const { experiments, skipped } = listExperiments(ROOT);
  assert.deepEqual(experiments.map(e => e.name), ['jit-fix-1', 'jit-fix-test']);
  assert.deepEqual(skipped, ['logs', 'smoke']);
  const plan = planOf('jit-fix-1', CONFIGS);
  assert.equal(plan.tasks.length, 10, '"101..106" plus a list of four');
  assert.deepEqual(plan.tasks.slice(5, 7), [{ idx: 5, seed: 106, difficulty: 3 }, { idx: 6, seed: 107, difficulty: 4 }]);
  assert.equal(planOf('jit-fix-test', CONFIGS), null, 'no config: no plan');
  assert.equal(armLabel('jit:claude-sonnet-5-5/claude-haiku-5-5'), 'jit sonnet-5-5 / haiku-5-5');
  assert.equal(armLabel('static:research/x/B1-fix/solve.mjs'), 'static B1-fix');
  assert.equal(shortSpec('static:research/x/B1-fix/solve.mjs'), 'static:B1-fix');
});

test('totals, curves, steady state and break-even are report.mjs output, unchanged; the summary markdown is renderMarkdown\'s', () => {
  const m = model(), e = exp(m);
  assert.equal(m.schema, STREAMS_SCHEMA);
  const rep = buildReport(path.join(ROOT, 'jit-fix-1'));
  assert.equal(e.arms.length, rep.arms.length);
  for (const a of e.arms) assert.deepEqual(a.summary, rep.arms.find(r => r.spec === a.spec), `${a.slug}: the summary is report.mjs's`);
  assert.equal(e.markdown.replace(/Generated \S+/, ''), renderMarkdown(rep).replace(/Generated \S+/, ''));
  const j = arm(e, JIT);
  assert.equal(j.summary.totalUsd, 11.46); assert.equal(j.summary.unbilledUsd, 0.05, 'the open task\'s billed-to-nobody spend');
  assert.deepEqual(j.lastHalf, { ...j.summary.steadyState, fromIdx: 4, usd: 4.96 }, 'last half: report.mjs steady state plus its dollars');
  assert.deepEqual(Object.keys(j.summary.breakEven).sort(), ['agent:claude-haiku-5-5', 'agent:claude-sonnet-5-5'], 'break-even against each agent arm');
  assert.match(e.report.evidence, /development/); assert.equal(e.report.runDir.endsWith('streams-fixture/runs/jit-fix-1'), true, 'no absolute path of this machine');
  assert.ok(!JSON.stringify(m).includes(path.resolve(ROOT)), 'no absolute path anywhere in the model');
});

test('plan, task order and colour slots: the plan names 10 tasks and an arm that never started; slots follow the config so a colour stays with its arm', () => {
  const e = exp(model());
  assert.equal(e.taskCount, 10); assert.equal(e.tasks[9].seed, 110); assert.equal(e.tasks[9].difficulty, 4);
  assert.deepEqual(e.missingArms.map(x => x.spec), ['agent:claude-opus-5-5']);
  assert.deepEqual(e.arms.map(a => [a.slug, a.slot]), [['agent-claude-haiku-5-5', 0], ['agent-claude-sonnet-5-5', 1], ['static-B1-fix-solve', 3], [JIT, 4]]);
  assert.equal(arm(e, JIT).label, 'jit haiku-5-5 / haiku-5-5');
});

test('rows and events: details per task, numeric oracle fields only, billed spend folded into rows, open tasks and faults kept, a partial last line skipped', () => {
  const m = model(), e = exp(m), j = arm(e, JIT), sonnet = arm(e, 'agent-claude-sonnet-5-5');
  assert.equal(j.rows.length, 8);
  const r6 = j.rows.find(r => r.idx === 6);
  assert.equal(r6.delivered, 'adjudicated'); assert.equal(r6.version, 1);
  assert.deepEqual(r6.costBreakdown, { compileBuilder: 1, compileGateway: 0.2, compileCheck: 0.3, compiled: 0.05, shadow: 0.5, adjudicator: 0.5 });
  assert.deepEqual(r6.events.map(x => x.kind), ['compile-attempt', 'rejected', 'compiled', 'interpret', 'shadow', 'disagree', 'interpret', 'adjudicate', 'regression']);
  assert.deepEqual(r6.state, { traces: 6, regressions: 1, version: 1, deoptsSinceCompile: 0, compiledOks: 2, pendingCompile: 'regression', fallbacksUsed: 1 });
  assert.deepEqual(Object.keys(r6.oracle), ['entities', 'predicted', 'matched', 'extra', 'missing', 'pairF1', 'fieldAccuracy']);
  assert.deepEqual(oracleNumbers('{"a":1,"mismatches":[{"got":"x"}],"perField":{"b":1},"t":"text"}'), { a: 1 });
  assert.ok(!JSON.stringify(m).includes('HIDDEN-TRUTH-MARKER'), 'no oracle mismatch text and no check-traces got/want value');
  assert.equal(j.events.filter(x => x.kind === 'spend').length, 1, 'billed spend lines are in the rows; the one unbilled line stays');
  assert.equal(j.events.find(x => x.kind === 'spend').idx, 8);
  assert.ok(j.events.some(x => x.kind === 'fault' && x.idx === 5));
  assert.deepEqual(j.faults, [{ idx: 5, component: 'compiled', code: 'MODEL_RATE_LIMIT', at: '2026-10-08T10:10:00.000Z' }]);
  assert.deepEqual(j.inProgress.map(p => [p.idx, p.kinds]), [[8, ['compiled']]]);
  assert.equal(sonnet.rows.length, 6, 'the partial last line (a live stream mid-write) is skipped');
  assert.deepEqual(sonnet.inProgress.map(p => p.idx), [6]);
});

test('versions: every compile attempt with its place in the stream, why it ran, its cost and check, what became of it, its parent and its notes', () => {
  const j = arm(exp(model()), JIT);
  const v = Object.fromEntries(j.versions.map(x => [x.dir, x]));
  assert.deepEqual(j.versions.map(x => [x.dir, x.status]), [['v1-haiku55', 'not chosen'], ['v1-opus55', 'adopted'], ['v2-haiku55', 'rejected'], ['v3-haiku55', 'adopted']]);
  assert.equal(v['v1-haiku55'].fellBackTo, 'claude-opus-5-5'); assert.equal(v['v1-haiku55'].chosen, 'claude-opus-5-5');
  assert.equal(v['v1-haiku55'].check.accepted, false); assert.deepEqual(v['v1-haiku55'].check.unexplained, ['trace-2']);
  assert.deepEqual([v['v1-opus55'].adoptedAt, v['v1-opus55'].adoptedAs, v['v1-opus55'].reason, v['v1-opus55'].costUsd], [3, 'compile', 'initial', 3]);
  assert.deepEqual(v['v1-opus55'].cost, { builder: 2.5, gateway: 0.2, check: 0.3, total: 3, builderUnknown: false });
  assert.equal(v['v2-haiku55'].reason, 'deopts', 'a rejected compile takes its reason from the state the previous task left');
  assert.deepEqual(v['v2-haiku55'].trigger, [{ idx: 4, kind: 'deopt', deoptKind: 'guard' }, { idx: 5, kind: 'crash', deoptKind: 'crash' }]);
  assert.match(v['v2-haiku55'].rejectedWhy, /fewer exact on the old cases/); assert.equal(v['v2-haiku55'].keptVersion, 1);
  assert.equal(v['v2-haiku55'].parent, 'v1-opus55', 'parent by artifact hash');
  assert.equal(v['v2-haiku55'].notes.source, 'compile.json', 'no BUILD-NOTES.md: the record\'s notes');
  assert.deepEqual([v['v3-haiku55'].adoptedAs, v['v3-haiku55'].reason, v['v3-haiku55'].trigger], ['recompile', 'regression', [{ idx: 6, kind: 'regression', deoptKind: null }]]);
  assert.equal(v['v3-haiku55'].check.regressionsPassed, 1);
  assert.ok(v['v1-opus55'].notes.excerpt.includes('<img src=x'), 'notes travel as text (the page renders them as text)');
  assert.ok(v['v1-opus55'].check.perCase.every(c => !('diffs' in c)), 'per-case statuses without got/want values');
  const short = buildExperiment(path.join(ROOT, 'jit-fix-1'), { configsDir: CONFIGS, notesChars: 20 });
  assert.equal(arm(short, JIT).versions[1].notes.excerpt.length, 20); assert.equal(arm(short, JIT).versions[1].notes.chars, v['v1-opus55'].notes.chars);
});

test('held-out streams: builder notes and error messages are withheld unless asked for; typed fields stay', () => {
  const t = exp(model(), 'jit-fix-test');
  assert.equal(t.split, 'test'); assert.equal(t.content, false); assert.match(t.report.evidence, /held-out/);
  const a = t.arms[0];
  assert.equal(a.versions[0].notes.excerpt, null); assert.match(a.versions[0].notes.withheld, /withheld/);
  assert.deepEqual(a.rows[1].error, { code: 'X' });
  const text = JSON.stringify(model());
  for (const marker of ['TEST-NOTES-MARKER', 'TEST-MESSAGE-MARKER']) assert.ok(!text.includes(marker), marker);
  const open = exp(model({ allowHeldoutNotes: true }), 'jit-fix-test');
  assert.match(open.arms[0].versions[0].notes.excerpt, /TEST-NOTES-MARKER/); assert.equal(open.arms[0].rows[1].error.message, 'TEST-MESSAGE-MARKER');
});

test('live files: a version folder still being written, a half-written arm.json and a growing results file never throw', t => {
  const root = path.join(tempDir(t, 'streams-live-'), 'runs');
  cpSync(ROOT, root, { recursive: true });
  const armDir = path.join(root, 'jit-fix-1', JIT);
  mkdirSync(path.join(armDir, 'versions', 'v4-haiku55'));                                       // stream.mjs: mkdir, then copy solve.mjs, then write compile.json
  writeFileSync(path.join(armDir, 'results.jsonl'), readFileSync(path.join(armDir, 'results.jsonl'), 'utf8') + '{"experiment":"jit-fix-1","idx":8,"pa');
  writeFileSync(path.join(root, 'jit-fix-test', JIT, 'arm.json'), '');                          // caught between truncate and write
  const m = buildStreams({ root, configsDir: CONFIGS });
  const j = arm(exp(m), JIT);
  assert.equal(j.rows.length, 8);
  assert.deepEqual(j.versions.find(v => v.dir === 'v4-haiku55'), { ...j.versions.find(v => v.dir === 'v4-haiku55'), status: 'writing', cost: null, check: null });
  const broken = exp(m, 'jit-fix-test');
  assert.match(broken.error, /could not read the arms/); assert.deepEqual(broken.arms, []);
});

test('read-only: indexing and exporting leave every file of the stream folders as it was, and add none', t => {
  const before = snapshot(FIX);
  const out = tempDir(t, 'streams-export-');
  model(); exportStreams({ root: ROOT, configsDir: CONFIGS, out: path.join(out, 'streams.html') });
  assert.deepEqual(snapshot(FIX), before);
});

test('export: one self-contained html (hashed CSP, connect-src none, no URL), a data block "<" cannot close, and the JSON beside it; .json writes JSON only', t => {
  const out = tempDir(t, 'streams-export-');
  const { data, outputs } = exportStreams({ root: ROOT, configsDir: CONFIGS, out: path.join(out, 'streams.html') });
  assert.deepEqual(outputs.map(o => path.basename(o.file)), ['streams-export.json', 'streams.html']);
  for (const o of outputs) assert.equal(statSync(o.file).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(readFileSync(path.join(out, 'streams-export.json'), 'utf8')), JSON.parse(JSON.stringify(data)));
  const html = readFileSync(path.join(out, 'streams.html'), 'utf8');
  const block = /<script id="streams-data" type="application\/json">([\s\S]*?)<\/script>/.exec(html)[1];
  assert.ok(!block.includes('<'), 'no "<" in the data block (the hostile notes are escaped)'); assert.deepEqual(JSON.parse(block), JSON.parse(JSON.stringify(data)));
  assert.ok(!/<script[^>]+\ssrc=|<link[^>]+href="(?!data:)/i.test(html), 'no external script or stylesheet');
  assert.ok(!/https?:\/\/(?!www\.w3\.org)/.test(html.replace(block, '')), 'no URL outside the data block');
  const csp = /Content-Security-Policy" content="([^"]+)"/.exec(html)[1];
  for (const d of ["default-src 'none'", "connect-src 'none'", "base-uri 'none'", "form-action 'none'"]) assert.ok(csp.includes(d), d);
  const sha = text => `'sha256-${createHash('sha256').update(text).digest('base64')}'`;
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]), styles = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m => m[1]);
  assert.equal(scripts.length, 2); assert.equal(styles.length, 2);
  for (const x of [...scripts, ...styles]) assert.ok(csp.includes(sha(x)), 'every inline script and style is hashed in the CSP');
  assert.ok(!/unsafe-inline|unsafe-eval/.test(csp));
  const evil = JSON.parse(JSON.stringify(data)); evil.experiments[0].name = '</script><img src=x onerror=alert(1)><!-- ';
  assert.deepEqual(JSON.parse(/<script id="streams-data" type="application\/json">([\s\S]*?)<\/script>/.exec(bundleStreamsHtml(evil))[1]), evil);
  assert.deepEqual(outputsFor('/x/a.json'), { html: null, json: '/x/a.json' });
  assert.deepEqual(outputsFor('/x/a.html', '/y/b.json'), { html: '/x/a.html', json: '/y/b.json' });
  const cli = spawnSync(process.execPath, [path.join(dir, 'export-streams.mjs'), '--root', ROOT, '--configs', CONFIGS, '--out', path.join(out, 'only.json')], { encoding: 'utf8' });
  assert.equal(cli.status, 0, cli.stderr);
  assert.deepEqual(JSON.parse(cli.stdout).outputs.map(o => path.basename(o.file)), ['only.json']); assert.ok(!existsSync(path.join(out, 'only.html')));
});

test('static: the page has no markup sink, no eval, no inline style or handler, no remote URL and one same-origin fetch; text goes through sanitizeDisplay', () => {
  const js = src('streams.js'), html = src('streams.html'), css = src('streams.css');
  assert.ok(!/\.(?:innerHTML|outerHTML)\s*=|insertAdjacentHTML|\beval\s*\(|new\s+Function\s*\(|document\.write|\.srcdoc|createContextualFragment|DOMParser/.test(js));
  assert.ok(!/\.style\b|setAttribute\(\s*['"]style['"]/.test(js), 'no inline style from script');
  assert.ok(!/\sstyle\s*=|\son\w+\s*=/i.test(html), 'no inline style or handler attribute');
  assert.ok(!/https?:\/\/(?!www\.w3\.org)/.test(js.replace(/http:\/\/www\.w3\.org\/2000\/svg/g, '') + html + css), 'no remote URL');
  assert.ok(!/XMLHttpRequest|WebSocket|sendBeacon|importScripts|new Worker|EventSource/.test(js)); assert.ok((js.match(/fetch\(/g) ?? []).length <= 1);
  assert.match(js, /const txt = value => H\.sanitizeDisplay\(value\)\.text;/);
  assert.match(js, /document\.createTextNode\(txt\(kid\)\)/);
  assert.ok(!/createTextNode\((?!txt)/.test(js), 'no text node bypasses txt()');
  for (const m of js.matchAll(/href: ?`([^`]*)`|href: ?'([^']*)'/g)) assert.match(m[1] ?? m[2], /^#\//, 'every href is a hash route');
  const invisible = new RegExp('[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u2028-\\u202e\\u2060-\\u206f\\ufeff]');
  for (const f of ['streams.js', 'streams.css', 'streams.html', 'index-streams.mjs', 'export-streams.mjs']) assert.ok(!invisible.test(src(f)), `${f} holds no invisible character`);
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

test('browser: charts, lanes, details, versions and the summary render from the fixture; hostile notes stay text; the summary reads like report.md', async t => {
  const b = await browser(t); if (!b) return;
  const out = tempDir(t, 'streams-browser-'), file = path.join(out, 'streams.html');
  exportStreams({ root: ROOT, configsDir: CONFIGS, out: file });
  const page = await (await b.newContext({ viewport: { width: 1300, height: 900 } })).newPage();
  const issues = [];
  page.on('console', m => { if (['error', 'warning'].includes(m.type())) issues.push(`console.${m.type()}: ${m.text()}`); }); page.on('pageerror', e => issues.push(`pageerror: ${e.message}`));
  page.on('dialog', d => { issues.push(`dialog: ${d.message()}`); d.dismiss(); }); page.on('request', r => { if (!r.url().startsWith('file:') && !r.url().startsWith('data:')) issues.push(`request: ${r.url()}`); });
  await page.addInitScript(() => { window.__csp = []; document.addEventListener('securitypolicyviolation', e => window.__csp.push(e.violatedDirective)); });
  await page.goto(`${pathToFileURL(file).href}#/exp/jit-fix-1`);
  await page.waitForSelector('svg.lanes');
  assert.equal(await page.locator('svg.chart').count(), 2);
  assert.equal(await page.locator('svg.chart path.ln').count(), 4, 'one line per arm');
  assert.equal(await page.locator('svg.lanes .hit').count(), 4 * 10, 'one cell per planned task per arm');
  assert.equal(await page.locator('svg.lanes .cell.open').count(), 2, 'two open tasks');
  // chart keyboard reading
  await page.locator('svg.chart').first().focus(); await page.keyboard.press('End');
  assert.match(await page.locator('#readout').innerText(), /Task 9/);
  await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft');
  const readout = await page.locator('#readout').innerText();
  assert.match(readout, /Task 7/); assert.match(readout, /\$11\.41/, 'cumulative $ of the JIT arm at task 7');
  // a cell: click pins it and shows the cost breakdown and events
  await page.locator(`svg.lanes .hit[aria-label^="jit haiku-5-5 / haiku-5-5, task 6"]`).click();
  const detail = await page.locator('#detail').innerText();
  for (const s of ['compileBuilder', 'adjudicator', 'regression', 'rejected', '$2.55', 'adjudicated']) assert.ok(detail.includes(s), `detail shows ${s}`);
  assert.match(page.url(), /cell=jit-claude-haiku-5-5--claude-haiku-5-5%3A6$/);
  // keyboard: arrows move, Enter pins
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('Enter');
  assert.match(await page.locator('#detail').innerText(), /task 7/);
  // versions and hostile notes
  const ver = page.locator('table.ver tbody tr');
  assert.equal(await ver.count(), 4);
  assert.match(await ver.nth(2).innerText(), /rejected/);
  for (const d of await page.locator('table.ver details').all()) await d.locator('summary').click();
  const notes = await page.locator('table.ver').innerText();
  assert.ok(notes.includes('<img src=x onerror="window.__pwned=1">'), 'the hostile note is visible as text');
  assert.match(notes, /U\+202E/, 'a bidi override is made visible');
  assert.deepEqual(await page.evaluate(() => ({ pwned: window.__pwned, imgs: document.querySelectorAll('img').length, csp: window.__csp })), { pwned: undefined, imgs: 0, csp: [] });
  // the summary table: the same cells as report.md's "## Arms" table
  const md = readFileSync(path.join(out, 'streams-export.json'), 'utf8'), e = JSON.parse(md).experiments[0];
  const mdRows = e.markdown.split('## Arms')[1].split('\n').filter(l => l.startsWith('| ') && !l.startsWith('| arm')).slice(0, 4).map(l => l.split(' | ').map(c => c.replace(/^\| |\s\|$/g, '').trim()));
  const page1 = await page.locator('section[aria-label="Summary as report.mjs computes it"] table').first().locator('tbody tr').evaluateAll(trs => trs.map(tr => [...tr.children].map(c => c.textContent.trim())));
  assert.deepEqual(page1.map(r => [...r.slice(0, 8), r[9]]), mdRows, 'arm, n, success, CI, total $, $/success, $/task, last half and delivered-by match report.md');
  // the held-out stream says its notes are withheld
  await page.goto(`${pathToFileURL(file).href}#/exp/jit-fix-test`);
  await page.waitForSelector('table.ver');
  assert.match(await page.locator('table.ver').innerText(), /withheld/);
  assert.deepEqual(issues, []);
});
