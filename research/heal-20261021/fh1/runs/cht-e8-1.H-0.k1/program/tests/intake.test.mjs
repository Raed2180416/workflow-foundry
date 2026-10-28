import test from 'node:test';
import assert from 'node:assert/strict';
import { moduleHarness } from '../compose-kit/kit.mjs';

const intake = moduleHarness('intake');
const NOW = '2026-03-02T10:00:00+01:00';
const files = {
  'rulebook/ed-2026-1/edition.json': JSON.stringify({ id: 'ed-2026-1', effectiveFrom: '2026-01-01' }),
  'rulebook/ed-2026-2/edition.json': JSON.stringify({ id: 'ed-2026-2', effectiveFrom: '2026-06-01' }),
  'rulebook/ed-2026-1/shipping-fees.json': JSON.stringify([{ location: 'WH-AMS', feeMinor: 495 }]),
  'rulebook/ed-2026-2/shipping-fees.json': JSON.stringify([{ location: 'WH-AMS', feeMinor: 600 }]),
  'master/catalog.json': JSON.stringify([{ sku: 'A', unitPriceMinor: 299 }, { sku: 'B', unitPriceMinor: 1000 }]),
};
const order = { orderId: 'ORD-1', customerId: 'C-1', placedAt: NOW, currency: 'EUR', items: [{ sku: 'A', qty: 2 }, { sku: 'B', qty: 1 }] };
const allocated = (fulfilments) => ({ type: 'effect.result', at: NOW, payload: { key: 'allocate', system: 'inventory', op: 'allocate', status: 'ok', fulfilments } });

test('placing an order asks for the allocation and no record yet (R1.1)', () => {
  const r = intake.step({ op: 'placed', order }, { key: 'ORD-1', state: null, now: NOW, files });
  assert.equal(r.violations.length, 0);
  assert.deepEqual(r.effects.map(e => `${e.system}.${e.op}`), ['inventory.allocate']);
  assert.equal(r.output.edition, 'ed-2026-1');
});

test('amounts: items at unit price, plus the location fee; an unavailable fulfilment has no fee (R1.2)', () => {
  const s = intake.step({ op: 'placed', order }, { key: 'ORD-1', state: null, now: NOW, files });
  const plan = [
    { fulfilmentId: 'ORD-1-F1', location: 'WH-AMS', items: [{ sku: 'A', qty: 2 }], available: true },
    { fulfilmentId: 'ORD-1-F2', location: null, items: [{ sku: 'B', qty: 1 }], available: false },
  ];
  const r = intake.onEvent(allocated(plan), { key: 'ORD-1', state: s.state, now: NOW, files });
  const create = r.effects.find(e => e.op === 'create');
  assert.equal(create.key, 'create');
  assert.equal(create.args.fulfilments[0].amountMinor, 2 * 299 + 495);
  assert.equal(create.args.fulfilments[1].amountMinor, 1000);
  assert.equal(create.args.totalMinor, 2 * 299 + 495 + 1000);
});

test('the edition in force at p is used, even when a newer one is on disk (R1.3)', () => {
  const r = intake.step({ op: 'placed', order: { ...order, placedAt: '2026-07-01T10:00:00+02:00' } }, { key: 'ORD-1', state: null, now: NOW, files });
  assert.equal(r.output.edition, 'ed-2026-2');
  const before = intake.step({ op: 'placed', order }, { key: 'ORD-1', state: null, now: NOW, files });
  assert.equal(before.output.edition, 'ed-2026-1');
});

test('a placed order already recorded is a duplicate: no effect (R1.4)', () => {
  const s = intake.step({ op: 'placed', order }, { key: 'ORD-1', state: null, now: NOW, files });
  const dup = intake.step({ op: 'placed', order }, { key: 'ORD-1', state: s.state, now: NOW, files });
  assert.equal(dup.output.duplicate, true);
  assert.equal(dup.effects.length, 0);
});

test('the record succeeds: the order is recorded', () => {
  const s = intake.step({ op: 'placed', order }, { key: 'ORD-1', state: null, now: NOW, files });
  const plan = [{ fulfilmentId: 'ORD-1-F1', location: 'WH-AMS', items: order.items, available: true }];
  const a = intake.onEvent(allocated(plan), { key: 'ORD-1', state: s.state, now: NOW, files });
  const c = intake.onEvent({ type: 'effect.result', at: NOW, payload: { key: 'create', system: 'orders', op: 'create', status: 'ok' } },
    { key: 'ORD-1', state: a.state, now: NOW, files });
  assert.equal(c.output.status, 'recorded');
  assert.equal(c.output.busy, false);
});
