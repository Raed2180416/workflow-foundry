// E8 item suites ($0, no model calls). Seeds: E-bed dev block (1001-1199 bed health, 1211-1222 attacks).
//   node --test --test-concurrency=2 beds/ebed/e8/test/
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld, referenceRuns, oracle, oracleItem, binding, referenceTransition, recordsOf, specE, family } from '../index.mjs';
import { gradeCase } from '../../oracle/grade.mjs';
import { runControl, CONTROLS } from '../controls.mjs';
import { createHost } from '../../host/host.mjs';
import { replayRun } from '../../host/replay.mjs';
import { hashOf } from '../../../lib/canonical.mjs';
import { planSaga } from '../../lib/saga.mjs';
import { runGoldens, goldens } from '../golden.mjs';

const MIN = 60_000;

test('world generation is pure and deterministic; difficulty features appear where declared', () => {
  for (const d of [2, 3, 4, 5]) {
    const a = generateWorld({ seed: 1001, difficulty: d, mix: 'tail' });
    const b = generateWorld({ seed: 1001, difficulty: d, mix: 'tail' });
    assert.equal(hashOf(a), hashOf(b), `d${d}`);
    const classes = new Set(Object.values(a.truth.cases).map(t => t.class));
    assert.ok(classes.has('straight') && classes.has('decline') || d >= 2, 'base classes');
    if (d >= 3) assert.ok(a.master.locations.some(l => l.carrier === 'SWIFTLINE'), 'd3 new carrier');
    if (d >= 4) assert.equal(a.rulebook.editions.length, 2, 'd4 edition switch');
    if (d >= 5) assert.ok(a.faults.some(f => f.kind === 'F5') && a.faults.some(f => f.kind === 'F3'), 'd5 faults');
    for (const ed of a.rulebook.editions) assert.ok(ed.files['edition.json'], 'edition.json published (R1.3)');
  }
  const nat = generateWorld({ seed: 1002, difficulty: 3, mix: 'natural' });
  const tail = generateWorld({ seed: 1002, difficulty: 3, mix: 'tail' });
  const share = w => Object.values(w.truth.cases).filter(t => t.tail).length / Object.keys(w.truth.cases).length;
  assert.ok(share(tail) >= 0.5, `tail mix ${share(tail)}`);
  assert.ok(share(nat) < share(tail));
});

test('both reference runs pass every case they complete (oracle self-consistency, contract §5.6)', async () => {
  for (const [seed, d] of [[1003, 2], [1004, 3], [1005, 4], [1006, 5]]) {
    const w = generateWorld({ seed, difficulty: d, mix: 'tail', size: d === 5 ? 80 : 50 });
    const r = await referenceRuns(w);
    for (const timing of ['earliest', 'latest']) {
      const v = r.verdicts[timing];
      assert.equal(v.oracleErrors.length, 0, `${timing} d${d}: oracle errors ${JSON.stringify(v.oracleErrors[0])}`);
      const div = v.cases.filter(c => c.firstDivergence);
      assert.equal(div.length, 0, `${timing} d${d}: ${JSON.stringify(div[0]?.firstDivergence)}`);
      assert.equal(v.critical.length, 0);
    }
    const pools = Object.values(r.pools);
    assert.ok(pools.filter(p => p === 'completed').length / pools.length >= 0.85, 'completed share');
  }
});

test('every bad and gaming control fails the world; necessity controls fail their target cases', async () => {
  const w = generateWorld({ seed: 1211, difficulty: 5, mix: 'tail', size: 80 });
  const { pools } = await referenceRuns(w);
  for (const ctl of CONTROLS) {
    const v = oracle(w, await runControl(ctl.id, w), { pools });
    const failed = v.cases.filter(c => c.pool === 'completed' && !c.pass).length;
    assert.ok(failed > 0, `${ctl.id} passed every completed case`);
    if (ctl.kind === 'bad') assert.ok(failed >= v.score.completed * 0.9, `${ctl.id}: ${failed}/${v.score.completed}`);
  }
});

test('a reference run replays byte-identically at $0 (E-BED §9.7)', async () => {
  const w = generateWorld({ seed: 1007, difficulty: 3, mix: 'tail', size: 30 });
  const r = await referenceRuns(w);
  const res = await replayRun({ item: binding, world: w, journal: r.runs.earliest.journal });
  assert.equal(res.ok, true, JSON.stringify(res.divergence ?? null).slice(0, 400));
  assert.equal(res.status, 'complete');
});

test('leak: no truth-only label reaches an arm (inputs, files, query results)', async () => {
  const w = generateWorld({ seed: 1008, difficulty: 5, mix: 'tail', size: 40 });
  const forbidden = [...new Set(Object.values(w.truth.cases).map(t => t.class))].filter(c => c.length > 6 && !['straight'].includes(c));
  const caseIds = Object.keys(w.truth.cases);
  const seen = [];
  const arm = { id: 'spy', tick(input, ctx) {
    seen.push(JSON.stringify(input));
    seen.push(JSON.stringify(Object.fromEntries(Object.entries(ctx.files).filter(([p]) => !p.startsWith('spec/')))));
    for (const t of ['orders.orders', 'inventory.reservations', 'carrier.shipments', 'billing.charges']) seen.push(JSON.stringify(ctx.query(t, {})));
    return { decisions: { subject: null }, effects: [], obligations: { upsert: [], cancel: [] }, humanTasks: [], close: true, carry: null };
  } };
  await createHost({ item: binding, world: w, arm }).run();
  const all = seen.join('\n');
  for (const s of forbidden) assert.ok(!all.includes(`"${s}"`), `class label ${s} leaked`);
  for (const c of caseIds.slice(0, 20)) assert.ok(!all.includes(`"${c}"`), `case id ${c} leaked`);
  for (const s of ['collectionFailed"', '"verdict"', '"declined"', 'allocations']) assert.ok(!all.includes(s), `${s} leaked`);
});

// ---------------------------------------------------------------------------------------------------------------------
// Goldens: hand-derived failure points of the per-fulfilment saga (reserve -> charge -> ship, pivot at collection), fed
// to the transition as synthetic histories, and cross-checked against the independent saga planner (lib/saga.mjs, MR11).

const W = generateWorld({ seed: 1001, difficulty: 3, mix: 'tail' });
const pick = (pred) => Object.entries(W.truth.cases).find(([, t]) => pred(t));
const [CASE, T] = pick(t => t.class === 'straight' && W.sor['inventory.allocations'].find(a => a.orderId === t.subject).fulfilments.length === 1);
const O = T.subject;
const FUL = W.sor['inventory.allocations'].find(a => a.orderId === O).fulfilments[0];
const F = FUL.fulfilmentId;
const P = Date.parse(T.placedAt);
let SEQ = 0;
const row = (at, system, op, args, committed = true, extra = {}) => ({ seq: ++SEQ, at, system, op, key: `${op}:${SEQ}`, args, committed, status: committed ? 'ok' : 'error', error: null,
  case: CASE, callAt: at, knows: new Set(), money: system === 'billing', ...extra });
const ev = (at, type, payload) => ({ id: `g-${++SEQ}`, type, at, seq: SEQ, source: 'golden', payload });
const loc = W.master.locations.find(l => l.location === FUL.location);
const code = meaning => ({ PARCELLA: { collected: 'COLLECTED', delivered: 'DELIVERED', collectionFailed: 'NOT_COLLECTED' }, VELOX: { collected: 'PU', delivered: 'DL', collectionFailed: 'NC' }, SWIFTLINE: { collected: 'picked', delivered: 'handed-over', collectionFailed: 'not-collected' } }[loc.carrier][meaning]);
const view = (at, rows, events) => ({ case: CASE, at, seq: Infinity, world: W, truth: T, rows, tasks: [], taskEvents: [], events: [ev(P, 'order.placed', { orderId: O }), ...events] });
const amount = FUL.items.reduce((s, i) => s + i.qty * W.master.catalog.find(c => c.sku === i.sku).unitPriceMinor, 0)
  + JSON.parse(W.rulebook.editions[0].files['shipping-fees.json']).find(x => x.location === FUL.location).feeMinor;

/** The happy path up to step k (0 = nothing, 1 reserved, 2 charged, 3 shipped), committed one minute apart. */
function history(k, { chargeUnknown = null } = {}) {
  const rows = [row(P + MIN, 'orders', 'create', { orderId: O })];
  let t = P + 2 * MIN;
  if (k >= 1) for (const i of FUL.items) rows.push(row(t, 'inventory', 'reserve', { orderId: O, fulfilmentId: F, location: FUL.location, sku: i.sku, qty: i.qty }));
  t += MIN;
  if (k >= 2) rows.push(row(t, 'billing', 'charge', { orderId: O, fulfilmentId: F, customerId: T.customerId, amountMinor: amount, currency: 'EUR' }, chargeUnknown ?? true, chargeUnknown === null ? {} : { status: 'unknown' }));
  t += MIN;
  if (k >= 3) rows.push(row(t, 'carrier', 'create', { orderId: O, fulfilmentId: F, location: FUL.location, ref: null }));
  return { rows, t: t + MIN };
}
const lidsOf = E => E.effects.required.map(e => e.lid);
const comp = E => E.effects.required.filter(e => /^(csh|rf|rel):/.test(e.lid));
const SAGA = { id: O, steps: [
  { id: 'reserve', do: { system: 'inventory', op: 'reserve' }, undo: { system: 'inventory', op: 'release' } },
  { id: 'charge', do: { system: 'billing', op: 'charge' }, undo: { system: 'billing', op: 'refund' } },
  { id: 'ship', do: { system: 'carrier', op: 'create' }, undo: { system: 'carrier', op: 'cancel' } },
] };
/** The independent planner's compensation, in the transition's lid vocabulary, as ordered groups. */
function plannerGroups(committedSteps, abort) {
  const steps = Object.fromEntries(SAGA.steps.map((s, i) => [s.id, i < committedSteps ? { outcome: 'ok' } : { outcome: 'not-started' }]));
  const plan = planSaga(SAGA, { steps }, abort ? { abort: { reason: 'cancel' } } : {});
  if (plan.action !== 'compensate') return [];
  const groups = [];
  for (const c of plan.compensations) {
    const lids = c.op === 'release' ? FUL.items.map(i => `rel:${F}:${i.sku}`) : [c.op === 'refund' ? `rf:${F}` : `csh:${F}`];
    (groups[c.group] ??= []).push(...lids);
  }
  return groups;
}
/** The transition's compensation as ordered groups (by `after` depth). */
function transitionGroups(E) {
  const c = comp(E);
  const depth = new Map();
  const d = e => { if (depth.has(e.lid)) return depth.get(e.lid); const ps = (e.after ?? []).map(p => c.find(x => x.lid === p)).filter(Boolean); const v = ps.length ? 1 + Math.max(...ps.map(d)) : 0; depth.set(e.lid, v); return v; };
  const groups = [];
  for (const e of c) (groups[d(e)] ??= []).push(e.lid);
  return groups.map(g => g.sort());
}

test('golden: a customer cancel before collection compensates exactly the committed steps, in reverse order (R6.2; MR11 vs lib/saga)', () => {
  for (const k of [0, 1, 2, 3]) {
    const { rows, t } = history(k);
    const a = t + 5 * MIN;
    const E = referenceTransition(W, view(a + MIN, rows, [ev(a, 'customer.action', { orderRef: O, action: 'cancel' })]));
    const expected = plannerGroups(k, true).map(g => g.sort());
    assert.deepEqual(transitionGroups(E), expected, `committed steps ${k}`);
    assert.ok(lidsOf(E).includes(`ost:${O}:cancelled`) && lidsOf(E).includes(`ntf:${O}:order-cancelled`), `k=${k} order cancelled`);
    assert.ok(!lidsOf(E).some(l => (l === `chg:${F}` && k < 2) || (l === `shp:${F}` && k < 3)), `k=${k}: no forward step after the cancel`);
  }
});

test('golden: a collection failure compensates refund then releases, never a shipment cancel (R5.1, R5.2)', () => {
  const { rows, t } = history(3);
  const R = t + 60 * MIN;
  const E = referenceTransition(W, view(R + MIN, rows, [ev(R, 'carrier.status', { carrier: loc.carrier, code: code('collectionFailed'), fulfilmentRef: F })]));
  assert.deepEqual(transitionGroups(E), [[`rf:${F}`], FUL.items.map(i => `rel:${F}:${i.sku}`).sort()]);
  const rf = E.effects.required.find(e => e.lid === `rf:${F}`);
  assert.equal(rf.match.amountMinor, amount, 'full refund');
  assert.ok(lidsOf(E).includes(`fst:${F}:failed`) && lidsOf(E).includes(`ntf:${F}:fulfilment-failed`));
  assert.ok(lidsOf(E).includes(`ost:${O}:failed`), 'single fulfilment failed: order failed (R4.5)');
});

test('golden: a declined charge releases the reservations only (R5.2)', () => {
  const { rows, t } = history(1);
  rows.push(row(t, 'billing', 'charge', { orderId: O, fulfilmentId: F, customerId: T.customerId, amountMinor: amount, currency: 'EUR' }, false, { error: { code: 402, reason: 'card-declined' } }));
  const E = referenceTransition(W, view(t + MIN, rows, []));
  assert.deepEqual(transitionGroups(E), [FUL.items.map(i => `rel:${F}:${i.sku}`).sort()]);
  assert.ok(!lidsOf(E).includes(`chg:${F}`), 'the declined charge is no longer required');
  assert.ok(lidsOf(E).includes(`fst:${F}:failed`));
});

test('golden: an unknown charge outcome is compensated iff it committed (S2, MR11)', () => {
  for (const committed of [true, false]) {
    const { rows, t } = history(2, { chargeUnknown: committed });
    const a = t + 5 * MIN;
    const E = referenceTransition(W, view(a + MIN, rows, [ev(a, 'customer.action', { orderRef: O, action: 'cancel' })]));
    assert.equal(lidsOf(E).includes(`rf:${F}`), committed, `committed=${committed}`);
  }
});

test('golden: a cancel after (or in the same instant as) the collection report is refused (R6.3, S4)', () => {
  const { rows, t } = history(3);
  const R = t + 60 * MIN;
  for (const a of [R + 30 * MIN, R]) {
    const col = ev(R, 'carrier.status', { carrier: loc.carrier, code: code('collected'), fulfilmentRef: F });
    const can = ev(a, 'customer.action', { orderRef: O, action: 'cancel' });
    const E = referenceTransition(W, view(a + MIN, rows, [col, can]));
    assert.ok(lidsOf(E).includes(`ntf:${O}:cancel-refused`), `a=${a - R}`);
    assert.equal(comp(E).length, 0);
    assert.ok(!lidsOf(E).includes(`ost:${O}:cancelled`));
  }
});

test('golden: a delivery report before the collection report: dispatched then completed, anchored at the delivery (R4.4, W2)', () => {
  const { rows, t } = history(3);
  const T2 = t + 30 * 60 * MIN;
  const del = ev(T2, 'carrier.status', { carrier: loc.carrier, code: code('delivered'), fulfilmentRef: F });
  const lateCol = ev(T2 + 90 * MIN, 'carrier.status', { carrier: loc.carrier, code: code('collected'), fulfilmentRef: F });
  const E = referenceTransition(W, view(T2 + 100 * MIN, rows, [del, lateCol]));
  const disp = E.effects.required.find(e => e.lid === `fst:${F}:dispatched`);
  const done = E.effects.required.find(e => e.lid === `fst:${F}:completed`);
  assert.equal(disp.window.earliest, T2, 'a late collection report does not move dispatched');
  assert.deepEqual(done.after.filter(x => x.startsWith('fst:')), [`fst:${F}:dispatched`]);
  assert.ok(lidsOf(E).includes(`ost:${O}:completed`));
});

test('golden: the customer-action race: an action exactly at D counts, the timeout is taken strictly after D (R3.2, S1)', () => {
  const [c2, t2] = pick(t => t.class === 'timeout');
  const p = Date.parse(t2.placedAt);
  const D = p + 4 * 60 * MIN;
  const v = (at, events) => ({ case: c2, at, seq: Infinity, world: W, truth: t2, rows: [{ seq: 1, at: p + MIN, system: 'orders', op: 'create', key: 'k', args: { orderId: t2.subject }, committed: true, case: c2, callAt: p + MIN, knows: new Set() }], tasks: [], taskEvents: [], events });
  const Et = referenceTransition(W, v(D + MIN, []));
  const to = Et.effects.required.find(e => e.lid === `ost:${t2.subject}:timedOut`);
  // S1: strictly after D. An effect exactly at D is outside the window (the grader's test: at < earliest is early); the
  // window opens within the minute after D (the grader's time resolution is not pinned).
  assert.ok(to.window.earliest > D && to.window.earliest <= D + MIN, `timeout earliest ${to.window.earliest - D} ms after D`);
  assert.ok(D < to.window.earliest, 'an effect exactly at D is outside the window');
  assert.equal(to.window.latest, D + 60 * MIN);
  const Ea = referenceTransition(W, v(D + MIN, [{ id: 'a', type: 'customer.action', at: D, seq: 5, payload: { orderRef: t2.subject, action: 'cancel' } }]));
  assert.ok(Ea.effects.required.some(e => e.lid === `ost:${t2.subject}:cancelled`), 'action at D counts');
  assert.ok(!Ea.effects.required.some(e => e.lid === `ost:${t2.subject}:timedOut`));
  const El = referenceTransition(W, v(D + 2 * MIN, [{ id: 'b', type: 'customer.action', at: D + MIN, seq: 5, payload: { orderRef: t2.subject, action: 'amend' } }]));
  assert.ok(El.effects.required.some(e => e.lid === `ost:${t2.subject}:timedOut`), 'an action after D is late');
});

test('grader: same-instant knowledge is per message (S10): a step by a call that was not given the cancel is in flight, not new', () => {
  // One instant a: a carrier info report reaches the order's instance (the call that also reserves... and charges), and a
  // customer cancel reaches another instance (merged later). The charge emitted by the first call was taken before the
  // cancel (S10): it is in flight, so the grader matches it to the charge lid the cancel withdrew. The same charge from
  // a call that had been given the cancel is new after it (R6.2): outside what is allowed.
  const a = P + 10 * MIN;
  const lidMatch = (E, l) => E.effects.required.find(e => e.lid === l).match;
  const E0 = referenceTransition(W, view(P + MIN, [], []));
  const r = (seq, at, system, op, args, given) => ({ seq, at, system, op, key: `${op}:${seq}`, args, committed: true, status: 'ok', error: null, case: CASE,
    money: system === 'billing', callAt: at, knows: new Set([CASE]), given: new Set(given) });
  const early = [r(2, P, 'orders', 'create', lidMatch(E0, `create:${O}`), ['g-placed']),
    r(3, P + MIN, 'orders', 'setStatus', lidMatch(E0, `ost:${O}:processing`), []), r(4, P + MIN, 'orders', 'setStatus', lidMatch(E0, `fst:${F}:processing`), []),
    ...FUL.items.map((i, k) => r(10 + k, a - MIN, 'inventory', 'reserve', lidMatch(E0, `rsv:${F}:${i.sku}`), []))];
  const E1 = referenceTransition(W, view(a, early, []));
  const d = (seq, at, id, type, source, payload) => ({ seq, at, event: { id, type, source, payload }, instance: 'i-1', round: 1, route: null, case: CASE, truth: true });
  const infoCode = { PARCELLA: 'LABEL_CREATED', VELOX: 'LB', SWIFTLINE: 'manifested' }[loc.carrier];
  const deliveries = [d(1, P, 'g-placed', 'order.placed', 'shop', { orderId: O }),
    d(20, a, 'g-info', 'carrier.status', 'carrier', { carrier: loc.carrier, code: infoCode, fulfilmentRef: F, reportedAt: new Date(a).toISOString() }),
    d(21, a, 'g-cancel', 'customer.action', 'customer-portal', { orderRef: O, action: 'cancel' })];
  const grade = given => {
    const ledger = [...early, r(22, a, 'billing', 'charge', lidMatch(E1, `chg:${F}`), given)];
    const b = { deliveries, ledger, tasks: [], taskEvents: [], calls: [] };
    const idx = { world: W, horizonMs: a + MIN, ledger, writes: [], bucket: c => (c === CASE ? b : { deliveries: [], ledger: [], tasks: [], taskEvents: [], calls: [] }) };
    return gradeCase({ item: oracleItem, world: W, idx, c: CASE });
  };
  const inFlight = grade(['g-info']);
  assert.equal(inFlight.firstDivergence, null, `a charge from a call not given the cancel: ${JSON.stringify(inFlight.firstDivergence)}`);
  const reacted = grade(['g-cancel']);
  assert.deepEqual([reacted.firstDivergence?.layer, reacted.firstDivergence?.code, reacted.firstDivergence?.system], [2, 'outside-allowed', 'billing']);
});

test('golden module: every exported golden passes the reference transition (the same set the mutation tool runs per mutant)', () => {
  assert.ok(goldens.length >= 20, `only ${goldens.length} goldens`);
  for (const r of runGoldens(referenceTransition, recordsOf)) assert.ok(r.pass, `${r.name} (${r.source}): ${r.detail}`);
});

test('spec-E is the module\'s spec and names every rule the oracle cites', () => {
  for (const r of ['R1.1', 'R1.3', 'R2.1', 'R2.2', 'R3.1', 'R3.2', 'R4.1', 'R4.2', 'R4.3', 'R4.4', 'R4.5', 'R5.1', 'R5.2', 'R6.1', 'R6.2', 'R6.3', 'R6.4', 'R7.2']) assert.ok(specE.text.includes(r), r);
  assert.equal(family.profile, 'temporal-like');
});
