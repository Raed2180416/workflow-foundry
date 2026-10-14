// E8 goldens (E-BED §9.1, contract §11): hand-derived histories fed straight to a reference transition, each with the
// expectation the rules give, cited. Exported as data + a runner so the item suite and the oracle mutation tool
// (tools/mutate.mjs) run the same checks against the real transition and against every mutant. The saga failure points
// are cross-checked against the independent planner beds/ebed/lib/saga.mjs (MR11). $0.
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
const CODES = { PARCELLA: { collected: 'COLLECTED', inTransit: 'IN_TRANSIT', delivered: 'DELIVERED', collectionFailed: 'NOT_COLLECTED' }, VELOX: { collected: 'PU', inTransit: 'IT', delivered: 'DL', collectionFailed: 'NC' }, SWIFTLINE: { collected: 'picked', inTransit: 'moving', delivered: 'handed-over', collectionFailed: 'not-collected' } };
const code = m => CODES[loc.carrier][m];
const price = (w, sku) => w.master.catalog.find(c => c.sku === sku).unitPriceMinor;
const fee0 = (w, location, ed = 0) => JSON.parse(w.rulebook.editions[ed].files['shipping-fees.json']).find(x => x.location === location).feeMinor;
const AMOUNT = FUL.items.reduce((s, i) => s + i.qty * price(W, i.sku), 0) + fee0(W, FUL.location);

function builder(c, w = W) {
  let seq = 0;
  return {
    row: (at, system, op, args, committed = true, extra = {}) => ({ seq: ++seq, at, system, op, key: `${op}:${seq}`, args, committed, status: committed ? 'ok' : 'error', error: null, case: c, callAt: at, knows: new Set(), money: system === 'billing', ...extra }),
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
  const { rows, t } = history(3);
  const R = t + 60 * MIN;
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
  const { rows, t } = history(3);
  const R = t + 60 * MIN;
  const a = R + dt * MIN;
  const E = tr(W, B.view(a + MIN, T, rows, [placed, B.ev(R, 'carrier.status', { carrier: loc.carrier, code: code('collected'), fulfilmentRef: F, reportedAt: new Date(R).toISOString() }), B.ev(a, 'customer.action', { orderRef: O, action: 'cancel' })]));
  if (!has(E, `ntf:${O}:cancel-refused`)) return 'no cancel-refused';
  return comp(E).length || has(E, `ost:${O}:cancelled`) ? 'order stopped after collection' : true;
});
G('delivery-before-collection-report', 'R4.4, W2', tr => {
  const { rows, t } = history(3);
  const T2 = t + 30 * 60 * MIN;
  const E = tr(W, B.view(T2 + 100 * MIN, T, rows, [placed, B.ev(T2, 'carrier.status', { carrier: loc.carrier, code: code('delivered'), fulfilmentRef: F, reportedAt: new Date(T2).toISOString() }),
    B.ev(T2 + 90 * MIN, 'carrier.status', { carrier: loc.carrier, code: code('collected'), fulfilmentRef: F, reportedAt: new Date(t + 60 * MIN).toISOString() })]));
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
  const w = win(tr(W, B2.view(D2 + MIN, T2c, created2, [])), `ost:${O2}:timedOut`);
  return w && w.earliest === D2 + 1000 && w.latest === D2 + 60 * MIN ? true : `timeout window ${JSON.stringify(w)}`;
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

// R4.3 collection cut-off: booked exactly cutoff minutes before a run is collected at that run.
G('collection-cutoff-boundary', 'R4.3', tr => {
  const { rows, t } = history(2);
  const [h, m] = loc.collectionTime.split(':').map(Number);
  const day = Math.floor((t - Date.parse(W.t0)) / (1440 * MIN)) + 1;
  const run = Date.parse(W.t0) + (day * 1440 + h * 60 + m) * MIN;
  rows.push(B.row(run - 30 * MIN, 'carrier', 'create', { orderId: O, fulfilmentId: F, location: FUL.location, ref: null }));
  const a = run - 20 * MIN;
  const E = tr(W, B.view(a + MIN, T, rows, [placed, B.ev(a, 'customer.action', { orderRef: O, action: 'cancel' })]));
  const w = win(E, `csh:${F}`);
  return w && w.latest === run - MIN ? true : `shipment cancel window ${JSON.stringify(w)} (collection at ${new Date(run).toISOString()})`;
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
    const w = win(tr(W, B6.view(dl + MIN, T6, base, [], { tasks: [task], taskEvents: [] })), `ost:${T6.subject}:cancelled`);
    return w && w.earliest === dl + 1000 ? true : `review-timeout window ${JSON.stringify(w)}`;
  });
  G('free-text-answer-is-unusable', 'R2.2', tr => {
    const E = tr(W, B6.view(dl + MIN, T6, base, [], { tasks: [task], taskEvents: [{ seq: 9, at: p6 + 60 * MIN, type: 'humanTask.answered', instance: 'i-1', payload: { taskId: 'r1', answer: { text: 'approve - fine' } } }] }));
    return has(E, `ost:${T6.subject}:cancelled`) ? true : 'free text counted as an answer';
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Survivor goldens (oracle mutation run 2026-10-14; ledger/MUTANTS.md). Each pins behaviour the corpus never reaches, with
// the SPEC-E sentence it rests on. None rests on a same-instant tie the spec leaves open (MUTANTS.md, spec-ambiguous).
const pick = (pred, what, w = W) => { const x = casesOf(w, pred)[0]; if (!x) throw new Error(`golden fixture: no ${what} case`); return x; };
/** R1.3: the policy of the edition in force on the (Europe/Amsterdam) date of p. */
const policyOf = (w, placedAt) => JSON.parse(w.rulebook.editions.filter(e => e.effectiveFrom <= placedAt.slice(0, 10))
  .sort((x, y) => (x.effectiveFrom < y.effectiveFrom ? -1 : 1)).at(-1).files['policy.json']);
const POL = policyOf(W, T.placedAt);
/** R4.3: the collection run that collects a shipment of the golden order's location booked at `booked`. */
const runOf = booked => {
  const [h, m] = loc.collectionTime.split(':').map(Number);
  for (let d = -1; d < 40; d++) { const r = Date.parse(W.t0) + (d * 1440 + h * 60 + m) * MIN; if (r >= booked + POL.collectionCutoffMinutes * MIN) return r; }
  return null;
};
const span = (E, l, e, x) => { const w = win(E, l); return w && w.earliest === e && w.latest === x ? true : `${l} window ${JSON.stringify(w)}, expected [${e}, ${x}]`; };
const report = (at, meaning, reportedAt = at) => B.ev(at, 'carrier.status', { carrier: loc.carrier, code: code(meaning), fulfilmentRef: F, reportedAt: new Date(reportedAt).toISOString() });
const act = (b, at, orderRef, action) => b.ev(at, 'customer.action', { orderRef, action });
const CHG = { orderId: O, fulfilmentId: F, customerId: T.customerId, amountMinor: AMOUNT, currency: 'EUR' };
const declined = at => B.row(at, 'billing', 'charge', CHG, false, { error: { code: 402, reason: 'card-declined' } });
const rsvArgs = i => ({ orderId: O, fulfilmentId: F, location: FUL.location, sku: i.sku, qty: i.qty });
const sends = (list, template, about = null) => list.some(e => e.system === 'notify' && e.op === 'send' && e.match?.template === template && (about === null || e.match?.about === about));
const asked = (E, system, op) => [...E.effects.required, ...E.effects.permitted].some(e => e.system === system && e.op === op);

// S9, R4.1, R4.2, R6.2, §1: "before" a counted processing cancel. Statuses and reservations taken before the cancel stay
// required (S9 relieves only a step the cancel made moot "before you took it"). A reservation taken by the call that was
// given the cancel (one case-tick, §1: it reacted to the cancel) or at a later instant is something "new for the order
// after the cancel" (R6.2): not required, only released.
G('steps-before-vs-after-a-processing-cancel', 'S9, R4.1, R4.2, R6.2, §1', tr => {
  const a = P + 10 * MIN;
  const cancel = act(B, a, O, 'cancel');
  const create = B.row(P + MIN, 'orders', 'create', { orderId: O });
  const rsv = (at, extra = {}) => FUL.items.map(i => B.row(at, 'inventory', 'reserve', rsvArgs(i), true, extra));
  const sts = [B.row(P + 2 * MIN, 'orders', 'setStatus', { orderId: O, fulfilmentId: null, status: 'processing' }), B.row(P + 2 * MIN, 'orders', 'setStatus', { orderId: O, fulfilmentId: F, status: 'processing' })];
  const E1 = tr(W, B.view(a + MIN, T, [create, ...sts, ...rsv(P + 3 * MIN)], [placed, cancel]));
  if (!has(E1, `ost:${O}:processing`) || !has(E1, `fst:${F}:processing`)) return 'processing set before the cancel is no longer required';
  if (FUL.items.some(i => !has(E1, `rsv:${F}:${i.sku}`))) return 'reservation taken before the cancel is no longer required';
  const E2 = tr(W, B.view(a + 2 * MIN, T, [create, ...rsv(a + MIN, { callAt: a, knows: new Set([CASE]) })], [placed, cancel]));
  if (FUL.items.some(i => has(E2, `rsv:${F}:${i.sku}`))) return 'reservation made by the call that was given the cancel is still required';
  const E3 = tr(W, B.view(a + 3 * MIN, T, [create, ...rsv(a + 2 * MIN, { callAt: a + MIN })], [placed, cancel]));
  if (FUL.items.some(i => has(E3, `rsv:${F}:${i.sku}`))) return 'reservation made a tick after the cancel is still required';
  if (FUL.items.some(i => !has(E2, `rel:${F}:${i.sku}`) || !has(E3, `rel:${F}:${i.sku}`))) return 'a reservation committed after the cancel is not released';
  return [E1, E2, E3].every(E => has(E, `ost:${O}:cancelled`)) ? true : 'order not cancelled';
});

// R3.2, R6.1, R7.2, §4.8, §3.5: W4's go-live order already awaiting the customer, with nothing available, is amended: "If
// none is available, cancel the order (R6.1)" within 60 min of the amend. Each status is set at most once (R7.2) and each
// notification sent once (§4.8), so no lid is required twice.
{
  const [Cn, Tn] = pick(t => t.class === 'gl-awaiting' && allocOf(W4, t.subject).every(f => !f.available), 'go-live awaiting order with nothing available', W4);
  const Bn = builder(Cn, W4), bn = W4.backlog.find(x => x.case === Cn);
  const On = Tn.subject, Dn = Date.parse(Tn.placedAt) + policyOf(W4, Tn.placedAt).customerActionHours * 60 * MIN;
  G('awaiting-amend-nothing-available-cancels-once', 'R3.2, R6.1, R7.2, §4.8, §3.5', tr => {
    const t0 = Date.parse(W4.t0), a = t0 + 30 * MIN;
    if (a > Dn) return 'fixture: the amend falls after D';
    const mig = Bn.ev(t0, 'migration', { records: bn.export.records, events: bn.export.events });
    const E = tr(W4, Bn.view(a + MIN, Tn, [], [mig, act(Bn, a, On, 'amend')]));
    const L = lids(E);
    const dup = L.find((l, i) => L.indexOf(l) !== i);
    if (dup) return `${dup} required twice (R7.2: each status at most once; §4.8: each notification once)`;
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

// R1.1, R1.4, §3.1: a second order.placed for an order already recorded "is a duplicate: no effect", so the order's items
// stay those of the placement it was recorded from (hand-built: the generator's duplicates repeat the payload exactly).
G('duplicate-placement-changes-no-items', 'R1.1, R1.4, §3.1', tr => {
  const items = FUL.items.map(i => ({ sku: i.sku, qty: i.qty }));
  const placedAs = its => ({ orderId: O, customerId: T.customerId, placedAt: T.placedAt, currency: 'EUR', items: its, channel: 'web' });
  const create = B.row(P + MIN, 'orders', 'create', { orderId: O, items });
  const E = tr(W, B.view(P + 11 * MIN, T, [create], [B.ev(P, 'order.placed', placedAs(items)), B.ev(P + 10 * MIN, 'order.placed', placedAs([{ sku: items[0].sku, qty: items[0].qty + 1 }]))]));
  const c = E.effects.required.find(e => e.lid === `create:${O}`);
  const want = [...items].sort((x, y) => (x.sku < y.sku ? -1 : 1));       // R1.1: list order is not significant
  return c && same(c.match.items, want) ? true : `create items ${JSON.stringify(c?.match.items)} after a duplicate placement, expected ${JSON.stringify(want)}`;
});

// Fraud review (R2.2, R6.4): an order under review with everything available.
{
  const [C7, T7] = pick(t => t.verdict === 'review' && !t.class.startsWith('gl-') && allocOf(W, t.subject).every(f => f.available), 'fraud-review order with everything available');
  const B7 = builder(C7), O7 = T7.subject, p7 = Date.parse(T7.placedAt);
  const RVH = policyOf(W, T7.placedAt).fraudReviewHours;
  const view7 = (at, events, tasks = [], taskEvents = []) => B7.view(at, T7, [B7.row(p7 + MIN, 'orders', 'create', { orderId: O7 })], [B7.ev(p7, 'order.placed', { orderId: O7 }), ...events], { tasks, taskEvents });
  const task7 = (id, at, seq, instance = 'i-7') => ({ seq, at, instance, task: { id, kind: 'fraudReview', role: 'fraudAnalyst' }, case: C7 });
  const answer7 = (id, at, seq, answer, instance = 'i-7') => ({ seq, at, type: 'humanTask.answered', instance, payload: { taskId: id, answer } });
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
    const wa = win(Ea, `ost:${O7}:cancelled`);
    if (!(wa && wa.earliest === dl + 1000 && wa.latest === dl + 120 * MIN)) return `review-timeout window ${JSON.stringify(wa)}`;
    // (b) two review tasks (a duplicate placement opened a second instance, §3.1), both approved, at p+30 and p+90: the order
    // is cleared at the first approve (R2.2) and ready then (R4.1); the second answer cannot move `processing`.
    const Eb = tr(W, view7(p7 + 91 * MIN, [], [task7('r1', p7 + 5 * MIN, 900), task7('r1', p7 + 6 * MIN, 901, 'i-8')],
      [answer7('r1', p7 + 30 * MIN, 950, { decision: 'approve' }), answer7('r1', p7 + 90 * MIN, 960, { decision: 'approve' }, 'i-8')]));
    const wb = win(Eb, `ost:${O7}:processing`);
    return wb && wb.earliest === p7 + 30 * MIN && wb.latest === p7 + 90 * MIN ? true : `processing window ${JSON.stringify(wb)}`;
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
      const w = win(E0, l);
      if (!w || !(w.earliest > Dt && w.earliest <= Dt + 1000) || w.latest !== Dt + 60 * MIN) return `${l} window ${JSON.stringify(w)} (D ${Dt})`;
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
}

// R2.1, R4.1, R6.2, S9, S5: a passed order is cleared and ready at p, so it is processing from p (R6.2) and a cancel at p
// counts: nothing is reserved, charged or booked (S9 relieves `processing`). An amend for an order with no unavailable
// fulfilment changes nothing (S5): the saga goes on.
G('processing-cancels: a cancel at the ready instant counts, an amend never stops', 'R2.1, R4.1, R6.2, S9, S5', tr => {
  const E1 = tr(W, B.view(P + 2 * MIN, T, [], [placed, act(B, P, O, 'cancel')]));
  if (!has(E1, `ost:${O}:cancelled`) || !has(E1, `ntf:${O}:order-cancelled`) || !has(E1, `fst:${F}:cancelled`)) return 'cancel at p (the ready instant) did not cancel the order';
  if (has(E1, `ost:${O}:processing`) || lids(E1).some(l => /^(rsv|chg|shp):/.test(l))) return 'processing or forward steps still required after the cancel';
  const { rows, t } = history(1);
  const a = t + 5 * MIN;
  const E2 = tr(W, B.view(a + MIN, T, rows, [placed, act(B, a, O, 'amend')]));
  if (has(E2, `ost:${O}:cancelled`) || has(E2, `ntf:${O}:order-cancelled`) || comp(E2).length) return 'an amend stopped the order';
  return has(E2, `chg:${F}`) ? true : 'the saga did not continue after the amend';
});

// S7, R6.2, R6.3: an inTransit report proves collection (the collection report itself never arrived); a later cancel is
// refused and changes nothing else.
G('in-transit-report-proves-collection', 'S7, R6.2, R6.3', tr => {
  const { rows } = history(3);                 // booked at P + 4 min
  const it = runOf(P + 4 * MIN) + 180 * MIN, a = it + 20 * MIN;
  const E = tr(W, B.view(a + MIN, T, rows, [placed, report(it, 'inTransit'), act(B, a, O, 'cancel')]));
  if (!has(E, `ntf:${O}:cancel-refused`)) return 'no cancel-refused after an inTransit report';
  return comp(E).length || has(E, `ost:${O}:cancelled`) ? 'order stopped after an inTransit report' : true;
});

// R4.1, R4.2: while nothing stops the saga, every step taken is one R4.2 asks for (steps 1-3), and R4.1 sets each available
// fulfilment `processing` "within 60 min of t" (a passed order with nothing unavailable is ready at p).
G('taken-forward-steps-stay-asked-for', 'R4.1, R4.2', tr => {
  const { rows, t } = history(3);
  const E = tr(W, B.view(t, T, rows, [placed]));
  const miss = [...FUL.items.map(i => `rsv:${F}:${i.sku}`), `chg:${F}`, `shp:${F}`].filter(l => !has(E, l));
  if (miss.length) return `taken steps no longer required without a cancel or failure: ${miss}`;
  return span(E, `fst:${F}:processing`, P, P + 60 * MIN);
});

// R6.2: "Within 60 min of the cancel ... set the order cancelled; send order-cancelled." A charge emitted before the cancel
// that commits after it is "one already in flight": not something new after the cancel (still asked for, not an error),
// and it "is compensated within 60 min of its commit".
G('cancel-windows-and-in-flight-charge (R6.2)', 'R6.2, R4.2', tr => {
  const { rows } = history(1);
  const a = P + 10 * MIN, chargedAt = a + 2 * MIN;
  rows.push(B.row(chargedAt, 'billing', 'charge', CHG, true, { callAt: a - MIN }));      // emitted at a - 1 min, committed at a + 2 min
  const E = tr(W, B.view(chargedAt + MIN, T, rows, [placed, act(B, a, O, 'cancel')]));
  if (!asked(E, 'billing', 'charge')) return 'in-flight charge (emitted before the cancel, committed after it) treated as a new charge after the cancel';
  for (const l of [`ost:${O}:cancelled`, `ntf:${O}:order-cancelled`]) { const w = win(E, l); if (!w || w.latest !== a + 60 * MIN) return `${l} window ${JSON.stringify(w)} (cancel at ${a})`; }
  const rf = win(E, `rf:${F}`);
  return rf && rf.latest === chargedAt + 60 * MIN ? true : `refund window ${JSON.stringify(rf)} (charge committed at ${chargedAt})`;
});

// R6.2: "Book, charge or reserve nothing new for the order after the cancel"; what still commits is compensated (R5.1).
G('no-new-forward-step-after-a-cancel', 'R6.2, R5.1', tr => {
  const a = P + 10 * MIN;
  const rows = [B.row(P + MIN, 'orders', 'create', { orderId: O }), ...FUL.items.map(i => B.row(a + 5 * MIN, 'inventory', 'reserve', rsvArgs(i))),
    B.row(a + 6 * MIN, 'billing', 'charge', CHG), B.row(a + 7 * MIN, 'carrier', 'create', { orderId: O, fulfilmentId: F, location: FUL.location, ref: null })];
  const E = tr(W, B.view(a + 8 * MIN, T, rows, [placed, act(B, a, O, 'cancel')]));
  for (const [system, op] of [['inventory', 'reserve'], ['billing', 'charge'], ['carrier', 'create']]) if (asked(E, system, op)) return `${system}.${op} taken after the cancel is still asked for`;
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

// §4: "a second commit of an effect that already happened" is an error, and §1 Keys: a committed effect is "not applied
// again". The step's commit, which anchors the next step's window (R4.2) and its collection (R4.3), is its first commit.
// (The grader reports the second commit as a divergence first, so only this golden sees these windows.)
G('second-commit-moves-no-window', '§1 Keys, §4, R4.2, R4.3, R6.2', tr => {
  const h1 = history(1);                       // reserved at P + 2 min
  const r1 = span(tr(W, B.view(P + 61 * MIN, T, [...h1.rows, B.row(P + 60 * MIN, 'inventory', 'reserve', rsvArgs(FUL.items[0]))], [placed])), `chg:${F}`, P + 2 * MIN, P + 122 * MIN);
  if (r1 !== true) return `reservation committed twice: ${r1}`;
  const h2 = history(2);                       // charged at P + 3 min
  const r2 = span(tr(W, B.view(P + 61 * MIN, T, [...h2.rows, B.row(P + 60 * MIN, 'billing', 'charge', CHG)], [placed])), `shp:${F}`, P + 3 * MIN, P + 123 * MIN);
  if (r2 !== true) return `charge committed twice: ${r2}`;
  // Booked at P + 4 min, so collected at R (R4.3); a second booking after R's cut-off and a cancel just before R: the
  // shipment must still be cancelled before R, the point of no return (R4.3; R6.2 "cancel a shipment at once").
  const h3 = history(3);
  const R = runOf(P + 4 * MIN), a = R - 3 * MIN;
  const E3 = tr(W, B.view(a + MIN, T, [...h3.rows, B.row(R - 5 * MIN, 'carrier', 'create', { orderId: O, fulfilmentId: F, location: FUL.location, ref: null })], [placed, act(B, a, O, 'cancel')]));
  const w = win(E3, `csh:${F}`);
  return w && w.latest === R - MIN ? true : `shipment booked twice: cancel latest ${w ? new Date(w.latest).toISOString() : 'missing'}, expected the collection ${new Date(R).toISOString()} - 1 min`;
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

// R5.2: a fulfilment fails at its first failure ("the time of the declined or failed attempt, or of the carrier's
// message"). A retried decline ("Do not retry a permanently failed step") or a later report about the already-failed
// fulfilment (§3.3 "change nothing") does not move it.
G('fulfilment-fails-at-its-first-failure', 'R5.2, §3.3, R7.2', tr => {
  const { rows, t } = history(1);              // reserved at P + 2 min; t = P + 5 min
  const r1 = span(tr(W, B.view(t + 31 * MIN, T, [...rows, declined(t), declined(t + 30 * MIN)], [placed])), `fst:${F}:failed`, t, t + 120 * MIN);
  if (r1 !== true) return `declined twice: ${r1}`;
  const R = runOf(t + MIN);
  const E2 = tr(W, B.view(R + MIN, T, [...rows, declined(t), B.row(t + MIN, 'carrier', 'create', { orderId: O, fulfilmentId: F, location: FUL.location, ref: null })], [placed, report(R, 'collectionFailed')]));
  const r2 = span(E2, `fst:${F}:failed`, t, t + 120 * MIN);
  return r2 === true ? true : `declined, then a collection failure: ${r2}`;
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

// R5.1 with R6.2: a counted cancel, then the carrier reports collectionFailed at the collection run, before any shipment
// cancel: compensation has no shipment cancel ("only if a shipment was booked and not reported collectionFailed"), and the
// booked shipment stays in the records (R7.1: "shipments as the carrier and your cancellations left them"; the golden
// checks the record exists, not its status). The cancel is strictly before the report: no same-instant tie (k177).
G('cancel-then-collection-failure-no-shipment-cancel (R5.1)', 'R5.1, R6.2, R7.1', tr => {
  const { rows } = history(3);                 // booked at P + 4 min
  const R = runOf(P + 4 * MIN), a = R - 10 * MIN;
  const E = tr(W, B.view(R + MIN, T, rows, [placed, act(B, a, O, 'cancel'), report(R, 'collectionFailed')]));
  if (!has(E, `ost:${O}:cancelled`) || !has(E, `rf:${F}`)) return 'cancel did not count';
  if (has(E, `csh:${F}`)) return 'shipment cancel required for a shipment reported collectionFailed';
  if (!E.records || E.records.shipments[F] === undefined) return `no shipment record for ${F}: ${JSON.stringify(E.records?.shipments)}`;
  return true;
});

// Layer 5 (records): recordsOf is the oracle's reading of the arm's records, passed as runGoldens' second argument.
// §2 orders.create: "the order starts pending, each fulfilment pending or, when its location is null, unavailable";
// §3.5: an order in flight at go-live arrives with "the records that exist for it" (untouched, they are its records, R7.1);
// §1, §3.2: a message that belongs to no order (subject null) has no order, so no order records.
{
  const [Cm, Tm] = pick(t => t.subject && !t.class.startsWith('gl-') && allocOf(W, t.subject).some(f => f.location === null) && allocOf(W, t.subject).some(f => f.location !== null), 'order with an available and an unavailable fulfilment');
  const alm = allocOf(W, Tm.subject);
  const createM = builder(Cm).row(Date.parse(Tm.placedAt) + MIN, 'orders', 'create', { orderId: Tm.subject, fulfilments: alm.map(f => ({ fulfilmentId: f.fulfilmentId, location: f.location, items: f.items })) });
  const migrated = W.backlog.filter(b => b.export?.records?.['orders.orders']?.length);
  const [Cx] = pick(t => t.subject === null, 'no-order');
  const idx = (ledger = []) => ({ ledger, writes: [] });
  G('records-of-create-migration-and-no-order', '§2 orders.create, §3.5, R7.1, §1, §3.2', (tr, recordsOf) => {
    if (typeof recordsOf !== 'function') return 'recordsOf not supplied: call runGoldens(transition, recordsOf)';
    const r1 = recordsOf(W, idx([createM]), Cm);
    if (r1?.order !== 'pending') return `after create: order ${r1?.order}`;
    for (const f of alm) { const want = f.location === null ? 'unavailable' : 'pending'; if (r1.fulfilments[f.fulfilmentId] !== want) return `after create: ${f.fulfilmentId} ${r1.fulfilments[f.fulfilmentId]} != ${want}`; }
    if (!migrated.length) return 'fixture: no go-live order with migrated records in W';
    for (const b of migrated) {
      const r2 = recordsOf(W, idx(), b.case);
      const want = b.export.records['orders.orders'].find(r => r.orderId === b.subject)?.status;
      if (r2?.order !== want) return `go-live ${b.case}: order ${r2?.order} != migrated ${want}`;
      for (const f of b.export.records['orders.fulfilments'] ?? []) if (r2.fulfilments[f.fulfilmentId] !== f.status) return `go-live ${b.case}: ${f.fulfilmentId} ${r2.fulfilments[f.fulfilmentId]} != migrated ${f.status}`;
    }
    const r3 = recordsOf(W, idx(), Cx);
    return r3 === null ? true : `records for a case with no order: ${JSON.stringify(r3)}`;
  });
}

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
