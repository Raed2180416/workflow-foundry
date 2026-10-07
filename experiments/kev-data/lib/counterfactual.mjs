// One-sentence re-render (JUDGE-PROGRAM.md §1.2 counterfactual balancing, §2.3 rule 7, §2.5). The
// factory replaces exactly one decisive sentence of a rendered state with another line: the same
// pool's opposite polarity at the same template index (flip and balancing), another template of the
// same label (invariance), a same-register non-deciding sentence (presence-matched unknowable), or a
// non-held-out template of the same pool, label and slots (leak repair). It is a string substitution
// on the rendered text, never a renderer fork.
//
// The line provider is opaque to this module: provider(request) -> { text, from } | null, where
// request = { ...the caller's request (port, pool, label, slots, slice, index, ...), attempt, avoid }.
// `avoid` holds skeleton hashes the replacement must not have (the registry's), so a provider can
// skip held-out lines; the result is re-checked here anyway.
import { sentences, skeleton } from './hash.mjs';

const occurrences = (text, s) => { let n = 0, i = -1; while ((i = text.indexOf(s, i + 1)) >= 0) n++; return n; };

// Replace the one occurrence of `sentence` in `text` with `replacement`. Zero or several occurrences
// are not repairable by substitution: the caller drops the record and counts it.
export function replaceSentence(text, sentence, replacement) {
  if (typeof sentence !== 'string' || !sentence) return { ok: false, reason: 'empty-sentence' };
  const n = occurrences(text, sentence);
  if (n !== 1) return { ok: false, reason: n === 0 ? 'sentence-not-found' : 'sentence-ambiguous', occurrences: n };
  if (typeof replacement !== 'string' || !replacement.trim()) return { ok: false, reason: 'empty-replacement' };
  const out = text.replace(sentence, () => replacement);
  return { ok: true, text: out };
}

const getAt = (obj, path) => path.reduce((v, k) => (v == null ? undefined : v[k]), obj);
function setAt(obj, path, value) {
  const root = structuredClone(obj);
  let v = root;
  for (const k of path.slice(0, -1)) v = v[k];
  v[path.at(-1)] = value;
  return root;
}
const toPath = p => Array.isArray(p) ? p : String(p).split('.').map(k => (/^\d+$/.test(k) ? Number(k) : k));

// Re-render one sentence of one string leaf of a state through the provider. Returns
//   { ok: true, state, counterfactual: { swapped: true, from, to, path, sentence } }
//   { ok: false, reason }   (provider had no line, the sentence is absent or ambiguous, every
//                            offered line was rejected)
export function rerender(state, { path, sentence, request = {}, provider, avoid = new Set(), skeletonOpts = {}, maxAttempts = 8 }) {
  if (typeof provider !== 'function') throw new TypeError('rerender needs a line provider function');
  const p = toPath(path), text = getAt(state, p);
  if (typeof text !== 'string') return { ok: false, reason: 'path-not-a-string' };
  const tried = [];
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const line = provider({ ...request, attempt, avoid, sentence });
    if (!line) return { ok: false, reason: 'provider-exhausted', tried };
    const sk = skeleton(sentences(line.text).join(' '), skeletonOpts);
    if (avoid.has(sk) || line.text === sentence) { tried.push(line.from ?? null); continue; }
    const r = replaceSentence(text, sentence, line.text);
    if (!r.ok) return { ok: false, reason: r.reason };
    return { ok: true, state: setAt(state, p, r.text), counterfactual: { swapped: true, from: request.from ?? null, to: line.from ?? null, path: p.join('.'), sentence } };
  }
  return { ok: false, reason: 'all-candidates-rejected', tried };
}

// Leak repair (§2.3 rule 7): re-render every sentence of a state that the span registry flags,
// with a non-held-out line from the provider; request(hit) builds the provider request for a hit
// (port, pool, label, slots of that sentence). If any hit cannot be repaired the record is dropped
// (ok: false) and the caller counts it. Re-scans after repair so a replacement never leaks.
export function repairLeaks(state, { registry, slice, provider, request, skeletonOpts = {}, maxRounds = 4 }) {
  let cur = state; const swaps = [];
  const avoid = new Set(registry.entries().map(e => e.hash));
  for (let round = 0; round < maxRounds; round++) {
    const hits = registry.scanState(cur, { ...skeletonOpts, slice });
    if (!hits.length) return { ok: true, state: cur, swaps };
    const h = hits[0];
    const r = rerender(cur, { path: h.path, sentence: h.sentence, request: request(h), provider, avoid, skeletonOpts });
    if (!r.ok) return { ok: false, reason: r.reason, hit: { path: h.path, entry: h.entry } };
    cur = r.state; swaps.push(r.counterfactual);
  }
  const left = registry.scanState(cur, { ...skeletonOpts, slice });
  return left.length ? { ok: false, reason: 'unrepaired-after-rounds', hits: left.length } : { ok: true, state: cur, swaps };
}

// A provider over explicit lists: lines[key] = [{ text, from }]; request.key picks the list and
// request.index the preferred position (same template index), then the others in order.
export function listProvider(lines) {
  return ({ key, index = 0, attempt = 0 }) => {
    const list = lines[key];
    if (!list?.length) return null;
    const order = [index, ...list.map((_, i) => i).filter(i => i !== index)];
    const i = order[attempt];
    return i === undefined || !list[i] ? null : list[i];
  };
}
