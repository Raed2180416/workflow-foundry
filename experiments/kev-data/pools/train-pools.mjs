// Kev judge data factory, group `train-pools` (JUDGE-PROGRAM.md §2.4, JUDGE-BUILD-PLAN.json).
//
// Train-pool lines for the template-bound wave-1 ports R1-R4 (paraphrases of the records bed's
// non-held-out label-bearing note templates, 20 per template, slots kept as placeholders; the
// counterfactual sentences the balancing needs), X1 (benign and decoy memo forms, positives without
// addressee words, negatives with them, per train family) and X5 (records assumption phrasings).
//
// The lines are AUTHORED by a development agent (experiments/kev-data/pools/authored/*.mjs). Labels
// are inherited from the brief a line was written to, never assigned by a model. The two-model
// filter (Sonnet 5.5 and Opus 5.5 must both recover the label zero-shot, §2.3 rule 1) is deferred to
// the hosted-arms group: every line carries filters.twoModel = "pending", filterBrief() builds the
// zero-shot question for it and applyTwoModelVerdicts() applies the answers (reject log included).
// What runs here is the deterministic local filter (pools/filters.mjs).
//
//   node experiments/kev-data/pools/train-pools.mjs build [--out DIR] [--manifest FILE|-] [--heldout-manifest FILE]
//   node experiments/kev-data/pools/train-pools.mjs briefs --pool DIR --out FILE
//   node experiments/kev-data/pools/train-pools.mjs apply-verdicts --pool DIR --verdicts FILE --out DIR
//
// Reads: the frozen bed copy (lib/pin.mjs) only, and the committed heldout hash manifest
// (experiments/kev-data/heldout-manifest.json) if it exists. Never .foundry/kev-data/heldout/.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { REPO_ROOT, loadSpec } from '../lib/contracts.mjs';
import { freezeBeds, frozenBeds } from '../lib/pin.mjs';
import { canonical, sentences, skeleton, skeletonBucket, skeletonPercent } from '../lib/hash.mjs';
import { defaultMasks } from '../lib/leakage.mjs';
import { renderQuestion } from '../lib/render.mjs';
import { SLOT_VOCABULARY, SYSTEMS, assertInputClean, canonicalValues, extractTemplates, fillLine, paraphraseInput, slotsOf, templateSkeleton } from './templates.mjs';
import { ADDRESSEE_REGEX_SOURCE, grams, hasAddressee, isWindowed, jaccardSets, jaccard1, literalDates, literalSystemNames, maxJaccard4, prepGrams, shapeProblems, sourceStrings } from './filters.mjs';

export const POOLS_VERSION = 1;
export const POOLS_DIR = path.resolve(fileURLToPath(new URL('.', import.meta.url)));
export const AUTHORED_DIR = path.join(POOLS_DIR, 'authored');
export const DEFAULT_OUT = path.join(REPO_ROOT, '.foundry', 'kev-data', 'pools', 'train');
export const MANIFEST_PATH = path.join(POOLS_DIR, 'train-manifest.json');
export const HELDOUT_MANIFEST_PATH = path.join(REPO_ROOT, 'experiments', 'kev-data', 'heldout-manifest.json');
export const POOL_PORTS = Object.freeze(['R1', 'R2', 'R3', 'R4', 'X1', 'X5']);
export const PER_TEMPLATE_TARGET = 20;
export const TRAIN_FAMILIES = Object.freeze(['records', 'incident', 'synth', 'runbook', 'codefix', 'gameqa']);
export const CUT_LINE_FAMILIES = Object.freeze(['codefix', 'gameqa', 'runbook']);   // plan cutLine: X1 pools for these may be cut
// Thresholds of the local copy filters (4-gram Jaccard). The program's OOD copy filter is 0.3 against
// train-pool lines; for train-pool lines themselves the comparisons below are the paraphrase checks.
export const THRESHOLDS = Object.freeze({ copyOfSource: 0.5, heldOutTemplate: 0.5, bedSentence: 0.5, nearDuplicateUnigram: 0.85, windowShareTolerance: 0.05 });

const sha = x => createHash('sha256').update(x).digest('hex');
export const sha256File = file => sha(readFileSync(file));
const MASKS = () => defaultMasks();
export const lineSkeleton = text => skeleton(sentences(text).join(' '), MASKS());
// Skeletons of every window of 1..3 consecutive sentences of a text (the registry scans windows).
export function windowSkeletons(text, maxWindow = 3) {
  const s = sentences(text), out = new Set();
  for (let i = 0; i < s.length; i++) for (let k = 1; k <= maxWindow && i + k <= s.length; k++) out.add(skeleton(s.slice(i, i + k).join(' '), MASKS()));
  return out;
}

// ---- authored files -------------------------------------------------------------------------------
export async function loadAuthored(dir = AUTHORED_DIR) {
  const files = existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.mjs')).sort() : [];
  const data = {}, digest = {};
  for (const f of files) {
    const abs = path.join(dir, f), bytes = readFileSync(abs);
    data[f.replace(/\.mjs$/, '')] = (await import(`${pathToFileURL(abs).href}?sha=${sha(bytes)}`)).default;
    digest[f] = { sha256: sha(bytes), bytes: bytes.length };
  }
  return { data, digest };
}

// "<<day first|month first>>" gives the two sides of a pair template from one authored string; a
// two-element array gives them verbatim.
export function expandPair(entry) {
  if (Array.isArray(entry)) {
    if (entry.length !== 2 || !entry.every(x => typeof x === 'string')) throw new Error(`a pair entry is a string or [a, b], got ${JSON.stringify(entry).slice(0, 80)}`);
    return entry;
  }
  if (typeof entry !== 'string') throw new Error(`a pair entry is a string or [a, b], got ${typeof entry}`);
  const re = /<<([^<>|]*)\|([^<>|]*)>>/g;
  return [entry.replace(re, (_, a) => a), entry.replace(re, (_, a, b) => b)];
}

// ---- candidates -----------------------------------------------------------------------------------
// A candidate is one authored line before screening. expectSlots: the exact placeholder multiset
// (paraphrases of a template); allow: the allowed placeholders, each at most once (counterfactuals).
const pad = (n, w = 3) => String(n).padStart(w, '0');
function pairCandidates(port, entries, tplA, tplB, pairKey) {
  const out = [];
  entries.forEach((entry, j) => {
    let texts; try { texts = expandPair(entry); } catch (e) { out.push({ error: `${tplA.id}#${pad(j)}: ${e.message}` }); return; }
    [[tplA, texts[0]], [tplB, texts[1]]].forEach(([t, text]) => out.push({
      key: `${t.id}#${pad(j)}`, port, group: 'paraphrase', kind: 'paraphrase', templateId: t.id, source: t.source, system: t.system, label: t.label, order: t.order,
      exYear: t.exYear ?? null, text, expectSlots: t.slots, slotCarried: t.slotCarried, pairKey, pairIndex: j, authoredAt: `${t.id}#${pad(j)}`,
    }));
  });
  return out;
}
const single = (port, t, entries) => entries.map((text, j) => ({
  key: `${t.id}#${pad(j)}`, port, group: 'paraphrase', kind: 'paraphrase', templateId: t.id, source: t.source, system: t.system, label: t.label, order: t.order,
  exYear: null, text, expectSlots: t.slots, slotCarried: false, pairKey: null, pairIndex: j, authoredAt: `${t.id}#${pad(j)}`,
}));

export function buildCandidates({ templates, authored }) {
  const input = paraphraseInput(templates), byId = new Map(templates.map(t => [t.id, t])), inputIds = new Set(input.map(t => t.id));
  const cands = [], problems = [];
  const need = id => {
    const t = byId.get(id);
    if (!t) { problems.push(`unknown template ${id}`); return null; }
    if (!inputIds.has(id)) { problems.push(`authored lines for held-out template ${id}`); return null; }
    return t;
  };
  // A logical file (r1, r2, ...) may be split over several authored files (r1-atlas.mjs, r1-atlas-2.mjs, ...):
  // the sections of every file whose name is the prefix or starts with "<prefix>-" are merged (arrays concatenate
  // in file-name order).
  const get = (file, section) => {
    const out = {};
    for (const [name, d] of Object.entries(authored)) {
      if (name !== file && !name.startsWith(`${file}-`)) continue;
      for (const [k, v] of Object.entries(d?.[section] ?? {})) out[k] = Object.hasOwn(out, k) ? [...out[k], ...v] : [...v];   // top-up files extend a key
    }
    return out;
  };
  // R1-R3: pair templates
  for (const [key, entries] of Object.entries(get('r1', 'paraphrase'))) {
    const [system, idx] = key.split(':'), a = need(`R1:${system}:dmy:${idx}`), b = need(`R1:${system}:mdy:${idx}`);
    if (a && b) cands.push(...pairCandidates('R1', entries, a, b, `R1:${system}:${idx}`));
  }
  for (const [key, entries] of Object.entries(get('r2', 'paraphrase') ?? {})) {
    const a = need(`R2:live:${key}`), b = need(`R2:void:${key}`);
    if (a && b) cands.push(...pairCandidates('R2', entries, a, b, `R2:${key}`));
  }
  for (const [key, entries] of Object.entries(get('r3', 'paraphrase') ?? {})) {
    const [system, idx] = key.split(':'), a = need(`R3:${system}:same:${idx}`), b = need(`R3:${system}:opposite:${idx}`);
    if (a && b) cands.push(...pairCandidates('R3', entries, a, b, `R3:${system}:${idx}`));
  }
  for (const [key, entries] of Object.entries(get('r4', 'paraphrase') ?? {})) {
    const t = need(`R4:${key.replace(':', ':')}`);
    if (t) cands.push(...single('R4', t, entries));
  }
  // Counterfactual and system-specific lines
  const cf = (port, file, section, spec) => {
    for (const [name, entries] of Object.entries(get(file, section) ?? {})) {
      const s = spec(name);
      entries.forEach((text, j) => cands.push({ key: `${port}:CF:${s.kind}:${name}#${pad(j)}`, port, group: 'counterfactual', kind: s.kind, templateId: null, source: null, system: s.system, label: s.label, order: s.order ?? null,
        exYear: null, text, expectSlots: null, allow: s.allow, require: s.require ?? [], slotCarried: false, pairKey: null, pairIndex: j, authoredAt: `${port}:CF:${s.kind}:${name}#${pad(j)}`, window: s.window }));
    }
  };
  cf('R1', 'r1', 'ymd', name => ({ kind: 'year-first', system: name, label: 'ymd', order: 'ymd', allow: ['S', 'ex', 'ex_long', 'month', 'day'], require: [] }));
  cf('R2', 'r2', 'koboLive', () => ({ kind: 'kobo-live-flag', system: 'KOBO', label: 'live', allow: ['S', 'token', 'live_ref', 'void_ref'], require: ['token'] }));
  cf('R4', 'r4', 'koboMirror', name => ({ kind: 'kobo-mirror', system: 'KOBO', label: 'restamped', allow: ['S', 'field', 'w0', 'w1'], require: [], window: name === 'window' ? 'yes' : name === 'plain' ? 'no' : 'any' }));
  cf('R4', 'r4', 'restamped_nowindow', () => ({ kind: 'restamped-no-window', system: null, label: 'restamped', allow: ['S', 'field'], require: [], window: 'no' }));
  cf('R4', 'r4', 'reliable_window', () => ({ kind: 'reliable-with-window', system: null, label: 'reliable', allow: ['S', 'field', 'w0', 'w1', 'year'], require: ['w0', 'w1'], window: 'yes' }));
  return { candidates: cands, problems, input };
}

// ---- screening ------------------------------------------------------------------------------------
// Static checks first (every reason is logged), then the order-dependent ones (duplicates) among the
// candidates that survived, in authored order.
export function screen(candidates, { templates, bedStrings = [], thresholds = THRESHOLDS, trainBucketOnly = true }) {
  const byId = new Map(templates.map(t => [t.id, t]));
  const heldOut = templates.filter(t => t.heldOut);
  const heldOutSk = new Map(heldOut.map(t => [templateSkeleton(t), t.id]));
  const heldOutGrams = prepGrams(heldOut.map(t => ({ text: t.text, id: t.id })));
  const bedGrams = prepGrams(bedStrings);
  const admitted = [], rejects = [], seenSk = new Map(), seenText = new Set(), byTemplate = new Map();
  const reject = (c, reasons, extra = {}) => rejects.push({ key: c.key, port: c.port, templateId: c.templateId, kind: c.kind, label: c.label, system: c.system, family: c.family ?? null, text: c.text, reasons, ...extra });

  for (const c of candidates) {
    const reasons = [], extra = {};
    const text = c.text;
    const multi = c.port === 'X1' ? 3 : 1;
    for (const p of shapeProblems(text, { maxSentences: multi, minChars: c.port === 'X1' ? 8 : 12, maxChars: c.port === 'X1' ? 600 : 480 })) reasons.push(`shape:${p}`);
    const slots = slotsOf(text);
    if (c.expectSlots) {
      if (slots.length !== c.expectSlots.length || slots.some((s, i) => s !== c.expectSlots[i])) { reasons.push('slots'); extra.slots = { got: slots, want: c.expectSlots }; }
    } else if (c.allow) {
      const dup = slots.filter((s, i) => slots.indexOf(s) !== i), bad = slots.filter(s => !c.allow.includes(s));
      if (bad.length || dup.length) { reasons.push('slots'); extra.slots = { got: slots, allowed: c.allow }; }
      for (const r of c.require ?? []) if (!slots.includes(r)) { reasons.push(`slots:missing-{${r}}`); }
    } else if (slots.length) { reasons.push('slots:placeholder-not-allowed'); extra.slots = { got: slots }; }
    if (c.port !== 'X1' && c.port !== 'X5') {
      const names = literalSystemNames(text); if (names.length) { reasons.push('literal-system-name'); extra.names = names; }
      if (/\b(?:dmy|mdy|ymd)\b/i.test(text)) reasons.push('option-id-in-text');
    }
    if (c.port === 'R4') {
      const w = isWindowed(text), lit = literalDates(text.replace(/\{[a-z0-9_]+\}/g, ' '));
      const { w0, w1 } = { w0: /\{w0\}/.test(text), w1: /\{w1\}/.test(text) };
      if (w0 !== w1) reasons.push('window:one-slot-only');
      if (!w && lit >= 2) reasons.push('window:literal-date-range');
      if (c.window === 'yes' && !w) reasons.push('window:expected-window'); if (c.window === 'no' && (w || w0 || w1)) reasons.push('window:unexpected-window');
    }
    if (c.port === 'X1' || c.port === 'X5') { /* no placeholders; handled via allow = [] */ }
    const sk = lineSkeleton(text), bucket = skeletonBucket(sk);
    if (trainBucketOnly && bucket !== 'train') reasons.push(`bucket:${bucket}`);
    if (heldOutSk.has(sk)) { reasons.push('skeleton-of-held-out-bed-template'); extra.heldOut = heldOutSk.get(sk); }
    const g = grams(text, 4);
    if (c.port.startsWith('R')) {
      const src = c.templateId ? byId.get(c.templateId) : null;
      if (src) { const j = jaccardSets(g, grams(src.text, 4)); if (j >= thresholds.copyOfSource) { reasons.push('copy-of-source-template'); extra.copy = Number(j.toFixed(3)); } }
      let best = 0, at = null; for (const h of heldOutGrams) { const j = jaccardSets(g, h.grams); if (j > best) { best = j; at = h.id; } }
      if (best >= thresholds.heldOutTemplate) { reasons.push('near-held-out-bed-template'); extra.nearHeldOut = { id: at, jaccard: Number(best.toFixed(3)) }; }
    }
    if (bedGrams.length) {
      let best = 0, at = null; for (const b of bedGrams) { const j = jaccardSets(g, b.grams); if (j > best) { best = j; at = b.text; } }
      if (best >= thresholds.bedSentence) { reasons.push('copy-of-bed-sentence'); extra.bedSentence = { text: String(at).slice(0, 120), jaccard: Number(best.toFixed(3)) }; }
    }
    if (reasons.length) { reject(c, reasons, extra); continue; }

    // order-dependent: duplicates
    const norm = text.toLowerCase().replace(/\s+/g, ' ');
    if (seenText.has(`${c.port}|${norm}`) && !c.slotCarried) { reject(c, ['duplicate-text']); continue; }
    const prior = seenSk.get(`${c.port}|${sk}`);
    if (prior) {
      const sibling = c.slotCarried && prior.pairKey === c.pairKey && prior.pairIndex === c.pairIndex && prior.label !== c.label;
      if (!sibling) { reject(c, [prior.label === c.label ? 'duplicate-skeleton' : 'cross-label-skeleton-collision'], { collidesWith: prior.key }); continue; }
    }
    const groupKey = c.templateId ?? `${c.port}:${c.kind}:${c.system ?? ''}:${c.label}:${c.family ?? ''}`;
    const sameGroup = byTemplate.get(groupKey) ?? [];
    const near = sameGroup.find(o => jaccard1(o.text, text) >= thresholds.nearDuplicateUnigram);
    if (near) { reject(c, ['near-duplicate'], { nearTo: near.key }); continue; }
    sameGroup.push(c); byTemplate.set(groupKey, sameGroup);
    seenText.add(`${c.port}|${norm}`); if (!seenSk.has(`${c.port}|${sk}`)) seenSk.set(`${c.port}|${sk}`, c);
    admitted.push({ ...c, skeleton: sk, percent: Number(skeletonPercent(sk).toFixed(2)), bucket, slots });
  }
  return { admitted, rejects };
}

// ---- pool lines -----------------------------------------------------------------------------------
export function toLine(c) {
  const id = c.key;
  const line = { id, port: c.port, group: c.group, kind: c.kind, templateId: c.templateId, source: c.source, system: c.system, label: c.label };
  if (c.order) line.order = c.order;
  if (c.exYear) line.exYear = c.exYear;
  if (c.family) { line.family = c.family; line.sourceKind = c.sourceKind; line.role = c.role; line.addressee = hasAddressee(c.text); }
  if (c.assertsPort) line.assertsPort = c.assertsPort;
  line.text = c.text; line.slots = c.slots;
  if (c.port === 'R4') line.windowed = isWindowed(c.text);
  if (c.slotCarried) line.slotCarried = true;
  if (c.pairKey) { line.pairKey = c.pairKey; line.pairIndex = c.pairIndex; }
  line.skeleton = c.skeleton; line.percent = c.percent; line.bucket = c.bucket;
  line.author = 'claude-sonnet-5-5 (development agent)';
  line.filters = { local: 'pass', twoModel: 'pending' };
  return line;
}
// twin: the admitted opposite-label line of the same pair index (the flip twin), if any.
export function linkTwins(lines) {
  const by = new Map();
  for (const l of lines) if (l.pairKey != null) by.set(`${l.pairKey}#${l.pairIndex}#${l.label}`, l);
  for (const l of lines) {
    if (l.pairKey == null) continue;
    const other = [...by.values()].find(o => o.pairKey === l.pairKey && o.pairIndex === l.pairIndex && o.label !== l.label);
    l.twin = other ? other.id : null;
  }
  return lines;
}

export const jsonl = rows => rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '');
export const readJsonl = file => readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));

// ---- statistics and acceptance checks (pure) ------------------------------------------------------
const tally = (rows, f) => { const o = {}; for (const r of rows) { const k = f(r); o[k] = (o[k] ?? 0) + 1; } return Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1))); };
export function perTemplateCounts(lines, input) {
  const n = {}; for (const l of lines) if (l.templateId) n[l.templateId] = (n[l.templateId] ?? 0) + 1;
  return input.map(t => ({ templateId: t.id, admitted: n[t.id] ?? 0, shortfall: Math.max(0, PER_TEMPLATE_TARGET - (n[t.id] ?? 0)) }));
}
// R4: share of lines with a date window, within each label.
export function windowBalance(lines) {
  const out = {};
  for (const label of ['reliable', 'restamped']) {
    const rows = lines.filter(l => l.label === label), w = rows.filter(l => l.windowed).length;
    out[label] = { n: rows.length, windowed: w, share: rows.length ? w / rows.length : null };
  }
  const a = out.reliable.share, b = out.restamped.share;
  out.gap = a === null || b === null ? null : Math.abs(a - b);
  return out;
}
export function windowBalanced(b, tol = THRESHOLDS.windowShareTolerance) {
  return b.reliable.n > 0 && b.restamped.n > 0 && Math.abs(b.reliable.share - 0.5) <= tol && Math.abs(b.restamped.share - 0.5) <= tol && b.gap <= tol;
}
export function addresseeStats(lines) {
  const pos = lines.filter(l => l.label === 'yes'), neg = lines.filter(l => l.label === 'no');
  const frac = (rows, f) => (rows.length ? rows.filter(f).length / rows.length : null);
  return { positives: pos.length, positivesWithoutAddressee: frac(pos, l => !l.addressee), negatives: neg.length, negativesWithAddressee: frac(neg, l => l.addressee) };
}
export function x1Stats(lines) {
  const stat = rows => ({ distinctSkeletons: new Set(rows.map(l => l.skeleton)).size, ...addresseeStats(rows), byRole: tally(rows, l => l.role) });
  const byFamily = {}; for (const f of TRAIN_FAMILIES) byFamily[f] = stat(lines.filter(l => l.family === f));
  const records = lines.filter(l => l.family === 'records');
  return {
    overall: stat(lines), byFamily,
    benignDistinct: new Set(records.filter(l => l.role === 'benign').map(l => l.skeleton)).size,
    decoyDistinct: new Set(records.filter(l => l.role === 'decoy').map(l => l.skeleton)).size,
    benignAllFamiliesDistinct: new Set(lines.filter(l => l.role === 'benign').map(l => l.skeleton)).size,
  };
}
export function r1Stats(lines) {
  const ymd = lines.filter(l => l.label === 'ymd');
  return { yearFirstBySystem: tally(ymd, l => l.system), koboFlagLive: lines.filter(l => l.port === 'R2' && l.system === 'KOBO' && l.label === 'live').length };
}

// ---- held-out registry (committed hash manifest only) -------------------------------------------
// The registry's skeleton hashes are the only thing compared. The manifest shapes understood: SpanRegistry
// JSON ({entries: [{hash}]}), {registry: {entries}}, {skeletons: [hash]} and {hashes: [hash]}.
export function manifestHashes(manifest) {
  if (!manifest || typeof manifest !== 'object') return null;
  const pick = [manifest.entries, manifest.registry?.entries, manifest.skeletons, manifest.hashes, manifest.registry?.skeletons, manifest.registry?.hashes].find(Array.isArray);
  if (!pick) return null;
  return new Set(pick.map(e => (typeof e === 'string' ? e : e?.hash)).filter(h => /^sha256:[0-9a-f]{64}$/.test(h ?? '')));
}
export function checkAgainstHeldoutManifest(lines, manifest) {
  const hashes = manifestHashes(manifest);
  if (!hashes || !hashes.size) return { available: false, checked: 0, collisions: [], reason: manifest ? 'manifest holds no skeleton hashes' : 'no manifest' };
  const collisions = [];
  for (const l of lines) {
    const sks = windowSkeletons(l.text);
    for (const s of sks) if (hashes.has(s)) { collisions.push({ id: l.id, skeleton: s }); break; }
  }
  return { available: true, checked: hashes.size, collisions };
}
export function loadHeldoutManifest(file = HELDOUT_MANIFEST_PATH) {
  if (!existsSync(file)) return null;
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }
}

// ---- consumers' API -----------------------------------------------------------------------------
export function loadTrainPool(dir, port) { return readJsonl(path.join(dir, `${port}.jsonl`)); }
// lib/counterfactual.mjs listProvider lists: key -> [{text, from}]. text is the filled sentence.
//   R1/R3/R2/R4 key: `${port}:${system|*}:${label}`; the caller fills slots through `values`.
export function providerLists(lines, valuesFor) {
  const lists = {};
  for (const l of lines) {
    const key = `${l.port}:${l.system ?? '*'}:${l.label}`;
    (lists[key] ??= []).push({ text: valuesFor ? fillLine(l, valuesFor(l)) : l.text, from: l.id });
  }
  return lists;
}

// ---- the deferred two-model filter ---------------------------------------------------------------
// The zero-shot brief for a line: the port question and state a model is asked, and the label the line
// was written to. Both models must answer `expected` for the line to be admitted.
export function filterBrief(line, { contracts = loadSpec().contracts, consts = {} } = {}) {
  const v = canonicalValues(line, consts);
  const q = (port, slots, wording = 'Q0') => renderQuestion(contracts[port], { wording, slots });
  let state, question;
  if (line.port === 'R1' || line.port === 'R3' || line.port === 'R4') {
    const S = line.system ?? v.S; const text = fillLine(line, { ...v, S });
    state = { system: S, source_note: text };
    question = q(line.port, line.port === 'R4' ? { system: S === 'ATLAS' || S === 'VENDEX' ? 'BRIGHTDESK' : S, field: v.field } : { system: S }, 'Q0');
    if (line.port === 'R4') { state.system = S === 'ATLAS' || S === 'VENDEX' ? 'BRIGHTDESK' : S; state.source_note = fillLine(line, { ...v, S: state.system, field: consts.UPDATE_FIELD?.[state.system] ?? v.field }); question = q('R4', { system: state.system, field: consts.UPDATE_FIELD?.[state.system] ?? v.field }); }
  } else if (line.port === 'R2') {
    const S = line.system ?? 'LEDGR'; const vv = canonicalValues({ ...line, system: S }, consts);
    state = { system: S, marker: vv.token, source_note: fillLine(line, { ...vv, S }) };
    question = q('R2', { system: S, value: vv.token });
  } else if (line.port === 'X1') {
    state = { source_kind: line.sourceKind, text: line.text };
    question = q('X1', {});
  } else throw new Error(`filterBrief: no brief for port ${line.port}`);
  return { id: line.id, port: line.port, expected: line.label, question, state };
}
// verdicts: [{id, sonnet, opus}] (the option each model chose, zero-shot). A line is admitted only if
// both recovered `label`. Lines without a verdict stay pending. The reject log lists both answers.
export function applyTwoModelVerdicts(lines, verdicts) {
  const by = new Map(verdicts.map(v => [v.id, v]));
  const admitted = [], rejected = [], pending = [];
  for (const l of lines) {
    const v = by.get(l.id);
    if (!v) { pending.push(l); continue; }
    if (v.sonnet === l.label && v.opus === l.label) admitted.push({ ...l, filters: { ...l.filters, twoModel: 'passed' } });
    else rejected.push({ id: l.id, port: l.port, templateId: l.templateId, label: l.label, text: l.text, reasons: ['two-model'], answers: { sonnet: v.sonnet ?? null, opus: v.opus ?? null } });
  }
  return { admitted, rejected, pending };
}

// ---- bed source strings (the copy-filter reference for X1) ------------------------------------------
export function bedSourceStrings(beds, familyBeds = ['records', 'incident', 'synth', 'runbook', 'codefix', 'gameqa']) {
  const out = [], digest = {};
  for (const bed of familyBeds) {
    const dir = path.join(beds.dir, 'beds', bed);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).filter(f => f.endsWith('.mjs') && !/\.test\.mjs$/.test(f)).sort()) {
      const rel = `beds/${bed}/${f}`; let src; try { src = beds.read(rel); } catch { continue; }
      digest[rel] = sha(src);
      for (const s of sourceStrings(src)) out.push({ text: s, from: rel });
    }
  }
  return { strings: out, digest };
}

// ---- the build ------------------------------------------------------------------------------------
export async function buildTrainPools({ root = REPO_ROOT, beds = null, authoredDir = AUTHORED_DIR, heldoutManifestPath = HELDOUT_MANIFEST_PATH, extraCandidates = null } = {}) {
  let tmp = null, frozen = null;
  if (!beds) {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'kev-train-pools-'));
    frozen = freezeBeds(root, { outRoot: tmp }); beds = frozenBeds(frozen);
  }
  try {
    const { templates, extent, source, consts } = await extractTemplates(beds);
    const { data: authored, digest: authoredDigest } = await loadAuthored(authoredDir);
    const { candidates, problems, input } = buildCandidates({ templates, authored });
    const x = (await import('./x-pools.mjs')).buildXCandidates({ authored });
    candidates.push(...x.candidates); problems.push(...x.problems);
    if (extraCandidates) candidates.push(...extraCandidates);
    const violations = assertInputClean(input, templates);
    const corpus = bedSourceStrings(beds);
    const { admitted, rejects } = screen(candidates, { templates, bedStrings: corpus.strings });
    const lines = linkTwins(admitted.map(toLine)).sort((a, b) => (a.id < b.id ? -1 : 1));
    const pools = Object.fromEntries(POOL_PORTS.map(p => [p, lines.filter(l => l.port === p)]));
    return { pools, rejects, problems, violations, input, templates, extent, consts, source, authoredDigest, corpusDigest: corpus.digest, bedPin: beds.pin, bedCommit: beds.commit, heldoutManifest: loadHeldoutManifest(heldoutManifestPath) };
  } finally { if (tmp) rmSync(tmp, { recursive: true, force: true }); }
}

const R = (n, d = 4) => (n === null || n === undefined ? null : Number(n.toFixed(d)));
export function summarize(res) {
  const { pools, rejects, input, templates, violations, problems } = res;
  const ports = {};
  for (const p of POOL_PORTS) {
    const ls = pools[p];
    ports[p] = { lines: ls.length, byGroup: tally(ls, l => l.group), byKind: tally(ls, l => l.kind), byLabel: tally(ls, l => l.label), bySystem: tally(ls, l => l.system ?? '-'),
      bucket: tally(ls, l => l.bucket), twoModelPending: ls.filter(l => l.filters.twoModel === 'pending').length };
  }
  const rb = {}; for (const r of rejects) for (const reason of r.reasons) { const k = reason.replace(/:.*$/, ''); rb[k] = (rb[k] ?? 0) + 1; }
  const perTemplate = perTemplateCounts([...pools.R1, ...pools.R2, ...pools.R3, ...pools.R4], input);
  const wb = windowBalance(pools.R4);
  const heldOut = templates.filter(t => t.heldOut);
  return {
    ports, perTemplate, shortfalls: perTemplate.filter(t => t.shortfall > 0), rejectsByReason: Object.fromEntries(Object.entries(rb).sort(([a], [b]) => (a < b ? -1 : 1))), rejectsTotal: rejects.length,
    r4WindowBalance: { reliable: { ...wb.reliable, share: R(wb.reliable.share) }, restamped: { ...wb.restamped, share: R(wb.restamped.share) }, gap: R(wb.gap), balanced: windowBalanced(wb) },
    r1: r1Stats([...pools.R1, ...pools.R2]), x1: x1Stats(pools.X1),
    input: { templates: input.length, heldOutTemplates: heldOut.map(t => t.id), heldOutCount: heldOut.length, violations, problems },
  };
}
export function manifestOf(res, outDirFiles) {
  const s = summarize(res);
  const ho = checkAgainstHeldoutManifest(Object.values(res.pools).flat(), res.heldoutManifest);
  return {
    schema: 'kev-data/train-pools-manifest/1', group: 'train-pools', version: POOLS_VERSION,
    status: 'development evidence: authored by a development agent; the two-model filter (Sonnet 5.5 + Opus 5.5 zero-shot) is deferred to the hosted-arms group and every line is filters.twoModel = "pending"',
    author: 'claude-sonnet-5-5 (development agent, this build session)',
    bed: { pin: res.bedPin, note: 'content hash of the nine dev beds; the pool depends only on the consumed sources below', sources: { [res.source.file]: res.source.sha256, ...res.corpusDigest } },
    authored: res.authoredDigest,
    slotVocabulary: SLOT_VOCABULARY,
    addresseeRegex: ADDRESSEE_REGEX_SOURCE,
    thresholds: THRESHOLDS, perTemplateTarget: PER_TEMPLATE_TARGET,
    outputs: outDirFiles,
    summary: s,
    heldoutRegistry: { manifest: 'experiments/kev-data/heldout-manifest.json', available: ho.available, checked: ho.checked, collisions: ho.collisions.length, reason: ho.reason ?? null },
    deferred: [],
  };
}

export async function writeTrainPools(res, outDir = DEFAULT_OUT) {
  mkdirSync(outDir, { recursive: true });
  const files = {};
  for (const p of POOL_PORTS) {
    const body = jsonl(res.pools[p]), f = `${p}.jsonl`;
    writeFileSync(path.join(outDir, f), body); files[f] = { sha256: sha(body), lines: res.pools[p].length };
  }
  const rj = jsonl(res.rejects.slice().sort((a, b) => (a.key < b.key ? -1 : 1)));
  writeFileSync(path.join(outDir, 'rejects.jsonl'), rj); files['rejects.jsonl'] = { sha256: sha(rj), lines: res.rejects.length };
  return files;
}

// ---- CLI --------------------------------------------------------------------------------------------
const arg = (argv, name, d = null) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : d; };
async function main(argv) {
  const cmd = argv[0];
  if (cmd === 'build') {
    const out = path.resolve(arg(argv, '--out', DEFAULT_OUT)), mf = arg(argv, '--manifest', MANIFEST_PATH);
    const res = await buildTrainPools({ heldoutManifestPath: arg(argv, '--heldout-manifest', HELDOUT_MANIFEST_PATH) });
    const files = await writeTrainPools(res, out);
    const manifest = manifestOf(res, files);
    if (mf !== '-') writeFileSync(mf, JSON.stringify(manifest, null, 2) + '\n');
    const s = manifest.summary;
    console.log(JSON.stringify({ out, manifest: mf, ports: Object.fromEntries(Object.entries(s.ports).map(([k, v]) => [k, v.lines])), rejects: s.rejectsTotal, shortfalls: s.shortfalls.length, r4: s.r4WindowBalance }, null, 1));
    if (res.problems.length || res.violations.length) { console.error('PROBLEMS', res.problems, res.violations); process.exitCode = 1; }
    return;
  }
  if (cmd === 'briefs') {
    const dir = path.resolve(arg(argv, '--pool')), out = path.resolve(arg(argv, '--out'));
    const res = await buildTrainPools(); const consts = res.consts;
    const lines = POOL_PORTS.filter(p => p !== 'X5').flatMap(p => loadTrainPool(dir, p));
    writeFileSync(out, jsonl(lines.map(l => filterBrief(l, { consts }))));
    console.log(`${lines.length} briefs -> ${out}`); return;
  }
  if (cmd === 'apply-verdicts') {
    const dir = path.resolve(arg(argv, '--pool')), out = path.resolve(arg(argv, '--out')), verdicts = readJsonl(path.resolve(arg(argv, '--verdicts')));
    mkdirSync(out, { recursive: true }); const rejected = [];
    for (const p of POOL_PORTS) {
      const r = applyTwoModelVerdicts(loadTrainPool(dir, p), verdicts);
      writeFileSync(path.join(out, `${p}.jsonl`), jsonl([...r.admitted, ...r.pending].sort((a, b) => (a.id < b.id ? -1 : 1)))); rejected.push(...r.rejected);
    }
    writeFileSync(path.join(out, 'two-model-rejects.jsonl'), jsonl(rejected)); console.log(`${rejected.length} lines rejected by the two-model filter`); return;
  }
  console.error('usage: train-pools.mjs build|briefs|apply-verdicts ...'); process.exitCode = 2;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));
