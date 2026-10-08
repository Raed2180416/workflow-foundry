// gridquest side of the interactive generator (JUDGE-PROGRAM.md §1.2 Q1, Q2, Q3, Q4, X1): worlds, plans with
// believed maps, the environment truth that labels them, and the candidates the generator draws from.
// Beds are reached only through the frozen-copy handle the build passes (ctx.beds); this file imports no bed and
// reads no held-out material. Pure: no Math.random, no clock; every choice is a salted hash of its key.
import { createHash } from 'node:crypto';
import { DIRECTIONS, OPPOSITE, describeExpectation, parseObservation, descriptionSentences, lowerFirst } from '../judges/interactive.mjs';

export const GQ_VERSION = 'gridquest-interactive@1';
const sha = s => createHash('sha256').update(s).digest('hex');
export const hnum = s => parseInt(sha(s).slice(0, 8), 16);
export const unit = s => hnum(s) / 0x100000000;
export const pickBy = (list, key) => (list.length ? list[hnum(key) % list.length] : undefined);
const byHash = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
export const shuffled = (list, key) => [...list].sort((a, b) => byHash(sha(`${key}|${typeof a === 'string' ? a : JSON.stringify(a)}`), sha(`${key}|${typeof b === 'string' ? b : JSON.stringify(b)}`)));

// ---- the frozen bed -------------------------------------------------------------------------------------------
const MOD = new Map();
export async function loadGq(beds) {
  if (!MOD.has(beds.pin)) {
    const [index, engine, solver, render, text, world] = await Promise.all(['index', 'engine', 'solver', 'render', 'text', 'world'].map(f => beds.import(`beds/gridquest/${f}.mjs`)));
    MOD.set(beds.pin, Object.freeze({ index, engine, solver, render, text, world, pin: beds.pin }));
  }
  return MOD.get(beds.pin);
}

// A difficulty cycle (d3-d5 carry the landmarks, fake exits, injections and the coupled switch).
const DIFFICULTY_CYCLE = [1, 2, 3, 3, 4, 4, 5, 5];
export const difficultyOf = (seed, allowed = [1, 2, 3, 4, 5]) => {
  const cycle = DIFFICULTY_CYCLE.filter(d => allowed.includes(d));
  return cycle.length ? cycle[seed % cycle.length] : allowed[seed % allowed.length];
};

// The names the skeleton masks hide: room names, the keep and the lock colours (a form is the same whatever
// the world calls its rooms and colours its doors).
export function masksOf(mod, task) {
  const W = mod.index._internal.world(task), w = W.w;
  const names = [...new Set([...w.rooms.map(r => r.name), w.keep, ...w.rooms.map(r => r.name.replace(/^the /, ''))])];
  const markers = [...mod.text.COLORS, ...mod.text.DECOR_COLORS];
  return { names, markers };
}

// ---- the abstract fixtures of a room ---------------------------------------------------------------------------------
const roomName = (w, c) => w.rooms[c].name;
export const cellOfRoom = (w, name) => w.rooms.findIndex(r => r.name === name);
const neighbour = (n, cell, dir) => {
  const r = Math.floor(cell / n), c = cell % n;
  const [dr, dc] = { north: [-1, 0], south: [1, 0], east: [0, 1], west: [0, -1] }[dir];
  const rr = r + dr, cc = c + dc;
  return rr < 0 || rr >= n || cc < 0 || cc >= n ? -1 : rr * n + cc;
};
export const fixturesOf = (w, cell) => w.objects.filter(o => o.room === cell).map(o => o.noun);

// ---- the truth of one step: did the plan's expected effect happen? ----------------------------------------------------------
// truth specs are internal to the generator (never in a state): {kind:'enter', cell} {kind:'take', item}
// {kind:'unlock', door} {kind:'toggle', flips:[{mech, open}]} {kind:'find', hide, color} {kind:'treasure'}
export function holds(mod, W, truth, pre, post) {
  const w = W.w;
  switch (truth.kind) {
    case 'enter': return post.pos === truth.cell;
    case 'take': return post.inv.some(id => !pre.inv.includes(id) && mod.render.itemName(w, id) === truth.item);
    case 'unlock': return truth.door >= 0 && post.unlocked.includes(truth.door) && !pre.unlocked.includes(truth.door);
    case 'toggle': {
      const flipped = post.mech.map((o, i) => (o !== pre.mech[i] ? { mech: i, open: o } : null)).filter(Boolean);
      return flipped.length === truth.flips.length && truth.flips.every(f => flipped.some(g => g.mech === f.mech && g.open === f.open));
    }
    case 'find': return truth.hide >= 0 && post.revealed.includes(truth.hide) && !pre.revealed.includes(truth.hide) && w.keys[w.hides[truth.hide].key].color === truth.color;
    case 'treasure': return post.won === true && pre.won === false;
    default: throw new Error(`unknown truth kind ${truth.kind}`);
  }
}

// What toggling a switch does to the mechanisms it moves, as expected-effect entries and truth flips.
export function toggleEffects(mod, W, pre, post, switchIndex) {
  const w = W.w, sw = w.switches[switchIndex], effects = [], flips = [];
  for (const mi of sw.targets) {
    const m = w.mechs[mi], e = w.edges[m.edge], open = post.mech[mi];
    const change = m.type === 'bridge' ? (open ? 'lowers' : 'raises') : (open ? 'raises' : 'drops');
    effects.push({ type: m.type === 'bridge' ? 'bridge' : 'portcullis', change, a: roomName(w, e.a), b: roomName(w, e.b), mech: mi });
    flips.push({ mech: mi, open });
  }
  return { effects, flips };
}

// ---- stepping --------------------------------------------------------------------------------------------------------------
// A walker runs the engine of the frozen bed (the same code createEnv wraps) and keeps the plain snapshots it takes.
export class Walker {
  constructor(mod, task) {
    this.mod = mod; this.task = task;
    this.W = mod.index._internal.world(task);
    this.env = mod.engine.makeEnv(this.W.w, this.W.budget);
    this.trace = [];
  }
  state() { return this.env._state(); }
  snapshot() { return this.env.snapshot(); }
  restore(s) { this.env.restore(s); }
  step(action) {
    const pre = this.state();
    const r = this.env.step(action);
    return { action, pre, post: this.state(), observation: r.observation, info: r.info };
  }
}

// The true plan: the bed's reference route, each step with the expectation a correct map gives it.
export function trueRoute(mod, task) {
  const wk = new Walker(mod, task), W = wk.W, w = W.w, rows = [];
  const initial = wk.env.observe();
  rows.push(null);
  rows.length = 0;
  const snaps = [wk.snapshot()];
  const observations = [initial];
  for (let k = 0; k < W.solution.length; k++) {
    const action = W.solution[k], cmd = mod.engine.parse(action), step = wk.step(action);
    const row = { k, action, ...step, cmd, ...expectationOf(mod, W, step, cmd) };
    rows.push(row);
    snaps.push(wk.snapshot());
    observations.push(step.observation);
  }
  return { W, w, rows, snaps, observations, initial, walker: wk };
}

// expectation + truth of a step that the world actually performed (the true plan's step)
function expectationOf(mod, W, step, cmd) {
  const w = W.w, { pre, post } = step;
  switch (cmd.verb) {
    case 'go': return { expect: { kind: 'enter', room: roomName(w, post.pos) }, truth: { kind: 'enter', cell: post.pos } };
    case 'take': {
      if (cmd.thing === 'treasure') return { expect: { kind: 'treasure' }, truth: { kind: 'treasure' } };
      const id = post.inv.find(i => !pre.inv.includes(i));
      const item = id ? mod.render.itemName(w, id) : cmd.thing;
      return { expect: { kind: 'take', item }, truth: { kind: 'take', item } };
    }
    case 'use': {
      const ex = mod.render.exitsOf(w, pre.pos), dir = DIRECTIONS.find(d => cmd.thing.startsWith(d));
      const ei = dir ? ex[dir] : undefined, door = ei !== undefined && w.edges[ei].kind === 'door' ? w.edges[ei].door : -1;
      return { expect: { kind: 'unlock', direction: dir }, truth: { kind: 'unlock', door } };
    }
    case 'toggle': {
      const si = w.switches.findIndex(s => s.room === pre.pos && (s.noun === cmd.thing || `${s.adj} ${s.noun}` === cmd.thing));
      const { effects, flips } = toggleEffects(mod, W, pre, post, si);
      return { expect: { kind: 'toggle', noun: w.switches[si].noun, effects: effects.map(({ mech, ...e }) => e) }, truth: { kind: 'toggle', flips }, switchIndex: si };
    }
    case 'examine': {
      const o = w.objects.find(x => x.room === pre.pos && x.noun === cmd.thing);
      if (o?.kind === 'hide') {
        const k = w.keys[w.hides[o.hide].key];
        return { expect: { kind: 'find', container: o.noun, item: `${k.color} key` }, truth: { kind: 'find', hide: o.hide, color: k.color } };
      }
      return { expect: null, truth: null };
    }
    default: return { expect: null, truth: null };
  }
}

// ---- perturbed beliefs ------------------------------------------------------------------------------------------------------
// Each operator proposes, for the state after k route steps, an action the plan issues and the effect it expects,
// on a map the plan believes wrongly. The environment decides whether the effect happens (holds()).
export const OPS = Object.freeze(['wrong-exit', 'locked-door', 'wrong-key', 'one-way-return', 'one-way-entry', 'wrong-room', 'unaware-coupling', 'phantom-coupling', 'empty-container', 'wrong-key-found', 'absent-item', 'no-treasure']);

function colourOfDoor(w, d) { return w.doors[d].color; }

export function proposeOps(mod, route, k, key) {
  const { W, w, rows, snaps } = route, n = w.n;
  const pre = snaps[k] ? JSON.parse(JSON.stringify(snaps[k])).st : null;
  if (!pre) return [];
  const out = [], cell = pre.pos, ex = mod.render.exitsOf(w, cell), step = rows[k];
  const nameAt = c => roomName(w, c);
  // wrong exit: a wall with a neighbour behind it that the plan believes open (a bricked-up arch, an exit-like feature)
  {
    const fake = new Set(w.rooms[cell].slots.filter(s => s.k === 'fakeexit').map(s => s.dir));
    const walls = DIRECTIONS.filter(d => ex[d] === undefined && neighbour(n, cell, d) >= 0);
    const pool = walls.filter(d => fake.has(d)), dir = pool.length && unit(`${key}|we|fake`) < 0.5 ? pickBy(pool, `${key}|we`) : pickBy(walls, `${key}|we`);
    if (dir) out.push({ op: 'wrong-exit', action: `go ${dir}`, expect: { kind: 'enter', room: nameAt(neighbour(n, cell, dir)) }, truth: { kind: 'enter', cell: neighbour(n, cell, dir) }, detail: { direction: dir, exitLike: fake.has(dir) } });
  }
  // locked door: the plan walks into a door it believes unlocked
  for (const d of DIRECTIONS) {
    const ei = ex[d];
    if (ei === undefined || w.edges[ei].kind !== 'door' || pre.unlocked.includes(w.edges[ei].door)) continue;
    const e = w.edges[ei], to = e.a === cell ? e.b : e.a;
    out.push({ op: 'locked-door', action: `go ${d}`, expect: { kind: 'enter', room: nameAt(to) }, truth: { kind: 'enter', cell: to }, detail: { direction: d, door: e.door } });
    // the plan holds a key it believes opens the door; it does not
    const wrong = pre.inv.map(id => (id.startsWith('key:') || id.startsWith('decoy:') ? mod.render.itemName(w, id) : null)).filter(Boolean)
      .filter(name => name !== `${colourOfDoor(w, e.door)} key`);
    if (wrong.length) out.push({ op: 'wrong-key', action: `use ${pickBy(wrong, `${key}|wk`)} on ${d} door`, expect: { kind: 'unlock', direction: d }, truth: { kind: 'unlock', door: e.door }, detail: { direction: d, door: e.door } });
  }
  // one-way passages: the plan believes a way back, or a way in from the closed side
  for (const d of DIRECTIONS) {
    const ei = ex[d];
    if (ei === undefined || w.edges[ei].kind !== 'oneway') continue;
    const e = w.edges[ei], to = e.a === cell ? e.b : e.a;
    if (e.from !== cell) out.push({ op: 'one-way-entry', action: `go ${d}`, expect: { kind: 'enter', room: nameAt(to) }, truth: { kind: 'enter', cell: to }, detail: { direction: d, style: e.style } });
  }
  // wrong room: the plan names another room for a move that works
  if (step && step.cmd.verb === 'go') {
    const here = step.post.pos, pool = [];
    for (const d of DIRECTIONS) { const c = neighbour(n, step.pre.pos, d); if (c >= 0 && c !== here) pool.push(c); }
    const others = pool.length ? pool : w.rooms.map((r, i) => i).filter(i => i !== here);
    const believed = pickBy(others, `${key}|wr`);
    out.push({ op: 'wrong-room', action: step.action, expect: { kind: 'enter', room: nameAt(believed) }, truth: { kind: 'enter', cell: believed }, detail: { believed, actual: here, direction: step.cmd.dir } });
  }
  // coupled switch: the plan knows only the first mechanism the switch moves
  if (step && step.cmd.verb === 'toggle' && step.switchIndex >= 0 && w.switches[step.switchIndex].targets.length > 1) {
    const { effects, flips } = toggleEffects(mod, W, step.pre, step.post, step.switchIndex);
    out.push({ op: 'unaware-coupling', action: step.action, expect: { kind: 'toggle', noun: w.switches[step.switchIndex].noun, effects: effects.slice(0, 1).map(({ mech, ...e }) => e) }, truth: { kind: 'toggle', flips: flips.slice(0, 1) }, detail: { targets: flips.length } });
  }
  // phantom coupling: the plan believes the switch also moves a mechanism it does not move (the mirror of unaware-coupling, so
  // that the number of effects the plan lists does not predict the label: drifts list one fewer or one more than the switch moves)
  // (single-target switches only: no switch of the bed moves three mechanisms, so a three-effect plan would be a drift by its length)
  if (step && step.cmd.verb === 'toggle' && step.switchIndex >= 0 && w.switches[step.switchIndex].targets.length === 1) {
    const sw = w.switches[step.switchIndex], others = w.mechs.map((m, i) => i).filter(i => !sw.targets.includes(i));
    if (others.length) {
      const { effects, flips } = toggleEffects(mod, W, step.pre, step.post, step.switchIndex);
      // a coupled switch of the bed opens one way and shuts another, so the phantom effect is a shutting one where the keep has an
      // open mechanism to shut (otherwise the change word of the extra effect alone would tell the phantom from a real coupling)
      const shut = others.filter(i => step.pre.mech[i]);
      const mi = pickBy(shut.length ? shut : others, `${key}|pc`), m = w.mechs[mi], e = w.edges[m.edge], open = !step.pre.mech[mi];
      const extra = { type: m.type === 'bridge' ? 'bridge' : 'portcullis', change: m.type === 'bridge' ? (open ? 'lowers' : 'raises') : (open ? 'raises' : 'drops'), a: roomName(w, e.a), b: roomName(w, e.b) };
      out.push({ op: 'phantom-coupling', action: step.action, expect: { kind: 'toggle', noun: sw.noun, effects: [...effects.map(({ mech, ...x }) => x), extra] }, truth: { kind: 'toggle', flips: [...flips, { mech: mi, open }] }, detail: { targets: flips.length, phantom: mi } });
    }
  }
  // containers: the plan believes an empty (or differently stocked) container holds a key
  {
    const here = w.objects.filter(o => o.room === cell && (o.kind === 'plain' || o.kind === 'fake' || o.kind === 'hide'));
    const colours = [...new Set(w.doors.map(d => d.color))];
    for (const o of here) {
      if (o.kind === 'hide') {
        const real = w.keys[w.hides[o.hide].key].color, wrong = colours.filter(c => c !== real);
        if (wrong.length && !pre.revealed.includes(o.hide)) { const c = pickBy(wrong, `${key}|wkf`); out.push({ op: 'wrong-key-found', action: `examine ${o.noun}`, expect: { kind: 'find', container: o.noun, item: `${c} key` }, truth: { kind: 'find', hide: o.hide, color: c }, detail: { container: o.noun, real } }); }
      } else if (colours.length) {
        const c = pickBy(colours, `${key}|ec|${o.noun}`);
        out.push({ op: 'empty-container', action: `examine ${o.noun}`, expect: { kind: 'find', container: o.noun, item: `${c} key` }, truth: { kind: 'find', hide: -1, color: c }, detail: { container: o.noun, cued: o.kind === 'fake' } });
      }
    }
  }
  // an item the plan believes lies here
  {
    const present = new Set(w.keys.filter(kk => kk.room === cell && (kk.hide < 0 || pre.revealed.includes(kk.hide))).map(kk => `${kk.color} key`));
    const absent = [...new Set(w.keys.map(kk => `${kk.color} key`))].filter(x => !present.has(x) && !pre.inv.some(id => mod.render.itemName(w, id) === x));
    if (absent.length) { const item = pickBy(absent, `${key}|ai`); out.push({ op: 'absent-item', action: `take ${item}`, expect: { kind: 'take', item }, truth: { kind: 'take', item }, detail: { item } }); }
  }
  // the treasure the plan believes is here (a mural, a journal lie)
  if (cell !== w.treasure) out.push({ op: 'no-treasure', action: 'take treasure', expect: { kind: 'treasure' }, truth: { kind: 'treasure' }, detail: { fakeMention: w.fakeTreasureRooms.includes(cell) } });
  return out;
}

// The step right after a one-way crossing: the plan goes back.
export function proposeReturn(mod, route, k, key) {
  const { w, rows } = route, step = rows[k - 1];
  if (!step || step.cmd.verb !== 'go') return null;
  const ex0 = mod.render.exitsOf(w, step.pre.pos), e0 = w.edges[ex0[step.cmd.dir]];
  if (!e0 || e0.kind !== 'oneway' || e0.from !== step.pre.pos) return null;
  const back = OPPOSITE[step.cmd.dir];
  return { op: 'one-way-return', action: `go ${back}`, expect: { kind: 'enter', room: roomName(w, step.pre.pos) }, truth: { kind: 'enter', cell: step.pre.pos }, detail: { direction: back, style: e0.style } };
}

// Run one proposal from the state after k route steps: the environment's answer and the label.
export function runProposal(mod, route, k, prop) {
  const wk = route.walker;
  wk.restore(route.snaps[k]);
  const step = wk.step(prop.action), ok = holds(mod, route.W, prop.truth, step.pre, step.post);
  return { ...step, ...prop, k, ok, label: ok ? 'as_expected' : 'drifted' };
}

// The sentence the state shows and the observation, with the renderings every row shares.
export function sentenceOf(expect, feature) { return describeExpectation(feature ? { ...expect, feature } : expect); }

// ---- fixtures and descriptions of the believed room ---------------------------------------------------------------------------
export function featureFor(mod, route, cell, key) {
  const { w } = route, nouns = [...new Set(fixturesOf(w, cell))];
  return pickBy(nouns, key);
}
export const descriptionHas = (description, noun) => new RegExp(`\\b${noun}\\b`).test(description);

// ---- text surgery on an observation (counterfactual re-renders; labels do not change) ----------------------------------------------
export function withHeader(observation, name) {
  const lines = observation.split('\n');
  lines[0] = `[${name.charAt(0).toUpperCase()}${name.slice(1)}]`;
  return lines.join('\n');
}
export function withLastAction(observation, text) {
  return observation.split('\n').map(l => (/^Last action: /.test(l) ? `Last action: ${text}` : l)).join('\n');
}
// sentences of the description, reordered (a cosmetic change: the room is the same)
export function permuteDescription(observation, key) {
  const o = parseObservation(observation), s = descriptionSentences(o.description);
  if (s.length < 3) return null;
  const rest = shuffled(s.slice(1).map((x, i) => ({ x, i })), key).map(r => r.x), out = [s[0], ...rest];
  if (out.join(' ') === s.join(' ')) return null;
  const lines = observation.split('\n'), carry = lines.findIndex(l => /^You are carrying /.test(l));
  return [lines[0], out.join(' '), ...lines.slice(carry - 1)].join('\n');
}
// a sentence inserted at a sentence boundary of the description
export function insertSentence(observation, sentence, key) {
  const o = parseObservation(observation), s = descriptionSentences(o.description), at = hnum(`${key}|at`) % (s.length + 1);
  const out = [...s.slice(0, at), sentence, ...s.slice(at)];
  const lines = observation.split('\n'), carry = lines.findIndex(l => /^You are carrying /.test(l));
  return [lines[0], out.join(' '), ...lines.slice(carry - 1)].join('\n');
}
export const replaceSentence = (observation, from, to) => {
  const o = parseObservation(observation), s = descriptionSentences(o.description), hits = s.filter(x => x === from).length;
  if (hits !== 1) return null;
  const out = s.map(x => (x === from ? to : x));
  const lines = observation.split('\n'), carry = lines.findIndex(l => /^You are carrying /.test(l));
  return [lines[0], out.join(' '), ...lines.slice(carry - 1)].join('\n');
};

export { lowerFirst, parseObservation, descriptionSentences };

// ================================================================================================================
// Q1 room_exit: the labeller (JUDGE-PROGRAM.md §1.2 Q1) and its second code path
// ================================================================================================================
const headerOf = obs => /^\[(.+)\]/.exec(obs)?.[1] ?? null;
// First path: the environment itself. createEnv with the lifetime ledger LIFTED (the default cap is the task budget
// and restore() does not refund it, so the revision-1 labeller stopped part-way, §1.2 Q1); the lift is explicit and
// logged. For every direction: snapshot, step(go <direction>), did the room change?, restore.
// The log records the option as passed and the limit the environment itself reports on every probe (info.lifetimeLimit of
// the bed's ledger), so "lifted" is evidence, not a constant.
export function probeExits(mod, task, k, log = []) {
  const W = mod.index._internal.world(task);
  const ledger = { lifetimeActions: Infinity };
  const env = mod.index.createEnv(task, ledger);
  env.reset();
  for (const a of W.solution.slice(0, k)) env.step(a);
  const observation = env.observe(), head = headerOf(observation), labels = {}, envLimits = new Set();
  let probes = 0;
  for (const d of DIRECTIONS) {
    const snap = env.snapshot(), r = env.step(`go ${d}`);
    if (r.info?.lifetimeLimit !== undefined) envLimits.add(String(r.info.lifetimeLimit));
    labels[d] = headerOf(r.observation) !== head ? 'yes' : 'no';
    env.restore(snap);
    probes++;
  }
  const entry = { task: task.id, k, lifetimeActions: String(ledger.lifetimeActions), envLimit: envLimits.size === 1 ? [...envLimits][0] : envLimits.size ? [...envLimits].join('|') : null,
    lifted: ledger.lifetimeActions === Infinity, probes, spent: env.spent() };
  log.push(entry);
  return { observation, labels, ledger: entry };
}
// Second path: the world structure (_internal.world(task).w.edges) with the dynamic state (position, unlocked
// doors, mechanisms) read from the ABSTRACT model of the bed (solver.mjs simulate over state bits), so neither the
// engine's parser nor its observation text is involved.
export function exitsByEdges(mod, task, k) {
  const W = mod.index._internal.world(task), w = W.w, m = W.model, s = mod.solver.simulate(m, W.solution.slice(0, k)).state;
  const cell = s & 63, ex = mod.render.exitsOf(w, cell), bitAt = (o, i) => (s >>> (o + i)) & 1, labels = {};
  for (const d of DIRECTIONS) {
    const ei = ex[d];
    if (ei === undefined) { labels[d] = 'no'; continue; }
    const e = w.edges[ei];
    labels[d] = e.kind === 'open' ? 'yes' : e.kind === 'door' ? (bitAt(m.oD, e.door) ? 'yes' : 'no') : e.kind === 'mech' ? (bitAt(m.oM, e.mech) ? 'yes' : 'no') : e.kind === 'oneway' ? (e.from === cell ? 'yes' : 'no') : 'no';
  }
  return { cell, labels };
}

// ================================================================================================================
// Q2 container_cue: the sentence that describes a fixed object, aligned with the object by its own indefinite phrase
// ================================================================================================================
const an = word => (/^[aeiou]/i.test(word) && !/^one\b/i.test(word) ? `an ${word}` : `a ${word}`);
const escapeRe = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function roomObservation(mod, W, cell, last = 'You go north.') {
  const w = W.w, st = { pos: cell, inv: [], revealed: [], unlocked: [], mech: w.mechs.map(m => m.open0), swCount: w.switches.map(() => 0), steps: 0, won: false };
  return mod.render.observationText(w, st, W.budget, last);
}
// every fixed object of the world with its sentence: { cell, object, kind: 'hide'|'fake'|'plain'|'decor', cued, sentence, observation } or { aligned: false }
export function containerSentences(mod, task) {
  const W = mod.index._internal.world(task), w = W.w, out = [], stats = { objects: 0, aligned: 0, missing: 0, ambiguous: 0 };
  for (let cell = 0; cell < w.n * w.n; cell++) {
    const observation = roomObservation(mod, W, cell), sentences = descriptionSentences(parseObservation(observation).description);
    for (const o of w.objects.filter(x => x.room === cell)) {
      stats.objects++;
      const re = new RegExp(`\\b${escapeRe(an(`${o.adj} ${o.noun}`))}\\b`, 'i'), hits = sentences.filter(s => re.test(s));
      if (hits.length === 0) { stats.missing++; continue; }
      if (hits.length > 1) { stats.ambiguous++; continue; }
      stats.aligned++;
      out.push({ cell, object: o, kind: o.kind, cued: o.cue !== undefined, sentence: hits[0], observation, noun: o.noun });
    }
  }
  return { items: out, stats };
}

// ================================================================================================================
// Q3: the equally optimal next actions (BFS over the abstract model, from any state)
// ================================================================================================================
export function remainingMoves(mod, m, s0) {
  const { successors } = mod.solver, pos = s => s & 63, prev = new Set([s0]);
  let frontier = [s0], d = 0;
  const buf = [];
  while (frontier.length) {
    d++;
    const next = [];
    for (const s of frontier) {
      if (pos(s) === m.T) return d;                    // take treasure
      for (const [, t] of successors(m, s, buf)) if (!prev.has(t)) { prev.add(t); next.push(t); }
    }
    frontier = next;
  }
  return Infinity;
}
// the canonical actions after which the shortest win is one shorter: the reference solver's equally good next actions
export function bestActions(mod, W, st) {
  const m = W.model, { successors } = mod.solver;
  // abstract state bits from the engine state: position, keys held, hides searched, doors unlocked, mechanisms
  let s = st.pos | (st.mech.reduce((b, o, i) => (o ? b | (1 << i) : b), 0) << m.oM);
  m.keyName.forEach((name, k) => { if (st.inv.some(id => mod.render.itemName(W.w, id) === name && id === `key:${k}`)) s |= 1 << (m.oK + k); });
  st.revealed.forEach(h => { s |= 1 << (m.oH + h); });
  st.unlocked.forEach(dr => { s |= 1 << (m.oD + dr); });
  const here = remainingMoves(mod, m, s), out = [];
  if ((s & 63) === m.T) out.push('take treasure');
  const buf = [];
  for (const [a, t] of successors(m, s, buf).map(x => [x[0], x[1]])) if (remainingMoves(mod, m, t) === here - 1) out.push(a);
  return out;
}
