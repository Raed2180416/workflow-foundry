import test from 'node:test';
import assert from 'node:assert/strict';
import { moduleHarness } from '../compose-kit/kit.mjs';

// cancellation calls fraud, order-progress, fulfilment, statuses and notices; the harness runs this module alone, so
// only the paths that make no call are checked here. The rest is covered by smoke runs on the platform.
const cancellation = moduleHarness('cancellation');
const NOW = '2026-03-02T10:00:00+01:00';

test('a cancel after the order has ended changes nothing (R6.3, S15)', () => {
  const r = cancellation.step({ op: 'customer-cancel', at: NOW, eventId: 'E1', phase: 'ended' }, { key: 'ORD-1', state: null, now: NOW });
  assert.equal(r.violations.length, 0);
  assert.equal(r.output.verdict, 'nothing');
  assert.equal(r.effects.length, 0);
});

test('the module declares no effects of its own', () => {
  assert.deepEqual(cancellation.declaration.effects, []);
});
