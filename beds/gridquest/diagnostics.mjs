// Diagnostic baseline for `gridquest` (not part of the bed interface): a keyword-heuristic
// agent that only reads observation text, the way a short script would. It treats any
// sentence that names a compass direction as a possible exit, takes anything called "key",
// examines objects described with a trailing clause, pulls every lever-like noun once, tries
// held keys on locked doors whose colour it recognises, and grabs "treasure" whenever the word
// appears. It explores depth-first over room names. Used to show how much the prose needs
// judgment: see README "Baselines".
import { COLORS } from './text.mjs';

const DIRW = { north: 'north', northern: 'north', northward: 'north', south: 'south', southern: 'south', southward: 'south', east: 'east', eastern: 'east', eastward: 'east', west: 'west', western: 'west', westward: 'west' };
const SWITCH = ['lever', 'wheel', 'crank', 'winch', 'handle', 'chain'];
const BACK = { north: 'south', south: 'north', east: 'west', west: 'east' };

export function keywordAgent(env, maxSteps) {
  const actions = [];
  const map = new Map(); // room -> { tried: Set(dir), links: Map(dir -> room), done: Set(action) }
  let obs = env.reset().observation;
  const inv = new Set();
  const parse = o => {
    const name = o.split('\n')[0];
    const desc = o.split('\n')[1] || '';
    return { name, desc, sentences: desc.split(/(?<=[.!?])\s+/) };
  };
  const room = name => { if (!map.has(name)) map.set(name, { tried: new Set(), links: new Map(), done: new Set() }); return map.get(name); };
  const act = a => { actions.push(a); const r = env.step(a); obs = r.observation; return r; };
  let prev = null, prevDir = null;
  while (actions.length < maxSteps) {
    const { name, desc, sentences } = parse(obs);
    const R = room(name);
    if (prev && prevDir && prev !== name) { room(prev).links.set(prevDir, name); R.links.set(BACK[prevDir], prev); }
    prev = name; prevDir = null;
    const todo = [];
    if (/treasure/i.test(desc)) todo.push('take treasure');
    for (const m of desc.toLowerCase().matchAll(/\b(?:an?|the)\s+([a-z-]+) key\b/g)) if (!inv.has(m[1])) todo.push(`take ${m[1]} key`);
    for (const [si, s0] of sentences.entries()) {
      const s = s0;
      const m = s.match(/\b(?:a|an)\s+(?:[a-z-]+\s+)?([a-z]+)\b[^;]*;/i);
      if (m) todo.push(`examine ${m[1]}`);
      for (const sw of SWITCH) if (new RegExp(`\\b${sw}\\b`).test(s)) todo.push(`toggle ${sw}`);
      const s2 = `${s} ${sentences[si + 1] || ''}`; // "...door... It is locked."
      if (/door/.test(s) && /locked|shut fast|will not budge/.test(s2)) {
        const color = COLORS.find(c => s.includes(c) && inv.has(c));
        const dir = Object.keys(DIRW).find(dw => new RegExp(`\\b${dw}\\b`).test(s));
        if (color && dir) todo.push(`use ${color} key on ${DIRW[dir]} door`);
      }
    }
    const next = todo.find(a => !R.done.has(a));
    if (next) {
      R.done.add(next);
      const r = act(next);
      if (r.done) break;
      const m = next.match(/^take ([a-z-]+) key$/);
      if (m && /You pick up/.test(obs)) inv.add(m[1]);
      continue;
    }
    // Candidate exits: every direction word in the description.
    R.cands = [];
    for (const m of desc.matchAll(/\b(north|northern|northward|south|southern|southward|east|eastern|eastward|west|western|westward)\b/g)) if (!R.cands.includes(DIRW[m[1]])) R.cands.push(DIRW[m[1]]);
    const open = C => (C.cands || []).filter(d => !C.tried.has(d));
    let dir = open(R)[0];
    if (!dir) {
      // Walk toward the nearest known room that still has untried candidate directions.
      const q = [[name, null]], seen = new Set([name]);
      for (let i = 0; i < q.length && !dir; i++) {
        const [cur, first] = q[i];
        if (cur !== name && open(room(cur)).length) { dir = first; break; }
        for (const [d, to] of room(cur).links) if (!seen.has(to)) { seen.add(to); q.push([to, first || d]); }
      }
      if (!dir) break;
    }
    R.tried.add(dir);
    prevDir = dir;
    const r = act(`go ${dir}`);
    if (r.done) break;
  }
  return { actions };
}
