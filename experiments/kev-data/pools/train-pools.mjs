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
// the hosted-arms group: every line carries filters.twoModel = "pending", briefsFor() builds the
// zero-shot question for it and applyTwoModelVerdicts() applies the answers (reject log included).
// What runs here is the deterministic local filter (pools/filters.mjs).
//
//   node experiments/kev-data/pools/train-pools.mjs build [--out DIR] [--manifest FILE|-] [--heldout-manifest FILE]
//   node experiments/kev-data/pools/train-pools.mjs input --out FILE     (the paraphrase brief: non-held-out templates only)
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
import { SLOT_VOCABULARY, SYSTEMS, assertInputClean, canonicalValues, extractTemplates, fillLine, paraphraseInput, slotsOf, systemFor, templateSkeleton } from './templates.mjs';
import { ADDRESSEE_REGEX_SOURCE, bedReferenceStrings, cueVerdict, grams, hasAddressee, isWindowed, jaccardSets, jaccard1, literalDates, literalSystemNames, maxJaccard4, pairOrientation, prepGrams, shapeProblems, sourceStrings } from './filters.mjs';

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
// heldOutTemplate and heldOutFamily use the program's copy-filter value (0.3, §2.4: OOD lines against train-pool
// lines and bed templates), applied the other way round: a train-pool line may not sit that close to a held-out bed
// template (§3.3) or to a string of a held-out family's bed (§3.4: X1 kinetics and gridquest; X5 kinetics and runbook).
// orientationCrossedMax and cueAgreeMin are the label guards' tolerances (filters.mjs pairOrientation, cueVerdict).
export const THRESHOLDS = Object.freeze({ copyOfSource: 0.5, copyOfSourceUnigram: 0.85, heldOutTemplate: 0.3, bedSentence: 0.5, heldOutFamily: 0.3, nearDuplicateUnigram: 0.85, windowShareTolerance: 0.05,
  orientationCrossedMax: 0.02, cueAgreeMin: 0.6, cueMinDecided: 10 });
// The held-out families of the cross-bed ports this pool writes for (JUDGE-PROGRAM.md §3.4): their bed strings are a
// copy-filter reference at THRESHOLDS.heldOutFamily. runbook is an X1 train family but an X5 held-out family.
export const HELD_OUT_FAMILY_BEDS = Object.freeze({ X1: Object.freeze(['kinetics', 'gridquest']), X5: Object.freeze(['kinetics', 'runbook']) });

const sha = x => createHash('sha256').update(x).digest('hex');
const R = (n, d = 4) => (n === null || n === undefined ? null : Number(n.toFixed(d)));
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
export function screen(candidates, { templates, bedStrings = [], heldOutFamilyStrings = {}, thresholds = THRESHOLDS, trainBucketOnly = true }) {
  const byId = new Map(templates.map(t => [t.id, t]));
  const heldOut = templates.filter(t => t.heldOut);
  const heldOutSk = new Map(heldOut.map(t => [templateSkeleton(t), t.id]));
  const heldOutGrams = prepGrams(heldOut.map(t => ({ text: t.text, id: t.id })));
  const bedGrams = prepGrams(bedStrings);
  const famGrams = Object.fromEntries(Object.entries(heldOutFamilyStrings).map(([p, list]) => [p, prepGrams(list)]));
  const admitted = [], rejects = [], seenSk = new Map(), seenText = new Set(), byTemplate = new Map();
  const reject = (c, reasons, extra = {}) => rejects.push({ key: c.key, port: c.port, templateId: c.templateId, kind: c.kind, label: c.label, system: c.system, family: c.family ?? null, text: c.text, reasons, ...extra });

  for (const c of candidates) {
    const reasons = [], extra = {};
    const text = c.text;
    const multi = c.port === 'X1' ? 3 : 1;
    for (const p of shapeProblems(text, { maxSentences: multi, minChars: c.port === 'X1' ? 8 : 12, maxChars: c.port === 'X1' ? 600 : 480, requireTerminal: c.port !== 'X1' && c.port !== 'X5' })) reasons.push(`shape:${p}`);
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
      if (/\b(?:dmy|mdy|ymd|restamped)\b/i.test(text)) reasons.push('option-id-in-text');   // an option id is code vocabulary, not note text
    }
    if (c.port === 'R4') {
      const w = isWindowed(text), lit = literalDates(text.replace(/\{[a-z0-9_]+\}/g, ' '));
      const { w0, w1 } = { w0: /\{w0\}/.test(text), w1: /\{w1\}/.test(text) };
      if (w0 !== w1) reasons.push('window:one-slot-only');
      if (!w && lit >= 2) reasons.push('window:literal-date-range');
      if (c.window === 'yes' && !w) reasons.push('window:expected-window'); if (c.window === 'no' && (w || w0 || w1)) reasons.push('window:unexpected-window');
    }
    if (c.port === 'X5') {   // the {assumption} slot of Q0-Q3 takes a clause
      if (/[.!?]$/.test(text)) reasons.push('x5:trailing-full-stop');
      if (/^[A-Z][a-z]/.test(text)) reasons.push('x5:capitalised-start');
    }
    const sk = lineSkeleton(text), bucket = skeletonBucket(sk);
    if (trainBucketOnly && bucket !== 'train') reasons.push(`bucket:${bucket}`);
    if (heldOutSk.has(sk)) { reasons.push('skeleton-of-held-out-bed-template'); extra.heldOut = heldOutSk.get(sk); }
    const g = grams(text, 4);
    if (c.port.startsWith('R')) {
      const src = c.templateId ? byId.get(c.templateId) : null;
      if (src) {
        const j = jaccardSets(g, grams(src.text, 4)); if (j >= thresholds.copyOfSource) { reasons.push('copy-of-source-template'); extra.copy = Number(j.toFixed(3)); }
        const u = jaccard1(text, src.text); if (u >= thresholds.copyOfSourceUnigram) { reasons.push('light-edit-of-source-template'); extra.lightEdit = Number(u.toFixed(3)); }   // a word or two changed is not a paraphrase
      }
      let best = 0, at = null; for (const h of heldOutGrams) { const j = jaccardSets(g, h.grams); if (j > best) { best = j; at = h.id; } }
      if (best >= thresholds.heldOutTemplate) { reasons.push('near-held-out-bed-template'); extra.nearHeldOut = { id: at, jaccard: Number(best.toFixed(3)) }; }
    }
    if (bedGrams.length) {
      let best = 0, at = null; for (const b of bedGrams) { const j = jaccardSets(g, b.grams); if (j > best) { best = j; at = b.text; } }
      if (best >= thresholds.bedSentence) { reasons.push('copy-of-bed-sentence'); extra.bedSentence = { text: String(at).slice(0, 120), jaccard: Number(best.toFixed(3)) }; }
    }
    if (famGrams[c.port]?.length) {   // held-out family of this port (test-OOD only): the OOD copy threshold
      let best = 0, at = null; for (const b of famGrams[c.port]) { const j = jaccardSets(g, b.grams); if (j > best) { best = j; at = b; } }
      if (best >= thresholds.heldOutFamily) { reasons.push('near-held-out-family-string'); extra.heldOutFamily = { from: at.from ?? null, text: String(at.text).slice(0, 120), jaccard: Number(best.toFixed(3)) }; }
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
// Surface shortcuts of one label's lines: share ending in a full stop / question / exclamation mark, share
// containing a quote character, mean words. The shortcut-audit group runs the real partial-input battery;
// these are the cheap guards the pool is checked against before it ships.
export function formStats(rows) {
  if (!rows.length) return { n: 0, endsWithStop: null, hasQuote: null, meanWords: null };
  const share = f => rows.filter(f).length / rows.length;
  return { n: rows.length, endsWithStop: R(share(l => /[.!?]$/.test(l.text))), hasQuote: R(share(l => /["'“”]/.test(l.text))), meanWords: R(rows.reduce((a, l) => a + l.text.split(/\s+/).length, 0) / rows.length, 2) };
}
export function formGap(rows) {
  const yes = formStats(rows.filter(l => l.label === 'yes')), no = formStats(rows.filter(l => l.label === 'no'));
  if (!yes.n || !no.n) return null;
  return { yes, no, stopGap: R(Math.abs(yes.endsWithStop - no.endsWithStop)), quoteGap: R(Math.abs(yes.hasQuote - no.hasQuote)), wordRatio: R(Math.max(yes.meanWords, no.meanWords) / Math.min(yes.meanWords, no.meanWords), 3) };
}
export function x1Stats(lines) {
  const stat = rows => ({ distinctSkeletons: new Set(rows.map(l => l.skeleton)).size, ...addresseeStats(rows), byRole: tally(rows, l => l.role), form: formGap(rows) });
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
// For the one group allowed to read the registry (assembly): drop the pool lines whose skeleton window equals a
// registered held-out span, and say which were dropped. `registry` is SpanRegistry.toJSON() output.
export function dropRegistryCollisions(lines, registry) {
  const r = checkAgainstHeldoutManifest(lines, registry), bad = new Set(r.collisions.map(c => c.id));
  return { kept: lines.filter(l => !bad.has(l.id)), dropped: lines.filter(l => bad.has(l.id)).map(l => l.id), available: r.available, checked: r.checked };
}
export function loadHeldoutManifest(file = HELDOUT_MANIFEST_PATH) {
  if (!existsSync(file)) return null;
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }
}

// ---- consumers' API -----------------------------------------------------------------------------
// requirePassed: only the lines the two-model filter admitted (filters.twoModel === "passed"); none until hosted-arms runs it.
export function loadTrainPool(dir, port, { requirePassed = false } = {}) { const rows = readJsonl(path.join(dir, `${port}.jsonl`)); return requirePassed ? rows.filter(l => l.filters?.twoModel === 'passed') : rows; }
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
// §2.3 rule 1: a pool line is admitted only if BOTH Sonnet 5.5 and Opus 5.5, asked the port question
// zero-shot, recover the label the line was written to. That needs hosted calls, so it belongs to the
// hosted-arms group: every line carries filters.twoModel = "pending". This module builds the briefs and
// applies the verdicts (a filter on text, never a labeller).
//   briefsFor(line)         the zero-shot questions for a line: {id, lineId, port, expected, question, state}.
//                           One brief for R1-R4 and X1; two for X5 (the assumption must be confirmed ("holds")
//                           by a source sentence that states the convention and contradicted ("violated") by
//                           one that states the opposite, so a line is admitted only if it really asserts the
//                           convention it was written for).
//   applyTwoModelVerdicts   verdicts [{id: briefId, sonnet, opus}] -> {admitted, rejected, pending}
const ORDER_WORDS = { dmy: 'day/month/year', mdy: 'month/day/year', ymd: 'year/month/day' };
// The sentence a brief appends when a line names another system's order ({ref}) whose own sentence lives
// elsewhere in a real note: the zero-shot reader needs it to decide.
const refSentence = (ref, order) => `Numeric birth dates in ${ref} are ${ORDER_WORDS[order]}.`;
export function briefsFor(line, { contracts = loadSpec().contracts, consts = {} } = {}) {
  const ask = (port, slots) => renderQuestion(contracts[port], { wording: 'Q0', slots });
  const one = (id, expected, port, question, state) => ({ id, lineId: line.id, port, expected, question, state });
  if (line.port === 'X1') return [one(line.id, line.label, 'X1', ask('X1', {}), { source_kind: line.sourceKind, text: line.text })];
  if (line.port === 'R1' || line.port === 'R2' || line.port === 'R3' || line.port === 'R4') {
    const S = systemFor(line), v = canonicalValues({ ...line, system: S }, consts);
    const fields = { ...v, S, ...(line.port === 'R4' ? { field: consts.UPDATE_FIELD?.[S] ?? v.field } : {}) };
    let note = fillLine(line, fields);
    if (line.port === 'R1' && line.slots.includes('ref')) note += ` ${refSentence(fields.ref, line.label)}`;
    if (line.port === 'R1') return [one(line.id, line.label, 'R1', ask('R1', { system: S }), { system: S, source_note: note })];
    if (line.port === 'R2') return [one(line.id, line.label, 'R2', ask('R2', { system: S, value: v.token }), { system: S, marker: v.token, source_note: note })];
    if (line.port === 'R3') return [one(line.id, line.label, 'R3', ask('R3', { system: S }), { system: S, source_note: note })];
    return [one(line.id, line.label, 'R4', ask('R4', { system: S }), { system: S, source_note: note })];
  }
  if (line.port === 'X5') {
    const port = line.assertsPort, S = systemFor(line), v = canonicalValues({ ...line, system: S }, consts), field = consts.UPDATE_FIELD?.[S] ?? v.field;
    const assumption = fillLine(line, { ...v, S, field });
    const stating = {
      R1: o => `${S} writes numeric birth dates ${ORDER_WORDS[o]}.`,
      R2: o => (o === 'void' ? `${v.token} marks a void row in ${S}; such rows must not be migrated.` : `${v.token} marks a live account in ${S}; such rows must be migrated.`),
      R3: o => (o === 'same' ? `${S} prints balances the same way as the master; the sign is kept.` : `${S} prints balances the opposite way to the master; the sign is flipped.`),
      R4: o => (o === 'reliable' ? `The ${field} of ${S} is the real date of the last change.` : `The ${field} of ${S} is only a copy date, not a change date.`),
    }[port];
    const opposite = { R1: { dmy: 'mdy', mdy: 'dmy', ymd: 'dmy' }, R2: { void: 'live', live: 'void' }, R3: { same: 'opposite', opposite: 'same' }, R4: { reliable: 'restamped', restamped: 'reliable' } }[port][line.label];
    const q = renderQuestion(contracts.X5, { wording: 'Q0', slots: { assumption } });
    return [one(`${line.id}/holds`, 'holds', 'X5', q, { source_text: stating(line.label) }), one(`${line.id}/violated`, 'violated', 'X5', q, { source_text: stating(opposite) })];
  }
  throw new Error(`briefsFor: no brief for port ${line.port}`);
}
// verdicts: [{id, sonnet, opus}], id a brief id (a line id for single-brief lines): the option each model
// chose. A line is admitted only if both models answered every one of its briefs with the expected label.
// A line with a missing verdict stays pending. The reject log lists both answers per brief.
export function applyTwoModelVerdicts(lines, verdicts, { briefs = l => briefsFor(l) } = {}) {
  const by = new Map(verdicts.map(v => [v.id, v]));
  const admitted = [], rejected = [], pending = [];
  for (const l of lines) {
    const bs = briefs(l), got = bs.map(b => [b, by.get(b.id)]);
    if (got.some(([, v]) => !v)) { pending.push(l); continue; }
    const bad = got.filter(([b, v]) => v.sonnet !== b.expected || v.opus !== b.expected);
    if (!bad.length) admitted.push({ ...l, filters: { ...l.filters, twoModel: 'passed' } });
    else rejected.push({ id: l.id, port: l.port, templateId: l.templateId ?? null, label: l.label, text: l.text, reasons: ['two-model'],
      answers: Object.fromEntries(got.map(([b, v]) => [b.id, { expected: b.expected, sonnet: v.sonnet ?? null, opus: v.opus ?? null }])) });
  }
  return { admitted, rejected, pending };
}

// ---- bed source strings (the copy-filter reference for X1) ------------------------------------------
// Every .mjs file of the train-family beds, recursively (codefix/domains/ included; tests and the audits' attacks/
// left out), read through the frozen copy only.
export function bedSourceStrings(beds, familyBeds = TRAIN_FAMILIES) { return bedReferenceStrings(beds, familyBeds, { sha }); }
// The held-out family references per port (HELD_OUT_FAMILY_BEDS): {strings: {X1: [...], X5: [...]}, digest}.
export function heldOutFamilyStrings(beds) {
  const strings = {}, digest = {};
  for (const [port, list] of Object.entries(HELD_OUT_FAMILY_BEDS)) { const r = bedReferenceStrings(beds, list, { sha }); strings[port] = r.strings; Object.assign(digest, r.digest); }
  return { strings, digest };
}

// ---- label guards (filters.mjs pairOrientation, cueVerdict): checks on authored text, never labels ----------------
// pairs: R1-R3 paraphrase pairs (both sides admitted), oriented against their two source bed templates.
// keyCues: the template pairs orientation cannot decide (both templates use the same words, e.g. "European, not
// American" against "American, not European", or only the order of {day} and {month} differs): the label cues of
// every line of the pair key instead. Slot-carried pairs (the label sits in the slot values; fillLine is tested)
// are listed, not checked.
// sections: single-label units (counterfactual sections, R4 paraphrases), the label cues' agreement.
export function labelGuard(pools, templates) {
  const byT = new Map(templates.map(t => [t.id, t])), pairs = {}, sections = {}, keyCues = {}, slotCarriedKeys = [];
  for (const p of ['R1', 'R2', 'R3']) {
    const rows = pools[p].filter(l => l.group === 'paraphrase' && l.twin), byId = new Map(rows.map(l => [l.id, l]));
    const tot = { straight: 0, crossed: 0, undecided: 0 }, byKey = {}, crossedIds = [];
    for (const l of rows) {
      const o = byId.get(l.twin); if (!o || l.id > o.id) continue;   // each pair once
      const v = pairOrientation(l.text, o.text, byT.get(l.templateId).text, byT.get(o.templateId).text);
      tot[v]++; (byKey[l.pairKey] ??= { straight: 0, crossed: 0, undecided: 0 })[v]++;
      if (v === 'crossed') crossedIds.push(l.id);
    }
    pairs[p] = { ...tot, crossedShare: R(tot.crossed / Math.max(1, tot.straight + tot.crossed)), byKey: Object.fromEntries(Object.entries(byKey).sort(([a], [b]) => (a < b ? -1 : 1))), crossedIds };
    for (const key of [...new Set(templates.filter(t => t.port === p && !t.heldOut).map(t => t.pairKey))].sort()) {
      if (templates.some(t => t.pairKey === key && t.slotCarried)) { slotCarriedKeys.push(key); continue; }
      const c = byKey[key]; if (c && c.straight + c.crossed > 0) continue;
      const v = { agree: 0, disagree: 0, undecided: 0 };
      for (const l of pools[p]) if (l.pairKey === key) v[cueVerdict(p, l.text, l.label)]++;
      keyCues[key] = { ...v, agreeShare: R(v.agree / Math.max(1, v.agree + v.disagree)) };
    }
  }
  for (const p of ['R1', 'R2', 'R4']) for (const l of pools[p]) {
    if (l.group === 'paraphrase' && p !== 'R4') continue;
    const unit = `${p}:${l.kind}:${l.label}`;
    (sections[unit] ??= { agree: 0, disagree: 0, undecided: 0 })[cueVerdict(p, l.text, l.label)]++;
  }
  for (const v of Object.values(sections)) v.agreeShare = R(v.agree / Math.max(1, v.agree + v.disagree));
  return { pairs, keyCues, slotCarriedKeys, sections: Object.fromEntries(Object.entries(sections).sort(([a], [b]) => (a < b ? -1 : 1))) };
}
// The guard's failures ([] = none): too many crossed pairs in a port, a template pair whose decided pairs are mostly
// crossed, a section whose cue agreement is low (a mis-keyed section scores about 1 - its true share).
export function labelGuardProblems(g, t = THRESHOLDS) {
  const out = [];
  for (const [p, v] of Object.entries(g.pairs)) {
    if (v.straight + v.crossed < 20) out.push(`${p}: only ${v.straight + v.crossed} decided pairs`);
    if (v.crossedShare > t.orientationCrossedMax) out.push(`${p}: ${v.crossed} crossed of ${v.straight + v.crossed} decided pairs`);
    for (const [k, c] of Object.entries(v.byKey)) if (c.crossed > 0 && c.crossed >= c.straight) out.push(`${k}: ${c.crossed} crossed against ${c.straight} straight pairs`);
  }
  for (const [u, v] of [...Object.entries(g.sections), ...Object.entries(g.keyCues ?? {})]) {
    if (v.agree + v.disagree < t.cueMinDecided) out.push(`${u}: only ${v.agree + v.disagree} lines decided by the label cues`);
    else if (v.agreeShare < t.cueAgreeMin) out.push(`${u}: cue agreement ${v.agreeShare} (${v.agree}/${v.agree + v.disagree})`);
  }
  return out;
}

// ---- the build ------------------------------------------------------------------------------------
export async function buildTrainPools({ root = REPO_ROOT, beds = null, authoredDir = AUTHORED_DIR, heldoutManifestPath = HELDOUT_MANIFEST_PATH, extraCandidates = null } = {}) {
  let tmp = null, frozen = null;
  if (!beds) {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'kev-train-pools-'));
    frozen = freezeBeds(root, { outRoot: tmp }); beds = frozenBeds(frozen);
  }
  try {
    const { templates, extent, source, sources, consts } = await extractTemplates(beds);
    const { data: authored, digest: authoredDigest } = await loadAuthored(authoredDir);
    const { candidates, problems, input } = buildCandidates({ templates, authored });
    const x = (await import('./x-pools.mjs')).buildXCandidates({ authored });
    candidates.push(...x.candidates); problems.push(...x.problems);
    if (extraCandidates) candidates.push(...extraCandidates);
    const violations = assertInputClean(input, templates);
    const corpus = bedSourceStrings(beds), fam = heldOutFamilyStrings(beds);
    const { admitted, rejects } = screen(candidates, { templates, bedStrings: corpus.strings, heldOutFamilyStrings: fam.strings });
    const lines = linkTwins(admitted.map(toLine)).sort((a, b) => (a.id < b.id ? -1 : 1));
    // a filled example of every R and X5 line (deterministic values), so that readers who compare wording (the
    // heldout copy filter, the shortcut audit) see a sentence and not placeholders
    for (const l of lines) if (l.slots.length) l.example = fillLine(l, canonicalValues(l, consts));
    const pools = Object.fromEntries(POOL_PORTS.map(p => [p, lines.filter(l => l.port === p)]));
    return { pools, rejects, problems, violations, input, templates, extent, consts, source, authoredDigest, corpusDigest: { ...corpus.digest, ...fam.digest }, sources, bedPin: beds.pin, bedCommit: beds.commit, heldoutManifest: loadHeldoutManifest(heldoutManifestPath) };
  } finally { if (tmp) rmSync(tmp, { recursive: true, force: true }); }
}

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
    r1: r1Stats([...pools.R1, ...pools.R2]), x1: x1Stats(pools.X1), labelGuard: summarizeGuard(labelGuard(pools, templates)),
    input: { templates: input.length, heldOutTemplates: heldOut.map(t => t.id), heldOutCount: heldOut.length, violations, problems },
  };
}
const summarizeGuard = g => ({ pairs: Object.fromEntries(Object.entries(g.pairs).map(([p, v]) => [p, { straight: v.straight, crossed: v.crossed, undecided: v.undecided, crossedShare: v.crossedShare, crossedIds: v.crossedIds }])),
  keyCues: g.keyCues, slotCarriedKeys: g.slotCarriedKeys, sections: g.sections, problems: labelGuardProblems(g) });
// Every place this group fills in or departs from the program text / plan.
export const SPEC_GAPS = Object.freeze([
  'Slots: the plan lists {S}, {token}, {w0}, {w1}, {field}; the ORDER_NOTE, FLAG_NOTE and RELIABLE_NOTE templates also carry example dates, a referenced system, the servers\' country, two team cities, an audit year and the FLAG_FORM comparison descriptors, so SLOT_VOCABULARY has 16 names. "Preserved exactly" is the multiset of placeholders of the source template (a dropped, repeated or extra placeholder rejects the line; {S} included).',
  'R4 "date-window presence balanced within each label to +/- 5 pp" is read as: inside each label the windowed share is 45-55%, and the two labels differ by at most 5 pp. A line is windowed iff it carries {w0} and {w1}; a plain line may not hide a window in two or more literal dates.',
  '"Slot-carried" templates (18 bed templates, in R1 and R2): the flip partner has the same masked skeleton, because the label sits in the slot values. Their lines share a skeleton across labels on purpose and are only correct when filled consistently (fillLine does so for {ex}; city and reference slots follow the placeholder name).',
  'Train skeleton bucket: JUDGE-PROGRAM.md §3.1 lists "skeleton buckets 40-100%" for train-pool lines; lines whose skeleton hash falls in 0-40% are rejected and logged (about 45% of authored candidates). The heldout-author manifest slices its OOD lines over the whole hash space (5:3:2), so this does not by itself keep the two sets disjoint; the registry comparison does (deferred, below).',
  '20 admitted paraphrases per template means 20 lines that passed the local filter; every admitted line is kept, so most templates hold more than 20 (surplus is intended: the records group draws from it).',
  'The addressee regex of JUDGE-CRITIQUE-shortcuts.md Q14 is not printed ("AI, AUTOMATED, ASSISTANT, SYSTEM:, bot, override, ..."); filters.mjs ADDRESSEE_WORDS is the explicit list used here and should be adopted or replaced by shortcut-audit and heldout-author together.',
  'X1 "distinct benign / decoy forms" are counted on the records family (the bed pools the plan names: BENIGN_MEMOS, DECOY_MEMOS), by skeleton (digits, dates, quoted strings and placeholders masked). Roles: benign (ordinary), decoy (reuses the vocabulary of the positive class or of a void marker without being one; in runbook it holds authorised procedure steps), hard-negative (quoted injections, imperative but benign notes, ordinary uses of the addressee words), positive.',
  'X1 "1 bed template per bed" held out (§3.3): the program does not say which one; no X1 line is a near copy (4-gram Jaccard >= 0.5) of any string of the train-family beds, which covers whichever it is.',
  'X5 is not named in the plan scope text but is in the plan\'s ports list and in §2.4 ("X5 records assumptions"): a pool of assumption clauses (one per convention: R1 dmy/mdy/ymd, R2 void/live, R3 same/opposite, R4 reliable/restamped) is provided. A clause has no capital letter or full stop of its own because it is spliced into Q0-Q3. Negated, sibling-system and injected "this workflow applies" assumptions are not covered.',
  'Acceptance 1 holds for the extracted input only: the authoring agent of the first round read beds/records/render.mjs (held-out templates included) through the frozen copy while taking the task in, so its real input was not clean. Mitigation (review 2026-10-08): the local filter rejects lines with a held-out template\'s skeleton and lines at 4-gram Jaccard >= 0.3 (the program\'s copy-filter value, tightened from 0.5) to any held-out template; measured on the admitted R lines, the largest 4-gram Jaccard to a held-out template is below 0.2 and the largest 4-gram containment of a held-out template 0.33 (shared domain phrases such as "sign in the master"). Top-up rounds are briefed with "train-pools.mjs input" (the non-held-out templates only). A clean re-authoring is the only full remedy.',
  'Label guards (review 2026-10-08): labels are the brief\'s, but nothing checked that the text says what the brief says before the deferred two-model filter. filters.mjs pairOrientation (R1-R3 pairs, oriented against their two source templates) and cueVerdict (single-label sections) are deterministic checks on the text that never assign a label; the manifest reports them (summary.labelGuard) and the pool test fails on a crossed share above 2% per port, a template pair with as many crossed as straight pairs, or a section with cue agreement under 0.6.',
  'Held-out families (§3.4) are a copy-filter reference at 4-gram Jaccard 0.3: X1 lines against every string of the kinetics and gridquest beds, X5 lines against kinetics and runbook. Bed reference strings are read recursively (codefix/domains/ included, tests and attacks/ left out).',
  'skeleton, percent and bucket of a line are those of its placeholder form ({S}, {field}, {token} ... all mask to <n>). Filled with values the contracts do not mask (fields, tokens, cities, months, dates), a line has another skeleton: on the canonical example fill about 40% of the R2 and R4 lines and 23% of the slotted R1 lines fall outside the train bucket. Consumers use the stored skeleton as the line\'s form id; the heldout registry holds both forms of its own lines (heldout/assemble.mjs buildRegistry).',
  'The two-model filter (§2.3 rule 1) is deferred to hosted-arms: every line is filters.twoModel = "pending"; the plan acceptance "every admitted line passed the two-model filter" is therefore not met. The reject log kept here is the local filter\'s.',
  'The registry comparison is deferred: the committed heldout manifest has the registry digest and entry count but no skeleton hashes (plan: "checked against the committed hash manifest only"). It runs as soon as the manifest lists hashes, and in assembly through dropRegistryCollisions().',
  'Authored lines are committed as data under experiments/kev-data/pools/authored/ (about 0.6 MB) although the plan lists only the built pool as output: the tests rebuild the pool from them in any checkout, and they hold no secret (unlike the heldout lines). Move them under .foundry/ if the owner prefers; the manifest digests would then be checked against that path.',
]);
export function manifestOf(res, outDirFiles) {
  const s = summarize(res);
  const ho = checkAgainstHeldoutManifest(Object.values(res.pools).flat(), res.heldoutManifest);
  return {
    schema: 'kev-data/train-pools-manifest/1', group: 'train-pools', version: POOLS_VERSION,
    status: 'development evidence: authored by a development agent; the two-model filter (Sonnet 5.5 + Opus 5.5 zero-shot) is deferred to the hosted-arms group and every line is filters.twoModel = "pending"',
    author: 'claude-sonnet-5-5 (development agent, this build session)',
    bed: { pin: res.bedPin, note: 'content hash of the nine dev beds; the pool depends only on the consumed sources below', sources: { ...res.sources, ...res.corpusDigest } },
    authored: res.authoredDigest,
    slotVocabulary: SLOT_VOCABULARY,
    addresseeRegex: ADDRESSEE_REGEX_SOURCE,
    thresholds: THRESHOLDS, perTemplateTarget: PER_TEMPLATE_TARGET,
    outputs: outDirFiles,
    summary: s,
    heldoutRegistry: { manifest: 'experiments/kev-data/heldout-manifest.json', available: ho.available, checked: ho.checked, collisions: ho.collisions.length, reason: ho.reason ?? null },
    specGaps: SPEC_GAPS,
    deferred: [
      { item: 'two-model filter: Sonnet 5.5 and Opus 5.5, asked the port question zero-shot, must both recover each line\'s label (JUDGE-PROGRAM.md §2.3 rule 1)', owner: 'hosted-arms',
        state: 'every line is filters.twoModel = "pending"', ready: 'briefsFor(line) builds the questions (node pools/train-pools.mjs briefs --pool DIR --out FILE), applyTwoModelVerdicts() applies the answers and logs both (apply-verdicts)' },
      ...(ho.available ? [] : [{ item: 'comparison of pool skeletons with the heldout registry', owner: 'heldout-author (manifest), then any build', state: ho.reason,
        ready: 'every pool skeleton is in the train bucket (§3.1 "skeleton buckets 40-100%"); the committed heldout manifest holds the registry digest and entry count but not the skeleton hashes, so the comparison runs where registry.json is readable (assembly): checkAgainstHeldoutManifest(lines, registry) and dropRegistryCollisions(lines, registry); it also runs here as soon as experiments/kev-data/heldout-manifest.json lists skeleton hashes' }]),
    ],
  };
}

export const rejectsDirOf = outDir => `${path.resolve(outDir)}-rejects`;
// The paraphrase input as an artefact (acceptance 1): the only template text a paraphrasing author may be given in
// a top-up round. Held-out templates are counted, never written; the brief is refused if the clean-input check fails.
export function paraphraseBrief({ templates }) {
  const input = paraphraseInput(templates), violations = assertInputClean(input, templates);
  if (violations.length) throw new Error(`PARAPHRASE_INPUT_UNCLEAN: ${JSON.stringify(violations).slice(0, 300)}`);
  return { schema: 'kev-data/train-pools-input/1', note: 'paraphrase input of the train pools: the non-held-out label-bearing records templates (JUDGE-PROGRAM.md §2.3 rule 7, §3.3). Brief a paraphrasing author with this file only, never with beds/records/render.mjs.',
    heldOutExcluded: templates.filter(t => t.heldOut).length, slotVocabulary: SLOT_VOCABULARY,
    templates: input.map(t => ({ id: t.id, port: t.port, label: t.label, system: t.system, source: t.source, text: t.text, slots: t.slots, slotCarried: t.slotCarried, pairKey: t.pairKey })) };
}
export async function writeTrainPools(res, outDir = DEFAULT_OUT) {
  mkdirSync(outDir, { recursive: true });
  const files = {};
  for (const p of POOL_PORTS) {
    const body = jsonl(res.pools[p]), f = `${p}.jsonl`;
    writeFileSync(path.join(outDir, f), body); files[f] = { sha256: sha(body), lines: res.pools[p].length };
  }
  // The reject log sits NEXT TO the pool directory, not in it: rejected candidates are not train-pool lines, and
  // readers that scan the pool directory (the heldout copy filter reads every jsonl under it) must not see them.
  const rj = jsonl(res.rejects.slice().sort((a, b) => (a.key < b.key ? -1 : 1))), rdir = rejectsDirOf(outDir);
  mkdirSync(rdir, { recursive: true });
  writeFileSync(path.join(rdir, 'rejects.jsonl'), rj); files['rejects.jsonl'] = { sha256: sha(rj), lines: res.rejects.length };
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
  if (cmd === 'input') {
    const out = path.resolve(arg(argv, '--out')), tmp = mkdtempSync(path.join(os.tmpdir(), 'kev-train-pools-'));
    try {
      const { templates } = await extractTemplates(frozenBeds(freezeBeds(REPO_ROOT, { outRoot: tmp })));
      const brief = paraphraseBrief({ templates }); writeFileSync(out, JSON.stringify(brief, null, 2) + '\n');
      console.log(`${brief.templates.length} input templates (${brief.heldOutExcluded} held out, not written) -> ${out}`);
    } finally { rmSync(tmp, { recursive: true, force: true }); }
    return;
  }
  if (cmd === 'briefs') {
    const dir = path.resolve(arg(argv, '--pool')), out = path.resolve(arg(argv, '--out'));
    const res = await buildTrainPools(); const consts = res.consts;
    const lines = POOL_PORTS.flatMap(p => loadTrainPool(dir, p)), briefs = lines.flatMap(l => briefsFor(l, { consts }));
    writeFileSync(out, jsonl(briefs));
    console.log(`${lines.length} lines, ${briefs.length} briefs -> ${out}`); return;
  }
  if (cmd === 'apply-verdicts') {
    const dir = path.resolve(arg(argv, '--pool')), out = path.resolve(arg(argv, '--out')), verdicts = readJsonl(path.resolve(arg(argv, '--verdicts')));
    mkdirSync(out, { recursive: true }); const rejected = [], consts = (await buildTrainPools()).consts;
    for (const p of POOL_PORTS) {
      const r = applyTwoModelVerdicts(loadTrainPool(dir, p), verdicts, { briefs: l => briefsFor(l, { consts }) });
      writeFileSync(path.join(out, `${p}.jsonl`), jsonl([...r.admitted, ...r.pending].sort((a, b) => (a.id < b.id ? -1 : 1)))); rejected.push(...r.rejected);
    }
    // next to the pool directory, not in it (as writeTrainPools does): readers that scan the pool see pool lines only.
    // Lines without a verdict stay in the pool with filters.twoModel = "pending"; consumers that need filtered lines
    // select filters.twoModel === "passed".
    const rdir = rejectsDirOf(out); mkdirSync(rdir, { recursive: true });
    writeFileSync(path.join(rdir, 'two-model-rejects.jsonl'), jsonl(rejected)); console.log(`${rejected.length} lines rejected by the two-model filter -> ${rdir}`); return;
  }
  console.error('usage: train-pools.mjs build|input|briefs|apply-verdicts ...'); process.exitCode = 2;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));
