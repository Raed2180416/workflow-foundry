// One certification library for every Foundry claim (research/blockers-20261021/ATTACK.md §6 Move 0; decision D28).
// It extends experiments/lib/stats.mjs (and its group-sequential core, experiments/lib/stats-builds.mjs and the gauntlet
// port in experiments/lib/gauntlet.mjs) with the decision rules the eight blocker sweeps each re-derived on their own:
//
//   proportions        clopperPearson, wilsonInterval, zeroFailureUpper            exact and score bounds, one- or two-sided
//   never-trigger      npMinN, npUmbrellaRank, npUmbrella                          Neyman–Pearson umbrella (Tong, Feng & Li,
//                                                                                  Sci Adv 2018): n_min = ceil(ln δ / ln(1 − α))
//   recall             hypergeometricUpper, elusionCertificate                     exact binomial and hypergeometric elusion
//                                                                                  bounds (e-discovery elusion test)
//   thresholds         hoeffdingBentkusP, fwerControl, learnThenTest               Learn-then-Test (Angelopoulos et al. 2021),
//                                                                                  MAPIE 1.6.0 parity (formula and FWER rules)
//   sequential         sequentialLook (O'Brien–Fleming / Pocock from stats.mjs), sprtOperatingPoint (exact truncated SPRT)
//   builds             buildPermutationTest, minAttainableP, casePooledTest        re-exported from stats-builds.mjs
//   heal               certifyHeal (deterministic | stochastic | mechanism)        three-valued: accept | reject | inconclusive
//   effective n        effectiveN                                                  Kish design effect with an ICC floor
//   reporting          manifestFromLaunch, checkManifest, headlineRow, headlineTable, EffortMissingError
//                                                                                  every headline carries the reachable-subset
//                                                                                  (ceiling) column, n_eff and each node's
//                                                                                  effort / temperature / cap; a paid run with a
//                                                                                  model node whose effort is unset is an error
//
// $0, pure functions, no dependency. Only generic mechanisms live here: no benchmark task names, grader requirements or
// ceiling notes (those stay in research/, never in a harness, verifier or model context).
import {
  wilson, exactBinomialBounds, betaInc, binomCdf, binomPmf, clusterDeff, kishEffectiveN, iccAnova, sprtDesign,
  mcnemarExactCounts, obrienFlemingBoundary, pocockBoundary, crossesAt, pairedPermutation, mixtureEvalue, normalUpper,
  RHO_REUSE_FLOOR,
} from './stats.mjs';
import { buildPermutationTest, minAttainableP, casePooledTest } from './stats-builds.mjs';
import {
  Evidence, Verdict, gauntlet, gauntletThreshold, confirmationBar, operatingPoint, normalInvCdf, INITIAL_MIN_HITS,
} from './gauntlet.mjs';

export {
  wilson, exactBinomialBounds, betaInc, binomCdf, binomPmf, clusterDeff, kishEffectiveN, iccAnova, sprtDesign,
  mcnemarExactCounts, obrienFlemingBoundary, pocockBoundary, crossesAt, pairedPermutation, mixtureEvalue,
  buildPermutationTest, minAttainableP, casePooledTest, normalInvCdf,
};
export * as gauntletLib from './gauntlet.mjs';

const isInt = x => Number.isInteger(x);
const need = (cond, msg) => { if (!cond) throw new Error(`certify: ${msg}`); };
const checkCounts = (x, n, who) => need(isInt(x) && isInt(n) && n >= 0 && x >= 0 && x <= n, `${who}: need integers 0 <= x <= n, got ${x}/${n}`);
const sideLevel = (level, sides) => {
  need(level > 0 && level < 1, `level must be in (0, 1), got ${level}`);
  need(sides === 1 || sides === 2, `sides must be 1 or 2, got ${sides}`);
  return 1 - (1 - level) / sides;   // the one-sided level of each bound
};

// ------------------------------------------------------------------------------------------------ proportions
/**
 * Clopper–Pearson (exact) interval for x successes in n. sides 2: each bound at (1 − level)/2; sides 1: each bound is the
 * one-sided bound at `level` (use lo or hi as the claim). x = 0 gives lo 0; x = n gives hi 1.
 */
export function clopperPearson(x, n, { level = 0.95, sides = 2 } = {}) {
  checkCounts(x, n, 'clopperPearson');
  const each = sideLevel(level, sides);
  if (n === 0) return { x, n, p: NaN, lo: 0, hi: 1, level, sides, method: 'clopper-pearson' };
  const b = exactBinomialBounds(x, n, { level: each });
  return { x, n, p: x / n, lo: b.lo, hi: b.hi, level, sides, method: 'clopper-pearson' };
}

/** Wilson score interval with z from the level (two-sided 0.95 → 1.95996; one-sided 0.95 → 1.64485). */
export function wilsonInterval(x, n, { level = 0.95, sides = 2 } = {}) {
  checkCounts(x, n, 'wilsonInterval');
  const z = normalInvCdf(sideLevel(level, sides));
  const w = wilson(x, n, z);
  return { x, n, p: w.p, lo: w.lo, hi: w.hi, level, sides, z, method: 'wilson' };
}

/** Exact one-sided upper bound on a failure rate after 0 failures in n independent trials: 1 − (1 − level)^(1/n). */
export function zeroFailureUpper(n, { level = 0.95 } = {}) {
  need(isInt(n) && n > 0, `zeroFailureUpper: n must be a positive integer, got ${n}`);
  return 1 - Math.pow(1 - level, 1 / n);
}

// ------------------------------------------------------------------------------------------------ never-trigger (NP umbrella)
/** Smallest number of independent negatives for which the umbrella can certify false-trigger rate ≤ alpha w.p. ≥ 1 − delta. */
export function npMinN(alpha, delta) {
  need(alpha > 0 && alpha < 1 && delta > 0 && delta < 1, 'npMinN: alpha and delta must be in (0, 1)');
  return Math.ceil(Math.log(delta) / Math.log(1 - alpha) - 1e-12);
}

/**
 * The umbrella's order-statistic rank: k* = min{ k : P(Bin(n, 1 − alpha) ≥ k) ≤ delta } (1-based), or null when n < n_min
 * (no rank satisfies it and the claim is refused).
 */
export function npUmbrellaRank(n, alpha, delta) {
  need(isInt(n) && n >= 1, `npUmbrellaRank: n must be a positive integer, got ${n}`);
  // P(Bin(n, q) >= k) = 1 − P(X <= k − 1), q = 1 − alpha. Scan from k = 1 upwards; the tail falls monotonically in k.
  const q = 1 - alpha;
  for (let k = 1; k <= n; k++) if (betaInc(q, k, n - k + 1) <= delta) return k;   // P(X >= k) = I_q(k, n − k + 1)
  return null;
}

/**
 * Neyman–Pearson umbrella threshold on held-out NEGATIVE scores (higher = more trigger-like): theta = s_(k*), trigger iff
 * score > theta; then P(true false-trigger rate > alpha) ≤ delta with no distributional assumption, for independent
 * negatives (pass effective clusters, not raw rows, when they cluster). n < n_min → { refused: true }.
 */
export function npUmbrella(negativeScores, { alpha = 0.01, delta = 0.05 } = {}) {
  need(Array.isArray(negativeScores) && negativeScores.every(Number.isFinite), 'npUmbrella: scores must be finite numbers');
  const n = negativeScores.length, nMin = npMinN(alpha, delta);
  if (!n) return { n, nMin, alpha, delta, refused: true, reason: 'no negatives' };
  const k = npUmbrellaRank(n, alpha, delta);
  if (k === null) return { n, nMin, alpha, delta, refused: true, reason: `n = ${n} < n_min = ${nMin}: no order statistic certifies alpha ${alpha} at delta ${delta}` };
  const sorted = [...negativeScores].sort((a, b) => a - b);
  return { n, nMin, alpha, delta, refused: false, k, theta: sorted[k - 1], rule: 'trigger iff score > theta' };
}

// ------------------------------------------------------------------------------------------------ recall (elusion)
const lfCache = [0];
function logFactorial(m) {
  for (let i = lfCache.length; i <= m; i++) lfCache.push(lfCache[i - 1] + Math.log(i));
  return lfCache[m];
}
const logChooseF = (a, b) => (b < 0 || b > a ? -Infinity : logFactorial(a) - logFactorial(b) - logFactorial(a - b));
/** Hypergeometric pmf: x marked in a sample of n drawn without replacement from N items of which M are marked. */
export function hypergeomPmf(x, N, M, n) {
  if (x < Math.max(0, n - (N - M)) || x > Math.min(n, M)) return 0;
  return Math.exp(logChooseF(M, x) + logChooseF(N - M, n - x) - logChooseF(N, n));
}
export function hypergeomCdf(x, N, M, n) {
  let s = 0;
  for (let i = Math.max(0, n - (N - M)); i <= Math.min(x, n, M); i++) s += hypergeomPmf(i, N, M, n);
  return Math.min(1, s);
}

/**
 * Exact one-sided upper confidence bound on the number of marked items M in a finite pool of N, after x marked in a
 * simple random sample of n (without replacement): the largest M with P(X ≤ x | N, M, n) > 1 − level.
 */
export function hypergeometricUpper({ N, n, x, level = 0.95 }) {
  need([N, n, x].every(isInt) && N >= 0 && n >= 0 && n <= N && x >= 0 && x <= n, `hypergeometricUpper: need integers 0 <= x <= n <= N, got N ${N} n ${n} x ${x}`);
  const a = 1 - level;
  let best = x;                                  // M >= x always (x marked were seen)
  for (let M = x; M <= N - (n - x); M++) { if (hypergeomCdf(x, N, M, n) > a) best = M; else break; }
  return best;
}

/**
 * Recall certificate from an elusion audit of the excluded pool (technology-assisted review): `found` relevant items were
 * kept; the excluded pool holds `excluded` items; a simple random sample of `sampled` of them contained `hits` relevant.
 *   hypergeometric (exact, finite pool): missUpper = hypergeometricUpper(excluded, sampled, hits)
 *   binomial (sampling with replacement, conservative for a finite pool): missUpper = ceil(CP_upper(hits / sampled) · excluded)
 * recallLower = found / (found + missUpper). A sample of the whole pool is a census (missUpper = hits).
 */
export function elusionCertificate({ found, excluded, sampled, hits, level = 0.95, method = 'hypergeometric' }) {
  need([found, excluded, sampled, hits].every(isInt) && found >= 0 && sampled <= excluded && hits <= sampled && hits >= 0, 'elusionCertificate: bad counts');
  let missUpper;
  if (sampled === 0) missUpper = excluded;
  else if (method === 'hypergeometric') missUpper = hypergeometricUpper({ N: excluded, n: sampled, x: hits, level });
  else if (method === 'binomial') missUpper = Math.min(excluded, Math.ceil(clopperPearson(hits, sampled, { level, sides: 1 }).hi * excluded - 1e-9));
  else throw new Error(`certify: elusionCertificate: unknown method ${method}`);
  const recallLower = found + missUpper === 0 ? 1 : found / (found + missUpper);
  return { found, excluded, sampled, hits, level, method, elusionRate: sampled ? hits / sampled : NaN, missUpper, recallLower };
}

/**
 * The distribution of the certificate an audit of `sampled` units would issue when the excluded pool truly holds `missed`
 * relevant items (known gold, for planning or re-scoring): P(zero hits), the expected and median recallLower, and
 * P(recallLower ≥ target).
 */
export function elusionAuditPlan({ found, excluded, missed, sampled, level = 0.95, target = 0.9 }) {
  need(missed <= excluded && sampled <= excluded, 'elusionAuditPlan: bad counts');
  const rows = [];
  for (let x = 0; x <= Math.min(sampled, missed); x++) {
    const pr = hypergeomPmf(x, excluded, missed, sampled);
    if (pr > 0) rows.push({ x, pr, cert: elusionCertificate({ found, excluded, sampled, hits: x, level }).recallLower });
  }
  const expected = rows.reduce((s, r) => s + r.pr * r.cert, 0);
  let acc = 0, median = null;
  for (const r of [...rows].sort((a, b) => a.cert - b.cert)) { acc += r.pr; if (median === null && acc >= 0.5) median = r.cert; }
  return {
    found, excluded, missed, sampled, level, trueRecall: found + missed ? found / (found + missed) : 1,
    pZeroHits: hypergeomPmf(0, excluded, missed, sampled), expectedRecallLower: expected, medianRecallLower: median,
    pCertifiesTarget: rows.filter(r => r.cert >= target).reduce((s, r) => s + r.pr, 0), target,
  };
}

/**
 * Exact hypergeometric null for a selection: a design that flags k of N units, `hits` of them among the G gold units.
 * p = P(X ≥ hits) for a random k-subset (the "no better than a random pick of the same size" null).
 */
export function selectionNullP({ N, G, k, hits }) {
  need([N, G, k, hits].every(isInt) && G <= N && k <= N && hits <= Math.min(k, G), 'selectionNullP: bad counts');
  return Math.min(1, 1 - hypergeomCdf(hits - 1, N, G, k));
}

// ------------------------------------------------------------------------------------------------ Learn-then-Test
/**
 * Hoeffding–Bentkus p-value for H0: risk(λ) > alpha, from an empirical risk rHat over n observations (Angelopoulos, Bates,
 * Candès, Jordan & Lei 2021, "Learn then Test"). Parity with MAPIE 1.6.0 `compute_hoeffding_bentkus_p_value`
 * (mapie/risk_control/methods.py): p = min(exp(−n·h1(min(rHat, alpha), alpha)), c·BinomCDF(ceil(n·rHat); n, alpha)),
 * h1(r, a) = r·ln(r/a) + (1 − r)·ln((1 − r)/(1 − a)) (0·ln 0 = 0), c = e, or 1 when the loss is binary.
 */
export function hoeffdingBentkusP(rHat, n, alpha, { binary = false } = {}) {
  need(rHat >= 0 && rHat <= 1, `hoeffdingBentkusP: rHat must be in [0, 1], got ${rHat}`);
  need(isInt(n) && n > 0, `hoeffdingBentkusP: n must be a positive integer, got ${n}`);
  need(alpha > 0 && alpha < 1, `hoeffdingBentkusP: alpha must be in (0, 1), got ${alpha}`);
  const r = rHat > alpha ? alpha : rHat;
  const h1 = (r === 0 ? 0 : r * Math.log(r / alpha)) + (1 - r) * Math.log((1 - r) / (1 - alpha));
  const hoeffding = Math.exp(-n * h1);
  const k = Math.ceil(n * rHat);
  const cdf = k >= n ? 1 : betaInc(1 - alpha, n - k, k + 1);   // P(X <= k), X ~ Bin(n, alpha)
  const bentkus = (binary ? 1 : Math.E) * cdf;
  return bentkus > hoeffding ? hoeffding : bentkus;
}

export const FWER_METHODS = Object.freeze(['bonferroni', 'bonferroni_holm', 'fixed_sequence']);
/**
 * Family-wise error control over hypotheses with p-values (MAPIE 1.6.0 mapie/risk_control/fwer_control.py, one start):
 *   bonferroni       reject every p ≤ delta / m
 *   bonferroni_holm  step-down: test the smallest active p at delta / |active|; stop at the first non-rejection
 *   fixed_sequence   test in index order at delta; stop at the first non-rejection (order hypotheses easiest first)
 * Returns the sorted indices of the rejected hypotheses (H0: risk > alpha rejected = λ certified).
 */
export function fwerControl(pValues, delta, method = 'bonferroni_holm') {
  need(Array.isArray(pValues) && pValues.length > 0, 'fwerControl: p_values must be non-empty');
  need(delta > 0 && delta <= 1, 'fwerControl: delta must be in (0, 1]');
  const m = pValues.length, out = [];
  if (method === 'bonferroni') { pValues.forEach((p, i) => { if (p <= delta / m) out.push(i); }); return out; }
  if (method === 'bonferroni_holm') {
    const active = new Set(pValues.map((_, i) => i));
    while (active.size) {
      let best = -1;
      for (const i of [...active].sort((a, b) => a - b)) if (best < 0 || pValues[i] < pValues[best]) best = i;   // first index on ties
      if (pValues[best] <= delta / active.size) { out.push(best); active.delete(best); } else break;
    }
    return out.sort((a, b) => a - b);
  }
  if (method === 'fixed_sequence') {
    for (let i = 0; i < m && pValues[i] <= delta; i++) out.push(i);
    return out;
  }
  throw new Error(`certify: fwerControl: unknown method ${method} (${FWER_METHODS.join(', ')})`);
}

/**
 * Learn-then-Test over a grid of thresholds λ_1..λ_m: risks[i] is the empirical risk at λ_i over n[i] (or n) calibration
 * observations; returns the λ indices certified to have risk ≤ alpha with family-wise probability ≥ 1 − delta. For
 * fixed_sequence the order is taken from the risks as MAPIE does: a decreasing risk is tested from the end; a non-monotone
 * one is tested as given, with a warning.
 */
export function learnThenTest({ risks, n, alpha, delta, binary = false, method = 'bonferroni_holm' }) {
  need(Array.isArray(risks) && risks.length > 0, 'learnThenTest: risks must be non-empty');
  const ns = Array.isArray(n) ? n : risks.map(() => n);
  need(ns.length === risks.length, 'learnThenTest: n must be one count or one per risk');
  const pValues = risks.map((r, i) => hoeffdingBentkusP(r, ns[i], alpha, { binary }));
  let order = risks.map((_, i) => i), warning = null;
  if (method === 'fixed_sequence') {
    const inc = risks.every((r, i) => i === 0 || r >= risks[i - 1] - 1e-6), dec = risks.every((r, i) => i === 0 || r <= risks[i - 1] + 1e-6);
    if (!inc && dec) order = order.reverse();
    else if (!inc && !dec) warning = 'fixed sequence testing requires a monotonic risk; tested in the given order';
  }
  const valid = fwerControl(order.map(i => pValues[i]), delta, method).map(j => order[j]).sort((a, b) => a - b);
  return { pValues, valid, alpha, delta, method, binary, ...(warning ? { warning } : {}) };
}

// ------------------------------------------------------------------------------------------------ sequential
/**
 * Group-sequential decision at look `look` (1-based) of `looks`, two-sided total alpha, from the shared core in stats.mjs:
 * crosses iff the look's two-sided p is below the boundary's nominal level.
 */
export function sequentialLook({ looks, look, p, alpha = 0.05, boundary = 'obrien-fleming', fractions = null }) {
  need(isInt(look) && look >= 1 && look <= looks, `sequentialLook: look must be in 1..${looks}`);
  const b = boundary === 'obrien-fleming' ? obrienFlemingBoundary(looks, { alpha, fractions }) : boundary === 'pocock' ? pocockBoundary(looks, { alpha, fractions }) : null;
  need(b, `sequentialLook: unknown boundary ${boundary}`);
  return { look, looks, p, nominal: b.nominal[look - 1], crosses: crossesAt(b, look, p), boundary, alpha };
}

/**
 * Exact operating characteristics of Wald's SPRT for a Bernoulli rate (H0: p0, H1: p1, p0 < p1), truncated at maxN: the
 * probability of deciding H1 and the expected sample size when the true rate is p, by dynamic programming over the
 * number of events (no Wald approximation).
 */
export function sprtOperatingPoint({ p0, p1, alpha = 0.05, beta = 0.05, p, maxN = 20000 }) {
  const d = sprtDesign({ p0, p1, alpha, beta });
  let mass = new Map([[0, 1]]);        // events → probability mass still undecided after n trials
  let decideH1 = 0, decideH0 = 0, expectedN = 0;
  for (let n = 1; n <= maxN && mass.size; n++) {
    const next = new Map();
    for (const [e, m] of mass) for (const [de, pr] of [[1, p], [0, 1 - p]]) {
      const ev = e + de, llr = ev * d.wrongStep + (n - ev) * d.cleanStep, mm = m * pr;
      if (llr >= d.killAt) { decideH1 += mm; expectedN += mm * n; }
      else if (llr <= d.serveAt) { decideH0 += mm; expectedN += mm * n; }
      else next.set(ev, (next.get(ev) ?? 0) + mm);
    }
    mass = next;
  }
  const undecided = [...mass.values()].reduce((s, m) => s + m, 0);
  return { p0, p1, alpha, beta, p, decideH1, decideH0, undecided, expectedN: expectedN + undecided * maxN, maxN };
}

// ------------------------------------------------------------------------------------------------ effective n
/**
 * Kish effective sample size of clustered binary outcomes: clusters [{ n, wrong }] (wrong = the counted event), with the
 * ICC taken as max(rho floor, ANOVA estimate). Returns stats.mjs clusterDeff's fields.
 */
export function effectiveN(clusters, { rho = RHO_REUSE_FLOOR, estimateRho = true } = {}) {
  need(Array.isArray(clusters) && clusters.every(c => isInt(c.n) && isInt(c.wrong) && c.wrong <= c.n), 'effectiveN: clusters must be [{ n, wrong }]');
  return clusterDeff(clusters, { rho, estimateRho });
}

/** Exact paired sign test on discordant counts (wins, losses): two-sided and one-sided (wins > losses) p. */
export function signTest(wins, losses) {
  const two = mcnemarExactCounts(wins, losses).p, n = wins + losses;
  let one = 0;
  for (let i = wins; i <= n; i++) one += binomPmf(i, n, 0.5);
  return { wins, losses, n, pTwoSided: two, pOneSided: n ? Math.min(1, one) : 1 };
}

// ------------------------------------------------------------------------------------------------ heal certification
export const HEAL = Object.freeze({
  MIN_DETERMINISM_REPLAYS: 3,   // replays with identical outcomes before one replay counts as a verdict
  MIN_FAILING_REPLAYS: 3,       // exact replays of the incident's failing cases under the candidate (ATTACK §6 Move 8)
});

const verdict3 = (verdict, label, reasons, extra = {}) => ({ verdict, label, reasons, ...extra });

/**
 * Three-valued heal certificate (accept | reject | inconclusive). Modes:
 *   deterministic  { determinism: { replays, identical }, failing: { n, fixed }, regressions: { n, broken },
 *                    fresh: [{ stratum, failing: bool, base: { n, pass }, cand: { n, pass } }], mutants?: { n, violations } }
 *                  accept iff determinism is established, every failing replay is fixed (≥ MIN_FAILING_REPLAYS), nothing
 *                  regresses, no mutant is violated, and at least one fresh case in a failing stratum discriminates
 *                  (base fails, candidate passes) with no fresh case lost; the fresh stratum's exact interval is stated.
 *   stochastic     { base: { runs, failures }, cand: { runs, failures }, minHits? }: the gauntlet in reverse polarity (the
 *                  interesting event is "the failure reproduces"). The base must first confirm (confirmation bar); the
 *                  anchor is the base failure rate's Wilson lower bound; accept iff the candidate's failure-rate upper
 *                  bound is below the gauntlet threshold; reject iff the gauntlet accepts the candidate as still
 *                  reproducing; otherwise inconclusive, with the zero-failure runs that would be needed.
 *   mechanism      { faults, parentWrong, candRight, clusters? }: an injected error class; accept iff the injection bites
 *                  (the parent is wrong on every fault) and the candidate is right on every one; certifies the mechanism
 *                  only (combine with a stochastic or monitoring certificate for the natural rate).
 */
export function certifyHeal(e) {
  need(e && typeof e === 'object', 'certifyHeal: evidence object required');
  if (e.mode === 'deterministic') {
    const reasons = [];
    const det = e.determinism ?? {};
    if (!(det.replays >= HEAL.MIN_DETERMINISM_REPLAYS && det.identical === det.replays)) {
      return verdict3('inconclusive', 'not-deterministic', [`determinism not established (${det.identical ?? 0}/${det.replays ?? 0} identical replays, need ≥ ${HEAL.MIN_DETERMINISM_REPLAYS} all identical): use the stochastic mode`]);
    }
    if (e.mutants && e.mutants.violations > 0) return verdict3('reject', 'mutant-violation', [`${e.mutants.violations} of ${e.mutants.n} mutants violated`]);
    if (e.regressions?.broken > 0) return verdict3('reject', 'regression', [`${e.regressions.broken} of ${e.regressions.n} previously passing cases broken`]);
    const f = e.failing ?? { n: 0, fixed: 0 };
    if (f.fixed < f.n) return verdict3('reject', 'failing-case-still-fails', [`${f.n - f.fixed} of ${f.n} failing cases still fail on exact replay (deterministic: one replay is a verdict)`], { failing: f });
    if (f.n < HEAL.MIN_FAILING_REPLAYS) reasons.push(`only ${f.n} failing replay(s) (< ${HEAL.MIN_FAILING_REPLAYS})`);
    const fresh = e.fresh ?? [];
    const lost = fresh.filter(s => s.cand.pass < s.cand.n && s.base.pass === s.base.n && !s.failing);
    if (lost.length) return verdict3('reject', 'fresh-regression', [`fresh cases lost in ${lost.map(s => s.stratum).join(', ')}`]);
    const failingStrata = fresh.filter(s => s.failing);
    const incomplete = failingStrata.filter(s => s.cand.pass < s.cand.n);
    if (incomplete.length) {
      const fixed = incomplete.reduce((a, s) => a + s.cand.pass, 0), of = incomplete.reduce((a, s) => a + s.cand.n, 0);
      return verdict3('reject', 'partial-fix', [`fresh failing strata not fully fixed: ${fixed}/${of} (${incomplete.map(s => s.stratum).join(', ')})`]);
    }
    const disc = failingStrata.filter(s => s.base.pass < s.base.n && s.cand.pass === s.cand.n);
    if (!disc.length || reasons.length) {
      return verdict3('inconclusive', 'no-fresh-discrimination', [...reasons, ...(disc.length ? [] : ['no fresh case in a failing stratum where the base fails and the candidate passes'])]);
    }
    const n = disc.reduce((a, s) => a + s.cand.n, 0);
    return verdict3('accept', 'deterministic', [`${f.fixed}/${f.n} failing replays fixed, 0 regressions, ${n} fresh failing-stratum cases fixed`],
      { freshFixRate: clopperPearson(n, n), note: 'deterministic mode: each replay is a verdict; the fresh-stratum interval is wide and stated, not a rate claim' });
  }
  if (e.mode === 'stochastic') {
    const minHits = e.minHits ?? INITIAL_MIN_HITS;
    const base = new Evidence(e.base.failures, e.base.runs), cand = new Evidence(e.cand.failures, e.cand.runs);
    const bar = confirmationBar(base);
    if (bar === Verdict.REJECT) return verdict3('inconclusive', 'non-evidential', [`the incident does not reproduce on the base (${base.interesting}/${base.runs} failures): no patch effect is measurable`]);
    if (bar === Verdict.CONTINUE && base.interesting < 1) {
      return verdict3('inconclusive', 'non-evidential', [`the base never failed in ${base.runs} control runs: the control is at ceiling and cannot show a patch effect`],
        { baseFailureUpper: base.upperBound() });
    }
    if (bar === Verdict.CONTINUE) {
      return verdict3('inconclusive', 'base-unconfirmed', [`the incident has not yet confirmed on the base (${base.interesting}/${base.runs} failures; the confirmation bar needs 4 hits within 40 runs)`]);
    }
    const anchor = base.lowerBound(), threshold = gauntletThreshold(anchor);
    const g = gauntlet(cand, anchor, minHits);
    if (g === Verdict.ACCEPT) return verdict3('reject', 'still-reproduces', [`the candidate reproduces the failure (${cand.interesting}/${cand.runs}; lower bound ${cand.lowerBound().toFixed(3)} ≥ threshold ${threshold.toFixed(3)})`]);
    if (cand.upperBound() < threshold) return verdict3('accept', 'stochastic', [`candidate failure-rate upper bound ${cand.upperBound().toFixed(3)} < threshold ${threshold.toFixed(3)} (base anchor ${anchor.toFixed(3)})`]);
    // zero-failure runs needed for the Wilson upper bound to fall below the threshold: z²/(n + z²) < t
    const z = 1.96, needRuns = Math.max(0, Math.floor((z * z * (1 - threshold)) / threshold) + 1);
    return verdict3('inconclusive', 'insufficient', [`candidate upper bound ${cand.upperBound().toFixed(3)} ≥ threshold ${threshold.toFixed(3)}`], { zeroFailureRunsNeeded: needRuns, anchor, threshold });
  }
  if (e.mode === 'mechanism') {
    const { faults, parentWrong, candRight } = e;
    need([faults, parentWrong, candRight].every(isInt), 'certifyHeal mechanism: integer counts required');
    if (parentWrong < faults) return verdict3('inconclusive', 'injection-did-not-bite', [`the parent was wrong on only ${parentWrong}/${faults} injected faults: the injection does not exercise the defect`]);
    if (candRight < faults) return verdict3('reject', 'mechanism-incomplete', [`the candidate corrected ${candRight}/${faults} injected faults`]);
    // Faults injected into one trial share its state: clusters [{ n }] give the Kish n_eff (ICC floor; all-correct data
    // carry no ICC estimate), and the one-sided exact lower bound on the correction rate is read at n_eff.
    const nEff = e.clusters ? effectiveN(e.clusters.map(c => ({ n: c.n, wrong: 0 }))).nEff : faults;
    return verdict3('accept', 'mechanism', [`${candRight}/${faults} injected faults corrected; the parent was wrong on all of them`],
      { correctionLower: 1 - zeroFailureUpper(Math.max(1, Math.floor(nEff))), nEff,
        note: 'certifies the mechanism on the injected class only; the natural-rate effect needs the stochastic mode or post-promotion monitoring' });
  }
  throw new Error(`certify: certifyHeal: unknown mode ${e.mode}`);
}

/**
 * Verifier validity on a set of runs: how often the workflow's own verdict says pass while the oracle says fail. An
 * evaluator whose false-accept rate cannot be bounded below `maxFalseAccept` blocks claims (AGENTS.md).
 */
export function verifierValidity({ verdictPass, oraclePass, n, maxFalseAccept = 0.2, level = 0.95 }) {
  // false accepts: verdict pass and oracle fail. With per-run pairs unavailable, the minimum consistent count.
  const falseAccepts = Math.max(0, verdictPass - oraclePass);
  const ci = clopperPearson(falseAccepts, verdictPass, { level, sides: 1 });
  const invalid = verdictPass > 0 && ci.lo > maxFalseAccept;
  return { n, verdictPass, oraclePass, falseAcceptsAtLeast: falseAccepts, falseAcceptLower: ci.lo, invalid, maxFalseAccept };
}

// ------------------------------------------------------------------------------------------------ reporting
export class EffortMissingError extends Error {
  constructor(runId, nodes) {
    super(`certify: paid run ${runId ?? '(unnamed)'} has model node(s) with no recorded effort: ${nodes.join(', ')} (D28: a paid run with effort unset is an error)`);
    this.name = 'EffortMissingError';
    this.runId = runId; this.nodes = nodes;
  }
}
const MODEL_KINDS = new Set(['model', 'session', 'judge', 'reader']);

const firstDefined = (...xs) => xs.find(x => x !== undefined) ?? null;
/**
 * Normalise a run's launch record into checkManifest's { runId, paid, nodes }. Accepts the shapes the repo's runners
 * write: a launch or summary record with `model`, `effort`, optional `temperature`, a per-session budget
 * (`budgetUsdPerSession` or `budgetUsd`, else the run's `capUsd`) and optional `harness.nodeModels` (with optional
 * `harness.nodeEfforts` / `harness.nodeTemperatures`), giving one node per entry, else one `session` node; or a session
 * record `{ session: { model, effort, temperature?, capUsd } }`. Nothing is inferred: an absent field stays null and is
 * reported as unrecorded (an unset effort is not the CLI default, it is unknown). `scripted: true` makes the run unpaid.
 */
export function manifestFromLaunch(launch, { runId = null, paid = null } = {}) {
  need(launch && typeof launch === 'object', 'manifestFromLaunch: a launch record is required');
  const s = launch.session && typeof launch.session === 'object' ? launch.session : null;
  const src = s ?? launch;
  const cap = firstDefined(src.budgetUsdPerSession, src.budgetUsd, src.capUsd);
  const isPaid = paid ?? (launch.scripted === true ? false : true);
  const h = launch.harness && typeof launch.harness === 'object' ? launch.harness : null;
  const nodes = h?.nodeModels && Object.keys(h.nodeModels).length
    ? Object.entries(h.nodeModels).map(([name, model]) => ({
      name, kind: 'model', model,
      effort: firstDefined(h.nodeEfforts?.[name], launch.effort),
      temperature: firstDefined(h.nodeTemperatures?.[name], launch.temperature),
      cap,
    }))
    : [{ name: 'session', kind: 'session', model: src.model ?? null, effort: firstDefined(src.effort), temperature: firstDefined(src.temperature), cap }];
  return { runId: runId ?? launch.runId ?? launch.label ?? null, paid: isPaid, nodes };
}

/**
 * Check a launch manifest { runId, paid?, nodes: [{ name, kind, model, effort, temperature, cap }] }. A node of a model
 * kind with effort null/undefined in a paid run throws EffortMissingError, unless `legacy` (a reason string) is given for a
 * historical run: then the result is marked non-conforming instead. paid defaults to "has any model node".
 * Temperature and cap are reported when unrecorded, never silently assumed.
 */
export function checkManifest(manifest, { legacy = null } = {}) {
  need(manifest && Array.isArray(manifest.nodes), 'checkManifest: manifest.nodes required');
  const modelNodes = manifest.nodes.filter(n => MODEL_KINDS.has(n.kind));
  const paid = manifest.paid ?? modelNodes.length > 0;
  const missingEffort = modelNodes.filter(n => n.effort == null || n.effort === '').map(n => n.name);
  const unrecordedTemperature = modelNodes.filter(n => n.temperature == null).map(n => n.name);
  const unrecordedCap = modelNodes.filter(n => n.cap == null).map(n => n.name);
  if (paid && missingEffort.length && !legacy) throw new EffortMissingError(manifest.runId, missingEffort);
  return { runId: manifest.runId, paid, conforming: !missingEffort.length, missingEffort, unrecordedTemperature, unrecordedCap,
    ...(legacy && missingEffort.length ? { legacy } : {}),
    nodes: modelNodes.map(n => `${n.name}:${n.model ?? '?'}@${n.effort ?? (legacy ? 'UNSET' : 'unset')}/T${n.temperature ?? '?'}/cap${n.cap ?? '?'}`) };
}

/**
 * One headline row. Required: the strict count (passes of n) and the reachable subset (passes on, and size of, the tasks
 * the evaluator can grade correctly: the ceiling column); optional conservative subset, clusters for n_eff, cost, and the
 * launch manifest (checked by checkManifest; a paid run without one is an error).
 */
export function headlineRow({ label, passes, n, reachable, conservative = null, clusters = null, manifest, legacy = null, costUsd = null, level = 0.95 }) {
  need(typeof label === 'string' && label, 'headlineRow: label required');
  checkCounts(passes, n, `headlineRow ${label}`);
  need(reachable && isInt(reachable.n) && isInt(reachable.passes), `headlineRow ${label}: the reachable-subset column is required ({ passes, n, source })`);
  checkCounts(reachable.passes, reachable.n, `headlineRow ${label} reachable`);
  need(manifest, `headlineRow ${label}: a launch manifest is required (effort, temperature and cap of every node)`);
  const m = checkManifest(manifest, { legacy });
  const ci = clopperPearson(passes, n, { level });
  const r = clopperPearson(reachable.passes, reachable.n, { level });
  const c = conservative ? clopperPearson(conservative.passes, conservative.n, { level }) : null;
  const eff = clusters ? effectiveN(clusters) : null;
  return {
    label, strict: { passes, n, p: ci.p, lo: ci.lo, hi: ci.hi }, reachable: { passes: reachable.passes, n: reachable.n, p: r.p, lo: r.lo, hi: r.hi, source: reachable.source ?? null },
    ...(c ? { conservative: { passes: conservative.passes, n: conservative.n, p: c.p, lo: c.lo, hi: c.hi } } : {}),
    nEff: eff ? eff.nEff : n, ...(eff ? { deff: eff.deff, rhoUsed: eff.rhoUsed, rhoHat: eff.rhoHat } : {}),
    costUsd, costPerSuccess: costUsd != null && passes ? costUsd / passes : null, level,
    manifest: m,
  };
}

const pct = x => (Number.isFinite(x) ? `${(100 * x).toFixed(1)}%` : '–');
/** Markdown table of headline rows (strict, reachable, conservative, n_eff, cost, nodes, conformance). */
export function headlineTable(rows) {
  const head = '| Arm | Strict (95% CP) | Reachable subset (ceiling column) | Conservative subset | n_eff | $ / task | $ / success | Nodes (model@effort/T/cap) | Manifest |';
  const sep = '|---|---|---|---|---|---|---|---|---|';
  const lines = rows.map(r => `| ${r.label} | ${r.strict.passes}/${r.strict.n} = ${pct(r.strict.p)} [${pct(r.strict.lo)}, ${pct(r.strict.hi)}] | `
    + `${r.reachable.passes}/${r.reachable.n} = ${pct(r.reachable.p)} [${pct(r.reachable.lo)}, ${pct(r.reachable.hi)}] | `
    + `${r.conservative ? `${r.conservative.passes}/${r.conservative.n} = ${pct(r.conservative.p)}` : '–'} | ${Number.isFinite(r.nEff) ? r.nEff.toFixed(1) : '–'} | `
    + `${r.costUsd != null ? (r.costUsd / r.strict.n).toFixed(4) : '–'} | ${r.costPerSuccess != null ? r.costPerSuccess.toFixed(4) : '–'} | ${r.manifest.nodes.join('; ')} | `
    + `${r.manifest.conforming ? 'conforming' : `NON-CONFORMING: effort unset on ${r.manifest.missingEffort.join(', ')}${r.manifest.legacy ? ` (legacy: ${r.manifest.legacy})` : ''}`} |`);
  return [head, sep, ...lines].join('\n');
}

// Re-exported for planning heal and need-router runs: the gauntlet's exact operating point at a true rate.
export { operatingPoint, confirmationBar, gauntlet, gauntletThreshold, Evidence, Verdict, normalUpper };
