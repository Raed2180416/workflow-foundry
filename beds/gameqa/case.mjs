// Truth for one task: the world, the planted bugs and the known (planner-minimal) repro for
// each, plus replay helpers shared by the oracle, the reference solver and the tests.
// Host-only; recomputed from (seed, split, difficulty) and memoised.
import { rng } from '../lib/rng.mjs';
import { canonical } from '../lib/canonical.mjs';
import { Game } from './engine.mjs';
import { makeWorld } from './world.mjs';
import { Driver } from './planner.mjs';
import { BUG_CLASSES, TEMPLATES, TEMPLATE_BY_ID } from './bugs.mjs';

export const MAX_REPRO = 400;
export const MAX_REPORTS = 20;

const memo = new Map();

export function caseFor({ seed, split, difficulty }) {
  const key = `${seed}|${split}|${difficulty}`;
  if (memo.has(key)) return memo.get(key);
  const c = buildCase(seed, split, difficulty);
  memo.set(key, c);
  if (memo.size > 256) memo.delete(memo.keys().next().value);
  return c;
}

function buildCase(seed, split, difficulty) {
  const world = makeWorld(seed, split, difficulty);
  const K = world.cfg.K;
  for (let attempt = 0; attempt < 80; attempt++) {
    const r = rng('gameqa-bugs', seed, split, difficulty, attempt);
    const classes = r.sample(BUG_CLASSES, K);
    const bugs = classes.map((cls, i) => {
      const tpl = r.pick(TEMPLATES.filter(t => t.cls === cls));
      return { id: `bug${i + 1}`, template: tpl.id, cls, ...tpl.sample(world, r.fork(`p${i}`), difficulty) };
    });
    const repros = {};
    let ok = true;
    for (const b of bugs) {
      const actions = knownRepro(world, bugs, b);
      if (!actions) { ok = false; break; }
      repros[b.id] = actions;
    }
    if (ok) return { seed, split, difficulty, world, bugs, repros, attempt };
  }
  throw new Error(`gameqa: no feasible bug set for seed ${seed} (${split}, d${difficulty})`);
}

function knownRepro(world, bugs, b) {
  const D = new Driver(new Game(world, bugs));
  let res;
  try { res = TEMPLATE_BY_ID[b.template].repro(D, b); } catch (error) { if (process.env.GAMEQA_DEBUG) console.error(error); return null; }
  if (!D.fired(b.id)) return null;
  // Trim to the first step at which the detector fires.
  const first = D.g.fired.find(f => f.bug === b.id).step;
  const actions = D.actions.slice(0, first);
  const ev = evaluateRepro(world, bugs, b.cls, actions);
  if (ev.verdict !== 'match' || ev.bug !== b.id) return null;
  return res === false && !actions.length ? null : actions;
}

const sig = g => `${g.frame()}\u0001${canonical(g.observation().state)}\u0001${g.s.status}\u0001${g.s.crash ?? ''}`;

// Replays actions from a fresh start. Observation signatures are recorded from step index
// `sigFrom` on (earlier entries are null), which keeps the oracle cheap.
export function replay(world, bugs, actions, sigFrom = 0) {
  const g = new Game(world, bugs);
  const trace = [];
  for (let i = 0; i < actions.length; i++) {
    if (g.s.status !== 'playing') break;
    const r = g.step(actions[i]);
    if (!r.ok) return { invalid: `action ${i} (${JSON.stringify(actions[i])}): ${r.error.split('.')[0]}`, trace, fired: g.fired, game: g };
    trace.push(i >= sigFrom ? sig(g) : null);
  }
  return { trace, fired: g.fired, game: g };
}

// Replays one reported repro on the buggy build and on the control build.
export function evaluateRepro(world, bugs, cls, actions) {
  if (!Array.isArray(actions) || !actions.length) return { verdict: 'invalid', reason: 'empty repro' };
  if (actions.length > MAX_REPRO) return { verdict: 'invalid', reason: `repro longer than ${MAX_REPRO} actions` };
  const probe = replay(world, bugs, actions, Infinity);
  if (probe.invalid) return { verdict: 'invalid', reason: probe.invalid };
  const firedClasses = [...new Set(probe.fired.map(f => bugs.find(b => b.id === f.bug).cls))];
  const b = bugs.find(x => x.cls === cls);
  const f = b && probe.fired.find(x => x.bug === b.id);
  if (!f) return { verdict: 'false', reason: 'no defect of this class reproduces with these actions', firedClasses };
  const from = f.step - 1;
  // Lockstep replay of both builds; stop at the first observable difference at or after `from`.
  const gb = new Game(world, bugs), gc = new Game(world, []);
  let differs = false;
  for (let i = 0; i < actions.length && !differs; i++) {
    const pb = gb.s.status === 'playing', pc = gc.s.status === 'playing';
    if (!pb && !pc) break;
    if (pb) gb.step(actions[i]);
    if (pc) gc.step(actions[i]);
    if (i >= from && (pb !== pc || sig(gb) !== sig(gc))) differs = true;
  }
  if (!differs) return { verdict: 'false', reason: 'control build behaves identically', firedClasses };
  return { verdict: 'match', bug: b.id, firedClasses };
}
