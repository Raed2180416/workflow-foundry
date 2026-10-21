import test from 'node:test';
import assert from 'node:assert';
import { moduleHarness } from '../compose-kit/kit.mjs';

// the harness loads only this module, so these paths never start a fulfilment (no saga call is made)
const of = moduleHarness('orderflow');
const files = { 'rulebook/r1/policy.json': { customerActionHours: 48, fraudReviewHours: 24 } };
const P = '2026-03-02T10:00:00+01:00';
const key = 'ORD-1';
const names = eff => eff.map(e => e.key).sort();

const recordWithUnavailable = () => of.step({
  op: 'record', p: P, ed: 'r1', em: 'a@x.test', cur: 'EUR', cust: 'C1',
  fl: [
    { fid: 'ORD-1-F1', loc: 'WH-A', av: true, amt: 2500, items: [{ sku: 'S1', qty: 2 }] },
    { fid: 'ORD-1-F2', loc: null, av: false, amt: 300, items: [{ sku: 'S2', qty: 1 }] },
  ],
}, { key, state: null, now: P, files }).state;

test('pass with an unavailable item: waiting, the customer deadline is D + 60 min, notice sent once', () => {
  let s = recordWithUnavailable();
  const c = of.step({ op: 'cleared', at: P }, { key, state: s, now: P, files });
  assert.equal(c.violations.length, 0);
  assert.equal(c.obligations.upsert[0].id, 'deadline');
  assert.equal(c.obligations.upsert[0].dueAt, '2026-03-04T11:00:00+01:00');
  s = c.state;
  const a = of.step({ op: 'settle' }, { key, state: s, now: P, files });
  assert.deepEqual(names(a.effects), ['n.action', 'o.action']);
  const again = of.step({ op: 'settle' }, { key, state: a.state, now: P, files });
  assert.equal(again.effects.length, 0);
});

test('nothing counted by D: the timeout cancels every fulfilment and times the order out', () => {
  let s = recordWithUnavailable();
  s = of.step({ op: 'cleared', at: P }, { key, state: s, now: P, files }).state;
  s = of.step({ op: 'settle' }, { key, state: s, now: P, files }).state;
  const t = of.onEvent({ type: 'timer.fired', payload: { obligationId: 'deadline' } }, { key, state: s, now: '2026-03-04T11:00:00+01:00', files });
  assert.deepEqual(names(t.effects), ['f.ORD-1-F1.cancelled', 'f.ORD-1-F2.cancelled', 'n.timed-out', 'o.timedOut']);
  assert.equal(t.output.done, true);
});

test('a cancel after D changes nothing while waiting', () => {
  let s = recordWithUnavailable();
  s = of.step({ op: 'cleared', at: P }, { key, state: s, now: P, files }).state;
  const r = of.step({ op: 'action', action: 'cancel', at: '2026-03-04T10:00:01+01:00', eid: 'e1' }, { key, state: s, now: '2026-03-04T10:00:01+01:00', files });
  assert.equal(r.effects.length, 0);
});

test('amend at or before D with every item unavailable: nothing is available, the order is cancelled', () => {
  let s = of.step({
    op: 'record', p: P, ed: 'r1', em: 'a@x.test', cur: 'EUR', cust: 'C1',
    fl: [{ fid: 'ORD-1-F2', loc: null, av: false, amt: 300, items: [{ sku: 'S2', qty: 1 }] }],
  }, { key, state: null, now: P, files }).state;
  s = of.step({ op: 'cleared', at: P }, { key, state: s, now: P, files }).state;
  const r = of.step({ op: 'action', action: 'amend', at: P, eid: 'e2' }, { key, state: s, now: P, files });
  assert.equal(r.violations.length, 0);
  assert.deepEqual(names(r.effects), ['f.ORD-1-F2.cancelled', 'n.cancelled', 'o.cancelled']);
  assert.equal(r.output.done, true);
});

test('amend with some items available: unavailable ones cancelled, the order is ready at the amend time', () => {
  let s = recordWithUnavailable();
  s = of.step({ op: 'cleared', at: P }, { key, state: s, now: P, files }).state;
  const r = of.step({ op: 'action', action: 'amend', at: P, eid: 'e6' }, { key, state: s, now: P, files });
  assert.equal(r.violations.length, 0);
  assert.deepEqual(names(r.effects), ['f.ORD-1-F2.cancelled']);
  assert.equal(r.state.ph, 'proc');
  assert.equal(r.state.cl, P);
});

test('pending order (review open): a customer cancel counts (R6.4) and cancels the order', () => {
  const s = recordWithUnavailable();
  const r = of.step({ op: 'action', action: 'cancel', at: P, eid: 'e3' }, { key, state: s, now: P, files });
  assert.deepEqual(names(r.effects), ['f.ORD-1-F1.cancelled', 'f.ORD-1-F2.cancelled', 'n.cancelled', 'o.cancelled']);
  const late = of.step({ op: 'cleared', at: P }, { key, state: r.state, now: P, files });
  assert.equal(late.effects.length, 0);
});

test('fraud reject before clearing cancels the order for fraud', () => {
  const s = recordWithUnavailable();
  const r = of.step({ op: 'reject', reason: 'fraud', at: P }, { key, state: s, now: P, files });
  assert.deepEqual(names(r.effects), ['f.ORD-1-F1.cancelled', 'f.ORD-1-F2.cancelled', 'n.cancelled', 'o.cancelled']);
});

test('a collection reported at or before the cancel refuses it: cancel-refused only (R6.3, S7)', () => {
  const rec = of.step({
    op: 'record', p: P, ed: 'r1', em: 'a@x.test', cur: 'EUR', cust: 'C1',
    fl: [{ fid: 'ORD-1-F1', loc: 'WH-A', av: true, amt: 2500, items: [{ sku: 'S1', qty: 2 }] }],
  }, { key, state: null, now: P, files }).state;
  let s = of.step({ op: 'cleared', at: P }, { key, state: rec, now: P, files }).state;
  s = of.step({ op: 'evidence', reportedAt: '2026-03-02T11:00:00+01:00' }, { key, state: s, now: P, files }).state;
  const r = of.step({ op: 'action', action: 'cancel', at: '2026-03-02T12:00:00+01:00', eid: 'e4' }, { key, state: s, now: P, files });
  assert.deepEqual(names(r.effects), ['n.refused.e4']);
});

test('a cancel before any collection report counts while processing (no fulfilment started here)', () => {
  const rec = of.step({
    op: 'record', p: P, ed: 'r1', em: 'a@x.test', cur: 'EUR', cust: 'C1',
    fl: [{ fid: 'ORD-1-F1', loc: 'WH-A', av: true, amt: 2500, items: [{ sku: 'S1', qty: 2 }] }],
  }, { key, state: null, now: P, files }).state;
  const s = of.step({ op: 'cleared', at: P }, { key, state: rec, now: P, files }).state;
  // the order is processing but settle has not run, so nothing was started: the cancel stops it before any step
  const r = of.step({ op: 'action', action: 'cancel', at: P, eid: 'e5' }, { key, state: s, now: P, files });
  assert.deepEqual(names(r.effects), ['f.ORD-1-F1.cancelled', 'n.cancelled', 'o.cancelled']);
});

test('go-live resume of a customer-action order: waiting, the notice is not sent again, the deadline still applies', () => {
  let s = recordWithUnavailable();
  const r = of.step({ op: 'resume', status: 'customerActionRequired', fs: {} }, { key, state: s, now: P, files });
  assert.equal(r.state.ph, 'wait');
  assert.equal(r.obligations.upsert[0].dueAt, '2026-03-04T11:00:00+01:00');
  const settled = of.step({ op: 'settle' }, { key, state: r.state, now: P, files });
  assert.equal(settled.effects.length, 0);
});

test('go-live resume of a completed order: ended, and nothing further is emitted', () => {
  const s = recordWithUnavailable();
  const r = of.step({ op: 'resume', status: 'completed', fs: { 'ORD-1-F1': 'completed', 'ORD-1-F2': 'cancelled' } }, { key, state: s, now: P, files });
  assert.equal(r.state.ph, 'end');
  assert.equal(r.output.done, true);
  assert.equal(r.effects.length, 0);
});
