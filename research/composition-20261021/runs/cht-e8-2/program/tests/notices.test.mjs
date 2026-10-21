import test from 'node:test';
import assert from 'node:assert/strict';
import { moduleHarness } from '../compose-kit/kit.mjs';

const nt = moduleHarness('notices');
const files = { 'master/customers.json': [{ customerId: 'C-1', email: 'buyer@example.nl' }] };
const K = 'ORD-1';

test('init reads the customer email; the notice goes to it, about the order (§4.8)', () => {
  const i = nt.step({ op: 'init', customerId: 'C-1' }, { key: K, state: null, files });
  assert.equal(i.violations.length, 0);
  const s = nt.step({ op: 'send', template: 'order-cancelled', about: K }, { key: K, state: i.state, files });
  assert.equal(s.effects.length, 1);
  assert.equal(s.effects[0].key, 'order-cancelled.ORD-1');
  assert.equal(s.effects[0].args.to, 'buyer@example.nl');
  assert.equal(s.effects[0].args.about, K);
});

test('each notice is sent once; cancel-refused is one notice per cancel event', () => {
  const i = nt.step({ op: 'init', customerId: 'C-1' }, { key: K, state: null, files });
  const a = nt.step({ op: 'send', template: 'order-cancelled', about: K }, { key: K, state: i.state, files });
  const twice = nt.step({ op: 'send', template: 'order-cancelled', about: K }, { key: K, state: a.state, files });
  assert.equal(twice.effects.length, 0);
  const r1 = nt.step({ op: 'send', template: 'cancel-refused', about: K, occurrence: 'evt-1' }, { key: K, state: a.state, files });
  const r2 = nt.step({ op: 'send', template: 'cancel-refused', about: K, occurrence: 'evt-2' }, { key: K, state: r1.state, files });
  assert.equal(r1.effects[0].key, 'cancel-refused.evt-1');
  assert.equal(r2.effects.length, 1);
});

test('get reports busy while a notice is in flight', () => {
  const i = nt.step({ op: 'init', customerId: 'C-1' }, { key: K, state: null, files });
  const s = nt.step({ op: 'send', template: 'action-required', about: K }, { key: K, state: i.state, files });
  assert.equal(nt.step({ op: 'get' }, { key: K, state: s.state, files }).output.busy, true);
});
