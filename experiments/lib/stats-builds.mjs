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
//   betaBinomialPosterior(builds)    one arm's mean build pass rate μ with builds as a random effect: y_b ~ BetaBin(n_b,
//                                    μκ, (1 − μ)κ), μ uniform, between-build SD half-normal(0.15), on a two-pass grid
//   buildDifferenceInterval(a, b)    posterior of μ_A − μ_B (paired across shared worlds: both arms graded on one pool)
//   estimateSigmaB(builds)           measured spread of build rates (sd of rates; moment estimate net of binomial noise)
//   buildMde / kForMde               the minimum detectable gap for K builds per arm, m cases each, measured σ_b
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
//   node experiments/lib/stats-builds.mjs mde --K 3,6,8,12 --m 1022 (--sd-rates 0.03 | --sigma-b 0.05) [--json]
//
// Measured with this file (2026-10-21, development evidence, the B7 model: σ_b 0.08, σ_c 0.8, p 0.85):
//   type-I at gap 0, m 43, 2,000 reps: build-level 0.000/0.019/0.037/0.040/0.037 at K 3/4/6/8/12; case-pooled
//     0.237/0.244/0.248/0.243/0.246 (the teeth: about 25% at every K);
//   power at gap 0.10, 1,000 reps: m 43: 0.00/0.25/0.56/0.78/0.92 at K 3/4/6/8/12; K 6: 0.29/0.56/0.82 at m 14/43/400;
//   sequential (O'Brien-Fleming, blocks of 2, K_max 12): false stops 0.0476 over 10,000 nulls at m 43; at gap 0.10 it
//     stops 0.91 of the time with mean K 9.2 (m 43) and 0.98 with mean K 8.1 (m 400). So it does NOT use fewer builds
//     than a fixed K = 8 (the researcher's expectation); it buys power (fixed K = 8: 0.78 and 0.92) at a mean K below
//     the fixed K = 12 that reaches the same power.
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
export const SIGMA_B_PRIOR_SCALE = 0.15;  // half-normal scale of the posterior's prior on σ_b (weakly informative)
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

/** Throws unless every build of both arms was graded on the same pool of worlds (the paired design). */
export function assertSharedPool(...arms) {
  const pools = arms.flat().map(b => (b.pool ? JSON.stringify(b.pool) : null));
  if (pools.some(p => p === null)) return { checked: false };
  if (new Set(pools).size !== 1) throw new Error('stats-builds: builds were graded on different world pools; a build-level comparison needs one shared pool (paired across shared worlds)');
  return { checked: true, pool: JSON.parse(pools[0]) };
}

/**
 * One build from an E8 / COMP-1 result.json: `pool: 'grading'` sums the full-size grading worlds (rows without a size;
 * 9 worlds, 1,022 completed cases in the COMP-1 pool), `pool: 'paired'` the size-limited paired world (1232 d2 size 12,
 * 14 completed cases). Rows carry { seed, d, size, status, completed, passed } or { oracle: { completed, passed } }.
 */
export function buildsFromResult(json, { pool = 'grading', id = json?.label } = {}) {
  const rows = (json?.rows ?? []).filter(r => (pool === 'paired' ? r.size != null : r.size == null));
  if (!rows.length) throw new Error(`stats-builds: ${id}: no ${pool} rows`);
  const bad = rows.filter(r => r.status !== 'complete');
  if (bad.length) throw new Error(`stats-builds: ${id}: ${bad.length} ${pool} row(s) not complete`);
  const c = r => r.completed ?? r.oracle?.completed, p = r => r.passed ?? r.oracle?.passed;
  return {
    id, passed: sum(rows.map(p)), completed: sum(rows.map(c)),
    pool: rows.map(r => `${r.seed}/${r.d}/${r.size ?? 'full'}`).sort(),
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
export function buildPermutationTest(a, b, { alpha = ALPHA, exactMax = 20000, iterations = 9999, seed = 'build-permutation' } = {}) {
  const A = norm(a), B = norm(b);
  assertSharedPool(A, B);
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

// ------------------------------------------------------------------------------------------------ beta-binomial posterior
// log Γ (Lanczos g = 7, 9 terms).
const LANCZOS = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
  12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
function lgamma(x) {
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x);
  const z = x - 1, t = z + 7.5;
  let s = LANCZOS[0];
  for (let i = 1; i < 9; i++) s += LANCZOS[i] / (z + i);
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(s);
}

// Unnormalised log posterior of (logit μ, ln κ) for one arm's builds, over a grid. Prior: μ uniform on (0, 1); the
// between-build SD on the pass-rate scale, σ_b = sqrt(μ(1 − μ)/(κ + 1)), half-normal with scale `sigmaBScale` (weakly
// informative: measured σ_b in E8 rows is 0.04-0.12, FIXES B7). On a logit-μ × ln-κ grid the cell weight carries the
// Jacobians μ(1 − μ) and |dσ_b/d ln κ| = σ_b·κ/(2(κ + 1)). (BDA3's p(α, β) ∝ (α + β)^(−5/2) was tried first and rejected:
// at K = 3 it puts most of the mass on absurd dispersion, e.g. builds at 1.000/0.953/0.993 gave a posterior mean of 0.77.)
function gridPosterior(builds, lx, lk, sigmaBScale) {
  const out = new Float64Array(lx.length * lk.length);
  const byN = new Map();
  for (const b of builds) { if (!byN.has(b.completed)) byN.set(b.completed, []); byN.get(b.completed).push(b.passed); }
  let max = -Infinity;
  for (let j = 0; j < lk.length; j++) {
    const kappa = Math.exp(lk[j]);
    for (let i = 0; i < lx.length; i++) {
      const mu = sigmoid(lx[i]), al = mu * kappa, be = (1 - mu) * kappa;
      if (!(al > 0 && be > 0)) { out[j * lx.length + i] = -Infinity; continue; }
      const lnBab = lgamma(al) + lgamma(be) - lgamma(kappa);
      let ll = 0;
      for (const [n, ys] of byN) {
        const lnTot = lgamma(n + kappa);
        for (const y of ys) ll += lgamma(y + al) + lgamma(n - y + be) - lnTot - lnBab;
      }
      const sb = Math.sqrt((mu * (1 - mu)) / (kappa + 1));
      const v = ll + Math.log(mu * (1 - mu)) - 0.5 * (sb / sigmaBScale) ** 2 + Math.log((sb * kappa) / (2 * (kappa + 1)));
      out[j * lx.length + i] = v;
      if (v > max) max = v;
    }
  }
  return { logp: out, max };
}
const linspace = (lo, hi, n) => Array.from({ length: n }, (_, i) => lo + ((hi - lo) * i) / (n - 1));

/**
 * One arm's posterior for the mean build pass rate μ (builds as a random effect). Two passes: a coarse logit grid over
 * (−12, 12) finds where the posterior lives, then a fine grid there. Returns the μ marginal (grid of values and masses),
 * its mean and equal-tailed interval, and the implied between-build SD sqrt(μ(1 − μ)/(κ + 1)) (posterior mean).
 */
export function betaBinomialPosterior(builds, { level = 0.95, coarse = [121, 31], fine = [161, 41], kappaRange = [0.1, 1e7], sigmaBScale = SIGMA_B_PRIOR_SCALE } = {}) {
  const B = norm(builds);
  if (B.some(b => b.passed === null)) throw new Error('stats-builds: the posterior needs passed/completed counts, not bare rates');
  const lk0 = Math.log(kappaRange[0]), lk1 = Math.log(kappaRange[1]);
  // pass 1
  let lx = linspace(-12, 12, coarse[0]), lk = linspace(lk0, lk1, coarse[1]);
  let g = gridPosterior(B, lx, lk, sigmaBScale);
  const keep = new Set();
  for (let j = 0; j < lk.length; j++) for (let i = 0; i < lx.length; i++) if (g.logp[j * lx.length + i] > g.max - 18) keep.add(i);
  const idx = [...keep].sort((x, y) => x - y);
  const step = lx[1] - lx[0];
  const lo = Math.max(-12, lx[idx[0]] - 2 * step), hi = Math.min(12, lx[idx[idx.length - 1]] + 2 * step);
  // pass 2
  lx = linspace(lo, hi, fine[0]); lk = linspace(lk0, lk1, fine[1]);
  g = gridPosterior(B, lx, lk, sigmaBScale);
  const muMass = new Float64Array(lx.length);
  let tot = 0, sbNum = 0;
  for (let j = 0; j < lk.length; j++) {
    const kappa = Math.exp(lk[j]);
    for (let i = 0; i < lx.length; i++) {
      const w = Math.exp(g.logp[j * lx.length + i] - g.max);
      muMass[i] += w; tot += w;
      const mu = sigmoid(lx[i]);
      sbNum += w * Math.sqrt((mu * (1 - mu)) / (kappa + 1));
    }
  }
  const mu = lx.map(sigmoid), mass = Array.from(muMass, w => w / tot);
  const q = quantilesDiscrete(mu, mass, [(1 - level) / 2, 1 - (1 - level) / 2]);
  return { k: B.length, mu: { values: mu, mass, mean: sum(mu.map((v, i) => v * mass[i])), lo: q[0], hi: q[1], level }, sigmaB: sbNum / tot, prior: { mu: 'uniform', sigmaB: `half-normal(${sigmaBScale})` }, grid: { logitRange: [lo, hi], fine, coarse, kappaRange } };
}

// Quantiles of a discrete distribution (values ascending, masses) with linear interpolation between support points.
function quantilesDiscrete(values, mass, ps) {
  const cum = []; let c = 0;
  for (const m of mass) { c += m; cum.push(c); }
  return ps.map(p => {
    let i = cum.findIndex(x => x >= p);
    if (i < 0) i = values.length - 1;
    if (i === 0) return values[0];
    const f = (p - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
    return values[i - 1] + f * (values[i] - values[i - 1]);
  });
}

/**
 * Posterior of μ_A − μ_B (independent arms of builds, every build graded on one shared pool): the exact convolution of
 * the two grid marginals. Returns { mean, lo, hi, pPositive } plus each arm's posterior summary.
 */
export function buildDifferenceInterval(a, b, { level = 0.95, ...opts } = {}) {
  const A = norm(a), B = norm(b);
  const pool = assertSharedPool(A, B);
  const pa = betaBinomialPosterior(A, { level, ...opts }), pb = betaBinomialPosterior(B, { level, ...opts });
  const pairs = [];
  for (let i = 0; i < pa.mu.values.length; i++) {
    if (pa.mu.mass[i] < 1e-12) continue;
    for (let j = 0; j < pb.mu.values.length; j++) {
      const m = pa.mu.mass[i] * pb.mu.mass[j];
      if (m > 1e-14) pairs.push([pa.mu.values[i] - pb.mu.values[j], m]);
    }
  }
  pairs.sort((x, y) => x[0] - y[0]);
  const tot = sum(pairs.map(p => p[1]));
  const values = pairs.map(p => p[0]), mass = pairs.map(p => p[1] / tot);
  const [lo, hi] = quantilesDiscrete(values, mass, [(1 - level) / 2, 1 - (1 - level) / 2]);
  return {
    kA: A.length, kB: B.length, mean: sum(values.map((v, i) => v * mass[i])), lo, hi, level,
    pPositive: sum(values.map((v, i) => (v > 0 ? mass[i] : 0))), pooled: pool.checked,
    armA: { mean: pa.mu.mean, lo: pa.mu.lo, hi: pa.mu.hi, sigmaB: pa.sigmaB },
    armB: { mean: pb.mu.mean, lo: pb.mu.lo, hi: pb.mu.hi, sigmaB: pb.sigmaB },
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
 * Minimum detectable gap of the build-level comparison, K builds per arm, m cases per build: a two-sample t
 * approximation, SE = sqrt(2v/K), df = 2K − 2, MDE = (t_{1−α/2} + t_{power})·SE, where v is the variance of one build's
 * observed rate. Preferred: `sdRates`, the SD of build rates measured on the same pool at the same m
 * (estimateSigmaB(builds).sdRates), v = sdRates². Otherwise v = σ_b² + p(1 − p)/m from a between-build SD σ_b and the
 * binomial bound (conservative on a shared pool with heterogeneous cases). Infinity when the exact permutation test
 * cannot reach alpha at this K. lehrK: Lehr's rule 16v/δ² builds per arm for 80% power at δ = `gap`.
 */
export function buildMde({ K, m, sigmaB = SIGMA_B_ASSUMED, sdRates = null, pRef = SIM_DEFAULTS.pRef, alpha = ALPHA, power = 0.8, gap = null }) {
  if (!(Number.isInteger(K) && K >= 2 && m > 0 && (sdRates === null ? sigmaB >= 0 : sdRates >= 0))) throw new Error('buildMde: need integer K >= 2, m > 0, and sigmaB >= 0 or sdRates >= 0');
  const v = sdRates !== null ? sdRates ** 2 : sigmaB ** 2 + (pRef * (1 - pRef)) / m, se = Math.sqrt((2 * v) / K), df = 2 * K - 2;
  const resolvable = minAttainableP(K, K) < alpha;
  const mde = resolvable ? (studentTQuantile(1 - alpha / 2, df) + studentTQuantile(power, df)) * se : Infinity;
  return { K, m, ...(sdRates !== null ? { sdRates } : { sigmaB, pRef }), alpha, power, se, mde, resolvable,
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
 * the build-level permutation p is below the boundary's nominal level at this look; at kMax without a crossing it stops
 * with "no resolvable difference". The posterior interval is reported beside it, never instead of it.
 */
export function sequentialBuildLook(a, b, design = sequentialBuildDesign(), { interval = true, ...opts } = {}) {
  const A = norm(a), B = norm(b);
  if (A.length !== B.length) throw new Error(`sequential: arms hold ${A.length} and ${B.length} builds; looks need equal K`);
  const K = A.length;
  if (K % design.block || K > design.kMax) throw new Error(`sequential: K = ${K} is not a planned look (${design.kAt.join(', ')})`);
  const look = K / design.block;
  const test = buildPermutationTest(A, B, { alpha: design.alpha, ...opts });
  const nominal = design.boundary.nominal[look - 1];
  const crossed = crossesAt(design.boundary, look, test.p);
  const decision = crossed ? `stop: difference at look ${look} (K = ${K})` : K === design.kMax ? `stop: K_max ${design.kMax} reached, no resolvable difference` : `continue: add ${design.block} builds per arm`;
  return { look, K, nominal, p: test.p, crossed, decision, test, ...(interval && A.every(x => x.passed !== null) && B.every(x => x.passed !== null) ? { interval: buildDifferenceInterval(A, B) } : {}) };
}

/** Operating characteristics of the sequential rule: stop rate (false stops at gap 0), mean K used, stops per look. */
export function simulateSequential({ m = 43, reps = 10000, seed = 'build-sequential', design = sequentialBuildDesign(), permIterations = 1999, exactMax = 20000, ...model } = {}) {
  const r = rng(seed, m, model.gap ?? 0, reps);
  let stops = 0, kUsed = 0;
  const atLook = new Array(design.looks).fill(0);
  for (let i = 0; i < reps; i++) {
    const { a, b } = simulateArms(r, { K: design.kMax, m, ...model });
    let stopped = false;
    for (let L = 1; L <= design.looks; L++) {
      const K = L * design.block;
      const p = buildPermutationTest(a.slice(0, K), b.slice(0, K), { alpha: design.alpha, exactMax, iterations: permIterations, seed: `${seed}:${i}:${L}` }).p;
      if (crossesAt(design.boundary, L, p)) { stops++; atLook[L - 1]++; kUsed += K; stopped = true; break; }
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
      console.log(`posterior μA − μB: ${fmt(interval.mean)} [${fmt(interval.lo)}, ${fmt(interval.hi)}] (95%), P(> 0) ${fmt(interval.pPositive)}`);
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
    const rows = nums(a.K, [3, 4, 6, 8, 12]).filter(K => K >= 2).map(K => buildMde({ K, m: Number(a.m ?? 400), sigmaB: Number(a['sigma-b'] ?? SIM_DEFAULTS.sigmaB),
      sdRates: a['sd-rates'] === undefined ? null : Number(a['sd-rates']), pRef: Number(a['p-ref'] ?? SIM_DEFAULTS.pRef), gap: a.gap ? Number(a.gap) : null }));
    out(rows);
    if (!a.json) for (const r of rows) console.log(`K ${r.K} m ${r.m} ${r.sdRates !== undefined ? `sd(rates) ${r.sdRates}` : `σ_b ${r.sigmaB}`}: MDE ${fmt(r.mde)}${r.resolvable ? '' : ' (cannot resolve: exact permutation p never < alpha)'}${r.casesBelowMinimum ? ` (m < ${MIN_CASES_PER_BUILD})` : ''}`);
    return;
  }
  throw new Error('usage: stats-builds.mjs compare|power|sequential|mde …');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(e => { console.error(e.message); process.exitCode = 1; });
}
