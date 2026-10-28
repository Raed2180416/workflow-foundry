import test from 'node:test';
import assert from 'node:assert/strict';
import { moduleHarness } from '../compose-kit/kit.mjs';

const notice = moduleHarness('notice');
const files = {
  'master/customers.json': [{ customerId: 'C1', email: 'c1@example.test' }],
};
const now = '2026-03-02T10:00:00+01:00';

test('sends one notice with a key derived from its template and subject', () => {
  const r = notice.step({ template: 'order-cancelled', about: 'ORD-1', customerId: 'C1', orderId: 'ORD-1' }, { key: 'ORD-1', files, now });
  assert.equal(r.error, null);
  assert.equal(r.violations.length, 0);
  assert.equal(r.effects.length, 1);
  assert.equal(r.effects[0].system, 'notify');
  assert.equal(r.effects[0].op, 'send');
  assert.equal(r.effects[0].key, 'n-order-cancelled-ORD-1');
  assert.equal(r.effects[0].args.to, 'c1@example.test');
  assert.equal(r.effects[0].args.template, 'order-cancelled');
  assert.equal(r.effects[0].args.about, 'ORD-1');
});

test('a fulfilment notice is about the fulfilment, with its own key', () => {
  const r = notice.step({ template: 'fulfilment-failed', about: 'ORD-1-F2', customerId: 'C1', orderId: 'ORD-1' }, { key: 'ORD-1', files, now });
  assert.equal(r.effects[0].key, 'n-fulfilment-failed-ORD-1-F2');
  assert.equal(r.effects[0].args.about, 'ORD-1-F2');
});

test('a customer with no email is an error, not a send to nobody', () => {
  const r = notice.step({ template: 'order-cancelled', about: 'ORD-1', customerId: 'C9', orderId: 'ORD-1' }, { key: 'ORD-1', files, now });
  assert.match(String(r.error), /no email/);
  assert.equal(r.effects.length, 0);
});
