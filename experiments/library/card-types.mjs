// card-types.mjs: the precise type model of the catch-all cards, and reachability over it (M4b; ATTACK-20261014 §3 M4;
// PROOF-LEDGER K6). $0: no model, Jev or network call. No card is written: card.json and skeleton.mjs are only read.
//
// M4 (enumerate.mjs) derived every card's interface from card.json and was killed on its count clause because four
// cards came out as catch-alls: P01 and P54 accept any value and emit any value, P12 emits any value, P20 accepts any
// value. This module re-derives those four from what their skeletons actually read, check and return. Each claim cites a
// skeleton line and a snippet that must be on that line (test/m4b.test.mjs fails when a skeleton moves). The other eleven
// cards keep the interfaces M4 derived. Nothing here changes what a card does.
//
// Types, beside the portable schema subset of enumerate.mjs:
//   param(name, 'declared')   a value whose type a schema slot fixes at S6 and the skeleton checks (P01: STAGES[-1].out,
//                             line 13) or requests as structured output (P20: GEN.schema);
//   param(name, 'unchecked')  a value a fn:pure slot computes at S6 and nothing checks (P12 REDUCE, P54 COMBINE);
//   union([...])              one of several closed shapes (P20, line 14).
// A param is unconstrained to enumerate.mjs's predicates (listSites, compatible): it may be any type.
//
// Reachability (enumeratePrecise), the same depth-first walk as enumerate.mjs, with two readings of a param:
//   existential (the M4 rule's reading, unchanged): a slot can be filled so that the value has whatever type the next card
//               or the goal needs, so a param holds any number of lists of any items and is compatible with any goal;
//   checked     (diagnostic): a hand-off between cards counts only when its producer checks it, so an UNCHECKED param
//               supplies no list a later reader can rely on; a declared param is as above. The final output is checked by
//               the envelope (run.mjs:142 validates it against outputSchema), so the goal check is unchanged.
// A path reader may carry an item requirement (P12: non-null items); it is met by an array location whose items are
// compatible with it. Options `preserve` (counterfactual: those cards return their input type) and `strictOthers`
// (the verifier's lower bound: a non-catch-all reader only right after a param-carrying output) are diagnostics, never
// the rule.
import { readFileSync } from 'node:fs';
import { loadL1, CARDS_DIR } from './cards.mjs';
import { interfaces, compatible, temporalPairs, violation, SLOT_TYPED, MAX_DEPTH } from './enumerate.mjs';

export const CATCH_ALLS = Object.freeze(['P01', 'P12', 'P20', 'P54']);
export const MODES = Object.freeze(['existential', 'checked']);
const isObj = v => v != null && typeof v === 'object' && !Array.isArray(v);
const typesOf = s => (s?.type == null ? null : Array.isArray(s.type) ? s.type : [s.type]);

export const param = (name, check) => Object.freeze({ $param: name, check });
export const union = branches => Object.freeze({ $union: Object.freeze(branches) });
export const isParam = s => isObj(s) && typeof s.$param === 'string';
export const isUnion = s => isObj(s) && Array.isArray(s.$union);
export const NON_NULL = Object.freeze({ type: Object.freeze(['object', 'array', 'string', 'number', 'integer', 'boolean']) });

// ---- the precise interfaces (each claim: skeleton line, a snippet on that line, the claim) ----
const S = id => `experiments/library/cards/${id}/skeleton.mjs`;
export const PRECISE = Object.freeze({
  P01: Object.freeze({
    readers: [],
    reads: { task: false, x: true },
    out: param('P01.STAGES[-1].out', 'declared'),
    preserving: false,
    claims: [
      { file: S('P01'), line: 8, has: 'let v = x;', claim: 'x enters unchecked: no schema is applied to it before the first stage' },
      { file: S('P01'), line: 10, has: 'flow.call(s.hash, v,', claim: 'a call stage hands v to a child; the child contract types it (CALL_TYPE), not P01' },
      { file: S('P01'), line: 11, has: 'judgeSpec(s.spec, prev)', claim: 'a judge stage reads only the previous value' },
      { file: S('P01'), line: 12, has: 'flow.step(s.name, () => s.fn(v))', claim: 'a step stage is a fn:pure of v alone (slot params ["v"]): any value in, any value out' },
      { file: S('P01'), line: 13, has: 'validates(s.out, v)', claim: 'every stage output is checked against that stage\'s out, a required schema slot' },
      { file: S('P01'), line: 16, has: 'return v;', claim: 'the output is the last stage\'s value, so it satisfies STAGES[-1].out: a declared type fixed at S6' },
    ],
    notRead: 'task',   // the identifier `task` occurs only in the signature (line 5): P01 reads x, never the task inputs
  }),
  P12: Object.freeze({
    readers: [{ slot: 'ITEMS', kind: 'path', items: NON_NULL }],
    reads: { task: true, x: true },
    out: param('P12.REDUCE()', 'unchecked'),
    preserving: false,
    claims: [
      { file: S('P12'), line: 5, has: 'const items = S.ITEMS(task, x);', claim: 'ITEMS is a path accessor (assemble.mjs renderPath): a location in the task inputs or in x' },
      { file: S('P12'), line: 6, has: 'items.length <= S.MAX_ITEMS', claim: 'the location holds a list (flow.map at line 7 iterates it)' },
      { file: S('P12'), line: 7, has: 'it.id ?? i', claim: 'each item is dereferenced, so a null or undefined item throws: items are non-null' },
      { file: S('P12'), line: 9, has: 'items[i].id ?? i', claim: 'the id echo dereferences each item again' },
      { file: S('P12'), line: 10, has: 'return S.REDUCE(res);', claim: 'the output is REDUCE(results), returned unchecked; REDUCE sees only [{...BODY(item), id}]' },
    ],
  }),
  P20: Object.freeze({
    readers: [{ slot: 'GEN', kind: 'judge' }],
    reads: { task: false, x: true },
    out: union([
      { type: 'object', required: ['result', 'tries'], properties: { result: param('P20.GEN.schema', 'declared'), tries: { type: 'integer' } }, additionalProperties: false },
      { type: 'object', required: ['result', 'review'], properties: { result: { type: 'null' },
        review: { type: 'object', required: ['problem', 'tries'], properties: { problem: {}, tries: { type: 'integer' } }, additionalProperties: false } }, additionalProperties: false },
    ]),
    preserving: false,
    claims: [
      { file: S('P20'), line: 8, has: 'tries++;', claim: 'tries counts up from 0: an integer' },
      { file: S('P20'), line: 9, has: 'judgeSpec(S.GEN, { input: x, problem:', claim: 'GEN reads {input: x, problem}: any x' },
      { file: S('P20'), line: 10, has: 'problem = S.VERIFY(out, x);', claim: 'VERIFY reads (out, x); its truthy return is the problem, unchecked' },
      { file: S('P20'), line: 14, has: 'return problem ? { result: null, review: { problem, tries } } : { result: out, tries };', claim: 'two closed shapes: {result, tries} or {result: null, review: {problem, tries}}' },
      { file: 'experiments/jit/flow.mjs', line: 144, has: 'callModel({ model, system: String(system), prompt: text, schema,', claim: 'result is a GEN judge value, requested under GEN.schema (a slot): declared, fixed at S6' },
    ],
    notRead: 'task',
  }),
  P54: Object.freeze({
    readers: [{ slot: 'PARTS', kind: 'fn' }],
    reads: { task: true, x: true },
    out: param('P54.COMBINE()', 'unchecked'),
    preserving: false,
    claims: [
      { file: S('P54'), line: 7, has: 'const parts = S.PARTS(task, x);', claim: 'the input is read only through PARTS, a fn:pure over (task, x): any value' },
      { file: S('P54'), line: 8, has: 'validates(S.ARG, p.input)', claim: 'what is checked is each part input against ARG, not x' },
      { file: S('P54'), line: 13, has: 'validates(S.READS, k)', claim: 'READS checks child outputs as COMBINE reads them, not the fragment output' },
      { file: S('P54'), line: 14, has: 'return S.COMBINE(kids, parts);', claim: 'the output is COMBINE(kids, parts), returned unchecked; no slot declares its schema' },
    ],
  }),
});

// Every claim's snippet is on its line (paths relative to the repository root). Returns the claims that do not hold.
export function citationProblems(root = new URL('../../', import.meta.url)) {
  const bad = [];
  for (const [id, p] of Object.entries(PRECISE)) {
    for (const c of p.claims) {
      const lines = readFileSync(new URL(c.file, root), 'utf8').split('\n');
      if (!(lines[c.line - 1] ?? '').includes(c.has)) bad.push(`${id}: ${c.file}:${c.line} does not contain ${JSON.stringify(c.has)}`);
    }
    if (p.notRead) {
      const src = readFileSync(new URL(S(id), root), 'utf8').split('\n');
      const sig = src.findIndex(l => l.startsWith(`export default async function ${id}(`));
      if (src.slice(sig + 1).some(l => new RegExp(`\\b${p.notRead}\\b`).test(l))) bad.push(`${id}: ${p.notRead} is read after the signature`);
    }
  }
  return bad;
}

// The precise interfaces: M4's for every card, the catch-alls replaced by PRECISE. Fields: id, readers (path readers with
// optional item requirements), anyInput (no path reader), out, check ('fixed' | 'declared' | 'unchecked' | 'union'),
// temporal (unchanged). `m4` instead gives M4's own interfaces in this shape (for the equivalence test).
export function preciseInterfaces(l1 = loadL1(), { m4 = false } = {}) {
  return interfaces(l1).map(c => {
    const p = !m4 && PRECISE[c.id];
    const readers = p ? p.readers.filter(r => r.kind === 'path') : c.readers.filter(r => r.type === 'path').map(r => ({ slot: r.slot, kind: 'path' }));
    const out = p ? p.out : c.out === SLOT_TYPED ? param(`${c.id}.slot`, 'declared') : c.out;
    return Object.freeze({ id: c.id, tier: c.tier, readers, needsLists: readers.length, anyInput: readers.length === 0, out,
      check: isParam(out) ? out.check : isUnion(out) ? 'union' : 'fixed', precise: !!p, temporal: c.temporal });
  });
}

// ---- array locations ----
// The array locations a path can reach in a value of schema s: {items: [item schema per distinct location], more: [item
// schemas of locations that may repeat without bound], open: an unconstrained location (any number of lists of any
// items)}. listSites(s) === open || more.length ? Infinity : items.length (tested).
export function arraySites(s, { mode = 'existential' } = {}, depth = 0) {
  if (isParam(s)) return mode === 'checked' && s.check === 'unchecked' ? { items: [], more: [], open: false } : { items: [], more: [], open: true };
  if (isUnion(s)) throw new Error('arraySites: a union is read branch by branch');
  if (s == null || s === true || s === SLOT_TYPED || (isObj(s) && !typesOf(s) && !s.properties && !s.items && !Array.isArray(s.enum) && s.const === undefined && s.additionalProperties === undefined)) return { items: [], more: [], open: true };
  if (depth > 8) return { items: [], more: [], open: false };
  const t = typesOf(s), r = { items: [], more: [], open: false };
  const add = x => { r.items.push(...x.items); r.more.push(...x.more); r.open ||= x.open; };
  if (t ? t.includes('array') : !!s.items) {
    r.items.push(s.items ?? {});
    if (s.items) add(arraySites(s.items, { mode }, depth + 1)); else r.open = true;
  }
  if (t ? t.includes('object') : !!s.properties || s.additionalProperties !== undefined) {
    for (const p of Object.values(s.properties ?? {})) add(arraySites(p, { mode }, depth + 1));
    if (s.additionalProperties !== false) {
      if (isObj(s.additionalProperties)) { const sub = arraySites(s.additionalProperties, { mode }, depth + 1); if (sub.open) r.open = true; else r.more.push(...sub.items, ...sub.more); }
      else r.open = true;
    }
  }
  return r;
}
const branches = s => (isUnion(s) ? s.$union : [s]);
const itemOk = (item, req) => !req || compatible(item, req).ok;

// Can the readers be given distinct array locations (each meeting its item requirement) in the environment? env: the
// schemas a path may read (the task inputs; x unless first). A union in the environment is read branch by branch.
export function readersMet(readers, env, { mode = 'existential' } = {}) {
  if (!readers.length) return true;
  const choose = (i, k) => {
    if (k === env.length) return assign(readers, i);
    return branches(env[k]).some(b => choose(merge(i, arraySites(b, { mode })), k + 1));
  };
  return choose({ items: [], more: [], open: false }, 0);
}
const merge = (a, b) => ({ items: [...a.items, ...b.items], more: [...a.more, ...b.more], open: a.open || b.open });
function assign(readers, sites) {
  if (sites.open) return true;
  const go = (r, used) => {
    if (r === readers.length) return true;
    const req = readers[r].items;
    if (sites.more.some(it => itemOk(it, req)) && go(r + 1, used)) return true;
    return sites.items.some((it, j) => !used.has(j) && itemOk(it, req) && go(r + 1, new Set([...used, j])));
  };
  return go(0, new Set());
}

// Could the output satisfy the goal? A param: yes (existential; checked mode too, since the envelope validates the final
// output, run.mjs:142). A union: some branch.
export const outCompatible = (out, goal) => branches(out).some(b => isParam(b) || compatible(b, goal).ok);
const carriesParam = (s, depth = 0) => isParam(s) || (isUnion(s) ? s.$union.some(b => carriesParam(b, depth)) : isObj(s) && depth < 9
  && ([...Object.values(s.properties ?? {}), ...(isObj(s.items) ? [s.items] : []), ...(isObj(s.additionalProperties) ? [s.additionalProperties] : [])].some(x => carriesParam(x, depth + 1))));

// ---- the enumerator ----
// enumerate.mjs's depth-first walk over the precise interfaces. temporal: prune by the cards' temporal pairs (the rule's
// layer); preserve: ids whose output is their input type (counterfactual); strictOthers: a non-catch-all card with a path
// reader (and P12 when not first) accepts only right after an output that carries a param (the verifier's lower bound).
export function enumeratePrecise({ input, output, cards, mode = 'existential', temporal = true, maxDepth = MAX_DEPTH, distinct = false, alphabet = null,
  preserve = [], strictOthers = false, keep = true } = {}) {
  if (!MODES.includes(mode)) throw new Error(`enumeratePrecise: unknown mode ${mode}`);
  const use = alphabet ? cards.filter(c => alphabet.includes(c.id)) : cards;
  const pairs = temporal ? temporalPairs(use) : [];
  const candidates = [], byDepth = Array(maxDepth).fill(0), pruned = { input: 0, temporal: 0, output: 0 };
  const accepts = (c, x, first) => {
    if (c.anyInput) return true;
    if (strictOthers && !first && !carriesParam(x)) return false;
    if (strictOthers && first && !CATCH_ALLS.includes(c.id)) return false;
    return readersMet(c.readers, first ? [input] : [input, x], { mode });
  };
  const walk = (seq, x) => {
    for (const c of use) {
      if (distinct && seq.includes(c.id)) continue;
      const first = seq.length === 0;
      if (!accepts(c, x, first)) { pruned.input++; continue; }
      const next = [...seq, c.id];
      if (pairs.length && violation(next, pairs)) { pruned.temporal++; continue; }
      const out = preserve.includes(c.id) ? (first ? input : x) : c.out;
      if (outCompatible(out, output)) { byDepth[next.length - 1]++; if (keep) candidates.push(next); } else pruned.output++;
      if (next.length < maxDepth) walk(next, out);
    }
  };
  walk([], input);
  return { mode, maxDepth, distinct, alphabet: alphabet ? [...alphabet] : null, preserve: [...preserve], strictOthers, temporal,
    cards: use.map(c => c.id), pairs: pairs.map(p => `${p.before}<${p.after}`), candidates, byDepth, total: byDepth.reduce((a, b) => a + b, 0), pruned };
}

