import test from 'node:test';
import assert from 'node:assert/strict';
import { moduleHarness } from '../compose-kit/kit.mjs';

const wait = moduleHarness('wait');
const P = '2026-03-02T10:00:00+01:00';           // placedAt: the anchor of D (S1)
const NOW = '2026-03-02T11:00:00+01:00';
const fulfilments = [{ fulfilmentId: 'F1', available: true }, { fulfilmentId: 'F2', available: false }];
const arm = { op: 'arm', orderId: 'ORD-1', p: P, customerActionHours: 48, email: 'c@example.test', fulfilments };
const armed = () => wait.step(arm, { key: 'ORD-1', state: null, now: NOW });

test('R3.1: the order is set customerActionRequired and the customer is told, within the window', () => {
  const r = armed();
  assert.equal(r.violations.length, 0);
  const status = r.effects.find(e => e.key === 'status');
  assert.equal(status.args.status, 'customerActionRequired');
  assert.equal(status.args.fulfilmentId, null);
  const notice = r.effects.find(e => e.key === 'notice');
  assert.equal(notice.args.template, 'action-required');
  assert.equal(notice.args.to, 'c@example.test');
});

test('R3.2: the deadline D is p plus customerActionHours; the timer sits one minute after it', () => {
  const r = armed();
  assert.equal(r.output.D, '2026-03-04T09:00:00.000Z');
  assert.equal(r.obligations.upsert[0].id, 'deadline');
  assert.equal(r.obligations.upsert[0].dueAt, '2026-03-04T09:01:00.000Z');
});

test('R3.2: an amend exactly at D counts: the unavailable fulfilment is cancelled and the rest is ready', () => {
  const s = armed();
  const r = wait.step({ op: 'action', at: '2026-03-04T09:00:00.000Z', action: 'amend' }, { key: 'ORD-1', state: s.state, now: '2026-03-04T09:00:00.000Z' });
  assert.equal(r.output.counted, 'amend');
  assert.equal(r.output.nothingAvailable, false);
  assert.equal(r.effects.length, 1);
  assert.equal(r.effects[0].args.fulfilmentId, 'F2');
  assert.equal(r.effects[0].args.status, 'cancelled');
});

test('R3.2: a cancel counts within the window; later actions change nothing (S5, S8)', () => {
  const s = armed();
  const c = wait.step({ op: 'action', at: '2026-03-03T08:00:00+01:00', action: 'cancel' }, { key: 'ORD-1', state: s.state, now: NOW });
  assert.equal(c.output.counted, 'cancel');
  const later = wait.step({ op: 'action', at: '2026-03-03T09:00:00+01:00', action: 'amend' }, { key: 'ORD-1', state: c.state, now: NOW });
  assert.equal(later.output.counted, null);
  assert.equal(later.effects.length, 0);
});

test('R3.2: an action after D does not count', () => {
  const s = armed();
  const r = wait.step({ op: 'action', at: '2026-03-04T09:00:01.000Z', action: 'cancel' }, { key: 'ORD-1', state: s.state, now: NOW });
  assert.equal(r.output.counted, null);
});

test('R3.2: nothing counted by D: every fulfilment cancelled, the order timedOut, the customer told', () => {
  const s = armed();
  const r = wait.onEvent({ type: 'timer.fired', at: '2026-03-04T09:01:00.000Z', payload: { obligationId: 'deadline', onDue: 'timeout' } },
    { key: 'ORD-1', state: s.state, now: '2026-03-04T09:01:00.000Z' });
  assert.equal(r.output.timedOut, true);
  assert.equal(r.effects.filter(e => e.op === 'setStatus' && e.args.status === 'cancelled').length, 2);
  const order = r.effects.find(e => e.key === 'order-timedout');
  assert.equal(order.args.status, 'timedOut');
  assert.equal(r.effects.find(e => e.key === 'notice-timeout').args.template, 'order-timed-out');
});

test('go-live: a window already open is adopted with its deadline and without notices again', () => {
  const r = wait.step({ op: 'adopt', orderId: 'ORD-1', p: P, customerActionHours: 48, email: 'a@x.example',
    fulfilments: [{ fulfilmentId: 'ORD-1-F2', available: false }] }, { key: 'ORD-1', state: null, now: NOW, files: {} });
  assert.equal(r.violations.length, 0);
  assert.equal(r.effects.length, 0);
  assert.equal(r.obligations.upsert[0].dueAt, '2026-03-04T09:01:00.000Z');
});
