// Parent orchestrator: routing and the order of the phases (DECOMPOSITION.md §3). It emits no effects itself: every
// system is reached through a module. Owns SPEC-E §1 (routing, subject, delivery order), §3.2, §3.5, §4 preamble,
// R7.1 (no close while a module is busy), and the phase order of S5, S8-S13, S15.
//
// Parent state (JSON; the whole carry stays under 64 KB):
//   { phase: 'new'|'intake'|'fraud'|'waiting'|'processing'|'ended', orderId, placedAt, customerId, currency, edition,
//     fulfilments: [{ fulfilmentId, location, available, items, amountMinor }], readyAt, readyDone,
//     started: { [fid]: true }, sagas: { [fid]: { end, reported } }, busy: { [module]: boolean }, held: [action] }

const FULFILMENT_ENDS = ['completed', 'failed'];

export function tick(input, ctx) {
  const state = input.state ?? newState();
  const events = input.events ?? [];
  let first = true;
  if (state.phase === 'new') {
    const r = firstTick(events[0], state, input, ctx);
    if (r.merge) return { decisions: { subject: r.subject }, state, merge: { into: r.merge } };
    if (r.close) return { decisions: { subject: r.subject ?? null }, state, close: true };
    first = false;
  }
  for (const ev of first ? events : events.slice(1)) handleEvent(ev, state, input, ctx);
  if (state.phase === 'processing') endOfTick(state, input, ctx);
  const out = { decisions: { subject: state.orderId ?? null }, state };
  if (shouldClose(state)) out.close = true;
  return out;
}

function newState() {
  return { phase: 'new', orderId: null, placedAt: null, customerId: null, currency: null, edition: null, fulfilments: [],
    readyAt: null, readyDone: false, started: {}, sagas: {}, busy: {}, held: [] };
}

// ---------------------------------------------------------------------------------------------------------------------
// The first tick of an instance started by a message (§1 Routing, §3.2, §3.3, §3.5)

function firstTick(ev, state, input, ctx) {
  if (!ev) return { close: true, subject: null };
  if (ev.type === 'migration') return resumeMigration(ev, state, input, ctx);
  if (ev.type === 'order.placed') {
    const orderId = normalise(ev.payload.orderId, ctx);
    const open = openElsewhere(orderId, input, ctx);
    if (open) return { merge: open, subject: orderId };
    if (recordedOrder(orderId, ctx)) return { close: true, subject: orderId };     // R1.4: a recorded duplicate
    state.orderId = orderId;
    state.placedAt = ev.at;                                                        // §3.1: placedAt is the event's time
    state.customerId = ev.payload.customerId;
    state.currency = ev.payload.currency;
    state.phase = 'intake';
    const r = ctx.call('intake', orderId, { op: 'placed', order: placedOrder(ev, orderId) });
    absorbIntake(r, state, ctx);
    return { subject: orderId };
  }
  if (ev.type === 'customer.action') {
    const orderId = normalise(ev.payload.orderRef, ctx);
    if (!orderId) return { close: true, subject: null };                          // §3.2: names no order: nothing
    const open = openElsewhere(orderId, input, ctx);
    if (open) return { merge: open, subject: orderId };
    return { close: true, subject: orderId };                                     // ended or unknown: changes nothing
  }
  if (ev.type === 'carrier.status') {
    const orderId = orderOfFulfilment(ev.payload.fulfilmentRef, ctx);
    if (orderId) {
      const open = openElsewhere(orderId, input, ctx);
      if (open) return { merge: open, subject: orderId };
    }
    return { close: true, subject: orderId };                                    // §3.3: changes nothing
  }
  return { close: true, subject: null };
}

function resumeMigration(ev, state, input, ctx) {
  // §3.5: continue from where the order stands. The records say what exists; the messages already received are
  // replayed through the same handlers (they are idempotent), and the rules continue unchanged.
  const rec = ev.payload.records ?? {};
  const row = (rec['orders.orders'] ?? [])[0];
  if (!row) return resumeUnrecorded(ev, state, input, ctx);
  const orderId = normalise(row.orderId, ctx);
  const rows = rec['orders.fulfilments'] ?? [];
  state.orderId = orderId;
  state.customerId = row.customerId;
  state.currency = row.currency;
  state.placedAt = row.placedAt;
  state.edition = ctx.call('intake', orderId, { op: 'resume', records: rec }).edition;
  state.fulfilments = rows.map(f => ({ fulfilmentId: f.fulfilmentId, location: f.location ?? null, available: (f.location ?? null) !== null,
    items: mergeItems(f.items ?? []), amountMinor: f.amountMinor ?? 0 }));
  ctx.call('statuses', orderId, { op: 'resume', orderId, records: { order: row.status, fulfilments: rows.map(f => ({ fulfilmentId: f.fulfilmentId, status: f.status })) } });
  ctx.call('notices', orderId, { op: 'resume', customerId: row.customerId, sent: (rec['notify.notifications'] ?? []).map(n => `${n.template}.${n.about}`) });
  const pending = row.status === 'pending';
  if (pending) {
    // Still before clearing: the fraud check is read again; a review task is asked again if the verdict needs one.
    ctx.call('fraud', orderId, { op: 'start', orderId, placedAt: row.placedAt, edition: state.edition });
    state.phase = 'fraud';
  } else {
    ctx.call('fraud', orderId, { op: 'resume', records: { state: 'cleared', placedAt: row.placedAt, edition: state.edition, at: row.placedAt } });
    state.phase = row.status === 'processing' ? 'processing' : row.status === 'customerActionRequired' ? 'waiting' : 'ended';
  }
  const ca = ctx.call('customer-action', orderId, { op: 'resume', placedAt: row.placedAt, edition: state.edition, records: rec });
  state.busy.ca = ca.busy;
  if (state.phase === 'processing') {
    state.readyAt = row.placedAt;
    state.readyDone = true;
    ctx.call('order-progress', orderId, { op: 'resume', records: { state: 'processing' } });
    for (const f of state.fulfilments) {
      if (!f.available) continue;
      state.started[f.fulfilmentId] = true;
      const out = ctx.call('fulfilment', f.fulfilmentId, { op: 'resume', records: fulfilmentRecord(f, state, rec, rows) });
      onFulfilment(f.fulfilmentId, out, state, ctx);
    }
  }
  for (const e of ev.payload.events ?? []) if (e.type !== 'order.placed') handleEvent(e, state, input, ctx);
  return { subject: orderId };
}

// §3.5: no record yet, so the order was not recorded before go-live: its order.placed is among the messages already
// received. It is placed now, as if it had just arrived; the other messages are handled after it (held until recorded).
function resumeUnrecorded(ev, state, input, ctx) {
  const placed = (ev.payload.events ?? []).find(e => e.type === 'order.placed');
  if (!placed) return { close: true, subject: null };
  const r = firstTick(placed, state, input, ctx);
  if (r.merge || r.close) return r;
  for (const e of ev.payload.events ?? []) if (e.type !== 'order.placed') handleEvent(e, state, input, ctx);
  return r;
}

// The fulfilment's saga state, read back from its records (reservations, charge, shipment and status rows).
function fulfilmentRecord(f, state, rec, rows) {
  const fid = f.fulfilmentId;
  const status = (rows.find(r => r.fulfilmentId === fid) ?? {}).status ?? 'pending';
  const reserved = (rec['inventory.reservations'] ?? []).filter(x => x.fulfilmentId === fid && x.status === 'active').map(x => x.sku);
  const charged = (rec['billing.charges'] ?? []).some(x => x.fulfilmentId === fid);
  const shipment = (rec['carrier.shipments'] ?? []).find(x => x.fulfilmentId === fid);
  const shipped = shipment !== undefined && shipment.status !== 'cancelled' && shipment.status !== 'failed';
  // Reports that already came are read back from the shipment: an earlier time, so they count for S7 (assumption).
  const reports = shipment && ['collected', 'inTransit', 'delivered'].includes(shipment.status)
    ? [{ meaning: shipment.status, reportedAt: '1970-01-01T00:00:00+00:00' }] : [];
  const phase = { pending: 'running', processing: 'running', dispatched: 'dispatched', completed: 'completed', failed: 'failed', cancelled: 'stopped' }[status] ?? 'running';
  const end = { completed: 'completed', failed: 'failed', cancelled: 'stopped' }[status] ?? null;
  return {
    orderId: state.orderId, fid, customerId: state.customerId, currency: state.currency, edition: state.edition,
    location: f.location, items: f.items, amountMinor: f.amountMinor, phase, batches: 0,
    reserve: Object.fromEntries(f.items.map(i => [i.sku, reserved.includes(i.sku) ? 'ok' : 'none'])),
    charge: charged ? 'ok' : 'none', ship: shipped ? 'ok' : 'none', shipUndo: 'none', refund: 'none',
    collectionFailed: shipment !== undefined && shipment.status === 'failed', dispatched: status === 'dispatched' || status === 'completed',
    reports, end, endedAt: null,
  };
}

function mergeItems(items) {
  const bySku = new Map();
  for (const i of items) bySku.set(i.sku, (bySku.get(i.sku) ?? 0) + i.qty);
  return [...bySku].map(([sku, qty]) => ({ sku, qty }));
}

// ---------------------------------------------------------------------------------------------------------------------
// Each event of the tick, in the order given (§1 Delivery order; never re-sorted)

function handleEvent(ev, state, input, ctx) {
  if (ev.type === 'effect.result' || ev.type === 'timer.fired' || ev.type.startsWith('humanTask.')) {
    const owner = ctx.ownerOf(ev);
    if (!owner) return;
    const out = ctx.deliver(ev);
    onModuleOutput(owner.module, owner.key, out, state, ctx);
    return;
  }
  if (ev.type === 'order.placed') {
    // A merged duplicate of a placed order (R1.4): intake recognises it.
    const r = ctx.call('intake', state.orderId, { op: 'placed', order: placedOrder(ev, state.orderId) });
    absorbIntake(r, state, ctx);
    return;
  }
  if (ev.type === 'customer.action') return routeCustomerAction(ev, state, ctx, normalise(ev.payload.orderRef, ctx));
  if (ev.type === 'carrier.status') {
    const fid = ev.payload.fulfilmentRef;
    if (!state.fulfilments.some(f => f.fulfilmentId === fid)) return;             // §3.3: unknown fulfilment: nothing
    const out = ctx.call('fulfilment', fid, { op: 'carrier', message: ev.payload, at: ev.at });
    onModuleOutput('fulfilment', fid, out, state, ctx);
  }
}

function routeCustomerAction(ev, state, ctx, orderId) {
  const at = ev.at;
  const action = ev.payload.action;
  if (orderId !== state.orderId) return;
  const cancelOf = () => ({ orderId, at, eventId: ev.id, fulfilmentIds: state.fulfilments.filter(f => f.available).map(f => f.fulfilmentId) });
  switch (state.phase) {
    case 'intake':
      // Recorded later: held and routed when the order is recorded (open point, DECOMPOSITION.md §8).
      state.held.push({ action, at, eventId: ev.id });
      return;
    case 'fraud':
      if (action === 'cancel') {
        const v = ctx.call('cancellation', orderId, { op: 'customer-cancel', ...cancelOf(), phase: 'not-cleared' });    // R6.4
        return verdictOf(v, state, ctx);
      }
      return onModuleOutput('customer-action', orderId, ctx.call('customer-action', orderId, { op: 'action', action, at }), state, ctx);
    case 'waiting':
      return onModuleOutput('customer-action', orderId, ctx.call('customer-action', orderId, { op: 'action', action, at }), state, ctx);
    case 'processing':
      if (action === 'cancel') {
        const v = ctx.call('cancellation', orderId, { op: 'customer-cancel', ...cancelOf(), phase: 'processing' });   // R6.2
        return verdictOf(v, state, ctx);
      }
      return;                                                                    // S5: an amend changes nothing
    case 'ended':
      if (action === 'cancel') ctx.call('cancellation', orderId, { op: 'customer-cancel', ...cancelOf(), phase: 'ended' });
      return;
  }
}

function placedOrder(ev, orderId) {
  // §3.1: the placed payload with the normalised id; placedAt is the event's time.
  const p = ev.payload;
  return { orderId, customerId: p.customerId, placedAt: ev.at, currency: p.currency, items: p.items };
}

function verdictOf(v, state, ctx) {
  if (v.verdict === 'counts') endOrder(state, ctx);
}

function endOrder(state, ctx) {
  state.phase = 'ended';
  // Their stop is read back, so that the busy flags say what is still pending (R7.1).
  state.busy.ca = ctx.call('customer-action', state.orderId, { op: 'stop' }).busy;
  state.busy.fraud = ctx.call('fraud', state.orderId, { op: 'stop' }).busy;
  // Fulfilments stopped by the cancellation: read their outcome back (their stop is not in this call's output).
  for (const fid of Object.keys(state.started)) {
    if (!state.sagas[fid] || state.sagas[fid].end === null) onFulfilment(fid, ctx.call('fulfilment', fid, { op: 'get' }), state, ctx);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Module outputs: act only on transitions not acted on before (outputs report the current state)

function onModuleOutput(module, key, out, state, ctx) {
  if (!out) return;
  if (module === 'intake') return absorbIntake(out, state, ctx);
  if (module === 'fraud') return onFraud(out, state, ctx);
  if (module === 'customer-action') return onCustomerAction(out, state, ctx);
  if (module === 'order-progress') {
    if (out.state === 'ended' && state.phase === 'processing') state.phase = 'ended';
    return;
  }
  if (module === 'fulfilment') return onFulfilment(key, out, state, ctx);
}

function absorbIntake(out, state, ctx) {
  state.busy.intake = out.busy;
  if (out.duplicate || out.status !== 'recorded' || state.phase !== 'intake') return;
  // Recorded (R1.1): only now the order's statuses, notices, fraud and customer deadline start (R4.1).
  const orderId = state.orderId;
  state.edition = out.edition;
  state.customerId = out.customerId;
  state.fulfilments = out.fulfilments;
  state.totalMinor = out.totalMinor;
  ctx.call('statuses', orderId, { op: 'init', orderId, fulfilments: state.fulfilments.map(f => ({ fulfilmentId: f.fulfilmentId, location: f.location })) });
  ctx.call('notices', orderId, { op: 'init', customerId: state.customerId });
  ctx.call('fraud', orderId, { op: 'start', orderId, placedAt: state.placedAt, edition: state.edition });
  const ca = ctx.call('customer-action', orderId, { op: 'start', orderId, placedAt: state.placedAt, edition: state.edition,
    fulfilments: state.fulfilments.map(f => ({ fulfilmentId: f.fulfilmentId, available: f.available })) });
  state.phase = 'fraud';
  state.busy.ca = ca.busy;
  const held = state.held;
  state.held = [];
  for (const h of held) {
    if (h.action === 'cancel') {
      const v = ctx.call('cancellation', orderId, { op: 'customer-cancel', orderId, at: h.at, eventId: h.eventId, phase: 'not-cleared',
        fulfilmentIds: state.fulfilments.filter(f => f.available).map(f => f.fulfilmentId) });
      verdictOf(v, state, ctx);
    } else if (state.phase === 'fraud') {
      onModuleOutput('customer-action', orderId, ctx.call('customer-action', orderId, { op: 'action', action: h.action, at: h.at }), state, ctx);
    }
    if (state.phase === 'ended') break;
  }
}

function onFraud(out, state, ctx) {
  state.busy.fraud = out.busy;
  if (state.phase !== 'fraud') return;
  const orderId = state.orderId;
  if (out.state === 'cleared') {
    // R2.1: cleared at c. R3.1 for unavailable items, else ready at c (R4.1).
    const ca = ctx.call('customer-action', orderId, { op: 'advance', clearedAt: out.at });
    state.busy.ca = ca.busy;
    if (ca.state === 'waiting') {
      state.phase = 'waiting';
      return;
    }
    return becomeReady(out.at, state, ctx);                                      // ready (counted amend) or no unavailable items
  }
  if (out.state === 'cancel') {
    // R2.1, R2.2: the order is cancelled for fraud or by the review deadline (S15).
    const v = ctx.call('cancellation', orderId, { op: 'cancel-order', orderId, at: out.at, reason: out.reason });
    endOrder(state, ctx);
    return v;
  }
}

function onCustomerAction(out, state, ctx) {
  state.busy.ca = out.busy;
  const orderId = state.orderId;
  if (state.phase === 'waiting' && out.state === 'ready') return becomeReady(out.at, state, ctx);   // R3.2: counted amend
  if ((state.phase === 'waiting' || state.phase === 'fraud') && out.state === 'cancel') {
    ctx.call('cancellation', orderId, { op: 'cancel-order', orderId, at: out.at, reason: out.reason });
    endOrder(state, ctx);
    return;
  }
  if ((state.phase === 'waiting' || state.phase === 'fraud') && out.state === 'timedOut') {
    endOrder(state, ctx);                                                        // R3.2: the end of the order
    return;
  }
}

function becomeReady(at, state, ctx) {
  state.phase = 'processing';
  state.readyAt = at;
}

function onFulfilment(fid, out, state, ctx) {
  state.busy[`f:${fid}`] = out.busy;
  const saga = state.sagas[fid] ?? { end: null, reported: false };
  if (out.end) saga.end = out.end;
  state.sagas[fid] = saga;
  if (FULFILMENT_ENDS.includes(out.end) && !saga.reported && state.phase === 'processing') {
    saga.reported = true;
    const r = ctx.call('order-progress', state.orderId, { op: 'ended', orderId: state.orderId, fulfilmentId: fid, end: out.end, at: out.endedAt });
    if (r.state === 'ended') state.phase = 'ended';
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// End of tick: the only place where forward steps are emitted (S10). Nothing once the order has ended (S9, R6.2).

function endOfTick(state, input, ctx) {
  const orderId = state.orderId;
  if (!state.readyDone) {
    state.readyDone = true;
    ctx.call('order-progress', orderId, { op: 'ready', orderId, at: state.readyAt, fulfilments: state.fulfilments.map(f => ({ fulfilmentId: f.fulfilmentId, available: f.available })) });
  }
  for (const f of state.fulfilments) {
    if (!f.available) continue;
    const saga = state.sagas[f.fulfilmentId] ?? { end: null, reported: false };
    if (saga.end) continue;
    if (!state.started[f.fulfilmentId]) {
      state.started[f.fulfilmentId] = true;
      ctx.call('fulfilment', f.fulfilmentId, { op: 'start', orderId, customerId: state.customerId, currency: state.currency,
        edition: state.edition, fulfilment: { fulfilmentId: f.fulfilmentId, location: f.location, items: f.items, amountMinor: f.amountMinor } });
    }
    onFulfilment(f.fulfilmentId, ctx.call('fulfilment', f.fulfilmentId, { op: 'advance' }), state, ctx);
  }
}

function shouldClose(state) {
  // Close only when the order has ended, no module is busy (R7.1) and every saga has ended. Until then the instance
  // stays open, so carrier messages quoting our ref still reach it (§1 Routing).
  if (state.phase !== 'ended') return false;
  if (Object.values(state.busy).some(Boolean)) return false;
  return Object.keys(state.started).every(fid => state.sagas[fid] && state.sagas[fid].end !== null);
}

// ---------------------------------------------------------------------------------------------------------------------
// Helpers

function normalise(raw, ctx) {
  return ctx.call('order-id', 'n', { raw }).orderId;
}

function openElsewhere(orderId, input, ctx) {
  if (!orderId) return null;
  const list = ctx.instances({ subject: orderId }) ?? [];
  for (const x of list) {
    const id = typeof x === 'string' ? x : x?.instance ?? x?.id;
    if (id && id !== input.instance) return id;
  }
  return null;
}

function recordedOrder(orderId, ctx) {
  return (ctx.query('orders.orders', { where: { orderId }, limit: 1 }) ?? []).length > 0;
}

function orderOfFulfilment(fid, ctx) {
  if (!fid) return null;
  const row = (ctx.query('orders.fulfilments', { where: { fulfilmentId: fid }, limit: 1 }) ?? [])[0];
  return row ? row.orderId : null;
}
