// E-bed statistics (research/enterprise-20261014/E-BED.md §6; BED-CONTRACT-v1.1.md §13). $0, pure functions, no model
// calls, no new dependencies (the seeded PRNG is beds/lib/rng.mjs). E-BED §6 asked for these in experiments/jit/stats.mjs;
// they live in this new module instead so the JIT instrument (and its pinned tests) does not move.
//
//   node experiments/lib/stats-ebed.mjs power [--iterations N] [--json]     the family-test power table (K × true gap)
//   node experiments/lib/stats-ebed.mjs thresholds [--json]                 H-E2 failure thresholds and the H-E2c case count
//
// Units. Success rates and gaps are proportions in [0, 1] (a "point" is 0.01). The decision unit is the closed-loop case
// segment on completed cases, paired across arms by (world, case) (E-BED §6 "Units"). Every function below takes the
// already-filtered pairs or counts; filtering to completed tail-mix cases is the scorer's job (BED-CONTRACT-v1.1 §6).
//
// Contents
//   clopperPearson(x, n, side)      exact binomial bounds; one-sided lower/upper or two-sided (E-BED §6 (ii))
//   maxFailures, minCleanCases      the H-E2 / H-E2c thresholds those bounds imply (E-BED §6 table)
//   reliabilityVerdict(worlds)      H-E2(i): pooled lower bound >= 0.95, every world >= 0.90, zero critical violations
//   censoringReport(epochs)         the "censored" mark (share > 20% in an epoch; E-BED §2.1)
//   wilcoxonExact(d)                exact signed-rank test, conditional on the observed (mid)ranks (E-BED §6 (iii))
//   wilcoxonCritical(n, alpha)      the no-ties one-sided critical W- (9 items: 8, p = 25/512)
//   familyTest(items)               the family-level test (i): one-sided Wilcoxon on {gap_i + delta}, p < alpha
//   familyDecision(arms)            (i) with Holm across arms, (ii) H-E2 on >= 7 items, (iii) no extra critical item
//   holm(pValues)                   Holm step-down adjusted p-values (E-BED §6 (iv))
//   nonInferiority(pairs, delta)    world-clustered bootstrap lower bound of the paired difference vs -delta (E-BED §6 (i))
//   itemGapSE, familyPower          the power simulation behind "K = 4 is recommended" (E-BED §6 "Power")
//
// Inequalities. Every test here rejects on a strict "p < alpha" (E-BED §6 writes "p < 0.05"), Holm included; a bound
// passes on ">= its threshold". Exact Wilcoxon p-values are dyadic (k / 2^n) and never equal 0.05 / j, so the strict
// form only matters for bootstrap p-values.
import { rng } from '../../beds/lib/rng.mjs';

export const ALPHA = 0.05;
export const NI_MARGIN = 0.10;          // delta: H-E1, H-E7 and the family test (E-BED §6)
export const RHO_EBED = 0.1;            // assumed within-world ICC of paired case differences; the value E-BED's power used
export const H_E2 = Object.freeze({ pooled: 0.95, world: 0.90, level: 0.95, criticalRate: 0.001 });
export const CENSOR_LIMIT = 0.20;       // E-BED §2.1: a verdict resting on a censored share > 20% in any epoch is "censored"
export const FAMILY = Object.freeze({ minItems: 6, minReliable: 7 });   // E-BED §6: n < 6 means no claim; H-E2 on >= 7 items

const isProb = p => typeof p === 'number' && Number.isFinite(p) && p >= 0 && p <= 1;
const assertCount = (v, name) => { if (!Number.isInteger(v) || v < 0) throw new Error(`stats-ebed: ${name} must be a non-negative integer, got ${v}`); };

// ------------------------------------------------------------------------------------------------ special functions
// log Γ(x), Lanczos (g = 7, 9 terms; relative error ~1e-15 for x > 0).
const LANCZOS = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
  12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
export function logGamma(x) {
  if (!(x > 0)) throw new Error(`stats-ebed: logGamma needs x > 0, got ${x}`);
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  const z = x - 1, t = z + 7.5;
  let a = LANCZOS[0];
  for (let i = 1; i < 9; i++) a += LANCZOS[i] / (z + i);
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

// Continued fraction for the incomplete beta (modified Lentz; Numerical Recipes §6.4).
function betaCF(a, b, x) {
  const FPMIN = 1e-300, EPS = 1e-16, MAXIT = 20000;
  const qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1, d = 1 - qab * x / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d; h *= d * c;
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) return h;
  }
  throw new Error(`stats-ebed: incomplete beta did not converge (a ${a}, b ${b}, x ${x})`);
}

// Regularised incomplete beta I_x(a, b).
export function betaInc(a, b, x) {
  if (!(a > 0 && b > 0)) throw new Error(`stats-ebed: betaInc needs a, b > 0, got ${a}, ${b}`);
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log1p(-x));
  return x < (a + 1) / (a + b + 2) ? front * betaCF(a, b, x) / a : 1 - front * betaCF(b, a, 1 - x) / b;
}

// P(X >= k) for X ~ Binomial(n, p) = I_p(k, n − k + 1).
export function binomUpperTail(n, p, k) {
  assertCount(n, 'n');
  if (!isProb(p)) throw new Error(`stats-ebed: p must be in [0, 1], got ${p}`);
  if (k <= 0) return 1;
  if (k > n) return 0;
  if (p === 0) return 0;
  if (p === 1) return 1;
  return betaInc(k, n - k + 1, p);
}
// P(X <= k).
export const binomLowerTail = (n, p, k) => (k < 0 ? 0 : k >= n ? 1 : 1 - binomUpperTail(n, p, k + 1));

// Root of a non-decreasing f on [0, 1] (bisection to double precision).
function bisect(f, target) {
  let lo = 0, hi = 1;
  for (let i = 0; i < 200 && hi - lo > 1e-16; i++) { const mid = (lo + hi) / 2; if (f(mid) < target) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}

// ------------------------------------------------------------------------------------------------ Clopper-Pearson
// Exact (Clopper-Pearson 1934) bounds for x successes in n trials.
//   one-sided lower at level L (alpha = 1 − L): 0 if x = 0, else the p with P(X >= x | p) = alpha;
//   one-sided upper: 1 if x = n, else the p with P(X <= x | p) = alpha;
//   two-sided at level L: the one-sided bounds at alpha / 2 each.
// Closed forms used by the tests: lower(n, n) = alpha^(1/n); upper(0, n) = 1 − alpha^(1/n).
export function clopperPearson(x, n, side = 'lower', { level = 0.95 } = {}) {
  assertCount(n, 'n'); assertCount(x, 'x');
  if (x > n) throw new Error(`stats-ebed: x (${x}) > n (${n})`);
  if (!['lower', 'upper', 'two-sided'].includes(side)) throw new Error(`stats-ebed: side must be lower, upper or two-sided, got ${side}`);
  if (!(level > 0 && level < 1)) throw new Error(`stats-ebed: level must be in (0, 1), got ${level}`);
  if (n === 0) return { x, n, side, level, estimate: NaN, lower: 0, upper: 1 };
  const alpha = side === 'two-sided' ? (1 - level) / 2 : 1 - level;
  // P(X >= x | p) is increasing in p; P(X <= x | p) is decreasing in p.
  const lower = x === 0 ? 0 : bisect(p => binomUpperTail(n, p, x), alpha);
  const upper = x === n ? 1 : bisect(p => -binomLowerTail(n, p, x), -alpha);
  return { x, n, side, level, estimate: x / n, lower: side === 'upper' ? 0 : lower, upper: side === 'lower' ? 1 : upper };
}

// The one-sided lower bound at `level` is >= bound  <=>  P(X >= x | p = bound) <= 1 − level (the tail rises with p).
// Deciding on the tail avoids the bisection's last-bit error at the threshold.
export const lowerBoundAtLeast = (x, n, bound, { level = 0.95 } = {}) => n > 0 && (x === 0 ? bound <= 0 : binomUpperTail(n, bound, x) <= 1 - level);

// Largest number of failures f in n cases whose one-sided lower bound on success is still >= bound (−1 if none).
// E-BED §6: n = 300 → 8, n = 100 → 1 at bound 0.95; n = 100 → 4 at bound 0.90.
export function maxFailures(n, bound, { level = 0.95 } = {}) {
  assertCount(n, 'n');
  let f = -1;
  while (f + 1 <= n && lowerBoundAtLeast(n - (f + 1), n, bound, { level })) f++;
  return f;
}

// Smallest number of clean cases (0 critical violations) whose one-sided upper bound on the violation rate is <= rate:
// 1 − alpha^(1/n) <= rate  <=>  n >= ln(alpha) / ln(1 − rate). E-BED H-E2c: rate 0.001 → 2,995.
export function minCleanCases(rate = H_E2.criticalRate, { level = 0.95 } = {}) {
  if (!(rate > 0 && rate < 1)) throw new Error(`stats-ebed: rate must be in (0, 1), got ${rate}`);
  let n = Math.max(1, Math.ceil(Math.log(1 - level) / Math.log1p(-rate)) - 2);
  while (1 - Math.pow(1 - level, 1 / n) > rate) n++;
  return n;
}

// ------------------------------------------------------------------------------------------------ H-E2 reliability
// H-E2(i) for one arm and item: completed tail-mix cases per held-out world.
//   worlds: [{ world, completed, passed, critical = 0 }]
// holds iff the pooled one-sided lower bound >= pooledBound (0.95), every world's own lower bound >= worldBound (0.90),
// and no critical violation anywhere. H-E2c (critical rate <= 0.1%) is reported beside it as `criticalRate`: the upper
// bound from the clean cases, established only when n >= minCleanCases() (2,995 at 0.1%).
export function reliabilityVerdict(worlds, { pooledBound = H_E2.pooled, worldBound = H_E2.world, level = H_E2.level, criticalRate = H_E2.criticalRate, censoring = null } = {}) {
  if (!Array.isArray(worlds) || !worlds.length) throw new Error('stats-ebed: reliabilityVerdict needs at least one world');
  const seen = new Set();
  const per = worlds.map(w => {
    if (seen.has(w.world)) throw new Error(`stats-ebed: world ${w.world} repeated`);
    seen.add(w.world);
    assertCount(w.completed, `${w.world}.completed`); assertCount(w.passed, `${w.world}.passed`); assertCount(w.critical ?? 0, `${w.world}.critical`);
    if (w.passed > w.completed) throw new Error(`stats-ebed: ${w.world} passed > completed`);
    const cp = clopperPearson(w.passed, w.completed, 'lower', { level });
    return { world: w.world, completed: w.completed, passed: w.passed, critical: w.critical ?? 0, lower: cp.lower,
      ok: lowerBoundAtLeast(w.passed, w.completed, worldBound, { level }), maxFailures: maxFailures(w.completed, worldBound, { level }) };
  });
  const n = per.reduce((s, w) => s + w.completed, 0), x = per.reduce((s, w) => s + w.passed, 0), critical = per.reduce((s, w) => s + w.critical, 0);
  const pooled = { completed: n, passed: x, lower: clopperPearson(x, n, 'lower', { level }).lower, ok: lowerBoundAtLeast(x, n, pooledBound, { level }), maxFailures: maxFailures(n, pooledBound, { level }) };
  const clean = critical === 0 ? n : 0;
  const crit = { violations: critical, upper: critical === 0 ? clopperPearson(0, n, 'upper', { level }).upper : null,
    needed: minCleanCases(criticalRate, { level }), established: critical === 0 && n >= minCleanCases(criticalRate, { level }) && clean > 0 };
  const holds = pooled.ok && per.every(w => w.ok) && critical === 0;
  const cens = censoring ? censoringReport(censoring) : null;
  return { holds, label: cens?.marked ? (holds ? 'holds (censored)' : 'fails (censored)') : (holds ? 'holds' : 'fails'), pooled, worlds: per, critical: crit, censoring: cens,
    rule: `one-sided ${level * 100}% Clopper-Pearson lower bound >= ${pooledBound} pooled and >= ${worldBound} in every world; zero critical violations` };
}

// Censoring per epoch: epochs [{ epoch, started, censored }] (cases assigned by start date; E-BED §2.1).
//   marked: some counted epoch has censored / started > limit (E-BED §2.1: the verdict is labelled "censored").
//   exceptLast: skip the last epoch (the bed-health rule of E-BED §9.2: the horizon closes >= 80% of the cases started
//   in every epoch except the last).
export function censoringReport(epochs, { limit = CENSOR_LIMIT, exceptLast = false } = {}) {
  if (!Array.isArray(epochs)) throw new Error('stats-ebed: censoringReport needs a list of epochs');
  const rows = epochs.map((e, i) => {
    assertCount(e.started, 'started'); assertCount(e.censored, 'censored');
    if (e.censored > e.started) throw new Error(`stats-ebed: epoch ${e.epoch ?? i}: censored > started`);
    const share = e.started ? e.censored / e.started : 0;
    const counted = !(exceptLast && i === epochs.length - 1);
    return { epoch: e.epoch ?? i, started: e.started, censored: e.censored, share, counted, over: counted && share > limit };
  });
  return { limit, exceptLast, epochs: rows, marked: rows.some(r => r.over) };
}

// ------------------------------------------------------------------------------------------------ Wilcoxon signed-rank
// Midranks of |d| (ties: values within tieTol of their sorted neighbour share the mean rank).
function midranks(abs, tieTol) {
  const idx = abs.map((v, i) => i).sort((i, j) => abs[i] - abs[j]);
  const ranks = new Array(abs.length);
  let tied = false;
  for (let s = 0; s < idx.length;) {
    let e = s;
    while (e + 1 < idx.length && abs[idx[e + 1]] - abs[idx[e]] <= tieTol) e++;
    if (e > s) tied = true;
    for (let k = s; k <= e; k++) ranks[idx[k]] = (s + e) / 2 + 1;
    s = e + 1;
  }
  return { ranks, tied };
}

// Null distribution of the sum of a random subset of `ranks` (each in with probability 1/2), as probabilities indexed by
// twice the sum (midranks are multiples of 1/2). Exact (dyadic) for up to 52 ranks.
function subsetSumDistribution(ranks) {
  const twice = ranks.map(r => Math.round(2 * r)), total = twice.reduce((s, v) => s + v, 0);
  let dist = new Float64Array(total + 1);
  dist[0] = 1;
  let reach = 0;
  for (const v of twice) {
    const next = new Float64Array(total + 1);
    for (let s = 0; s <= reach; s++) if (dist[s]) { next[s] += dist[s] / 2; next[s + v] += dist[s] / 2; }
    reach += v; dist = next;
  }
  return dist;
}
const cdfAt = (dist, twiceW) => { let p = 0; for (let s = 0; s <= Math.min(twiceW, dist.length - 1); s++) p += dist[s]; return Math.min(1, p); };

// Exact Wilcoxon signed-rank test of location 0, conditional on the observed absolute values (the sign-flip permutation
// distribution, which is the classic exact null when there are no ties).
//   alternative 'greater' (H1: location > 0): p = P(W- <= observed W-); 'less': p = P(W+ <= observed W+);
//   'two-sided': twice the smaller one-sided p, capped at 1.
//   zeros 'wilcox' (default): zero differences are dropped (Wilcoxon 1945; the SciPy default); 'pratt': zeros take part
//   in the ranking, then their ranks leave both statistics and the null (Pratt 1959).
export function wilcoxonExact(d, { alternative = 'greater', zeros = 'wilcox', tieTol = 1e-9 } = {}) {
  if (!Array.isArray(d) || !d.every(v => typeof v === 'number' && Number.isFinite(v))) throw new Error('stats-ebed: wilcoxonExact needs a list of finite numbers');
  if (!['greater', 'less', 'two-sided'].includes(alternative)) throw new Error(`stats-ebed: alternative must be greater, less or two-sided, got ${alternative}`);
  if (!['wilcox', 'pratt'].includes(zeros)) throw new Error(`stats-ebed: zeros must be wilcox or pratt, got ${zeros}`);
  const isZero = v => Math.abs(v) <= tieTol;
  const used = zeros === 'wilcox' ? d.filter(v => !isZero(v)) : d.slice();
  const { ranks, tied } = midranks(used.map(Math.abs), tieTol);
  const nonzero = used.map((v, i) => ({ v, r: ranks[i] })).filter(o => !isZero(o.v));
  const n = nonzero.length;
  if (n > 1000) throw new Error('stats-ebed: wilcoxonExact supports at most 1000 non-zero differences');
  const wPlus = nonzero.filter(o => o.v > 0).reduce((s, o) => s + o.r, 0), wMinus = nonzero.filter(o => o.v < 0).reduce((s, o) => s + o.r, 0);
  const dist = subsetSumDistribution(nonzero.map(o => o.r));
  // By symmetry of the null, W- and W+ have the same distribution.
  const pGreater = cdfAt(dist, Math.round(2 * wMinus)), pLess = cdfAt(dist, Math.round(2 * wPlus));
  const p = alternative === 'greater' ? pGreater : alternative === 'less' ? pLess : Math.min(1, 2 * Math.min(pGreater, pLess));
  return { n, nTotal: d.length, zeros: d.filter(isZero).length, zeroMethod: zeros, ties: tied, wPlus, wMinus, alternative, p, exact: n <= 52 };
}

// The largest W- whose no-ties null probability P(W- <= c) is still < alpha, for n non-zero differences (−1 if none):
// 5 → 0, 6 → 2, 7 → 3, 8 → 5, 9 → 8 at alpha 0.05 one-sided.
export function wilcoxonCritical(n, alpha = ALPHA) {
  assertCount(n, 'n');
  const dist = subsetSumDistribution(Array.from({ length: n }, (_, i) => i + 1));
  let c = -1, acc = 0;
  for (let w = 0; 2 * w < dist.length; w++) { acc += dist[2 * w]; if (acc < alpha) c = w; else break; }
  return { n, alpha, critical: c, p: c < 0 ? null : cdfAt(dist, 2 * c) };
}

// ------------------------------------------------------------------------------------------------ Holm
// Holm (1979) step-down adjusted p-values: with p sorted ascending, adj_(j) = max_{i <= j} min(1, (m − i + 1) · p_(i)).
// Accepts a list or an object { name: p } and returns the same shape; reject = adjusted < alpha.
export function holm(pValues, { alpha = ALPHA } = {}) {
  const isList = Array.isArray(pValues);
  const entries = isList ? pValues.map((p, i) => [i, p]) : Object.entries(pValues ?? {});
  for (const [k, p] of entries) if (!isProb(p)) throw new Error(`stats-ebed: holm: p-value ${k} must be in [0, 1], got ${p}`);
  const m = entries.length, order = entries.map((e, i) => i).sort((i, j) => entries[i][1] - entries[j][1]);
  const adj = new Array(m);
  let running = 0;
  order.forEach((idx, j) => { running = Math.max(running, Math.min(1, (m - j) * entries[idx][1])); adj[idx] = running; });
  if (isList) return { m, alpha, adjusted: adj, reject: adj.map(a => a < alpha) };
  return { m, alpha, adjusted: Object.fromEntries(entries.map(([k], i) => [k, adj[i]])), reject: Object.fromEntries(entries.map(([k], i) => [k, adj[i] < alpha])) };
}

// ------------------------------------------------------------------------------------------------ family test (E-BED §6)
// items: [{ item, gap, excluded? }] with gap = Δ_i = pooled completed tail-mix success of arm X − (c) (a proportion).
// An item leaves the test when `excluded` is set (K1 "excluded: oracle", K1' "reference not buildable", K2 demotion) or
// its gap is not a finite number. Test (i): exact one-sided Wilcoxon signed-rank on {Δ_i + delta}, H1 location > 0,
// rejecting on p < alpha; the sign test is not used. Fewer than minItems admitted (or non-zero) items: no claim.
export function familyTest(items, { delta = NI_MARGIN, alpha = ALPHA, minItems = FAMILY.minItems, zeros = 'wilcox' } = {}) {
  if (!Array.isArray(items)) throw new Error('stats-ebed: familyTest needs a list of items');
  const ids = new Set();
  for (const it of items) { if (ids.has(it.item)) throw new Error(`stats-ebed: item ${it.item} repeated`); ids.add(it.item); }
  const admitted = items.filter(it => !it.excluded && typeof it.gap === 'number' && Number.isFinite(it.gap));
  const excluded = items.filter(it => !admitted.includes(it)).map(it => ({ item: it.item, reason: it.excluded || 'gap undefined' }));
  for (const it of admitted) if (it.gap < -1 || it.gap > 1) throw new Error(`stats-ebed: item ${it.item}: gap must be a proportion difference in [-1, 1]`);
  const d = admitted.map(it => it.gap + delta);
  const base = { n: admitted.length, admitted: admitted.map(it => it.item), excluded, delta, alpha, d };
  if (admitted.length < minItems) return { ...base, test: null, critical: null, reject: false, claim: false, reason: `${admitted.length} admitted items < ${minItems}: no family-level claim` };
  const test = wilcoxonExact(d, { alternative: 'greater', zeros });
  if (test.n < minItems) return { ...base, test, critical: null, reject: false, claim: false, reason: `${test.n} non-zero differences < ${minItems}: no family-level claim` };
  const critical = test.ties ? null : wilcoxonCritical(test.n, alpha);
  const reject = test.p < alpha;
  return { ...base, test, critical, reject, claim: reject, reason: reject ? `W- = ${test.wMinus}, exact one-sided p = ${test.p.toFixed(6)} < ${alpha}` : `exact one-sided p = ${test.p.toFixed(6)} >= ${alpha}` };
}

// The family-level bar decision for each arm (E-BED §6): all of
//   (i) familyTest rejects after Holm across the arms tested (family-wise alpha);
//   (ii) H-E2 holds for the arm on >= minReliable of the admitted items;
//   (iii) no item where the arm has a critical violation and (c) has none (over every item that reports both counts).
// arms: { [arm]: [{ item, gap, excluded?, reliable: boolean, critical: int, criticalRef: int }] }
// minReliable: a number, or a function of the admitted count (E-BED fixes 7 for 9 core items; see BED-CONTRACT-v1.1 §13).
export function familyDecision(arms, { delta = NI_MARGIN, alpha = ALPHA, minItems = FAMILY.minItems, minReliable = FAMILY.minReliable, zeros = 'wilcox' } = {}) {
  const names = Object.keys(arms ?? {});
  if (!names.length) throw new Error('stats-ebed: familyDecision needs at least one arm');
  const tests = Object.fromEntries(names.map(a => [a, familyTest(arms[a], { delta, alpha, minItems, zeros })]));
  const tested = names.filter(a => tests[a].test && tests[a].test.n >= minItems);
  const h = holm(Object.fromEntries(tested.map(a => [a, tests[a].test.p])), { alpha });
  const out = {};
  for (const a of names) {
    const t = tests[a], admitted = new Set(t.admitted), rows = arms[a];
    const need = typeof minReliable === 'function' ? minReliable(t.n) : minReliable;
    const reliable = rows.filter(r => admitted.has(r.item) && r.reliable === true).length;
    const extraCritical = rows.filter(r => Number.isInteger(r.critical) && Number.isInteger(r.criticalRef) && r.critical > 0 && r.criticalRef === 0).map(r => r.item);
    const i = tested.includes(a) ? h.reject[a] : false;
    const checks = { i, ii: t.n > 0 && reliable >= need, iii: extraCritical.length === 0 };
    out[a] = { meets: checks.i && checks.ii && checks.iii, checks, p: t.test?.p ?? null, holmP: tested.includes(a) ? h.adjusted[a] : null,
      reliableItems: reliable, reliableNeeded: need, extraCritical, family: t };
  }
  return { alpha, delta, armsTested: tested, holm: h, arms: out };
}

// ------------------------------------------------------------------------------------------------ non-inferiority
// Δ for one item and arm: pooled success of X minus (c) over the paired completed cases.
export function itemGap(pairs) {
  const ps = normalisePairs(pairs);
  return ps.length ? ps.reduce((s, p) => s + p.x - p.y, 0) / ps.length : NaN;
}

function normalisePairs(pairs) {
  if (!Array.isArray(pairs)) throw new Error('stats-ebed: pairs must be a list of { world, case, x, y }');
  const seen = new Set();
  return pairs.map(p => {
    const key = `${p.world}\u0000${p.case}`;
    if (p.world === undefined || p.case === undefined) throw new Error('stats-ebed: every pair needs world and case');
    if (seen.has(key)) throw new Error(`stats-ebed: pair (${p.world}, ${p.case}) repeated`);
    seen.add(key);
    const x = typeof p.x === 'boolean' ? +p.x : p.x, y = typeof p.y === 'boolean' ? +p.y : p.y;
    if (![0, 1].includes(x) || ![0, 1].includes(y)) throw new Error(`stats-ebed: pair (${p.world}, ${p.case}): x and y must be 0/1 or booleans`);
    return { world: String(p.world), case: String(p.case), x, y };
  });
}

const quantileSorted = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))))];

// H0: Δ <= −delta (X worse than (c) by delta or more) vs H1: Δ > −delta, Δ = success(X) − success(c) on paired cases.
// The one-sided lower bound at `level` is the smaller of
//   (a) a two-stage world-clustered percentile bootstrap (resample worlds, then cases within each drawn world), and
//   (b) the i.i.d. case bootstrap widened about the estimate by sqrt(Deff), Deff = 1 + (m̄ − 1)·rho, m̄ = cases per world.
// (b) is there because (a) has 2–4 clusters at K = 2–4 and cannot see between-world variance; it is the same rule as
// experiments/jit/stats.mjs pairedComparison, and rho = 0.1 is the value E-BED's power computation assumed.
// Decision: nonInferior = lower > −delta; null (no decision) when fewer than minWorlds (2) worlds (E-BED §4).
// p = max over (a), (b) of (#{replicates <= −delta} + 1) / (B + 1), for Holm across items; it agrees with the bound's
// decision up to the bootstrap's discreteness.
export function nonInferiority(pairs, delta = NI_MARGIN, { level = 0.95, rho = RHO_EBED, iterations = 10000, seed = 'ebed-ni', minWorlds = 2 } = {}) {
  if (!(delta >= 0 && delta < 1)) throw new Error(`stats-ebed: delta must be in [0, 1), got ${delta}`);
  if (!Number.isInteger(iterations) || iterations < 100) throw new Error('stats-ebed: iterations must be an integer >= 100');
  const ps = normalisePairs(pairs), n = ps.length;
  if (!n) throw new Error('stats-ebed: nonInferiority needs at least one pair');
  const byWorld = new Map();
  for (const p of ps) { if (!byWorld.has(p.world)) byWorld.set(p.world, []); byWorld.get(p.world).push(p.x - p.y); }
  const worlds = [...byWorld.values()], K = worlds.length, all = ps.map(p => p.x - p.y);
  const est = all.reduce((s, v) => s + v, 0) / n;
  const rc = rng(seed, 'world-cluster'), ri = rng(seed, 'iid'), a = 1 - level;
  const cl = new Float64Array(iterations), iid = new Float64Array(iterations);
  for (let b = 0; b < iterations; b++) {
    let s = 0, m = 0;
    for (let j = 0; j < K; j++) { const w = worlds[rc.int(0, K - 1)]; for (let t = 0; t < w.length; t++) { s += w[rc.int(0, w.length - 1)]; m++; } }
    cl[b] = s / m;
    let s2 = 0;
    for (let t = 0; t < n; t++) s2 += all[ri.int(0, n - 1)];
    iid[b] = s2 / n;
  }
  const mBar = n / K, deff = 1 + (mBar - 1) * rho, w = Math.sqrt(deff);
  const widened = Float64Array.from(iid, v => est + (v - est) * w);
  const sCl = Float64Array.from(cl).sort(), sW = Float64Array.from(widened).sort();
  const lowerCluster = quantileSorted(sCl, a), lowerWidened = quantileSorted(sW, a), lower = Math.min(lowerCluster, lowerWidened);
  const tail = arr => (arr.reduce((c, v) => c + (v <= -delta ? 1 : 0), 0) + 1) / (iterations + 1);
  const p = Math.max(tail(cl), tail(widened));
  const decided = K >= minWorlds;
  return { n, worlds: K, casesPerWorld: mBar, estimate: est, lower, lowerCluster, lowerWidened, deff, rho, delta, level, iterations, p,
    nonInferior: decided ? lower > -delta : null, reason: decided ? (lower > -delta ? `lower bound ${lower.toFixed(4)} > −${delta}` : `lower bound ${lower.toFixed(4)} <= −${delta}`) : `${K} world(s) < ${minWorlds}: no decision (any arm entering a decision runs K >= 2)` };
}

// ------------------------------------------------------------------------------------------------ power (E-BED §6)
// The SE of one item's pooled gap: the experiments/jit/stats.mjs pairedPower formula, restated here.
//   pX = pRef + g/2, pY = pRef − g/2; discordance psi = pX(1 − pY) + pY(1 − pX); Var(d) = psi − g²;
//   Deff = 1 + (m − 1)·rho; SE = sqrt(Var(d) · Deff / (K · m)).
// E-BED used m = 40 cases per world, rho = 0.1, pRef = 0.8 and the discordance at a 10-point gap (g = 0.10), which gives
// SE 0.1389 at K = 2 and 0.0982 at K = 4 (0.1400 and 0.0990 at g = 0; the power moves by < 0.005).
export function itemGapSE({ K, m = 40, rho = RHO_EBED, pRef = 0.8, gap = 0.10 }) {
  if (!(K >= 1 && m >= 1)) throw new Error('stats-ebed: itemGapSE needs K >= 1 and m >= 1');
  const pX = Math.min(1, pRef + gap / 2), pY = Math.max(0, pRef - gap / 2);
  const psi = pX * (1 - pY) + pY * (1 - pX), v = Math.max(1e-12, psi - gap * gap), deff = 1 + (m - 1) * rho;
  return Math.sqrt(v * deff / (K * m));
}

// Monte Carlo power of the family test (i) for nItems admitted items whose gaps are i.i.d. N(trueGap, se²): the rejection
// rate of the exact one-sided Wilcoxon rule (W- <= wilcoxonCritical) on {gap_i + delta}, and of the sign rule it
// replaced (#positive >= the exact sign critical value, 8 of 9). trueGap = 0 is equality with (c); trueGap = −delta is
// the null boundary, where the Wilcoxon rate is exactly P(W- <= 8) = 25/512 and the sign rate 10/512 (9 items).
export function familyPower({ K = 2, m = 40, rho = RHO_EBED, pRef = 0.8, seGap = 0.10, se = null, trueGap = 0, delta = NI_MARGIN, nItems = 9, alpha = ALPHA, iterations = 200000, seed = 'ebed-family-power' } = {}) {
  const s = se ?? itemGapSE({ K, m, rho, pRef, gap: seGap });
  const wc = wilcoxonCritical(nItems, alpha).critical;
  let signCrit = nItems + 1;   // smallest k with P(Bin(n, 1/2) >= k) < alpha
  for (let k = nItems; k >= 0; k--) { if (binomUpperTail(nItems, 0.5, k) < alpha) signCrit = k; else break; }
  const r = rng(seed, `K${K}`, `g${trueGap}`, `n${nItems}`);
  const d = new Float64Array(nItems), order = new Int32Array(nItems);
  let wil = 0, sign = 0;
  for (let it = 0; it < iterations; it++) {
    let pos = 0;
    for (let i = 0; i < nItems; i++) { d[i] = trueGap + delta + s * r.normal(); order[i] = i; if (d[i] > 0) pos++; }
    if (pos >= signCrit) sign++;
    for (let i = 1; i < nItems; i++) {   // insertion sort of indices by |d| (no ties with continuous draws)
      const o = order[i], v = Math.abs(d[o]);
      let j = i - 1;
      while (j >= 0 && Math.abs(d[order[j]]) > v) { order[j + 1] = order[j]; j--; }
      order[j + 1] = o;
    }
    let wm = 0;
    for (let i = 0; i < nItems; i++) if (d[order[i]] < 0) wm += i + 1;
    if (wm <= wc) wil++;
  }
  const pw = wil / iterations, ps = sign / iterations;
  return { K, m, rho, se: s, trueGap, delta, nItems, alpha, iterations, wilcoxonCritical: wc, signCritical: signCrit,
    wilcoxon: pw, sign: ps, mcse: { wilcoxon: Math.sqrt(pw * (1 - pw) / iterations), sign: Math.sqrt(ps * (1 - ps) / iterations) } };
}

export function familyPowerTable({ Ks = [2, 4], gaps = [0, -0.05, -0.10], iterations = 200000, ...opts } = {}) {
  const cells = [];
  for (const K of Ks) for (const trueGap of gaps) cells.push(familyPower({ K, trueGap, iterations, ...opts }));
  return cells;
}

// ------------------------------------------------------------------------------------------------ CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, ...rest] = process.argv.slice(2);
  const json = rest.includes('--json'), at = rest.indexOf('--iterations'), iterations = at >= 0 ? Number(rest[at + 1]) : 200000;
  if (cmd === 'power') {
    const t = familyPowerTable({ iterations });
    if (json) console.log(JSON.stringify(t, null, 1));
    else {
      console.log(`Family test power: 9 items, gap_i ~ N(true gap, SE^2), SE from itemGapSE (m = 40, rho = 0.1, pRef = 0.8, discordance at 10 points), delta = 0.10, alpha = 0.05; ${iterations} draws.`);
      console.log('| K | SE | true gap | Wilcoxon (W- <= 8) | sign (>= 8 of 9) |');
      console.log('|---|---|---|---|---|');
      for (const c of t) console.log(`| ${c.K} | ${c.se.toFixed(4)} | ${c.trueGap} | ${c.wilcoxon.toFixed(3)} ± ${c.mcse.wilcoxon.toFixed(3)} | ${c.sign.toFixed(3)} ± ${c.mcse.sign.toFixed(3)} |`);
    }
  } else if (cmd === 'thresholds') {
    const rows = [];
    for (const [n, bound] of [[100, 0.95], [300, 0.95], [100, 0.90], [300, 0.90]]) rows.push({ n, bound, maxFailures: maxFailures(n, bound) });
    const out = { level: 0.95, rows, minCleanCases: minCleanCases(0.001) };
    console.log(json ? JSON.stringify(out, null, 1) : [...rows.map(r => `n = ${r.n}, lower bound >= ${r.bound}: at most ${r.maxFailures} failures`), `critical rate <= 0.1% (one-sided 95% upper bound): >= ${out.minCleanCases} clean cases`].join('\n'));
  } else {
    console.error('usage: node experiments/lib/stats-ebed.mjs power [--iterations N] [--json] | thresholds [--json]');
    process.exit(2);
  }
}
