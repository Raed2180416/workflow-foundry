// BM25F ranking of member views for `find(need)`, ARCHITECTURE.md §2.4. A port of experiments/library/retrieve.mjs bm25Index (same
// tokenizer, k1 1.2, b 0.75) with per-field weights: name x3, system x2, intents x2, summary x1, argument names x0.5. With one field of
// weight 1 it equals bm25Index exactly (tests/nodecap-resolve.test.mjs checks parity). Deterministic; ties break by id.
export const BM25_PARAMS = Object.freeze({ k1: 1.2, b: 0.75 });
export const FIELD_WEIGHTS = Object.freeze({ name: 3, system: 2, intents: 2, summary: 1, args: 0.5 });
// The same closed stop list as experiments/library/retrieve.mjs (parity is tested).
const STOP = new Set(('a an and are as at be by can do does each for from has have if in into is it its may must no not of on one or '
  + 'that the then this to was what when where which with without would should their there these those than so such any all '
  + 'only also more most other some same than very via per p v ev slots tier').split(' '));
export const tokenize = text => (String(text ?? '').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter(w => w.length > 1 && !STOP.has(w) && !/^\d+$/.test(w));
/**
 * A light English suffix stemmer for need ranking (fix round 2026-11-04, review-cost B1: "deals" did not match "deal", nor "refunded"
 * "refund", so a typed object pointing at the wrong member won the ranking). Plural -s/-es/-ies, past -ed, gerund -ing; nothing else.
 * Used only where a need is ranked (stem: true); the library-parity index and the standby cap keep the plain tokenizer.
 */
export function stem(w) {
  if (w.length > 4 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.length > 4 && /(?:sses|xes|ches|shes)$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !/(?:ss|us|is)$/.test(w)) return w.slice(0, -1);
  if (w.length > 5 && w.endsWith('ed')) return w.slice(0, -2);
  if (w.length > 6 && w.endsWith('ing')) return w.slice(0, -3);
  return w;
}

/** docs: [{id, fields: {name, system, intents, summary, args}}] (each field a string). `stem`: rank on stemmed tokens (need ranking). */
export function bm25fIndex(docs, { weights = FIELD_WEIGHTS, k1 = BM25_PARAMS.k1, b = BM25_PARAMS.b, stem: stemmed = false } = {}) {
  const toks = text => stemmed ? tokenize(text).map(stem) : tokenize(text);
  const tf = docs.map(d => {
    const m = new Map();
    let len = 0;
    for (const [field, weight] of Object.entries(weights)) for (const w of toks(d.fields[field])) { m.set(w, (m.get(w) ?? 0) + weight); len += weight; }
    return { id: d.id, m, len };
  });
  const N = tf.length, avgdl = tf.reduce((a, d) => a + d.len, 0) / Math.max(1, N), df = new Map();
  for (const d of tf) for (const w of d.m.keys()) df.set(w, (df.get(w) ?? 0) + 1);
  const idf = w => { const n = df.get(w) ?? 0; return Math.log(1 + (N - n + 0.5) / (n + 0.5)); };
  return {
    n: N, avgdl,
    score(query) {
      const q = [...new Set(toks(query))].filter(w => df.has(w)), out = new Map();
      for (const d of tf) {
        let s = 0;
        for (const w of q) { const f = d.m.get(w); if (f) s += idf(w) * (f * (k1 + 1)) / (f + k1 * (1 - b + b * d.len / avgdl)); }
        if (s > 0) out.set(d.id, s);
      }
      return out;
    },
    /** [{id, score}] best first, ties by id; at most k. */
    rank(query, k = 5) { return [...this.score(query).entries()].map(([id, score]) => ({ id, score })).sort((x, y) => y.score - x.score || (x.id < y.id ? -1 : 1)).slice(0, k); }
  };
}
/** The fields of one member (authored text only: view name, system, owner intents, view summary, view argument names). */
export const memberFields = member => ({ name: `${member.view.name} ${member.id.replace(/[._-]/g, ' ')}`, system: member.system, intents: (member.intents ?? []).join(' '),
  summary: member.view.summary, args: Object.keys(member.view.inputSchema?.properties ?? {}).join(' ') });
export const indexMembers = (members, options) => bm25fIndex(members.map(m => ({ id: m.id, fields: memberFields(m) })), options);
