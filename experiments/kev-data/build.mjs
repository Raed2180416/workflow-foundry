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
//            handle (lib/pin.mjs frozenBeds); beds are imported through it and never live.
//   Pure: the same (slice, seeds, opts, factory version, bed pin) gives the same records in the same
//   order. No Math.random, no clock, no network.
//
// Build outputs (git-ignored): <outRoot>/<buildId>/
//   kev/<slice>.jsonl + kev/<slice>.meta.jsonl   Kev files and meta sidecars (export-kev.mjs)
//   manifest.json                                 counts, hashes, pins, drops, token stats (deterministic)
//   timing.json                                   generation time (the only non-deterministic file)
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
import { loadSpec, REPO_ROOT } from './lib/contracts.mjs';
import { canonical, sha256, stateHash } from './lib/hash.mjs';
import { contractOptions, normalizeWs, portOfQuestionId, questionContract, questionOf, wordingPattern } from './lib/render.mjs';
import { OOD_SLICES, SpanRegistry, TRAIN_LIKE, WordingGuard } from './lib/leakage.mjs';
import { parseWorldKey, reservationOf, reservedViolation, worldKey } from './lib/registry.mjs';
import { checkPositionUniform, positionHistogram } from './lib/balance.mjs';
import { freezeBeds, frozenBeds } from './lib/pin.mjs';
import { KEV, KEV_MAX_STATE, TOKENIZER, jobMaxState, measureRecords, quantile } from './lib/tokens.mjs';
import { exportKev, fileDigest, readKevFile, softTargetPort } from './export-kev.mjs';

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
export const MAX_QUESTIONS = 6;

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

// Does `instructions` render one of `templates` (any slot filling) through toSystemOneQuestion with
// the contract's criteria? Returns the matching wording id or null.
function matchWording(instructions, templates, contract, options, descriptions) {
  const q = questionOf(instructions), norm = normalizeWs(q);
  for (const [id, text] of templates) {
    if (!wordingPattern(text).test(norm)) continue;
    const direct = toSystemOneQuestion({ question: q, criteria: contract.criteria ?? [], options, optionDescriptions: descriptions });
    if (direct.instructions === instructions) return id;
  }
  return null;
}

// The checks every record must pass before it reaches a file (§2.2, §2.3 rules 1-3, 5, 7, 8; §3.1).
// Returns { record (normalised: meta.split, ports, bed pin, state hash, worlds, reserved), errors }.
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
  for (const k of ['seed', 'difficulty']) if (meta[k] !== undefined && meta[k] !== null && !Number.isInteger(meta[k])) err('META', `meta.${k} must be an integer or null`);
  // worlds: the record's own world (bed, the slice's bed split, difficulty, seed) plus meta.worlds
  const worlds = [];
  if (meta.bed && meta.seed !== undefined && meta.seed !== null) {
    if (!Number.isInteger(meta.difficulty)) err('META', 'a bed record needs meta.difficulty');
    else worlds.push(worldKey({ bed: meta.bed, split: def.bedSplit, difficulty: meta.difficulty, seed: meta.seed }));
  }
  for (const w of meta.worlds ?? []) { try { parseWorldKey(w); worlds.push(w); } catch (e) { err('META', e.message); } }
  const reservedHits = worlds.map(w => reservedViolation(w, slice)).filter(Boolean);
  for (const v of reservedHits) err('RESERVED_WORLD', `${v.world} is reserved (${v.reservation}) and may not enter ${slice}`);
  if (!reservedHits.length) {
    const [lo, hi] = def.seeds;
    if (meta.seed !== undefined && meta.seed !== null && (meta.seed < lo || meta.seed > hi)) err('SEED_RANGE', `seed ${meta.seed} is outside ${slice} (${lo}-${hi})`);
    for (const w of worlds) { const p = parseWorldKey(w); if (p.split !== def.bedSplit || p.seed < lo || p.seed > hi) err('SEED_RANGE', `world ${w} is outside ${slice} (${def.bedSplit} ${lo}-${hi})`); }
    if (def.difficulties && worlds.some(w => !def.difficulties.includes(parseWorldKey(w).difficulty))) err('SEED_RANGE', `${slice} takes difficulties ${def.difficulties.join(', ')}`);
  }
  meta.worldKeys = worlds;
  meta.reserved = worlds.some(w => reservationOf(w) !== null);
  // questions
  const qids = questions && typeof questions === 'object' ? Object.keys(questions) : [];
  if (!qids.length) err('RECORD', 'a record needs at least one question');
  const resolved = Object.fromEntries(qids.map(q => [q, questionContract(q, contracts)]));
  const ports = [...new Set(qids.map(q => resolved[q]?.port ?? portOfQuestionId(q)))].sort();
  if (meta.ports !== undefined && !sameSet(meta.ports, ports)) err('META', `meta.ports ${JSON.stringify(meta.ports)} != question ports ${JSON.stringify(ports)}`);
  meta.ports = ports;
  const asked = qids.map(q => resolved[q]?.reportId ?? portOfQuestionId(q));
  if (def.kind === 'reserve' || TEST_SLICES.includes(slice)) {
    if (new Set(asked).size !== asked.length && meta.variant !== 'paraphrase' && (meta.pairId === undefined || meta.pairId === null)) err('QUESTION_LIMIT', `${slice} records carry at most one question per port (except paraphrase and pair records)`);
  } else if (qids.length > MAX_QUESTIONS) err('QUESTION_LIMIT', `${qids.length} questions (at most ${MAX_QUESTIONS})`);
  const ood = OOD_SLICES.includes(slice);
  if (ood && !wordings) err('WORDING', `${slice} needs the held-out wordings (WordingGuard) to check its questions`);
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
    if (meta.variant === 'unknowable' && softTargetPort(c) && slice === 'train' && (q.target === undefined || q.target === null)) err('CONTRACT', `${qid}: a training unknowable of ${port} needs a soft target`);
    // wording (rule 3)
    const templates = ood ? (wordings?.forSlice(port, slice) ?? []).map(w => [w.id, w.text]) : ['Q0', 'Q1', 'Q2', 'Q3'].filter(w => c.wordings[w]).map(w => [w, c.wordings[w]]);
    if (!ood || wordings) {
      const id = matchWording(q.instructions, templates, c, opts, q.criteria);
      if (!id) err('WORDING', `${qid}: instructions are not a rendering of ${ood ? `a ${slice} held-out wording` : 'Q0-Q3'} of ${port} through toSystemOneQuestion`);
    }
    if (wordings) for (const leak of wordings.check(q.instructions, slice)) err('WORDING', `${qid}: held-out wording ${leak.port}/${leak.id} of ${leak.slice} in ${slice}`);
  }
  // span-skeleton registry (rule 7): train, calib-in, dev-select against every entry; OOD slices against the others
  if (registry) for (const h of registry.scanState(state, { ...(meta.masks ?? {}), slice })) err('SPAN_LEAK', `${h.path}: "${h.sentence.slice(0, 80)}" matches a registered ${h.entry.slice} span (${h.entry.source ?? h.entry.kind})`);
  // hashes and pin
  let sh = null;
  try { sh = stateHash(state); } catch (e) { err('STATE', e.message); }
  if (meta.stateHash !== undefined && meta.stateHash !== sh) err('META', 'meta.stateHash does not match the state');
  meta.stateHash = sh;
  if (pin) { if (meta.bedPin !== undefined && meta.bedPin !== pin) err('META', `meta.bedPin ${meta.bedPin} != the build's frozen pin ${pin}`); meta.bedPin = pin; }
  return { record: { state, questions, meta }, errors };
}

// Imports that resolve into the live beds/ tree are refused while generators load and run: beds are
// read only through the frozen copy (§2.1 bed internals).
const IMPORT_RE = /^\s*(?:import|export)\s[^;'"]*?\bfrom\s*['"]([^'"]+)['"]|^\s*import\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/gm;
export function liveBedImports(file, liveBedsDir) {
  const src = readFileSync(file, 'utf8'), out = [];
  for (const m of src.matchAll(IMPORT_RE)) {
    const spec = m[1] ?? m[2] ?? m[3];
    if (!spec.startsWith('.') && !spec.startsWith('/') && !spec.startsWith('file:')) continue;
    const abs = spec.startsWith('file:') ? fileURLToPath(spec) : path.resolve(path.dirname(file), spec);
    if (abs === liveBedsDir.slice(0, -1) || abs.startsWith(liveBedsDir)) out.push(spec);
  }
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
    return { group: mod.group, ports: mod.ports ?? [], records: mod.records, source: `sha256:${sha256(readFileSync(file))}`, file };
  }
  if (g && typeof g.records === 'function') return { group: g.group, ports: g.ports ?? [], records: g.records, source: `sha256:${sha256(String(g.records))}`, file: null };
  throw fail('GENERATOR', 'a generator is a module path or an object with records()');
}

const statsOf = xs => xs.length ? { n: xs.length, p50: quantile(xs, 0.5), p90: quantile(xs, 0.9), max: Math.max(...xs) } : { n: 0 };

// Build. Fails on any record error (never a silent drop); drops only exact duplicates and Kev misfits,
// and counts both.
export async function buildKev({
  root = REPO_ROOT, outRoot = path.join(root, '.foundry', 'kev-data'), generators = [], slices = ['train'], seeds = {}, opts = {},
  spec = loadSpec(), wordings = null, registry = null, measure = measureRecords, maxState = KEV_MAX_STATE.bridge, expectPin = null,
  enforcePositions = false, heldoutDir = null, poolsDir = null, log = () => {},
} = {}) {
  const t0 = Date.now(), timing = { generate: {}, measureMs: null, writeMs: null };
  for (const s of slices) sliceDef(s);
  const frozen = freezeBeds(root, { outRoot, expectPin });
  const beds = frozenBeds(frozen), liveBedsDir = path.join(path.resolve(root), 'beds') + path.sep;
  const contracts = spec.contracts, variants = spec.spec.conventions.variants;
  const violations = [], hooks = guardLiveBeds(liveBedsDir, violations);
  const out = new Map(), drops = {}, claimed = new Map(), errors = [];
  const drop = (slice, reason, port = '*') => { const d = (drops[slice] ??= {}); d[reason] = d[reason] ?? {}; d[reason][port] = (d[reason][port] ?? 0) + 1; };
  let gens;
  try {
    gens = [];
    for (const g of generators) {
      if (typeof g === 'string') { const bad = liveBedImports(path.resolve(g), liveBedsDir); if (bad.length) throw fail('LIVE_BED_IMPORT', `${g} imports the live beds tree: ${bad.join(', ')}`); }
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
          const key = sha256(canonical({ state: record.state, questions: record.questions }));
          if (seen.has(key)) { drop(slice, 'duplicate', record.meta.ports.join('+')); continue; }
          const prior = claimed.get(record.meta.stateHash);
          if (prior && prior !== slice) { drop(slice, `state-in-${prior}`, record.meta.ports.join('+')); continue; }
          // test slices: at most one question per port per state, across records too (rule 5)
          if (TEST_SLICES.includes(slice) && record.meta.variant !== 'paraphrase' && (record.meta.pairId === undefined || record.meta.pairId === null)) {
            const dup = Object.keys(record.questions).map(q => `${record.meta.stateHash}|${questionContract(q, contracts)?.reportId}`).find(k => asked.has(k));
            if (dup) { errors.push({ code: 'QUESTION_LIMIT', message: `a second ${dup.split('|')[1]} question on one state in ${slice}`, slice, group: g.group }); continue; }
            for (const q of Object.keys(record.questions)) asked.add(`${record.meta.stateHash}|${questionContract(q, contracts)?.reportId}`);
          }
          seen.add(key); claimed.set(record.meta.stateHash, slice); recs.push(record);
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

  // Kev's own fits() at maxState (rule 6), one Python process for the whole build.
  const all = [...out.values()].flat();
  let measured = null;
  if (measure) {
    const tm = Date.now();
    measured = all.length ? measure(all.map(r => ({ state: r.state, questions: r.questions })), { maxState }) : [];
    timing.measureMs = Date.now() - tm;
    if (measured.length !== all.length) throw fail('MEASURE', 'the measure call returned a different number of results');
    all.forEach((r, i) => { r.tokens = measured[i]; });
  }
  // write
  const buildId = `kd-${sha256(canonical({ factory: FACTORY_VERSION, spec: spec.hash, pin: frozen.pin, generators: gens.map(g => ({ group: g.group, source: g.source })),
    slices: [...slices].sort(), seeds, opts, maxState, measured: Boolean(measure), wordings: wordings?.digest ?? null, registry: registry?.digest ?? null })).slice(0, 16)}`;
  const dir = path.join(outRoot, buildId), tw = Date.now();
  rmSync(dir, { recursive: true, force: true }); mkdirSync(path.join(dir, 'kev'), { recursive: true });
  const manifest = {
    schema: 'kev-data/build@1', buildId, factoryVersion: FACTORY_VERSION, spec: { file: path.relative(KEV_DATA_DIR, spec.file), hash: spec.hash },
    beds: { pin: frozen.pin, commit: frozen.commit, versions: frozen.versions, diffHash: frozen.diffHash, clean: frozen.clean, allowlist: frozen.allowlist },
    kev: { commit: KEV.commit, tokenizer: `${TOKENIZER.repo}@${TOKENIZER.revision}` },
    generators: gens.map(g => ({ group: g.group, ports: g.ports, source: g.source, file: g.file ? path.relative(path.resolve(root), g.file) : null })),
    config: { slices: [...slices].sort(), seeds, opts, maxState, measured: Boolean(measure),
      heldoutWordings: wordings ? { n: wordings.size, digest: wordings.digest } : null, registry: registry ? { n: registry.size, digest: registry.digest } : null },
    slices: {}, jobMaxState: null,
  };
  const stateTokensAll = [];
  for (const slice of SLICE_IDS.filter(s => out.has(s))) {
    const recs = [];
    for (const r of out.get(slice)) {
      if (r.tokens && !r.tokens.fits) { drop(slice, 'misfit', r.meta.ports.join('+')); continue; }
      recs.push(r);
    }
    const perPort = {}, tokensByPort = {};
    for (const r of recs) {
      if (r.tokens) stateTokensAll.push(r.tokens.stateTokens);
      for (const [qid, q] of Object.entries(r.questions)) {
        const p = questionContract(qid, contracts)?.reportId ?? portOfQuestionId(qid), s = (perPort[p] ??= { questions: 0, records: 0, labels: {} });
        s.questions++; s.labels[q.label] = (s.labels[q.label] ?? 0) + 1;
      }
      for (const p of r.meta.ports) { (perPort[p] ??= { questions: 0, records: 0, labels: {} }).records++; if (r.tokens) (tokensByPort[p] ??= []).push(r.tokens.stateTokens); }
    }
    for (const [p, s] of Object.entries(perPort)) { s.labels = Object.fromEntries(Object.entries(s.labels).sort()); s.stateTokens = statsOf(tokensByPort[p] ?? []); }
    const positions = positionHistogram(recs.flatMap(r => Object.values(r.questions)));
    const posCheck = checkPositionUniform(positions);
    if (enforcePositions && slice !== 'train' && !posCheck.ok) throw fail('POSITION', `${slice}: label positions are not within ±5 pp of uniform`, posCheck.problems);
    const file = path.join(dir, 'kev', `${slice}.jsonl`);
    const ex = exportKev(recs.map(r => ({ state: r.state, questions: r.questions, meta: r.meta })), { file, contracts, slice, guard: wordings });
    const def = sliceDef(slice), list = seedsFor(slice, seeds[slice]);
    manifest.slices[slice] = { bedSplit: def.bedSplit, seedRange: def.seeds, seeds: { n: list.length, first: list[0] ?? null, last: list.at(-1) ?? null },
      records: recs.length, questions: recs.reduce((s, r) => s + Object.keys(r.questions).length, 0), worlds: new Set(recs.flatMap(r => r.meta.worldKeys)).size,
      perPort, positions, positionCheck: posCheck.ok ? 'ok' : posCheck.problems.length, dropped: drops[slice] ?? {}, unknowable: ex.unknowable,
      files: { kev: { path: `kev/${slice}.jsonl`, sha256: ex.sha256 }, meta: { path: `kev/${slice}.meta.jsonl`, sha256: ex.metaSha256 } } };
  }
  manifest.jobMaxState = stateTokensAll.length ? jobMaxState(stateTokensAll) : null;
  writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  timing.writeMs = Date.now() - tw; timing.totalMs = Date.now() - t0;
  writeFileSync(path.join(dir, 'timing.json'), JSON.stringify(timing, null, 2) + '\n');
  const v = verifyBuildDir(dir, { spec });
  if (!v.ok) throw fail(v.errors[0].code, `the written build fails verification: ${v.errors[0].message}`, v.errors);
  log(`kev-data build ${buildId}: ${Object.entries(manifest.slices).map(([s, x]) => `${s} ${x.records}`).join(', ')} (${timing.totalMs} ms)`);
  return { buildId, dir, manifest, timing, frozen };
}

// Re-check a written build: file digests, ids and sidecars, forbidden keys, reserved worlds and seed
// ranges, and no stateHash shared between slices (§10 global acceptance 2-3).
export function verifyBuildDir(dir, { spec = loadSpec() } = {}) {
  const errors = [], err = (code, m) => errors.push({ code, message: m });
  const manifest = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const owner = new Map();
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
    }
  }
  return { ok: errors.length === 0, errors };
}

// Held-out material for a CLI build: <heldoutDir>/wordings.jsonl ({port, id, slice, text} per line)
// and <heldoutDir>/registry.json (SpanRegistry#toJSON). Both optional; their sha256 is in the manifest config.
export function loadHeldout(heldoutDir) {
  if (!heldoutDir) return { wordings: null, registry: null };
  const wf = path.join(heldoutDir, 'wordings.jsonl'), rf = path.join(heldoutDir, 'registry.json');
  const wordings = existsSync(wf) ? new WordingGuard(readFileSync(wf, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))) : null;
  const registry = existsSync(rf) ? SpanRegistry.fromJSON(JSON.parse(readFileSync(rf, 'utf8'))) : null;
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
