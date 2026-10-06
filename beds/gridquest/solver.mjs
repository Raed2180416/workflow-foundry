// Oracle-side abstract model of a gridquest world: full-state BFS (reference solver),
// 0-1 BFS for the minimum number of mechanism actions (keys used + switches toggled), and a
// perfect-perception, no-prior-map explorer used to certify that the budget is fair.
// Never exposed to solvers. Semantics must match engine.mjs exactly; tests cross-check them.
import { DIRS } from './text.mjs';

// Exit kinds in the compiled model.
export const K_NONE = 0, K_OPEN = 1, K_DOOR = 2, K_MECH = 3, K_OUT = 4, K_IN = 5;

export function compile(w) {
  const N = w.n * w.n;
  const nbr = Array.from({ length: N }, () => DIRS.map(() => ({ to: -1, kind: K_NONE, ref: -1 })));
  w.edges.forEach((e, ei) => {
    const back = { north: 'south', south: 'north', east: 'west', west: 'east' }[e.dir];
    const da = DIRS.indexOf(e.dir), db = DIRS.indexOf(back);
    let ka, kb, ref = -1;
    if (e.kind === 'open') { ka = kb = K_OPEN; }
    else if (e.kind === 'door') { ka = kb = K_DOOR; ref = e.door; }
    else if (e.kind === 'mech') { ka = kb = K_MECH; ref = e.mech; }
    else if (e.kind === 'oneway') { if (e.from === e.a) { ka = K_OUT; kb = K_IN; } else { ka = K_IN; kb = K_OUT; } }
    nbr[e.a][da] = { to: e.b, kind: ka, ref, edge: ei };
    nbr[e.b][db] = { to: e.a, kind: kb, ref, edge: ei };
  });
  const K = w.keys.length, H = w.hides.length, D = w.doors.length, M = w.mechs.length;
  const oK = 6, oH = oK + K, oD = oH + H, oM = oD + D;
  if (oM + M > 30) throw new Error('gridquest: state does not fit in 30 bits');
  let mech0 = 0;
  w.mechs.forEach((m, i) => { if (m.open0) mech0 |= 1 << i; });
  const room = Array.from({ length: N }, () => ({ keys: [], hides: [], switches: [], fakes: [], decoys: [] }));
  (w.fakes || []).forEach(f => room[f.room].fakes.push(f.noun));
  (w.decoys || []).forEach(x => room[x.room].decoys.push(x.name));
  w.keys.forEach((k, i) => room[k.room].keys.push(i));
  w.hides.forEach((h, i) => room[h.room].hides.push(i));
  w.switches.forEach((s, i) => room[s.room].switches.push(i));
  return {
    N, start: w.start, T: w.treasure, nbr, room, K, H, D, M, oK, oH, oD, oM,
    keyHide: w.keys.map(k => k.hide), keyName: w.keys.map(k => `${k.color} key`),
    hideNoun: w.hides.map(h => h.noun), hideKey: w.hides.map(h => h.key),
    doorKey: w.doors.map(d => d.key),
    swNoun: w.switches.map(s => s.noun),
    swMask: w.switches.map(s => s.targets.reduce((m, t) => m | (1 << t), 0)),
    init: w.start | (mech0 << oM),
  };
}

const bit = (s, o, i) => (s >>> (o + i)) & 1;
const pos = s => s & 63;

export function passable(m, s, cell, di) {
  const x = m.nbr[cell][di];
  switch (x.kind) {
    case K_OPEN: case K_OUT: return true;
    case K_DOOR: return bit(s, m.oD, x.ref) === 1;
    case K_MECH: return bit(s, m.oM, x.ref) === 1;
    default: return false;
  }
}

// Successors in canonical order: take keys, examine hides, use keys on doors, toggle, go.
// Only state-changing actions; useless ones (look, decor, decoys, wrong keys) never shorten a plan.
export function successors(m, s, out) {
  out.length = 0;
  const p = pos(s), r = m.room[p];
  for (const k of r.keys) {
    if (bit(s, m.oK, k)) continue;
    const h = m.keyHide[k];
    if (h >= 0 && !bit(s, m.oH, h)) continue;
    out.push([`take ${m.keyName[k]}`, s | (1 << (m.oK + k)), 0]);
  }
  for (const h of r.hides) if (!bit(s, m.oH, h)) out.push([`examine ${m.hideNoun[h]}`, s | (1 << (m.oH + h)), 0]);
  for (let di = 0; di < 4; di++) {
    const x = m.nbr[p][di];
    if (x.kind !== K_DOOR || bit(s, m.oD, x.ref)) continue;
    const k = m.doorKey[x.ref];
    if (bit(s, m.oK, k)) out.push([`use ${m.keyName[k]} on ${DIRS[di]} door`, s | (1 << (m.oD + x.ref)), 1]);
  }
  for (const sw of r.switches) out.push([`toggle ${m.swNoun[sw]}`, s ^ (m.swMask[sw] << m.oM), 1]);
  for (let di = 0; di < 4; di++) {
    if (!passable(m, s, p, di)) continue;
    out.push([`go ${DIRS[di]}`, (s & ~63) | m.nbr[p][di].to, 0]);
  }
  return out;
}

// Shortest winning action sequence (BFS over full state). Returns null if unsolvable.
export function solve(m) {
  const prev = new Map([[m.init, null]]);
  let frontier = [m.init];
  const buf = [];
  while (frontier.length) {
    const next = [];
    for (const s of frontier) {
      if (pos(s) === m.T) {
        const actions = ['take treasure'];
        for (let cur = s; prev.get(cur); cur = prev.get(cur)[0]) actions.push(prev.get(cur)[1]);
        actions.reverse();
        return { actions, length: actions.length, states: prev.size };
      }
      for (const [a, t] of successors(m, s, buf)) {
        if (prev.has(t)) continue;
        prev.set(t, [s, a]);
        next.push(t);
      }
    }
    frontier = next;
  }
  return null;
}

// Minimum number of effective use/toggle actions over all winning plays (0-1 BFS).
export function minMechanisms(m) {
  const dist = new Map([[m.init, 0]]);
  let deque = [m.init], head = 0;
  const front = [];
  const buf = [];
  while (head < deque.length || front.length) {
    const s = front.length ? front.pop() : deque[head++];
    const ds = dist.get(s);
    if (pos(s) === m.T) return ds;
    for (const [, t, c] of successors(m, s, buf)) {
      if (t === s) continue;
      const nd = ds + c;
      const old = dist.get(t);
      if (old !== undefined && old <= nd) continue;
      dist.set(t, nd);
      if (c === 0) front.push(t); else deque.push(t);
    }
  }
  return Infinity;
}
// Note: `front` is a LIFO of zero-cost successors processed before the FIFO; distances are
// re-relaxed on improvement, so the result is exact (label-correcting 0-1 search).

export function simulate(m, actions) {
  // Abstract replay of canonical action strings (used by tests to cross-check engine.mjs).
  let s = m.init;
  const buf = [];
  for (let i = 0; i < actions.length; i++) {
    if (actions[i] === 'take treasure') { if (pos(s) === m.T) return { won: true, steps: i + 1, state: s }; continue; }
    const hit = successors(m, s, buf).find(x => x[0] === actions[i]);
    if (hit) s = hit[1];
  }
  return { won: false, steps: actions.length, state: s };
}

// Perfect-perception explorer with no prior map: it perceives the current room exactly (exits,
// their state, items, cued containers, switches), remembers what it has seen, and knows which
// mechanisms a switch moved once it has toggled it. Greedy: grab keys, examine cued containers,
// unlock doors it holds keys for, toggle each new switch once, then walk to the nearest
// frontier (two-way exits before one-way drops); when stuck, re-toggle a known switch that
// would reopen a closed passage next to explored rooms.
export function explore(m, maxSteps) {
  let s = m.init;
  const actions = [];
  const visited = new Set([pos(s)]);
  const toggled = new Map(); // switch -> times toggled
  const done = new Set(); // decoy items taken / empty containers examined (no state change)
  const buf = [];
  const act = (a, t) => { actions.push(a); s = t; visited.add(pos(s)); };
  while (actions.length < maxSteps) {
    const p = pos(s), r = m.room[p];
    if (p === m.T) { actions.push('take treasure'); return { won: true, steps: actions.length, actions }; }
    // A careful player also takes the odd-looking keys and checks cued containers that turn out empty.
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
    // Navigation over explored rooms.
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
  const start = pos(s);
  // BFS over visited cells with current passability; remember first move.
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
      // A door we now hold the key for (the caller already unlocks doors in the current room).
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
  // Stuck: find a known switch that reopens a closed mechanism adjacent to an explored room.
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
