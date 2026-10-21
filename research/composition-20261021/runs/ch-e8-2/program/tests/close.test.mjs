import test from 'node:test';
import assert from 'node:assert/strict';
import { moduleHarness } from '../compose-kit/kit.mjs';

const close = moduleHarness('close');
const NOW = '2026-03-02T11:00:00+01:00';
const opts = state => ({ key: 'ORD-1', state, now: NOW });

test('R6.1: a cancel sets the order cancelled and tells the customer with order-cancelled', () => {
  const r = close.step({ op: 'cancel', orderId: 'ORD-1', email: 'c@example.test', reason: 'customer' }, opts(null));
  assert.equal(r.violations.length, 0);
  assert.equal(r.effects.find(e => e.key === 'order-cancelled').args.status, 'cancelled');
  assert.equal(r.effects.find(e => e.key === 'notice').args.template, 'order-cancelled');
  assert.equal(r.output.phase, 'cancelled');
});

test('S15: the first decision wins; a later cancel changes nothing', () => {
  const first = close.step({ op: 'cancel', orderId: 'ORD-1', email: 'c@example.test', reason: 'fraud' }, opts(null));
  const again = close.step({ op: 'cancel', orderId: 'ORD-1', email: 'c@example.test', reason: 'customer' }, opts(first.state));
  assert.equal(again.effects.length, 0);
  assert.equal(again.output.already, true);
});

test('R6.3: a refused cancel sends cancel-refused once per cancel and changes no order status', () => {
  const r = close.step({ op: 'refuse', orderId: 'ORD-1', ref: 'evt-9', email: 'c@example.test' }, opts(null));
  assert.equal(r.effects.length, 1);
  assert.equal(r.effects[0].args.template, 'cancel-refused');
  assert.equal(r.effects.filter(e => e.system === 'orders').length, 0);
});

test('R4.1: the order is set processing when it becomes ready', () => {
  const r = close.step({ op: 'processing', orderId: 'ORD-1' }, opts(null));
  assert.equal(r.effects[0].args.status, 'processing');
  assert.equal(r.effects[0].args.fulfilmentId, null);
});

test('R4.5: completed if one fulfilment completed, else failed if one failed, else cancelled', () => {
  const done = close.step({ op: 'outcome', orderId: 'ORD-1', statuses: ['completed', 'failed'] }, opts(null));
  assert.equal(done.effects[0].args.status, 'completed');
  const failed = close.step({ op: 'outcome', orderId: 'ORD-1', statuses: ['failed', 'cancelled'] }, opts(null));
  assert.equal(failed.effects[0].args.status, 'failed');
  const cancelled = close.step({ op: 'outcome', orderId: 'ORD-1', statuses: ['cancelled', 'cancelled'] }, opts(null));
  assert.equal(cancelled.effects[0].args.status, 'cancelled');
});

test('R4.5: no outcome while a fulfilment has not ended, and none twice', () => {
  const open = close.step({ op: 'outcome', orderId: 'ORD-1', statuses: ['completed', 'processing'] }, opts(null));
  assert.equal(open.effects.length, 0);
  assert.equal(open.output.phase, 'open');
  const once = close.step({ op: 'outcome', orderId: 'ORD-1', statuses: ['completed'] }, opts(null));
  const twice = close.step({ op: 'outcome', orderId: 'ORD-1', statuses: ['completed'] }, opts(once.state));
  assert.equal(twice.effects.length, 0);
});
