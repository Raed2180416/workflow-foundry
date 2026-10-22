import test from 'node:test';
import assert from 'node:assert/strict';
import { moduleHarness } from '../compose-kit/kit.mjs';

const notices = moduleHarness('notices');
const NOW = '2026-03-02T10:00:00+01:00';
const files = { 'master/customers.json': [{ customerId: 'C1', email: 'ana@example.test' }] };
const send = (state, input) => notices.step({ op: 'send', ...input }, { key: 'ORD-1', state, now: NOW, files });

test('a notice goes to the customer email, about the order', () => {
  const r = send(notices.step({ op: 'init', customerId: 'C1' }, { key: 'ORD-1', state: null, now: NOW, files }).state,
    { template: 'action-required', about: 'ORD-1', customerId: 'C1' });
  assert.equal(r.violations.length, 0);
  assert.equal(r.effects.length, 1);
  assert.equal(r.effects[0].key, 'action-required.ORD-1');
  assert.equal(r.effects[0].args.to, 'ana@example.test');
  assert.equal(r.effects[0].args.about, 'ORD-1');
});

test('the same notice twice is sent once', () => {
  const first = send(null, { template: 'order-cancelled', about: 'ORD-1', customerId: 'C1' });
  const again = send(first.state, { template: 'order-cancelled', about: 'ORD-1', customerId: 'C1' });
  assert.equal(again.effects.length, 0);
});

test('a refused cancel is one notice per cancel event', () => {
  const a = send(null, { template: 'cancel-refused', about: 'ORD-1', occurrence: 'E1', customerId: 'C1' });
  const b = send(a.state, { template: 'cancel-refused', about: 'ORD-1', occurrence: 'E2', customerId: 'C1' });
  assert.equal(b.effects.length, 1);
  assert.equal(b.effects[0].key, 'cancel-refused.E2');
});
