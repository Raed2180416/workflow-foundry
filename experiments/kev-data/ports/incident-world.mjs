// Worlds of the incident bed for the incident generator (JUDGE-PROGRAM.md §1.2 group I; §2.3; §3.1, §3.3).
// A world is the bed's { task, truth } for (split, difficulty, seed) plus everything the generator derives from the task
// text alone: the system document (judges/incident.mjs parseSystem), the log, the masks of its skeletons and the
// surface form (masked skeleton) of a message. Beds are imported only through ctx.beds (the frozen copy).
import { createHash } from 'node:crypto';
import { parseSystem, parseLog, serviceOfSource, lineText } from '../judges/incident.mjs';
import { skeleton, skeletonBucket, worldHash, sha256 } from '../lib/hash.mjs';
import * as lib from '../solve/incident-lib.mjs';

export const FAMILY = 'incident', BED = 'incident';
export const sha = s => createHash('sha256').update(s).digest('hex');
export const hnum = s => parseInt(sha(s).slice(0, 8), 16);
export const unit = key => hnum(key) / 0x100000000;
export const pick = (list, key) => list[hnum(key) % list.length];
export const byHash = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
export const fail = (code, message) => { const e = new Error(`${code}: ${message}`); e.code = code; return e; };

// ---- the frozen bed (once per pin) --------------------------------------------------------------------------------------------
const BED_CACHE = new Map();
export async function loadBed(beds, labelTags) {
  const key = `${beds.pin}|${JSON.stringify(labelTags)}`;
  if (!BED_CACHE.has(key)) {
    const [gen, C] = await Promise.all([beds.import('beds/incident/gen.mjs'), beds.import('beds/incident/catalog.mjs')]);
    BED_CACHE.set(key, Object.freeze({ gen, C, version: gen.VERSION, sc: lib.makeSolverContext(C, labelTags), notes: lib.compileNotes(C), pin: beds.pin }));
  }
  return BED_CACHE.get(key);
}

// ---- masks and surface forms ---------------------------------------------------------------------------------------------------
// names: every way a log line or a note names a service or a provider; markers: pods and log sources (their suffixes are
// random hex). An IPv4 address is masked as one token before the skeleton: its dotted shape would otherwise change how the
// skeleton reads dates.
export function masksOf(task) {
  const sys = parseSystem(task.inputs.system), log = parseLog(task.inputs.log);
  const names = [...sys.aliases.map(a => a.alias), ...sys.providers.flatMap(p => [p.name, p.host])];
  const markers = [...new Set([...log.lines.map(l => l.source), ...sys.shadowPods])];
  return { names: [...new Set(names)].sort(), markers: markers.sort() };
}
export const ipMasked = s => String(s).replace(/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/g, ' {ip} ');
export const formOf = (text, masks) => skeleton(ipMasked(text), masks);

// the bucket a slice reads (§3.1, §3.3): train-like slices and test-in 'train', each OOD slice its own
export const BUCKET_OF_SLICE = Object.freeze({ train: 'train', 'calib-in': 'train', 'dev-select': 'train', 'test-in': 'train', 'calib-ood': 'calib-ood', 'dev-ood': 'dev-ood', 'test-ood': 'test-ood' });
export const OOD = new Set(['calib-ood', 'dev-ood', 'test-ood']);
export const bucketAllows = (slice, formHash) => skeletonBucket(formHash) === BUCKET_OF_SLICE[slice];
// Context (every line or note of a state that is not the row's decisive span): a state of a slice reads the train bucket and
// its own, never the bucket of another held-out slice (a more held-out surface must not reach a less held-out file).
export const contextAllows = (slice, formHash) => { const b = skeletonBucket(formHash); return b === 'train' || b === BUCKET_OF_SLICE[slice]; };

// ---- worlds ---------------------------------------------------------------------------------------------------------------------
const DIFFICULTY_CYCLE = [3, 4, 5, 5];
export const difficultyOf = (seed, allowed = [3, 4, 5]) => {
  const cycle = DIFFICULTY_CYCLE.filter(d => allowed.includes(d));
  return cycle.length ? cycle[seed % cycle.length] : allowed[seed % allowed.length];
};
const WORLDS = new Map();
export function loadWorld(B, split, difficulty, seed) {
  const key = `${B.pin}|${split}|${difficulty}|${seed}`;
  if (WORLDS.has(key)) return WORLDS.get(key);
  const { task, truth } = B.gen.build(seed, split, difficulty);
  const sys = parseSystem(task.inputs.system), log = parseLog(task.inputs.log);
  const tagOf = new Map();
  for (const [tag, ids] of Object.entries(truth.idsByTag)) for (const id of ids) tagOf.set(id, tag);
  const W = { task, truth, sys, log, tagOf, seed, split, difficulty, key: `${split}:d${difficulty}:s${seed}`, worldHash: worldHash(task), masks: masksOf(task), forms: new Map() };
  if (WORLDS.size > 24) WORLDS.clear();
  WORLDS.set(key, W);
  return W;
}
// surface form of a log line's message (memoised per world)
export function lineForm(W, id) {
  if (!W.forms.has(id)) W.forms.set(id, formOf(W.log.byId.get(id).message, W.masks));
  return W.forms.get(id);
}
export const serviceOfLine = (W, id) => serviceOfSource(W.sys, W.log.byId.get(id).source);
// the bed's times are seconds from the start of its 30-minute window; truth.T is the fault's, truth.first_bad_timestamp its ISO form
export const isoOfMs = ms => new Date(ms).toISOString().replace('.000Z', 'Z');
export const epochMs = W => Date.parse(W.truth.first_bad_timestamp) - W.truth.T * 1000;
export const isoAt = (W, seconds) => isoOfMs(epochMs(W) + seconds * 1000);
export { parseSystem, parseLog, serviceOfSource, lineText, sha256 };

// ---- records ----------------------------------------------------------------------------------------------------------------------
import { labelledQuestion, uniformTarget, questionId } from '../lib/render.mjs';
import { optionOrder } from '../lib/balance.mjs';
import { spanHash } from '../lib/hash.mjs';

// wording of a record (§2.3 rule 3): Q0-Q3 uniformly in train-like slices; an OOD slice uses only its own held-out
// wordings, which the assembly passes in opts.wordings (this generator never reads the held-out store)
export function wordingFor(contract, slice, key, opts) {
  const port = contract.id, held = (contract.heldoutWordings?.[slice] ?? 0) > 0 && OOD.has(slice);
  if (held) {
    const list = opts.wordings?.[port] ?? [];
    if (!list.length) throw fail('HELDOUT_WORDINGS_MISSING', `${port} in ${slice} uses the slice's held-out wordings: pass opts.wordings.${port} = [{id, text}] (the assembly reads them from the held-out store; this generator does not)`);
    const w = pick(list, `${key}|wording`);
    return { wording: 'Q0', wordingText: w.text, wordingId: w.id };
  }
  const q = pick(['Q0', 'Q1', 'Q2', 'Q3'], `${key}|wording`);
  return { wording: q, wordingText: undefined, wordingId: q };
}
// one record: a state, one question, its meta
export function makeRecord({ contract, slice, opts, key, state, label, target, slots = {}, meta }) {
  const w = wordingFor(contract, slice, key, opts);
  const names = Object.keys(contract.options ?? {});
  const q = labelledQuestion(contract, { label, target, wording: w.wording, wordingText: w.wordingText, slots, optionOrder: optionOrder(names, key) });
  return { state, questions: { [questionId(contract.id)]: q }, meta: { family: FAMILY, bed: BED, labelSource: 'generator', needsWorldKnowledge: false, wordingId: w.wordingId, ...meta } };
}
// a paraphrase-consistency record (§3.2): the same state asked with Q0 and two held-out wordings of the slice
export function paraphraseOf(rec, contract, opts, key, slots = {}) {
  const port = contract.id, label = Object.values(rec.questions)[0].label;
  const list = opts.wordings?.[port] ?? [];
  if (list.length < 2) return null;
  const a = pick(list, `${key}|pa`), b = pick(list.filter(w => w.id !== a.id), `${key}|pb`);
  const names = Object.keys(contract.options ?? {}), questions = {};
  questions[questionId(port, 'Q0')] = labelledQuestion(contract, { label, wording: 'Q0', slots, optionOrder: optionOrder(names, `${key}|Q0`) });
  for (const w of [a, b]) questions[questionId(port, w.id)] = labelledQuestion(contract, { label, wording: 'Q0', wordingText: w.text, slots, optionOrder: optionOrder(names, `${key}|${w.id}`) });
  return { state: rec.state, questions, meta: { ...rec.meta, variant: 'paraphrase', wordingId: `Q0+${a.id}+${b.id}` } };
}
export { uniformTarget, questionId, spanHash };

// A deterministic RNG for the bed's own template functions (they use int, pick, chance, next only): seeded by a key
export function detRng(key) {
  let n = 0;
  const next = () => hnum(`${key}|${n++}`) / 0x100000000;
  const api = { next, int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)), float: (lo, hi) => lo + next() * (hi - lo), pick: l => l[Math.floor(next() * l.length)], chance: p => next() < p,
    shuffle: l => { const o = [...l]; for (let i = o.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [o[i], o[j]] = [o[j], o[i]]; } return o; }, sample: (l, k) => api.shuffle(l).slice(0, k), fork: lbl => detRng(`${key}|${lbl}`) };
  return api;
}

// What the generator dropped and why, per port (side channel for the tests and the manifest; the records are the output)
export const STATS = { dropped: {}, rows: {}, forms: {} };
export const resetStats = () => { STATS.dropped = {}; STATS.rows = {}; STATS.forms = {}; };
export const drop = (port, reason) => { const d = (STATS.dropped[port] ??= {}); d[reason] = (d[reason] ?? 0) + 1; };
export const count = (port, what) => { const d = (STATS.rows[port] ??= {}); d[what] = (d[what] ?? 0) + 1; };
