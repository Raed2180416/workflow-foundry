import test from 'node:test';
import assert from 'node:assert/strict';
import { runCall } from './_program.mjs';

const K = 'ORD-1';
const files = {
  'master/catalog.json': [{ sku: 'A', unitPriceMinor: 1000 }, { sku: 'B', unitPriceMinor: 250 }],
  'rulebook/ED1/edition.json': { id: 'ED1', effectiveFrom: '2026-01-01' },
  'rulebook/ED2/edition.json': { id: 'ED2', effectiveFrom: '2026-06-01' },
  'rulebook/ED1/shipping-fees.json': [{ location: 'AMS', feeMinor: 495 }],
  'rulebook/ED2/shipping-fees.json': [{ location: 'AMS', feeMinor: 600 }],
};
const order = { orderId: K, customerId: 'C-1', placedAt: '2026-03-02T10:00:00+01:00', currency: 'EUR', items: [{ sku: 'A', qty: 2 }, { sku: 'B', qty: 1 }] };
const plan = {
  orderId: K,
  fulfilments: [
    { fulfilmentId: 'F1', location: 'AMS', items: [{ sku: 'A', qty: 2 }], available: true },
    { fulfilmentId: 'F2', location: null, items: [{ sku: 'B', qty: 1 }], available: false },
  ],
};
const allocated = (at = '2026-03-02T10:01:00+01:00') => ({ type: 'effect.result', at, payload: { key: 'allocate', system: 'inventory', op: 'allocate', status: 'ok', result: plan } });

test('placed asks inventory for the plan (R1.1) and emits nothing else', () => {
  const r = runCall({ mod: 'intake', key: K, input: { op: 'placed', order } });
  assert.equal(r.error, null);
  assert.equal(r.effects.length, 1);
  assert.equal(r.effects[0].key, `intake/${K}/allocate`);
  assert.equal(r.output.duplicate, false);
  assert.equal(r.output.status, 'allocating');
});

test('amounts: Σ qty × unit price, plus the fee only where there is a location (R1.2)', () => {
  const r0 = runCall({ mod: 'intake', key: K, input: { op: 'placed', order }, files });
  const r = runCall({ mod: 'intake', key: K, event: allocated(), carry: { intake: { [K]: r0.carry.intake[K] } }, files });
  assert.equal(r.error, null);
  const f1 = r.output.fulfilments.find(f => f.fulfilmentId === 'F1');
  const f2 = r.output.fulfilments.find(f => f.fulfilmentId === 'F2');
  assert.equal(f1.amountMinor, 2 * 1000 + 495);
  assert.equal(f2.amountMinor, 250);
  assert.equal(r.output.totalMinor, 2495 + 250);
  const create = r.effects.find(e => e.key.endsWith('/create'));
  assert.equal(create.args.totalMinor, 2745);
  assert.equal(create.args.orderId, K);
});

test('the edition in force at placedAt is used, even when a newer one is on disk (R1.3)', () => {
  const late = { ...order, placedAt: '2026-07-01T10:00:00+02:00' };
  const r0 = runCall({ mod: 'intake', key: K, input: { op: 'placed', order: late }, files });
  const r = runCall({ mod: 'intake', key: K, event: allocated('2026-07-01T10:01:00+02:00'), carry: { intake: { [K]: r0.carry.intake[K] } }, files });
  assert.equal(r.output.edition, 'ED2');
  assert.equal(r.output.fulfilments.find(f => f.fulfilmentId === 'F1').amountMinor, 2000 + 600);
});

test('a placed order already recorded is a duplicate: no effect (R1.4)', () => {
  const query = (table) => (table === 'orders.orders' ? [{ orderId: K }] : []);
  const r = runCall({ mod: 'intake', key: K, input: { op: 'placed', order }, query, files });
  assert.equal(r.output.duplicate, true);
  assert.equal(r.effects.length, 0);
});
