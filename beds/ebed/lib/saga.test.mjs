// Unit tests for saga.mjs: the full single-failure-point table of the E8-shaped order saga (derived by hand below),
// partial batches, parallel commit order, pivots, refusals, and grading of compensation effects through
// ledger.matchEffects. No model is called.
import test from 'node:test';
import assert from 'node:assert/strict';
import { planSaga, failurePoints, sagaKey, defineSaga, stepStates, compensationEffects } from './saga.mjs';
import { matchEffects } from './ledger.mjs';
import { codeOf } from './errors.mjs';
import { ORDER_SAGA } from './fixtures.mjs';

const steps = plan => plan.compensations.map(c => (c.item === null ? c.step : `${c.step}/${c.item}`));
const obs = o => ({ steps: o });

test('failure-point table of reserve -> charge -> ship -> notify (hand-derived)', () => {
  // [action, compensated steps in order, skipped, query units]
  const want = {
    'reserve:error': ['compensate', [], []], 'reserve:unknown/committed+abort': ['compensate', ['reserve'], []],
    'reserve:unknown/not-found+abort': ['compensate', [], []], 'reserve:unknown/pending': ['query-status', ['reserve']],
    'reserve:ok+abort': ['compensate', ['reserve'], []],
    'charge:error': ['compensate', ['reserve'], []], 'charge:unknown/committed+abort': ['compensate', ['charge', 'reserve'], []],
    'charge:unknown/not-found+abort': ['compensate', ['reserve'], []], 'charge:unknown/pending': ['query-status', ['charge']],
    'charge:ok+abort': ['compensate', ['charge', 'reserve'], []],
    'ship:error': ['compensate', ['charge', 'reserve'], []], 'ship:unknown/committed+abort': ['compensate', ['ship', 'charge', 'reserve'], []],
    'ship:unknown/not-found+abort': ['compensate', ['charge', 'reserve'], []], 'ship:unknown/pending': ['query-status', ['ship']],
    'ship:ok+abort': ['compensate', ['ship', 'charge', 'reserve'], []],
    'notify:error': ['compensate', ['ship', 'charge', 'reserve'], []], 'notify:unknown/committed+abort': ['compensate', ['ship', 'charge', 'reserve'], ['notify']],
    'notify:unknown/not-found+abort': ['compensate', ['ship', 'charge', 'reserve'], []], 'notify:unknown/pending': ['query-status', ['notify']],
    'notify:ok+abort': ['compensate', ['ship', 'charge', 'reserve'], ['notify']],
  };
  const fps = failurePoints(ORDER_SAGA);
  assert.equal(fps.length, 20);
  for (const { name, plan } of fps) {
    const [action, list, skipped] = want[name];
    assert.equal(plan.action, action, name);
    if (action === 'query-status') { assert.deepEqual(plan.units.map(u => u.step), list, name); continue; }
    assert.deepEqual(steps(plan), list, name);
    assert.deepEqual(plan.skipped.map(s => s.step), skipped, name);
    // Reverse order is a chain: each compensation runs after the previous one.
    plan.compensations.forEach((c, i) => assert.equal(c.after, i ? plan.compensations[i - 1].key : null, name));
  }
  const shipError = fps.find(f => f.name === 'ship:error').plan;
  assert.deepEqual(shipError.failure, { step: 'ship', item: null });
  assert.deepEqual(shipError.compensations[0], { step: 'charge', item: null, system: 'billing', op: 'refund', key: 'order-1:charge:undo', after: null, subject: { orderId: 'O-1' } });
  assert.deepEqual(shipError.compensations[1].key, 'order-1:reserve:undo');
  assert.deepEqual(fps.find(f => f.name === 'charge:unknown/pending').plan.units, [{ step: 'charge', item: null, key: 'order-1:charge:do' }]);
});

test('forward actions: complete, continue after a not-found status, nothing guessed', () => {
  const ok = { outcome: 'ok' };
  assert.deepEqual(planSaga(ORDER_SAGA, obs({ reserve: ok, charge: ok, ship: ok, notify: ok })), { action: 'complete' });
  assert.deepEqual(planSaga(ORDER_SAGA, obs({ reserve: ok, charge: { outcome: 'unknown', status: 'not-found' } })),
    { action: 'continue', step: 'charge', units: [{ step: 'charge', item: null, key: 'order-1:charge:do' }] });
  assert.deepEqual(planSaga(ORDER_SAGA, obs({ reserve: ok })).step, 'charge');
  assert.equal(planSaga(ORDER_SAGA, obs({ reserve: ok, charge: { outcome: 'unknown' } })).action, 'query-status');
  // An unknown blocks even a plan that would otherwise compensate.
  assert.equal(planSaga(ORDER_SAGA, obs({ reserve: { outcome: 'unknown' }, charge: { outcome: 'error' } })).action, 'query-status');
});

test('partial batches compensate exactly the committed items (F4)', () => {
  const p = planSaga(ORDER_SAGA, obs({ reserve: { items: { 'SKU-A': { outcome: 'ok' }, 'SKU-B': { outcome: 'error' }, 'SKU-C': { outcome: 'unknown', status: 'committed' } } } }));
  assert.equal(p.action, 'compensate');
  assert.deepEqual(p.failure, { step: 'reserve', item: 'SKU-B' });
  assert.deepEqual(steps(p), ['reserve/SKU-C', 'reserve/SKU-A']); // reverse item order without seq
  assert.deepEqual(p.compensations[0].subject, { orderId: 'O-1', sku: 'SKU-C' });
  assert.equal(p.compensations[0].key, 'order-1:reserve:SKU-C:undo');
  assert.deepEqual(stepStates(ORDER_SAGA, obs({ reserve: { items: { A: { outcome: 'ok' }, B: { outcome: 'not-started' } } } })),
    { reserve: 'partial', charge: 'open', ship: 'open', notify: 'open' });
});

test('commit sequence numbers decide the order for parallel branches', () => {
  const p = planSaga(ORDER_SAGA, obs({ reserve: { items: { A: { outcome: 'ok', seq: 2 }, B: { outcome: 'ok', seq: 1 } } }, charge: { outcome: 'ok', seq: 3 }, ship: { outcome: 'error' } }));
  assert.deepEqual(steps(p), ['charge', 'reserve/A', 'reserve/B']);
  const q = planSaga(ORDER_SAGA, obs({ reserve: { items: { A: { outcome: 'ok', seq: 1 }, B: { outcome: 'ok', seq: 2 } } }, charge: { outcome: 'ok', seq: 3 }, ship: { outcome: 'error' } }));
  assert.deepEqual(steps(q), ['charge', 'reserve/B', 'reserve/A']);
  assert.equal(codeOf(() => planSaga(ORDER_SAGA, obs({ reserve: { outcome: 'ok', seq: 1 }, charge: { outcome: 'ok' }, ship: { outcome: 'error' } }))), 'SAGA_INPUT');
  assert.equal(codeOf(() => planSaga(ORDER_SAGA, obs({ reserve: { outcome: 'ok', seq: 1 }, charge: { outcome: 'ok', seq: 1 }, ship: { outcome: 'error' } }))), 'SAGA_INPUT');
});

test('pivots: retry forward after a committed pivot, refuse an abort, compensate before it', () => {
  const pivoted = { id: 'p', steps: [
    { id: 'reserve', do: { system: 'inv', op: 'reserve' }, undo: { system: 'inv', op: 'release' } },
    { id: 'charge', kind: 'pivot', do: { system: 'bill', op: 'charge' }, undo: null },
    { id: 'ship', kind: 'retriable', do: { system: 'car', op: 'create' }, undo: null },
    { id: 'notify', kind: 'retriable', do: { system: 'mail', op: 'send' }, undo: null },
  ] };
  const ok = { outcome: 'ok' };
  const r = planSaga(pivoted, obs({ reserve: ok, charge: ok, ship: { outcome: 'error' } }));
  assert.deepEqual([r.action, r.units.map(u => u.step)], ['retry-forward', ['ship', 'notify']]);
  assert.deepEqual(planSaga(pivoted, obs({ reserve: ok, charge: ok }), { abort: { reason: 'cancel' } }), { action: 'abort-refused', reason: 'pivot-committed' });
  assert.deepEqual(steps(planSaga(pivoted, obs({ reserve: ok, charge: { outcome: 'error' } }))), ['reserve']);
  // A step with nothing to undo in the middle is skipped, not invented.
  const mid = { id: 'm', steps: [ORDER_SAGA.steps[0], { id: 'note', do: { system: 'mail', op: 'send' }, undo: null }, ORDER_SAGA.steps[1]] };
  const pm = planSaga(mid, obs({ reserve: ok, note: ok, charge: { outcome: 'error' } }));
  assert.deepEqual([steps(pm), pm.skipped], [['reserve'], [{ step: 'note', item: null, reason: 'no-undo' }]]);
  assert.equal(codeOf(() => planSaga(pivoted, obs({ reserve: { outcome: 'error' }, charge: ok }))), 'SAGA_INPUT'); // pivot committed after a failure
});

test('definitions and observations are validated; keys are injective', () => {
  const s = ORDER_SAGA.steps;
  for (const bad of [
    { id: 'x', steps: [] }, { id: 'x', steps: [s[0], s[0]] }, { id: 'x', steps: [{ ...s[0], kind: 'retriable' }] },
    { id: 'x', steps: [{ ...s[0], kind: 'pivot' }, s[1]] }, { id: 'x', steps: [{ ...s[0], kind: 'pivot' }, { ...s[1], kind: 'pivot' }] },
    { id: 'x', steps: [{ ...s[0], do: null }] }, { id: 'x', steps: [{ ...s[0], undo: { system: 'inv' } }] }, { id: 'x', steps: [{ ...s[0], kind: 'magic' }] },
  ]) assert.equal(codeOf(() => defineSaga(bad)), 'SAGA_INVALID', JSON.stringify(bad.steps.map(x => x.id)));
  assert.equal(codeOf(() => planSaga(ORDER_SAGA, obs({ reserve: { outcome: 'done' } }))), 'SAGA_INPUT');
  assert.equal(codeOf(() => planSaga(ORDER_SAGA, obs({ reserve: { outcome: 'unknown', status: 'maybe' } }))), 'SAGA_INPUT');
  assert.equal(codeOf(() => planSaga(ORDER_SAGA, obs({ reserve: { items: {} } }))), 'SAGA_INPUT');
  assert.equal(sagaKey('a:b', 'c', null, 'do'), 'a%3Ab:c:do');
  assert.notEqual(sagaKey('a:b', 'c', null, 'do'), sagaKey('a', 'b:c', null, 'do'));
  assert.equal(codeOf(() => sagaKey('a', 'b', null, 'c:do')), 'SAGA_INVALID'); // found by this test: phase was free text
  assert.notEqual(sagaKey('a', 'b', 'c', 'do'), sagaKey('a', 'b:c', null, 'do'));
  assert.notEqual(sagaKey('a', 'b', 'c', 'undo'), sagaKey('a', 'b', 'c', 'do'));
});

test('compensation graded through the ledger: exact set and order pass; each mistake has its code', () => {
  const plan = planSaga(ORDER_SAGA, obs({ reserve: { outcome: 'ok' }, charge: { outcome: 'ok' }, ship: { outcome: 'error' } }));
  const window = { earliest: '2026-12-01T10:00:00Z', latest: '2026-12-01T12:00:00Z' };
  const expected = compensationEffects(ORDER_SAGA, plan, { window, money: { charge: true } });
  assert.deepEqual(expected.map(e => [e.lid, e.system, e.op, e.after, e.money === true]), [
    ['undo:order-1:charge:undo', 'billing', 'refund', [], true], ['undo:order-1:reserve:undo', 'inventory', 'release', ['undo:order-1:charge:undo'], false]]);
  const refund = (at, key = 'r1', committed = true) => ({ at, system: 'billing', op: 'refund', key, args: { orderId: 'O-1' }, committed });
  const release = (at, key = 'v1') => ({ at, system: 'inventory', op: 'release', key, args: { orderId: 'O-1' }, committed: true });
  const grade = rows => matchEffects({ expected, rows, end: '2026-12-02T00:00:00Z' });
  assert.equal(grade([refund('2026-12-01T10:05:00Z'), release('2026-12-01T10:06:00Z')]).ok, true);
  // F3 on the refund: committed, result unknown; the retry with the same key is not applied again.
  assert.equal(grade([refund('2026-12-01T10:05:00Z'), refund('2026-12-01T10:06:00Z', 'r1', false), release('2026-12-01T10:07:00Z')]).ok, true);
  const codes = rows => grade(rows).divergences.map(d => d.code);
  assert.deepEqual(codes([release('2026-12-01T10:05:00Z'), refund('2026-12-01T10:06:00Z')]), ['order']); // forward order
  assert.deepEqual(codes([refund('2026-12-01T10:05:00Z')]), ['missed']); // orphaned reservation
  assert.deepEqual(codes([refund('2026-12-01T10:05:00Z'), release('2026-12-01T10:06:00Z'), { at: '2026-12-01T10:07:00Z', system: 'carrier', op: 'cancel', args: { orderId: 'O-1' }, committed: true }]), ['outside-allowed']); // over-compensation
  const twice = grade([refund('2026-12-01T10:05:00Z'), refund('2026-12-01T10:06:00Z', 'r2'), release('2026-12-01T10:07:00Z')]);
  assert.deepEqual(twice.divergences.map(d => d.code), ['key-split', 'duplicate']);
  assert.deepEqual(twice.critical.map(c => c.code), ['duplicate-money']);
  assert.deepEqual(compensationEffects(ORDER_SAGA, { action: 'complete' }, { window }), []);
});
