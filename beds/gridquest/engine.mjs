// Concrete game engine for `gridquest`: parser, state transitions, observations and the
// interactive env API. Deterministic (D0): no randomness after generation, no clock.
import { DIRS, ONEWAY_STYLES, SWITCH_VERB, EMPTY_CONTAINER, ALIASES, an, capFirst } from './text.mjs';
import { observationText, itemName, exitsOf } from './render.mjs';

const DIR_ALIASES = {
  n: 'north', north: 'north', northward: 'north', northwards: 'north',
  s: 'south', south: 'south', southward: 'south', southwards: 'south',
  e: 'east', east: 'east', eastward: 'east', eastwards: 'east',
  w: 'west', west: 'west', westward: 'west', westwards: 'west',
};
const ARTICLES = new Set(['the', 'a', 'an', 'to', 'some']);

export const norm = raw => String(raw).toLowerCase().replace(/[^a-z0-9\- ]+/g, ' ').replace(/\s+/g, ' ').trim();
const stripArticles = phrase => phrase.split(' ').filter(x => !ARTICLES.has(x)).join(' ');

export function parse(raw) {
  if (typeof raw !== 'string') return { verb: 'invalid' };
  const s = norm(raw);
  if (!s) return { verb: 'invalid' };
  if (DIR_ALIASES[s]) return { verb: 'go', dir: DIR_ALIASES[s] };
  if (s === 'look' || s === 'l' || s === 'look around') return { verb: 'look' };
  let m;
  if ((m = s.match(/^(?:go|walk|move|head|travel|run|climb|slide)\s+(.+)$/))) {
    const d = DIR_ALIASES[stripArticles(m[1]).replace(/^toward(s)? /, '')];
    return d ? { verb: 'go', dir: d } : { verb: 'go', dir: null, phrase: m[1] };
  }
  if ((m = s.match(/^(?:take|get|grab|pick up|pickup|collect)\s+(.+)$/))) return { verb: 'take', thing: stripArticles(m[1]) };
  if ((m = s.match(/^(?:examine|inspect|x|look at|look in|search|check|study)\s+(.+)$/))) return { verb: 'examine', thing: stripArticles(m[1]) };
  if ((m = s.match(/^(?:toggle|pull|push|turn|flip|throw|operate|crank|spin|wind|haul)\s+(.+)$/))) return { verb: 'toggle', thing: stripArticles(m[1]) };
  if ((m = s.match(/^use\s+(.+?)\s+(?:on|with|in|into)\s+(.+)$/))) return { verb: 'use', item: stripArticles(m[1]), thing: stripArticles(m[2]) };
  if ((m = s.match(/^unlock\s+(.+?)\s+with\s+(.+)$/))) return { verb: 'use', item: stripArticles(m[2]), thing: stripArticles(m[1]) };
  return { verb: 'invalid' };
}

export function initialState(w) {
  return { pos: w.start, inv: [], revealed: [], unlocked: [], mech: w.mechs.map(m => m.open0), swCount: w.switches.map(() => 0), steps: 0, won: false };
}

function visibleItems(w, st, cell) {
  const out = [];
  w.keys.forEach((k, i) => {
    if (k.room !== cell || st.inv.includes(`key:${i}`)) return;
    if (k.hide >= 0 && !st.revealed.includes(k.hide)) return;
    out.push(`key:${i}`);
  });
  w.decoys.forEach((x, i) => { if (x.room === cell && !st.inv.includes(`decoy:${i}`)) out.push(`decoy:${i}`); });
  if (cell === w.treasure && !st.won) out.push('treasure');
  return out;
}

// Things in the room addressable by name. Each entry: { names: [...], type, ref, dir? }.
function thingsIn(w, st, cell) {
  const things = [];
  w.objects.forEach((o, i) => { if (o.room === cell) things.push({ names: [o.noun, `${o.adj} ${o.noun}`, ...ALIASES[o.noun]], type: 'object', ref: i }); });
  w.switches.forEach((s, i) => { if (s.room === cell) things.push({ names: [s.noun, `${s.adj} ${s.noun}`, ...ALIASES[s.noun]], type: 'switch', ref: i }); });
  const ex = exitsOf(w, cell);
  const doorCount = DIRS.filter(d => ex[d] !== undefined && w.edges[ex[d]].kind === 'door').length;
  for (const d of DIRS) {
    if (ex[d] === undefined) continue;
    const e = w.edges[ex[d]];
    if (e.kind === 'door') {
      const color = w.doors[e.door].color;
      things.push({ names: [`${d} door`, `${color} door`, `${d} ${color} door`, `${color} ${d} door`, ...(doorCount === 1 ? ['door'] : [])], type: 'door', ref: e.door, dir: d, canonical: `${d} door` });
    } else if (e.kind === 'mech') {
      const t = w.mechs[e.mech].type;
      const nouns = t === 'bridge' ? ['bridge', 'drawbridge', 'chasm', 'gorge'] : ['portcullis', 'gate', 'grille'];
      things.push({ names: nouns.flatMap(x => [`${d} ${x}`, x]), type: t, ref: e.mech, dir: d });
    } else if (e.kind === 'oneway') {
      const style = ONEWAY_STYLES[e.style].name;
      things.push({ names: [`${d} ${style}`, style], type: 'oneway', ref: ex[d], dir: d });
    }
  }
  return things;
}

function resolve(list, phrase) {
  const hits = list.filter(t => t.names.includes(phrase));
  return hits.length ? hits[0] : null;
}

// Message for a phrase that names nothing here; a bare noun shared by several things is ambiguous.
function missing(w, st, phrase) {
  const sharing = thingsIn(w, st, st.pos).filter(t => t.names.some(n => n.endsWith(` ${phrase}`)));
  if (sharing.length >= 2) return `Which ${phrase} do you mean? Name it more exactly, for example "${sharing[0].canonical || sharing[0].names[0]}".`;
  return `You see no ${phrase} here.`;
}

function itemEntries(w, ids) {
  return ids.map(id => {
    const name = itemName(w, id);
    const names = [name];
    if (id === 'treasure') names.push('the treasure');
    return { names, type: 'item', ref: id };
  });
}

function resolveItem(w, ids, phrase) {
  const entries = itemEntries(w, ids);
  const hit = resolve(entries, phrase);
  if (hit) return hit;
  // Bare "key" resolves only when exactly one key-like item matches.
  if (phrase === 'key') {
    const keys = entries.filter(x => x.names[0].endsWith(' key'));
    if (keys.length === 1) return keys[0];
  }
  return null;
}

const roomName = (w, c) => w.rooms[c].name;
function mechMessage(w, st, mi) {
  const m = w.mechs[mi], e = w.edges[m.edge];
  const a = e.a === st.pos ? 'here' : roomName(w, e.a), b = e.b === st.pos ? 'here' : roomName(w, e.b);
  const between = `between ${a} and ${b}`;
  const open = st.mech[mi];
  if (m.type === 'bridge') return open ? `Far off, chains rattle and a bridge swings down across the chasm ${between}.` : `Far off, the bridge ${between} hauls itself back up with a groan.`;
  return open ? `With a shriek of chains, the portcullis ${between} rises.` : `With a distant crash, the portcullis ${between} drops shut.`;
}

// Apply one action to a state (mutates). Returns { result, outcome }.
export function applyAction(w, st, raw) {
  const cmd = parse(raw);
  const here = st.pos;
  switch (cmd.verb) {
    case 'look': return { result: 'You look around.', outcome: 'ok' };
    case 'go': {
      if (!cmd.dir) return { result: 'Which way? Directions are north, south, east and west.', outcome: 'invalid' };
      const ex = exitsOf(w, here);
      const ei = ex[cmd.dir];
      if (ei === undefined) return { result: `There is no way to go ${cmd.dir} from here.`, outcome: 'blocked' };
      const e = w.edges[ei];
      const to = e.a === here ? e.b : e.a;
      if (e.kind === 'door' && !st.unlocked.includes(e.door)) return { result: `The ${w.doors[e.door].color} door is locked.`, outcome: 'blocked' };
      if (e.kind === 'mech' && !st.mech[e.mech]) {
        return { result: w.mechs[e.mech].type === 'bridge' ? 'The chasm is far too wide to jump, and the bridge is up.' : 'The portcullis is down; you cannot pass.', outcome: 'blocked' };
      }
      if (e.kind === 'oneway' && e.from !== here) return { result: ONEWAY_STYLES[e.style].blocked, outcome: 'blocked' };
      st.pos = to;
      const extra = e.kind === 'oneway' ? ` You pass the ${ONEWAY_STYLES[e.style].name}; there is no way back through it.` : '';
      return { result: `You go ${cmd.dir}.${extra}`, outcome: 'ok' };
    }
    case 'take': {
      const vis = visibleItems(w, st, here);
      const it = resolveItem(w, vis, cmd.thing);
      if (it) {
        if (it.ref === 'treasure') {
          st.won = true;
          return { result: `You lift ${w.treasureDesc} from its resting place. The treasure is yours!`, outcome: 'won' };
        }
        st.inv.push(it.ref);
        return { result: `You pick up the ${itemName(w, it.ref)}.`, outcome: 'ok' };
      }
      if (cmd.thing === 'treasure') {
        return { result: w.fakeTreasureRooms.includes(here) ? 'There is only talk and pictures of treasure here, nothing to take.' : 'There is no treasure here.', outcome: 'failed' };
      }
      if (resolveItem(w, st.inv, cmd.thing)) return { result: 'You already have that.', outcome: 'failed' };
      const th = resolve(thingsIn(w, st, here), cmd.thing);
      if (th) return { result: th.type === 'object' ? `The ${w.objects[th.ref].noun} is not something you can carry off.` : 'That is fixed in place.', outcome: 'failed' };
      return { result: missing(w, st, cmd.thing), outcome: 'failed' };
    }
    case 'examine': {
      const th = resolve(thingsIn(w, st, here), cmd.thing);
      if (th) return { result: examineThing(w, st, th), outcome: 'ok' };
      const it = resolveItem(w, [...st.inv, ...visibleItems(w, st, here)], cmd.thing);
      if (it) {
        const [kind, i] = it.ref.split(':');
        if (kind === 'key') return { result: `A small ${w.keys[+i].color} key.`, outcome: 'ok' };
        if (kind === 'decoy') return { result: w.decoys[+i].ex, outcome: 'ok' };
        return { result: `It is ${w.treasureDesc}. The treasure!`, outcome: 'ok' };
      }
      return { result: missing(w, st, cmd.thing), outcome: 'failed' };
    }
    case 'toggle': {
      const th = resolve(thingsIn(w, st, here), cmd.thing);
      if (!th) return { result: missing(w, st, cmd.thing), outcome: 'failed' };
      if (th.type === 'switch') {
        const s = w.switches[th.ref];
        st.swCount[th.ref]++;
        const msgs = s.targets.map(mi => { st.mech[mi] = !st.mech[mi]; return mechMessage(w, st, mi); });
        return { result: `You ${SWITCH_VERB[s.noun][0]} the ${s.noun}. ${msgs.join(' ')}`, outcome: 'ok' };
      }
      if (th.type === 'door') return { result: 'Doors here open with keys, not by fiddling with them.', outcome: 'failed' };
      if (th.type === 'bridge' || th.type === 'gate') return { result: 'You cannot work that by hand; there must be a mechanism somewhere.', outcome: 'failed' };
      if (th.type === 'object') return { result: `You fiddle with the ${w.objects[th.ref].noun}, but nothing happens.`, outcome: 'failed' };
      return { result: 'Nothing happens.', outcome: 'failed' };
    }
    case 'use': {
      const it = resolveItem(w, st.inv, cmd.item);
      if (!it) return { result: `You are not carrying any ${cmd.item}.`, outcome: 'failed' };
      const th = resolve(thingsIn(w, st, here), cmd.thing);
      if (!th) return { result: missing(w, st, cmd.thing), outcome: 'failed' };
      if (th.type !== 'door') return { result: 'Nothing happens.', outcome: 'failed' };
      const door = w.doors[th.ref];
      if (st.unlocked.includes(th.ref)) return { result: 'That door is already unlocked.', outcome: 'failed' };
      if (it.ref === `key:${door.key}`) {
        st.unlocked.push(th.ref);
        return { result: `The ${door.color} key turns with a heavy clunk. The ${th.dir} door is unlocked.`, outcome: 'ok' };
      }
      return { result: `The ${itemName(w, it.ref)} does not fit the lock of the ${th.dir} door.`, outcome: 'failed' };
    }
    default:
      return { result: `I don't understand "${String(raw).slice(0, 80)}". Try: go <direction>, take <item>, use <item> on <thing>, toggle <thing>, examine <thing>, look.`, outcome: 'invalid' };
  }
}

function examineThing(w, st, th) {
  if (th.type === 'object') {
    const o = w.objects[th.ref];
    if (o.kind === 'hide') {
      if (st.revealed.includes(o.hide)) return `The ${o.noun} is empty now.`;
      st.revealed.push(o.hide);
      const k = w.keys[w.hides[o.hide].key];
      return `You search the ${o.noun} carefully and find ${an(`${k.color} key`)} tucked inside!`;
    }
    if (o.kind === 'fake' || o.kind === 'plain') return EMPTY_CONTAINER[o.emptyV](o.noun);
    return o.exText;
  }
  if (th.type === 'switch') {
    const s = w.switches[th.ref];
    const moved = st.swCount[th.ref] % 2 === 1;
    return `${capFirst(an(`${s.adj} ${s.noun}`))}. ${moved ? `It has been ${SWITCH_VERB[s.noun][1]} from where you found it.` : 'It is just as you found it.'} Whatever it works is not in this room.`;
  }
  if (th.type === 'door') {
    const dr = w.doors[th.ref];
    return `A ${dr.mat} door with a ${dr.color} lock. It is ${st.unlocked.includes(th.ref) ? 'unlocked' : 'locked'}.`;
  }
  if (th.type === 'bridge') return `A drawbridge over a deep chasm. It is ${st.mech[th.ref] ? 'lowered across the gap' : 'raised out of reach'}. It must be worked from elsewhere.`;
  if (th.type === 'gate') return `A heavy iron portcullis. It is ${st.mech[th.ref] ? 'raised' : 'down'}. There is no way to lift it by hand.`;
  const e = w.edges[th.ref];
  return e.from === st.pos ? `It only goes one way: away from here, ${th.dir}.` : 'It only goes one way, and not from this side.';
}

// Syntactically legal actions for the current room, sorted and de-duplicated so that neither
// the order nor the membership reveals what anything is: every fixed object and switch gets
// take/examine/toggle, doors are offered in all four directions whether or not a door exists,
// and "take treasure" is always offered while the game is running. Visible and held items are
// listed by name (they are named in the prose too).
export function legalActions(w, st) {
  if (st.won) return [];
  const here = st.pos;
  const fixed = [...w.objects.filter(o => o.room === here).map(o => o.noun), ...w.switches.filter(s => s.room === here).map(s => s.noun)];
  const visible = visibleItems(w, st, here).filter(id => id !== 'treasure').map(id => itemName(w, id));
  const held = st.inv.map(id => itemName(w, id));
  const doors = DIRS.map(d => `${d} door`);
  const out = new Set(['look', 'take treasure', ...DIRS.map(d => `go ${d}`), ...doors.map(d => `examine ${d}`)]);
  for (const n of fixed) for (const v of ['examine', 'take', 'toggle']) out.add(`${v} ${n}`);
  for (const n of visible) { out.add(`take ${n}`); out.add(`examine ${n}`); }
  for (const n of held) { out.add(`examine ${n}`); for (const t of [...fixed, ...doors]) out.add(`use ${n} on ${t}`); }
  return [...out].sort();
}

export function makeEnv(w, budget) {
  let st, last;
  const clone = x => JSON.parse(JSON.stringify(x));
  const observe = () => observationText(w, st, budget, last);
  const done = () => st.won || st.steps >= budget;
  const env = {
    determinism: 'D0',
    reset() {
      st = initialState(w);
      last = `You slip into ${w.keep} through a broken postern and find yourself somewhere inside. Find the treasure.`;
      return observe();
    },
    step(action) {
      if (done()) return { observation: observe(), done: true, reward: st.won ? 1 : 0, info: { ignored: true, steps: st.steps, budget, outcome: 'ignored' } };
      st.steps++;
      const { result, outcome } = applyAction(w, st, action);
      last = result;
      const fin = done();
      return { observation: observe(), done: fin, reward: st.won ? 1 : 0, info: { steps: st.steps, budget, outcome } };
    },
    observe,
    // Host-side only: plain, readable state copies. The public env (index.mjs createEnv) seals
    // them; never hand these to a solver.
    snapshot: () => clone({ st, last }),
    restore(snap) { const s = clone(snap); st = s.st; last = s.last; },
    actions: () => (done() ? [] : legalActions(w, st)),
    _state: () => clone(st),
  };
  env.reset();
  return env;
}

