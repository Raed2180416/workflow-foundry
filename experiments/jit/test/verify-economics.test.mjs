// verify-economics.mjs (ATTACK-20261014 §3 M2; PROOF-LEDGER K2) at $0: the pure functions (CSP-1, Wilson, break-even,
// comparator proxy, the shadow draw) against hand values, then the analysis over the committed streams under
// research/jit-20261008/runs/ (jit-dev-records-1, jit-dev-kinetics-1, jit-r0-records): the ATTACK's P6 arithmetic is
// reproduced, the proxy never calls real agreement a disagreement, and the section rule's verdicts.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  shadowDrawOf, wilsonHi, csp1, csp1Afi, aoql, steadyState, breakEvenRate, numericProxy, proxyCompare, tally, projectedBound,
  witnessFlags, analyze, attackArithmetic, slider, FLOOR, RECORDS_MISMATCH_CAP,
} from '../verify-economics.mjs';

const close = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''}: ${a} vs ${b}`);

test('Wilson upper bound: 0/6 is 0.39 (the ATTACK kill-mode figure); no data is 1', () => {
  close(wilsonHi(0, 6), 0.390, 0.001, '0/6');
  assert.equal(wilsonHi(0, 0), 1);
  assert.ok(wilsonHi(1, 5) > wilsonHi(0, 5));
});

test('CSP-1: AOQL i = 20, f = 0.1 is 5.23% at p ≈ 9.75%; i = 60, f = 0.25 is 0.99% (ATTACK §3 M2 [M])', () => {
  const a = aoql({ i: 20, f: 0.1 });
  close(a.aoql, 0.0523, 0.0001, 'AOQL 20/0.1'); close(a.pAt, 0.0975, 0.002, 'worst p');
  close(aoql({ i: 60, f: 0.25 }).aoql, 0.0099, 0.0001, 'AOQL 60/0.25');
  // AFI: f with nothing flagged, 1 when everything is flagged; a perfect inspector at p gives AOQ = p (1 − AFI).
  assert.equal(csp1Afi(0, 20, 0.1), 0.1); assert.equal(csp1Afi(1, 20, 0.1), 1);
  const r = csp1({ p: 0.05, i: 20, f: 0.1 });
  close(r.aoq, 0.05 * (1 - r.afi), 1e-12, 'perfect AOQ');
  // False alarms push AFI up (more inspection, lower AOQ); an inspector that never detects has no AOQL.
  assert.ok(csp1({ p: 0.05, i: 20, f: 0.1, phi: 0.5 }).afi > r.afi);
  assert.equal(aoql({ i: 20, f: 0.1, delta: 0 }).unbounded, true);
  assert.ok(aoql({ i: 20, f: 0.1, delta: 0.5 }).aoql > a.aoql, 'a half-blind inspector lets more through');
});

test('steady state and break-even rate are consistent; edge cases', () => {
  const p = { base: 0.05, q: 0.9, shadowUsd: 0.3, adjUsd: 0.3, pD: 0.5, adjudicate: true };
  const r = breakEvenRate({ ...p, target: 0.1 });
  close(steadyState({ ...p, rate: r }), 0.1, 1e-12, 'steady(r*) = target');
  close(r, 0.05 / (0.9 * 0.45), 1e-12, 'r* formula');
  assert.equal(breakEvenRate({ ...p, shadowUsd: 0, adjudicate: false, target: 0.1 }), Infinity);
  assert.equal(breakEvenRate({ ...p, shadowUsd: 0, adjudicate: false, target: 0.01 }), -Infinity);
  assert.ok(breakEvenRate({ ...p, base: 0.2, target: 0.1 }) < 0, 'base above the agent: never');
  assert.equal(steadyState({ ...p, rate: 0 }), 0.05);
});

test('numericProxy: certain agree, certain disagree, ambiguous over sign and rounding corners', () => {
  assert.equal(numericProxy(0, 0), 'agree');
  assert.equal(numericProxy(0.01, 0.01), 'agree');
  assert.equal(numericProxy(0.3122, 0.0), 'disagree');
  assert.equal(numericProxy(0.03, 0.02), 'agree', '1.03 vs 0.98 is within 5% of 1.03');
  assert.equal(numericProxy(0.04, 0.03), 'ambiguous');
  assert.equal(numericProxy(NaN, 0), 'ambiguous');
});

test('proxyCompare: records details as sets; kinetics excluded-sample set decides first', () => {
  const m = (id, f) => ({ entity_id: id, field: f, expected: 1, got: 2 });
  const base = { entities: 3, pairF1: 1, mismatches: [m(1, 'country'), m(2, 'birth_date')] };
  assert.equal(proxyCompare('records', base, { ...base, mismatches: [m(2, 'birth_date'), m(1, 'country')] }), 'agree', 'order of mismatches is not an answer difference');
  assert.equal(proxyCompare('records', base, { ...base, pairF1: 0.9 }), 'disagree');
  const capped = k => ({ ...base, mismatches: Array.from({ length: RECORDS_MISMATCH_CAP }, (_, i) => m(i + k, 'amount_usd')) });
  assert.equal(proxyCompare('records', capped(0), capped(1)), 'ambiguous', 'two capped lists may hide equal answers');
  assert.equal(proxyCompare('records', null, base), 'unknown');
  const kin = (missing, e) => ({ perCondition: [{ id: 'C1', vmaxRelErr: e, kmRelErr: e }], unknownConditions: [], duplicateConditions: [], excluded: { exact: !missing.length, missing, extra: [] } });
  assert.equal(proxyCompare('kinetics', kin([], 0.01), kin(['X-1'], 0.01)), 'disagree');
  assert.equal(proxyCompare('kinetics', kin([], 0.01), kin([], 0.01)), 'agree');
  assert.equal(proxyCompare('kinetics', kin([], 0.04), kin([], 0.03)), 'ambiguous');
  assert.equal(witnessFlags(kin(['X-1'], 0)), true);
  assert.equal(witnessFlags(kin([], 0)), false);
});

test('tally: detection, false alarms and the planning quantities', () => {
  const c = tally([
    { wrong: true, verdict: 'disagree' }, { wrong: true, verdict: 'agree' }, { wrong: false, verdict: 'disagree' },
    { wrong: false, verdict: 'agree' }, { wrong: false, verdict: 'ambiguous' }, { wrong: null, verdict: 'disagree' }, { wrong: false, verdict: 'unknown' },
  ]);
  assert.deepEqual([c.n, c.known, c.disagree, c.ambiguous, c.wrong, c.right, c.detectedWrong, c.falseAlarm, c.missedWrong], [7, 6, 3, 1, 2, 3, 1, 1, 1]);
  close(c.pD, 3 / 6, 1e-12); close(c.pDhi, 4 / 6, 1e-12); close(c.delta, 0.5, 1e-12); close(c.phi, 1 / 3, 1e-12);
  const b = projectedBound({ d: 0, q: 1, rate: 0.25, N: 24 });
  close(b.hi, wilsonHi(0, 6), 1e-12, 'n = 6 shadows');
});

// ------------------------------------------------------------------------------------------------ committed streams
let res;
const get = async () => (res ??= await analyze());
const arm = (r, exp, short) => r.econ.find(e => e.experiment === exp && e.short === short);

test('shadowDrawOf reproduces the draws R0 logged (stream.mjs semantics, seed jit-r0-records)', async () => {
  const r = await get(), e = arm(r, 'jit-r0-records', 'H→H');
  assert.deepEqual(e.systemView.realized.idx, [3, 5, 6, 8, 11]);
  close(shadowDrawOf('jit-r0-records', 3), 0.074638, 5e-7); close(shadowDrawOf('jit-r0-records', 9), 0.955313, 5e-7);
});

test('reproduces the ATTACK P6 arithmetic from the committed records stream (S→H and O→H)', async () => {
  const r = await get(), S = attackArithmetic(arm(r, 'jit-dev-records-1', 'S→H'), 0.1025), O = attackArithmetic(arm(r, 'jit-dev-records-1', 'O→H'), 0.1025);
  close(S.compiledPerOk, 0.0468, 0.0001, 'S compiled'); close(S.shadow, 0.297, 0.0005, 'S shadow'); close(S.shadowPlusAdj, 0.453, 0.002, 'S shadow+adj');
  close(S.steady, 0.129, 0.001, 'S steady'); close(S.beShadow, 0.187, 0.001, 'S be'); close(S.beAdj, 0.123, 0.001, 'S be adj');
  close(S.horizonShadow, 186, 1, 'S horizon'); close(S.horizonAdj, 464, 8, 'S horizon adj (rounding of 0.453)');
  close(O.steady, 0.150, 0.001, 'O steady'); close(O.beShadow, 0.155, 0.001, 'O be'); close(O.beAdj, 0.120, 0.001, 'O be adj');
  close(O.horizonShadow, 68, 1, 'O horizon'); close(O.horizonAdj, 145, 3, 'O horizon adj (the ATTACK rounded its inputs)');
});

test('agent comparators and arm inputs come from the committed rows', async () => {
  const r = await get();
  const H = exp => r.econ.find(e => e.experiment === exp).agents.find(a => a.short === 'H');
  close(H('jit-dev-records-1').usdPerTask, 0.1027, 0.0001); close(H('jit-dev-kinetics-1').usdPerTask, 0.0876, 0.0001); close(H('jit-r0-records').usdPerTask, 0.1039, 0.0001);
  const S = arm(r, 'jit-dev-records-1', 'S→H');
  assert.deepEqual([S.n, S.compiledOk, S.asRun.shadows, S.asRun.adjudications], [21, 19, 4, 2]);
  close(S.base.L0, 0.889 / 21, 0.0005); close(S.base.L1, (0.889 + 0.757) / 21, 0.0005);
  const R0 = arm(r, 'jit-r0-records', 'H→H');
  assert.equal(R0.asRun.flagged, 9, 'every compiled run in R0 raised flags: shadowed at 100%, not at the 25% floor');
});

test('the comparator proxy never reports a real agreement as a disagreement on the archived answer pairs', async () => {
  const r = await get();
  for (const v of r.validation) assert.equal(v.matrix.disagree.agree, 0, `${v.experiment}: ${JSON.stringify(v.matrix)}`);
  const rec = r.validation.find(v => v.experiment === 'jit-dev-records-1');
  assert.ok(rec.pairs >= 200 && rec.matrix.agree.disagree <= 5, 'records: identical details are almost always the same answer');
  const w = r.witness[0];
  assert.deepEqual([w.flagged, w.wrong], [24, 28], 'kinetics: 4 wrong answers carry the right exclusion set');
});

test('the section rule: kinetics withdrawn at L1; records: the engine as built fails for S→H and O→H at the floor', async () => {
  const r = await get(), d = (fam, level) => r.decision.find(x => x.family === fam && x.level === level);
  const k1 = d('kinetics', 'L1');
  assert.match(k1.verdictAllArms, /^WITHDRAWN/);
  assert.equal(k1.ceilingBeats, false, 'even a $0 witness with the reference set does not pay for the deopt fallbacks');
  const r1 = d('records', 'L1');
  for (const a of r1.arms.filter(x => !x.negativeControl)) assert.equal(a.engine.beats, false, `${a.arm}: interp tier + adjudication at the floor`);
  assert.match(d('records', 'L2').verdictAllArms, /^WITHDRAWN/);
  for (const x of r.decision) assert.equal(x.stream24BeatsPerSuccess, false, `${x.family} ${x.level}: a 24-task stream never beats the Haiku agent per success`);
});

test('slider: infeasible below the measured detectable-wrong rate, and at N = 24 for tight bounds', async () => {
  const r = await get(), S = arm(r, 'jit-dev-records-1', 'S→H');
  assert.equal(slider(S, { bound: 0.05, N: 24 }).feasible, false);
  const big = slider(S, { bound: 0.2, N: 1000 });
  assert.equal(big.feasible, true); assert.ok(big.rate >= FLOOR && big.bound <= 0.2);
  assert.equal(slider(arm(r, 'jit-dev-kinetics-1', 'S→H'), { bound: 0.4, N: 10000 }).feasible, false);
});
