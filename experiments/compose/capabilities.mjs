// Hidden capability contracts for E8 (research/composition-20261021/HARNESS.md §3). $0, analyst side; never shown to a
// builder. Each contract is a predicate over one order's EFFECT HISTORY (the committed ledger rows and attempts the
// journal attributes to the case, the messages delivered for it, its human tasks) plus world facts SPEC-E gives every
// arm (catalog, fees, allocation, verdict, customer e-mail), written from SPEC-E's rules (each check cites its rule).
// They never look at how a program was split into modules, so any decomposition can pass; a wrong boundary shows up
// as a violated business capability. They are deliberately written apart from the oracle's transition: they do not
// import it, and they judge consistency of what happened with the rules, not the oracle's per-step expectation, so
// they can disagree with it (a disagreement is a finding, reported by validate.mjs, never tuned away).
// Parsing only: the journal is indexed with the item-independent oracle/view.mjs JournalIndex (case attribution by the
// host's subjectCase, F5 renames mapped back, batches flattened per item); every rule below is this file's own.
// The saga planner (beds/ebed/lib/saga.mjs) is the independent compensation planner of BAR-SET §3 P59.
import { indexJournal, caseIds } from '../../beds/ebed/oracle/view.mjs';
import { planSaga } from '../../beds/ebed/lib/saga.mjs';
import { validate } from './runtime.mjs';

const MIN = 60_000;
const ms = s => Date.parse(s);
const sortSku = items => [...(items ?? [])].map(i => `${i?.sku}x${i?.qty}`).sort().join(',');
const ORANK = { pending: 0, customerActionRequired: 1, processing: 2, completed: 3, failed: 3, cancelled: 3, timedOut: 3 };
const FRANK = { unavailable: 0, pending: 0, processing: 1, dispatched: 2, completed: 3, failed: 3, cancelled: 3 };
const ENDED = s => ['completed', 'failed', 'cancelled', 'timedOut'].includes(s);
const FORWARD = new Set(['inventory.reserve', 'billing.charge', 'carrier.create']);
const COMP = new Set(['inventory.release', 'billing.refund', 'carrier.cancel']);
const permanentRow = r => !r.committed && !!r.error && (r.error.code === 402 || r.error.code === 'permanent');
const k = r => `${r.system}.${r.op}`;

/** The capability contracts: id, title, rules (SPEC-E ids), what is checked. */
export const CAPABILITIES = Object.freeze([
  { id: 'intake', title: 'Order intake and record', rules: ['R1.1', 'R1.2', 'R1.3', 'R1.4', '§3.1', '§3.5'] },
  { id: 'fraud', title: 'Fraud screening and review', rules: ['R2.1', 'R2.2', 'R6.4', 'S1', 'S3', 'S12', 'S15'] },
  { id: 'capture', title: 'Payment capture, at most once, after reservation', rules: ['R4.2.2', '§1 Keys', 'R5.2', 'R6.2'] },
  { id: 'refund', title: 'Refund if and only if captured money must return', rules: ['R5.1', 'R5.2', 'R6.2', 'R7.1'] },
  { id: 'reservation', title: 'Stock reservation and release', rules: ['R4.2.1', 'R5.1', 'R6.2', 'R7.1'] },
  { id: 'shipment', title: 'Shipment booking and cancellation', rules: ['R4.2.3', 'R5.1', 'R6.2'] },
  { id: 'compensation', title: 'Compensation of committed steps in reverse order, on time', rules: ['R5.1', 'R5.2', 'R6.2', 'S2', 'S14'] },
  { id: 'failure', title: 'Fulfilment failure handling', rules: ['R5.2', 'S13', 'S14'] },
  { id: 'tracking', title: 'Carrier tracking, forward-only statuses, order outcome', rules: ['R4.1', 'R4.4', 'R4.5', 'R7.2'] },
  { id: 'customer-action', title: 'Customer action on unavailable items (amend / cancel / timeout)', rules: ['R3.1', 'R3.2', 'S1', 'S5', 'S9', 'S11'] },
  { id: 'cancellation', title: 'Customer cancel during processing and its refusal', rules: ['R6.1', 'R6.2', 'R6.3', 'S4', 'S6', 'S7', 'S10', 'S13', 'S15'] },
  { id: 'notifications', title: 'Each required notification exactly once, to the right party', rules: ['§4.8', 'R2', 'R3', 'R5.2', 'R6'] },
  { id: 'exactly-once', title: 'Exactly-once effects and key discipline', rules: ['§1 Keys', 'R1.4', 'R7.2'] },
]);

/** Rule variants (drift.mjs): which reading of a drifted rule the contracts apply. */
export const DEFAULT_RULES = Object.freeze({ reviewTimeout: 'cancel' });

// ---------------------------------------------------------------------------------------------------------------------
// Facts of one case

function editionAt(world, placedAt) {
  const date = placedAt.slice(0, 10);                         // the order's local date (times carry their offset)
  const eds = world.rulebook.editions.filter(e => e.effectiveFrom <= date).sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1));
  const ed = eds[0] ?? world.rulebook.editions[0];
  return { id: ed.id, policy: JSON.parse(ed.files['policy.json']), fees: JSON.parse(ed.files['shipping-fees.json']), codes: JSON.parse(ed.files['carrier-codes.json']) };
}

function factsOf(world, idx, c) {
  const t = world.truth.cases[c];
  const O = t.subject;
  const b = idx.bucket(c);
  const p = ms(t.placedAt);
  const ed = editionAt(world, t.placedAt);
  const stage = t.class.startsWith('gl-') ? t.class : null;
  const price = sku => world.master.catalog.find(x => x.sku === sku)?.unitPriceMinor ?? NaN;
  const fee = loc => ed.fees.find(f => f.location === loc)?.feeMinor ?? 0;
  const alloc = world.sor['inventory.allocations'].find(a => a.orderId === O).fulfilments.map(f => ({
    ...f, amount: f.items.reduce((s, i) => s + i.qty * price(i.sku), 0) + (f.location ? fee(f.location) : 0) }));
  const avail = alloc.filter(f => f.available), unavail = alloc.filter(f => !f.available);
  const meaning = (carrier, code) => ed.codes.find(x => x.carrier === carrier && x.code === code)?.meaning ?? 'info';
  const dl = [...b.deliveries].sort((x, y) => x.at - y.at || x.seq - y.seq);
  const placements = dl.filter(d => d.event.type === 'order.placed');
  const migration = dl.find(d => d.event.type === 'migration');
  const placedSeq = placements[0]?.seq ?? migration?.seq ?? -1;
  // S11: an action delivered before its order's placement names no order yet.
  const actions = dl.filter(d => d.event.type === 'customer.action' && d.seq > placedSeq)
    .map(d => ({ id: d.event.id, action: d.event.payload.action, at: ms(d.event.at), dAt: d.at, seq: d.seq }))
    .sort((x, y) => x.at - y.at || x.seq - y.seq);
  const reports = dl.filter(d => d.event.type === 'carrier.status').map(d => ({ id: d.event.id, F: d.event.payload.fulfilmentRef,
    meaning: meaning(d.event.payload.carrier, d.event.payload.code), reportedAt: ms(d.event.payload.reportedAt ?? d.event.at), dAt: d.at, seq: d.seq }));
  if (migration) for (const m of migration.event.payload?.events ?? []) if (m.type === 'carrier.status') {
    reports.push({ id: m.id, F: m.payload.fulfilmentRef, meaning: meaning(m.payload.carrier, m.payload.code), reportedAt: ms(m.payload.reportedAt ?? m.at), dAt: migration.at, seq: migration.seq, pre: true });
  }
  const rows = [...b.ledger].sort((x, y) => x.seq - y.seq);
  // Deadlines after the end of what was observed (the horizon, or the last wake-up of a run that stopped) are not judged.
  const endMs = idx.end ? idx.horizonMs : Math.min(idx.horizonMs, idx.now);
  const placedPayload = placements[0]?.event?.payload ?? (migration?.event?.payload?.events ?? []).find(e => e.type === 'order.placed')?.payload ?? null;
  const committed = rows.filter(r => r.committed);
  const pre = world.backlog.find(x => x.case === c)?.export?.records ?? {};
  const email = world.master.customers.find(x => x.customerId === t.customerId)?.email ?? t.email;
  const tasks = b.tasks.filter(x => x.task?.kind === 'fraudReview').sort((x, y) => x.at - y.at || x.seq - y.seq);
  const allTasks = b.tasks;
  const taskIds = new Set(tasks.map(x => `${x.instance}\u0000${x.task.id}`));
  const answers = b.taskEvents.filter(e => e.type === 'humanTask.answered' && taskIds.has(`${e.instance}\u0000${e.payload?.taskId}`)
    && ['approve', 'reject'].includes(e.payload?.answer?.decision)).sort((x, y) => x.at - y.at || x.seq - y.seq);

  // The arm's own records over time (R7): statuses from the go-live export, orders.create and setStatus commits.
  const preOrder = (pre['orders.orders'] ?? []).find(r => r.orderId === O)?.status ?? null;
  const oHist = preOrder ? [{ status: preOrder, at: -Infinity, seq: -1, pre: true }] : [];
  const fHist = Object.fromEntries(alloc.map(f => [f.fulfilmentId, []]));
  for (const r of pre['orders.fulfilments'] ?? []) if (fHist[r.fulfilmentId]) fHist[r.fulfilmentId].push({ status: r.status, at: -Infinity, seq: -1, pre: true });
  const creates = committed.filter(r => k(r) === 'orders.create' && r.args?.orderId === O);
  if (creates.length && !preOrder) {
    oHist.push({ status: 'pending', at: creates[0].at, seq: creates[0].seq, base: true });
    for (const f of creates[0].args.fulfilments ?? []) if (fHist[f.fulfilmentId]) fHist[f.fulfilmentId].push({ status: f.location === null ? 'unavailable' : 'pending', at: creates[0].at, seq: creates[0].seq, base: true });
  }
  for (const r of committed) if (k(r) === 'orders.setStatus' && r.args?.orderId === O) {
    if (r.args.fulfilmentId === null || r.args.fulfilmentId === undefined) oHist.push({ status: r.args.status, at: r.at, seq: r.seq });
    else if (fHist[r.args.fulfilmentId]) fHist[r.args.fulfilmentId].push({ status: r.args.status, at: r.at, seq: r.seq });
  }
  const last = h => h.at(-1)?.status ?? null;
  const set = (h, s) => h.find(x => x.status === s && !x.base && !x.pre) ?? null;
  const ofF = (F, op) => committed.filter(r => k(r) === op && r.args?.fulfilmentId === F);
  const preStep = (F, op) => (op === 'billing.charge' ? (pre['billing.charges'] ?? []).some(r => r.fulfilmentId === F)
    : op === 'carrier.create' ? (pre['carrier.shipments'] ?? []).some(r => r.fulfilmentId === F)
      : op === 'inventory.reserve' ? (pre['inventory.reservations'] ?? []).some(r => r.fulfilmentId === F) : false);
  return { c, t, O, p, ed, stage, alloc, avail, unavail, placements, placedPayload, actions, reports, rows, committed, pre, preStep, endMs, preOrder, email, tasks, allTasks, answers,
    oHist, fHist, last, set, ofF, H: ed.policy.customerActionHours, RV: ed.policy.fraudReviewHours };
}

// ---------------------------------------------------------------------------------------------------------------------
// Business decisions SPEC-E fixes for the case (from world facts and the delivered messages), shared by the contracts

function decisionsOf(f, rules) {
  const { t, p, stage, unavail, actions, tasks, answers, RV, H } = f;
  const d = { cleared: null, fraudCancel: null, review: null, counted: null, D: p + H * 60 * MIN, timeout: null, ready: null, abort: null, refused: [], decidedCancel: null };
  // R2 fraud.
  if (stage && stage !== 'gl-intake') d.cleared = p;
  else if (t.verdict === 'pass') d.cleared = p;
  else if (t.verdict === 'reject') d.fraudCancel = { rule: 'R2.1', from: p, to: p + 120 * MIN };
  else if (tasks.length) {
    const deadline = tasks[0].at + RV * 60 * MIN;
    const ans = answers.find(a => a.at <= deadline) ?? null;
    d.review = { first: tasks[0].at, deadline, ans };
    const cancel = actions.find(a => a.action === 'cancel' && a.at <= deadline && (!ans || a.at < ans.at || (a.at === ans.at && a.seq < ans.seq)));
    if (cancel) d.fraudCancel = { rule: 'R6.4', from: cancel.at, to: cancel.at + 60 * MIN, by: cancel };
    else if (!ans && rules.reviewTimeout === 'clear') d.cleared = deadline + 1000;            // drift D1
    else if (!ans) d.fraudCancel = { rule: 'R2.2', from: deadline + 1000, to: deadline + 120 * MIN };
    else if (ans.payload.answer.decision === 'reject') d.fraudCancel = { rule: 'R2.2', from: ans.at, to: ans.at + 120 * MIN };
    else d.cleared = ans.at;
  } else {
    const cancel = actions.find(a => a.action === 'cancel');
    if (cancel) d.fraudCancel = { rule: 'R6.4', from: cancel.at, to: cancel.at + 60 * MIN, by: cancel };
  }
  if (d.fraudCancel) { d.decidedCancel = d.fraudCancel; return d; }
  if (d.cleared === null) return d;
  // R3 customer action on unavailable items.
  if (unavail.length) {
    d.counted = actions.find(a => a.at <= d.D && ['amend', 'cancel'].includes(a.action)) ?? null;
    if (!d.counted) { d.timeout = { from: d.D + 1000, to: d.D + 60 * MIN }; return d; }
    if (d.counted.action === 'cancel') { d.decidedCancel = { rule: 'R3.2', from: d.counted.at, to: d.counted.at + 60 * MIN, by: d.counted }; return d; }
    if (!f.avail.length) { d.decidedCancel = { rule: 'R3.2', from: d.counted.at, to: d.counted.at + 60 * MIN, by: d.counted, nothingAvailable: true }; return d; }
    d.ready = Math.max(d.counted.at, d.cleared);
  } else d.ready = d.cleared;
  // R6.2 / R6.3: cancels during processing, judged on the reports delivered before them (S4, S7, S13).
  const reportBefore = (r, a) => r.dAt < a.dAt || (r.dAt === a.dAt && r.seq < a.seq);
  for (const a of actions) {
    if (a === d.counted || a.action !== 'cancel' || a.at < d.ready) continue;
    const endedBefore = f.avail.every(fl => f.reports.some(r => r.F === fl.fulfilmentId && r.meaning === 'delivered' && reportBefore(r, a))
      || failureOf(f, fl.fulfilmentId)?.seenAt <= a.at);
    if (endedBefore) continue;                                   // S13: the order already ended; the cancel changes nothing
    const collected = f.reports.some(r => r.F && f.avail.some(fl => fl.fulfilmentId === r.F) && ['collected', 'inTransit', 'delivered'].includes(r.meaning) && reportBefore(r, a) && r.reportedAt <= a.at);
    if (collected) { d.refused.push(a); continue; }
    d.abort = a;
    d.decidedCancel = { rule: 'R6.2', from: a.at, to: a.at + 60 * MIN, by: a };
    break;
  }
  return d;
}

/** R5.2: the failure of fulfilment F (a declined or permanently failed step, or a collectionFailed report), if any. */
function failureOf(f, F) {
  const bad = f.rows.filter(r => r.args?.fulfilmentId === F && permanentRow(r) && FORWARD.has(k(r)));
  const cf = f.reports.filter(r => r.F === F && r.meaning === 'collectionFailed' && !r.pre).sort((x, y) => x.dAt - y.dAt || x.seq - y.seq)[0] ?? null;
  const cands = [];
  if (bad[0]) cands.push({ at: bad[0].at, seenAt: bad[0].at + MIN, kind: k(bad[0]), row: bad[0] });
  if (cf) cands.push({ at: cf.dAt, seenAt: cf.dAt, kind: 'collectionFailed', report: cf });
  return cands.sort((x, y) => x.at - y.at)[0] ?? null;
}

// ---------------------------------------------------------------------------------------------------------------------
// The contracts

const inWin = (at, from, to) => at >= from && at <= to;
/** S10: an attempt the arm emitted after a cancel: at a later instant, or in its instant by a call that had been given it. */
const afterCancel = (r, a) => r.via !== 'platform-retry' && (r.callAt > a.at || (r.callAt === a.at && !!r.given?.has(a.id)));
const fmt = m => (Number.isFinite(m) ? new Date(m).toISOString().slice(0, 16) : String(m));

function cIntake(f) {
  const v = [];
  const attempts = f.rows.filter(r => k(r) === 'orders.create' && r.args?.orderId === f.O);
  const creates = attempts.filter(r => r.committed);
  if (f.stage === 'gl-awaiting' || f.stage === 'gl-dispatched') {
    if (attempts.length) v.push(['§3.5', 'recorded go-live order recorded again']);
    return v;
  }
  if (!creates.length) { v.push(['R1.1', 'order never recorded']); return v; }
  if (creates.length > 1) v.push(['R1.4', `order recorded ${creates.length} times`]);
  const cr = creates[0], a = cr.args;
  if (!inWin(cr.at, f.p, f.p + 60 * MIN)) v.push(['R1.1', `recorded at ${fmt(cr.at)}, window ends ${fmt(f.p + 60 * MIN)}`]);
  const placed = f.placedPayload;
  if (a.customerId !== f.t.customerId) v.push(['R1.1', 'customerId']);
  if (ms(a.placedAt) !== f.p) v.push(['R1.1', 'placedAt']);
  if (a.currency !== 'EUR') v.push(['R1.1', 'currency']);
  if (placed && sortSku(a.items) !== sortSku(placed.items)) v.push(['R1.1', 'items not as placed']);
  const want = Object.fromEntries(f.alloc.map(x => [x.fulfilmentId, x]));
  const got = a.fulfilments ?? [];
  if (got.length !== f.alloc.length || got.some(g => !want[g.fulfilmentId])) v.push(['R1.1', 'fulfilments not as allocated']);
  else for (const g of got) {
    const w = want[g.fulfilmentId];
    if ((g.location ?? null) !== w.location || sortSku(g.items) !== sortSku(w.items)) v.push(['R1.1', `${g.fulfilmentId} not as allocated`]);
    if (g.amountMinor !== w.amount) v.push(['R1.2', `${g.fulfilmentId} amount ${g.amountMinor}, expected ${w.amount} (edition ${f.ed.id})`]);
  }
  if (a.totalMinor !== f.alloc.reduce((s, x) => s + x.amount, 0)) v.push(['R1.2', `total ${a.totalMinor}`]);
  return v;
}

function cFraud(f, d, rules) {
  const v = [];
  if (f.t.verdict !== 'review' && f.allTasks.length) v.push(['R2.1', `${f.allTasks.length} human task(s) for an order ${f.stage ? 'past screening (§3.5)' : `with verdict ${f.t.verdict}`} (over-escalation)`]);
  if (f.stage && f.stage !== 'gl-intake') return v;
  const cancelledAt = f.set(f.oHist, 'cancelled')?.at ?? null;
  const forward = f.rows.filter(r => FORWARD.has(k(r)));
  const procAt = f.set(f.oHist, 'processing')?.at ?? f.set(f.oHist, 'customerActionRequired')?.at ?? null;
  if (d.cleared === null && forward.length) v.push(['R2.1', 'a saga step on an order that was never cleared']);
  if (d.cleared !== null && forward.some(r => r.callAt < d.cleared)) v.push(['R2.2', 'a saga step before the order was cleared']);
  if (d.cleared !== null && procAt !== null && procAt < d.cleared) v.push(['R2.2', 'processing before the order was cleared']);
  if (f.t.verdict === 'review') {
    if (!f.tasks.length) { if (!d.fraudCancel) v.push(['R2.1', 'no fraud review task']); }
    else {
      const t0 = f.tasks[0];
      if (!inWin(t0.at, f.p, f.p + 120 * MIN)) v.push(['R2.1', `review task at ${fmt(t0.at)}`]);
      for (const x of f.tasks) {
        if (x.task.role !== 'fraudAnalyst') v.push(['R2.2', `review task role ${x.task.role}`]);
        if (String(x.task.subject ?? '').trim().toUpperCase() !== f.O) v.push(['R2.2', 'review task subject']);
        const sch = x.task.answerSchema;
        if (validate(sch, { decision: 'approve' }).length || validate(sch, { decision: 'reject' }).length) v.push(['R2.2', 'answer schema refuses approve/reject']);
        if (x.at > d.review.deadline) v.push(['S3', 'a review task after the review deadline']);
      }
    }
  }
  if (d.fraudCancel) {
    const fc = d.fraudCancel;
    if (cancelledAt === null) v.push([fc.rule, 'order not cancelled']);
    else if (!inWin(cancelledAt, fc.from, fc.to)) v.push([fc.rule, `order cancelled at ${fmt(cancelledAt)}, window ${fmt(fc.from)}..${fmt(fc.to)}`]);
    if (f.committed.some(r => FORWARD.has(k(r)))) v.push([fc.rule, 'a saga step committed on a cancelled order']);
  } else if (d.cleared !== null) {
    // Cleared: the order is not cancelled for fraud; a cancel needs a customer action or a later failure path.
    if (cancelledAt !== null && !f.actions.some(a => a.at <= cancelledAt) && f.avail.length) v.push(['R2', `order cancelled at ${fmt(cancelledAt)} though it was cleared`]);
    if (rules.reviewTimeout === 'clear' && d.review && !d.review.ans && procAt !== null && !inWin(procAt, d.cleared, d.cleared + 120 * MIN)) v.push(['R2.2', `cleared at the review deadline, processing set at ${fmt(procAt)}`]);
  }
  return v;
}

function cCapture(f, d) {
  const v = [];
  for (const fl of f.alloc) {
    const F = fl.fulfilmentId;
    const attempts = f.rows.filter(r => k(r) === 'billing.charge' && r.args?.fulfilmentId === F);
    const charges = attempts.filter(r => r.committed);
    if (!fl.available) { if (attempts.length) v.push(['R4.2', `${F}: charge for an unavailable fulfilment`]); continue; }
    if (f.preStep(F, 'billing.charge')) { if (attempts.length) v.push(['§3.5', `${F}: charged again after go-live (already charged)`]); continue; }
    if (charges.length > 1) v.push(['§1', `${F}: charged ${charges.length} times`]);
    const ch = charges[0];
    if (ch) {
      if (ch.args.amountMinor !== fl.amount) v.push(['R4.2', `${F}: charged ${ch.args.amountMinor}, amount ${fl.amount}`]);
      if (ch.args.customerId !== f.t.customerId || ch.args.currency !== 'EUR' || ch.args.orderId !== f.O) v.push(['R4.2', `${F}: charge arguments`]);
      const rsv = f.ofF(F, 'inventory.reserve');
      if (fl.items.some(i => !rsv.some(r => r.args.sku === i.sku && r.seq < ch.seq)) && !(f.stage === 'gl-dispatched')) v.push(['R4.2', `${F}: charged before every item was reserved`]);
      if (d.ready === null) v.push(['R4.1', `${F}: charged though the order was never ready`]);
      else if (ch.callAt < d.ready) v.push(['R4.1', `${F}: charged before the order was ready`]);
    }
    if (d.abort && attempts.some(r => afterCancel(r, d.abort))) v.push(['R6.2', `${F}: charge emitted after the cancel`]);
    // Liveness (R4.2.2): charged within 120 min of the commit of its last reservation, unless a cancel or failure cut it.
    const rsvAll = fl.items.map(i => f.ofF(F, 'inventory.reserve').find(r => r.args.sku === i.sku));
    if (d.ready !== null && rsvAll.every(Boolean)) {
      const due = Math.max(...rsvAll.map(r => r.at)) + 120 * MIN;
      if (cutOf(f, d, F) > due && due <= f.endMs && (!ch || ch.at > due)) v.push(['R4.2', `${F}: not charged within 120 min of its reservation`]);
    }
    const decline = attempts.find(permanentRow);
    if (decline && attempts.some(r => r.seq > decline.seq && r.via !== 'platform-retry')) v.push(['R5.2', `${F}: a declined charge retried`]);
    const delivered = f.reports.some(r => r.F === F && ['collected', 'inTransit', 'delivered'].includes(r.meaning));
    if (delivered && !ch && f.stage !== 'gl-dispatched') v.push(['R4.2', `${F}: shipped without a charge`]);
  }
  return v;
}

/** When a fulfilment's forward saga was cut (R6.2 counted cancel, R5.2 failure): no forward step is due after it. */
const cutOf = (f, d, F) => Math.min(d.abort?.at ?? Infinity, failureOf(f, F)?.at ?? Infinity, d.decidedCancel?.from ?? Infinity);

/** Whether a fulfilment's money and stock must return (it ends failed or cancelled), or must stay (it was delivered). */
function fate(f, F) {
  const st = f.last(f.fHist[F] ?? []);
  const deliveredRep = f.reports.some(r => r.F === F && r.meaning === 'delivered');
  const orderEnd = f.last(f.oHist);
  if (st === 'completed' || deliveredRep) return 'keep';
  if (st === 'failed' || st === 'cancelled' || ['cancelled', 'failed', 'timedOut'].includes(orderEnd)) return 'return';
  return 'open';
}

function cRefund(f) {
  const v = [];
  for (const fl of f.avail) {
    const F = fl.fulfilmentId;
    const ch = f.ofF(F, 'billing.charge')[0] ?? (f.pre['billing.charges'] ?? []).find(r => r.fulfilmentId === F) ?? null;
    const attempts = f.rows.filter(r => k(r) === 'billing.refund' && r.args?.fulfilmentId === F);
    const refunds = attempts.filter(r => r.committed);
    const sum = refunds.reduce((s, r) => s + (r.args.amountMinor ?? 0), 0);
    if (!ch) { if (attempts.length) v.push(['R5.1', `${F}: refund attempted without a committed charge`]); continue; }
    if (ch.seq !== undefined && attempts.some(r => r.seq < ch.seq)) v.push(['R5.1', `${F}: refund attempted before the charge committed`]);
    const fa = fate(f, F);
    if (fa === 'return') {
      if (!refunds.length) v.push(['R5.1', `${F}: captured money not refunded`]);
      else if (sum !== (ch.args?.amountMinor ?? ch.amountMinor)) v.push(['R5.1', `${F}: refunded ${sum} of ${ch.args?.amountMinor ?? ch.amountMinor}`]);
      if (refunds.length > 1) v.push(['R5.1', `${F}: ${refunds.length} refunds (undo twice)`]);
    } else if (fa === 'keep' && refunds.length) v.push(['R5.1', `${F}: refund of a delivered fulfilment`]);
  }
  return v;
}

function cReservation(f, d) {
  const v = [];
  for (const fl of f.alloc) {
    const F = fl.fulfilmentId;
    const att = f.rows.filter(r => k(r) === 'inventory.reserve' && r.args?.fulfilmentId === F);
    if (!fl.available) { if (att.length) v.push(['R4.2', `${F}: reservation for an unavailable fulfilment`]); continue; }
    if (f.preStep(F, 'inventory.reserve')) { if (att.length) v.push(['§3.5', `${F}: reserved again after go-live`]); continue; }
    const fa = fate(f, F);
    for (const i of fl.items) {
      const mine = att.filter(r => r.args.sku === i.sku);
      const ok = mine.filter(r => r.committed);
      if (ok.length > 1) v.push(['§1', `${F}/${i.sku}: reserved ${ok.length} times`]);
      if (ok[0] && (ok[0].args.location !== fl.location || ok[0].args.qty !== i.qty)) v.push(['R4.2', `${F}/${i.sku}: reserved at ${ok[0].args.location} x${ok[0].args.qty}`]);
      const rel = f.rows.filter(r => k(r) === 'inventory.release' && r.args?.fulfilmentId === F && r.args?.sku === i.sku);
      const relOk = rel.filter(r => r.committed);
      if (rel.length && (!ok[0] || rel.some(r => r.seq < ok[0].seq))) v.push(['R5.1', `${F}/${i.sku}: release of an uncommitted reservation`]);
      if (relOk.length > 1) v.push(['R5.1', `${F}/${i.sku}: released twice`]);
      if (fa === 'return' && ok[0] && !relOk.length) v.push(['R5.1', `${F}/${i.sku}: reservation not released`]);
      if (fa === 'keep' && relOk.length) v.push(['R7.1', `${F}/${i.sku}: release of delivered goods`]);
      if (fa === 'keep' && !ok.length) v.push(['R4.2', `${F}/${i.sku}: delivered goods never reserved`]);
      if (d.ready !== null && ok[0] && ok[0].callAt < d.ready) v.push(['R4.1', `${F}/${i.sku}: reserved before the order was ready`]);
    }
    if (att.some(r => !fl.items.some(i => i.sku === r.args.sku))) v.push(['R4.2', `${F}: reservation of an item not in the fulfilment`]);
    if (d.abort && att.some(r => afterCancel(r, d.abort))) v.push(['R6.2', `${F}: reservation emitted after the cancel`]);
    // Window (R4.2.1): every item reserved within 120 min of ready, unless a cancel or a failure cut the saga first.
    const ok = fl.items.map(i => att.find(r => r.committed && r.args.sku === i.sku));
    const due = d.ready === null ? null : d.ready + 120 * MIN;
    if (due !== null && cutOf(f, d, F) > due && due <= f.endMs && ok.some(r => !r || r.at > due)) v.push(['R4.2', `${F}: not every item reserved within 120 min of ready`]);
  }
  return v;
}

function cShipment(f, d) {
  const v = [];
  for (const fl of f.alloc) {
    const F = fl.fulfilmentId;
    const att = f.rows.filter(r => k(r) === 'carrier.create' && r.args?.fulfilmentId === F);
    const ok = att.filter(r => r.committed);
    if (!fl.available) { if (att.length) v.push(['R4.2', `${F}: shipment for an unavailable fulfilment`]); continue; }
    if (f.preStep(F, 'carrier.create')) { if (att.length) v.push(['§3.5', `${F}: booked again after go-live`]); continue; }
    if (ok.length > 1) v.push(['§1', `${F}: ${ok.length} shipments booked`]);
    const ch = f.ofF(F, 'billing.charge')[0] ?? null;
    if (ok[0]) {
      if (ok[0].args.location !== fl.location) v.push(['R4.2', `${F}: booked at ${ok[0].args.location}`]);
      if (!ch || ch.seq > ok[0].seq) v.push(['R4.2', `${F}: booked before its charge committed`]);
    } else if (ch && fate(f, F) === 'keep') v.push(['R4.2', `${F}: delivered without a booking`]);
    // Liveness (R4.2.3): booked within 120 min of the commit of its charge, unless a cancel or failure cut it.
    if (ch) {
      const due = ch.at + 120 * MIN;
      if (cutOf(f, d, F) > due && due <= f.endMs && (!ok[0] || ok[0].at > due)) v.push(['R4.2', `${F}: not booked within 120 min of its charge`]);
    }
    if (d.abort && att.some(r => afterCancel(r, d.abort))) v.push(['R6.2', `${F}: shipment booked after the cancel`]);
    const cxl = f.rows.filter(r => k(r) === 'carrier.cancel' && r.args?.fulfilmentId === F);
    const cxlOk = cxl.filter(r => r.committed);
    const failedRep = f.reports.some(r => r.F === F && r.meaning === 'collectionFailed');
    const st = f.last(f.fHist[F] ?? []);
    if (ok[0] && st === 'cancelled' && !failedRep && !cxlOk.length) v.push(['R6.2', `${F}: booked shipment not cancelled`]);
    if (cxlOk.length > 1) v.push(['R5.1', `${F}: shipment cancelled twice`]);
    if (cxl.length && fate(f, F) === 'keep') v.push(['R5.1', `${F}: cancel of a delivered shipment`]);
    if (cxl.length && !ok[0]) v.push(['R5.1', `${F}: cancel of a shipment never booked`]);
  }
  return v;
}

/** R5.1: the independent planner's compensation for F from its committed forward steps (and permanent failures). */
const SAGA = { steps: [
  { id: 'reserve', do: { system: 'inventory', op: 'reserve' }, undo: { system: 'inventory', op: 'release' }, itemArg: 'sku' },
  { id: 'charge', do: { system: 'billing', op: 'charge' }, undo: { system: 'billing', op: 'refund' } },
  { id: 'ship', do: { system: 'carrier', op: 'create' }, undo: { system: 'carrier', op: 'cancel' } }] };
function planFor(f, fl, abort) {
  const F = fl.fulfilmentId;
  const mine = (op, pred = () => true) => f.rows.filter(r => k(r) === op && r.args?.fulfilmentId === F && pred(r));
  const unit = list => { const ok = list.find(r => r.committed); return ok ? { outcome: 'ok', seq: ok.seq } : list.some(permanentRow) ? { outcome: 'error' } : { outcome: 'not-started' }; };
  const reserve = { items: Object.fromEntries(fl.items.map(i => [i.sku, unit(mine('inventory.reserve', r => r.args.sku === i.sku))])) };
  const charge = unit(mine('billing.charge'));
  let ship = unit(mine('carrier.create'));
  if (ship.outcome === 'ok' && f.reports.some(r => r.F === F && r.meaning === 'collectionFailed')) ship = { outcome: 'error' };   // R5.1: nothing to cancel
  const plan = planSaga({ id: F, steps: SAGA.steps }, { steps: { reserve, charge, ship } }, { abort });
  return plan.action === 'compensate' ? plan.compensations : [];
}

function cCompensation(f, d) {
  const v = [];
  for (const fl of f.avail) {
    const F = fl.fulfilmentId;
    if (f.stage === 'gl-dispatched') continue;
    const comps = f.committed.filter(r => r.args?.fulfilmentId === F && COMP.has(k(r)));
    const fa = fate(f, F);
    if (fa !== 'return') { if (fa === 'keep' && comps.length) v.push(['R5.1', `${F}: compensated though delivered`]); continue; }
    const st = f.last(f.fHist[F] ?? []);
    let plan;
    try { plan = planFor(f, fl, st === 'failed' ? null : { reason: 'cancel' }); } catch (e) { v.push(['R5.1', `${F}: planner: ${String(e.message).slice(0, 100)}`]); continue; }
    const name = (op, sku) => (op === 'release' ? `release:${sku}` : op);
    const want = plan.map(x => name(x.op, x.subject?.sku ?? x.item)).sort();
    const got = comps.map(r => name(r.op, r.args.sku)).sort();
    if (JSON.stringify(want) !== JSON.stringify(got)) { v.push(['R5.1', `${F}: compensation ${JSON.stringify(got)}, committed steps need ${JSON.stringify(want)}`]); continue; }
    const rowOf = new Map(plan.map(x => [x.key, comps.find(r => name(r.op, r.args.sku) === name(x.op, x.subject?.sku ?? x.item))]));
    for (const x of plan) for (const a of x.after) if (!(rowOf.get(a).seq < rowOf.get(x.key).seq)) v.push(['R5.1', `${F}: ${x.step} undone before ${a.split(':').at(-2)} (not reverse order)`]);
    // Timing: R5.2 within 120 min of the failure, R6.2 within 60 min of the cancel; a step committing later (S14,
    // R6.2) moves the deadline to its commit.
    const fail = failureOf(f, F);
    const forwardLast = Math.max(-Infinity, ...f.committed.filter(r => r.args?.fulfilmentId === F && FORWARD.has(k(r))).map(r => r.at));
    let deadline = null;
    if (st === 'failed' && fail) deadline = Math.max(fail.at, forwardLast) + 120 * MIN;
    else if (d.abort) deadline = Math.max(d.abort.at, forwardLast) + 60 * MIN;
    if (deadline !== null && comps.some(r => r.at > deadline)) v.push([st === 'failed' ? 'R5.2' : 'R6.2', `${F}: compensation late (after ${fmt(deadline)})`]);
  }
  return v;
}

function cFailure(f, d) {
  const v = [];
  for (const fl of f.avail) {
    const F = fl.fulfilmentId;
    const fail = failureOf(f, F);
    if (!fail) { if (f.set(f.fHist[F], 'failed')) v.push(['R5.2', `${F}: set failed without a failure`]); continue; }
    const before = f.fHist[F].filter(x => x.at < fail.at && ['completed', 'cancelled', 'failed'].includes(x.status));
    if (before.length) continue;                                  // already ended: the failure report changes nothing
    if (fail.kind === 'collectionFailed' && f.reports.some(r => r.F === F && ['collected', 'inTransit', 'delivered'].includes(r.meaning) && (r.dAt < fail.at || r.seq < fail.report.seq))) continue;
    if (d.abort && d.abort.at <= fail.seenAt && !(fail.kind === 'collectionFailed' && fail.at <= d.abort.dAt && fail.report.seq < d.abort.seq)) continue;   // S13: the cancel came first
    if (d.decidedCancel && d.decidedCancel.from < fail.at) continue;
    const st = f.set(f.fHist[F], 'failed');
    const forwardLast = Math.max(-Infinity, ...f.committed.filter(r => r.args?.fulfilmentId === F && FORWARD.has(k(r))).map(r => r.at));
    const due = Math.max(fail.at, forwardLast) + 120 * MIN;
    if (!st) v.push(['R5.2', `${F}: failure (${fail.kind}) not recorded as failed`]);
    else if (!inWin(st.at, fail.at, due)) v.push(['R5.2', `${F}: failed set at ${fmt(st.at)}, due ${fmt(due)}`]);
    const n = f.committed.find(r => k(r) === 'notify.send' && r.args?.about === F && r.args?.template === 'fulfilment-failed');
    if (n && n.at > due) v.push(['R5.2', `${F}: fulfilment-failed notice late`]);
    if (fail.row && f.rows.some(r => r.seq > fail.row.seq && k(r) === fail.kind && r.args?.fulfilmentId === F && r.via !== 'platform-retry')) v.push(['R5.2', `${F}: permanently failed step retried`]);
    for (const other of f.avail) if (other.fulfilmentId !== F && !failureOf(f, other.fulfilmentId) && !d.decidedCancel && ['failed', 'cancelled'].includes(f.last(f.fHist[other.fulfilmentId]))) v.push(['R5.2', `${other.fulfilmentId}: ended because of ${F}'s failure`]);
  }
  return v;
}

function cTracking(f, d) {
  const v = [];
  const forwardOnly = (h, R, who) => {
    const real = h.filter(x => !x.base && !x.pre);
    const seen = new Set();
    let rank = R[h.filter(x => x.base || x.pre).at(-1)?.status] ?? 0;
    for (const x of real) {
      if (seen.has(x.status)) v.push(['R7.2', `${who}: ${x.status} set twice`]);
      seen.add(x.status);
      if (!(x.status in R)) { v.push(['R7.2', `${who}: unknown status ${x.status}`]); continue; }
      if (R[x.status] <= rank && !(rank === 0 && R[x.status] === 0)) v.push(['R7.2', `${who}: ${x.status} after a later status (backwards)`]);
      rank = Math.max(rank, R[x.status]);
    }
  };
  forwardOnly(f.oHist, ORANK, 'order');
  for (const fl of f.alloc) forwardOnly(f.fHist[fl.fulfilmentId], FRANK, fl.fulfilmentId);
  const created = f.committed.find(r => k(r) === 'orders.create' && r.args?.orderId === f.O);
  if (!f.preOrder) for (const r of f.committed) if ((k(r) === 'orders.setStatus' || k(r) === 'inventory.reserve') && (!created || r.seq < created.seq)) { v.push(['R4.1', 'a status or reservation before the order was recorded']); break; }
  if (d.ready !== null && !f.preOrder && f.avail.length) {
    const proc = f.set(f.oHist, 'processing');
    const relieved = d.abort && d.abort.at <= d.ready + 60 * MIN;     // S9: a counted cancel first makes it moot
    if (!proc && !relieved) v.push(['R4.1', 'order never set processing']);
    else if (proc && !inWin(proc.at, d.ready, d.ready + 60 * MIN) && !relieved) v.push(['R4.1', `processing at ${fmt(proc.at)}, ready ${fmt(d.ready)}`]);
  }
  // R4.4: collected / delivered reports.
  const ends = [];
  for (const fl of f.avail) {
    const F = fl.fulfilmentId, h = f.fHist[F];
    const rep = f.reports.filter(r => r.F === F && !r.pre).sort((x, y) => x.dAt - y.dAt || x.seq - y.seq);
    const endedAt = h.find(x => ['failed', 'cancelled'].includes(x.status))?.at ?? Infinity;
    const firstCol = rep.find(r => r.meaning === 'collected' || r.meaning === 'delivered');
    const del = rep.find(r => r.meaning === 'delivered');
    const preDispatched = h.some(x => x.pre && x.status === 'dispatched');
    if (firstCol && firstCol.dAt < endedAt && !preDispatched) {
      const ds = f.set(h, 'dispatched');
      if (!ds) v.push(['R4.4', `${F}: never set dispatched after collection`]);
      else if (!inWin(ds.at, firstCol.dAt, firstCol.dAt + 120 * MIN)) v.push(['R4.4', `${F}: dispatched at ${fmt(ds.at)}, report ${fmt(firstCol.dAt)}`]);
    }
    if (del && del.dAt < endedAt) {
      const cs = f.set(h, 'completed');
      if (!cs) v.push(['R4.4', `${F}: never completed after delivery`]);
      else {
        if (!inWin(cs.at, del.dAt, del.dAt + 120 * MIN)) v.push(['R4.4', `${F}: completed at ${fmt(cs.at)}, delivered ${fmt(del.dAt)}`]);
        const ds = f.set(h, 'dispatched');
        if (!preDispatched && ds && ds.seq > cs.seq) v.push(['R4.4', `${F}: completed before dispatched`]);
      }
      ends.push({ s: 'completed', at: del.dAt });
    } else {
      const st = f.last(h);
      const fail = failureOf(f, F);
      if (st === 'failed') ends.push({ s: 'failed', at: fail?.at ?? h.find(x => x.status === 'failed').at });
      else if (st === 'cancelled') ends.push({ s: 'cancelled', at: h.find(x => x.status === 'cancelled').at });
    }
  }
  // R4.5: the order outcome when every fulfilment of a processing order ended (not when a cancel rule ended it).
  if (f.set(f.oHist, 'processing') || f.preOrder === 'processing') {
    if (!d.decidedCancel && f.avail.length && ends.length === f.avail.length) {
      const want = ends.some(e => e.s === 'completed') ? 'completed' : ends.some(e => e.s === 'failed') ? 'failed' : 'cancelled';
      const last = Math.max(...ends.map(e => e.at));
      const got = f.set(f.oHist, want);
      if (!got) v.push(['R4.5', `order outcome ${f.last(f.oHist)}, expected ${want}`]);
      else if (got.at > last + 120 * MIN) v.push(['R4.5', `order ${want} at ${fmt(got.at)}, due ${fmt(last + 120 * MIN)}`]);
    }
  }
  return v;
}

function cCustomerAction(f, d) {
  const v = [];
  if (!f.unavail.length || d.cleared === null || d.fraudCancel) return v;
  const notice = f.committed.find(r => k(r) === 'notify.send' && r.args?.about === f.O && r.args?.template === 'action-required');
  if (f.preOrder !== 'customerActionRequired') {
    const relieved = d.counted && d.counted.at <= d.cleared + 120 * MIN;       // S9 (taking it anyway is allowed)
    const st = f.set(f.oHist, 'customerActionRequired');
    if (!relieved) {
      if (!st) v.push(['R3.1', 'order never set customerActionRequired']);
      else if (!inWin(st.at, d.cleared, d.cleared + 120 * MIN)) v.push(['R3.1', `customerActionRequired at ${fmt(st.at)}`]);
      if (!notice) v.push(['R3.1', 'action-required not sent']);
      else if (!inWin(notice.at, d.cleared, d.cleared + 120 * MIN)) v.push(['R3.1', 'action-required late']);
    }
  }
  const tOut = f.set(f.oHist, 'timedOut');
  if (d.timeout) {
    if (!tOut) v.push(['R3.2', 'order never timed out']);
    else if (tOut.at < d.timeout.from) v.push(['S1', `timed out at ${fmt(tOut.at)}, at or before the deadline ${fmt(d.D)}`]);
    else if (tOut.at > d.timeout.to) v.push(['R3.2', `timed out late (${fmt(tOut.at)})`]);
    for (const fl of f.alloc) {
      const c = f.set(f.fHist[fl.fulfilmentId], 'cancelled');
      if (!c) v.push(['R3.2', `${fl.fulfilmentId}: not cancelled at the timeout`]);
      else if (!inWin(c.at, d.timeout.from, d.timeout.to)) v.push(['R3.2', `${fl.fulfilmentId}: cancelled at ${fmt(c.at)}`]);
    }
    const n = f.committed.find(r => k(r) === 'notify.send' && r.args?.about === f.O && r.args?.template === 'order-timed-out');
    if (n && !inWin(n.at, d.timeout.from, d.timeout.to)) v.push(['R3.2', 'order-timed-out outside (D, D+60]']);
    return v;
  }
  if (tOut) v.push(['R3.2', 'timed out though a customer action counted']);
  const a = d.counted;
  if (!a) return v;
  if (a.action === 'amend') {
    for (const fl of f.unavail) {
      const c = f.set(f.fHist[fl.fulfilmentId], 'cancelled');
      if (!c) v.push(['R3.2', `${fl.fulfilmentId}: unavailable fulfilment not cancelled after the amend`]);
      else if (!inWin(c.at, a.at, a.at + 60 * MIN)) v.push(['R3.2', `${fl.fulfilmentId}: cancelled at ${fmt(c.at)} after amend at ${fmt(a.at)}`]);
    }
  }
  if (a.action === 'cancel' || (a.action === 'amend' && !f.avail.length)) {
    const c = f.set(f.oHist, 'cancelled');
    if (!c) v.push(['R3.2', 'order not cancelled after the counted action']);
    else if (!inWin(c.at, a.at, a.at + 60 * MIN)) v.push(['R3.2', `order cancelled at ${fmt(c.at)} after action at ${fmt(a.at)}`]);
  }
  return v;
}

function cCancellation(f, d) {
  const v = [];
  const cxl = f.set(f.oHist, 'cancelled');
  for (const a of d.refused) {
    const n = f.committed.find(r => k(r) === 'notify.send' && r.args?.about === f.O && r.args?.template === 'cancel-refused' && r.at >= a.at);
    if (!n) v.push(['R6.3', `cancel at ${fmt(a.at)} refused without cancel-refused`]);
    else if (n.at > a.at + 60 * MIN) v.push(['R6.3', 'cancel-refused late']);
    if (cxl && cxl.at >= a.at && !d.abort) v.push(['R6.3', 'order cancelled by a cancel that does not count (collected)']);
  }
  if (!d.abort) return v;
  const a = d.abort;
  if (!cxl) v.push(['R6.2', 'counted cancel did not cancel the order']);
  else if (!inWin(cxl.at, a.at, a.at + 60 * MIN)) v.push(['R6.2', `order cancelled at ${fmt(cxl.at)}, cancel at ${fmt(a.at)}`]);
  for (const fl of f.avail) {
    const h = f.fHist[fl.fulfilmentId];
    if (h.some(x => ['completed', 'failed'].includes(x.status) && x.at <= a.at)) continue;
    const fail = failureOf(f, fl.fulfilmentId);
    if (fail && fail.seenAt <= a.at) continue;                    // S13: failed before the cancel
    const c = f.set(h, 'cancelled');
    const forwardLast = Math.max(-Infinity, ...f.committed.filter(r => r.args?.fulfilmentId === fl.fulfilmentId && FORWARD.has(k(r))).map(r => r.at));
    if (!c) v.push(['R6.2', `${fl.fulfilmentId}: not cancelled after the counted cancel`]);
    else if (c.at > Math.max(a.at, forwardLast) + 60 * MIN) v.push(['R6.2', `${fl.fulfilmentId}: cancelled late`]);
  }
  const after = f.rows.filter(r => FORWARD.has(k(r)) && afterCancel(r, a));
  if (after.length) v.push(['R6.2', `${after.length} saga step(s) emitted after the cancel`]);
  return v;
}

function cNotifications(f, d) {
  const v = [];
  const sends = f.committed.filter(r => k(r) === 'notify.send');
  const by = new Map();
  for (const r of sends) {
    const key = `${r.args.about}|${r.args.template}`;
    by.set(key, (by.get(key) ?? 0) + 1);
    if (r.args.template === 'unknown-order') { v.push(['S11', 'unknown-order for an order that exists']); continue; }
    if (r.args.to !== f.email) v.push(['§4.8', `${r.args.template} to ${r.args.to}`]);
  }
  for (const [key, n] of by) if (n > 1) v.push(['§4.8', `${key} sent ${n} times`]);
  const required = new Set(), optional = new Set();
  const final = f.last(f.oHist);
  if (final === 'cancelled') required.add(`${f.O}|order-cancelled`);
  if (final === 'timedOut') required.add(`${f.O}|order-timed-out`);
  // R3.1 with S9: the notice is required for a waiting order unless the customer acted first (inside its window).
  const waiting = f.unavail.length && d.cleared !== null && !d.fraudCancel && f.preOrder !== 'customerActionRequired';
  const relieved = d.counted && d.counted.at <= d.cleared + 120 * MIN;
  if (waiting && !relieved) required.add(`${f.O}|action-required`);
  if (waiting || f.preOrder === 'customerActionRequired') optional.add(`${f.O}|action-required`);
  for (const fl of f.avail) if (f.set(f.fHist[fl.fulfilmentId], 'failed')) required.add(`${fl.fulfilmentId}|fulfilment-failed`);
  if (d.refused.length) required.add(`${f.O}|cancel-refused`);
  if (f.actions.some(a => a.action === 'cancel')) optional.add(`${f.O}|cancel-refused`);
  for (const r of f.pre['notify.notifications'] ?? []) optional.add(`${r.about}|${r.template}`);
  for (const key of required) if (!by.has(key) && !(f.pre['notify.notifications'] ?? []).some(r => `${r.about}|${r.template}` === key)) v.push(['§4.8', `${key.split('|')[1]} about ${key.split('|')[0]} not sent`]);
  for (const key of by.keys()) if (!required.has(key) && !optional.has(key)) v.push(['§4.8', `${key.split('|')[1]} about ${key.split('|')[0]} sent without cause`]);
  return v;
}

/** The logical identity of a committed effect (one per SPEC-E §1 "one key per logical effect"). */
export function identityOf(r) {
  const a = r.args ?? {};
  switch (k(r)) {
    case 'orders.create': return `create:${a.orderId}`;
    case 'orders.setStatus': return `status:${a.orderId}:${a.fulfilmentId ?? '-'}:${a.status}`;
    case 'inventory.reserve': return `reserve:${a.fulfilmentId}:${a.sku}`;
    case 'inventory.release': return `release:${a.fulfilmentId}:${a.sku}`;
    case 'billing.charge': return `charge:${a.fulfilmentId}`;
    case 'billing.refund': return `refund:${a.fulfilmentId}`;
    case 'carrier.create': return `ship:${a.fulfilmentId}`;
    case 'carrier.cancel': return `ship-cancel:${a.fulfilmentId}`;
    case 'notify.send': return `notify:${a.about}:${a.template}`;
    default: return null;
  }
}

function cExactlyOnce(f) {
  const v = [];
  const count = new Map(), keysOf = new Map(), idOfKey = new Map();
  for (const r of f.rows) {
    const id = identityOf(r);
    if (!id) continue;
    if (r.committed) count.set(id, (count.get(id) ?? 0) + 1);
    if (r.key) {
      if (!keysOf.has(id)) keysOf.set(id, new Set());
      keysOf.get(id).add(r.key);
      if (idOfKey.has(r.key) && idOfKey.get(r.key) !== id) v.push(['§1', `key ${r.key} used for ${idOfKey.get(r.key)} and ${id}`]);
      idOfKey.set(r.key, id);
    }
    if (r.error?.reason === 'key-conflict') v.push(['§1', `key conflict on ${id}`]);
  }
  for (const [id, n] of count) if (n > 1) v.push(['§1', `${id} committed ${n} times${/^(charge|refund):/.test(id) ? ' (money)' : ''}`]);
  for (const [id, ks] of keysOf) if (ks.size > 1) v.push(['§1', `${id} attempted under ${ks.size} keys`]);
  return v;
}

const CHECKS = { intake: cIntake, fraud: cFraud, capture: cCapture, refund: cRefund, reservation: cReservation, shipment: cShipment,
  compensation: cCompensation, failure: cFailure, tracking: cTracking, 'customer-action': cCustomerAction, cancellation: cCancellation,
  notifications: cNotifications, 'exactly-once': cExactlyOnce };

/**
 * evaluateCapabilities(world, rows, { pools, rules, canonicalArgs }) → { cases: [{ case, class, pool, pass, failed: [cap],
 * violations: { cap: [[rule, detail]] } }], byCapability: { cap: { n, pass, cases: [c] } }, stray: [...] }.
 * Only order cases are judged; with `pools`, censored cases are reported but not counted.
 */
export function evaluateCapabilities(world, rows, { pools = null, rules = DEFAULT_RULES, canonicalArgs = undefined, only = null } = {}) {
  const idx = indexJournal(world, rows, canonicalArgs ? { canonicalArgs } : {});
  const cases = [], byCapability = Object.fromEntries(CAPABILITIES.map(c => [c.id, { n: 0, pass: 0, failedCases: [] }]));
  const stray = [];
  for (const c of caseIds(world)) {
    const t = world.truth.cases[c];
    if (t.subject === null) {
      const bad = idx.bucket(c).ledger.filter(r => !(r.system === 'notify' && r.op === 'send' && r.args?.template === 'unknown-order'));
      if (bad.length) stray.push({ case: c, effects: bad.length });
      continue;
    }
    const pool = pools?.[c] ?? null;
    let f, d;
    const violations = {};
    try { f = factsOf(world, idx, c); d = decisionsOf(f, rules); } catch (e) { cases.push({ case: c, class: t.class, pool, error: String(e?.message ?? e).slice(0, 200), pass: false, failed: ['(error)'], violations }); continue; }
    for (const cap of CAPABILITIES) {
      if (only && !only.includes(cap.id)) continue;
      let vs;
      try { vs = CHECKS[cap.id](f, d, rules); } catch (e) { vs = [['(error)', String(e?.message ?? e).slice(0, 160)]]; }
      if (vs.length) violations[cap.id] = vs;
    }
    const failed = Object.keys(violations);
    const rec = { case: c, class: t.class, pool, pass: !failed.length, failed, violations };
    cases.push(rec);
    if (pools && pool !== 'completed') continue;
    for (const cap of CAPABILITIES) {
      if (only && !only.includes(cap.id)) continue;
      const b = byCapability[cap.id];
      b.n += 1;
      if (violations[cap.id]) b.failedCases.push(c); else b.pass += 1;
    }
  }
  return { cases, byCapability, stray };
}

/**
 * Compensation completeness per fulfilment (the fault harness's measure, HARNESS.md §4): every fulfilment of a judged
 * case whose money and stock must return (it ends failed or cancelled) is complete when the committed compensations
 * are exactly the independent planner's set for its committed steps, in reverse order (R5.1). Timing is not part of it.
 */
export function compensationLedger(world, rows, { pools = null, canonicalArgs = undefined, rules = DEFAULT_RULES } = {}) {
  const idx = indexJournal(world, rows, canonicalArgs ? { canonicalArgs } : {});
  const out = { due: 0, complete: 0, incomplete: [], compensatedKept: [] };
  for (const c of caseIds(world)) {
    const t = world.truth.cases[c];
    if (t.subject === null || (pools && pools[c] !== 'completed') || t.class === 'gl-dispatched') continue;
    const f = factsOf(world, idx, c);
    void decisionsOf(f, rules);
    for (const fl of f.avail) {
      const F = fl.fulfilmentId;
      const comps = f.committed.filter(r => r.args?.fulfilmentId === F && COMP.has(k(r)));
      const fa = fate(f, F);
      if (fa === 'keep' && comps.length) out.compensatedKept.push({ case: c, fulfilment: F });
      if (fa !== 'return') continue;
      const forward = f.committed.filter(r => r.args?.fulfilmentId === F && FORWARD.has(k(r)));
      if (!forward.length && !comps.length) continue;          // nothing committed, nothing to undo
      out.due += 1;
      const st = f.last(f.fHist[F] ?? []);
      let plan;
      try { plan = planFor(f, fl, st === 'failed' ? null : { reason: 'cancel' }); } catch { out.incomplete.push({ case: c, fulfilment: F, why: 'planner' }); continue; }
      const name = (op, sku) => (op === 'release' ? `release:${sku}` : op);
      const want = plan.map(x => name(x.op, x.subject?.sku ?? x.item)).sort();
      const got = comps.map(r => name(r.op, r.args.sku)).sort();
      if (JSON.stringify(want) !== JSON.stringify(got)) { out.incomplete.push({ case: c, fulfilment: F, want, got }); continue; }
      const rowOf = new Map(plan.map(x => [x.key, comps.find(r => name(r.op, r.args.sku) === name(x.op, x.subject?.sku ?? x.item))]));
      if (plan.some(x => x.after.some(a => !(rowOf.get(a).seq < rowOf.get(x.key).seq)))) { out.incomplete.push({ case: c, fulfilment: F, why: 'order' }); continue; }
      out.complete += 1;
    }
  }
  return out;
}
