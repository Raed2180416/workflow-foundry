// Tests for the information-path budget (infopath.mjs). Each block has teeth: a variant that decides on verdict
// agreement instead of error agreement, or that ignores clustering, must fail where the rule passes.
//   nice -n 15 node --test --test-concurrency=1 experiments/lib/infopath.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KAPPA_MAX, admissionWalk, admitSignal, budgetPaths, clusterBootstrap, cohenKappa, errorsOf, informative, neffOfSet, pairStats, rng } from './infopath.mjs';

test('Cohen κ: hand-computed table, perfect agreement, nulls skipped, undefined when one side is constant', () => {
  // 2x2: both 1: 20, a only: 5, b only: 10, both 0: 15  (n 50): po 0.7, pa 0.5, pb 0.6, pe 0.5 -> κ 0.4
  const a = [...Array(20).fill(1), ...Array(5).fill(1), ...Array(10).fill(0), ...Array(15).fill(0)];
  const b = [...Array(20).fill(1), ...Array(5).fill(0), ...Array(10).fill(1), ...Array(15).fill(0)];
  const k = cohenKappa(a, b);
  assert.ok(Math.abs(k.kappa - 0.4) < 1e-12);
  assert.equal(k.n, 50);
  assert.equal(cohenKappa([1, 0, 1, null], [1, 0, 1, 0]).kappa, 1);
  assert.equal(cohenKappa([1, 0, 1, null], [1, 0, 1, 0]).n, 3);
  assert.equal(cohenKappa([1, 1, 1], [1, 0, 1]).kappa, 0, 'constant side: κ 0 by definition here (po = pe)');
  assert.equal(cohenKappa([1, 1], [1, 1]).kappa, null);
  assert.deepEqual(errorsOf([true, false, null], [true, true, false]), [0, 1, null]);
});

// two accurate verifiers with independent errors: they agree in verdicts (both follow the label) but not in mistakes
function twoIndependent(n = 600, noise = 0.1, seed = 5) {
  const r = rng(seed);
  const y = Array.from({ length: n }, () => r() < 0.4);
  const flip = v => v.map(x => (r() < noise ? !x : x));
  return { y, a: flip(y), b: flip(y), copy: null };
}

test('the metric is named, never defaulted; error κ admits two accurate verifiers with independent mistakes, verdict κ (ATTACK\'s) refuses them', () => {
  const { y, a, b } = twoIndependent();
  const st = pairStats(a, b, { y });
  assert.ok(st.verdictKappa > KAPPA_MAX, `verdict κ ${st.verdictKappa}`);
  assert.ok(Math.abs(st.errorKappa) < 0.15, `error κ ${st.errorKappa}`);
  assert.equal(admitSignal({ name: 'b', verdicts: b }, [{ name: 'a', verdicts: a }], { y, on: 'errors' }).decision, 'admit');
  // the cost of ATTACK's metric: verdict κ refuses two accurate verifiers whose mistakes are independent
  assert.equal(admitSignal({ name: 'b', verdicts: b }, [{ name: 'a', verdicts: a }], { y, on: 'verdicts' }).decision, 'refuse');
  // v2: the metric is never defaulted silently
  assert.throws(() => admitSignal({ name: 'b', verdicts: b }, [{ name: 'a', verdicts: a }], { y }), /name the metric/);
  // a near-copy (shares the mistakes) is refused
  const r = rng(9);
  const copy = a.map(x => (r() < 0.02 ? !x : x));
  const res = admitSignal({ name: 'copy', verdicts: copy }, [{ name: 'a', verdicts: a }], { y, on: 'errors' });
  assert.equal(res.decision, 'refuse');
  assert.match(res.reason, /errors κ 0\.\d\d with a > 0\.4/);
  assert.equal(admitSignal({ name: 'x', verdicts: a.slice(0, 10) }, [{ name: 'a', verdicts: b.slice(0, 10) }], { y: y.slice(0, 10), on: 'errors' }).decision, 'unmeasured');
  assert.equal(admitSignal({ name: 'first', verdicts: a }, [], { y, on: 'errors' }).decision, 'admit');
});

test('provisional: below the bar at the point, above it at the cluster-bootstrap bound', () => {
  // clustered data: 30 tasks of 6 rows; within a task, errors of a and b coincide in some tasks only
  const r = rng(13);
  const y = [], a = [], b = [], cl = [];
  for (let t = 0; t < 30; t++) {
    const shared = r() < 0.3;
    for (let k = 0; k < 6; k++) {
      const yy = r() < 0.5; y.push(yy); cl.push(`t${t}`);
      const ea = r() < 0.25, eb = shared ? ea : r() < 0.25;
      a.push(ea ? !yy : yy); b.push(eb ? !yy : yy);
    }
  }
  const st = pairStats(a, b, { y, clusters: cl, B: 400 });
  assert.ok(st.errorKappaCI.lo < st.errorKappa && st.errorKappa < st.errorKappaCI.hi);
  const res = admitSignal({ name: 'b', verdicts: b }, [{ name: 'a', verdicts: a }], { y, clusters: cl, kappaMax: st.errorKappa + 0.02, B: 400, on: 'errors' });
  assert.equal(res.decision, 'provisional');
  // teeth: without clusters the same point estimate is a plain admit (the clustered uncertainty is ignored)
  assert.equal(admitSignal({ name: 'b', verdicts: b }, [{ name: 'a', verdicts: a }], { y, kappaMax: st.errorKappa + 0.02, on: 'errors' }).decision, 'admit');
});

test('n_eff of a set: copies count once, independent signals count fully', () => {
  const { y, a, b } = twoIndependent(2000, 0.2, 21);
  const ea = errorsOf(a, y), eb = errorsOf(b, y);
  assert.ok(Math.abs(neffOfSet([ea, ea, ea]).nEff - 1) < 1e-9);
  const ind = neffOfSet([ea, eb]);
  assert.ok(ind.nEff > 1.9, `independent errors: n_eff ${ind.nEff}`);
  assert.equal(neffOfSet([ea]).nEff, 1);
});

test('cluster bootstrap resamples whole clusters (teeth: a row bootstrap of clustered data is too narrow)', () => {
  const r = rng(3);
  const cl = [], v = [];
  for (let t = 0; t < 20; t++) { const p = r(); for (let k = 0; k < 10; k++) { cl.push(t); v.push(p + 0.01 * r()); } }
  const mean = idx => idx.reduce((s, i) => s + v[i], 0) / idx.length;
  const c = clusterBootstrap(cl, mean, { B: 500 });
  const rows = clusterBootstrap(v.map((_, i) => i), mean, { B: 500 });
  assert.ok(c.hi - c.lo > 2 * (rows.hi - rows.lo), `cluster width ${c.hi - c.lo} vs row width ${rows.hi - rows.lo}`);
});

test('budget: the greedy rule never admits a pair above the bar and respects the dollar cap', () => {
  const { y, a, b } = twoIndependent(800, 0.15, 33);
  const r = rng(4);
  const copy = a.map(x => (r() < 0.03 ? !x : x));
  const cands = [
    { name: 'a', verdicts: a, costUsd: 0.002, value: 0.35 },
    { name: 'copy', verdicts: copy, costUsd: 0.0001, value: 0.34 },
    { name: 'b', verdicts: b, costUsd: 0.003, value: 0.35 },
    { name: 'chance', verdicts: y.map(() => r() < 0.5), costUsd: 0, value: 0 },
  ];
  const full = budgetPaths(cands, { y, on: 'errors' });
  assert.deepEqual(full.chosen.sort(), ['b', 'copy']);
  assert.ok(full.refused.some(x => x.name === 'a' && /κ/.test(x.reason)), 'a duplicates copy: refused');
  assert.ok(full.refused.some(x => x.name === 'chance'));
  assert.ok(full.nEff > 1.8);
  const capped = budgetPaths(cands, { y, budgetUsd: 0.001, on: 'errors' });
  assert.deepEqual(capped.chosen, ['copy']);
  const byValue = budgetPaths(cands, { y, order: 'value', on: 'errors' });
  assert.deepEqual(byValue.chosen.sort(), ['a', 'b']);
  assert.throws(() => budgetPaths(cands, { y, order: 'random', on: 'errors' }), /order must be/);
  assert.throws(() => budgetPaths(cands, { y }), /name the metric/);
  // an unpriced signal (a shadow price pending) is not bought, whatever its value
  const unp = budgetPaths([...cands, { name: 'free?', verdicts: b, costUsd: null, value: 0.9 }], { y, on: 'errors' });
  assert.ok(!unp.chosen.includes('free?'));
  assert.ok(unp.refused.some(x => x.name === 'free?' && /unpriced/.test(x.reason)));
});

test('admission walk (review 6): self-reports and near-constant signals are excluded by rule; the bound rule holds provisional signals (teeth: the v1 walk admitted all three)', () => {
  const r = rng(17);
  const y = [], cl = [], acc = [], indep = [], self = [], constant = [], shared = [];
  for (let t = 0; t < 40; t++) {
    const sh = r() < 0.3;
    for (let k = 0; k < 6; k++) {
      const yy = r() < 0.45; y.push(yy); cl.push(`t${t}`);
      const ea = r() < 0.2; acc.push(ea ? !yy : yy);
      indep.push(r() < 0.2 ? !yy : yy);
      shared.push(sh ? (ea ? !yy : yy) : (r() < 0.2 ? !yy : yy));
      self.push(r() < 0.3 ? !yy : yy);
      constant.push(r() < 0.02);
    }
  }
  const signals = { acc: { verdicts: acc }, self: { verdicts: self, selfReport: true }, constant: { verdicts: constant }, indep: { verdicts: indep }, shared: { verdicts: shared } };
  const order = ['acc', 'self', 'constant', 'indep', 'shared'];
  const point = admissionWalk(order, signals, { y, clusters: cl, on: 'errors', rule: 'point', B: 300 });
  const by = Object.fromEntries(point.walk.map(w => [w.name, w]));
  assert.equal(by.self.decision, 'excluded');
  assert.match(by.self.reason, /self-report/);
  assert.equal(by.constant.decision, 'excluded');
  assert.match(by.constant.reason, /uninformative/);
  assert.equal(by.indep.decision, 'admit');
  assert.ok(!point.admitted.includes('self') && !point.admitted.includes('constant'));
  assert.equal(informative(constant, y).ok, false);
  assert.equal(informative(acc, y).ok, true);
  // a signal whose error κ is under the bar at the point but over it at the bound: 'point' admits it (fragile), 'bound' holds it
  const st = pairStats(shared, acc, { y, clusters: cl, B: 300 });
  const kappaMax = st.errorKappa + 0.02;
  const p2 = admissionWalk(['acc', 'shared'], signals, { y, clusters: cl, on: 'errors', rule: 'point', kappaMax, B: 300 });
  const b2 = admissionWalk(['acc', 'shared'], signals, { y, clusters: cl, on: 'errors', rule: 'bound', kappaMax, B: 300 });
  assert.equal(p2.walk[1].decision, 'admit');
  assert.equal(p2.walk[1].fragile, true);
  assert.equal(b2.walk[1].decision, 'held');
  assert.deepEqual(b2.admitted, ['acc']);
  // teeth: the v1 walk (admit on 'admit' or 'provisional', no exclusions) admits the self-report and the constant signal
  const v1 = [];
  for (const n of order) { const res = admitSignal({ name: n, verdicts: signals[n].verdicts }, v1.map(m => ({ name: m, verdicts: signals[m].verdicts })), { y, clusters: cl, on: 'errors', B: 300 }); if (res.decision === 'admit' || res.decision === 'provisional') v1.push(n); }
  assert.ok(v1.includes('self') && v1.includes('constant'), `v1 admitted ${v1}`);
  assert.throws(() => admissionWalk(order, signals, { y, on: 'errors', rule: 'loose' }), /rule must be/);
});
