// Tests for experiments/lib/stats-ebed.mjs (E-BED §6). Every expected value is derived independently of the module:
// by hand or in closed form (derivations in the comments), by exact rational arithmetic with BigInt, or by a published
// table. $0, no model calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  logGamma, betaInc, binomUpperTail, clopperPearson, lowerBoundAtLeast, maxFailures, minCleanCases, reliabilityVerdict,
  censoringReport, wilcoxonExact, wilcoxonCritical, holm, familyTest, familyDecision, itemGap, nonInferiority, itemGapSE,
  familyPower,
} from './stats-ebed.mjs';

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} got ${a}, want ${b} ± ${tol}`);

// Exact binomial upper tail P(X >= k), X ~ Bin(n, a/b), as a BigInt numerator over b^n:
// sum_{i >= k} C(n, i) a^i (b − a)^(n − i). No floating point anywhere.
function tailNumerator(n, a, b, k) {
  const A = BigInt(a), Bm = BigInt(b - a);
  let c = 1n, s = 0n;
  for (let i = 0; i <= n; i++) {
    if (i >= k) s += c * A ** BigInt(i) * Bm ** BigInt(n - i);
    c = (c * BigInt(n - i)) / BigInt(i + 1);
  }
  return s;
}
// P(X >= k | p = a/b) <= 1/20 (the one-sided 95% boundary), decided exactly: 20 · numerator <= b^n.
const tailAtMostFivePercent = (n, a, b, k) => 20n * tailNumerator(n, a, b, k) <= BigInt(b) ** BigInt(n);
// A plain floating finite sum of the binomial tail, independent of the module's incomplete beta (for small n).
function tailSum(n, p, k) {
  let s = 0;
  for (let i = Math.max(0, k); i <= n; i++) {
    let lc = 0;
    for (let j = 1; j <= i; j++) lc += Math.log(n - i + j) - Math.log(j);
    s += Math.exp(lc + i * Math.log(p) + (n - i) * Math.log1p(-p));
  }
  return s;
}

test('special functions: log-gamma and the incomplete beta against closed forms', () => {
  // Γ(5) = 4! = 24; Γ(1/2) = sqrt(pi); Γ(10) = 362880.
  close(logGamma(5), Math.log(24), 1e-13);
  close(logGamma(0.5), 0.5 * Math.log(Math.PI), 1e-13);
  close(logGamma(10), Math.log(362880), 1e-12);
  // I_x(1, 1) = x; I_x(a, 1) = x^a; I_x(1, b) = 1 − (1 − x)^b; I_x(a, b) = 1 − I_{1−x}(b, a).
  for (const x of [0.01, 0.3, 0.5, 0.77, 0.999]) {
    close(betaInc(1, 1, x), x, 1e-14);
    close(betaInc(7, 1, x), x ** 7, 1e-14);
    close(betaInc(1, 4, x), 1 - (1 - x) ** 4, 1e-14);
    close(betaInc(3.5, 2.25, x), 1 - betaInc(2.25, 3.5, 1 - x), 1e-13);
  }
  // Binomial tails: P(X >= 1 | n, p) = 1 − (1 − p)^n; P(X >= n) = p^n; and a finite sum at n = 40.
  close(binomUpperTail(30, 0.1, 1), 1 - 0.9 ** 30, 1e-13);
  close(binomUpperTail(30, 0.9, 30), 0.9 ** 30, 1e-13);
  for (const k of [0, 5, 17, 33, 40]) close(binomUpperTail(40, 0.37, k), tailSum(40, 0.37, k), 1e-12, `k ${k}`);
  // P(X >= 8 | 9, 1/2) = (C(9,8) + C(9,9)) / 512 = 10/512.
  close(binomUpperTail(9, 0.5, 8), 10 / 512, 1e-15);
});

test('Clopper-Pearson: closed-form bounds, the defining tail equations, and classic table values', () => {
  // x = n, one-sided lower 95%: P(X >= n | p) = p^n = 0.05 → p = 0.05^(1/n). n = 59: e^(ln 0.05 / 59) = e^(−0.050775)
  // = 0.950492 — the classic "59 clean trials for 95% at 95%"; n = 58 gives 0.949661 < 0.95.
  close(clopperPearson(59, 59, 'lower').lower, 0.950492390, 1e-8);
  close(clopperPearson(58, 58, 'lower').lower, 0.949660662, 1e-8);
  // x = 0, one-sided upper: (1 − p)^n = 0.05 → p = 1 − 0.05^(1/n); n = 2995 → 0.00099974 <= 0.001, n = 2994 → 0.00100008.
  close(clopperPearson(0, 2995, 'upper').upper, 1 - 0.05 ** (1 / 2995), 1e-12);
  // x = 1, n = 2, lower: 1 − (1 − p)^2 = 0.05 → p = 1 − sqrt(0.95) = 0.0253206.
  close(clopperPearson(1, 2, 'lower').lower, 1 - Math.sqrt(0.95), 1e-12);
  // Two-sided 95%, x = 0 of 10: upper = 1 − 0.025^(1/10) = 0.308497 (the textbook [0, 0.3085]).
  close(clopperPearson(0, 10, 'two-sided').upper, 1 - 0.025 ** 0.1, 1e-12);
  // Two-sided 95%, x = 5 of 10: the published interval [0.1871, 0.8129], symmetric about 1/2.
  const t = clopperPearson(5, 10, 'two-sided');
  close(t.lower, 0.1871, 5e-5); close(t.upper, 0.8129, 5e-5); close(t.lower + t.upper, 1, 1e-12);
  // The defining equations, checked with a finite sum that does not use the module's incomplete beta.
  for (const [x, n] of [[3, 17], [12, 40], [37, 40], [1, 25]]) {
    const lo = clopperPearson(x, n, 'lower').lower, hi = clopperPearson(x, n, 'upper').upper;
    close(tailSum(n, lo, x), 0.05, 1e-10, `P(X >= ${x} | ${n}, lower)`);
    close(1 - tailSum(n, hi, x + 1), 0.05, 1e-10, `P(X <= ${x} | ${n}, upper)`);
  }
  // Edge cases and shape.
  assert.equal(clopperPearson(0, 10, 'lower').lower, 0);
  assert.equal(clopperPearson(10, 10, 'upper').upper, 1);
  assert.deepEqual([clopperPearson(4, 10, 'lower').upper, clopperPearson(4, 10, 'upper').lower], [1, 0]);
  assert.throws(() => clopperPearson(11, 10), /x \(11\) > n/);
  assert.throws(() => clopperPearson(1, 10, 'sideways'), /side must be/);
});

test('H-E2 thresholds of E-BED §6, decided by exact rational arithmetic', () => {
  // The one-sided 95% lower bound for x of n is >= b  <=>  P(X >= x | p = b) <= 0.05.
  // n = 100, b = 0.95 (by hand: 0.95^100 = e^(100 ln 0.95) = e^(−5.129329) = 0.0059205):
  //   P(X >= 99) = 100 · 0.95^99 · 0.05 + 0.95^100 = 0.031161 + 0.005921 = 0.037081 <= 0.05  → 1 failure passes;
  //   P(X >= 98) = 0.037081 + C(100,2) · 0.95^98 · 0.05^2 = 0.037081 + 0.081181 = 0.118263 > 0.05 → 2 failures fail.
  assert.equal(tailAtMostFivePercent(100, 19, 20, 99), true);
  assert.equal(tailAtMostFivePercent(100, 19, 20, 98), false);
  assert.equal(maxFailures(100, 0.95), 1);
  // n = 300, b = 0.95: at most 8 failures (P(X >= 292) = 0.03407, P(X >= 291) = 0.06497).
  assert.equal(tailAtMostFivePercent(300, 19, 20, 292), true);
  assert.equal(tailAtMostFivePercent(300, 19, 20, 291), false);
  assert.equal(maxFailures(300, 0.95), 8);
  // Per world, n = 100, b = 0.90 (0.9^100 = e^(−10.536052) = 2.65614e-5):
  //   P(100) 2.656e-5, P(99) 2.951e-4, P(98) 1.6232e-3, P(97) 5.8916e-3, P(96) 0.0158746 → P(X >= 96) = 0.023711 <= 0.05;
  //   P(95) = C(100,5) · 0.9^95 · 0.1^5 = 75,287,520 · 4.4982e-5 · 1e-5 = 0.033866 → P(X >= 95) = 0.057577 > 0.05.
  assert.equal(tailAtMostFivePercent(100, 9, 10, 96), true);
  assert.equal(tailAtMostFivePercent(100, 9, 10, 95), false);
  assert.equal(maxFailures(100, 0.90), 4);
  // 59 clean cases are the smallest n whose zero-failure bound reaches 0.95 (0.95^59 = 0.04849 <= 0.05 < 0.95^58).
  assert.equal(maxFailures(59, 0.95), 0); assert.equal(maxFailures(58, 0.95), -1);
  assert.equal(lowerBoundAtLeast(59, 59, 0.95), true); assert.equal(lowerBoundAtLeast(58, 58, 0.95), false);
  // H-E2c: critical rate <= 0.1% needs n >= ln 0.05 / ln 0.999 = −2.995732 / −0.0010005 = 2994.2 → 2,995 clean cases.
  assert.equal(minCleanCases(0.001), 2995);
  assert.equal(minCleanCases(0.01), 299);   // ln 0.05 / ln 0.99 = 298.07 → 299
});

test('reliabilityVerdict: pooled and per-world bounds, critical violations, censoring label', () => {
  const W = (world, completed, passed, critical = 0) => ({ world, completed, passed, critical });
  // 3 worlds × 100 = 300 pooled. Pooled, at most 8 failures (above); per world of 100, at most 4 (above).
  // 3 + 3 + 2 = 8 failures: every bound holds.
  const ok = reliabilityVerdict([W('A', 100, 97), W('B', 100, 97), W('C', 100, 98)]);
  assert.equal(ok.pooled.passed, 292); assert.equal(ok.pooled.ok, true); assert.ok(ok.worlds.every(w => w.ok)); assert.equal(ok.holds, true); assert.equal(ok.label, 'holds');
  // 3 + 3 + 3 = 9 failures: the pooled bound fails although every world is fine.
  const nine = reliabilityVerdict([W('A', 100, 97), W('B', 100, 97), W('C', 100, 97)]);
  assert.equal(nine.pooled.ok, false); assert.ok(nine.worlds.every(w => w.ok)); assert.equal(nine.holds, false);
  // One world of 100 with 5 failures breaks the per-world 0.90 bound (4 is the most; derivation above).
  const pw = reliabilityVerdict([W('A', 100, 95), W('B', 400, 400)]);
  assert.equal(pw.worlds[0].ok, false); assert.equal(pw.worlds[0].maxFailures, 4); assert.equal(pw.holds, false);
  // A single critical violation fails H-E2 on its own.
  const crit = reliabilityVerdict([W('A', 300, 300, 1)]);
  assert.equal(crit.pooled.ok, true); assert.equal(crit.holds, false); assert.equal(crit.critical.upper, null);
  // Zero critical violations over 3,000 clean cases establish the 0.1% bound; over 300 they do not.
  assert.equal(reliabilityVerdict([W('A', 3000, 3000)]).critical.established, true);
  assert.equal(reliabilityVerdict([W('A', 300, 300)]).critical.established, false);
  // The censored label (E-BED §2.1): any epoch with a censored share > 20%.
  const cens = reliabilityVerdict([W('A', 300, 300)], { censoring: [{ started: 100, censored: 5 }, { started: 50, censored: 11 }] });
  assert.equal(cens.holds, true); assert.equal(cens.label, 'holds (censored)');
  assert.throws(() => reliabilityVerdict([W('A', 10, 11)]), /passed > completed/);
  assert.throws(() => reliabilityVerdict([W('A', 10, 9), W('A', 10, 9)]), /repeated/);
});

test('censoringReport: 20% limit per epoch, the last epoch optionally excepted (bed-health rule)', () => {
  const ep = [{ epoch: 'E0', started: 40, censored: 8 }, { epoch: 'E1', started: 30, censored: 7 }, { epoch: 'E4', started: 20, censored: 15 }];
  const r = censoringReport(ep);
  assert.deepEqual(r.epochs.map(e => e.over), [false, true, true], '8/40 = 0.20 is not over; 7/30 = 0.233 is');
  assert.equal(r.marked, true);
  const health = censoringReport(ep.slice(0, 1).concat(ep.slice(2)), { exceptLast: true });
  assert.equal(health.marked, false, 'the last epoch is excepted');
});

test('wilcoxonExact: hand-enumerated null distributions, ties by midranks, zeros dropped or Pratt', () => {
  // n = 9, no ties. Subsets of {1..9} with sum <= 8, by sum: 0:1, 1:1, 2:1, 3:2, 4:2, 5:3, 6:4, 7:5, 8:6 → 25 of 512.
  // Negatives at ranks 1, 2, 5 → W- = 8 → p = 25/512 = 0.048828125 (E-BED: W- <= 8 of 9, p = 0.049).
  const d9 = [-0.01, -0.02, 0.03, 0.04, -0.05, 0.06, 0.07, 0.08, 0.09];
  const a = wilcoxonExact(d9);
  assert.equal(a.wMinus, 8); assert.equal(a.wPlus, 37); assert.equal(a.p, 25 / 512); assert.equal(a.ties, false);
  // Negatives at ranks 1, 3, 5 → W- = 9; sum 9 adds {9},{1,8},{2,7},{3,6},{4,5},{1,2,6},{1,3,5},{2,3,4} = 8 → 33/512.
  assert.equal(wilcoxonExact([-0.01, 0.02, -0.03, 0.04, -0.05, 0.06, 0.07, 0.08, 0.09]).p, 33 / 512);
  // Ties: d = [−1, 2, 2, 3] → |d| ranks 1, 2.5, 2.5, 4; W- = 1. The 16 sign patterns give W- in
  // {0, 1, 2.5, 2.5, 4, 3.5, 3.5, 5, 5, 6.5, 6.5, 6, 7.5, 7.5, 9, 10}; P(W- <= 1) = 2/16 = 0.125; two-sided 0.25.
  const t = wilcoxonExact([-1, 2, 2, 3]);
  assert.equal(t.ties, true); assert.equal(t.wMinus, 1); assert.equal(t.p, 0.125);
  assert.equal(wilcoxonExact([-1, 2, 2, 3], { alternative: 'two-sided' }).p, 0.25);
  // 'less' mirrors 'greater': P(W+ <= 1) for the negated sample.
  assert.equal(wilcoxonExact([1, -2, -2, -3], { alternative: 'less' }).p, 0.125);
  // Zeros. d = [0, −1, −2, 3, 4, 5, 6, 7].
  //   wilcox: drop the zero → ranks 1..7, W- = 1 + 2 = 3; subsets of {1..7} with sum <= 3: {}, {1}, {2}, {3}, {1,2} → 5/128.
  //   pratt: rank with the zero (ranks 1..8), drop its rank → negatives at 2, 3, W- = 5; subsets of {2..8} with sum <= 5:
  //   {}, {2}, {3}, {4}, {5}, {2,3} → 6/128.
  const z = [0, -1, -2, 3, 4, 5, 6, 7];
  const zw = wilcoxonExact(z), zp = wilcoxonExact(z, { zeros: 'pratt' });
  assert.deepEqual([zw.n, zw.zeros, zw.wMinus, zw.p], [7, 1, 3, 5 / 128]);
  assert.deepEqual([zp.n, zp.wMinus, zp.p], [7, 5, 6 / 128]);
  // All positive, n = 4: p = 1/16 = 0.0625 — no 4-item sample can reach 0.05.
  assert.equal(wilcoxonExact([1, 2, 3, 4]).p, 1 / 16);
  // Values equal up to floating noise tie (0.35 − 0.25 + 0.1 vs 0.2).
  assert.equal(wilcoxonExact([0.35 - 0.25 + 0.1, 0.2, -0.5]).ties, true);
  assert.throws(() => wilcoxonExact([1, NaN]), /finite numbers/);
});

test('wilcoxonCritical: the one-sided 5% critical values of the standard table', () => {
  // By hand for small n (cumulative subset counts of {1..n}): n = 5: P(W- <= 0) = 1/32, P(<= 1) = 2/32 = 0.0625 → 0;
  // n = 6: 3/64 = 0.047 at 2, 5/64 at 3 → 2; n = 7: 5/128 = 0.039 at 3, 7/128 = 0.055 at 4 → 3;
  // n = 8: 10/256 = 0.039 at 5, 14/256 = 0.055 at 6 → 5; n = 9: 25/512 at 8, 33/512 at 9 → 8.
  // n = 10..13 from the published one-tailed alpha = 0.05 table: 10, 13, 17, 21.
  assert.deepEqual([4, 5, 6, 7, 8, 9, 10, 11, 12, 13].map(n => wilcoxonCritical(n).critical), [-1, 0, 2, 3, 5, 8, 10, 13, 17, 21]);
  assert.equal(wilcoxonCritical(9).p, 25 / 512);
  assert.equal(wilcoxonCritical(8).p, 10 / 256);
});

test('holm: hand-computed step-down adjustment', () => {
  // p = [0.01, 0.04, 0.03, 0.005]; sorted 0.005, 0.01, 0.03, 0.04 times 4, 3, 2, 1 → 0.02, 0.03, 0.06, 0.04;
  // running maximum → 0.02, 0.03, 0.06, 0.06. In input order: [0.03, 0.06, 0.06, 0.02]; reject at 0.05: [T, F, F, T].
  const h = holm([0.01, 0.04, 0.03, 0.005]);
  [0.03, 0.06, 0.06, 0.02].forEach((v, i) => close(h.adjusted[i], v, 1e-15));
  assert.deepEqual(h.reject, [true, false, false, true]);
  // Named arms; capping at 1; one p-value is unchanged.
  // { a: 0.02, g: 0.6, B1-H: 0.024 }: 0.02 × 3 = 0.06; 0.024 × 2 = 0.048 → running max 0.06; 0.6 × 1 = 0.6.
  const n = holm({ a: 0.02, g: 0.6, 'B1-H': 0.024 });
  close(n.adjusted.a, 0.06, 1e-15); close(n.adjusted['B1-H'], 0.06, 1e-15); close(n.adjusted.g, 0.6, 1e-15);
  assert.deepEqual(n.reject, { a: false, g: false, 'B1-H': false });
  // [0.6, 0.7]: 0.6 × 2 = 1.2 → capped at 1; 0.7 → running max 1.
  assert.deepEqual(holm([0.6, 0.7]).adjusted, [1, 1]);
  assert.deepEqual(holm([0.049]).reject, [true]);
  assert.deepEqual(holm([0.05]).reject, [false], 'strict: p = alpha does not reject');
  assert.throws(() => holm([0.2, 1.2]), /must be in \[0, 1\]/);
});

// Nine core items whose gaps + 0.10 are the d9 sample above (negatives at ranks 1, 2, 5).
const GAPS9 = [-0.11, -0.12, -0.07, -0.06, -0.15, -0.04, -0.03, -0.02, -0.01];
const items9 = (gaps = GAPS9) => gaps.map((gap, i) => ({ item: `E${i + 1}`, gap }));

test('familyTest: E-BED §6 test (i) on {gap + delta}; exclusions; thresholds recomputed for the remaining n', () => {
  const r = familyTest(items9());
  close(r.d[0], -0.01, 1e-12);
  assert.equal(r.n, 9); assert.equal(r.test.wMinus, 8); assert.equal(r.test.p, 25 / 512); assert.equal(r.reject, true);
  assert.equal(r.critical.critical, 8);
  // E5 excluded at K1 and E9 a K1' capability outcome: 7 items remain; d = [−0.01, −0.02, 0.03, 0.04, 0.06, 0.07, 0.08]
  // → negatives at ranks 1, 2 → W- = 3 → P(W- <= 3 | n = 7) = 5/128 = 0.039 < 0.05 (critical value for n = 7 is 3).
  const ex = items9().map(it => (it.item === 'E5' ? { ...it, excluded: 'K1' } : it.item === 'E9' ? { ...it, gap: null, excluded: "K1'" } : it));
  const r7 = familyTest(ex);
  assert.deepEqual(r7.excluded.map(e => e.reason), ['K1', "K1'"]);
  assert.equal(r7.n, 7); assert.equal(r7.test.wMinus, 3); assert.equal(r7.test.p, 5 / 128); assert.equal(r7.critical.critical, 3); assert.equal(r7.reject, true);
  // Four exclusions leave 5 items: no family-level claim.
  const r5 = familyTest(items9().map((it, i) => (i < 4 ? { ...it, excluded: 'K2' } : it)));
  assert.equal(r5.claim, false); assert.match(r5.reason, /5 admitted items < 6/);
  // A zero difference (gap exactly −delta) is dropped and can push n below 6.
  const r6z = familyTest(items9().map((it, i) => (i < 3 ? { ...it, excluded: 'K1' } : i === 3 ? { ...it, gap: -0.10 } : it)));
  assert.equal(r6z.claim, false); assert.match(r6z.reason, /5 non-zero differences < 6/);
  // An arm 10 points worse everywhere: d all 0 → nothing to test.
  assert.equal(familyTest(items9(GAPS9.map(() => -0.10))).claim, false);
  assert.throws(() => familyTest([{ item: 'E1', gap: 0 }, { item: 'E1', gap: 0 }]), /repeated/);
});

test('familyDecision: Holm across the arms tested, H-E2 on >= 7 items, no extra critical item', () => {
  const rows = (gaps, { reliable = 9, extraCritical = null } = {}) => items9(gaps).map((it, i) => ({ ...it, reliable: i < reliable, critical: it.item === extraCritical ? 1 : 0, criticalRef: 0 }));
  // Arm a: p = 25/512; arm b: all nine d positive → W- = 0 → p = 1/512; arm g: d9 negatives at ranks 1, 3, 5 → 33/512.
  const arms = {
    a: rows(GAPS9),
    b: rows(GAPS9.map(g => g + 0.2)),
    g: rows([-0.11, -0.08, -0.13, -0.06, -0.15, -0.04, -0.03, -0.02, -0.01]),
  };
  // Holm over three p-values: sorted 1/512 (×3 = 0.00586), 25/512 (×2 = 0.0977), 33/512 (×1 = 0.0645 → running max 0.0977).
  const r = familyDecision(arms);
  close(r.arms.b.holmP, 3 / 512, 1e-15); close(r.arms.a.holmP, 50 / 512, 1e-15); close(r.arms.g.holmP, 50 / 512, 1e-15);
  assert.deepEqual([r.arms.a.meets, r.arms.b.meets, r.arms.g.meets], [false, true, false]);
  // Alone, arm a passes (i) (p = 0.0488); with only 6 reliable items it fails (ii); an extra critical item fails (iii).
  assert.equal(familyDecision({ a: arms.a }).arms.a.meets, true);
  const ii = familyDecision({ a: rows(GAPS9, { reliable: 6 }) }).arms.a;
  assert.deepEqual(ii.checks, { i: true, ii: false, iii: true });
  const iii = familyDecision({ a: rows(GAPS9, { extraCritical: 'E4' }) }).arms.a;
  assert.deepEqual([iii.checks.iii, iii.extraCritical], [false, ['E4']]);
  // A critical violation that (c) shares is not an extra one.
  assert.equal(familyDecision({ a: rows(GAPS9).map(x => (x.item === 'E4' ? { ...x, critical: 2, criticalRef: 1 } : x)) }).arms.a.checks.iii, true);
  // minReliable as a function of the admitted count (the proportional reading, BED-CONTRACT-v1.1 §13).
  const prop = familyDecision({ a: rows(GAPS9, { reliable: 7 }).map((x, i) => (i === 8 ? { ...x, excluded: 'K1' } : x)) }, { minReliable: n => Math.ceil((7 * n) / 9) });
  assert.equal(prop.arms.a.reliableNeeded, 7); // ceil(56/9) = 7 for 8 admitted items
});

test('nonInferiority: degenerate, closed-form normal approximation, the Deff widening, K < 2', () => {
  // Identical arms: every replicate is 0, the bound is 0 > −0.10.
  const same = [];
  for (const w of ['A', 'B']) for (let c = 0; c < 50; c++) same.push({ world: w, case: `c${c}`, x: c % 3 ? 1 : 0, y: c % 3 ? 1 : 0 });
  const s = nonInferiority(same, 0.10, { iterations: 2000 });
  assert.deepEqual([s.estimate, s.lower, s.nonInferior], [0, 0, true]);
  // Four identical worlds of 200 cases: 20 cases x=1,y=0 (+1), 10 cases x=0,y=1 (−1), 170 ties. d = 10/200 = 0.05.
  // Var(D) = E[D²] − d² = 30/200 − 0.0025 = 0.1475; SE(iid) = sqrt(0.1475 / 800) = 0.0135785; z(0.95) = 1.644854.
  //   i.i.d. lower bound ≈ 0.05 − 1.644854 · 0.0135785 = 0.05 − 0.022335 = 0.027665; the world-cluster bootstrap sees
  //   no between-world variance here, so its bound is the same ≈ 0.0277.
  //   Deff = 1 + (200 − 1) · 0.1 = 20.9, sqrt = 4.571652 → widened bound ≈ 0.05 − 0.022335 · 4.571652 = −0.052107.
  //   Non-inferior at delta = 0.10 (−0.0521 > −0.10), not at delta = 0.05 (−0.0521 <= −0.05).
  //   p: the widened replicates are ≈ N(0.05, 0.062076²); P(<= −0.10) = Φ(−2.4164) = 0.0078.
  const pairs = [];
  for (const w of ['A', 'B', 'C', 'D']) for (let c = 0; c < 200; c++) { const k = c % 20; pairs.push({ world: w, case: `c${c}`, x: k < 2 ? 1 : k === 2 ? 0 : k < 10 ? 1 : 0, y: k < 2 ? 0 : k === 2 ? 1 : k < 10 ? 1 : 0 }); }
  close(itemGap(pairs), 0.05, 1e-15);
  const r = nonInferiority(pairs, 0.10, { iterations: 10000 });
  assert.equal(r.worlds, 4); close(r.deff, 20.9, 1e-12);
  close(r.lowerCluster, 0.027665, 0.003); close(r.lowerWidened, -0.052107, 0.012); assert.equal(r.lower, r.lowerWidened);
  assert.equal(r.nonInferior, true); assert.ok(r.p > 0.002 && r.p < 0.02, `p ${r.p}`);
  assert.equal(nonInferiority(pairs, 0.05, { iterations: 10000 }).nonInferior, false);
  // rho = 0: no widening; the bound is the bootstrap's ≈ 0.0277.
  close(nonInferiority(pairs, 0.10, { iterations: 10000, rho: 0 }).lower, 0.027665, 0.003);
  // Deterministic given the seed.
  assert.deepEqual(nonInferiority(pairs, 0.10, { iterations: 500 }), nonInferiority(pairs, 0.10, { iterations: 500 }));
  // One world: bounds reported, no decision.
  const one = nonInferiority(pairs.filter(p => p.world === 'A'), 0.10, { iterations: 500 });
  assert.equal(one.nonInferior, null); assert.match(one.reason, /no decision/);
  // A clearly inferior arm (x fails 30 more cases of 100 in each world).
  const bad = [];
  for (const w of ['A', 'B']) for (let c = 0; c < 100; c++) bad.push({ world: w, case: `c${c}`, x: c < 60 ? 1 : 0, y: c < 90 ? 1 : 0 });
  assert.equal(nonInferiority(bad, 0.10, { iterations: 2000 }).nonInferior, false);
  assert.throws(() => nonInferiority([{ world: 'A', case: 1, x: 1, y: 1 }, { world: 'A', case: 1, x: 0, y: 1 }]), /repeated/);
  assert.throws(() => nonInferiority([{ world: 'A', case: 1, x: 0.5, y: 1 }]), /0\/1 or booleans/);
});

test('power: the SE by hand, the sign rule in closed form, the exact null size, and E-BED\'s 0.60 / 0.85', () => {
  // SE (m = 40, rho = 0.1, pRef = 0.8, discordance at a 10-point gap): pX = 0.85, pY = 0.75;
  // psi = 0.85·0.25 + 0.75·0.15 = 0.325; Var = 0.325 − 0.01 = 0.315; Deff = 1 + 39·0.1 = 4.9;
  // K = 2: sqrt(0.315 · 4.9 / 80) = sqrt(0.01929375) = 0.138902; K = 4: sqrt(0.009646875) = 0.098219.
  close(itemGapSE({ K: 2 }), 0.138902, 1e-6); close(itemGapSE({ K: 4 }), 0.098219, 1e-6);
  // At equality (true gap 0) each item's d = gap + 0.10 is positive with q = Φ(0.10 / SE):
  //   K = 2: Φ(0.719934) ≈ 0.76422 (table: Φ(0.72) = 0.76424, φ(0.72) = 0.3079);
  //   K = 4: Φ(1.018138) ≈ 0.84569 (Φ(1.00) = 0.841345, Φ(1.02) = 0.846136, linear in between).
  // Sign rule (>= 8 of 9 positive): 9 q^8 (1 − q) + q^9 → K = 2: 0.33577; K = 4: 0.58461.
  const signPower = q => 9 * q ** 8 * (1 - q) + q ** 9;
  const N = 100000, mc = p => 5 * Math.sqrt(p * (1 - p) / N);
  const k2 = familyPower({ K: 2, iterations: N }), k4 = familyPower({ K: 4, iterations: N });
  assert.deepEqual([k2.wilcoxonCritical, k2.signCritical], [8, 8]);
  close(k2.sign, signPower(0.76422), mc(0.336) + 0.002, 'sign K=2'); close(k4.sign, signPower(0.84569), mc(0.585) + 0.002, 'sign K=4');
  // At the null boundary (true gap = −delta) the d are symmetric about 0, so the Wilcoxon rejection rate is exactly
  // P(W- <= 8) = 25/512 = 0.04883 and the sign rate 10/512 = 0.01953 (whatever the SE).
  const h0 = familyPower({ K: 2, trueGap: -0.10, iterations: N });
  close(h0.wilcoxon, 25 / 512, mc(0.049), 'null size, Wilcoxon'); close(h0.sign, 10 / 512, mc(0.02), 'null size, sign');
  // E-BED §6: Wilcoxon power at equality 0.60 (K = 2) and 0.85 (K = 4). This simulation gives 0.609 and 0.856 (± 0.001
  // at 400k draws in an independent mulberry32 script). The E-BED figures came from a 31-bit LCG with Box-Muller whose
  // sign-rule rates miss the closed forms above (0.572 vs 0.585 at K = 4; 0.017 vs 0.0195 at the null): the published
  // 0.60 / 0.85 are about 0.005-0.01 low. Reproduced here to within 0.015, with the corrected values pinned.
  close(k2.wilcoxon, 0.609, mc(0.61) + 0.002, 'K=2 corrected'); close(k4.wilcoxon, 0.856, mc(0.86) + 0.002, 'K=4 corrected');
  close(k2.wilcoxon, 0.60, 0.015, 'E-BED K=2'); close(k4.wilcoxon, 0.85, 0.015, 'E-BED K=4');
  assert.ok(k4.wilcoxon > k2.wilcoxon && k2.wilcoxon > k2.sign, 'K = 4 has more power; Wilcoxon beats the sign rule');
  // Deterministic for a seed.
  assert.deepEqual(familyPower({ K: 2, iterations: 2000 }), familyPower({ K: 2, iterations: 2000 }));
});
