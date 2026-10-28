// Tests for certify.mjs (ATTACK.md §6 Move 0). Every block has teeth: a deliberately broken variant of the rule (a naive
// threshold, a Wilson bound where the exact one is required, a point estimate instead of a bound, a one-run heal verdict,
// a headline without its manifest) is run through the same check and must fail it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { rng } from '../../beds/lib/rng.mjs';
import {
  clopperPearson, wilsonInterval, zeroFailureUpper, npMinN, npUmbrellaRank, npUmbrella, hypergeometricUpper,
  hypergeomPmf, elusionCertificate, elusionAuditPlan, selectionNullP, hoeffdingBentkusP, fwerControl, learnThenTest,
  sequentialLook, sprtOperatingPoint, effectiveN, signTest, certifyHeal, verifierValidity, checkManifest, headlineRow,
  headlineTable, EffortMissingError, buildPermutationTest, minAttainableP, casePooledTest, binomPmf, normalUpper,
  kishEffectiveN, manifestFromLaunch,
} from './certify.mjs';

const close = (a, b, eps, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} ${a} != ${b} ± ${eps}`);
const rel = (a, b, r, msg = '') => assert.ok(Math.abs(a - b) <= r * Math.abs(b), `${msg} ${a} != ${b} (rel ${r})`);

// ------------------------------------------------------------------------------------------------ proportions
test('Clopper–Pearson: CP(0/59) ≤ 0.05 < CP(0/58) one-sided; the Wilson bound would certify at 58 (teeth)', () => {
  const u59 = clopperPearson(0, 59, { sides: 1 }).hi, u58 = clopperPearson(0, 58, { sides: 1 }).hi;
  assert.ok(u59 <= 0.05 && u58 > 0.05, `${u59} ${u58}`);
  close(u59, 0.0495076, 1e-6); close(u59, zeroFailureUpper(59), 1e-12);
  // known two-sided values (R binom.test(7, 10)$conf.int: 0.3475471 0.9332605)
  const c = clopperPearson(7, 10);
  close(c.lo, 0.3475471, 1e-6); close(c.hi, 0.9332605, 1e-6);
  // teeth: the one-sided Wilson bound is below 0.05 already at n = 58 (and at 55): it would certify too early
  assert.ok(wilsonInterval(0, 58, { sides: 1 }).hi < 0.05);
  assert.ok(wilsonInterval(0, 55, { sides: 1 }).hi < 0.05);
});

test('Clopper–Pearson covers ≥ 95% at every p on an exhaustive grid; Wilson does not (teeth)', () => {
  const n = 20;
  const coverage = (bound, p) => { let s = 0; for (let x = 0; x <= n; x++) { const b = bound(x); if (b.lo <= p && p <= b.hi) s += binomPmf(x, n, p); } return s; };
  let cpMin = 1, wMin = 1;
  for (let i = 1; i < 200; i++) {
    const p = i / 200;
    cpMin = Math.min(cpMin, coverage(x => clopperPearson(x, n), p));
    wMin = Math.min(wMin, coverage(x => wilsonInterval(x, n), p));
  }
  assert.ok(cpMin >= 0.95 - 1e-9, `CP min coverage ${cpMin}`);
  assert.ok(wMin < 0.95, `Wilson min coverage ${wMin} should dip below 0.95`);
});

// ------------------------------------------------------------------------------------------------ NP umbrella
test('NP umbrella: n_min = ceil(ln δ / ln(1 − α)) and the order-statistic rank', () => {
  // (alpha, delta) → n_min, as tabulated in the need-router sweep: 22, 45, 29, 59, 149, 299
  for (const [a, d, want] of [[0.1, 0.1, 22], [0.05, 0.1, 45], [0.1, 0.05, 29], [0.05, 0.05, 59], [0.02, 0.05, 149], [0.01, 0.05, 299]]) {
    assert.equal(npMinN(a, d), want, `alpha ${a} delta ${d}`);
    assert.equal(npUmbrellaRank(want, a, d), want, 'at n_min the rank is the maximum');
    assert.equal(npUmbrellaRank(want - 1, a, d), null, 'below n_min the claim is refused');
  }
  const r = npUmbrella(Array.from({ length: 40 }, (_, i) => i), { alpha: 0.05, delta: 0.05 });
  assert.equal(r.refused, true);
  assert.match(r.reason, /n_min = 59/);
});

test('NP umbrella keeps P(false-trigger rate > α) ≤ δ; the naive empirical quantile violates about half the time (teeth)', () => {
  const alpha = 0.05, delta = 0.05, n = 300, reps = 2000, r = rng('certify', 'np-umbrella');
  let umb = 0, naive = 0;
  for (let i = 0; i < reps; i++) {
    const s = Array.from({ length: n }, () => r.normal()).sort((a, b) => a - b);
    const u = npUmbrella(s, { alpha, delta });
    if (normalUpper(u.theta) > alpha) umb++;
    const thetaNaive = s[Math.ceil((1 - alpha) * n) - 1];   // the (1 − α) empirical quantile
    if (normalUpper(thetaNaive) > alpha) naive++;
  }
  assert.ok(umb / reps <= 0.08, `umbrella violation ${umb / reps}`);
  assert.ok(naive / reps >= 0.35, `naive violation ${naive / reps} (expected about half)`);
});

// ------------------------------------------------------------------------------------------------ elusion
test('hypergeometric elusion bound: exact coverage on an exhaustive grid; a point estimate fails it (teeth)', () => {
  const N = 30, n = 10, level = 0.95;
  const ub = Array.from({ length: n + 1 }, (_, x) => hypergeometricUpper({ N, n, x, level }));
  let minCov = 1, pointMin = 1;
  for (let M = 0; M <= N; M++) {
    let cov = 0, pcov = 0;
    for (let x = 0; x <= n; x++) {
      const pr = hypergeomPmf(x, N, M, n);
      if (ub[x] >= M) cov += pr;
      if (Math.round((N * x) / n) >= M) pcov += pr;
    }
    minCov = Math.min(minCov, cov); pointMin = Math.min(pointMin, pcov);
  }
  assert.ok(minCov >= level - 1e-9, `coverage ${minCov}`);
  assert.ok(pointMin < 0.8, `point estimate coverage ${pointMin}`);
  // the extraction sweep's X2 sizing: an excluded pool of about 84 units, 40 sampled, zero hits → at most 4 missed
  assert.equal(hypergeometricUpper({ N: 84, n: 40, x: 0 }), 4);
  // binomial (with replacement) is conservative against the exact finite-pool bound
  for (let x = 0; x <= 5; x++) {
    const h = elusionCertificate({ found: 50, excluded: 84, sampled: 40, hits: x });
    const b = elusionCertificate({ found: 50, excluded: 84, sampled: 40, hits: x, method: 'binomial' });
    assert.ok(b.missUpper >= h.missUpper, `x ${x}: binomial ${b.missUpper} < exact ${h.missUpper}`);
  }
});

test('elusion audit plan and the random-selection null', () => {
  const plan = elusionAuditPlan({ found: 76, excluded: 87, missed: 6, sampled: 40 });
  assert.ok(plan.pZeroHits > 0 && plan.pZeroHits < 0.1);
  assert.ok(plan.expectedRecallLower < plan.trueRecall);
  // a census (sampled = excluded) certifies exactly
  const census = elusionCertificate({ found: 10, excluded: 20, sampled: 20, hits: 2 });
  assert.equal(census.missUpper, 2);
  // selecting all gold units of 82 in a pick of 129 out of 163 is far from random; picking half at random is not
  assert.ok(selectionNullP({ N: 163, G: 82, k: 129, hits: 79 }) < 1e-6);
  assert.ok(selectionNullP({ N: 163, G: 82, k: 80, hits: 40 }) > 0.3);
});

// ------------------------------------------------------------------------------------------------ Learn-then-Test
test('Hoeffding–Bentkus p-values match MAPIE 1.6.0\'s formula (exact rational recomputation)', () => {
  // [rHat, n, alpha, binary, p] from scratchpad m0-hb-reference.py: the formula of mapie/risk_control/methods.py
  // compute_hoeffding_bentkus_p_value with the binomial CDF in exact rational arithmetic (MAPIE itself not executed).
  for (const [r, n, a, b, want] of [
    [0.5, 1100, 0.6, false, 3.421829126330086e-11], [0.8, 1200, 0.7, false, 1.0], [0.0, 20, 0.1, false, 0.12157665459056914],
    [0.0, 20, 0.1, true, 0.12157665459056914], [0.05, 100, 0.1, false, 0.15651020427695309], [0.05, 100, 0.1, true, 0.05757688648703379],
    [0.07, 100, 0.1, true, 0.32087388836283937], [0.1, 50, 0.2, false, 0.13055151768688114], [0.02, 300, 0.05, true, 0.006579374400801552],
    [0.3, 30, 0.2, false, 1.0], [0.15, 60, 0.2, true, 0.21321478045680362],
  ]) rel(hoeffdingBentkusP(r, n, a, { binary: b }), want, 1e-9, `HB(${r}, ${n}, ${a}, ${b})`);
});

test('FWER procedures follow MAPIE 1.6.0 (Bonferroni, Holm step-down, fixed sequence)', () => {
  const p = [0.001, 0.04, 0.012, 0.3, 0.02];
  assert.deepEqual(fwerControl(p, 0.05, 'bonferroni'), [0]);                 // threshold 0.01
  assert.deepEqual(fwerControl(p, 0.05, 'bonferroni_holm'), [0, 2]);         // 0.001 ≤ .01, 0.012 ≤ .0125, then 0.02 > .0167 stops
  assert.deepEqual(fwerControl([0.001, 0.012, 0.016, 0.3], 0.05, 'bonferroni_holm'), [0, 1, 2]);
  assert.deepEqual(fwerControl(p, 0.05, 'fixed_sequence'), [0, 1, 2]);       // stops at 0.3
  assert.deepEqual(fwerControl([0.06, 0.001], 0.05, 'fixed_sequence'), []);  // the first failure ends the sequence
  assert.throws(() => fwerControl([], 0.05), /non-empty/);
});

test('Learn-then-Test certifies risk ≤ α w.p. ≥ 1 − δ; the naive "empirical risk ≤ α" threshold does not (teeth)', () => {
  const alpha = 0.1, delta = 0.1, n = 200, reps = 1000, lambdas = Array.from({ length: 19 }, (_, i) => 0.02 + 0.01 * i);
  const r = rng('certify', 'ltt');
  let lttViol = 0, naiveViol = 0;
  for (let rep = 0; rep < reps; rep++) {
    const u = Array.from({ length: n }, () => r.next());
    const risks = lambdas.map(l => u.filter(x => x < l).length / n);         // true risk(λ) = λ, increasing in λ
    const { valid } = learnThenTest({ risks, n, alpha, delta, binary: true, method: 'fixed_sequence' });
    if (valid.length && lambdas[Math.max(...valid)] > alpha + 1e-12) lttViol++;
    const naive = lambdas.filter((l, i) => risks[i] <= alpha);
    if (naive.length && Math.max(...naive) > alpha + 1e-12) naiveViol++;
  }
  assert.ok(lttViol / reps <= delta, `LTT violation ${lttViol / reps}`);
  assert.ok(naiveViol / reps >= 0.3, `naive violation ${naiveViol / reps}`);
  // a decreasing risk is tested from the end (MAPIE reverses it); non-monotone risks carry a warning
  const dec = learnThenTest({ risks: [0.3, 0.2, 0.01], n: 500, alpha: 0.1, delta: 0.1, binary: true, method: 'fixed_sequence' });
  assert.deepEqual(dec.valid, [2]);
  assert.ok(learnThenTest({ risks: [0.01, 0.3, 0.02], n: 500, alpha: 0.1, delta: 0.1, method: 'fixed_sequence' }).warning);
});

// ------------------------------------------------------------------------------------------------ sequential, SPRT, builds
test('O\'Brien–Fleming looks via the shared sequential core', () => {
  const first = sequentialLook({ looks: 5, look: 1, p: 0.001 }), last = sequentialLook({ looks: 5, look: 5, p: 0.04 });
  assert.equal(first.crosses, false); assert.ok(first.nominal < 1e-4);
  assert.equal(last.crosses, true); close(last.nominal, 0.0413, 5e-4);
  // teeth: Pocock spends alpha evenly, so the same early p crosses there
  assert.equal(sequentialLook({ looks: 5, look: 1, p: 0.01, boundary: 'pocock' }).crosses, true);
  assert.equal(sequentialLook({ looks: 5, look: 1, p: 0.01 }).crosses, false);
});

test('exact SPRT operating characteristics: error rates near the design; the heal-sized ASN', () => {
  const h0 = sprtOperatingPoint({ p0: 0.005, p1: 1 / 36, p: 0.005 }), h1 = sprtOperatingPoint({ p0: 0.005, p1: 1 / 36, p: 1 / 36 });
  assert.ok(h0.decideH1 <= 0.05 && h1.decideH0 <= 0.06, `${h0.decideH1} ${h1.decideH0}`);
  assert.ok(h0.expectedN > 150 && h0.expectedN < 250, `ASN under the fix ${h0.expectedN}`);
  assert.ok(h0.undecided < 1e-9);
});

test('build-level exact permutation: K = 3 vs 3 cannot resolve; the case-pooled test claims a difference (teeth)', () => {
  const a = [{ passed: 1000, completed: 1022 }, { passed: 960, completed: 1022 }, { passed: 1010, completed: 1022 }];
  const b = [{ passed: 940, completed: 1022 }, { passed: 980, completed: 1022 }, { passed: 900, completed: 1022 }];
  const t = buildPermutationTest(a, b);
  close(minAttainableP(3, 3), 0.1, 1e-12);
  assert.equal(t.resolvable, false); assert.match(t.verdict, /cannot resolve/);
  assert.ok(casePooledTest(a, b).p < 1e-6);
});

// ------------------------------------------------------------------------------------------------ effective n, sign test
test('effective n: Kish design effect with the ICC floor; the M1 sizing (ICC 0.79, m = 12)', () => {
  close(kishEffectiveN(Array(5).fill(12), 0.79), 60 / (1 + 11 * 0.79), 1e-12);
  const allClean = effectiveN([{ n: 960, wrong: 0 }, { n: 950, wrong: 0 }, { n: 1015, wrong: 0 }]);
  assert.equal(allClean.rhoHat, null); assert.equal(allClean.rhoUsed, 0.1);
  assert.ok(allClean.nEff < 40, `n_eff ${allClean.nEff}`);
  const st = signTest(7, 1), s8 = signTest(8, 0);
  close(st.pTwoSided, 0.0703125, 1e-12); close(s8.pTwoSided, 0.0078125, 1e-12); close(st.pOneSided, 0.03515625, 1e-12);
});

// ------------------------------------------------------------------------------------------------ heal
const oneRunVerdict = e => (e.failing ? (e.failing.fixed === e.failing.n ? 'accept' : 'reject') : e.cand.failures === 0 ? 'accept' : 'reject');

test('heal: stochastic control at ceiling is non-evidential; a one-run verdict would accept it (teeth)', () => {
  const p1 = { mode: 'stochastic', base: { runs: 8, failures: 0 }, cand: { runs: 8, failures: 0 } };
  const c = certifyHeal(p1);
  assert.equal(c.verdict, 'inconclusive'); assert.equal(c.label, 'non-evidential');
  assert.equal(oneRunVerdict(p1), 'accept');
  // a confirmed base and a candidate that still reproduces is rejected; a clean long candidate is accepted
  assert.equal(certifyHeal({ mode: 'stochastic', base: { runs: 10, failures: 6 }, cand: { runs: 10, failures: 6 } }).verdict, 'reject');
  assert.equal(certifyHeal({ mode: 'stochastic', base: { runs: 10, failures: 8 }, cand: { runs: 20, failures: 0 } }).verdict, 'accept');
  const short = certifyHeal({ mode: 'stochastic', base: { runs: 10, failures: 8 }, cand: { runs: 3, failures: 0 } });
  assert.equal(short.verdict, 'inconclusive'); assert.ok(short.zeroFailureRunsNeeded > 3);
});

test('heal: deterministic mode needs determinism, exact replays, no regression and fresh discrimination', () => {
  const base = { mode: 'deterministic', determinism: { replays: 11, identical: 11 }, failing: { n: 3, fixed: 3 }, regressions: { n: 8, broken: 0 }, mutants: { n: 16, violations: 0 } };
  const disc = [{ stratum: 'defect', failing: true, base: { n: 2, pass: 0 }, cand: { n: 2, pass: 2 } }, { stratum: 'other', failing: false, base: { n: 2, pass: 2 }, cand: { n: 2, pass: 2 } }];
  const nodisc = [{ stratum: 'defect', failing: true, base: { n: 1, pass: 1 }, cand: { n: 1, pass: 1 } }, { stratum: 'other', failing: false, base: { n: 3, pass: 3 }, cand: { n: 3, pass: 3 } }];
  assert.equal(certifyHeal({ ...base, fresh: disc }).verdict, 'accept');
  const nd = { ...base, fresh: nodisc };
  assert.equal(certifyHeal(nd).verdict, 'inconclusive');
  assert.equal(oneRunVerdict(nd), 'accept', 'teeth: the V3 one-run rule accepts without fresh discrimination');
  assert.equal(certifyHeal({ ...base, mutants: { n: 16, violations: 3 }, fresh: disc }).label, 'mutant-violation');
  assert.equal(certifyHeal({ ...base, determinism: { replays: 2, identical: 2 }, fresh: disc }).label, 'not-deterministic');
  assert.equal(certifyHeal({ ...base, failing: { n: 4, fixed: 0 }, fresh: disc }).verdict, 'reject');
  const partial = certifyHeal({ ...base, fresh: [{ stratum: 'defect', failing: true, base: { n: 136, pass: 0 }, cand: { n: 136, pass: 18 } }] });
  assert.equal(partial.label, 'partial-fix');
});

test('heal: mechanism injection certifies the class only; an injection that does not bite is not evidence', () => {
  const m = certifyHeal({ mode: 'mechanism', faults: 88, parentWrong: 88, candRight: 88, clusters: Array.from({ length: 35 }, (_, i) => ({ n: i < 18 ? 3 : 2 })) });
  assert.equal(m.verdict, 'accept'); assert.ok(m.nEff < 88 && m.correctionLower > 0.9);
  assert.equal(certifyHeal({ mode: 'mechanism', faults: 88, parentWrong: 10, candRight: 88 }).label, 'injection-did-not-bite');
});

test('verifier validity: verdict pass 4/4 with oracle 0/4 is an invalid evaluator', () => {
  const v = verifierValidity({ verdictPass: 4, oraclePass: 0, n: 4 });
  assert.equal(v.invalid, true); close(v.falseAcceptLower, Math.pow(0.05, 1 / 4), 1e-9);
  assert.equal(verifierValidity({ verdictPass: 8, oraclePass: 8, n: 8 }).invalid, false);
});

// ------------------------------------------------------------------------------------------------ reporting
const manifest = (effort, extra = {}) => ({ runId: 'r1', nodes: [
  { name: 'ledger-1', kind: 'model', model: 'mercury-3', effort, temperature: null, cap: 24576 },
  { name: 'act', kind: 'session', model: 'claude-haiku-5-5', effort, temperature: null, cap: 39 },
  { name: 'check-0', kind: 'code' }], ...extra });

test('reporting: a paid run with effort unset is an error; legacy runs are marked non-conforming', () => {
  assert.throws(() => checkManifest(manifest(null)), EffortMissingError);
  assert.throws(() => checkManifest(manifest(undefined)), /ledger-1, act/);
  const ok = checkManifest(manifest('high'));
  assert.equal(ok.conforming, true); assert.deepEqual(ok.unrecordedTemperature, ['ledger-1', 'act']);
  const legacy = checkManifest(manifest(null), { legacy: 'historical run: CLI default effort (medium)' });
  assert.equal(legacy.conforming, false); assert.deepEqual(legacy.missingEffort, ['ledger-1', 'act']);
  // a scripted run (no paid model node) needs no effort
  assert.equal(checkManifest({ runId: 's', paid: false, nodes: [{ name: 'act', kind: 'session', model: 'scripted', effort: null }] }).paid, false);
});

test('reporting: every headline carries the reachable-subset column, n_eff and the nodes; omissions throw (teeth)', () => {
  const row = headlineRow({ label: 'arm', passes: 29, n: 60, reachable: { passes: 29, n: 53, source: 'ceiling audit' }, conservative: { passes: 29, n: 49 },
    manifest: manifest('high'), costUsd: 0.93 });
  close(row.reachable.p, 29 / 53, 1e-12); assert.ok(row.reachable.lo < row.reachable.p && row.reachable.hi > row.reachable.p);
  const md = headlineTable([row]);
  assert.match(md, /Reachable subset \(ceiling column\)/); assert.match(md, /29\/53/); assert.match(md, /act:claude-haiku-5-5@high/);
  assert.throws(() => headlineRow({ label: 'x', passes: 1, n: 2, manifest: manifest('high') }), /reachable-subset column is required/);
  assert.throws(() => headlineRow({ label: 'x', passes: 1, n: 2, reachable: { passes: 1, n: 2 } }), /launch manifest is required/);
  assert.throws(() => headlineRow({ label: 'x', passes: 1, n: 2, reachable: { passes: 1, n: 2 }, manifest: manifest(null) }), EffortMissingError);
  const legacy = headlineRow({ label: 'x', passes: 1, n: 2, reachable: { passes: 1, n: 2 }, manifest: manifest(null), legacy: 'pre-D28 run' });
  assert.match(headlineTable([legacy]), /NON-CONFORMING: effort unset on ledger-1, act \(legacy: pre-D28 run\)/);
});

test('reporting: manifestFromLaunch reads every node of a launch record; an unset effort in a live run throws (teeth)', () => {
  // the shape of a runner summary with a code-owned harness (two model families, effort never recorded)
  const launch = { runId: 'arm-x', model: 'claude-haiku-5-5', scripted: false, effort: null, budgetUsdPerSession: 0.75, capUsd: 4,
    harness: { nodeModels: { ledger: 'mercury-3', act: 'claude-haiku-5-5' } } };
  const m = manifestFromLaunch(launch);
  assert.equal(m.runId, 'arm-x'); assert.equal(m.paid, true);
  assert.deepEqual(m.nodes.map(n => `${n.name}:${n.model}:${n.effort}:${n.cap}`), ['ledger:mercury-3:null:0.75', 'act:claude-haiku-5-5:null:0.75']);
  assert.throws(() => checkManifest(m), EffortMissingError);
  // teeth: an adapter that fills in the CLI default would pass the same record
  const naive = { ...m, nodes: m.nodes.map(n => ({ ...n, effort: n.effort ?? 'medium' })) };
  assert.equal(checkManifest(naive).conforming, true);
  // per-node efforts win over the run's; a session record gives one node; a scripted run is unpaid
  const ok = manifestFromLaunch({ ...launch, effort: 'high', harness: { nodeModels: launch.harness.nodeModels, nodeEfforts: { ledger: 'low' } } });
  assert.deepEqual(ok.nodes.map(n => n.effort), ['low', 'high']); assert.equal(checkManifest(ok).conforming, true);
  const sess = manifestFromLaunch({ label: 'fh', session: { model: 'claude-haiku-5-5', effort: 'high', capUsd: 0.5 } });
  assert.deepEqual(sess.nodes, [{ name: 'session', kind: 'session', model: 'claude-haiku-5-5', effort: 'high', temperature: null, cap: 0.5 }]);
  assert.equal(checkManifest(manifestFromLaunch({ model: 'scripted', scripted: true, effort: null })).paid, false);
  assert.throws(() => manifestFromLaunch(null), /launch record is required/);
});
