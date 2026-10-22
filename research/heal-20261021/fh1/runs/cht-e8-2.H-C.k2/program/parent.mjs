// Parent orchestrator: routing and the order of the phases. Owns SPEC-E §1 (routing, subject, delivery order), §3.2,
// §3.3 (which carrier message goes where), §3.5 (migration), the §4 preamble (act inside each window, never twice),
// S5, S8, S9, S10 (same-instant knowledge: forward steps only at the end of a tick), S11, S12, S13 and S15. It emits no
// effects itself: every system is reached through a module.
//
// Parent state (JSON, the parent's carry):
//   { orderId, phase: 'new'|'intake'|'fraud'|'waiting'|'processing'|'ended', placedAt, customerId, currency, edition,
//     totalMinor, fulfilments: [{ fulfilmentId, location, available, items, amountMinor }], clearedAt, readyAt,
//     progressReady, started: {fid: true}, ended: {fid: 'completed'|'failed'}, outcome, held: [customer actions],
//     busy: {module:key: bool} }

export function tick(input, ctx) {
  const st = input.state ?? newState();
  const events = input.events ?? [];
  let first = null;
  if (st.phase === 'new' && events.length) {
    first = routeFirst(events[0], input, st, ctx);
    if (first.merge) return { decisions: { subject: first.subject }, state: st, merge: { into: first.merge } };
    if (first.close) return finish(st, first.subject, true);
  }
  for (const ev of events.slice(first ? 1 : 0)) handle(ev, st, ctx, input);
  endOfTick(st, ctx);
  return finish(st, st.orderId ?? null, st.phase === 'ended' && !busyAny(st));
}

function newState() {
  return { phase: 'new', orderId: null, placedAt: null, customerId: null, currency: null, edition: null, totalMinor: null,
    fulfilments: [], clearedAt: null, readyAt: null, progressReady: false, started: {}, ended: {}, outcome: null, held: [], busy: {} };
}

function finish(st, subject, close) {
  const out = { decisions: { subject: subject ?? null }, state: st };
  if (close) out.close = true;
  return out;
}

function busyAny(st) {
  return Object.values(st.busy).some(Boolean);
}

function setBusy(st, mod, key, out) {
  if (out && typeof out.busy === 'boolean') st.busy[`${mod}:${key}`] = out.busy;
}

// Every module call goes through here, so the busy flags are kept.
function callMod(st, ctx, mod, key, input) {
  const out = ctx.call(mod, key, input);
  setBusy(st, mod, key, out);
  return out;
}

function normalise(raw, ctx) {
  return ctx.call('order-id', 'n', { raw: typeof raw === 'string' ? raw : null }).orderId;
}

function inboundKind(ev) {
  if (ev.type === 'migration') return 'migration';
  if (ev.source === 'shop' || ev.type === 'order.placed') return 'placed';
  if (ev.source === 'customer-portal' || ev.type === 'customer.action') return 'action';
  if (ev.source === 'carrier' || ev.type === 'carrier.status') return 'carrier';
  return null;
}

// Open instances of an order, other than this one (ctx.instances lists open instances by declared subject).
function openOthers(oid, self, ctx) {
  return ctx.instances({ subject: oid }).map(x => (typeof x === 'string' ? x : x.instance)).filter(x => x && x !== self);
}

// §1 Routing: the first tick of an instance started by a message. merge is only allowed here.
function routeFirst(ev, input, st, ctx) {
  const kind = inboundKind(ev);
  const p = ev.payload ?? {};
  if (kind === 'placed') {
    const oid = normalise(p.orderId, ctx);
    const others = openOthers(oid, input.instance, ctx);
    if (others.length) return { merge: others[0], subject: oid };
    return startPlaced(ev, st, ctx);
  }
  if (kind === 'action') {
    const oid = normalise(p.orderRef, ctx);
    if (!oid) return { subject: null, close: true };
    const others = openOthers(oid, input.instance, ctx);
    if (others.length) return { merge: others[0], subject: oid };
    return { subject: oid, close: true };                                          // no open case: nothing (§3.2, S11)
  }
  if (kind === 'carrier') {
    const rows = ctx.query('orders.fulfilments', { where: { fulfilmentId: p.fulfilmentRef }, limit: 1 });
    if (!rows.length) return { subject: null, close: true };
    const oid = normalise(rows[0].orderId, ctx);
    const others = openOthers(oid, input.instance, ctx);
    if (others.length) return { merge: others[0], subject: oid };
    return { subject: oid, close: true };                                          // §3.3: changes nothing
  }
  if (kind === 'migration') return resumeMigration(ev, input, st, ctx);
  return { subject: null, close: true };
}

// A placed order starts its case: intake records it (R1.1).
function startPlaced(ev, st, ctx) {
  const p = ev.payload ?? {};
  const oid = normalise(p.orderId, ctx);
  st.orderId = oid;
  st.phase = 'intake';
  st.placedAt = ev.at;
  st.customerId = p.customerId;
  st.currency = p.currency;
  const order = { orderId: oid, customerId: p.customerId, placedAt: ev.at, currency: p.currency, items: p.items };
  const r = callMod(st, ctx, 'intake', oid, { op: 'placed', order });
  if (r.duplicate) { st.phase = 'ended'; return { subject: oid, close: true }; }    // R1.4: nothing
  return { subject: oid };
}

function handle(ev, st, ctx, input) {
  const owner = ctx.ownerOf(ev);
  if (owner) {
    const out = ctx.deliver(ev);
    onOutput(owner.module, owner.key, out, st, ctx);
    return;
  }
  const kind = inboundKind(ev);
  if (kind === 'placed') {
    // a merged duplicate of the placed order (R1.4)
    callMod(st, ctx, 'intake', st.orderId, { op: 'placed', order: { orderId: st.orderId, customerId: ev.payload.customerId,
      placedAt: ev.at, currency: ev.payload.currency, items: ev.payload.items } });
  } else if (kind === 'action') {
    routeAction({ eventId: ev.id, action: ev.payload.action, at: ev.at }, st, ctx);
  } else if (kind === 'carrier') {
    const fid = ev.payload.fulfilmentRef;
    if (!st.fulfilments.some(f => f.fulfilmentId === fid)) return;                 // §3.3: unknown shipment: nothing
    const r = callMod(st, ctx, 'fulfilment', fid, { op: 'carrier', at: ev.at, message: {
      code: ev.payload.code, reportedAt: ev.payload.reportedAt, carrier: ev.payload.carrier ?? null, shipmentId: ev.payload.shipmentId ?? null } });
    onOutput('fulfilment', fid, r, st, ctx);
  }
}

// A customer action by phase (R3.2, R6.2, R6.3, R6.4, S5, S8, S11, S12, S15).
function routeAction(act, st, ctx) {
  const oid = st.orderId;
  switch (st.phase) {
    case 'intake': st.held.push(act); return;                                      // the order is not recorded yet
    case 'fraud':
      if (act.action === 'cancel') customerCancel(act, 'not-cleared', st, ctx);     // R6.4
      else st.held.push(act);
      return;
    case 'waiting': {
      const r = callMod(st, ctx, 'customer-action', oid, { op: 'action', action: act.action, at: act.at });
      customerActionOut(r, st, ctx);
      return;
    }
    case 'processing':
      if (act.action === 'cancel') customerCancel(act, 'processing', st, ctx);     // R6.2, R6.3
      return;                                                                      // amend: nothing (S5)
    case 'ended':
      if (act.action === 'cancel') customerCancel(act, 'ended', st, ctx);          // R6.3: changes nothing
      return;
  }
}

function customerCancel(act, phase, st, ctx) {
  const r = callMod(st, ctx, 'cancellation', st.orderId, { op: 'customer-cancel', orderId: st.orderId, at: act.at, eventId: act.eventId, phase });
  if (r.verdict === 'counts') st.phase = 'ended';
}

// Held customer actions are routed in order when their phase is reached (S10: they keep their own times).
function drainHeld(st, ctx) {
  const held = st.held;
  st.held = [];
  for (const act of held) routeAction(act, st, ctx);
}

function onOutput(mod, key, out, st, ctx) {
  setBusy(st, mod, key, out);
  switch (mod) {
    case 'intake':
      if (out.status === 'recorded' && st.phase === 'intake') recorded(out, st, ctx);
      return;
    case 'fraud':
      fraudOut(out, st, ctx);
      return;
    case 'customer-action':
      customerActionOut(out, st, ctx);
      return;
    case 'fulfilment':
      fulfilmentOut(key, out, st, ctx);
      return;
    case 'order-progress':
      orderProgressOut(out, st);
      return;
    default:
      return;                                  // statuses, notices: busy flags only
  }
}

// The order is recorded (R1.1): statuses and notices start, the fraud phase starts (R2.1).
function recorded(out, st, ctx) {
  const oid = st.orderId;
  st.edition = out.edition;
  st.totalMinor = out.totalMinor;
  st.fulfilments = out.fulfilments;
  st.phase = 'fraud';
  callMod(st, ctx, 'statuses', oid, { op: 'init', fulfilments: out.fulfilments.map(f => ({ fulfilmentId: f.fulfilmentId, location: f.location })) });
  callMod(st, ctx, 'notices', oid, { op: 'init', customerId: st.customerId });
  callMod(st, ctx, 'fraud', oid, { op: 'start', orderId: oid, placedAt: st.placedAt, edition: st.edition });
  drainHeld(st, ctx);
}

function fraudOut(out, st, ctx) {
  if (st.phase !== 'fraud') return;
  const oid = st.orderId;
  if (out.state === 'cleared') {
    st.clearedAt = out.at;
    if (st.fulfilments.some(f => !f.available)) {
      st.phase = 'waiting';                                                        // R3.1 starts
      callMod(st, ctx, 'customer-action', oid, { op: 'start', orderId: oid, placedAt: st.placedAt, clearedAt: out.at,
        edition: st.edition, fulfilments: st.fulfilments.map(f => ({ fulfilmentId: f.fulfilmentId, available: f.available })) });
    } else {
      st.readyAt = out.at;                                                         // R4.1: ready at the clearing
      st.phase = 'processing';
    }
    drainHeld(st, ctx);
  } else if (out.state === 'cancel') {
    callMod(st, ctx, 'cancellation', oid, { op: 'cancel-order', orderId: oid, at: out.at, reason: out.reason });
    st.phase = 'ended';                                                            // S15
  }
}

function customerActionOut(out, st, ctx) {
  if (st.phase !== 'waiting') return;
  if (out.state === 'ready') {
    st.readyAt = out.at;
    st.phase = 'processing';
  } else if (out.state === 'cancel') {
    callMod(st, ctx, 'cancellation', st.orderId, { op: 'cancel-order', orderId: st.orderId, at: out.at, reason: out.reason });
    st.phase = 'ended';                                                            // S15
  } else if (out.state === 'timedOut') {
    st.phase = 'ended';                                                            // R3.2: the end of the order
  }
}

// R4.5: once a fulfilment has ended, the order is told; the order's own outcome comes back from order-progress.
function fulfilmentOut(fid, out, st, ctx) {
  if (!(out.end === 'completed' || out.end === 'failed') || st.ended[fid]) return;
  st.ended[fid] = out.end;
  if (st.phase !== 'processing') return;
  const r = callMod(st, ctx, 'order-progress', st.orderId, { op: 'ended', fulfilmentId: fid, end: out.end, at: out.endedAt });
  orderProgressOut(r, st);
}

function orderProgressOut(out, st) {
  if (out.state === 'ended') {
    st.phase = 'ended';
    st.outcome = out.outcome;
  }
}

// Forward steps (R3.1, R4.1, R4.2), once per transition, at the end of the tick (S10, S9).
function endOfTick(st, ctx) {
  const oid = st.orderId;
  if (st.phase === 'waiting') {
    const r = callMod(st, ctx, 'customer-action', oid, { op: 'advance' });
    customerActionOut(r, st, ctx);
  }
  if (st.phase === 'processing') {
    if (!st.progressReady) {
      st.progressReady = true;
      const fulfilments = st.fulfilments.map(f => ({ fulfilmentId: f.fulfilmentId, available: f.available }));
      orderProgressOut(callMod(st, ctx, 'order-progress', oid, { op: 'ready', orderId: oid, at: st.readyAt, fulfilments }), st);
    }
    for (const f of st.fulfilments) {
      if (st.phase !== 'processing' || !f.available || st.ended[f.fulfilmentId]) continue;
      const fid = f.fulfilmentId;
      if (!st.started[fid]) {
        st.started[fid] = true;
        callMod(st, ctx, 'fulfilment', fid, { op: 'start', orderId: oid, customerId: st.customerId, currency: st.currency,
          edition: st.edition, readyAt: st.readyAt,
          fulfilment: { fulfilmentId: fid, location: f.location, items: f.items, amountMinor: f.amountMinor } });
      }
      fulfilmentOut(fid, callMod(st, ctx, 'fulfilment', fid, { op: 'advance' }), st, ctx);
    }
  }
  if (st.phase === 'ended') {
    // Refresh the busy flags of every module that may still owe a result (the instance stays open until none does).
    callMod(st, ctx, 'statuses', oid, { op: 'get' });
    callMod(st, ctx, 'notices', oid, { op: 'get' });
    for (const fid of Object.keys(st.started)) {
      fulfilmentOut(fid, callMod(st, ctx, 'fulfilment', fid, { op: 'get' }), st, ctx);
    }
  }
}

// §3.5: a migrated order continues from where it stands. Its own records (orders.*) say where that is.
function resumeMigration(ev, input, st, ctx) {
  // the migration payload carries the order; the first order-like reference in it names the case
  const found = (JSON.stringify(ev.payload ?? {}).match(/#?\s*ord-[\w-]+/i) ?? [null])[0];
  const oid = normalise(ev.payload?.orderId ?? ev.payload?.order?.orderId ?? found, ctx);
  if (!oid) return { subject: null, close: true };
  const ord = ctx.query('orders.orders', { where: { orderId: oid }, limit: 1 })[0];
  if (!ord) return resumeUnrecorded(ev, oid, input, st, ctx);
  const rows = ctx.query('orders.fulfilments', { where: { orderId: oid }, limit: 1000 });
  st.orderId = oid;
  st.placedAt = ord.placedAt;
  st.customerId = ord.customerId;
  st.currency = ord.currency;
  st.fulfilments = rows.map(f => ({ fulfilmentId: f.fulfilmentId, location: f.location ?? null, available: migratedAvailable(f),
    items: f.items, amountMinor: f.amountMinor }));
  const intake = callMod(st, ctx, 'intake', oid, { op: 'resume', records: { intake: { order: { orderId: oid, customerId: ord.customerId,
    placedAt: ord.placedAt, currency: ord.currency, items: ord.items }, fulfilments: st.fulfilments, totalMinor: ord.totalMinor } } });
  st.edition = intake.edition ?? null;
  st.phase = 'fraud';
  if (['completed', 'failed', 'cancelled', 'timedOut'].includes(ord.status)) {
    st.phase = 'ended';
    st.outcome = ord.status;
    return { subject: oid, close: true };
  }
  // §3.5: the statuses and notices already on the records count as set and sent (R7.2, §4.8).
  callMod(st, ctx, 'statuses', oid, { op: 'resume', records: { statuses: { order: ord.status,
    fulfilments: rows.map(f => ({ fulfilmentId: f.fulfilmentId, status: f.status })) } } });
  callMod(st, ctx, 'notices', oid, { op: 'resume', customerId: ord.customerId, records: { notices: { sent: sentKeys(oid, rows, ctx) } } });
  if (ord.status === 'customerActionRequired') {
    st.phase = 'waiting';
    // the customer's deadline runs from placedAt (R3.2): the module re-sets its wake-up, its notice was already sent.
    callMod(st, ctx, 'customer-action', oid, { op: 'resume', placedAt: ord.placedAt, edition: st.edition,
      fulfilments: st.fulfilments.map(f => ({ fulfilmentId: f.fulfilmentId, available: f.available })),
      records: { customerAction: { state: 'waiting' } } });
  } else if (ord.status === 'processing') {
    st.phase = 'processing';
    st.readyAt = ord.placedAt;
    st.progressReady = true;
    callMod(st, ctx, 'order-progress', oid, { op: 'resume', records: { progress: { status: 'processing' } } });
    for (const f of st.fulfilments) {
      if (!f.available) continue;
      const row = rows.find(r => r.fulfilmentId === f.fulfilmentId);
      if (row.status === 'completed' || row.status === 'failed') { st.ended[f.fulfilmentId] = row.status; continue; }
      st.started[f.fulfilmentId] = true;
      callMod(st, ctx, 'fulfilment', f.fulfilmentId, { op: 'resume', records: { fulfilment: resumedFulfilment(ord, row, st, ev.at, ctx) } });
    }
  }
  return { subject: oid };
}

// A fulfilment of a migrated order is available when it has a location and has not been cancelled (R3.2).
function migratedAvailable(f) {
  return f.location !== null && f.location !== undefined && f.status !== 'unavailable' && f.status !== 'cancelled';
}

// §3.5: an order not yet recorded whose order.placed is among the export's messages starts as if just placed (R1.1);
// the other messages of the export are then given to it as they would have arrived.
function resumeUnrecorded(ev, oid, input, st, ctx) {
  const msgs = ev.payload?.events ?? [];
  const placed = msgs.find(e => inboundKind(e) === 'placed' && normalise(e.payload?.orderId, ctx) === oid);
  if (!placed) return { subject: oid, close: true };
  const r = startPlaced(placed, st, ctx);
  if (r.close) return r;
  for (const e of msgs) if (e !== placed) handle(e, st, ctx, input);
  return r;
}

// §3.5: the state of a migrated fulfilment that is still open, from the records of the steps that committed.
function resumedFulfilment(ord, row, st, at, ctx) {
  const fid = row.fulfilmentId;
  const reservations = ctx.query('inventory.reservations', { where: { fulfilmentId: fid }, limit: 1000 });
  const charge = ctx.query('billing.charges', { where: { fulfilmentId: fid }, limit: 1 })[0];
  const shipment = ctx.query('carrier.shipments', { where: { fulfilmentId: fid }, limit: 1 })[0];
  const items = {};
  for (const it of row.items) {
    const reserved = reservations.some(r => r.sku === it.sku && r.status === 'active');
    items[it.sku] = { qty: it.qty, st: reserved ? 'ok' : 'none' };
  }
  const collected = !!shipment && ['collected', 'inTransit', 'delivered'].includes(shipment.status);
  // a collection happened before go-live, so it is reported before any cancel that follows (S7)
  const reports = collected ? [{ meaning: shipment.status, reportedAt: shipment.createdAt ?? at }] : [];
  const state = {
    oid: ord.orderId, cust: ord.customerId, cur: ord.currency, edition: st.edition, readyAt: st.readyAt,
    f: { fulfilmentId: fid, location: row.location, items: row.items, amountMinor: row.amountMinor },
    items, charge: charge ? 'ok' : 'none', ship: shipment ? 'ok' : 'none',
    refund: charge && charge.refundedMinor > 0 ? 'done' : 'none',
    dispatched: row.status === 'dispatched', collected,
  };
  return { state, reports };
}

// §3.5: the notices already on the records, as the notices module keys them (template and order or fulfilment id).
function sentKeys(oid, rows, ctx) {
  const about = [oid, ...rows.map(f => f.fulfilmentId)];
  return about.flatMap(id => ctx.query('notify.notifications', { where: { about: id }, limit: 1000 }))
    .map(n => `${n.template}.${n.about}`);
}
