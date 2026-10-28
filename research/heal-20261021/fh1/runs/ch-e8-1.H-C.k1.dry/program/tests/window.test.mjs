import test from 'node:test';
import assert from 'node:assert/strict';
import { moduleHarness } from '../compose-kit/kit.mjs';

const window_ = moduleHarness('window');
const files = {
  'rulebook/ed1/edition.json': { id: 'ed1', effectiveFrom: '2026-01-01' },
  'rulebook/ed1/policy.json': { fraudReviewHours: 24, customerActionHours: 48 },
  'master/customers.json': [{ customerId: 'C1', email: 'c1@example.test' }],
};
const p = '2026-03-02T10:00:00+01:00';
const cleared = '2026-03-02T10:02:00+01:00';
const D = '2026-03-04T10:00:00+01:00';
const opts = (state, now, extra = {}) => ({ key: 'ORD-1', state, files, now, ...extra });

function open() {
  const r = window_.step({ op: 'open', orderId: 'ORD-1', p, customerId: 'C1', unavailable: ['ORD-1-F2'], available: ['ORD-1-F1'] },
    opts(null, cleared));
  assert.equal(r.violations.length, 0);
  assert.equal(r.output.deadline, D);
  return r;
}

test('on clearing: order customerActionRequired, and the timeout set for D', () => {
  const r = open();
  assert.ok(r.effects.some(e => e.system === 'orders' && e.args.status === 'customerActionRequired' && e.args.fulfilmentId === null));
  assert.equal(r.obligations.upsert[0].id, 'cad');
  assert.equal(r.obligations.upsert[0].dueAt, '2026-03-04T10:01:00+01:00');
});

test('an amend at D counts: the unavailable fulfilments are cancelled and the order is ready', () => {
  const r = open();
  const a = window_.step({ op: 'act', action: 'amend', at: D }, opts(r.state, '2026-03-04T10:00:01+01:00'));
  assert.equal(a.output.decision, 'amend');
  assert.deepEqual([...a.output.available], ['ORD-1-F1']);
  assert.equal(a.effects.length, 1);
  assert.equal(a.effects[0].args.fulfilmentId, 'ORD-1-F2');
  assert.equal(a.effects[0].args.status, 'cancelled');
});

test('a later action changes nothing', () => {
  const r = open();
  const c = window_.step({ op: 'act', action: 'cancel', at: '2026-03-02T11:00:00+01:00' }, opts(r.state, '2026-03-02T11:00:00+01:00'));
  assert.equal(c.output.decision, 'cancel');
  const late = window_.step({ op: 'act', action: 'amend', at: '2026-03-04T10:00:01+01:00' }, opts(c.state, '2026-03-04T10:00:02+01:00'));
  assert.equal(late.output.decision, null);
});

test('an action after D is not counted, and the timeout is taken after D', () => {
  const r = open();
  const late = window_.step({ op: 'act', action: 'cancel', at: '2026-03-04T10:00:01+01:00' }, opts(r.state, '2026-03-04T10:00:02+01:00'));
  assert.equal(late.output.decision, null);
  const atD = window_.onEvent({ id: 't0', type: 'timer.fired', at: D, payload: { obligationId: 'cad', onDue: 'timeout' } },
    opts(r.state, D));
  assert.equal(atD.output, null, 'a timeout taken at D itself is too early');
  const t = window_.onEvent({ id: 't1', type: 'timer.fired', at: '2026-03-04T10:01:00+01:00', payload: { obligationId: 'cad', onDue: 'timeout' } },
    opts(r.state, '2026-03-04T10:01:00+01:00'));
  assert.equal(t.output.decision, 'timeout');
  const statuses = t.effects.filter(e => typeof e.args.fulfilmentId === 'string').map(e => `${e.args.fulfilmentId}:${e.args.status}`);
  assert.deepEqual(statuses.sort(), ['ORD-1-F1:cancelled', 'ORD-1-F2:cancelled']);
  assert.ok(t.effects.some(e => e.args.status === 'timedOut' && e.args.fulfilmentId === null));
});
