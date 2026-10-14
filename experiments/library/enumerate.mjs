// enumerate.mjs: "code enumerates, Haiku ranks" (ATTACK-20261014 §3 M4; PROOF-LEDGER K6), the $0 half: enumerate the
// type-valid compositions of executable L1 cards by reachability from a task's input type to its output schema, at depth
// <= 4, and prune them by the temporal constraints the cards declare. No model, Jev or network call; nothing here ranks.
//
//   const r = enumerateCompositions({ input, output, cards: interfaces(loadL1()) });
//   // r.candidates: [['P01', 'P03', 'P12'], ...]; r.byDepth: [n1, n2, n3, n4]; r.total; r.pruned: {input, output, temporal}
//
// A composition is what S5 emits and assemble.mjs builds: cards run in order, x = task.inputs; x = card_i(flow, task, x);
// flow.done(x). So card i reads the task inputs (`inputs.` paths) and the previous card's output (`x.` paths), nothing
// else, and its output replaces x.
//
// Types (derived by code from card.json; no type field was added to any card):
//   - a type is a JSON schema over the portable subset, or SLOT_TYPED: the card's output is whatever its slots compute
//     (`fragment.out: null`: P01's last stage, P12's REDUCE, P54's COMBINE), so it may be anything;
//   - a card's READERS are the slot names in its `fragment.in` text ("any (ITEMS reads it)"). A reader of slot type
//     `path` is an accessor that cannot reshape (assemble.mjs PATH_RE), and every skeleton iterates it (map, filter, for),
//     so it needs a list; a reader of type `fn` or `judge` (P54 PARTS, P20 GEN) or no reader at all (P01: "the first
//     stage reads it") accepts any value. A card needs as many list sites as it has path readers (P17: LEFT and RIGHT);
//   - a list site is an array-typed location a path can reach in the task inputs or in x; an unconstrained location
//     (no type, an open object, SLOT_TYPED) may hold any number of them;
//   - a card's output schema is closed at the top level (properties and required keys, nothing else): every skeleton
//     returns exactly those keys (checked against the fixtures in test/enumerate.test.mjs); nested levels stay as declared;
//   - the last card's output must be COMPATIBLE with the task's output schema (some value satisfies both), not subsumed by
//     it: what a card leaves open (ROW_SCHEMA, a judge schema) its slots decide.
//
// Layers, each a superset of the next:
//   raw       the card schemas exactly as declared: `fragment.in` is free text ("any ..."), so every card accepts every
//             value; outputs as declared (open), checked for compatibility at the end;
//   typed     + reader list sites and closed outputs (above);
//   temporal  + the temporal constraints (the M4 mechanism as specified; the kill rule reads this layer).
// Temporal constraints (a field added 2026-10-14 to the cards that lacked it; P58-P60 are frozen by hash, so the one rule
// between two frozen cards is FROZEN_TEMPORAL below): card.json `temporal: [{before: [ids]} | {after: [ids]}, source]`.
// "A before B" means: in a composition holding both, every A comes before every B. Each rule quotes its source line; none
// was written from a measurement. "Validate before act" declares nothing here: a tier-S solver performs no effect (LIBRARY
// §6 EFFECT_IN_SOLVER; P08's skeleton leaves the act to the envelope), so no card acts inside a composition.
//
// Sensitivities (options, reported beside the layers, never part of the M4 rule): `distinct` (a card at most once),
// `alphabet` (only the given ids, e.g. the S4 code ranker's shown set), `maxDepth` (3).
import { loadL1 } from './cards.mjs';

export const MAX_DEPTH = 4;
export const SLOT_TYPED = Object.freeze({ slotTyped: true });
export const LAYERS = Object.freeze(['raw', 'typed', 'temporal']);
export const KILL = Object.freeze({ maxCandidates: 100, overShare: 0.5, minCoverage: 0.8 });   // ATTACK M4: kill if > 100 on more than half, or coverage < 80%
export const FROZEN_TEMPORAL = Object.freeze([
  Object.freeze({ card: 'P58', before: Object.freeze(['P60']), source: "P60 companions: P58 'targets by a decision table' (P58 and P60 are frozen by hash, FROZEN-P58-P60.json, so the rule is declared here)" }),
]);
const isObj = v => v != null && typeof v === 'object' && !Array.isArray(v);
const typesOf = s => (s?.type == null ? null : Array.isArray(s.type) ? s.type : [s.type]);
const UNBOUNDED = Infinity;

// ---- types from values and TaskSpecs ----
// The schema of a value. closed: objects allow only their own keys (task inputs are exactly what they are); open: the
// shape of an expected output used as a goal, like the beds' output schemas (no additionalProperties: false).
export function schemaOfValue(v, { closed = false } = {}) {
  if (v === null || v === undefined) return {};
  if (Array.isArray(v)) {
    const kinds = new Set(v.map(x => (Array.isArray(x) ? 'array' : x === null ? 'null' : typeof x)));
    return { type: 'array', items: v.length && kinds.size === 1 && !kinds.has('null') ? schemaOfValue(v[0], { closed }) : {} };
  }
  if (isObj(v)) return { type: 'object', required: Object.keys(v), properties: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, schemaOfValue(x, { closed })])), ...(closed ? { additionalProperties: false } : {}) };
  if (typeof v === 'number') return { type: Number.isInteger(v) ? 'integer' : 'number' };
  if (typeof v === 'string') return { type: 'string' };
  if (typeof v === 'boolean') return { type: 'boolean' };
  return {};
}

// A TaskSpec `inputs[].kind` (S1's free word) as a schema. Unknown words are unconstrained (any), never guessed.
export function kindSchema(kind) {
  const k = String(kind ?? '').trim().toLowerCase();
  const map = k.match(/^(?:map|object|dict(?:ionary)?) of (.+)$/);
  if (map) return { type: 'object', additionalProperties: kindSchema(map[1]) };
  const list = k.match(/^(?:list|array) of (.+)$/) ?? k.match(/^(?:list|array)(?:\[\d*\])?$/);
  if (list) return { type: 'array', items: list[1] ? kindSchema(list[1]) : {} };
  if (/^(text|string|csv|tsv|markdown|prose|document|json text)$/.test(k)) return { type: 'string' };
  if (/^(integer|int)$/.test(k)) return { type: 'integer' };
  if (/^(number|float|amount)$/.test(k)) return { type: 'number' };
  if (/^(boolean|bool)$/.test(k)) return { type: 'boolean' };
  return {};
}
// The task's input type from a TaskSpec: inputs [{path: 'inputs.a.b', kind}] -> a closed object (the TaskSpec names the
// inputs the constructor works from; an input it leaves out is not read).
export function taskSpecInputType(ts) {
  const root = { type: 'object', required: [], properties: {}, additionalProperties: false };
  for (const { path, kind } of ts?.inputs ?? []) {
    const parts = String(path).replace(/^inputs\.?/, '').split('.').filter(Boolean);
    if (!parts.length) continue;
    let at = root;
    parts.forEach((p, i) => {
      if (i === parts.length - 1) { at.properties[p] = kindSchema(kind); if (!at.required.includes(p)) at.required.push(p); return; }
      at.properties[p] ??= { type: 'object', required: [], properties: {}, additionalProperties: false };
      if (!at.required.includes(p)) at.required.push(p);
      at = at.properties[p];
    });
  }
  return root;
}

// ---- schema predicates ----
const unconstrained = s => s == null || s === true || s === SLOT_TYPED || (isObj(s) && !typesOf(s) && !s.properties && !s.items && !Array.isArray(s.enum) && s.const === undefined && s.additionalProperties === undefined);

// How many list sites may a path reach in a value of schema s? UNBOUNDED when any reachable location is unconstrained.
export function listSites(s, depth = 0) {
  if (unconstrained(s)) return UNBOUNDED;
  if (depth > 8) return 0;
  const t = typesOf(s);
  const canArray = t ? t.includes('array') : !!s.items;
  const canObject = t ? t.includes('object') : !!s.properties || s.additionalProperties !== undefined;
  let n = 0;
  if (canArray) n += 1 + (s.items ? listSites(s.items, depth + 1) : UNBOUNDED);
  if (canObject) {
    for (const p of Object.values(s.properties ?? {})) n += listSites(p, depth + 1);
    // Extra keys: none when closed; with a schema, any number of keys of that schema; open, anything.
    if (s.additionalProperties !== false) n += isObj(s.additionalProperties) ? (listSites(s.additionalProperties, depth + 1) > 0 ? UNBOUNDED : 0) : UNBOUNDED;
  }
  return n;
}

// Could some value satisfy both a and b? (portable subset; integer is a number; an unconstrained side is compatible.)
export function compatible(a, b, at = '') {
  if (unconstrained(a) || unconstrained(b)) return { ok: true };
  const ta = typesOf(a), tb = typesOf(b);
  if (ta && tb && !ta.some(x => tb.includes(x) || (x === 'integer' && tb.includes('number')) || (x === 'number' && tb.includes('integer'))))
    return { ok: false, why: `${at || '/'}: type ${ta.join('|')} vs ${tb.join('|')}` };
  const ea = Array.isArray(a.enum) ? a.enum : a.const !== undefined ? [a.const] : null, eb = Array.isArray(b.enum) ? b.enum : b.const !== undefined ? [b.const] : null;
  if (ea && eb && !ea.some(x => eb.some(y => JSON.stringify(x) === JSON.stringify(y)))) return { ok: false, why: `${at || '/'}: disjoint enums` };
  const objA = (ta ?? []).includes('object') || isObj(a.properties), objB = (tb ?? []).includes('object') || isObj(b.properties);
  if (objA && objB) {
    const pa = a.properties ?? {}, pb = b.properties ?? {};
    const allows = (s, p, k) => k in p || s.additionalProperties !== false;
    for (const k of b.required ?? []) if (!allows(a, pa, k)) return { ok: false, why: `${at}/${k}: required by the goal, never produced` };
    for (const k of a.required ?? []) if (!allows(b, pb, k)) return { ok: false, why: `${at}/${k}: always produced, not allowed by the goal` };
    for (const k of Object.keys(pa)) if (k in pb) { const r = compatible(pa[k], pb[k], `${at}/${k}`); if (!r.ok) return r; }
  }
  if (a.items && b.items) { const r = compatible(a.items, b.items, `${at}/[]`); if (!r.ok) return r; }
  return { ok: true };
}

// A card output schema closed at the top level (its properties plus its required keys, nothing else).
export function closeTop(s) {
  if (!isObj(s) || s === SLOT_TYPED) return s;
  const properties = { ...(s.properties ?? {}) };
  for (const k of s.required ?? []) properties[k] ??= {};
  return { ...s, type: s.type ?? 'object', properties, additionalProperties: false };
}

// ---- card interfaces ----
// The typed interface of one executable card, by code from card.json (see the header).
export function cardInterface(card) {
  const names = new Set((card.slots ?? []).map(d => d.name));
  const readers = [...new Set(String(card.fragment?.in ?? '').match(/\b[A-Z][A-Z0-9_]+\b/g) ?? [])].filter(n => names.has(n))
    .map(n => ({ slot: n, type: card.slots.find(d => d.name === n).type }));
  const declared = card.fragment?.out ?? null;
  return Object.freeze({
    id: card.id, tier: card.tier, readers, needsLists: readers.filter(r => r.type === 'path').length,
    outDeclared: declared == null ? SLOT_TYPED : declared, out: declared == null ? SLOT_TYPED : closeTop(declared),
    temporal: [...(card.temporal ?? []), ...FROZEN_TEMPORAL.filter(r => r.card === card.id)],
  });
}
export const interfaces = (l1 = loadL1(), { tiers = ['S'] } = {}) => l1.filter(e => e.executable && tiers.includes(e.tier)).map(cardInterface).sort((a, b) => (a.id < b.id ? -1 : 1));

// Temporal pairs [A, B] (A before B) among the given interfaces, each with its source.
export function temporalPairs(ifaces) {
  const ids = new Set(ifaces.map(c => c.id)), out = [], seen = new Set();
  const add = (a, b, source) => { const k = `${a}<${b}`; if (ids.has(a) && ids.has(b) && a !== b && !seen.has(k)) { seen.add(k); out.push({ before: a, after: b, source }); } };
  for (const c of ifaces) for (const r of c.temporal) {
    for (const b of r.before ?? []) add(c.id, b, r.source);
    for (const a of r.after ?? []) add(a, c.id, r.source);
  }
  return out.sort((x, y) => (x.before + x.after < y.before + y.after ? -1 : 1));
}
// The first pair a sequence violates (some B before some A), or null.
export function violation(seq, pairs) {
  for (const p of pairs) {
    const lastA = seq.lastIndexOf(p.before), firstB = seq.indexOf(p.after);
    if (lastA >= 0 && firstB >= 0 && firstB < lastA) return p;
  }
  return null;
}

// Does card c accept the environment (task inputs, current x) at a given position?
export function accepts(c, { input, x, first, layer }) {
  if (layer === 'raw' || c.needsLists === 0) return true;
  const sites = first ? listSites(input) : listSites(input) + listSites(x);
  return sites >= c.needsLists;
}

// ---- the enumerator ----
// Depth-first over sequences of length 1..maxDepth; a prefix that a card cannot accept is cut (reachability), the output
// check runs on complete sequences, the temporal check on every prefix (a violation never heals by appending).
export function enumerateCompositions({ input, output, cards, layer = 'temporal', maxDepth = MAX_DEPTH, distinct = false, alphabet = null, keep = true } = {}) {
  if (!LAYERS.includes(layer)) throw new Error(`enumerate: unknown layer ${layer}`);
  const use = alphabet ? cards.filter(c => alphabet.includes(c.id)) : cards;
  const pairs = layer === 'temporal' ? temporalPairs(use) : [];
  const outOf = c => (layer === 'raw' ? c.outDeclared : c.out);
  const candidates = [], byDepth = Array(maxDepth).fill(0), pruned = { input: 0, temporal: 0, output: 0 };
  const walk = (seq, x) => {
    for (const c of use) {
      if (distinct && seq.includes(c.id)) continue;
      if (!accepts(c, { input, x, first: seq.length === 0, layer })) { pruned.input++; continue; }
      const next = [...seq, c.id];
      if (pairs.length && violation(next, pairs)) { pruned.temporal++; continue; }
      const out = outOf(c);
      if (compatible(out, output).ok) { byDepth[next.length - 1]++; if (keep) candidates.push(next); } else pruned.output++;
      if (next.length < maxDepth) walk(next, out);
    }
  };
  walk([], input);
  return { layer, maxDepth, distinct, alphabet: alphabet ? [...alphabet] : null, cards: use.map(c => c.id), pairs: pairs.map(p => `${p.before}<${p.after}`),
    candidates, byDepth, total: byDepth.reduce((a, b) => a + b, 0), pruned };
}

// ---- coverage and the decision ----
export function containsInOrder(seq, core) {
  let i = 0;
  for (const id of seq) if (id === core[i]) i++;
  return i === core.length;
}
// Does a candidate match a gold? exact: the same sequence; subsequence: the core in order, other cards as glue.
export const matches = (seq, gold, match) => (match === 'exact' ? seq.length === gold.length && seq.every((id, i) => id === gold[i]) : containsInOrder(seq, gold));
export const covering = (candidates, golds, match) => candidates.filter(s => golds.some(g => matches(s, g, match)));

// The M4 kill rule over per-task rows [{total, covered}].
export function decide(rows, rule = KILL) {
  const over = rows.filter(r => r.total > rule.maxCandidates).length, covered = rows.filter(r => r.covered).length;
  const overShare = rows.length ? over / rows.length : 0, coverage = rows.length ? covered / rows.length : 0;
  const reasons = [];
  if (overShare > rule.overShare) reasons.push(`> ${rule.maxCandidates} candidates on ${over} of ${rows.length} tasks (more than half)`);
  if (coverage < rule.minCoverage) reasons.push(`coverage ${covered}/${rows.length} < ${rule.minCoverage * 100}%`);
  return { tasks: rows.length, over, overShare, covered, coverage, kill: reasons.length > 0, reasons };
}

// A fixed code order for a diagnostic only (never part of the rule): shorter first, then the sum of each card's position
// in a given ranking (absent cards at the end), then the ids.
export function codeOrder(candidates, ranking = []) {
  const pos = new Map(ranking.map((id, i) => [id, i])), at = id => pos.get(id) ?? ranking.length;
  const key = s => [s.length, s.reduce((a, id) => a + at(id), 0), s.join(' ')];
  return [...candidates].sort((a, b) => { const ka = key(a), kb = key(b); return ka[0] - kb[0] || ka[1] - kb[1] || (ka[2] < kb[2] ? -1 : ka[2] > kb[2] ? 1 : 0); });
}
