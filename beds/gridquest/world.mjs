// Structural world generator for `gridquest`: grid, spanning tree, lock-and-key zones,
// switches, one-way passages, hidden keys. Solvability, the mechanism requirement and the
// budget are certified by solver.mjs before a world is accepted. Pure function of its RNG.
import { COLORS, SWITCH_NOUNS, CONTAINERS, DECOY_ITEMS } from './text.mjs';
import { compile, solve, minMechanisms, explore } from './solver.mjs';

// Per-difficulty structural knobs. `minReq` is the minimum number of effective use/toggle
// actions that EVERY winning play needs (checked by 0-1 BFS, not just the optimal plan);
// `minOpt` rejects degenerate worlds whose optimal plan is too short for the level.
export const LEVELS = {
  1: { n: 3, main: 1, side: 0, hidden: 0, mechFrac: 0, minMech: 0, loops: 0.15, back: 0, trap: 0, coupled: 0, fakes: 0, decoys: 0, minReq: 1, minOpt: 6, budgetF: 3.0 },
  2: { n: 4, main: 2, side: 0, hidden: 1, mechFrac: 0.5, minMech: 1, loops: 0.15, back: 1, trap: 0, coupled: 0, fakes: 0, decoys: 0, minReq: 2, minOpt: 10, budgetF: 2.75 },
  3: { n: 5, main: 2, side: 1, hidden: 1, mechFrac: 0.45, minMech: 1, loops: 0.15, back: 1, trap: 0, coupled: 0, fakes: 1, decoys: 0, minReq: 2, minOpt: 15, budgetF: 2.75 },
  4: { n: 6, main: 3, side: 1, hidden: 2, mechFrac: 0.45, minMech: 1, loops: 0.15, back: 2, trap: 1, coupled: 1, fakes: 2, decoys: 1, minReq: 3, minOpt: 22, budgetF: 2.75 },
  5: { n: 7, main: 4, side: 2, hidden: 2, mechFrac: 0.5, minMech: 2, loops: 0.15, back: 2, trap: 1, coupled: 1, fakes: 3, decoys: 2, minReq: 3, minOpt: 30, budgetF: 2.75 },
};

export function buildStructure(R, L) {
  const n = L.n, N = n * n;
  const pairs = [];
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    const id = r * n + c;
    if (c + 1 < n) pairs.push([id, id + 1, 'east']);
    if (r + 1 < n) pairs.push([id, id + n, 'south']);
  }
  // Random spanning tree (Kruskal over shuffled grid adjacencies).
  const uf = [...Array(N).keys()];
  const find = x => { while (uf[x] !== x) { uf[x] = uf[uf[x]]; x = uf[x]; } return x; };
  const tree = [], extra = [];
  for (const p of R.shuffle(pairs)) {
    const a = find(p[0]), b = find(p[1]);
    if (a !== b) { uf[a] = b; tree.push(p); } else extra.push(p);
  }
  const adj = Array.from({ length: N }, () => []);
  tree.forEach(([a, b], i) => { adj[a].push([b, i]); adj[b].push([a, i]); });

  const start = R.int(0, N - 1);
  const dist = Array(N).fill(-1), parEdge = Array(N).fill(-1), par = Array(N).fill(-1), order = [start];
  dist[start] = 0;
  for (let i = 0; i < order.length; i++) {
    const u = order[i];
    for (const [v, ei] of adj[u]) if (dist[v] < 0) { dist[v] = dist[u] + 1; par[v] = u; parEdge[v] = ei; order.push(v); }
  }
  const maxD = Math.max(...dist);
  const T = R.pick([...Array(N).keys()].filter(c => c !== start && dist[c] >= Math.ceil(0.75 * maxD)));
  const pathCells = [];
  for (let c = T; c !== -1; c = par[c]) pathCells.push(c);
  pathCells.reverse();
  const onPath = new Set(pathCells);
  const pathEdges = pathCells.slice(1).map(c => parEdge[c]);
  const E = pathEdges.length;
  if (E < L.main + 2) return null;

  // Subtree sizes / Euler intervals (tree rooted at start) for side pockets.
  const size = Array(N).fill(1);
  for (let i = order.length - 1; i > 0; i--) size[par[order[i]]] += size[order[i]];
  const tin = Array(N), tout = Array(N);
  { let t = 0; const st = [[start, 0]];
    while (st.length) { const top = st[st.length - 1]; const [u, k] = top;
      if (k === 0) tin[u] = t++;
      const kids = adj[u].filter(([v]) => par[v] === u);
      if (k < kids.length) { top[1]++; st.push([kids[k][0], 0]); } else { tout[u] = t++; st.pop(); } } }
  const inSub = (root, x) => tin[root] <= tin[x] && tout[x] <= tout[root];

  // Main locks spread along the start→treasure path.
  const locks = [];
  let prevK = 0;
  for (let i = 0; i < L.main; i++) {
    let k = Math.round((i + 1) * E / (L.main + 1)) + R.int(-1, 1);
    k = Math.max(prevK + 1, Math.min(E - 1, k));
    if (k > E - 1) return null;
    prevK = k;
    const ei = pathEdges[k];
    locks.push({ edge: ei, u: pathCells[k], v: pathCells[k + 1], main: true });
  }
  // Side locks guard pockets off the path (disjoint subtrees of 2..N/4 rooms).
  const sideCands = R.shuffle(tree.map((p, ei) => ei).filter(ei => !pathEdges.includes(ei)));
  for (const ei of sideCands) {
    if (locks.length >= L.main + L.side) break;
    const [a, b] = tree[ei];
    const child = par[a] === b ? a : b, parent = child === a ? b : a;
    if (size[child] < 2 || size[child] > Math.floor(N / 4)) continue;
    if (locks.some(l => !l.main && (inSub(l.v, child) || inSub(child, l.v)))) continue;
    locks.push({ edge: ei, u: parent, v: child, main: false });
  }
  const lockEdge = new Set(locks.map(l => l.edge));
  const comp = Array(N).fill(-1);
  const compCells = [];
  for (let s0 = 0; s0 < N; s0++) {
    if (comp[s0] >= 0) continue;
    const id = compCells.length, cells = [s0];
    comp[s0] = id;
    for (let i = 0; i < cells.length; i++) for (const [v, ei] of adj[cells[i]]) if (!lockEdge.has(ei) && comp[v] < 0) { comp[v] = id; cells.push(v); }
    compCells.push(cells);
  }

  // Lock kinds.
  const kinds = locks.map(() => (R.chance(L.mechFrac) ? 'mech' : 'door'));
  const count = k => kinds.filter(x => x === k).length;
  for (const idx of R.shuffle([...kinds.keys()])) {
    if (count('door') < Math.min(L.hidden, locks.length) && kinds[idx] === 'mech') kinds[idx] = 'door';
  }
  for (const idx of R.shuffle([...kinds.keys()])) {
    if (count('mech') < L.minMech && kinds[idx] === 'door' && count('door') > L.hidden) kinds[idx] = 'mech';
  }

  // Open locks in a randomised order consistent with reachability and place each opener
  // (key or switch) somewhere already reachable; recent pockets are favoured so keys chain.
  const reachable = [comp[start]];
  const compParent = new Map();
  const pending = [...locks.keys()];
  const openerRoom = Array(locks.length);
  const used = new Set();
  while (pending.length) {
    const cands = pending.filter(i => reachable.includes(comp[locks[i].u]));
    const sideC = cands.filter(i => !locks[i].main), mainC = cands.filter(i => locks[i].main);
    const pick = sideC.length && (!mainC.length || R.chance(0.55)) ? R.pick(sideC) : mainC[0];
    const cmp = R.chance(0.6) ? reachable[reachable.length - 1] : R.pick(reachable);
    let cells = compCells[cmp].filter(c => c !== start && c !== T);
    if (!cells.length) cells = compCells[reachable[0]].filter(c => c !== T);
    const off = cells.filter(c => !onPath.has(c) && !used.has(c)), free = cells.filter(c => !used.has(c));
    const room = off.length && R.chance(0.7) ? R.pick(off) : free.length ? R.pick(free) : R.pick(cells);
    openerRoom[pick] = room;
    used.add(room);
    const child = comp[locks[pick].v];
    compParent.set(child, comp[locks[pick].u]);
    reachable.push(child);
    pending.splice(pending.indexOf(pick), 1);
  }

  // Assemble edges and lock objects.
  const w = { n, start, treasure: T, edges: [], doors: [], keys: [], mechs: [], switches: [], hides: [], comp, onPath: pathCells };
  const nounsAt = Array.from({ length: N }, () => new Set());
  const exitAt = Array.from({ length: N }, () => ({}));
  const addEdge = (a, b, dir, kind, extraProps = {}) => {
    const e = { a, b, dir, kind, ...extraProps };
    w.edges.push(e);
    exitAt[a][dir] = w.edges.length - 1;
    exitAt[b][{ east: 'west', south: 'north' }[dir]] = w.edges.length - 1;
    return w.edges.length - 1;
  };
  const colors = R.shuffle(COLORS);
  const lockOfEdge = new Map(locks.map((l, i) => [l.edge, i]));
  const freshNoun = (room, pool) => {
    const opts = pool.filter(x => !nounsAt[room].has(x));
    const noun = R.pick(opts);
    nounsAt[room].add(noun);
    return noun;
  };
  tree.forEach(([a, b, dir], ei) => {
    const li = lockOfEdge.get(ei);
    if (li === undefined) { addEdge(a, b, dir, 'open'); return; }
    if (kinds[li] === 'door') {
      const color = colors[w.doors.length];
      const key = w.keys.length;
      w.keys.push({ color, room: openerRoom[li], hide: -1, main: locks[li].main });
      const ed = addEdge(a, b, dir, 'door', { door: w.doors.length });
      w.doors.push({ edge: ed, color, key, main: locks[li].main });
    } else {
      const mech = w.mechs.length;
      const ed = addEdge(a, b, dir, 'mech', { mech });
      w.mechs.push({ edge: ed, type: R.chance(0.5) ? 'bridge' : 'gate', open0: false, main: locks[li].main });
      w.switches.push({ room: openerRoom[li], noun: freshNoun(openerRoom[li], SWITCH_NOUNS), targets: [mech] });
    }
  });
  // Hidden keys: main-path keys first.
  const hideOrder = [...w.keys.keys()].sort((x, y) => Number(w.keys[y].main) - Number(w.keys[x].main));
  const mainKeys = R.shuffle(hideOrder.filter(k => w.keys[k].main)), sideKeys = R.shuffle(hideOrder.filter(k => !w.keys[k].main));
  for (const k of [...mainKeys, ...sideKeys].slice(0, L.hidden)) {
    const room = w.keys[k].room;
    w.keys[k].hide = w.hides.length;
    w.hides.push({ room, key: k, noun: freshNoun(room, CONTAINERS.map(c => c.noun)) });
  }
  // Cued-but-empty containers and decoy items (they cost moves; they never help).
  const spare = R.shuffle([...Array(N).keys()].filter(c => c !== start && c !== T));
  w.fakes = spare.slice(0, L.fakes).map(room => ({ room, noun: freshNoun(room, CONTAINERS.map(c => c.noun)) }));
  w.decoys = R.sample(DECOY_ITEMS.map(x => x.name), L.decoys).map((name, i) => ({ room: spare[spare.length - 1 - i], name }));
  // Extra adjacencies: loops inside a zone, one-way shortcuts back to an ancestor zone.
  const isAnc = (a, b) => { for (let x = b; x !== undefined; x = compParent.get(x)) if (x === a) return true; return false; };
  let back = 0;
  const trapCands = [];
  for (const [a, b, dir] of R.shuffle(extra)) {
    const ca = comp[a], cb = comp[b];
    if (ca === cb) {
      if (R.chance(L.loops)) addEdge(a, b, dir, 'open');
      else if (R.chance(L.loops * 0.6)) addEdge(a, b, dir, 'oneway', { from: R.chance(0.5) ? a : b });
    } else if (isAnc(ca, cb) || isAnc(cb, ca)) {
      const [anc, desc] = isAnc(ca, cb) ? [a, b] : [b, a];
      if (back < L.back && R.chance(0.5)) { addEdge(a, b, dir, 'oneway', { from: desc }); back++; }
      else trapCands.push([a, b, dir, anc, desc]);
    }
  }
  w.nounsAt = nounsAt.map(s => [...s]);
  return { w, trapCands, exitAt };
}

function check(w, L) {
  const m = compile(w);
  const sol = solve(m);
  if (!sol) return null;
  const mm = minMechanisms(m);
  if (mm < L.minReq) return null;
  return { m, sol, mm };
}

// Build, certify and return a structural world. Attempts are salted deterministically. Only a
// world that passed every check (solvable, mechanism requirement, minimum length, explorer
// certificate within budget) is ever returned; if none is found the generator throws rather
// than emit an uncertified world. In practice at most 6 attempts are used (see README).
export const MAX_ATTEMPTS = 200;
export function makeWorld(R0, d, L = LEVELS[d]) {
  const rejected = { layout: 0, requirement: 0, short: 0, explorer: 0 };
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const R = R0.fork(`attempt-${attempt}`);
    const built = buildStructure(R, L);
    if (!built) { rejected.layout++; continue; }
    const { w, trapCands } = built;
    let ok = check(w, L);
    if (!ok) { rejected.requirement++; continue; }
    // Optional trap chute: a one-way drop that skips locks (and can strand an unprepared player).
    for (const [a, b, dir, anc, desc] of R.shuffle(trapCands).slice(0, 6)) {
      if (w.edges.filter(e => e.trap).length >= L.trap) break;
      w.edges.push({ a, b, dir, kind: 'oneway', from: anc, trap: true });
      const t = check(w, L);
      if (t) { ok = t; } else w.edges.pop();
    }
    // Optional coupled switch: one switch also drops an (initially raised) portcullis elsewhere.
    if (L.coupled && w.switches.length && w.mechs.length < 7) {
      const sw = R.pick(w.switches);
      const cands = R.shuffle(w.edges.map((e, i) => i).filter(i => w.edges[i].kind === 'open' && w.edges[i].a !== w.start && w.edges[i].b !== w.start)).slice(0, 8);
      let firstValid = null;
      for (const ei of cands) {
        const e = w.edges[ei];
        e.kind = 'mech'; e.mech = w.mechs.length;
        w.mechs.push({ edge: ei, type: 'gate', open0: true, main: false, coupled: true });
        sw.targets.push(e.mech);
        const t = check(w, L);
        const consequential = t && t.sol.length !== ok.sol.length;
        if (t && !firstValid) firstValid = { ei, t };
        sw.targets.pop(); w.mechs.pop(); e.kind = 'open'; delete e.mech;
        if (consequential) { firstValid = { ei, t }; break; }
      }
      if (firstValid) {
        const e = w.edges[firstValid.ei];
        e.kind = 'mech'; e.mech = w.mechs.length;
        w.mechs.push({ edge: firstValid.ei, type: 'gate', open0: true, main: false, coupled: true });
        sw.targets.push(e.mech);
        ok = firstValid.t;
      }
    }
    if (ok.sol.length < L.minOpt) { rejected.short++; continue; }
    const budget = Math.ceil(L.budgetF * ok.sol.length);
    const ex = explore(ok.m, budget);
    if (ex.won) return { w, model: ok.m, solution: ok.sol.actions, optimal: ok.sol.length, minMech: ok.mm, budget, explorer: ex, attempt, rejected };
    rejected.explorer++;
    if (ex.steps < budget) rejected.explorerStuck = (rejected.explorerStuck || 0) + 1;
  }
  throw new Error(`gridquest: no certified world for difficulty ${d} after ${MAX_ATTEMPTS} attempts (${JSON.stringify(rejected)})`);
}
