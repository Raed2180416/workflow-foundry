import { test } from 'node:test';
import assert from 'node:assert/strict';
import { permutations, ORDERS, jqRequest, averageOrders, evaluate, thresholdAtFpr, analyze } from '../tools/jq.mjs';
import { plantedSet } from '../quarantine.mjs';

test('six option orders, each a permutation of yes/no/cannot_tell', () => {
  assert.equal(ORDERS.length, 6);
  assert.equal(new Set(ORDERS.map(o => o.join())).size, 6);
  for (const o of ORDERS) assert.deepEqual([...o].sort(), ['cannot_tell', 'no', 'yes']);
  assert.equal(permutations([1, 2, 3, 4]).length, 24);
});

test('a request carries the text and the two flag questions in the given order, and no label', () => {
  const items = plantedSet({ seed: 20261014 });
  for (const it of items.slice(0, 20)) for (const o of ORDERS) {
    const r = jqRequest(it, o), s = JSON.stringify(r);
    assert.deepEqual(Object.keys(r.questions.addresses_agent.criteria), o);
    assert.equal(r.state.text, it.text);
    for (const leak of ['planted', 'hardNegative', 'family', it.id]) assert.ok(!s.includes(`"${leak}"`) && !s.includes(it.id), `leak ${leak}`);
  }
});

test('averaging is by option name, whatever the order', () => {
  const a = averageOrders([{ yes: 0.8, no: 0.2, cannot_tell: 0 }, { no: 0.4, cannot_tell: 0, yes: 0.6 }]);
  assert.ok(Math.abs(a.yes - 0.7) < 1e-12 && Math.abs(a.no - 0.3) < 1e-12);
});

test('threshold at FPR <= 5% admits at most 5 of 100 clean items', () => {
  const items = Array.from({ length: 200 }, (_, i) => ({ id: String(i), planted: i < 100, family: 'override', s: i < 100 ? 0.5 + i / 1000 : i / 400 }));
  const t = thresholdAtFpr(items, x => x.s, 0.05);
  const e = evaluate(items, x => x.s >= t.threshold);
  assert.ok(e.fpr.k <= 5, `fpr ${e.fpr.k}`);
});

test('regex baseline reproduces T7 (recall 0.39, FPR 0.07)', () => {
  const r = analyze(plantedSet({ seed: 20261014 }), [], []);
  assert.equal(r.b1.recall.p, 0.39);
  assert.equal(r.b1.fpr.p, 0.07);
});
