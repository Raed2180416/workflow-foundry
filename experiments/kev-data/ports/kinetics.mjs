// Generator for the kinetics bed group (JUDGE-PROGRAM.md §1.2 group K, X3, X8, X5, X1, X4, X7; §2.2, §3.4).
//   X3:kinetics   speech act of a lab-chat message or notebook addendum (train family; runbook is held out)
//   X8:kinetics   a table row's extracted rate against the sheet's unit statement (train family)
//   X5:kinetics   precondition (rate unit, concentration unit, SOP revision) against a document window
//                 (held-out family: test-ood only)
//   X1:kinetics   injected instruction in a chat message or addendum (held-out family: test-ood only)
//   X7:kinetics   message needed for a sub-question (held-out family: test-ood only)
//   K1, K2, K3, X4:kinetics  wave-2 smoke sets (train and dev-select)
//
// Pure: the same (slice, seeds, opts, factory version, bed pin) gives the same records in the same order.
// Every choice is a salted hash of the record key: no Math.random, no clock, no network. Beds are imported
// through ctx.beds (the frozen copy); the port kit (judges/kinetics.mjs) and the tap (taps/kinetics.mjs)
// import no bed. This file never reads the held-out directory: held-out wordings reach it only through
// `opts` (data), supplied by the assembly.
//
// Surfaces (§3.1, §3.3): the label-bearing span of a row (the message, the unit statement, the note, the
// description) is hashed by its masked skeleton; train, calib-in, dev-select and test-in read the skeleton
// bucket 40-100%, calib-ood 30-40%, dev-ood 20-30%, test-ood 0-20%. The held-out families (X5, X1, X7)
// are test-ood only; their label-bearing spans are listed by heldoutSpans() for the span registry, and the
// train-like slices never contain them (the same bucket rule keeps the train ports' spans apart).
//
// opts (all optional, plain data):
//   ports         port ids to generate (default: the ports that apply to the slice)
//   difficulties  bed difficulties seeds are spread over (default [1, 2, 3, 4, 5], weighted toward 3-5)
//   perWorld      { X3: n, ... } rows per world per port (defaults below: the supply the assembly draws from)
//   wordings      { X3: [{id, text}], ... } the held-out wordings of THIS slice (required in calib-ood,
//                 dev-ood and test-ood for the wave-1 ports X3, X8, X5, X1)
//   smokeEvery    a wave-2 smoke port uses one world in `smokeEvery` (default 12; K1 3, X4 8)
//   authorSwap    share of X3 rows that also get an author-swap twin (default 0.15)
//   x3Authority   false: X3 states omit author and fact_owner (default true)
import { createHash } from 'node:crypto';
import { labelledQuestion, questionId } from '../lib/render.mjs';
import { optionOrder } from '../lib/balance.mjs';
import { worldHash, skeleton, skeletonBucket, spanHash } from '../lib/hash.mjs';
import {
  parsed as parsedOf, buildX3, buildX8, buildK1, buildK2, buildK3, buildX1, buildX5, buildX4, buildX7, sheetParts, parseRate, rowCells, normalizeConds,
  registerBench, resolveCondition, describeCondition, referencedSheet, X8_FIELD, RATE_FACTOR, RATE_LABELS, RATE_WORDS, CONC_LABELS, CONC_WORDS, UNIT_CODES, isUnitSentence, headerOf,
} from '../judges/kinetics.mjs';
import { alignMessages, harvestAliases, alignNotes, alignInjections, alignStatements } from '../taps/kinetics.mjs';

export const group = 'kinetics';
export const ports = ['X3:kinetics', 'X8:kinetics', 'X5:kinetics', 'X1:kinetics', 'K1', 'K2', 'K3', 'X4:kinetics', 'X7:kinetics'];
export const GENERATOR_VERSION = 'kinetics@1';
const FAMILY = 'kinetics', BED = 'kinetics';

const sha = s => createHash('sha256').update(s).digest('hex');
const hnum = s => parseInt(sha(s).slice(0, 8), 16);
const pick = (list, key) => list[hnum(key) % list.length];
const unit = key => hnum(key) / 0x100000000;
const fail = (code, message) => { const e = new Error(`${code}: ${message}`); e.code = code; return e; };
const byHash = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// seeds are spread over the bed's difficulties; d3-d5 carry the chat, the late facts and the traps
const DIFFICULTY_CYCLE = [1, 2, 3, 3, 4, 4, 5, 5];
export const difficultyOf = (seed, allowed = [1, 2, 3, 4, 5]) => {
  const cycle = DIFFICULTY_CYCLE.filter(d => allowed.includes(d));
  return cycle.length ? cycle[seed % cycle.length] : allowed[seed % allowed.length];
};

// Which ports a slice asks for by default (§10: wave 1 everywhere; wave-2 smoke in train and dev-select;
// the held-out families of X5, X1 and X7 only in test-ood, §3.4).
export const SLICE_PORTS = Object.freeze({
  train: ['X3', 'X8', 'K1', 'K2', 'K3', 'X4'], 'calib-in': ['X3', 'X8'], 'calib-ood': ['X3', 'X8'], 'dev-select': ['X3', 'X8', 'K1', 'K2', 'K3', 'X4'],
  'dev-ood': ['X3', 'X8'], 'test-in': ['X3', 'X8'], 'test-ood': ['X3', 'X8', 'X5', 'X1', 'X7'], 'real-reserve': [], 'e2e-reserve': [],
});
export const HELD_OUT_PORTS = Object.freeze(['X5', 'X1', 'X7']);
export const SMOKE_PORTS = Object.freeze(['K1', 'K2', 'K3', 'X4']);
// rows per world per port: the supply the assembly draws its allocation from (shortfalls are reported)
const PER_WORLD = Object.freeze({
  train: { X3: 2, X8: 1, K1: 4, K2: 2, K3: 1, X4: 3 }, 'calib-in': { X3: 2, X8: 2 }, 'calib-ood': { X3: 6, X8: 16 },
  'dev-select': { X3: 2, X8: 2, K1: 2, K2: 1, K3: 1, X4: 2 }, 'dev-ood': { X3: 6, X8: 16 }, 'test-in': { X3: 1, X8: 1 },
  'test-ood': { X3: 6, X8: 12, X5: 3, X1: 3, X7: 2 },
});

// ---- masks and skeleton buckets -------------------------------------------------------------
export function masksOf(world) {
  const m = world.meta, first = n => String(n).split(' ')[0];
  const people = [...m.techs, ...m.extras, m.pi];
  return {
    names: [...new Set([...people, ...people.map(first), m.enzyme.name, m.substrate, m.inhibitor, m.reader, ...Object.values(world.bench ?? {})])].filter(Boolean),
    markers: [...new Set([m.prefix, m.studyCode, m.sopCode, m.enzyme.code, 'lab-assistant-bot', 'qc-digest@core'])].filter(Boolean),
  };
}
// the bucket a slice reads: train-like slices and test-in 'train' (40-100%), each OOD slice its own (§3.1, §3.3)
const BUCKET_OF_SLICE = { train: 'train', 'calib-in': 'train', 'dev-select': 'train', 'test-in': 'train', 'calib-ood': 'calib-ood', 'dev-ood': 'dev-ood', 'test-ood': 'test-ood' };
export const bucketAllows = (slice, formHash) => skeletonBucket(formHash) === BUCKET_OF_SLICE[slice];
const formOf = (text, masks) => skeleton(text, masks);

// ---- wording and records ---------------------------------------------------------------------
function wordingFor(contract, slice, key, opts, taken = []) {
  const port = contract.id, held = (contract.heldoutWordings?.[slice] ?? 0) > 0;
  if (held) {
    const list = (opts.wordings?.[port] ?? []).filter(w => !taken.includes(w.id));
    if (!list.length) throw fail('HELDOUT_WORDINGS_MISSING', `${port} in ${slice} uses the slice's held-out wordings: pass opts.wordings.${port} = [{id, text}] (the assembly reads them from the held-out store; this generator does not)`);
    const w = pick(list, `${key}|wording`);
    return { wording: 'Q0', wordingText: w.text, wordingId: w.id };
  }
  const q = pick(['Q0', 'Q1', 'Q2', 'Q3'], `${key}|wording`);
  return { wording: q, wordingText: undefined, wordingId: q };
}
function makeRecord({ contract, slice, opts, key, state, label, slots = {}, options, optionDescriptions, meta, target }) {
  const w = wordingFor(contract, slice, key, opts);
  const names = options ?? Object.keys(contract.options ?? {});
  const q = labelledQuestion(contract, { label, target, wording: w.wording, wordingText: w.wordingText, slots, options, optionDescriptions, optionOrder: optionOrder(names, key) });
  return { state, questions: { [questionId(contract.id)]: q }, meta: { family: FAMILY, bed: BED, labelSource: 'generator', needsWorldKnowledge: false, wordingId: w.wordingId, ...meta } };
}
// a paraphrase-consistency record (§3.2): the same state asked with Q0 and two test wordings
function paraphraseOf(rec, contract, slice, opts, key, slots = {}) {
  const port = contract.id, label = Object.values(rec.questions)[0].label;
  const list = opts.wordings?.[port] ?? [];
  if (list.length < 2) return null;
  const a = pick(list, `${key}|pa`), b = pick(list.filter(w => w.id !== a.id), `${key}|pb`);
  const names = Object.keys(contract.options ?? {}), questions = {};
  questions[questionId(port, 'Q0')] = labelledQuestion(contract, { label, wording: 'Q0', slots, optionOrder: optionOrder(names, `${key}|Q0`) });
  for (const w of [a, b]) questions[questionId(port, w.id)] = labelledQuestion(contract, { label, wording: 'Q0', wordingText: w.text, slots, optionOrder: optionOrder(names, `${key}|${w.id}`) });
  return { state: rec.state, questions, meta: { ...rec.meta, variant: 'paraphrase', wordingId: `Q0+${a.id}+${b.id}` } };
}

// choose n candidates for a world. Each slot draws a label among those this world can still supply, with
// weight w[label] (rarer labels weigh more), so the pool stays near-balanced without a global buffer.
function rotate(cands, labels, n, key, id = c => c.sp?.id ?? c.id, weights = null) {
  const by = Object.fromEntries(labels.map(l => [l, cands.filter(c => c.label === l).sort((a, b) => byHash(sha(`${key}|${id(a)}`), sha(`${key}|${id(b)}`)))]));
  const picked = [];
  for (let slot = 0; slot < n; slot++) {
    const avail = labels.filter(l => by[l].length);
    if (!avail.length) break;
    const w = avail.map(l => weights?.[l] ?? 1), total = w.reduce((a, b) => a + b, 0);
    let x = unit(`${key}|slot${slot}`) * total, i = 0;
    while (i < avail.length - 1 && (x -= w[i]) >= 0) i++;
    picked.push(by[avail[i]].shift());
  }
  return picked;
}
const X3_WEIGHTS = Object.freeze({ retracts: 25, confirms: 6, proposes: 2.5, mentions: 1.4, changes: 1 });
const K1_WEIGHTS = Object.freeze({ none: 1, bubble: 1.5, reader_saturation: 4, pipetting_error: 5, temperature_deviation: 8 });
const X4_WEIGHTS = Object.freeze({ binding: 1, superseded: 3, informal: 2.5, out_of_scope: 2.5 });

// ---- X3 ------------------------------------------------------------------------------------
export const X3_LABELS = ['changes', 'proposes', 'mentions', 'confirms', 'retracts'];
function x3Candidates({ task, tap, masks, slice, authority = true }) {
  const out = [], dropped = {};
  for (const sp of tap.spans.values()) {
    if (!sp.label) { dropped['no-single-speech-act'] = (dropped['no-single-speech-act'] ?? 0) + 1; continue; }     // a redirect withdraws and re-assigns
    const full = buildX3(task, { message: sp.id });
    if (full.fact_owner !== sp.ownerTruth) { dropped['owner-unresolved'] = (dropped['owner-unresolved'] ?? 0) + 1; continue; }
    const slots = authority ? { message: sp.id } : { message: sp.id, authority: false }, state = authority ? full : buildX3(task, slots);
    const texts = [state.message, ...state.thread_context.map(c => c.replace(/^[^:]+: /, ''))];
    const forms = texts.map(t => formOf(t, masks));
    // the message is the label-bearing span; its thread context must not carry a surface of another bucket
    if (!bucketAllows(slice, forms[0]) || (slice === 'train' || slice === 'calib-in' || slice === 'dev-select' || slice === 'test-in') && !forms.every(f => bucketAllows(slice, f))) { dropped.bucket = (dropped.bucket ?? 0) + 1; continue; }
    out.push({ sp, slots, state, form: forms[0], label: sp.label });
  }
  return { cands: out, dropped };
}
function x3Record(c, ctx) {
  const { contracts, slice, opts, seed, difficulty, wh, masks } = ctx;
  const key = `${slice}|X3|${seed}|${c.sp.id}`;
  return makeRecord({ contract: contracts.X3, slice, opts, key, state: c.state, label: c.label,
    meta: { seed, difficulty, worldHash: wh, variant: 'clean', formId: c.form, surface: { source: 'bed', slice, lineHash: spanHash(c.state.message) }, masks,
      kit: { port: 'X3', slots: c.slots }, x3: { role: c.sp.role, factType: c.sp.factType, fact: c.sp.fact }, ...(ctx.x3Wave === 2 ? { wave: 2 } : {}) } });
}
// an author-swap twin: the same message attributed to someone else; the speech act does not change, only
// the authority does (authority stays in code, §1.2 X3)
function swapTwin(rec, c, ctx, people) {
  const { contracts, slice, opts, seed } = ctx;
  const others = people.filter(p => p !== rec.state.author && p !== rec.state.fact_owner && !/^Dr\./.test(p));
  if (!others.length || rec.state.author === undefined) return null;
  const to = pick(others, `${slice}|swap|${seed}|${c.sp.id}`);
  const key = `${slice}|X3|${seed}|${c.sp.id}|swap`;
  const twin = makeRecord({ contract: contracts.X3, slice, opts, key, state: { ...rec.state, author: to }, label: c.label,
    meta: { ...rec.meta, variant: 'invariance', pairId: `kx3:${slice}:${seed}:${c.sp.id}`, counterfactual: { swapped: true, from: rec.state.author, to, path: 'author' }, kit: { ...rec.meta.kit, slots: { ...c.slots, author: to } } } });
  rec.meta.pairId = twin.meta.pairId;
  return twin;
}

// ---- X8 ------------------------------------------------------------------------------------
// wrong unit factors a careless extraction applies (the bed's near-miss for kinetics: RATE_FACTOR)
function wrongUnits(u) {
  const [conc, time] = u.split('/'), same = UNIT_CODES.filter(c => c !== u);
  return { sameConc: same.filter(c => c.startsWith(`${conc}/`)), sameTime: same.filter(c => c.endsWith(`/${time}`)), ignored: u === 'uM/s' ? [] : ['uM/s'], all: same };
}
export const fmtValue = v => String(Number(v.toPrecision(4)));
function x8Candidates({ task, world, shown, seed }) {
  const out = [], p = parsedOf(task);
  const trapDocs = new Set(world.traps.filter(t => t.type === 'units').map(t => t.doc));
  for (const doc of world.docs) {
    if (!['mdtable', 'csv', 'semicolon'].includes(doc.format) || !['header', 'preamble'].includes(doc.unitPlacement) || doc.mixedRowUnits || trapDocs.has(doc.index)) continue;
    const sheet = p.sheets.find(s => s.author === doc.author && s.date === doc.date);
    if (!sheet) continue;
    const parts = sheetParts(sheet);
    for (const key of doc.series) for (const id of world.seriesByKey[key].wells) {
      const w = world.wellById[id];
      if (w.status === 'reread' || !shown[id] || w.typo) continue;
      const row = parts.rows.find(r => r.id === id);
      if (!row) continue;
      const printed = shown[id].rawRate;
      if (!Number.isFinite(printed) || parseRate(rowCells(sheet.format, row.line).rate) !== printed) continue;   // the kit's parse must agree with the bed's printed value
      out.push({ id, doc, sheet, printed, key: `${seed}|${id}` });
    }
  }
  return out;
}
function makeX8(c, ctx, wantConsistent) {
  const { task, slice, contracts, opts, seed, difficulty, wh, masks } = ctx;
  const trueUnit = c.doc.rateUnit, value = c.printed / RATE_FACTOR[trueUnit];
  let extracted, wrong = null;
  if (wantConsistent) extracted = fmtValue(value);
  else {
    const w = wrongUnits(trueUnit), r = unit(`${c.key}|wrong`);
    const pool = r < 0.35 && w.sameConc.length ? w.sameConc : r < 0.7 && w.sameTime.length ? w.sameTime : r < 0.85 && w.ignored.length ? w.ignored : w.all;
    wrong = pick(pool, `${c.key}|wrongunit`);
    extracted = fmtValue(c.printed / RATE_FACTOR[wrong]);
  }
  const slots = { sample: c.id, field: X8_FIELD, value: extracted };
  const state = buildX8(task, slots), form = formOf(state.conventions, masks);
  if (!bucketAllows(slice, form)) return null;
  const key = `${slice}|X8|${seed}|${c.id}`;
  return makeRecord({ contract: contracts.X8, slice, opts, key, state, label: wantConsistent ? 'consistent' : 'inconsistent', slots: { field: state.field, value: state.extracted_value },
    meta: { seed, difficulty, worldHash: wh, variant: 'clean', formId: form, surface: { source: 'bed', slice, lineHash: spanHash(state.conventions) }, masks,
      kit: { port: 'X8', slots }, x8: { sheet: c.sheet.id, format: c.sheet.format, rateUnit: trueUnit, wrongUnit: wrong, printed: c.printed } } });
}

// ---- K3 / K2 / K1 (wave-2 smoke) ---------------------------------------------------------------
const K3_LABELS = Object.keys(RATE_FACTOR).concat('mAU/min');
function k3Candidates({ task, world, masks, slice }) {
  const out = [], p = parsedOf(task), trapDocs = new Set(world.traps.filter(t => t.type === 'units').map(t => t.doc));
  for (const doc of world.docs) {
    if (trapDocs.has(doc.index)) continue;           // the header is wrong until a later correction: not decidable from header and preamble
    const sheet = p.sheets.find(s => s.author === doc.author && s.date === doc.date);
    if (!sheet || !sheet.format) continue;
    const slots = { document: sheet.id }, state = buildK3(task, slots);
    const form = formOf([state.header, ...sheetParts(sheet).unitLines].join('\n'), masks);
    if (!bucketAllows(slice, form)) continue;
    out.push({ id: sheet.id, slots, state, form, label: doc.rateUnit, doc });
  }
  return out;
}
function k2Candidates({ task, world, masks, slice }) {
  const out = [], p = parsedOf(task), conds = normalizeConds(p.study), bench = registerBench(p), seen = new Set();
  for (const a of harvestAliases({ parsed: p, world })) {
    if (seen.has(a.alias) || resolveCondition(a.alias, conds, bench) !== a.label) continue;      // duplicate register rows and unresolvable aliases are dropped
    seen.add(a.alias);
    const form = formOf(a.alias, masks);
    if (!bucketAllows(slice, form)) continue;
    out.push({ id: `${a.sheet}|${a.series}`, slots: { description: a.alias }, form, label: a.label, conds });
  }
  return out;
}
function k1Candidates({ task, world, masks, slice }) {
  const out = [];
  for (const n of alignNotes({ parsed: parsedOf(task), world })) {
    if (n.dropped) continue;
    const form = formOf(n.note, masks);
    if (!bucketAllows(slice, form)) continue;
    out.push({ id: n.sample, slots: { sample: n.sample }, form, label: n.label });
  }
  return out;
}

// ---- X1 (held-out family) ------------------------------------------------------------------------
function x1Candidates({ task, world, masks }) {
  return alignInjections({ parsed: parsedOf(task), world }).map(x => ({ id: x.id, x, label: x.label, hard: x.hard, form: formOf(x.text, masks), slots: x.message ? { message: x.message } : { document: x.document, line: x.line } }));
}

// ---- X5 (held-out family) ------------------------------------------------------------------------
const RATE_PHRASES = [
  L => `technician sheets report initial rates in ${L.label}`, L => `the rates on this sheet are written in ${L.words}`, L => `the v0 values are in ${L.label}`,
  L => `every rate on the sheet is ${L.words}`, L => `the sheet's rate column is in ${L.label}`, L => `initial rates in this export are given in ${L.label}`,
  L => `the technician expressed the reaction rates as ${L.words}`, L => `rate values are reported in ${L.label}, not converted`,
];
const CONC_PHRASES = [
  C => `substrate concentrations on the sheet are in ${C.label}`, C => `the [S] column is given in ${C.words}`, C => `substrate is written in ${C.label}`, C => `[S] values are ${C.words}`,
];
const SOP_PHRASES = [
  s => `the SOP in force for this study is ${s.code} revision ${s.n}`, s => `exclusions and fitting follow ${s.code} rev ${s.n}`,
  s => `${s.code} rev ${s.n} is the current rule set`, s => `the study is analysed under revision ${s.n} of ${s.code}`,
];
const OTHER_RATE = c => UNIT_CODES.filter(u => u !== c);
const OTHER_CONC = c => ['uM', 'mM', 'nM'].filter(u => u !== c);
function unitSpan(sheet) { const parts = sheetParts(sheet); return [...parts.unitLines, ...(parts.unitComment ? [parts.unitComment] : []), parts.header].filter(Boolean).join('\n'); }
// the presence-matched replacement of a sheet's unit statement (§2.5): the bed's own unit-less header, or a
// same-register preamble line of another sheet of the task
export function unitlessWindow(task, sheet, window, key) {
  const p = parsedOf(task), parts = sheetParts(sheet);
  let text = window;
  const swap = (from, to) => { if (from && text.split(from).length === 2) { text = text.replace(from, () => to); return true; } return false; };
  const fillers = p.sheets.filter(s => s.id !== sheet.id).flatMap(s => sheetParts(s).preamble.filter(l => !isUnitSentence(l) && !/ uM\/s| µM\/s/.test(l)));
  const filler = fillers.length ? pick(fillers, `${key}|filler`) : null;
  let changed = false;
  for (const line of parts.unitLines) changed = swap(line, filler ?? '') || changed;
  if (parts.unitComment) { text = text.replace(`${parts.unitComment}\n`, ''); changed = true; }
  if (parts.header) {
    const plain = { mdtable: '| Sample | Well | [S] | v0 | Notes |', csv: 'sample_id,plate,well,condition,replicate,S,rate,read_start,qc', semicolon: 'sample;plate;well;condition;rep;S;rate;remark' }[sheet.format];
    if (plain && parts.header !== plain && text.includes(parts.header)) { text = text.split(parts.header).join(plain); changed = true; }
  }
  return changed ? text : null;
}
function x5UnitRows(task, world, masks, ctx) {
  const { slice, contracts, opts, seed, difficulty, wh } = ctx, p = parsedOf(task), out = [];
  const trapDocs = new Set(world.traps.filter(t => t.type === 'units').map(t => t.doc));
  for (const doc of world.docs) {
    const sheet = p.sheets.find(s => s.author === doc.author && s.date === doc.date);
    if (!sheet || doc.format === 'reader' || doc.mixedRowUnits || trapDocs.has(doc.index)) continue;
    const kindKey = `${slice}|X5|${seed}|${doc.index}`, kind = pick(['rate', 'rate', 'rate', 'conc'], `${kindKey}|kind`);
    const slots = { document: sheet.id, rows: 5 }, state = buildX5(task, slots);
    const span = unitSpan(sheet) || sheetParts(sheet).preamble.join('\n');
    const form = formOf(span, masks);
    if (!bucketAllows('test-ood', form)) continue;                       // the family's spans stay in the 0-20% skeleton bucket: apart from the train ports' spans
    const settled = doc.unitPlacement !== 'ref';
    const makeAssumption = (u, which) => {
      if (kind === 'rate') return pick(RATE_PHRASES, `${kindKey}|${which}|rp`)({ label: pick(RATE_LABELS[u], `${kindKey}|${which}|rl`), words: RATE_WORDS[u] });
      return pick(CONC_PHRASES, `${kindKey}|${which}|cp`)({ label: pick(CONC_LABELS[u], `${kindKey}|${which}|cl`), words: CONC_WORDS[u] });
    };
    const truth = kind === 'rate' ? doc.rateUnit : doc.concUnit, wrong = pick(kind === 'rate' ? OTHER_RATE(truth) : OTHER_CONC(truth), `${kindKey}|wrong`);
    const base = { seed, difficulty, worldHash: wh, formId: form, surface: { source: 'bed', slice, lineHash: spanHash(span) }, masks, x5: { kind, sheet: sheet.id, placement: doc.unitPlacement, format: doc.format } };
    const rec = (label, assumption, st, extra = {}) => makeRecord({ contract: contracts.X5, slice, opts, key: `${kindKey}|${label}|${extra.tag ?? ''}`, state: st, label, slots: { assumption },
      meta: { ...base, variant: 'clean', kit: { port: 'X5', slots }, ...extra.meta } });
    if (!settled) {
      out.push([rec('not_stated', makeAssumption(truth, 'a'), state, { tag: 'ref', meta: { x5: { ...base.x5, notStated: 'natural' } } })]);
      continue;
    }
    // a polarity pair on one state: the true unit holds, another is violated (one cluster)
    const pairId = `kx5:${seed}:${doc.index}`;
    const pair = [rec('holds', makeAssumption(truth, 'a'), state, { tag: 'h', meta: { variant: 'flip', pairId } }), rec('violated', makeAssumption(wrong, 'b'), state, { tag: 'v', meta: { variant: 'flip', pairId } })];
    out.push(pair);
    // the unit statement replaced by a same-register line that does not settle the question
    const unitless = unitlessWindow(task, sheet, state.source_text, kindKey);
    if (unitless && sheet.format !== 'prose') {
      const pm = { variant: 'unknowable', pairId: `${pairId}:pm`, x5: { ...base.x5, notStated: 'presence-matched' }, counterfactual: { swapped: true, from: 'unit statement', to: 'same-register line', path: 'source_text' } };
      out.push([rec('not_stated', makeAssumption(truth, 'c'), { source_text: unitless }, { tag: 'pm1', meta: pm }), rec('not_stated', makeAssumption(wrong, 'd'), { source_text: unitless }, { tag: 'pm2', meta: pm })]);
    }
  }
  return out;
}
function x5SopRows(task, world, masks, ctx) {
  const { slice, contracts, opts, seed, difficulty, wh } = ctx, p = parsedOf(task), out = [];
  const code = world.meta.sopCode, rev = world.meta.sopRev;
  for (const d of p.docs.filter(x => x.kind === 'sop')) {
    const superseded = /superseded/i.test(d.title), docRev = Number(/ rev (\d+)/.exec(d.title)?.[1]);
    const slots = { sop: d.id, lines: 3 }, state = buildX5(task, slots), key = `${slice}|X5sop|${seed}|${d.id}`;
    const phrase = n => pick(SOP_PHRASES, `${key}|${n}|p`)({ code, n });
    const base = { seed, difficulty, worldHash: wh, formId: formOf(state.source_text, masks), surface: { source: 'bed', slice, lineHash: spanHash(state.source_text) }, masks, x5: { kind: 'sop', sheet: d.id, superseded }, kit: { port: 'X5', slots } };
    const rec = (label, n, tag, meta = {}) => makeRecord({ contract: contracts.X5, slice, opts, key: `${key}|${tag}`, state, label, slots: { assumption: phrase(n) }, meta: { ...base, variant: 'clean', ...meta } });
    const pairId = `kx5:${seed}:${d.id}`;
    if (unit(`${key}|keep`) >= (superseded ? 0.9 : 0.35)) continue;       // SOP heads are few forms: take a share of them, not one per world
    if (!superseded) out.push([rec('holds', docRev, 'h', { variant: 'flip', pairId }), rec('violated', docRev - 1, 'v', { variant: 'flip', pairId })]);
    else out.push([rec('holds', rev, 'h', { variant: 'flip', pairId }), rec('violated', docRev, 'v', { variant: 'flip', pairId })]);
  }
  // the SOP revision against a sheet excerpt that does not mention the SOP: not stated
  const sheet = p.sheets[hnum(`${slice}|X5sop-ns|${seed}`) % p.sheets.length];
  if (sheet && unit(`${slice}|X5sop-ns-keep|${seed}`) < 0.12) {
    const slots = { document: sheet.id, rows: 2 }, state = buildX5(task, slots);
    if (!/\bSOP\b/.test(state.source_text)) {
      const key = `${slice}|X5sopns|${seed}`, n = unit(`${key}|n`) < 0.5 ? rev : rev - 1;
      out.push([makeRecord({ contract: contracts.X5, slice, opts, key, state, label: 'not_stated', slots: { assumption: pick(SOP_PHRASES, `${key}|p`)({ code, n }) },
        meta: { seed, difficulty, worldHash: wh, variant: 'clean', formId: formOf(state.source_text, masks), surface: { source: 'bed', slice, lineHash: spanHash(state.source_text) }, masks, x5: { kind: 'sop', sheet: sheet.id, notStated: 'unrelated' }, kit: { port: 'X5', slots } } })]);
    }
  }
  return out;
}

// X5 groups: a polarity pair on one unit window, a presence-matched not_stated (the unit statement replaced by a
// same-register line), a natural not_stated (the sheet points to another sheet), an SOP pair, an SOP head against an
// unrelated excerpt. Presence-matched rows are to be at least half of the not_stated rows (§1.2 X5).
const X5_WEIGHTS = Object.freeze({ 'unit-pair': 3, 'unit-pm': 3.5, 'unit-natural': 1.5, 'sop-pair': 1.2, 'sop-unrelated': 0.15 });
const x5GroupKind = g => {
  const x = g[0].meta.x5;
  if (g.length === 2) return x.kind === 'sop' ? 'sop-pair' : x.notStated === 'presence-matched' ? 'unit-pm' : 'unit-pair';
  return x.notStated === 'natural' ? 'unit-natural' : 'sop-unrelated';
};
function weightedDraw(items, weights, n, key) {
  const left = [...items].sort((a, b) => byHash(sha(`${key}|${a.id}`), sha(`${key}|${b.id}`))), out = [];
  for (let slot = 0; slot < n && left.length; slot++) {
    const w = left.map(x => weights[x.kind] ?? 1), total = w.reduce((a, b) => a + b, 0);
    let x = unit(`${key}|draw${slot}`) * total, i = 0;
    while (i < left.length - 1 && (x -= w[i]) >= 0) i++;
    out.push(left.splice(i, 1)[0]);
  }
  return out;
}

// ---- X4 / X7 -------------------------------------------------------------------------------------
function x4Candidates({ task, world, masks, slice }) {
  const out = [];
  for (const s of alignStatements({ parsed: parsedOf(task), world })) {
    const state = buildX4(task, s.slots), form = formOf(state.statement, masks);
    if (!bucketAllows(slice, form)) continue;
    out.push({ id: s.id, slots: s.slots, state, form, label: s.label, kind: s.kind });
  }
  return out;
}
const SUBQUESTIONS = [
  'What are the corrected Vmax and Km of every condition', 'Which study wells does the SOP exclude', 'What are the fitted kinetic parameters for this study',
  'Which wells and conditions must be corrected before fitting',
];

// ---- label-bearing spans of the held-out families (for the span registry, §2.3 rule 7) -----------------
// Returns [{text, port, kind, masks}] for a record of X1, X5 or X7. The assembly registers them with
// registry.add(text, {slice: 'heldout', source: 'kinetics', port, kind, ...masks}).
export function heldoutSpans(record) {
  const masks = record.meta?.masks ?? { names: [], markers: [] }, out = [];
  const ports = Object.keys(record.questions).map(q => q.split('~')[0]);
  if (ports.includes('X1')) out.push({ text: record.state.text, port: 'X1', kind: 'family-span', masks });
  if (ports.includes('X5')) {
    const x5 = record.meta.x5 ?? {};
    const text = record.state.source_text;
    if (x5.kind === 'sop') out.push(...text.split('\n').slice(0, 2).map(t => ({ text: t, port: 'X5', kind: 'family-span', masks })));
    else {
      const decisive = text.split('\n').filter(l => isUnitSentence(l) || /^\| Sample \||^sample[_;]|^# units:|^Well {2}Sample /.test(l)).join('\n');
      out.push({ text: decisive || text.split('\n')[0], port: 'X5', kind: 'family-span', masks });
    }
  }
  if (ports.includes('X7')) out.push({ text: record.state.item.replace(/^[^:]+: /, ''), port: 'X7', kind: 'family-span', masks });
  return out.filter(s => s.text);
}
export function registerHeldout(registry, recs) {
  let n = 0;
  for (const r of recs) for (const s of heldoutSpans(r)) { registry.add(s.text, { slice: 'heldout', source: 'kinetics', port: s.port, kind: s.kind, names: s.masks.names, markers: s.masks.markers }); n++; }
  return n;
}

// ---- generator -----------------------------------------------------------------------------
export async function* records(slice, seeds, opts = {}, ctx) {
  const def = ctx.slice, contracts = ctx.contracts;
  const wanted = (opts.ports ?? SLICE_PORTS[slice] ?? []).map(p => String(p).split(':')[0]);
  const perWorld = { ...(PER_WORLD[slice] ?? {}), ...(opts.perWorld ?? {}) };
  for (const port of wanted) if (HELD_OUT_PORTS.includes(port) && slice !== 'test-ood') throw fail('HELDOUT_FAMILY', `${port}:kinetics is a held-out family (test-ood only, §3.4); it is not generated in ${slice}`);
  if (!wanted.length) return;
  const K = await ctx.beds.import('beds/kinetics/index.mjs');
  const diffs = opts.difficulties ?? [1, 2, 3, 4, 5], smokeEvery = 12, swapShare = opts.authorSwap ?? 0.15, authority = opts.x3Authority !== false;
  const x3Wave = opts.x3Wave ?? 1;            // 2: the tap missed its gate (taps/kinetics.mjs tapStatus); X3 is then a wave-2 smoke set
  const test = slice === 'test-ood';
  for (const seed of seeds) {
    const difficulty = difficultyOf(seed, diffs);
    const task = K.generate({ seed, split: def.bedSplit, difficulty });
    const { world, shown } = K._internals(task);
    const wh = worldHash(task), masks = masksOf(world), p = parsedOf(task);
    const c0 = { task, world, shown, masks, slice, seed, difficulty, wh, contracts, opts, x3Wave };
    const every = { K1: 3, K2: smokeEvery, K3: smokeEvery, X4: 8, X3: smokeEvery };
    const smoke = port => (!SMOKE_PORTS.includes(port) && !(port === 'X3' && x3Wave === 2)) || hnum(`${slice}|smoke|${port}|${seed}`) % (opts.smokeEvery ?? every[port]) === 0;

    if (wanted.includes('X3') && perWorld.X3 && smoke('X3')) {
      const tap = alignMessages({ task, world, parsed: p });
      const { cands } = x3Candidates({ task, tap, masks, slice, authority });
      for (const c of rotate(cands, X3_LABELS, perWorld.X3, `${slice}|X3|${seed}`, undefined, X3_WEIGHTS)) {
        const rec = x3Record(c, c0);
        const twin = authority && c.label !== 'proposes' && unit(`${slice}|swap|${seed}|${c.sp.id}`) < swapShare ? swapTwin(rec, c, c0, p.people) : null;
        const para = test && !twin && unit(`${slice}|para|${seed}|${c.sp.id}`) < 0.15 ? paraphraseOf(rec, contracts.X3, slice, opts, `${slice}|X3|${seed}|${c.sp.id}`) : null;
        yield para ?? rec;
        if (twin) yield twin;
      }
    }
    if (wanted.includes('X8') && perWorld.X8) {
      let made = 0;
      for (const c of x8Candidates(c0).sort((a, b) => byHash(sha(a.key), sha(b.key)))) {
        if (made >= perWorld.X8) break;
        const rec = makeX8(c, c0, unit(`${slice}|${c.key}|label`) < 0.5);
        if (!rec) continue;
        made++;
        yield test && unit(`${slice}|para|${c.key}`) < 0.15 ? paraphraseOf(rec, contracts.X8, slice, opts, `${slice}|X8|${seed}|${c.id}`, { field: rec.state.field, value: rec.state.extracted_value }) ?? rec : rec;
      }
    }
    if (wanted.includes('K3') && perWorld.K3 && smoke('K3')) {
      for (const c of rotate(k3Candidates(c0), K3_LABELS, perWorld.K3, `${slice}|K3|${seed}`, c => c.id))
        yield makeRecord({ contract: contracts.K3, slice, opts, key: `${slice}|K3|${seed}|${c.id}`, state: c.state, label: c.label,
          meta: { seed, difficulty, worldHash: wh, variant: 'clean', formId: c.form, surface: { source: 'bed', slice, lineHash: spanHash(c.state.header) }, masks, kit: { port: 'K3', slots: c.slots } } });
    }
    if (wanted.includes('K2') && perWorld.K2 && smoke('K2')) {
      const cands = k2Candidates(c0);
      for (const c of rotate(cands, [...new Set(cands.map(x => x.label))], perWorld.K2, `${slice}|K2|${seed}`, c => c.slots.description)) {
        const state = buildK2(task, c.slots), options = c.conds.map(x => x.id).sort(), optionDescriptions = Object.fromEntries(c.conds.map(x => [x.id, describeCondition(x)]));
        yield makeRecord({ contract: contracts.K2, slice, opts, key: `${slice}|K2|${seed}|${c.slots.description}`, state, label: c.label, options, optionDescriptions,
          meta: { seed, difficulty, worldHash: wh, variant: 'clean', formId: c.form, surface: { source: 'bed', slice, lineHash: spanHash(c.slots.description) }, masks, kit: { port: 'K2', slots: c.slots } } });
      }
    }
    if (wanted.includes('K1') && perWorld.K1 && smoke('K1')) {
      for (const c of rotate(k1Candidates(c0), ['none', 'bubble', 'reader_saturation', 'pipetting_error', 'temperature_deviation'], perWorld.K1, `${slice}|K1|${seed}`, c => c.id, K1_WEIGHTS)) {
        const state = buildK1(task, c.slots);
        yield makeRecord({ contract: contracts.K1, slice, opts, key: `${slice}|K1|${seed}|${c.id}`, state, label: c.label,
          meta: { seed, difficulty, worldHash: wh, variant: 'clean', formId: c.form, surface: { source: 'bed', slice, lineHash: spanHash(state.note) }, masks, kit: { port: 'K1', slots: c.slots } } });
      }
    }
    if (wanted.includes('X4') && perWorld.X4 && smoke('X4')) {
      for (const c of rotate(x4Candidates(c0), ['binding', 'superseded', 'informal', 'out_of_scope'], perWorld.X4, `${slice}|X4|${seed}`, c => c.id, X4_WEIGHTS))
        yield makeRecord({ contract: contracts.X4, slice, opts, key: `${slice}|X4|${seed}|${c.id}`, state: c.state, label: c.label,
          meta: { seed, difficulty, worldHash: wh, variant: 'clean', formId: c.form, surface: { source: 'bed', slice, lineHash: spanHash(c.state.statement) }, masks, kit: { port: 'X4', slots: c.slots }, x4: { kind: c.kind } } });
    }
    if (wanted.includes('X1') && perWorld.X1) {
      const cands = x1Candidates(c0).filter(c => c.label === 'yes' || skeletonBucket(c.form) === 'test-ood');   // negatives stay in the held-out bucket, apart from the train ports' spans
      const yes = cands.filter(c => c.label === 'yes').sort((a, b) => byHash(sha(`${slice}|X1|${seed}|${a.id}`), sha(`${slice}|X1|${seed}|${b.id}`)));
      const no = cands.filter(c => c.label === 'no').sort((a, b) => (Number(b.hard) - Number(a.hard)) || byHash(sha(`${slice}|X1|${seed}|${a.id}`), sha(`${slice}|X1|${seed}|${b.id}`)));
      for (const c of rotate([...yes, ...no], ['yes', 'no'], perWorld.X1, `${slice}|X1|${seed}`, c => c.id)) {
        const long = unit(`${slice}|X1long|${seed}|${c.id}`) < 0.1;
        const state = buildX1(task, { ...c.slots, long });
        yield makeRecord({ contract: contracts.X1, slice, opts, key: `${slice}|X1|${seed}|${c.id}`, state, label: c.label,
          meta: { seed, difficulty, worldHash: wh, variant: long ? 'long' : 'clean', formId: c.form, surface: { source: 'bed', slice, lineHash: spanHash(c.x.text) }, masks, kit: { port: 'X1', slots: { ...c.slots, long } },
            x1: { hard: c.hard, kind: c.x.kind } } });
      }
    }
    if (wanted.includes('X5') && perWorld.X5) {
      const groups = [...x5UnitRows(task, world, masks, c0), ...x5SopRows(task, world, masks, c0)].map(g => ({ g, kind: x5GroupKind(g), id: `${g[0].meta.x5.sheet}|${g[0].meta.x5.kind}|${g[0].meta.x5.notStated ?? ''}` }));
      for (const x of weightedDraw(groups, X5_WEIGHTS, perWorld.X5, `${slice}|X5|${seed}`)) for (const r of x.g) yield r;
    }
    if (wanted.includes('X7') && perWorld.X7) {
      const tap = alignMessages({ task, world, parsed: p });
      // the held-out family stays in the 0-20% skeleton bucket, apart from the messages the train ports (X3, X4) read
      const cands = [...tap.spans.values()].filter(sp => sp.label && X7_NEEDED[sp.factType] !== undefined && skeletonBucket(formOf(parsedOf(task).messageById[sp.id].text, masks)) === 'test-ood')
        .map(sp => ({ sp, id: sp.id, label: X7_NEEDED[sp.factType] ? 'needed' : 'not_needed' }));
      for (const c of rotate(cands, ['needed', 'not_needed'], perWorld.X7, `${slice}|X7|${seed}`, c => c.id)) {
        const state = buildX7(task, { message: c.id }), sub = pick(SUBQUESTIONS, `${slice}|X7|${seed}|${c.id}|sq`);
        yield makeRecord({ contract: contracts.X7, slice, opts, key: `${slice}|X7|${seed}|${c.id}`, state, label: c.label, slots: { subquestion: sub },
          meta: { seed, difficulty, worldHash: wh, variant: 'clean', formId: formOf(state.item, masks), surface: { source: 'bed', slice, lineHash: spanHash(state.item) }, masks, kit: { port: 'X7', slots: { message: c.id } }, x7: { factType: c.sp.factType } } });
      }
    }
  }
}
// X7: whether a message is needed to answer a study-level sub-question. A message is needed when the bed
// applies it (a correction, a late fact, a confirmed report) and not when it is rejected, withdrawn or
// leaves the record as it was.
export const X7_NEEDED = Object.freeze({
  'trap:swap': true, 'trap:units': true, 'trap:reassign': true, 'trap:omitted-inhibitor': true, 'trap:reassign-via-claim': true, 'trap:units-via-claim': true,
  'late:fact': true, 'late:rowflag': true, 'late:misattributed': true, 'late:colleague-confirmed': true, 'dose:correction': true,
  'trap:retracted': false, 'claim:swap': false, 'claim:reassign': false, 'claim:units': false, 'claim:addendum': false, 'late:withdrawn': false, 'late:cleared': false, 'late:late-denied': false,
  'herring:herringRange': false, 'herring:herringSwap': false, 'herring:herringUnits': false, 'herring:herringReaderLog': false,
});


// ---- class support (JUDGE-PROGRAM.md §2.7 step 8): class x difficulty, forms = distinct masked surface forms ----
// A cell with fewer than `minForms` forms is diagnostic: its accuracy is not a verdict (§6.0).
export function classSupport(recs, { minForms = 30, label = r => Object.values(r.questions)[0].label } = {}) {
  const cells = {};
  for (const r of recs) {
    const l = label(r), d = `d${r.meta.difficulty}`, c = ((cells[l] ??= {})[d] ??= { rows: 0, forms: new Set(), worlds: new Set() });
    c.rows++; c.forms.add(r.meta.formId); c.worlds.add(r.meta.seed);
  }
  const out = {};
  for (const [l, byD] of Object.entries(cells)) for (const [d, c] of Object.entries(byD)) (out[l] ??= {})[d] = { rows: c.rows, forms: c.forms.size, worlds: c.worlds.size, diagnostic: c.forms.size < minForms };
  return out;
}
export const formsPerLabel = (recs, label = r => Object.values(r.questions)[0].label) => {
  const m = {};
  for (const r of recs) (m[label(r)] ??= new Set()).add(r.meta.formId);
  return Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v.size]));
};
