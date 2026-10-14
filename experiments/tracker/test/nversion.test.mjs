import test from 'node:test';
import assert from 'node:assert/strict';
import { signatures, vote } from '../nversion.mjs';

const emit = (em, system, op, args) => ({ type: 'effect.emit', emission: em, effect: { system, op, args } });
const led = (em, system, op, committed = true) => ({ type: 'ledger', emission: em, system, op, committed });

test('signatures join ledger rows to their emitted args and key by the order id the workflow emitted', () => {
  const rows = [emit('e1', 'orders', 'create', { orderId: 'A' }), led('e1', 'orders', 'create'),
    emit('e2', 'orders', 'setStatus', { orderId: 'A', fulfilmentId: null, status: 'processing' }), led('e2', 'orders', 'setStatus'),
    emit('e3', 'notify', 'send', { orderId: 'A', template: 'order-confirmed' }), led('e3', 'notify', 'send'),
    emit('e4', 'billing', 'charge', { orderId: 'A' }), led('e4', 'billing', 'charge', false)];   // uncommitted: ignored
  const s = JSON.parse(signatures(rows).get('A'));
  assert.deepEqual(s.ops, [['notify.send', 1], ['orders.create', 1], ['orders.setStatus', 1]]);
  assert.deepEqual(s.st, ['O:processing']);
  assert.deepEqual(s.nt, ['order-confirmed']);
});

test('vote: a strict majority names the minority as suspects; a split is unresolved and flags nobody', () => {
  const m = sig => new Map([['A', sig]]);
  const v = vote([m('x'), m('x'), m('y')]).get('A');
  assert.deepEqual(v.suspects, [2]); assert.equal(v.unresolved, false); assert.equal(v.consensus, 'x');
  const t = vote([m('x'), m('x'), m('y'), m('y')]).get('A');
  assert.equal(t.unresolved, true); assert.deepEqual(t.suspects, []);
  const missing = vote([m('x'), m('x'), new Map()]).get('A');
  assert.deepEqual(missing.suspects, [2]);                       // a build that never acted on the order is a suspect
});
