// Parent orchestrator (DECOMPOSITION 3): routing, the phases of an order, the order of each tick. Owns SPEC-E 1
// (routing, subject, delivery order), 3.2, 3.5, the 4 preamble, R7.1, S5, S8-S13, S15. It emits no effects itself:
// every system is reached through a module.
//
// Phases: intake (placed, not yet recorded) -> fraud (recorded, not cleared) -> waiting (customer deadline, R3)
// -> processing (ready, R4) -> ended. A customer action in intake is held until the order is recorded (SPEC-E
// section 8, open point; this is the reading chosen here).

const MIN = 60000;
const ENDED_STATUSES = ['completed', 'failed', 'cancelled', 'timedOut'];

export function tick(input, ctx) {
  const events = Array.isArray(input.events) ? input.events : [];
  const self = input.instance;
  let st = input.state ?? null;
  let migrated = null;

  // First tick of an instance started by an inbound message (SPEC-E 1 Routing, 3.5).
  if (st === null) {
    const first = events[0];
    const kind = first ? kindOf(first) : 'other';
    if (kind === 'placed') {
      const oid = normalise(ctx, first.payload?.orderId);
      if (!oid) return { decisions: { subject: null }, close: true };
      const other = openOther(ctx, oid, self);
      if (other) return { decisions: { subject: oid }, merge: { into: other } };
      if (ctx.query('orders.orders', { where: { orderId: oid }, limit: 1 }).length > 0) {
        return { decisions: { subject: oid }, close: true };
      }
      st = newState(oid, first.at);
    } else if (kind === 'action') {
      const oid = normalise(ctx, first.payload?.orderRef);
      const other = oid ? openOther(ctx, oid, self) : null;
      if (other) return { decisions: { subject: oid }, merge: { into: other } };
      return { decisions: { subject: oid }, close: true };
    } else if (kind === 'carrier') {
      const ref = first.payload?.fulfilmentRef;
      const rows = ref ? ctx.query('orders.fulfilments', { where: { fulfilmentId: ref }, limit: 1 }) : [];
      const oid = rows.length > 0 ? normalise(ctx, rows[0].orderId) : null;
      const other = oid ? openOther(ctx, oid, self) : null;
      if (other) return { decisions: { subject: oid }, merge: { into: other } };
      return { decisions: { subject: oid }, close: true };
    } else if (kind === 'migration') {
      const oid = normalise(ctx, first.payload?.orderId ?? first.payload?.order?.orderId);
      const rows = oid ? ctx.query('orders.orders', { where: { orderId: oid }, limit: 1 }) : [];
      if (rows.length === 0) return { decisions: { subject: oid }, close: true };
      st = newState(oid, rows[0].placedAt);
      migrated = rows[0];
    } else {
      return { decisions: { subject: null }, close: true };
    }
  }

  // Every call to a module goes through here: its busy flag is kept and its output drives the phase.
  function call(mod, key, inp) {
    const o = ctx.call(mod, key, inp);
    st.busy[`${mod}/${key}`] = !!(o && o.busy);
    onOutput(mod, key, o);
    return o;
  }

  function deliver(ev) {
    const owner = ctx.ownerOf(ev);
    if (!owner) return;
    const o = ctx.deliver(ev);
    st.busy[`${owner.module}/${owner.key}`] = !!(o && o.busy);
    onOutput(owner.module, owner.key, o);
  }

  function onOutput(mod, key, o) {
    if (!o) return;
    if (mod === 'intake') {
      if (o.status === 'recorded' && !o.duplicate && st.phase === 'intake') recordOrder(o);
    } else if (mod === 'fraud') {
      if (st.phase !== 'fraud') return;
      if (o.state === 'cleared') clearing(o.at);
      else if (o.state === 'cancel') cancelOrder(o.reason, o.at);
    } else if (mod === 'customer-action') {
      if (st.phase === 'ended') return;
      if (o.state === 'ready' && st.phase === 'waiting') toProcessing(o.at);
      else if (o.state === 'cancel') cancelOrder(o.reason, o.at);
      else if (o.state === 'timedOut') setEnded();
    } else if (mod === 'fulfilment') {
      const sg = st.sagas[key];
      if (!sg) return;
      sg.end = o.end ?? null;
      sg.failing = !!o.failing;
      if ((o.end === 'completed' || o.end === 'failed') && !sg.told) {
        sg.told = true;
        call('order-progress', st.orderId, { op: 'ended', fulfilmentId: key, end: o.end, at: o.endedAt });
      }
    } else if (mod === 'order-progress') {
      if (o.state === 'ended') setEnded();
    } else if (mod === 'cancellation') {
      if (o.verdict === 'counts') setEnded();
    }
  }

  // R1.1 / R1.4: the order is recorded; statuses, notices, the customer clock and the fraud check start.
  function recordOrder(o) {
    st.recorded = true;
    st.customerId = o.customerId;
    st.currency = o.currency;
    st.placedAt = o.placedAt;
    st.edition = o.edition;
    st.fulfilments = o.fulfilments.map(f => ({ fulfilmentId: f.fulfilmentId, location: f.location, available: f.available, items: f.items, amountMinor: f.amountMinor }));
    st.hasUnavailable = st.fulfilments.some(f => !f.available);
    st.phase = 'fraud';
    call('statuses', st.orderId, { op: 'init', fulfilments: st.fulfilments.map(f => ({ fulfilmentId: f.fulfilmentId, location: f.location })) });
    call('notices', st.orderId, { op: 'init', customerId: st.customerId });
    if (st.hasUnavailable) call('customer-action', st.orderId, { op: 'start', placedAt: st.placedAt, edition: st.edition, fulfilments: availability() });
    call('fraud', st.orderId, { op: 'start', placedAt: st.placedAt, edition: st.edition });
    const held = st.held;
    st.held = [];
    for (const a of held) routeAction(a);
  }

  // R2.1 / R3.1: the order is cleared at c. Without unavailable items it is ready at once (R4.1).
  function clearing(c) {
    st.clearedAt = c;
    if (!st.hasUnavailable) return toProcessing(c);
    const o = call('customer-action', st.orderId, { op: 'cleared', at: c });
    if (o.state === 'waiting') st.phase = 'waiting';
    else if (o.state === 'ready') toProcessing(c);
  }

  function toProcessing(at) {
    if (st.phase !== 'waiting' && st.phase !== 'fraud') return;
    st.phase = 'processing';
    st.readyAt = at;
  }

  // A cancel that counts, or a fraud rejection: the order is decided (S15). Fraud and the customer clock stop.
  function cancelOrder(reason, at) {
    if (st.phase === 'ended') return;
    call('cancellation', st.orderId, { op: 'cancel-order', at, reason, customerId: st.customerId });
    setEnded();
  }

  function setEnded() {
    if (st.phase === 'ended') return;
    st.phase = 'ended';
    call('fraud', st.orderId, { op: 'stop' });
    if (st.hasUnavailable) call('customer-action', st.orderId, { op: 'stop' });
  }

  // Customer actions by phase (SPEC-E 3.2, R3.2, R6.2-R6.4, S5, S8, S11, S15).
  function routeAction(a) {
    if (st.phase === 'ended') return;
    if (st.phase === 'intake') { st.held.push(a); return; }
    if (a.action === 'cancel') {
      if (st.phase === 'fraud') {
        call('cancellation', st.orderId, { op: 'customer-cancel', at: a.at, eventId: a.id, phase: 'not-cleared', customerId: st.customerId });
      } else if (st.phase === 'waiting') {
        call('customer-action', st.orderId, { op: 'action', action: 'cancel', at: a.at });
      } else if (st.phase === 'processing') {
        call('cancellation', st.orderId, { op: 'customer-cancel', at: a.at, eventId: a.id, phase: 'processing', customerId: st.customerId });
      }
    } else if (a.action === 'amend') {
      if ((st.phase === 'fraud' && st.hasUnavailable) || st.phase === 'waiting') {
        call('customer-action', st.orderId, { op: 'action', action: 'amend', at: a.at });
      }
    }
  }

  // 3.3: a carrier report for one of our shipments goes to its fulfilment saga.
  function routeCarrier(ev) {
    const fid = ev.payload?.fulfilmentRef;
    if (!fid || !st.sagas[fid]) return;
    call('fulfilment', fid, {
      op: 'carrier',
      message: { code: ev.payload.code, reportedAt: ev.payload.reportedAt, carrier: ev.payload.carrier ?? null, shipmentId: ev.payload.shipmentId ?? null },
      at: ev.at,
    });
  }

  // End of tick: the only place where forward steps are emitted (S9, S10). Nothing once the order has ended.
  function endOfTick() {
    if (st.phase === 'waiting') {
      call('customer-action', st.orderId, { op: 'advance' });
      return;
    }
    if (st.phase !== 'processing') return;
    const avail = st.fulfilments.filter(f => f.available);
    if (!st.progress) {
      st.progress = true;
      call('order-progress', st.orderId, { op: 'ready', at: st.readyAt, fulfilments: availability() });
    }
    for (const f of avail) {
      if (st.phase !== 'processing') return;
      if (st.sagas[f.fulfilmentId]) continue;
      st.sagas[f.fulfilmentId] = { end: null, failing: false, told: false };
      call('fulfilment', f.fulfilmentId, {
        op: 'start', orderId: st.orderId, customerId: st.customerId, currency: st.currency, edition: st.edition,
        readyAt: st.readyAt,
        fulfilment: { fulfilmentId: f.fulfilmentId, location: f.location, items: f.items, amountMinor: f.amountMinor },
      });
    }
    for (const f of avail) {
      if (st.phase !== 'processing') return;
      const sg = st.sagas[f.fulfilmentId];
      if (!sg || sg.end) continue;
      call('fulfilment', f.fulfilmentId, { op: 'advance' });
    }
  }

  function availability() {
    return st.fulfilments.map(f => ({ fulfilmentId: f.fulfilmentId, available: f.available }));
  }

  // 3.5: a migrated order continues from where it stands (its records say the phase and the steps done).
  function resumeMigration(o) {
    const oid = st.orderId;
    const rows = ctx.query('orders.fulfilments', { where: { orderId: oid }, limit: 20 });
    st.recorded = true;
    st.customerId = o.customerId;
    st.currency = o.currency;
    st.placedAt = o.placedAt;
    st.edition = chooseEdition(ctx.files, o.placedAt);
    st.fulfilments = rows.map(r => {
      const location = r.location ?? null;
      return { fulfilmentId: r.fulfilmentId, location, available: location !== null && r.status !== 'unavailable', items: r.items ?? [], amountMinor: r.amountMinor ?? 0, status: r.status };
    });
    st.hasUnavailable = st.fulfilments.some(f => !f.available);
    call('statuses', oid, { op: 'init', orderStatus: o.status, fulfilments: st.fulfilments.map(f => ({ fulfilmentId: f.fulfilmentId, location: f.location, status: f.status })) });
    call('notices', oid, { op: 'init', customerId: st.customerId });
    if (st.hasUnavailable) {
      call('customer-action', oid, { op: 'start', placedAt: st.placedAt, edition: st.edition, fulfilments: availability(), resumed: o.status !== 'pending' });
    }
    if (o.status === 'pending') {
      st.phase = 'fraud';
      call('fraud', oid, { op: 'start', placedAt: st.placedAt, edition: st.edition });
    } else if (o.status === 'customerActionRequired') {
      st.phase = 'waiting';
      call('customer-action', oid, { op: 'cleared', at: st.placedAt });
    } else if (o.status === 'processing') {
      st.phase = 'processing';
      st.readyAt = st.placedAt;
      st.progress = true;
      call('order-progress', oid, { op: 'ready', at: st.readyAt, fulfilments: availability() });
      for (const f of st.fulfilments.filter(x => x.available)) {
        st.sagas[f.fulfilmentId] = { end: null, failing: false, told: false };
        const records = {
          reservations: ctx.query('inventory.reservations', { where: { fulfilmentId: f.fulfilmentId }, limit: 200 }),
          charge: ctx.query('billing.charges', { where: { fulfilmentId: f.fulfilmentId }, limit: 1 })[0] ?? null,
          shipment: ctx.query('carrier.shipments', { where: { fulfilmentId: f.fulfilmentId }, limit: 1 })[0] ?? null,
        };
        call('fulfilment', f.fulfilmentId, {
          op: 'resume', orderId: oid, customerId: st.customerId, currency: st.currency, edition: st.edition, readyAt: st.readyAt,
          status: f.status, records,
          fulfilment: { fulfilmentId: f.fulfilmentId, location: f.location, items: f.items, amountMinor: f.amountMinor },
        });
      }
    } else {
      st.phase = 'ended';
    }
  }

  if (migrated !== null) resumeMigration(migrated);

  for (const ev of events) {
    const k = kindOf(ev);
    if (k === 'owned') deliver(ev);
    else if (k === 'placed') { if (st.orderId) call('intake', st.orderId, { op: 'placed', order: placedOrder(ev) }); }
    else if (k === 'action') routeAction({ action: ev.payload?.action, at: ev.at, id: ev.id });
    else if (k === 'carrier') routeCarrier(ev);
  }

  if (st.phase !== 'ended') endOfTick();

  const out = { decisions: { subject: st.orderId ?? null }, state: st };
  if (st.phase === 'ended' && !Object.values(st.busy).some(Boolean)) out.close = true;
  return out;

  function placedOrder(ev) {
    return {
      orderId: st.orderId,
      customerId: ev.payload?.customerId,
      placedAt: ev.at,
      currency: ev.payload?.currency ?? 'EUR',
      items: ev.payload?.items,
    };
  }
}

function newState(oid, at) {
  return {
    phase: 'intake', orderId: oid, placedAt: at ?? null, customerId: null, currency: null, edition: null,
    recorded: false, hasUnavailable: false, fulfilments: [], clearedAt: null, readyAt: null,
    held: [], progress: false, sagas: {}, busy: {},
  };
}

function kindOf(ev) {
  const t = String(ev.type ?? '');
  const src = String(ev.source ?? '');
  if (t === 'migration') return 'migration';
  if (t === 'effect.result' || t === 'timer.fired' || t.startsWith('humanTask.')) return 'owned';
  if (t === 'order.placed' || src === 'shop') return 'placed';
  if (t === 'customer.action' || src === 'customer-portal') return 'action';
  if (t === 'carrier.status' || src === 'carrier') return 'carrier';
  return 'other';
}

function normalise(ctx, raw) {
  if (raw === undefined || raw === null) return null;
  return ctx.call('order-id', 'n', { raw: String(raw) }).orderId;
}

// The other open instance that declared this order as its subject (SPEC-E 1 Routing), if any.
function openOther(ctx, oid, self) {
  if (!oid) return null;
  for (const x of ctx.instances({ subject: oid }) ?? []) {
    const id = typeof x === 'string' ? x : x?.instance;
    if (id && id !== self) return id;
  }
  return null;
}

// R1.3 (the parent needs it to resume a migrated order): the published edition in force at the date of `at`.
function chooseEdition(files, at) {
  const day = amsDate(at);
  let best = null;
  let bestFrom = '';
  for (const k of Object.keys(files ?? {})) {
    const m = /^rulebook\/([^/]+)\/edition\.json$/.exec(k);
    if (!m) continue;
    const v = files[k];
    const e = typeof v === 'string' ? JSON.parse(v) : v;
    const from = String(e?.effectiveFrom ?? '').slice(0, 10);
    if (from <= day && from >= bestFrom) { best = m[1]; bestFrom = from; }
  }
  if (best === null) throw new Error(`no edition in force at ${at}`);
  return best;
}

function amsDate(iso) {
  const t = Date.parse(iso);
  const y = new Date(t).getUTCFullYear();
  const lastSunday = mo => { const d = new Date(Date.UTC(y, mo + 1, 0)); return d.getUTCDate() - d.getUTCDay(); };
  const off = t >= Date.UTC(y, 2, lastSunday(2), 1) && t < Date.UTC(y, 9, lastSunday(9), 1) ? 120 : 60;
  return new Date(t + off * MIN).toISOString().slice(0, 10);
}
