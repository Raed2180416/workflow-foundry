import test from 'node:test';
import assert from 'node:assert/strict';
import { programHarness } from './helpers/program.mjs';

const fx = programHarness('fulfilment');
const FID = 'ORD-1-F1';
const T = '2026-03-02T10:00:00+01:00';
const T2 = '2026-03-02T11:00:00+01:00';
const files = { 'rulebook/ed-2026-1/carrier-codes.json': JSON.stringify([
  { carrier: 'PARCELLA', code: 'COLLECTED', meaning: 'collected' },
  { carrier: 'PARCELLA', code: 'DELIVERED', meaning: 'delivered' },
  { carrier: 'PARCELLA', code: 'NOT_COLLECTED', meaning: 'collectionFailed' },
]) };
const statuses = { 'ORD-1': { order: 'processing', fulfilments: { [FID]: 'processing' } } };
const notices = { 'ORD-1': { customerId: 'C-1', sent: [] } };
const start = { op: 'start', orderId: 'ORD-1', customerId: 'C-1', currency: 'EUR', edition: 'ed-2026-1',
  fulfilment: { fulfilmentId: FID, location: 'WH-AMS', items: [{ sku: 'A', qty: 2 }, { sku: 'B', qty: 1 }], amountMinor: 2093 } };
const opts = (state, extra = {}) => ({ key: FID, state, now: T, files, states: { statuses, notices }, ...extra });
const eff = (r, op) => r.effects.find(e => e.op === op);
const result = (key, system, op, status, extra = {}) => ({ type: 'effect.result', at: T2, payload: { key, system, op, status, ...extra } });
const reserveOk = { type: 'effect.result', at: T2, payload: { system: 'inventory', op: 'reserve', status: 'ok',
  items: [{ key: 'item.A', status: 'ok' }, { key: 'item.B', status: 'ok' }] } };
// The state after the reservation and the charge are committed, and the shipment is booked.
function booked() {
  let s = fx.step(start, opts(null)).state;
  s = fx.step({ op: 'advance' }, opts(s)).state;
  s = fx.onEvent(reserveOk, opts(s)).state;
  s = fx.onEvent(result('charge', 'billing', 'charge', 'ok'), opts(s)).state;
  return fx.onEvent(result('ship', 'carrier', 'create', 'ok'), opts(s)).state;
}

test('reserve is one batch whose items carry the keys, no batch key (R4.2, §2)', () => {
  const s = fx.step(start, opts(null)).state;
  const r = fx.step({ op: 'advance' }, opts(s));
  assert.equal(r.effects.length, 1);
  assert.equal(r.effects[0].key, undefined);
  assert.deepEqual(r.effects[0].args.items.map(i => i.key), ['item.A', 'item.B']);
  assert.equal(r.effects[0].args.location, 'WH-AMS');
});

test('the charge follows a committed reservation; the shipment follows a committed charge (R4.2)', () => {
  const s = fx.step(start, opts(null)).state;
  const reserved = fx.onEvent(reserveOk, opts(fx.step({ op: 'advance' }, opts(s)).state));
  assert.equal(eff(reserved, 'charge').args.amountMinor, 2093);
  assert.equal(eff(reserved, 'charge').key, 'charge');
  const charged = fx.onEvent(result('charge', 'billing', 'charge', 'ok'), opts(reserved.state));
  assert.equal(eff(charged, 'create').key, 'ship');
  assert.equal(eff(charged, 'create').args.ref, FID);
});

test('a partial batch resubmits only the failed items, with their original keys (R4.2)', () => {
  const s = fx.step(start, opts(null)).state;
  const partial = { type: 'effect.result', at: T2, payload: { system: 'inventory', op: 'reserve', status: 'partial',
    items: [{ key: 'item.A', status: 'ok' }, { key: 'item.B', status: 'error', error: { code: 503, reason: 'busy', retryable: true } }] } };
  const r = fx.onEvent(partial, opts(fx.step({ op: 'advance' }, opts(s)).state));
  assert.equal(r.effects.length, 1);
  assert.deepEqual(r.effects[0].args.items.map(i => i.key), ['item.B']);
});

test('a declined card fails the fulfilment: release what committed, no refund, notice (R5.2, R5.1)', () => {
  const declined = fx.onEvent(result('charge', 'billing', 'charge', 'error', { error: { code: 402, reason: 'card-declined', retryable: false } }),
    opts(fx.onEvent(reserveOk, opts(fx.step({ op: 'advance' }, opts(fx.step(start, opts(null)).state)).state)).state));
  assert.equal(declined.output.state, 'failed');
  // the failure is noticed once, and only the reserved items are released (the charge did not commit)
  assert.deepEqual(declined.effects.map(e => e.key), ['f.ORD-1-F1.failed', 'fulfilment-failed.ORD-1-F1', 'release.A', 'release.B']);
  assert.equal(declined.effects.some(e => e.op === 'refund' || e.op === 'cancel'), false);
});

test('a 400 is our own mistake: the same step is re-issued, not failed (R4.2)', () => {
  const s = fx.onEvent(reserveOk, opts(fx.step({ op: 'advance' }, opts(fx.step(start, opts(null)).state)).state)).state;
  const r = fx.onEvent(result('charge', 'billing', 'charge', 'error', { error: { code: 400, reason: 'field-renamed', retryable: false } }), opts(s));
  assert.equal(r.output.state, 'running');
  assert.equal(eff(r, 'charge').key, 'charge');
});

test('a shipment after a committed charge that fails permanently refunds the charge and releases the items (R5.1)', () => {
  const s = fx.onEvent(result('charge', 'billing', 'charge', 'ok'), opts(fx.onEvent(reserveOk, opts(fx.step({ op: 'advance' }, opts(fx.step(start, opts(null)).state)).state)).state));
  const r = fx.onEvent(result('ship', 'carrier', 'create', 'error', { error: { code: 'permanent-failure', retryable: false } }), opts(s.state));
  assert.equal(r.output.state, 'failed');
  assert.deepEqual(r.effects.filter(e => e.op === 'refund' || e.op === 'release' || e.op === 'cancel').map(e => e.op), ['refund', 'release', 'release']);
});

test('a stop with a charge in flight: nothing new; the charge is refunded when it commits (R6.2)', () => {
  let s = fx.step(start, opts(null)).state;
  s = fx.onEvent(reserveOk, opts(fx.step({ op: 'advance' }, opts(s)).state)).state;     // charge now in flight
  const stopped = fx.step({ op: 'stop', at: T2 }, opts(s));
  // the reserved items are released now; nothing new is charged or booked
  assert.deepEqual(stopped.effects.map(e => e.op), ['release', 'release']);
  assert.equal(stopped.output.state, 'stopped');
  const late = fx.onEvent(result('charge', 'billing', 'charge', 'ok'), opts(stopped.state));
  assert.equal(eff(late, 'refund').key, 'refund');
  assert.equal(late.effects.some(e => e.op === 'create'), false);
  assert.equal(late.effects.filter(e => e.op === 'release').length, 0);       // released already at the stop
});

test('a collection moves the fulfilment to dispatched; delivery completes it (R4.4)', () => {
  const s = booked();
  const msg = (code, at) => ({ op: 'carrier', at, message: { carrier: 'PARCELLA', code, shipmentId: 'SHP-1', fulfilmentRef: FID, reportedAt: at } });
  const c = fx.step(msg('COLLECTED', T2), opts(s));
  assert.equal(c.output.state, 'dispatched');
  assert.deepEqual(c.effects.map(e => e.key), ['f.ORD-1-F1.dispatched']);
  assert.equal(c.output.reports[0].meaning, 'collected');
  const d = fx.step(msg('DELIVERED', T2), opts(c.state));
  assert.equal(d.output.state, 'completed');
  assert.equal(d.output.end, 'completed');
});

test('a delivery reported before the collection: dispatched first, then completed (R4.4)', () => {
  const s = booked();
  const r = fx.step({ op: 'carrier', at: T2, message: { carrier: 'PARCELLA', code: 'DELIVERED', shipmentId: 'SHP-1', fulfilmentRef: FID, reportedAt: T2 } }, opts(s));
  assert.equal(r.output.state, 'completed');
  assert.deepEqual(r.effects.map(e => e.key), ['f.ORD-1-F1.dispatched', 'f.ORD-1-F1.completed']);
  assert.equal(r.effects[1].after, 'f.ORD-1-F1.dispatched');
});

test('a collection failure fails the fulfilment and does not cancel the shipment (R5.2)', () => {
  const s = booked();
  const r = fx.step({ op: 'carrier', at: T2, message: { carrier: 'PARCELLA', code: 'NOT_COLLECTED', shipmentId: 'SHP-1', fulfilmentRef: FID, reportedAt: T2 } }, opts(s));
  assert.equal(r.output.state, 'failed');
  assert.equal(r.effects.some(e => e.op === 'cancel'), false);
  assert.equal(eff(r, 'refund').key, 'refund');
});

test('a carrier code the table does not list is info: no change (§3.3)', () => {
  const s = booked();
  const r = fx.step({ op: 'carrier', at: T2, message: { carrier: 'PARCELLA', code: 'WHATEVER', shipmentId: 'SHP-1', fulfilmentRef: FID, reportedAt: T2 } }, opts(s));
  assert.equal(r.output.state, 'running');
  assert.equal(r.output.reports.length, 0);
});
