// X1:synth injected_instruction (JUDGE-PROGRAM.md §1.2 X1: "synth: the world.injection claim sentence is yes (render.mjs:212).
// Ordinary, prediction and protocol sentences are no."; addressee-word balance; §2.5 long; §2.3 rule 9 deployment rate bed-natural).
// A row is a span of one document with its neighbours (the sentence plus or minus one sentence, or the whole document for the
// long variant): the state is {source_kind, text}.
//   yes   the bed's injection sentence (d5: one per task; three phrasings) and the authored positives of the train pools (no addressee
//         word in about 60%) or of the held-out store, inserted into a document at a sentence boundary
//   no    windows around ordinary claim sentences (measured, quoted, predicted, bound), around the imperative lines of notices
//         ("Its results should not be used."), around bracketed banners, around the bed's noise lines, and the authored negatives
//         (benign memos, decoys, hard negatives, a third of them carrying an addressee word)
// Negatives are matched to the positives' source kind (document, memo), so the kind does not carry the label.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { spanHash, skeletonBucket, sentences as registrySentences, skeleton } from '../lib/hash.mjs';
import { importanceWeights } from '../lib/balance.mjs';
import { INJECTION_CUE, NOISE, CLOSING, LABNOTE_CLOSING, NOTICE_IMPERATIVES, KIND_OF_TYPE } from '../taps/synth-frames.mjs';
import { sentenceSpans, SOURCE_KINDS, kindOfType } from '../judges/synth.mjs';
import { makeRecord, paraphraseOf, hnum, sha, byHash, unit01, bump, textAllowed, formOf, OOD, BUCKET_OF_SLICE, fail, pickBy } from './synth-core.mjs';

export const X1_NATURAL = Object.freeze({ yes: 0.01, no: 0.99 });   // estimate: "well under 1% of lines" (JUDGE-PROGRAM.md §1.2 X1)
const ADDRESSEE = /\b(?:AI|LLM|automated|automation|assistants?|agents?|bots?|chatbots?|override[sd]?|overriding|language model|SYSTEM:)\b/i;
export const hasAddressee = t => ADDRESSEE.test(t);
const NOISE_SET = new Set([...Object.values(NOISE).flat(), ...CLOSING, ...LABNOTE_CLOSING]);
const PLACEHOLDER = /\{[A-Za-z_][A-Za-z0-9_]*\}/;

// ---- authored lines (train pools, held-out store lines through opts.lines) -------------------------------------------------------
function readPool(dir, port, digest) {
  const file = path.join(dir, `${port}.jsonl`);
  if (!existsSync(file)) return [];
  const body = readFileSync(file, 'utf8'), got = `sha256:${sha(body)}`;
  if (digest !== undefined && digest !== null && digest !== got) throw fail('POOL_DIGEST', `${file} hashes to ${got}, opts.pools.digest says ${digest}`);
  return body.split('\n').filter(Boolean).map(l => JSON.parse(l));
}
const lineFilter = l => l.filters?.twoModel ?? (typeof l.filter === 'string' ? l.filter : l.filter?.status) ?? 'pending';
// the authored lines X1:synth may use in `slice`: train-like slices take the train pool lines of the synth family; an OOD slice takes the
// held-out store lines tagged with its own name (never a line of another slice)
export function authoredLines(G) {
  const o = G.opts, out = [];
  const train = !OOD.has(G.slice);
  let raw = [...(o.lines ?? [])];
  if (train && o.pools?.dir) raw = [...readPool(o.pools.dir, 'X1', o.pools.digest), ...raw];
  for (const l of raw) {
    if (!l || l.port !== 'X1' || typeof l.text !== 'string' || !l.text.trim()) continue;
    if (!['yes', 'no'].includes(l.label)) continue;
    if (l.family !== undefined && l.family !== 'synth' && train) continue;
    if (PLACEHOLDER.test(l.text)) { bump(G, 'x1:placeholder-skipped'); continue; }
    if (l.role === 'carrier') continue;
    if (train ? (l.slice ?? 'train') !== 'train' : l.slice !== G.slice) continue;
    out.push({ text: l.text, label: l.label, id: l.id ?? sha(l.text).slice(0, 12), addressee: l.addressee ?? hasAddressee(l.text), role: l.role ?? 'authored', filter: lineFilter(l), source: l.slice ? 'heldout' : 'train-pool' });
  }
  return out;
}

// ---- candidates of a world ----------------------------------------------------------------------------------------------------------
const kindOfDoc = d => kindOfType(d.type);
const sourceKindOf = d => SOURCE_KINDS[kindOfDoc(d)] ?? 'document';
function windows(doc) {
  const spans = sentenceSpans(doc.text);
  return spans.map((s, i) => ({ i, s, from: spans[Math.max(0, i - 1)].start, to: spans[Math.min(spans.length - 1, i + 1)].end, text: doc.text.slice(spans[Math.max(0, i - 1)].start, spans[Math.min(spans.length - 1, i + 1)].end) }));
}
export function x1Candidates(G, W) {
  const out = [], { slice } = G;
  const claimSentences = new Map();                                       // doc id -> Map(sentence text -> mode)
  for (const r of W.tap.claims) if (r.status === 'aligned') (claimSentences.get(r.doc) ?? claimSentences.set(r.doc, new Map()).get(r.doc)).set(r.sentence, r.mode);
  for (const doc of W.parsed.documents) {
    const kind = kindOfDoc(doc), notice = ['erratum', 'retraction', 'concern'].includes(kind), sk = sourceKindOf(doc);
    const ws = windows(doc), inj = ws.some(w => INJECTION_CUE.test(w.s.text));
    for (const w of ws) {
      const t = w.s.text;
      let label = null, cls = null, hard = false;
      if (INJECTION_CUE.test(t)) { label = 'yes'; cls = 'injection'; }
      else if (INJECTION_CUE.test(w.text)) continue;                   // a neighbour of the injection sentence is not a negative
      else if (claimSentences.get(doc.id)?.has(t)) { label = 'no'; const m = claimSentences.get(doc.id).get(t); cls = `claim-${m}`; hard = m !== 'measured'; }
      else if (notice && NOTICE_IMPERATIVES.some(x => t.includes(x))) { label = 'no'; cls = 'procedure'; hard = true; }
      else if (/^\[.*\]$/.test(t) && !INJECTION_CUE.test(t)) { label = 'no'; cls = 'banner'; hard = true; }
      else if (NOISE_SET.has(t)) { label = 'no'; cls = 'noise'; }
      else continue;
      const form = formOf(t, W.masks);
      if (!textAllowed(slice, form, w.text, W.masks)) { bump(G, 'x1:bucket'); continue; }
      out.push({ id: `${W.seed}:${doc.id}:${w.i}`, seed: W.seed, label, cls, hard, source: 'bed', docId: doc.id, sourceKind: sk, text: w.text, sentence: t, form, addressee: hasAddressee(t),
        slots: { document: doc.id, text: w.text }, host: doc.id });
    }
    // the long variant: the whole document, relaxed bucket rule (a document has too many sentences for all of them to be of one bucket)
    if (G.opts.long !== false && !notice && kind !== 'press') {
      const noHeld = slice === 'test-ood' || registrySentences(doc.text).every(s => skeletonBucket(skeleton(s, W.masks)) !== 'test-ood');
      if (noHeld) out.push({ id: `${W.seed}:${doc.id}:long`, seed: W.seed, label: inj ? 'yes' : 'no', cls: inj ? 'injection-long' : 'document-long', hard: false, source: 'bed', docId: doc.id, sourceKind: sk, text: doc.text,
        sentence: inj ? ws.find(w => INJECTION_CUE.test(w.s.text)).s.text : doc.text.slice(0, 80), form: formOf(inj ? ws.find(w => INJECTION_CUE.test(w.s.text)).s.text : doc.text, W.masks), addressee: inj ? hasAddressee(ws.find(w => INJECTION_CUE.test(w.s.text)).s.text) : false, slots: { document: doc.id, text: doc.text }, host: doc.id, long: true });
    }
  }
  return out;
}

// An authored line inserted into a window of one of the world's documents at a sentence boundary (the host keeps its neighbours).
export function authoredCandidates(G, W, lines, perLabel) {
  const out = [];
  if (!lines.length) return out;
  const docs = W.parsed.documents.filter(d => ['journal', 'preprint', 'labnote'].includes(kindOfDoc(d)));
  for (const label of ['yes', 'no']) {
    const ordered = lines.filter(l => l.label === label).sort((a, b) => byHash(sha(`${G.slice}|${W.seed}|${a.id}`), sha(`${G.slice}|${W.seed}|${b.id}`)));
    for (const l of ordered.slice(0, perLabel)) {
      // the first host (document, boundary) in a hashed order whose neighbouring sentences obey the slice's skeleton buckets
      const hosts = [];
      for (const doc of docs) { const spans = sentenceSpans(doc.text); for (let at = 1; at < spans.length; at++) hosts.push({ doc, at, spans }); }
      hosts.sort((a, b) => byHash(sha(`${G.slice}|${W.seed}|${l.id}|${a.doc.id}|${a.at}`), sha(`${G.slice}|${W.seed}|${l.id}|${b.doc.id}|${b.at}`)));
      let made = false;
      for (const h of hosts.slice(0, 40)) {
        const prev = h.spans[h.at - 1].text, next = h.spans[h.at].text, text = `${prev} ${l.text} ${next}`;
        if (!textAllowed(G.slice, null, `${prev} ${next}`, W.masks) || INJECTION_CUE.test(`${prev} ${next}`)) continue;
        out.push({ id: `${W.seed}:${h.doc.id}:L${l.id}`, seed: W.seed, label: l.label, cls: `authored-${l.role}`, hard: l.role === 'hard-negative', source: l.source, docId: h.doc.id, sourceKind: sourceKindOf(h.doc), text, sentence: l.text, form: formOf(l.text, W.masks), addressee: l.addressee,
          slots: { document: h.doc.id, text }, host: h.doc.id, authored: { id: l.id, filter: l.filter, role: l.role, lineHash: spanHash(l.text) }, reproducible: false });
        made = true; break;
      }
      if (!made) bump(G, 'x1:authored-host-bucket');
    }
  }
  return out;
}

export function x1Record(G, W, c, key, extra = {}) {
  const state = { source_kind: c.sourceKind, text: c.text };
  return makeRecord({ contract: G.contracts.X1, slice: G.slice, opts: G.opts, key, state, label: c.label, labelSource: c.authored ? 'authored-brief' : 'generator',
    meta: { seed: W.seed, difficulty: W.difficulty, worldHash: W.wh, variant: c.long ? 'long' : 'clean', formId: c.form, surface: { source: c.authored ? 'authored' : 'bed', slice: G.slice, lineHash: spanHash(c.sentence), ...(c.authored ? { filter: c.authored.filter, line: c.authored.lineHash } : {}) },
      masks: W.masks, kit: { port: 'X1', slots: c.slots, ...(c.reproducible === false ? { reproducible: false } : {}) },
      x1: { cls: c.cls, hard: c.hard, source: c.source, addressee: c.addressee, sourceKind: c.sourceKind, host: c.host }, ...extra } });
}

// ---- the draw --------------------------------------------------------------------------------------------------------------------------------------
// plan per slice: positives share, long share, natural-rate part
function x1Plan(slice, n) {
  if (slice === 'calib-ood') return [{ name: 'enriched', n, pos: 0.25, weights: true }];
  if (slice === 'test-ood') return [{ name: 'balanced', n: Math.round(n * 192 / 692), pos: 0.5 }, { name: 'natural', n: n - Math.round(n * 192 / 692), pos: X1_NATURAL.yes }];
  return [{ name: slice === 'train' ? 'train' : 'balanced', n, pos: 0.5 }];
}
const take = (list, k, used) => { const out = []; for (const c of list) { if (out.length >= k) break; if (!used.has(c.id)) { out.push(c); used.add(c.id); } } return out; };
export function x1Records(G, cands, worlds) {
  const slice = G.slice, n = G.opts.rows?.['X1:synth'] ?? G.targets['X1:synth']?.[slice];
  if (!n) return { records: [], report: null };
  const plan = x1Plan(slice, n), used = new Set(), records = [], report = { slice, n, axes: {}, supply: {} };
  const bySalt = salt => (a, b) => byHash(sha(`${salt}|${a.id}`), sha(`${salt}|${b.id}`));
  const group = (label, f) => cands.filter(c => c.label === label && f(c));
  report.supply = { yes: cands.filter(c => c.label === 'yes').length, no: cands.filter(c => c.label === 'no').length, authored: cands.filter(c => c.authored).length };
  const longShare = slice === 'train' ? 0.05 : 0.1;
  for (const ax of plan) {
    const nPos = Math.round(ax.n * ax.pos), nNeg = ax.n - nPos, salt = `${slice}|X1|${ax.name}`;
    const rows = [], rep = { want: { yes: nPos, no: nNeg }, taken: {}, shortfall: {} };
    // positives: the authored positives without an addressee word first (at least half), then the bed's injection sentences, then authored with one
    const posAuthNo = group('yes', c => c.authored && !c.addressee).sort(bySalt(salt)), posAuthAddr = group('yes', c => c.authored && c.addressee).sort(bySalt(salt)), posBed = group('yes', c => !c.authored && !c.long).sort(bySalt(salt)), posLong = group('yes', c => c.long).sort(bySalt(salt));
    const nLong = Math.round(nPos * longShare);
    const pos = [];
    pos.push(...take(posLong, nLong, used));
    const wantNoAddr = Math.ceil((nPos - pos.length) * 0.55);
    pos.push(...take(posAuthNo, wantNoAddr, used));
    pos.push(...take(posBed, Math.max(0, nPos - pos.length - Math.ceil((nPos - pos.length) * 0.1)), used));
    pos.push(...take(posAuthAddr, nPos - pos.length, used));
    pos.push(...take(posBed, nPos - pos.length, used));
    pos.push(...take(posAuthNo, nPos - pos.length, used));
    // negatives: matched to the positives' source kind; the authored negatives carrying an addressee word are at least 30%
    const kinds = {};
    for (const c of pos) kinds[c.sourceKind] = (kinds[c.sourceKind] ?? 0) + 1;
    const negAuthAddr = group('no', c => c.authored && c.addressee).sort(bySalt(salt)), negAuthNo = group('no', c => c.authored && !c.addressee).sort(bySalt(salt));
    const negBed = group('no', c => !c.authored && !c.long).sort(bySalt(salt)), negLong = group('no', c => c.long).sort(bySalt(salt));
    const neg = [];
    const nNegLong = Math.round(nNeg * longShare);
    neg.push(...take(negLong, nNegLong, used));
    neg.push(...take(negAuthAddr, Math.ceil(nNeg * 0.35), used));
    neg.push(...take(negAuthNo, Math.ceil(nNeg * 0.10), used));
    // the bed's negatives per source kind of the positives, hard ones weighted up
    for (const [sk, k] of Object.entries(kinds)) {
      const want = Math.max(0, Math.round((nNeg - neg.length) * k / Math.max(1, pos.length)));
      const pool = negBed.filter(c => c.sourceKind === sk && !used.has(c.id));
      const hard = pool.filter(c => c.hard), plain = pool.filter(c => !c.hard);
      const take1 = [];
      for (let i = 0; i < want; i++) { const src = (i % 2 === 0 ? hard : plain).length ? (i % 2 === 0 ? hard : plain) : (hard.length ? hard : plain); const c = src.shift(); if (!c) break; take1.push(c); used.add(c.id); }
      neg.push(...take1);
    }
    neg.push(...take(negBed, nNeg - neg.length, used));
    rows.push(...pos, ...neg);
    rep.taken = { yes: pos.length, no: neg.length };
    for (const l of ['yes', 'no']) if (rep.taken[l] < rep.want[l]) rep.shortfall[l] = rep.want[l] - rep.taken[l];
    const weights = ax.weights ? importanceWeights(rows, { label: c => c.label, target: X1_NATURAL }) : null;
    report.axes[ax.name] = rep;
    rows.sort(bySalt(`${salt}|order`));
    for (const c of rows) {
      const W = worlds.get(c.seed), key = `${slice}|X1|${c.id}`;
      let rec = x1Record(G, W, c, key, { x1set: ax.name, ...(weights ? { weight: Number(weights[c.label].toFixed(6)) } : {}) });
      if (slice === 'test-ood' && !c.long && unit01(`${key}|para`) < 0.1) rec = paraphraseOf(rec, G.contracts.X1, slice, G.opts, key) ?? rec;
      records.push(rec);
    }
  }
  report.rows = records.length;
  const labels = {}; let addrPos = 0, nPosAll = 0, addrNeg = 0, nNegAll = 0;
  for (const r of records) { const l = Object.values(r.questions)[0].label; labels[l] = (labels[l] ?? 0) + 1; if (l === 'yes') { nPosAll++; if (r.meta.x1.addressee) addrPos++; } else { nNegAll++; if (r.meta.x1.addressee) addrNeg++; } }
  report.labels = labels; report.addressee = { positivesWithout: nPosAll ? 1 - addrPos / nPosAll : null, negativesWith: nNegAll ? addrNeg / nNegAll : null };
  return { records, report };
}
