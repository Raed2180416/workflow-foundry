import test from 'node:test';
import assert from 'node:assert/strict';
import { moduleHarness } from '../compose-kit/kit.mjs';

const notices = moduleHarness('notices');
const NOW = '2026-03-02T10:00:00+01:00';
const files = { 'master/customers.json': JSON.stringify([{ customerId: 'C-1', name: 'One', email: 'c1@example.test' }]) };

test('the customer email comes from master data (§4.8)', () => {
  const init = notices.step({ op: 'init', customerId: 'C-1' }, { key: 'ORD-1', state: null, now: NOW, files });
  const r = notices.step({ op: 'send', template: 'order-cancelled', about: 'ORD-1' }, { key: 'ORD-1', state: init.state, now: NOW, files });
  assert.equal(r.effects.length, 1);
  assert.equal(r.effects[0].key, 'order-cancelled.ORD-1');
  assert.equal(r.effects[0].args.to, 'c1@example.test');
  assert.equal(r.effects[0].args.about, 'ORD-1');
});

test('the same notice is sent once (§4.8)', () => {
  const init = notices.step({ op: 'init', customerId: 'C-1' }, { key: 'ORD-1', state: null, now: NOW, files });
  const first = notices.step({ op: 'send', template: 'action-required', about: 'ORD-1' }, { key: 'ORD-1', state: init.state, now: NOW, files });
  const again = notices.step({ op: 'send', template: 'action-required', about: 'ORD-1' }, { key: 'ORD-1', state: first.state, now: NOW, files });
  assert.equal(again.effects.length, 0);
});

test('a refused cancel is noticed once per cancel event (R6.3)', () => {
  const init = notices.step({ op: 'init', customerId: 'C-1' }, { key: 'ORD-1', state: null, now: NOW, files });
  const a = notices.step({ op: 'send', template: 'cancel-refused', about: 'ORD-1', occurrence: 'ev-1' }, { key: 'ORD-1', state: init.state, now: NOW, files });
  const b = notices.step({ op: 'send', template: 'cancel-refused', about: 'ORD-1', occurrence: 'ev-2' }, { key: 'ORD-1', state: a.state, now: NOW, files });
  assert.equal(a.effects[0].key, 'cancel-refused.ev-1');
  assert.equal(b.effects[0].key, 'cancel-refused.ev-2');
});

test('a fulfilment notice names the fulfilment (§4.8)', () => {
  const init = notices.step({ op: 'init', customerId: 'C-1' }, { key: 'ORD-1', state: null, now: NOW, files });
  const r = notices.step({ op: 'send', template: 'fulfilment-failed', about: 'ORD-1-F2' }, { key: 'ORD-1', state: init.state, now: NOW, files });
  assert.equal(r.effects[0].args.about, 'ORD-1-F2');
  assert.equal(r.effects[0].args.template, 'fulfilment-failed');
});
