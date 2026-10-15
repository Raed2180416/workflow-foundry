// Regression tests for the preregistered reading rules (prereg-rules.mjs), one or more per defect of the 2026-10-14
// adversarial review of PREREG-NEED-V1.md. $0: no model, no bed, no result file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  balancedAccuracyInterval, c7aPower, c7aMinimumCounts, c7aReading, signFlipFloor, withDropAgreement, g1Reading, holm, harmfulPositions,
  thetaFitStatus, locoFolds, fitOrRule, missingDataRule, powerGate, rowCharge, hasObservedCost, capMeter, mayStart, C7A_ALPHA,
} from '../prereg-rules.mjs';
import { signFlipTest } from '../metrics.mjs';
import { STAGES_FILE } from '../prereg-check.mjs';

const STAGES = JSON.parse(readFileSync(STAGES_FILE, 'utf8'));
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} vs ${b}`);
// The first draft's C7a bound: the mean of the two per-class Wilson lower bounds (z = 1.96), kept here only as the contrast.
const wilsonLo = (x, n, z = 1.96) => { const p = x / n, d = 1 + (z * z) / n; return (p + (z * z) / (2 * n) - z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d; };

test('review B1: at the planned class counts a perfect H0 is not powered, so C7a reads INCONCLUSIVE, never REFUTED', () => {
  // The reviewer's hand check of the first draft: 1/1 and 7/7 gave a Wilson mean of 0.426 <= 0.5, so F12 tripped.
  close((wilsonLo(1, 1) + wilsonLo(7, 7)) / 2, 0.426, 0.001, 'first-draft Wilson mean');
  // Exact joint bound for a perfect classifier at (1, 7): sup over p1 of p1 (2b - p1)^7 = 7^7 b^8 / 4^8, so b = (0.025 * 4^8 / 7^7)^(1/8).
  const p17 = c7aPower(1, 7);
  close(p17.perfectLowerBound, (0.025 * 4 ** 8 / 7 ** 7) ** (1 / 8), 1e-4, 'analytic (1, 7)');
  assert.equal(p17.powered, false);
  const r = c7aReading({ h0: { tp: 1, fn: 0, tn: 7, fp: 0 }, tunedPoint: 0.5, coverage: 1 });
  assert.equal(r.reading, 'INCONCLUSIVE');
  assert.equal(r.f12, false);
  assert.match(r.why, /not powered/);
  // (2, 8): sup of p1^2 (2b - p1)^8 is 0.16 * 1.6^8 b^10, so b = (0.025 / (0.16 * 1.6^8))^(1/10) = 0.570.
  close(c7aPower(2, 8).perfectLowerBound, (0.025 / (0.16 * 1.6 ** 8)) ** 0.1, 1e-4, 'analytic (2, 8)');
  // Second review (D9): the precondition is a chance, P(lower bound > 0.5) >= 0.8 for a TPR = TNR = 0.9 classifier, not a
  // perfect classifier's bound; 2 + 8 is no longer powered (pExclude 0.659).
  assert.equal(c7aPower(2, 8).powered, false);
  close(c7aPower(2, 8).pExclude, 0.659, 0.001, 'pExclude (2, 8)');
  // Minimum confident counts (stated in PREREG §7 and stages.json analysis.c7a), revised in D9.
  assert.deepEqual(c7aMinimumCounts({ maxPos: 4 }), [{ pos: 1, minNeg: null }, { pos: 2, minNeg: null }, { pos: 3, minNeg: null }, { pos: 4, minNeg: 9 }]);
  assert.deepEqual(STAGES.analysis.c7a.minimumConfidentCounts.slice(0, 3).map(x => [x.pos, x.neg]), [[4, 9], [5, 7], [6, 6]]);
  // Powered and the upper bound below 0.7: F12 trips (REFUTED); powered and right: SUPPORTED-DIAGNOSTIC.
  assert.equal(c7aReading({ h0: { tp: 2, fn: 4, tn: 5, fp: 5 }, tunedPoint: 0.5, coverage: 1 }).reading, 'REFUTED');
  assert.equal(c7aReading({ h0: { tp: 6, fn: 0, tn: 10, fp: 0 }, tunedPoint: 0.6, coverage: 0.8 }).reading, 'SUPPORTED-DIAGNOSTIC');
  assert.equal(c7aReading({ h0: { tp: 6, fn: 0, tn: 10, fp: 0 }, tunedPoint: 0.6, coverage: 0.4 }).reading, 'INCONCLUSIVE', 'coverage under 50%');
  assert.equal(c7aReading({ h0: { tp: 0, fn: 0, tn: 8, fp: 0 } }).reading, 'INCONCLUSIVE', 'one class only');
});

test('review B1: the joint interval has exact coverage >= 1 - alpha per side (enumerated, not simulated)', () => {
  // Coverage of the lower bound: sum over every outcome (x1, x2) of P(outcome) * [lo(outcome) <= true BA].
  const pmf = (n, p) => { const c = [1]; for (let k = 1; k <= n; k++) c[k] = (c[k - 1] * (n - k + 1)) / k; return c.map((ck, k) => ck * p ** k * (1 - p) ** (n - k)); };
  for (const [n1, n2, p1, p2] of [[2, 6, 0.9, 0.7], [3, 9, 0.6, 0.95], [1, 7, 0.5, 0.9], [4, 4, 0.75, 0.75]]) {
    const truth = (p1 + p2) / 2, a = pmf(n1, p1), b = pmf(n2, p2);
    let covLo = 0, covHi = 0;
    for (let x1 = 0; x1 <= n1; x1++) for (let x2 = 0; x2 <= n2; x2++) {
      const ci = balancedAccuracyInterval({ tp: x1, fn: n1 - x1, tn: x2, fp: n2 - x2 });
      if (ci.lo <= truth + 1e-9) covLo += a[x1] * b[x2];
      if (ci.hi >= truth - 1e-9) covHi += a[x1] * b[x2];
    }
    assert.ok(covLo >= 1 - C7A_ALPHA - 1e-6, `lower bound coverage ${covLo} at ${[n1, n2, p1, p2]}`);
    assert.ok(covHi >= 1 - C7A_ALPHA - 1e-6, `upper bound coverage ${covHi} at ${[n1, n2, p1, p2]}`);
  }
  const ci = balancedAccuracyInterval({ tp: 5, fn: 1, tn: 9, fp: 3 });
  assert.ok(ci.lo < ci.point && ci.point < ci.hi);
  assert.equal(balancedAccuracyInterval({ tp: 0, fn: 0, tn: 3, fp: 0 }), null);
});

test('review B1 and B2: a C7a or C7b claim must survive dropping r3p (near and dev-observed)', () => {
  // r3p carries 3 of the 6 positives: dropping it leaves an unpowered set, so a would-be SUPPORTED-DIAGNOSTIC reads
  // INCONCLUSIVE (D9: 6 + 10 is powered, 3 + 10 is not).
  const full = { h0: { tp: 6, fn: 0, tn: 10, fp: 0 }, tunedPoint: 0.5, coverage: 1 };
  assert.equal(c7aReading(full).reading, 'SUPPORTED-DIAGNOSTIC');
  const r = c7aReading({ ...full, withoutNear: { h0: { tp: 3, fn: 0, tn: 10, fp: 0 }, tunedPoint: 0.5, coverage: 1 } });
  assert.equal(r.reading, 'INCONCLUSIVE');
  assert.equal(r.agrees, false);
  assert.equal(c7aReading({ ...full, withoutNear: null }).reading, 'INCONCLUSIVE', 'no valid set without r3p');
  assert.deepEqual(withDropAgreement('SUPPORTED', 'SUPPORTED'), { reading: 'SUPPORTED', agrees: true });
  assert.equal(withDropAgreement('SUPPORTED', 'INCONCLUSIVE').reading, 'INCONCLUSIVE');
  assert.equal(withDropAgreement('REFUTED', 'INCONCLUSIVE').reading, 'INCONCLUSIVE');
  assert.equal(withDropAgreement('HARMFUL', 'INCONCLUSIVE').reading, 'HARMFUL', 'a safety rule stands on the full set');
});

test('review M1: zero clusters (router = SBS) set the sign-flip floor; the power gate projects informative clusters', () => {
  // The reviewer's example: 4 informative clusters at +0.10 and 3 zero clusters.
  const d = [0.1, 0.1, 0.1, 0.1, 0, 0, 0];
  const t = signFlipTest(d, { alpha: 0.025 });
  assert.equal(t.p, 8 / 128);
  assert.ok(!(t.lo > 0), 'SUPPORTED is impossible');
  const f = signFlipFloor(d);
  assert.deepEqual(f, { n: 7, zero: 3, informative: 4, floor: 1 / 16 });
  assert.ok(t.p >= f.floor - 1e-12, 'p is never below 2^-(informative clusters)');
  assert.equal(signFlipTest(Array(7).fill(0.1), { alpha: 0.025 }).p, 1 / 128, 'all seven informative: 1/128');
  // Power gate: 8 planned clusters at agreement 0.5 leave 4 informative clusters, floor 1/16 > 0.025.
  const g = powerGate({ clusters: 8, agreeShare: 0.5, sigma: 0.02 });
  assert.equal(g.expectedInformative, 4);
  assert.equal(g.floorAtExpected, 1 / 16);
  assert.equal(g.floorOk, false);
  assert.match(g.outcome, /expected INCONCLUSIVE/);
  assert.equal(powerGate({ clusters: 8, agreeShare: 0, sigma: 0.02 }).floorOk, true);
});

test('review M2: with 4 TRAIN clusters G1 can only read CONTINUE or OWNER-DECIDES; REFUTED-PREMISE needs exact bounds', () => {
  // The exact one-sided 95% sign-flip upper bound over 4 clusters is +infinity (smallest p 1/16 > 0.05).
  assert.equal(signFlipTest([0.001, 0.002, 0.0, 0.001], { alpha: 0.05 }).hi, Infinity);
  const tiny = V => ({ V, N: 10, upper: 0.001, lower: -0.01, jobLower: -0.001, costShare: 0.5 });
  const four = g1Reading({ clusters: 4, cells: [tiny(0.1), tiny(1), tiny(10)] });
  assert.equal(four.canRefute, false);
  assert.notEqual(four.verdict, 'REFUTED-PREMISE');
  assert.deepEqual(four.possible, ['CONTINUE', 'OWNER-DECIDES']);
  assert.equal(four.verdict, 'OWNER-DECIDES');
  // CONTINUE on the diagnostic job-level bound.
  const cont = g1Reading({ clusters: 4, cells: [tiny(0.1), { ...tiny(1), jobLower: 0.02 }, tiny(10)] });
  assert.equal(cont.verdict, 'CONTINUE');
  assert.match(cont.basis, /diagnostic/);
  // With 5 clusters the exact bound is finite and can refute.
  assert.equal(g1Reading({ clusters: 5, cells: [tiny(0.1), tiny(1), tiny(10)] }).verdict, 'REFUTED-PREMISE');
  assert.match(STAGES.analysis.g1.fourClusters, /only read CONTINUE or OWNER-DECIDES/);
  assert.match(STAGES.analysis.labelConfidence, /no cluster level/);
});

test('review M3: theta is not fitted below the minimum; a fold without a positive is undefined; thresholds sit at midpoints', () => {
  // Confident N = 1 TRAIN labels as hypothesised in stages.json (pending and either rows are not confident labels).
  const train = STAGES.jobs.filter(j => j.split === 'train').map(j => ({ job: j.id, cluster: j.cluster, workflow: j.hypothesis.n1.class === 'workflow' }));
  assert.deepEqual(train.filter(x => x.workflow).map(x => x.job), ['wbed-r3-hi']);
  const st = thetaFitStatus(train);
  assert.equal(st.fit, false);
  assert.match(st.why, /H0 not fitted: 1 confident positive\(s\) < 2; positives in 1 cluster\(s\) < 2/);
  const loco = locoFolds(train, ['W', 'kinetics', 'codefix', 'need-qa']);
  assert.deepEqual(loco.folds.find(f => f.held === 'W'), { held: 'W', defined: false, trainPos: 0, trainNeg: 5 });
  assert.equal(loco.undefined, 1);
  assert.equal(loco.defined, 3);
  // Midpoint rule on the reviewer's set-1 medians (log10), with a second positive outside W so a fit is allowed.
  const items = [
    { cluster: 'W', workflow: true, features: { logInputTokens: 4.60, maxListLength: 2.98 } },    // wbed-r3-hi
    { cluster: 'X', workflow: true, features: { logInputTokens: 4.90, maxListLength: 0.50 } },    // a positive outside W
    { cluster: 'W', workflow: false, features: { logInputTokens: 4.26, maxListLength: 2.27 } },   // wbed-r1-hi
    { cluster: 'W', workflow: false, features: { logInputTokens: 4.78, maxListLength: 1.51 } },   // wbed-r6
    { cluster: 'K', workflow: false, features: { logInputTokens: 3.80, maxListLength: 1.00 } },
  ];
  assert.equal(thetaFitStatus(items).fit, true);
  const fit = fitOrRule(items, ['logInputTokens', 'maxListLength']);
  assert.equal(fit.balancedAccuracy, 1);
  close(fit.thresholds.maxListLength, (2.27 + 2.98) / 2, 1e-12, 'theta_fan at the midpoint, not at wbed-r3-hi\'s own 2.98');
  close(fit.thresholds.logInputTokens, (4.78 + 4.90) / 2, 1e-12, 'theta_tok at the midpoint');
  for (const [k, th] of Object.entries(fit.thresholds)) assert.ok(!items.some(x => x.features[k] === th), `${k} never sits on a job's own value`);
  assert.throws(() => fitOrRule(items.filter(x => !x.workflow), ['logInputTokens']), /both classes/);
});

test('review m2 (minor): HARMFUL is Holm-adjusted over the 6 (policy, V) tests', () => {
  assert.deepEqual(holm([0.01, 0.04, 0.03]).map(x => +x.toFixed(6)), [0.03, 0.06, 0.06]);
  const tests = [['NR-static', 0.1, 0.0078], ['NR-static', 1, 0.02], ['NR-static', 10, 0.4], ['NR-probe', 0.1, 0.5], ['NR-probe', 1, 0.6], ['NR-probe', 10, 0.9]]
    .map(([policy, V, pLess]) => ({ policy, V, pLess }));
  const h = harmfulPositions(tests);
  assert.deepEqual(h.map(x => [x.policy, x.V]), [['NR-static', 0.1]], 'p = 0.02 is harmful unadjusted, not after Holm (0.10)');
  assert.match(STAGES.analysis.levels['C7b HARMFUL'], /Holm over the 6/);
  assert.match(STAGES.analysis.maskedFallback, /next mode of their own TRAIN ranking/);
});

test('review m3 (minor): a job missing a primary mode leaves Delta and C7a and is counted; a conditional job that does not run leaves TRAIN', () => {
  const all = ['direct-H', 'agent-H', 'agent-O', 'agent-H+proc', 'construct-H'];
  const r = missingDataRule([
    { id: 'incident', cluster: 'incident', required: all, present: all },
    { id: 'synth-hi', cluster: 'synth', required: all, present: all.filter(m => m !== 'agent-O') },   // stage stopped at its cap
    { id: 'gameqa', cluster: 'gameqa', required: all.filter(m => m !== 'direct-H'), present: all.filter(m => m !== 'direct-H') }, // masked, not missing
  ]);
  assert.deepEqual(r.kept, ['incident', 'gameqa']);
  assert.deepEqual(r.dropped, [{ job: 'synth-hi', cluster: 'synth', missing: ['agent-O'] }]);
  assert.match(r.line, /dropped 1: synth-hi \(agent-O\)/);
  // codefix-notests (conditional) not run: TRAIN is 14 jobs in the same 4 clusters.
  const ran = STAGES.jobs.filter(j => j.split === 'train' && j.id !== 'codefix-notests');
  assert.equal(ran.length, 14);
  assert.deepEqual([...new Set(ran.map(j => j.cluster))], ['W', 'kinetics', 'codefix', 'need-qa']);
  assert.match(STAGES.analysis.missingData, /recomputed on what ran/);
});

test('review M7: one cap meter for every runner (max of reported and re-priced, bounds for rows with no observed cost, reservations)', () => {
  // M1 tag m1: 166 rows with an observed cost summing to $2.9957 and 26 MODEL_TIMEOUT rows booked at $0.
  const rows = [
    ...Array.from({ length: 166 }, () => ({ costUsd: 2.9957 / 166, imputedUsd: 0 })),
    ...Array.from({ length: 26 }, () => ({ costUsd: 0, imputedUsd: 0, error: { code: 'MODEL_TIMEOUT' } })),
  ];
  const m = capMeter(rows, { bound: 1 });
  assert.equal(m.noCostRows, 26);
  close(m.meterUsd, 28.9957, 1e-9, 'M1 on the §12 meter');
  close(m.meterUsd, STAGES.stages.find(s => s.id === 'M1').observed.m1.meterUsd, 1e-9, 'stages.json records the same figure');
  assert.ok(m.meterUsd > 15, 'over M1\'s $15 cap, let alone its $5 share');
  // Reservations: 4 starts in flight at $1 each count before they return.
  const inflight = capMeter(rows.slice(0, 166), { bound: 1, inFlight: [1, 1, 1, 1] });
  close(inflight.meterUsd, 2.9957 + 4, 1e-9);
  assert.equal(mayStart({ meterUsd: inflight.meterUsd, boundUsd: 1, capUsd: 7 }), false);
  assert.equal(mayStart({ meterUsd: inflight.meterUsd, boundUsd: 1, capUsd: 8 }), true);
  // max(reported, re-priced); costUnknown and no-dollar, no-token rows are charged at the bound.
  assert.equal(rowCharge({ usdReported: 0.02, usdRepriced: 0.03 }, 1), 0.03);
  assert.equal(rowCharge({ usdReported: 0.05, usdRepriced: 0.03 }, 1), 0.05);
  assert.equal(rowCharge({ costUsd: 0.4, costUnknown: true }, 2), 2);
  assert.equal(hasObservedCost({ costUsd: 0, tokens: { input: 0, output: 0 } }), false);
  assert.equal(hasObservedCost({ costUsd: 0, usage: { input_tokens: 10, output_tokens: 3 } }), true);
  assert.match(STAGES.spendMeter.appliesTo, /m1-run\.mjs/);
});
