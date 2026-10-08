// Kev data factory build (JUDGE-PROGRAM.md §2.1-§2.3, §3.1). Skeleton owned by contracts-lib: the
// split and slice table, the record checks every group's output must pass, the build driver and the
// build verifier. Generators (experiments/kev-data/ports/<group>.mjs) are written by the bed groups.
//
// Generator interface (§2.2, extended with the build context):
//   export const group = 'records-notes';
//   export const ports = ['R1', 'R2', ...];
//   export function* records(slice, seeds, opts, ctx) { yield { state, questions, meta }; }   // or async function*
//     slice  one of SLICES[].id;  seeds  the slice's seed list;  opts  the build's generator options
//     ctx    { beds, pin, spec, contracts, slice, heldoutDir, poolsDir }: beds is the frozen-copy
//            handle (lib/pin.mjs frozenBeds); beds are imported through it and never live. spec and
//            contracts are deep-frozen.
//   Pure: the same (slice, seeds, opts, factory version, bed pin) gives the same records in the same
//   order. No Math.random, no clock, no network.
//
// Build outputs (git-ignored): <outRoot>/<buildId>/
//   kev/<slice>.jsonl + kev/<slice>.meta.jsonl   Kev files and meta sidecars (export-kev.mjs)
//   manifest.json                                 counts, hashes, pins, drops, token stats (deterministic:
//                                                 byte-identical for the same config and pin)
//   timing.json                                   generation time and the HEAD commit the beds were read
//                                                 at (the only non-deterministic file)
//
//   node experiments/kev-data/build.mjs --slices            print the §3.1 slice table
//   node experiments/kev-data/build.mjs --config <file>     build ({generators, slices, seeds, opts, ...})
//   node experiments/kev-data/build.mjs --verify <dir>      re-check a build directory
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { registerHooks } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertPortState } from './judges/kit.mjs';
import { toSystemOneQuestion } from '../../src/judgment.mjs';
import { contractMasks, familyBed, loadSpec, REPO_ROOT } from './lib/contracts.mjs';
import { canonical, sha256, stateHash } from './lib/hash.mjs';
import { contractOptions, normalizeWs, portOfQuestionId, questionContract, questionOf, wordingPattern } from './lib/render.mjs';
import { coversMasks, OOD_SLICES, SpanRegistry, TRAIN_LIKE, WordingGuard } from './lib/leakage.mjs';
import { BEDS, parseWorldKey, reservationOf, reservedViolation, worldKey } from './lib/registry.mjs';
import { checkPositionUniform, positionHistogram } from './lib/balance.mjs';
import { checkDriftRecord, freezeBeds, frozenBeds } from './lib/pin.mjs';
import { BED_DERIVED, checkBedDerived } from './lib/bedsync.mjs';
import { KEV, KEV_MAX_STATE, TOKENIZER, jobMaxState, measureForJob, quantile } from './lib/tokens.mjs';
import { exportKev, fileDigest, readKevFile, softTargetPort, TRAIN_SLICE, unknowableQuestions } from './export-kev.mjs';

export const FACTORY_VERSION = 'kev-data-factory@1';
export const KEV_DATA_DIR = path.dirname(fileURLToPath(import.meta.url));

// §3.1 seed ranges and slices (all beds). `kind`: train | in (in-family evaluation) | ood | reserve.
// `wordings`: 'Q0-Q3' (sampled uniformly per record) or the slice's own held-out wordings.
export const RESERVED = Object.freeze({ id: 'reserved', bedSplit: 'dev', seeds: [1, 400], use: 'probe and pilot worlds; never trained or calibrated' });
export const SLICES = Object.freeze([
  { id: 'train', bedSplit: 'dev', seeds: [401, 3999], kind: 'train', wordings: 'Q0-Q3', skeletonBuckets: [40, 100],
    surfaces: 'bed templates (non-held-out), train-pool lines, Q0-Q3, train families, skeleton buckets 40-100%', use: 'training; hard-negative mining' },
  { id: 'calib-in', bedSplit: 'dev', seeds: [4000, 4199], kind: 'in', wordings: 'Q0-Q3', skeletonBuckets: [40, 100], surfaces: 'as train', use: 'in-family calibration gap (report only)' },
  { id: 'calib-ood', bedSplit: 'dev', seeds: [4200, 4499], kind: 'ood', wordings: 'calib-ood', skeletonBuckets: [30, 40],
    surfaces: 'calib-OOD authored lines and wordings, skeleton bucket 30-40%', use: 'temperature, per-option biases, thresholds' },
  { id: 'dev-select', bedSplit: 'dev', seeds: [4500, 4699], kind: 'in', wordings: 'Q0-Q3', skeletonBuckets: [40, 100], surfaces: 'as train', use: 'in-family diagnostics, transfer gap at selection' },
  { id: 'dev-ood', bedSplit: 'dev', seeds: [4700, 4999], kind: 'ood', wordings: 'dev-ood', skeletonBuckets: [20, 30],
    surfaces: 'dev-OOD authored lines and wordings, skeleton bucket 20-30%', use: 'learning-curve read-out; config and checkpoint selection' },
  { id: 'test-in', bedSplit: 'test', seeds: [5000, 5999], kind: 'in', wordings: 'Q0-Q3', skeletonBuckets: [40, 100], surfaces: 'as train', use: 'read once: recall' },
  { id: 'test-ood', bedSplit: 'test', seeds: [6000, 6999], kind: 'ood', wordings: 'test-ood', skeletonBuckets: [0, 20],
    surfaces: 'test-OOD authored lines and wordings, skeleton bucket 0-20%, held-out families, held-out bed templates (diagnostic), adversarial, long, unknowable, causal', use: 'read once' },
  { id: 'real-reserve', bedSplit: 'test', seeds: [7000, 7039], kind: 'reserve', wordings: 'Q0-Q3', difficulties: [3, 4, 5], surfaces: 'real weak-model runs', use: 'X8-real axis; X8 end-to-end' },
  { id: 'e2e-reserve', bedSplit: 'test', seeds: [7040, 7199], kind: 'reserve', wordings: 'Q0-Q3', surfaces: '-', use: 'X5 end-to-end gate (§8.3)' },
].map(s => Object.freeze(s)));
export const SLICE_IDS = Object.freeze(SLICES.map(s => s.id));
export const sliceDef = id => { const s = SLICES.find(x => x.id === id); if (!s) throw fail('SLICE', `unknown slice ${id}`); return s; };
// Evaluation slices first: a state claimed by an earlier slice is dropped from later ones (§2.3 rule 7:
// stateHash dedups exact states across all splits and slices; evaluation sets keep theirs).
export const SLICE_PRIORITY = Object.freeze(['e2e-reserve', 'real-reserve', 'test-ood', 'test-in', 'dev-ood', 'calib-ood', 'dev-select', 'calib-in', 'train']);
export const TEST_SLICES = Object.freeze(['test-in', 'test-ood', 'real-reserve', 'e2e-reserve']);
// §2.3 rule 1: labels come from generator truth, simulators, oracles, replays, journals, composers,
// the brief an authored line was written to, or hand labels. Never from an LLM.
export const LABEL_SOURCES = Object.freeze(['generator', 'simulator', 'oracle', 'replay', 'journal', 'composer', 'authored-brief', 'hand-label']);
// Rule 5: at most 6 questions per train/calib/dev record, unless a port's own record form holds more
// (contract.recordQuestions: C1 12, C3 9, Q1 4).
export const MAX_QUESTIONS = 6;
// §3.4: held-out families appear only in test-OOD (and the reserves, where records-real lives).
export const HELDOUT_FAMILY_SLICES = Object.freeze(['test-ood', 'real-reserve', 'e2e-reserve']);
// Held-out material every build needs (§2.3 rules 3 and 7): the span registry for train-like and OOD
// slices, the held-out wording guard for every slice.
export const REGISTRY_SLICES = Object.freeze([...TRAIN_LIKE, ...OOD_SLICES]);
// Rule 4: option positions within ±5 pp of uniform, enforced per evaluation file and option count once
// the file holds at least this many questions with that count (a fair shuffle of fewer can miss
// ±5 pp by chance); smaller counts are reported only.
export const POSITION_MIN_N = 1000;
const WORLD_HASH = /^sha256:[0-9a-f]{64}$/;
const recordQuestionsOf = c => (Number.isInteger(c?.recordQuestions) ? c.recordQuestions : 1);

function fail(code, message, details) { const e = new Error(`${code}: ${message}`); e.code = code; if (details !== undefined) e.details = details; return e; }

// The seed list of a slice: the whole range, an explicit list, or {first?, count}.
export function seedsFor(slice, want) {
  const [lo, hi] = sliceDef(slice).seeds;
  let list;
  if (want === undefined || want === null) list = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
  else if (Array.isArray(want)) list = [...want];
  else if (Number.isInteger(want?.count)) { const first = want.first ?? lo; list = Array.from({ length: want.count }, (_, i) => first + i); }
  else throw fail('SEEDS', `seeds for ${slice} must be a list or {first?, count}`);
  const bad = list.filter(s => !Number.isInteger(s) || s < lo || s > hi);
  if (bad.length) throw fail('SEED_RANGE', `${slice} takes seeds ${lo}-${hi}; got ${bad.slice(0, 5).join(', ')}`);
  return list;
}

const sameSet = (a, b) => a.length === b.length && [...a].sort().every((x, i) => x === [...b].sort()[i]);

// Does `instructions` render one of `templates` through toSystemOneQuestion with the contract's
// criteria and slot values (a slot with values takes one of them, a maxChars slot at most that many
// characters)? Returns { id } for the matching wording, or { id: null, slotMiss } where slotMiss says a
// template matched only with a slot filling the contract does not allow.
function matchWording(instructions, templates, contract, options, descriptions) {
  const q = questionOf(instructions), norm = normalizeWs(q);
  let slotMiss = false;
  for (const [id, text] of templates) {
    if (!wordingPattern(text).test(norm)) continue;
    if (!wordingPattern(text, contract.slots ?? {}).test(norm)) { slotMiss = true; continue; }
    const direct = toSystemOneQuestion({ question: q, criteria: contract.criteria ?? [], options, optionDescriptions: descriptions });
    if (direct.instructions === instructions) return { id };
  }
  return { id: null, slotMiss };
}

// The checks every record must pass before it reaches a file (§2.2, §2.3 rules 1-3, 5, 7, 8; §3.1,
// §3.4). Returns { record (normalised: meta.split, ports, bed pin, state hash, world, worlds, reserved,
// unknowable), errors }. A build passes the span registry and the held-out wording guard (buildKev
// requires them); a caller that omits them gets every other check.
export function checkRecord(record, { slice, contracts, variants, pin = null, wordings = null, registry = null }) {
  const errors = [], err = (code, m) => errors.push({ code, message: m });
  const def = sliceDef(slice);
  if (!record || typeof record !== 'object' || Array.isArray(record)) return { record, errors: [{ code: 'RECORD', message: 'a record is an object' }] };
  const { state, questions } = record, meta = { ...(record.meta ?? {}) };
  const extra = Object.keys(record).filter(k => !['state', 'questions', 'meta'].includes(k));
  if (extra.length) err('RECORD', `unexpected record keys ${extra.join(', ')}`);
  try { assertPortState(state); } catch (e) { err(e.code === 'PORT_STATE_FORBIDDEN_KEY' ? 'FORBIDDEN_KEY' : 'STATE', e.message); }
  // meta
  if (meta.split !== undefined && meta.split !== slice) err('META', `meta.split ${meta.split} in a ${slice} build`);
  meta.split = slice;
  if (typeof meta.family !== 'string' || !meta.family) err('META', 'meta.family is required');
  if (!variants.includes(meta.variant)) err('META', `meta.variant ${meta.variant} is not one of ${variants.join(', ')}`);
  if (!LABEL_SOURCES.includes(meta.labelSource)) err('LABEL_SOURCE', `meta.labelSource ${meta.labelSource} is not one of ${LABEL_SOURCES.join(', ')} (no LLM labels)`);
  const given = k => meta[k] !== undefined && meta[k] !== null;
  for (const k of ['seed', 'difficulty']) if (given(k) && !(Number.isInteger(meta[k]) && meta[k] >= 0)) err('META', `meta.${k} must be a non-negative integer or null`);
  // worlds (rule 8): a record drawn from a bed names its own world (bed, the slice's bed split,
  // difficulty, seed) or the worlds it draws on (meta.worlds); both are checked against the reserved
  // registry and the slice's seed range. A family drawn from a bed requires meta.bed.
  const worlds = [];
  let own = null;
  if (given('worlds') && !Array.isArray(meta.worlds)) err('META', 'meta.worlds must be a list of world keys');
  const drawn = Array.isArray(meta.worlds) ? meta.worlds : [];
  const famBed = familyBed(meta.family);
  if (famBed && !given('bed')) err('META', `family ${meta.family} is drawn from bed ${famBed}: set meta.bed and the record's world (meta.seed and meta.difficulty, or meta.worlds)`);
  if (given('bed')) {
    if (!BEDS.includes(meta.bed)) err('META', `meta.bed ${JSON.stringify(meta.bed)} is not one of the pinned dev beds (${BEDS.join(', ')})`);
    else if (famBed && famBed !== meta.bed) err('META', `meta.bed ${meta.bed} does not match family ${meta.family}`);
    if (!given('seed') && !drawn.length) err('META', 'a bed record needs meta.seed and meta.difficulty (its own world) or meta.worlds (the worlds it draws on)');
    if (given('seed')) {
      if (!Number.isInteger(meta.difficulty) || meta.difficulty < 1 || meta.difficulty > 5) err('META', `a bed record with a seed needs meta.difficulty 1-5 (got ${JSON.stringify(meta.difficulty)})`);
      else if (Number.isInteger(meta.seed) && meta.seed >= 0 && BEDS.includes(meta.bed)) worlds.push(own = worldKey({ bed: meta.bed, split: def.bedSplit, difficulty: meta.difficulty, seed: meta.seed }));
      if (!WORLD_HASH.test(meta.worldHash ?? '')) err('META', 'a bed record with a seed needs meta.worldHash (lib/hash.mjs worldHash(task)): worlds are deduplicated by it (rule 7)');
    }
  }
  for (const w of drawn) {
    try { const p = parseWorldKey(w); if (!BEDS.includes(p.bed)) throw new Error(`world ${w} names ${p.bed}, which is not a pinned dev bed`); worlds.push(w); } catch (e) { err('META', e.message); }
  }
  const reservedHits = worlds.map(w => reservedViolation(w, slice)).filter(Boolean);
  for (const v of reservedHits) err('RESERVED_WORLD', `${v.world} is reserved (${v.reservation}) and may not enter ${slice}`);
  if (!reservedHits.length) {
    const [lo, hi] = def.seeds;
    if (given('seed') && Number.isInteger(meta.seed) && (meta.seed < lo || meta.seed > hi)) err('SEED_RANGE', `seed ${meta.seed} is outside ${slice} (${lo}-${hi})`);
    for (const w of worlds) { const p = parseWorldKey(w); if (p.split !== def.bedSplit || p.seed < lo || p.seed > hi) err('SEED_RANGE', `world ${w} is outside ${slice} (${def.bedSplit} ${lo}-${hi})`); }
    if (def.difficulties && worlds.some(w => !def.difficulties.includes(parseWorldKey(w).difficulty))) err('SEED_RANGE', `${slice} takes difficulties ${def.difficulties.join(', ')}`);
  }
  meta.world = own;
  meta.worldKeys = worlds;
  meta.reserved = worlds.some(w => reservationOf(w) !== null);
  // questions
  const qids = questions && typeof questions === 'object' ? Object.keys(questions) : [];
  if (!qids.length) err('RECORD', 'a record needs at least one question');
  const resolved = Object.fromEntries(qids.map(q => [q, questionContract(q, contracts)]));
  const ports = [...new Set(qids.map(q => resolved[q]?.port ?? portOfQuestionId(q)))].sort();
  if (meta.ports !== undefined && !sameSet(meta.ports, ports)) err('META', `meta.ports ${JSON.stringify(meta.ports)} != question ports ${JSON.stringify(ports)}`);
  meta.ports = ports;
  // families (§3.4): the record's family is a family of every port it asks; held-out families only in test-OOD
  if (typeof meta.family === 'string') for (const p of ports) {
    const fams = contracts[p]?.families;
    if (!fams || contracts[p].ledgerOnly) continue;
    if (fams.heldOut.includes(meta.family)) { if (!HELDOUT_FAMILY_SLICES.includes(slice)) err('HELDOUT_FAMILY', `${p}: family ${meta.family} is held out (test-OOD only, §3.4) and may not enter ${slice}`); }
    else if (!fams.train.includes(meta.family)) err('FAMILY', `${p}: family ${meta.family} is not one of ${p}'s families (${[...fams.train, ...fams.heldOut].join(', ')})`);
  }
  // question limits (rule 5)
  const asked = qids.map(q => resolved[q]?.reportId ?? portOfQuestionId(q));
  const testLike = def.kind === 'reserve' || TEST_SLICES.includes(slice), clustered = meta.variant === 'paraphrase' || given('pairId');
  if (testLike) {
    if (!clustered) for (const p of new Set(asked)) {
      const mine = qids.filter((q, i) => asked[i] === p), n = recordQuestionsOf(resolved[mine[0]]?.contract);
      if (mine.length > n) err('QUESTION_LIMIT', `${slice} records carry at most ${n === 1 ? 'one question' : `${n} questions (one per slot value)`} of ${p} per state (except paraphrase and pair records)`);
      else if (n > 1 && new Set(mine.map(q => normalizeWs(questionOf(questions[q]?.instructions ?? '')))).size !== mine.length) err('QUESTION_LIMIT', `${slice}: two ${p} questions on one state ask the same thing`);
    }
  } else {
    const limit = Math.max(MAX_QUESTIONS, ...ports.map(p => recordQuestionsOf(contracts[p])));
    if (qids.length > limit) err('QUESTION_LIMIT', `${qids.length} questions (at most ${limit})`);
  }
  // unknowables (§2.5): per question; an evaluation record marked unknowable carries only those questions
  if (given('unknowable') && (!Array.isArray(meta.unknowable) || !meta.unknowable.every(q => typeof q === 'string'))) err('META', 'meta.unknowable is a list of question ids');
  else if (meta.variant === 'unknowable' && !given('unknowable') && qids.length > 1) err('META', 'a multi-question unknowable record lists its unknowable questions in meta.unknowable');
  else if (given('unknowable') && meta.variant !== 'unknowable' && meta.unknowable.length) err('META', `meta.unknowable is set on a ${meta.variant} record`);
  else if (meta.variant === 'unknowable' && given('unknowable') && !meta.unknowable.length) err('META', 'an unknowable record names at least one unknowable question');
  for (const q of Array.isArray(meta.unknowable) ? meta.unknowable : []) if (!qids.includes(q)) err('META', `meta.unknowable names ${q}, which the record does not ask`);
  const unknowable = unknowableQuestions({ questions: questions ?? {}, meta });
  if (unknowable.length) meta.unknowable = unknowable; else delete meta.unknowable;
  const softUnknowable = unknowable.filter(q => softTargetPort(resolved[q]?.contract));
  if (slice !== TRAIN_SLICE && softUnknowable.length && softUnknowable.length !== qids.length) {
    err('MIXED_UNKNOWABLE', `an evaluation record with unknowable ${softUnknowable.join(', ')} carries other questions (${qids.filter(q => !softUnknowable.includes(q)).join(', ')}); Kev's _meta.source is per record, so split it`);
  }
  const needGuard = qids.some(q => OOD_SLICES.includes(slice) && !resolved[q]?.companion && (resolved[q]?.contract?.heldoutWordings?.[slice] ?? 0) > 0);
  if (needGuard && !wordings) err('WORDING', `${slice} needs the held-out wordings (WordingGuard) to check its questions`);
  for (const qid of qids) {
    const q = questions[qid], qc = resolved[qid], c = qc?.contract, port = qc?.reportId ?? portOfQuestionId(qid);
    if (!c) { err('CONTRACT', `${qid}: no frozen contract for ${port}`); continue; }
    if (c.ledgerOnly) { err('CONTRACT', `${qid}: ${port} is ledger-only (no data, no training, no gate)`); continue; }
    if (!q || q.type !== 'choice' || typeof q.instructions !== 'string' || !q.criteria || typeof q.criteria !== 'object') { err('CONTRACT', `${qid}: not a System One choice question`); continue; }
    const opts = Object.keys(q.criteria);
    if (c.options) {
      if (!sameSet(opts, Object.keys(c.options)) || opts.some(o => q.criteria[o] !== c.options[o])) err('CONTRACT', `${qid}: options and descriptions must be the contract's (${Object.keys(c.options).join(', ')})`);
    } else {
      try { contractOptions(c, { options: opts, optionDescriptions: q.criteria }); } catch (e) { err('CONTRACT', `${qid}: ${e.message}`); }
    }
    if (!Object.hasOwn(q.criteria, q.label)) err('CONTRACT', `${qid}: label ${JSON.stringify(q.label)} is not an offered option`);
    if (q.target !== undefined && q.target !== null) {
      const t = q.target;
      if (typeof t !== 'object' || Array.isArray(t) || !Object.keys(t).length || Object.keys(t).some(k => !opts.includes(k) || !(t[k] >= 0)) || !(Object.values(t).reduce((a, b) => a + b, 0) > 0)) err('CONTRACT', `${qid}: target must weigh offered options only, with a positive sum`);
    }
    if (unknowable.includes(qid)) {
      if (softTargetPort(c)) { if (slice === TRAIN_SLICE && (q.target === undefined || q.target === null)) err('CONTRACT', `${qid}: a training unknowable of ${port} needs a soft target`); }
      else if (c.unknowable === 'label:not_stated') { if (q.label !== 'not_stated') err('CONTRACT', `${qid}: an unknowable of ${port} is labelled not_stated`); }
      else err('CONTRACT', `${qid}: ${port} has no unknowable variant (${c.unknowable})`);
    }
    // wording (rule 3): Q0-Q3 in train, calib-in, dev-select, test-in and the reserves; in an OOD slice the
    // slice's own held-out wordings for a port that has them (a paraphrase record may add Q0, §3.2), Q0-Q3
    // for a port that has none
    const heldout = OOD_SLICES.includes(slice) && !qc.companion && (c.heldoutWordings?.[slice] ?? 0) > 0;
    let templates = ['Q0', 'Q1', 'Q2', 'Q3'].filter(w => c.wordings[w]).map(w => [w, c.wordings[w]]);
    if (heldout) templates = [...(meta.variant === 'paraphrase' ? [['Q0', c.wordings.Q0]] : []), ...(wordings?.forSlice(port, slice) ?? []).map(w => [w.id, w.text])];
    if (!heldout || wordings) {
      const m = matchWording(q.instructions, templates, c, opts, q.criteria);
      if (!m.id) err(m.slotMiss ? 'SLOT' : 'WORDING', m.slotMiss ? `${qid}: a slot of ${port} is filled with a value outside the contract's slot values (or over its maxChars)`
        : `${qid}: instructions are not a rendering of ${heldout ? `a ${slice} held-out wording` : 'Q0-Q3'} of ${port} through toSystemOneQuestion`);
    }
    if (wordings) for (const leak of wordings.check(q.instructions, slice)) err('WORDING', `${qid}: held-out wording ${leak.port}/${leak.id} of ${leak.slice} in ${slice}`);
  }
  // span-skeleton registry (rule 7): train, calib-in, dev-select against every entry; OOD slices against
  // the others. The registry's own masks (default: the frozen contracts' system names) apply, plus the
  // record's meta.masks (its world's names and markers).
  if (registry) {
    const masks = meta.masks ?? {};
    for (const h of registry.scanState(state, { names: masks.names ?? [], markers: masks.markers ?? [], slice })) err('SPAN_LEAK', `${h.path}: "${h.sentence.slice(0, 80)}" matches a registered ${h.entry.slice} span (${h.entry.source ?? h.entry.kind})`);
  }
  // hashes and pin
  let sh = null;
  try { sh = stateHash(state); } catch (e) { err('STATE', e.message); }
  if (meta.stateHash !== undefined && meta.stateHash !== sh) err('META', 'meta.stateHash does not match the state');
  meta.stateHash = sh;
  if (pin) { if (meta.bedPin !== undefined && meta.bedPin !== pin) err('META', `meta.bedPin ${meta.bedPin} != the build's frozen pin ${pin}`); meta.bedPin = pin; }
  return { record: { state, questions, meta }, errors };
}

// Imports that resolve into the live beds/ tree are refused (§2.1 bed internals: beds are read only
// through the frozen copy), twice over:
//   statically  liveBedImports follows every relative, absolute and file: import of a generator file
//               (and of the files an object generator lists in `files`) transitively, so a port kit or
//               helper that imports a live bed is refused even when it was imported before the build
//               (a module already in the ESM cache is never resolved again);
//   at runtime  a resolve hook refuses any new resolution into the live tree while generators load and
//               run (computed specifiers, import() of a built path).
// Neither sees a module that an object generator without `files` reached before the build: such a
// generator is recorded in the manifest as `scan: 'runtime'`. The CLI takes generator files only.
const IMPORT_RE = /^\s*(?:import|export)\s[^;'"]*?\bfrom\s*['"]([^'"]+)['"]|^\s*import\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/gm;
export function liveBedImports(file, liveBedsDir, { seen = new Set() } = {}) {
  const out = [], inLive = abs => abs === liveBedsDir.slice(0, -1) || abs.startsWith(liveBedsDir);
  const visit = (f, chain) => {
    if (seen.has(f)) return;
    seen.add(f);
    let src;
    try { src = readFileSync(f, 'utf8'); } catch { return; }
    for (const m of src.matchAll(IMPORT_RE)) {
      const spec = m[1] ?? m[2] ?? m[3];
      if (!spec.startsWith('.') && !spec.startsWith('/') && !spec.startsWith('file:')) continue;   // builtins and packages
      let abs;
      try { abs = spec.startsWith('file:') ? fileURLToPath(spec) : path.resolve(path.dirname(f), spec); } catch { continue; }
      if (inLive(abs)) { out.push(chain.length ? `${spec} (via ${[...chain, f].map(x => path.basename(x)).join(' -> ')})` : spec); continue; }
      if (/\.(?:mjs|js|cjs)$/.test(abs)) visit(abs, [...chain, f]);
    }
  };
  visit(path.resolve(file), []);
  return out;
}
function guardLiveBeds(liveBedsDir, violations) {
  return registerHooks({
    resolve(specifier, context, next) {
      const r = next(specifier, context);
      if (r?.url?.startsWith('file:')) {
        const p = fileURLToPath(r.url);
        if (p.startsWith(liveBedsDir)) { violations.push(p); throw fail('LIVE_BED_IMPORT', `${specifier} resolves into the live beds tree (${p}); import beds through ctx.beds (the frozen copy)`); }
      }
      return r;
    },
  });
}

async function loadGenerator(g) {
  if (typeof g === 'string') {
    const file = path.resolve(g);
    const mod = await import(pathToFileURL(file).href);
    return { group: mod.group, ports: mod.ports ?? [], records: mod.records, source: `sha256:${sha256(readFileSync(file))}`, file, scan: 'static+runtime' };
  }
  if (g && typeof g.records === 'function') {
    const files = (g.files ?? []).map(f => path.resolve(f));
    return { group: g.group, ports: g.ports ?? [], records: g.records, source: `sha256:${sha256(String(g.records))}`, file: null, files, scan: files.length ? 'static+runtime' : 'runtime' };
  }
  throw fail('GENERATOR', 'a generator is a module path or an object with records()');
}

const statsOf = xs => xs.length ? { n: xs.length, p50: quantile(xs, 0.5), p90: quantile(xs, 0.9), max: Math.max(...xs) } : { n: 0 };

// Build. Fails on any record error (never a silent drop); drops only exact duplicates, states and worlds
// claimed by an earlier slice, and Kev misfits (at the bridge maxState, then at the job maxState), and
// counts every drop.
//   wordings  WordingGuard of every held-out wording (required: every file is wording-checked)
//   registry  SpanRegistry of every held-out span (required for train, calib-in, dev-select and the OOD
//             slices; its masks must include the frozen contracts' system names)
//   An empty guard or registry is allowed (the manifest records n: 0); a missing one is refused.
export async function buildKev({
  root = REPO_ROOT, outRoot = path.join(root, '.foundry', 'kev-data'), generators = [], slices = ['train'], seeds = {}, opts = {},
  spec = loadSpec(), wordings = null, registry = null, measure = measureForJob, maxState = KEV_MAX_STATE.bridge, expectPin = null,
  enforcePositions = true, heldoutDir = null, poolsDir = null, log = () => {},
} = {}) {
  const t0 = Date.now(), timing = { generate: {}, measureMs: null, writeMs: null };
  for (const s of slices) sliceDef(s);
  const contracts = spec.contracts, variants = spec.spec.conventions.variants;
  if (!(wordings instanceof WordingGuard)) throw fail('HELDOUT_REQUIRED', 'a build needs the held-out wordings (a WordingGuard; heldout/wordings.jsonl) to wording-check every file (§2.3 rule 3)');
  if (slices.some(s => REGISTRY_SLICES.includes(s))) {
    if (!(registry instanceof SpanRegistry)) throw fail('HELDOUT_REQUIRED', `${slices.filter(s => REGISTRY_SLICES.includes(s)).join(', ')} need the span-skeleton registry (a SpanRegistry; heldout/registry.json) (§2.3 rule 7)`);
    const need = contractMasks(contracts);
    if (!coversMasks(registry.masks, need)) throw fail('REGISTRY_MASKS', `the span registry's masks must include the contracts' names (${need.names.join(', ')}): entries and states would be masked differently`);
  }
  const frozen = freezeBeds(root, { outRoot, expectPin });
  checkDriftRecord(path.resolve(root), frozen);
  const beds = frozenBeds(frozen), liveBedsDir = path.join(path.resolve(root), 'beds') + path.sep;
  const violations = [], hooks = guardLiveBeds(liveBedsDir, violations);
  const out = new Map(), drops = {}, claimed = new Map(), worldOwner = new Map(), errors = [];
  const drop = (slice, reason, port = '*') => { const d = (drops[slice] ??= {}); d[reason] = d[reason] ?? {}; d[reason][port] = (d[reason][port] ?? 0) + 1; };
  let gens;
  try {
    gens = [];
    for (const g of generators) {
      const files = typeof g === 'string' ? [path.resolve(g)] : (g?.files ?? []).map(f => path.resolve(f));
      for (const f of files) { const bad = liveBedImports(f, liveBedsDir); if (bad.length) throw fail('LIVE_BED_IMPORT', `${f} imports the live beds tree: ${bad.join(', ')}`); }
      const lg = await loadGenerator(g);
      if (typeof lg.group !== 'string' || !lg.group || typeof lg.records !== 'function') throw fail('GENERATOR', 'a generator exports group and records()');
      gens.push(lg);
    }
    gens.sort((a, b) => (a.group < b.group ? -1 : a.group > b.group ? 1 : 0));
    if (new Set(gens.map(g => g.group)).size !== gens.length) throw fail('GENERATOR', 'two generators share a group name');
    for (const slice of SLICE_PRIORITY.filter(s => slices.includes(s))) {
      const list = seedsFor(slice, seeds[slice]), recs = [], seen = new Set(), asked = new Set();
      for (const g of gens) {
        const tg = Date.now();
        const ctx = Object.freeze({ beds, pin: frozen.pin, spec: spec.spec, contracts, slice: sliceDef(slice), heldoutDir, poolsDir });
        for await (const r of g.records(slice, list, structuredClone(opts), ctx)) {
          const { record, errors: es } = checkRecord(r, { slice, contracts, variants, pin: frozen.pin, wordings, registry });
          if (es.length) { errors.push(...es.map(e => ({ ...e, slice, group: g.group }))); if (errors.length >= 50) break; continue; }
          record.meta.group = g.group;
          const ports = record.meta.ports.join('+');
          const key = sha256(canonical({ state: record.state, questions: record.questions }));
          if (seen.has(key)) { drop(slice, 'duplicate', ports); continue; }
          // rule 7: stateHash dedups exact states across all slices; worldHash dedups worlds (two seeds or
          // splits that render the same task are one world, kept by the slice that claimed it first)
          const prior = claimed.get(record.meta.stateHash);
          if (prior && prior !== slice) { drop(slice, `state-in-${prior}`, ports); continue; }
          const wh = record.meta.world ? record.meta.worldHash : null, wo = wh ? worldOwner.get(wh) : null;
          if (wo && (wo.slice !== slice || wo.world !== record.meta.world)) { drop(slice, wo.slice !== slice ? `world-in-${wo.slice}` : 'world-duplicate', ports); continue; }
          // test slices: the per-port question limit holds across records on one state too (rule 5)
          if (TEST_SLICES.includes(slice) && record.meta.variant !== 'paraphrase' && (record.meta.pairId === undefined || record.meta.pairId === null)) {
            const keys = Object.keys(record.questions).map(q => { const qc = questionContract(q, contracts); return `${record.meta.stateHash}|${qc?.reportId}${recordQuestionsOf(qc?.contract) > 1 ? `|${q}` : ''}`; });
            const dup = keys.find(k => asked.has(k));
            if (dup) { errors.push({ code: 'QUESTION_LIMIT', message: `a second ${dup.split('|')[1]} question on one state in ${slice}`, slice, group: g.group }); continue; }
            for (const k of keys) asked.add(k);
          }
          seen.add(key); claimed.set(record.meta.stateHash, slice); if (wh && !wo) worldOwner.set(wh, { slice, world: record.meta.world });
          recs.push(record);
        }
        timing.generate[`${slice}/${g.group}`] = Date.now() - tg;
        if (errors.length >= 50) break;
      }
      out.set(slice, recs);
      if (errors.length) break;
    }
  } finally { hooks.deregister(); }
  if (violations.length) throw fail('LIVE_BED_IMPORT', `generators resolved ${violations.length} module(s) in the live beds tree`, violations);
  if (errors.length) throw fail(errors[0].code, `${errors.length} record error(s); first: [${errors[0].slice}/${errors[0].group}] ${errors[0].message}`, errors);

  // bed-derived option sets and tag tables of the ports this build asks, at the build's pin (fail closed)
  const all = [...out.values()].flat();
  const derived = [...new Set(all.flatMap(r => r.meta.ports))].filter(p => BED_DERIVED[p]).sort();
  if (derived.length) {
    const es = await checkBedDerived(contracts, beds, derived);
    if (es.length) throw fail('BED_CONTRACT_DRIFT', `${es.length} bed-derived contract part(s) differ from the frozen beds at ${frozen.pin}: ${es[0]}`, es);
  }

  // Kev's own fits() (rule 6) at the bridge maxState, then at the job maxState (the admitted records'
  // p99.9, clamped to [384, maxState]); a record that misfits either is dropped and counted, so every
  // written record fits the job and Kev drops none. measure(records, {maxState}) returns the results at
  // maxState (and is then called again at the job maxState), or { results, job: { maxState, results } }
  // with both passes (lib/tokens.mjs measureForJob: one Python process).
  let job = null;
  if (measure) {
    const tm = Date.now(), plain = rs => rs.map(r => ({ state: r.state, questions: r.questions }));
    const m = all.length ? measure(plain(all), { maxState }) : [];
    const measured = Array.isArray(m) ? m : m.results, pass = Array.isArray(m) ? null : m.job;
    if (measured.length !== all.length) throw fail('MEASURE', 'the measure call returned a different number of results');
    all.forEach((r, i) => { r.tokens = measured[i]; });
    const fit = all.filter(r => r.tokens.fits);
    if (fit.length) {
      job = Math.min(maxState, jobMaxState(fit.map(r => r.tokens.stateTokens)));
      if (pass && pass.maxState !== job) throw fail('MEASURE', `the measure call fitted the job at maxState ${pass.maxState}; the build's p99.9 is ${job}`);
      if (job < maxState) {
        const again = pass ? pass.results : measure(plain(fit), { maxState: job });
        if (!Array.isArray(again) || again.length !== fit.length) throw fail('MEASURE', 'the job-maxState pass returned a different number of results');
        fit.forEach((r, i) => { r.jobTokens = again[i]; });
      }
    }
    timing.measureMs = Date.now() - tm;
  }
  // write
  const buildId = `kd-${sha256(canonical({ factory: FACTORY_VERSION, spec: spec.hash, pin: frozen.pin, generators: gens.map(g => ({ group: g.group, source: g.source })),
    slices: [...slices].sort(), seeds, opts, maxState, measured: Boolean(measure), wordings: wordings.digest, registry: registry?.digest ?? null })).slice(0, 16)}`;
  const dir = path.join(outRoot, buildId), tw = Date.now();
  rmSync(dir, { recursive: true, force: true }); mkdirSync(path.join(dir, 'kev'), { recursive: true });
  // Deterministic: no clock, no HEAD commit (an unrelated commit must not change the manifest of the
  // same build); the commit the beds were read at goes to timing.json.
  const manifest = {
    schema: 'kev-data/build@1', buildId, factoryVersion: FACTORY_VERSION, spec: { file: path.relative(KEV_DATA_DIR, spec.file), hash: spec.hash },
    beds: { pin: frozen.pin, versions: frozen.versions, diffHash: frozen.diffHash, clean: frozen.clean, allowlist: frozen.allowlist },
    kev: { commit: KEV.commit, tokenizer: `${TOKENIZER.repo}@${TOKENIZER.revision}` },
    generators: gens.map(g => ({ group: g.group, ports: g.ports, source: g.source, file: g.file ? path.relative(path.resolve(root), g.file) : null, scan: g.scan })),
    config: { slices: [...slices].sort(), seeds, opts, maxState, measured: Boolean(measure), enforcePositions, positionMinN: POSITION_MIN_N,
      heldoutWordings: { n: wordings.size, digest: wordings.digest }, registry: registry ? { n: registry.size, digest: registry.digest, masks: registry.masks } : null },
    slices: {}, jobMaxState: job,
  };
  for (const slice of SLICE_IDS.filter(s => out.has(s))) {
    const recs = [];
    for (const r of out.get(slice)) {
      if (r.tokens && !r.tokens.fits) { drop(slice, 'misfit', r.meta.ports.join('+')); continue; }
      if (r.tokens && job !== null && (r.tokens.stateTokens > job || (r.jobTokens && !r.jobTokens.fits))) { drop(slice, 'misfit-job-max-state', r.meta.ports.join('+')); continue; }
      recs.push(r);
    }
    const perPort = {}, tokensByPort = {};
    for (const r of recs) {
      for (const [qid, q] of Object.entries(r.questions)) {
        const p = questionContract(qid, contracts)?.reportId ?? portOfQuestionId(qid), s = (perPort[p] ??= { questions: 0, records: 0, labels: {} });
        s.questions++; s.labels[q.label] = (s.labels[q.label] ?? 0) + 1;
      }
      for (const p of r.meta.ports) { (perPort[p] ??= { questions: 0, records: 0, labels: {} }).records++; if (r.tokens) (tokensByPort[p] ??= []).push(r.tokens.stateTokens); }
    }
    for (const [p, s] of Object.entries(perPort)) { s.labels = Object.fromEntries(Object.entries(s.labels).sort()); s.stateTokens = statsOf(tokensByPort[p] ?? []); }
    const positions = positionHistogram(recs.flatMap(r => Object.values(r.questions)));
    const posAll = checkPositionUniform(positions), posGate = checkPositionUniform(positions, { minPerK: POSITION_MIN_N });
    const gated = Object.entries(positions).filter(([, row]) => row.reduce((a, b) => a + b, 0) >= POSITION_MIN_N).map(([k]) => Number(k));
    if (enforcePositions && slice !== TRAIN_SLICE && !posGate.ok) throw fail('POSITION', `${slice}: label positions are not within ±5 pp of uniform (option counts with >= ${POSITION_MIN_N} questions)`, posGate.problems);
    const file = path.join(dir, 'kev', `${slice}.jsonl`);
    const ex = exportKev(recs.map(r => ({ state: r.state, questions: r.questions, meta: r.meta })), { file, contracts, slice, guard: wordings });
    const def = sliceDef(slice), list = seedsFor(slice, seeds[slice]);
    manifest.slices[slice] = { bedSplit: def.bedSplit, seedRange: def.seeds, seeds: { n: list.length, first: list[0] ?? null, last: list.at(-1) ?? null },
      records: recs.length, questions: recs.reduce((s, r) => s + Object.keys(r.questions).length, 0), worlds: new Set(recs.flatMap(r => r.meta.worldKeys)).size,
      perPort, positions, positionCheck: { all: posAll.ok ? 'ok' : posAll.problems.length, gatedOptionCounts: gated, gate: slice === TRAIN_SLICE ? 'not applied (train)' : posGate.ok ? 'ok' : posGate.problems.length },
      dropped: drops[slice] ?? {}, unknowable: ex.unknowable,
      files: { kev: { path: `kev/${slice}.jsonl`, sha256: ex.sha256 }, meta: { path: `kev/${slice}.meta.jsonl`, sha256: ex.metaSha256 } } };
  }
  writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  timing.writeMs = Date.now() - tw; timing.totalMs = Date.now() - t0; timing.bedsCommit = frozen.commit;
  writeFileSync(path.join(dir, 'timing.json'), JSON.stringify(timing, null, 2) + '\n');
  const v = verifyBuildDir(dir, { spec });
  if (!v.ok) throw fail(v.errors[0].code, `the written build fails verification: ${v.errors[0].message}`, v.errors);
  log(`kev-data build ${buildId}: ${Object.entries(manifest.slices).map(([s, x]) => `${s} ${x.records}`).join(', ')} (${timing.totalMs} ms)`);
  return { buildId, dir, manifest, timing, frozen };
}

// Re-check a written build: file digests, ids and sidecars, the record checks (forbidden keys, reserved
// worlds and seed ranges, families, wordings outside OOD slices, unknowables), no stateHash shared
// between slices and no world (worldHash) under two world keys or slices (§10 global acceptance 2-3).
export function verifyBuildDir(dir, { spec = loadSpec() } = {}) {
  const errors = [], err = (code, m) => errors.push({ code, message: m });
  const manifest = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const owner = new Map(), worlds = new Map();
  for (const [slice, info] of Object.entries(manifest.slices)) {
    let recs;
    try {
      for (const k of ['kev', 'meta']) if (fileDigest(path.join(dir, info.files[k].path)) !== info.files[k].sha256) err('DIGEST', `${info.files[k].path} does not match the manifest`);
      recs = readKevFile(path.join(dir, info.files.kev.path));
    } catch (e) { err(e.code ?? 'READ', e.message); continue; }
    if (recs.length !== info.records) err('COUNT', `${slice}: ${recs.length} records, manifest says ${info.records}`);
    for (const r of recs) {
      const { errors: es } = checkRecord({ state: r.state, questions: r.questions, meta: r.meta }, { slice, contracts: spec.contracts, variants: spec.spec.conventions.variants, pin: manifest.beds.pin });
      // OOD wordings are checked at build time against the held-out guard, which a verifier does not hold
      for (const e of es.filter(x => x.code !== 'WORDING' || !OOD_SLICES.includes(slice))) err(e.code, `${slice} ${r.id}: ${e.message}`);
      const sh = r.meta.stateHash, o = owner.get(sh);
      if (o && o !== slice) err('STATE_OVERLAP', `${slice} ${r.id}: its state is also in ${o}`);
      else owner.set(sh, slice);
      if (r.meta.world && r.meta.worldHash) {
        const w = worlds.get(r.meta.worldHash);
        if (w && (w.slice !== slice || w.world !== r.meta.world)) err('WORLD_OVERLAP', `${slice} ${r.id}: world ${r.meta.world} renders the same task as ${w.world} in ${w.slice}`);
        else if (!w) worlds.set(r.meta.worldHash, { slice, world: r.meta.world });
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

// Held-out material for a CLI build: <heldoutDir>/wordings.jsonl ({port, id, slice, text} per line)
// and <heldoutDir>/registry.json (SpanRegistry#toJSON, with its masks). Both are required (a missing
// file is refused, never read as "no held-out material"); an empty file is an explicit empty set, and
// the manifest records n and the digest of each.
export function loadHeldout(heldoutDir) {
  if (!heldoutDir) throw fail('HELDOUT_MISSING', 'no held-out directory');
  const wf = path.join(heldoutDir, 'wordings.jsonl'), rf = path.join(heldoutDir, 'registry.json');
  const missing = [wf, rf].filter(f => !existsSync(f));
  if (missing.length) throw fail('HELDOUT_MISSING', `held-out material not found: ${missing.join(', ')} (written by the heldout-author group; for a development build without it, write an empty wordings.jsonl and {"version": 1, "masks": <lib/leakage.mjs defaultMasks()>, "entries": []})`);
  const wordings = new WordingGuard(readFileSync(wf, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)));
  const registry = SpanRegistry.fromJSON(JSON.parse(readFileSync(rf, 'utf8')));
  return { wordings, registry };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [flag, arg] = process.argv.slice(2);
  if (flag === '--slices') console.table([RESERVED, ...SLICES].map(s => ({ slice: s.id, bedSplit: s.bedSplit, seeds: s.seeds.join('-'), kind: s.kind ?? 'reserved', wordings: s.wordings ?? '-', use: s.use })));
  else if (flag === '--verify' && arg) { const v = verifyBuildDir(path.resolve(arg)); console.log(JSON.stringify(v, null, 2)); process.exitCode = v.ok ? 0 : 1; }
  else if (flag === '--config' && arg) {
    const cfgFile = path.resolve(arg), cfg = JSON.parse(readFileSync(cfgFile, 'utf8')), base = path.dirname(cfgFile);
    const heldoutDir = cfg.heldoutDir ? path.resolve(base, cfg.heldoutDir) : path.join(REPO_ROOT, '.foundry', 'kev-data', 'heldout');
    const { wordings, registry } = loadHeldout(heldoutDir);
    const r = await buildKev({ ...cfg, generators: (cfg.generators ?? []).map(g => path.resolve(base, g)), wordings, registry,
      heldoutDir, poolsDir: cfg.poolsDir ? path.resolve(base, cfg.poolsDir) : null, log: m => console.error(m) });
    console.log(JSON.stringify({ buildId: r.buildId, dir: r.dir, slices: Object.fromEntries(Object.entries(r.manifest.slices).map(([s, x]) => [s, { records: x.records, dropped: x.dropped }])), timing: r.timing }, null, 2));
  } else { console.error('usage: node experiments/kev-data/build.mjs --slices | --config <file.json> | --verify <build dir>'); process.exitCode = 2; }
}
