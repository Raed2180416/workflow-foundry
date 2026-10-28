import test from 'node:test';
import assert from 'node:assert/strict';
import { runCall } from './_program.mjs';

const K = 'ORD-1';
const T = '2026-03-02T11:00:00+01:00';
const statusesWith = (f, order = 'processing') => ({ [K]: { order, f, inflight: {}, last: null } });

test('ready: the order and every available fulfilment become processing (R4.1)', () => {
  const r = runCall({ mod: 'order-progress', key: K, carry: { statuses: statusesWith({ F1: 'pending', F2: 'unavailable' }, 'pending') },
    input: { op: 'ready', orderId: K, at: T, fulfilments: [{ fulfilmentId: 'F1', available: true }, { fulfilmentId: 'F2', available: false }] } });
  assert.equal(r.output.state, 'processing');
  const sets = r.effects.map(e => `${e.args.fulfilmentId}:${e.args.status}`).sort();
  assert.deepEqual(sets, ['F1:processing', 'null:processing']);
});

function ended(statuses, at = '2026-03-03T09:00:00+01:00') {
  return runCall({ mod: 'order-progress', key: K, carry: { statuses: statusesWith(statuses), 'order-progress': { [K]: { status: 'processing', outcome: null, at: null } } },
    input: { op: 'ended', orderId: K, fulfilmentId: 'F1', end: 'completed', at } });
}

test('R4.5: completed if one completed; failed if none completed but one failed; cancelled otherwise', () => {
  const outcome = f => {
    const r = ended(f);
    return r.effects.length ? r.effects[0].args.status : r.output.outcome;
  };
  assert.equal(outcome({ F1: 'completed', F2: 'failed' }), 'completed');
  assert.equal(outcome({ F1: 'failed', F2: 'cancelled' }), 'failed');
  assert.equal(outcome({ F1: 'cancelled', F2: 'cancelled' }), 'cancelled');
});

test('the order is not ended while a fulfilment is still open', () => {
  const r = ended({ F1: 'completed', F2: 'processing' });
  assert.equal(r.output.state, 'processing');
  assert.equal(r.effects.length, 0);
});
