// Leakage guards for the Kev data factory (JUDGE-PROGRAM.md §2.3 rules 2, 3 and 7).
//   forbidden exact key names in states (shared with the runtime port kits)
//   unrendered bed-internal ids
//   the span-skeleton registry: masked skeletons of every held-out surface, checked against every
//     port's states, sentence by sentence (a hit is re-rendered by lib/counterfactual.mjs or the
//     record is dropped and counted; the build fails on any hit that reaches a file)
//   wording exclusion: no held-out wording, exact or whitespace-normalised, outside its own slice
import { FORBIDDEN_STATE_KEYS, findForbiddenKeys } from '../../../src/judges/kit.mjs';
import { sentences, skeleton, skeletonText } from './hash.mjs';
import { normalizeWs, questionOf, wordingPattern } from './render.mjs';

export { FORBIDDEN_STATE_KEYS, findForbiddenKeys };

export function checkStateKeys(state) {
  const hits = findForbiddenKeys(state);
  return { ok: hits.length === 0, hits };
}

// Every string value of a state with its key path ('source_note', 'log_lines.3', 'source.doc_type').
export function stringLeaves(state) {
  const out = [];
  const walk = (v, path) => {
    if (typeof v === 'string') out.push({ path: path.join('.'), text: v });
    else if (Array.isArray(v)) v.forEach((x, i) => walk(x, [...path, i]));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, [...path, k]);
  };
  walk(state, []);
  return out;
}

// Bed-internal ids that the bed never renders must not appear in a state, as a value or a key.
export function findUnrenderedIds(state, ids) {
  const list = [...new Set(ids)].filter(s => typeof s === 'string' && s.length >= 3);
  const found = [];
  const text = JSON.stringify(state);
  for (const id of list) if (text.includes(id)) found.push(id);
  return found;
}

// Slices whose states must not contain any held-out surface (§2.3 rule 7).
export const TRAIN_LIKE = Object.freeze(['train', 'calib-in', 'dev-select']);
export const OOD_SLICES = Object.freeze(['calib-ood', 'dev-ood', 'test-ood']);

// Does a registered span of `entrySlice` leak into a state of `slice`? Rule 7 checks train,
// calib-in and dev-select against every registered span, and each OOD slice against the others.
// Entry slice 'heldout' is test-OOD-only material (held-out bed templates, held-out family spans,
// held-out entity lists): it leaks into every slice but test-OOD. test-in and the reserves are not
// span-checked (rule 7 names neither); held-out wordings are checked there (WordingGuard).
export function leaksInto(entrySlice, slice) {
  if (TRAIN_LIKE.includes(slice)) return true;
  if (!OOD_SLICES.includes(slice) || entrySlice === slice) return false;
  if (entrySlice === 'heldout') return slice !== 'test-ood';
  return true;
}

// The span-skeleton registry. Entries hold the skeleton hash of a held-out span (one sentence, or
// a window of consecutive sentences), never its text, plus where it came from. scan() computes the
// skeleton of every window of 1..maxSentences consecutive sentences of every string in a state.
export class SpanRegistry {
  #entries = new Map(); #maxSentences = 1;
  constructor(entries = []) { for (const e of entries) this.#insert(e); }
  #insert(e) {
    if (!/^sha256:[0-9a-f]{64}$/.test(e.hash)) throw new Error('registry entry needs a sha256 skeleton hash');
    const list = this.#entries.get(e.hash) ?? [];
    list.push(Object.freeze({ hash: e.hash, sentences: e.sentences ?? 1, slice: e.slice ?? 'heldout', source: e.source ?? null, port: e.port ?? null, kind: e.kind ?? 'span' }));
    this.#entries.set(e.hash, list);
    this.#maxSentences = Math.max(this.#maxSentences, e.sentences ?? 1);
  }
  // span: held-out text; names/markers: the masks of its world (or of the pool's slot fillers).
  add(span, { slice, source = null, port = null, kind = 'span', names = [], markers = [] } = {}) {
    const n = sentences(span).length || 1;
    const hash = skeleton(sentences(span).join(' '), { names, markers });
    this.#insert({ hash, sentences: n, slice, source, port, kind });
    return hash;
  }
  get size() { let n = 0; for (const l of this.#entries.values()) n += l.length; return n; }
  get maxSentences() { return this.#maxSentences; }
  has(hash) { return this.#entries.has(hash); }
  entries() { return [...this.#entries.values()].flat(); }
  toJSON() { return { version: 1, entries: this.entries().sort((a, b) => a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0) }; }
  static fromJSON(obj) { if (obj?.version !== 1) throw new Error('unknown registry version'); return new SpanRegistry(obj.entries); }

  scanText(text, { names = [], markers = [] } = {}) {
    const sents = sentences(text), hits = [];
    for (let i = 0; i < sents.length; i++) {
      for (let k = 1; k <= this.#maxSentences && i + k <= sents.length; k++) {
        const window = sents.slice(i, i + k).join(' ');
        const hash = skeleton(window, { names, markers });
        const found = this.#entries.get(hash);
        if (found) for (const entry of found) if (entry.sentences === k) hits.push({ sentence: window, index: i, count: k, hash, entry });
      }
    }
    return hits;
  }
  // Hits in every string leaf of a state, optionally only those that leak into `slice`.
  scanState(state, { names = [], markers = [], slice = null } = {}) {
    const hits = [];
    for (const { path, text } of stringLeaves(state)) {
      for (const h of this.scanText(text, { names, markers })) if (!slice || leaksInto(h.entry.slice, slice)) hits.push({ path, ...h });
    }
    return hits;
  }
}
export { skeletonText };

// Held-out wordings: [{port, id, slice, text}]. check(instructions, slice) returns every held-out
// wording of another slice (rule 3: "no held-out wording of any slice, exact or whitespace-
// normalised, appears in a file of another slice or in training") that the instruction's question
// matches, with any slot filling.
export class WordingGuard {
  #items;
  constructor(wordings = []) {
    this.#items = wordings.map(w => ({ ...w, norm: normalizeWs(w.text), re: wordingPattern(w.text) }));
  }
  get size() { return this.#items.length; }
  forSlice(port, slice) { return this.#items.filter(w => w.port === port && w.slice === slice); }
  check(instructions, slice) {
    const q = normalizeWs(questionOf(instructions));
    return this.#items.filter(w => w.slice !== slice && (w.norm === q || w.re.test(q))).map(({ port, id, slice: s }) => ({ port, id, slice: s }));
  }
}
