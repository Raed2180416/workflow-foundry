// Generator for the interactive beds group (JUDGE-PROGRAM.md §1.2 group Q, X1, X2, X6; §2.2 interface, §2.3 rules,
// §2.5 variants, §3 splits; JUDGE-BUILD-PLAN.json group "interactive").
//
//   Q4:gridquest   expectation_met on the solver route of a keep, with a believed map that may be wrong (a wrong exit, a
//                  locked door, a one-way passage, a wrong destination, an unseen side effect, an empty container ...).
//                  Labels: the environment itself (the engine of the frozen bed): did the planned effect happen?
//   Q4:gameqa      held-out family (test-ood only): a repro of a planted bug, each step against what the rules and errata
//                  predict (the bug-free control build stepped from the same state).
//   X1:gameqa      train family: injection reports and pinned posts against ordinary, decoy and stale reports
//   X1:gridquest   held-out family (test-ood only): injection inscriptions and journal injections against graffiti,
//                  journal notes and ordinary room sentences
//   wave-2 smoke   Q1 room_exit, Q2 container_cue, Q5 bug_class, Q6 spec_violation, X6 report_triage (train and
//                  dev-select), X2:gameqa same_entity (held-out family, test-ood), Q3 next_action (skeleton, opt-in)
//
// Pure: the same (slice, seeds, opts, factory version, bed pin) gives the same records in the same order. Every choice
// is a salted hash of the record key: no Math.random, no clock, no network. Beds are imported through ctx.beds (the
// frozen copy); the port kit (judges/interactive.mjs) and the tap (taps/interactive.mjs) import no bed. This file
// never reads the held-out directory: held-out wordings and carriers reach it only through `opts` (data).
//
// opts (all optional, plain data):
//   ports          port ids to produce ('Q4', 'Q4:gridquest', 'X1:gameqa', ... default: SLICE_PORTS[slice])
//   difficulties   { gridquest: [..], gameqa: [..] } or a list for both (defaults: gridquest 1-5, gameqa 2-5)
//   perWorld       { 'Q4:gridquest': n, ... } rows per world (defaults below: the supply the assembly draws from)
//   wordings       { Q4: [{id, text}], X1: [...] } the held-out wordings of THIS slice (OOD slices; required there)
//   lines          authored lines (train-pools schema and heldout surface units): { port, role, label, text, slice?, ... }
//   pools          { dir, digest } train pool files <dir>/X1.jsonl (verified against the digest)
//   builtin        false: no built-in authored lines (lib: ports/interactive-lines.mjs) in train-like slices
//   share          { injection, invariance, paraphrase, unknowable } fractions of clean Q4:gridquest rows that get a twin
//   smokeEvery     a wave-2 smoke port uses one world in `smokeEvery` (default 6)
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { labelledQuestion, questionId, uniformTarget } from '../lib/render.mjs';
import { optionOrder } from '../lib/balance.mjs';
import { worldHash, skeleton, skeletonBucket, spanHash, canonical } from '../lib/hash.mjs';
import { stringLeaves } from '../lib/leakage.mjs';
import {
  kits, compactObservation, parseObservation, describeExpectation, parseExpectation, descriptionSentences, lowerFirst,
} from '../judges/interactive.mjs';
import * as GQ from './interactive-gq.mjs';
import * as QA from './interactive-qa.mjs';
import { Q4_CARRIERS, NEUTRAL_INSCRIPTIONS, BENIGN_PINNED } from './interactive-lines.mjs';
import { GRIDQUEST_INJECTIONS, GRIDQUEST_JOURNAL_INJECTIONS, isInjectionSentence, alignReports, stripPadding, GAMEQA_INJECTIONS, roomSentenceKinds as roomSentenceKindsOf } from '../taps/interactive.mjs';
import { solveQ4Gridquest, toggleEffectsOf } from '../solve/Q4.mjs';

export const group = 'interactive';
export const ports = ['Q4:gridquest', 'Q4:gameqa', 'X1:gameqa', 'X1:gridquest', 'Q1', 'Q2', 'Q3', 'Q5', 'Q6:gameqa', 'X6:gameqa', 'X2:gameqa'];
export const GENERATOR_VERSION = 'interactive@1';

const sha = s => createHash('sha256').update(s).digest('hex');
const hnum = GQ.hnum, unit = GQ.unit, pickBy = GQ.pickBy, shuffled = GQ.shuffled;
const fail = (code, message) => { const e = new Error(`${code}: ${message}`); e.code = code; return e; };
const byHash = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// ---- which port is asked where ---------------------------------------------------------------------------------------------
// Wave 1 everywhere it applies (§10); wave-2 smoke in train and dev-select; the held-out families (Q4:gameqa,
// X1:gridquest, X2:gameqa) only in test-ood (§3.4); Q3 is a wave-3 skeleton, opt-in.
export const JOBS = Object.freeze({
  'Q4:gridquest': ['train', 'calib-in', 'calib-ood', 'dev-select', 'dev-ood', 'test-in', 'test-ood'],
  'X1:gameqa': ['train', 'calib-in', 'calib-ood', 'dev-select', 'dev-ood', 'test-in', 'test-ood'],
  'Q4:gameqa': ['test-ood'], 'X1:gridquest': ['test-ood'], 'X2:gameqa': ['test-ood'],
  Q1: ['train', 'dev-select'], Q2: ['train', 'dev-select'], 'Q5:gameqa': ['train', 'dev-select'], 'Q6:gameqa': ['train', 'dev-select'], 'X6:gameqa': ['train', 'dev-select'],
  Q3: [],
});
export const HELD_OUT_JOBS = Object.freeze(['Q4:gameqa', 'X1:gridquest', 'X2:gameqa']);
export const SMOKE_JOBS = Object.freeze(['Q1', 'Q2', 'Q5:gameqa', 'Q6:gameqa', 'X6:gameqa', 'X2:gameqa', 'Q3']);
const BED_OF = job => (job.endsWith(':gameqa') || /^Q[56]/.test(job) || job === 'X6:gameqa' ? 'gameqa' : 'gridquest');
export const SLICE_PORTS = Object.freeze(Object.fromEntries(['train', 'calib-in', 'calib-ood', 'dev-select', 'dev-ood', 'test-in', 'test-ood', 'real-reserve', 'e2e-reserve']
  .map(s => [s, Object.entries(JOBS).filter(([, ss]) => ss.includes(s)).map(([j]) => j)])));
// rows per world per job: the supply the assembly draws its allocation from (shortfalls are reported)
const PER_WORLD = Object.freeze({
  train: { 'Q4:gridquest': 4, 'X1:gameqa': 5, Q1: 2, Q2: 3, 'Q5:gameqa': 3, 'Q6:gameqa': 3, 'X6:gameqa': 4 },
  'calib-in': { 'Q4:gridquest': 4, 'X1:gameqa': 5 }, 'calib-ood': { 'Q4:gridquest': 6, 'X1:gameqa': 6 },
  'dev-select': { 'Q4:gridquest': 4, 'X1:gameqa': 5, Q1: 2, Q2: 3, 'Q5:gameqa': 3, 'Q6:gameqa': 3, 'X6:gameqa': 4 }, 'dev-ood': { 'Q4:gridquest': 6, 'X1:gameqa': 6 },
  'test-in': { 'Q4:gridquest': 4, 'X1:gameqa': 5 }, 'test-ood': { 'Q4:gridquest': 8, 'X1:gameqa': 8, 'Q4:gameqa': 6, 'X1:gridquest': 8, 'X2:gameqa': 3 },
});
const DEFAULT_SHARE = Object.freeze({ injection: 0.12, invariance: 0.1, paraphrase: 0.18, unknowable: 0.5, sameName: 0.6 });
const TRAIN_LIKE = new Set(['train', 'calib-in', 'dev-select', 'test-in']);
const OOD = new Set(['calib-ood', 'dev-ood', 'test-ood']);

// ---- skeleton buckets (§3.1, §3.3) ------------------------------------------------------------------------------------------------
// The label-bearing span of a row is hashed by its masked skeleton: train, calib-in, dev-select and test-in read the
// bucket 40-100%, calib-ood 30-40%, dev-ood 20-30%, test-ood 0-20%.
const BUCKET_OF_SLICE = { train: 'train', 'calib-in': 'train', 'dev-select': 'train', 'test-in': 'train', 'calib-ood': 'calib-ood', 'dev-ood': 'dev-ood', 'test-ood': 'test-ood' };
export const bucketAllows = (slice, formHash) => skeletonBucket(formHash) === BUCKET_OF_SLICE[slice];
const formOf = (text, masks) => skeleton(text, masks);

// ---- wording and records -------------------------------------------------------------------------------------------------------------
function wordingFor(contract, slice, key, opts, taken = []) {
  const port = contract.id, held = (contract.heldoutWordings?.[slice] ?? 0) > 0;
  if (held) {
    const list = (opts.wordings?.[port] ?? []).filter(w => !taken.includes(w.id));
    if (!list.length) throw fail('HELDOUT_WORDINGS_MISSING', `${port} in ${slice} uses the slice's held-out wordings: pass opts.wordings.${port} = [{id, text}] (the assembly reads them from the held-out store; this generator does not)`);
    const w = pickBy(list, `${key}|wording`);
    return { wording: 'Q0', wordingText: w.text, wordingId: w.id };
  }
  const q = pickBy(['Q0', 'Q1', 'Q2', 'Q3'], `${key}|wording`);
  return { wording: q, wordingText: undefined, wordingId: q };
}
function makeRecord({ contract, slice, opts, key, state, label, slots = {}, qid = null, target, meta }) {
  const w = wordingFor(contract, slice, key, opts);
  const names = Object.keys(contract.options);
  const q = labelledQuestion(contract, { label, ...(target ? { target } : {}), wording: w.wording, wordingText: w.wordingText, slots, optionOrder: optionOrder(names, key) });
  return { state, questions: { [qid ?? questionId(contract.id)]: q }, meta: { labelSource: 'simulator', needsWorldKnowledge: false, wordingId: w.wordingId, ...meta } };
}
// a paraphrase-consistency record (§3.2): the same state asked with Q0 and two test wordings
function paraphraseOf(rec, contract, slice, opts, key, slots = {}) {
  const port = contract.id, label = Object.values(rec.questions)[0].label;
  const list = opts.wordings?.[port] ?? [];
  if (list.length < 2) return null;
  const a = pickBy(list, `${key}|pa`), b = pickBy(list.filter(w => w.id !== a.id), `${key}|pb`);
  const names = Object.keys(contract.options), questions = {};
  questions[questionId(port, 'Q0')] = labelledQuestion(contract, { label, wording: 'Q0', slots, optionOrder: optionOrder(names, `${key}|Q0`) });
  for (const w of [a, b]) questions[questionId(port, w.id)] = labelledQuestion(contract, { label, wording: 'Q0', wordingText: w.text, slots, optionOrder: optionOrder(names, `${key}|${w.id}`) });
  return { state: rec.state, questions, meta: { ...rec.meta, variant: 'paraphrase', wordingId: `Q0+${a.id}+${b.id}` } };
}

// ---- authored lines (opts.lines, opts.pools, built-ins) -----------------------------------------------------------------------------------
const readPool = (dir, port, digest) => {
  const file = path.join(dir, `${port}.jsonl`);
  if (!existsSync(file)) return { lines: [], digest: null };
  const body = readFileSync(file, 'utf8'), got = `sha256:${sha(body)}`;
  if (digest !== undefined && digest !== got && digest !== null) throw fail('POOL_DIGEST', `${file} hashes to ${got}, opts.pools.digest says ${digest}`);
  return { lines: body.split('\n').filter(Boolean).map(l => JSON.parse(l)), digest: got };
}
export function linesFor(G) {
  const o = G.opts;
  let raw = [...(o.lines ?? [])];
  if (o.pools?.dir) raw = [...readPool(o.pools.dir, 'X1', o.pools.digest).lines, ...raw];
  return raw.filter(l => l && typeof l.text === 'string' && l.text.trim());
}
const lineSlice = l => l.slice ?? 'train';
// carriers of Q4 for a slice: built-in authored carriers in train-like slices (when allowed), the slice's own
// held-out carriers (opts.lines, role 'carrier', port Q4) in OOD slices
function q4Carriers(G) {
  const own = linesFor(G).filter(l => l.port === 'Q4' && l.role === 'carrier' && (OOD.has(G.slice) ? lineSlice(l) === G.slice : lineSlice(l) === 'train'));
  const out = { as_expected: [], drifted: [] };
  for (const l of own) if (out[l.label]) out[l.label].push(l.text);
  if (!OOD.has(G.slice) && G.opts.builtin !== false) {
    // a built-in carrier is used only where its skeleton falls in the train bucket (§3.1: authored train lines never carry an OOD form)
    for (const [label, key] of [['as_expected', 'asExpected'], ['drifted', 'drifted']]) for (const t of Q4_CARRIERS[key]) if (skeletonBucket(skeleton(t, {})) === 'train') out[label].push(t);
  }
  return out;
}

// ---- the generation context ---------------------------------------------------------------------------------------------------------------
function makeContext(slice, opts, ctx) {
  const o = opts ?? {};
  return { slice, ctx, contracts: ctx.contracts, def: ctx.slice, opts: o, ood: OOD.has(slice), test: slice === 'test-ood', share: { ...DEFAULT_SHARE, ...(o.share ?? {}) }, counts: {}, notes: {} };
}
const bump = (G, k, n = 1) => { G.counts[k] = (G.counts[k] ?? 0) + n; };

// ================================================================================================================
// Q4:gridquest
// ================================================================================================================
// Family spans: the six injection inscriptions of the bed are the held-out family X1:gridquest (§3.4). In every
// slice but test-ood a state that shows one gets that sentence replaced by a neutral decor sentence (the same
// replacement for the same sentence in one world), so the held-out surface never reaches a train, calib or dev state.
export function scrubFamilySpans(observation, seed, slice) {
  if (slice === 'test-ood') return observation;
  let out = observation;
  for (const inj of GRIDQUEST_INJECTIONS) {
    if (!out.includes(inj)) continue;
    const rep = pickBy(NEUTRAL_INSCRIPTIONS, `${seed}|scrub|${inj}`);
    const r = GQ.replaceSentence(out, inj, rep);
    if (r) out = r;
  }
  return out;
}
const carriesInjection = obs => GRIDQUEST_INJECTIONS.some(i => obs.includes(i));

function q4Form(sentence, observation, masks) {
  const o = parseObservation(observation), exp = parseExpectation(sentence);
  const rel = exp?.kind === 'enter' ? (o.roomName.toLowerCase() === exp.room.toLowerCase() ? 'same room' : 'other room') : '';
  const fixture = exp?.kind === 'enter' && exp.feature ? (GQ.descriptionHas(o.description, exp.feature) ? 'fixture present' : 'fixture absent') : '';
  return formOf(`${sentence} // ${rel} // ${fixture} // ${o.lastAction}`, masks);
}

// The adversarial same-name room (§1.2 Q4 Adv): a wrong-destination drift whose observation names the room the plan
// expected, for a room that is not that room. It is kept ONLY where the observation tells the rooms apart (the
// fixture the plan expects in its room is not in the description); otherwise the label is not determined by the state
// and the item is dropped (§2.7 step 5). "Kept" is decided by the state-only solver reading the renamed state.
export function sameNameDistractor({ sentence, observation, believedRoom }) {
  const renamed = GQ.withHeader(observation, believedRoom);
  const verdict = solveQ4Gridquest({ action: '', expected_effect: sentence, observation: renamed });
  return { observation: renamed, kept: verdict.label === 'drifted', reason: verdict.label === 'drifted' ? 'the observation distinguishes the rooms' : 'indistinguishable: the observation fits the expectation' };
}

// One candidate row of a world: an OK step of the true route or a drifting proposal.
function q4Candidates(mod, route, task, G, seed) {
  const { W, w, rows } = route, out = [];
  const feature = (cell, key) => (unit(`${key}|feat`) < 0.35 ? GQ.featureFor(mod, route, cell, `${key}|f`) : undefined);
  const mk = (base) => {
    const { expect, observation } = base;
    const feat = expect.kind === 'enter' ? base.feature : undefined;
    const sentence = GQ.sentenceOf(expect, feat);
    return { ...base, sentence, feat };
  };
  for (const row of rows) {
    if (!row.expect) continue;
    const key = `${G.slice}|Q4|${seed}|ok|${row.k}`;
    const cell = row.truth.kind === 'enter' ? row.truth.cell : null;
    let remote = false;
    if (row.expect.kind === 'toggle' && row.switchIndex >= 0) remote = w.switches[row.switchIndex].targets.every(mi => { const e = w.edges[w.mechs[mi].edge]; return e.a !== row.pre.pos && e.b !== row.pre.pos; });
    out.push(mk({ id: `ok:${row.k}`, role: 'ok', k: row.k, op: null, action: row.action, expect: row.expect, truth: row.truth, observation: row.observation, label: 'as_expected', feature: cell === null ? undefined : feature(cell, key), key, kind: row.expect.kind, pre: row.pre, post: row.post, remote }));
  }
  for (let k = 0; k < rows.length; k++) {
    const props = [...GQ.proposeOps(mod, route, k, `${seed}|${k}`)];
    const ret = GQ.proposeReturn(mod, route, k, `${seed}|${k}`);
    if (ret) props.push(ret);
    for (const p of props) {
      const run = GQ.runProposal(mod, route, k, p);
      if (run.label !== 'drifted') continue;                     // a proposal the world happens to satisfy is not a drift
      const key = `${G.slice}|Q4|${seed}|${p.op}|${k}`;
      const cell = p.truth.kind === 'enter' ? p.truth.cell : null;
      // a wrong-room drift always names a fixture of the believed room (the distractor variant needs it)
      const feat = cell === null ? undefined : (p.op === 'wrong-room' || unit(`${key}|feat`) < 0.35 ? GQ.featureFor(mod, route, cell, `${key}|f`) : undefined);
      out.push(mk({ id: `${p.op}:${k}`, role: 'drift', k, op: p.op, action: p.action, expect: p.expect, truth: p.truth, observation: run.observation, label: 'drifted', feature: feat, key, kind: p.expect.kind, pre: run.pre, post: run.post, detail: p.detail }));
    }
  }
  return out;
}

const OP_WEIGHTS = Object.freeze({ 'wrong-exit': 1, 'locked-door': 8, 'wrong-key': 10, 'one-way-return': 20, 'one-way-entry': 8, 'wrong-room': 1, 'unaware-coupling': 30, 'empty-container': 1, 'wrong-key-found': 10, 'absent-item': 0.5, 'no-treasure': 0.4 });
const FLIP_OPS = new Set(['wrong-room', 'unaware-coupling']);
function weightedDraw(items, weight, n, key) {
  const left = [...items].sort((a, b) => byHash(sha(`${key}|${a.id}`), sha(`${key}|${b.id}`))), out = [];
  for (let slot = 0; slot < n && left.length; slot++) {
    const w = left.map(weight), total = w.reduce((a, b) => a + b, 0);
    let x = unit(`${key}|draw${slot}`) * total, i = 0;
    while (i < left.length - 1 && (x -= w[i]) >= 0) i++;
    out.push(left.splice(i, 1)[0]);
  }
  return out;
}

function q4Record(c, ctx0, extra = {}) {
  const { G, task, seed, difficulty, wh, masks } = ctx0, contract = G.contracts.Q4;
  const observation = extra.observation ?? scrubFamilySpans(c.observation, seed, G.slice);
  const sentence = extra.sentence ?? c.sentence;
  const kitSlots = { action: c.action, expected_effect: sentence, observation };
  const state = kits.gridquest.Q4.buildState(task, kitSlots);
  const form = q4Form(sentence, observation, masks);
  return makeRecord({ contract, slice: G.slice, opts: G.opts, key: `${c.key}${extra.tag ? `|${extra.tag}` : ''}`, state, label: extra.label ?? c.label, target: extra.target,
    meta: { family: 'gridquest', bed: 'gridquest', seed, difficulty, worldHash: wh, variant: extra.variant ?? 'clean', formId: form, surface: { source: extra.source ?? 'bed', slice: G.slice, lineHash: spanHash(`${sentence}\n${parseObservation(observation).lastAction}`) }, masks,
      kit: { port: 'Q4', slots: kitSlots }, q4: { op: c.op, kind: c.kind, k: c.k, role: c.role, action: c.action, truth: c.truth, detail: c.detail ?? null, feature: c.feat ?? null }, ...(extra.meta ?? {}) } });
}

async function* gridquestQ4(G, mod, seed, difficulty, perWorld) {
  const task = mod.index.generate({ seed, split: G.def.bedSplit, difficulty });
  const wh = worldHash(task), masks = GQ.masksOf(mod, task);
  const ctx0 = { G, task, seed, difficulty, wh, masks };
  const route = GQ.trueRoute(mod, task);
  const cands = q4Candidates(mod, route, task, G, seed);
  // surfaces: the row's decisive span (expected sentence, the relation of header to expectation, the result line) in this slice's skeleton bucket
  const usable = cands.filter(c => {
    const obs = scrubFamilySpans(c.observation, seed, G.slice);
    if (G.slice !== 'test-ood' && carriesInjection(obs)) { bump(G, 'q4:injection-left'); return false; }
    return bucketAllows(G.slice, q4Form(c.sentence, obs, masks));
  });
  bump(G, 'q4:candidates', cands.length); bump(G, 'q4:usable', usable.length);
  const drifts = usable.filter(c => c.role === 'drift'), oks = usable.filter(c => c.role === 'ok');
  if (!drifts.length && !oks.length) return;
  const chosen = weightedDraw(drifts, c => OP_WEIGHTS[c.op] ?? 1, perWorld, `${G.slice}|Q4|${seed}|drift`);
  const used = new Set(), picked = [];
  for (const d of chosen) {
    picked.push({ c: d, pair: null });
    // a flip pair: the same step, the same observation, the expectation of the true map against the believed one
    const twin = FLIP_OPS.has(d.op) ? oks.find(o => o.k === d.k && !used.has(o.id)) : null;
    if (twin) { used.add(twin.id); picked.push({ c: twin, pair: `gq4flip:${G.slice}:${seed}:${d.id}` }); picked[picked.length - 2].pair = picked.at(-1).pair; continue; }
    // otherwise an as_expected row of the same expectation kind, so that the kind of the expectation does not predict the label
    const same = oks.filter(o => o.kind === d.kind && !used.has(o.id)), pool = same.length ? same : oks.filter(o => !used.has(o.id));
    const ok = weightedDraw(pool, () => 1, 1, `${G.slice}|Q4|${seed}|ok|${d.id}`)[0];
    if (ok) { used.add(ok.id); picked.push({ c: ok, pair: null }); }
  }
  const test = G.test, carriers = q4Carriers(G);
  for (const { c, pair } of picked) {
    const rec = q4Record(c, ctx0, pair ? { variant: 'flip', meta: { pairId: pair } } : {});
    yield rec;
    const obs = rec.state.observation;
    // a cosmetic re-render (the room is the same): the label does not move
    if (unit(`${c.key}|inv`) < G.share.invariance) {
      const p = GQ.permuteDescription(obs, `${c.key}|perm`);
      if (p) { const twin = q4Record(c, ctx0, { observation: p, tag: 'perm', variant: 'invariance', meta: { pairId: `gq4:${G.slice}:${seed}:${c.id}:perm`, counterfactual: { swapped: true, from: 'sentence order', to: 'permuted', path: 'observation' } } }); if (rec.meta.pairId === undefined) rec.meta.pairId = twin.meta.pairId; yield twin; }
    }
    // a carrier urging the wrong answer, inserted at a sentence boundary (paired with the clean row)
    if (unit(`${c.key}|inj`) < G.share.injection) {
      const pool = carriers[c.label === 'drifted' ? 'as_expected' : 'drifted'];
      if (pool.length) {
        const text = pickBy(pool, `${c.key}|carrier`), ins = GQ.insertSentence(obs, text, `${c.key}|carrier`);
        const pairId = rec.meta.variant === 'clean' ? (rec.meta.pairId ??= `gq4:${G.slice}:${seed}:${c.id}:inj`) : `gq4:${G.slice}:${seed}:${c.id}:inj`;
        yield q4Record(c, ctx0, { observation: ins, tag: 'inj', variant: 'injection', source: OOD.has(G.slice) ? 'authored' : 'authored-builtin', meta: { pairId, counterfactual: { swapped: false, from: null, to: 'carrier', path: 'observation' }, carrier: spanHash(text) } });
      }
    }
    if (test && unit(`${c.key}|para`) < G.share.paraphrase) { const p = paraphraseOf(rec, G.contracts.Q4, G.slice, G.opts, c.key); if (p) yield p; }
    // the same room name for a different room: kept only where the observation tells the rooms apart
    if (c.op === 'wrong-room' && unit(`${c.key}|same`) < G.share.sameName) {
      const believed = c.expect.room, d = sameNameDistractor({ sentence: c.sentence, observation: obs, believedRoom: believed });
      if (!d.kept) bump(G, 'q4:samename-dropped'); else { bump(G, 'q4:samename-kept'); yield q4Record(c, ctx0, { observation: d.observation, tag: 'same', variant: 'distractor', meta: { counterfactual: { swapped: true, from: 'header', to: believed, path: 'observation' }, sameName: true } }); }
    }
  }
  // presence-matched unknowable (§2.5): the remote effects of a switch are reported only in the result line; replace it by
  // the same-register line that settles nothing. The label stays the true one (as_expected); the training target is uniform.
  for (const c of oks.filter(o => o.remote && o.kind === 'toggle')) {
    if (unit(`${c.key}|unk`) >= G.share.unknowable) continue;
    const o = parseObservation(c.observation), first = /^You [a-z ]+ the [a-z]+\./.exec(o.lastAction)?.[0];
    if (!first) continue;
    const obs = scrubFamilySpans(GQ.withLastAction(c.observation, first), seed, G.slice);
    const rec = q4Record(c, ctx0, { observation: obs, tag: 'unk', variant: 'unknowable', target: G.slice === 'train' ? uniformTarget(['as_expected', 'drifted']) : undefined, meta: { counterfactual: { swapped: true, from: 'result line', to: 'result line without the remote effects', path: 'observation' } } });
    if (bucketAllows(G.slice, rec.meta.formId)) yield rec; else bump(G, 'q4:unknowable-bucket');
  }
}

// ================================================================================================================
// Q1 room_exit and Q2 container_cue (wave-2 smoke sets, gridquest)
// ================================================================================================================
async function* gridquestQ1(G, mod, seed, difficulty, perWorld) {
  const task = mod.index.generate({ seed, split: G.def.bedSplit, difficulty }), wh = worldHash(task), masks = GQ.masksOf(mod, task);
  const W = mod.index._internal.world(task), route = GQ.trueRoute(mod, task);
  // states along the reference route in distinct rooms (up to perWorld)
  const ks = shuffled([...route.snaps.keys()], `${G.slice}|Q1|${seed}|ks`), seenCells = new Set(), chosen = [];
  for (const k of ks) {
    const cell = route.snaps[k].st.pos;
    if (seenCells.has(cell)) continue;
    seenCells.add(cell); chosen.push(k);
    if (chosen.length >= perWorld) break;
  }
  const log = (G.labellerLog ??= []);
  for (const k of chosen) {
    const probed = GQ.probeExits(mod, task, k, log), edges = GQ.exitsByEdges(mod, task, k);
    if (DIRECTIONS.some(d => probed.labels[d] !== edges.labels[d])) { bump(G, 'q1:path-disagree'); continue; }
    const observation = scrubFamilySpans(probed.observation, seed, G.slice), form = formOf(parseObservation(observation).description, masks);
    if (!bucketAllows(G.slice, form)) continue;
    const slots = { observation }, state = kits.gridquest.Q1.buildState(task, slots), key = `${G.slice}|Q1|${seed}|${k}`;
    const questions = {};
    for (const d of DIRECTIONS) {
      const w = wordingFor(G.contracts.Q1, G.slice, `${key}|${d}`, G.opts);
      questions[`Q1~${d}`] = labelledQuestion(G.contracts.Q1, { label: probed.labels[d], wording: w.wording, wordingText: w.wordingText, slots: { direction: d }, optionOrder: optionOrder(Object.keys(G.contracts.Q1.options), `${key}|${d}`) });
    }
    yield { state, questions, meta: { family: 'gridquest', bed: 'gridquest', seed, difficulty, worldHash: wh, variant: 'clean', formId: form, labelSource: 'simulator', needsWorldKnowledge: false, wordingId: 'Q0-Q3', surface: { source: 'bed', slice: G.slice, lineHash: spanHash(state.observation) }, masks,
      kit: { port: 'Q1', slots }, q1: { k, labeller: { path: 'createEnv', lifetimeActions: 'Infinity', lifted: true, probes: 4 }, secondPath: 'w.edges + abstract model', labels: probed.labels } } };
  }
}
async function* gridquestQ2(G, mod, seed, difficulty, perWorld) {
  const task = mod.index.generate({ seed, split: G.def.bedSplit, difficulty }), wh = worldHash(task), masks = GQ.masksOf(mod, task);
  const { items, stats } = GQ.containerSentences(mod, task);
  bump(G, 'q2:objects', stats.objects); bump(G, 'q2:aligned', stats.aligned);
  const cands = items.map((x, j) => ({ ...x, id: `q2:${x.cell}:${x.noun}`, form: formOf(x.sentence, masks), label: x.cued ? 'cued' : 'plain' }))
    .filter(x => (x.kind !== 'decor' || unit(`${G.slice}|Q2|${seed}|${x.id}|decor`) < 0.5) && bucketAllows(G.slice, x.form));
  const cued = cands.filter(x => x.label === 'cued'), plain = cands.filter(x => x.label === 'plain');
  const nCued = Math.ceil(perWorld / 2);
  const chosen = [...weightedDraw(cued, () => 1, nCued, `${G.slice}|Q2|${seed}|cued`), ...weightedDraw(plain, x => (x.kind === 'plain' ? 2 : 1), perWorld - nCued, `${G.slice}|Q2|${seed}|plain`)];
  for (const x of chosen) {
    const observation = scrubFamilySpans(x.observation, seed, G.slice);
    if (!descriptionSentences(parseObservation(observation).description).includes(x.sentence)) continue;
    const slots = { observation, sentence: x.sentence }, state = kits.gridquest.Q2.buildState(task, slots);
    yield makeRecord({ contract: G.contracts.Q2, slice: G.slice, opts: G.opts, key: `${G.slice}|Q2|${seed}|${x.id}`, state, label: x.label,
      meta: { family: 'gridquest', bed: 'gridquest', seed, difficulty, worldHash: wh, variant: 'clean', formId: x.form, labelSource: 'generator', surface: { source: 'bed', slice: G.slice, lineHash: spanHash(x.sentence) }, masks, kit: { port: 'Q2', slots }, q2: { kind: x.kind, cue: x.object.cue ?? null } } });
  }
}

// ================================================================================================================
// Q4:gameqa (held-out family, test-ood only)
// ================================================================================================================
const Q4_TEMPLATE_WEIGHT = Object.freeze({ crash_action: 1, stale_hud: 0.25, purse_wrap: 1, chest_rubble: 4, price_rounding: 1.5, wall_clip: 1, stairs_drop: 1, load_dupe: 1, door_bypass: 1.2, key_eaten: 4, enemy_teleport: 2, enemy_freeze: 2, ghost_sprite: 2 });

async function* gameqaQ4(G, qa, seed, difficulty, perWorld) {
  const task = qa.index.generate({ seed, split: G.def.bedSplit, difficulty }), c = qa.case.caseFor(task);
  const wh = worldHash(task), masks = QA.masksOf(c);
  const { steps } = QA.q4Steps(qa, task, c);
  const drifts = steps.filter(x => x.label === 'drifted').map((x, j) => ({ ...x, id: `d${j}` })), oks = steps.filter(x => x.label === 'as_expected').map((x, j) => ({ ...x, id: `o${j}` }));
  const chosen = weightedDraw(drifts, d => Math.min(...d.firedTemplates.map(t => Q4_TEMPLATE_WEIGHT[t] ?? 1)), perWorld, `${G.slice}|Q4qa|${seed}|drift`);
  const used = new Set();
  const rec = (x, role) => {
    const obsText = compactObservation(x.observation);
    const slots = { action: x.action, expect: x.expected, observation: obsText };
    const state = kits.gameqa.Q4.buildState(task, slots);
    const key = `${G.slice}|Q4qa|${seed}|${x.prefix.join(',')}`;
    return makeRecord({ contract: G.contracts.Q4, slice: G.slice, opts: G.opts, key, state, label: x.label,
      meta: { family: 'gameqa', bed: 'gameqa', seed, difficulty, worldHash: wh, variant: 'clean', formId: formOf(`${state.expected_effect} // ${state.observation}`, masks), surface: { source: 'bed', slice: G.slice, lineHash: spanHash(`${state.expected_effect}\n${state.observation}`) }, masks,
        kit: { port: 'Q4', slots: { action: x.action, expect: x.expected, observation: obsText } },
        q4: { role, kind: x.kind, bug: x.bug, i: x.i, probe: x.probe, templates: x.firedTemplates, classes: x.firedClasses, ids: x.firedIds, prefix: x.prefix } } });
  };
  for (const d of chosen) {
    yield rec(d, 'drift');
    // an as_expected row of the same kind of action (the kind of the action does not predict the label)
    const pool = oks.filter(o => o.kind === d.kind && !used.has(o.id)), pick = weightedDraw(pool.length ? pool : oks.filter(o => !used.has(o.id)), o => (o.probe ? 1 : 2), 1, `${G.slice}|Q4qa|${seed}|ok|${d.id}`)[0];
    if (pick) { used.add(pick.id); yield rec(pick, 'ok'); }
  }
}

// ================================================================================================================
// X1:gameqa (train family) and X1:gridquest (held-out family, test-ood only)
// ================================================================================================================
const lineFamilyOk = (l, fam) => l.family === undefined || l.family === fam;
function x1Lines(G) {
  const own = linesFor(G).filter(l => l.port === 'X1' && lineFamilyOk(l, 'gameqa') && (OOD.has(G.slice) ? lineSlice(l) === G.slice : lineSlice(l) === 'train'));
  const out = { positive: [], negative: [] };
  for (const l of own) {
    const label = l.label ?? (l.role === 'positive' ? 'yes' : 'no');
    if (label === 'yes') out.positive.push({ ...l, label }); else if (label === 'no') out.negative.push({ ...l, label });
  }
  return out;
}
const lineKey = l => l.id ?? sha(l.text).slice(0, 12);

async function* gameqaX1(G, qa, seed, difficulty, perWorld) {
  const task = qa.index.generate({ seed, split: G.def.bedSplit, difficulty }), c = qa.case.caseFor(task);
  const wh = worldHash(task), masks = QA.masksOf(c);
  const { reports, stats } = alignReports(task);
  bump(G, 'x1:reports', stats.reports); bump(G, 'x1:aligned', stats.aligned);
  const lines = x1Lines(G), test = G.test, pinnedOn = G.opts.builtin !== false && !OOD.has(G.slice);
  // candidates --------------------------------------------------------------------------------------------------------
  const cand = [];
  const meta = (extra) => ({ family: 'gameqa', bed: 'gameqa', seed, difficulty, worldHash: wh, masks, ...extra });
  for (const a of reports) {
    const body = stripPadding(a.report.body);
    if (a.injection) {
      const form = formOf(a.injection, masks), text = a.mode === 'pinned' ? 'pinned' : 'appended';
      cand.push({ id: `bed:${a.id}`, label: 'yes', slots: { report: a.id }, form, source: 'bed', kind: a.mode === 'pinned' ? 'pinned-injection' : 'appended-injection', hard: null, addressee: QA.hasAddressee(a.injection), labelSource: 'generator', weight: 1 });
    } else {
      const span = `${a.report.title} ${body}`, form = formOf(span, masks), hard = QA.hardNegativeKind(span);
      cand.push({ id: `bed:${a.id}`, label: 'no', slots: { report: a.id }, form, source: 'bed', kind: `report-${a.kind}`, hard, addressee: QA.hasAddressee(span), labelSource: 'generator', weight: hard ? 2.5 : 1 });
    }
  }
  const hosts = reports.filter(a => !a.injection && a.report.source !== 'telemetry' && a.kind !== 'instruction');
  const composed = (l, j) => {
    const host = hosts.length ? pickBy(hosts, `${G.slice}|X1|${seed}|host|${lineKey(l)}|${j}`) : null;
    if (!host) return null;
    return { id: `line:${lineKey(l)}:${host.id}`, label: l.label, slots: { report: host.id, append: l.text }, form: formOf(l.text, masks), source: 'authored', kind: `line-${l.role ?? 'decisive'}`, hard: l.label === 'no' ? QA.hardNegativeKind(l.text) : null, addressee: QA.hasAddressee(l.text), labelSource: 'authored-brief', weight: l.label === 'yes' ? (QA.hasAddressee(l.text) ? 1 : 2.4) : (QA.hasAddressee(l.text) ? 3 : 1.2), line: lineKey(l) };
  };
  const posLines = shuffled(lines.positive, `${G.slice}|X1|${seed}|lp`).slice(0, 4), negLines = shuffled(lines.negative, `${G.slice}|X1|${seed}|ln`).slice(0, 6);
  posLines.forEach((l, j) => { const x = composed(l, j); if (x) cand.push(x); });
  negLines.forEach((l, j) => { const x = composed(l, j); if (x) cand.push(x); });
  if (pinnedOn) {
    shuffled(BENIGN_PINNED.map((t, j) => ({ t, j })), `${G.slice}|X1|${seed}|bp`).slice(0, 4).forEach(({ t: [title, body], j }) => {
      cand.push({ id: `pinned:${j}`, label: 'no', slots: { text: `${title}\n${body}`, source_kind: 'tracker post' }, form: formOf(`${title} ${body}`, masks), source: 'authored-builtin', kind: 'benign-pinned', hard: QA.hardNegativeKind(body) ?? 'pinned', addressee: QA.hasAddressee(body), labelSource: 'authored-brief', weight: 2 });
    });
  }
  const usable = cand.filter(x => bucketAllows(G.slice, x.form));
  bump(G, 'x1:candidates', cand.length); bump(G, 'x1:usable', usable.length);
  const pos = usable.filter(x => x.label === 'yes'), neg = usable.filter(x => x.label === 'no');
  const nPos = Math.max(1, Math.round(perWorld * 0.4));
  const chosen = [...weightedDraw(pos, x => x.weight, nPos, `${G.slice}|X1|${seed}|pos`), ...weightedDraw(neg, x => x.weight, perWorld - nPos, `${G.slice}|X1|${seed}|neg`)];
  for (const x of chosen) {
    const state = kits.gameqa.X1.buildState(task, x.slots);
    const key = `${G.slice}|X1|${seed}|${x.id}`;
    yield makeRecord({ contract: G.contracts.X1, slice: G.slice, opts: G.opts, key, state, label: x.label,
      meta: meta({ variant: 'clean', formId: x.form, labelSource: x.labelSource, surface: { source: x.source, slice: G.slice, lineHash: spanHash(x.slots.append ?? x.slots.text ?? state.text) }, kit: { port: 'X1', slots: x.slots }, x1: { kind: x.kind, hard: x.hard, addressee: x.addressee, line: x.line ?? null } }) });
  }
  // the long variant: the span inside a window of the tracker (about 6 reports)
  if (unit(`${G.slice}|X1long|${seed}`) < (G.opts.longShare ?? 0.15) && reports.length >= 6) {
    const all = task.inputs.reports, pickPos = unit(`${G.slice}|X1longpos|${seed}`) < 0.5, injReports = reports.filter(a => a.injection);
    const startMax = all.length - 6;
    let start = hnum(`${G.slice}|X1longwin|${seed}`) % (startMax + 1);
    if (pickPos && injReports.length) { const at = all.findIndex(r => r.id === pickBy(injReports, `${G.slice}|X1longinj|${seed}`).id); start = Math.max(0, Math.min(startMax, at - (hnum(`${G.slice}|X1longoff|${seed}`) % 6))); }
    const ids = all.slice(start, start + 6).map(r => r.id), win = reports.filter(a => ids.includes(a.id)), has = win.some(a => a.injection);
    const span = has ? win.find(a => a.injection).injection : `${win[0].report.title}`, form = formOf(span, masks);
    if (bucketAllows(G.slice, form)) {
      const slots = { reports: ids }, state = kits.gameqa.X1.buildState(task, slots);
      yield makeRecord({ contract: G.contracts.X1, slice: G.slice, opts: G.opts, key: `${G.slice}|X1|${seed}|long`, state, label: has ? 'yes' : 'no',
        meta: meta({ variant: 'long', formId: form, labelSource: 'generator', surface: { source: 'bed', slice: G.slice, lineHash: spanHash(state.text) }, kit: { port: 'X1', slots }, x1: { kind: has ? 'window-with-injection' : 'window', hard: null, addressee: has ? QA.hasAddressee(span) : false, line: null } }) });
    }
  }
}
const alignJournalEntry = entry => GRIDQUEST_JOURNAL_INJECTIONS.includes(entry);

// ----------------------------------------------------------------------------------------------------------------
// X1:gridquest (held-out family): the injection inscriptions and the journal injections against graffiti, journal notes and
// ordinary room sentences. Registered spans (heldoutSpans) are the injections: the label-bearing, family-specific text.
// ----------------------------------------------------------------------------------------------------------------
async function* gridquestX1(G, mod, seed, difficulty, perWorld) {
  const task = mod.index.generate({ seed, split: G.def.bedSplit, difficulty }), wh = worldHash(task), masks = GQ.masksOf(mod, task);
  const W = mod.index._internal.world(task), w = W.w;
  const st = { pos: 0, inv: [], revealed: [], unlocked: [], mech: w.mechs.map(m => m.open0), swCount: w.switches.map(() => 0), steps: 0, won: false };
  const cand = [];
  const meta = (extra) => ({ family: 'gridquest', bed: 'gridquest', seed, difficulty, worldHash: wh, masks, labelSource: 'generator', ...extra });
  for (let cell = 0; cell < w.n * w.n; cell++) {
    st.pos = cell;
    const observation = mod.render.observationText(w, st, W.budget, 'You go north.');
    const o = parseObservation(observation);
    for (const k of roomSentenceKindsOf(o.description)) {
      if (k.kind === 'ordinary' && unit(`${G.slice}|X1gq|${seed}|${cell}|${k.sentence}`) > 0.06) continue;
      const label = k.kind === 'injection' ? 'yes' : 'no';
      cand.push({ id: `room:${cell}:${sha(k.sentence).slice(0, 8)}`, label, kind: k.kind, sentence: k.sentence, observation, slots: { observation, sentence: k.sentence }, form: formOf(k.sentence, masks) });
    }
  }
  (task.inputs.journal ?? []).forEach((e, i) => {
    const inj = alignJournalEntry(e.entry);
    cand.push({ id: `journal:${i}`, label: inj ? 'yes' : 'no', kind: inj ? 'journal-injection' : 'journal-note', sentence: e.entry, slots: { journal: i }, form: formOf(e.entry, masks) });
  });
  if (!cand.length) return;
  const pos = cand.filter(x => x.label === 'yes'), neg = cand.filter(x => x.label === 'no');
  const nPos = Math.max(1, Math.round(perWorld * 0.4));
  const hardW = x => (x.kind === 'ordinary' ? 0.5 : 2);
  const chosen = [...weightedDraw(pos, () => 1, nPos, `${G.slice}|X1gq|${seed}|pos`), ...weightedDraw(neg, hardW, perWorld - nPos, `${G.slice}|X1gq|${seed}|neg`)];
  for (const x of chosen) {
    const long = x.slots.observation && unit(`${G.slice}|X1gqlong|${seed}|${x.id}`) < (G.opts.longShare ?? 0.15);
    const slots = long ? { ...x.slots, long: true } : x.slots, state = kits.gridquest.X1.buildState(task, slots);
    yield makeRecord({ contract: G.contracts.X1, slice: G.slice, opts: G.opts, key: `${G.slice}|X1gq|${seed}|${x.id}`, state, label: x.label,
      meta: meta({ variant: long ? 'long' : 'clean', formId: x.form, surface: { source: 'bed', slice: G.slice, lineHash: spanHash(x.sentence) }, kit: { port: 'X1', slots }, x1: { kind: x.kind, hard: x.kind === 'ordinary' ? null : 'in-world-text', addressee: QA.hasAddressee(x.sentence), span: x.sentence } }) });
  }
}

// ================================================================================================================
// the generator
// ================================================================================================================
export async function* records(slice, seeds, opts = {}, ctx) {
  const G = makeContext(slice, opts, ctx), def = ctx.slice;
  const wanted = (opts.ports ?? SLICE_PORTS[slice] ?? []).flatMap(p => {
    const s = String(p);
    if (s.includes(':')) return [s];
    return Object.keys(JOBS).filter(j => j === s || j.startsWith(`${s}:`));
  });
  const jobs = [...new Set(wanted)];
  for (const j of jobs) if (HELD_OUT_JOBS.includes(j) && slice !== 'test-ood') throw fail('HELDOUT_FAMILY', `${j} is a held-out family (test-ood only, §3.4); it is not generated in ${slice}`);
  if (!jobs.length) return;
  const perWorld = { ...(PER_WORLD[slice] ?? {}), ...(opts.perWorld ?? {}) };
  const diffs = Array.isArray(opts.difficulties) ? { gridquest: opts.difficulties, gameqa: opts.difficulties } : { gridquest: [1, 2, 3, 4, 5], gameqa: [2, 3, 4, 5], ...(opts.difficulties ?? {}) };
  const need = bed => jobs.some(j => BED_OF(j) === bed);
  const mod = need('gridquest') ? await GQ.loadGq(ctx.beds) : null;
  const qa = need('gameqa') ? await QA.loadQa(ctx.beds) : null;
  const smokeEvery = opts.smokeEvery ?? 6, smoke = (job, seed) => hnum(`${slice}|smoke|${job}|${seed}`) % smokeEvery === 0;
  for (const seed of seeds) {
    if (jobs.includes('Q4:gridquest') && perWorld['Q4:gridquest']) yield* gridquestQ4(G, mod, seed, GQ.difficultyOf(seed, diffs.gridquest), perWorld['Q4:gridquest']);
    if (jobs.includes('Q1') && perWorld.Q1 && smoke('Q1', seed)) yield* gridquestQ1(G, mod, seed, GQ.difficultyOf(seed, diffs.gridquest), perWorld.Q1);
    if (jobs.includes('Q2') && perWorld.Q2 && smoke('Q2', seed)) yield* gridquestQ2(G, mod, seed, GQ.difficultyOf(seed, diffs.gridquest.filter(d => d >= 2)), perWorld.Q2);
    if (jobs.includes('X1:gridquest') && perWorld['X1:gridquest']) yield* gridquestX1(G, mod, seed, GQ.difficultyOf(seed, diffs.gridquest.filter(d => d >= 3)), perWorld['X1:gridquest']);
    if (jobs.includes('X1:gameqa') && perWorld['X1:gameqa']) yield* gameqaX1(G, qa, seed, QA.difficultyOf(seed, diffs.gameqa.filter(d => d >= 3)), perWorld['X1:gameqa']);
    if (jobs.includes('Q4:gameqa') && perWorld['Q4:gameqa']) yield* gameqaQ4(G, qa, seed, QA.difficultyOf(seed, diffs.gameqa), perWorld['Q4:gameqa']);
  }
}
export const describe = G => G.counts;
