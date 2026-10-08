// Shared parts of the synth generator (ports/synth.mjs): hashing, skeleton buckets, wordings, record assembly, the world
// context (bed task, world, tap), and the deployment-rate draws. Pure: every choice is a salted hash of a key; no
// Math.random, no clock, no network. The bed is imported through ctx.beds (the frozen copy); this file imports none.
import { createHash } from 'node:crypto';
import { labelledQuestion, questionId } from '../lib/render.mjs';
import { optionOrder, allocate, counts } from '../lib/balance.mjs';
import { worldHash, skeleton, skeletonBucket, sentences } from '../lib/hash.mjs';
import { parseTask } from '../judges/synth.mjs';
import { alignClaims, masksOf } from '../taps/synth-values.mjs';

export const sha = s => createHash('sha256').update(s).digest('hex');
export const hnum = s => parseInt(sha(s).slice(0, 8), 16);
export const unit01 = key => hnum(key) / 0x100000000;
export const pickBy = (list, key) => list[hnum(key) % list.length];
export const byHash = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
// rows of a wave-2 smoke set (JUDGE-PROGRAM.md §10: about 300 train and 100 dev-select rows per port)
export const SMOKE = Object.freeze({ train: 300, 'dev-select': 100 });
export const fail = (code, message) => { const e = new Error(`${code}: ${message}`); e.code = code; return e; };
export const bump = (G, k, n = 1) => { G.counts[k] = (G.counts[k] ?? 0) + n; };

// the code an entity is called by in a document: an isolate number for a microorganism, the development or phase code otherwise (render.mjs aliasText)
export const aliasText = e => (e.kind === 'organism' ? `isolate ${e.alias}` : e.alias);

// ---- difficulty ---------------------------------------------------------------------------------------------------
// The S2 population is d3-d5 (JUDGE-PROGRAM.md §1.2 S2: claim modes of d3-d5; instruction_like only at d5, projected only from d4).
export const DEFAULT_DIFFICULTIES = Object.freeze([3, 4, 5]);
export const difficultyOf = (seed, allowed = DEFAULT_DIFFICULTIES) => allowed[seed % allowed.length];

// ---- skeleton buckets (§3.1, §3.3) ----------------------------------------------------------------------------------------
// The label-bearing span of a row is hashed by its masked skeleton: train, calib-in, dev-select and test-in read the bucket
// 40-100%, calib-ood 30-40%, dev-ood 20-30%, test-ood 0-20%.
export const BUCKET_OF_SLICE = Object.freeze({ train: 'train', 'calib-in': 'train', 'dev-select': 'train', 'test-in': 'train', 'calib-ood': 'calib-ood', 'dev-ood': 'dev-ood', 'test-ood': 'test-ood' });
export const OOD = new Set(['calib-ood', 'dev-ood', 'test-ood']);
export const bucketAllows = (slice, formHash) => skeletonBucket(formHash) === BUCKET_OF_SLICE[slice];
export const formOf = (text, masks) => skeleton(text, masks);
// A state's text may carry the label-bearing sentence of the slice's own bucket and other sentences of the bed's train
// bucket only: no sentence of a held-out bucket reaches another slice (so none of the registered test-ood material of this
// group, X8's source lines, can sit in a train, calib or dev state). Every sentence the span registry would split the
// text into (lib/hash.mjs sentences) is checked, not only the label sentence.
const BUCKETS = new WeakMap();                      // masks object -> Map(sentence -> bucket): a world's sentences are bucketed once
export function bucketOfSentence(s, masks) {
  let m = BUCKETS.get(masks);
  if (!m) BUCKETS.set(masks, m = new Map());
  let b = m.get(s);
  if (b === undefined) { b = skeletonBucket(skeleton(s, masks)); m.set(s, b); }
  return b;
}
export function textAllowed(slice, labelForm, text, masks) {
  const own = BUCKET_OF_SLICE[slice];
  if (labelForm !== null && skeletonBucket(labelForm) !== own) return false;
  const allowed = own === 'train' ? ['train'] : ['train', own];
  return sentences(text).every(s => allowed.includes(bucketOfSentence(s, masks)));
}
export const textBucketsAllowed = (slice, text, masks) => textAllowed(slice, null, text, masks);
// The relaxed rule for a long text (a whole document: too many sentences for all of them to be of the train bucket): no sentence of the
// test-ood bucket, which is where the held-out family (X8 synth) takes its spans from, may sit in a state of another slice.
export const noTestOodSentences = (slice, text, masks) => slice === 'test-ood' || sentences(text).every(s => bucketOfSentence(s, masks) !== 'test-ood');

// ---- wording and records ------------------------------------------------------------------------------------------------
const sliceWordings = (opts, port, slice) => (opts.wordings?.[port] ?? []).filter(w => w.slice === undefined || w.slice === slice);
export function wordingFor(contract, slice, key, opts, taken = []) {
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
export function makeRecord({ contract, slice, opts, key, state, label, target, slots = {}, options, optionDescriptions, qid = null, extraQuestions = null, meta }) {
  const w = wordingFor(contract, slice, key, opts);
  const names = options ?? Object.keys(contract.options ?? {});
  const q = labelledQuestion(contract, { label, ...(target ? { target } : {}), wording: w.wording, wordingText: w.wordingText, slots, options, optionDescriptions, optionOrder: optionOrder(names, key) });
  return { state, questions: { [qid ?? questionId(contract.id)]: q, ...(extraQuestions ?? {}) }, meta: { family: 'synth', bed: 'synth', labelSource: 'generator', needsWorldKnowledge: false, wordingId: w.wordingId, ...meta } };
}
// a paraphrase-consistency record (§3.2): the same state asked with Q0 and two test wordings (one cluster)
export function paraphraseOf(rec, contract, slice, opts, key, slots = {}) {
  const port = contract.id, label = Object.values(rec.questions)[0].label;
  const list = sliceWordings(opts, port, slice);
  if (list.length < 2) return null;
  const a = pickBy(list, `${key}|pa`), b = pickBy(list.filter(w => w.id !== a.id), `${key}|pb`);
  const names = Object.keys(contract.options ?? {}), questions = {};
  questions[questionId(port, 'Q0')] = labelledQuestion(contract, { label, wording: 'Q0', slots, optionOrder: optionOrder(names, `${key}|Q0`) });
  for (const w of [a, b]) questions[questionId(port, w.id)] = labelledQuestion(contract, { label, wording: 'Q0', wordingText: w.text, slots, optionOrder: optionOrder(names, `${key}|${w.id}`) });
  return { state: rec.state, questions, meta: { ...rec.meta, variant: 'paraphrase', wordingId: `Q0+${a.id}+${b.id}` } };
}

// ---- a world as the generator sees it -----------------------------------------------------------------------------------------
export async function loadWorld(G, seed, difficulty) {
  const S = G.bed ?? (G.bed = await G.ctx.beds.import('beds/synth/index.mjs'));
  const split = G.def.bedSplit, task = S.generate({ seed, split, difficulty }), { world } = S.hidden({ seed, split, difficulty });
  const parsed = parseTask(task), tap = alignClaims({ task, world, parsed }), masks = masksOf(world);
  const rowOf = new Map(tap.claims.map(r => [r.cid, r]));
  return { seed, difficulty, task, world, parsed, tap, masks, wh: worldHash(task), rowOf };
}

// ---- deployment-rate draws ------------------------------------------------------------------------------------------------------
// Draw `n` rows from `rows` at label `rates` (largest-remainder counts); each label's rows are taken in the order of a salted
// hash of the row key. A label short of rows is reported in `shortfall` (never padded with another label), except that
// `fill` names a label that tops the draw up to n (an enriched calib-OOD set keeps its size and its minority counts).
export function drawAtRates(rows, { label, rates, n, key, salt, fill = null, exclude = null }) {
  const pool = exclude ? rows.filter(r => !exclude.has(key(r))) : rows;
  const want = allocate(n, rates), by = {};
  for (const r of pool) (by[label(r)] ??= []).push(r);
  for (const l of Object.keys(by)) by[l].sort((a, b) => byHash(sha(`${salt}|${key(a)}`), sha(`${salt}|${key(b)}`)));
  const taken = {}, kept = [], shortfall = {};
  for (const l of Object.keys(want)) {
    const take = (by[l] ?? []).slice(0, want[l]);
    taken[l] = take.length; kept.push(...take);
    if (take.length < want[l]) shortfall[l] = want[l] - take.length;
  }
  if (fill && kept.length < n) {
    const more = (by[fill] ?? []).slice(taken[fill] ?? 0, (taken[fill] ?? 0) + (n - kept.length));
    kept.push(...more); taken[fill] = (taken[fill] ?? 0) + more.length;
  }
  const inPool = new Set(kept.map(key));
  kept.sort((a, b) => byHash(sha(`${salt}|order|${key(a)}`), sha(`${salt}|order|${key(b)}`)));
  return { kept, want, taken, shortfall, supply: counts(pool, label), inPool };
}
// The rates an enriched calibration set draws at: every minority label at `factor` times its natural rate, the majority label the rest.
export function enrichedRates(natural, majority, factor = 3) {
  const out = {}; let rest = 1;
  for (const [l, r] of Object.entries(natural)) if (l !== majority) { out[l] = Math.min(0.45, r * factor); rest -= out[l]; }
  out[majority] = Math.max(0, rest);
  return out;
}
