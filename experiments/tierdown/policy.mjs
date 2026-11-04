// Tier-down policy (A10 / #33, #42; dossier §4 item 4 and §5 "Promotion rule"). Pure functions, no I/O, no model calls.
//
// A cheaper tier t replaces the reference tier at site s only when, on the HELD-OUT slice H and with everything frozen
// beforehand (PREREG-TIERDOWN.md):
//   Bound 1  the one-sided 95% Clopper-Pearson upper bound on the unit-level pass->fail flip rate (the cheaper tier's
//            real answers injected end to end, every other judge held at its archived answer) is <= delta(class), where
//            class is the site's leverage class measured on the CALIBRATION slice C by the perturbation screen:
//              low  (flip rate < 0.05)        delta 0.10   (0 flips need >= 29 units)
//              mid  (0.05 <= rate < 0.20)     delta 0.05   (>= 59)
//              high (rate >= 0.20)            delta 0.02   (>= 149)
//            (Assurance levels scale with consequence, DO-178C style; the success-run theorem gives the unit counts.)
//   Bound 2  the mean decision-leaf disagreement of t with the reference answers on H is <= epsilon (0.05), and t's
//            usable-answer rate (schema-valid, not abstained) is >= 0.95 (dossier Phase 1 drop rule), unless it is a rule
//            tier, whose abstentions fall back to the reference by construction.
// Sites are tested in a preregistered fixed sequence (descending expected saving on C) at alpha = 0.05 each; testing
// stops at the first site whose bounds fail (fixed-sequence testing keeps the familywise error at alpha without a
// Bonferroni split). The promoted policy runs t with a fallback to the reference on abstention, an invalid answer or a
// failed solver check (a cascade), and a deployed site is monitored by shadow re-asks at the reference tier and a
// Bernoulli CUSUM that demotes it on drift.
import { clopperPearson, binomUpperTail } from '../lib/stats-ebed.mjs';
import { runCusum } from '../jit/cusum.mjs';

export const LEVERAGE_CLASSES = Object.freeze([
  { name: 'low', below: 0.05, delta: 0.10 },
  { name: 'mid', below: 0.20, delta: 0.05 },
  { name: 'high', below: Infinity, delta: 0.02 },
]);
export const EPSILON = 0.05, MIN_USABLE = 0.95, ALPHA = 0.05, NI_MARGIN = 0.03;

// The class of a site from its C-slice perturbation flip rate. An unmeasured site (no measured perturbation) is 'high':
// no evidence of low leverage is not evidence of low leverage.
export function leverageClass(flipRate) {
  if (flipRate == null || !Number.isFinite(flipRate)) return { ...LEVERAGE_CLASSES[2], unmeasured: true };
  return { ...LEVERAGE_CLASSES.find(c => flipRate < c.below) };
}

// Smallest number of units with zero flips whose one-sided upper bound reaches delta: n >= ln(alpha) / ln(1 - delta).
export function zeroFlipUnits(delta, { level = 0.95 } = {}) {
  if (!(delta > 0 && delta < 1)) throw new Error(`zeroFlipUnits: delta must be in (0, 1), got ${delta}`);
  let n = Math.max(1, Math.floor(Math.log(1 - level) / Math.log1p(-delta)) - 1);
  while (clopperPearson(0, n, 'upper', { level }).upper > delta) n++;
  return n;
}

// Bound 1: {flips, units} -> {upper, delta, holds}.
export function bound1({ flips, units, delta, level = 1 - ALPHA }) {
  if (!Number.isInteger(units) || units < 0 || !Number.isInteger(flips) || flips < 0 || flips > units) throw new Error(`bound1: bad counts ${flips}/${units}`);
  const upper = units ? clopperPearson(flips, units, 'upper', { level }).upper : 1;
  return { flips, units, upper, delta, holds: units > 0 && upper <= delta };
}

// Bound 2: mean decision-leaf disagreement and usable-answer rate.
export function bound2({ disagreement, usable, answered, epsilon = EPSILON, minUsable = MIN_USABLE, rule = false }) {
  const usableRate = answered ? usable / answered : 0;
  // 1e-12: a mean agreement of exactly 0.95 is a disagreement of 0.05, not 0.05000000000000004 (found on the C data
  // before AMENDMENT-1 was frozen: records/date-order at Mercury, 19 of 20 leaves).
  const okDisagreement = disagreement != null && disagreement <= epsilon + 1e-12;
  const okUsable = rule ? usable > 0 : usableRate >= minUsable;
  return { disagreement, usableRate, epsilon, minUsable: rule ? null : minUsable, holds: okDisagreement && okUsable };
}

// Fixed-sequence testing: candidates in their preregistered order; each is tested at full alpha; the first failure
// stops the sequence (every later candidate is 'not tested'). test(candidate) -> {holds, ...}.
export function fixedSequence(candidates, test) {
  const out = [];
  let stopped = null;
  for (const c of candidates) {
    if (stopped) { out.push({ ...c, verdict: 'not-tested', stoppedBy: stopped }); continue; }
    const r = test(c);
    out.push({ ...c, ...r, verdict: r.holds ? 'promote' : 'keep-reference' });
    if (!r.holds) stopped = c.id ?? c.site;
  }
  return out;
}

// Exact two-sided McNemar p on the discordant pairs (b: reference pass, policy fail; c: reference fail, policy pass).
export function mcnemarExact(b, c) {
  const d = b + c;
  if (!d) return 1;
  const k = Math.min(b, c);
  const tail = 1 - binomUpperTail(d, 0.5, k + 1);   // P(X <= k), X ~ Bin(d, 1/2)
  return Math.min(1, 2 * tail);
}

// Equal accuracy (non-inferiority) of the policy against the all-reference arm on paired units: the one-sided upper
// bound on the loss rate b/n, net of the observed gains c/n, must stay under the margin. Conservative (the gains are
// taken at their point estimate, the losses at their upper bound); reports the exact McNemar p as well.
export function nonInferior({ b, c, n, margin = NI_MARGIN, level = 1 - ALPHA }) {
  if (!n) return { b, c, n, margin, holds: false, reason: 'no paired units' };
  const lossUpper = clopperPearson(b, n, 'upper', { level }).upper, net = lossUpper - c / n;
  return { b, c, n, margin, lossUpper, netLossUpper: net, mcnemarP: mcnemarExact(b, c), holds: net < margin, diff: (c - b) / n };
}

// Cost saved at equal accuracy: 1 - C_policy / C_ref, both in judge USD per unit.
export const costSaved = (policyUsd, refUsd) => (refUsd > 0 ? 1 - policyUsd / refUsd : null);

// The deployed cascade for one site: the tier answers; abstention, an invalid answer or a failed solver check falls back
// to the reference tier (the judge's tier list becomes [tier, ...referenceTiers]).
export function cascadeOf({ site, tier, reference }) {
  return { site, tiers: [tier, ...[].concat(reference).filter(t => t !== tier)], fallbackOn: ['abstain', 'invalid', 'check-failed'] };
}

// Shadow plan: re-ask the reference tier on a share of production calls (crowdsourcing gold injection; about sqrt(n) of n).
export const shadowCount = n => (n > 0 ? Math.max(1, Math.ceil(Math.sqrt(n))) : 0);

// Demotion monitor: a Bernoulli CUSUM over shadow comparisons (y = 1 when the promoted tier disagreed with the reference
// on a decision leaf), at the expected disagreement rate p0 (the H estimate) and odds ratio ra (2: alarm on a doubling).
// Returns {alarms, demote, path}.
export function demotionMonitor(disagreements, { p0, ra = 2, h = 2.5 } = {}) {
  if (!(p0 > 0 && p0 < 1)) throw new Error('demotionMonitor: p0 must be in (0, 1)');
  const seq = disagreements.map((y, idx) => ({ idx, y: y ? 1 : 0, p: p0, version: 0 }));
  const r = runCusum(seq, { h, ra, reset: 'none' });
  return { alarms: r.alarms, demote: r.alarms.length > 0, firstAlarm: r.alarms[0] ?? null, path: r.path };
}

// ---------------------------------------------------------------------------------------------- review 2026-11-04
// #11: the preregistered non-inferiority (nonInferior above) takes the gains at their point estimate. The corrected
// (exploratory) test uses Tango's (1998) score interval for a paired difference of proportions, which keeps both
// discordant cells random and does not collapse when there are no discordant pairs (Newcombe's hybrid interval does:
// with b = c = 0 its width is the Wilson interval's asymmetry, about +-0.02 at n = 42, so it would "show" a 3-point
// non-inferiority from zero events). Delta = (c - b) / n, c = gains (fail->pass), b = losses (pass->fail).
// Closed form at b = c = 0: [-z^2 / (n + z^2), z^2 / (n + z^2)].
export function normalQuantile(p) {
  if (!(p > 0 && p < 1)) throw new Error(`normalQuantile: p must be in (0, 1), got ${p}`);
  // Acklam's rational approximation (relative error < 1.2e-9; z(0.95) = 1.6448536).
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
  const lo = 0.02425, hi = 1 - lo;
  let x;
  if (p < lo) { const q = Math.sqrt(-2 * Math.log(p)); x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  else if (p <= hi) { const q = p - 0.5, r = q * q; x = (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1); }
  else { const q = Math.sqrt(-2 * Math.log(1 - p)); x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  return x;
}

export function tangoScore({ b, c, n }, delta) {
  const n12 = c, n21 = b;
  const W = n12 + n21 - delta * (2 * n - n12 + n21);
  const q = (W + Math.sqrt(Math.max(0, W * W + 8 * n * n21 * delta * (1 - delta)))) / (4 * n);
  const v = n * (2 * q + delta * (1 - delta));
  const num = n12 - n21 - n * delta;
  return v > 0 ? num / Math.sqrt(v) : (num === 0 ? 0 : Math.sign(num) * Infinity);
}

// Two-sided interval at `level` (0.90 gives the one-sided 95% bounds) by bisection on the monotone score.
export function tangoInterval({ b, c, n, level = 0.90 }) {
  if (!(Number.isInteger(b) && Number.isInteger(c) && Number.isInteger(n) && b >= 0 && c >= 0 && b + c <= n && n > 0)) throw new Error(`tangoInterval: bad counts b ${b}, c ${c}, n ${n}`);
  const z = normalQuantile(1 - (1 - level) / 2), est = (c - b) / n, eps = 1e-12;
  const solve = (lo, hi, target) => { // tangoScore decreases in delta
    for (let i = 0; i < 200; i++) { const mid = (lo + hi) / 2; if (tangoScore({ b, c, n }, mid) > target) lo = mid; else hi = mid; }
    return (lo + hi) / 2;
  };
  const lower = est <= -1 + eps ? -1 : solve(-1 + eps, est, z), upper = est >= 1 - eps ? 1 : solve(est, 1 - eps, -z);
  return { b, c, n, estimate: est, lower, upper, level, z };
}

// Corrected (exploratory) equal-accuracy test: Tango lower bound on (policy - reference) > -margin. Units are runs; when
// `byTask` is given (one {b, c} per task: the sign of the task's mean paired difference), the same test is also run with
// one unit per task (review #3: runs of one task are not independent). `holds` is the task-level verdict when tasks are
// given, else the run-level one.
export function nonInferiorTango({ b, c, n, byTask = null, margin = NI_MARGIN, level = 0.90 }) {
  const runs = n ? tangoInterval({ b, c, n, level }) : null;
  let tasks = null;
  if (byTask?.length) {
    const tb = byTask.filter(t => t.diff < 0).length, tc = byTask.filter(t => t.diff > 0).length;
    tasks = tangoInterval({ b: tb, c: tc, n: byTask.length, level });
  }
  const decide = iv => (iv ? iv.lower > -margin : false);
  return { margin, level, runs, tasks, holdsRuns: decide(runs), holdsTasks: tasks ? decide(tasks) : null, holds: tasks ? decide(tasks) : decide(runs) };
}

// Task-clustered percentile bootstrap of cost saved (1 - sum policy / sum reference over resampled tasks). Seeded and
// deterministic: tasks are sorted by key and drawn with beds/lib/rng.mjs.
export function clusterBootstrapSaved(units, { iterations = 4000, level = 0.90, seed = 'tierdown-review-20261104' } = {}, rngOf) {
  const byTask = new Map();
  for (const u of units) { const t = byTask.get(u.task) ?? { pol: 0, ref: 0 }; t.pol += u.policyUsd; t.ref += u.refUsd; byTask.set(u.task, t); }
  const tasks = [...byTask.keys()].sort().map(k => byTask.get(k)), K = tasks.length;
  if (!K) return null;
  const r = rngOf(seed, 'cluster-saved'), out = new Float64Array(iterations);
  for (let i = 0; i < iterations; i++) { let p = 0, q = 0; for (let j = 0; j < K; j++) { const t = tasks[r.int(0, K - 1)]; p += t.pol; q += t.ref; } out[i] = q > 0 ? 1 - p / q : 0; }
  out.sort();
  const at = x => out[Math.min(iterations - 1, Math.max(0, Math.floor(x * (iterations - 1))))];
  const tp = tasks.reduce((s, t) => s + t.pol, 0), tr = tasks.reduce((s, t) => s + t.ref, 0);
  return { tasks: K, estimate: tr > 0 ? 1 - tp / tr : null, lower: at((1 - level) / 2), upper: at(1 - (1 - level) / 2), level, iterations };
}

// #14: a confidence interval for Spearman's rho (Fisher z with the Bonett-Wright standard error sqrt((1 + rho^2/2) / (n - 3))).
export function spearmanInterval(rho, n, { level = 0.95 } = {}) {
  if (rho == null || !(n > 3)) return null;
  const z = normalQuantile(1 - (1 - level) / 2), r = Math.max(-0.999999, Math.min(0.999999, rho));
  const f = Math.atanh(r), se = Math.sqrt((1 + r * r / 2) / (n - 3));
  return { rho, n, level, lower: Math.tanh(f - z * se), upper: Math.tanh(f + z * se) };
}

// Token-priced sensitivity (#9): a tier's tokens at another listed price ({inputPerMTok, outputPerMTok, cacheReadPerMTok}).
export const pricedUsd = (tokens, price) => (tokens ? ((tokens.input ?? 0) * price.inputPerMTok + (tokens.output ?? 0) * price.outputPerMTok + (tokens.cacheRead ?? 0) * (price.cacheReadPerMTok ?? price.inputPerMTok)) / 1e6 : 0);
