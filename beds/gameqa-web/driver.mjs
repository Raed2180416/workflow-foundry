// Playwright driver for the gameqa-web bed: one Chromium page per build, lockstep ticks, a fixed action vocabulary.
// Determinism class D0: the game runs only when the driver ticks it (window.__LOCKSTEP), randomness is seeded, and
// nothing reads the wall clock, so a (build, seed, steps) triple always produces the same observations.
//
// Two entry points:
//   openSession(browser, { flags })            the tester's session: reset/run/observe. It never returns probe data.
//   openSession(browser, { flags, oracle:true }) the oracle's session: run() also returns the injected-fault probes
//                                               that fired, with the primitive step index. Only beds/gameqa-web/oracle.mjs uses it.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const GAME_URL = pathToFileURL(path.join(here, 'game', 'index.html')).href;
export const CHROMIUM = '/opt/pw-browsers/chromium';

// The action vocabulary (public; also documented in spec/DESIGN.md).
export const KEY_TOKENS = Object.freeze({
  up: { key: 'ArrowUp' }, down: { key: 'ArrowDown' }, left: { key: 'ArrowLeft' }, right: { key: 'ArrowRight' },
  'dash-up': { key: 'ArrowUp', shift: true }, 'dash-down': { key: 'ArrowDown', shift: true },
  'dash-left': { key: 'ArrowLeft', shift: true }, 'dash-right': { key: 'ArrowRight', shift: true },
  use: { key: ' ' }, pause: { key: 'p' }, esc: { key: 'Escape' }, enter: { key: 'Enter' },
});
export const BUTTON_IDS = Object.freeze(['btn-resume', 'btn-restart', 'btn-next', 'btn-retry', 'btn-again']);
export const MAX_STEPS = 400;

// Grammar: a primitive token, `wait`, `click:<button id>`, `goto:x,y` (a macro the driver expands into walk steps by
// breadth-first search on the current tile map, ignoring enemies), or a same-tick combo `a+b` / `a+b+c` of key tokens.
export function tokenError(tok) {
  if (typeof tok !== 'string' || !tok || tok.length > 40) return 'not a short string';
  if (tok === 'wait' || KEY_TOKENS[tok]) return null;
  if (tok.startsWith('click:')) return BUTTON_IDS.includes(tok.slice(6)) ? null : `unknown button ${tok.slice(6)}`;
  if (tok.startsWith('goto:')) return /^goto:\d{1,2},\d{1,2}$/.test(tok) ? null : 'goto needs x,y';
  if (tok.includes('+')) {
    const parts = tok.split('+');
    if (parts.length > 3) return 'at most 3 keys per combo';
    return parts.every(p => KEY_TOKENS[p]) ? null : 'combo parts must be key tokens';
  }
  return `unknown token ${tok}`;
}
export const validSteps = steps => Array.isArray(steps) && steps.length >= 1 && steps.length <= MAX_STEPS && steps.every(t => tokenError(t) === null);

// In-page helper, installed before the game script runs. It only uses the game's public API, except runOracle(), which
// also reads the probes; the tester-facing Session never calls it.
function pageHelper({ flags, keyTokens }) {
  window.__BUILD_FLAGS = flags;
  window.__LOCKSTEP = true;
  const errors = [];
  window.addEventListener('error', e => errors.push(String(e.message || e.error || 'error').slice(0, 200)));
  window.addEventListener('unhandledrejection', e => errors.push(`unhandled rejection: ${String(e.reason).slice(0, 200)}`));
  const origError = console.error.bind(console);
  console.error = (...a) => { errors.push(a.map(String).join(' ').slice(0, 200)); origError(...a); };
  const dirs = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  function bfs(state, tx, ty) {
    const { tiles, player, gateOpen, keys } = state, H = tiles.length, W = tiles[0].length;
    const ok = (x, y) => {
      if (x < 0 || y < 0 || x >= W || y >= H) return false;
      const t = tiles[y][x];
      if (x === tx && y === ty) return t !== '#' && !(t === '=' && !gateOpen) && !(t === 'D' && keys <= 0);
      return !(t === '#' || t === '^' || t === 'E' || (t === '=' && !gateOpen) || (t === 'D' && keys <= 0));
    };
    if (!ok(tx, ty)) return null;
    const key = (x, y) => y * W + x, prev = new Map([[key(player.x, player.y), null]]), q = [[player.x, player.y]];
    while (q.length) {
      const [x, y] = q.shift();
      if (x === tx && y === ty) {
        const path = []; let k = key(x, y);
        while (prev.get(k)) { const [pk, d] = prev.get(k); path.unshift(d); k = pk; }
        return path;
      }
      for (const [d, [dx, dy]] of Object.entries(dirs)) {
        const nx = x + dx, ny = y + dy, nk = key(nx, ny);
        if (!prev.has(nk) && ok(nx, ny)) { prev.set(nk, [key(x, y), d]); q.push([nx, ny]); }
      }
    }
    return null;
  }
  function press(tok) {
    for (const part of tok.split('+')) {
      const k = keyTokens[part];
      document.dispatchEvent(new KeyboardEvent('keydown', { key: k.key, shiftKey: Boolean(k.shift), bubbles: true }));
    }
  }
  function click(id) {
    const el = document.getElementById(id);
    if (!el) return 'missing';
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return 'not-visible';
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (!top) return 'nothing-at-point';
    top.click();
    return top === el || el.contains(top) ? 'hit' : `hit-other:${top.id || top.className || top.tagName}`;
  }
  function observe(detail) {
    const g = window.__game;
    if (detail === 'none') return null;
    const o = { state: g.publicState(), hud: g.hud() };
    if (detail === 'each' || detail === 'full') o.ui = g.ui();
    return o;
  }
  function run(tokens, detail, withProbes) {
    const g = window.__game, out = [], q = [...tokens];
    let primitives = 0, faultCount = withProbes ? g.__faults().length : 0;
    const fired = [];
    while (q.length) {
      const tok = q.shift();
      if (tok.startsWith('goto:')) {
        const [tx, ty] = tok.slice(5).split(',').map(Number);
        const path = bfs(g.publicState(), tx, ty);
        out.push({ macro: tok, expanded: path ? path.length : null });
        if (path && path.length) q.unshift(...path);
        continue;
      }
      if (primitives >= 4000) { out.push({ macro: tok, error: 'step cap' }); break; }
      const errBefore = errors.length;
      let clickResult = null;
      if (tok === 'wait') { /* no input */ }
      else if (tok.startsWith('click:')) clickResult = click(tok.slice(6));
      else press(tok);
      g.tick();
      primitives += 1;
      const rec = { token: tok, obs: observe(detail) };
      if (clickResult) rec.click = clickResult;
      if (errors.length > errBefore) rec.errors = errors.slice(errBefore);
      if (withProbes) {
        const f = g.__faults();
        for (const x of f.slice(faultCount)) fired.push({ id: x.id, step: primitives - 1, ...(x.sig ? { sig: x.sig } : {}) });
        faultCount = f.length;
      }
      out.push(rec);
    }
    return { steps: out, final: observe('full'), primitives, ...(withProbes ? { fired } : {}) };
  }
  window.__qaDriver = Object.freeze({
    reset(seed) { errors.length = 0; window.__game.reset(seed); return observe('full'); },
    run: (tokens, detail) => run(tokens, detail, false),
    observe: () => observe('full'),
    runOracle: (tokens, detail = 'none') => run(tokens, detail, true),
  });
}

export async function launchBrowser() {
  const { chromium } = await import('playwright');
  const opts = { headless: true, args: ['--no-sandbox'] };
  const exe = process.env.FOUNDRY_CHROMIUM ?? CHROMIUM;
  if (existsSync(exe)) opts.executablePath = exe;
  return chromium.launch(opts);
}

class Session {
  #page; #oracle;
  constructor(page, oracle) { this.#page = page; this.#oracle = oracle; this.ticks = 0; this.resets = 0; }
  async reset(seed) {
    if (!Number.isInteger(seed) || seed < 1 || seed > 1_000_000) throw new Error('seed must be an integer 1..1000000');
    this.resets += 1;
    return this.#page.evaluate(s => window.__qaDriver.reset(s), seed);
  }
  // Runs the tokens (one tick per primitive; macros expand) and returns per-step observations.
  // detail: 'each' (state, HUD and UI per step), 'state' (state and HUD per step), 'none' (final observation only).
  async run(steps, { detail = 'each' } = {}) {
    if (!Array.isArray(steps) || !steps.length || steps.length > MAX_STEPS) throw new Error(`invalid steps: a run holds 1..${MAX_STEPS} tokens`);
    const bad = steps.map(tokenError).find(Boolean);
    if (bad) throw new Error(`invalid steps: ${bad}`);
    const r = await this.#page.evaluate(([t, d]) => window.__qaDriver.run(t, d), [steps, detail]);
    this.ticks += r.primitives;
    return r;
  }
  async observe() { return this.#page.evaluate(() => window.__qaDriver.observe()); }
  // Oracle-only: replay from a fresh reset and return the probes that fired.
  async replayWithProbes(seed, steps, { detail = 'none' } = {}) {
    if (!this.#oracle) throw new Error('replayWithProbes is oracle-only');
    await this.reset(seed);
    const r = await this.#page.evaluate(([t, d]) => window.__qaDriver.runOracle(t, d), [steps, detail]);
    this.ticks += r.primitives;
    return r;
  }
  async close() { await this.#page.context().close(); }
}

export async function openSession(browser, { flags = [], oracle = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.addInitScript(pageHelper, { flags: [...flags], keyTokens: KEY_TOKENS });
  await page.goto(GAME_URL);
  await page.waitForFunction(() => Boolean(window.__game && window.__qaDriver));
  return new Session(page, oracle);
}

// The executed primitive sequence of a run (macros replaced by their expansion), for repros and minimization.
export const primitivesOf = run => run.steps.filter(s => s.token).map(s => s.token);
