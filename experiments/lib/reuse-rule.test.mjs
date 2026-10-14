// M3 (ATTACK-20261014 §3; PROOF-LEDGER K1): the reuse acceptance rules in stats.mjs and their simulated operating
// characteristics under parent clustering. $0, seeded, deterministic.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  wilson, binomCdf, binomPmf, betaInc, exactBinomialBounds, kishDeff, kishEffectiveN, iccAnova, clusterDeff, clustersOf,
  reuseBoundRule, sprtDesign, reuseSprt, samplingPlanDesign, reuseSamplingPlan, RHO_REUSE_FLOOR,
} from './stats.mjs';
import { rng } from '../../beds/lib/rng.mjs';
import { drawClusters, simulate, exactIndependent, criterion, reuseRuleV1, SCENARIOS } from './reuse-rule-sim.mjs';

const close = (a, b, eps = 1e-4) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const clean = n => Array.from({ length: n }, () => ({ n: 1, wrong: 0 }));
const parents = (J, m, wrongAt = () => 0) => Array.from({ length: J }, (_, j) => ({ n: m, wrong: wrongAt(j) }));

test('the ATTACK §3 M3 numbers reproduce', () => {
  close(wilson(0, 60).hi, 0.0602);                         // today: 0/60 fails the two-sided bound
  assert.ok(wilson(0, 73).hi <= 0.05 && wilson(0, 72).hi > 0.05); // 73 clean decisions pass it
  close(wilson(1, 110).hi, 0.0497, 1e-3); assert.ok(wilson(1, 109).hi > 0.05); // PROOF-LEDGER K1: 110 with 1 wrong
  close(wilson(0, 60, 1.645).hi, 0.0432);                  // (a) one-sided Wilson: 0/60 → 0.043
  const d = sprtDesign();
  close(d.wrongStep, 1.609, 1e-3); close(d.cleanStep, -0.0412, 1e-4); close(d.killAt, 2.944, 1e-3); close(d.serveAt, -2.944, 1e-3);
  assert.equal(reuseSprt(clean(72)).decision, 'serve'); assert.equal(reuseSprt(clean(72)).n, 72);
  assert.equal(reuseSprt(clean(71)).decision, 'no-decision');
  const plan = samplingPlanDesign();
  assert.equal(plan.n, 181); assert.equal(plan.c, 4);
  close(plan.falseKill, 0.0363); close(plan.miss, 0.0492);
});

test('binomial, incomplete beta and Clopper–Pearson bounds are exact', () => {
  close(binomCdf(4, 181, 0.01) + (1 - binomCdf(4, 181, 0.01)), 1, 1e-12);
  close(binomPmf(0, 10, 0), 1, 1e-15); close(binomPmf(3, 10, 0), 0, 1e-15);
  close(betaInc(0.3, 2, 5), 0.579825, 1e-6); close(betaInc(0.5, 0.5, 0.5), 0.5, 1e-9);
  close(exactBinomialBounds(0, 60).hi, 1 - Math.pow(0.05, 1 / 60), 1e-9); // 0.0487: a perfect gate passes at 60
  assert.ok(exactBinomialBounds(0, 59).hi <= 0.05 && exactBinomialBounds(0, 58).hi > 0.05);
  for (const [x, n] of [[1, 60], [4, 181], [12, 576]]) {
    const b = exactBinomialBounds(x, n);
    close(binomCdf(x, n, b.hi), 0.05, 1e-9);               // upper: P(X ≤ x | hi) = α
    close(1 - binomCdf(x - 1, n, b.lo), 0.05, 1e-9);       // lower: P(X ≥ x | lo) = α
  }
  assert.ok(exactBinomialBounds(4, 181).hi <= 0.05 && exactBinomialBounds(5, 181).hi > 0.05); // = plan (c) at n 181
});

test('Kish design effect, effective n and the ANOVA ICC', () => {
  close(kishDeff([6, 6, 6], 0.1), 1.5, 1e-12); close(kishEffectiveN(Array(96).fill(6), 0.1), 384, 1e-9);
  close(kishDeff([1, 11], 0.1), 1 + (122 / 12 - 1) * 0.1, 1e-12); // unequal sizes: m* = Σm²/Σm
  close(kishDeff(Array(60).fill(1), 0.5), 1, 1e-12);               // singletons cannot cluster
  close(iccAnova([{ n: 2, wrong: 2 }, { n: 2, wrong: 0 }, { n: 2, wrong: 1 }]), 0.5, 1e-12); // hand-computed
  assert.equal(iccAnova([{ n: 3, wrong: 3 }, { n: 3, wrong: 0 }]), 1);
  assert.equal(iccAnova(parents(10, 6)), null);                      // no variation: not estimable
  assert.equal(iccAnova(clean(60)), null);                            // all singletons: not estimable
  const s = clusterDeff(parents(10, 6));                              // floor applies when ρ̂ is null
  assert.equal(s.rhoUsed, RHO_REUSE_FLOOR); close(s.deff, 1.5, 1e-12); close(s.nEff, 40, 1e-9);
  const t = clusterDeff([{ n: 6, wrong: 6 }, ...parents(9, 6)]);     // a burst in one parent raises ρ̂ above the floor
  assert.ok(t.rhoHat > RHO_REUSE_FLOOR && t.deff > 1.5);
});

test('clustersOf groups admitted decisions by parent and refuses anything else', () => {
  const c = clustersOf([{ parent: 't1', wrong: false }, { parent: 't2', label: 'wrong' }, { parent: 't1', label: 'correct' }, { parent: 't1', wrong: true }]);
  assert.deepEqual(c, [{ parent: 't1', n: 3, wrong: 1 }, { parent: 't2', n: 1, wrong: 1 }]);
  assert.throws(() => clustersOf([{ parent: 't1', label: 'missed' }]), /admitted decisions only/);
  assert.throws(() => clustersOf([{ wrong: false }]), /without parent/);
});

test('rules on hand-built data: a perfect gate passes at L4 scale; small clustered n gives no decision', () => {
  for (const method of ['wilson', 'exact']) {
    assert.equal(reuseBoundRule(parents(96, 6), { method }).decision, 'serve');
    assert.equal(reuseBoundRule(parents(10, 6), { method }).decision, 'no-decision');  // n_eff 40 < 59
    assert.equal(reuseBoundRule(clean(60), { method }).decision, 'serve');             // 60 independent: passes
    assert.equal(reuseBoundRule(parents(96, 6, j => (j < 20 ? 3 : 0)), { method }).decision, 'kill'); // 60/576, bursty
  }
  assert.equal(reuseRuleV1(clean(60)).decision, 'kill');       // the current rule fails a perfect gate at 60
  assert.equal(reuseRuleV1(clean(73)).decision, 'serve');
  assert.equal(reuseSprt([{ n: 1, wrong: 1 }, { n: 1, wrong: 1 }, ...clean(10)]).decision, 'kill'); // early kill folded in
  assert.equal(reuseSprt(parents(10, 6)).decision, 'no-decision');                    // 60 clean at Deff 1.5 is not enough
  const indep = (n, x) => Array.from({ length: n }, (_, i) => ({ n: 1, wrong: i < x ? 1 : 0 }));
  assert.equal(reuseSamplingPlan(indep(200, 4)).decision, 'serve'); assert.equal(reuseSamplingPlan(indep(200, 4)).n, 181);
  assert.equal(reuseSamplingPlan(indep(200, 5)).decision, 'kill');
  assert.equal(reuseSamplingPlan(parents(30, 6)).decision, 'no-decision');            // n_eff 120 < 181
});

test('the beta-binomial generator has mean p and the intended within-parent correlation', () => {
  const r = rng('m3-test-gen'), m = 6, p = 0.05, rho = 0.2, sizes = Array(96).fill(m);
  let X = 0, N = 0, s2 = 0, k = 0;
  for (let i = 0; i < 1500; i++) for (const c of drawClusters(r, { p, rho, sizes })) { X += c.wrong; N += c.n; s2 += (c.wrong - m * p) ** 2; k++; }
  close(X / N, p, 0.002);
  const varRatio = s2 / k / (m * p * (1 - p) * (1 + (m - 1) * rho)); // beta-binomial variance of a parent's count
  assert.ok(Math.abs(varRatio - 1) < 0.08, `variance ratio ${varRatio}`);
  assert.deepEqual(drawClusters(rng('z'), { p: 0, rho: 0.2, sizes: [6, 6] }), [{ n: 6, wrong: 0 }, { n: 6, wrong: 0 }]);
});

test('the simulator agrees with the exact operating characteristic under independence (n = 576)', () => {
  const reps = 3000, sizes = SCENARIOS['L4-indep'].sizes;
  for (const p of [0.01, 0.05]) {
    const sim = simulate({ p, rho: 0, sizes, reps, seed: 'm3-test-exact', rules: ['v1', 'a', 'aE', 'b', 'c'] });
    for (const rule of ['v1', 'a', 'aE', 'b', 'c']) {
      const ex = exactIndependent(rule, 576, p).serve, se = Math.sqrt(Math.max(ex * (1 - ex), 1e-4) / reps);
      assert.ok(Math.abs(sim[rule].serve - ex) < 4 * se + 0.002, `${rule} p ${p}: sim ${sim[rule].serve} exact ${ex}`);
    }
  }
});

test('exact OC at n = 576 independent: (a)-Wilson misses by 0.06 points, (a)-exact, (b) and (c) meet the criterion', () => {
  const oc = rule => ({ falseKill: 1 - exactIndependent(rule, 576, 0.01).serve, miss: exactIndependent(rule, 576, 0.05).serve });
  const a = oc('a'), aE = oc('aE'), b = oc('b'), c = oc('c');
  close(a.miss, 0.0506, 1e-4); assert.ok(a.miss > 0.05);
  assert.ok(aE.falseKill <= 0.05 && aE.miss <= 0.05); close(aE.miss, 0.0319, 1e-4);
  assert.ok(b.falseKill <= 0.05 && b.miss <= 0.05); close(b.falseKill, 0.0291, 1e-4); close(b.miss, 0.0499, 1e-4);
  close(c.falseKill, 0.0363, 1e-4); close(c.miss, 0.0492, 1e-4);
  assert.equal(exactIndependent('aE', 60, 0).serve, 1);        // a perfect gate passes at 60 independent decisions
  assert.equal(exactIndependent('v1', 60, 0).serve, 0);        // and fails the current rule there
});

test('M3 criterion at L4 scale under parent clustering (96 parents × 6): the chosen rule (a)-exact meets it at rho ≤ 0.1', () => {
  const sizes = SCENARIOS['L4-parent'].sizes, reps = 2500, rules = ['aE', 'b', 'v1'];
  const run = rho => { const by = {}; for (const p of [0, 0.01, 0.05]) { const r = simulate({ p, rho, sizes, reps, seed: 'm3-test-l4', rules }); for (const k of rules) (by[k] ??= {})[p] = r[k]; } return by; };
  for (const rho of [0, 0.1]) {
    const by = run(rho), c = criterion(by.aE);
    assert.equal(by.aE[0].serve, 1, 'a perfect gate is served');
    assert.ok(c.pass, `aE at rho ${rho}: false kill ${c.falseKill}, miss ${c.miss}`);
  }
  // rho 0.2: the SPRT's miss and false kill degrade more than (a)-exact's (full grid: aE 2.1% / 4.6%, b 5.3% / 7.1%).
  const by = run(0.2), aE = criterion(by.aE), b = criterion(by.b);
  assert.ok(b.miss > aE.miss && b.falseKill > aE.falseKill, `rho 0.2: aE ${JSON.stringify(aE)} b ${JSON.stringify(b)}`);
});

test('small n: no rule can meet the criterion at 60 clustered decisions; the rule then gives no decision, not a serve', () => {
  const sizes = SCENARIOS['small-parent'].sizes;
  const res = simulate({ p: 0, rho: 0.1, sizes, reps: 500, seed: 'm3-test-small', rules: ['a', 'aE', 'b', 'c'] });
  for (const k of ['a', 'aE', 'b', 'c']) { assert.equal(res[k].serve, 0); assert.equal(res[k].kill, 0); }
});
