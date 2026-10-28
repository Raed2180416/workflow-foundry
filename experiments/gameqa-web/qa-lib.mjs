// Shared, game-agnostic QA machinery for the gameqa-web arms: compact observation rendering for model prompts, the
// generic detectors (page errors, frozen-without-affordance), model-written expression checks, deterministic replay
// predicates and delta-debugging minimization (ddmin, Zeller & Hildebrandt 2002). None of it reads the hidden truth.
import { compile, mentions } from './expr.mjs';

// ------------------------------------------------------------------------------------------------ rendering
const short = s => (s.length > 70 ? `${s.slice(0, 67)}...` : s);
export function renderObs(o, { token, click, index, errors } = {}) {
  const s = o.state, h = o.hud ?? {};
  const en = (s.enemies ?? []).map(e => `${e.id}(${e.x},${e.y})`).join(' ');
  const ui = (o.ui ?? []).filter(u => u.visible).map(u => u.kind === 'button' ? `${u.id}${u.top === false ? '(top=false)' : ''}`
    : u.kind === 'toast' ? `toast"${short(u.text)}"` : u.kind === 'dialog' ? `[${u.id}]` : `${u.id}"${short(u.text)}"`).join(' ');
  return `${index !== undefined ? `#${index} ` : ''}${token ? `${token}${click && click !== 'hit' ? `{click:${click}}` : ''} -> ` : ''}` +
    `P(${s.player.x},${s.player.y}) ${s.mode}${s.dialog ? `/${s.dialog}` : ''} score=${s.score} lives=${s.lives} keys=${s.keys} coins=${s.coins} ` +
    `time=${s.timeLeft} dashCd=${s.dashCooldown} inv=${s.invulnerable} gate=${s.gateOpen ? 'open' : 'shut'}` +
    `${s.bonus !== null && s.bonus !== undefined ? ` bonus=${s.bonus}` : ''} ev=[${(s.events ?? []).join(',')}] en=${en} | HUD ${Object.values(h).join(' | ')}` +
    `${ui ? ` | UI ${ui}` : ''}${errors?.length ? ` | ERRORS ${errors.join('; ')}` : ''}`;
}
export function renderMap(o) {
  const rows = o.state.tiles.map(r => r.split(''));
  for (const e of o.state.enemies ?? []) rows[e.y][e.x] = 'e';
  rows[o.state.player.y][o.state.player.x] = '@';
  return rows.map((r, y) => `${String(y).padStart(2)} ${r.join('')}`).join('\n');
}
/** A run (driver Session.run result with detail 'each' or 'state') as prompt text, eliding the middle of long runs. */
export function renderRun(run, { maxSteps = 120, start = null } = {}) {
  const lines = [];
  if (start) lines.push(`start: ${renderObs(start)}`);
  let i = 0;
  const prims = [];
  for (const st of run.steps) {
    if (st.macro) { lines.push(`(${st.macro} expands to ${st.expanded === null ? 'nothing: unreachable' : `${st.expanded} steps`})`); continue; }
    prims.push(lines.length);
    lines.push(renderObs(st.obs, { token: st.token, click: st.click, index: i++, errors: st.errors }));
  }
  if (prims.length > maxSteps) {
    const keepHead = Math.floor(maxSteps / 3), keepTail = maxSteps - keepHead;
    const drop = new Set(prims.slice(keepHead, prims.length - keepTail));
    const out = [];
    let noted = false;
    lines.forEach((l, j) => { if (drop.has(j)) { if (!noted) { out.push(`... (${drop.size} steps not shown) ...`); noted = true; } } else out.push(l); });
    return out.join('\n');
  }
  return lines.join('\n');
}

// ------------------------------------------------------------------------------------------------ checks
// Generic detectors are part of the frontier-written template (game-agnostic): they read only page errors, the UI
// layer's visible controls and whether the observation changes.
export const FROZEN_WINDOW = 30;
const snapshot = o => JSON.stringify({ ...o.state, frame: undefined, events: undefined });
const affordance = o => (o.ui ? o.ui.some(u => u.visible && (u.kind === 'button' || u.kind === 'dialog')) : Boolean(o.state.dialog));

/** Compile model-written checks; returns { checks, rejected } (rejected: parse errors, for a repair round). */
export function compileChecks(specs) {
  const checks = [], rejected = [];
  for (const c of specs ?? []) {
    try {
      const expect = compile(c.expect), when = c.when ? compile(c.when) : null;
      checks.push({ ...c, _expect: expect, _when: when, needsUi: mentions(`${c.when ?? ''} ${c.expect}`, 'ui') });
    } catch (e) { rejected.push({ id: c.id, error: e.message }); }
  }
  return { checks, rejected };
}

/** The triage signature context of a violation: the screen the game is on (its open dialog, else its mode). */
export const contextOf = obs => String(obs?.state?.dialog ?? obs?.state?.mode ?? '?');

/**
 * Evaluate the generic detectors and the compiled checks over a run. Returns the first violation per detector/check and
 * context (contextOf: the dialog or mode at the violating tick), so one check that catches different faults on
 * different screens yields one candidate per screen (R08 triage: dedup by signature, not by check):
 * [{ checkId, ctx, step (primitive index), tokenIndex (index of the token that produced that step), detail }], plus
 * per-check evaluation errors.
 */
export function scanRun(run, start, checks, { generic = true, frozenWindow = FROZEN_WINDOW } = {}) {
  const found = new Map(), errors = new Map();
  let prev = start, prim = -1, frozenSince = null, lastSnap = snapshot(start), ctx = contextOf(start);
  const hit = (checkId, detail) => { const k = `${checkId}|${ctx}`; if (!found.has(k)) found.set(k, { checkId, ctx, step: prim, detail }); };
  for (const st of run.steps) {
    if (st.macro) continue;
    prim++;
    const cur = { ...st.obs, token: st.token, click: st.click ?? null, errors: st.errors ?? [] };
    ctx = contextOf(cur);
    if (generic) {
      if (cur.errors.length) hit('generic:page-error', cur.errors[0]);
      const snap = snapshot(cur);
      if (snap === lastSnap && !affordance(cur)) { frozenSince ??= prim; if (prim - frozenSince + 1 >= frozenWindow) hit('generic:frozen', `no change and no visible control for ${frozenWindow} ticks`); }
      else frozenSince = null;
      lastSnap = snap;
    }
    for (const c of checks) {
      if (found.has(`${c.id}|${ctx}`) || errors.has(c.id) || (c.needsUi && !cur.ui)) continue;
      try {
        const env = { cur, prev, step: prim };
        if (c._when && !c._when(env)) continue;
        if (!c._expect(env)) hit(c.id, null);
      } catch (e) { errors.set(c.id, e.message); }
    }
    prev = cur;
  }
  // tokenIndex: map each primitive step back to the input token that produced it.
  const owner = tokenOwners(run);
  for (const v of found.values()) v.tokenIndex = owner[v.step];
  return { violations: [...found.values()], errors: [...errors].map(([id, error]) => ({ id, error })) };
}

/** For each primitive step, the index of the input token that produced it (a macro owns all of its expanded steps). */
export function tokenOwners(run) {
  const owners = [];
  let tok = -1, macroLeft = 0;
  for (const st of run.steps) {
    if (st.macro) { tok++; macroLeft = st.expanded ?? 0; continue; }
    if (macroLeft > 0) { macroLeft--; owners.push(tok); continue; }
    tok++; owners.push(tok);
  }
  return owners;
}

// ------------------------------------------------------------------------------------------------ replay + ddmin
/**
 * A deterministic predicate "check `checkId` is violated (on screen `ctx`, when given) when `tokens` are replayed from a
 * fresh game with `seed`". Keeping the screen fixed keeps ddmin on the same symptom, as reducers keep a failure signature.
 * For the frozen detector the replay is followed by FROZEN_WINDOW waits (the watch window, not part of the repro).
 */
export function violationPredicate(session, seed, checkId, checks, { counter, ctx } = {}) {
  const needUi = checkId === 'generic:frozen' || checks.find(c => c.id === checkId)?.needsUi;
  const only = checks.filter(c => c.id === checkId);
  const cache = new Map();
  return async tokens => {
    const key = tokens.join(' ');
    if (cache.has(key)) return cache.get(key);
    if (!tokens.length) { cache.set(key, false); return false; }
    const run = [...tokens, ...(checkId === 'generic:frozen' ? Array(FROZEN_WINDOW).fill('wait') : [])];
    if (run.length > 400) { cache.set(key, false); return false; }
    const start = await session.reset(seed);
    const r = await session.run(run, { detail: needUi ? 'each' : 'state' });
    if (counter) counter.replays++;
    const v = scanRun(r, start, only, { generic: checkId.startsWith('generic:') }).violations.some(x => x.checkId === checkId && (ctx === undefined || x.ctx === ctx));
    cache.set(key, v);
    return v;
  };
}

/** ddmin over a token list; returns { tokens, tests, oneMinimal } where oneMinimal is guaranteed unless the test cap hit. */
export async function ddmin(tokens, test, { maxTests = 400 } = {}) {
  let cur = [...tokens], n = 2, tests = 0;
  const t = async c => { tests++; return test(c); };
  while (cur.length >= 2 && tests < maxTests) {
    const size = Math.ceil(cur.length / n), chunks = [];
    for (let i = 0; i < cur.length; i += size) chunks.push(cur.slice(i, i + size));
    let reduced = false;
    for (const ch of chunks) {                       // try each subset
      if (tests >= maxTests) break;
      if (ch.length < cur.length && await t(ch)) { cur = ch; n = 2; reduced = true; break; }
    }
    if (!reduced) for (let i = 0; i < chunks.length; i++) {   // try each complement
      if (tests >= maxTests) break;
      const comp = chunks.filter((_, j) => j !== i).flat();
      if (comp.length && comp.length < cur.length && await t(comp)) { cur = comp; n = Math.max(n - 1, 2); reduced = true; break; }
    }
    if (!reduced) { if (n >= cur.length) break; n = Math.min(cur.length, n * 2); }
  }
  // Final 1-minimality pass (single-token removals), so the guarantee holds even after a capped run of the loop above.
  let changed = true;
  while (changed && tests < maxTests) {
    changed = false;
    for (let i = 0; i < cur.length && cur.length > 1; i++) {
      if (tests >= maxTests) break;
      const w = cur.filter((_, j) => j !== i);
      if (await t(w)) { cur = w; changed = true; break; }
    }
  }
  return { tokens: cur, tests, oneMinimal: tests < maxTests };
}

// ------------------------------------------------------------------------------------------------ coverage
export function coverageOf(runs) {
  const tiles = new Set(), events = new Set(), modes = new Set(), dialogs = new Set();
  for (const r of runs) for (const st of r.steps) if (st.obs) {
    const s = st.obs.state; tiles.add(`${s.player.x},${s.player.y}`); s.events.forEach(e => events.add(e)); modes.add(s.mode); if (s.dialog) dialogs.add(s.dialog);
  }
  return { tiles: tiles.size, events: [...events].sort(), modes: [...modes].sort(), dialogs: [...dialogs].sort() };
}
