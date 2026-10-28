import test from 'node:test';
import assert from 'node:assert/strict';
import { moduleHarness } from '../compose-kit/kit.mjs';
import { priceFulfilment } from '../modules/intake.mjs';

const intake = moduleHarness('intake');
const NOW = '2026-03-02T10:00:00+01:00';
const prices = { 'SKU-1': 500, 'SKU-2': 250 };
const fees = { 'WH-A': 300 };
const items = [{ sku: 'SKU-1', qty: 2 }, { sku: 'SKU-2', qty: 1 }];
const place = { op: 'place', orderId: 'ORD-1', customerId: 'C1', placedAt: NOW, currency: 'EUR', items, prices, fees };
const plan = {
  orderId: 'ORD-1',
  fulfilments: [
    { fulfilmentId: 'F1', location: 'WH-A', items: [{ sku: 'SKU-1', qty: 2 }], available: true },
    { fulfilmentId: 'F2', location: null, items: [{ sku: 'SKU-2', qty: 1 }], available: false },
  ],
};

test('placing an order asks the inventory for the allocation (read-only, keyed locally)', () => {
  const r = intake.step(place, { key: 'ORD-1', state: null, now: NOW });
  assert.equal(r.violations.length, 0);
  assert.equal(r.error, null);
  assert.equal(r.effects.length, 1);
  assert.equal(r.effects[0].system, 'inventory');
  assert.equal(r.effects[0].op, 'allocate');
  assert.equal(r.effects[0].key, 'allocate');
});

test('R1.2: amounts are qty × unit price plus the location fee; an unavailable fulfilment has no fee', () => {
  assert.equal(priceFulfilment({ location: 'WH-A', items: [{ sku: 'SKU-1', qty: 2 }] }, prices, fees), 1300);
  assert.equal(priceFulfilment({ location: null, items: [{ sku: 'SKU-2', qty: 1 }] }, prices, fees), 250);
});

test('R1.1: after the allocation the order is recorded and the fraud check is asked', () => {
  const s = intake.step(place, { key: 'ORD-1', state: null, now: NOW });
  const r = intake.onEvent({ type: 'effect.result', payload: { key: 'allocate', system: 'inventory', op: 'allocate', status: 'ok', result: plan } },
    { key: 'ORD-1', state: s.state, now: NOW });
  assert.equal(r.violations.length, 0);
  const create = r.effects.find(e => e.key === 'create');
  const fraud = r.effects.find(e => e.key === 'fraud');
  assert.ok(create, 'orders.create is emitted');
  assert.equal(create.system, 'orders');
  assert.equal(create.args.totalMinor, 1550);
  assert.equal(create.args.fulfilments.length, 2);
  assert.equal(create.args.fulfilments[0].amountMinor, 1300);
  assert.equal(create.args.fulfilments[1].amountMinor, 250);
  assert.ok(fraud, 'fraud.check is emitted');
  assert.equal(fraud.args.orderId, 'ORD-1');
  assert.equal(r.output.totalMinor, 1550);
});

test('R2.1: the fraud verdict comes back as the output', () => {
  const s = intake.step(place, { key: 'ORD-1', state: null, now: NOW });
  const a = intake.onEvent({ type: 'effect.result', payload: { key: 'allocate', system: 'inventory', op: 'allocate', status: 'ok', result: plan } },
    { key: 'ORD-1', state: s.state, now: NOW });
  const r = intake.onEvent({ type: 'effect.result', payload: { key: 'fraud', system: 'fraud', op: 'check', status: 'ok', result: { orderId: 'ORD-1', verdict: 'review' } } },
    { key: 'ORD-1', state: a.state, now: NOW });
  assert.equal(r.output.verdict, 'review');
});
