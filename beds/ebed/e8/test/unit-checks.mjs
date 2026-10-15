// E8 transition unit checks ($0): regressions of the reference transition whose differences the grader cannot see, so they
// are not goldens (ledger/MUTANTS.md §0). They were goldens until the 2026-10-15 re-review; they moved here so that
// tools/mutate.mjs, which runs only golden.mjs's `goldens`, counts a mutant as killed only for a difference the grader
// can report. Each check: { name, source, check(transition, recordsOf) -> true | string }. Run by test/e8.test.mjs.
//   - a lid named twice (the grader merges lids by id);
//   - whether a step the arm already took stays named (the grader keeps a satisfied lid satisfied, and exempts a row in
//     flight or from a call that could not know the withdrawal's cause);
//   - windows that only a second commit, a retried permanent failure or a step after the grader stopped can move;
//   - records the grader never compares (recordsOf on non-final states; a shipment record after a missed cancel);
//   - inputs outside the world contract (a held-up carrier report meeting a processing cancel, SPEC-E §3.3);
//   - which message cut a fulfilment's forward steps (S10 with S13; no forward step exists at a failure instant on a
//     graded trajectory).
import { fixtures as X } from '../golden.mjs';

const { MIN, W, W4, CASE, T, O, F, FUL, P, loc, CODES, price, fee0, B, builder, placed, history, lids, comp, has, win, span, sends, asked, report, act,
  CHG, declined, rsvArgs, runOf, POL, policyOf, pick, allocOf, review: { B7, O7, p7, view7, task7, answer7 }, twoFul: { C2f, T2f } } = X;

export const unitChecks = [];
const U = (name, source, check) => unitChecks.push({ name, source, check });

// Taken steps stay named (S9, S10): statuses and reservations taken before a processing cancel; reservations by the call
// given the cancel or at a later instant are not named; one by a call given another message (not the cancel) is.
U('steps-before-vs-after-a-processing-cancel: taken steps and their naming', 'S9, S10, R4.1, R4.2, R6.2', tr => {
  const a = P + 10 * MIN;
  const info = report(a, 'info');
  const cancel = act(B, a, O, 'cancel');
  const create = B.row(P + MIN, 'orders', 'create', { orderId: O });
  const rsv = (at, extra = {}) => FUL.items.map(i => B.row(at, 'inventory', 'reserve', rsvArgs(i), true, extra));
  const sts = (at, extra = {}) => [B.row(at, 'orders', 'setStatus', { orderId: O, fulfilmentId: null, status: 'processing' }, true, extra), B.row(at, 'orders', 'setStatus', { orderId: O, fulfilmentId: F, status: 'processing' }, true, extra)];
  const E1 = tr(W, B.view(a + MIN, T, [create, ...sts(P + 2 * MIN), ...rsv(P + 3 * MIN)], [placed, cancel]));
  if (!has(E1, `ost:${O}:processing`) || !has(E1, `fst:${F}:processing`)) return 'processing set before the cancel is no longer named';
  if (FUL.items.some(i => !has(E1, `rsv:${F}:${i.sku}`))) return 'reservation taken before the cancel is no longer named';
  const gotCancel = { callAt: a, knows: new Set([CASE]), given: new Set([cancel.id]) };
  if (FUL.items.some(i => has(tr(W, B.view(a + 2 * MIN, T, [create, ...rsv(a, gotCancel)], [placed, cancel])), `rsv:${F}:${i.sku}`))) return 'reservation made by the call that was given the cancel is still named';
  if (FUL.items.some(i => has(tr(W, B.view(a + 3 * MIN, T, [create, ...rsv(a + 2 * MIN, { callAt: a + MIN })], [placed, cancel])), `rsv:${F}:${i.sku}`))) return 'reservation made a tick after the cancel is still named';
  const E5 = tr(W, B.view(a + 2 * MIN, T, [create, ...rsv(a, { callAt: a, knows: new Set([CASE]), given: new Set([info.id]) })], [placed, info, cancel]));
  return FUL.items.some(i => !has(E5, `rsv:${F}:${i.sku}`)) ? 'a reservation by a call that was not given the cancel (S10) is not named' : true;
});

// S10, S12: `processing` set by the call that got the approve (not given the cancel of the same instant) stays named.
U('review-answer-and-cancel-in-one-instant: processing set by the approve\'s call stays named', 'S10, S12', tr => {
  const r1 = task7('r1', p7 + 5 * MIN, 900), x = p7 + 60 * MIN;
  const cancel = { ...act(B7, x, O7, 'cancel'), seq: 960 };
  const sts = [null, ...allocOf(W, O7).map(f => f.fulfilmentId)].map(fid => B7.row(x, 'orders', 'setStatus', { orderId: O7, fulfilmentId: fid, status: 'processing' }));
  const T7 = X.review.T7;
  const Eb = tr(W, B7.view(x + 2 * MIN, T7, [B7.row(p7 + MIN, 'orders', 'create', { orderId: O7 }), ...sts], [B7.ev(p7, 'order.placed', { orderId: O7 }), cancel], { tasks: [r1], taskEvents: [answer7('r1', x, 950, { decision: 'approve' })] }));
  return has(Eb, `ost:${O7}:processing`) ? true : 'processing set by the call that got the approve (not given the cancel) is no longer named (S10)';
});

// R4.2: while nothing stops the saga, every step taken stays named.
U('taken-forward-steps-stay-named', 'R4.1, R4.2', tr => {
  const { rows, t } = history(3);
  const E = tr(W, B.view(t, T, rows, [placed]));
  const miss = [...FUL.items.map(i => `rsv:${F}:${i.sku}`), `chg:${F}`, `shp:${F}`].filter(l => !has(E, l));
  return miss.length ? `taken steps no longer named without a cancel or failure: ${miss}` : true;
});

// R6.2: a charge emitted before the cancel that commits after it is one already in flight, still named.
U('in-flight-charge-stays-named', 'R6.2, R4.2', tr => {
  const { rows } = history(1);
  const a = P + 10 * MIN, chargedAt = a + 2 * MIN;
  rows.push(B.row(chargedAt, 'billing', 'charge', CHG, true, { callAt: a - MIN }));
  return asked(tr(W, B.view(chargedAt + MIN, T, rows, [placed, act(B, a, O, 'cancel')])), 'billing', 'charge') ? true : 'in-flight charge treated as a new charge after the cancel';
});

// R6.2: steps taken after the cancel are not named (the grader stops at the first of them, outside what is allowed).
U('new-forward-steps-after-a-cancel-not-named', 'R6.2', tr => {
  const a = P + 10 * MIN;
  const rows = [B.row(P + MIN, 'orders', 'create', { orderId: O }), ...FUL.items.map(i => B.row(a + 5 * MIN, 'inventory', 'reserve', rsvArgs(i))),
    B.row(a + 6 * MIN, 'billing', 'charge', CHG), B.row(a + 7 * MIN, 'carrier', 'create', { orderId: O, fulfilmentId: F, location: FUL.location, ref: null })];
  const E = tr(W, B.view(a + 8 * MIN, T, rows, [placed, act(B, a, O, 'cancel')]));
  for (const [system, op] of [['inventory', 'reserve'], ['billing', 'charge'], ['carrier', 'create']]) if (asked(E, system, op)) return `${system}.${op} taken after the cancel is still named`;
  return true;
});

// §1 Keys, §4, R4.2, R4.3: the step's first commit anchors the next window and the collection run (a second commit is
// reported as a divergence first).
U('second-commit-moves-no-window', '§1 Keys, §4, R4.2, R4.3, R6.2', tr => {
  const h1 = history(1);
  const r1 = span(tr(W, B.view(P + 61 * MIN, T, [...h1.rows, B.row(P + 60 * MIN, 'inventory', 'reserve', rsvArgs(FUL.items[0]))], [placed])), `chg:${F}`, P + 2 * MIN, P + 122 * MIN);
  if (r1 !== true) return `reservation committed twice: ${r1}`;
  const h2 = history(2);
  const r2 = span(tr(W, B.view(P + 61 * MIN, T, [...h2.rows, B.row(P + 60 * MIN, 'billing', 'charge', CHG)], [placed])), `shp:${F}`, P + 3 * MIN, P + 123 * MIN);
  if (r2 !== true) return `charge committed twice: ${r2}`;
  const h3 = history(3);
  const R = runOf(P + 4 * MIN), a = R - 3 * MIN;
  const w = win(tr(W, B.view(a + MIN, T, [...h3.rows, B.row(R - 5 * MIN, 'carrier', 'create', { orderId: O, fulfilmentId: F, location: FUL.location, ref: null })], [placed, act(B, a, O, 'cancel')])), `csh:${F}`);
  return w && w.latest === R - MIN ? true : `shipment booked twice: cancel latest ${w ? new Date(w.latest).toISOString() : 'missing'}`;
});

// R5.2: a fulfilment fails at its first failure; a retried decline or a later report does not move it (both reported as
// divergences first: retrying a permanently failed step, booking after a failure).
U('fulfilment-fails-at-its-first-failure', 'R5.2, §3.3, R7.2', tr => {
  const { rows, t } = history(1);
  const r1 = span(tr(W, B.view(t + 31 * MIN, T, [...rows, declined(t), declined(t + 30 * MIN)], [placed])), `fst:${F}:failed`, t, t + 120 * MIN);
  if (r1 !== true) return `declined twice: ${r1}`;
  const R = runOf(t + MIN);
  const r2 = span(tr(W, B.view(R + MIN, T, [...rows, declined(t), B.row(t + MIN, 'carrier', 'create', { orderId: O, fulfilmentId: F, location: FUL.location, ref: null })], [placed, report(R, 'collectionFailed')])), `fst:${F}:failed`, t, t + 120 * MIN);
  return r2 === true ? true : `declined, then a collection failure: ${r2}`;
});

// R4.3: booked exactly cut-off minutes before a run, the shipment is collected at that run (a cancel after the run is
// refused by the carrier, so a later window is never usable).
U('collection-cutoff-boundary', 'R4.3', tr => {
  const { rows, t } = history(2);
  const [h, m] = loc.collectionTime.split(':').map(Number);
  const day = Math.floor((t - Date.parse(W.t0)) / (1440 * MIN)) + 1;
  const run = Date.parse(W.t0) + (day * 1440 + h * 60 + m) * MIN;
  rows.push(B.row(run - 30 * MIN, 'carrier', 'create', { orderId: O, fulfilmentId: F, location: FUL.location, ref: null }));
  const a = run - 20 * MIN;
  const w = win(tr(W, B.view(a + MIN, T, rows, [placed, act(B, a, O, 'cancel')])), `csh:${F}`);
  return w && w.latest === run - MIN ? true : `shipment cancel window ${JSON.stringify(w)} (collection at ${new Date(run).toISOString()})`;
});

// R6.2, R7.1 (oracle defect D1): after a counted cancel whose shipment cancel was missed, a collectionFailed report leaves
// the shipment record `failed`, as the carrier wrote it (the grader stopped at the missed shipment cancel).
U('cancel-before-a-collection-failure: records after the report (D1)', 'R6.2, R5.1, R7.1', tr => {
  const { rows } = history(3);
  const R = runOf(P + 4 * MIN), a = R - 10 * MIN;
  const E = tr(W, B.view(R + MIN, T, rows, [placed, act(B, a, O, 'cancel'), report(R, 'collectionFailed')]));
  if (!has(E, `ost:${O}:cancelled`) || !has(E, `rf:${F}`)) return 'cancel did not count';
  return E.records?.shipments?.[F] === 'failed' ? true : `shipment records ${JSON.stringify(E.records?.shipments)}: the carrier left ${F} failed (R7.1, D1)`;
});

// S14: a step of a failing fulfilment that commits after the failure (unreachable under R4.2 sequencing).
U('step-committing-after-a-failure (S14)', 'S14, R5.2, R5.1', tr => {
  if (FUL.items.length < 2) return 'fixture: needs a multi-item fulfilment';
  const [i0, i1, ...rest] = FUL.items;
  const x = P + 5 * MIN, late = x + 30 * MIN;
  const rows = [B.row(P + MIN, 'orders', 'create', { orderId: O }), ...[i0, ...rest].map(i => B.row(P + 2 * MIN, 'inventory', 'reserve', rsvArgs(i))), declined(x),
    B.row(late, 'inventory', 'reserve', rsvArgs(i1), true, { callAt: P + 2 * MIN })];
  const E = tr(W, B.view(late + MIN, T, rows, [placed]));
  for (const l of [`rel:${F}:${i0.sku}`, `rel:${F}:${i1.sku}`, `fst:${F}:failed`, `ntf:${F}:fulfilment-failed`]) { const r = span(E, l, x, late + 120 * MIN); if (r !== true) return r; }
  return true;
});

// S7 on an input outside the world contract (SPEC-E §3.3: no held-up report meets a processing cancel): a delivery report
// that arrived before its collection report proves collection, so the cancel is refused.
U('delivery-report-proves-collection (S7, outside the world contract)', 'S7, S6, R6.3, W2', tr => {
  const B2 = builder(C2f), O2 = T2f.subject, p2 = Date.parse(T2f.placedAt), [F1, F2] = allocOf(W, O2);
  const amt = f => f.items.reduce((s, i) => s + i.qty * price(W, i.sku), 0) + fee0(W, f.location);
  const rows = [B2.row(p2 + MIN, 'orders', 'create', { orderId: O2 }),
    ...[F1, F2].flatMap(f => f.items.map(i => B2.row(p2 + 2 * MIN, 'inventory', 'reserve', { orderId: O2, fulfilmentId: f.fulfilmentId, location: f.location, sku: i.sku, qty: i.qty }))),
    B2.row(p2 + 3 * MIN, 'billing', 'charge', { orderId: O2, fulfilmentId: F1.fulfilmentId, customerId: T2f.customerId, amountMinor: amt(F1), currency: 'EUR' }),
    B2.row(p2 + 4 * MIN, 'carrier', 'create', { orderId: O2, fulfilmentId: F1.fulfilmentId, location: F1.location, ref: null })];
  const l1 = W.master.locations.find(l => l.location === F1.location);
  const [h, m] = l1.collectionTime.split(':').map(Number);
  let R = Date.parse(W.t0) + (h * 60 + m - 1440) * MIN;
  while (R < p2 + 4 * MIN + POL.collectionCutoffMinutes * MIN) R += 1440 * MIN;
  const T2 = R + 1200 * MIN, a = T2 + 20 * MIN;
  const delivered = B2.ev(T2, 'carrier.status', { carrier: l1.carrier, code: CODES[l1.carrier].delivered, fulfilmentRef: F1.fulfilmentId, reportedAt: new Date(T2).toISOString() });
  const E = tr(W, B2.view(a + MIN, T2f, rows, [B2.ev(p2, 'order.placed', { orderId: O2 }), delivered, act(B2, a, O2, 'cancel')]));
  const w = win(E, `ntf:${O2}:cancel-refused`);
  if (!w || w.earliest !== a || w.latest !== a + 60 * MIN) return `cancel-refused window ${JSON.stringify(w)}`;
  return comp(E).length || has(E, `ost:${O2}:cancelled`) || has(E, `fst:${F2.fulfilmentId}:cancelled`) ? 'order stopped after a delivery report proved collection' : true;
});

// S10, S13 (review 2026-10-15): a fulfilment whose collectionFailed report is delivered in a cancel's instant fails before
// the cancel; its forward steps are judged against that report, not against the cancel. A reservation of F1 by a call
// given the report (not the cancel) was taken after the failure (not named); one by a call given the cancel (not the
// report) was taken before the failure (named). The input is synthetic: no forward step exists at a failure instant.
U('forward-step-cut-judged-against-its-own-message (S10, S13)', 'S10, S13, R5.2', tr => {
  const B2 = builder(C2f), O2 = T2f.subject, p2 = Date.parse(T2f.placedAt), [F1] = allocOf(W, O2);
  const l1 = W.master.locations.find(l => l.location === F1.location);
  const R = p2 + 600 * MIN;
  const nc = B2.ev(R, 'carrier.status', { carrier: l1.carrier, code: CODES[l1.carrier].collectionFailed, fulfilmentRef: F1.fulfilmentId, reportedAt: new Date(R).toISOString() });
  const cancel = act(B2, R, O2, 'cancel');
  const rsv1 = given => F1.items.map(i => B2.row(R, 'inventory', 'reserve', { orderId: O2, fulfilmentId: F1.fulfilmentId, location: F1.location, sku: i.sku, qty: i.qty }, true, { callAt: R, knows: new Set([C2f]), given: new Set(given) }));
  const view = rows => B2.view(R + MIN, T2f, [B2.row(p2 + MIN, 'orders', 'create', { orderId: O2 }), ...rows], [B2.ev(p2, 'order.placed', { orderId: O2 }), nc, cancel]);
  const Ea = tr(W, view(rsv1([nc.id])));
  if (!has(Ea, `fst:${F1.fulfilmentId}:failed`)) return 'F1 did not fail before the cancel (S13)';
  if (F1.items.some(i => has(Ea, `rsv:${F1.fulfilmentId}:${i.sku}`))) return 'a reservation by a call given the collectionFailed report is named (S10: taken after the failure)';
  const Eb = tr(W, view(rsv1([cancel.id])));
  return F1.items.some(i => !has(Eb, `rsv:${F1.fulfilmentId}:${i.sku}`)) ? 'a reservation by a call given the cancel but not the report is not named (S10: taken before the failure)' : true;
});

// R3.2, R6.1, R7.2, §4.8: W4's go-live order awaiting the customer, with nothing available, is amended: no lid is named
// twice (the grader merges lids by id).
U('awaiting-amend-nothing-available: no lid named twice', 'R7.2, §4.8', tr => {
  const [Cn, Tn] = pick(t => t.class === 'gl-awaiting' && allocOf(W4, t.subject).every(f => !f.available), 'go-live awaiting order with nothing available', W4);
  const Bn = builder(Cn, W4), bn = W4.backlog.find(x => x.case === Cn);
  const t0 = Date.parse(W4.t0), a = t0 + 30 * MIN;
  const E = tr(W4, Bn.view(a + MIN, Tn, [], [Bn.ev(t0, 'migration', { records: bn.export.records, events: bn.export.events }), act(Bn, a, Tn.subject, 'amend')]));
  const L = lids(E);
  const dup = L.find((l, i) => L.indexOf(l) !== i);
  return dup ? `${dup} named twice` : true;
});

// Layer 5 (records): recordsOf on states the grader never compares (initial statuses, migrated records before the end)
// and on a case with no order.
U('records-of-create-migration-and-no-order', '§2 orders.create, §3.5, R7.1, §3.2', (tr, recordsOf) => {
  if (typeof recordsOf !== 'function') return 'recordsOf not supplied';
  const [Cm, Tm] = pick(t => t.subject && !t.class.startsWith('gl-') && allocOf(W, t.subject).some(f => f.location === null) && allocOf(W, t.subject).some(f => f.location !== null), 'order with an available and an unavailable fulfilment');
  const alm = allocOf(W, Tm.subject);
  const createM = builder(Cm).row(Date.parse(Tm.placedAt) + MIN, 'orders', 'create', { orderId: Tm.subject, fulfilments: alm.map(f => ({ fulfilmentId: f.fulfilmentId, location: f.location, items: f.items })) });
  const idx = (ledger = []) => ({ ledger, writes: [] });
  const r1 = recordsOf(W, idx([createM]), Cm);
  if (r1?.order !== 'pending') return `after create: order ${r1?.order}`;
  for (const f of alm) { const want = f.location === null ? 'unavailable' : 'pending'; if (r1.fulfilments[f.fulfilmentId] !== want) return `after create: ${f.fulfilmentId} ${r1.fulfilments[f.fulfilmentId]} != ${want}`; }
  const migrated = W.backlog.filter(b => b.export?.records?.['orders.orders']?.length);
  if (!migrated.length) return 'fixture: no go-live order with migrated records';
  for (const b of migrated) {
    const r2 = recordsOf(W, idx(), b.case);
    const want = b.export.records['orders.orders'].find(r => r.orderId === b.subject)?.status;
    if (r2?.order !== want) return `go-live ${b.case}: order ${r2?.order} != migrated ${want}`;
    for (const f of b.export.records['orders.fulfilments'] ?? []) if (r2.fulfilments[f.fulfilmentId] !== f.status) return `go-live ${b.case}: ${f.fulfilmentId} ${r2.fulfilments[f.fulfilmentId]} != migrated ${f.status}`;
  }
  const [Cx] = pick(t => t.subject === null, 'no-order');
  return recordsOf(W, idx(), Cx) === null ? true : 'records for a case with no order';
});

/** Run every unit check; returns [{ name, source, pass, detail }]. A throw is a failure. */
export function runUnitChecks(transition, recordsOf = null) {
  return unitChecks.map(u => {
    let r;
    try { r = u.check(transition, recordsOf); } catch (e) { r = `threw: ${String(e?.message ?? e).slice(0, 200)}`; }
    return { name: u.name, source: u.source, pass: r === true, detail: r === true ? null : r };
  });
}
