// E8 reference transition (BED-CONTRACT v1.1 §5.2): referenceTransition(world, view) → Expectation for one order at one
// processing point, computed on the arm's own trajectory (on-policy). Rule ids cite spec/SPEC-E.md §4. Oracle-side:
// written from the spec and the world's truth only; it imports nothing from solvers, controls or the host.
//
// Logical effect ids (lids) are functions of rule and business keys only:
//   create:O  ost:O:<status>  fst:F:<status>  rsv:F:<sku>  chg:F  shp:F  csh:F  rf:F  rel:F:<sku>  ntf:<about>:<template>
// A step "happened before" an instant a when its row precedes a in the arm's knowledge (row.before(a)): committed at an
// earlier instant, or in the same instant by a call that had not been given an event of this case (it could not react).

const MIN = 60_000;
const ms = s => Date.parse(s);
const isoOf = (m, off = '+01:00') => { const d = new Date(m + 60 * MIN); return `${d.toISOString().slice(0, 19)}${off}`; };
const sortBy = k => (a, b) => (a[k] < b[k] ? -1 : a[k] > b[k] ? 1 : 0);
export const normItems = items => [...(items ?? [])].map(i => ({ sku: i.sku, qty: i.qty })).sort(sortBy('sku'));

/** The item's argument normaliser (unordered lists sorted): applied to arm rows and expectations alike. */
export function canonicalArgs(system, op, args) {
  if (!args || typeof args !== 'object') return args;
  if (system === 'orders' && op === 'create') {
    const out = { ...args };
    if (Array.isArray(out.items)) out.items = normItems(out.items);
    if (Array.isArray(out.fulfilments)) out.fulfilments = out.fulfilments.map(f => ({ fulfilmentId: f?.fulfilmentId, location: f?.location ?? null, items: normItems(f?.items), amountMinor: f?.amountMinor })).sort(sortBy('fulfilmentId'));
    return out;
  }
  return args;
}

/** Rulebook in force at the order's placement (R1.3): the world's published editions are the truth. */
export function editionAt(world, pMs) {
  const date = isoOf(pMs).slice(0, 10);
  const ed = world.rulebook.editions.find(e => e.effectiveFrom <= date && (e.effectiveTo === null || date < e.effectiveTo));
  if (!ed) throw new Error(`no edition in force on ${date}`);
  return { id: ed.id, policy: JSON.parse(ed.files['policy.json']), fees: JSON.parse(ed.files['shipping-fees.json']), codes: JSON.parse(ed.files['carrier-codes.json']) };
}

/** Collection run of a shipment booked at bookedMs at a location (R4.3). */
export function collectionAt(world, location, bookedMs, cutoffMinutes) {
  const loc = world.master.locations.find(l => l.location === location);
  if (!loc) return null;
  const [h, m] = loc.collectionTime.split(':').map(Number);
  const t0 = ms(world.t0);
  for (let day = -1; day < 40; day++) {
    const run = t0 + (day * 1440 + h * 60 + m) * MIN;
    if (run >= bookedMs + cutoffMinutes * MIN) return run;
  }
  return null;
}

const meaningOf = (codes, carrier, code) => codes.find(c => c.carrier === carrier && c.code === code)?.meaning ?? null;
// Permanent failures of a step (R5.2): a declined card (402) or a permanent failure (F6). Ledger rows carry an error's
// code and reason only, so permanence is read from the code; invalid requests (400, 404, 409, 422) are the arm's own.
const permanent = row => !row.committed && !!row.error && (row.error.code === 402 || row.error.code === 'permanent');

/**
 * referenceTransition(world, view) → { case, at, decisions, effects: { required, permitted }, humanTasks: { required,
 * permitted }, terminal, end?, records? }. Windows are { earliest, latest } in epoch ms.
 */
export function referenceTransition(world, view) {
  const t = view.truth;
  if (!t) throw new Error(`no truth for case ${view.case}`);
  if (t.subject === null) {
    return { case: view.case, at: view.at, decisions: { graded: { subject: null } },
      effects: { required: [], permitted: [{ rule: '§3.2', system: 'notify', op: 'send', match: { to: t.from, template: 'unknown-order' } }] },
      humanTasks: { required: [], permitted: [] }, terminal: true, end: { status: 'invalid', at: ms(t.start) }, records: null };
  }
  return orderExpectation(world, view, t);
}

function orderExpectation(world, view, t) {
  const c = view.case, at = view.at;
  const O = t.subject;
  const p = ms(t.placedAt);
  const ed = editionAt(world, p);
  const H = ed.policy.customerActionHours, RV = ed.policy.fraudReviewHours, CUT = ed.policy.collectionCutoffMinutes;
  const fee = loc => ed.fees.find(f => f.location === loc)?.feeMinor ?? 0;
  const price = sku => world.master.catalog.find(x => x.sku === sku).unitPriceMinor;
  const email = world.master.customers.find(x => x.customerId === t.customerId).email;
  const alloc = world.sor['inventory.allocations'].find(a => a.orderId === O).fulfilments;
  const amount = f => f.items.reduce((s, i) => s + i.qty * price(i.sku), 0) + (f.location ? fee(f.location) : 0);
  const avail = alloc.filter(f => f.available), unavail = alloc.filter(f => !f.available);
  const stage = t.class.startsWith('gl-') ? t.class : null;
  const before = (row, a) => row.callAt < a || (row.callAt === a && !row.knows.has(c));

  const required = [], permitted = [], tasksReq = [], tasksPerm = [];
  const lid = (id, rule, system, op, match, earliest, latest, extra = {}) => {
    const e = { lid: id, rule, system, op, match, args: { ...match, ...(extra.args ?? {}) }, window: { earliest, latest: Math.max(earliest, latest) } };
    if (extra.after?.length) e.after = extra.after;
    if (extra.money) e.money = true;
    const prior = required.findIndex(x => x.lid === id);
    if (prior >= 0) required.splice(prior, 1);
    required.push(e);
    return e;
  };
  const named = id => required.some(x => x.lid === id);
  // Statuses and reservations come after the order is recorded (R1.1, R4.1): `after` the create lid while it is named.
  const afterCreate = extra => ({ ...(extra ?? {}), after: [...new Set([...(named(`create:${O}`) ? [`create:${O}`] : []), ...((extra ?? {}).after ?? [])])] });
  const fst = (F, status, rule, e, l, extra) => lid(`fst:${F}:${status}`, rule, 'orders', 'setStatus', { orderId: O, fulfilmentId: F, status }, e, l, afterCreate(extra));
  const ost = (status, rule, e, l) => lid(`ost:${O}:${status}`, rule, 'orders', 'setStatus', { orderId: O, fulfilmentId: null, status }, e, l, afterCreate());
  const ntf = (about, template, rule, e, l, text) => lid(`ntf:${about}:${template}`, rule, 'notify', 'send', { to: email, about, template }, e, l, { args: { text: text ?? template, ref: null } });

  // Expected business records (R7) and the case's end.
  const rec = { order: null, fulfilments: Object.fromEntries(alloc.map(f => [f.fulfilmentId, f.available ? 'pending' : 'unavailable'])), reservations: {}, charges: {}, shipments: {} };
  let end = null;
  const done = (status, endAt) => { rec.order = status; end = { status, at: endAt }; };
  const out = () => ({ case: c, at, decisions: { graded: { subject: O } }, effects: { required, permitted }, humanTasks: { required: tasksReq, permitted: tasksPerm },
    terminal: end !== null, end, records: end ? rec : null });

  const rows = view.rows;
  const committed = (system, op, pred = () => true) => rows.filter(r => r.system === system && r.op === op && r.committed && pred(r.args ?? {}));
  const events = view.events;
  const custActions = events.filter(e => e.type === 'customer.action').sort((a, b) => a.at - b.at || a.seq - b.seq);
  const msgs = events.filter(e => e.type === 'carrier.status').map(e => ({ ...e, meaning: meaningOf(ed.codes, e.payload.carrier, e.payload.code), F: e.payload.fulfilmentRef }));
  if (stage === 'gl-dispatched') {
    const mig = events.find(e => e.type === 'migration');
    for (const m of mig?.payload?.events ?? []) if (m.type === 'carrier.status') msgs.push({ id: m.id, at: ms(m.at), seq: -1, payload: m.payload, meaning: meaningOf(ed.codes, m.payload.carrier, m.payload.code), F: m.payload.fulfilmentRef });
  }

  /** R6.1: cancel an order whose steps have not committed (fraud, review, customer while waiting, nothing available). */
  const cancelOrder = (rule, e, l, endAt = e) => {
    for (const f of alloc) { fst(f.fulfilmentId, 'cancelled', rule, e, l); rec.fulfilments[f.fulfilmentId] = 'cancelled'; }
    ost('cancelled', rule, e, l);
    ntf(O, 'order-cancelled', rule, e, l);
    done('cancelled', endAt);
    return out();
  };

  // R1 intake.
  const pre = { created: !!stage && stage !== 'gl-intake', actionRequired: stage === 'gl-awaiting', processing: stage === 'gl-dispatched' };
  if (!pre.created) {
    const fuls = alloc.map(f => ({ fulfilmentId: f.fulfilmentId, location: f.location, items: f.items, amountMinor: amount(f) }));
    lid(`create:${O}`, 'R1.1', 'orders', 'create', canonicalArgs('orders', 'create', { orderId: O, customerId: t.customerId, placedAt: t.placedAt, currency: 'EUR',
      items: t.class === 'gl-dispatched' ? alloc[0].items : (events.find(e => e.type === 'order.placed')?.payload.items ?? alloc.flatMap(f => f.items)),
      fulfilments: fuls, totalMinor: fuls.reduce((s, f) => s + f.amountMinor, 0) }), p, p + 60 * MIN);
  }
  rec.order = 'pending';

  // R2 fraud.
  let cleared = null;
  if (stage && stage !== 'gl-intake') cleared = p;
  else if (t.verdict === 'pass') cleared = p;
  else if (t.verdict === 'reject') return cancelOrder('R2.1', p, p + 120 * MIN);
  else {
    tasksReq.push({ lid: `review:${O}`, rule: 'R2.1', kind: 'fraudReview', role: 'fraudAnalyst', mustExclude: [], window: { earliest: p, latest: p + 120 * MIN } });
    const reviews = view.tasks.filter(x => x.task.kind === 'fraudReview').sort((a, b) => a.at - b.at || a.seq - b.seq);
    const first = reviews[0];
    if (!first) {
      const cancel = custActions.find(a => a.payload.action === 'cancel');
      if (cancel) return cancelOrder('R6.4', cancel.at, cancel.at + 60 * MIN);
      return out();
    }
    const deadline = first.at + RV * 60 * MIN;
    tasksPerm.push({ rule: 'R2.2', kind: 'fraudReview', role: 'fraudAnalyst', window: { earliest: first.at, latest: deadline } });
    const ids = new Set(reviews.map(x => `${x.instance}\u0000${x.task.id}`));
    const answers = view.taskEvents.filter(e => e.type === 'humanTask.answered' && ids.has(`${e.instance}\u0000${e.payload.taskId}`)
      && ['approve', 'reject'].includes(e.payload.answer?.decision) && e.at <= deadline).sort((a, b) => a.at - b.at || a.seq - b.seq);
    const ans = answers[0] ?? null;
    const cancel = custActions.find(a => a.payload.action === 'cancel' && (!ans || a.at < ans.at || (a.at === ans.at && a.seq < ans.seq)) && a.at <= deadline);
    if (cancel) return cancelOrder('R6.4', cancel.at, cancel.at + 60 * MIN);
    if (!ans) return cancelOrder('R2.2', deadline, deadline + 120 * MIN);
    if (ans.payload.answer.decision === 'reject') return cancelOrder('R2.2', ans.at, ans.at + 120 * MIN);
    cleared = ans.at;
  }

  // R3 customer action on unavailable items.
  let ready = cleared;
  let countedAction = null;
  if (unavail.length) {
    if (!pre.actionRequired) {
      ost('customerActionRequired', 'R3.1', cleared, cleared + 120 * MIN);
      ntf(O, 'action-required', 'R3.1', cleared, cleared + 120 * MIN);
    }
    rec.order = 'customerActionRequired';
    const D = p + H * 60 * MIN;
    countedAction = custActions.find(a => a.at <= D && ['amend', 'cancel'].includes(a.payload.action)) ?? null;
    for (const a of custActions) if (a !== countedAction && a.payload.action === 'cancel' && a.at > D) permitted.push({ rule: 'R6.3', system: 'notify', op: 'send', match: { about: O, template: 'cancel-refused' } });
    if (!countedAction) {
      for (const f of alloc) { fst(f.fulfilmentId, 'cancelled', 'R3.2', D, D + 60 * MIN); rec.fulfilments[f.fulfilmentId] = 'cancelled'; }
      ost('timedOut', 'R3.2', D, D + 60 * MIN);
      ntf(O, 'order-timed-out', 'R3.2', D, D + 60 * MIN);
      done('timedOut', D);
      return out();
    }
    const a = countedAction.at;
    if (countedAction.payload.action === 'cancel') return cancelOrder('R3.2', a, a + 60 * MIN);
    for (const f of unavail) { fst(f.fulfilmentId, 'cancelled', 'R3.2', a, a + 60 * MIN); rec.fulfilments[f.fulfilmentId] = 'cancelled'; }
    if (!avail.length) return cancelOrder('R3.2', a, a + 60 * MIN);
    ready = a;
  }

  // R4 processing, one saga per available fulfilment.
  const tr = ready;
  if (!pre.processing) {
    ost('processing', 'R4.1', tr, tr + 60 * MIN);
    for (const f of avail) fst(f.fulfilmentId, 'processing', 'R4.1', tr, tr + 60 * MIN);
  }
  rec.order = 'processing';

  // Customer cancels while processing (R6.2, R6.3): the first that counts aborts.
  const procCancels = custActions.filter(a => a !== countedAction && a.payload.action === 'cancel' && a.at >= tr);
  const collectedBy = a => msgs.some(m => ['collected', 'inTransit', 'delivered'].includes(m.meaning) && (m.at < a.at || (m.at === a.at && m.seq < a.seq)));

  // Per-fulfilment saga state (units as the arm committed them).
  const saga = avail.map(f => {
    const F = f.fulfilmentId;
    const mine = r => r.fulfilmentId === F;
    const items = f.items.map(i => {
      const row = committed('inventory', 'reserve', a => mine(a) && a.sku === i.sku)[0] ?? null;
      return { sku: i.sku, qty: i.qty, row, pre: pre.processing };
    });
    const allReserved = items.every(i => i.row || i.pre);
    const rF = pre.processing ? null : allReserved ? Math.max(...items.map(i => i.row.at)) : null;
    const chargeRow = committed('billing', 'charge', mine)[0] ?? null;
    const shipRow = committed('carrier', 'create', mine)[0] ?? null;
    const fails = rows.filter(r => r.args?.fulfilmentId === F && permanent(r) && ['inventory.reserve', 'billing.charge', 'carrier.create'].includes(`${r.system}.${r.op}`));
    const myMsgs = msgs.filter(m => m.F === F).sort((a, b) => a.at - b.at || a.seq - b.seq);
    const collectedMsg = myMsgs.find(m => m.meaning === 'collected') ?? null;
    const deliveredMsg = myMsgs.find(m => m.meaning === 'delivered') ?? null;
    const failedMsg = myMsgs.find(m => m.meaning === 'collectionFailed') ?? null;
    const failAt = [fails[0]?.at, failedMsg?.at].filter(x => x !== undefined).sort((a, b) => a - b)[0] ?? null;
    const R = shipRow ? collectionAt(world, shipRow.args.location, shipRow.at, CUT) : null;
    return { f, F, items, rF, chargeRow, shipRow, fails, collectedMsg, deliveredMsg, failedMsg, failAt, R, location: f.location, amount: amount(f) };
  });

  let abortAt = null;
  for (const a of procCancels) {
    const endedBefore = saga.every(s => (s.deliveredMsg && s.deliveredMsg.at < a.at) || (s.failAt !== null && s.failAt < a.at));
    if (endedBefore) { permitted.push({ rule: 'R6.3', system: 'notify', op: 'send', match: { about: O, template: 'cancel-refused' } }); continue; }
    if (collectedBy(a)) { ntf(O, 'cancel-refused', 'R6.3', a.at, a.at + 60 * MIN); continue; }
    abortAt = a.at;
    break;
  }

  let lastEnd = tr;
  const ends = [];
  for (const s of saga) {
    const { F } = s;
    const aborted = abortAt !== null && !(s.failAt !== null && s.failAt < abortAt);
    const cut = aborted ? abortAt : s.failAt;          // forward steps are required only before this instant
    const forwardOk = row => cut === null || before(row, cut);
    // Forward steps (R4.2) and their records.
    if (!s.items[0].pre) {
      for (const i of s.items) {
        const keep = i.row ? forwardOk(i.row) : cut === null;
        if (keep) lid(`rsv:${F}:${i.sku}`, 'R4.2', 'inventory', 'reserve', { orderId: O, fulfilmentId: F, location: s.location, sku: i.sku, qty: i.qty }, tr, tr + 120 * MIN, afterCreate());
        if (i.row) rec.reservations[`${F}/${i.sku}`] = 'active';
      }
    } else for (const i of s.items) rec.reservations[`${F}/${i.sku}`] = 'active';
    if (s.rF !== null && (s.chargeRow ? forwardOk(s.chargeRow) : cut === null)) {
      lid(`chg:${F}`, 'R4.2', 'billing', 'charge', { orderId: O, fulfilmentId: F, customerId: t.customerId, amountMinor: s.amount, currency: 'EUR' }, s.rF, s.rF + 120 * MIN,
        { after: s.items.map(i => `rsv:${F}:${i.sku}`).filter(named), money: true });
    }
    if (s.chargeRow) rec.charges[F] = { amountMinor: s.chargeRow.args.amountMinor, refundedMinor: 0 };
    if (s.items[0].pre) rec.charges[F] = { amountMinor: s.amount, refundedMinor: 0 };
    if (s.chargeRow && !s.items[0].pre && (s.shipRow ? forwardOk(s.shipRow) : cut === null)) {
      lid(`shp:${F}`, 'R4.2', 'carrier', 'create', { orderId: O, fulfilmentId: F, location: s.location }, s.chargeRow.at, s.chargeRow.at + 120 * MIN, { after: named(`chg:${F}`) ? [`chg:${F}`] : [] });
    }
    if (s.shipRow || s.items[0].pre) rec.shipments[F] = s.items[0].pre ? 'collected' : 'created';

    if (aborted) {
      // R6.2: compensate this fulfilment's committed steps in reverse order, set it cancelled.
      const last = Math.max(abortAt, ...[s.shipRow?.at, s.chargeRow?.at, ...s.items.map(i => i.row?.at)].filter(x => x !== undefined && x !== null));
      const L = last + 60 * MIN;
      const after = [];
      if (s.shipRow && !s.failedMsg) {
        lid(`csh:${F}`, 'R6.2', 'carrier', 'cancel', { orderId: O, fulfilmentId: F }, abortAt, Math.min(L, (s.R ?? Infinity) - MIN));
        after.push(`csh:${F}`); rec.shipments[F] = 'cancelled';
      }
      if (s.chargeRow) {
        lid(`rf:${F}`, 'R6.2', 'billing', 'refund', { orderId: O, fulfilmentId: F, amountMinor: s.chargeRow.args.amountMinor }, abortAt, L, { after: [...after], money: true });
        after.splice(0, after.length, `rf:${F}`); rec.charges[F].refundedMinor = s.chargeRow.args.amountMinor;
      }
      for (const i of s.items) if (i.row) { lid(`rel:${F}:${i.sku}`, 'R6.2', 'inventory', 'release', { orderId: O, fulfilmentId: F, sku: i.sku }, abortAt, L, { after: [...after] }); rec.reservations[`${F}/${i.sku}`] = 'released'; }
      fst(F, 'cancelled', 'R6.2', abortAt, L);
      rec.fulfilments[F] = 'cancelled';
      ends.push('cancelled');
      continue;
    }
    if (s.failAt !== null) {
      // R5.2: the fulfilment fails; compensate (no shipment cancel: a failure comes before or at collection).
      const x = s.failAt;
      const last = Math.max(x, ...[s.chargeRow?.at, ...s.items.map(i => i.row?.at)].filter(v => v !== undefined && v !== null));
      const L = last + 120 * MIN;
      const after = [];
      if (s.chargeRow) {
        lid(`rf:${F}`, 'R5.1', 'billing', 'refund', { orderId: O, fulfilmentId: F, amountMinor: s.chargeRow.args.amountMinor }, x, L, { money: true });
        after.push(`rf:${F}`); rec.charges[F].refundedMinor = s.chargeRow.args.amountMinor;
      }
      for (const i of s.items) if (i.row) { lid(`rel:${F}:${i.sku}`, 'R5.1', 'inventory', 'release', { orderId: O, fulfilmentId: F, sku: i.sku }, x, L, { after: [...after] }); rec.reservations[`${F}/${i.sku}`] = 'released'; }
      fst(F, 'failed', 'R5.2', x, L);
      ntf(F, 'fulfilment-failed', 'R5.2', x, L);
      if (s.failedMsg) rec.shipments[F] = 'failed';
      rec.fulfilments[F] = 'failed';
      ends.push('failed'); lastEnd = Math.max(lastEnd, x);
      continue;
    }
    // R4.4: carrier messages (dispatched never after completed; completed after dispatched).
    const prePatched = s.items[0].pre;
    if (s.collectedMsg && !prePatched) fst(F, 'dispatched', 'R4.4', s.collectedMsg.at, s.collectedMsg.at + 120 * MIN);
    if (s.collectedMsg) { rec.fulfilments[F] = 'dispatched'; rec.shipments[F] = 'collected'; }
    if (s.deliveredMsg) {
      if (!named(`fst:${F}:dispatched`) && !prePatched) fst(F, 'dispatched', 'R4.4', s.deliveredMsg.at, s.deliveredMsg.at + 120 * MIN);
      fst(F, 'completed', 'R4.4', s.deliveredMsg.at, s.deliveredMsg.at + 120 * MIN, { after: prePatched ? [] : [`fst:${F}:dispatched`] });
      rec.fulfilments[F] = 'completed'; rec.shipments[F] = 'delivered';
      ends.push('completed'); lastEnd = Math.max(lastEnd, s.deliveredMsg.at);
    } else if (s.collectedMsg) {
      const later = msgs.find(m => m.F === F && m.meaning === 'inTransit');
      if (later) rec.shipments[F] = 'inTransit';
    }
  }

  if (abortAt !== null) {
    ost('cancelled', 'R6.2', abortAt, abortAt + 60 * MIN);
    ntf(O, 'order-cancelled', 'R6.2', abortAt, abortAt + 60 * MIN);
    for (const f of unavail) rec.fulfilments[f.fulfilmentId] = 'cancelled';
    done('cancelled', abortAt);
    return out();
  }
  // R4.5 order outcome once every fulfilment ended.
  if (saga.length && ends.length === saga.length) {
    const final = ends.includes('completed') ? 'completed' : ends.includes('failed') ? 'failed' : 'cancelled';
    ost(final, 'R4.5', lastEnd, lastEnd + 120 * MIN);
    done(final, lastEnd);
  }
  return out();
}

/**
 * The arm's business records for one case at the end of its trajectory (layer 5): order and fulfilment statuses,
 * reservations, charges with refunds, shipments; from its committed rows, the world's and carriers' writes, and the
 * go-live export. Same shape as the expectation's `records`.
 */
export function recordsOf(world, idx, c) {
  const t = world.truth.cases[c];
  if (!t || t.subject === null) return null;
  const O = t.subject;
  const alloc = world.sor['inventory.allocations'].find(a => a.orderId === O).fulfilments;
  const rec = { order: null, fulfilments: {}, reservations: {}, charges: {}, shipments: {} };
  const shipFul = new Map();
  const b = world.backlog.find(x => x.case === c);
  for (const [qual, rws] of Object.entries(b?.export?.records ?? {})) for (const r of rws) {
    if (qual === 'orders.orders' && r.orderId === O) rec.order = r.status;
    if (qual === 'orders.fulfilments') rec.fulfilments[r.fulfilmentId] = r.status;
    if (qual === 'inventory.reservations') rec.reservations[`${r.fulfilmentId}/${r.sku}`] = r.status;
    if (qual === 'billing.charges') rec.charges[r.fulfilmentId] = { amountMinor: r.amountMinor, refundedMinor: r.refundedMinor };
    if (qual === 'carrier.shipments') { rec.shipments[r.fulfilmentId] = r.status; shipFul.set(r.shipmentId, r.fulfilmentId); }
  }
  const fids = new Set(alloc.map(f => f.fulfilmentId));
  const timeline = [
    ...idx.ledger.filter(r => r.committed && (r.case === c || fids.has(r.args?.fulfilmentId))).map(r => ({ seq: r.seq, kind: 'row', r })),
    ...idx.writes.filter(w => w.system === 'carrier' && w.table === 'shipments' && fids.has(w.row?.fulfilmentId) && w.source !== 'initial' && !String(w.source).startsWith('backlog:')).map(w => ({ seq: w.seq, kind: 'write', w })),
  ].sort((a, b2) => a.seq - b2.seq);
  for (const e of timeline) {
    if (e.kind === 'write') { rec.shipments[e.w.row.fulfilmentId] = e.w.row.status; continue; }
    const { system, op, args } = e.r;
    const k = `${system}.${op}`;
    if (k === 'orders.create' && args.orderId === O) { rec.order = 'pending'; for (const f of args.fulfilments ?? []) rec.fulfilments[f.fulfilmentId] = f.location === null ? 'unavailable' : 'pending'; }
    else if (k === 'orders.setStatus' && args.orderId === O) { if (args.fulfilmentId === null) rec.order = args.status; else rec.fulfilments[args.fulfilmentId] = args.status; }
    else if (k === 'inventory.reserve') rec.reservations[`${args.fulfilmentId}/${args.sku}`] = 'active';
    else if (k === 'inventory.release') rec.reservations[`${args.fulfilmentId}/${args.sku}`] = 'released';
    else if (k === 'billing.charge') rec.charges[args.fulfilmentId] = { amountMinor: args.amountMinor, refundedMinor: rec.charges[args.fulfilmentId]?.refundedMinor ?? 0 };
    else if (k === 'billing.refund' && rec.charges[args.fulfilmentId]) rec.charges[args.fulfilmentId].refundedMinor += args.amountMinor;
    else if (k === 'carrier.create') rec.shipments[args.fulfilmentId] = 'created';
    else if (k === 'carrier.cancel') rec.shipments[args.fulfilmentId] = 'cancelled';
  }
  return rec;
}
