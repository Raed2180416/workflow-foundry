import test from 'node:test';
import assert from 'node:assert/strict';
import { moduleHarness } from '../compose-kit/kit.mjs';

const orderId = moduleHarness('order-id');
const norm = raw => orderId.step({ raw }, { key: 'n' });

test('trims spaces and upper-cases (§3.1)', () => {
  const r = norm(' ord-1001-0007');
  assert.equal(r.violations.length, 0);
  assert.equal(r.output.orderId, 'ORD-1001-0007');
});

test('removes a leading #', () => {
  assert.equal(norm('#ORD-1').output.orderId, 'ORD-1');
  assert.equal(norm(' # ord-2 ').output.orderId, 'ORD-2');
});

test('null in gives null out, and no effects', () => {
  const r = norm(null);
  assert.equal(r.violations.length, 0);
  assert.equal(r.output.orderId, null);
  assert.equal(r.effects.length, 0);
});
