// Q4 expectation_met: state-only solvers and the second replay (JUDGE-PROGRAM.md §2.7 steps 1-2, §10 "second-code-path
// label agreement >= 99.5% on 200 records").
//
//   solveQ4Gridquest(state)  reads {action, expected_effect, observation} only: the header, the result line, the
//                            carried items and the expected sentence's own words. It returns {label, basis} or
//                            {label: null, reason} (no rule decides: the observation does not settle the expectation).
//   solveQ4Gameqa(state)     the same for {action, expected_effect, observation} of the gameqa tile game.
//   replayGridquest(...)     the second code path: replays the plan in the ABSTRACT model of the bed (solver.mjs
//                            compile/simulate over state bits), not in the engine that labelled the row.
//   audit, collisions        the decidability audit (state-only accuracy and coverage; masked-state collisions)
//
// A state-only solver is allowed the knowledge the port declares (none) and the bed's own phrasing; it never reads a
// world, a seed, a template id or any meta.
import { parseObservation, parseExpectation, parseGameExpectation, parseCompact, descriptionSentences } from '../judges/interactive.mjs';
import { skeletonText } from '../lib/hash.mjs';
import { stringLeaves } from '../lib/leakage.mjs';

const decided = (label, basis) => ({ label, basis });
const undecided = reason => ({ label: null, reason });
const norm = s => String(s).trim().toLowerCase();

// ---- gridquest -----------------------------------------------------------------------------------------------
const MOVED = /^You go (north|east|south|west)\./;
const TOGGLE_PARTS = [
  [/a bridge swings down across the chasm between ([^.]+?) and ([^.]+?)\./g, 'lowers', 'bridge'],
  [/the bridge between ([^.]+?) and ([^.]+?) hauls itself back up/g, 'raises', 'bridge'],
  [/the portcullis between ([^.]+?) and ([^.]+?) rises\./g, 'raises', 'portcullis'],
  [/the portcullis between ([^.]+?) and ([^.]+?) drops shut\./g, 'drops', 'portcullis'],
];
// the mechanism effects a toggle message reports; "here" is the room the player stands in
export function toggleEffectsOf(lastAction, roomName) {
  const out = [];
  for (const [re, change, type] of TOGGLE_PARTS) for (const m of lastAction.matchAll(re)) {
    const fix = s => (s === 'here' ? norm(roomName) : norm(s));
    out.push(`${change}|${type}|${fix(m[1])}|${fix(m[2])}`);
  }
  return out.sort();
}
const hasWord = (text, noun) => new RegExp(`\\b${noun.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(text);

export function solveQ4Gridquest(state) {
  let exp, o;
  try { exp = parseExpectation(state.expected_effect); o = parseObservation(state.observation); } catch (e) { return undecided('malformed-state'); }
  if (!exp) return undecided('unparsed-expectation');
  const la = o.lastAction;
  switch (exp.kind) {
    case 'enter': {
      if (!MOVED.test(la)) return decided('drifted', 'the move did not happen');
      if (norm(o.roomName) !== norm(exp.room)) return decided('drifted', 'another room');
      if (exp.feature && !hasWord(o.description, exp.feature)) return decided('drifted', 'the expected fixture is not in the room');
      return decided('as_expected', 'the expected room');
    }
    case 'take': return la === `You pick up the ${exp.item}.` ? decided('as_expected', 'picked up') : decided('drifted', 'not picked up');
    case 'unlock': return new RegExp(`^The \\w+ key turns with a heavy clunk\\. The ${exp.direction} door is unlocked\\.$`).test(la) ? decided('as_expected', 'unlocked') : decided('drifted', 'not unlocked');
    case 'find': return new RegExp(`^You search the ${exp.container} carefully and find an? ${exp.item} tucked inside!$`).test(la) ? decided('as_expected', 'found') : decided('drifted', 'not found');
    case 'treasure': return /^You lift .+ from its resting place\. The treasure is yours!$/.test(la) ? decided('as_expected', 'taken') : decided('drifted', 'not taken');
    case 'toggle': {
      const got = toggleEffectsOf(la, o.roomName);
      if (!got.length) return undecided('the observation reports no effect of the switch');
      const want = exp.effects.map(f => `${f.change}|${f.type}|${norm(f.a)}|${norm(f.b)}`).sort();
      return decided(JSON.stringify(got) === JSON.stringify(want) ? 'as_expected' : 'drifted', 'effects of the switch');
    }
    default: return undecided('unknown-expectation');
  }
}

// ---- gameqa ---------------------------------------------------------------------------------------------------
export function solveQ4Gameqa(state) {
  let exp, got;
  try { exp = parseGameExpectation(state.expected_effect); got = parseCompact(state.observation); } catch (e) { return undecided('malformed-state'); }
  if (!exp) return undecided('unparsed-expectation');
  const same = exp.events === got.events && exp.hud === got.hud && exp.x === got.x && exp.y === got.y && exp.status === got.status;
  return decided(same ? 'as_expected' : 'drifted', 'events, status line, position and status compared');
}

export function solveQ4(state) {
  if (/^by the rules the build reports /.test(state.expected_effect ?? '')) return solveQ4Gameqa(state);
  return solveQ4Gridquest(state);
}

// ---- the audit (§2.7) ---------------------------------------------------------------------------------------
// rows: [{ id, state, label, masks? }] -> { rows, decided, agree, accuracy, coverage, wrong, undecided }
export function audit(rows, solver = solveQ4) {
  let decidedN = 0, agree = 0; const wrong = [], und = {};
  for (const r of rows) {
    const out = solver(r.state);
    if (out.label === null) { und[out.reason] = (und[out.reason] ?? 0) + 1; continue; }
    decidedN++;
    if (out.label === r.label) agree++; else wrong.push({ id: r.id, solved: out.label, truth: r.label, basis: out.basis });
  }
  return { rows: rows.length, decided: decidedN, agree, accuracy: decidedN ? agree / decidedN : null, coverage: rows.length ? decidedN / rows.length : null, wrong, undecided: und };
}

// Masked-state collisions (§2.7 step 2): group rows by the masked state; the share of groups with more than one label.
// Names are masked with their ROLE kept (the header room, the expected room, any other room): the label of a Q4 row
// is a relation between the two, so masking them to one token would merge opposite labels by construction.
export function relationalText(state, names = []) {
  let exp = null, head = null;
  try { exp = parseExpectation(state.expected_effect)?.room ?? null; head = parseObservation(state.observation).roomName; } catch { /* a gameqa state */ }
  const swap = (text) => {
    let t = String(text);
    const named = [...new Set(names)].sort((a, b) => b.length - a.length);
    for (const n of named) {
      const tok = exp && norm(n) === norm(exp) && head && norm(n) === norm(head) ? '<same>' : exp && norm(n) === norm(exp) ? '<expected>' : head && norm(n) === norm(head) ? '<header>' : '<other>';
      t = t.replace(new RegExp(`(?<![\\p{L}\\p{N}_])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}_])`, 'giu'), tok);
    }
    return t;
  };
  return stringLeaves(state).map(l => skeletonText(swap(l.text).replace(/<(same|expected|header|other)>/g, m => ` ${m.slice(1, -1).toUpperCase()}ROLE `), {})).join(' | ');
}
export function collisions(rows, { exact = false } = {}) {
  const groups = new Map();
  for (const r of rows) {
    const sk = exact ? JSON.stringify(r.state) : relationalText(r.state, r.masks?.names ?? []);
    const g = groups.get(sk) ?? { labels: new Set(), n: 0, example: r.id };
    g.labels.add(r.label); g.n++; groups.set(sk, g);
  }
  const mixed = [...groups.values()].filter(g => g.labels.size > 1);
  return { groups: groups.size, mixed: mixed.length, share: groups.size ? mixed.length / groups.size : 0, examples: mixed.slice(0, 5).map(g => g.example) };
}

// ---- the second replay (gridquest) ---------------------------------------------------------------------------
// Replays the plan's actions in the abstract model of the bed (solver.mjs: state bits over position, keys, hides, doors
// and mechanisms; only state-changing canonical actions move it) and evaluates the row's truth spec on the bits.
const bit = (s, o, i) => (s >>> (o + i)) & 1;
export function abstractHolds(m, W, truth, s0, s1, won) {
  switch (truth.kind) {
    case 'enter': return (s1 & 63) === truth.cell;
    case 'take': { for (let k = 0; k < m.K; k++) if (m.keyName[k] === truth.item && bit(s1, m.oK, k) && !bit(s0, m.oK, k)) return true; return false; }
    case 'unlock': return truth.door >= 0 && bit(s1, m.oD, truth.door) === 1 && bit(s0, m.oD, truth.door) === 0;
    case 'toggle': {
      const flipped = []; for (let i = 0; i < m.M; i++) if (bit(s1, m.oM, i) !== bit(s0, m.oM, i)) flipped.push({ mech: i, open: bit(s1, m.oM, i) === 1 });
      return flipped.length === truth.flips.length && truth.flips.every(f => flipped.some(g => g.mech === f.mech && g.open === f.open));
    }
    case 'find': return truth.hide >= 0 && bit(s1, m.oH, truth.hide) === 1 && bit(s0, m.oH, truth.hide) === 0 && W.w.keys[W.w.hides[truth.hide].key].color === truth.color;
    case 'treasure': return won === true;
    default: throw new Error(`unknown truth kind ${truth.kind}`);
  }
}
// episode: the actions up to and including the row's step; returns the label the abstract model gives
export function replayGridquest(mod, task, episode, truth) {
  const W = mod.index._internal.world(task), m = W.model, s = mod.solver;
  const before = episode.slice(0, -1);
  const r0 = s.simulate(m, before), r1 = s.simulate(m, episode);
  const ok = abstractHolds(m, W, truth, r0.state, r1.state, r1.won && !r0.won);
  return ok ? 'as_expected' : 'drifted';
}
