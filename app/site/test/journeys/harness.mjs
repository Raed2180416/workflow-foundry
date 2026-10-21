// Playwright journey harness for the onboarding site (SPEC §16). Development evidence, scripted, no users.
//
// Each journey runs the real site in-process over a temp workspace (fixed clock 2026-10-21T09:00:00Z, ephemeral keychain, $0, no
// model), drives Chromium as the person would, and counts what the person does:
//   steps  every person action (click, fill, choose, upload, key)
//   asks   actions on a control that carries data-ask (a question whose wrong guess is harmful), or inside one
// After every action and settled state it saves a screenshot (JPEG, quality 70, to keep the committed set small), the ARIA snapshot
// of <main>, the focused element, the fallback accessibility checks, console and page errors, failed and external requests, and
// the elapsed time. Any request to a host other than 127.0.0.1 is aborted and fails the journey (R11).
// Output: research/onboarding-20261021/shots/<persona>/NN-<step>.jpg, shots/<persona>/journey.json, and a summary row in
// research/onboarding-20261021/JOURNEYS.json.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createSite, siteApp } from '../../server.mjs';
import { Keychain } from '../../../onboarding/keychain.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.join(here, '..', '..', '..', '..');
export const FIXTURES = path.join(here, '..', 'fixtures');
export const OUT = process.env.FOUNDRY_SHOTS ?? path.join(ROOT, 'research', 'onboarding-20261021', 'shots');
export const SUMMARY = path.join(ROOT, 'research', 'onboarding-20261021', 'JOURNEYS.json');
export const NOW = Date.parse('2026-10-21T09:00:00Z');
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';

let browserPromise = null;
// The browser itself must not reach the network either: its own background services (sync, push messaging) are switched off, and
// any connection that is not to 127.0.0.1 goes to a proxy address where nothing listens (loopback is never proxied).
export const browser = () => (browserPromise ??= chromium.launch({ executablePath: CHROMIUM,
  args: ['--no-sandbox', '--disable-background-networking', '--disable-sync', '--disable-component-update', '--no-pings', '--proxy-server=http://127.0.0.1:9', '--disable-features=PushMessaging,OptimizationHints,MediaRouter'] }));
export async function closeBrowser() { if (browserPromise) { await (await browserPromise).close(); browserPromise = null; } }

/** The fallback accessibility checks (until axe-core is approved, O-F): the six most common WebAIM failures plus page structure. */
export async function a11y(page) {
  return page.evaluate(() => {
    const issues = [];
    const visible = e => !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length);
    const name = e => (e.getAttribute('aria-label') || e.textContent || e.getAttribute('title') || e.value || '').trim();
    if (!document.documentElement.lang) issues.push('missing lang');
    for (const i of document.querySelectorAll('input:not([type=hidden]), select, textarea')) {
      if (!visible(i)) continue;
      const labelled = i.id && document.querySelector(`label[for="${CSS.escape(i.id)}"]`) || i.closest('label') || i.getAttribute('aria-label') || i.getAttribute('aria-labelledby');
      if (!labelled) issues.push(`unlabelled ${i.tagName.toLowerCase()} ${i.name || i.type || ''}`);
    }
    for (const a of document.querySelectorAll('a')) if (visible(a) && !name(a)) issues.push('empty link');
    for (const b of document.querySelectorAll('button')) if (visible(b) && !name(b)) issues.push('empty button');
    for (const s of document.querySelectorAll('svg[role=img], img')) if (!s.getAttribute('alt') && !s.getAttribute('aria-label')) issues.push('image without text');
    const h1 = document.querySelectorAll('main h1');
    if (h1.length !== 1) issues.push(`main has ${h1.length} h1`);
    for (const l of ['header', 'nav', 'main', 'footer']) if (!document.querySelector(l)) issues.push(`no ${l}`);
    if (!document.querySelector('.skip')) issues.push('no skip link');
    if (document.querySelector('[tabindex]:not([tabindex="0"]):not([tabindex="-1"])')) issues.push('positive tabindex');
    if (!document.querySelector('[data-nav="help"]')) issues.push('no help link');
    if (document.documentElement.scrollWidth > document.documentElement.clientWidth + 1) issues.push(`horizontal scroll (${document.documentElement.scrollWidth} > ${document.documentElement.clientWidth})`);
    for (const t of document.querySelectorAll('main button, main a.button')) { const r = t.getBoundingClientRect(); if (visible(t) && (r.width < 24 || r.height < 24)) issues.push(`small target: ${name(t).slice(0, 30)}`); }
    return issues;
  });
}

/**
 * Run one journey. fn({ page, person, shot, site, app, base, url, mark, dir }) drives it.
 * opts: { name, persona, theme, width, height, keyboard, siteOptions, env, before(app, dir), budgets }
 */
export async function journey(opts, fn) {
  const { name, persona = name, theme = 'light', width = 1280, height = 900, keyboard = false } = opts;
  const variant = theme === 'light' && width === 1280 && !keyboard ? '' : `-${keyboard ? 'keyboard' : theme}-${width}`;
  const outDir = path.join(OUT, persona);
  mkdirSync(outDir, { recursive: true });
  const dir = mkdtempSync(path.join(tmpdir(), `journey-${name}-`));
  const savedEnv = {};
  for (const [k, v] of Object.entries(opts.env ?? {})) { savedEnv[k] = process.env[k]; process.env[k] = v; }
  const app = await siteApp({ workspace: dir });
  await opts.before?.(app, dir);
  const site = createSite(app, { workspace: dir, now: () => NOW, keychain: new Keychain({ backend: process.env.FOUNDRY_KEYCHAIN === 'none' ? 'none' : 'ephemeral' }), ...(opts.siteOptions ?? {}) });
  const { port, url } = await site.listen(0);
  const base = `http://127.0.0.1:${port}`;
  const context = await (await browser()).newContext({ viewport: { width, height }, colorScheme: theme, acceptDownloads: true, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const log = { journey: name, persona, variant: variant || 'light-1280', theme, width, keyboard, label: 'development, scripted, no users', steps: [], errors: [], external: [], failed: [], milestones: {}, a11y: [] };
  // A refusal the page asked for and shows in words (an /api/ answer of 4xx, e.g. practice-only mode) is logged by Chromium as
  // "Failed to load resource"; it is recorded as a refusal, not an error. Anything else on the console is an error.
  log.refusals = [];
  page.on('console', m => {
    if (m.type() !== 'error') return;
    const at = m.location()?.url ?? '';
    if (/^Failed to load resource: the server responded with a status of 4\d\d/.test(m.text()) && /^http:\/\/127\.0\.0\.1:\d+\/api\//.test(at)) { log.refusals.push(`${m.text().match(/status of (\d+)/)[1]} ${new URL(at).pathname}`); return; }
    log.errors.push(`console: ${m.text()}`);
  });
  page.on('pageerror', e => log.errors.push(`page: ${e.message}`));
  page.on('requestfailed', r => { if (!r.url().startsWith('blob:') && !/net::ERR_ABORTED/.test(r.failure()?.errorText ?? '')) log.failed.push(`${r.url()} ${r.failure()?.errorText}`); });
  await context.route('**/*', route => { const u = new URL(route.request().url()); if (['blob:', 'data:'].includes(u.protocol) || u.hostname === '127.0.0.1') return route.continue(); log.external.push(u.href); return route.abort(); });
  const started = Date.now();
  let steps = 0, asks = 0, n = 0;
  const shots = [];
  // Settled: the view and every control done being busy. A control still busy after 10 s is a defect (a spinner that never ends).
  const settle = async () => {
    await page.waitForFunction(() => !document.getElementById('view')?.hasAttribute('aria-busy') && !document.querySelector('[aria-busy="true"]'), null, { timeout: 10000 })
      .catch(async () => { log.errors.push(`stuck busy: ${await page.evaluate(() => document.querySelector('[aria-busy="true"]')?.outerHTML.slice(0, 160) ?? 'the view')}`); });
    await page.waitForTimeout(150);
  };
  /** Screenshot the settled state. `of` shoots another page (an agent transcript, a dialog stand-in): no site checks on it. */
  async function shot(slug, { note = null, fullPage = !keyboard, of = null, quality = 70 } = {}) { // keyboard runs: the viewport, where focus is
    const target = of ?? page;
    if (!of) await settle();
    n += 1;
    const file = `${String(n).padStart(2, '0')}-${slug}${variant}.jpg`;
    await target.screenshot({ path: path.join(outDir, file), fullPage, type: 'jpeg', quality });
    if (of) { const row = { n, shot: file, slug, note, steps, asks, ms: Date.now() - started, route: null, h1: null, focus: null, a11y: [], aria: '' }; log.steps.push(row); shots.push(file); return row; }
    const aria = await page.locator('main').ariaSnapshot().catch(() => '');
    const focus = await page.evaluate(() => { const a = document.activeElement; return a ? `${a.tagName.toLowerCase()}${a.id ? `#${a.id}` : ''} ${(a.textContent ?? '').trim().slice(0, 60)}` : null; });
    const h1 = await page.locator('main h1').first().textContent().catch(() => null);
    const issues = await a11y(page);
    if (issues.length) log.a11y.push({ shot: file, issues });
    const row = { n, shot: file, slug, note, steps, asks, ms: Date.now() - started, route: new URL(page.url()).hash, h1: h1?.trim() ?? null, focus, a11y: issues, aria: aria.slice(0, 6000) };
    log.steps.push(row); shots.push(file);
    return row;
  }
  // ---------------------------------------------------------------- the person
  // An ask: the control (or a container) carries data-ask with a harm class; data-ask="none" marks a control that is not a question.
  const asksOf = async loc => loc.evaluate(e => { const v = e.dataset?.ask ?? e.closest('[data-ask]')?.dataset.ask; return !!v && v !== 'none'; }).catch(() => false);
  async function act(kind, loc, fnAct) {
    await loc.waitFor({ state: 'visible', timeout: 15000 });
    const isAsk = await asksOf(loc);
    const target = await loc.evaluate(e => (e.getAttribute('aria-label') || (e.matches('input,select,textarea') && e.labels?.[0]?.textContent) || e.textContent || e.name || e.id || e.tagName).replace(/\s+/g, ' ').trim().slice(0, 80)).catch(() => '?');
    steps += 1; if (isAsk) asks += 1;
    if (keyboard) await tabTo(loc);
    await fnAct();
    log.steps.push({ action: kind, ask: isAsk, target, steps, asks, ms: Date.now() - started });
  }
  async function tabTo(loc) {
    const target = await loc.elementHandle();
    for (let i = 0; i < 160; i++) {
      const where = await page.evaluate(t => { const a = document.activeElement; if (a === t) return 'on'; if (t.type === 'radio' && a?.type === 'radio' && a.name === t.name) return 'group'; return 'off'; }, target);
      if (where === 'on') return;
      if (where === 'group') { // inside a radio group Tab moves past it; arrows move within it (and select, as a person's arrows would)
        for (let j = 0; j < 12 && !(await page.evaluate(t => document.activeElement === t, target)); j++) await page.keyboard.press('ArrowDown');
        return;
      }
      await page.keyboard.press('Tab');
    }
    throw new Error(`keyboard: could not reach ${await loc.evaluate(e => e.outerHTML.slice(0, 120))} with Tab`);
  }
  const person = {
    click: (loc) => act('click', loc, () => keyboard ? page.keyboard.press(loc._isCheck ? 'Space' : 'Enter') : loc.click()),
    fill: (loc, value) => act('fill', loc, async () => { if (keyboard) { await page.keyboard.press('Control+A'); await page.keyboard.type(String(value)); } else await loc.fill(String(value)); await loc.dispatchEvent('change'); }),
    choose: (loc, value) => act('choose', loc, async () => {
      const tag = await loc.evaluate(e => e.tagName);
      if (tag === 'SELECT') { await loc.selectOption(value); }
      else if (keyboard) { if (!(await loc.isChecked())) await page.keyboard.press('Space'); } else await loc.check();
    }),
    upload: (loc, file) => act('upload', loc, async () => {
      if (!keyboard) return loc.setInputFiles(file);
      const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.keyboard.press('Space')]);
      await chooser.setFiles(file);
    }),
    key: (key) => { steps += 1; log.steps.push({ action: 'key', key, steps, asks, ms: Date.now() - started }); return page.keyboard.press(key); },
    /** An action outside the browser (pasting a line into a terminal, typing to a coding agent, answering its dialog). */
    external: (what, { ask = false } = {}) => { steps += 1; if (ask) asks += 1; log.steps.push({ action: 'external', target: what, ask, steps, asks, ms: Date.now() - started }); },
    /** Something the person had in place before the journey (reported, not counted). */
    precondition: (what) => { log.preconditions = [...(log.preconditions ?? []), what]; log.steps.push({ action: 'precondition', target: what, steps, asks, ms: Date.now() - started }); },
    get steps() { return steps; }, get asks() { return asks; }
  };
  const mark = (milestone, extra = {}) => { log.milestones[milestone] = { steps, asks, ms: Date.now() - started, ...extra }; };
  let failure = null;
  try {
    await page.goto(url);
    await page.waitForSelector('main h1');
    await fn({ page, person, shot, site, app, base, url, mark, dir, log, settle });
  } catch (error) {
    failure = error;
    log.failure = String(error.stack ?? error).slice(0, 2000);
    await page.screenshot({ path: path.join(outDir, `zz-failure${variant}.jpg`), fullPage: true, type: 'jpeg', quality: 70 }).catch(() => {});
  } finally {
    log.totalSteps = steps; log.totalAsks = asks; log.ms = Date.now() - started; log.shots = shots;
    log.budgets = opts.budgets ?? null;
    log.passed = !failure && !log.errors.length && !log.external.length;
    writeFileSync(path.join(outDir, `journey${variant}.json`), JSON.stringify(log, null, 2));
    record(log);
    await context.close(); await site.close(); await app.close();
    for (const [k, v] of Object.entries(savedEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    rmSync(dir, { recursive: true, force: true });
  }
  if (failure) throw failure;
  if (log.errors.length) throw new Error(`${name}: console or page errors: ${log.errors.join(' | ')}`);
  if (log.external.length) throw new Error(`${name}: external requests: ${log.external.join(' | ')}`);
  return log;
}

/** Merge one journey's summary into JOURNEYS.json (keyed by journey and variant). */
export function record(log) {
  let all = { label: 'development, scripted, no users', note: 'Written by app/site/test/journeys/*.mjs. Steps and asks are counted by the harness; times are scripted wall-clock on a shared machine, not human time.', journeys: {} };
  if (existsSync(SUMMARY)) { try { all = JSON.parse(readFileSync(SUMMARY, 'utf8')); } catch { /* rewrite */ } }
  all.journeys[`${log.journey}${log.variant === 'light-1280' ? '' : ` (${log.variant})`}`] = { persona: log.persona, variant: log.variant, passed: log.passed, steps: log.totalSteps, asks: log.totalAsks, ms: log.ms,
    milestones: log.milestones, budgets: log.budgets, preconditions: log.preconditions ?? [], errors: log.errors.length, refusals: log.refusals?.length ?? 0, external: log.external.length, a11yIssues: log.a11y.reduce((s, x) => s + x.issues.length, 0),
    a11yFirst: log.a11y[0] ?? null, shots: log.shots.length, failure: log.failure ? log.failure.split('\n')[0] : null, checks: log.checks ?? null };
  writeFileSync(SUMMARY, `${JSON.stringify(all, null, 2)}\n`);
}

/** A milestone within its budget; `since` counts from an earlier milestone (P1 counts from the end of the one-time setup paste). */
export function assertBudget(log, milestone, { steps, asks, since = null }) {
  const m = log.milestones[milestone], from = since ? log.milestones[since] : { steps: 0, asks: 0 };
  if (!m) throw new Error(`${log.journey}: milestone ${milestone} not reached`);
  if (!from) throw new Error(`${log.journey}: milestone ${since} not reached`);
  const s = m.steps - from.steps, a = m.asks - from.asks;
  if (steps !== undefined && s > steps) throw new Error(`${log.journey}: ${milestone} took ${s} actions${since ? ` after ${since}` : ''} (budget ${steps})`);
  if (asks !== undefined && a > asks) throw new Error(`${log.journey}: ${milestone} took ${a} asks${since ? ` after ${since}` : ''} (budget ${asks})`);
}
export const fixturePath = name => path.join(FIXTURES, name);
