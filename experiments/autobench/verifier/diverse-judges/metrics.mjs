// Scoring helpers for the diverse-judges evaluation: confusion metrics, AUROC, Brier, Platt scaling and a small L2 logistic
// regression (Newton steps), all without dependencies. Deterministic.

export function confusion(items) {
  // items: [{ y: 0|1, d: boolean }]
  const c = { tp: 0, fp: 0, tn: 0, fn: 0 };
  for (const { y, d } of items) { if (d && y) c.tp++; else if (d && !y) c.fp++; else if (!d && !y) c.tn++; else c.fn++; }
  const n = c.tp + c.fp + c.tn + c.fn;
  const precision = c.tp + c.fp ? c.tp / (c.tp + c.fp) : null, recall = c.tp + c.fn ? c.tp / (c.tp + c.fn) : null;
  const f1 = precision && recall ? (2 * precision * recall) / (precision + recall) : precision === 0 || recall === 0 ? 0 : null;
  return { ...c, n, accuracy: n ? (c.tp + c.tn) / n : null, precision, recall, f1, failRecall: c.tn + c.fp ? c.tn / (c.tn + c.fp) : null, accepted: c.tp + c.fp };
}

/** AUROC (Mann-Whitney, ties count half). items: [{ y, s }]. Null when one class is missing. */
export function auroc(items) {
  const pos = items.filter(i => i.y === 1).map(i => i.s), neg = items.filter(i => i.y === 0).map(i => i.s);
  if (!pos.length || !neg.length) return null;
  const all = [...items].sort((a, b) => a.s - b.s);
  // rank with ties averaged
  const ranks = new Map();
  let i = 0;
  while (i < all.length) {
    let j = i;
    while (j + 1 < all.length && all[j + 1].s === all[i].s) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks.set(all[k], r);
    i = j + 1;
  }
  const rPos = all.filter(x => x.y === 1).reduce((s, x) => s + ranks.get(x), 0);
  return (rPos - (pos.length * (pos.length + 1)) / 2) / (pos.length * neg.length);
}

export const brier = items => (items.length ? items.reduce((s, { y, p }) => s + (p - y) ** 2, 0) / items.length : null);
export const logLoss = items => (items.length ? -items.reduce((s, { y, p }) => s + (y ? Math.log(Math.max(1e-6, p)) : Math.log(Math.max(1e-6, 1 - p))), 0) / items.length : null);
/** Expected calibration error with equal-width bins. */
export function ece(items, bins = 10) {
  if (!items.length) return null;
  let e = 0;
  for (let b = 0; b < bins; b++) {
    const lo = b / bins, hi = (b + 1) / bins;
    const inBin = items.filter(({ p }) => (p >= lo && p < hi) || (b === bins - 1 && p === 1));
    if (!inBin.length) continue;
    const conf = inBin.reduce((s, x) => s + x.p, 0) / inBin.length, acc = inBin.reduce((s, x) => s + x.y, 0) / inBin.length;
    e += (inBin.length / items.length) * Math.abs(conf - acc);
  }
  return e;
}

export const logit = p => { const q = Math.min(0.99, Math.max(0.01, p)); return Math.log(q / (1 - q)); };
export const sigmoid = z => 1 / (1 + Math.exp(-z));

/** L2-regularized logistic regression by Newton's method. X: rows of features (no intercept column), y: 0|1. */
export function fitLogistic(X, y, { l2 = 1, iters = 50 } = {}) {
  const d = (X[0]?.length ?? 0) + 1;
  let w = new Array(d).fill(0);
  const row = x => [1, ...x];
  for (let it = 0; it < iters; it++) {
    const g = new Array(d).fill(0), H = Array.from({ length: d }, () => new Array(d).fill(0));
    for (let i = 0; i < X.length; i++) {
      const xi = row(X[i]), p = sigmoid(xi.reduce((s, v, k) => s + v * w[k], 0));
      for (let a = 0; a < d; a++) {
        g[a] += (p - y[i]) * xi[a];
        for (let b = 0; b < d; b++) H[a][b] += p * (1 - p) * xi[a] * xi[b];
      }
    }
    for (let a = 1; a < d; a++) { g[a] += l2 * w[a]; H[a][a] += l2; }
    H[0][0] += 1e-6;
    const step = solve(H, g);
    if (!step) break;
    w = w.map((v, k) => v - step[k]);
    if (Math.max(...step.map(Math.abs)) < 1e-8) break;
  }
  return { w, predict: x => sigmoid(row(x).reduce((s, v, k) => s + v * w[k], 0)) };
}

function solve(A, b) {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((r, i) => r[n] / r[i]);
}

/** Deterministic PRNG (mulberry32) for bootstrap resampling. */
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Percentile bootstrap over clusters (tasks): stat(clusterList) -> number. */
export function bootstrap(clusters, stat, { reps = 2000, seed = 7 } = {}) {
  const r = rng(seed), vals = [];
  for (let k = 0; k < reps; k++) {
    const sample = Array.from({ length: clusters.length }, () => clusters[Math.floor(r() * clusters.length)]);
    const v = stat(sample);
    if (v !== null && Number.isFinite(v)) vals.push(v);
  }
  vals.sort((a, b) => a - b);
  const q = p => vals[Math.min(vals.length - 1, Math.max(0, Math.floor(p * (vals.length - 1))))];
  return vals.length ? { lo: q(0.025), hi: q(0.975), n: vals.length } : null;
}
