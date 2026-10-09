// Shared helpers for the gridquest handoff-headroom analysis (row 32, B13-E1).
// Analyst-side diagnostic: imports oracle-side bed modules (solver.mjs, engine.mjs). It is
// never a system component and never shown to a solver. No model calls.
import * as bed from '../../../../beds/gridquest/index.mjs';
import { DIRS } from '../../../../beds/gridquest/text.mjs';
import { passable, successors, K_OUT, K_DOOR, K_MECH } from '../../../../beds/gridquest/solver.mjs';

export { bed };
export const split = 'dev';
export const worldOf = task => bed._internal.world(task);

// ---------------------------------------------------------------- abstract state
const bit = (s, o, i) => (s >>> (o + i)) & 1;
export const posOf = s => s & 63;

// Engine state ({pos, inv, revealed, unlocked, mech}) -> abstract bitmask used by solver.mjs.
export function absState(m, st) {
  let s = st.pos;
  for (const id of st.inv) if (id.startsWith('key:')) s |= 1 << (m.oK + +id.slice(4));
  for (const h of st.revealed) s |= 1 << (m.oH + h);
  for (const d of st.unlocked) s |= 1 << (m.oD + d);
  st.mech.forEach((open, i) => { if (open) s |= 1 << (m.oM + i); });
  return s;
}

// Can the treasure still be reached from abstract state s (no budget consideration)? Memoised
// per model. Reachability is monotone along any play, so "last recoverable" is well defined.
const reachMemo = new WeakMap();
export function canReach(m, s) {
  let memo = reachMemo.get(m);
  if (!memo) reachMemo.set(m, memo = new Map());
  if (memo.has(s)) return memo.get(s);
  const seen = new Set([s]);
  const frontier = [s], buf = [];
  let found = false;
  for (let i = 0; i < frontier.length && !found; i++) {
    const c = frontier[i];
    if (posOf(c) === m.T) { found = true; break; }
    for (const [, t] of successors(m, c, buf)) if (!seen.has(t)) { seen.add(t); frontier.push(t); }
  }
  memo.set(s, found);
  return found;
}

// Irreversible-action classification used by the P4 permissive. `a` is a controller action
// string, `p` the room before it. one-way = `go` through an outgoing one-way edge;
// coupled = `toggle` of a switch that also moves a coupled portcullis.
export function flaggedKind(m, w, p, a) {
  let r;
  if ((r = /^go (north|east|south|west)$/.exec(a))) {
    const x = m.nbr[p][DIRS.indexOf(r[1])];
    return x.kind === K_OUT ? 'oneway' : null;
  }
  if ((r = /^toggle (\w+)$/.exec(a))) {
    const sw = m.room[p].switches.find(i => m.swNoun[i] === r[1]);
    if (sw === undefined) return null;
    return w.switches[sw].targets.some(mi => w.mechs[mi].coupled) ? 'coupled' : null;
  }
  return null;
}

// ---------------------------------------------------------------- explorer from a state
// Re-implementation of solver.mjs `explore` + `navigate` (identical decision logic) that can
// start from an arbitrary abstract state with an explicit memory `mem` = {visited:Set<room>,
// toggled:Map<switch,count>, done:Set<string>}. verify.mjs checks that, from m.init with an
// empty memory, it reproduces solver.explore action-for-action on every seed used here.
export function exploreFrom(m, s0, mem, maxSteps) {
  let s = s0;
  const actions = [];
  const visited = new Set(mem.visited), toggled = new Map(mem.toggled), done = new Set(mem.done);
  visited.add(posOf(s));
  const buf = [];
  const act = (a, t) => { actions.push(a); s = t; visited.add(posOf(s)); };
  while (actions.length < maxSteps) {
    const p = posOf(s), r = m.room[p];
    if (p === m.T) { actions.push('take treasure'); return { won: true, steps: actions.length, actions }; }
    const extra = [...r.decoys.map(x => `take ${x}`), ...r.fakes.map(x => `examine ${x}`)].find(a => !done.has(a));
    if (extra) { done.add(extra); actions.push(extra); continue; }
    const succ = successors(m, s, buf).slice();
    const take = succ.find(x => x[0].startsWith('take '));
    if (take) { act(take[0], take[1]); continue; }
    const exam = succ.find(x => x[0].startsWith('examine '));
    if (exam) { act(exam[0], exam[1]); continue; }
    const use = succ.find(x => x[0].startsWith('use '));
    if (use) { act(use[0], use[1]); continue; }
    const swNew = r.switches.find(sw => !toggled.has(sw));
    if (swNew !== undefined) { toggled.set(swNew, 1); act(`toggle ${m.swNoun[swNew]}`, s ^ (m.swMask[swNew] << m.oM)); continue; }
    const step = navigate(m, s, visited, toggled);
    if (!step) break;
    if (step.toggle !== undefined) {
      toggled.set(step.toggle, (toggled.get(step.toggle) || 0) + 1);
      act(`toggle ${m.swNoun[step.toggle]}`, s ^ (m.swMask[step.toggle] << m.oM));
      continue;
    }
    const di = step.dir;
    act(`go ${DIRS[di]}`, (s & ~63) | m.nbr[p][di].to);
  }
  return { won: false, steps: actions.length, actions };
}

function navigate(m, s, visited, toggled) {
  const start = posOf(s);
  const first = new Map([[start, -1]]);
  const order = [start];
  for (let i = 0; i < order.length; i++) {
    const c = order[i];
    for (let di = 0; di < 4; di++) {
      if (!passable(m, s, c, di)) continue;
      const t = m.nbr[c][di].to;
      if (!visited.has(t) || first.has(t)) continue;
      first.set(t, c === start ? di : first.get(c));
      order.push(t);
    }
  }
  const heldKey = k => bit(s, m.oK, k) === 1;
  let best1 = null, best2 = null;
  for (const c of order) {
    const fd = first.get(c);
    for (let di = 0; di < 4; di++) {
      const x = m.nbr[c][di];
      if (x.kind === K_DOOR && c !== start && !bit(s, m.oD, x.ref) && heldKey(m.doorKey[x.ref]) && !best1) best1 = { dir: fd };
      if (visited.has(x.to) || x.to < 0 || !passable(m, s, c, di)) continue;
      const two = x.kind !== K_OUT;
      const mv = { dir: c === start ? di : fd };
      if (two && !best1) best1 = mv;
      if (!two && !best2) best2 = mv;
    }
    if (best1) return best1;
  }
  if (best2) return best2;
  const closedNeeded = new Set();
  for (const c of visited) for (let di = 0; di < 4; di++) {
    const x = m.nbr[c][di];
    if (x.kind === K_MECH && !bit(s, m.oM, x.ref)) closedNeeded.add(x.ref);
  }
  for (const c of order) {
    for (const sw of m.room[c].switches) {
      if (!toggled.has(sw) || toggled.get(sw) > 3) continue;
      const mask = m.swMask[sw];
      let opens = false;
      for (const mi of closedNeeded) if (mask & (1 << mi)) opens = true;
      if (!opens) continue;
      if (c === start) return { toggle: sw };
      return { dir: first.get(c) };
    }
  }
  return null;
}

// ---------------------------------------------------------------- statistics
function mulberry32(a) {
  return () => {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
// Percentile bootstrap over tasks (paired: resample indices once, apply to every column).
// `f(indices)` returns the statistic for the resampled index list.
export function bootstrap(n, f, { reps = 10000, seed = 20261009 } = {}) {
  const R = mulberry32(seed);
  const stats = new Array(reps);
  const idx = new Array(n);
  for (let b = 0; b < reps; b++) {
    for (let i = 0; i < n; i++) idx[i] = Math.floor(R() * n);
    stats[b] = f(idx);
  }
  stats.sort((a, b) => a - b);
  return [stats[Math.floor(0.025 * reps)], stats[Math.ceil(0.975 * reps) - 1]];
}
