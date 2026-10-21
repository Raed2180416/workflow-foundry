#!/usr/bin/env node
// Build-level inference (register B7; research/compromises-20261021/FIXES.md §2 action 6). $0, pure functions, seeded,
// no model calls, no new dependency (experiments/lib/stats.mjs and beds/lib/rng.mjs only).
//
// The unit. When arms differ in what a model BUILT (a compiled solver, a composed program, a workflow lineage), the build
// is the experimental unit: every case graded on one build shares that build's defects, so cases within a build are
// correlated and a case-pooled test treats K builds × m cases as K·m independent draws. Under the B7 simulation's
// assumptions (between-build SD σ_b ≈ 0.08 on the pass rate, i.e. 0.6 on the logit scale at p ≈ 0.85; shared case
// difficulty SD 0.8 on the logit scale; 43 cases per build) a case-pooled two-proportion test rejects a true null about
// 25% of the time at a nominal 5%, at every K (stats-builds.test.mjs reproduces it: the teeth).
//
//   buildPermutationTest(a, b)       exact build-level permutation test (Monte Carlo past `exactMax` splits); reports the
//                                    smallest attainable p and "cannot resolve at K = …" when it is not below alpha
//                                    (K = 3 vs 3: 2/C(6,3) = 0.10, so no 3-vs-3 comparison can ever reach p < 0.05)
//   buildRatePosterior(builds)       one arm's mean build pass rate μ with builds as a random effect on the logit scale:
//                                    y_b ~ Bin(n_b, sigmoid(θ + u_b)), u_b ~ N(0, τ²), sigmoid(θ) uniform, τ half-normal(1);
//                                    point estimate = the sample mean of build rates; interval = 95% HPD
//   buildDifferenceInterval(a, b)    μ_A − μ_B on one shared pool of worlds: difference of sample means, Welch's t interval
//                                    on build rates (headline), and the convolved posteriors beside it (no world-level pairing)
//   estimateSigmaB(builds)           measured spread of build rates (sd of rates; moment estimate net of binomial noise)
//   buildMde / kForMde               the minimum detectable gap for K builds per arm from a measured SD of build rates:
//                                    simulated with the exact permutation test (the t approximation is reported beside)
//   simulateArms / buildPower        the B7 generative model and the rejection rates of the build-level and case-pooled
//                                    methods (type-I at gap 0, power otherwise)
//   sequentialBuildDesign / sequentialBuildLook / simulateSequential
//                                    builds added in blocks of 2 per arm up to K_max 12, O'Brien-Fleming boundaries from
//                                    the shared group-sequential core (stats.mjs, also used by experiments/autobench/
//                                    sequential.mjs) applied to the build-level permutation p at each look
//   buildsFromResult(json)           E8 / COMP-1 result.json → one build ({ id, passed, completed, pool })
//
//   node experiments/lib/stats-builds.mjs compare --a f1,f2,f3 --b g1,g2[,…] [--pool grading|paired] [--json]
//   node experiments/lib/stats-builds.mjs power --K 3,6,8,12 --m 43 [--sigma-b 0.08] [--gap 0.10] [--reps 2000] [--json]
//   node experiments/lib/stats-builds.mjs sequential [--m 43] [--gap 0] [--reps 10000] [--boundary pocock] [--json]
//   node experiments/lib/stats-builds.mjs mde --K 3,6,8,12 --m 1022 (--sd-rates 0.03 | --sigma-b 0.05) [--json]   (one is required)
//
// Measured with this file (2026-10-21, development evidence, the B7 model: σ_b 0.08, σ_c 0.8, p 0.85):
//   type-I at gap 0, m 43, 2,000 reps: build-level 0.000/0.019/0.037/0.040/0.037 at K 3/4/6/8/12; case-pooled
//     0.237/0.244/0.248/0.243/0.246 (the teeth: about 25% at every K);
//   power at gap 0.10, 1,000 reps: m 43: 0.00/0.25/0.56/0.78/0.92 at K 3/4/6/8/12; K 6: 0.29/0.56/0.82 at m 14/43/400;
//   sequential (O'Brien-Fleming, blocks of 2, K_max 12): false stops 0.0476 over 10,000 nulls at m 43 without the
//     3-point floor, 0.0475 over 2,000 with it; at gap 0.10 it stops 0.92 of the time with mean K 9.2 (m 43) and 0.98
//     with mean K 8.1 (m 400). So it does NOT use fewer builds than a fixed K = 8 (the researcher's expectation); it
//     buys power (fixed K = 8: 0.77 and 0.92) at a mean K below the fixed K = 12 that reaches the same power.
//   posterior (after the 2026-10-21 review; stats-builds.test.mjs (c)): one arm's 95% HPD covers the mean build rate
//     0.95-0.99 at true rates 0.92/0.95/0.97 (m 1,022, K 3 and 6) and the sample mean's bias is under 0.005; the
//     posterior median runs 0.01-0.03 low, so it is never the point estimate. Difference: Welch 0.94-0.98 coverage, width
//     0.22-0.27 at K = 3; the convolved posterior 0.96-1.00, width 0.39-0.43 (too wide to be the headline).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rng } from '../../beds/lib/rng.mjs';
import { crossesAt, obrienFlemingBoundary, pocockBoundary, studentTQuantile, twoSidedP } from './stats.mjs';

export const ALPHA = 0.05;
export const MIN_CASES_PER_BUILD = 400;   // FIXES B7: grade every build on >= 400 cases (E8's 9-world pool has 1,022)
export const BLOCK = 2;                   // builds added per arm per look
export const K_MAX = 12;                  // builds per arm at most
export const SIGMA_B_ASSUMED = 0.08;      // the B7 simulation's between-build SD (pass-rate scale); measure before each prereg
export const SIGMA_B_LOGIT_PRIOR_SCALE = 1.0;   // half-normal scale of the posterior's prior on the logit-scale build SD τ (from E8: 0.58, 0.87)
export const FLOOR = 0.03;                // ROADMAP §4.3: gaps under 3 points are noise; a crossing smaller than this does not decide
export const SIM_DEFAULTS = Object.freeze({ pRef: 0.85, sigmaB: SIGMA_B_ASSUMED, sigmaC: 0.8, gap: 0.10 });

const sum = xs => xs.reduce((s, x) => s + x, 0);
const mean = xs => (xs.length ? sum(xs) / xs.length : NaN);
const logit = p => Math.log(p / (1 - p));
const sigmoid = x => 1 / (1 + Math.exp(-x));
function logChoose(n, k) { if (k < 0 || k > n) return -Infinity; let s = 0; for (let i = 1; i <= k; i++) s += Math.log(n - k + i) - Math.log(i); return s; }
const choose = (n, k) => Math.round(Math.exp(logChoose(n, k)));

// ------------------------------------------------------------------------------------------------ builds
/** A build: { id, passed, completed, pool? } (pool: the sorted list of world keys it was graded on). */
function normBuild(b, i) {
  if (typeof b === 'number') {
    if (!(b >= 0 && b <= 1)) throw new Error(`stats-builds: rate ${b} outside [0, 1]`);
    return { id: `b${i + 1}`, rate: b, passed: null, completed: null, pool: null };
  }
  const { passed, completed } = b ?? {};
  if (!(Number.isInteger(passed) && Number.isInteger(completed) && completed > 0 && passed >= 0 && passed <= completed)) {
    throw new Error(`stats-builds: build ${b?.id ?? i + 1} needs integer passed <= completed, completed > 0`);
  }
  return { id: b.id ?? `b${i + 1}`, rate: passed / completed, passed, completed, pool: b.pool ?? null };
}
const norm = builds => {
  if (!Array.isArray(builds) || !builds.length) throw new Error('stats-builds: an arm needs at least one build');
  return builds.map(normBuild);
};

/**
 * Throws unless every build of both arms was graded on the same pool (spec hash and worlds). Builds without a pool (bare
 * counts or rates: simulations) are accepted only when no build carries one, and the result says the pool was not checked;
 * a mix is refused.
 */
export function assertSharedPool(...arms) {
  const pools = arms.flat().map(b => (b.pool ? JSON.stringify(b.pool) : null)), missing = pools.filter(p => p === null).length;
  if (missing === pools.length) return { checked: false, note: 'no build carries a pool (bare counts or rates); the shared pool was not checked' };
  if (missing) throw new Error(`stats-builds: ${missing} of ${pools.length} builds carry no world pool; every build of a comparison must name the pool it was graded on`);
  if (new Set(pools).size !== 1) throw new Error('stats-builds: builds were graded on different world pools; a build-level comparison needs one shared pool (same spec, same worlds)');
  return { checked: true, pool: JSON.parse(pools[0]) };
}

export const POOLS = Object.freeze(['grading', 'paired']);
/**
 * One build from an E8 / COMP-1 result.json: `pool: 'grading'` sums the full-size grading worlds (rows without a size;
 * 9 worlds, 1,022 completed cases in the COMP-1 pool), `pool: 'paired'` the size-limited paired world (1232 d2 size 12,
 * 14 completed cases). Rows carry { seed, d, size, status, completed, passed } or { oracle: { completed, passed } }. The
 * pool identity is the result's spec hash plus the sorted world keys; an unknown pool name is refused.
 */
export function buildsFromResult(json, { pool = 'grading', id = json?.label } = {}) {
  if (!POOLS.includes(pool)) throw new Error(`stats-builds: pool must be one of ${POOLS.join(', ')}, got ${pool}`);
  if (typeof json?.spec !== 'string' || !json.spec) throw new Error(`stats-builds: ${id}: result.json carries no spec hash (the pool identity needs it)`);
  const rows = (json?.rows ?? []).filter(r => (pool === 'paired' ? r.size != null : r.size == null));
  if (!rows.length) throw new Error(`stats-builds: ${id}: no ${pool} rows`);
  const bad = rows.filter(r => r.status !== 'complete');
  if (bad.length) throw new Error(`stats-builds: ${id}: ${bad.length} ${pool} row(s) not complete`);
  const c = r => r.completed ?? r.oracle?.completed, p = r => r.passed ?? r.oracle?.passed;
  return {
    id, passed: sum(rows.map(p)), completed: sum(rows.map(c)),
    pool: [`spec:${json.spec}`, ...rows.map(r => `${r.seed}/${r.d}/${r.size ?? 'full'}`).sort()],
    worlds: rows.map(r => ({ world: `${r.seed}/${r.d}/${r.size ?? 'full'}`, passed: p(r), completed: c(r) })),
  };
}

// ------------------------------------------------------------------------------------------------ exact permutation
/** The smallest two-sided p a build-level permutation test can give for kA vs kB builds (all rates distinct). */
export const minAttainableP = (kA, kB) => (kA === kB ? 2 : 1) / choose(kA + kB, kA);

/**
 * Exact two-sided permutation test of mean build rate A − mean build rate B over every split of the K_A + K_B build rates
 * into groups of K_A and K_B (Monte Carlo with `iterations` seeded splits when there are more than `exactMax`). The case
 * pool, shared by every build, cancels; only build-to-build variation is the noise.
 */
export function buildPermutationTest(a, b, { alpha = ALPHA, exactMax = 20000, iterations = 9999, seed = 'build-permutation', rates = false } = {}) {
  // rates: true takes bare real values (the MDE simulation's normal draws), not pass rates in [0, 1].
  const A = rates ? a.map(x => ({ rate: x })) : norm(a), B = rates ? b.map(x => ({ rate: x })) : norm(b);
  if (!rates) assertSharedPool(A, B);
  const ra = A.map(x => x.rate), rb = B.map(x => x.rate);
  const kA = ra.length, kB = rb.length, N = kA + kB, all = [...ra, ...rb], total = sum(all);
  const diffOf = sA => sA / kA - (total - sA) / kB;
  const obs = diffOf(sum(ra)), absObs = Math.abs(obs), tol = 1e-12 * Math.max(1, N);
  const splits = choose(N, kA), minP = minAttainableP(kA, kB), resolvable = minP < alpha;
  let p, method;
  if (splits <= exactMax) {
    let hits = 0;
    const rec = (start, left, s) => {
      if (left === 0) { if (Math.abs(diffOf(s)) >= absObs - tol) hits++; return; }
      for (let i = start; i <= N - left; i++) rec(i + 1, left - 1, s + all[i]);
    };
    rec(0, kA, 0);
    p = hits / splits; method = 'exact';
  } else {
    const r = rng(seed, kA, kB, obs);
    const idx = Array.from({ length: N }, (_, i) => i);
    let hits = 0;
    for (let it = 0; it < iterations; it++) {
      let s = 0;
      for (let i = 0; i < kA; i++) { const j = i + Math.floor(r.next() * (N - i)); [idx[i], idx[j]] = [idx[j], idx[i]]; s += all[idx[i]]; }
      if (Math.abs(diffOf(s)) >= absObs - tol) hits++;
    }
    p = (hits + 1) / (iterations + 1); method = 'monte-carlo';
  }
  const verdict = !resolvable
    ? `cannot resolve at K = ${kA} vs ${kB}: the smallest attainable two-sided p is ${minP.toFixed(4)}, not below ${alpha}`
    : p < alpha ? 'difference (build-level)' : 'no resolvable difference at this K';
  return { kA, kB, meanA: mean(ra), meanB: mean(rb), diff: obs, p, method, splits, minP, resolvable, alpha, verdict };
}

/** The case-pooled two-proportion z test that ignores builds (the WRONG unit; kept for the teeth and for comparison). */
export function casePooledTest(a, b) {
  const A = norm(a), B = norm(b);
  const sa = sum(A.map(x => x.passed)), na = sum(A.map(x => x.completed)), sb = sum(B.map(x => x.passed)), nb = sum(B.map(x => x.completed));
  const pa = sa / na, pb = sb / nb, pp = (sa + sb) / (na + nb);
  const se = Math.sqrt(pp * (1 - pp) * (1 / na + 1 / nb));
  const z = se > 0 ? (pa - pb) / se : 0;
  return { pa, pb, diff: pa - pb, z, p: twoSidedP(z), cases: [na, nb] };
}

// ------------------------------------------------------------------------------------------------ build-rate posterior
// One arm's builds as a random effect on the logit scale (a binomial / logit-normal model):
//   y_b ~ Bin(n_b, sigmoid(θ + u_b)),  u_b ~ N(0, τ²),  sigmoid(θ) ~ U(0, 1),  τ ~ half-normal(SIGMA_B_LOGIT_PRIOR_SCALE).
// The estimand is the mean build pass rate of the build process on this pool, μ = E_u[sigmoid(θ + u)]. The point estimate
// is the sample mean of the build rates (unbiased for μ); the posterior median is reported beside it; the interval is the
// shortest 95% posterior interval (HPD), whose frequentist coverage was measured by simulation (stats-builds.test.mjs).
//
// Why not the beta-binomial (μ uniform, rate-scale σ_b half-normal(0.15)) this file used first: near the ceiling a rate-scale
// σ_b of 0.1-0.17 is a U-shaped beta, so three builds at 0.97 were read as consistent with a much lower mean (posterior
// mean 0.912 for B1L-H's 1.000 / 0.953 / 0.993; bias -0.025 to -0.045 at true rates 0.92-0.97, single-arm coverage 0.90
// at 0.97, difference coverage 1.00: the 2026-10-21 review). The logit scale keeps spread proportionate near the ceiling.
// The prior scale is set from measured E8 spread: the logit-scale SD of build rates is 0.58 for C-H builds 1-3 and 0.87
// for C-H-T builds 1-3 on the 1,022-case pool (B1L-H's 2.3 is inflated by a 1,022/1,022 build), so half-normal(1): median
// 0.67, 90th percentile 1.64. Equal-tailed intervals are also returned; near the ceiling they cover only 0.90-0.96,
// because the μ posterior is left-skewed, which is why the HPD interval is the reported one.
const logSig = x => (x >= 0 ? -Math.log1p(Math.exp(-x)) : x - Math.log1p(Math.exp(x)));
// Every build perfect (passed = completed): a perfect build's logit is unbounded, so any spread fits and the posterior
// piles up at 1. A logit-normal spread cannot represent "most builds perfect, an occasional broken one" (B1L-H's
// 1.000 / 0.953 / 0.993 is that shape), so for such an arm the interval is overconfident.
export const CEILING_NOTE = 'every build of this arm is perfect: the logit-normal posterior piles up at 1 and its interval is overconfident (it cannot represent an occasional broken build); read the permutation test and the Welch interval';
const ETA_LO = -16, ETA_HI = 16;
const ZQ = Array.from({ length: 41 }, (_, i) => -5 + i * 0.25);
const ZW = (() => { const w = ZQ.map(z => Math.exp(-0.5 * z * z)), t = sum(w); return w.map(x => x / t); })();
/** E_z[sigmoid(θ + τz)], z ~ N(0, 1): the mean build pass rate of a logit-normal build population. */
const meanRate = (th, tau) => { if (tau === 0) return sigmoid(th); let s = 0; for (let i = 0; i < ZQ.length; i++) s += ZW[i] * sigmoid(th + tau * ZQ[i]); return s; };

// Quantiles of a discrete distribution (values ascending, masses summing to 1).
function quantilesDiscrete(values, mass, ps) {
  return ps.map(p => { let c = 0; for (let i = 0; i < values.length; i++) { c += mass[i]; if (c >= p) return values[i]; } return values[values.length - 1]; });
}
// The shortest interval holding `level` of the mass (the HPD interval of a unimodal marginal).
function shortestInterval(values, mass, level) {
  let best = [values[0], values[values.length - 1]], j = 0, acc = 0;
  for (let i = 0; i < values.length; i++) {
    while (j < values.length && acc < level - 1e-12) { acc += mass[j]; j++; }
    if (acc < level - 1e-12) break;
    if (values[j - 1] - values[i] < best[1] - best[0]) best = [values[i], values[j - 1]];
    acc -= mass[i];
  }
  return best;
}
const summarise = (values, mass, level) => {
  const [lo, hi] = shortestInterval(values, mass, level), [etLo, median, etHi] = quantilesDiscrete(values, mass, [(1 - level) / 2, 0.5, 1 - (1 - level) / 2]);
  return { mean: sum(values.map((v, i) => v * mass[i])), median, lo, hi, level, interval: 'hpd', equalTailed: { lo: etLo, hi: etHi } };
};

/**
 * One arm's posterior for the mean build pass rate μ (builds as a random effect on the logit scale; see above). Computed on
 * a grid: θ on the η grid (step h) in two passes (coarse, then the live range), τ on a power-spaced grid to 4× the prior
 * scale; each build's binomial likelihood is integrated against N(θ, τ²) on the η grid. Returns { k, sampleMean (the
 * point estimate), mu: { values, mass, mean, median, lo, hi (HPD), equalTailed }, sigmaBLogit (posterior mean τ), prior }.
 */
export function buildRatePosterior(builds, { level = 0.95, sigmaBLogitScale = SIGMA_B_LOGIT_PRIOR_SCALE, h = 0.05, nTau = 31, tauMaxScale = 4, coarseStride = 8, fineStride = 2 } = {}) {
  const B = norm(builds);
  if (B.some(b => b.passed === null)) throw new Error('stats-builds: the posterior needs passed/completed counts, not bare rates');
  const N = Math.round((ETA_HI - ETA_LO) / h) + 1, eta = i => ETA_LO + i * h;
  const sup = B.map(b => {
    const ll = new Float64Array(N);
    let max = -Infinity, top = 0;
    for (let k = 0; k < N; k++) { const e = eta(k); ll[k] = b.passed * logSig(e) + (b.completed - b.passed) * logSig(-e); if (ll[k] > max) { max = ll[k]; top = k; } }
    let a = 0, z = N - 1;
    while (ll[a] < max - 30) a++;
    while (ll[z] < max - 30) z--;
    return { a, z, top, ll, max, L: Float64Array.from({ length: z - a + 1 }, (_, k) => Math.exp(ll[a + k] - max)) };
  });
  const tauMax = tauMaxScale * sigmaBLogitScale, taus = [0];
  for (let j = 1; j < nTau; j++) taus.push(tauMax * (j / (nTau - 1)) ** 1.5);
  const logTauW = taus.map((t, j) => { const lo = j === 0 ? 0 : (taus[j - 1] + t) / 2, hi = j === nTau - 1 ? t : (t + taus[j + 1]) / 2; return -0.5 * (t / sigmaBLogitScale) ** 2 + Math.log(hi - lo); });
  const kernels = taus.map(t => {
    if (t < h) return null;   // below the grid's resolution: the build's likelihood is read at θ itself
    const D = Math.min(N, Math.ceil((8.5 * t) / h)), T = new Float64Array(2 * D + 1), c = h / (t * Math.sqrt(2 * Math.PI));
    for (let d = -D; d <= D; d++) T[d + D] = c * Math.exp(-0.5 * ((d * h) / t) ** 2);
    return { D, T };
  });
  const cellLp = (i, j) => {
    const m = sigmoid(eta(i));
    let lp = Math.log(m * (1 - m)) + logTauW[j];
    const K = kernels[j];
    for (const s of sup) {
      let c = 0;
      if (!K) c = Math.exp(s.ll[i] - s.max);
      else { const lo = Math.max(s.a, i - K.D), hi = Math.min(s.z, i + K.D); for (let k = lo; k <= hi; k++) c += s.L[k - s.a] * K.T[k - i + K.D]; }
      if (!(c > 0)) return -Infinity;
      lp += Math.log(c);
    }
    return lp;
  };
  // pass 1: a coarse θ grid around the builds' maximum-likelihood logits
  const c0 = Math.max(0, Math.min(...sup.map(s => s.top)) - Math.round((2 + tauMax) / h)), c1 = Math.min(N - 1, Math.max(...sup.map(s => s.top)) + Math.round((2 + tauMax) / h));
  let max = -Infinity;
  const coarse = [];
  for (let i = c0; i <= c1; i += coarseStride) for (let j = 0; j < nTau; j++) { const v = cellLp(i, j); coarse.push([i, v]); if (v > max) max = v; }
  const live = coarse.filter(([, v]) => v > max - 25).map(([i]) => i);
  const i0 = Math.max(0, Math.min(...live) - 2 * coarseStride), i1 = Math.min(N - 1, Math.max(...live) + 2 * coarseStride);
  // pass 2: the live θ range
  const cells = [];
  max = -Infinity;
  for (let i = i0; i <= i1; i += fineStride) for (let j = 0; j < nTau; j++) { const v = cellLp(i, j); if (v > -Infinity) { cells.push([i, j, v]); if (v > max) max = v; } }
  let tot = 0, tauNum = 0;
  const pts = [];
  for (const [i, j, v] of cells) { const w = Math.exp(v - max); if (w < 1e-14) continue; tot += w; tauNum += w * taus[j]; pts.push([meanRate(eta(i), taus[j]), w]); }
  pts.sort((x, y) => x[0] - y[0]);
  const values = pts.map(p => p[0]), mass = pts.map(p => p[1] / tot);
  const allPerfect = B.every(b => b.passed === b.completed);
  return {
    k: B.length, sampleMean: mean(B.map(b => b.rate)), mu: { values, mass, ...summarise(values, mass, level) }, sigmaBLogit: tauNum / tot,
    ...(allPerfect ? { note: CEILING_NOTE } : {}),
    prior: { mu: 'uniform (sigmoid(θ) ~ U(0, 1))', sigmaBLogit: `half-normal(${sigmaBLogitScale}) on the logit scale` }, grid: { h, nTau, tauMax, theta: [eta(i0), eta(i1)], fineStride },
  };
}

/**
 * The difference in mean build pass rate μ_A − μ_B. Both arms must be graded on one shared pool of worlds (so μ_A − μ_B is
 * the difference on that pool and the pool's case difficulty is common to both); no world-level pairing is modelled and
 * per-world results are not used. Returns the point estimate (difference of the arms' sample means of build rates) and:
 *   - the headline interval: Welch's t interval on the build rates (unequal spreads, Welch-Satterthwaite df). Measured
 *     coverage 0.95-0.98 at K = 3-6 (stats-builds.test.mjs (c)); a K = 3 vs 3 width of about 0.21-0.28 at the ceiling.
 *     Degenerate (zero width) when neither arm's builds vary; then the posterior interval is the one to read (`note`).
 *   - `posterior`: the two arms' independent buildRatePosterior marginals convolved (binned to `bins` points per arm),
 *     with its HPD interval and P(μ_A > μ_B). It over-covers (0.96-1.00) and near the ceiling is 1.5-1.8x as wide as
 *     Welch's, because each arm's posterior keeps a long left tail for a large build spread; it is reported beside, never
 *     instead.
 */
export function buildDifferenceInterval(a, b, { level = 0.95, bins = 150, ...opts } = {}) {
  const A = norm(a), B = norm(b);
  const pool = assertSharedPool(A, B);
  const ra = A.map(x => x.rate), rb = B.map(x => x.rate), kA = ra.length, kB = rb.length;
  const ma = mean(ra), mb = mean(rb), estimate = ma - mb;
  let welch = null;
  if (kA >= 2 || kB >= 2) {
    const v = (r, m) => (r.length >= 2 ? sum(r.map(x => (x - m) ** 2)) / (r.length - 1) / r.length : 0);
    const va = v(ra, ma), vb = v(rb, mb), se = Math.sqrt(va + vb);
    const den = (kA >= 2 ? va ** 2 / (kA - 1) : 0) + (kB >= 2 ? vb ** 2 / (kB - 1) : 0);
    const df = den > 0 ? (va + vb) ** 2 / den : Math.max(1, kA + kB - 2);
    const q = studentTQuantile(1 - (1 - level) / 2, df);
    welch = { lo: estimate - q * se, hi: estimate + q * se, se, df, ...(se === 0 ? { note: 'no build-to-build spread in either arm: Welch interval degenerate; read the posterior interval' } : {}) };
  }
  const pa = buildRatePosterior(A, { level, ...opts }), pb = buildRatePosterior(B, { level, ...opts });
  const bin = post => {
    const v = post.mu.values, m = post.mu.mass, lo = v[0], w = (v[v.length - 1] - lo) / bins || 1e-12;
    const mm = new Float64Array(bins + 1), vv = new Float64Array(bins + 1);
    for (let i = 0; i < v.length; i++) { const k = Math.min(bins, Math.floor((v[i] - lo) / w)); mm[k] += m[i]; vv[k] += m[i] * v[i]; }
    const out = [];
    for (let k = 0; k <= bins; k++) if (mm[k] > 0) out.push([vv[k] / mm[k], mm[k]]);
    return out;
  };
  const ba = bin(pa), bb = bin(pb), pairs = [];
  for (const [x, mx] of ba) for (const [y, my] of bb) pairs.push([x - y, mx * my]);
  pairs.sort((x, y) => x[0] - y[0]);
  const tot = sum(pairs.map(p => p[1]));
  const values = pairs.map(p => p[0]), mass = pairs.map(p => p[1] / tot);
  const posterior = { ...summarise(values, mass, level), pPositive: sum(values.map((v, i) => (v > 0 ? mass[i] : 0))), ...(pa.note || pb.note ? { note: `${pa.note ? 'arm A' : 'arm B'}: ${CEILING_NOTE}` } : {}) };
  const head = welch && welch.se > 0 ? { lo: welch.lo, hi: welch.hi, method: 'welch' } : { lo: posterior.lo, hi: posterior.hi, method: 'posterior hpd (Welch undefined or degenerate)' };
  return {
    kA, kB, estimate, ...head, level, welch, posterior, pPositive: posterior.pPositive, pooled: pool.checked, paired: false,
    armA: { sampleMean: pa.sampleMean, mean: pa.mu.mean, median: pa.mu.median, lo: pa.mu.lo, hi: pa.mu.hi, sigmaBLogit: pa.sigmaBLogit, ...(pa.note ? { note: pa.note } : {}) },
    armB: { sampleMean: pb.sampleMean, mean: pb.mu.mean, median: pb.mu.median, lo: pb.mu.lo, hi: pb.mu.hi, sigmaBLogit: pb.sigmaBLogit, ...(pb.note ? { note: pb.note } : {}) },
  };
}

// ------------------------------------------------------------------------------------------------ σ_b, MDE
/**
 * The spread of one arm's build rates: sdRates (the sample SD of the rates, what the build-level test sees) and a moment
 * estimate of the between-build SD net of binomial noise, sqrt(max(0, s² − mean r(1 − r)/n)). The binomial term
 * overstates within-build noise on a fixed shared pool, so sigmaBMoment is a lower bound and sdRates an upper bound.
 */
export function estimateSigmaB(builds) {
  const B = norm(builds), r = B.map(b => b.rate), k = r.length;
  if (k < 2) return { k, mean: mean(r), sdRates: null, sigmaBMoment: null, within: null, note: 'K < 2: no spread can be measured' };
  const m = mean(r), s2 = sum(r.map(x => (x - m) ** 2)) / (k - 1);
  const within = B.every(b => b.completed) ? mean(B.map(b => (b.rate * (1 - b.rate)) / b.completed)) : null;
  return { k, mean: m, sdRates: Math.sqrt(s2), sigmaBMoment: within === null ? null : Math.sqrt(Math.max(0, s2 - within)), within };
}

/**
 * The MDE multiplier of the exact build-level permutation test, in units of the SD of one build's observed rate: the
 * smallest δ/sd at which the test (two-sided alpha, K vs K builds) rejects with probability `power` when each arm's rates
 * are N(μ_arm, sd²). The test is scale-free, so one multiplier serves every sd. Simulated (seeded, common random numbers
 * across δ, bisection), exact over all splits up to `exactMax`, Monte Carlo past it. Cached per (K, alpha, power).
 */
const mdeMultCache = new Map();
export function permutationMdeMultiplier(K, { alpha = ALPHA, power = 0.8, reps = 1000, exactMax = 1000, iterations = 999, seed = 'build-mde' } = {}) {
  const key = JSON.stringify([K, alpha, power, reps, exactMax, iterations, seed]);
  if (mdeMultCache.has(key)) return mdeMultCache.get(key);
  if (!(minAttainableP(K, K) < alpha)) { mdeMultCache.set(key, Infinity); return Infinity; }
  const r = rng(seed, K, alpha, power, reps);
  const draws = Array.from({ length: reps }, () => ({ a: Array.from({ length: K }, () => r.normal()), b: Array.from({ length: K }, () => r.normal()) }));
  const rejects = d => draws.filter(({ a, b }, i) => buildPermutationTest(a.map(x => x + d), b, { alpha, exactMax, iterations, seed: `${seed}:${i}`, rates: true }).p < alpha).length / reps;
  let lo = 0, hi = 12;
  for (let i = 0; i < 16; i++) { const mid = (lo + hi) / 2; if (rejects(mid) >= power) hi = mid; else lo = mid; }
  mdeMultCache.set(key, hi);
  return hi;
}

/**
 * Minimum detectable gap of the build-level comparison, K builds per arm, m cases per build. The spread is required, never
 * assumed: `sdRates`, the SD of build rates measured on the same pool at the same m (estimateSigmaB(builds).sdRates;
 * preferred), or a between-build SD `sigmaB` (then v = σ_b² + p(1 − p)/m, conservative on a shared pool). For K ≤ simMaxK
 * (6) the MDE is simulated with the exact permutation test (permutationMdeMultiplier × sd); past it, and beside it as mdeT,
 * the two-sample t approximation (t_{1−α/2} + t_{power})·sqrt(2v/K), df 2K − 2. The t form is optimistic at small K because
 * the permutation p is coarse there (multiplier of sd at 80% power, simulated vs t: K 4 2.98 vs 2.37, K 5 2.09 vs 2.02,
 * K 6 1.82 vs 1.79, K 8 1.52 vs 1.51), so it is used only from K 7 on. Infinity when the permutation test cannot reach
 * alpha at this K. lehrK: 16v/δ² at δ = gap.
 */
export function buildMde({ K, m, sigmaB = null, sdRates = null, pRef = SIM_DEFAULTS.pRef, alpha = ALPHA, power = 0.8, gap = null, simMaxK = 6 }) {
  if (!(Number.isInteger(K) && K >= 2 && m > 0)) throw new Error('buildMde: need integer K >= 2 and m > 0');
  if (sdRates === null && sigmaB === null) throw new Error('buildMde: the spread is measured, not assumed: give sdRates (SD of build rates) or sigmaB');
  if (!((sdRates ?? sigmaB) >= 0)) throw new Error('buildMde: sdRates / sigmaB must be >= 0');
  const v = sdRates !== null ? sdRates ** 2 : sigmaB ** 2 + (pRef * (1 - pRef)) / m, sd = Math.sqrt(v), se = Math.sqrt((2 * v) / K), df = 2 * K - 2;
  const resolvable = minAttainableP(K, K) < alpha;
  const mdeT = resolvable ? (studentTQuantile(1 - alpha / 2, df) + studentTQuantile(power, df)) * se : Infinity;
  const simulated = resolvable && K <= simMaxK;
  const mde = !resolvable ? Infinity : simulated ? permutationMdeMultiplier(K, { alpha, power }) * sd : mdeT;
  return { K, m, ...(sdRates !== null ? { sdRates } : { sigmaB, pRef }), alpha, power, se, mde, mdeT, method: !resolvable ? 'unresolvable' : simulated ? 'simulated exact permutation' : 't approximation', resolvable,
    ...(gap ? { lehrK: Math.ceil((16 * v) / gap ** 2) } : {}), casesBelowMinimum: m < MIN_CASES_PER_BUILD };
}
/** The smallest K (per arm) whose MDE is at most `gap`, up to kMax; null if none. */
export function kForMde({ gap, kMax = 40, ...opts }) {
  for (let K = 2; K <= kMax; K++) { const r = buildMde({ K, ...opts }); if (r.mde <= gap) return { ...r, gap }; }
  return null;
}

// ------------------------------------------------------------------------------------------------ simulation (B7 model)
/**
 * One replicate of the B7 generative model. Logit pass probability of case c on build b of arm a:
 *   logit(pRef) + shift_a + u_b + d_c,  u_b ~ N(0, σ_b,logit), d_c ~ N(0, σ_c) shared by every build of both arms,
 * shift = logit(pRef + gap) − logit(pRef) for arm A, 0 for arm B. σ_b on the pass-rate scale converts to the logit scale
 * as σ_b / (pRef(1 − pRef)) (0.08 → 0.63 at 0.85; the scratch simulation used 0.6).
 */
export function simulateArms(r, { K, kB = K, m, pRef = SIM_DEFAULTS.pRef, sigmaB = SIM_DEFAULTS.sigmaB, sigmaBLogit = null, sigmaC = SIM_DEFAULTS.sigmaC, gap = 0, cases = null }) {
  const sb = sigmaBLogit ?? sigmaB / (pRef * (1 - pRef));
  const d = cases ?? Array.from({ length: m }, () => sigmaC * r.normal());
  const mu0 = logit(pRef), shift = gap ? logit(pRef + gap) - mu0 : 0;
  const arm = (k, mu) => Array.from({ length: k }, () => {
    const u = sb * r.normal();
    let s = 0;
    for (let c = 0; c < d.length; c++) if (r.next() < sigmoid(mu + u + d[c])) s++;
    return { passed: s, completed: d.length };
  });
  return { a: arm(K, mu0 + shift), b: arm(kB, mu0), cases: d };
}

/** Rejection rates of the build-level permutation test and the case-pooled test over `reps` replicates. */
export function buildPower({ K, m, reps = 2000, seed = 'build-power', alpha = ALPHA, permIterations = 1999, exactMax = 20000, ...model }) {
  const r = rng(seed, K, m, model.gap ?? 0, model.sigmaB ?? model.sigmaBLogit ?? '');
  let build = 0, pooled = 0;
  for (let i = 0; i < reps; i++) {
    const { a, b } = simulateArms(r, { K, m, ...model });
    if (buildPermutationTest(a, b, { alpha, exactMax, iterations: permIterations, seed: `${seed}:${i}` }).p < alpha) build++;
    if (casePooledTest(a, b).p < alpha) pooled++;
  }
  return { K, m, gap: model.gap ?? 0, reps, alpha, build: build / reps, pooled: pooled / reps, mcSE: Math.sqrt(0.25 / reps) };
}

// ------------------------------------------------------------------------------------------------ sequential (blocks of builds)
/**
 * Looks at K = block, 2·block, …, kMax builds per arm, with the shared group-sequential boundary (equal spacing):
 * O'Brien-Fleming by default (the A4 choice; it keeps nearly the fixed-K power), Pocock on request.
 */
export function sequentialBuildDesign({ block = BLOCK, kMax = K_MAX, alpha = ALPHA, type = 'obrien-fleming' } = {}) {
  if (!(Number.isInteger(block) && block >= 1 && Number.isInteger(kMax) && kMax % block === 0)) throw new Error('sequentialBuildDesign: kMax must be a multiple of block');
  if (type !== 'obrien-fleming' && type !== 'pocock') throw new Error(`sequentialBuildDesign: unknown boundary ${type}`);
  const looks = kMax / block;
  const boundary = (type === 'pocock' ? pocockBoundary : obrienFlemingBoundary)(looks, { alpha });
  return { block, kMax, alpha, type, looks, kAt: Array.from({ length: looks }, (_, i) => (i + 1) * block), boundary };
}

/**
 * The decision at the current look: both arms must hold the same K, a multiple of the block. Stops for a difference when
 * the build-level permutation p is below the boundary's nominal level at this look AND the gap in mean build rate is at
 * least the 3-point floor (ROADMAP §4.3, as A4); a crossing under the floor does not decide. At kMax without a decision it
 * stops with "no resolvable difference". The posterior interval is reported beside it, never instead of it.
 */
export function sequentialBuildLook(a, b, design = sequentialBuildDesign(), { interval = true, floor = FLOOR, ...opts } = {}) {
  const A = norm(a), B = norm(b);
  if (A.length !== B.length) throw new Error(`sequential: arms hold ${A.length} and ${B.length} builds; looks need equal K`);
  const K = A.length;
  if (K % design.block || K > design.kMax) throw new Error(`sequential: K = ${K} is not a planned look (${design.kAt.join(', ')})`);
  const look = K / design.block;
  const test = buildPermutationTest(A, B, { alpha: design.alpha, ...opts });
  const nominal = design.boundary.nominal[look - 1];
  const crossed = crossesAt(design.boundary, look, test.p), floorMet = Math.abs(test.diff) >= floor, decided = crossed && floorMet;
  const decision = decided ? `stop: difference at look ${look} (K = ${K})`
    : K === design.kMax ? `stop: K_max ${design.kMax} reached, no resolvable difference${crossed ? ` (crossed, but |diff| ${Math.abs(test.diff).toFixed(3)} is under the ${floor} floor)` : ''}`
    : `continue: add ${design.block} builds per arm${crossed ? ` (crossed, but |diff| ${Math.abs(test.diff).toFixed(3)} is under the ${floor} floor)` : ''}`;
  return { look, K, nominal, p: test.p, crossed, floorMet, decided, decision, test, ...(interval && A.every(x => x.passed !== null) && B.every(x => x.passed !== null) ? { interval: buildDifferenceInterval(A, B) } : {}) };
}

/** Operating characteristics of the sequential rule (with its 3-point floor): stop rate (false stops at gap 0), mean K used, stops per look. */
export function simulateSequential({ m = 43, reps = 10000, seed = 'build-sequential', design = sequentialBuildDesign(), permIterations = 1999, exactMax = 20000, floor = FLOOR, ...model } = {}) {
  const r = rng(seed, m, model.gap ?? 0, reps);
  let stops = 0, kUsed = 0;
  const atLook = new Array(design.looks).fill(0);
  for (let i = 0; i < reps; i++) {
    const { a, b } = simulateArms(r, { K: design.kMax, m, ...model });
    let stopped = false;
    for (let L = 1; L <= design.looks; L++) {
      const K = L * design.block;
      const t = buildPermutationTest(a.slice(0, K), b.slice(0, K), { alpha: design.alpha, exactMax, iterations: permIterations, seed: `${seed}:${i}:${L}` });
      if (crossesAt(design.boundary, L, t.p) && Math.abs(t.diff) >= floor) { stops++; atLook[L - 1]++; kUsed += K; stopped = true; break; }
    }
    if (!stopped) kUsed += design.kMax;
  }
  return { m, gap: model.gap ?? 0, reps, stopRate: stops / reps, meanK: kUsed / reps, stopsAtLook: atLook, kAt: design.kAt, nominal: design.boundary.nominal };
}

// ------------------------------------------------------------------------------------------------ CLI
function parse(argv) {
  const a = { _: argv[0] };
  for (let i = 1; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith('--')) throw new Error(`unexpected argument ${k}`);
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) a[k.slice(2)] = true; else { a[k.slice(2)] = v; i++; }
  }
  return a;
}
const fmt = x => (x === null || x === undefined ? '-' : Number.isFinite(x) ? x.toFixed(4) : String(x));

async function main(argv) {
  const a = parse(argv);
  const nums = (s, d) => (s === undefined ? d : String(s).split(',').map(Number));
  const out = x => { if (a.json) console.log(JSON.stringify(x, null, 1)); return x; };
  if (a._ === 'compare') {
    const load = list => String(list).split(',').map(f => buildsFromResult(JSON.parse(readFileSync(f, 'utf8')), { pool: a.pool ?? 'grading', id: path.basename(path.dirname(f)) }));
    const A = load(a.a), B = load(a.b);
    const perm = buildPermutationTest(A, B), interval = A.length && B.length ? buildDifferenceInterval(A, B) : null;
    const r = out({ a: A.map(({ worlds, ...x }) => x), b: B.map(({ worlds, ...x }) => x), sigmaA: estimateSigmaB(A), sigmaB: estimateSigmaB(B), permutation: perm, interval, casePooled: casePooledTest(A, B) });
    if (!a.json) {
      for (const [n, arm] of [['A', r.a], ['B', r.b]]) console.log(`${n}: ${arm.map(x => `${x.id} ${x.passed}/${x.completed}`).join(', ')}`);
      console.log(`build-level: diff ${fmt(perm.diff)}, p ${fmt(perm.p)} (${perm.method}, ${perm.splits} splits, smallest attainable ${fmt(perm.minP)}): ${perm.verdict}`);
      for (const [n, arm] of [['A', interval.armA], ['B', interval.armB]]) console.log(`${n}: mean build rate ${fmt(arm.sampleMean)} (sample mean of build rates); posterior median ${fmt(arm.median)}, 95% HPD [${fmt(arm.lo)}, ${fmt(arm.hi)}]${arm.note ? ` (${arm.note})` : ''}`);
      console.log(`μA − μB: ${fmt(interval.estimate)} (difference of sample means); 95% ${interval.method} [${fmt(interval.lo)}, ${fmt(interval.hi)}]; posterior HPD [${fmt(interval.posterior.lo)}, ${fmt(interval.posterior.hi)}], P(> 0) ${fmt(interval.pPositive)} (independent arms on one shared pool; no world-level pairing)`);
      console.log(`case-pooled (wrong unit, for contrast): diff ${fmt(r.casePooled.diff)}, p ${fmt(r.casePooled.p)}`);
    }
    return;
  }
  if (a._ === 'power') {
    const rows = [];
    for (const K of nums(a.K, [3, 4, 6, 8, 12])) for (const m of nums(a.m, [43])) rows.push(buildPower({ K, m, reps: Number(a.reps ?? 2000), gap: Number(a.gap ?? SIM_DEFAULTS.gap), sigmaB: Number(a['sigma-b'] ?? SIM_DEFAULTS.sigmaB), sigmaC: Number(a['sigma-c'] ?? SIM_DEFAULTS.sigmaC), pRef: Number(a['p-ref'] ?? SIM_DEFAULTS.pRef) }));
    out(rows);
    if (!a.json) for (const r of rows) console.log(`K ${r.K} m ${r.m} gap ${r.gap}: build-level ${fmt(r.build)}, case-pooled ${fmt(r.pooled)} (reps ${r.reps}, MC SE <= ${fmt(r.mcSE)})`);
    return;
  }
  if (a._ === 'sequential') {
    const design = sequentialBuildDesign({ type: a.boundary ?? 'obrien-fleming' });
    const r = out(simulateSequential({ design, m: Number(a.m ?? 43), reps: Number(a.reps ?? 10000), gap: Number(a.gap ?? 0), sigmaB: Number(a['sigma-b'] ?? SIM_DEFAULTS.sigmaB) }));
    if (!a.json) console.log(`${design.type} m ${r.m} gap ${r.gap}: stop rate ${fmt(r.stopRate)}, mean K ${fmt(r.meanK)}, stops at looks ${r.stopsAtLook.join('/')} (K ${r.kAt.join('/')}), reps ${r.reps}`);
    return;
  }
  if (a._ === 'mde') {
    if (a['sd-rates'] === undefined && a['sigma-b'] === undefined) throw new Error('mde: give --sd-rates (measured SD of build rates at --m; preferred) or --sigma-b; the spread is measured, not assumed');
    const rows = nums(a.K, [3, 4, 6, 8, 12]).filter(K => K >= 2).map(K => buildMde({ K, m: Number(a.m ?? 400), sigmaB: a['sigma-b'] === undefined ? null : Number(a['sigma-b']),
      sdRates: a['sd-rates'] === undefined ? null : Number(a['sd-rates']), pRef: Number(a['p-ref'] ?? SIM_DEFAULTS.pRef), gap: a.gap ? Number(a.gap) : null }));
    out(rows);
    if (!a.json) for (const r of rows) console.log(`K ${r.K} m ${r.m} ${r.sdRates !== undefined ? `sd(rates) ${r.sdRates}` : `σ_b ${r.sigmaB}`}: MDE ${fmt(r.mde)} (${r.method}; t approximation ${fmt(r.mdeT)})${r.resolvable ? '' : ' (cannot resolve: exact permutation p never < alpha)'}${r.casesBelowMinimum ? ` (m < ${MIN_CASES_PER_BUILD})` : ''}`);
    return;
  }
  throw new Error('usage: stats-builds.mjs compare|power|sequential|mde …');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(e => { console.error(e.message); process.exitCode = 1; });
}
