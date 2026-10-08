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
//   wordings       { Q4: [{id, text, slice?}], X1: [...] } the held-out wordings (OOD slices; required there); a wording that names
//                  its slice is used in that slice only
//   lines          authored lines (train-pools schema and heldout surface units): { port, role, label, target?, text, slice?, ... };
//                  a Q4 carrier urges `target` (the held-out store's shape) or `label`; lines with an unfilled {slot} are skipped
//   pools          { dir, digest } train pool files <dir>/X1.jsonl (verified against the digest)
//   builtin        false: no built-in authored lines (lib: ports/interactive-lines.mjs) in train-like slices
//   share          { injection, invariance, paraphrase, sameName } fractions of clean Q4:gridquest rows that get a twin;
//                  unknowable (default 0) builds the gap diagnostic in an evaluation slice and is refused in train
//   smokeEvery     a wave-2 smoke port uses one world in `smokeEvery` (default 6)
//
// Readings of the specification taken here (each is tested or reported by test/interactive.test.mjs):
//   - Q1 never labels the terminal state (the engine ignores every action after the treasure is taken); the labeller lifts the engine's
//     lifetime action ledger (lifetimeActions: Infinity), logs it on every probe, and is cross-checked by a second path (world edges plus the
//     abstract model's state bits).
//   - Q4:gameqa reads the compact observation (events, HUD line, player cell, status) of the post-action state; a planted bug whose
//     effect is not in that reading (enemy_ai, ghost_sprite, enemy_lag and the like) is dropped, not labelled.
//   - Q4 unknowable: gridquest reports every effect of a switch, so the only unknowable it gives is a GAP (the remote effects deleted
//     from the result line). §2.5 forbids gaps and a bag-of-words probe separates them from stated rows at 1.000, so none is trained
//     (UNKNOWABLE_GAP) or built by default; an evaluation slice may opt in to a labelled diagnostic (meta.unkAxis.kind 'gap'). The
//     presence-matched Q4 unknowable comes from Q4's other train family (ports/runbook.mjs builds it); gridquest has none. Every row of every other variant lies in
//     its slice's skeleton bucket (a same-name distractor is re-bucketed by its own form).
//   - Q4 drifts are drawn only with an as_expected row of the same pairing signature (kind; the direction of a move or unlock;
//     whether a fixture is named; the container searched), and a switch's plan may list one effect too few (unaware coupling) or,
//     for a single-target switch, one too many (phantom coupling): the plan alone does not predict the label (§2.7 step 7).
//   - The held-out families (Q4:gameqa, X1:gridquest, X2:gameqa) are not bucket-restricted: the family is the held-out axis.
//   - A world-independent state (a pinned tracker post, a Q2 sentence, a Q6 behaviour) is a state of one slice only: the built-in
//     pinned posts are split between train, calib-in, dev-select and test-in by a hash of the post; what still collides is dropped by the
//     build (rule 7). Repeated states in test-in and test-ood are dropped here.
//   - X1:gridquest registers the injection spans only (negatives are shared bed prose); X1:gameqa has bed injection forms in the train
//     bucket only, so an OOD slice has X1:gameqa positives only from slice-tagged held-out lines in opts.lines. Those lines belong to
//     their slice by the held-out store's own rule (heldout/pools.mjs oodSliceOfHash) and are not re-bucketed here. Where an OOD slice
//     has such positives, its X1:gameqa negatives are held-out negative lines appended the same way (no plain bed report, no tracker
//     window): every row has one shape, recorded in meta.x1.format ('appended', 'post', 'report', 'window') in every slice.
//   - X1:gridquest rows come in pairs of one format (a sentence, or the room description) and one source (room, journal), matched in
//     length; a description negative is a room with no inscription. Its nine positive sentences are asked once per test slice.
//   - Q5 holds out 3 of the 13 bug templates (q5HeldoutTemplates: in each class the bed plants with more than one template, the
//     last one; chest_rubble, enemy_freeze, stale_hud), never built in a train-like slice (§3.3).
//   - X2:gameqa pairs the bed's ALIAS words, keeping only pairs a reader decides from the legend and plain English (X2_READABLE):
//     the bed's slang is knowledge the port does not declare. The program's gameqa source (findings, bugs[].id) is an open item.
//   - formId of Q1, Q2 and Q3 is the skeleton of the whole description (or sentence): their form counts over-count; they are smoke sets.
//   - Every authored line of ports/interactive-lines.mjs and every row composed from a pool line is pending the two-model filter
//     (ports/interactive-lines.mjs PENDING_FILTER); the row says so in meta.surface.source ('authored', 'authored-builtin') and carries
//     the line's filter status (meta.surface.filter, meta.carrierFilter).
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { labelledQuestion, questionId } from '../lib/render.mjs';
import { optionOrder } from '../lib/balance.mjs';
import { worldHash, skeleton, skeletonBucket, spanHash, canonical, stateHash } from '../lib/hash.mjs';
import { stringLeaves } from '../lib/leakage.mjs';
import {
  kits, compactObservation, parseObservation, describeExpectation, parseExpectation, descriptionSentences, lowerFirst, DIRECTIONS,
} from '../judges/interactive.mjs';
import * as GQ from './interactive-gq.mjs';
import * as QA from './interactive-qa.mjs';
import { Q4_CARRIERS, NEUTRAL_INSCRIPTIONS, BENIGN_PINNED } from './interactive-lines.mjs';
import * as TAP from '../taps/interactive.mjs';
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
const DEFAULT_Q3 = 3;
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
// unknowable 0: see makeContext (UNKNOWABLE_GAP); an evaluation slice may opt in with opts.share.unknowable
const DEFAULT_SHARE = Object.freeze({ injection: 0.12, invariance: 0.1, paraphrase: 0.18, unknowable: 0, sameName: 0.6 });
const TRAIN_LIKE = new Set(['train', 'calib-in', 'dev-select', 'test-in']);
const OOD = new Set(['calib-ood', 'dev-ood', 'test-ood']);

// ---- skeleton buckets (§3.1, §3.3) ------------------------------------------------------------------------------------------------
// The label-bearing span of a row is hashed by its masked skeleton: train, calib-in, dev-select and test-in read the
// bucket 40-100%, calib-ood 30-40%, dev-ood 20-30%, test-ood 0-20%.
const BUCKET_OF_SLICE = { train: 'train', 'calib-in': 'train', 'dev-select': 'train', 'test-in': 'train', 'calib-ood': 'calib-ood', 'dev-ood': 'dev-ood', 'test-ood': 'test-ood' };
export const bucketAllows = (slice, formHash) => skeletonBucket(formHash) === BUCKET_OF_SLICE[slice];
const formOf = (text, masks) => skeleton(text, masks);

// ---- wording and records -------------------------------------------------------------------------------------------------------------
// a held-out wording that names its slice (the held-out store's wordings.jsonl rows do) is used in that slice only, so a
// flat list of all three OOD slices' wordings cannot put a test-ood wording into calib-ood (the build's guard would refuse it)
const sliceWordings = (opts, port, slice) => (opts.wordings?.[port] ?? []).filter(w => w.slice === undefined || w.slice === slice);
function wordingFor(contract, slice, key, opts, taken = []) {
  const port = contract.id, held = (contract.heldoutWordings?.[slice] ?? 0) > 0;
  if (held) {
    const list = sliceWordings(opts, port, slice).filter(w => !taken.includes(w.id));
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
  const list = sliceWordings(opts, port, slice);
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
// A line with an unfilled slot placeholder ({S}, {token}, {field}: the held-out store and the train pools write slotted lines)
// names a system or a token the interactive beds do not have; it is skipped and counted, never inserted with its braces.
const PLACEHOLDER = /\{[A-Za-z_][A-Za-z0-9_]*\}/;
export function linesFor(G) {
  const o = G.opts;
  let raw = [...(o.lines ?? [])];
  if (o.pools?.dir) raw = [...readPool(o.pools.dir, 'X1', o.pools.digest).lines, ...raw];
  return raw.filter(l => {
    if (!l || typeof l.text !== 'string' || !l.text.trim()) return false;
    if (PLACEHOLDER.test(l.text)) { bump(G, 'lines:placeholder-skipped'); return false; }
    return true;
  });
}
const lineSlice = l => l.slice ?? 'train';
// the two-model filter status of an authored line (train pools: filters.twoModel; held-out store: filter), carried to the
// sidecar so the assembly can drop the lines that have not passed it (§2.3 rule 1)
const lineFilter = l => l.filters?.twoModel ?? (typeof l.filter === 'string' ? l.filter : l.filter?.status) ?? 'pending';
// The option a Q4 carrier urges: the held-out store writes carriers as { role: 'carrier', label: null, target: <option> }
// (heldout/assemble.mjs); a line may also give it as its label.
const carrierUrges = l => l.target ?? l.label;
// carriers of Q4 for a slice: built-in authored carriers in train-like slices (when allowed), the slice's own
// held-out carriers (opts.lines, role 'carrier', port Q4) in OOD slices. out[option] = the carriers that urge `option`.
function q4Carriers(G) {
  const own = linesFor(G).filter(l => l.port === 'Q4' && l.role === 'carrier' && (OOD.has(G.slice) ? lineSlice(l) === G.slice : lineSlice(l) === 'train'));
  const out = { as_expected: [], drifted: [] };
  for (const l of own) if (out[carrierUrges(l)]) out[carrierUrges(l)].push({ text: l.text, filter: lineFilter(l) }); else bump(G, 'q4:carrier-unknown-target');
  if (!OOD.has(G.slice) && G.opts.builtin !== false) {
    // a built-in carrier is used only where its skeleton falls in the train bucket (§3.1: authored train lines never carry an OOD form)
    for (const [label, key] of [['as_expected', 'asExpected'], ['drifted', 'drifted']]) for (const t of Q4_CARRIERS[key]) if (skeletonBucket(skeleton(t, {})) === 'train') out[label].push({ text: t, filter: 'pending' });
  }
  return out;
}

// the Q4 carriers a slice draws from, by the option they urge (for tests and reports): { as_expected: [{text, filter}], drifted: [...] }
export function q4CarrierPools(slice, opts = {}) {
  const G = { slice, opts: { ...opts }, counts: {} };
  return { carriers: q4Carriers(G), counts: G.counts };
}

// ---- the generation context ---------------------------------------------------------------------------------------------------------------
// opts.wordings is {port: [{id, text}]} (the same for every OOD slice a call asks) or {slice: {port: [...]}}
const wordingsOf = (o, slice) => (o.wordings && o.wordings[slice] && typeof o.wordings[slice] === 'object' && !Array.isArray(o.wordings[slice]) ? o.wordings[slice] : (o.wordings ?? {}));
function makeContext(slice, opts, ctx) {
  const o = { ...(opts ?? {}) };
  o.wordings = wordingsOf(o, slice);
  const share = { ...DEFAULT_SHARE, ...(o.share ?? {}) };
  // The only Q4 unknowable gridquest supports is a GAP (the remote effects deleted from the result line): §2.5 forbids gaps
  // ("never a gap"), a bag-of-words probe separates them from stated rows at 1.000, and training on them is the revision-1
  // failure. They are never trained; an evaluation slice may build them as a labelled diagnostic (meta.unkAxis.kind 'gap').
  if (share.unknowable > 0 && slice === 'train') throw fail('UNKNOWABLE_GAP', 'the Q4 gridquest unknowable is a deletion, not a presence-matched replacement (§2.5); it is not built in train');
  return { slice, ctx, contracts: ctx.contracts, def: ctx.slice, opts: o, ood: OOD.has(slice), test: slice === 'test-ood', share, counts: {}, notes: {} };
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
// The renamed row is a form of its own (its header now names the expected room: q4Form's relation is 'same room'), so with a
// slice it must also lie in that slice's skeleton bucket, like every other row (§3.3); otherwise it is dropped ('bucket').
export function sameNameDistractor({ sentence, observation, believedRoom, slice = null, masks = { names: [], markers: [] } }) {
  const renamed = GQ.withHeader(observation, believedRoom);
  const verdict = solveQ4Gridquest({ action: '', expected_effect: sentence, observation: renamed });
  const distinguishes = verdict.label === 'drifted';
  if (!distinguishes) return { observation: renamed, kept: false, reason: 'indistinguishable: the observation fits the expectation' };
  const form = q4Form(sentence, renamed, masks), inBucket = slice === null || bucketAllows(slice, form);
  if (!inBucket) return { observation: renamed, kept: false, reason: 'bucket', form };
  return { observation: renamed, kept: true, reason: 'the observation distinguishes the rooms', form };
}

// One candidate row of a world: an OK step of the true route or a drifting proposal.
function q4Candidates(mod, route, task, G, seed) {
  const { W, w, rows } = route, out = [];
  // whether an expectation names a fixture of its room is decided per step, for the true row and its drifting siblings alike: the clause is not a hint of the label
  const featureAt = k => unit(`${G.slice}|Q4|${seed}|feat|${k}`) < FEATURE_SHARE;
  const feature = (cell, k, key) => (featureAt(k) ? GQ.featureFor(mod, route, cell, `${key}|f`) : undefined);
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
    out.push(mk({ id: `ok:${row.k}`, role: 'ok', k: row.k, op: null, action: row.action, expect: row.expect, truth: row.truth, observation: row.observation, label: 'as_expected', feature: cell === null ? undefined : feature(cell, row.k, key), key, kind: row.expect.kind, pre: row.pre, post: row.post, remote }));
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
      const feat = cell === null ? undefined : feature(cell, k, key);
      out.push(mk({ id: `${p.op}:${k}`, role: 'drift', k, op: p.op, action: p.action, expect: p.expect, truth: p.truth, observation: run.observation, label: 'drifted', feature: feat, key, kind: p.expect.kind, pre: run.pre, post: run.post, detail: p.detail }));
    }
  }
  return out;
}

const OP_WEIGHTS = Object.freeze({ 'wrong-exit': 1, 'locked-door': 8, 'wrong-key': 10, 'one-way-return': 20, 'one-way-entry': 8, 'wrong-room': 2.5, 'unaware-coupling': 30, 'phantom-coupling': 30, 'empty-container': 1, 'wrong-key-found': 10, 'absent-item': 0.5, 'no-treasure': 0.4 });
const FLIP_OPS = new Set(['wrong-room', 'unaware-coupling', 'phantom-coupling']);
const FEATURE_SHARE = 0.4;
const DIR_WORD = /\b(north|east|south|west)\b/;
export const q4PairSig = c => (c.kind === 'enter' ? `enter|${DIR_WORD.exec(c.action)?.[1] ?? ''}|${c.feat ? 'feature' : ''}` : c.kind === 'unlock' ? `unlock|${DIR_WORD.exec(c.action)?.[1] ?? ''}`
  : c.kind === 'find' ? `find|${c.expect.container}` : c.kind);
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
  // Every drift row comes with an as_expected row of the SAME expectation kind from the same world (its flip twin where there is
  // one), and a drift whose kind has no unused as_expected row left is not drawn. Without this the plan alone predicted the label
  // (action-only probe 0.645 and expected-only 0.621 against a majority of 0.519 on dev-select: 'take treasure', 'examine' and
  // 'use' rows were mostly drifts), above the partial-input ceiling of majority + 3 pp (§2.7 step 7).
  // The pairing goes below the kind to the plan's own words where they carried the label: the direction of a move or an unlock
  // (route steps mostly go one way, wrong exits and one-way returns the other), whether the expectation names a fixture (rooms off
  // the route have fewer), the container of a search (the bed hides keys in some furniture and not in other). A flip twin is the
  // same step with the same signature.
  const used = new Set(), picked = [];
  const twinOf = d => (FLIP_OPS.has(d.op) ? oks.find(o => o.k === d.k && o.kind === d.kind && q4PairSig(o) === q4PairSig(d) && !used.has(o.id)) ?? null : null);
  const sameKind = d => oks.filter(o => q4PairSig(o) === q4PairSig(d) && !used.has(o.id));
  let pool = drifts;
  for (let slot = 0; slot < perWorld; slot++) {
    const avail = pool.filter(d => twinOf(d) || sameKind(d).length);
    if (!avail.length) { if (pool.length) bump(G, 'q4:drift-unpaired', pool.length); break; }
    const d = weightedDraw(avail, c => OP_WEIGHTS[c.op] ?? 1, 1, `${G.slice}|Q4|${seed}|drift|${slot}`)[0];
    pool = pool.filter(x => x !== d);
    picked.push({ c: d, pair: null });
    // a flip pair: the same step, the same observation, the expectation of the true map against the believed one
    const twin = twinOf(d);
    if (twin) { used.add(twin.id); picked.push({ c: twin, pair: `gq4flip:${G.slice}:${seed}:${d.id}` }); picked[picked.length - 2].pair = picked.at(-1).pair; continue; }
    // otherwise an as_expected row of the same expectation kind, so that the kind of the expectation does not predict the label
    const ok = weightedDraw(sameKind(d), () => 1, 1, `${G.slice}|Q4|${seed}|ok|${d.id}`)[0];
    used.add(ok.id); picked.push({ c: ok, pair: null });
  }
  const test = G.test, carriers = q4Carriers(G);
  for (const { c, pair } of picked) {
    // the twins of a row (a cosmetic re-render, a carrier) and the row itself are one cluster: they share a pairId, fixed before the row is yielded
    const wantPerm = unit(`${c.key}|inv`) < G.share.invariance, wantInj = unit(`${c.key}|inj`) < G.share.injection && (carriers[c.label === 'drifted' ? 'as_expected' : 'drifted'].length > 0);
    const cluster = pair ?? (wantPerm || wantInj ? `gq4:${G.slice}:${seed}:${c.id}` : undefined);
    const rec = q4Record(c, ctx0, { variant: pair ? 'flip' : 'clean', meta: { ...(cluster ? { pairId: cluster } : {}), rowId: `${seed}:${c.id}` } });
    yield rec;
    const obs = rec.state.observation;
    if (wantPerm) {
      const p = GQ.permuteDescription(obs, `${c.key}|perm`);
      if (p) yield q4Record(c, ctx0, { observation: p, tag: 'perm', variant: 'invariance', meta: { pairId: cluster, rowId: `${seed}:${c.id}`, counterfactual: { swapped: true, from: 'sentence order', to: 'permuted', path: 'observation' } } });
    }
    if (wantInj) {
      const carrier = pickBy(carriers[c.label === 'drifted' ? 'as_expected' : 'drifted'], `${c.key}|carrier`), ins = GQ.insertSentence(obs, carrier.text, `${c.key}|carrier`);
      yield q4Record(c, ctx0, { observation: ins, tag: 'inj', variant: 'injection', source: OOD.has(G.slice) ? 'authored' : 'authored-builtin', meta: { pairId: cluster, rowId: `${seed}:${c.id}`, counterfactual: { swapped: false, from: null, to: 'carrier', path: 'observation' }, carrier: spanHash(carrier.text), carrierFilter: carrier.filter } });
    } else if (unit(`${c.key}|inj`) < G.share.injection) bump(G, 'q4:carrier-missing');
    if (test && unit(`${c.key}|para`) < G.share.paraphrase) { const p = paraphraseOf(rec, G.contracts.Q4, G.slice, G.opts, c.key); if (p) yield p; }
    // the same room name for a different room: kept only where the observation tells the rooms apart, and only where the
    // renamed row's own form lies in this slice's skeleton bucket
    if (c.op === 'wrong-room' && unit(`${c.key}|same`) < G.share.sameName) {
      const believed = c.expect.room, d = sameNameDistractor({ sentence: c.sentence, observation: obs, believedRoom: believed, slice: G.slice, masks });
      if (!d.kept) bump(G, d.reason === 'bucket' ? 'q4:samename-bucket' : 'q4:samename-dropped'); else { bump(G, 'q4:samename-kept'); yield q4Record(c, ctx0, { observation: d.observation, tag: 'same', variant: 'distractor', meta: { rowId: `${seed}:${c.id}`, counterfactual: { swapped: true, from: 'header', to: believed, path: 'observation' }, sameName: true } }); }
    }
  }
  // The unknowable of gridquest Q4 (evaluation slices only, opt-in: opts.share.unknowable): the remote effects of a switch are
  // reported only in the result line, and this variant DELETES them. That is a gap, not the presence-matched replacement §2.5
  // asks for, so the rows are a labelled diagnostic (meta.unkAxis.kind 'gap'), never training rows (makeContext refuses them in
  // train) and not the program's 2 x 2 unknowable axis. The label stays the true one (as_expected).
  // In an OOD slice the row's own form may be in the slice's held-out bucket ('new' phrasing) or in the train bucket ('known').
  const unkShare = G.share.unknowable;
  for (const c of unkShare > 0 ? cands.filter(o => o.role === 'ok' && o.remote && o.kind === 'toggle') : []) {
    if (unit(`${c.key}|unk`) >= unkShare) continue;
    const o = parseObservation(c.observation), first = /^You [a-z ]+ the [a-z]+\./.exec(o.lastAction)?.[0];
    if (!first) continue;
    const obs = scrubFamilySpans(GQ.withLastAction(c.observation, first), seed, G.slice);
    if (G.slice !== 'test-ood' && carriesInjection(obs)) { bump(G, 'q4:injection-left'); continue; }
    const rec = q4Record(c, ctx0, { observation: obs, tag: 'unk', variant: 'unknowable', meta: { counterfactual: { swapped: true, from: 'result line', to: 'result line without the remote effects', path: 'observation' } } });
    const bucket = skeletonBucket(rec.meta.formId), phrasing = bucket === BUCKET_OF_SLICE[G.slice] ? (OOD.has(G.slice) ? 'new' : 'known') : bucket === 'train' && OOD.has(G.slice) ? 'known' : null;
    if (!phrasing) { bump(G, 'q4:unknowable-bucket'); continue; }
    rec.meta.unkAxis = { kind: 'gap', diagnostic: true, phrasing, stated: `${seed}:${c.id}` };         // meta.unknowable itself is the build's list of question ids
    bump(G, `q4:unknowable-${phrasing}`);
    yield rec;
  }
}

// ================================================================================================================
// Q1 room_exit and Q2 container_cue (wave-2 smoke sets, gridquest)
// ================================================================================================================
async function* gridquestQ1(G, mod, seed, difficulty, perWorld) {
  const task = mod.index.generate({ seed, split: G.def.bedSplit, difficulty }), wh = worldHash(task), masks = GQ.masksOf(mod, task);
  const W = mod.index._internal.world(task), route = GQ.trueRoute(mod, task);
  // states along the reference route in distinct rooms (up to perWorld)
  // the state after the winning action is terminal (the engine ignores every action once the treasure is taken): a Q1 there has no answer to read
  const ks = shuffled([...route.snaps.keys()].filter(k => k < W.solution.length), `${G.slice}|Q1|${seed}|ks`), seenCells = new Set(), chosen = [];
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
    if (G.slice !== 'test-ood' && carriesInjection(observation)) { bump(G, 'q1:injection-left'); continue; }   // a family span the scrub could not replace
    if (!bucketAllows(G.slice, form)) continue;
    const slots = { observation }, state = kits.gridquest.Q1.buildState(task, slots), key = `${G.slice}|Q1|${seed}|${k}`;
    const questions = {};
    for (const d of DIRECTIONS) {
      const w = wordingFor(G.contracts.Q1, G.slice, `${key}|${d}`, G.opts);
      questions[`Q1~${d}`] = labelledQuestion(G.contracts.Q1, { label: probed.labels[d], wording: w.wording, wordingText: w.wordingText, slots: { direction: d }, optionOrder: optionOrder(Object.keys(G.contracts.Q1.options), `${key}|${d}`) });
    }
    yield { state, questions, meta: { family: 'gridquest', bed: 'gridquest', seed, difficulty, worldHash: wh, variant: 'clean', formId: form, labelSource: 'simulator', needsWorldKnowledge: false, wordingId: 'Q0-Q3', surface: { source: 'bed', slice: G.slice, lineHash: spanHash(state.observation) }, masks,
      kit: { port: 'Q1', slots }, q1: { k, labeller: { path: 'createEnv', lifetimeActions: probed.ledger.lifetimeActions, envLimit: probed.ledger.envLimit, lifted: probed.ledger.lifted, probes: probed.ledger.probes }, secondPath: 'w.edges + abstract model', labels: probed.labels } } };
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
  const { steps, dropped, droppedBy } = QA.q4Steps(qa, task, c);
  bump(G, 'q4qa:steps', steps.length); bump(G, 'q4qa:dropped-invisible', dropped.invisible); bump(G, 'q4qa:dropped-unexplained', dropped.unexplained);
  for (const [t, n] of Object.entries(droppedBy)) bump(G, `q4qa:invisible:${t}`, n);
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
// the shape of an X1:gameqa state, for stratified draws: a report with a paragraph appended (a composed line, the bed's appended
// injection), a standalone post (a pinned post), a plain report, or a tracker window (the long variant)
const x1Format = x => (x.slots.append !== undefined || x.kind === 'appended-injection' ? 'appended' : x.slots.text !== undefined || x.kind === 'pinned-injection' ? 'post' : 'report');

// 70% of the posts to train, 10% each to calib-in, dev-select and test-in
const PINNED_PARTS = Object.freeze([['calib-in', 0.1], ['dev-select', 0.2], ['test-in', 0.3]]);
const pinnedPart = ([title, body]) => { const u = unit(`pinned-part|${title}|${body}`); return (PINNED_PARTS.find(([, upto]) => u < upto) ?? ['train'])[0]; };
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
      cand.push({ id: `bed:${a.id}`, label: 'yes', slots: { report: a.id }, form, source: 'bed', kind: a.mode === 'pinned' ? 'pinned-injection' : 'appended-injection', hard: null, addressee: QA.hasAddressee(a.injection), labelSource: 'generator', weight: 0.7 });
    } else {
      const span = `${a.report.title} ${body}`, form = formOf(span, masks), hard = QA.hardNegativeKind(span);
      cand.push({ id: `bed:${a.id}`, label: 'no', slots: { report: a.id }, form, source: 'bed', kind: `report-${a.kind}`, hard, addressee: QA.hasAddressee(span), labelSource: 'generator', weight: hard ? 2.5 : 0.5 });
    }
  }
  const hosts = reports.filter(a => !a.injection && a.report.source !== 'telemetry' && a.kind !== 'instruction');
  const composed = (l, j) => {
    const host = hosts.length ? pickBy(hosts, `${G.slice}|X1|${seed}|host|${lineKey(l)}|${j}`) : null;
    if (!host) return null;
    return { id: `line:${lineKey(l)}:${host.id}`, label: l.label, slots: { report: host.id, append: l.text }, form: formOf(l.text, masks), source: 'authored', kind: `line-${l.role ?? 'decisive'}`, hard: l.label === 'no' ? QA.hardNegativeKind(l.text) : null, addressee: QA.hasAddressee(l.text), labelSource: 'authored-brief', weight: l.label === 'yes' ? (QA.hasAddressee(l.text) ? 1 : 4) : (QA.hasAddressee(l.text) ? 6 : 1.2), line: lineKey(l), filter: lineFilter(l), lineSlice: lineSlice(l) };
  };
  const posLines = shuffled(lines.positive, `${G.slice}|X1|${seed}|lp`).slice(0, 4), negLines = shuffled(lines.negative, `${G.slice}|X1|${seed}|ln`).slice(0, 6);
  posLines.forEach((l, j) => { const x = composed(l, j); if (x) cand.push(x); });
  negLines.forEach((l, j) => { const x = composed(l, j); if (x) cand.push(x); });
  if (pinnedOn) {
    // a pinned post is the same text in every world, so the posts are split between the train slice and the in-distribution evaluation
    // slices (calib-in, dev-select, test-in) by a hash of the post: no evaluation state is a train state or another slice's state (the build would drop the copy: rule 7)
    const part = G.slice;
    shuffled(BENIGN_PINNED.map((t, j) => ({ t, j })).filter(({ t }) => pinnedPart(t) === part), `${G.slice}|X1|${seed}|bp`).slice(0, 4).forEach(({ t: [title, body], j }) => {
      cand.push({ id: `pinned:${j}`, label: 'no', slots: { text: `${title}\n${body}`, source_kind: 'tracker post' }, form: formOf(`${title} ${body}`, masks), source: 'authored-builtin', kind: 'benign-pinned', hard: QA.hardNegativeKind(body) ?? 'pinned', addressee: QA.hasAddressee(body), labelSource: 'authored-brief', weight: 3 });
    });
  }
  // A held-out line of an OOD slice belongs to that slice by the held-out store's own rule (heldout/pools.mjs oodSliceOfHash:
  // the whole skeleton space shared 5:3:2 among the OOD slices, not lib/hash.mjs skeletonBucket), and x1Lines kept only this
  // slice's lines: re-bucketing them by skeletonBucket would drop every calib-ood and dev-ood line and 60% of the test-ood ones.
  // Bed spans and train-pool lines are bucketed as everywhere else.
  // In an OOD slice every positive is a held-out line appended to a host report (the bed's injection forms are train-bucket forms),
  // so a plain bed report there would be a negative by its format alone: on 100 dev-ood worlds with stand-in lines, 'the body ends
  // in an appended paragraph' was true of every positive and of 74% of the negatives (balanced accuracy 0.63 for that reader). Where
  // the slice has held-out positive lines, its negatives are the held-out negative lines appended the same way (oodMatched) and the
  // tracker-window variant (bed text, negative-only there) is not built; without held-out lines the bed negatives stay.
  const oodMatched = OOD.has(G.slice) && lines.positive.length > 0;
  const usable = cand.filter(x => (x.source === 'authored' && OOD.has(G.slice) && x.lineSlice === G.slice) || (!oodMatched && bucketAllows(G.slice, x.form)));
  if (oodMatched) bump(G, 'x1:ood-format-matched');
  bump(G, 'x1:candidates', cand.length); bump(G, 'x1:usable', usable.length);
  const pos = usable.filter(x => x.label === 'yes'), neg = usable.filter(x => x.label === 'no');
  const nPos = Math.max(1, Math.round(perWorld * 0.4));
  const chosen = [...weightedDraw(pos, x => x.weight, nPos, `${G.slice}|X1|${seed}|pos`), ...weightedDraw(neg, x => x.weight, perWorld - nPos, `${G.slice}|X1|${seed}|neg`)];
  for (const x of chosen) {
    const state = kits.gameqa.X1.buildState(task, x.slots);
    const key = `${G.slice}|X1|${seed}|${x.id}`;
    const rec = makeRecord({ contract: G.contracts.X1, slice: G.slice, opts: G.opts, key, state, label: x.label,
      meta: meta({ variant: 'clean', formId: x.form, labelSource: x.labelSource, surface: { source: x.source, slice: G.slice, lineHash: spanHash(x.slots.append ?? x.slots.text ?? state.text), ...(x.source === 'bed' ? {} : { filter: x.filter ?? 'pending' }) }, kit: { port: 'X1', slots: x.slots }, x1: { kind: x.kind, hard: x.hard, addressee: x.addressee, line: x.line ?? null, format: x1Format(x) } }) });
    yield rec;
    if (G.test && unit(`${key}|para`) < G.share.paraphrase) { const p = paraphraseOf(rec, G.contracts.X1, G.slice, G.opts, key); if (p) yield p; }
  }
  // the long variant: the span inside a window of the tracker (about 6 reports)
  if (!oodMatched && unit(`${G.slice}|X1long|${seed}`) < (G.opts.longShare ?? 0.15) && reports.length >= 6) {
    const all = task.inputs.reports, pickPos = unit(`${G.slice}|X1longpos|${seed}`) < 0.5, injReports = reports.filter(a => a.injection);
    const startMax = all.length - 6;
    let start = hnum(`${G.slice}|X1longwin|${seed}`) % (startMax + 1);
    if (pickPos && injReports.length) { const at = all.findIndex(r => r.id === pickBy(injReports, `${G.slice}|X1longinj|${seed}`).id); start = Math.max(0, Math.min(startMax, at - (hnum(`${G.slice}|X1longoff|${seed}`) % 6))); }
    // the label reads every report of the window (aligned or not): a window holding any injection text is a positive
    const winAll = all.slice(start, start + 6), ids = winAll.map(r => r.id), injText = winAll.map(r => TAP.injectionIn(r.body)).find(Boolean) ?? null, has = injText !== null;
    const span = has ? injText : winAll[0].title, form = formOf(span, masks);
    if (bucketAllows(G.slice, form)) {
      const slots = { reports: ids }, state = kits.gameqa.X1.buildState(task, slots);
      yield makeRecord({ contract: G.contracts.X1, slice: G.slice, opts: G.opts, key: `${G.slice}|X1|${seed}|long`, state, label: has ? 'yes' : 'no',
        meta: meta({ variant: 'long', formId: form, labelSource: 'generator', surface: { source: 'bed', slice: G.slice, lineHash: spanHash(state.text) }, kit: { port: 'X1', slots }, x1: { kind: has ? 'window-with-injection' : 'window', hard: null, addressee: has ? QA.hasAddressee(span) : false, line: null, format: 'window' } }) });
    }
  }
}
const alignJournalEntry = entry => GRIDQUEST_JOURNAL_INJECTIONS.includes(entry);

// ----------------------------------------------------------------------------------------------------------------
// X1:gridquest (held-out family): the injection inscriptions and the journal injections against graffiti, journal notes and
// ordinary room sentences. Registered spans (heldoutSpans) are the injections: the label-bearing, family-specific text.
//
// Two formats: the SENTENCE (one room sentence, or one journal entry) and the room DESCRIPTION (the long variant: the whole
// description the inscription stands in). Every positive row comes with a negative row of the same format and the same source
// (room or journal) from the same world, matched in length, so neither the format, the length nor source_kind tells the label
// (§2.7 step 7). The bed has nine positive sentences in all (six inscriptions, three journal injections) and a test slice asks a
// state once, so a sentence pair is emitted only while its positive state is new in this run; a description pair always (a
// description names the world's rooms). Measured before this rule, on 400 dev worlds read as test-ood: 126 of 144 positives were
// descriptions and 196 of 1392 negatives, and a length-only reader separated the labels.
// A description negative is a room with NO injection inscription: a description that holds one is a positive whatever sentence
// was drawn (the earlier per-row long draw labelled 8 of 196 such descriptions 'no').
// ----------------------------------------------------------------------------------------------------------------
const X1GQ_SOURCE = x => (x.cell === null ? 'journal' : 'room');
// A length-matched negative for a positive of `target` characters: of the five candidates nearest in length (ties: hard negatives
// first, then the hash of the key), the one that brings the run's running length difference (G.x1gqLenBias, per format) closest
// to zero. The nearest alone left positives 2% longer on average (an inscription room has one long sentence more), and a
// length-threshold reader then reached 0.53-0.54 balanced accuracy out of sample (400 dev worlds read as test-ood, split by seed);
// with the running balance 0.515-0.518 (test/interactive.test.mjs holds it under 0.53).
function nearestByLength(G, format, list, target, key, hardOf = () => false) {
  const ranked = list.map(x => ({ x, d: x.text.length - target, h: hardOf(x) ? 0 : 1, k: sha(`${key}|${x.id}`) }))
    .sort((a, b) => Math.abs(a.d) - Math.abs(b.d) || a.h - b.h || (a.k < b.k ? -1 : a.k > b.k ? 1 : 0)).slice(0, 5);
  if (!ranked.length) return null;
  const bias = (G.x1gqLenBias ??= {})[format] ?? 0;
  const pick = ranked.reduce((a, b) => (Math.abs(bias + b.d) < Math.abs(bias + a.d) ? b : a));
  G.x1gqLenBias[format] = bias + pick.d;
  return pick.x;
}
async function* gridquestX1(G, mod, seed, difficulty, perWorld) {
  const task = mod.index.generate({ seed, split: G.def.bedSplit, difficulty }), wh = worldHash(task), masks = GQ.masksOf(mod, task);
  const W = mod.index._internal.world(task), w = W.w;
  const st = { pos: 0, inv: [], revealed: [], unlocked: [], mech: w.mechs.map(m => m.open0), swCount: w.switches.map(() => 0), steps: 0, won: false };
  const sents = [], rooms = [];
  const meta = (extra) => ({ family: 'gridquest', bed: 'gridquest', seed, difficulty, worldHash: wh, masks, labelSource: 'generator', ...extra });
  for (let cell = 0; cell < w.n * w.n; cell++) {
    st.pos = cell;
    const observation = mod.render.observationText(w, st, W.budget, 'You go north.');
    const o = parseObservation(observation), kinds = roomSentenceKindsOf(o.description);
    // a sentence the description says twice has no single span to point at (the kit needs exactly one occurrence)
    const once = kinds.filter(k => kinds.filter(x => x.sentence === k.sentence).length === 1);
    bump(G, 'x1gq:repeated-sentence', kinds.length - once.length);
    const anchor = once.find(k => k.kind === 'graffiti' || k.kind === 'fake-treasure') ?? once[0];
    rooms.push({ id: `desc:${cell}`, cell, observation, text: o.description, injection: kinds.some(k => k.kind === 'injection'), hard: kinds.some(k => k.kind === 'graffiti' || k.kind === 'fake-treasure'), anchor: anchor?.sentence ?? null });
    for (const k of once) sents.push({ id: `room:${cell}:${sha(k.sentence).slice(0, 8)}`, label: k.kind === 'injection' ? 'yes' : 'no', kind: k.kind, text: k.sentence, cell, slots: { observation, sentence: k.sentence }, form: formOf(k.sentence, masks) });
  }
  (task.inputs.journal ?? []).forEach((e, i) => {
    const inj = alignJournalEntry(e.entry);
    sents.push({ id: `journal:${i}`, label: inj ? 'yes' : 'no', kind: inj ? 'journal-injection' : 'journal-note', text: e.entry, cell: null, slots: { journal: i }, form: formOf(e.entry, masks) });
  });
  const pos = sents.filter(x => x.label === 'yes');
  if (!pos.length) return;
  const testLike = TEST_LIKE_SLICES.has(G.slice), seen = (G.x1gqSeen ??= new Set()), usedS = new Set(), usedR = new Set(), usedP = new Set();
  const stateOf = slots => kits.gridquest.X1.buildState(task, slots);
  const fresh = slots => !testLike || !seen.has(stateHash(stateOf(slots)));
  const hardS = x => x.kind !== 'ordinary';
  const row = function* (x, { long = false, label, kind, hard, span, form }) {
    const slots = long ? { ...x.slots, long: true } : x.slots, state = stateOf(slots);
    if (testLike) seen.add(stateHash(state));
    const key = `${G.slice}|X1gq|${seed}|${long ? 'desc' : 'sent'}|${x.id}`;
    const rec = makeRecord({ contract: G.contracts.X1, slice: G.slice, opts: G.opts, key, state, label,
      meta: meta({ variant: long ? 'long' : 'clean', formId: form, surface: { source: 'bed', slice: G.slice, lineHash: spanHash(span ?? state.text) }, kit: { port: 'X1', slots },
        x1: { kind, hard, addressee: QA.hasAddressee(state.text), span, format: long ? 'description' : 'sentence', source: X1GQ_SOURCE(x) } }) });
    yield rec;
    if (G.test && unit(`${key}|para`) < G.share.paraphrase) { const p = paraphraseOf(rec, G.contracts.X1, G.slice, G.opts, key); if (p) yield p; }
  };
  // room inscriptions first (each gives a description pair), journal injections after
  const nPos = Math.max(1, Math.round(perWorld / 4));
  for (const p of weightedDraw(pos, x => (x.cell === null ? 1 : 3), nPos, `${G.slice}|X1gq|${seed}|pos`)) {
    // the sentence pair: a negative sentence of the same source, nearest in length, not used, whose state is new in a test slice
    if (!fresh(p.slots)) bump(G, 'x1gq:sentence-pair-repeated');
    else {
      const n = nearestByLength(G, 'sentence', sents.filter(x => x.label === 'no' && X1GQ_SOURCE(x) === X1GQ_SOURCE(p) && !usedS.has(x.id) && fresh(x.slots)), p.text.length, `${G.slice}|X1gq|${seed}|${p.id}|ns`, hardS);
      if (!n) bump(G, 'x1gq:no-sentence-negative');
      else {
        usedS.add(n.id);
        yield* row(p, { label: 'yes', kind: p.kind, hard: null, span: p.text, form: p.form });
        yield* row(n, { label: 'no', kind: n.kind, hard: n.kind === 'ordinary' ? null : 'in-world-text', span: n.text, form: n.form });
      }
    }
    // the description pair: the room of the inscription against a room with no inscription, nearest in length (one pair per room:
    // a room with two inscriptions is one description)
    if (p.cell === null || usedP.has(p.cell)) continue;
    const room = rooms[p.cell];
    if (!fresh({ ...p.slots, long: true })) { bump(G, 'x1gq:description-pair-repeated'); continue; }
    const n = nearestByLength(G, 'description', rooms.filter(r => !r.injection && r.anchor && !usedR.has(r.cell) && fresh({ observation: r.observation, sentence: r.anchor, long: true })), room.text.length, `${G.slice}|X1gq|${seed}|${p.id}|nd`, r => r.hard);
    if (!n) { bump(G, 'x1gq:no-description-negative'); continue; }
    usedR.add(n.cell); usedP.add(p.cell);
    yield* row(p, { long: true, label: 'yes', kind: p.kind, hard: null, span: p.text, form: p.form });
    yield* row({ id: n.id, cell: n.cell, slots: { observation: n.observation, sentence: n.anchor } }, { long: true, label: 'no', kind: 'room-description', hard: n.hard ? 'in-world-text' : null, span: null, form: formOf(n.text, masks) });
  }
}

// ================================================================================================================
// wave-2 smoke on gameqa: X6 report_triage, Q5 bug_class, Q6 spec_violation, X2 same_entity (held-out family)
// ================================================================================================================
const X6_WEIGHTS = Object.freeze({ instruction: 6, duplicate: 3, stale: 1.5, designed: 1, noise: 1, lead: 1 });
async function* gameqaX6(G, qa, seed, difficulty, perWorld) {
  const task = qa.index.generate({ seed, split: G.def.bedSplit, difficulty }), c = qa.case.caseFor(task), wh = worldHash(task), masks = QA.masksOf(c);
  const { reports } = alignReports(task);
  const cands = [];
  for (const a of reports) {
    if (a.injection && a.mode === 'appended') { bump(G, 'x6:mixed-dropped'); continue; }        // a lead with an injection appended is both: no single label
    const form = formOf(`${a.report.title} ${stripPadding(a.report.body)}`, masks);
    if (!bucketAllows(G.slice, form)) continue;
    cands.push({ id: a.id, label: a.kind, form, report: a.report });
  }
  const chosen = weightedDraw(cands, x => X6_WEIGHTS[x.label] ?? 1, perWorld, `${G.slice}|X6|${seed}`);
  for (const x of chosen) {
    const slots = { report: x.id }, state = kits.gameqa.X6.buildState(task, slots);
    yield makeRecord({ contract: G.contracts.X6, slice: G.slice, opts: G.opts, key: `${G.slice}|X6|${seed}|${x.id}`, state, label: x.label,
      meta: { family: 'gameqa', bed: 'gameqa', seed, difficulty, worldHash: wh, variant: 'clean', formId: x.form, labelSource: 'generator', surface: { source: 'bed', slice: G.slice, lineHash: spanHash(state.report) }, masks, kit: { port: 'X6', slots }, x6: { kind: x.label } } });
  }
}
// Q5's template axis (§3.3; spec/ports.json Q5 holdouts.templateAxis: "3 of 13 bugs[].template ids, each from a class keeping a
// training template"), pre-registered by rule: in every class the bed plants with more than one template, the LAST of them in
// beds/gameqa/bugs.mjs TEMPLATES order (the records group's rule is the same: the highest index). At the pinned bed: chest_rubble
// (softlock keeps key_eaten), enemy_freeze (enemy_ai keeps enemy_teleport), stale_hud (render_mismatch keeps ghost_sprite).
// Held-out templates never enter a train-like slice: Q5 is a wave-2 smoke set of train and dev-select, so a held-out template's row
// is not built (counted 'q5:heldout-template'); the test-OOD template axis that reads them is built with Q5's OOD slices (not yet).
export function q5HeldoutTemplates(templates) {
  const byClass = new Map();
  for (const t of templates) { if (!byClass.has(t.cls)) byClass.set(t.cls, []); byClass.get(t.cls).push(t.id); }
  return Object.freeze([...byClass.values()].filter(ids => ids.length > 1).map(ids => ids.at(-1)).sort());
}
export const Q5_HELDOUT_TEMPLATES = Object.freeze(['chest_rubble', 'enemy_freeze', 'stale_hud']);
export const q5Admits = (template, slice) => slice === 'test-ood' || !Q5_HELDOUT_TEMPLATES.includes(template);
async function* gameqaQ5(G, qa, seed, difficulty, perWorld) {
  const held = q5HeldoutTemplates(qa.bugs.TEMPLATES);
  if (held.join(',') !== Q5_HELDOUT_TEMPLATES.join(',')) throw fail('Q5_HELDOUT_DRIFT', `the bed's templates give the held-out set ${held.join(', ')}, the pre-registered set is ${Q5_HELDOUT_TEMPLATES.join(', ')}`);
  const task = qa.index.generate({ seed, split: G.def.bedSplit, difficulty }), c = qa.case.caseFor(task), wh = worldHash(task), masks = QA.masksOf(c);
  const eff = QA.triggerEffects(qa, task, c).filter(x => x.effect).filter(x => q5Admits(x.bug.template, G.slice) || (bump(G, 'q5:heldout-template'), false)).map(x => ({ ...x, id: x.bug.id }));
  const cands = eff.map(x => ({ ...x, form: formOf(`${x.effect} // ${x.last}`, masks) })).filter(x => bucketAllows(G.slice, x.form));
  for (const x of weightedDraw(cands, () => 1, perWorld, `${G.slice}|Q5|${seed}`)) {
    const slots = { actions: x.actions, observed_effect: x.effect }, state = kits.gameqa.Q5.buildState(task, slots);
    yield makeRecord({ contract: G.contracts.Q5, slice: G.slice, opts: G.opts, key: `${G.slice}|Q5|${seed}|${x.id}`, state, label: x.bug.cls,
      meta: { family: 'gameqa', bed: 'gameqa', seed, difficulty, worldHash: wh, variant: 'clean', formId: x.form, labelSource: 'generator', surface: { source: 'bed', slice: G.slice, lineHash: spanHash(state.observed_effect) }, masks, kit: { port: 'Q5', slots }, q5: { template: x.bug.template, variant: x.bug.variant ?? null } } });
  }
}
async function* gameqaQ6(G, qa, seed, difficulty, perWorld) {
  const task = qa.index.generate({ seed, split: G.def.bedSplit, difficulty }), c = qa.case.caseFor(task), wh = worldHash(task), masks = QA.masksOf(c);
  const { reports } = alignReports(task);
  const cands = [...QA.defectBehaviours(qa, task, c, TAP), ...QA.designedBehaviours(task, c, reports, TAP, stripPadding)]
    .map(x => ({ ...x, form: formOf(x.behaviour, masks) })).filter(x => bucketAllows(G.slice, x.form));
  const defects = cands.filter(x => x.label === 'defect'), designed = cands.filter(x => x.label === 'designed'), nDef = Math.ceil(perWorld / 2);
  for (const x of [...weightedDraw(defects, () => 1, nDef, `${G.slice}|Q6|${seed}|d`), ...weightedDraw(designed, () => 1, perWorld - nDef, `${G.slice}|Q6|${seed}|s`)]) {
    const slots = { sections: x.sections, behaviour: x.behaviour, ...(x.floor ? { floor: x.floor } : {}) }, state = kits.gameqa.Q6.buildState(task, slots);
    yield makeRecord({ contract: G.contracts.Q6, slice: G.slice, opts: G.opts, key: `${G.slice}|Q6|${seed}|${x.id}`, state, label: x.label,
      meta: { family: 'gameqa', bed: 'gameqa', seed, difficulty, worldHash: wh, variant: 'clean', formId: x.form, labelSource: 'generator', surface: { source: 'bed', slice: G.slice, lineHash: spanHash(x.behaviour) }, masks, kit: { port: 'Q6', slots }, q6: { template: x.template ?? null, title: x.title ?? null } } });
  }
}
// X2:gameqa (held-out family): two references to the game's things in the words of the design document and of the players
// (the bed's ALIAS table), the same thing or two different ones of the same kind.
const X2_KINDS = Object.freeze({ colour: ['amber', 'blue', 'crimson', 'dusk'], item: ['gem', 'potion', 'coins'], enemy: ['crawler', 'moth'], gear: ['sword', 'lantern'] });
// The state of X2 is {a, b, context} with the legend of the design document as context, and the port declares no world
// knowledge (allowedKnowledge: []). Of the bed's ALIAS table only these words are read without the bed's own slang: the
// legend's names and their plain-English synonyms. Each inner list is a reader class: two words of one class are the same
// thing to any reader; 'dusk' and its synonyms 'purple'/'violet' are separate classes (that dusk is purple is the bed's
// convention, nowhere in the task). glimmerstone, glim, shard, tonic, red bottle, beetle thing and gold-coloured are game
// slang: a pair using them is not decidable from the state and is not built (§1.0 allowed knowledge, §2.7 step 4).
// Measured before this rule: 103 of 109 alias pairs had a word missing from the legend, many of them slang.
export const X2_READABLE = Object.freeze({
  gem: [['gem']], potion: [['potion']], coins: [['coins', 'coin pile', 'gold pile']],
  amber: [['amber', 'orange']], blue: [['blue', 'navy']], crimson: [['crimson', 'red']], dusk: [['dusk'], ['purple', 'violet']],
  crawler: [['crawler']], moth: [['moth', 'big moth']], sword: [['sword', 'blade']], lantern: [['lantern', 'lamp']],
});
const readerClass = (key, alias) => X2_READABLE[key]?.findIndex(cls => cls.includes(alias)) ?? -1;
// decidable from the state: both words readable, and a 'same' pair is one reader class (a 'different' pair is two keys)
export const x2Decidable = (ka, aliasA, kb, aliasB) => {
  const ca = readerClass(ka, aliasA), cb = readerClass(kb, aliasB);
  return ca >= 0 && cb >= 0 && (ka !== kb || ca === cb);
};
// the pairs of one world (pure: a function of the key): [{ id, a, b, label, kind }], decidable pairs only
export function x2Pairs(keyBase, perWorld, counts = null) {
  const out = [];
  for (let j = 0; j < perWorld * 6 && out.length < perWorld * 3; j++) {
    const k = `${keyBase}|${j}`, kind = pickBy(Object.keys(X2_KINDS), `${k}|kind`), keys = X2_KINDS[kind];
    const same = unit(`${k}|same`) < 0.5, ka = pickBy(keys, `${k}|ka`), kb = same ? ka : pickBy(keys.filter(x => x !== ka), `${k}|kb`);
    const aliasA = pickBy(TAP.GAMEQA_ALIAS[ka], `${k}|aa`), aliasB = pickBy(TAP.GAMEQA_ALIAS[kb].filter(x => !same || x !== aliasA), `${k}|ab`);
    if (!aliasB || (same && aliasA === aliasB)) continue;
    if (!x2Decidable(ka, aliasA, kb, aliasB)) { if (counts) counts['x2:needs-slang'] = (counts['x2:needs-slang'] ?? 0) + 1; continue; }
    const noun = pickBy(['door', 'key'], `${k}|noun`);
    const a = kind === 'colour' ? `the ${aliasA} ${noun}` : `the ${aliasA}`, b = kind === 'colour' ? `the ${aliasB} ${noun}` : `the ${aliasB}`;
    out.push({ id: `x2:${j}`, a, b, label: same ? 'same' : 'different', kind, keys: [ka, kb], aliases: [aliasA, aliasB] });
  }
  return out;
}
async function* gameqaX2(G, qa, seed, difficulty, perWorld) {
  const task = qa.index.generate({ seed, split: G.def.bedSplit, difficulty }), c = qa.case.caseFor(task), wh = worldHash(task), masks = QA.masksOf(c);
  const out = x2Pairs(`${G.slice}|X2|${seed}`, perWorld, G.counts).map(x => ({ ...x, form: formOf(`${x.a} // ${x.b}`, masks) }));
  const seen = new Set();
  for (const x of out.filter(x => !seen.has(`${x.a}|${x.b}`) && seen.add(`${x.a}|${x.b}`)).slice(0, perWorld)) {
    const slots = { a: x.a, b: x.b }, state = kits.gameqa.X2.buildState(task, slots);
    yield makeRecord({ contract: G.contracts.X2, slice: G.slice, opts: G.opts, key: `${G.slice}|X2|${seed}|${x.id}`, state, label: x.label,
      meta: { family: 'gameqa', bed: 'gameqa', seed, difficulty, worldHash: wh, variant: 'clean', formId: x.form, labelSource: 'generator', surface: { source: 'bed', slice: G.slice, lineHash: spanHash(`${x.a}\n${x.b}`) }, masks, kit: { port: 'X2', slots }, x2: { kind: x.kind } } });
  }
}

// ----------------------------------------------------------------------------------------------------------------
// Q3 next_action (wave 3, skeleton only): the reference solver's next action over at most 15 legal actions, a soft target
// over the equally optimal ones. The label is a ranking prior: the observation does not determine it (§1.2 Q3).
// ----------------------------------------------------------------------------------------------------------------
async function* gridquestQ3(G, mod, seed, difficulty, perWorld) {
  const task = mod.index.generate({ seed, split: G.def.bedSplit, difficulty }), wh = worldHash(task), masks = GQ.masksOf(mod, task);
  const route = GQ.trueRoute(mod, task), W = route.W;
  const ks = shuffled([...route.rows.keys()], `${G.slice}|Q3|${seed}`).slice(0, perWorld);
  for (const k of ks) {
    route.walker.restore(route.snaps[k]);
    const legal = route.walker.env.actions(), label = W.solution[k];
    if (!legal.includes(label)) continue;
    const best = GQ.bestActions(mod, W, route.snaps[k].st).filter(a => legal.includes(a));
    if (!best.includes(label)) { bump(G, 'q3:label-not-best'); continue; }
    const others = shuffled(legal.filter(a => !best.includes(a)), `${G.slice}|Q3|${seed}|${k}|others`).slice(0, Math.max(0, 14 - best.length));
    const options = [...new Set([...best, ...others])].sort();
    const history = route.rows.slice(Math.max(0, k - 4), k).map(r => ({ action: r.action, result: parseObservation(r.observation).lastAction }));
    const observation = scrubFamilySpans(route.observations[k], seed, G.slice), slots = { observation, history }, state = kits.gridquest.Q3.buildState(task, slots);
    if (G.slice !== 'test-ood' && carriesInjection(observation)) { bump(G, 'q3:injection-left'); continue; }
    const form = formOf(parseObservation(observation).description, masks);
    if (!bucketAllows(G.slice, form)) continue;
    const target = best.length > 1 ? Object.fromEntries(best.map(a => [a, 1 / best.length])) : undefined;
    const w = wordingFor(G.contracts.Q3, G.slice, `${G.slice}|Q3|${seed}|${k}`, G.opts), key = `${G.slice}|Q3|${seed}|${k}`;
    const q = labelledQuestion(G.contracts.Q3, { label, ...(target ? { target } : {}), wording: w.wording, wordingText: w.wordingText, options, optionOrder: optionOrder(options, key) });
    yield { state, questions: { Q3: q }, meta: { family: 'gridquest', bed: 'gridquest', seed, difficulty, worldHash: wh, variant: 'clean', formId: form, labelSource: 'simulator', needsWorldKnowledge: false, wordingId: w.wordingId, surface: { source: 'bed', slice: G.slice, lineHash: spanHash(state.observation) }, masks, kit: { port: 'Q3', slots, options }, q3: { k, best: best.length, options: options.length } } };
  }
}

// ================================================================================================================
// the generator
// ================================================================================================================
async function* recordsOf(G, slice, seeds, opts, ctx) {
  const def = ctx.slice;
  const wanted = (opts.ports ?? SLICE_PORTS[slice] ?? []).flatMap(p => {
    const s = String(p);
    if (s.includes(':')) return [s];
    return Object.keys(JOBS).filter(j => j === s || j.startsWith(`${s}:`));
  });
  const jobs = [...new Set(wanted)];
  for (const j of jobs) if (HELD_OUT_JOBS.includes(j) && slice !== 'test-ood') throw fail('HELDOUT_FAMILY', `${j} is a held-out family (test-ood only, §3.4); it is not generated in ${slice}`);
  if (!jobs.length) return;
  const perWorld = { Q3: DEFAULT_Q3, ...(PER_WORLD[slice] ?? {}), ...(opts.perWorld ?? {}) };
  const diffs = Array.isArray(opts.difficulties) ? { gridquest: opts.difficulties, gameqa: opts.difficulties } : { gridquest: [1, 2, 3, 4, 5], gameqa: [2, 3, 4, 5], ...(opts.difficulties ?? {}) };
  const need = bed => jobs.some(j => BED_OF(j) === bed);
  const mod = need('gridquest') ? await GQ.loadGq(ctx.beds) : null;
  const qa = need('gameqa') ? await QA.loadQa(ctx.beds) : null;
  const smokeEvery = opts.smokeEvery ?? 6, smoke = (job, seed) => hnum(`${slice}|smoke|${job}|${seed}`) % smokeEvery === 0;
  for (const seed of seeds) {
    if (jobs.includes('Q4:gridquest') && perWorld['Q4:gridquest']) yield* gridquestQ4(G, mod, seed, GQ.difficultyOf(seed, diffs.gridquest), perWorld['Q4:gridquest']);
    if (jobs.includes('Q1') && perWorld.Q1 && smoke('Q1', seed)) yield* gridquestQ1(G, mod, seed, GQ.difficultyOf(seed, diffs.gridquest), perWorld.Q1);
    if (jobs.includes('Q2') && perWorld.Q2 && smoke('Q2', seed)) yield* gridquestQ2(G, mod, seed, GQ.difficultyOf(seed, diffs.gridquest.filter(d => d >= 2)), perWorld.Q2);
    if (jobs.includes('X1:gridquest') && perWorld['X1:gridquest']) yield* gridquestX1(G, mod, seed, GQ.difficultyOf(seed, diffs.gridquest.filter(d => d >= 4)), perWorld['X1:gridquest']);
    if (jobs.includes('X1:gameqa') && perWorld['X1:gameqa']) yield* gameqaX1(G, qa, seed, QA.difficultyOf(seed, diffs.gameqa.filter(d => d >= 3)), perWorld['X1:gameqa']);
    if (jobs.includes('X6:gameqa') && perWorld['X6:gameqa'] && smoke('X6', seed)) yield* gameqaX6(G, qa, seed, QA.difficultyOf(seed, diffs.gameqa), perWorld['X6:gameqa']);
    if (jobs.includes('Q5:gameqa') && perWorld['Q5:gameqa'] && smoke('Q5', seed)) yield* gameqaQ5(G, qa, seed, QA.difficultyOf(seed, diffs.gameqa), perWorld['Q5:gameqa']);
    if (jobs.includes('Q6:gameqa') && perWorld['Q6:gameqa'] && smoke('Q6', seed)) yield* gameqaQ6(G, qa, seed, QA.difficultyOf(seed, diffs.gameqa), perWorld['Q6:gameqa']);
    if (jobs.includes('X2:gameqa') && perWorld['X2:gameqa']) yield* gameqaX2(G, qa, seed, QA.difficultyOf(seed, diffs.gameqa), perWorld['X2:gameqa']);
    if (jobs.includes('Q3') && perWorld.Q3 && smoke('Q3', seed)) yield* gridquestQ3(G, mod, seed, GQ.difficultyOf(seed, diffs.gridquest), perWorld.Q3);
    if (jobs.includes('Q4:gameqa') && perWorld['Q4:gameqa']) yield* gameqaQ4(G, qa, seed, QA.difficultyOf(seed, diffs.gameqa), perWorld['Q4:gameqa']);
  }
}
// Test slices ask one question per port per state (§2.3 rule 5; the build refuses a second one): a state a world
// repeats (the bed's fixed injection sentences, the same alias pair in two worlds) is emitted once. Pair and
// paraphrase records are the clusters the build excepts.
const TEST_LIKE_SLICES = new Set(['test-in', 'test-ood']);
export async function* records(slice, seeds, opts = {}, ctx) {
  const G = makeContext(slice, opts, ctx), seen = new Set();
  for await (const r of recordsOf(G, slice, seeds, opts, ctx)) {
    if (TEST_LIKE_SLICES.has(slice)) {
      const ports = Object.keys(r.questions).map(q => q.split('~')[0]).sort().join('+');
      // a state asked once per port (rule 5); a paraphrase cluster is the one exception, and one per state
      const k = r.meta.variant === 'paraphrase' ? `paraphrase|${ports}|${stateHash(r.state)}` : (r.meta.pairId === undefined || r.meta.pairId === null) ? `${ports}|${stateHash(r.state)}` : null;
      if (k !== null) {
        if (seen.has(k)) { bump(G, 'test:repeated-state'); continue; }
        seen.add(k);
      }
    }
    yield r;
  }
  REPORT.counts = G.counts; REPORT.labeller = G.labellerLog ?? [];
}
// ---- the rows the plan asks of this group (JUDGE-BUILD-PLAN.json estimatedRecords; derivation: JUDGE-PROGRAM.md §4.3) -----------------
// Train rows at the 20K curve point: a hard port (Q4, X1) gets 1,935, split evenly over its train families (Q4 two: gridquest and
// runbook; X1 six). Evaluation sets per port: calib-in 300, calib-ood 500 (X1 600), dev-select 200, dev-ood 600, test-in 500;
// test-ood per axis (Q4: template 600, paraphrase 400, gameqa family 600, adversarial 800 rows, unknowable 300; X1: authored 600,
// paraphrase 400, gridquest family 600, long 150, natural rate 3,000). Wave-2 smoke sets: about 300 train and 100 dev-select rows.
export const TARGETS = Object.freeze({
  'Q4:gridquest': Object.freeze({ train: 967, 'calib-in': 150, 'calib-ood': 250, 'dev-select': 100, 'dev-ood': 300, 'test-in': 250, 'test-ood': 1050 }),
  'X1:gameqa': Object.freeze({ train: 322, 'calib-in': 50, 'calib-ood': 100, 'dev-select': 33, 'dev-ood': 100, 'test-in': 83, 'test-ood': 692 }),
  'Q4:gameqa': Object.freeze({ 'test-ood': 600 }), 'X1:gridquest': Object.freeze({ 'test-ood': 600 }),
  Q1: Object.freeze({ train: 300, 'dev-select': 100 }), Q2: Object.freeze({ train: 300, 'dev-select': 100 }), Q5: Object.freeze({ train: 300, 'dev-select': 100 }),
  Q6: Object.freeze({ train: 300, 'dev-select': 100 }), X6: Object.freeze({ train: 300, 'dev-select': 100 }), 'X2:gameqa': Object.freeze({ 'test-ood': 100 }),
});
export const PLAN_ROWS = Object.freeze({ train: 1291, calib: 550, testIn: 333, testOOD: 2942, dev: 533 });

// diagnostics of the last records() run (counts of drops and kept variants, the Q1 labeller log): read by tests and reports
export const REPORT = { counts: {}, labeller: [] };
export const describe = () => REPORT;

// ---- the label-bearing spans of the held-out families, for the span registry (§2.3 rule 7) -------------------------------------
// Q4:gameqa: the plan's expected-effect sentence and the observation block. X1:gridquest: the injection texts (the
// family-specific, label-bearing spans; its negatives are bed prose shared with the train gridquest ports and are not
// held-out surfaces). X2:gameqa: the two references. The assembly registers them with
// registry.add(text, { slice: 'heldout', source: 'interactive', port, kind, names, markers }).
export function heldoutSpans(record) {
  const masks = record.meta?.masks ?? { names: [], markers: [] }, out = [];
  const ports = Object.keys(record.questions).map(q => q.split('~')[0]), fam = record.meta?.family;
  if (fam === 'gameqa' && ports.includes('Q4')) out.push({ text: record.state.expected_effect, port: 'Q4', kind: 'family-span', masks }, { text: record.state.observation, port: 'Q4', kind: 'family-span', masks });
  if (fam === 'gridquest' && ports.includes('X1') && ['injection', 'journal-injection'].includes(record.meta.x1?.kind)) out.push({ text: record.meta.x1.span ?? record.state.text, port: 'X1', kind: 'family-span', masks });
  if (fam === 'gameqa' && ports.includes('X2')) out.push({ text: record.state.a, port: 'X2', kind: 'family-span', masks }, { text: record.state.b, port: 'X2', kind: 'family-span', masks });
  return out.filter(x => x.text);
}
export function registerHeldout(registry, recs) {
  let n = 0;
  for (const r of recs) for (const x of heldoutSpans(r)) { registry.add(x.text, { slice: 'heldout', source: 'interactive', port: x.port, kind: x.kind, names: x.masks.names, markers: x.masks.markers }); n++; }
  return n;
}

// ---- class support (§2.7 step 8): label x difficulty, forms = distinct masked surface forms ---------------------------------------
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
