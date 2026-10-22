import test from 'node:test';
import assert from 'node:assert/strict';
import { programHarness } from './helpers/program.mjs';

const ca = programHarness('customer-action');
const P = '2026-03-02T09:30:00+01:00';            // p; D = p + 4 h = 2026-03-02T12:30:00Z
const D = '2026-03-02T12:30:00.000Z';
const files = { 'rulebook/ed-2026-1/policy.json': JSON.stringify({ customerActionHours: 4, fraudReviewHours: 24, collectionCutoffMinutes: 30 }) };
const fulfilments = [{ fulfilmentId: 'ORD-1-F1', available: true }, { fulfilmentId: 'ORD-1-F2', available: false }];
const statuses = { 'ORD-1': { order: 'pending', fulfilments: { 'ORD-1-F1': 'pending', 'ORD-1-F2': 'unavailable' } } };
const opts = (state, extra = {}) => ({ key: 'ORD-1', state, now: P, files, states: { statuses, notices: {} }, ...extra });
const start = (fs = fulfilments) => ca.step({ op: 'start', orderId: 'ORD-1', placedAt: P, edition: 'ed-2026-1', fulfilments: fs }, opts(null));
const waiting = () => ca.step({ op: 'advance', clearedAt: P }, opts(start().state)).state;
const sets = r => r.effects.filter(e => e.system === 'orders' && e.op === 'setStatus').map(e => `${e.args.fulfilmentId ?? 'order'}=${e.args.status}`);

test('nothing unavailable: no wake-up, nothing to do (R3.1)', () => {
  const r = start([{ fulfilmentId: 'ORD-1-F1', available: true }]);
  assert.equal(r.output.state, 'inert');
  assert.equal(r.obligations.upsert.length, 0);
});

test('an unavailable item sets the deadline D = p + customerActionHours, with a wake-up just after D (R3.2, S1)', () => {
  const r = start();
  assert.equal(r.output.state, 'review');
  assert.equal(r.obligations.upsert[0].id, 'deadline');
  assert.equal(r.obligations.upsert[0].dueAt, '2026-03-02T13:00:00.000Z');
});

test('after clearing: customerActionRequired and action-required, within the window (R3.1)', () => {
  const r = ca.step({ op: 'advance', clearedAt: P }, opts(start().state));
  assert.equal(r.output.state, 'waiting');
  assert.deepEqual(sets(r), ['order=customerActionRequired']);
  assert.equal(r.effects.find(e => e.system === 'notify').args.template, 'action-required');
});

test('an amend at D counts: the unavailable items are cancelled and the order is ready (R3.2)', () => {
  const r = ca.step({ op: 'action', action: 'amend', at: D }, opts(waiting()));
  assert.equal(r.output.state, 'ready');
  assert.deepEqual(sets(r), ['ORD-1-F2=cancelled']);
});

test('an action after D changes nothing (R3.2)', () => {
  const r = ca.step({ op: 'action', action: 'cancel', at: '2026-03-02T12:30:01.000Z' }, opts(waiting()));
  assert.equal(r.output.state, 'waiting');
  assert.equal(r.effects.length, 0);
});

test('a cancel counts with reason customer and the wake-up is withdrawn (R3.2)', () => {
  const r = ca.step({ op: 'action', action: 'cancel', at: '2026-03-02T11:00:00.000Z' }, opts(waiting()));
  assert.equal(r.output.state, 'cancel');
  assert.equal(r.output.reason, 'customer');
  assert.deepEqual(r.obligations.cancel, ['deadline']);
});

test('an amend with nothing available cancels the order for nothing-available (R3.2)', () => {
  const s = start([{ fulfilmentId: 'ORD-1-F2', available: false }]).state;
  const r = ca.step({ op: 'action', action: 'amend', at: '2026-03-02T11:00:00.000Z' }, opts(s));
  assert.equal(r.output.state, 'cancel');
  assert.equal(r.output.reason, 'nothing-available');
});

test('nothing counted by D: after D every fulfilment cancelled, the order timed out, one notice (R3.2)', () => {
  const r = ca.onEvent({ type: 'timer.fired', at: '2026-03-02T13:00:00.000Z', payload: { obligationId: 'deadline' } },
    opts(waiting()));
  assert.equal(r.output.state, 'timedOut');
  assert.deepEqual(sets(r).sort(), ['ORD-1-F1=cancelled', 'ORD-1-F2=cancelled', 'order=timedOut']);
  assert.equal(r.effects.find(e => e.system === 'notify').args.template, 'order-timed-out');
});
