// Shared helpers for the M0 $0 diagnostics D0-D6 (research/need-router-20261014/DESIGN.md §7 M0 item 10).
// Pure functions, no model calls, no network. Every diagnostic is development evidence; D2, D3, D4 and D6 read LEGACY
// rows (archived runs from before this program: never pooled with new labels).
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { wilson } from '../../lib/stats.mjs';
import { rng } from '../metrics.mjs';
import { assertSeedsAllowed, loadLedger, rangesOf } from '../../jit/seeds.mjs';

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

/**
 * The seed gate of a diagnostic that generates tasks in-process (PREREG §3.3: "every runner calls assertSeedsAllowed for every task", L4). A diagnostic generates the
 * worked EXAMPLES a router may see (purpose need-example, dev split) and nothing else, so on top of the ledger's own refusals (assertSeedsAllowed) a seed must lie in a
 * range whose allow list names the purpose, and never at or above the held-out floor: the ledger models the held-out seeds as a test-split range, so a dev call with
 * seed 8801 would otherwise pass it (no dev range covers 8801). Throws SEED_REFUSED with one detail per refused seed; returns { bed, split, purpose, seeds }.
 */
export function assertExampleSeeds({ bed, seeds, purpose = 'need-example', split = 'dev', ledger = null }) {
  const L = ledger ?? loadLedger();
  assertSeedsAllowed({ bed, split, seeds, purpose, ledger: L });
  const refused = seeds.map(seed => {
    const reasons = [];
    if (seed >= L.rules.heldoutMinSeed) reasons.push(`seed ${seed} is in the held-out range (>= ${L.rules.heldoutMinSeed}): a dev diagnostic never generates it`);
    else if (!rangesOf(L, { bed, split, seed }).some(r => r.allow?.includes(purpose))) reasons.push(`seed ${seed} is in no ${split} ledger range that allows ${purpose}`);
    return { seed, reasons };
  }).filter(x => x.reasons.length);
  if (refused.length) {
    const e = new Error(`SEED_REFUSED: ${refused.length} ${bed}:${split} seed(s) refused for ${purpose}: ${refused.slice(0, 4).map(x => `s${x.seed} (${x.reasons.join('; ')})`).join(', ')}`);
    e.code = 'SEED_REFUSED'; e.details = refused; throw e;
  }
  return { bed, split, purpose, seeds: seeds.length };
}

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

/**
 * Area under the ROC curve (Mann-Whitney, ties count 1/2). With `strata` only pairs from the same stratum are compared, which
 * removes a confound between the strata (for example difficulty bands that differ in both input size and pass rate).
 * null when no comparable (positive, negative) pair exists.
 */
export function auc(scores, labels, strata = null) {
  let wins = 0, pairs = 0;
  for (let i = 0; i < scores.length; i++) {
    if (!labels[i]) continue;
    for (let j = 0; j < scores.length; j++) {
      if (labels[j] || (strata && strata[i] !== strata[j])) continue;
      pairs += 1; wins += scores[i] > scores[j] ? 1 : scores[i] === scores[j] ? 0.5 : 0;
    }
  }
  return pairs ? wins / pairs : null;
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

export const fmt = {
  n: (x, d = 3) => (Number.isFinite(x) ? x.toFixed(d) : 'n/a'),
  pct: (x, d = 0) => (Number.isFinite(x) ? `${(100 * x).toFixed(d)}%` : 'n/a'),
  usd: (x, d = 3) => (Number.isFinite(x) ? `$${x.toFixed(d)}` : 'n/a'),
  ci: (lo, hi, d = 2) => `[${Number.isFinite(lo) ? lo.toFixed(d) : 'n/a'}, ${Number.isFinite(hi) ? hi.toFixed(d) : 'n/a'}]`,
};
