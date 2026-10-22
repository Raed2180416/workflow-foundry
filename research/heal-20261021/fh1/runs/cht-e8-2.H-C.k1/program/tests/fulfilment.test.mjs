import test from 'node:test';
import assert from 'node:assert/strict';
import { runCall } from './_program.mjs';

const K = 'F1';
const ORD = 'ORD-1';
const READY = '2026-03-02T10:01:00+01:00';
const files = { 'rulebook/ED1/carrier-codes.json': [{ code: 'C1', meaning: 'collected' }, { code: 'C2', meaning: 'delivered' }, { code: 'C9', meaning: 'collectionFailed' }] };
const fulfilment = { fulfilmentId: 'F1', location: 'AMS', items: [{ sku: 'A', qty: 2 }, { sku: 'B', qty: 1 }], amountMinor: 2745 };
const base = {
  statuses: { [ORD]: { order: 'processing', f: { F1: 'processing' }, inflight: {}, last: null } },
  notices: { [ORD]: { customerId: 'C-1', email: 'b@example.nl', sent: {}, inflight: {} } },
};
const at = (t) => `2026-03-02T${t}+01:00`;
const result = (key, payload, t = '10:05:00') => ({ type: 'effect.result', at: at(t), payload: { key, system: '', op: '', ...payload } });
const names = effects => effects.map(e => (e.key ? e.key.split('/').slice(2).join('/') : e.op));
const run = (carry, opts) => runCall({ mod: 'fulfilment', key: K, carry, files, now: at('10:05:00'), ...opts });

function started() {
  return run(base, { input: { op: 'start', orderId: ORD, customerId: 'C-1', currency: 'EUR', edition: 'ED1', readyAt: READY, fulfilment } });
}

test('start: reserve every item in one batch, item keys per SKU (R4.2 step 1)', () => {
  const r = started();
  assert.equal(r.error, null);
  assert.deepEqual(names(r.effects), ['reserve']);
  const items = r.effects[0].args.items.map(i => i.key.split('/').slice(2).join('/')).sort();
  assert.deepEqual(items, ['item.A', 'item.B']);
  assert.equal(r.output.state, 'reserving');
  assert.equal(r.violations.length, 0);
});

test('a partial batch resubmits only the failed item, with its original key (R4.2)', () => {
  const s = started();
  const partial = result(undefined, { status: 'partial', items: [
    { key: 'item.A', status: 'ok' }, { key: 'item.B', status: 'error', error: { code: 'out-of-stock', retryable: true } }] });
  const r = runCall({ mod: 'fulfilment', key: K, event: partial, carry: s.carry, files, now: at('10:05:00') });
  assert.deepEqual(names(r.effects), ['reserve']);
  assert.deepEqual(r.effects[0].args.items.map(i => i.sku), ['B']);
  assert.ok(r.effects[0].args.items[0].key.endsWith('item.B'));
});

test('the forward chain: reserve, then charge with the amount, then ship with the ref (R4.2)', () => {
  const charge = runCall({ mod: 'fulfilment', key: K, event: result(undefined, { status: 'ok', items: [
    { key: 'item.A', status: 'ok' }, { key: 'item.B', status: 'ok' }] }), carry: started().carry, files });
  assert.deepEqual(names(charge.effects), ['charge']);
  assert.equal(charge.effects[0].args.amountMinor, 2745);
  assert.equal(charge.effects[0].args.customerId, 'C-1');
  const ship = runCall({ mod: 'fulfilment', key: K, event: result('charge', { status: 'ok' }), carry: charge.carry, files });
  assert.deepEqual(names(ship.effects), ['ship']);
  assert.equal(ship.effects[0].args.ref, 'F1');
  assert.equal(ship.effects[0].args.location, 'AMS');
});

function booked() {
  let c = started().carry;
  c = runCall({ mod: 'fulfilment', key: K, event: result(undefined, { status: 'ok', items: [
    { key: 'item.A', status: 'ok' }, { key: 'item.B', status: 'ok' }] }), carry: c, files }).carry;
  c = runCall({ mod: 'fulfilment', key: K, event: result('charge', { status: 'ok' }), carry: c, files }).carry;
  return runCall({ mod: 'fulfilment', key: K, event: result('ship', { status: 'ok' }), carry: c, files });
}

test('a delivered report sets dispatched first, then completed (R4.4), and ends the fulfilment', () => {
  const c = booked().carry;
  const r = run(c, { input: { op: 'carrier', at: at('11:00:00'), message: { code: 'C2', reportedAt: at('10:59:00'), carrier: 'X', shipmentId: 'S1' } } });
  assert.equal(r.output.end, 'completed');
  assert.equal(r.effects.length, 2);
  assert.equal(r.effects[0].args.status, 'dispatched');
  assert.equal(r.effects[1].args.status, 'completed');
  assert.equal(r.effects[1].after, 'statuses/ORD-1/f.F1.dispatched');
});

test('a declined charge fails the fulfilment and compensates the reservations, never the charge (R5.2, R5.1)', () => {
  let c = started().carry;
  c = runCall({ mod: 'fulfilment', key: K, event: result(undefined, { status: 'ok', items: [
    { key: 'item.A', status: 'ok' }, { key: 'item.B', status: 'ok' }] }), carry: c, files }).carry;
  const r = runCall({ mod: 'fulfilment', key: K, event: result('charge', { status: 'error', error: { code: 'card-declined', status: 402, retryable: false } }),
    carry: c, files, now: at('10:06:00') });
  assert.equal(r.output.end, 'failed');
  const n = names(r.effects);
  assert.ok(n.includes('release.A') && n.includes('release.B'));
  assert.ok(!n.some(x => x.startsWith('refund') || x === 'charge' || x === 'ship' || x === 'unship'));
  assert.ok(r.effects.some(e => e.args && e.args.status === 'failed'));
  assert.ok(r.effects.some(e => e.args && e.args.template === 'fulfilment-failed' && e.args.about === 'F1'));
});

test('a stop while a reservation is in flight: nothing new is reserved; the commit is released (R6.2)', () => {
  const s = started();
  const stopped = run(s.carry, { input: { op: 'stop', at: at('10:03:00') } });
  assert.equal(stopped.output.end, 'stopped');
  assert.equal(stopped.effects.length, 0);
  assert.equal(stopped.output.busy, true);
  const late = runCall({ mod: 'fulfilment', key: K, event: result(undefined, { status: 'ok', items: [
    { key: 'item.A', status: 'ok' }, { key: 'item.B', status: 'ok' }] }), carry: stopped.carry, files, now: at('10:04:00') });
  assert.deepEqual(names(late.effects).sort(), ['release.A', 'release.B']);
  assert.ok(!names(late.effects).includes('charge'));
});

test('a collectionFailed report fails the fulfilment and cancels no shipment (R5.2)', () => {
  const r = run(booked().carry, { input: { op: 'carrier', at: at('11:00:00'), message: { code: 'C9', reportedAt: at('10:59:00'), carrier: 'X', shipmentId: 'S1' } } });
  assert.equal(r.output.end, 'failed');
  assert.ok(!names(r.effects).includes('unship'));
  assert.ok(names(r.effects).includes('refund'));
});

test('a migrated dispatched fulfilment resumes from its records: a delivered report completes it (R4.4, §3.5)', () => {
  const carry = { ...base, statuses: { [ORD]: { order: 'processing', f: { F1: 'dispatched' }, inflight: {}, last: null } } };
  const records = { orderId: ORD, customerId: 'C-1', currency: 'EUR', edition: 'ED1', readyAt: READY, at: at('09:00:00'), fulfilment,
    status: 'dispatched', reservations: [{ sku: 'A', status: 'active' }, { sku: 'B', status: 'active' }],
    charges: [{ amountMinor: 2745, refundedMinor: 0 }], refunds: [], shipments: [{ status: 'inTransit' }] };
  const resumed = run(carry, { input: { op: 'resume', records: { fulfilment: records } } });
  assert.equal(resumed.output.state, 'dispatched');
  assert.equal(resumed.effects.length, 0);
  const r = run(resumed.carry, { input: { op: 'carrier', at: at('11:00:00'), message: { code: 'C2', reportedAt: at('10:59:00'), carrier: 'X', shipmentId: 'S1' } } });
  assert.equal(r.output.end, 'completed');
  assert.deepEqual(r.effects.map(e => e.args.status), ['completed']);
});

test('a migrated fulfilment with no reservation yet reserves its items when advanced (R4.2 step 1, §3.5)', () => {
  const records = { orderId: ORD, customerId: 'C-1', currency: 'EUR', edition: 'ED1', readyAt: READY, at: at('09:00:00'), fulfilment,
    status: 'processing', reservations: [], charges: [], refunds: [], shipments: [] };
  const resumed = run(base, { input: { op: 'resume', records: { fulfilment: records } } });
  const a = run(resumed.carry, { input: { op: 'advance' } });
  assert.deepEqual(names(a.effects), ['reserve']);
});
