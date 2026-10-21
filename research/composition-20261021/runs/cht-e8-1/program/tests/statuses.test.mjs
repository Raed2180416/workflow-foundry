import test from 'node:test';
import assert from 'node:assert/strict';
import { moduleHarness } from '../compose-kit/kit.mjs';

const st = moduleHarness('statuses');
const NOW = '2026-03-02T10:00:00+01:00';
const FULS = [{ fulfilmentId: 'F1', location: 'AMS' }, { fulfilmentId: 'F2', location: null }];

function init() {
  return st.step({ op: 'init', fulfilments: FULS }, { key: 'ORD-1', state: null, now: NOW });
}

test('init records pending order and unavailable fulfilment without effects (R7.2)', () => {
  const r = init();
  assert.equal(r.violations.length, 0);
  assert.equal(r.effects.length, 0);
  assert.equal(r.state.order, 'pending');
  assert.deepEqual(r.state.fulfilments, { F1: 'pending', F2: 'unavailable' });
});

test('set before init is refused (R4.1)', () => {
  const r = st.step({ op: 'set', orderId: 'ORD-1', fulfilmentId: 'F1', status: 'processing' }, { key: 'ORD-1', state: null, now: NOW });
  assert.equal(r.effects.length, 0);
});

test('forward move emits one setStatus with a stable key', () => {
  const s = init();
  const r = st.step({ op: 'set', orderId: 'ORD-1', fulfilmentId: 'F1', status: 'processing' }, { key: 'ORD-1', state: s.state, now: NOW });
  assert.equal(r.effects.length, 1);
  assert.equal(r.effects[0].key, 'f.F1.processing');
  assert.deepEqual(r.effects[0].args, { orderId: 'ORD-1', fulfilmentId: 'F1', status: 'processing' });
});

test('a repeat or a backward move emits nothing (R7.2)', () => {
  let s = init();
  s = st.step({ op: 'set', orderId: 'ORD-1', fulfilmentId: 'F1', status: 'processing' }, { key: 'ORD-1', state: s.state, now: NOW });
  const again = st.step({ op: 'set', orderId: 'ORD-1', fulfilmentId: 'F1', status: 'processing' }, { key: 'ORD-1', state: s.state, now: NOW });
  assert.equal(again.effects.length, 0);
  const back = st.step({ op: 'set', orderId: 'ORD-1', fulfilmentId: 'F1', status: 'pending' }, { key: 'ORD-1', state: s.state, now: NOW });
  assert.equal(back.effects.length, 0);
});

test('unavailable to cancelled is allowed (R3.2, R6.1)', () => {
  const s = init();
  const r = st.step({ op: 'set', orderId: 'ORD-1', fulfilmentId: 'F2', status: 'cancelled' }, { key: 'ORD-1', state: s.state, now: NOW });
  assert.equal(r.effects.length, 1);
  assert.equal(r.effects[0].key, 'f.F2.cancelled');
});

test('delivered without dispatched: dispatched first, completed after it (R4.4)', () => {
  let s = init();
  s = st.step({ op: 'set', orderId: 'ORD-1', fulfilmentId: 'F1', status: 'processing' }, { key: 'ORD-1', state: s.state, now: NOW });
  const r = st.step({ op: 'set', orderId: 'ORD-1', fulfilmentId: 'F1', status: 'completed', afterStatus: 'dispatched' }, { key: 'ORD-1', state: s.state, now: NOW });
  assert.deepEqual(r.effects.map(e => e.key), ['f.F1.dispatched', 'f.F1.completed']);
  assert.equal(r.effects[1].after, 'f.F1.dispatched');
});

test('order status is set on the order (fulfilmentId null)', () => {
  let s = init();
  s = st.step({ op: 'set', orderId: 'ORD-1', fulfilmentId: null, status: 'processing' }, { key: 'ORD-1', state: s.state, now: NOW });
  assert.equal(s.effects[0].key, 'order.processing');
  assert.equal(s.effects[0].args.fulfilmentId, null);
});
