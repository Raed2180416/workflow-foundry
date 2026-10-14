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

/** Each golden: { name, source (rule), check(transition) -> true | string (why it failed) }. */
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

/** Run every golden against a transition; returns [{ name, source, pass, detail }]. A throw is a failure. */
export function runGoldens(transition) {
  return goldens.map(g => {
    let r;
    try { r = g.check(transition); } catch (e) { r = `threw: ${String(e?.message ?? e).slice(0, 200)}`; }
    return { name: g.name, source: g.source, pass: r === true, detail: r === true ? null : r };
  });
}
