// C2-3 post-hoc analysis helpers ($0): which items a supplier's labelled history determines, the supplier-clustered
// bootstrap, and the per-item cost projection.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { historyPins, stratumOf } from '../c23-errors.mjs';
import { pairedClusterBootstrap, projectArm } from '../c23-posthoc.mjs';
import { pairedShipmentBootstrap } from '../analyze.mjs';

const A = 'Hazard Class A', B = 'Hazard Class B', C = 'Hazard Class C', D = 'Hazard Class D';

test('history pins a total by an equal total, by two same-class totals around it, or beyond the end classes; gaps stay open', () => {
  const h = [{ total: 5, cls: A }, { total: 9, cls: B }, { total: 15, cls: C }, { total: 17, cls: D }];
  assert.equal(historyPins(h, 5), true);           // seen
  assert.equal(historyPins(h, 4), true);           // at or below an A
  assert.equal(historyPins(h, 20), true);          // at or above a D
  assert.equal(historyPins(h, 6), false);          // between A@5 and B@9: the history cannot say where A ends
  assert.equal(historyPins(h, 16), false);         // between C@15 and D@17
  assert.equal(historyPins([...h, { total: 7, cls: A }], 6), true);   // between two As
  assert.equal(historyPins([{ total: 9, cls: B }, { total: 13, cls: B }], 11), true);
  assert.equal(historyPins([{ total: 9, cls: 'Unable to Decide' }], 9), false);   // Unable records pin nothing
  assert.equal(stratumOf(h, { hazard_class: 'Unable to Decide', hazard_score: 0 }), 'unable');
  assert.equal(stratumOf(h, { hazard_class: B, hazard_score: 12 }), 'gap');
  assert.equal(stratumOf(h, { hazard_class: B, hazard_score: 9 }), 'pinned');
});

test('supplier-clustered bootstrap: errors concentrated in one supplier widen the interval against the shipment bootstrap', () => {
  // 4 suppliers x 5 shipments x 2 items; arm B is wrong on every item of supplier s0, arm A is always right.
  const mk = wrongSupplier => ['s0', 's1', 's2', 's3'].flatMap(s => Array.from({ length: 10 }, (_, i) => ({ id: `${s}-${i}`, source: s, shipment: `${s}-sh${i >> 1}`, correct: s !== wrongSupplier })));
  const a = mk(null), b = mk('s0');
  const bySupplier = pairedClusterBootstrap(a, b), byShipment = pairedShipmentBootstrap(a, b);
  assert.equal(bySupplier.point, 0.25);
  assert.equal(byShipment.point, 0.25);
  assert.ok(bySupplier.lo <= 0.25 && 0.25 <= bySupplier.hi);
  assert.ok(bySupplier.hi - bySupplier.lo > byShipment.hi - byShipment.lo, `${JSON.stringify(bySupplier)} vs ${JSON.stringify(byShipment)}`);
  assert.equal(bySupplier.lo, 0);   // a resample that never draws s0 shows no difference
});

test('projection: fixed builds amortise over N items per supplier, the agent pays every item', () => {
  const built = { out: Array.from({ length: 10 }, () => ({ ms: 1000 })), usd: 1, ms: 10 * 1000 + 50000 };
  assert.deepEqual(projectArm(built, { suppliers: 2, perItem: false, N: 5 }), { N: 5, usdPerItem: 0.1, msPerItem: 6000 });
  assert.deepEqual(projectArm(built, { suppliers: 2, perItem: false, N: 500 }), { N: 500, usdPerItem: 0.001, msPerItem: 1050 });
  const agent = { out: Array.from({ length: 10 }, () => ({ ms: 9000 })), usd: 0.02, ms: 90000 };
  assert.deepEqual(projectArm(agent, { suppliers: 2, perItem: true, N: 1000 }), { N: 1000, usdPerItem: 0.002, msPerItem: 9000 });
});
