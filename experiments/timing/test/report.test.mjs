// LAT-0 report helpers ($0).
import test from 'node:test';
import assert from 'node:assert/strict';
import { quantile, cp95, perSuccess, armSummary } from '../report.mjs';

test('nearest-rank quantiles; p99 at n < 100 is the maximum', () => {
  const xs = Array.from({ length: 96 }, (_, i) => i + 1);
  assert.equal(quantile(xs, 0.5), 48);
  assert.equal(quantile(xs, 0.9), 87);
  assert.equal(quantile(xs, 0.99), 96);
  assert.equal(quantile([], 0.5), null);
});

test('two-sided 95% Clopper-Pearson', () => {
  const c = cp95(10, 14);
  assert.ok(Math.abs(c.lo - 0.419) < 1e-3 && Math.abs(c.hi - 0.916) < 1e-3, JSON.stringify(c));
  const p = cp95(14, 14);
  assert.ok(Math.abs(p.lo - 0.768) < 1e-3 && p.hi === 1);
});

test('wall time per verified success: none without a success; bounds carried; success-count interval', () => {
  assert.equal(perSuccess(1000, 0, 5), null);
  const b = perSuccess({ lo: 2000, hi: 6000 }, 10, 14);
  assert.equal(b.pointLo, 200); assert.equal(b.pointHi, 600); assert.equal(b.point, null);
  const p = perSuccess(1400, 14, 14);
  assert.equal(p.point, 1400); assert.equal(p.pointLo, 100); assert.ok(p.hi > 100 && p.lo === 100);
});

test('armSummary pools wall, successes and first-effect share', () => {
  const row = (wall, ok, ttfe) => ({ timing: { wallMs: wall, timeToFirstEffectMs: ttfe, components: { modelMs: wall / 2 }, concurrency: { configured: 4, observedMax: 2 } },
    verdict: { successes: ok ? 1 : 0, total: 1 }, usd: { charged: 0.1, reported: 0.1 } });
  const s = armSummary([row(100, true, 50), row(300, false, 30), row(200, true, null)]);
  assert.equal(s.successes, 2); assert.equal(s.wall.sum, 600); assert.equal(s.wall.p50, 200);
  assert.equal(s.wallPerSuccess.pointLo, 300);
  assert.equal(s.timeToFirstEffect.rows, 2);
  assert.equal(s.modelShareP50, 0.5);
  assert.deepEqual(s.concurrency, { configured: [4], observedMax: 2 });
});
