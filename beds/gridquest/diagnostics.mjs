// Diagnostic baselines and attacks for `gridquest` (oracle-side; never part of a solver's
// context). Unless marked otherwise they read only what a solver sees (observations,
// actions(), step info) and exist to show what the bed does NOT reward. See AUDIT.md.
//   keywordAgent        v1 diagnostic: every direction word is an exit (weak by design)
//   blindAgent          no exit parsing: actions() + room header + feedback, tries every wall
//   regexAgent          40-line function tuned with full knowledge of the v1 (1.0.0) templates
//   regexAgentV2        40-line function tuned to the v2 templates (landmarks by noun, fake and
//                       reopened exits, placement paraphrases) but with no synonym table
//   templateAwareAgent  46-line function that IMPORTS the bed's own alias table and hard-codes
//                       every placement template: a white-box upper bound, not a fair baseline
//   snapshotSearch      blind breadth-first search through snapshot()/restore()
// Line counts are physical lines of each exported function; module-level regex tables are noted.
import { COLORS, ALIASES } from './text.mjs';

const BACK = { north: 'south', south: 'north', east: 'west', west: 'east' };

// --- keywordAgent (v1 diagnostic, unchanged) ---
const DIRW = { north: 'north', northern: 'north', northward: 'north', south: 'south', southern: 'south', southward: 'south', east: 'east', eastern: 'east', eastward: 'east', west: 'west', western: 'west', westward: 'west' };
const SWITCH = ['lever', 'wheel', 'crank', 'winch', 'handle', 'chain'];
export function keywordAgent(env, maxSteps) {
  const actions = [];
  const map = new Map();
  let obs = env.reset().observation;
  const inv = new Set();
  const parse = o => { const desc = o.split('\n')[1] || ''; return { name: o.split('\n')[0], desc, sentences: desc.split(/(?<=[.!?])\s+/) }; };
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
    for (const [si, s] of sentences.entries()) {
      const m = s.match(/\b(?:a|an)\s+(?:[a-z-]+\s+)?([a-z]+)\b[^;]*;/i);
      if (m) todo.push(`examine ${m[1]}`);
      for (const sw of SWITCH) if (new RegExp(`\\b${sw}\\b`).test(s)) todo.push(`toggle ${sw}`);
      const s2 = `${s} ${sentences[si + 1] || ''}`;
      if (/door/.test(s) && /locked|shut fast|will not budge/.test(s2)) {
        const color = COLORS.find(c => s.includes(c) && inv.has(c));
        const dir = Object.keys(DIRW).find(dw => new RegExp(`\\b${dw}\\b`).test(s));
        if (color && dir) todo.push(`use ${color} key on ${DIRW[dir]} door`);
      }
    }
    const next = todo.find(a => !R.done.has(a));
    if (next) {
      R.done.add(next);
      if (act(next).done) break;
      const m = next.match(/^take ([a-z-]+) key$/);
      if (m && /You pick up/.test(obs)) inv.add(m[1]);
      continue;
    }
    R.cands = [];
    for (const m of desc.matchAll(/\b(north|northern|northward|south|southern|southward|east|eastern|eastward|west|western|westward)\b/g)) if (!R.cands.includes(DIRW[m[1]])) R.cands.push(DIRW[m[1]]);
    const open = C => (C.cands || []).filter(d => !C.tried.has(d));
    let dir = open(R)[0];
    if (!dir) {
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
    if (act(`go ${dir}`).done) break;
  }
  return { actions };
}

// --- blindAgent (no exit parsing; 31-line function) ---
export function blindAgent(env, budget) {
  const map = new Map(), acts = [];
  let obs = env.reset().observation, prev = null, prevDir = null;
  const R = n => (map.has(n) || map.set(n, { tried: new Set(), links: new Map(), done: new Set() }), map.get(n));
  const act = a => { acts.push(a); const r = env.step(a); obs = r.observation; return r; };
  while (acts.length < budget) {
    const name = obs.split('\n')[0], room = R(name), legal = env.actions();
    if (prev !== null && prevDir && prev !== name) R(prev).links.set(prevDir, name);
    prev = name; prevDir = null;
    if (/rests the treasure|treasure you came for|at last is the treasure/.test(obs)) { act('take treasure'); break; }
    const objs = legal.filter(a => /^examine /.test(a) && !/ door$| key$/.test(a));
    const todo = [...legal.filter(a => /^take .* key$/.test(a)), ...objs.slice(0, 1),
      ...legal.filter(a => /^toggle (lever|wheel|crank|winch|handle|chain)$/.test(a)),
      ...legal.filter(a => /^use .* key on \w+ door$/.test(a))].filter(a => !room.done.has(a));
    if (todo.length) { room.done.add(todo[0]); if (act(todo[0]).done) break; continue; }
    const open = n => ['north', 'east', 'south', 'west'].filter(d => !R(n).tried.has(d));
    let dir = open(name)[0];
    if (!dir) {
      const q = [[name, null]], seen = new Set([name]);
      for (let i = 0; i < q.length && !dir; i++) {
        const [cur, first] = q[i];
        if (cur !== name && open(cur).length) { dir = first; break; }
        for (const [d, to] of R(cur).links) if (!seen.has(to)) { seen.add(to); q.push([to, first || d]); }
      }
      if (!dir) { for (const v of map.values()) { v.tried.clear(); v.done.clear(); } dir = open(name)[0]; }
    }
    room.tried.add(dir); prevDir = dir;
    if (act(`go ${dir}`).done) break;
  }
  return { actions: acts };
}

// --- regexAgent (tuned to the v1 templates; 40-line function + 5 table lines) ---
const DW1 = { north: 'north', northern: 'north', northward: 'north', 'pole star': 'north', 'pole-star': 'north', south: 'south', southern: 'south', southward: 'south', 'noonday sun': 'south', 'noon-sun': 'south', east: 'east', eastern: 'east', eastward: 'east', sunrise: 'east', west: 'west', western: 'west', westward: 'west', sunset: 'west' };
const DRE1 = /\b(north(?:ern|ward)?|south(?:ern|ward)?|east(?:ern|ward)?|west(?:ern|ward)?|pole[ -]star|noon(?:day sun|-sun)|sunrise|sunset)\b/g;
const EXIT1 = /archway|passage|corridor|gap|steps|opening|arch\b|doorway|crack|door|bridge|chasm|rift|gorge|portcullis|chute|ledge|turnstile|hatch|ways stand open/;
const closed1 = s => (/door\b/.test(s) && !/doorway|unlocked|ajar|hangs open/.test(s)) || (/bridge|chasm|rift|gorge/.test(s) && !/now spans|lowered drawbridge/.test(s))
  || (/portcullis/.test(s) && !/is raised|winched up/.test(s)) || /too slick|no way up|locked against you|no handle on this side/.test(s);
export function regexAgent(env, budget) {
  const M = new Map(), acts = [], inv = new Set();
  let obs = env.reset().observation, prev = null, pd = null, stuck = 0;
  const R = n => (M.has(n) || M.set(n, { ex: {}, links: {}, done: new Set(), blocked: new Set(), dc: {} }), M.get(n));
  const act = a => { acts.push(a); const r = env.step(a); obs = r.observation; if (/You pick up the (\w+) key/.test(obs)) inv.add(RegExp.$1); if (/^toggle/.test(a)) for (const v of M.values()) v.blocked.clear(); return r; };
  while (acts.length < budget) {
    const [head, desc] = obs.split('\n'), room = R(head), todo = []; room.ex = {};
    if (prev && pd) { if (prev !== head) { R(prev).links[pd] = head; room.links[BACK[pd]] = prev; } else R(prev).blocked.add(pd); }
    prev = head; pd = null;
    const sents = desc.toLowerCase().split(/(?<=[.!?])\s+/);
    sents.forEach((s, i) => {
      if (/"/.test(s)) return;
      const s2 = /^it is/.test(sents[i + 1] || '') ? `${s} ${sents[i + 1]}` : s;
      if (/(rests the treasure|at last is the treasure|treasure you came for)/.test(s)) todo.push('take treasure');
      for (const m of s.matchAll(/\b(\w+) key\b/g)) if (COLORS.includes(m[1]) && !inv.has(m[1]) && !/door|lock/.test(s)) todo.push(`take ${m[1]} key`);
      const cue = s.match(/\b(urn|chest|coffer|vase|barrel|crate|satchel|jar|cauldron|boot|cushion|nest)\b[^;]*;/); if (cue) todo.push(`examine ${cue[1]}`);
      const sw = s.match(/\b(lever|wheel|crank|winch|handle|chain)\b/); if (sw) todo.push(`toggle ${sw[1]}`);
      if (!EXIT1.test(s) || /no way through|window|compass|wall bears|bare stone/.test(s)) return;
      const color = COLORS.find(c => s.includes(c));
      for (const d of [...s.matchAll(DRE1)].map(m => DW1[m[1]])) {
        if (/door\b/.test(s) && closed1(s2) && color && inv.has(color)) todo.push(`use ${color} key on ${d} door`);
        if (/door\b/.test(s) && closed1(s2) && color) room.dc[d] = color; else delete room.dc[d];
        room.ex[d] = closed1(s2) ? 'closed' : /no climbing back|no way back up|only one way: out|swings outward/.test(s) ? 'oneway' : 'open';
      }
    });
    const next = todo.find(a => !room.done.has(a));
    if (next) { room.done.add(next); if (act(next).done) break; continue; }
    const ok = (n, d) => R(n).ex[d] === 'open' && !R(n).blocked.has(d);
    const q = [[head, null]], seen = new Set([head]); let dir = null;
    for (let i = 0; i < q.length && !dir; i++) {
      const [cur, first] = q[i], f = Object.keys(R(cur).ex).filter(d => ok(cur, d) && !R(cur).links[d]);
      if (f.length || (cur !== head && Object.values(R(cur).dc).some(c => inv.has(c)))) { dir = first || f[0]; break; }
      for (const [d, to] of Object.entries(R(cur).links)) if (ok(cur, d) && !seen.has(to)) { seen.add(to); q.push([to, first || d]); }
    }
    if (!dir) dir = Object.keys(room.ex).find(d => room.ex[d] === 'oneway' && !room.links[d]);
    if (!dir) { if (++stuck > 3) break; for (const v of M.values()) { v.done = new Set([...v.done].filter(a => !a.startsWith('toggle'))); v.blocked.clear(); } continue; }
    pd = dir; if (act(`go ${dir}`).done) break;
  }
  return { actions: acts };
}

// --- regexAgentV2 (tuned to the v2 templates, no synonym table; 40-line function + 3 table lines, reuses regexAgent's tables) ---
const FAKE2 = /bricked up;|has stayed that way|trompe|heap of fallen masonry|barred window|hand's width|flooded to the ceiling|only solid stone|since been bricked up|filled it again/;
const PLACE2 = /^(?:there is |against the \w+ wall leans |pushed up against the \w+ wall is |close against the \w+ wall stands |along the \w+ wall you make out )?an? [\w-]+ ([\w-]+)/;
const LAND2 = /(beside|next to|behind|same wall as|across the room from|directly across from|opposite) the (?:[\w-]+ )?([\w-]+)/;
export function regexAgentV2(env, budget) {
  const M = new Map(), acts = [], inv = new Set();
  let obs = env.reset().observation, prev = null, pd = null, stuck = 0;
  const R = n => (M.has(n) || M.set(n, { ex: {}, links: {}, done: new Set(), blocked: new Set(), dc: {}, tried: new Set() }), M.get(n));
  const act = a => { acts.push(a); const r = env.step(a); obs = r.observation; if (/You pick up the (\w+) key/.test(obs)) inv.add(RegExp.$1); if (/^toggle/.test(a)) for (const v of M.values()) v.blocked.clear(); return r; };
  while (acts.length < budget) {
    const [head, desc] = obs.split('\n'), room = R(head), todo = [], wallOf = {}; room.ex = {};
    if (prev && pd) { if (prev !== head) { R(prev).links[pd] = head; room.links[BACK[pd]] = prev; } else R(prev).blocked.add(pd); }
    prev = head; pd = null;
    const sents = desc.toLowerCase().split(/(?<=[.!?])\s+/);
    for (const s of sents) { const m = s.match(PLACE2), w = s.match(/\bthe (\w+) wall/); if (m && w && DW1[w[1]] && !EXIT1.test(s.replace(/;.*/, ''))) wallOf[m[1]] = DW1[w[1]]; }
    sents.forEach((s, i) => {
      if (/"/.test(s)) return;
      const s2 = /^it is/.test(sents[i + 1] || '') ? `${s} ${sents[i + 1]}` : s;
      if (/(rests the treasure|at last is the treasure|treasure you came for)/.test(s)) todo.push('take treasure');
      for (const m of s.matchAll(/\b(\w+) key\b/g)) if (COLORS.includes(m[1]) && !inv.has(m[1]) && !/door|lock/.test(s)) todo.push(`take ${m[1]} key`);
      const cue = s.match(/\b(urn|chest|coffer|vase|barrel|crate|satchel|jar|cauldron|boot|cushion|nest)\b[^;]*;/); if (cue) todo.push(`examine ${cue[1]}`);
      const sw = s.match(/\b(lever|wheel|crank|winch|handle|chain)\b/); if (sw) todo.push(`toggle ${sw[1]}`);
      if (!EXIT1.test(s) || /no way through|window slit|compass|wall bears|bare stone/.test(s) || FAKE2.test(s)) return;
      const lm = s.match(LAND2), color = COLORS.find(c => s.includes(c)), lw = lm && wallOf[lm[2]];
      for (const d of lm ? (lw ? [/across|opposite/.test(lm[1]) ? BACK[lw] : lw] : []) : [...s.matchAll(DRE1)].map(m => DW1[m[1]])) {
        if (/door\b/.test(s) && closed1(s2) && color && inv.has(color)) todo.push(`use ${color} key on ${d} door`);
        if (/door\b/.test(s) && closed1(s2) && color) room.dc[d] = color; else delete room.dc[d];
        room.ex[d] = closed1(s2) ? 'closed' : /no climbing back|no way back up|only one way: out|swings outward/.test(s) ? 'oneway' : 'open';
      }
    });
    const next = todo.find(a => !room.done.has(a)), ok = (n, d) => R(n).ex[d] === 'open' && !R(n).blocked.has(d);
    if (next) { room.done.add(next); if (act(next).done) break; continue; }
    const q = [[head, null]], seen = new Set([head]); let dir = null;
    for (let i = 0; i < q.length && !dir; i++) {
      const [cur, first] = q[i], f = Object.keys(R(cur).ex).filter(d => ok(cur, d) && !R(cur).links[d]);
      if (f.length || (cur !== head && Object.values(R(cur).dc).some(c => inv.has(c)))) { dir = first || f[0]; break; }
      for (const [d, to] of Object.entries(R(cur).links)) if (R(cur).ex[d] !== 'closed' && !R(cur).blocked.has(d) && !seen.has(to)) { seen.add(to); q.push([to, first || d]); }
    }
    dir = dir || Object.keys(room.ex).find(d => room.ex[d] === 'oneway' && !room.links[d]) || Object.keys(BACK).find(d => !room.ex[d] && !room.links[d] && !room.tried.has(d));
    if (!dir) { if (++stuck > 3) break; for (const v of M.values()) { v.done = new Set([...v.done].filter(a => !a.startsWith('toggle'))); v.blocked.clear(); v.tried.clear(); } continue; }
    room.tried.add(dir); pd = dir; if (act(`go ${dir}`).done) break;
  }
  return { actions: acts };
}

// --- templateAwareAgent (white-box: imports ALIASES from the bed; 46-line function + 3 table lines + shared tables) ---
const AL = Object.fromEntries(Object.entries(ALIASES).flatMap(([n, as]) => [[n, n], ...as.map(a => [a, n])]));
const REF3 = new RegExp(`(beside|next to|behind|same wall as|across the room from|directly across from|opposite|up next to|faces) the ((?:[\\w-]+ )?(?:${Object.keys(AL).sort((a, b) => b.length - a.length).map(x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')}))\\b`);
const nounOf = ph => AL[ph] || AL[ph.split(' ').slice(1).join(' ')];
export function templateAwareAgent(env, budget) {
  const M = new Map(), acts = [], inv = new Set();
  let obs = env.reset().observation, prev = null, pd = null, stuck = 0;
  const R = n => (M.has(n) || M.set(n, { ex: {}, links: {}, done: new Set(), blocked: new Set(), dc: {}, tried: new Set() }), M.get(n));
  const act = a => { acts.push(a); const r = env.step(a); obs = r.observation; if (/You pick up the (\w+) key/.test(obs)) inv.add(RegExp.$1); if (/^toggle/.test(a)) for (const v of M.values()) v.blocked.clear(); return r; };
  while (acts.length < budget) {
    const [head, desc] = obs.split('\n'), room = R(head), todo = [], wallOf = {}; room.ex = {};
    if (prev && pd) { if (prev !== head) { R(prev).links[pd] = head; room.links[BACK[pd]] = prev; } else R(prev).blocked.add(pd); }
    prev = head; pd = null;
    const sents = desc.toLowerCase().split(/(?<=[.!?])\s+/), objs = sents.filter(s => !EXIT1.test(s.replace(/;.*/, '')) && PLACE2.test(s));
    for (let pass = 0; pass < 3; pass++) for (const s of objs) {
      const n = nounOf(s.match(PLACE2)[1]) || nounOf(((s.match(/^(?:there is )?an? ((?:[\w'-]+ ){0,2}?[\w'-]+?) (?:stands|sits|juts|is bolted|has been|faces|near)/) || [])[1]) || '');
      const w = s.match(/\bthe (\w+) wall/), ref = s.match(REF3);
      if (n && ref && wallOf[nounOf(ref[2])]) wallOf[n] = /across|opposite|faces/.test(s) ? BACK[wallOf[nounOf(ref[2])]] : wallOf[nounOf(ref[2])];
      else if (n && w && DW1[w[1]] && !ref) wallOf[n] = DW1[w[1]];
    }
    sents.forEach((s, i) => {
      if (/"/.test(s)) return;
      const s2 = /^it is/.test(sents[i + 1] || '') ? `${s} ${sents[i + 1]}` : s;
      if (/(rests the treasure|at last is the treasure|treasure you came for)/.test(s)) todo.push('take treasure');
      for (const m of s.matchAll(/\b(\w+) key\b/g)) if (COLORS.includes(m[1]) && !inv.has(m[1]) && !/door|lock/.test(s)) todo.push(`take ${m[1]} key`);
      const cue = s.match(/\b(urn|chest|coffer|vase|barrel|crate|satchel|jar|cauldron|boot|cushion|nest)\b[^;]*;/); if (cue && !EXIT1.test(s.replace(/;.*/, ''))) todo.push(`examine ${cue[1]}`);
      const sw = s.match(/^an? [\w-]+ (lever|wheel|crank|winch|handle|chain)\b/); if (sw) todo.push(`toggle ${sw[1]}`);
      if (!EXIT1.test(s) || /no way through|window slit|compass|wall bears|bare stone/.test(s) || FAKE2.test(s) || objs.includes(s)) return;
      const lm = s.match(REF3), color = COLORS.find(c => s.includes(c)), lw = lm && wallOf[nounOf(lm[2])];
      for (const d of lm ? (lw ? [/across|opposite/.test(lm[1]) ? BACK[lw] : lw] : []) : [...s.matchAll(DRE1)].map(m => DW1[m[1]])) {
        if (/door\b/.test(s) && closed1(s2) && color && inv.has(color)) todo.push(`use ${color} key on ${d} door`);
        if (/door\b/.test(s) && closed1(s2) && color) room.dc[d] = color; else delete room.dc[d];
        room.ex[d] = closed1(s2) ? 'closed' : /no climbing back|no way back up|only one way: out|swings outward/.test(s) ? 'oneway' : 'open';
      }
    });
    const next = todo.find(a => !room.done.has(a));
    if (next) { room.done.add(next); if (act(next).done) break; continue; }
    const ok = (n, d) => R(n).ex[d] === 'open' && !R(n).blocked.has(d);
    const q = [[head, null]], seen = new Set([head]); let dir = null;
    for (let i = 0; i < q.length && !dir; i++) {
      const [cur, first] = q[i], f = Object.keys(R(cur).ex).filter(d => ok(cur, d) && !R(cur).links[d]);
      if (f.length || (cur !== head && Object.values(R(cur).dc).some(c => inv.has(c)))) { dir = first || f[0]; break; }
      for (const [d, to] of Object.entries(R(cur).links)) if (R(cur).ex[d] !== 'closed' && !R(cur).blocked.has(d) && !seen.has(to)) { seen.add(to); q.push([to, first || d]); }
    }
    dir = dir || Object.keys(room.ex).find(d => room.ex[d] === 'oneway' && !room.links[d]) || Object.keys(BACK).find(d => !room.ex[d] && !room.links[d] && !room.tried.has(d));
    if (!dir) { if (++stuck > 3) break; for (const v of M.values()) { v.done = new Set([...v.done].filter(a => !a.startsWith('toggle'))); v.blocked.clear(); v.tried.clear(); } continue; }
    room.tried.add(dir); pd = dir; if (act(`go ${dir}`).done) break;
  }
  return { actions: acts };
}

// --- snapshotSearch (no language understanding; 27-line function) ---
// Breadth-first search over env states through snapshot()/restore(), keyed by the observation
// text minus the move counter plus the parity of effective toggles. With unlimited rewinds it
// solved 30/30 d3 tasks of bed 1.0.0; the lifetime action ledger (createEnv) now stops it.
export function snapshotSearch(env, budget, { maxExpansions = 200000 } = {}) {
  env.reset();
  const core = o => o.split('\n').filter(l => !/^(Last action|Moves used)/.test(l)).join('\n');
  const seen = new Set([`${core(env.observe())}|`]);
  let frontier = [{ snap: env.snapshot(), path: [], tog: '' }], n = 0;
  while (frontier.length && n < maxExpansions) {
    const next = [];
    for (const node of frontier) {
      env.restore(node.snap);
      for (const a of env.actions()) {
        if (++n > maxExpansions) break;
        env.restore(node.snap);
        const r = env.step(a);
        if (r.reward === 1) return { actions: [...node.path, a], expansions: n };
        if (r.done) continue;
        const ta = r.observation.split('\n')[0] + a, cur = node.tog.split(',').filter(Boolean);
        const tog = a.startsWith('toggle') && r.info.outcome === 'ok' ? (cur.includes(ta) ? cur.filter(x => x !== ta) : [...cur, ta]).sort().join(',') : node.tog;
        const k = `${core(r.observation)}|${tog}`;
        if (seen.has(k)) continue;
        seen.add(k);
        next.push({ snap: env.snapshot(), path: [...node.path, a], tog });
      }
    }
    frontier = next;
  }
  return { actions: [], expansions: n };
}
