// Label balance, deployment-rate sampling and importance weights (JUDGE-PROGRAM.md §1.0 deployment
// base rate, §2.3 rules 4 and 9). Every function is pure and deterministic: where rows must be
// dropped or drawn, the order is a salted hash of each row's key, never Math.random, so a rebuild
// keeps the same rows. Rows are any objects; callers pass accessors.
import { sha256 } from './hash.mjs';

export const DEPLOYMENT_RATES = Object.freeze(['bed-natural', 'balanced-within-entity', 'uniform']);

const order = (rows, key, salt) => rows.map((r, i) => ({ r, i, h: sha256(`${salt}\u0000${key(r, i)}`) }))
  .sort((a, b) => (a.h < b.h ? -1 : a.h > b.h ? 1 : a.i - b.i));

export function counts(rows, label) {
  const out = {};
  for (const r of rows) { const l = label(r); out[l] = (out[l] ?? 0) + 1; }
  return out;
}

// Train caps every label at `maxRatio` x the rarest present label (rule 9: 3x). Kept rows keep
// their input order.
export function capRatio(rows, { label, key = (r, i) => i, maxRatio = 3, salt = 'kev-data:cap' }) {
  const c = counts(rows, label), present = Object.values(c);
  if (!present.length) return { kept: [], dropped: [], counts: {} };
  const cap = Math.floor(Math.min(...present) * maxRatio), taken = {}, keep = new Set();
  for (const { r, i } of order(rows, key, salt)) { const l = label(r); if ((taken[l] ?? 0) < cap) { taken[l] = (taken[l] ?? 0) + 1; keep.add(i); } }
  return { kept: rows.filter((_, i) => keep.has(i)), dropped: rows.filter((_, i) => !keep.has(i)), counts: taken, cap };
}

// Equal label counts within each group (port × system or service, §1.0 balanced-within-entity).
// A group that lacks a label entirely cannot be balanced by dropping rows: it is reported in
// `missing` (the factory adds counterfactual rows for it, §2.5) and its rows are kept as they are
// only if keepUnbalanced is set; otherwise they are dropped.
export function balanceWithin(rows, { group, label, labels, key = (r, i) => i, salt = 'kev-data:within', keepUnbalanced = false }) {
  const groups = new Map();
  rows.forEach((r, i) => { const g = group(r); if (!groups.has(g)) groups.set(g, []); groups.get(g).push({ r, i }); });
  const keep = new Set(), missing = [];
  for (const [g, items] of groups) {
    const want = labels ?? [...new Set(items.map(x => label(x.r)))];
    const byLabel = Object.fromEntries(want.map(l => [l, []]));
    for (const x of order(items.map(x => x.r), (r, j) => key(r, items[j].i), salt)) byLabel[label(x.r)]?.push(items[x.i].i);
    const absent = want.filter(l => !byLabel[l].length);
    if (absent.length) { missing.push({ group: g, labels: absent }); if (keepUnbalanced) items.forEach(x => keep.add(x.i)); continue; }
    const n = Math.min(...want.map(l => byLabel[l].length));
    for (const l of want) byLabel[l].slice(0, n).forEach(i => keep.add(i));
  }
  return { kept: rows.filter((_, i) => keep.has(i)), dropped: rows.filter((_, i) => !keep.has(i)), missing };
}

// Largest-remainder allocation of n draws to labels at the given rates.
export function allocate(n, rates) {
  const labels = Object.keys(rates), total = labels.reduce((s, l) => s + rates[l], 0);
  if (!(total > 0)) throw new Error('rates must have a positive sum');
  const exact = labels.map(l => (n * rates[l]) / total), out = Object.fromEntries(labels.map((l, i) => [l, Math.floor(exact[i])]));
  let left = n - Object.values(out).reduce((a, b) => a + b, 0);
  for (const i of labels.map((_, i) => i).sort((a, b) => (exact[b] - Math.floor(exact[b])) - (exact[a] - Math.floor(exact[a])) || a - b)) { if (left-- <= 0) break; out[labels[i]]++; }
  return out;
}

// Draw n rows at a label distribution (a port's deployment rate, or an enriched calib-OOD rate).
// Shortfalls are reported, never padded.
export function sampleAtRate(rows, { label, rates, n, key = (r, i) => i, salt = 'kev-data:rate' }) {
  const want = allocate(n, rates), taken = {}, keep = new Set();
  for (const { r, i } of order(rows, key, salt)) { const l = label(r); if ((taken[l] ?? 0) < (want[l] ?? 0)) { taken[l] = (taken[l] ?? 0) + 1; keep.add(i); } }
  const shortfall = Object.fromEntries(Object.keys(want).filter(l => (taken[l] ?? 0) < want[l]).map(l => [l, want[l] - (taken[l] ?? 0)]));
  return { kept: rows.filter((_, i) => keep.has(i)), want, taken, shortfall };
}

// Importance weights that take a sample's label distribution back to the deployment rate:
// w(label) = target(label) / sample(label), normalised so the weights average 1 over the sample.
export function importanceWeights(rows, { label, target }) {
  const c = counts(rows, label), n = rows.length, tTotal = Object.values(target).reduce((a, b) => a + b, 0);
  const raw = Object.fromEntries(Object.keys(c).map(l => [l, ((target[l] ?? 0) / tTotal) / (c[l] / n)]));
  const mean = rows.reduce((s, r) => s + raw[label(r)], 0) / (n || 1);
  return Object.fromEntries(Object.keys(raw).map(l => [l, mean ? raw[l] / mean : 0]));
}

// Rule 4: the label's option position over a file's questions must be within ±tolerance of
// uniform per position, for each option count. questions: [{criteria, label}].
export function positionHistogram(questions) {
  const byK = {};
  for (const q of questions) {
    const keys = Object.keys(q.criteria), k = keys.length, pos = keys.indexOf(q.label);
    if (pos < 0) throw new Error('label is not an option');
    (byK[k] ??= Array(k).fill(0))[pos]++;
  }
  return byK;
}
export function checkPositionUniform(hist, { tolerance = 0.05, minPerK = 1 } = {}) {
  const problems = [];
  for (const [k, row] of Object.entries(hist)) {
    const n = row.reduce((a, b) => a + b, 0);
    if (n < minPerK) continue;
    row.forEach((c, pos) => { const d = c / n - 1 / Number(k); if (Math.abs(d) > tolerance) problems.push({ k: Number(k), position: pos, share: c / n, deviation: d, n }); });
  }
  return { ok: problems.length === 0, problems };
}
// A deterministic option order for one record: a salted-hash permutation (rule 4 asks for a seeded
// shuffle; beds/lib/rng.mjs from the frozen copy can be passed as `shuffle` instead).
export function optionOrder(options, recordKey, { salt = 'kev-data', shuffle = null } = {}) {
  if (shuffle) return shuffle([...options]);
  return [...options].map(o => ({ o, h: sha256(`${salt}\u0000${recordKey}\u0000${o}`) })).sort((a, b) => (a.h < b.h ? -1 : 1)).map(x => x.o);
}
