import test from 'node:test';
import assert from 'node:assert/strict';
import { programHarness } from './helpers/program.mjs';

const op = programHarness('order-progress');
const T = '2026-03-02T10:00:00+01:00';
const sets = r => r.effects.map(e => `${e.args.fulfilmentId ?? 'order'}=${e.args.status}`);
const ready = { op: 'ready', orderId: 'ORD-1', at: T, fulfilments: [{ fulfilmentId: 'ORD-1-F1', available: true }, { fulfilmentId: 'ORD-1-F2', available: false }] };
const opts = (statuses, state = null) => ({ key: 'ORD-1', state, now: T, states: { statuses: { 'ORD-1': statuses } } });

test('ready sets the order and every available fulfilment to processing, once (R4.1)', () => {
  const r = op.step(ready, opts({ order: 'pending', fulfilments: { 'ORD-1-F1': 'pending', 'ORD-1-F2': 'unavailable' } }));
  assert.deepEqual(sets(r), ['order=processing', 'ORD-1-F1=processing']);
  assert.equal(r.output.state, 'processing');
  const again = op.step(ready, { ...opts({ order: 'processing', fulfilments: {} }), state: r.state });
  assert.equal(again.effects.length, 0);
});

test('the order completes when one fulfilment completed and the others ended (R4.5)', () => {
  const ended = op.step({ op: 'ended', orderId: 'ORD-1', fulfilmentId: 'ORD-1-F2', end: 'failed', at: T },
    { key: 'ORD-1', state: { state: 'processing', outcome: null, at: T }, now: T, states: { statuses: { 'ORD-1': { order: 'processing', fulfilments: { 'ORD-1-F1': 'completed', 'ORD-1-F2': 'failed' } } } } });
  assert.deepEqual(sets(ended), ['order=completed']);
  assert.equal(ended.output.outcome, 'completed');
});

test('the outcome is failed, else cancelled, when no fulfilment completed (R4.5)', () => {
  const failed = op.step({ op: 'ended', orderId: 'ORD-1', fulfilmentId: 'ORD-1-F2', end: 'failed', at: T },
    { key: 'ORD-1', state: { state: 'processing', outcome: null, at: T }, now: T, states: { statuses: { 'ORD-1': { order: 'processing', fulfilments: { 'ORD-1-F1': 'cancelled', 'ORD-1-F2': 'failed' } } } } });
  assert.deepEqual(sets(failed), ['order=failed']);
  const cancelled = op.step({ op: 'ended', orderId: 'ORD-1', fulfilmentId: 'ORD-1-F1', end: 'stopped', at: T },
    { key: 'ORD-1', state: { state: 'processing', outcome: null, at: T }, now: T, states: { statuses: { 'ORD-1': { order: 'processing', fulfilments: { 'ORD-1-F1': 'cancelled', 'ORD-1-F2': 'cancelled' } } } } });
  assert.deepEqual(sets(cancelled), ['order=cancelled']);
});

test('while a fulfilment is still open, the order is not decided (R4.5)', () => {
  const r = op.step({ op: 'ended', orderId: 'ORD-1', fulfilmentId: 'ORD-1-F2', end: 'failed', at: T },
    { key: 'ORD-1', state: { state: 'processing', outcome: null, at: T }, now: T, states: { statuses: { 'ORD-1': { order: 'processing', fulfilments: { 'ORD-1-F1': 'processing', 'ORD-1-F2': 'failed' } } } } });
  assert.equal(r.effects.length, 0);
  assert.equal(r.output.state, 'processing');
});

test('a stop from cancellation stops the order, so R4.5 does not decide it (R6.2)', () => {
  const r = op.step({ op: 'stop', orderId: 'ORD-1', at: T }, { key: 'ORD-1', state: { state: 'processing', outcome: null, at: T }, now: T, states: {} });
  assert.equal(r.output.state, 'stopped');
  assert.equal(r.effects.length, 0);
});
