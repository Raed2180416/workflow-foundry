// Tests for the κ tables (tables.mjs): the admission walks as wired for the stored signals (review findings 6, 7, 18).
// Synthetic signals only (no stored data). nice -n 15 node --test --test-concurrency=1 experiments/autobench/verifier/kappa/tables.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COST, PURCHASE_ORDER, SELF_REPORT, costOf, signalTable, walks } from './tables.mjs';
import { budgetPaths, pairStats, rng } from '../../../lib/infopath.mjs';

// labels, clusters and signals of the purchase order: two accurate signals with independent mistakes (high verdict κ, low
// error κ), a near-copy judge, a near-constant judge and the self-report
function fixture(seed = 3) {
  const r = rng(seed);
  const y = [], clusters = [], sig = Object.fromEntries(PURCHASE_ORDER.map(n => [n, []]));
  for (let t = 0; t < 50; t++) for (let k = 0; k < 6; k++) {
    const yy = r() < 0.4; y.push(yy); clusters.push(`t${t}`);
    const e1 = r() < 0.12;
    sig.rl2.push(e1 ? !yy : yy);
    sig['judge-haiku'].push(r() < 0.12 ? !yy : yy);                                  // accurate, independent mistakes
    sig['judge-sonnet'].push(r() < 0.05 ? !sig['judge-haiku'].at(-1) : sig['judge-haiku'].at(-1));   // a near-copy of the Haiku judge
    sig['judge-mercury'].push(r() < 0.5);                                            // a coin
    sig['judge-haiku-diff'].push(r() < 0.02);                                       // accepts ~2%: near-constant
    sig.cc.push(r() < 0.3 ? !yy : yy);
    for (const rd of ['reader-haiku0', 'reader-haiku1', 'reader-haiku2']) sig[rd].push(r() < 0.04 ? !sig.rl2.at(-1) : sig.rl2.at(-1));   // shares RL2's mistakes
    sig.own.push(r() < 0.1 ? !yy : yy);                                              // accurate, but a self-report
  }
  return { y, clusters, sig };
}

test('walks: the decision of record is ATTACK\'s (verdict κ, point); self-reports and near-constant judges are excluded by rule in every walk (teeth: v1 admitted both)', () => {
  const { y, clusters, sig } = fixture();
  const w = walks(sig, { y, clusters, B: 200 });
  assert.equal(w.decisionOfRecord, 'verdicts/point');
  for (const k of ['verdicts/point', 'verdicts/bound', 'errors/point', 'errors/bound']) {
    const by = Object.fromEntries(w[k].walk.map(x => [x.name, x]));
    assert.equal(by.own.decision, 'excluded', `${k}: own`);
    assert.equal(by['judge-haiku-diff'].decision, 'excluded', `${k}: near-constant judge`);
    assert.ok(!w[k].admitted.includes('own') && !w[k].admitted.includes('judge-haiku-diff'));
    assert.equal(by.rl2.decision, 'admit');
    for (const rd of ['reader-haiku0', 'reader-haiku1', 'reader-haiku2']) assert.notEqual(by[rd].decision, 'admit', `${k}: a reader sharing RL2's mistakes`);
    assert.equal(by['judge-sonnet'].decision === 'admit', false, `${k}: a near-copy judge`);
  }
  // the metric matters: two accurate signals with independent mistakes have a high verdict κ (ATTACK's rule refuses the
  // second) and a low error κ (the error-κ rule admits it)
  const st = pairStats(sig['judge-haiku'], sig.rl2, { y });
  assert.ok(st.verdictKappa > 0.4 && st.errorKappa < 0.2, `verdict ${st.verdictKappa}, error ${st.errorKappa}`);
  const rec = Object.fromEntries(w['verdicts/point'].walk.map(x => [x.name, x.decision])), err = Object.fromEntries(w['errors/point'].walk.map(x => [x.name, x.decision]));
  assert.equal(rec['judge-haiku'], 'refuse');
  assert.equal(err['judge-haiku'], 'admit');
  assert.equal(SELF_REPORT.includes('own'), true);
});

test('review 18: the Mercury judge has no price on record and is never bought by the budget (teeth: a $0 price would make it the first pick)', () => {
  assert.equal(COST['judge-mercury'], null);
  assert.equal(costOf('judge-mercury'), null);
  assert.equal(costOf('reader-haiku2'), COST.reader);
  const { y, clusters, sig } = fixture(5);
  const names = ['rl2', 'judge-mercury', 'cc'];
  const val = { rl2: 0.3, 'judge-mercury': 0.5, cc: 0.2 };
  const cands = names.map(n => ({ name: n, verdicts: sig[n], costUsd: costOf(n), value: val[n] }));
  const b = budgetPaths(cands, { y, clusters, on: 'verdicts', budgetUsd: 0.01 });
  assert.ok(!b.chosen.includes('judge-mercury'));
  const free = budgetPaths(cands.map(c => (c.name === 'judge-mercury' ? { ...c, costUsd: 0 } : c)), { y, clusters, on: 'verdicts', budgetUsd: 0.01 });
  assert.equal(free.chosen[0], 'judge-mercury', 'v1 priced it at $0: free signals are bought first');
});

test('signalTable: per-signal rates and every pair on its own overlap (nulls are not scored)', () => {
  const y = [true, true, false, false, true, false, true, false, true, false, true, false];
  const a = [true, true, false, false, true, false, true, false, true, false, true, false];
  const b = [true, false, false, true, true, false, null, null, true, false, true, false];
  const t = signalTable({ a, b }, y, y.map((_, i) => `t${i % 4}`), { B: 50 });
  assert.equal(t.per.a.errorRate, 0);
  assert.equal(t.per.b.n, 10);
  assert.equal(t.pairs.length, 1);
  assert.equal(t.pairs[0].n, 10);
  assert.equal(signalTable({ a: a.slice(0, 9), b: b.slice(0, 9) }, y.slice(0, 9), y.slice(0, 9).map((_, i) => `t${i}`), { B: 10 }).pairs.length, 0, 'fewer than 10 paired items: no pair row');
});
