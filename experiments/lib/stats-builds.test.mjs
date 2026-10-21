// Tests for experiments/lib/stats-builds.mjs (register B7; FIXES §2 action 6). $0, seeded simulations and stored grades.
//   nice -n 15 node --test --test-concurrency=1 experiments/lib/stats-builds.test.mjs
// The five B7 checks: (a) type-I with teeth (the case-pooled method rejects a true null about 25% of the time), (b) power,
// (c) Bayes coverage, (d) the sequential rule's false stops, (e) a replay on stored E8 grades that returns an interval and
// "cannot resolve at K = 3" instead of a p-value claim.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rng } from '../../beds/lib/rng.mjs';
import {
  assertSharedPool, betaBinomialPosterior, buildDifferenceInterval, buildMde, buildPermutationTest, buildPower, buildsFromResult,
  casePooledTest, estimateSigmaB, kForMde, minAttainableP, sequentialBuildDesign, sequentialBuildLook, simulateArms, simulateSequential,
} from './stats-builds.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const result = rel => JSON.parse(readFileSync(path.join(ROOT, rel), 'utf8'));
const mcBound = (p, reps, k = 3) => p + k * Math.sqrt((p * (1 - p)) / reps);

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

test('builds from stored result.json: grading pool and paired world; a different pool is refused', () => {
  const ch1 = buildsFromResult(result('research/composition-20261021/runs/ch-e8-1/result.json'), { id: 'ch-e8-1' });
  assert.deepEqual([ch1.passed, ch1.completed, ch1.pool.length], [974, 1022, 9]);
  const s12 = buildsFromResult(result('research/composition-20261021/runs/ch-e8-1/result.json'), { pool: 'paired', id: 'ch-e8-1' });
  assert.deepEqual([s12.passed, s12.completed, s12.pool], [11, 14, ['1232/2/12']]);
  assert.throws(() => assertSharedPool([ch1], [s12]), /different world pools/);
  assert.throws(() => buildPermutationTest([ch1], [s12]), /different world pools/);
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
  const need = kForMde({ gap, m: 43, sdRates: sd });
  assert.ok(need.mde <= gap && need.K >= 7 && need.K <= 11, `K for MDE ${gap}: ${need.K} (MDE ${need.mde})`);
});

test('(c) Bayes coverage of mu_A - mu_B is at least 93% at K = 3..6 on simulated truth', t => {
  const logit = p => Math.log(p / (1 - p)), sig = x => 1 / (1 + Math.exp(-x));
  // Truth: the expected build pass rate on the realised case pool, E_u[mean_c sig(mu + u + d_c)] (trapezoid over u).
  const truth = (mu, sb, d) => { let tot = 0, w = 0; for (let z = -6; z <= 6; z += 0.05) { const pz = Math.exp(-z * z / 2); let m = 0; for (const c of d) m += sig(mu + sb * z + c); tot += pz * m / d.length; w += pz; } return tot / w; };
  const pRef = 0.85, sb = 0.08 / (pRef * (1 - pRef)), reps = 150;
  for (const K of [3, 4, 6]) {
    const r = rng('b7-coverage', K);
    let cover = 0;
    for (let i = 0; i < reps; i++) {
      const gap = i % 2 ? 0.10 : 0;
      const { a, b, cases } = simulateArms(r, { K, m: 43, gap, sigmaBLogit: sb });
      const iv = buildDifferenceInterval(a, b);
      const shift = gap ? logit(pRef + gap) - logit(pRef) : 0;
      const tr = truth(logit(pRef) + shift, sb, cases) - truth(logit(pRef), sb, cases);
      if (iv.lo <= tr && tr <= iv.hi) cover++;
    }
    t.diagnostic(`coverage K ${K} m 43: ${(cover / reps).toFixed(3)} (${reps} reps, gap 0 and 0.10 alternating)`);
    assert.ok(cover / reps >= 0.93, `K ${K}: coverage ${cover / reps}`);
  }
});

test('posterior: centred on the build rates, wider at small K, and the prior is reported', () => {
  const tight = [{ passed: 1000, completed: 1022 }, { passed: 1005, completed: 1022 }, { passed: 995, completed: 1022 }];
  const p3 = betaBinomialPosterior(tight);
  assert.ok(p3.mu.lo < 0.978 && p3.mu.hi > 0.978, `interval [${p3.mu.lo}, ${p3.mu.hi}] holds the build mean`);
  const p6 = betaBinomialPosterior([...tight, ...tight]);
  assert.ok(p6.mu.hi - p6.mu.lo < p3.mu.hi - p3.mu.lo, 'six builds narrow the interval');
  assert.match(p3.prior.sigmaB, /half-normal/);
  assert.throws(() => betaBinomialPosterior([0.9, 0.8]), /counts/);
});

test('(d) sequential rule (blocks of 2, K_max 12, O\'Brien-Fleming): false stops at most 5%; under a 10-point gap it beats the fixed K of equal power', t => {
  const design = sequentialBuildDesign();
  assert.deepEqual(design.kAt, [2, 4, 6, 8, 10, 12]);
  assert.ok(Math.abs(design.boundary.totalAlpha - 0.05) < 1e-4);
  const reps = 2000;
  const nul = simulateSequential({ m: 43, gap: 0, reps, seed: 'b7-seq-null' });
  // The full 10,000-run measurement (CLI `sequential --reps 10000`) gave 0.0476; here 2,000 runs with a 3-SE allowance.
  assert.ok(nul.stopRate <= mcBound(0.05, reps), `false-stop rate ${nul.stopRate}`);
  const alt = simulateSequential({ m: 43, gap: 0.10, reps: 1000, seed: 'b7-seq-alt' });
  const fixed8 = buildPower({ K: 8, m: 43, gap: 0.10, reps: 1000, seed: 'b7-seq-fixed8' }).build;
  const fixed12 = buildPower({ K: 12, m: 43, gap: 0.10, reps: 1000, seed: 'b7-seq-fixed12' }).build;
  assert.ok(alt.stopRate > fixed8 + 0.05, `sequential power ${alt.stopRate} vs fixed K 8 ${fixed8}`);
  t.diagnostic(`sequential: null stop rate ${nul.stopRate} (${reps} reps); gap 0.10 m 43: power ${alt.stopRate} at mean K ${alt.meanK} vs fixed K 8 ${fixed8}, fixed K 12 ${fixed12}`);
  assert.ok(alt.stopRate >= fixed12 - 0.05 && alt.meanK < 12, `sequential ${alt.stopRate} at mean K ${alt.meanK} vs fixed K 12 ${fixed12}`);
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
  assert.ok(Number.isFinite(iv.lo) && Number.isFinite(iv.hi) && iv.lo < iv.hi && iv.lo < 0.2857 && iv.hi > 0.2857, `interval [${iv.lo}, ${iv.hi}]`);
  assert.ok(casePooledTest(built, agent).p < 0.001, 'the case-pooled test would have claimed it');
  // COMP-1 C-H builds 1-3 vs B1L-H lineages 1-3 on the 9-world pool (1,022 completed cases each).
  const ch = [1, 2, 3].map(i => buildsFromResult(result(`${C}/ch-e8-${i}/result.json`), { id: `ch-e8-${i}` }));
  const b1 = [1, 2, 3].map(i => buildsFromResult(result(`${E}/regrade-oracle2-b1lh-e8-${i}/result.json`), { id: `b1lh-e8-${i}` }));
  const t = buildPermutationTest(ch, b1);
  assert.equal(t.resolvable, false); assert.match(t.verdict, /cannot resolve at K = 3 vs 3/);
  const d = buildDifferenceInterval(ch, b1);
  assert.ok(d.lo < 0 && d.hi > 0, `C-H - B1L-H interval [${d.lo}, ${d.hi}] spans 0`);
  assert.ok(casePooledTest(ch, b1).p < 1e-6, 'the case-pooled test would have claimed a difference');
});
