// Need router v1: the preregistered reading rules as code ($0; pure functions; no imports, no files, no model).
// PREREG-NEED-V1.md states each rule in prose; this module is its executable half, so the text, the checker and the
// analysis (evaluate.mjs) can apply one rule. Each export names the PREREG section it implements:
//   §5   missingDataRule              a job missing any primary mode leaves Δ and C7a, and is counted
//   §6   thetaFitStatus, locoFolds,   θ fitting: a minimum of confident positives and negatives, undefined
//        fitOrRule                    leave-one-cluster-out folds, midpoint candidates
//   §7   balancedAccuracyInterval,    C7a: one exact joint interval for the balanced accuracy and its power
//        c7aPower, c7aMinimumCounts   precondition (the bound a perfect classifier would reach)
//        signFlipFloor                the exact sign-flip floor counts informative (non-zero) clusters only
//   §8   c7aReading, g1Reading,       readings, their levels, the near-cluster agreement rule and Holm over the
//        holm, harmfulPositions,      six HARMFUL tests
//        withDropAgreement
//   §11  powerGate                    projected informative clusters and the floor and width they allow
//   §12  hasObservedCost, rowCharge,  the one cap meter every paid runner uses (max of reported and re-priced, bounds
//        capMeter, mayStart           for rows without an observed cost, reservations for starts in flight)

export const MIN_USEFUL = 0.03;          // minimum useful effect (decision 1)
export const C7A_ALPHA = 0.025;          // each side of C7a's two-sided 95% interval
export const C7A_CHANCE = 0.5;           // the majority-class balanced accuracy

// ------------------------------------------------------------------------------------------------ binomial helpers
const LF = [0];
const logFact = n => { for (let i = LF.length; i <= n; i++) LF[i] = LF[i - 1] + Math.log(i); return LF[n]; };
function binomPmf(n, p) {
  const out = new Float64Array(n + 1);
  if (p <= 0) { out[0] = 1; return out; }
  if (p >= 1) { out[n] = 1; return out; }
  const lp = Math.log(p), lq = Math.log1p(-p);
  for (let k = 0; k <= n; k++) out[k] = Math.exp(logFact(n) - logFact(k) - logFact(n - k) + k * lp + (n - k) * lq);
  return out;
}
// P(X1·n2 + X2·n1 >= T) for X1 ~ Bin(n1, p1), X2 ~ Bin(n2, p2): the upper tail of n1·n2 times twice the balanced accuracy.
function tailGE(n1, n2, p1, p2, T) {
  const a = binomPmf(n1, p1), b = binomPmf(n2, p2), bt = new Float64Array(n2 + 2);
  for (let k = n2; k >= 0; k--) bt[k] = bt[k + 1] + b[k];
  let s = 0;
  for (let x1 = 0; x1 <= n1; x1++) { const need = Math.max(0, Math.ceil((T - x1 * n2) / n1)); if (need <= n2) s += a[x1] * bt[need]; }
  return Math.min(1, s);
}
// sup of the tail over the null boundary (p1 + p2)/2 = b. The tail rises in p1 and in p2, so this is also the sup over
// the whole composite null {(p1 + p2)/2 <= b}. A grid plus a golden-section refinement around its best point.
function supTail(n1, n2, T, b, grid = 200) {
  const lo = Math.max(0, 2 * b - 1), hi = Math.min(1, 2 * b);
  if (hi < lo) return 0;
  const f = p1 => tailGE(n1, n2, p1, Math.min(1, Math.max(0, 2 * b - p1)), T);
  let best = -1, bi = 0;
  const xs = Array.from({ length: grid + 1 }, (_, i) => lo + ((hi - lo) * i) / grid);
  xs.forEach((x, i) => { const v = f(x); if (v > best) { best = v; bi = i; } });
  let a = xs[Math.max(0, bi - 1)], c = xs[Math.min(grid, bi + 1)];
  for (let k = 0; k < 40; k++) {
    const m1 = a + (c - a) * 0.381966, m2 = a + (c - a) * 0.618034, v1 = f(m1), v2 = f(m2);
    best = Math.max(best, v1, v2);
    if (v1 < v2) a = m1; else c = m2;
  }
  return best;
}
// One-sided lower confidence bound at level 1 − alpha for (p1 + p2)/2 from x1 of n1 and x2 of n2: the largest b whose
// null (p1 + p2)/2 <= b is still rejected (the exact unconditional test, inverted by bisection).
function lowerBound(x1, n1, x2, n2, alpha) {
  const T = x1 * n2 + x2 * n1;
  if (T === 0) return 0;
  const point = (x1 / n1 + x2 / n2) / 2;
  let lo = 0, hi = point;
  for (let k = 0; k < 50; k++) { const mid = (lo + hi) / 2; if (supTail(n1, n2, T, mid) <= alpha) lo = mid; else hi = mid; }
  return lo;
}

// ------------------------------------------------------------------------------------------------------------ §7 C7a
/**
 * C7a's interval (PREREG §7): one joint exact interval for the balanced accuracy BA = (TPR + TNR)/2 over confident jobs,
 * each job one Bernoulli trial of its class (jobs treated as independent; the assumption is stated in §7). The lower
 * bound inverts the exact unconditional one-sided test of H: BA <= b (sup of the tail over every (TPR, TNR) with mean
 * b); the upper bound mirrors it. alpha is per side (0.025: a two-sided 95% interval). Coverage >= 1 − alpha per side by
 * construction, unlike the mean of two marginal Wilson bounds. Returns null when a class is empty (BA undefined).
 */
export function balancedAccuracyInterval({ tp, fn, tn, fp }, { alpha = C7A_ALPHA } = {}) {
  const nPos = tp + fn, nNeg = tn + fp;
  if (!nPos || !nNeg) return null;
  return {
    point: (tp / nPos + tn / nNeg) / 2, lo: lowerBound(tp, nPos, tn, nNeg, alpha), hi: 1 - lowerBound(fn, nPos, fp, nNeg, alpha),
    nPos, nNeg, alpha, method: 'exact joint (unconditional test inversion)',
  };
}

/** The power precondition (PREREG §7, §8, F12): the lower bound a perfect classifier would reach at these class counts. */
export function c7aPower(nPos, nNeg, { alpha = C7A_ALPHA } = {}) {
  if (!(nPos > 0 && nNeg > 0)) return { nPos, nNeg, perfectLowerBound: null, powered: false };
  const perfectLowerBound = lowerBound(nPos, nPos, nNeg, nNeg, alpha);
  return { nPos, nNeg, perfectLowerBound, powered: perfectLowerBound > C7A_CHANCE };
}

/** For each count of confident positives 1..maxPos, the fewest confident negatives at which C7a is powered (symmetric). */
export function c7aMinimumCounts({ alpha = C7A_ALPHA, maxPos = 4, maxNeg = 40 } = {}) {
  const out = [];
  for (let p = 1; p <= maxPos; p++) {
    let n = 1;
    while (n <= maxNeg && !c7aPower(p, n, { alpha }).powered) n += 1;
    out.push({ pos: p, minNeg: n <= maxNeg ? n : null });
  }
  return out;
}

/**
 * The exact sign-flip floor (PREREG §7, §11): a cluster whose Δ_c is exactly 0 (the policy chose SBS-train's mode on
 * every job of it, so both sides read the same rows) changes nothing under a sign flip, so p >= 2^−(n − z). The floor
 * and the informative count are printed with every reading.
 */
export function signFlipFloor(d, { eps = 1e-12 } = {}) {
  const informative = d.filter(x => Math.abs(x) > eps).length;
  return { n: d.length, zero: d.length - informative, informative, floor: 2 ** -informative };
}

// ---------------------------------------------------------------------------------------------------------- §8 rules
/**
 * A claim must survive dropping the near, dev-observed cluster (r3p; PREREG §8). Every reading is printed both ways;
 * SUPPORTED, SUPERIOR-BELOW-USEFUL, REFUTED and C7a's SUPPORTED-DIAGNOSTIC stand only when the reading without the
 * dropped cluster is the same, else INCONCLUSIVE. HARMFUL (a safety rule that disables a slider position) and
 * INCONCLUSIVE stand on the full set. dropped === undefined: no near cluster in the set (nothing to check).
 */
export function withDropAgreement(full, dropped) {
  const exempt = new Set(['INCONCLUSIVE', 'HARMFUL']);
  if (dropped === undefined || exempt.has(full)) return { reading: full, agrees: true };
  return dropped === full ? { reading: full, agrees: true } : { reading: 'INCONCLUSIVE', agrees: false, full, dropped: dropped ?? null };
}

/**
 * C7a reading (PREREG §8): INCONCLUSIVE when a class is empty or the counts are not powered (a perfect classifier's lower
 * bound <= 0.5): F12 cannot trip then. Powered: SUPPORTED-DIAGNOSTIC when the lower bound > 0.5, the point beats the
 * tuned size rule's point and coverage >= 50%; REFUTED (F12) when the lower bound <= 0.5; otherwise INCONCLUSIVE.
 * withoutNear: { h0, tunedPoint, coverage } with the near cluster dropped; null when dropping it leaves no valid set.
 */
export function c7aReading({ h0, tunedPoint = null, coverage = null, withoutNear = undefined }, { alpha = C7A_ALPHA, minCoverage = 0.5 } = {}) {
  const own = (() => {
    const nPos = h0.tp + h0.fn, nNeg = h0.tn + h0.fp;
    if (!nPos || !nNeg) return { reading: 'INCONCLUSIVE', why: 'one class only: balanced accuracy undefined', f12: false, interval: null, power: c7aPower(nPos, nNeg, { alpha }) };
    const power = c7aPower(nPos, nNeg, { alpha }), interval = balancedAccuracyInterval(h0, { alpha });
    if (!power.powered) return { reading: 'INCONCLUSIVE', why: `not powered: a perfect classifier's lower bound at ${nPos} positive and ${nNeg} negative confident jobs is ${power.perfectLowerBound.toFixed(3)} <= 0.5`, f12: false, interval, power };
    if (interval.lo <= C7A_CHANCE) return { reading: 'REFUTED', why: 'F12: lower bound <= 0.5', f12: true, interval, power };
    if (tunedPoint !== null && interval.point > tunedPoint && coverage !== null && coverage >= minCoverage) return { reading: 'SUPPORTED-DIAGNOSTIC', why: 'lower bound > 0.5, beats the tuned size rule, coverage >= 50%', f12: false, interval, power };
    return { reading: 'INCONCLUSIVE', why: 'lower bound > 0.5 but the tuned size rule or coverage condition fails', f12: false, interval, power };
  })();
  const dropped = withoutNear === undefined ? undefined : withoutNear === null ? null : c7aReading({ ...withoutNear, withoutNear: undefined }, { alpha, minCoverage }).reading;
  const agreed = withDropAgreement(own.reading, dropped);
  return { ...own, reading: agreed.reading, withoutNear: dropped, agrees: agreed.agrees };
}

/**
 * Gate G1 (PREREG §8). cells: [{ V, N, upper, lower, jobLower, costShare }] where upper/lower are the exact one-sided 95%
 * cluster-level sign-flip bounds of the VBS* − SBS headroom and jobLower the job-level (task -> replicate) bootstrap lower
 * bound, which is diagnostic. REFUTED-PREMISE needs finite exact bounds, so at least 5 TRAIN clusters (2^−4 = 1/16 >
 * 0.05): with 4 clusters G1 can only read CONTINUE or OWNER-DECIDES. CONTINUE needs a lower bound > 0 (exact, or the
 * diagnostic job-level one) in some cell at V = $1.
 */
export function g1Reading({ clusters, cells }, { alpha = 0.05, minUseful = MIN_USEFUL, costFraction = 0.2 } = {}) {
  const canRefute = 2 ** -clusters <= alpha;
  const refuted = canRefute && cells.length > 0 && cells.every(c => c.upper < minUseful && c.upper < costFraction * c.costShare);
  const exactContinue = cells.some(c => c.V === 1 && c.lower > 0), diagContinue = cells.some(c => c.V === 1 && c.jobLower > 0);
  const verdict = refuted ? 'REFUTED-PREMISE' : exactContinue || diagContinue ? 'CONTINUE' : 'OWNER-DECIDES';
  return { verdict, canRefute, possible: canRefute ? ['REFUTED-PREMISE', 'CONTINUE', 'OWNER-DECIDES'] : ['CONTINUE', 'OWNER-DECIDES'],
    basis: verdict === 'CONTINUE' ? (exactContinue ? 'exact cluster-level' : 'job-level (diagnostic)') : verdict === 'REFUTED-PREMISE' ? 'exact cluster-level' : null };
}

/** Holm step-down adjusted p-values (monotone), in the input order. */
export function holm(ps) {
  const m = ps.length, idx = ps.map((p, i) => [p, i]).sort((a, b) => a[0] - b[0]), adj = new Array(m);
  let run = 0;
  idx.forEach(([p, i], k) => { run = Math.max(run, Math.min(1, (m - k) * p)); adj[i] = run; });
  return adj;
}

/**
 * HARMFUL (PREREG §8): tests = [{ policy, V, pLess }] where pLess is the exact one-sided sign-flip p-value of H: Δ >= 0
 * against Δ < 0. A (policy, V) slider position is disabled only when its Holm-adjusted p over all the tests (3 V × 2
 * co-primaries = 6) is <= alpha (familywise 0.05).
 */
export function harmfulPositions(tests, { alpha = 0.05 } = {}) {
  const adj = holm(tests.map(t => t.pLess));
  return tests.map((t, i) => ({ ...t, pHolm: adj[i], harmful: adj[i] <= alpha })).filter(t => t.harmful);
}

// ------------------------------------------------------------------------------------------------------------ §6 θ
/**
 * θ is fitted only with enough confident N = 1 TRAIN labels (PREREG §6): at least minPos positives (workflow) from at
 * least minPosClusters clusters and minNeg negatives from minNegClusters clusters. items: [{ job, cluster, workflow }]
 * (confident labels only). Below the minimum H0 is "not fitted": C7a reads INCONCLUSIVE and NR-static has one leaf.
 */
export function thetaFitStatus(items, { minPos = 2, minPosClusters = 2, minNeg = 2, minNegClusters = 2 } = {}) {
  const pos = items.filter(x => x.workflow), neg = items.filter(x => !x.workflow);
  const pc = new Set(pos.map(x => x.cluster)).size, nc = new Set(neg.map(x => x.cluster)).size;
  const short = [];
  if (pos.length < minPos) short.push(`${pos.length} confident positive(s) < ${minPos}`);
  if (pc < minPosClusters) short.push(`positives in ${pc} cluster(s) < ${minPosClusters}`);
  if (neg.length < minNeg) short.push(`${neg.length} confident negative(s) < ${minNeg}`);
  if (nc < minNegClusters) short.push(`negatives in ${nc} cluster(s) < ${minNegClusters}`);
  return { fit: !short.length, pos: pos.length, neg: neg.length, posClusters: pc, negClusters: nc, why: short.length ? `H0 not fitted: ${short.join('; ')}` : null };
}

/**
 * Leave-one-cluster-out folds (PREREG §6): a fold whose training part has no confident positive or no confident
 * negative is undefined. It is excluded from every LOCO statistic (C7a dev numbers, σ for the power gate) and counted;
 * it is never given θ = +∞.
 */
export function locoFolds(items, clusters = [...new Set(items.map(x => x.cluster))]) {
  const folds = clusters.map(c => {
    const tr = items.filter(x => x.cluster !== c), pos = tr.filter(x => x.workflow).length, neg = tr.length - pos;
    return { held: c, defined: pos > 0 && neg > 0, trainPos: pos, trainNeg: neg };
  });
  return { folds, defined: folds.filter(f => f.defined).length, undefined: folds.filter(f => !f.defined).length };
}

/**
 * The preregistered OR-of-thresholds fit (PREREG §6): candidates for each key are the midpoints between adjacent
 * distinct values among the confident items, plus +∞ (the key unused); the pair with the highest balanced accuracy
 * wins; ties go to the larger thresholds, key by key in order. Every finite θ is therefore a midpoint between a
 * confident negative and a confident positive value, never a job's own value (the edge).
 * items: [{ features, workflow }] (confident only; needs both classes). Returns { thresholds, balancedAccuracy }.
 */
export function fitOrRule(items, keys) {
  const pos = items.filter(x => x.workflow).length, neg = items.length - pos;
  if (!pos || !neg) throw new Error('fitOrRule needs confident items of both classes (check thetaFitStatus first)');
  const cands = keys.map(k => {
    const v = [...new Set(items.map(x => x.features[k]).filter(Number.isFinite))].sort((a, b) => a - b);
    return [Infinity, ...v.slice(1).map((x, i) => (x + v[i]) / 2).reverse()];
  });
  let best = null;
  const visit = (i, th) => {
    if (i === keys.length) {
      let tp = 0, tn = 0;
      for (const x of items) { const call = keys.some((k, j) => (x.features[k] ?? -Infinity) >= th[j]); if (x.workflow) tp += call ? 1 : 0; else tn += call ? 0 : 1; }
      const ba = (tp / pos + tn / neg) / 2;
      // Candidates are visited largest first, so a strict improvement is needed to move off a larger tied threshold.
      if (!best || ba > best.ba + 1e-12) best = { ba, th: [...th] };
      return;
    }
    for (const t of cands[i]) visit(i + 1, [...th, t]);
  };
  visit(0, []);
  return { thresholds: Object.fromEntries(keys.map((k, i) => [k, best.th[i]])), balancedAccuracy: best.ba };
}

// ------------------------------------------------------------------------------------------------------------ §5 data
/**
 * Missing data (PREREG §5, §7): a job missing any of its primary modes (its L_today menu minus masked modes), for any
 * reason (a stage stopped at its cap, an arm invalidated by K4, a condition not met, a void lineage set), leaves Δ and
 * C7a and is printed on the "dropped" line. jobs: [{ id, cluster, required: [mode], present: [mode] }].
 */
export function missingDataRule(jobs) {
  const kept = [], dropped = [];
  for (const j of jobs) {
    const missing = j.required.filter(m => !j.present.includes(m));
    (missing.length ? dropped : kept).push(missing.length ? { job: j.id, cluster: j.cluster, missing } : j);
  }
  const clusters = [...new Set(kept.map(j => j.cluster))];
  return { kept: kept.map(j => j.id), dropped, clusters, line: `dropped ${dropped.length}: ${dropped.map(d => `${d.job} (${d.missing.join(', ')})`).join('; ') || 'none'}` };
}

// ------------------------------------------------------------------------------------------------------- §11 power
const T975 = [null, 12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.160, 2.145, 2.131, 2.120, 2.110, 2.101, 2.093, 2.086];
/**
 * The power gate after NL1 (PREREG §11): the projected informative clusters (held-out clusters where the router's
 * choice is expected to differ from SBS-train, from the LOCO agreement share on TRAIN), the sign-flip floor they allow,
 * and the t-type half-width at the planned cluster count.
 */
export function powerGate({ clusters, agreeShare, sigma, alpha = 0.025, halfWidthMax = MIN_USEFUL }) {
  const expectedInformative = clusters * (1 - agreeShare), whole = Math.floor(expectedInformative + 1e-9);
  const floor = 2 ** -whole, t = T975[Math.min(clusters - 1, T975.length - 1)] ?? 1.96;
  const halfWidth = clusters > 1 ? (t * sigma) / Math.sqrt(clusters) : Infinity;
  const floorOk = floor <= alpha, widthOk = halfWidth <= halfWidthMax;
  return { clusters, agreeShare, expectedInformative, floorAtExpected: floor, floorOk, halfWidth, widthOk,
    outcome: floorOk && widthOk ? 'powered' : 'expected INCONCLUSIVE (add clusters or accept; record in §13 before NL2)' };
}

// ------------------------------------------------------------------------------------------------------ §12 meter
const NO_COST_ERRORS = new Set(['MODEL_TIMEOUT', 'AGENT_TIMEOUT', 'TIMEOUT', 'KILLED', 'SESSION_KILLED', 'BUDGET_KILLED']);
const num = x => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
/** Whether a row carries an observed cost: no timeout or kill, not costUnknown, and some dollars or tokens recorded. */
export function hasObservedCost(row) {
  const usd = num(row.usdReported ?? row.costUsd) + num(row.usdImputed ?? row.imputedUsd) + num(row.usdRepriced);
  const tokens = num(row.tokens?.input) + num(row.tokens?.output) + num(row.usage?.input_tokens) + num(row.usage?.output_tokens);
  return !row.costUnknown && !NO_COST_ERRORS.has(row.error?.code) && (usd > 0 || tokens > 0);
}
/**
 * One row's charge on the cap meter (PREREG §12 K5): max(reported, re-priced) when the row has an observed cost; its
 * bound when it has none (a timeout or killed session, costUnknown, or no dollars and no tokens recorded).
 */
export function rowCharge(row, bound) {
  const reported = num(row.usdReported ?? row.costUsd) + num(row.usdImputed ?? row.imputedUsd), repriced = num(row.usdRepriced);
  return hasObservedCost(row) ? Math.max(reported, repriced) : Math.max(bound, reported, repriced);
}
/** The cap meter of a stage or tag: settled rows charged by rowCharge, plus the reserved bound of every start in flight. */
export function capMeter(rows, { bound, inFlight = [] }) {
  const boundOf = typeof bound === 'function' ? bound : () => bound;
  let observedUsd = 0, boundUsd = 0, noCostRows = 0;
  for (const r of rows) {
    const c = rowCharge(r, boundOf(r));
    if (hasObservedCost(r)) observedUsd += c; else { boundUsd += c; noCostRows += 1; }
  }
  const inFlightUsd = inFlight.reduce((a, x) => a + num(x), 0);
  return { rows: rows.length, noCostRows, observedUsd, boundUsd, inFlightUsd, meterUsd: observedUsd + boundUsd + inFlightUsd };
}
/** A start is allowed only when the meter plus its reserved bound stays within the cap (reserve before launch). */
export const mayStart = ({ meterUsd, boundUsd, capUsd }) => meterUsd + boundUsd <= capUsd + 1e-9;
