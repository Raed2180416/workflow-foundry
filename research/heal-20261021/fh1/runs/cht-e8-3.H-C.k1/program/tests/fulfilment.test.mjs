import test from 'node:test';
import assert from 'node:assert/strict';
import { moduleHarness } from '../compose-kit/kit.mjs';

// Outputs come from the module's own realm; plain copies compare cleanly under deepEqual.
const plain = x => JSON.parse(JSON.stringify(x));
// A reservation batch comes back with its item keys; the batch itself has no key.
const OK_ITEMS = [{ key: 'item.A', status: 'ok' }, { key: 'item.B', status: 'ok' }];
const f = moduleHarness('fulfilment');
const T0 = '2026-03-02T10:00:00+01:00';
const T1 = '2026-03-02T10:01:00+01:00';
const fulfilment = { fulfilmentId: 'F1', location: 'UTR', items: [{ sku: 'A', qty: 2 }, { sku: 'B', qty: 1 }], amountMinor: 1495 };
const opts = state => ({ key: 'F1', state, now: T0, files: {} });
const started = () => f.step({ op: 'start', orderId: 'ORD-1', customerId: 'C1', currency: 'EUR', edition: 'ed-2026-01', readyAt: T0, fulfilment }, opts(null));
const advance = (state, now = T0) => f.step({ op: 'advance' }, { key: 'F1', state, now, files: {} });
const result = (state, payload, now = T1) => f.onEvent({ type: 'effect.result', at: now, payload: { key: payload.key, system: 'x', op: 'x', ...payload } }, { key: 'F1', state, now, files: {} });

test('advance reserves every item first, in one batch with the item keys', () => {
  const r = advance(started().state);
  assert.equal(r.violations.length, 0);
  assert.equal(r.effects.length, 1);
  assert.equal(r.effects[0].key, undefined, 'a batch op has no batch key');
  assert.equal(r.effects[0].op, 'reserve');
  assert.deepEqual(plain(r.effects[0].args.items.map(i => i.key)), ['item.A', 'item.B']);
});

test('a partial batch resubmits only the failed items, with their original keys, under a new batch key', () => {
  const a = advance(started().state);
  const partial = result(a.state, { status: 'partial', items: [
    { key: 'item.A', status: 'ok' },
    { key: 'item.B', status: 'error', error: { code: 'busy', retryable: true } },
  ] });
  const again = advance(partial.state, T1);
  assert.equal(again.effects.length, 1);
  assert.equal(again.effects[0].key, undefined);
  assert.deepEqual(plain(again.effects[0].args.items), [{ key: 'item.B', sku: 'B', qty: 1 }]);
});

test('after the reservations commit, the charge is the next step, then the shipment', () => {
  const a = advance(started().state);
  const ok = result(a.state, { status: 'ok', items: OK_ITEMS });
  const c = advance(ok.state, T1);
  assert.equal(c.effects[0].key, 'charge');
  assert.equal(c.effects[0].args.amountMinor, 1495);
  const charged = result(c.state, { key: 'charge', status: 'ok' }, '2026-03-02T10:02:00+01:00');
  const s = advance(charged.state, '2026-03-02T10:02:00+01:00');
  assert.equal(s.effects[0].key, 'ship');
  assert.equal(s.effects[0].args.ref, 'F1');
});

test('a declined card fails the fulfilment and compensates committed reservations (no refund: no charge)', () => {
  const a = advance(started().state);
  const ok = result(a.state, { status: 'ok', items: OK_ITEMS });
  const c = advance(ok.state, T1);
  const declined = result(c.state, { key: 'charge', status: 'error', error: { code: 'card-declined', retryable: false } }, '2026-03-02T10:02:00+01:00');
  assert.equal(declined.output.failing, true);
  assert.deepEqual(plain(declined.effects.map(e => e.key).sort()), ['release.A', 'release.B']);
  assert.ok(!declined.effects.some(e => e.op === 'refund'));
});

test('stop with a step in flight emits nothing forward and compensates the step when it commits', () => {
  const a = advance(started().state);
  const stopped = f.step({ op: 'stop', at: T1 }, { key: 'F1', state: a.state, now: T1, files: {} });
  assert.equal(stopped.effects.length, 0);
  assert.equal(stopped.output.end, null);
  const adv = advance(stopped.state, T1);
  assert.equal(adv.effects.length, 0, 'no new step after a stop');
  const committed = result(stopped.state, { status: 'ok', items: OK_ITEMS }, '2026-03-02T10:02:00+01:00');
  assert.ok(committed.effects.some(e => e.key === 'release.A'), 'the committed reservation is released');
});

test('a carrier report is recorded once, however often it repeats; a code the table does not list is info', () => {
  const files = { 'rulebook/ed-2026-01/carrier-codes.json': { TRN: 'inTransit', XX: 'unknown-code' } };
  const msg = { code: 'TRN', reportedAt: '2026-03-02T09:00:00+01:00' };
  const r1 = f.step({ op: 'carrier', message: msg, at: T1 }, { key: 'F1', state: started().state, now: T1, files });
  assert.equal(r1.violations.length, 0);
  assert.deepEqual(plain(r1.output.reports), [{ meaning: 'inTransit', reportedAt: '2026-03-02T09:00:00+01:00' }]);
  assert.equal(r1.effects.length, 0);
  const r2 = f.step({ op: 'carrier', message: msg, at: T1 }, { key: 'F1', state: r1.state, now: T1, files });
  assert.equal(r2.output.reports.length, 1);
  const unlisted = f.step({ op: 'carrier', message: { code: 'XX', reportedAt: '2026-03-02T09:30:00+01:00' }, at: T1 }, { key: 'F1', state: r2.state, now: T1, files });
  assert.equal(plain(unlisted.output.reports)[1].meaning, 'info');
});
