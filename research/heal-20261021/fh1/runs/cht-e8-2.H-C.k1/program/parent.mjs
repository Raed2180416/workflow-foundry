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

// §3.5: a migrated order continues from where it stands. Its own records (orders.*, and the inventory, billing, carrier
// and notify records of its steps) say where that is; the messages it had already received are in the migration's events.
// Every module that owns a step of the order is resumed from those records, since it has no state of its own yet.
function resumeMigration(ev, input, st, ctx) {
  const payload = ev.payload ?? {};
  const inner = Array.isArray(payload.events) ? payload.events : [];
  const placedEv = inner.find(e => inboundKind(e) === 'placed');
  // the first order-like reference in the migration names the case
  const found = (JSON.stringify(payload).match(/#?\s*ord-[\w-]+/i) ?? [null])[0];
  const oid = normalise(payload.orderId ?? payload.order?.orderId ?? placedEv?.payload?.orderId ?? found, ctx);
  if (!oid) return { subject: null, close: true };
  const ord = ctx.query('orders.orders', { where: { orderId: oid }, limit: 1 })[0];
  if (!ord) {
    // placed before go-live but not recorded yet: that placed message is what this instance does first (R1.1)
    if (!placedEv) return { subject: oid, close: true };
    const first = routeFirst(placedEv, input, st, ctx);
    if (first.merge || first.close) return first;
    for (const e of inner) if (e !== placedEv && inboundKind(e) === 'action') routeAction({ eventId: e.id, action: e.payload?.action, at: e.at }, st, ctx);
    return first;
  }
  const rows = ctx.query('orders.fulfilments', { where: { orderId: oid }, limit: 1000 });
  const byFulfilment = table => {
    const groups = {};
    for (const r of ctx.query(table, { where: { orderId: oid }, limit: 1000 })) {
      if (!groups[r.fulfilmentId]) groups[r.fulfilmentId] = [];
      groups[r.fulfilmentId].push(r);
    }
    return groups;
  };
  const reservations = byFulfilment('inventory.reservations');
  const charges = byFulfilment('billing.charges');
  const refunds = byFulfilment('billing.refunds');
  const shipments = byFulfilment('carrier.shipments');
  // the notices already sent for this order and its fulfilments (cancel-refused is keyed by its occurrence: not carried)
  const sent = [oid, ...rows.map(f => f.fulfilmentId)]
    .flatMap(about => ctx.query('notify.notifications', { where: { about }, limit: 1000 }))
    .filter(n => n.template !== 'cancel-refused')
    .map(n => `${n.template}.${n.about}`);
  st.orderId = oid;
  st.placedAt = ord.placedAt;
  st.customerId = ord.customerId;
  st.currency = ord.currency;
  // an unavailable fulfilment has no location (R1.1); an amend later cancels it, so its status is not the test
  st.fulfilments = rows.map(f => ({ fulfilmentId: f.fulfilmentId, location: f.location ?? null, available: (f.location ?? null) !== null,
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
  callMod(st, ctx, 'statuses', oid, { op: 'resume', records: { statuses: { order: ord.status,
    fulfilments: rows.map(f => ({ fulfilmentId: f.fulfilmentId, status: f.status })) } } });
  callMod(st, ctx, 'notices', oid, { op: 'resume', customerId: ord.customerId, records: { notices: { sent } } });
  if (ord.status === 'customerActionRequired') {
    st.phase = 'waiting';
    callMod(st, ctx, 'customer-action', oid, { op: 'resume', records: { customerAction: { state: 'waiting', placedAt: ord.placedAt,
      edition: st.edition, fulfilments: st.fulfilments.map(f => ({ fulfilmentId: f.fulfilmentId, available: f.available })) } } });
  } else if (ord.status === 'processing') {
    st.phase = 'processing';
    st.readyAt = ord.placedAt;
    st.progressReady = true;
    callMod(st, ctx, 'order-progress', oid, { op: 'resume', records: { progress: { status: 'processing' } } });
    for (const f of st.fulfilments) {
      if (!f.available) continue;
      const fid = f.fulfilmentId;
      st.started[fid] = true;
      callMod(st, ctx, 'fulfilment', fid, { op: 'resume', records: { fulfilment: { orderId: oid, customerId: ord.customerId,
        currency: ord.currency, edition: st.edition, readyAt: st.readyAt, at: ev.at ?? ctx.now,
        fulfilment: { fulfilmentId: fid, location: f.location, items: f.items, amountMinor: f.amountMinor },
        status: rows.find(r => r.fulfilmentId === fid)?.status ?? 'pending', reservations: reservations[fid] ?? [],
        charges: charges[fid] ?? [], refunds: refunds[fid] ?? [], shipments: shipments[fid] ?? [] } } });
    }
  }
  return { subject: oid };
}
