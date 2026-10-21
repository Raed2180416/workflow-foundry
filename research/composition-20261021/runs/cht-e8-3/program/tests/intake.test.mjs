import test from 'node:test';
import assert from 'node:assert/strict';
import { moduleHarness } from '../compose-kit/kit.mjs';

const intake = moduleHarness('intake');
const PLACED = '2026-03-02T10:00:00+01:00';
const files = {
  'master/catalog.json': [{ sku: 'A', unitPriceMinor: 500 }, { sku: 'B', unitPriceMinor: 300 }],
  'rulebook/ed-2026-01/edition.json': { id: 'ed-2026-01', effectiveFrom: '2026-01-01' },
  'rulebook/ed-2026-01/shipping-fees.json': [{ location: 'UTR', feeMinor: 495 }],
  'rulebook/ed-2026-06/edition.json': { id: 'ed-2026-06', effectiveFrom: '2026-06-01' },
  'rulebook/ed-2026-06/shipping-fees.json': [{ location: 'UTR', feeMinor: 595 }],
};
const order = { orderId: 'ORD-1', customerId: 'C1', placedAt: PLACED, currency: 'EUR', items: [{ sku: 'A', qty: 2 }, { sku: 'B', qty: 1 }] };

test('a placed order asks for the allocation once', () => {
  const r = intake.step({ op: 'placed', order }, { key: 'ORD-1', state: null, now: PLACED, files });
  assert.equal(r.violations.length, 0);
  assert.equal(r.output.status, 'allocating');
  assert.equal(r.effects.length, 1);
  assert.equal(r.effects[0].key, 'allocate');
  assert.equal(r.effects[0].op, 'allocate');
});

test('a repeated placed order is a duplicate and emits nothing', () => {
  const first = intake.step({ op: 'placed', order }, { key: 'ORD-1', state: null, now: PLACED, files });
  const again = intake.step({ op: 'placed', order }, { key: 'ORD-1', state: first.state, now: PLACED, files });
  assert.equal(again.output.duplicate, true);
  assert.equal(again.effects.length, 0);
});

test('amounts: items plus the location fee; an unavailable fulfilment has no fee; totals add up', () => {
  const first = intake.step({ op: 'placed', order }, { key: 'ORD-1', state: null, now: PLACED, files });
  const allocated = {
    key: 'allocate', system: 'inventory', op: 'allocate', status: 'ok',
    result: { fulfilments: [
      { fulfilmentId: 'F1', location: 'UTR', available: true, items: [{ sku: 'A', qty: 2 }] },
      { fulfilmentId: 'F2', location: null, available: false, items: [{ sku: 'B', qty: 1 }] },
    ] },
  };
  const r = intake.onEvent({ type: 'effect.result', at: '2026-03-02T10:01:00+01:00', payload: allocated }, { key: 'ORD-1', state: first.state, now: PLACED, files });
  assert.equal(r.violations.length, 0);
  const create = r.effects.find(e => e.key === 'create');
  assert.ok(create, 'orders.create is emitted');
  assert.equal(create.op, 'create');
  const [f1, f2] = create.args.fulfilments;
  assert.equal(f1.amountMinor, 2 * 500 + 495);
  assert.equal(f2.amountMinor, 300);
  assert.equal(create.args.totalMinor, 1495 + 300);
});

test('the edition in force at placedAt is used, not a newer one already on disk', () => {
  const first = intake.step({ op: 'placed', order }, { key: 'ORD-1', state: null, now: PLACED, files });
  const allocated = { key: 'allocate', status: 'ok', result: { fulfilments: [{ fulfilmentId: 'F1', location: 'UTR', available: true, items: [{ sku: 'A', qty: 1 }] }] } };
  const r = intake.onEvent({ type: 'effect.result', at: '2026-03-02T10:01:00+01:00', payload: allocated }, { key: 'ORD-1', state: first.state, now: PLACED, files });
  assert.equal(r.output.edition, 'ed-2026-01');
  assert.equal(r.effects.find(e => e.key === 'create').args.fulfilments[0].amountMinor, 500 + 495);
});

test('the record commit makes the order recorded', () => {
  const first = intake.step({ op: 'placed', order }, { key: 'ORD-1', state: null, now: PLACED, files });
  const a = intake.onEvent({ type: 'effect.result', at: '2026-03-02T10:01:00+01:00', payload: { key: 'allocate', status: 'ok', result: { fulfilments: [{ fulfilmentId: 'F1', location: 'UTR', available: true, items: [{ sku: 'A', qty: 1 }] }] } } }, { key: 'ORD-1', state: first.state, now: PLACED, files });
  const b = intake.onEvent({ type: 'effect.result', at: '2026-03-02T10:02:00+01:00', payload: { key: 'create', status: 'ok' } }, { key: 'ORD-1', state: a.state, now: PLACED, files });
  assert.equal(b.output.status, 'recorded');
  assert.equal(b.output.fulfilments.length, 1);
});
