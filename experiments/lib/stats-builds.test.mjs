// Tests for experiments/lib/stats-builds.mjs (register B7; FIXES §2 action 6). $0, seeded simulations and stored grades.
//   nice -n 15 node --test --test-concurrency=1 experiments/lib/stats-builds.test.mjs
// The five B7 checks: (a) type-I with teeth (the case-pooled method rejects a true null about 25% of the time), (b) power
// and the simulated MDE, (c) Bayes coverage of the difference and, near the ceiling, of one arm's mean build rate, with the
// point estimate's bias, (d) the sequential rule's false stops (with its 3-point floor), (e) a replay on stored E8 grades
// that returns an interval and "cannot resolve at K = 3" instead of a p-value claim.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rng } from '../../beds/lib/rng.mjs';
import {
  assertSharedPool, buildDifferenceInterval, buildMde, buildPermutationTest, buildPower, buildRatePosterior, buildsFromResult,
  casePooledTest, estimateSigmaB, kForMde, minAttainableP, permutationMdeMultiplier, sequentialBuildDesign, sequentialBuildLook, simulateArms, simulateSequential,
} from './stats-builds.mjs';
import { studentTQuantile } from './stats.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const result = rel => JSON.parse(readFileSync(path.join(ROOT, rel), 'utf8'));
const mcBound = (p, reps, k = 3) => p + k * Math.sqrt((p * (1 - p)) / reps);
const logit = p => Math.log(p / (1 - p)), sig = x => 1 / (1 + Math.exp(-x));

test('exact build-level permutation: hand-checked splits, the smallest attainable p, and "cannot resolve at K = 3"', () => {
  assert.equal(minAttainableP(3, 3), 0.1);          // 2 / C(6,3)
  assert.equal(minAttainableP(4, 4), 2 / 70);
  assert.equal(minAttainableP(3, 1), 0.25);
  // A strictly above B, 3 vs 3: only the observed split and its mirror reach |diff| -> p = 2/20.
  const t = buildPermutationTest([0.9, 0.91, 0.92], [0.5, 0.51, 0.52]);
  assert.equal(t.method, 'exact'); assert.equal(t.splits, 20); assert.equal(t.p, 0.1);
  assert.equal(t.resolvable, false); assert.match(t.verdict, /cannot resolve at K = 3 vs 3/);
  // 4 vs 4 fully separated: p = 2/70 < 0.05, resolvable.
  const u = buildPermutationTest([0.9, 0.91, 0.92, 0.93], [0.5, 0.51, 0.52, 0.53]);
  assert.equal(u.p, 2 / 70); assert.equal(u.resolvable, true); assert.match(u.verdict, /^difference/);
  // Identical arms: every split is at least as extreme as 0.
  assert.equal(buildPermutationTest([0.5, 0.6], [0.5, 0.6]).p, 1);
  // Monte Carlo past exactMax is valid ((hits + 1)/(B + 1)) and close to the exact p.
  const a = [0.81, 0.86, 0.79, 0.9, 0.84], b = [0.78, 0.8, 0.83, 0.76, 0.82];
  const ex = buildPermutationTest(a, b), mc = buildPermutationTest(a, b, { exactMax: 10, iterations: 20000 });
  assert.equal(ex.method, 'exact'); assert.equal(mc.method, 'monte-carlo');
  assert.ok(Math.abs(ex.p - mc.p) < 0.02, `exact ${ex.p} vs MC ${mc.p}`);
});

test('builds from stored result.json: grading pool and paired world; spec in the pool identity; a different or missing pool is refused', () => {
  const json = result('research/composition-20261021/runs/ch-e8-1/result.json');
  const ch1 = buildsFromResult(json, { id: 'ch-e8-1' });
  assert.deepEqual([ch1.passed, ch1.completed, ch1.pool.length], [974, 1022, 10]);
  assert.equal(ch1.pool[0], `spec:${json.spec}`);
  const s12 = buildsFromResult(json, { pool: 'paired', id: 'ch-e8-1' });
  assert.deepEqual([s12.passed, s12.completed, s12.pool], [11, 14, [`spec:${json.spec}`, '1232/2/12']]);
  assert.throws(() => assertSharedPool([ch1], [s12]), /different world pools/);
  assert.throws(() => buildPermutationTest([ch1], [s12]), /different world pools/);
  // The same worlds under another spec are another pool.
  const other = buildsFromResult({ ...json, spec: 'f'.repeat(64) }, { id: 'other-spec' });
  assert.throws(() => assertSharedPool([ch1], [other]), /different world pools/);
  // An unknown pool name is refused (it used to read as 'grading'); a result without a spec hash is refused.
  assert.throws(() => buildsFromResult(json, { pool: 'gradng' }), /pool must be one of grading, paired/);
  assert.throws(() => buildsFromResult({ ...json, spec: undefined }, { id: 'nospec' }), /no spec hash/);
  // A build without a pool beside builds with one is refused (it used to switch the check off silently); bare counts on
  // both sides (simulations) pass unchecked and say so.
  assert.throws(() => assertSharedPool([ch1], [{ passed: 950, completed: 1022 }]), /1 of 2 builds carry no world pool/);
  assert.equal(assertSharedPool([{ passed: 1, completed: 2 }], [{ passed: 1, completed: 2 }]).checked, false);
});

test('(a) type-I: the build-level test holds 5% at K = 3..12; the case-pooled test rejects a true null about 25% of the time (teeth)', t => {
  const reps = 2000;
  for (const K of [3, 4, 6, 8, 12]) {
    const r = buildPower({ K, m: 43, gap: 0, reps, seed: `b7-typeI-${K}` });
    t.diagnostic(`type-I K ${K} m 43: build-level ${r.build}, case-pooled ${r.pooled} (${reps} reps)`);
    assert.ok(r.build <= mcBound(0.05, reps), `K ${K}: build-level type-I ${r.build}`);
    assert.ok(r.pooled >= 0.18 && r.pooled <= 0.32, `K ${K}: case-pooled type-I ${r.pooled} (expected about 0.25)`);
    if (K === 3) assert.equal(r.build, 0, 'K = 3 vs 3 can never reject');
  }
});

test('(b) power at sigma_b 0.08, gap 0.10: about 0.8 at K = 8 with 43 cases; about 0.84 at K = 6 with 400 cases; 0 at K = 3', t => {
  const k8 = buildPower({ K: 8, m: 43, gap: 0.10, reps: 1000, seed: 'b7-power-8' });
  t.diagnostic(`power K 8 m 43: ${k8.build}`);
  assert.ok(k8.build >= 0.70 && k8.build <= 0.88, `K 8 m 43: ${k8.build}`);
  const k6 = buildPower({ K: 6, m: 400, gap: 0.10, reps: 1000, seed: 'b7-power-6-400' });
  assert.ok(k6.build >= 0.74 && k6.build <= 0.92, `K 6 m 400: ${k6.build}`);
  const k6s = buildPower({ K: 6, m: 43, gap: 0.10, reps: 1000, seed: 'b7-power-6-43' });
  t.diagnostic(`power K 6: m 400 ${k6.build}, m 43 ${k6s.build}`);
  assert.ok(k6.build > k6s.build + 0.1, `more cases per build helps: m 400 ${k6.build} vs m 43 ${k6s.build}`);
  assert.equal(buildPower({ K: 3, m: 400, gap: 0.10, reps: 200, seed: 'b7-power-3' }).build, 0);
  // The MDE tracks the simulation. The logit shift of "gap 0.10" realises a pass-rate gap of about 0.115 (0.926 vs 0.811)
  // with unequal build SDs (about 0.054 and 0.096); with the pooled SD of build rates measured under that alternative,
  // MDE(K 8, m 43) at 80% power lands near the realised gap, which the simulation detects 0.78 of the time.
  const r = rng('b7-sd');
  let v = 0, gap = 0;
  const reps = 300;
  for (let i = 0; i < reps; i++) {
    const { a, b } = simulateArms(r, { K: 8, m: 43, gap: 0.10 });
    const sa = estimateSigmaB(a), sb = estimateSigmaB(b);
    v += (sa.sdRates ** 2 + sb.sdRates ** 2) / 2; gap += sa.mean - sb.mean;
  }
  const sd = Math.sqrt(v / reps); gap /= reps;
  const mde = buildMde({ K: 8, m: 43, sdRates: sd }).mde;
  assert.ok(gap > 0.10 && gap < 0.13, `realised gap ${gap}`);
  t.diagnostic(`MDE K 8 m 43: ${mde.toFixed(4)} vs realised gap ${gap.toFixed(4)} (pooled sd of rates ${sd.toFixed(4)})`);
  assert.ok(Math.abs(mde - gap) < 0.03, `MDE ${mde} vs realised gap ${gap} (pooled sd of rates ${sd})`);
  assert.equal(buildMde({ K: 3, m: 1022, sdRates: 0.03 }).mde, Infinity);
  // The spread is measured, never assumed (the CLI used to fall back to sigma_b 0.08).
  assert.throws(() => buildMde({ K: 6, m: 1022 }), /measured, not assumed/);
  // At small K the t approximation is optimistic, because the exact permutation p is coarse: the MDE is simulated there.
  for (const K of [4, 5, 6]) {
    const r = buildMde({ K, m: 1022, sdRates: 0.03 });
    t.diagnostic(`MDE K ${K} sd 0.03: simulated ${r.mde.toFixed(4)} vs t ${r.mdeT.toFixed(4)}`);
    assert.equal(r.method, 'simulated exact permutation'); assert.ok(r.mde >= r.mdeT * 0.99, `K ${K}: ${r.mde} vs ${r.mdeT}`);
  }
  assert.ok(buildMde({ K: 4, m: 1022, sdRates: 0.03 }).mde > 1.2 * buildMde({ K: 4, m: 1022, sdRates: 0.03 }).mdeT, 'K 4: the t form understates the MDE by more than 20%');
  // The simulated multiplier does what it says: at delta = multiplier x sd the exact test rejects about 80% of the time
  // (fresh draws, another seed).
  const mult = permutationMdeMultiplier(5), rr = rng('b7-mde-check');
  let rej = 0;
  for (let i = 0; i < 600; i++) {
    const a = Array.from({ length: 5 }, () => mult + rr.normal()), b = Array.from({ length: 5 }, () => rr.normal());
    if (buildPermutationTest(a, b, { rates: true }).p < 0.05) rej++;
  }
  t.diagnostic(`K 5: multiplier ${mult.toFixed(3)}, power on fresh draws ${(rej / 600).toFixed(3)}`);
  assert.ok(Math.abs(rej / 600 - 0.8) < 0.06, `power at the simulated MDE ${rej / 600}`);
  assert.ok(Math.abs(buildMde({ K: 8, m: 1022, sdRates: 0.03 }).mde - (studentTQuantile(0.975, 14) + studentTQuantile(0.8, 14)) * Math.sqrt(2 / 8) * 0.03) < 1e-12, 'K 8: t form');
  const need = kForMde({ gap, m: 43, sdRates: sd });
  assert.ok(need.mde <= gap && need.K >= 7 && need.K <= 11, `K for MDE ${gap}: ${need.K} (MDE ${need.mde})`);
});

test('(c) coverage of mu_A - mu_B (Welch headline and posterior) is at least 93% at K = 3..6 on simulated truth', t => {
  // Truth: the expected build pass rate on the realised case pool, E_u[mean_c sig(mu + u + d_c)] (trapezoid over u).
  const truth = (mu, sb, d) => { let tot = 0, w = 0; for (let z = -6; z <= 6; z += 0.05) { const pz = Math.exp(-z * z / 2); let m = 0; for (const c of d) m += sig(mu + sb * z + c); tot += pz * m / d.length; w += pz; } return tot / w; };
  const pRef = 0.85, sb = 0.08 / (pRef * (1 - pRef)), reps = 150;
  for (const K of [3, 4, 6]) {
    const r = rng('b7-coverage', K);
    let cover = 0, coverP = 0, w = 0, wP = 0;
    for (let i = 0; i < reps; i++) {
      const gap = i % 2 ? 0.10 : 0;
      const { a, b, cases } = simulateArms(r, { K, m: 43, gap, sigmaBLogit: sb });
      const iv = buildDifferenceInterval(a, b);
      const shift = gap ? logit(pRef + gap) - logit(pRef) : 0;
      const tr = truth(logit(pRef) + shift, sb, cases) - truth(logit(pRef), sb, cases);
      if (iv.lo <= tr && tr <= iv.hi) cover++;
      if (iv.posterior.lo <= tr && tr <= iv.posterior.hi) coverP++;
      w += iv.hi - iv.lo; wP += iv.posterior.hi - iv.posterior.lo;
    }
    t.diagnostic(`coverage K ${K} m 43: Welch ${(cover / reps).toFixed(3)} (width ${(w / reps).toFixed(3)}), posterior ${(coverP / reps).toFixed(3)} (width ${(wP / reps).toFixed(3)}) (${reps} reps, gap 0 and 0.10 alternating)`);
    assert.ok(cover / reps >= 0.93, `K ${K}: coverage ${cover / reps}`);
    assert.ok(coverP / reps >= 0.93, `K ${K}: posterior coverage ${coverP / reps}`);
  }
});

test('(c) near the ceiling (m 1,022): the sample mean is unbiased and the HPD interval covers the mean build rate at least 93% of the time', t => {
  // The regimes the 2026-10-21 review measured the beta-binomial posterior in (posterior-mean bias -0.025 to -0.045,
  // coverage 0.90 at 0.97, difference coverage 1.00). Truth: the expected build pass rate on the realised case pool.
  const truth = (mu, sb, d) => { let tot = 0, w = 0; for (let z = -6; z <= 6; z += 0.25) { const pz = Math.exp(-z * z / 2); let m = 0; for (const c of d) m += sig(mu + sb * z + c); tot += pz * m / d.length; w += pz; } return tot / w; };
  const reps = 160;
  for (const [pRef, sigmaB] of [[0.92, 0.045], [0.95, 0.03], [0.97, 0.03]]) for (const K of [3, 6]) {
    const r = rng('b7-ceiling', pRef, K), sb = sigmaB / (pRef * (1 - pRef));
    let cover = 0, coverD = 0, coverDP = 0, coverET = 0, biasS = 0, biasMed = 0, width = 0, widthD = 0, widthDP = 0;
    const dReps = reps / 2;
    for (let i = 0; i < reps; i++) {
      const { a, b, cases } = simulateArms(r, { K, m: 1022, pRef, sigmaBLogit: sb, gap: 0 });
      const tr = truth(logit(pRef), sb, cases), p = buildRatePosterior(a);
      if (p.mu.lo <= tr && tr <= p.mu.hi) cover++;
      if (p.mu.equalTailed.lo <= tr && tr <= p.mu.equalTailed.hi) coverET++;
      biasS += p.sampleMean - tr; biasMed += p.mu.median - tr; width += p.mu.hi - p.mu.lo;
      if (i < dReps) {
        const d = buildDifferenceInterval(a, b);
        if (d.lo <= 0 && 0 <= d.hi) coverD++;
        if (d.posterior.lo <= 0 && 0 <= d.posterior.hi) coverDP++;
        widthD += d.hi - d.lo; widthDP += d.posterior.hi - d.posterior.lo;
      }
    }
    t.diagnostic(`p ${pRef} sigma_b ${sigmaB} (logit ${sb.toFixed(2)}) K ${K}: one arm, HPD coverage ${(cover / reps).toFixed(3)} (equal-tailed ${(coverET / reps).toFixed(3)}), width ${(width / reps).toFixed(3)}; bias: sample mean ${(biasS / reps).toFixed(4)}, posterior median ${(biasMed / reps).toFixed(4)}; difference: Welch coverage ${(coverD / dReps).toFixed(3)} width ${(widthD / dReps).toFixed(3)}, posterior ${(coverDP / dReps).toFixed(3)} width ${(widthDP / dReps).toFixed(3)}`);
    assert.ok(cover / reps >= 0.93, `p ${pRef} K ${K}: coverage ${cover / reps}`);
    assert.ok(Math.abs(biasS / reps) < 0.01, `p ${pRef} K ${K}: sample-mean bias ${biasS / reps}`);
    assert.ok(Math.abs(biasMed / reps) < 0.03, `p ${pRef} K ${K}: posterior-median bias ${biasMed / reps}`);
    assert.ok(coverD / dReps >= 0.93, `p ${pRef} K ${K}: difference coverage ${coverD / dReps}`);
    assert.ok(widthD < widthDP, `p ${pRef} K ${K}: the Welch interval is narrower than the convolved posterior's`);
  }
});

test('posterior: centred on the build rates, wider at small K, the point estimate is the sample mean, and the prior is reported', () => {
  const tight = [{ passed: 1000, completed: 1022 }, { passed: 1005, completed: 1022 }, { passed: 995, completed: 1022 }];
  const p3 = buildRatePosterior(tight);
  assert.ok(p3.mu.lo < 0.978 && p3.mu.hi > 0.978, `interval [${p3.mu.lo}, ${p3.mu.hi}] holds the build mean`);
  assert.ok(Math.abs(p3.sampleMean - 3000 / 3066) < 1e-12);
  const p6 = buildRatePosterior([...tight, ...tight]);
  assert.ok(p6.mu.hi - p6.mu.lo < p3.mu.hi - p3.mu.lo, 'six builds narrow the interval');
  assert.match(p3.prior.sigmaBLogit, /half-normal\(1\) on the logit scale/);
  assert.throws(() => buildRatePosterior([0.9, 0.8]), /counts/);
  // The review's examples: B1L-H 1.000 / 0.953 / 0.993 read 0.912 as a posterior mean under the beta-binomial; the point
  // estimate now is the sample mean (0.982), and the posterior median sits near it, not 7 points below.
  const b1 = buildRatePosterior([1022, 974, 1015].map(passed => ({ passed, completed: 1022 })));
  assert.ok(Math.abs(b1.sampleMean - 0.982) < 0.001 && b1.mu.median > 0.94 && b1.mu.lo < b1.sampleMean && b1.mu.hi > b1.sampleMean, JSON.stringify({ median: b1.mu.median, lo: b1.mu.lo, hi: b1.mu.hi }));
});

test('(d) sequential rule (blocks of 2, K_max 12, O\'Brien-Fleming): false stops at most 5%; under a 10-point gap it beats the fixed K of equal power', t => {
  const design = sequentialBuildDesign();
  assert.deepEqual(design.kAt, [2, 4, 6, 8, 10, 12]);
  assert.ok(Math.abs(design.boundary.totalAlpha - 0.05) < 1e-4);
  const reps = 2000;
  const nul = simulateSequential({ m: 43, gap: 0, reps, seed: 'b7-seq-null' });
  // The spec: false stops at most 5%. Asserted on this seeded measurement itself (no Monte Carlo allowance above 0.05).
  assert.ok(nul.stopRate <= 0.05, `false-stop rate ${nul.stopRate}`);
  const alt = simulateSequential({ m: 43, gap: 0.10, reps: 1000, seed: 'b7-seq-alt' });
  const fixed8 = buildPower({ K: 8, m: 43, gap: 0.10, reps: 1000, seed: 'b7-seq-fixed8' }).build;
  const fixed12 = buildPower({ K: 12, m: 43, gap: 0.10, reps: 1000, seed: 'b7-seq-fixed12' }).build;
  assert.ok(alt.stopRate > fixed8 + 0.05, `sequential power ${alt.stopRate} vs fixed K 8 ${fixed8}`);
  t.diagnostic(`sequential: null stop rate ${nul.stopRate} (${reps} reps); gap 0.10 m 43: power ${alt.stopRate} at mean K ${alt.meanK} vs fixed K 8 ${fixed8}, fixed K 12 ${fixed12}`);
  assert.ok(alt.stopRate >= fixed12 - 0.05 && alt.meanK < 12, `sequential ${alt.stopRate} at mean K ${alt.meanK} vs fixed K 12 ${fixed12}`);
  // The 3-point floor (as A4): a crossing with a gap under 0.03 does not decide.
  const one = sequentialBuildDesign({ block: 4, kMax: 4 });
  const near = sequentialBuildLook([900, 901, 902, 903].map(passed => ({ passed, completed: 1000 })), [888, 889, 890, 891].map(passed => ({ passed, completed: 1000 })), one);
  assert.equal(near.crossed, true); assert.equal(near.floorMet, false); assert.equal(near.decided, false);
  assert.match(near.decision, /no resolvable difference \(crossed, but \|diff\| 0\.012 is under the 0\.03 floor\)/);
  const far = sequentialBuildLook([950, 951, 952, 953].map(passed => ({ passed, completed: 1000 })), [888, 889, 890, 891].map(passed => ({ passed, completed: 1000 })), one);
  assert.equal(far.decided, true); assert.match(far.decision, /^stop: difference/);
  // A look: equal K required, and the decision names the look.
  assert.throws(() => sequentialBuildLook([0.9, 0.8], [0.9]), /equal K/);
  const look = sequentialBuildLook([{ passed: 40, completed: 43 }, { passed: 41, completed: 43 }], [{ passed: 30, completed: 43 }, { passed: 31, completed: 43 }], design);
  assert.equal(look.look, 1); assert.equal(look.crossed, false); assert.match(look.decision, /continue/);
  assert.ok(look.interval.lo < look.interval.hi);
});

test('(e) replay on stored E8 grades: an interval and "cannot resolve at K = 3", where the case-pooled test claims p < 1e-6', () => {
  const E = 'research/enterprise-20261014/runs', C = 'research/composition-20261021/runs';
  // B1L-H lineage 1 and B1N-H lineages 2, 3 (the built workflows, 14/14 each) vs agent-H (10/14), paired world 1232 d2 s12.
  const built = ['grade-s12-b1lh-e8-1', 'grade-s12-b1nh-e8-2', 'grade-s12-b1nh-e8-3'].map(id => buildsFromResult(result(`${E}/${id}/result.json`), { pool: 'paired', id }));
  const agent = [buildsFromResult(result(`${E}/agenth-e8-s12/result.json`), { pool: 'paired', id: 'agenth-e8-s12' })];
  assert.deepEqual(built.map(b => b.passed), [14, 14, 14]); assert.equal(agent[0].passed, 10);
  const perm = buildPermutationTest(built, agent);
  assert.equal(perm.resolvable, false); assert.match(perm.verdict, /cannot resolve at K = 3 vs 1/);
  const iv = buildDifferenceInterval(built, agent);
  // No spread in either arm (14/14 three times; one agent build): Welch is degenerate, so the posterior interval is the headline.
  assert.match(iv.method, /posterior hpd/); assert.ok(Math.abs(iv.estimate - 4 / 14) < 1e-12);
  assert.ok(Number.isFinite(iv.lo) && Number.isFinite(iv.hi) && iv.lo < iv.hi && iv.lo < 0.2857 && iv.hi > 0.2857, `interval [${iv.lo}, ${iv.hi}]`);
  assert.ok(casePooledTest(built, agent).p < 0.001, 'the case-pooled test would have claimed it');
  // COMP-1 C-H builds 1-3 vs B1L-H lineages 1-3 on the 9-world pool (1,022 completed cases each).
  const ch = [1, 2, 3].map(i => buildsFromResult(result(`${C}/ch-e8-${i}/result.json`), { id: `ch-e8-${i}` }));
  const b1 = [1, 2, 3].map(i => buildsFromResult(result(`${E}/regrade-oracle2-b1lh-e8-${i}/result.json`), { id: `b1lh-e8-${i}` }));
  const t = buildPermutationTest(ch, b1);
  assert.equal(t.resolvable, false); assert.match(t.verdict, /cannot resolve at K = 3 vs 3/);
  const d = buildDifferenceInterval(ch, b1);
  assert.equal(d.method, 'welch'); assert.ok(Math.abs(d.estimate - (2815 / 3066 - 3011 / 3066)) < 1e-12, `estimate ${d.estimate}`);
  assert.ok(d.lo < 0 && d.hi > 0, `C-H - B1L-H interval [${d.lo}, ${d.hi}] spans 0`);
  assert.ok(d.posterior.lo < 0 && d.posterior.hi > 0, `posterior [${d.posterior.lo}, ${d.posterior.hi}] spans 0`);
  // An arm whose builds are all perfect (the COMP-1 monolith rows: B1L-H l1, B1N-H l2, l3, 1,022/1,022 each) piles the
  // logit-normal posterior up at 1: the posterior difference is flagged as overconfident; Welch and the permutation test
  // still read "cannot resolve".
  const mono = [buildsFromResult(result(`${E}/regrade-oracle2-b1lh-e8-1/result.json`), { id: 'b1lh-e8-1' }), ...[2, 3].map(i => buildsFromResult(result(`${E}/regrade-oracle2-b1nh-e8-${i}/result.json`), { id: `b1nh-e8-${i}` }))];
  const dm = buildDifferenceInterval(ch, mono);
  assert.equal(dm.method, 'welch'); assert.ok(dm.lo < 0 && dm.hi > 0, `Welch [${dm.lo}, ${dm.hi}]`);
  assert.match(dm.posterior.note, /^arm B: every build of this arm is perfect/); assert.match(dm.armB.note, /overconfident/);
  assert.match(buildPermutationTest(ch, mono).verdict, /cannot resolve at K = 3 vs 3/);
  assert.ok(casePooledTest(ch, b1).p < 1e-6, 'the case-pooled test would have claimed a difference');
});
