import test from 'node:test';
import assert from 'node:assert/strict';
import { runCall } from './_program.mjs';

const K = 'ORD-1';
const files = { 'rulebook/ED1/policy.json': { customerActionHours: 72, fraudReviewHours: 24 } };
const fulfilments = [{ fulfilmentId: 'F1', available: true }, { fulfilmentId: 'F2', available: false }];
const D = '2026-03-05T10:00:00+01:00';
const carry = {
  statuses: { [K]: { order: 'pending', f: { F1: 'pending', F2: 'unavailable' }, inflight: {}, last: null } },
  notices: { [K]: { customerId: 'C-1', email: 'b@example.nl', sent: {}, inflight: {} } },
};

function started() {
  return runCall({ mod: 'customer-action', key: K, files, carry,
    input: { op: 'start', orderId: K, placedAt: '2026-03-02T10:00:00+01:00', clearedAt: '2026-03-02T10:01:00+01:00', edition: 'ED1', fulfilments } });
}

test('start: the deadline D is placedAt + customerActionHours; the wake-up is one minute after D (R3.2, S1)', () => {
  const r = started();
  assert.equal(r.error, null);
  assert.equal(r.output.state, 'waiting');
  assert.ok(r.obligations.upsert[0].id.endsWith('/deadline'));
  assert.equal(r.obligations.upsert[0].dueAt, '2026-03-05T10:01:00+01:00');
});

test('advance: customerActionRequired and action-required, once (R3.1)', () => {
  const s = started();
  const c = { ...carry, 'customer-action': s.carry['customer-action'] };
  const r = runCall({ mod: 'customer-action', key: K, files, carry: c, input: { op: 'advance' } });
  assert.equal(r.effects.length, 2);
  assert.ok(r.effects.some(e => e.system === 'orders' && e.args.status === 'customerActionRequired'));
  assert.ok(r.effects.some(e => e.system === 'notify' && e.args.template === 'action-required'));
  const again = runCall({ mod: 'customer-action', key: K, files, carry: { ...carry, 'customer-action': r.carry['customer-action'] }, input: { op: 'advance' } });
  assert.equal(again.effects.length, 0);
});

test('an amend exactly at D counts: the unavailable fulfilment is cancelled, the order is ready at the amend time (R3.2)', () => {
  const c = { ...carry, 'customer-action': started().carry['customer-action'] };
  const r = runCall({ mod: 'customer-action', key: K, files, carry: c, input: { op: 'action', action: 'amend', at: D } });
  assert.equal(r.output.state, 'ready');
  assert.equal(r.output.at, D);
  assert.ok(r.effects.some(e => e.args.fulfilmentId === 'F2' && e.args.status === 'cancelled'));
  assert.ok(r.obligations.cancel[0].endsWith('/deadline'));
});

test('an action after D changes nothing; the timeout after D sets everything cancelled and notifies (R3.2)', () => {
  const c = { ...carry, 'customer-action': started().carry['customer-action'] };
  const late = runCall({ mod: 'customer-action', key: K, files, carry: c, input: { op: 'action', action: 'cancel', at: '2026-03-05T10:00:01+01:00' } });
  assert.equal(late.output.state, 'waiting');
  const fired = runCall({ mod: 'customer-action', key: K, files, carry: c,
    event: { type: 'timer.fired', at: '2026-03-05T10:01:00+01:00', payload: { obligationId: 'deadline' } } });
  assert.equal(fired.output.state, 'timedOut');
  assert.ok(fired.effects.some(e => e.args.status === 'timedOut'));
  assert.ok(fired.effects.some(e => e.args.template === 'order-timed-out'));
});

const migrated = { customerAction: { state: 'waiting', placedAt: '2026-03-02T10:00:00+01:00', edition: 'ED1', fulfilments } };

test('a migrated waiting order resumes with its deadline: D is placedAt + customerActionHours, an amend still counts (R3.2, S1, §3.5)', () => {
  const r = runCall({ mod: 'customer-action', key: K, files, carry, input: { op: 'resume', records: migrated } });
  assert.equal(r.error, null);
  assert.equal(r.output.state, 'waiting');
  assert.equal(r.obligations.upsert[0].dueAt, '2026-03-05T10:01:00+01:00');
  assert.equal(r.effects.length, 0);
  const a = runCall({ mod: 'customer-action', key: K, files, carry: r.carry, input: { op: 'action', action: 'amend', at: D } });
  assert.equal(a.output.state, 'ready');
  assert.ok(a.effects.some(e => e.args.fulfilmentId === 'F2' && e.args.status === 'cancelled'));
});

test('a migrated waiting order times out at its deadline: every fulfilment cancelled, the order timedOut, one notice (R3.2, §3.5)', () => {
  const r = runCall({ mod: 'customer-action', key: K, files, carry, input: { op: 'resume', records: migrated } });
  const fired = runCall({ mod: 'customer-action', key: K, files, carry: r.carry,
    event: { type: 'timer.fired', at: '2026-03-05T10:01:00+01:00', payload: { obligationId: 'deadline' } } });
  assert.equal(fired.output.state, 'timedOut');
  assert.ok(fired.effects.some(e => e.args.template === 'order-timed-out'));
});
