// Controller trace and protocols P0-P4 (dossier 8 / B13-E13-1) with code stand-ins.
import { performance } from 'node:perf_hooks';
import { bed, split, worldOf, absState, canReach, flaggedKind, exploreFrom, posOf } from './lib.mjs';
import { makeEnv } from '../../../../beds/gridquest/engine.mjs';
import { regexAgentV2, templateAwareAgent } from '../../../../beds/gridquest/diagnostics.mjs';

const BAD = new Set(['blocked', 'failed', 'invalid']);

// ---------------------------------------------------------------- the controller run (once)
// Runs regexAgentV2 (honest code-only perception) in the real env with the default ledger and
// mirrors every action into a shadow engine so the true abstract state after each step is known
// (analyst-side only: the controller never sees it).
export function controllerTrace(task) {
  const W = worldOf(task), m = W.model, B = W.budget;
  const env = bed.createEnv(task);
  const shadow = makeEnv(W.w, W.budget);
  const trace = [];            // {a, outcome}
  const abs = [m.init];        // abstract state before step 1, after step 1, ...
  const wrapped = {
    reset() { const r = env.reset(); shadow.reset(); trace.length = 0; abs.length = 1; return r; },
    step(a) {
      const r = env.step(a);
      if (r.info.outcome !== 'ignored') {
        shadow.step(a);
        trace.push({ a, outcome: r.info.outcome });
        abs.push(absState(m, shadow._state()));
      }
      return r;
    },
    observe: () => env.observe(), actions: () => env.actions(),
  };
  const t0 = performance.now();
  const res = regexAgentV2(wrapped, B);
  const ms = performance.now() - t0;
  const verdict = bed.oracle(task, env.record());
  const won = trace.length > 0 && trace[trace.length - 1].outcome === 'won';
  // last recoverable prefix length (monotone: once the treasure is unreachable it stays so)
  let lastRec = -1;
  for (let i = trace.length; i >= 0; i--) if (canReach(m, abs[i])) { lastRec = i; break; }
  // first refuted expectation = first step whose outcome is blocked / failed / invalid
  const firstBad = trace.findIndex(x => BAD.has(x.outcome));
  return { W, m, B, trace, abs, ms, won, pass: verdict.pass, lastRec, firstBad: firstBad < 0 ? null : firstBad + 1, n: trace.length, actionsMatch: JSON.stringify(res.actions) === JSON.stringify(trace.map(x => x.a)) };
}

// ---------------------------------------------------------------- triggers (prefix lengths)
// A handoff happens after `prefix` controller actions have been executed (and charged).
export function triggers(C) {
  const { m, W, trace, abs, B, n } = C;
  const out = {};
  if (C.won && (C.firstBad === null)) { out.none = true; return out; }
  // default boundary: first refuted expectation; if the controller never trips one it hands
  // off when it halts (episode boundary) unless it already won.
  let hand = C.firstBad !== null ? C.firstBad : n;
  out.P3 = hand;
  // P4: permissive on one-way / coupled actions. Veto happens BEFORE the action executes.
  let vetoOracle = null, vetoCons = null;
  for (let i = 0; i < trace.length; i++) {
    const kind = flaggedKind(m, W.w, posOf(abs[i]), trace[i].a);
    if (!kind) continue;
    if (vetoCons === null) vetoCons = i;
    if (vetoOracle === null && !canReach(m, abs[i + 1])) vetoOracle = i;
    if (vetoCons !== null && vetoOracle !== null) break;
  }
  out.P4 = vetoOracle !== null ? Math.min(hand, vetoOracle) : hand;
  out.P4c = vetoCons !== null ? Math.min(hand, vetoCons) : hand;
  out.vetoOracle = vetoOracle; out.vetoCons = vetoCons;
  return out;
}

// ---------------------------------------------------------------- environment helpers
function tally(env) {
  const t = { failures: 0, executed: 0 };
  const w = {
    reset: () => env.reset(),
    step(a) {
      const r = env.step(a);
      if (r.info.outcome !== 'ignored') { t.executed++; if (BAD.has(r.info.outcome)) t.failures++; }
      return r;
    },
    observe: () => env.observe(), actions: () => env.actions(),
  };
  return { w, t };
}
// resume view for env-driven agents: reset() must not wipe the held state
const resumeView = w => ({ ...w, reset: () => ({ observation: w.observe() }) });

function prefixFailures(C, prefix) {
  let f = 0;
  for (let i = 0; i < prefix; i++) if (BAD.has(C.trace[i].outcome)) f++;
  return f;
}

// memory handed to the explorer resumer at a hold (ground truth of what the controller did)
function memAt(C, prefix, level) {
  const { m, W, trace, abs } = C;
  const visited = new Set([m.start]), toggled = new Map(), done = new Set();
  if (level === 'amn') { visited.clear(); visited.add(posOf(abs[prefix])); return { visited, toggled, done }; }
  for (let i = 1; i <= prefix; i++) visited.add(posOf(abs[i]));
  if (level === 'lossy') return { visited, toggled, done };
  for (let i = 0; i < prefix; i++) {
    const { a, outcome } = trace[i];
    if (outcome !== 'ok') continue;
    const p = posOf(abs[i]);
    let r;
    if ((r = /^toggle (\w+)$/.exec(a))) {
      const sw = m.room[p].switches.find(k => m.swNoun[k] === r[1]);
      if (sw !== undefined) toggled.set(sw, (toggled.get(sw) || 0) + 1);
    }
    if (m.room[p].decoys.some(x => a === `take ${x}`) || m.room[p].fakes.some(x => a === `examine ${x}`)) done.add(a);
  }
  return { visited, toggled, done };
}

// run the explorer resumer (ii) on `env` from abstract state s0
function runExplorer(C, env, s0, mem, limit) {
  const plan = exploreFrom(C.m, s0, mem, limit);
  for (const a of plan.actions) { if (env.step(a).done) break; }
}

function finish(C, task, env, t, prefix, ms) {
  const verdict = bed.oracle(task, env.record());
  return { pass: verdict.pass, steps: prefix + t.executed, failures: prefixFailures(C, prefix) + t.failures, ms: Math.round(ms * 100) / 100 };
}

// replay the controller's prefix into a fresh ledgered env
function heldEnv(C, task, prefix) {
  const env = bed.createEnv(task);
  env.reset();
  for (let i = 0; i < prefix; i++) env.step(C.trace[i].a);
  return env;
}

// ---------------------------------------------------------------- protocols
// P1 fresh env after the handoff (counterfactual; each env has its own full ledger)
// P2 same env, game reset, residual ledger
// P3 same env, resume at the held state (snapshot + mem)
// resumer: 'ii' explorer-from-state (oracle-side upper bound), 'i' templateAwareAgent (amnesiac)
export function runHandoff(C, task, proto, resumer, prefix, memLevel = 'full') {
  const { m, B, abs } = C;
  const t0 = performance.now();
  let env;
  if (proto === 'P1') {
    env = bed.createEnv(task); env.reset();
  } else {
    env = heldEnv(C, task, prefix);
    if (proto === 'P2') env.reset();
  }
  const tl = tally(env);
  const view = proto === 'P3' ? resumeView(tl.w) : tl.w;
  const remaining = proto === 'P1' ? B : B - prefix;
  const s0 = proto === 'P3' ? abs[prefix] : m.init;
  if (remaining > 0) {
    if (resumer === 'ii') {
      const mem = proto === 'P3' ? memAt(C, prefix, memLevel) : { visited: new Set([m.start]), toggled: new Map(), done: new Set() };
      runExplorer(C, view, s0, mem, remaining);
    } else {
      templateAwareAgent(view, remaining);
    }
  }
  return finish(C, task, env, tl.t, prefix, performance.now() - t0);
}

export { templateAwareAgent, regexAgentV2 };
