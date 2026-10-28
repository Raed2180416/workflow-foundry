import test from 'node:test';
import assert from 'node:assert/strict';
import { moduleHarness } from '../compose-kit/kit.mjs';

const statuses = moduleHarness('statuses');
const NOW = '2026-03-02T10:00:00+01:00';
// Outputs come from the module's own realm; plain copies compare cleanly under deepEqual.
const plain = x => JSON.parse(JSON.stringify(x));
const init = () => statuses.step({ op: 'init', fulfilments: [{ fulfilmentId: 'F1', location: 'UTR' }, { fulfilmentId: 'F2', location: null }] }, { key: 'ORD-1', state: null, now: NOW });
const set = (state, fulfilmentId, status) => statuses.step({ op: 'set', fulfilmentId, status }, { key: 'ORD-1', state, now: NOW });

test('init: the order pending; a fulfilment pending, or unavailable at a null location', () => {
  const r = init();
  assert.equal(r.output.order, 'pending');
  assert.deepEqual(plain(r.output.fulfilments), [{ fulfilmentId: 'F1', status: 'pending' }, { fulfilmentId: 'F2', status: 'unavailable' }]);
  assert.equal(r.effects.length, 0);
});

test('a legal move emits one orders.setStatus with a stable key', () => {
  const r = set(init().state, 'F1', 'processing');
  assert.equal(r.output.applied, true);
  assert.equal(r.effects.length, 1);
  assert.equal(r.effects[0].key, 'f.F1.processing');
  assert.equal(r.effects[0].args.fulfilmentId, 'F1');
});

test('a repeated or backward move emits nothing (R7.2)', () => {
  const p = set(init().state, 'F1', 'processing');
  const again = set(p.state, 'F1', 'processing');
  assert.equal(again.effects.length, 0);
  const back = set(p.state, 'F1', 'pending');
  assert.equal(back.effects.length, 0);
});

test('unavailable may become cancelled (R3.2, R6.1)', () => {
  const r = set(init().state, 'F2', 'cancelled');
  assert.equal(r.effects.length, 1);
  assert.equal(r.effects[0].key, 'f.F2.cancelled');
});

test('an order status cannot leave an end state', () => {
  const s0 = init().state;
  const c = statuses.step({ op: 'set', fulfilmentId: null, status: 'cancelled' }, { key: 'ORD-1', state: s0, now: NOW });
  assert.equal(c.effects.length, 1, 'pending -> cancelled is legal');
  const again = statuses.step({ op: 'set', fulfilmentId: null, status: 'processing' }, { key: 'ORD-1', state: c.state, now: NOW });
  assert.equal(again.effects.length, 0);
});
