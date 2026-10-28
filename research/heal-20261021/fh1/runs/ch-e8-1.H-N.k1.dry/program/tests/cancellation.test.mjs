import test from 'node:test';
import assert from 'node:assert/strict';
import { programHarness } from './helpers/program.mjs';

const cx = programHarness('cancellation');
const F1 = 'ORD-1-F1', F2 = 'ORD-1-F2';
const T = '2026-03-02T10:00:00+01:00';
const CANCEL = '2026-03-02T11:00:00+01:00';
// A fulfilment as its module holds it: running, with the given reports and nothing committed yet.
const fulfilmentWith = reports => ({ orderId: 'ORD-1', fid: F1, customerId: 'C-1', currency: 'EUR', edition: 'ed-2026-1', location: 'WH-AMS',
  items: [{ sku: 'A', qty: 1 }], amountMinor: 299, phase: 'running', batches: 0, reserve: { A: 'none' }, charge: 'none', ship: 'none',
  shipUndo: 'none', refund: 'none', collectionFailed: false, dispatched: false, reports, end: null, endedAt: null });
const base = (statuses, reports = [], fulfilmentStates = {}) => ({
  key: 'ORD-1', state: null, now: CANCEL,
  states: {
    statuses: { 'ORD-1': statuses },
    'order-progress': { 'ORD-1': { state: 'processing', outcome: null, at: T } },
    notices: { 'ORD-1': { customerId: 'C-1', sent: [] } },
    fulfilment: { [F1]: fulfilmentWith(reports), ...fulfilmentStates },
  },
});
const processing = { order: 'processing', fulfilments: { [F1]: 'processing', [F2]: 'pending' } };
const cancel = (phase, eventId = 'ev-9') => ({ op: 'customer-cancel', orderId: 'ORD-1', at: CANCEL, eventId, phase, fulfilmentIds: [F1, F2] });
const noticeKeys = r => r.effects.filter(e => e.system === 'notify').map(e => e.key);
const statusSets = r => r.effects.filter(e => e.system === 'orders').map(e => `${e.args.fulfilmentId ?? 'order'}=${e.args.status}`);

test('a cancel before clearing counts: the order and its fulfilments are cancelled, one notice (R6.4)', () => {
  const statuses = { order: 'pending', fulfilments: { [F1]: 'pending', [F2]: 'unavailable' } };
  const r = cx.step(cancel('not-cleared'), base(statuses));
  assert.equal(r.output.verdict, 'counts');
  assert.deepEqual(statusSets(r), [`${F1}=cancelled`, `${F2}=cancelled`, 'order=cancelled']);
  assert.deepEqual(noticeKeys(r), ['order-cancelled.ORD-1']);
});

test('a collection reported before the cancel refuses it: cancel-refused, nothing else (R6.3, S7)', () => {
  const r = cx.step(cancel('processing'), base(processing, [{ meaning: 'collected', reportedAt: T }]));
  assert.equal(r.output.verdict, 'refused');
  assert.deepEqual(noticeKeys(r), ['cancel-refused.ev-9']);
  assert.equal(statusSets(r).length, 0);
});

test('a report of transit or delivery also proves collection (S7)', () => {
  for (const meaning of ['inTransit', 'delivered']) {
    const r = cx.step(cancel('processing'), base(processing, [{ meaning, reportedAt: T }]));
    assert.equal(r.output.verdict, 'refused', meaning);
  }
});

test('a collection in the same instant as the cancel wins (S4, S7)', () => {
  const r = cx.step(cancel('processing'), base(processing, [{ meaning: 'collected', reportedAt: CANCEL }]));
  assert.equal(r.output.verdict, 'refused');
});

test('no collection before the cancel: it counts, every open fulfilment is stopped and cancelled (R6.2)', () => {
  const r = cx.step(cancel('processing'), base(processing, [{ meaning: 'collected', reportedAt: '2026-03-02T12:00:00+01:00' }]));
  assert.equal(r.output.verdict, 'counts');
  assert.deepEqual(statusSets(r), [`${F1}=cancelled`, `${F2}=cancelled`, 'order=cancelled']);
  assert.deepEqual(noticeKeys(r), ['order-cancelled.ORD-1']);
});

test('an ended order changes nothing (R6.3, S15)', () => {
  const r = cx.step(cancel('ended'), base({ order: 'completed', fulfilments: { [F1]: 'completed' } }));
  assert.equal(r.output.verdict, 'nothing');
  assert.equal(r.effects.length, 0);
});

test('cancel-order cancels the open fulfilments and the order with its reason (R6.1)', () => {
  const r = cx.step({ op: 'cancel-order', orderId: 'ORD-1', at: CANCEL, reason: 'fraud' },
    base({ order: 'pending', fulfilments: { [F1]: 'pending', [F2]: 'pending' } }));
  assert.equal(r.output.verdict, 'done');
  assert.equal(r.output.reason, 'fraud');
  assert.deepEqual(statusSets(r), [`${F1}=cancelled`, `${F2}=cancelled`, 'order=cancelled']);
});
