import test from 'node:test';
import assert from 'node:assert';
import { moduleHarness } from '../compose-kit/kit.mjs';

const intake = moduleHarness('intake');
const NOW = '2026-03-02T10:00:00+01:00';
const files = {
  'master/catalog.json': [{ sku: 'S1', unitPriceMinor: 1000 }, { sku: 'S2', unitPriceMinor: 300 }],
  'master/customers.json': [{ customerId: 'C1', email: 'a@x.test' }],
  'rulebook/r1/shipping-fees.json': [{ location: 'WH-A', feeMinor: 500 }],
};
const order = { orderId: 'ORD-1', customerId: 'C1', placedAt: NOW, currency: 'EUR', items: [{ sku: 'S1', qty: 2 }, { sku: 'S2', qty: 1 }] };
const plan = {
  fulfilments: [
    { fulfilmentId: 'ORD-1-F1', location: 'WH-A', items: [{ sku: 'S1', qty: 2 }], available: true },
    { fulfilmentId: 'ORD-1-F2', location: null, items: [{ sku: 'S2', qty: 1 }], available: false },
  ],
};

test('place asks the inventory for the allocation (a read, no key)', () => {
  const r = intake.step({ op: 'place', order, edition: 'r1' }, { key: 'ORD-1', state: null, now: NOW, files });
  assert.equal(r.violations.length, 0);
  assert.equal(r.effects.length, 1);
  assert.equal(r.effects[0].system, 'inventory');
  assert.equal(r.effects[0].op, 'allocate');
  assert.equal(r.effects[0].key, undefined);
});

test('allocated: amounts are Σ qty × unit price plus the location fee; an unavailable fulfilment has no fee (R1.2)', () => {
  const r = intake.step({ op: 'allocated', order, plan, edition: 'r1' }, { key: 'ORD-1', state: null, now: NOW, files });
  assert.equal(r.violations.length, 0);
  assert.deepEqual(r.output.fl.map(f => [f.fid, f.av, f.amt]), [['ORD-1-F1', true, 2500], ['ORD-1-F2', false, 300]]);
  assert.equal(r.output.total, 2800);
  assert.equal(r.output.em, 'a@x.test');
});

test('allocated: the order is recorded once, with its fulfilments and total (R1.1)', () => {
  const r = intake.step({ op: 'allocated', order, plan, edition: 'r1' }, { key: 'ORD-1', state: null, now: NOW, files });
  assert.equal(r.effects.length, 1);
  assert.equal(r.effects[0].key, 'create');
  assert.equal(r.effects[0].op, 'create');
  assert.equal(r.effects[0].args.totalMinor, 2800);
  assert.deepEqual(r.effects[0].args.fulfilments.map(f => [f.fulfilmentId, f.location, f.amountMinor]), [['ORD-1-F1', 'WH-A', 2500], ['ORD-1-F2', null, 300]]);
});

test('an item the catalog does not price is an error, not a guessed amount', () => {
  const bad = { ...order, items: [{ sku: 'NOPE', qty: 1 }] };
  const badPlan = { fulfilments: [{ fulfilmentId: 'ORD-1-F1', location: 'WH-A', items: [{ sku: 'NOPE', qty: 1 }], available: true }] };
  const r = intake.step({ op: 'allocated', order: bad, plan: badPlan, edition: 'r1' }, { key: 'ORD-1', state: null, now: NOW, files });
  assert.match(String(r.error), /no unitPriceMinor for NOPE/);
});
