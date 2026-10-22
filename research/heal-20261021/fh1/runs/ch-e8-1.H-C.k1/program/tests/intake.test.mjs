import test from 'node:test';
import assert from 'node:assert/strict';
import { moduleHarness } from '../compose-kit/kit.mjs';

const intake = moduleHarness('intake');
const files = {
  'rulebook/ed1/edition.json': { id: 'ed1', effectiveFrom: '2026-01-01' },
  'rulebook/ed1/shipping-fees.json': [{ location: 'AMS', feeMinor: 500 }],
  'master/catalog.json': [{ sku: 'SKU-1', unitPriceMinor: 1000 }],
};
const order = {
  orderId: 'ORD-1',
  customerId: 'C1',
  placedAt: '2026-03-02T10:00:00+01:00',
  currency: 'EUR',
  items: [{ sku: 'SKU-1', qty: 2 }],
};
const at = '2026-03-02T10:01:00+01:00';
const result = (key, status, payload = {}) => ({
  id: `e-${key}`, type: 'effect.result', at,
  payload: { key, system: key === 'fraud' ? 'fraud' : 'inventory', op: key, status, ...payload },
});

function placed() {
  const r = intake.step({ op: 'place', order }, { key: 'ORD-1', files, now: order.placedAt });
  assert.equal(r.violations.length, 0);
  assert.deepEqual(r.effects.map(e => e.key), ['allocate', 'fraud']);
  return r;
}

test('reads the allocation and the fraud verdict, and records nothing until both have answered', () => {
  const s = placed();
  const a = intake.onEvent(result('allocate', 'ok', {
    fulfilments: [
      { fulfilmentId: 'ORD-1-F1', location: 'AMS', items: [{ sku: 'SKU-1', qty: 1 }] },
      { fulfilmentId: 'ORD-1-F2', location: null, items: [{ sku: 'SKU-1', qty: 1 }] },
    ],
  }), { key: 'ORD-1', state: s.state, files, now: at });
  assert.equal(a.violations.length, 0);
  assert.equal(a.effects.length, 0);
  assert.equal(a.output.status, 'waiting');
});

test('records the order with amounts: a fee for a located fulfilment, none for an unavailable one', () => {
  const s = placed();
  const a = intake.onEvent(result('allocate', 'ok', {
    fulfilments: [
      { fulfilmentId: 'ORD-1-F1', location: 'AMS', items: [{ sku: 'SKU-1', qty: 1 }] },
      { fulfilmentId: 'ORD-1-F2', location: null, items: [{ sku: 'SKU-1', qty: 1 }] },
    ],
  }), { key: 'ORD-1', state: s.state, files, now: at });
  const b = intake.onEvent(result('fraud', 'ok', { verdict: 'pass' }), { key: 'ORD-1', state: a.state, files, now: at });
  assert.equal(b.violations.length, 0);
  assert.equal(b.output.status, 'recorded');
  assert.equal(b.output.verdict, 'pass');
  assert.equal(b.output.edition, 'ed1');
  assert.equal(b.effects.length, 1);
  const create = b.effects[0];
  assert.equal(create.system, 'orders');
  assert.equal(create.op, 'create');
  assert.equal(create.key, 'create');
  assert.deepEqual(create.args.fulfilments.map(f => f.amountMinor), [1500, 1000]);
  assert.equal(create.args.totalMinor, 2500);
  assert.equal(create.args.placedAt, order.placedAt);
});

test('a fraud verdict of review or reject is passed on, not acted on here', () => {
  const s = placed();
  const a = intake.onEvent(result('allocate', 'ok', {
    fulfilments: [{ fulfilmentId: 'ORD-1-F1', location: 'AMS', items: [{ sku: 'SKU-1', qty: 2 }] }],
  }), { key: 'ORD-1', state: s.state, files, now: at });
  const b = intake.onEvent(result('fraud', 'ok', { verdict: 'reject' }), { key: 'ORD-1', state: a.state, files, now: at });
  assert.equal(b.output.verdict, 'reject');
  assert.equal(b.output.fulfilments[0].amountMinor, 2500);
});
