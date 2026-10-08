// Port kit for the interactive beds, gridquest and gameqa (JUDGE-PROGRAM.md §1.2 group Q, X1, X2, X6; §2.1, §8.4 W2).
// RELOCATED from src/judges/interactive.mjs until the frozen C0 and P1 experiments finish (any file added under
// src/ changes their construction-kit hash); it moves to src/judges/ afterwards, unchanged.
//
// The factory (experiments/kev-data/ports/interactive.mjs) and the runtime import this same module, so a training
// state and a served state come from one function (W2: kit.buildState(task, slots) is the factory state byte for
// byte). The kit imports no bed (the runtime has no frozen copy of the beds): it works on the task it is given and
// on the facts the runtime holds (the observation the environment returned, the action it sent, the plan's
// expectation). It uses no clock and no random source.
//
// States (frozen contracts, spec/ports.json state.keys). `slots` are trusted code knowledge, never task text; a slot
// that is runtime data (an observation, an action) is passed in and checked, never read from the task:
//   gridquest
//     Q1  { observation }                       slots { observation }
//     Q2  { container_text }                    slots { observation, sentence }  (a sentence of the observation)
//     Q3  { observation, recent_history }       slots { observation, history: [{action, result}] }
//     Q4  { action, expected_effect, observation }   slots { action, observation, expect | expected_effect }
//     X1  { source_kind, text }                 slots { observation, sentence } | { journal: i } | { text, source_kind }
//   gameqa
//     Q4  { action, expected_effect, observation }   slots { action, observation: <env observation>, expect }
//     Q5  { repro_summary, observed_effect }    slots { actions, observed: { events, hud, at, status } }
//     Q6  { spec_excerpt, behaviour }           slots { topic, behaviour }
//     X1  { source_kind, text }                 slots { report: id } | { reports: [id, ...] } | { text, source_kind }
//     X2  { a, b, context }                     slots { a, b }  (finding summaries; context from the floor notes)
//     X6  { report, known_reports, build_info } slots { report: id }
// `expect` is the plan's structured expectation of one step (EXPECT below); the kit writes the one sentence that
// reaches the state (describeExpectation), so the factory and a runtime plan writer share the wording.
import { definePortKit } from './kit.mjs';
import { loadSpec } from '../lib/contracts.mjs';

export const KIT_VERSION = 1;
const fail = (code, message, details) => { const e = new Error(`${code}: ${message}`); e.code = code; if (details !== undefined) e.details = details; return e; };
const needStr = (v, what) => { if (typeof v !== 'string' || !v.trim()) throw fail('KIT_SLOT', `${what} must be a non-empty string`); return v; };
const escapeRe = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const lowerFirst = s => s.charAt(0).toLowerCase() + s.slice(1);
export const upperFirst = s => s.charAt(0).toUpperCase() + s.slice(1);
export const DIRECTIONS = Object.freeze(['north', 'east', 'south', 'west']);
export const OPPOSITE = Object.freeze({ north: 'south', south: 'north', east: 'west', west: 'east' });

// ================================================================================================================
// gridquest observations (beds/gridquest/render.mjs observationText)
//   [The Lark Bathhouse]
//   <description: one paragraph>
//   <blank>
//   You are carrying nothing.            | You are carrying a crimson key and a cobalt key.
//   Last action: <result>
//   Moves used: 3 of 61.
//   [*** You have taken the treasure. The game is over. ***]
// ================================================================================================================
export function parseObservation(text) {
  const t = needStr(text, 'observation');
  const lines = t.split('\n');
  const head = /^\[(.+)\]$/.exec(lines[0] ?? '');
  const carry = lines.findIndex(l => /^You are carrying /.test(l));
  const last = lines.findIndex(l => /^Last action: /.test(l));
  const moves = lines.findIndex(l => /^Moves used: \d+ of \d+\.$/.test(l));
  if (!head || carry < 2 || last < carry || moves < last) throw fail('KIT_OBSERVATION', 'not a gridquest observation (header, description, carrying, last action and moves lines)');
  const description = lines.slice(1, carry).join('\n').trim();
  const m = /^Moves used: (\d+) of (\d+)\.$/.exec(lines[moves]);
  return {
    room: head[1],                                           // 'The Lark Bathhouse'
    roomName: lowerFirst(head[1]),                           // 'the Lark Bathhouse'
    description,
    carrying: lines[carry].replace(/^You are carrying /, '').replace(/\.$/, ''),
    lastAction: lines.slice(last, moves).join('\n').replace(/^Last action: /, ''),
    moves: Number(m[1]), budget: Number(m[2]),
    over: lines.slice(moves + 1).join('\n').trim() || null,
  };
}

// The sentences of a room description, in order. A sentence ends at . ! ? followed by a space and a capital letter,
// a quote or a bracket; a quoted inscription ("SYSTEM: ... stop.") stays inside its sentence.
export function descriptionSentences(description) {
  const out = [], s = String(description);
  let start = 0, inQuote = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"') { inQuote = !inQuote; continue; }
    if (c !== '.' && c !== '!' && c !== '?') continue;
    // a sentence ends at a full stop; inside a quotation only a full stop right before the closing quote counts
    let end = i;
    if (inQuote) {
      if (s[i + 1] !== '"') continue;
      end = i + 1;
    }
    if (s[end + 1] !== ' ' && end + 1 < s.length) continue;
    const after = s.slice(end + 2);
    if (after !== '' && !/^[A-Z"\[]/.test(after)) continue;
    out.push(s.slice(start, end + 1).trim());
    start = end + 2;
    i = end;
    inQuote = false;
  }
  if (start < s.length) out.push(s.slice(start).trim());
  return out.filter(Boolean);
}
export const joinSentences = list => list.join(' ');

// ----------------------------------------------------------------------------------------------------------------
// The plan's expectation of one gridquest step (the "one sentence from the plan", §1.2 Q4)
//   { kind: 'enter',    room: 'the Amber Hall', feature?: 'mirror' }       go <direction> (feature: a fixture the plan expects in it)
//   { kind: 'take',     item: 'amber key' }
//   { kind: 'unlock',   direction: 'north' }                               use <colour> key on <direction> door
//   { kind: 'toggle',   noun: 'crank', effects: [{ type: 'portcullis'|'bridge', change: 'raises'|'lowers'|'drops', a: 'the Bramble Ossuary', b: 'the Tinker Weaving Room' }] }
//   { kind: 'find',     container: 'coffer', item: 'cobalt key' }          examine <container>
//   { kind: 'treasure' }                                                   take treasure
// ----------------------------------------------------------------------------------------------------------------
const an = word => (/^[aeiou]/i.test(word) ? `an ${word}` : `a ${word}`);
export const EXPECT_KINDS = Object.freeze(['enter', 'take', 'unlock', 'toggle', 'find', 'treasure']);
export const EFFECT_CHANGES = Object.freeze({ bridge: ['lowers', 'raises'], portcullis: ['raises', 'drops'] });

export function describeExpectation(e) {
  if (!e || typeof e !== 'object') throw fail('KIT_SLOT', 'expect must be an object');
  switch (e.kind) {
    case 'enter': return `you enter ${needStr(e.room, 'expect.room')}${e.feature ? `, where there is ${an(needStr(e.feature, 'expect.feature'))}` : ''}`;
    case 'take': return `you pick up the ${needStr(e.item, 'expect.item')}`;
    case 'unlock': return `the ${needStr(e.direction, 'expect.direction')} door is unlocked`;
    case 'toggle': {
      if (!Array.isArray(e.effects) || !e.effects.length) throw fail('KIT_SLOT', 'expect.effects must list the effects of the switch');
      return `the ${needStr(e.noun, 'expect.noun')} ${e.effects.map(f => `${needStr(f.change, 'effect.change')} the ${needStr(f.type, 'effect.type')} between ${needStr(f.a, 'effect.a')} and ${needStr(f.b, 'effect.b')}`).join(' and ')}`;
    }
    case 'find': return `you find ${an(needStr(e.item, 'expect.item'))} tucked inside the ${needStr(e.container, 'expect.container')}`;
    case 'treasure': return 'you take the treasure';
    default: throw fail('KIT_SLOT', `unknown expectation kind ${JSON.stringify(e.kind)}`);
  }
}

// Inverse of describeExpectation: the structured expectation a sentence states (null when it states none).
export function parseExpectation(sentence) {
  const s = String(sentence ?? '').trim();
  let m;
  if ((m = /^you enter (.+?)(?:, where there is an? ([a-z' -]+))?$/.exec(s))) return { kind: 'enter', room: m[1], ...(m[2] ? { feature: m[2] } : {}) };
  if ((m = /^you pick up the (.+)$/.exec(s))) return { kind: 'take', item: m[1] };
  if ((m = /^the (north|east|south|west) door is unlocked$/.exec(s))) return { kind: 'unlock', direction: m[1] };
  if ((m = /^you find an? (.+?) tucked inside the (.+)$/.exec(s))) return { kind: 'find', item: m[1], container: m[2] };
  if (s === 'you take the treasure') return { kind: 'treasure' };
  if ((m = /^the ([a-z]+) ((?:lowers|raises|drops) the (?:bridge|portcullis) between .+)$/.exec(s))) {
    const effects = [];
    for (const part of m[2].split(/ and (?=(?:lowers|raises|drops) the )/)) {
      const f = /^(lowers|raises|drops) the (bridge|portcullis) between (.+?) and (.+)$/.exec(part);
      if (!f) return null;
      effects.push({ change: f[1], type: f[2], a: f[3], b: f[4] });
    }
    return { kind: 'toggle', noun: m[1], effects };
  }
  return null;
}

export function buildQ4Gridquest(task, slots = {}) {
  const expected = slots.expected_effect !== undefined ? needStr(slots.expected_effect, 'slots.expected_effect') : describeExpectation(slots.expect);
  parseObservation(slots.observation);                       // refuses text that is not an observation
  return { action: needStr(slots.action, 'slots.action'), expected_effect: expected, observation: slots.observation };
}
export function buildQ1(task, slots = {}) { parseObservation(slots.observation); return { observation: slots.observation }; }
export function buildQ2(task, slots = {}) {
  const o = parseObservation(slots.observation), sentence = needStr(slots.sentence, 'slots.sentence');
  const hits = descriptionSentences(o.description).filter(x => x === sentence).length;
  if (hits !== 1) throw fail('KIT_SLOT', `the sentence occurs ${hits} times in the observation (needs exactly one)`);
  return { container_text: sentence };
}
export function buildQ3(task, slots = {}) {
  parseObservation(slots.observation);
  const history = Array.isArray(slots.history) ? slots.history : [];
  return { observation: slots.observation, recent_history: history.slice(-4).map(h => `${needStr(h.action, 'history.action')} -> ${needStr(h.result, 'history.result')}`) };
}
export const GQ_SOURCE = Object.freeze({ room: 'room description', journal: 'expedition journal entry' });
export function buildX1Gridquest(task, slots = {}) {
  if (slots.journal !== undefined) {
    const j = task?.inputs?.journal;
    if (!Array.isArray(j) || !Number.isInteger(slots.journal) || !j[slots.journal]) throw fail('KIT_SLOT', `the task has no journal entry ${slots.journal}`);
    return { source_kind: GQ_SOURCE.journal, text: j[slots.journal].entry };
  }
  if (slots.text !== undefined) return { source_kind: needStr(slots.source_kind ?? GQ_SOURCE.room, 'slots.source_kind'), text: needStr(slots.text, 'slots.text') };
  const o = parseObservation(slots.observation), sentence = needStr(slots.sentence, 'slots.sentence');
  const hits = descriptionSentences(o.description).filter(x => x === sentence).length;
  if (hits !== 1) throw fail('KIT_SLOT', `the sentence occurs ${hits} times in the observation (needs exactly one)`);
  // the long variant: the sentence inside the room description it stands in
  return { source_kind: GQ_SOURCE.room, text: slots.long ? o.description : sentence };
}

// ================================================================================================================
// gameqa
// ================================================================================================================
// The build's observation as the tester reads it: the events of the turn, the status line of the frame, the
// player's tile and the status (beds/gameqa/engine.mjs Game#observation). The frame's map and the engine
// instrumentation (enemies, items, doors, save slot) are not part of this reading: what they alone show cannot be
// judged from these four lines, so the factory drops rows whose difference lives only there.
export function compactObservation(obs) {
  if (!obs || typeof obs !== 'object' || typeof obs.frame !== 'string' || !obs.state?.player || !Array.isArray(obs.events)) throw fail('KIT_OBSERVATION', 'not a gameqa observation (frame, state.player, events)');
  const hud = obs.frame.split('\n').at(-1);
  if (!/^HP \d+\/\d+ \| Gold /.test(hud)) throw fail('KIT_OBSERVATION', 'the frame has no status line');
  const p = obs.state.player;
  return `Events: ${obs.events.length ? obs.events.join(' ') : 'none'}\n${hud}\nPlayer at (${p.x}, ${p.y}). Status: ${obs.status}.`;
}
export function parseCompact(text) {
  const m = /^Events: ([\s\S]*)\n(HP \d+\/\d+ \|.*)\nPlayer at \((\d+), (\d+)\)\. Status: (\w+)\.$/.exec(String(text));
  if (!m) throw fail('KIT_OBSERVATION', 'not a compact gameqa observation');
  return { events: m[1] === 'none' ? '' : m[1], hud: m[2], x: Number(m[3]), y: Number(m[4]), status: m[5] };
}
// The plan's expectation of one gameqa step: what the specification (rules and errata) says the build shows.
//   { events: ['You buy a lantern for 14 gold.'], hud: 'HP 6/6 | Gold 11 | ...', at: [4, 2], status: 'playing' }
export function describeGameExpectation(e) {
  if (!e || typeof e !== 'object' || !Array.isArray(e.events) || !Array.isArray(e.at) || e.at.length !== 2) throw fail('KIT_SLOT', 'expect needs events, hud and at');
  const status = e.status && e.status !== 'playing' ? ` and the status ${e.status}` : '';
  const events = e.events.length ? `"${e.events.join(' ')}"` : 'no events';
  return `by the rules the build reports ${events}, shows the status line "${needStr(e.hud, 'expect.hud')}" and has the player at (${e.at[0]}, ${e.at[1]})${status}`;
}
export function parseGameExpectation(sentence) {
  const m = /^by the rules the build reports (?:"([\s\S]*)"|no events), shows the status line "(HP [^"]*)" and has the player at \((\d+), (\d+)\)(?: and the status (\w+))?$/.exec(String(sentence));
  return m ? { events: m[1] ?? '', hud: m[2], x: Number(m[3]), y: Number(m[4]), status: m[5] ?? 'playing' } : null;
}
export function buildQ4Gameqa(task, slots = {}) {
  const expected = slots.expected_effect !== undefined ? needStr(slots.expected_effect, 'slots.expected_effect') : describeGameExpectation(slots.expect);
  return { action: needStr(slots.action, 'slots.action'), expected_effect: expected, observation: typeof slots.observation === 'string' ? (parseCompact(slots.observation), slots.observation) : compactObservation(slots.observation) };
}

// ---- reports (task.inputs.reports: { id, source, author, build, status, title, body, replies? }) --------------------
export const GAMEQA_SOURCE = Object.freeze({ forum: 'forum post', tracker: 'tracker post', playtest: 'playtest note', telemetry: 'crash telemetry' });
export const reportsOf = task => {
  const r = task?.inputs?.reports;
  if (!Array.isArray(r)) throw fail('KIT_TASK', 'a gameqa task has inputs.reports');
  return r;
};
export function reportById(task, id) {
  const r = reportsOf(task).find(x => x.id === id);
  if (!r) throw fail('KIT_SLOT', `no report ${JSON.stringify(id)}`);
  return r;
}
// A report as the reader gets it: its title and body, then its replies (author, text).
export function reportText(r, { replies = true } = {}) {
  const head = `${r.title}\n${r.body}`;
  return replies && Array.isArray(r.replies) && r.replies.length ? `${head}\n${r.replies.map(x => `Reply: ${x.body}`).join('\n')}` : head;
}
export function buildX1Gameqa(task, slots = {}) {
  if (slots.text !== undefined) return { source_kind: needStr(slots.source_kind ?? GAMEQA_SOURCE.forum, 'slots.source_kind'), text: needStr(slots.text, 'slots.text') };
  if (Array.isArray(slots.reports)) {
    // the long variant: a window of consecutive reports of the tracker, as the reader meets them
    const rs = slots.reports.map(id => reportById(task, id));
    return { source_kind: 'tracker export', text: rs.map(r => `[${GAMEQA_SOURCE[r.source] ?? r.source}] ${reportText(r)}`).join('\n\n') };
  }
  const r = reportById(task, needStr(slots.report, 'slots.report'));
  // slots.append: a line added to the end of the body (how the bed adds an injection to a host report)
  const host = slots.append !== undefined ? { ...r, body: `${r.body}\n\n${needStr(slots.append, 'slots.append')}` } : r;
  return { source_kind: GAMEQA_SOURCE[r.source] ?? 'forum post', text: reportText(host) };
}
export const BUILD_INFO = (task) => {
  const log = String(task?.inputs?.changelog ?? '');
  const title = /^# (.+?) — release notes/m.exec(log);
  const fixed = [];
  let inFixed = false;
  for (const line of log.split('\n')) {
    if (/^## /.test(line)) inFixed = /^## Fixed/.test(line);
    else if (inFixed && /^- /.test(line)) fixed.push(line.slice(2));
  }
  return { build: title ? title[1] : null, fixed };
};
export function buildX6(task, slots = {}) {
  const reports = reportsOf(task), r = reportById(task, needStr(slots.report, 'slots.report'));
  const earlier = reports.slice(0, reports.indexOf(r)).slice(-8).map(x => x.title);
  const info = BUILD_INFO(task);
  const cur = r.build ? null : null;
  return { report: reportText(r, { replies: false }), known_reports: earlier, build_info: `Current build ${info.build}. Reported against build ${r.build}. Fixed since earlier builds: ${info.fixed.join('; ') || 'nothing listed'}.${cur ?? ''}` };
}

// ---- Q6: the specification excerpt chosen by topic ----------------------------------------------------------------
// The design document is "# title — Rules of Play" followed by "## N. Heading" sections and an errata section.
export function specSections(task) {
  const doc = String(task?.inputs?.design_doc ?? '');
  const parts = doc.split(/\n\n(?=## )/);
  const sections = {};
  for (const p of parts) {
    const m = /^## (\d+)\. ([^\n]+)\n\n?([\s\S]*)$/.exec(p);
    if (m) sections[Number(m[1])] = { heading: m[2], text: m[3].trim() };
  }
  return sections;
}
export function specExcerpt(task, numbers, { errata = true } = {}) {
  const sec = specSections(task);
  const parts = [];
  for (const n of numbers) {
    if (!sec[n]) throw fail('KIT_SLOT', `the design document has no section ${n}`);
    parts.push(`${n}. ${sec[n].heading}: ${sec[n].text}`);
  }
  if (errata) {
    const err = Object.values(sec).find(s => /^Errata/.test(s.heading));
    if (err) {
      // only the errata lines that supersede a section shown in the excerpt
      const lines = err.text.split('\n').filter(l => numbers.some(n => new RegExp(`\\(supersedes section ${n}\\)`).test(l)));
      if (lines.length) parts.push(`Errata: ${lines.map(l => l.replace(/^- /, '')).join(' ')}`);
    }
  }
  return parts.join('\n');
}
export function buildQ6(task, slots = {}) {
  const nums = Array.isArray(slots.sections) ? slots.sections : [];
  if (!nums.length) throw fail('KIT_SLOT', 'slots.sections must list the specification sections of the topic');
  return { spec_excerpt: specExcerpt(task, nums), behaviour: needStr(slots.behaviour, 'slots.behaviour') };
}

// ---- Q5 and X2: findings -----------------------------------------------------------------------------------------
// A repro as a run-length summary: "S x6, E x4, USE:potion".
export function summariseRepro(actions) {
  if (!Array.isArray(actions) || !actions.length || !actions.every(a => typeof a === 'string')) throw fail('KIT_SLOT', 'slots.actions must be a non-empty list of actions');
  const out = [];
  for (const a of actions) {
    const last = out.at(-1);
    if (last && last.a === a) last.n++; else out.push({ a, n: 1 });
  }
  return out.map(x => (x.n > 1 ? `${x.a} x${x.n}` : x.a)).join(', ');
}
export function buildQ5(task, slots = {}) {
  const o = slots.observed;
  if (!o || typeof o.events !== 'string' || typeof o.hud !== 'string') throw fail('KIT_SLOT', 'slots.observed needs events and hud (the replay observation)');
  const effect = typeof slots.effect === 'string' ? slots.effect : needStr(slots.observed_effect, 'slots.observed_effect');
  return { repro_summary: `${slots.actions.length} actions from a fresh start: ${summariseRepro(slots.actions)}`, observed_effect: effect };
}
export function buildX2(task, slots = {}) {
  return { a: needStr(slots.a, 'slots.a'), b: needStr(slots.b, 'slots.b'), context: needStr(slots.context, 'slots.context') };
}

// ================================================================================================================
// The kits. `kits[port]` binds one port of one bed; `kit` binds them all and reads the bed from task.family and the
// port from slots.port.
// ================================================================================================================
const { contracts: ALL } = loadSpec();
export const BUILDERS = Object.freeze({
  gridquest: Object.freeze({ Q1: buildQ1, Q2: buildQ2, Q3: buildQ3, Q4: buildQ4Gridquest, X1: buildX1Gridquest }),
  gameqa: Object.freeze({ Q4: buildQ4Gameqa, Q5: buildQ5, Q6: buildQ6, X1: buildX1Gameqa, X2: buildX2, X6: buildX6 }),
});
export const kits = Object.freeze(Object.fromEntries(Object.entries(BUILDERS).map(([bed, ports]) => [bed, Object.freeze(Object.fromEntries(Object.entries(ports).map(([port, f]) => [port,
  definePortKit({ bed, contracts: { [port]: ALL[port] }, buildState: (task, slots) => f(task, slots) })])))])));
export const kit = definePortKit({
  bed: 'interactive',
  contracts: Object.fromEntries([...new Set(Object.values(BUILDERS).flatMap(p => Object.keys(p)))].map(port => [port, ALL[port]])),
  buildState(task, slots) {
    const bed = task?.family;
    const f = BUILDERS[bed]?.[slots?.port];
    if (!f) throw fail('KIT_SLOT', `the interactive kit needs task.family (gridquest or gameqa) and slots.port (got ${JSON.stringify(bed)}, ${JSON.stringify(slots?.port)})`);
    return f(task, slots);
  },
});
