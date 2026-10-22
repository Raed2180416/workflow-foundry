import test from 'node:test';
import assert from 'node:assert/strict';
import { moduleHarness } from '../compose-kit/kit.mjs';

const st = moduleHarness('statuses');
const K = 'ORD-1';

function initialised() {
  const r = st.step({ op: 'init', fulfilments: [{ fulfilmentId: 'F1', location: 'AMS' }, { fulfilmentId: 'F2', location: null }] },
    { key: K, state: null, now: '2026-03-02T10:00:00+01:00' });
  return r.state;
}

test('init sets the order pending and the unavailable fulfilment unavailable, with no effect', () => {
  const r = st.step({ op: 'init', fulfilments: [{ fulfilmentId: 'F1', location: 'AMS' }, { fulfilmentId: 'F2', location: null }] },
    { key: K, state: null, now: '2026-03-02T10:00:00+01:00' });
  assert.equal(r.effects.length, 0);
  assert.equal(r.violations.length, 0);
  assert.equal(r.output.order, 'pending');
  assert.equal(JSON.stringify(r.output.fulfilments.map(f => f.status)), JSON.stringify(['pending', 'unavailable']));
});

test('a forward move emits one setStatus; a repeat or a backward move emits nothing', () => {
  const s0 = initialised();
  const now = '2026-03-02T10:05:00+01:00';
  const a = st.step({ op: 'set', fulfilmentId: 'F1', status: 'processing' }, { key: K, state: s0, now });
  assert.equal(a.output.applied, true);
  assert.equal(a.effects[0].key, 'f.F1.processing');
  assert.deepEqual(a.effects[0].args, { orderId: K, fulfilmentId: 'F1', status: 'processing' });
  const again = st.step({ op: 'set', fulfilmentId: 'F1', status: 'processing' }, { key: K, state: a.state, now });
  assert.equal(again.effects.length, 0);
  const back = st.step({ op: 'set', fulfilmentId: 'F1', status: 'pending' }, { key: K, state: a.state, now });
  assert.equal(back.effects.length, 0);
});

test('unavailable may become cancelled (R3.2, R6.1); a status set before init is refused (R4.1)', () => {
  const s0 = initialised();
  const c = st.step({ op: 'set', fulfilmentId: 'F2', status: 'cancelled' }, { key: K, state: s0, now: '2026-03-02T11:00:00+01:00' });
  assert.equal(c.effects.length, 1);
  const early = st.step({ op: 'set', fulfilmentId: null, status: 'processing' }, { key: K, state: null, now: '2026-03-02T11:00:00+01:00' });
  assert.equal(early.effects.length, 0);
});

test('dispatched before completed: the completed change waits for dispatched in the same instant', () => {
  let s = initialised();
  const now = '2026-03-02T12:00:00+01:00';
  s = st.step({ op: 'set', fulfilmentId: 'F1', status: 'processing' }, { key: K, state: s, now: '2026-03-02T10:30:00+01:00' }).state;
  const d = st.step({ op: 'set', fulfilmentId: 'F1', status: 'dispatched' }, { key: K, state: s, now });
  const c = st.step({ op: 'set', fulfilmentId: 'F1', status: 'completed', afterStatus: 'dispatched' }, { key: K, state: d.state, now });
  assert.equal(c.effects[0].after, 'f.F1.dispatched');
});
