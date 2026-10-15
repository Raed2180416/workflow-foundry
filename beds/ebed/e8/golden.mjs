// E8 goldens (E-BED §9.1, contract §11): hand-derived histories fed straight to a reference transition, each with the
// expectation the rules give, cited. Exported as data + a runner so the item suite and the oracle mutation tool
// (tools/mutate.mjs) run the same checks against the real transition and against every mutant. The saga failure points
// are cross-checked against the independent planner beds/ebed/lib/saga.mjs (MR11). $0.
// A golden asserts only spec-stated outcomes the grader can see (ledger/MUTANTS.md §0): which lids are open, their
// windows, order and predecessors, permitted patterns and records the grader compares. Checks of the transition that the
// grader cannot see (a lid named twice, whether a step the arm already took stays named, recordsOf on states the grader
// never compares, inputs outside the world contract) are unit checks in test/unit-checks.mjs, run by the item suite only.
import { generateWorld } from './world.mjs';
import { planSaga } from '../lib/saga.mjs';

const MIN = 60_000;
const W = generateWorld({ seed: 1001, difficulty: 3, mix: 'tail' });
const W4 = generateWorld({ seed: 1001, difficulty: 4, mix: 'tail' });
const casesOf = (w, pred) => Object.entries(w.truth.cases).filter(([, t]) => pred(t));
const allocOf = (w, O) => w.sor['inventory.allocations'].find(a => a.orderId === O).fulfilments;
const [CASE, T] = casesOf(W, t => t.class === 'straight' && allocOf(W, t.subject).length === 1)[0];
const O = T.subject;
const FUL = allocOf(W, O)[0];
const F = FUL.fulfilmentId;
const P = Date.parse(T.placedAt);
const loc = W.master.locations.find(l => l.location === FUL.location);
const CODES = { PARCELLA: { collected: 'COLLECTED', inTransit: 'IN_TRANSIT', delivered: 'DELIVERED', collectionFailed: 'NOT_COLLECTED', info: 'LABEL_CREATED' }, VELOX: { collected: 'PU', inTransit: 'IT', delivered: 'DL', collectionFailed: 'NC', info: 'LB' }, SWIFTLINE: { collected: 'picked', inTransit: 'moving', delivered: 'handed-over', collectionFailed: 'not-collected', info: 'manifested' } };
const code = m => CODES[loc.carrier][m];
const price = (w, sku) => w.master.catalog.find(c => c.sku === sku).unitPriceMinor;
const fee0 = (w, location, ed = 0) => JSON.parse(w.rulebook.editions[ed].files['shipping-fees.json']).find(x => x.location === location).feeMinor;
const AMOUNT = FUL.items.reduce((s, i) => s + i.qty * price(W, i.sku), 0) + fee0(W, FUL.location);

function builder(c, w = W) {
  let seq = 0;
  return {
    row: (at, system, op, args, committed = true, extra = {}) => ({ seq: ++seq, at, system, op, key: `${op}:${seq}`, args, committed, status: committed ? 'ok' : 'error', error: null, case: c, callAt: at, knows: new Set(), given: new Set(), money: system === 'billing', ...extra }),
    ev: (at, type, payload) => ({ id: `g-${++seq}`, type, at, seq, source: 'golden', payload }),
    view: (at, t, rows, events, extra = {}) => ({ case: c, at, seq: Infinity, world: w, truth: t, rows, tasks: [], taskEvents: [], events, ...extra }),
  };
}
const B = builder(CASE);
const placed = B.ev(P, 'order.placed', { orderId: O });
/** The happy path up to step k (0 nothing, 1 reserved, 2 charged, 3 shipped), one minute apart. */
function history(k, { chargeUnknown = null } = {}) {
  const rows = [B.row(P + MIN, 'orders', 'create', { orderId: O })];
  let t = P + 2 * MIN;
  if (k >= 1) for (const i of FUL.items) rows.push(B.row(t, 'inventory', 'reserve', { orderId: O, fulfilmentId: F, location: FUL.location, sku: i.sku, qty: i.qty }));
  t += MIN;
  if (k >= 2) rows.push(B.row(t, 'billing', 'charge', { orderId: O, fulfilmentId: F, customerId: T.customerId, amountMinor: AMOUNT, currency: 'EUR' }, chargeUnknown ?? true, chargeUnknown === null ? {} : { status: 'unknown' }));
  t += MIN;
  if (k >= 3) rows.push(B.row(t, 'carrier', 'create', { orderId: O, fulfilmentId: F, location: FUL.location, ref: null }));
  return { rows, t: t + MIN };
}
const lids = E => E.effects.required.map(e => e.lid);
/** R4.3: the collection run that collects a shipment booked at `booked` at a location (default: the golden order's). */
function runOf(booked, at = loc) {
  const cutoff = JSON.parse(W.rulebook.editions[0].files['policy.json']).collectionCutoffMinutes;
  const [h, m] = at.collectionTime.split(':').map(Number);
  for (let d = -1; d < 40; d++) { const r = Date.parse(W.t0) + (d * 1440 + h * 60 + m) * MIN; if (r >= booked + cutoff * MIN) return r; }
  return null;
}
const comp = E => E.effects.required.filter(e => /^(csh|rf|rel):/.test(e.lid));
const SAGA = { id: O, steps: [
  { id: 'reserve', do: { system: 'inventory', op: 'reserve' }, undo: { system: 'inventory', op: 'release' } },
  { id: 'charge', do: { system: 'billing', op: 'charge' }, undo: { system: 'billing', op: 'refund' } },
  { id: 'ship', do: { system: 'carrier', op: 'create' }, undo: { system: 'carrier', op: 'cancel' } },
] };
function plannerGroups(committedSteps) {
  const steps = Object.fromEntries(SAGA.steps.map((s, i) => [s.id, i < committedSteps ? { outcome: 'ok' } : { outcome: 'not-started' }]));
  const plan = planSaga(SAGA, { steps }, { abort: { reason: 'cancel' } });
  if (plan.action !== 'compensate') return [];
  const groups = [];
  for (const c of plan.compensations) (groups[c.group] ??= []).push(...(c.op === 'release' ? FUL.items.map(i => `rel:${F}:${i.sku}`) : [c.op === 'refund' ? `rf:${F}` : `csh:${F}`]));
  return groups.map(g => g.sort());
}
function groupsOf(E) {
  const c = comp(E);
  const depth = new Map();
  const d = e => { if (depth.has(e.lid)) return depth.get(e.lid); const ps = (e.after ?? []).map(p => c.find(x => x.lid === p)).filter(Boolean); const v = ps.length ? 1 + Math.max(...ps.map(d)) : 0; depth.set(e.lid, v); return v; };
  const groups = [];
  for (const e of c) (groups[d(e)] ??= []).push(e.lid);
  return groups.map(g => g.sort());
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const has = (E, l) => lids(E).includes(l);
const win = (E, l) => E.effects.required.find(e => e.lid === l)?.window ?? null;
/** The grader's window test (oracle/grade.mjs: a commit before `earliest` is early, after `latest` late). */
const inWindow = (w, t) => t >= w.earliest && t <= w.latest;
/**
 * S1 "after the deadline": an effect exactly at the deadline is outside the window and the window opens within the
 * minute after it (the grader's time resolution is not pinned: any earliest in (D, D + 1 min] is a correct encoding).
 */
const afterDeadline = (w, D, latest) => (w && w.earliest > D && w.earliest <= D + MIN && !inWindow(w, D) && inWindow(w, D + MIN) && w.latest === latest ? null
  : `window ${JSON.stringify(w)}: expected (D, D + 1 min] .. ${latest} with an effect at D (${D}) outside it`);

/** Each golden: { name, source (rule), check(transition, recordsOf) -> true | string (why it failed) }. */
export const goldens = [];
const G = (name, source, check) => goldens.push({ name, source, check });

for (const k of [0, 1, 2, 3]) {
  G(`cancel-before-collection-after-${k}-steps`, 'R6.2, R5.1; MR11 vs lib/saga', tr => {
    const { rows, t } = history(k);
    const a = t + 5 * MIN;
    const E = tr(W, B.view(a + MIN, T, rows, [placed, B.ev(a, 'customer.action', { orderRef: O, action: 'cancel' })]));
    if (!same(groupsOf(E), plannerGroups(k))) return `compensation groups ${JSON.stringify(groupsOf(E))} != planner ${JSON.stringify(plannerGroups(k))}`;
    if (!has(E, `ost:${O}:cancelled`) || !has(E, `ntf:${O}:order-cancelled`)) return 'order not cancelled';
    if ((k < 2 && has(E, `chg:${F}`)) || (k < 3 && has(E, `shp:${F}`))) return 'forward step still required after the cancel';
    return true;
  });
}
G('collection-failure-refund-then-release', 'R5.1, R5.2', tr => {
  const { rows } = history(3);                 // booked at P + 4 min: the carrier reports at its collection run (R4.3)
  const R = runOf(P + 4 * MIN);
  const E = tr(W, B.view(R + MIN, T, rows, [placed, B.ev(R, 'carrier.status', { carrier: loc.carrier, code: code('collectionFailed'), fulfilmentRef: F, reportedAt: new Date(R).toISOString() })]));
  if (!same(groupsOf(E), [[`rf:${F}`], FUL.items.map(i => `rel:${F}:${i.sku}`).sort()])) return `groups ${JSON.stringify(groupsOf(E))}`;
  if (E.effects.required.find(e => e.lid === `rf:${F}`).match.amountMinor !== AMOUNT) return 'refund not the full amount';
  if (!has(E, `fst:${F}:failed`) || !has(E, `ntf:${F}:fulfilment-failed`) || !has(E, `ost:${O}:failed`)) return 'failure statuses or notice missing';
  return true;
});
G('declined-charge-releases-only', 'R5.2', tr => {
  const { rows, t } = history(1);
  rows.push(B.row(t, 'billing', 'charge', { orderId: O, fulfilmentId: F, customerId: T.customerId, amountMinor: AMOUNT, currency: 'EUR' }, false, { error: { code: 402, reason: 'card-declined' } }));
  const E = tr(W, B.view(t + MIN, T, rows, [placed]));
  if (!same(groupsOf(E), [FUL.items.map(i => `rel:${F}:${i.sku}`).sort()])) return `groups ${JSON.stringify(groupsOf(E))}`;
  if (has(E, `chg:${F}`)) return 'declined charge still required';
  return has(E, `fst:${F}:failed`) ? true : 'not failed';
});
for (const committed of [true, false]) G(`unknown-charge-committed-${committed}`, 'S2, MR11', tr => {
  const { rows, t } = history(2, { chargeUnknown: committed });
  const a = t + 5 * MIN;
  const E = tr(W, B.view(a + MIN, T, rows, [placed, B.ev(a, 'customer.action', { orderRef: O, action: 'cancel' })]));
  return has(E, `rf:${F}`) === committed ? true : `refund required: ${has(E, `rf:${F}`)}`;
});
for (const dt of [30, 0]) G(`cancel-${dt ? 'after' : 'at'}-collection-refused`, 'R6.3, S4, S7', tr => {
  const { rows } = history(3);                 // booked at P + 4 min, collected at its collection run (R4.3)
  const R = runOf(P + 4 * MIN);
  const a = R + dt * MIN;
  const E = tr(W, B.view(a + MIN, T, rows, [placed, B.ev(R, 'carrier.status', { carrier: loc.carrier, code: code('collected'), fulfilmentRef: F, reportedAt: new Date(R).toISOString() }), B.ev(a, 'customer.action', { orderRef: O, action: 'cancel' })]));
  if (!has(E, `ntf:${O}:cancel-refused`)) return 'no cancel-refused';
  return comp(E).length || has(E, `ost:${O}:cancelled`) ? 'order stopped after collection' : true;
});
G('delivery-before-collection-report', 'R4.4, W2', tr => {
  const { rows } = history(3);                 // booked at P + 4 min, collected at R; the collection report is held up (W2)
  const R = runOf(P + 4 * MIN), T2 = R + 30 * 60 * MIN;
  const E = tr(W, B.view(T2 + 100 * MIN, T, rows, [placed, B.ev(T2, 'carrier.status', { carrier: loc.carrier, code: code('delivered'), fulfilmentRef: F, reportedAt: new Date(T2).toISOString() }),
    B.ev(T2 + 90 * MIN, 'carrier.status', { carrier: loc.carrier, code: code('collected'), fulfilmentRef: F, reportedAt: new Date(R).toISOString() })]));
  if (win(E, `fst:${F}:dispatched`)?.earliest !== T2) return 'dispatched not anchored at the delivery report';
  const done = E.effects.required.find(e => e.lid === `fst:${F}:completed`);
  if (!done?.after?.includes(`fst:${F}:dispatched`)) return 'completed not after dispatched';
  return has(E, `ost:${O}:completed`) ? true : 'order not completed';
});
G('cancel-stops-before-processing-set (S9)', 'S9, R4.1', tr => {
  const rows = [B.row(P + MIN, 'orders', 'create', { orderId: O })];
  const a = P + 10 * MIN;
  const E = tr(W, B.view(a + MIN, T, rows, [placed, B.ev(a, 'customer.action', { orderRef: O, action: 'cancel' })]));
  if (has(E, `ost:${O}:processing`) || has(E, `fst:${F}:processing`)) return 'processing still required after a cancel that came first';
  if (!E.effects.permitted.some(p => p.op === 'setStatus' && p.match?.status === 'processing')) return 'processing not permitted';
  return has(E, `ost:${O}:cancelled`) ? true : 'order not cancelled';
});
G('processing-required-without-cancel', 'R4.1', tr => {
  const E = tr(W, B.view(P + 2 * MIN, T, [B.row(P + MIN, 'orders', 'create', { orderId: O })], [placed]));
  const w = win(E, `ost:${O}:processing`);
  return w && w.earliest === P && w.latest === P + 60 * MIN ? true : `processing window ${JSON.stringify(w)}`;
});

// Customer-action race (R3.2, S1) and amend-then-cancel (S8).
const [C2, T2c] = casesOf(W, t => t.class === 'timeout')[0];
const B2 = builder(C2);
const p2 = Date.parse(T2c.placedAt), D2 = p2 + 4 * 60 * MIN, O2 = T2c.subject;
const created2 = [B2.row(p2 + MIN, 'orders', 'create', { orderId: O2 })];
G('timeout-strictly-after-deadline', 'R3.2, S1', tr => {
  const why = afterDeadline(win(tr(W, B2.view(D2 + MIN, T2c, created2, [])), `ost:${O2}:timedOut`), D2, D2 + 60 * MIN);
  return why ? `timeout ${why}` : true;
});
G('action-at-deadline-counts', 'R3.2, S1', tr => {
  const E = tr(W, B2.view(D2 + MIN, T2c, created2, [B2.ev(D2, 'customer.action', { orderRef: O2, action: 'cancel' })]));
  return has(E, `ost:${O2}:cancelled`) && !has(E, `ost:${O2}:timedOut`) ? true : 'action at D did not count';
});
G('action-after-deadline-is-late', 'R3.2', tr => {
  const E = tr(W, B2.view(D2 + 2 * MIN, T2c, created2, [B2.ev(D2 + MIN, 'customer.action', { orderRef: O2, action: 'amend' })]));
  return has(E, `ost:${O2}:timedOut`) ? true : 'late action counted';
});
G('action-before-status-supersedes-R3.1 (S9)', 'S9, R3.1', tr => {
  const E = tr(W, B2.view(p2 + 80 * MIN, T2c, created2, [B2.ev(p2 + 75 * MIN, 'customer.action', { orderRef: O2, action: 'cancel' })]));
  return !has(E, `ost:${O2}:customerActionRequired`) && !has(E, `ntf:${O2}:action-required`) ? true : 'R3.1 still required after the customer acted first';
});
G('amend-then-cancel-is-a-processing-cancel (S8)', 'S8, R6.2', tr => {
  const a1 = p2 + 80 * MIN, a2 = p2 + 100 * MIN;
  const E = tr(W, B2.view(a2 + MIN, T2c, created2, [B2.ev(a1, 'customer.action', { orderRef: O2, action: 'amend' }), B2.ev(a2, 'customer.action', { orderRef: O2, action: 'cancel' })]));
  const avail = allocOf(W, O2).filter(f => f.available);
  if (!avail.length) return true;
  return has(E, `ost:${O2}:cancelled`) ? true : 'cancel after an amend was not judged by R6.2';
});

// R1.3 editions: the edition of the placement DATE in Europe/Amsterdam (a late-evening order on the day before the switch).
const [C4, T4] = casesOf(W4, t => t.subject && allocOf(W4, t.subject).some(f => f.available))[0];
G('edition-by-local-placement-date', 'R1.3', tr => {
  const late = '2026-03-07T23:30:00+01:00';
  const t4 = { ...T4, placedAt: late, start: late, class: 'straight', verdict: 'pass' };
  const pl = Date.parse(late);
  const B4 = builder(C4, W4);
  const E = tr(W4, B4.view(pl + MIN, t4, [], [B4.ev(pl, 'order.placed', { orderId: t4.subject })]));
  const create = E.effects.required.find(e => e.lid === `create:${t4.subject}`);
  const f = create.match.fulfilments.find(x => x.location);
  const fee1 = fee0(W4, f.location, 0), items = f.items.reduce((s, i) => s + i.qty * price(W4, i.sku), 0);
  return f.amountMinor === items + fee1 ? true : `fee of the wrong edition (${f.amountMinor - items} vs ${fee1})`;
});

// Go-live: a dispatched backlog order completes on its delivery report (no dispatched status re-required).
const glc = casesOf(W, t => t.class === 'gl-dispatched')[0];
if (glc) {
  const [C5, T5] = glc;
  const B5 = builder(C5);
  const b = W.backlog.find(x => x.case === C5);
  G('go-live-dispatched-completes-on-delivery', '§3.5, R4.4, R4.5', tr => {
    const del = Date.parse(T5.fulfilments[Object.keys(T5.fulfilments)[0]].deliveredAt);
    const F5 = Object.keys(T5.fulfilments)[0];
    const mig = B5.ev(Date.parse(W.t0), 'migration', { records: b.export.records, events: b.export.events });
    const dl = W.arrivals.find(x => x.id === `ev-${T5.subject}-gl-del`);
    const E = tr(W, B5.view(del + MIN, T5, [], [mig, B5.ev(del, 'carrier.status', dl.payload)]));
    if (has(E, `fst:${F5}:dispatched`) || has(E, `create:${T5.subject}`)) return 'pre-go-live steps required again';
    return has(E, `fst:${F5}:completed`) && has(E, `ost:${T5.subject}:completed`) ? true : 'not completed on delivery';
  });
}

// Fraud review deadline (R2.2): an answer exactly at the deadline counts; the cancel after it is strictly later.
const rv = casesOf(W, t => t.class === 'review-timeout')[0] ?? casesOf(W, t => t.verdict === 'review')[0];
if (rv) {
  const [C6, T6] = rv;
  const B6 = builder(C6);
  const p6 = Date.parse(T6.placedAt);
  const task = { seq: 2, at: p6 + 5 * MIN, instance: 'i-1', task: { id: 'r1', kind: 'fraudReview', role: 'fraudAnalyst' }, case: C6 };
  const dl = task.at + 24 * 60 * MIN;
  const base = [B6.row(p6 + MIN, 'orders', 'create', { orderId: T6.subject })];
  G('review-answer-at-deadline-counts', 'R2.2, S1', tr => {
    const E = tr(W, B6.view(dl + MIN, T6, base, [], { tasks: [task], taskEvents: [{ seq: 9, at: dl, type: 'humanTask.answered', instance: 'i-1', payload: { taskId: 'r1', answer: { decision: 'approve' } } }] }));
    return has(E, `ost:${T6.subject}:processing`) || has(E, `ost:${T6.subject}:customerActionRequired`) ? true : 'answer at the deadline did not count';
  });
  G('review-timeout-strictly-after-deadline', 'R2.2, S1', tr => {
    const why = afterDeadline(win(tr(W, B6.view(dl + MIN, T6, base, [], { tasks: [task], taskEvents: [] })), `ost:${T6.subject}:cancelled`), dl, dl + 120 * MIN);
    return why ? `review-timeout ${why}` : true;
  });
  G('free-text-answer-is-unusable', 'R2.2', tr => {
    const E = tr(W, B6.view(dl + MIN, T6, base, [], { tasks: [task], taskEvents: [{ seq: 9, at: p6 + 60 * MIN, type: 'humanTask.answered', instance: 'i-1', payload: { taskId: 'r1', answer: { text: 'approve - fine' } } }] }));
    return has(E, `ost:${T6.subject}:cancelled`) ? true : 'free text counted as an answer';
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Survivor goldens (oracle mutation run 2026-10-14; ledger/MUTANTS.md). Each pins behaviour the corpus never reaches, with
// the SPEC-E sentence it rests on. A same-instant tie is pinned only where a reading settles it (S4 delivery order, S10
// knowledge, S11 ready instant, S12 answer and cancel, S13 endings at a cancel's instant); same-instant events are built
// in the platform's delivery order (S4: by source, so `actor` < `carrier` < `customer-portal` < `shop`).
const pick = (pred, what, w = W) => { const x = casesOf(w, pred)[0]; if (!x) throw new Error(`golden fixture: no ${what} case`); return x; };
/** R1.3: the policy of the edition in force on the (Europe/Amsterdam) date of p. */
const policyOf = (w, placedAt) => JSON.parse(w.rulebook.editions.filter(e => e.effectiveFrom <= placedAt.slice(0, 10))
  .sort((x, y) => (x.effectiveFrom < y.effectiveFrom ? -1 : 1)).at(-1).files['policy.json']);
const POL = policyOf(W, T.placedAt);
const span = (E, l, e, x) => { const w = win(E, l); return w && w.earliest === e && w.latest === x ? true : `${l} window ${JSON.stringify(w)}, expected [${e}, ${x}]`; };
const report = (at, meaning, reportedAt = at) => B.ev(at, 'carrier.status', { carrier: loc.carrier, code: code(meaning), fulfilmentRef: F, reportedAt: new Date(reportedAt).toISOString() });
const act = (b, at, orderRef, action) => b.ev(at, 'customer.action', { orderRef, action });
const CHG = { orderId: O, fulfilmentId: F, customerId: T.customerId, amountMinor: AMOUNT, currency: 'EUR' };
const declined = at => B.row(at, 'billing', 'charge', CHG, false, { error: { code: 402, reason: 'card-declined' } });
const rsvArgs = i => ({ orderId: O, fulfilmentId: F, location: FUL.location, sku: i.sku, qty: i.qty });
const sends = (list, template, about = null) => list.some(e => e.system === 'notify' && e.op === 'send' && e.match?.template === template && (about === null || e.match?.about === about));
const asked = (E, system, op) => [...E.effects.required, ...E.effects.permitted].some(e => e.system === system && e.op === op);

// S9, S10, R4.1, R4.2, R6.2, §1: "before" a counted processing cancel. A step taken by the call that was given the cancel
// (one case-tick, §1: it reacted to the cancel) or at a later instant is taken after it (S10): a reservation then is
// something "new for the order after the cancel" (R6.2) and is released; a `processing` status then is not required,
// only permitted (S9). A reservation taken in the cancel's instant by a call that was given another message about the
// order but not the cancel was taken before it (S10: knowledge is per message): one already in flight, released.
// (Whether a step the arm already took stays named is not visible to the grader: test/unit-checks.mjs.)
G('steps-before-vs-after-a-processing-cancel', 'S9, S10, R4.1, R4.2, R6.2, §1', tr => {
  const a = P + 10 * MIN;
  const info = report(a, 'info');                         // built first: in one instant carrier messages come first (S4)
  const cancel = act(B, a, O, 'cancel');
  const create = B.row(P + MIN, 'orders', 'create', { orderId: O });
  const rsv = (at, extra = {}) => FUL.items.map(i => B.row(at, 'inventory', 'reserve', rsvArgs(i), true, extra));
  const sts = (at, extra = {}) => [B.row(at, 'orders', 'setStatus', { orderId: O, fulfilmentId: null, status: 'processing' }, true, extra), B.row(at, 'orders', 'setStatus', { orderId: O, fulfilmentId: F, status: 'processing' }, true, extra)];
  const gotCancel = { callAt: a, knows: new Set([CASE]), given: new Set([cancel.id]) };
  const E2 = tr(W, B.view(a + 2 * MIN, T, [create, ...rsv(a, gotCancel)], [placed, cancel]));
  const E3 = tr(W, B.view(a + 3 * MIN, T, [create, ...rsv(a + 2 * MIN, { callAt: a + MIN })], [placed, cancel]));
  if (FUL.items.some(i => !has(E2, `rel:${F}:${i.sku}`) || !has(E3, `rel:${F}:${i.sku}`))) return 'a reservation committed after the cancel is not released';
  // E4: `processing` set by the call that was given the cancel (S9: allowed, not required; S10: taken after the cancel).
  const E4 = tr(W, B.view(a + 2 * MIN, T, [create, ...sts(a, gotCancel)], [placed, cancel]));
  if (has(E4, `ost:${O}:processing`) || has(E4, `fst:${F}:processing`)) return 'processing set by the call that was given the cancel is required (S10: it was taken after the cancel)';
  if (!E4.effects.permitted.some(p => p.op === 'setStatus' && p.match?.status === 'processing')) return 'processing set with the cancel not permitted (S9)';
  // E6: `processing` set at a later instant than the cancel (by a call that was not given it): taken after it (S10), so
  // not required, only permitted (S9).
  const E6 = tr(W, B.view(a + 3 * MIN, T, [create, ...sts(a + 2 * MIN, { callAt: a + MIN })], [placed, cancel]));
  if (has(E6, `ost:${O}:processing`) || has(E6, `fst:${F}:processing`)) return 'processing set at a later instant than the cancel is required (S10: it was taken after the cancel)';
  if (!E6.effects.permitted.some(p => p.op === 'setStatus' && p.match?.status === 'processing')) return 'processing set after the cancel not permitted (S9)';
  // E5: in the cancel's instant, a call given a carrier report about the order but not the cancel reserves: before the
  // cancel (S10), one already in flight, released.
  const E5 = tr(W, B.view(a + 2 * MIN, T, [create, ...rsv(a, { callAt: a, knows: new Set([CASE]), given: new Set([info.id]) })], [placed, info, cancel]));
  if (FUL.items.some(i => !has(E5, `rel:${F}:${i.sku}`))) return 'a reservation by a call that was not given the cancel (S10) is not released';
  return [E2, E3, E4, E5, E6].every(E => has(E, `ost:${O}:cancelled`)) ? true : 'order not cancelled';
});

// R3.2, R6.1, R7.2, §4.8, §3.5: W4's go-live order already awaiting the customer, with nothing available, is amended: "If
// none is available, cancel the order (R6.1)" within 60 min of the amend. (That no lid is named twice is a unit check of
// the transition, test/unit-checks.mjs: the grader merges lids by id.)
{
  const [Cn, Tn] = pick(t => t.class === 'gl-awaiting' && allocOf(W4, t.subject).every(f => !f.available), 'go-live awaiting order with nothing available', W4);
  const Bn = builder(Cn, W4), bn = W4.backlog.find(x => x.case === Cn);
  const On = Tn.subject, Dn = Date.parse(Tn.placedAt) + policyOf(W4, Tn.placedAt).customerActionHours * 60 * MIN;
  G('awaiting-amend-nothing-available-cancels-once', 'R3.2, R6.1, R7.2, §4.8, §3.5', tr => {
    const t0 = Date.parse(W4.t0), a = t0 + 30 * MIN;
    if (a > Dn) return 'fixture: the amend falls after D';
    const mig = Bn.ev(t0, 'migration', { records: bn.export.records, events: bn.export.events });
    const E = tr(W4, Bn.view(a + MIN, Tn, [], [mig, act(Bn, a, On, 'amend')]));
    for (const f of allocOf(W4, On)) { const w = win(E, `fst:${f.fulfilmentId}:cancelled`); if (!w || w.earliest !== a || w.latest !== a + 60 * MIN) return `fulfilment ${f.fulfilmentId} cancel window ${JSON.stringify(w)}`; }
    if (has(E, `ost:${On}:processing`)) return 'processing required with nothing available';
    return has(E, `ost:${On}:cancelled`) && has(E, `ntf:${On}:order-cancelled`) ? true : 'order not cancelled (nothing available)';
  });
}

// §3.5, R6.2, R6.3, S6, S7: a go-live order whose shipment was reported collected before go-live (the report is in its
// migration) can no longer be cancelled: a customer cancel after go-live gets cancel-refused within 60 min, nothing else.
{
  const [Cd, Td] = pick(t => t.class === 'gl-dispatched', 'go-live dispatched order');
  const Bd = builder(Cd), bd = W.backlog.find(x => x.case === Cd), Od = Td.subject;
  G('go-live-collected-refuses-cancel', '§3.5, R6.2, R6.3, S6, S7', tr => {
    const t0 = Date.parse(W.t0), a = t0 + 30 * MIN;           // before the delivery report (the generator: t0 + 60 min or later)
    const mig = Bd.ev(t0, 'migration', { records: bd.export.records, events: bd.export.events });
    const E = tr(W, Bd.view(a + MIN, Td, [], [mig, act(Bd, a, Od, 'cancel')]));
    const w = win(E, `ntf:${Od}:cancel-refused`);
    if (!w || w.earliest !== a || w.latest !== a + 60 * MIN) return `cancel-refused window ${JSON.stringify(w)}`;
    if (has(E, `ost:${Od}:cancelled`) || has(E, `ntf:${Od}:order-cancelled`) || comp(E).length || lids(E).some(l => /^fst:.*:cancelled$/.test(l))) return 'order stopped although its shipment was reported collected before go-live';
    return true;
  });
}

// §3.5, R2.1, R6.1: a go-live order not yet recorded (intake: its migration carries no records) is a new order, "under the
// same rules": with a reject verdict it is cancelled within 120 min of p and never processed. (The generator gives every
// go-live order the verdict pass; the truth's verdict is set here, as the edition golden sets its placement.)
{
  const [Ci, Ti] = pick(t => t.class === 'gl-intake', 'go-live intake order');
  const Bi = builder(Ci), bi = W.backlog.find(x => x.case === Ci), pi = Date.parse(Ti.placedAt), Oi = Ti.subject;
  G('go-live-intake-fraud-reject-cancels', '§3.5, R2.1, R6.1', tr => {
    const t0 = Date.parse(W.t0);
    const mig = Bi.ev(t0, 'migration', { records: bi.export.records, events: bi.export.events });
    const E = tr(W, Bi.view(t0 + MIN, { ...Ti, verdict: 'reject' }, [], [mig]));
    const w = win(E, `ost:${Oi}:cancelled`);
    if (!w || w.earliest !== pi || w.latest !== pi + 120 * MIN) return `fraud cancel window ${JSON.stringify(w)}`;
    if (has(E, `ost:${Oi}:processing`) || E.effects.required.some(e => e.op === 'reserve')) return 'a fraud-rejected order is processed';
    return has(E, `create:${Oi}`) && has(E, `ntf:${Oi}:order-cancelled`) ? true : 'not recorded, or no order-cancelled';
  });
}

// R1.1: orders.create carries "items as placed" and "fulfilments as allocated"; the two differ when the allocation splits
// one SKU over two warehouses (hand-built: the generator never splits a SKU).
{
  const s0 = FUL.items[0].sku;
  const other = W.master.locations.find(l => l.location !== FUL.location).location;
  const split = [{ fulfilmentId: `${O}-F1`, location: FUL.location, items: [{ sku: s0, qty: 2 }], available: true }, { fulfilmentId: `${O}-F2`, location: other, items: [{ sku: s0, qty: 1 }], available: true }];
  const Ws = { ...W, sor: { ...W.sor, 'inventory.allocations': W.sor['inventory.allocations'].map(x => (x.orderId === O ? { orderId: O, fulfilments: split } : x)) } };
  const Bs = builder(CASE, Ws);
  G('create-items-as-placed-not-as-allocated', 'R1.1', tr => {
    const E = tr(Ws, Bs.view(P + MIN, T, [], [Bs.ev(P, 'order.placed', { orderId: O, customerId: T.customerId, placedAt: T.placedAt, currency: 'EUR', items: [{ sku: s0, qty: 3 }], channel: 'web' })]));
    const create = E.effects.required.find(e => e.lid === `create:${O}`);
    if (!create) return 'create not required';
    if (!same(create.match.items, [{ sku: s0, qty: 3 }])) return `items ${JSON.stringify(create.match.items)} are not the items as placed`;
    return same(create.match.fulfilments.map(f => [f.fulfilmentId, f.items]), split.map(f => [f.fulfilmentId, f.items])) ? true : 'fulfilments not as allocated';
  });
}

// R1.1, R1.4, §3.1: a second order.placed with the same order id "is a duplicate: no effect", even with other items and
// even when it arrives before the arm has recorded the order: the order is recorded with the items of its first placement
// (hand-built: the generator's duplicates repeat the payload exactly).
G('duplicate-placement-changes-no-items', 'R1.1, R1.4, §3.1', tr => {
  const items = FUL.items.map(i => ({ sku: i.sku, qty: i.qty }));
  const placedAs = its => ({ orderId: O, customerId: T.customerId, placedAt: T.placedAt, currency: 'EUR', items: its, channel: 'web' });
  const E = tr(W, B.view(P + 11 * MIN, T, [], [B.ev(P, 'order.placed', placedAs(items)), B.ev(P + 10 * MIN, 'order.placed', placedAs([{ sku: items[0].sku, qty: items[0].qty + 1 }]))]));
  const c = E.effects.required.find(e => e.lid === `create:${O}`);
  const want = [...items].sort((x, y) => (x.sku < y.sku ? -1 : 1));       // R1.1: list order is not significant
  return c && same(c.match.items, want) ? true : `create items ${JSON.stringify(c?.match.items)} after a duplicate placement, expected ${JSON.stringify(want)}`;
});

// Fraud review (R2.2, R6.4): an order under review with everything available.
const [C7, T7] = pick(t => t.verdict === 'review' && !t.class.startsWith('gl-') && allocOf(W, t.subject).every(f => f.available), 'fraud-review order with everything available');
const B7 = builder(C7), O7 = T7.subject, p7 = Date.parse(T7.placedAt);
const RVH = policyOf(W, T7.placedAt).fraudReviewHours;
const view7 = (at, events, tasks = [], taskEvents = []) => B7.view(at, T7, [B7.row(p7 + MIN, 'orders', 'create', { orderId: O7 })], [B7.ev(p7, 'order.placed', { orderId: O7 }), ...events], { tasks, taskEvents });
const task7 = (id, at, seq, instance = 'i-7') => ({ seq, at, instance, task: { id, kind: 'fraudReview', role: 'fraudAnalyst' }, case: C7 });
const answer7 = (id, at, seq, answer, instance = 'i-7') => ({ seq, at, type: 'humanTask.answered', instance, payload: { taskId: id, answer } });
{
  const cancelWithin60 = (E, a) => {
    const w = win(E, `ost:${O7}:cancelled`);
    return w && w.earliest === a && w.latest === a + 60 * MIN && has(E, `ntf:${O7}:order-cancelled`) ? null : `cancel window ${JSON.stringify(w)}, counted cancel at p+${(a - p7) / MIN} min`;
  };

  // R6.4, S5: only a `cancel` stops an order under fraud review; an amend (nothing unavailable) changes nothing.
  G('review-open-amend-changes-nothing', 'R6.4, S5, R2.2, R4.1', tr => {
    const amend = act(B7, p7 + 30 * MIN, O7, 'amend');
    if (has(tr(W, view7(p7 + 31 * MIN, [amend])), `ost:${O7}:cancelled`)) return 'an amend cancelled the order (no review task yet)';
    const E = tr(W, view7(p7 + 61 * MIN, [amend], [task7('r1', p7 + 5 * MIN, 900)], [answer7('r1', p7 + 60 * MIN, 950, { decision: 'approve' })]));
    if (has(E, `ost:${O7}:cancelled`)) return 'an amend cancelled the order (review open)';
    // R2.2: an approve clears the order at the answer; R4.1: ready then, `processing` within 60 min.
    const w = win(E, `ost:${O7}:processing`);
    return w && w.earliest === p7 + 60 * MIN && w.latest === p7 + 120 * MIN ? true : `processing window after the approve ${JSON.stringify(w)}`;
  });

  // R6.4, R6.3, R2.2, S1: a cancel while the order is not yet cleared counts; the first one counts, within 60 min of it.
  G('review-open-first-cancel-counts', 'R6.4, R6.3, R2.2, S1', tr => {
    // (a) no review task yet; cancels at p+10 and p+40: the first counts, the repeat changes nothing (R6.3).
    let why = cancelWithin60(tr(W, view7(p7 + 41 * MIN, [act(B7, p7 + 10 * MIN, O7, 'cancel'), act(B7, p7 + 40 * MIN, O7, 'cancel')])), p7 + 10 * MIN);
    if (why) return `no task: ${why}`;
    // (b) review open; cancels at p+30 and p+50, approve at p+70: the first cancel counts; "a later review answer changes nothing".
    const r1 = task7('r1', p7 + 5 * MIN, 900);
    why = cancelWithin60(tr(W, view7(p7 + 71 * MIN, [act(B7, p7 + 30 * MIN, O7, 'cancel'), act(B7, p7 + 50 * MIN, O7, 'cancel')], [r1], [answer7('r1', p7 + 70 * MIN, 950, { decision: 'approve' })])), p7 + 30 * MIN);
    if (why) return `review open: ${why}`;
    // (c) a cancel exactly at the review deadline, no answer: the review is still open then (R2.2 "an answer exactly at the
    // deadline still counts"; S1: the timeout follows the deadline), so the order is not cleared and the cancel counts.
    const dl = r1.at + RVH * 60 * MIN;
    why = cancelWithin60(tr(W, view7(dl + MIN, [act(B7, dl, O7, 'cancel')], [r1], [])), dl);
    return why ? `cancel at the deadline: ${why}` : true;
  });

  // R2.2, S3, S1, R4.1: the deadline runs from the FIRST review task; the order is cleared at the FIRST usable approve.
  G('review-first-task-and-first-answer-decide', 'R2.2, S3, S1, R4.1', tr => {
    // (a) r1's answer is free text (unusable), so the arm asks again (r2): "the deadline does not move" (R2.2, S3). An approve
    // after r1's deadline changes nothing; the order is cancelled for the timeout in (deadline, deadline + 120 min].
    const t1 = task7('r1', p7 + 5 * MIN, 900), t2 = task7('r2', p7 + 65 * MIN, 910);
    const dl = t1.at + RVH * 60 * MIN;
    const Ea = tr(W, view7(dl + 31 * MIN, [], [t1, t2], [answer7('r1', p7 + 60 * MIN, 905, { text: 'looks fine' }), answer7('r2', dl + 30 * MIN, 960, { decision: 'approve' })]));
    if (has(Ea, `ost:${O7}:processing`)) return 'an answer after the first task\'s deadline cleared the order';
    const wa = afterDeadline(win(Ea, `ost:${O7}:cancelled`), dl, dl + 120 * MIN);
    if (wa) return `review-timeout ${wa}`;
    // (b) two review tasks (a duplicate placement opened a second instance, §3.1), both approved, at p+30 and p+90: the order
    // is cleared at the first approve (R2.2) and ready then (R4.1); the second answer cannot move `processing`.
    const Eb = tr(W, view7(p7 + 91 * MIN, [], [task7('r1', p7 + 5 * MIN, 900), task7('r1', p7 + 6 * MIN, 901, 'i-8')],
      [answer7('r1', p7 + 30 * MIN, 950, { decision: 'approve' }), answer7('r1', p7 + 90 * MIN, 960, { decision: 'approve' }, 'i-8')]));
    const wb = win(Eb, `ost:${O7}:processing`);
    return wb && wb.earliest === p7 + 30 * MIN && wb.latest === p7 + 90 * MIN ? true : `processing window ${JSON.stringify(wb)}`;
  });

  // S12, S4, S11, R6.2, R2.2, S9, S15: a usable review answer and a customer cancel with the same time. The answer is
  // delivered first (S4: human-task events before customer actions), so it decides first. After an `approve` the order is
  // cleared and ready (R2.2, R4.1, S11): the cancel is a cancel during processing (R6.2) and counts within 60 min of it;
  // `processing` not yet set is only permitted (S9). After a `reject` the order is cancelled for fraud within 120 min of
  // the answer (R2.2); the cancel changes nothing, and cancel-refused is allowed for it (S12, S15), not required.
  G('review-answer-and-cancel-in-one-instant (S12)', 'S12, S4, S11, R6.2, R2.2, S9, S15', tr => {
    const r1 = task7('r1', p7 + 5 * MIN, 900), x = p7 + 60 * MIN;
    const ans = d => answer7('r1', x, 950, { decision: d });
    const cancel = { ...act(B7, x, O7, 'cancel'), seq: 960 };          // delivered after the answer (seq 950), S4
    const Ea = tr(W, view7(x + MIN, [cancel], [r1], [ans('approve')]));
    const wa = win(Ea, `ost:${O7}:cancelled`);
    if (!wa || wa.earliest !== x || wa.latest !== x + 60 * MIN || !has(Ea, `ntf:${O7}:order-cancelled`)) return `approve then cancel: order-cancel window ${JSON.stringify(wa)}, expected [x, x + 60 min] (R6.2)`;
    if (has(Ea, `ost:${O7}:processing`) || !Ea.effects.permitted.some(p => p.op === 'setStatus' && p.match?.status === 'processing')) return 'approve then cancel: processing not set is not merely permitted (S9; the order was ready at the approve)';
    const Er = tr(W, view7(x + MIN, [cancel], [r1], [ans('reject')]));
    const wr = win(Er, `ost:${O7}:cancelled`);
    if (!wr || wr.earliest !== x || wr.latest !== x + 120 * MIN) return `reject then cancel: order-cancel window ${JSON.stringify(wr)}, expected [x, x + 120 min] (R2.2)`;
    if (has(Er, `ntf:${O7}:cancel-refused`) || !sends(Er.effects.permitted, 'cancel-refused', O7)) return 'reject then cancel: cancel-refused is not merely allowed (S12, S15)';
    return true;
  });
}

// R3.2, S1, R6.3, S5, §4.8: an order that times out. Every timeout effect is due in (D, D + 60 min]; afterwards a cancel may
// be answered with cancel-refused (the order is already timedOut, R6.3), a late amend may not (it changes nothing).
{
  const [Ct, Tt] = casesOf(W, t => t.class === 'timeout' && allocOf(W, t.subject).some(f => f.available))[0] ?? pick(t => t.class === 'timeout', 'timeout');
  const Bt = builder(Ct), Ot = Tt.subject, pt = Date.parse(Tt.placedAt);
  const Dt = pt + policyOf(W, Tt.placedAt).customerActionHours * 60 * MIN;
  const to = W.master.customers.find(x => x.customerId === Tt.customerId).email;
  const created = Bt.row(pt + MIN, 'orders', 'create', { orderId: Ot });
  G('timed-out-order: window (D, D+60] and late actions', 'R3.2, S1, R6.3, S5, §4.8', tr => {
    const E0 = tr(W, Bt.view(Dt + MIN, Tt, [created], []));
    for (const l of [...allocOf(W, Ot).map(f => `fst:${f.fulfilmentId}:cancelled`), `ost:${Ot}:timedOut`, `ntf:${Ot}:order-timed-out`]) {
      const why = afterDeadline(win(E0, l), Dt, Dt + 60 * MIN);
      if (why) return `${l} ${why}`;
    }
    const at = Dt + 5 * MIN;
    const ended = [created, ...allocOf(W, Ot).map(f => Bt.row(at, 'orders', 'setStatus', { orderId: Ot, fulfilmentId: f.fulfilmentId, status: 'cancelled' })),
      Bt.row(at, 'orders', 'setStatus', { orderId: Ot, fulfilmentId: null, status: 'timedOut' }), Bt.row(at, 'notify', 'send', { to, about: Ot, template: 'order-timed-out' })];
    const c = Dt + 90 * MIN;
    const E1 = tr(W, Bt.view(c + MIN, Tt, ended, [act(Bt, c, Ot, 'cancel')]));
    if (!sends(E1.effects.permitted, 'cancel-refused', Ot)) return 'cancel-refused not permitted for a cancel of a timed-out order';
    if (has(E1, `ntf:${Ot}:cancel-refused`) || has(E1, `ost:${Ot}:cancelled`)) return 'a cancel of a timed-out order changed something';
    const a = Dt + MIN;
    const E2 = tr(W, Bt.view(a + MIN, Tt, [created], [act(Bt, a, Ot, 'amend')]));
    if (sends([...E2.effects.required, ...E2.effects.permitted], 'cancel-refused', Ot)) return 'cancel-refused allowed in answer to a late amend';
    return has(E2, `ost:${Ot}:timedOut`) ? true : 'late amend counted';
  });
}

// S8, R6.2, R6.3: after a counted amend the order is processing; a cancel exactly at D (not after D, so S5 does not apply)
// is judged by R6.2 and counts before any collection: the order is cancelled, and cancel-refused (only for a cancel that
// does not count, or for an order already ended, R6.3) is not allowed.
{
  const [Ca, Ta] = pick(t => t.class === 'amend' && allocOf(W, t.subject).some(f => f.available) && allocOf(W, t.subject).some(f => !f.available), 'amend order with available and unavailable fulfilments');
  const Ba = builder(Ca), pa = Date.parse(Ta.placedAt), Oa = Ta.subject;
  const Da = pa + policyOf(W, Ta.placedAt).customerActionHours * 60 * MIN;
  G('amend-then-cancel-at-deadline-counts (S8)', 'S8, R6.2, R6.3, S5', tr => {
    const E = tr(W, Ba.view(Da + MIN, Ta, [Ba.row(pa + MIN, 'orders', 'create', { orderId: Oa })], [act(Ba, pa + 80 * MIN, Oa, 'amend'), act(Ba, Da, Oa, 'cancel')]));
    if (!has(E, `ost:${Oa}:cancelled`) || !has(E, `ntf:${Oa}:order-cancelled`)) return 'cancel at D after an amend did not stop the order';
    return sends([...E.effects.required, ...E.effects.permitted], 'cancel-refused') ? 'cancel-refused allowed for a cancel that counts' : true;
  });
  // S11, S8, R3.2, R6.2, S9: an amend and a cancel with the same time, the amend delivered first (same source, by id): the
  // amend counts (R3.2) and makes the order ready in that instant, and the order is processing from the instant it is ready
  // (S11), so the cancel is a cancel during processing (S8) and counts: the order is cancelled within 60 min of it, and
  // `processing` (not yet set) is only permitted (S9).
  G('amend-and-cancel-in-one-instant (S11)', 'S11, S8, R3.2, R6.2, R6.3, S9', tr => {
    for (const a of [pa + 80 * MIN, Da]) {             // also exactly at D: both actions count in time (R3.2, S1)
      const E = tr(W, Ba.view(a + MIN, Ta, [Ba.row(pa + MIN, 'orders', 'create', { orderId: Oa })], [act(Ba, a, Oa, 'amend'), act(Ba, a, Oa, 'cancel')]));
      const w = win(E, `ost:${Oa}:cancelled`);
      if (!w || w.earliest !== a || w.latest !== a + 60 * MIN || !has(E, `ntf:${Oa}:order-cancelled`)) return `a cancel delivered after the amend of its instant did not count: order-cancel window ${JSON.stringify(w)}`;
      if (has(E, `ost:${Oa}:processing`)) return 'processing still required after a cancel in the ready instant';
      if (!E.effects.permitted.some(p => p.op === 'setStatus' && p.match?.status === 'processing')) return 'processing not permitted (S9)';
      if (sends([...E.effects.required, ...E.effects.permitted], 'cancel-refused')) return `cancel-refused allowed for a cancel that counts (at p + ${(a - pa) / MIN} min)`;
    }
    return true;
  });
}

// S11, S4, §3.2, R4.1: a passed order is ready at p, but a `cancel` timed at p reaches the arm before the placement
// (customer actions are delivered before placed orders in one instant, S4), so it names no order yet and changes nothing:
// the order is processed as usual. (A cancel in the instant of the approve or amend that made an order ready, delivered
// after it, does count: `amend-and-cancel-in-one-instant (S11)`, `review-answer-and-cancel-in-one-instant (S12)`.)
// S5: an amend for an order with no unavailable fulfilment changes nothing: the saga goes on.
G('processing-cancels: a cancel before its placement names no order, an amend never stops', 'S11, S4, §3.2, R4.1, S5', tr => {
  const early = act(B, P, O, 'cancel'), placedAfter = B.ev(P, 'order.placed', { orderId: O });   // delivery order (S4)
  const E1 = tr(W, B.view(P + 2 * MIN, T, [B.row(P + MIN, 'orders', 'create', { orderId: O })], [early, placedAfter]));
  if (has(E1, `ost:${O}:cancelled`) || has(E1, `ntf:${O}:order-cancelled`) || sends([...E1.effects.required, ...E1.effects.permitted], 'cancel-refused')) return 'a cancel that reached the arm before its order was placed changed the order';
  const w1 = span(E1, `ost:${O}:processing`, P, P + 60 * MIN);
  if (w1 !== true) return `after a cancel before the placement: ${w1}`;
  const { rows, t } = history(1);
  const a = t + 5 * MIN;
  const E2 = tr(W, B.view(a + MIN, T, rows, [placed, act(B, a, O, 'amend')]));
  if (has(E2, `ost:${O}:cancelled`) || has(E2, `ntf:${O}:order-cancelled`) || comp(E2).length) return 'an amend stopped the order';
  return has(E2, `chg:${F}`) ? true : 'the saga did not continue after the amend';
});

// R4.1: a passed order with nothing unavailable is ready at p, and R4.1 sets each available fulfilment `processing`
// "within 60 min of t", also after the saga's steps were taken. (That the taken steps stay named: test/unit-checks.mjs.)
G('processing-window-after-the-steps', 'R4.1, R4.2', tr => {
  const { rows, t } = history(3);
  const E = tr(W, B.view(t, T, rows, [placed]));
  return span(E, `fst:${F}:processing`, P, P + 60 * MIN);
});

// R6.2: "Within 60 min of the cancel ... set the order cancelled; send order-cancelled." A charge emitted before the cancel
// that commits after it is "one already in flight": it "is compensated within 60 min of its commit". (That it stays
// named, not new after the cancel, is invisible to the grader, which exempts an in-flight row: test/unit-checks.mjs.)
G('cancel-windows-and-in-flight-charge (R6.2)', 'R6.2, R4.2', tr => {
  const { rows } = history(1);
  const a = P + 10 * MIN, chargedAt = a + 2 * MIN;
  rows.push(B.row(chargedAt, 'billing', 'charge', CHG, true, { callAt: a - MIN }));      // emitted at a - 1 min, committed at a + 2 min
  const E = tr(W, B.view(chargedAt + MIN, T, rows, [placed, act(B, a, O, 'cancel')]));
  for (const l of [`ost:${O}:cancelled`, `ntf:${O}:order-cancelled`]) { const w = win(E, l); if (!w || w.latest !== a + 60 * MIN) return `${l} window ${JSON.stringify(w)} (cancel at ${a})`; }
  const rf = win(E, `rf:${F}`);
  return rf && rf.latest === chargedAt + 60 * MIN ? true : `refund window ${JSON.stringify(rf)} (charge committed at ${chargedAt})`;
});

// R6.2: "Book, charge or reserve nothing new for the order after the cancel"; what still commits is compensated (R5.1).
// (That the new steps are not named is invisible to the grader, which stops at the first of them: test/unit-checks.mjs.)
G('no-new-forward-step-after-a-cancel', 'R6.2, R5.1', tr => {
  const a = P + 10 * MIN;
  const rows = [B.row(P + MIN, 'orders', 'create', { orderId: O }), ...FUL.items.map(i => B.row(a + 5 * MIN, 'inventory', 'reserve', rsvArgs(i))),
    B.row(a + 6 * MIN, 'billing', 'charge', CHG), B.row(a + 7 * MIN, 'carrier', 'create', { orderId: O, fulfilmentId: F, location: FUL.location, ref: null })];
  const E = tr(W, B.view(a + 8 * MIN, T, rows, [placed, act(B, a, O, 'cancel')]));
  const uncomp = [`csh:${F}`, `rf:${F}`, ...FUL.items.map(i => `rel:${F}:${i.sku}`)].filter(l => !has(E, l));
  if (uncomp.length) return `committed steps not compensated: ${uncomp}`;
  return has(E, `ost:${O}:cancelled`) ? true : 'order not cancelled';
});

// R4.2: a partial reservation batch. Each step comes "only after the previous step of the same fulfilment has committed",
// the failed items are resubmitted, and the charge is due "within 120 min of the commit of its last reservation".
G('charge-waits-for-the-last-reservation', 'R4.2', tr => {
  if (FUL.items.length < 2) return 'fixture: the golden needs a multi-item fulfilment';
  const [i0, ...rest] = FUL.items;
  const rows = [B.row(P + MIN, 'orders', 'create', { orderId: O }), B.row(P + 2 * MIN, 'inventory', 'reserve', rsvArgs(i0)),
    ...rest.map(i => B.row(P + 2 * MIN, 'inventory', 'reserve', rsvArgs(i), false, { error: { code: 503, reason: 'unavailable' } }))];
  const E = tr(W, B.view(P + 3 * MIN, T, rows, [placed]));
  if (has(E, `chg:${F}`)) return 'charge required before every item is reserved';
  if (rest.some(i => !has(E, `rsv:${F}:${i.sku}`))) return 'failed items of a partial batch not required again';
  const done = P + 40 * MIN;
  const E2 = tr(W, B.view(done + MIN, T, [...rows, ...rest.map(i => B.row(done, 'inventory', 'reserve', rsvArgs(i)))], [placed]));
  return span(E2, `chg:${F}`, done, done + 120 * MIN);
});

// §3.3 "Carriers repeat messages"; R4.4 and R5.2 windows run from the message; R7.2 each status is set once and "A late or
// repeated message never moves a status back"; §3.3: messages about a fulfilment "already completed or failed, change nothing".
G('repeated-carrier-messages-change-nothing', '§3.3, R4.4, R4.5, R5.2, R7.2', tr => {
  const { rows } = history(3);                 // booked at P + 4 min
  const R = runOf(P + 4 * MIN), Dl = R + 600 * MIN;
  const E = tr(W, B.view(Dl + 101 * MIN, T, rows, [placed, report(R, 'collected'), report(R + 30 * MIN, 'collected', R), report(Dl, 'delivered'), report(Dl + 100 * MIN, 'delivered', Dl)]));
  for (const r of [span(E, `fst:${F}:dispatched`, R, R + 120 * MIN), span(E, `fst:${F}:completed`, Dl, Dl + 120 * MIN), span(E, `ost:${O}:completed`, Dl, Dl + 120 * MIN)]) if (r !== true) return r;
  const E2 = tr(W, B.view(R + 31 * MIN, T, rows, [placed, report(R, 'collectionFailed'), report(R + 30 * MIN, 'collectionFailed', R)]));
  for (const r of [span(E2, `fst:${F}:failed`, R, R + 120 * MIN), span(E2, `ntf:${F}:fulfilment-failed`, R, R + 120 * MIN)]) if (r !== true) return r;
  return true;
});

// R6.3: a cancel refused because a shipment was collected gets cancel-refused "within 60 min of the cancel"; a cancel for an
// order that is already failed or completed (its R4.5 window long past; no longer processing, R6.2) "changes nothing (you
// may send cancel-refused)".
G('cancel-refused-and-cancel-after-the-end', 'R6.3, R6.2, R4.5', tr => {
  const h = history(3);
  const R = runOf(P + 4 * MIN), a = R + 30 * MIN;
  const w = win(tr(W, B.view(a + MIN, T, h.rows, [placed, report(R, 'collected'), act(B, a, O, 'cancel')])), `ntf:${O}:cancel-refused`);
  if (!w || w.earliest !== a || w.latest !== a + 60 * MIN) return `cancel-refused window ${JSON.stringify(w)}, expected [cancel, cancel + 60 min]`;
  const { rows, t } = history(1);
  const a2 = t + 180 * MIN;
  const E2 = tr(W, B.view(a2 + MIN, T, [...rows, declined(t)], [placed, act(B, a2, O, 'cancel')]));
  if (!has(E2, `ost:${O}:failed`) || has(E2, `ost:${O}:cancelled`) || has(E2, `ntf:${O}:order-cancelled`)) return 'a cancel after the order failed changed its outcome';
  if (has(E2, `ntf:${O}:cancel-refused`)) return 'cancel-refused required for a cancel after the order failed (it is optional)';
  const Dl = R + 600 * MIN, a3 = Dl + 180 * MIN;
  const E3 = tr(W, B.view(a3 + MIN, T, h.rows, [placed, report(R, 'collected'), report(Dl, 'delivered'), act(B, a3, O, 'cancel')]));
  if (has(E3, `ntf:${O}:cancel-refused`)) return 'cancel-refused required for a cancel after the order completed (it is optional)';
  if (!sends(E3.effects.permitted, 'cancel-refused', O)) return 'cancel-refused not permitted after the order completed';
  return has(E3, `ost:${O}:completed`) && !has(E3, `ost:${O}:cancelled`) ? true : 'a cancel after the order completed changed its outcome';
});

// R6.2, R4.3: a counted cancel 10 min before the collection run: "cancel a shipment at once", before the point of no
// return, so the shipment cancel is due from the cancel until the collection. A cancel emitted at the collection run or
// later is refused (the carrier collects first, R4.3), so a window ending at R - 1 min or at R is the same rule; the
// golden accepts either encoding. What the expectation says after a later collectionFailed report (oracle defect D1, R7.1)
// is a unit check: test/unit-checks.mjs.
G('cancel-shortly-before-collection (R6.2, R4.3)', 'R6.2, R4.3', tr => {
  const { rows } = history(3);                 // booked at P + 4 min
  const R = runOf(P + 4 * MIN), a = R - 10 * MIN;
  const w = win(tr(W, B.view(a + MIN, T, rows, [placed, act(B, a, O, 'cancel')])), `csh:${F}`);
  return w && w.earliest === a && w.latest >= R - MIN && w.latest <= R ? true : `shipment cancel window ${JSON.stringify(w)}, expected [cancel, collection] (R6.2, R4.3)`;
});

// S13, S4, S7, R6.3, R4.5: a delivery report that ends the order's last open fulfilment and a cancel with the same time.
// The report is delivered first (S4), so the order has already ended when the cancel reaches the arm (S13): the cancel
// changes nothing and `cancel-refused` is allowed, not required (R6.3); the order completes (R4.5).
G('delivery-and-cancel-in-one-instant (S13)', 'S13, S4, S7, R6.3, R4.5', tr => {
  const h = history(3);
  const R = runOf(P + 4 * MIN), Dl = R + 600 * MIN;
  const E = tr(W, B.view(Dl + MIN, T, h.rows, [placed, report(R, 'collected'), report(Dl, 'delivered'), act(B, Dl, O, 'cancel')]));
  if (has(E, `ntf:${O}:cancel-refused`)) return 'cancel-refused required for a cancel in the instant of the delivery that ended the order (S13: it had already ended)';
  if (!sends(E.effects.permitted, 'cancel-refused', O)) return 'cancel-refused not permitted';
  return has(E, `ost:${O}:completed`) && !has(E, `ost:${O}:cancelled`) ? true : 'the order did not complete';
});

// S13, S4, S10, R5.2, R6.2, R6.3, R4.5, R7.1: a fulfilment failure and a cancel with the same time.
// (a) A charge attempt declined in the cancel's instant (emitted by a call that was not given the cancel, S10): its result
//     reaches the arm a minute later, so the cancel came first: the fulfilment is compensated and cancelled (R6.2), not
//     failed, and the order is cancelled.
// (b) A collectionFailed report delivered before the cancel in its instant (S4): the failure came first (R5.2). With one
//     fulfilment the order has ended (failed, R4.5): the cancel changes nothing, `cancel-refused` allowed; no shipment
//     cancel (R5.1), and the shipment's record is `failed` (R7.1).
// (c) The same with two fulfilments: the failed one fails (R5.2); the cancel counts for the other (R6.2): compensated and
//     cancelled, and the order is cancelled.
G('failure-and-cancel-in-one-instant (S13)', 'S13, S4, S10, R5.2, R6.2, R6.3, R4.5, R7.1', tr => {
  const { rows, t } = history(1);              // reserved at P + 2 min; t = P + 5 min
  const Ea = tr(W, B.view(t + 2 * MIN, T, [...rows, declined(t)], [placed, act(B, t, O, 'cancel')]));
  if (!has(Ea, `fst:${F}:cancelled`) || has(Ea, `fst:${F}:failed`) || has(Ea, `ntf:${F}:fulfilment-failed`)) return '(a) a decline in the cancel\'s instant failed the fulfilment (S13: its result reaches the arm after the cancel)';
  if (FUL.items.some(i => !has(Ea, `rel:${F}:${i.sku}`)) || has(Ea, `rf:${F}`) || !has(Ea, `ost:${O}:cancelled`)) return '(a) compensation or order cancel wrong after a decline in the cancel\'s instant';
  const h3 = history(3);                       // booked at P + 4 min
  const R = runOf(P + 4 * MIN);
  const Eb = tr(W, B.view(R + MIN, T, h3.rows, [placed, report(R, 'collectionFailed'), act(B, R, O, 'cancel')]));
  for (const l of [`fst:${F}:failed`, `ntf:${F}:fulfilment-failed`, `rf:${F}`, `ost:${O}:failed`]) if (!has(Eb, l)) return `(b) collectionFailed delivered before the cancel: ${l} not required (S13: the failure came first)`;
  if (has(Eb, `csh:${F}`) || has(Eb, `ost:${O}:cancelled`) || has(Eb, `ntf:${O}:order-cancelled`) || has(Eb, `ntf:${O}:cancel-refused`)) return '(b) the cancel changed an order whose only fulfilment had already failed';
  if (!sends(Eb.effects.permitted, 'cancel-refused', O)) return '(b) cancel-refused not permitted after the order ended';
  if (Eb.records?.shipments?.[F] !== 'failed') return `(b) shipment record ${Eb.records?.shipments?.[F]} (R7.1: the carrier left it failed)`;
  return twoFulfilments(tr);
});

/** S13 (c): two available fulfilments, both booked; F1, whose location collects first, fails by a collectionFailed report
 * delivered just before a cancel of its instant; F2 is booked and not yet collected then (its run is later). */
const [C2f, T2f] = pick(t => t.class === 'straight' && allocOf(W, t.subject).length === 2 && allocOf(W, t.subject).every(f => f.available), 'straight order with two available fulfilments');
function twoFulfilments(tr) {
  const B2 = builder(C2f), O2 = T2f.subject, p2 = Date.parse(T2f.placedAt);
  const at = f => W.master.locations.find(l => l.location === f.location);
  const [F1, F2] = allocOf(W, O2).slice().sort((x, y) => runOf(p2 + 4 * MIN, at(x)) - runOf(p2 + 4 * MIN, at(y)));
  const amt = f => f.items.reduce((s, i) => s + i.qty * price(W, i.sku), 0) + fee0(W, f.location);
  const rows = [B2.row(p2 + MIN, 'orders', 'create', { orderId: O2 }),
    ...[F1, F2].flatMap(f => f.items.map(i => B2.row(p2 + 2 * MIN, 'inventory', 'reserve', { orderId: O2, fulfilmentId: f.fulfilmentId, location: f.location, sku: i.sku, qty: i.qty }))),
    ...[F1, F2].map(f => B2.row(p2 + 3 * MIN, 'billing', 'charge', { orderId: O2, fulfilmentId: f.fulfilmentId, customerId: T2f.customerId, amountMinor: amt(f), currency: 'EUR' })),
    ...[F1, F2].map(f => B2.row(p2 + 4 * MIN, 'carrier', 'create', { orderId: O2, fulfilmentId: f.fulfilmentId, location: f.location, ref: null }))];
  const R = runOf(p2 + 4 * MIN, at(F1)), R2 = runOf(p2 + 4 * MIN, at(F2));
  if (!(R2 > R)) return 'fixture: the two locations collect at the same run';
  const nc = B2.ev(R, 'carrier.status', { carrier: at(F1).carrier, code: CODES[at(F1).carrier].collectionFailed, fulfilmentRef: F1.fulfilmentId, reportedAt: new Date(R).toISOString() });
  const E = tr(W, B2.view(R + MIN, T2f, rows, [B2.ev(p2, 'order.placed', { orderId: O2 }), nc, act(B2, R, O2, 'cancel')]));
  const f1 = F1.fulfilmentId, f2 = F2.fulfilmentId;
  for (const l of [`fst:${f1}:failed`, `ntf:${f1}:fulfilment-failed`, `rf:${f1}`, `fst:${f2}:cancelled`, `csh:${f2}`, `rf:${f2}`, `ost:${O2}:cancelled`, `ntf:${O2}:order-cancelled`]) if (!has(E, l)) return `(c) ${l} not required (S13: F1 failed before the cancel, which counts for F2)`;
  if (has(E, `fst:${f1}:cancelled`) || has(E, `csh:${f1}`) || has(E, `fst:${f2}:failed`)) return '(c) F1 cancelled although its failure came before the cancel';
  return true;
}

// S15, S12, R6.3, R2.1, R2.2, R3.2, R6.2, R6.4: once a rule has decided that the order is cancelled, every later customer
// cancel "changes nothing (you may send cancel-refused)": cancel-refused is allowed for it, not required. An amend after it
// gets no cancel-refused, and neither does the cancel that counts.
G('a-cancel-after-the-cancellation-is-decided (S15)', 'S15, S12, R6.3, R2.1, R2.2, R3.2, R6.2, R6.4', tr => {
  const allowed = (E, o) => !has(E, `ntf:${o}:cancel-refused`) && sends(E.effects.permitted, 'cancel-refused', o);
  const none = (E, o) => !sends([...E.effects.required, ...E.effects.permitted], 'cancel-refused', o);
  // (a) R2.1: the fraud verdict `reject` decides at p; a cancel 10 min later.
  const Ea = tr(W, B.view(P + 11 * MIN, { ...T, verdict: 'reject' }, [B.row(P + MIN, 'orders', 'create', { orderId: O })], [placed, act(B, P + 10 * MIN, O, 'cancel')]));
  if (!has(Ea, `ost:${O}:cancelled`) || !allowed(Ea, O)) return '(a) a cancel after the fraud verdict reject (R2.1): cancel-refused not merely allowed';
  // (b) R2.2: a `reject` answer at x and a cancel 30 min later; an amend instead gets nothing.
  const r1 = task7('r1', p7 + 5 * MIN, 900), x = p7 + 60 * MIN, rej = answer7('r1', x, 950, { decision: 'reject' });
  if (!allowed(tr(W, view7(x + 31 * MIN, [act(B7, x + 30 * MIN, O7, 'cancel')], [r1], [rej])), O7)) return '(b) a cancel after a reject answer (R2.2): cancel-refused not merely allowed';
  if (!none(tr(W, view7(x + 31 * MIN, [act(B7, x + 30 * MIN, O7, 'amend')], [r1], [rej])), O7)) return '(b) cancel-refused allowed for an amend after a reject answer';
  // (c) R2.2: the review deadline passes without a usable answer; a cancel 30 min after it.
  const dl = r1.at + RVH * 60 * MIN;
  if (!allowed(tr(W, view7(dl + 31 * MIN, [act(B7, dl + 30 * MIN, O7, 'cancel')], [r1], [])), O7)) return '(c) a cancel after the review deadline (R2.2): cancel-refused not merely allowed';
  // (d) R6.4: a cancel while the review is open counts; a repeat 30 min later changes nothing.
  const Ed = tr(W, view7(p7 + 41 * MIN, [act(B7, p7 + 10 * MIN, O7, 'cancel'), act(B7, p7 + 40 * MIN, O7, 'cancel')], [r1], []));
  if (!allowed(Ed, O7)) return '(d) a repeat cancel after an R6.4 cancel: cancel-refused not merely allowed';
  if (!none(tr(W, view7(p7 + 11 * MIN, [act(B7, p7 + 10 * MIN, O7, 'cancel')], [r1], [])), O7)) return '(d) cancel-refused allowed for the R6.4 cancel that counts';
  // (e) R3.2: a cancel while the order waits for the customer counts; a repeat before D changes nothing.
  if (!allowed(tr(W, B2.view(p2 + 101 * MIN, T2c, created2, [act(B2, p2 + 80 * MIN, O2, 'cancel'), act(B2, p2 + 100 * MIN, O2, 'cancel')])), O2)) return '(e) a repeat cancel after a counted R3.2 cancel: cancel-refused not merely allowed';
  // (f) R6.2: a cancel during processing counts; a repeat 5 min later changes nothing.
  const { rows, t } = history(1);
  const a = t + 5 * MIN;
  const Ef = tr(W, B.view(a + 6 * MIN, T, rows, [placed, act(B, a, O, 'cancel'), act(B, a + 5 * MIN, O, 'cancel')]));
  if (!has(Ef, `ost:${O}:cancelled`) || !allowed(Ef, O)) return '(f) a repeat cancel after a counted R6.2 cancel: cancel-refused not merely allowed';
  return none(tr(W, B.view(a + MIN, T, rows, [placed, act(B, a, O, 'cancel')])), O) ? true : '(f) cancel-refused allowed for the R6.2 cancel that counts';
});

/** Fixtures shared with the transition unit checks (test/unit-checks.mjs); tools/mutate.mjs runs only `goldens`. */
export const fixtures = Object.freeze({ MIN, W, W4, CASE, T, O, F, FUL, P, loc, CODES, code, price, fee0, AMOUNT, builder, B, placed, history, lids, comp,
  same, has, win, span, sends, asked, report, act, CHG, declined, rsvArgs, runOf, POL, policyOf, pick, casesOf, allocOf,
  review: { C7, T7, B7, O7, p7, RVH, view7, task7, answer7 }, twoFul: { C2f, T2f } });

/**
 * Run every golden against a transition and, for the records goldens, the same module's recordsOf (a mutant's own, in the
 * mutation tool); returns [{ name, source, pass, detail }]. A throw is a failure.
 */
export function runGoldens(transition, recordsOf = null) {
  return goldens.map(g => {
    let r;
    try { r = g.check(transition, recordsOf); } catch (e) { r = `threw: ${String(e?.message ?? e).slice(0, 200)}`; }
    return { name: g.name, source: g.source, pass: r === true, detail: r === true ? null : r };
  });
}
