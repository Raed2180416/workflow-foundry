import test from 'node:test';
import assert from 'node:assert/strict';
import { moduleHarness } from '../compose-kit/kit.mjs';
test('intake loads and runs inside its declaration', () => {
  const m = moduleHarness('intake');
  const r = m.onEvent({ type: 'timer.fired', payload: { obligationId: 'x' } }, { key: 'K' });
  assert.equal(r.error, null);
  assert.deepEqual(r.violations, []);
});
