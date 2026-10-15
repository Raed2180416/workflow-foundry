import test from 'node:test';
import assert from 'node:assert/strict';
import { betaBinomial, expectedUtilities, probeValue, bestProbe, evsiMonteCarlo } from '../voi.mjs';
import { rng } from '../metrics.mjs';

const close = (a, b, eps) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b} (eps ${eps})`);

test('Beta-Binomial pmf sums to 1 and matches the uniform-prior closed form', () => {
  const p = betaBinomial(6, 1, 1);
  close(p.reduce((s, x) => s + x, 0), 1, 1e-9);
  for (const x of p) close(x, 1 / 7, 1e-9);          // Beta(1,1): every s equally likely
  const q = betaBinomial(4, 3, 2);
  close(q.reduce((s, x) => s + x, 0), 1, 1e-9);
});

test('EVSI is non-negative, matches a Monte Carlo estimate, and is zero when one mode dominates every posterior', () => {
  const modes = [
    { id: 'agent', a: 6, b: 4, c: 0.1, F: 0 },
    { id: 'build', a: 2, b: 2, c: 0.02, F: 3 },        // uncertain: probing it is informative
  ];
  for (const k of [1, 3, 5]) {
    const v = probeValue(modes, 'build', k, { V: 1, H: 50 });
    assert.ok(v.evsi >= -1e-9);
    close(v.evsi, evsiMonteCarlo(modes, 'build', k, { V: 1, H: 50 }, { draws: 40000, rand: rng(k) }), 0.35);
  }
  // A mode that is better whatever the probe can show: no information value.
  const dom = [{ id: 'a', a: 50, b: 1, c: 0, F: 0 }, { id: 'b', a: 1, b: 50, c: 1, F: 5 }];
  close(probeValue(dom, 'b', 3, { V: 1, H: 20 }).evsi, 0, 1e-9);
  assert.equal(bestProbe(dom, { V: 1, H: 20 }).probe, null);
});

test('more prior uncertainty means more value of information (same mean)', () => {
  const base = { id: 'agent', a: 6, b: 4, c: 0.1, F: 0 };
  const wide = [base, { id: 'build', a: 1, b: 1, c: 0.02, F: 3 }];
  const narrow = [base, { id: 'build', a: 50, b: 50, c: 0.02, F: 3 }];
  assert.ok(probeValue(wide, 'build', 3, { V: 1, H: 50 }).evsi > probeValue(narrow, 'build', 3, { V: 1, H: 50 }).evsi);
});

test('one-off tasks (H = 1): a probe never pays unless it is deliverable', () => {
  const modes = [{ id: 'direct', a: 3, b: 3, c: 0.03, F: 0 }, { id: 'agent', a: 3, b: 2, c: 0.1, F: 0 }];
  assert.equal(bestProbe(modes, { V: 1, H: 1, cVerify: 0.01 }).probe, null);
});

test('a deliverable probe on a recurring family is nearly free information (delivered value offsets its cost)', () => {
  const modes = [{ id: 'agent', a: 3, b: 3, c: 0.1, F: 0 }, { id: 'opus', a: 9, b: 1, c: 0.6, F: 0 }];
  const notDel = probeValue(modes, 'agent', 3, { V: 1, H: 40, cVerify: 0.01 });
  const del = probeValue(modes, 'agent', 3, { V: 1, H: 40, cVerify: 0.01, deliverable: true });
  assert.ok(del.net > notDel.net);
  assert.ok(del.delivered > 0 && notDel.delivered === 0);
});

test('probing a build mode sinks its one-off cost: after a probe the build is chosen without paying F again', () => {
  const modes = [{ id: 'agent', a: 5, b: 5, c: 0.1, F: 0 }, { id: 'build', a: 1, b: 1, c: 0.01, F: 2 }];
  const v = probeValue(modes, 'build', 2, { V: 1, H: 100 });
  assert.equal(v.cost, 2 * 0.01 + 2);
  const allBuildOk = v.after.find(x => x.s === 2);
  assert.equal(allBuildOk.choose, 'build');
  const allBuildFail = v.after.find(x => x.s === 0);
  assert.equal(allBuildFail.choose, 'agent');
});

test('expected utilities follow H*(V*mean - c) - F', () => {
  const U = expectedUtilities([{ id: 'x', a: 3, b: 1, c: 0.2, F: 1 }], { V: 2, H: 10 });
  close(U.get('x'), 10 * (2 * 0.75 - 0.2) - 1, 1e-12);
});

test('bestProbe returns the plan with the highest positive net value and reports the prior choice', () => {
  const modes = [{ id: 'agent', a: 6, b: 4, c: 0.1, F: 0 }, { id: 'build', a: 1, b: 1, c: 0.02, F: 1 }];
  const r = bestProbe(modes, { V: 2, H: 200, kMax: 4, cVerify: 0.005 });
  const top = r.plans.reduce((x, y) => (y.net > x.net ? y : x));
  if (top.net > 0) assert.deepEqual(r.probe, { j: top.j, k: top.k }); else assert.equal(r.probe, null);
  assert.ok(['agent', 'build'].includes(r.priorChoice));
  assert.throws(() => probeValue(modes, 'nope', 1, { V: 1, H: 5 }), /unknown mode/);
  // A deliverable probe runs on the job's tasks, so k <= H; one on examples is bounded by kMax only (third review R2).
  assert.throws(() => probeValue(modes, 'agent', 9, { V: 1, H: 5, deliverable: true }), /k must be/);
  assert.throws(() => probeValue(modes, 'agent', 0, { V: 1, H: 5 }), /k must be/);
  assert.equal(probeValue(modes, 'agent', 9, { V: 1, H: 5 }).k, 9);
});
