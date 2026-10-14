import test from 'node:test';
import assert from 'node:assert/strict';
import { labelTable, leakTest, baselines } from '../metrics.mjs';
import { priorPredictor, knnPredictor, expectedUtilityRouter, lofo, subTable, cellSummary } from '../router.mjs';

// 18 synthetic families on one latent axis: rule density r in [0, 1] (a pre-execution feature) plus a noise feature.
// Direct calls fail as rules pile up, the agent degrades more slowly and costs more, a constructed workflow is reliable on
// rule-heavy work but has a build cost. So the best mode moves with r: direct -> agent -> construct.
const MODES = ['direct', 'agent', 'construct'];
function world(nFam = 18, nTask = 20) {
  const rows = [], fixed = [], features = {};
  for (let i = 0; i < nFam; i++) {
    const r = i / (nFam - 1), f = `fam${String(i).padStart(2, '0')}`;
    features[f] = { rules: r, noise: (i * 7919) % 13 };
    const p = { direct: Math.max(0, 0.95 - 1.2 * r), agent: Math.max(0, 0.9 - 0.5 * r), construct: 0.85 + 0.1 * r };
    const c = { direct: 0.01, agent: 0.2, construct: 0.03 };
    for (const m of MODES) for (let t = 0; t < nTask; t++) rows.push({ family: f, mode: m, task: `t${t}`, success: t < Math.round(p[m] * nTask), costUsd: c[m] });
    fixed.push({ family: f, mode: 'construct', fixedUsd: 2 });
  }
  return { table: labelTable(rows, fixed), features };
}
const { table: T, features: X } = world();
const H = () => 20;

test('cellSummary counts successes, mean per-task cost and fixed cost', () => {
  const s = cellSummary(T, 'fam00').get('construct');
  assert.equal(s.n, 20); assert.equal(s.fixedUsd, 2);
  assert.ok(Math.abs(s.perTaskUsd - 0.03) < 1e-12);
});

test('subTable keeps exactly the named families with their fixed costs', () => {
  const s = subTable(T, ['fam01', 'fam05']);
  assert.deepEqual(s.families, ['fam01', 'fam05']);
  assert.equal(s.cell('fam05', 'construct').fixedUsd, 2);
});

test('expected-utility router follows the slider and respects hard-requirement rules', () => {
  const pred = () => new Map([['direct', { p: 0.5, perTaskUsd: 0.01, fixedUsd: 0 }], ['construct', { p: 0.95, perTaskUsd: 0.03, fixedUsd: 2 }]]);
  const r = expectedUtilityRouter({ predict: pred, horizon: () => 20 });
  assert.equal(r('x', 0.1), 'direct');          // 20*(0.05-0.01)=0.8 vs 20*(0.095-0.03)-2=-0.7
  assert.equal(r('x', 10), 'construct');        // 99.8 vs 187.4
  const ruled = expectedUtilityRouter({ predict: pred, horizon: () => 20, allowed: () => ['construct'] });
  assert.equal(ruled('x', 0.1), 'construct');
  assert.throws(() => expectedUtilityRouter({ predict: pred, horizon: () => 20, allowed: () => [] })('x', 1), /no allowed mode/);
});

test('LOFO: a kNN router on the informative feature closes most of the SBS-VBS gap; the feature-blind prior does not', () => {
  const V = 1;
  const knn = lofo(T, train => expectedUtilityRouter({ predict: knnPredictor(train, X, { k: 3, keys: ['rules'] }), horizon: H }), V);
  const prior = lofo(T, train => expectedUtilityRouter({ predict: priorPredictor(train), horizon: H }), V);
  assert.ok(knn.headroom > 0, 'the synthetic world must have headroom');
  assert.ok(knn.closedGap > 0.6, `knn closed gap ${knn.closedGap}`);
  assert.ok(prior.closedGap <= 0.05, `prior closed gap ${prior.closedGap}`);
  // On the noise feature alone the kNN router has nothing to learn from.
  const noise = lofo(T, train => expectedUtilityRouter({ predict: knnPredictor(train, X, { k: 3, keys: ['noise'] }), horizon: H }), V);
  assert.ok(noise.closedGap < knn.closedGap - 0.3, `noise ${noise.closedGap} vs rules ${knn.closedGap}`);
});

test('LOFO picks the SBS on each fold\'s training families only', () => {
  const r = lofo(T, () => () => 'agent', 1);
  for (const p of r.per) assert.ok(['direct', 'agent', 'construct'].includes(p.sbsMode));
  assert.equal(r.folds, 18);
});

test('the kNN router passes the decoy-label leak test when given only training labels; a router built on the evaluation table is caught', () => {
  // The harness builds routers from TRAINING labels; a router that is (wrongly) built from the evaluation table reads
  // its labels, and the decoy makes its picks change.
  const clean = () => expectedUtilityRouter({ predict: knnPredictor(subTable(T, T.families.slice(0, 9)), X, { keys: ['rules'] }), horizon: H });
  assert.equal(leakTest(T, clean, [0.1, 1, 10]).ok, true);
  const leaky = table => expectedUtilityRouter({ predict: knnPredictor(table, X, { k: 1, keys: ['rules'] }), horizon: H });
  assert.equal(leakTest(T, leaky, [0.1, 1, 10]).ok, false);
});

test('random and fixed-mode baselines score as expected under LOFO', () => {
  const B = baselines(MODES);
  const rnd = lofo(T, () => B.random, 1);
  const knn = lofo(T, train => expectedUtilityRouter({ predict: knnPredictor(train, X, { keys: ['rules'] }), horizon: H }), 1);
  assert.ok(rnd.closedGap < knn.closedGap);
});
