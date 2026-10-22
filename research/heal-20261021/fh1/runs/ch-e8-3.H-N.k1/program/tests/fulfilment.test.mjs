import test from 'node:test';
import assert from 'node:assert';
import { moduleHarness } from '../compose-kit/kit.mjs';

const fulfilment = moduleHarness('fulfilment');
const key = 'ORD-1-F1';
const NOW = '2026-03-02T10:00:00+01:00';
const files = {};
const fInput = {
  orderId: 'ORD-1', fulfilmentId: 'ORD-1-F1', location: 'WH-A', customerId: 'C1', currency: 'EUR',
  amountMinor: 2500, items: [{ sku: 'S1', qty: 2 }, { sku: 'S2', qty: 1 }], email: 'a@x.test',
};
const result = (name, status, extra = {}) => ({ type: 'effect.result', at: NOW, payload: { key: name.key, system: name.system, op: name.op, status, ...extra } });
const RES = { system: 'inventory', op: 'reserve', key: 'r.S1' };
const CHARGE = { system: 'billing', op: 'charge', key: 'charge' };
const SHIP = { system: 'carrier', op: 'create', key: 'ship' };
const names = eff => eff.map(e => e.key).sort();

// start, and reserve every item: the charge is the next step
const reserved = () => {
  const s0 = fulfilment.step({ op: 'start', fulfilment: fInput }, { key, state: null, now: NOW, files });
  const r = fulfilment.onEvent(result(RES, 'ok'), { key, state: s0.state, now: NOW, files });
  return { s0, r };
};

test('start reserves every item of the fulfilment in one keyed-by-item batch', () => {
  const r = fulfilment.step({ op: 'start', fulfilment: fInput }, { key, state: null, now: NOW, files });
  assert.equal(r.violations.length, 0);
  assert.equal(r.effects.length, 1);
  assert.equal(r.effects[0].op, 'reserve');
  assert.deepEqual(r.effects[0].args.items.map(i => [i.key, i.sku, i.qty]), [['r.S1', 'S1', 2], ['r.S2', 'S2', 1]]);
});

test('all reserved: charge the fulfilment amount; charge ok: book the shipment with its ref', () => {
  const { r } = reserved();
  assert.deepEqual(names(r.effects), ['charge']);
  assert.equal(r.effects[0].args.amountMinor, 2500);
  const c = fulfilment.onEvent(result(CHARGE, 'ok'), { key, state: r.state, now: NOW, files });
  assert.deepEqual(names(c.effects), ['ship']);
  assert.equal(c.effects[0].args.ref, 'ORD-1-F1');
});

test('the carrier reports collected then delivered: dispatched, then completed (R4.4)', () => {
  let { r } = reserved();
  r = fulfilment.onEvent(result(CHARGE, 'ok'), { key, state: r.state, now: NOW, files });
  r = fulfilment.onEvent(result(SHIP, 'ok'), { key, state: r.state, now: NOW, files });
  assert.equal(r.effects.length, 0);
  const col = fulfilment.step({ op: 'carrier', report: { meaning: 'collected', reportedAt: NOW, code: 'C' } }, { key, state: r.state, now: NOW, files });
  assert.deepEqual(names(col.effects), ['st.dispatched']);
  const del = fulfilment.step({ op: 'carrier', report: { meaning: 'delivered', reportedAt: NOW, code: 'D' } }, { key, state: col.state, now: NOW, files });
  assert.deepEqual(names(del.effects), ['st.completed']);
  assert.deepEqual(del.output.ended, { fid: 'ORD-1-F1', status: 'completed', at: NOW });
});

test('a declined card fails the fulfilment: release what committed, set failed, notify once (R5.2)', () => {
  let { r } = reserved();
  r = fulfilment.onEvent({ type: 'effect.result', at: NOW, payload: { key: 'charge', system: 'billing', op: 'charge', status: 'error', error: { code: 'card-declined', retryable: false } } },
    { key, state: r.state, now: NOW, files });
  assert.deepEqual(names(r.effects), ['n.failed', 'rel.S1', 'rel.S2', 'st.failed']);
  assert.deepEqual(r.output.ended, { fid: 'ORD-1-F1', status: 'failed', at: NOW });
  assert.equal(r.effects.some(e => e.op === 'refund'), false);
});

test('a cancel while the shipment is in flight waits for it, then undoes shipment, charge and reservations in that order (S14)', () => {
  let { r } = reserved();
  r = fulfilment.onEvent(result(CHARGE, 'ok'), { key, state: r.state, now: NOW, files });
  const c = fulfilment.step({ op: 'cancel', at: NOW, reason: 'customer' }, { key, state: r.state, now: NOW, files });
  assert.equal(c.effects.length, 0);
  assert.equal(c.output.ended, null);
  const s = fulfilment.onEvent(result(SHIP, 'ok'), { key, state: c.state, now: NOW, files });
  assert.deepEqual(s.effects.map(e => e.op), ['cancel', 'refund', 'release', 'release', 'setStatus']);
  assert.deepEqual(s.output.ended, { fid: 'ORD-1-F1', status: 'cancelled', at: NOW });
});

test('a charge that commits after the cancel is refunded and its reservations released (S14)', () => {
  let { r } = reserved();
  const c = fulfilment.step({ op: 'cancel', at: NOW, reason: 'customer' }, { key, state: r.state, now: NOW, files });
  assert.equal(c.effects.length, 0);
  const late = fulfilment.onEvent(result(CHARGE, 'ok'), { key, state: c.state, now: NOW, files });
  assert.deepEqual(late.effects.map(e => e.op), ['refund', 'release', 'release', 'setStatus']);
  assert.deepEqual(late.output.ended, { fid: 'ORD-1-F1', status: 'cancelled', at: NOW });
  assert.equal(late.effects.some(e => e.op === 'charge' || e.op === 'create'), false);
});

test('a fulfilment that was never started has nothing to undo: the order module sets its status', () => {
  const c = fulfilment.step({ op: 'cancel', at: NOW, reason: 'customer' }, { key, state: null, now: NOW, files });
  assert.equal(c.violations.length, 0);
  assert.equal(c.effects.length, 0);
  assert.equal(c.output, null);
});

test('go-live resume: reserved items are not reserved again, a missing shipment is booked once the charge is committed', () => {
  const r = fulfilment.step({ op: 'resume', fulfilment: fInput, reserved: ['S1', 'S2'], charged: true, shipped: false, dispatched: false }, { key, state: null, now: NOW, files });
  assert.equal(r.violations.length, 0);
  assert.deepEqual(names(r.effects), ['ship']);
  assert.equal(r.state.ch, 'ok');
});

test('go-live resume: a reservation still missing is issued again with its stable item key', () => {
  const r = fulfilment.step({ op: 'resume', fulfilment: fInput, reserved: ['S1'], charged: false, shipped: false, dispatched: false }, { key, state: null, now: NOW, files });
  assert.equal(r.effects.length, 1);
  assert.deepEqual(r.effects[0].args.items.map(i => i.key), ['r.S2']);
});
