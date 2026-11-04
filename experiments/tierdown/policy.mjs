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
