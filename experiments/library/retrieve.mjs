// retrieve.mjs: code-first candidate generation (LIBRARY.md §4.2–4.3; BUILD-ORDER step 5; LIBRARY-TESTS T9 and the L2
// code arms A1, A2). Pure code, $0, deterministic: no model, no Jev, no embedding.
//
//   const r = candidates({ task, text, l1, library?, bindings?, host? });
//   // -> { candidates: [{id, layer, score, rules, bm25, bm25Rank, companionOf, profile?}] (<= 20, ranked), order: [ids],
//   //      shape, fired: [shape features], log: {pool, initial, companionsAdded, cut} }
//
// The six steps of §4.3, in order:
//   1. hard filters: tier available on this host (host.tiers), L2/L4 status in {kept, shadow} and not revoked (the index
//      already drops retired and revoked items), L4 only from the same project (host.project), L3 bindings and L2/L4
//      effect tags within host.effects;
//   2. feature rules: shape/1 (index.mjs shapeOf) against the §4.2 table (SHAPE_FEATURES): an L1 pattern enters when a
//      feature that points to it fires; `rules` = the number of fired features that point to it;
//   3. BM25 (k1 1.2, b 0.75) over each row's search text (index row `bm25`: the code-generated line, the name, the J
//      questions, an L2 task template unless untrusted) against the task text (the TaskSpec rendering when there is one);
//   4. companions: for every L1 pattern in the set, its top companion by lift (catalog `companions`, from
//      out/pattern-evidence.md; ties by co-items) is added if absent;
//   5. profile pre-check for L2/L4: checkProfile on the task, recorded beside the candidate, never dropping it;
//   6. cut to 20 by the fixed score  2 x rules + BM25 rank-normalised + 0.5 x companion  (ties by id); the order is
//      logged: it is the code baseline every Jev port must beat (JEV-PORTS §1.4).
// The initial set before companions is every row a rule hit plus the top 20 rows by BM25 (score > 0). BM25
// rank-normalised = 1 - rank / n over the n rows with a BM25 score > 0 (rank 0 is the best, so the top row gets 1); a
// row with no BM25 score gets 0.
import { buildIndex, shapeOf, SHAPE_FEATURES } from './index.mjs';
import { checkProfile } from '../jit/profile.mjs';

export const MAX_CANDIDATES = 20;
export const WEIGHTS = Object.freeze({ rule: 2, bm25: 1, companion: 0.5 });
export const BM25_PARAMS = Object.freeze({ k1: 1.2, b: 0.75 });
export const ALL_TIERS = Object.freeze(['S', 'IR', 'HOST', 'D', 'N']);
export const ALL_EFFECTS = Object.freeze(['none', 'read', 'write', 'send', 'delete', 'pay']);
const FEATURES = Object.keys(SHAPE_FEATURES);
// A small closed stop list (function words and the words every card or task carries).
const STOP = new Set(('a an and are as at be by can do does each for from has have if in into is it its may must no not of on one or '
  + 'that the then this to was what when where which with without would should their there these those than so such any all '
  + 'only also more most other some same than very via per p v ev slots tier').split(' '));
export const tokenize = text => (String(text ?? '').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter(w => w.length > 1 && !STOP.has(w) && !/^\d+$/.test(w));

// BM25 over docs [{id, text}]. score(query) -> Map(id -> score > 0).
export function bm25Index(docs, { k1 = BM25_PARAMS.k1, b = BM25_PARAMS.b } = {}) {
  const tf = docs.map(d => { const m = new Map(); for (const w of tokenize(d.text)) m.set(w, (m.get(w) ?? 0) + 1); return { id: d.id, m, len: [...m.values()].reduce((a, x) => a + x, 0) }; });
  const N = tf.length, avgdl = tf.reduce((a, d) => a + d.len, 0) / Math.max(1, N), df = new Map();
  for (const d of tf) for (const w of d.m.keys()) df.set(w, (df.get(w) ?? 0) + 1);
  const idf = w => { const n = df.get(w) ?? 0; return Math.log(1 + (N - n + 0.5) / (n + 0.5)); };
  return {
    n: N, avgdl,
    score(query) {
      const q = [...new Set(tokenize(query))].filter(w => df.has(w)), out = new Map();
      for (const d of tf) {
        let s = 0;
        for (const w of q) { const f = d.m.get(w); if (f) s += idf(w) * (f * (k1 + 1)) / (f + k1 * (1 - b + b * d.len / avgdl)); }
        if (s > 0) out.set(d.id, s);
      }
      return out;
    },
  };
}
const byScore = (a, b) => b.s - a.s || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
// Rank-normalised BM25: Map(id -> 1 - rank / n) over the scored rows.
export function rankNormalise(scores) {
  const ranked = [...scores.entries()].map(([id, s]) => ({ id, s })).sort(byScore);
  return new Map(ranked.map((r, i) => [r.id, 1 - i / ranked.length]));
}
// The fired shape features of a shape/1 record (its vector, in SHAPE_FEATURES order).
export const firedFeatures = shape => FEATURES.filter((f, i) => shape?.vector?.[i] === 1);
// The rules an L1 pattern hits: fired features that point to it (§4.2 table).
export const rulesHit = (id, fired) => fired.filter(f => SHAPE_FEATURES[f].includes(id)).length;
// The top companion of an L1 entry by lift (ties by co-items, then id).
export const topCompanion = entry => [...(entry?.companions ?? [])].sort((a, b) => b.lift - a.lift || b.n - a.n || (a.id < b.id ? -1 : 1))[0]?.id ?? null;

// The task text BM25 searches: the TaskSpec rendering when given (S4), else the task prompt, else free text (corpus).
export function queryOf({ task = null, taskSpec = null, text = null } = {}) {
  if (text != null) return String(text);
  const parts = [task?.prompt ?? ''];
  if (taskSpec) parts.push(taskSpec.outputSchemaSummary ?? '', ...(taskSpec.rules ?? []).map(r => r.span), ...(taskSpec.conventionsInProse ?? []), ...(taskSpec.effects ?? []).map(e => (typeof e === 'string' ? e : e.verb ?? '')));
  return parts.filter(Boolean).join('\n');
}

// Step 1. host: {tiers, effects, project}. Rows from buildIndex (L1 rows carry tier; L2/L4 rows status and tags).
export function hardFilter(rows, { tiers = ALL_TIERS, effects = ALL_EFFECTS, project = null } = {}, library = null) {
  const out = [], dropped = {};
  const drop = (r, why) => { dropped[why] = (dropped[why] ?? 0) + 1; };
  for (const r of rows) {
    if (r.layer === 'L1') { if (r.tier && !tiers.includes(r.tier)) { drop(r, 'tier'); continue; } }
    else if (r.layer === 'L2' || r.layer === 'L4') {
      if (!['kept', 'shadow'].includes(r.status)) { drop(r, 'status'); continue; }
      const e = library?.get?.(r.id);
      if (e?.revoked) { drop(r, 'revoked'); continue; }
      if (r.layer === 'L4' && project != null && e?.scope?.project !== project) { drop(r, 'scope'); continue; }
    }
    const eff = (r.tags ?? []).filter(t => t.startsWith('effect:')).map(t => t.slice(7));
    if (eff.some(k => !effects.includes(k))) { drop(r, 'effect'); continue; }
    out.push(r);
  }
  return { rows: out, dropped };
}

// The candidate set (§4.3). l1: loadL1() entries (companions, tier); index: prebuilt rows (else built here without
// writing index.jsonl); library: openLibrary() (L2/L4 rows, profiles); shape: a precomputed shape/1 (else shapeOf(task)).
export function candidates({ task = null, taskSpec = null, text = null, shape = null, l1 = [], index = null, library = null, bindings = [], host = {}, max = MAX_CANDIDATES, bm25 = null } = {}) {
  const rows = index ?? buildIndex({ l1, library, bindings, write: false });
  const sh = shape ?? shapeOf(task ?? { prompt: text ?? '' });
  const fired = firedFeatures(sh);
  const { rows: pool, dropped } = hardFilter(rows, host, library);
  const poolIds = new Set(pool.map(r => r.id));
  const engine = bm25 ?? bm25Index(pool.map(r => ({ id: r.id, text: r.bm25 })));
  const scores = new Map([...engine.score(queryOf({ task, taskSpec, text }))].filter(([id]) => poolIds.has(id)));
  const norm = rankNormalise(scores);
  const ranked = [...scores.entries()].map(([id, s]) => ({ id, s })).sort(byScore);
  const rankOf = new Map(ranked.map((r, i) => [r.id, i]));
  const rule = new Map(pool.filter(r => r.layer === 'L1').map(r => [r.id, rulesHit(r.id, fired)]));
  // Steps 2-3: the initial set.
  const initial = new Set([...pool.filter(r => (rule.get(r.id) ?? 0) > 0).map(r => r.id), ...ranked.slice(0, max).map(r => r.id)]);
  // Step 4: companions of L1 patterns in the set (one round, no chaining).
  const entryOf = new Map(l1.map(e => [e.id, e])), companionOf = new Map();
  for (const id of [...initial].sort()) {
    const c = topCompanion(entryOf.get(id));
    if (c && poolIds.has(c) && !initial.has(c) && !companionOf.has(c)) companionOf.set(c, id);
  }
  const set = [...initial, ...companionOf.keys()];
  // Steps 5-6.
  const byId = new Map(pool.map(r => [r.id, r]));
  const scored = set.map(id => {
    const r = byId.get(id), rules = rule.get(id) ?? 0, b = norm.get(id) ?? 0, comp = companionOf.has(id) ? 1 : 0;
    const c = { id, layer: r.layer, score: Math.round((WEIGHTS.rule * rules + WEIGHTS.bm25 * b + WEIGHTS.companion * comp) * 1e6) / 1e6, rules, bm25: Math.round((scores.get(id) ?? 0) * 1e4) / 1e4,
      bm25Rank: rankOf.has(id) ? rankOf.get(id) : null, bm25Norm: Math.round(b * 1e6) / 1e6, companionOf: companionOf.get(id) ?? null, line: r.line };
    if ((r.layer === 'L2' || r.layer === 'L4') && task && library) {
      const e = library.get(id);
      if (e?.profile) { const p = checkProfile(e.profile, { prompt: e.contract?.taskTemplate ?? task.prompt ?? '', inputs: task.inputs ?? {} }); c.profile = { novel: p.novel, score: Math.round(p.score * 1e4) / 1e4 }; }
    }
    return c;
  }).sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
  const cut = scored.slice(0, max);
  return { candidates: cut, order: cut.map(c => c.id), shape: sh, fired,
    log: { pool: pool.length, dropped, initial: initial.size, companionsAdded: companionOf.size, beforeCut: scored.length, cut: cut.length } };
}

// ---- the L2 code arms over L1 patterns (LIBRARY-TESTS L2) ----
// A1: BM25 over the L1 cards alone, the full ranking (every card with a score, best first).
export function armA1(query, engine) {
  return [...engine.score(query).entries()].map(([id, s]) => ({ id, s })).sort(byScore).map(r => r.id);
}
// A2: the code ranker (§4.3) restricted to L1 (the corpus gold is L1 patterns), all tiers.
export function armA2({ task = null, text = null, shape = null }, ctx) {
  return candidates({ task, text, shape, l1: ctx.l1, index: ctx.l1Rows, bm25: ctx.engine, host: { tiers: ALL_TIERS } }).order;
}
// Context shared by the arms: the L1 index rows and one BM25 engine over them.
export function l1Context(l1) {
  const l1Rows = buildIndex({ l1, write: false });
  return { l1, l1Rows, engine: bm25Index(l1Rows.map(r => ({ id: r.id, text: r.bm25 }))) };
}

// ---- metrics ----
// One item: recall@k of the gold set, precision@5, reciprocal rank of the first gold pattern (0 if none ranked).
export function itemMetrics(ranked, gold, ks = [3, 5, 20]) {
  const G = new Set(gold), out = {};
  for (const k of ks) out[`recall@${k}`] = ranked.slice(0, k).filter(id => G.has(id)).length / G.size;
  out['precision@5'] = ranked.slice(0, 5).filter(id => G.has(id)).length / 5;
  const first = ranked.findIndex(id => G.has(id));
  out.rr = first < 0 ? 0 : 1 / (first + 1);
  return out;
}
// A seeded PRNG (mulberry32) for the bootstrap.
export function prng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
// Mean of a per-item metric with a cluster bootstrap 95% CI (clusters resampled with replacement; LIBRARY-TESTS §1).
// rows: [{cluster, m: {metric: number}}] (or pass `values` and `clusters` arrays). The metric is read once per row through
// Object.entries into arrays, never by a computed key in the hot loop: on Node 24.21 a computed-key load `r.m[metric]` in
// this loop returned another metric's value after the function had first run on rows of another shape (reproduced in this
// session: recall@20 came back as precision@5 after one call with metric 'x'), so the loop works on plain arrays.
export function columnOf(rows, metric) {
  const out = new Array(rows.length);
  rows.forEach((r, i) => { let v; for (const [k, x] of Object.entries(r.m)) if (k === metric) v = x; out[i] = v; });
  return out;
}
export function clusterMean(rows, metric, { cluster = r => r.cluster, B = 4000, seed = 20261014, values = null, clusters = null } = {}) {
  const xs = values ?? columnOf(rows, metric), cs = clusters ?? rows.map(cluster);
  if (xs.some(v => typeof v !== 'number' || !Number.isFinite(v))) throw new Error(`clusterMean: metric ${metric} is missing or not a number on some row`);
  const groups = new Map();
  for (let i = 0; i < xs.length; i++) { const g = groups.get(cs[i]) ?? { s: 0, n: 0 }; g.s += xs[i]; g.n++; groups.set(cs[i], g); }
  const gs = [...groups.values()], n = xs.length, mean = xs.reduce((a, v) => a + v, 0) / Math.max(1, n);
  const rand = prng(seed), means = [];
  for (let i = 0; i < B; i++) { let s = 0, c = 0; for (let j = 0; j < gs.length; j++) { const g = gs[Math.floor(rand() * gs.length)]; s += g.s; c += g.n; } means.push(c ? s / c : 0); }
  means.sort((a, b) => a - b);
  const r4 = x => Math.round(x * 1e4) / 1e4;
  return { mean: r4(mean), lo: r4(means[Math.floor(0.025 * B)]), hi: r4(means[Math.min(B - 1, Math.ceil(0.975 * B) - 1)]), n, clusters: gs.length };
}
