import test from 'node:test';
import assert from 'node:assert/strict';
import { moduleHarness } from '../compose-kit/kit.mjs';

const op = moduleHarness('order-progress');
const NOW = '2026-03-02T10:00:00+01:00';

test('ended does nothing until the order is processing', () => {
  const r = op.step({ op: 'ended', fulfilmentId: 'F1', end: 'completed', at: NOW }, { key: 'ORD-1', state: null, now: NOW });
  assert.equal(r.output.state, 'idle');
  assert.equal(r.effects.length, 0);
});

test('stop before ready ends the progress for good (R6.2): it never becomes processing', () => {
  const s = op.step({ op: 'stop' }, { key: 'ORD-1', state: null, now: NOW });
  assert.equal(s.output.state, 'stopped');
  assert.equal(s.effects.length, 0);
});
