import test from 'node:test';
import assert from 'node:assert/strict';
import { moduleHarness } from '../compose-kit/kit.mjs';

const fulfil = moduleHarness('fulfil');
const NOW = '2026-03-02T11:00:00+01:00';
const KEY = 'ORD-1.F1';
const start = {
  op: 'start', orderId: 'ORD-1', fid: 'F1', location: 'WH-A', customerId: 'C1', email: 'c@example.test',
  currency: 'EUR', amountMinor: 1300, items: [{ sku: 'SKU-1', qty: 2 }, { sku: 'SKU-3', qty: 1 }],
};
const res = (key, status, extra = {}) => ({ type: 'effect.result', at: NOW, payload: { key, system: 'x', op: 'y', status, ...extra } });
const begun = () => fulfil.step(start, { key: KEY, state: null, now: NOW });
const onr = (state, ev) => fulfil.onEvent(ev, { key: KEY, state, now: NOW });

test('R4.1/R4.2: the fulfilment is processing and its items are reserved at its location', () => {
  const r = begun();
  assert.equal(r.violations.length, 0);
  assert.equal(r.effects[0].args.status, 'processing');
  const reserve = r.effects[1];
  assert.equal(reserve.op, 'reserve');
  assert.equal(reserve.args.location, 'WH-A');
  assert.deepEqual(reserve.args.items.map(i => i.key), ['r0', 'r1']);
});

test('R4.2: a partial batch resubmits only the failed items, with their original keys', () => {
  const s = begun();
  const r = onr(s.state, res('reserve', 'partial', { items: [{ key: 'r0', status: 'ok' }, { key: 'r1', status: 'error', error: { code: 'no-stock', retryable: true } }] }));
  assert.equal(r.effects.length, 1);
  assert.equal(r.effects[0].op, 'reserve');
  assert.deepEqual(r.effects[0].args.items, [{ key: 'r1', sku: 'SKU-3', qty: 1 }]);
});

test('R4.2: committed reservations charge the amount, then the shipment is booked with the fulfilment as ref', () => {
  const s = begun();
  const r1 = onr(s.state, res('reserve', 'ok'));
  const charge = r1.effects.find(e => e.key === 'charge');
  assert.equal(charge.system, 'billing');
  assert.equal(charge.args.amountMinor, 1300);
  const r2 = onr(r1.state, res('charge', 'ok'));
  const ship = r2.effects.find(e => e.key === 'ship');
  assert.equal(ship.system, 'carrier');
  assert.equal(ship.args.ref, 'F1');
  const r3 = onr(r2.state, res('ship', 'ok'));
  assert.equal(r3.output.phase, 'shipped');
});

test('R5.2: a declined charge fails the fulfilment; the reservation is released, the charge is not refunded', () => {
  const s = begun();
  const r1 = onr(s.state, res('reserve', 'ok'));
  const r2 = onr(r1.state, res('charge', 'error', { error: { code: 'card-declined', retryable: false } }));
  assert.equal(r2.output.phase, 'failed');
  assert.equal(r2.effects.filter(e => e.op === 'refund').length, 0);
  assert.equal(r2.effects.filter(e => e.op === 'release').length, 2);
  assert.equal(r2.effects.find(e => e.key === 'status-failed').args.status, 'failed');
  assert.equal(r2.effects.find(e => e.key === 'notice').args.template, 'fulfilment-failed');
});

test('R5.1/R6.2: a cancel after the charge committed compensates in reverse order: refund, then release', () => {
  const s = begun();
  const r1 = onr(s.state, res('reserve', 'ok'));
  const r2 = onr(r1.state, res('charge', 'ok'));
  const c = fulfil.step({ op: 'compensate', reason: 'cancelled' }, { key: KEY, state: r2.state, now: NOW });
  const ops = c.effects.map(e => e.op);
  assert.deepEqual(ops, ['refund', 'release', 'release', 'setStatus']);
  assert.equal(c.effects.find(e => e.op === 'refund').args.amountMinor, 1300);
  assert.equal(c.effects.at(-1).args.status, 'cancelled');
  // a second compensation undoes nothing again
  const again = fulfil.step({ op: 'compensate', reason: 'cancelled' }, { key: KEY, state: c.state, now: NOW });
  assert.equal(again.effects.filter(e => e.op === 'refund' || e.op === 'release').length, 0);
});

test('S14: a step that commits after the fulfilment was cancelled is compensated at once', () => {
  const s = begun();
  const c = fulfil.step({ op: 'compensate', reason: 'cancelled' }, { key: KEY, state: s.state, now: NOW });
  const late = onr(c.state, res('reserve', 'ok'));
  assert.equal(late.output.lateUndo, true);
  assert.equal(late.effects.filter(e => e.op === 'release').length, 2);
  assert.equal(late.effects.filter(e => e.op === 'charge').length, 0);
});

test('R4.4: a collection, then a delivery, completes the fulfilment (dispatched before completed)', () => {
  const s = begun();
  const r1 = onr(s.state, res('reserve', 'ok'));
  const r2 = onr(r1.state, res('charge', 'ok'));
  const r3 = onr(r2.state, res('ship', 'ok'));
  const col = fulfil.step({ op: 'carrier', meaning: 'collected', reportedAt: NOW }, { key: KEY, state: r3.state, now: NOW });
  assert.equal(col.output.phase, 'dispatched');
  assert.equal(col.effects[0].args.status, 'dispatched');
  const del = fulfil.step({ op: 'carrier', meaning: 'delivered', reportedAt: NOW }, { key: KEY, state: col.state, now: NOW });
  assert.equal(del.effects.length, 1);
  assert.equal(del.effects[0].args.status, 'completed');
});

test('R4.4: a delivery that reaches first sets dispatched, then completed', () => {
  const s = begun();
  const r1 = onr(s.state, res('reserve', 'ok'));
  const r2 = onr(r1.state, res('charge', 'ok'));
  const r3 = onr(r2.state, res('ship', 'ok'));
  const del = fulfil.step({ op: 'carrier', meaning: 'delivered', reportedAt: NOW }, { key: KEY, state: r3.state, now: NOW });
  assert.deepEqual(del.effects.map(e => e.args.status), ['dispatched', 'completed']);
});

test('R5.2: a failed collection fails the fulfilment and does not cancel the shipment', () => {
  const s = begun();
  const r1 = onr(s.state, res('reserve', 'ok'));
  const r2 = onr(r1.state, res('charge', 'ok'));
  const r3 = onr(r2.state, res('ship', 'ok'));
  const f = fulfil.step({ op: 'carrier', meaning: 'collectionFailed', reportedAt: NOW }, { key: KEY, state: r3.state, now: NOW });
  assert.equal(f.output.phase, 'failed');
  assert.equal(f.effects.filter(e => e.op === 'cancel').length, 0);
  assert.equal(f.effects.filter(e => e.op === 'refund').length, 1);
});

test('go-live: a fulfilment whose charge is recorded but whose shipment is not continues with the shipment', () => {
  const r = fulfil.step({ op: 'adopt', orderId: 'ORD-1', fid: 'ORD-1-F1', location: 'WH-EIN', customerId: 'C-1', email: 'a@x.example',
    currency: 'EUR', amountMinor: 100, items: [{ sku: 'SKU-1', qty: 1 }], dispatched: false, reservedSkus: ['SKU-1'], charged: true, shipped: false },
    { key: 'ORD-1.ORD-1-F1', state: null, now: NOW, files: {} });
  assert.equal(r.violations.length, 0);
  assert.equal(r.output.phase, 'shipping');
  assert.deepEqual(r.effects.map(e => e.key), ['ship']);
});
