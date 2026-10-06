import test from 'node:test';
import assert from 'node:assert/strict';
import { passAtK, passHatK, wilson, summarizeArm, byArmTask, pairedBootstrap, mcnemar } from './stats.mjs';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('pass@k and pass^k match closed forms', () => {
  close(passHatK(3, 3, 3), 1); close(passHatK(3, 2, 3), 0); close(passHatK(4, 3, 2), 3 / 6);
  close(passAtK(4, 1, 2), 1 - 3 / 6); close(passAtK(5, 0, 3), 0); close(passAtK(5, 3, 3), 1);
  close(passHatK(10, 7, 1), 0.7); close(passAtK(10, 7, 1), 0.7);
});

test('wilson interval contains p and is bounded', () => {
  const w = wilson(7, 10); assert.ok(w.lo < 0.7 && w.hi > 0.7 && w.lo >= 0 && w.hi <= 1);
  const z = wilson(0, 10); assert.equal(z.lo, 0); assert.ok(z.hi > 0);
});

const recs = [];
for (let t = 0; t < 12; t++) for (let k = 0; k < 3; k++) {
  const family = t < 6 ? 'f1' : 'f2';
  recs.push({ arm: 'A', task: `t${t}`, family, trial: k, pass: t % 4 !== 0, costUsd: 0.01 });
  recs.push({ arm: 'B', task: `t${t}`, family, trial: k, pass: t % 2 === 0, costUsd: 0.05 });
}

test('summarizeArm computes CPS over all spend including failures', () => {
  const s = summarizeArm(byArmTask(recs).get('A'), { k: 3 });
  assert.equal(s.trials, 36); assert.equal(s.successes, 27);
  close(s.costUsd, 0.36); close(s.cps, 0.36 / 27); close(s.passHat3, 9 / 12);
  const withConstruction = summarizeArm(byArmTask(recs).get('A'), { extraCostUsd: 1 });
  close(withConstruction.cps, 1.36 / 27);
});

test('paired bootstrap is deterministic and brackets the point estimate', () => {
  const a = pairedBootstrap(recs, 'A', 'B', { iterations: 2000 });
  const b = pairedBootstrap(recs, 'A', 'B', { iterations: 2000 });
  assert.deepEqual(a, b);
  close(a.successDiff.point, 27 / 36 - 18 / 36);
  assert.ok(a.successDiff.lo <= a.successDiff.point && a.successDiff.hi >= a.successDiff.point);
  assert.ok(a.cpsRatio.point < 1 && a.families === 2 && a.tasks === 12);
});

test('mcnemar counts discordant tasks', () => {
  const m = mcnemar(recs, 'A', 'B');
  assert.equal(m.aOnly + m.bOnly > 0, true); assert.ok(m.p > 0 && m.p <= 1);
});
