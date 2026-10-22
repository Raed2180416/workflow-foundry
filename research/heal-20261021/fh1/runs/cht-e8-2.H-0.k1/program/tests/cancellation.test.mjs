import test from 'node:test';
import assert from 'node:assert/strict';
import { runCall } from './_program.mjs';

const K = 'ORD-1';
const CANCEL = '2026-03-03T10:00:00+01:00';
const processingCarry = (reports) => ({
  statuses: { [K]: { order: 'processing', f: { F1: 'processing' }, inflight: {}, last: null } },
  fulfilment: { F1: { started: true, oid: K, cust: 'C-1', cur: 'EUR', edition: 'ED1', readyAt: '2026-03-02T10:01:00+01:00',
    f: { fulfilmentId: 'F1', location: 'AMS', items: [{ sku: 'A', qty: 1 }], amountMinor: 1495 }, items: {}, rel: {}, charge: 'none',
    ship: 'none', unship: 'none', refund: 'none', end: null, endedAt: null, stopAt: null, failed: false, cfail: false,
    dispatched: false, collected: false, reports, announced: false, inflight: {}, batches: 0 } },
  'order-progress': { [K]: { status: 'processing', outcome: null, at: null } },
  notices: { [K]: { customerId: 'C-1', email: 'b@example.nl', sent: {}, inflight: {} } },
});
const customerCancel = (carry, at = CANCEL) => runCall({ mod: 'cancellation', key: K, carry,
  input: { op: 'customer-cancel', orderId: K, at, eventId: 'evt-9', phase: 'processing' } });

test('R6.2 vs S7: a collection reported before the cancel refuses it, with cancel-refused (R6.3)', () => {
  const r = customerCancel(processingCarry([{ meaning: 'collected', reportedAt: '2026-03-03T08:00:00+01:00' }]));
  assert.equal(r.error, null);
  assert.equal(r.output.verdict, 'refused');
  assert.ok(r.effects.some(e => e.args.template === 'cancel-refused'));
  assert.ok(!r.effects.some(e => e.args && e.args.status === 'cancelled'));
});

test('a collection reported after the cancel does not refuse it (S7); the cancel counts and stops the fulfilment', () => {
  const r = customerCancel(processingCarry([{ meaning: 'collected', reportedAt: '2026-03-03T11:00:00+01:00' }]));
  assert.equal(r.output.verdict, 'counts');
  assert.ok(r.effects.some(e => e.args.fulfilmentId === 'F1' && e.args.status === 'cancelled'));
  assert.ok(r.effects.some(e => e.args.fulfilmentId === null && e.args.status === 'cancelled'));
  assert.ok(r.effects.some(e => e.args.template === 'order-cancelled'));
});

test('a cancel before clearing counts (R6.4): fraud is stopped, the order cancelled for the customer', () => {
  const carry = {
    statuses: { [K]: { order: 'pending', f: { F1: 'pending' }, inflight: {}, last: null } },
    notices: { [K]: { customerId: 'C-1', email: 'b@example.nl', sent: {}, inflight: {} } },
    fraud: { [K]: { state: 'review', deadline: '2026-03-03T10:00:00+01:00', tasks: 1, placedAt: '2026-03-02T10:00:00+01:00', edition: 'ED1' } },
  };
  const r = runCall({ mod: 'cancellation', key: K, carry, input: { op: 'customer-cancel', orderId: K, at: CANCEL, eventId: 'evt-2', phase: 'not-cleared' } });
  assert.equal(r.output.verdict, 'counts');
  assert.equal(r.carry.fraud[K].state, 'stopped');
});

test('an ended order changes nothing (R6.3, S15)', () => {
  const r = runCall({ mod: 'cancellation', key: K, input: { op: 'customer-cancel', orderId: K, at: CANCEL, eventId: 'evt-3', phase: 'ended' } });
  assert.equal(r.output.verdict, 'nothing');
  assert.equal(r.effects.length, 0);
});
