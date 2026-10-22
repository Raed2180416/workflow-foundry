import test from 'node:test';
import assert from 'node:assert/strict';
import { moduleHarness } from '../compose-kit/kit.mjs';

const oid = moduleHarness('order-id');

test('trims, drops a leading #, upper-cases (SPEC-E §3.1)', () => {
  assert.equal(oid.step({ raw: ' ord-1001-0007' }, { key: 'n' }).output.orderId, 'ORD-1001-0007');
  assert.equal(oid.step({ raw: '#ORD-1' }, { key: 'n' }).output.orderId, 'ORD-1');
  assert.equal(oid.step({ raw: ' #ord-7 ' }, { key: 'n' }).output.orderId, 'ORD-7');
});

test('null in, null out, no state', () => {
  const r = oid.step({ raw: null }, { key: 'n' });
  assert.equal(r.output.orderId, null);
  assert.equal(r.state, null);
  assert.equal(r.violations.length, 0);
  assert.equal(r.effects.length, 0);
});
