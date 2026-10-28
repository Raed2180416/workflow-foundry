import test from 'node:test';
import assert from 'node:assert/strict';
import { moduleHarness } from '../compose-kit/kit.mjs';

const saga = moduleHarness('saga');
const files = {};
const now = '2026-03-02T10:02:00+01:00';
const OK_ITEMS = [{ key: 'r0', status: 'ok' }, { key: 'r1', status: 'ok' }];
const key = 'ORD-1.ORD-1-F1';
const start = {
  op: 'start', orderId: 'ORD-1', fid: 'ORD-1-F1', location: 'AMS',
  items: [{ sku: 'SKU-1', qty: 1 }, { sku: 'SKU-2', qty: 2 }],
  amountMinor: 1500, customerId: 'C1', currency: 'EUR',
};

// Feed one effect result (or a list of them) back to the saga; returns the last call's result.
function feed(state, system, op, k, status, extra = {}, opts = {}) {
  return saga.onEvent({ id: `e-${k}`, type: 'effect.result', at: now, payload: { ...(k === undefined ? {} : { key: k }), system, op, status, ...extra } },
    { key, state, files, now, ...opts });
}

function started() {
  const r = saga.step(start, { key, state: null, files, now });
  assert.equal(r.violations.length, 0);
  assert.equal(r.error, null);
  return r;
}

test('start: the fulfilment is processing, and its items are reserved in one batch with item keys', () => {
  const r = started();
  assert.equal(r.effects[0].key, 'fs-processing');
  assert.equal(r.effects[0].args.status, 'processing');
  assert.equal(r.effects[1].key, undefined, 'a batch is keyed by its items');
  assert.equal(r.effects[1].op, 'reserve');
  assert.deepEqual(r.effects[1].args.items.map(i => i.key), ['r0', 'r1']);
});

test('the forward steps run one after the other: charge after the reservations, shipment after the charge', () => {
  const r = started();
  const a = feed(r.state, 'inventory', 'reserve', undefined, 'ok', { items: [{ key: 'r0', status: 'ok' }, { key: 'r1', status: 'ok' }] });
  assert.deepEqual(a.effects.map(e => e.key), ['charge']);
  assert.equal(a.effects[0].args.amountMinor, 1500);
  assert.equal(a.effects[0].args.customerId, 'C1');
  const b = feed(a.state, 'billing', 'charge', 'charge', 'ok');
  assert.equal(b.effects.length, 1);
  assert.equal(b.effects[0].system, 'carrier');
  assert.equal(b.effects[0].op, 'create');
  assert.equal(b.effects[0].args.location, 'AMS');
  assert.equal(b.effects[0].args.ref, 'ORD-1.ORD-1-F1');
  const c = feed(b.state, 'carrier', 'create', 'ship', 'ok');
  assert.equal(c.effects.length, 0);
});

test('a partial reserve is resubmitted for the failed item only, with its original key', () => {
  const r = started();
  const a = feed(r.state, 'inventory', 'reserve', undefined, 'partial', { items: [{ key: 'r0', status: 'ok' }, { key: 'r1', status: 'failed' }] });
  assert.equal(a.effects.length, 1);
  assert.equal(a.effects[0].op, 'reserve');
  assert.deepEqual(a.effects[0].args.items, [{ key: 'r1', sku: 'SKU-2', qty: 2 }]);
});

test('a carrier collection marks the fulfilment dispatched; delivery completes it', () => {
  let r = started();
  r = feed(r.state, 'inventory', 'reserve', undefined, 'ok', { items: OK_ITEMS });
  r = feed(r.state, 'billing', 'charge', 'charge', 'ok');
  r = feed(r.state, 'carrier', 'create', 'ship', 'ok');
  const c = saga.step({ op: 'carrier', meaning: 'collected', reportedAt: now }, { key, state: r.state, files, now });
  assert.deepEqual(c.effects.map(e => e.key), ['fs-dispatched']);
  const d = saga.step({ op: 'carrier', meaning: 'delivered', reportedAt: now }, { key, state: c.state, files, now });
  assert.deepEqual(d.effects.map(e => e.key), ['fs-completed']);
  assert.equal(d.output.term, 'completed');
});

test('a declined charge fails the fulfilment: the reserved items are released in order, then failed and notified', () => {
  let r = started();
  r = feed(r.state, 'inventory', 'reserve', undefined, 'ok', { items: OK_ITEMS });
  const a = feed(r.state, 'billing', 'charge', 'charge', 'error', { error: { code: 'card-declined', retryable: false } });
  assert.deepEqual(a.effects.map(e => e.key), ['release-0']);
  const b = feed(a.state, 'inventory', 'release', 'release-0', 'ok');
  assert.deepEqual(b.effects.map(e => e.key), ['release-1']);
  const c = feed(b.state, 'inventory', 'release', 'release-1', 'ok');
  assert.deepEqual(c.effects.map(e => e.key), ['fs-failed']);
  assert.equal(c.output.term, 'failed');
});

test('cancel after the shipment is booked: cancel the shipment, refund the charge, release the items, then cancelled', () => {
  let r = started();
  r = feed(r.state, 'inventory', 'reserve', undefined, 'ok', { items: OK_ITEMS });
  r = feed(r.state, 'billing', 'charge', 'charge', 'ok');
  r = feed(r.state, 'carrier', 'create', 'ship', 'ok');
  const c = saga.step({ op: 'cancel' }, { key, state: r.state, files, now });
  assert.deepEqual(c.effects.map(e => e.key), ['cancel-ship']);
  const d = feed(c.state, 'carrier', 'cancel', 'cancel-ship', 'ok');
  assert.deepEqual(d.effects.map(e => e.key), ['refund']);
  assert.equal(d.effects[0].args.amountMinor, 1500);
  const e = feed(d.state, 'billing', 'refund', 'refund', 'ok');
  assert.deepEqual(e.effects.map(x => x.key), ['release-0']);
  const f = feed(e.state, 'inventory', 'release', 'release-0', 'ok');
  const g = feed(f.state, 'inventory', 'release', 'release-1', 'ok');
  assert.deepEqual(g.effects.map(x => x.key), ['fs-cancelled']);
  assert.equal(g.output.term, 'cancelled');
});

test('a collection failure fails the fulfilment without cancelling a shipment that was not collected', () => {
  let r = started();
  r = feed(r.state, 'inventory', 'reserve', undefined, 'ok', { items: OK_ITEMS });
  r = feed(r.state, 'billing', 'charge', 'charge', 'ok');
  r = feed(r.state, 'carrier', 'create', 'ship', 'ok');
  const c = saga.step({ op: 'carrier', meaning: 'collectionFailed', reportedAt: now }, { key, state: r.state, files, now });
  assert.deepEqual(c.effects.map(e => e.key), ['refund']);
  assert.ok(!c.effects.some(e => e.key === 'cancel-ship'));
});

test('a cancel refused because the carrier collected first stops the undo: the fulfilment carries on', () => {
  let r = started();
  r = feed(r.state, 'inventory', 'reserve', undefined, 'ok', { items: OK_ITEMS });
  r = feed(r.state, 'billing', 'charge', 'charge', 'ok');
  r = feed(r.state, 'carrier', 'create', 'ship', 'ok');
  const c = saga.step({ op: 'cancel' }, { key, state: r.state, files, now });
  const d = feed(c.state, 'carrier', 'cancel', 'cancel-ship', 'error', { error: { code: 'already-collected', retryable: false } });
  assert.equal(d.effects.length, 0);
  assert.equal(d.output.term, null);
  const e = saga.step({ op: 'carrier', meaning: 'delivered', reportedAt: now }, { key, state: d.state, files, now });
  assert.equal(e.output.term, 'completed');
});
