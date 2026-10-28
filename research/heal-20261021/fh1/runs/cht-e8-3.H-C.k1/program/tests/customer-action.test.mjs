import test from 'node:test';
import assert from 'node:assert/strict';
import { moduleHarness } from '../compose-kit/kit.mjs';

const ca = moduleHarness('customer-action');
const PLACED = '2026-03-02T10:00:00+01:00';
const D = '2026-03-04T10:00:00+01:00';
const files = { 'rulebook/ed-2026-01/policy.json': { customerActionHours: 48, fraudReviewHours: 24 } };
const started = () => ca.step({
  op: 'start', placedAt: PLACED, edition: 'ed-2026-01',
  fulfilments: [{ fulfilmentId: 'F1', available: true }, { fulfilmentId: 'F2', available: false }],
}, { key: 'ORD-1', state: null, now: PLACED, files });

test('start sets the deadline D = placedAt + customerActionHours, the wake-up is after D', () => {
  const r = started();
  assert.equal(r.violations.length, 0);
  assert.equal(r.output.state, 'pending');
  assert.equal(r.obligations.upsert[0].id, 'deadline');
  assert.equal(r.obligations.upsert[0].dueAt, '2026-03-04T10:01:00+01:00');
});

test('a cancel exactly at D counts', () => {
  const r = ca.step({ op: 'cleared', at: '2026-03-02T11:00:00+01:00' }, { key: 'ORD-1', state: started().state, now: PLACED, files });
  assert.equal(r.output.state, 'waiting');
  const c = ca.step({ op: 'action', action: 'cancel', at: D }, { key: 'ORD-1', state: r.state, now: D, files });
  assert.equal(c.output.state, 'cancel');
  assert.equal(c.output.reason, 'customer');
  assert.deepEqual(c.obligations.cancel, ['deadline']);
});

test('a cancel after D changes nothing', () => {
  const r = ca.step({ op: 'cleared', at: '2026-03-02T11:00:00+01:00' }, { key: 'ORD-1', state: started().state, now: PLACED, files });
  const late = ca.step({ op: 'action', action: 'cancel', at: '2026-03-04T10:00:01+01:00' }, { key: 'ORD-1', state: r.state, now: D, files });
  assert.equal(late.output.state, 'waiting');
});

test('stop cancels the deadline and ends the customer clock', () => {
  const r = ca.step({ op: 'stop' }, { key: 'ORD-1', state: started().state, now: PLACED, files });
  assert.equal(r.output.state, 'stopped');
  assert.deepEqual(r.obligations.cancel, ['deadline']);
});
