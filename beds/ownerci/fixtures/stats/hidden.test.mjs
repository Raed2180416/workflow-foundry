// ownerci hidden regression tests for experiments/lib/stats.mjs. Authored for the bed from the
// ORIGINAL module's behaviour at the frozen commit; never shown to solvers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { passAtK, passHatK, wilson, summarizeArm, byArmTask, pairedBootstrap, mcnemar } from './experiments/lib/stats.mjs';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const C = (n, k) => { let r = 1; for (let i = 1; i <= k; i++) r = r * (n - k + i) / i; return r; };
const rec = (arm, task, family, pass, costUsd = 0.1, extra = {}) => ({ arm, task, family, pass, costUsd, ...extra });

test('hidden stats: pass@k matches the combinatorial closed form', () => {
  close(passAtK(5, 2, 2), 1 - C(3, 2) / C(5, 2));
  close(passAtK(6, 2, 3), 1 - C(4, 3) / C(6, 3));
  close(passAtK(5, 1, 4), 1 - C(4, 4) / C(5, 4));
  close(passAtK(10, 3, 5), 1 - C(7, 5) / C(10, 5));
  assert.equal(passAtK(4, 2, 3), 1);
  assert.equal(passAtK(3, 0, 1), 0);
  close(passAtK(8, 8, 8), 1);
  close(passAtK(9, 1, 1), 1 / 9);
});

test('hidden stats: pass^k matches the combinatorial closed form', () => {
  close(passHatK(5, 2, 2), C(2, 2) / C(5, 2));
  close(passHatK(6, 4, 3), C(4, 3) / C(6, 3));
  close(passHatK(10, 6, 4), C(6, 4) / C(10, 4));
  assert.equal(passHatK(2, 1, 2), 0);
  assert.equal(passHatK(5, 0, 1), 0);
  close(passHatK(7, 7, 7), 1);
  close(passHatK(4, 4, 1), 1);
});

test('hidden stats: Wilson interval values, bounds and z', () => {
  const ref = (s, n, z) => {
    const p = s / n, d = 1 + z * z / n, c = (p + z * z / (2 * n)) / d, h = (z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d;
    return { p, lo: Math.max(0, c - h), hi: Math.min(1, c + h) };
  };
  for (const [s, n] of [[5, 10], [3, 20], [17, 18], [1, 1]]) {
    const w = wilson(s, n), r = ref(s, n, 1.96);
    close(w.p, r.p); close(w.lo, r.lo); close(w.hi, r.hi);
  }
  const z1 = wilson(5, 10, 1), r1 = ref(5, 10, 1);
  close(z1.lo, r1.lo); close(z1.hi, r1.hi);
  const all = wilson(10, 10);
  assert.ok(all.hi <= 1 && all.lo > 0.6);
  const none = wilson(0, 10);
  assert.equal(none.lo, 0); assert.equal(none.p, 0);
  const empty = wilson(0, 0);
  assert.ok(Number.isNaN(empty.p) && Number.isNaN(empty.lo) && Number.isNaN(empty.hi));
});

test('hidden stats: byArmTask groups by arm then task and falls back to taskKey', () => {
  const g = byArmTask([rec('A', 't1', 'f', true), { arm: 'A', taskKey: 't2', family: 'g', pass: false }, rec('A', 't1', 'f2', false), rec('B', 't1', 'f', true)]);
  assert.deepEqual([...g.keys()], ['A', 'B']);
  assert.deepEqual([...g.get('A').keys()], ['t1', 't2']);
  assert.equal(g.get('A').get('t1').family, 'f');
  assert.equal(g.get('A').get('t1').trials.length, 2);
  assert.equal(g.get('A').get('t2').task, 't2');
  assert.equal(g.get('A').get('t2').trials[0].task, 't2');
  assert.equal(g.get('B').get('t1').trials.length, 1);
});

test('hidden stats: summarizeArm counts, costs and pass^k over tasks with enough trials', () => {
  const records = [
    rec('A', 'x', 'f', true, 0.1, { imputedUsd: 1 }), rec('A', 'x', 'f', true, 0.1), rec('A', 'x', 'f', false, 0.1),
    rec('A', 'y', 'f', false, 0.2), rec('A', 'y', 'f', true, 0.2),
    rec('A', 'z', 'f', true, 0.3)];
  const tasks = byArmTask(records).get('A');
  const s = summarizeArm(tasks, { k: 2 });
  assert.equal(s.tasks, 3); assert.equal(s.trials, 6); assert.equal(s.successes, 4);
  close(s.successRate, 4 / 6); close(s.costUsd, 1.0); close(s.cps, 1.0 / 4); close(s.costPerTrial, 1.0 / 6);
  close(s.passHat2, (C(2, 2) / C(3, 2) + 0) / 2);
  close(s.passAt2, (1 + 1) / 2);
  assert.equal(s.passHat3, undefined);
  close(summarizeArm(tasks, { k: 2, includeImputed: true }).costUsd, 2.0);
  close(summarizeArm(tasks, { k: 2, extraCostUsd: 3 }).cps, 4.0 / 4);
  const d = summarizeArm(tasks);
  close(d.passHat3, C(2, 3) / C(3, 3)); close(d.passAt3, 1);
  close(d.ci.p, 4 / 6);
  const none = summarizeArm(byArmTask([rec('A', 'q', 'f', false, 0.5), rec('A', 'q', 'f', false, 0.5)]).get('A'));
  assert.equal(none.cps, Infinity); assert.ok(Number.isNaN(none.passHat3)); assert.ok(Number.isNaN(none.passAt3));
  close(none.costPerTrial, 0.5);
  const zero = summarizeArm(new Map());
  assert.equal(zero.trials, 0); assert.ok(Number.isNaN(zero.successRate)); assert.ok(Number.isNaN(zero.costPerTrial));
});

test('hidden stats: pairedBootstrap validates arms and uses only shared tasks', () => {
  const recs = [rec('A', 't1', 'f', true), rec('B', 't1', 'f', false), rec('A', 'only-a', 'f', true)];
  assert.throws(() => pairedBootstrap(recs, 'A', 'C'), e => e.message === 'missing arm C');
  assert.throws(() => pairedBootstrap(recs, 'X', 'B'), e => e.message === 'missing arm X');
  const r = pairedBootstrap(recs, 'A', 'B', { iterations: 50 });
  assert.equal(r.tasks, 1); assert.equal(r.families, 1); assert.equal(r.iterations, 50);
  assert.equal(r.armA, 'A'); assert.equal(r.armB, 'B');
  assert.deepEqual(r.successDiff, { point: 1, lo: 1, hi: 1 });
  assert.ok(Number.isNaN(r.cpsRatio.point));
  assert.equal(r.cpsRatio.finiteResamples, 0);
});

test('hidden stats: pairedBootstrap point estimates, quantiles and seeding', () => {
  const recs = [];
  for (let t = 0; t < 10; t++) for (let k = 0; k < 2; k++) {
    const family = t < 5 ? 'f1' : 'f2';
    recs.push(rec('A', `t${t}`, family, t % 3 !== 0, 0.02, { imputedUsd: 0.01 }));
    recs.push(rec('B', `t${t}`, family, t % 2 === 0, 0.04));
  }
  const a = pairedBootstrap(recs, 'A', 'B', { iterations: 400, seed: 's1' });
  close(a.successDiff.point, 12 / 20 - 10 / 20);
  close(a.cpsRatio.point, (0.4 / 12) / (0.8 / 10));
  // exact values of the original implementation for this seed (one resample has no B success)
  assert.equal(a.cpsRatio.finiteResamples, 399);
  close(a.successDiff.lo, -0.4); close(a.successDiff.hi, 0.5);
  close(a.cpsRatio.lo, 1 / 7); close(a.cpsRatio.hi, 1);
  assert.ok(a.successDiff.lo <= a.successDiff.point && a.successDiff.point <= a.successDiff.hi);
  assert.ok(a.successDiff.lo < a.successDiff.hi);
  assert.ok(a.cpsRatio.lo <= a.cpsRatio.point && a.cpsRatio.point <= a.cpsRatio.hi);
  assert.deepEqual(pairedBootstrap(recs, 'A', 'B', { iterations: 400, seed: 's1' }), a);
  assert.notDeepEqual(pairedBootstrap(recs, 'A', 'B', { iterations: 400, seed: 's2' }).successDiff, a.successDiff);
  const imputed = pairedBootstrap(recs, 'A', 'B', { iterations: 10, includeImputed: true });
  close(imputed.cpsRatio.point, (0.6 / 12) / (0.8 / 10));
  assert.equal(pairedBootstrap(recs, 'A', 'B', { iterations: 3 }).iterations, 3);
  assert.equal(pairedBootstrap(recs, 'A', 'B').iterations, 10000);
});

test('hidden stats: mcnemar counts discordant majority outcomes and gives the exact two-sided p', () => {
  const recs = [];
  const add = (task, a, b) => { for (const [arm, passes] of [['A', a], ['B', b]]) for (const p of passes) recs.push(rec(arm, task, 'f', p)); };
  add('t1', [true, true], [false, false]);
  add('t2', [true, false], [false, false]);
  add('t3', [true, true, false], [true, false, false]);
  add('t4', [false, false], [true, true]);
  add('t5', [true], [true]);
  const m = mcnemar(recs, 'A', 'B');
  assert.equal(m.aOnly, 3); assert.equal(m.bOnly, 1);
  close(m.p, 2 * (C(4, 0) + C(4, 1)) / 16);
  const flipped = mcnemar(recs, 'B', 'A');
  assert.equal(flipped.aOnly, 1); assert.equal(flipped.bOnly, 3); close(flipped.p, m.p);
  const none = mcnemar([rec('A', 't', 'f', true), rec('B', 't', 'f', true)], 'A', 'B');
  assert.deepEqual(none, { aOnly: 0, bOnly: 0, p: 1 });
  const lopsided = [];
  for (let t = 0; t < 6; t++) { lopsided.push(rec('A', `t${t}`, 'f', true)); lopsided.push(rec('B', `t${t}`, 'f', false)); }
  lopsided.push(rec('A', 'extra', 'f', true));
  const l = mcnemar(lopsided, 'A', 'B');
  assert.equal(l.aOnly, 6); assert.equal(l.bOnly, 0); close(l.p, 2 / 64);
});

// ---- added by the 2026-10-07 audit (AUDIT.md F7)
test('hidden stats: missing costs count as zero and pass^k takes (trials, successes) in that order', () => {
  const trials = (task, n, c) => Array.from({ length: n }, (_, i) => ({ arm: 'A', task, family: 'f', trial: i, pass: i < c }));
  const s = summarizeArm(byArmTask([...trials('t1', 4, 2), ...trials('t2', 5, 3), ...trials('t3', 6, 1)]).get('A'), { k: 3 });
  assert.equal(s.costUsd, 0); assert.equal(s.cps, 0); assert.equal(s.costPerTrial, 0);
  assert.ok(Math.abs(s.passHat3 - (0 + 0.1 + 0) / 3) < 1e-12, String(s.passHat3));
  assert.ok(Math.abs(s.passAt3 - (1 + 1 + 0.5) / 3) < 1e-12, String(s.passAt3));
});

test('hidden stats: pairedBootstrap with the default seed and few iterations gives the reference quantiles', () => {
  const recs = [];
  const add = (arm, task, family, passes, cost) => passes.forEach((p, i) => recs.push({ arm, task, family, trial: i, pass: p, costUsd: cost }));
  for (const [t, f, a, b] of [['t1', 'f1', [1, 1, 0], [0, 0, 0]], ['t2', 'f1', [1, 0, 0], [1, 1, 0]], ['t3', 'f2', [1, 1, 1], [1, 0, 0]],
    ['t4', 'f2', [0, 0, 1], [0, 1, 1]], ['t5', 'f3', [1, 0, 1], [0, 0, 1]], ['t6', 'f3', [1, 1, 0], [1, 0, 0]], ['t7', 'f4', [0, 1, 1], [0, 0, 1]]]) {
    add('A', t, f, a.map(Boolean), 0.22); add('B', t, f, b.map(Boolean), 0.1);
  }
  const r = pairedBootstrap(recs, 'A', 'B', { iterations: 9 });
  const got = [r.successDiff.lo, r.successDiff.hi, r.cpsRatio.lo, r.cpsRatio.hi, r.cpsRatio.finiteResamples].map(x => Math.round(x * 1e9) / 1e9);
  assert.deepEqual(got, [0.047619048, 0.333333333, 0.733333333, 1.925, 9]);
  const r2 = pairedBootstrap(recs, 'A', 'B', { iterations: 9, seed: 'bootstrap' });
  assert.deepEqual([r2.successDiff.lo, r2.successDiff.hi], [r.successDiff.lo, r.successDiff.hi], 'the default seed is "bootstrap"');
});
