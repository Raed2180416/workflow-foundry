// Shared helpers for the M0 $0 diagnostics D0-D6 (research/need-router-20261014/DESIGN.md §7 M0 item 10).
// Pure functions, no model calls, no network. Every diagnostic is development evidence; D2, D3, D4 and D6 read LEGACY
// rows (archived runs from before this program: never pooled with new labels).
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { wilson } from '../../lib/stats.mjs';
import { rng } from '../metrics.mjs';

export { wilson, rng };
export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const PROGRAM_DIR = path.join(REPO, 'research/need-router-20261014');
export const ARCHIVE_DIR = path.join(PROGRAM_DIR, 'archive');
export const OUT_DIR = path.join(PROGRAM_DIR, 'analysis/m0');
export const rel = p => { const r = path.relative(REPO, p); return r.startsWith('..') ? p : r.split(path.sep).join('/'); };
export const abs = p => (path.isAbsolute(p) ? p : path.join(REPO, p));

export const GRADE = Object.freeze({ legacy: 'LEGACY/dev', dev: 'dev' });

export function readJsonl(file) {
  return readFileSync(file, 'utf8').split('\n').filter(l => l.trim()).map((l, i) => {
    try { return JSON.parse(l); } catch (e) { throw new Error(`${file}:${i + 1}: ${e.message}`); }
  });
}
export const readJson = file => JSON.parse(readFileSync(file, 'utf8'));
export const sha256 = x => createHash('sha256').update(x).digest('hex');
export const sha256File = file => sha256(readFileSync(file));
/** {path, sha256, bytes} of a repository file, for the `sources` lists of the report (path is repo-relative). */
export function sourceOf(file, extra = {}) {
  const f = abs(file);
  return { path: rel(f), sha256: sha256File(f), bytes: statSync(f).size, ...extra };
}
export const listDir = d => (existsSync(d) ? readdirSync(d) : []);

// ---------------------------------------------------------------------------------------------------- statistics
export const sum = xs => xs.reduce((a, x) => a + x, 0);
export const mean = xs => (xs.length ? sum(xs) / xs.length : NaN);
export function quantile(xs, q) {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b), pos = (s.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}
export const median = xs => quantile(xs, 0.5);
export const round = (x, d = 4) => (Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : x);

/** Area under the ROC curve (Mann-Whitney, ties count 1/2). null when only one class is present. */
export function auc(scores, labels) {
  const pos = [], neg = [];
  scores.forEach((s, i) => (labels[i] ? pos : neg).push(s));
  if (!pos.length || !neg.length) return null;
  let wins = 0;
  for (const p of pos) for (const n of neg) wins += p > n ? 1 : p === n ? 0.5 : 0;
  return wins / (pos.length * neg.length);
}

/** All k-subsets of 0..n-1 (lexicographic). */
export function* combinations(n, k, start = 0, prefix = []) {
  if (prefix.length === k) { yield prefix; return; }
  for (let i = start; i <= n - (k - prefix.length); i++) yield* combinations(n, k, i + 1, [...prefix, i]);
}

const logFactorial = n => { let s = 0; for (let i = 2; i <= n; i++) s += Math.log(i); return s; };
const logChoose = (n, k) => (k < 0 || k > n ? -Infinity : logFactorial(n) - logFactorial(k) - logFactorial(n - k));
/**
 * One-sided Fisher exact test on a 2x2 table [[a, b], [c, d]] for positive association: P(X >= a) under the
 * hypergeometric null with the margins fixed. a = both wrong, b = only first wrong, c = only second wrong, d = both right.
 */
export function fisherUpper(a, b, c, d) {
  const n1 = a + b, n2 = c + d, m1 = a + c, N = n1 + n2;
  let p = 0;
  for (let x = a; x <= Math.min(n1, m1); x++) {
    if (n1 - x > n2 || m1 - x < 0 || m1 - x > n2) continue;
    p += Math.exp(logChoose(m1, x) + logChoose(N - m1, n1 - x) - logChoose(N, n1));
  }
  return Math.min(1, p);
}

// ------------------------------------------------------------------------------------------ ridge logistic regression
const sigmoid = z => 1 / (1 + Math.exp(-z));
function solve(A, b) {   // Gaussian elimination with partial pivoting (small systems)
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    if (Math.abs(M[c][c]) < 1e-12) M[c][c] = 1e-12;
    for (let r = c + 1; r < n; r++) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) { let s = M[i][n]; for (let k = i + 1; k < n; k++) s -= M[i][k] * x[k]; x[i] = s / M[i][i]; }
  return x;
}
/**
 * Ridge-penalised logistic regression by Newton steps (intercept unpenalised). Features are standardised with the
 * training mean and sd; a constant feature gets weight 0. Returns { predict(x) -> P(y = 1) }. With one class in the
 * training data it predicts that class's base rate (smoothed), so a held-out fold never fails.
 */
export function fitLogistic(X, y, { lambda = 1, iters = 60 } = {}) {
  const n = X.length, p = n ? X[0].length : 0;
  const base = (sum(y) + 0.5) / (n + 1);
  if (!n || !p || sum(y) === 0 || sum(y) === n) return { predict: () => base, constant: true };
  const mu = Array.from({ length: p }, (_, j) => mean(X.map(r => r[j])));
  const sd = Array.from({ length: p }, (_, j) => { const v = Math.sqrt(mean(X.map(r => (r[j] - mu[j]) ** 2))); return v > 1e-12 ? v : 0; });
  const Z = X.map(r => [1, ...r.map((v, j) => (sd[j] ? (v - mu[j]) / sd[j] : 0))]);
  let w = new Array(p + 1).fill(0);
  for (let it = 0; it < iters; it++) {
    const pr = Z.map(r => sigmoid(r.reduce((s, v, j) => s + v * w[j], 0)));
    const g = new Array(p + 1).fill(0), H = Array.from({ length: p + 1 }, () => new Array(p + 1).fill(0));
    Z.forEach((r, i) => {
      const e = pr[i] - y[i], s = Math.max(pr[i] * (1 - pr[i]), 1e-9);
      for (let a = 0; a <= p; a++) { g[a] += e * r[a]; for (let b = 0; b <= p; b++) H[a][b] += s * r[a] * r[b]; }
    });
    for (let a = 1; a <= p; a++) { g[a] += lambda * w[a]; H[a][a] += lambda; }
    const step = solve(H, g);
    w = w.map((v, j) => v - step[j]);
    if (Math.max(...step.map(Math.abs)) < 1e-9) break;
  }
  return { constant: false, weights: w, predict: x => sigmoid(w[0] + x.reduce((s, v, j) => s + (sd[j] ? ((v - mu[j]) / sd[j]) * w[j + 1] : 0), 0)) };
}

export const fmt = {
  n: (x, d = 3) => (Number.isFinite(x) ? x.toFixed(d) : 'n/a'),
  pct: (x, d = 0) => (Number.isFinite(x) ? `${(100 * x).toFixed(d)}%` : 'n/a'),
  usd: (x, d = 3) => (Number.isFinite(x) ? `$${x.toFixed(d)}` : 'n/a'),
  ci: (lo, hi, d = 2) => `[${Number.isFinite(lo) ? lo.toFixed(d) : 'n/a'}, ${Number.isFinite(hi) ? hi.toFixed(d) : 'n/a'}]`,
};
