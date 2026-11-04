// Treatment-delivery gate (experiments/swarm/delivery-gate.mjs, review fix M1).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deliveryGate } from '../delivery-gate.mjs';

const row = (workers, spawned = workers, completed = spawned) => ({ arm: 'S-swarm-haiku', taskKey: 't', meta: { workers, subagentStats: { spawned, completed } } });
test('the gate stops a swarm arm that does not fan out, and passes one that does', () => {
  assert.equal(deliveryGate([row(0)]).ok, false);
  assert.equal(deliveryGate([row(1)]).ok, false);
  assert.equal(deliveryGate([row(3, 3, 0)]).ok, false, 'started but none completed');
  assert.equal(deliveryGate([row(3, 0)]).ok, false, 'tree and CLI must agree');
  assert.equal(deliveryGate([row(9)]).ok, true);
  assert.equal(deliveryGate([]).ok, false);
  assert.equal(deliveryGate([row(2), row(0)]).ok, false, 'every calibration trial');
});
test('on rung 1\'s own calibration record the gate would have stopped before the held-out stage', () => {
  const rows = readFileSync(new URL('../../../research/swarm-20261021/runs/calibrate-results.jsonl', import.meta.url), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  const g = deliveryGate(rows);
  assert.equal(g.ok, false); assert.match(g.reason, /started 0 workers/);
});
