// parent (SPEC-E §1 routing, §3, §4.1 R1.4, §4.4 R4.1 and R4.5, §4.6 R6, §4.7 R7.2, §5 S4, S7, S11, S13, S15): the
// orchestrator of one order's instance. It routes the case's events to the sub-workflows, keeps the order-level state
// (stage, which fulfilments are terminal, the earliest collection report), and sets the order's own status. The
// sub-workflows are: intake (R1, R2.1), review (R2.2), window (R3), saga (one per fulfilment, R4.2 to R5), notice (§4.8).

const AMS = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Amsterdam', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const wall = t => Object.fromEntries(AMS.formatToParts(new Date(Math.floor(t / 1000) * 1000)).filter(x => x.type !== 'literal').map(x => [x.type, x.value]));
const dayOf = t => { const p = wall(t); return `${p.year}-${p.month}-${p.day}`; };
const ms = s => new Date(s).getTime();
const norm = v => { let s = String(v ?? '').trim(); if (s.startsWith('#')) s = s.slice(1); return s.trim().toUpperCase(); };
const clone = v => JSON.parse(JSON.stringify(v));

const fileJson = (files, p) => {
  let v = files?.[p];
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { v = null; } }
  return v ?? null;
};

function editionAt(files, t) {
  const day = dayOf(t);
  let best = null;
  for (const k of Object.keys(files ?? {})) {
    const m = /^rulebook\/([^/]+)\/edition\.json$/.exec(k);
    const e = m ? fileJson(files, k) : null;
    if (!e || typeof e.effectiveFrom !== 'string') continue;
    const from = e.effectiveFrom.slice(0, 10);
    if (from <= day && (!best || from > best.from)) best = { dir: m[1], from };
  }
  if (!best) throw new Error('parent: no rulebook edition in force');
  return best.dir;
}

// The carrier's own code, translated with the edition's table; an unlisted code is info (no action).
function meaningOf(files, ed, carrier, code) {
  const t = fileJson(files, `rulebook/${ed}/carrier-codes.json`);
  const hit = Array.isArray(t) ? t.find(r => r.code === code && (r.carrier === undefined || r.carrier === carrier)) : (t?.[carrier]?.[code] ?? t?.[code]);
  const m = typeof hit === 'string' ? hit : hit?.meaning;
  return ['collected', 'inTransit', 'delivered', 'collectionFailed'].includes(m) ? m : 'info';
}

const fk = (oid, fid) => `${oid}.${String(fid).replace(/\//g, '|')}`;
const TERM = { completed: 'completed', failed: 'failed', cancelled: 'cancelled' };
const orderStatus = (oid, status, key) => ({ key, system: 'orders', op: 'setStatus', args: { orderId: oid, fulfilmentId: null, status } });
const fulfStatus = (oid, fid, status, key) => ({ key, system: 'orders', op: 'setStatus', args: { orderId: oid, fulfilmentId: fid, status } });

const fresh = oid => ({
  id: oid, stage: 'recording', started: false, recorded: false, pc: false,
  cust: null, cur: null, p: null, ed: null, fulfs: {}, colAt: null, end: null, why: null,
});

function orderRecord(ctx, oid) {
  return ctx.query('orders.orders', { where: { orderId: oid }, limit: 1 })[0] ?? null;
}

// An open instance of the same order to merge into. A placed order merges only into an older instance, so two
// instances that start together do not merge into each other.
function openOther(oid, input, ctx, placed) {
  for (const x of ctx.instances({ subject: oid }) ?? []) {
    const id = typeof x === 'string' ? x : x?.instance;
    if (!id || id === input.instance) continue;
    if (placed && !(id < input.instance)) continue;
    return id;
  }
  return null;
}

// --- the first tick of an instance: which order it works on, and whether it belongs to a case already running
function begin(input, ctx, eff) {
  const first = (input.events ?? [])[0] ?? null;
  const sub = first?.payload ?? {};
  if (first?.type === 'order.placed') {
    const oid = norm(sub.orderId);
    const into = openOther(oid, input, ctx, true);
    if (into) return { ret: { decisions: { subject: oid }, merge: { into }, effects: [] } };
    if (orderRecord(ctx, oid)) return { ret: { decisions: { subject: oid }, close: true, effects: [] } };
    return { S: fresh(oid) };
  }
  if (first?.type === 'customer.action') {
    const oid = norm(sub.orderRef);
    const into = openOther(oid, input, ctx, false);
    if (into) return { ret: { decisions: { subject: oid }, merge: { into }, effects: [] } };
    // An action that names no order (or an order placed in this same instant) changes nothing (S11).
    return { ret: { decisions: { subject: orderRecord(ctx, oid) ? oid : null }, close: true, effects: [] } };
  }
  if (first?.type === 'carrier.status') {
    const rec = ctx.query('orders.fulfilments', { where: { fulfilmentId: sub.fulfilmentRef }, limit: 1 })[0];
    if (!rec) return { ret: { decisions: { subject: null }, close: true, effects: [] } };
    const oid = norm(rec.orderId);
    const into = openOther(oid, input, ctx, false);
    if (into) return { ret: { decisions: { subject: oid }, merge: { into }, effects: [] } };
    return { ret: { decisions: { subject: oid }, close: true, effects: [] } };
  }
  if (first?.type === 'migration') {
    const oid = norm(sub.orderId ?? sub.orderRef);
    const rec = orderRecord(ctx, oid);
    if (!rec) return { ret: { decisions: { subject: null }, close: true, effects: [] } };
    const S = fresh(oid);
    adopt(S, rec, sub, ctx, eff);
    return { S };
  }
  return { ret: { decisions: { subject: null }, close: true, effects: [] } };
}

// Go-live (§3.5): continue an order already in flight from its records, under the same rules.
function adopt(S, rec, sub, ctx, eff) {
  S.started = true;
  S.recorded = true;
  S.cust = rec.customerId;
  S.cur = rec.currency;
  S.p = rec.placedAt;
  S.ed = editionAt(ctx.files, ms(rec.placedAt));
  for (const f of ctx.query('orders.fulfilments', { where: { orderId: S.id }, limit: 50 })) {
    const loc = f.location ?? null;
    S.fulfs[f.fulfilmentId] = {
      loc, avail: loc !== null && f.status !== 'unavailable', items: f.items, amt: f.amountMinor, st: f.status,
      term: TERM[f.status] ?? (f.status === 'unavailable' && rec.status !== 'customerActionRequired' ? 'cancelled' : null),
    };
  }
  const st = rec.status;
  if (['completed', 'failed', 'cancelled', 'timedOut'].includes(st)) {
    S.stage = 'ended';
    S.end = st;
    for (const f of Object.values(S.fulfs)) if (!f.term) f.term = 'cancelled';
    return;
  }
  if (st === 'customerActionRequired') {
    S.stage = 'waiting';
    const ids = Object.keys(S.fulfs);
    ctx.call('window', S.id, {
      op: 'open', orderId: S.id, p: rec.placedAt, customerId: S.cust,
      unavailable: ids.filter(f => !S.fulfs[f].avail), available: ids.filter(f => S.fulfs[f].avail),
    });
    return;
  }
  if (st === 'processing') {
    S.stage = 'processing';
    for (const [fid, f] of Object.entries(S.fulfs)) {
      if (!f.avail || f.term) continue;
      const args = { orderId: S.id, fid, location: f.loc, items: f.items, amountMinor: f.amt, customerId: S.cust, currency: S.cur };
      if (f.st === 'pending') { ctx.call('saga', fk(S.id, fid), { op: 'start', ...args }); continue; }
      const ships = ctx.query('carrier.shipments', { where: { fulfilmentId: fid }, limit: 50 });
      const rows = {
        charged: ctx.query('billing.charges', { where: { fulfilmentId: fid }, limit: 50 }).length > 0,
        reservedSkus: ctx.query('inventory.reservations', { where: { fulfilmentId: fid, status: 'active' }, limit: 200 }).map(r => r.sku),
        ship: ships.at(-1)?.status ?? null,
        dispatched: f.st === 'dispatched',
        fstatus: f.st,
      };
      onOut(S, 'saga', ctx.call('saga', fk(S.id, fid), { op: 'resume', ...args, rows }), ctx, eff);
    }
    for (const m of sub.messages ?? []) carrier(S, m, ctx, eff);
    outcome(S, eff);
    return;
  }
  // pending: the order is recorded but not cleared; its fraud review is taken again from now (approximation).
  S.stage = 'review';
  ctx.call('review', S.id, { op: 'open', orderId: S.id, p: rec.placedAt });
}

function handle(S, ev, ctx, eff) {
  if (ev.type === 'order.placed') {
    if (S.started) return;                       // a repeat of the order: no effect (R1.4)
    S.started = true;
    return placed(S, ev, ctx, eff);
  }
  if (ev.type === 'customer.action') return action(S, ev, ctx, eff);
  if (ev.type === 'carrier.status') return carrier(S, ev.payload, ctx, eff);
  if (ev.type === 'effect.result' || ev.type === 'timer.fired' || String(ev.type).startsWith('humanTask.')) {
    const own = ctx.ownerOf(ev);
    if (own) onOut(S, own.module, ctx.deliver(ev), ctx, eff);
  }
}

function placed(S, ev, ctx, eff) {
  const p = ev.payload;
  S.cust = p.customerId;
  S.cur = p.currency;
  S.p = p.placedAt;
  const out = ctx.call('intake', S.id, {
    op: 'place',
    order: { orderId: S.id, customerId: p.customerId, placedAt: p.placedAt, currency: p.currency, items: p.items },
  });
  onOut(S, 'intake', out, ctx, eff);
}

function onOut(S, mod, out, ctx, eff) {
  if (!out) return;
  if (mod === 'intake') return recorded(S, out, ctx, eff);
  if (mod === 'review') return reviewed(S, out, ctx, eff);
  if (mod === 'window') return windowed(S, out, ctx, eff);
  if (mod === 'saga') {
    const f = S.fulfs[out.fid];
    if (f && out.term && !f.term) {
      f.term = out.term;
      if (out.term === 'failed') notify(ctx, S, 'fulfilment-failed', out.fid);
      outcome(S, eff);
    }
  }
}

// §4.8: the notice goes out once, from the instance that decided it; its key is derived from the template and subject.
function notify(ctx, S, template, about) {
  ctx.call('notice', S.id, { template, about, customerId: S.cust, orderId: S.id });
}

// The order is recorded (R1.1). Its verdict decides what follows (R2.1); a cancel that arrived before it counts (R6.4).
function recorded(S, out, ctx, eff) {
  if (out.status !== 'recorded' || S.recorded) return;
  S.recorded = true;
  S.ed = out.edition;
  for (const f of out.fulfilments) {
    S.fulfs[f.fulfilmentId] = { loc: f.location, avail: f.available, items: f.items, amt: f.amountMinor, term: null };
  }
  if (out.verdict === 'reject') return cancelOrder(S, 'fraud', ctx, eff);
  if (S.pc) return cancelOrder(S, 'customer', ctx, eff);
  if (out.verdict === 'review') {
    S.stage = 'review';
    ctx.call('review', S.id, { op: 'open', orderId: S.id, p: S.p });
    return;
  }
  return clear(S, ctx, eff);
}

function reviewed(S, out, ctx, eff) {
  if (S.stage !== 'review') return;
  if (out.decision === 'approve') return clear(S, ctx, eff);
  if (out.decision === 'reject') return cancelOrder(S, 'fraud', ctx, eff);
  if (out.decision === 'timeout') return cancelOrder(S, 'fraud-review-timeout', ctx, eff);
}

// The order is cleared: with an unavailable item the customer's window opens (R3.1), otherwise it is ready (R4.1).
function clear(S, ctx, eff) {
  const ids = Object.keys(S.fulfs);
  const unavailable = ids.filter(f => !S.fulfs[f].avail);
  if (unavailable.length) {
    S.stage = 'waiting';
    ctx.call('window', S.id, {
      op: 'open', orderId: S.id, p: S.p, customerId: S.cust,
      unavailable, available: ids.filter(f => S.fulfs[f].avail),
    });
    notify(ctx, S, 'action-required', S.id);
    return;
  }
  return ready(S, ctx, eff);
}

// Ready: the order and each available fulfilment are processing; each fulfilment's saga starts (R4.1, R4.2).
function ready(S, ctx, eff) {
  S.stage = 'processing';
  eff.push(orderStatus(S.id, 'processing', `ord-processing-${S.id}`));
  for (const fid of Object.keys(S.fulfs)) {
    const f = S.fulfs[fid];
    if (!f.avail) continue;
    ctx.call('saga', fk(S.id, fid), {
      op: 'start', orderId: S.id, fid, location: f.loc, items: f.items, amountMinor: f.amt, customerId: S.cust, currency: S.cur,
    });
  }
}

function windowed(S, out, ctx, eff) {
  if (!out || S.stage !== 'waiting') return;
  if (out.decision === 'amend') {
    for (const fid of Object.keys(S.fulfs)) if (!S.fulfs[fid].avail) S.fulfs[fid].term = 'cancelled';
    if (!Object.values(S.fulfs).some(f => f.avail)) return cancelOrder(S, 'nothing-available', ctx, eff);
    return ready(S, ctx, eff);
  }
  if (out.decision === 'cancel') return cancelOrder(S, 'customer', ctx, eff);
  if (out.decision === 'timeout') {
    S.stage = 'ended';
    S.end = 'timedOut';
    for (const f of Object.values(S.fulfs)) f.term = 'cancelled';
    notify(ctx, S, 'order-timed-out', S.id);
  }
}

// A cancel that counts (R6.1, R6.2, R6.4, R3.2): stop the order. A processing fulfilment is compensated by its saga,
// which sets it cancelled; the others are cancelled here. The order is cancelled and the customer told (S15).
function cancelOrder(S, reason, ctx, eff) {
  if (S.stage === 'ended') return;
  const was = S.stage;
  S.stage = 'ended';
  S.end = 'cancelled';
  S.why = reason;
  if (was === 'review') ctx.call('review', S.id, { op: 'stop' });
  if (was === 'waiting') ctx.call('window', S.id, { op: 'stop' });
  for (const fid of Object.keys(S.fulfs)) {
    const f = S.fulfs[fid];
    if (f.term) continue;
    if (was === 'processing' && f.avail) { ctx.call('saga', fk(S.id, fid), { op: 'cancel' }); continue; }
    f.term = 'cancelled';
    eff.push(fulfStatus(S.id, fid, 'cancelled', `fx-${S.id}-${fid}`));
  }
  eff.push(orderStatus(S.id, 'cancelled', `ord-cancelled-${S.id}`));
  ctx.call('notice', S.id, { template: 'order-cancelled', about: S.id, customerId: S.cust, orderId: S.id });
}

// R4.5: once every fulfilment of a processing order is completed, failed or cancelled.
function outcome(S, eff) {
  if (S.stage !== 'processing') return;
  const ts = Object.values(S.fulfs).map(f => f.term);
  if (ts.some(t => !t)) return;
  const end = ts.includes('completed') ? 'completed' : ts.includes('failed') ? 'failed' : 'cancelled';
  S.stage = 'ended';
  S.end = end;
  eff.push(orderStatus(S.id, end, `ord-end-${S.id}`));
}

// The customer's actions (§3.2, R3.2, R6.2-R6.4). A cancel of a processing order counts unless a collection was
// reported at or before it (S4, S7): then it is refused.
function action(S, ev, ctx, eff) {
  const a = ev.payload?.action;
  const at = ev.at;
  if (S.stage === 'ended') return;
  if (a === 'cancel') {
    if (!S.recorded) { S.pc = true; return; }
    if (S.stage === 'review') return cancelOrder(S, 'customer', ctx, eff);
    if (S.stage === 'waiting') return windowed(S, ctx.call('window', S.id, { op: 'act', action: 'cancel', at }), ctx, eff);
    if (S.stage === 'processing') {
      if (S.colAt !== null && S.colAt <= ms(at)) return refuse(S, ctx);
      return cancelOrder(S, 'customer', ctx, eff);
    }
    return;
  }
  if (a === 'amend' && S.stage === 'waiting') {
    return windowed(S, ctx.call('window', S.id, { op: 'act', action: 'amend', at }), ctx, eff);
  }
}

function refuse(S, ctx) {
  ctx.call('notice', S.id, { template: 'cancel-refused', about: S.id, customerId: S.cust, orderId: S.id });
}

// A carrier message about one of this order's fulfilments (§3.3). Collection, transit and delivery reports are
// remembered by when they were reported (S7).
function carrier(S, p, ctx, eff) {
  const f = S.fulfs[p?.fulfilmentRef];
  if (!f || !f.avail) return;
  const m = meaningOf(ctx.files, S.ed, p.carrier, p.code);
  if (m === 'collected' || m === 'inTransit' || m === 'delivered') {
    const at = ms(p.reportedAt);
    S.colAt = S.colAt === null ? at : Math.min(S.colAt, at);
  }
  onOut(S, 'saga', ctx.call('saga', fk(S.id, p.fulfilmentRef), { op: 'carrier', meaning: m, reportedAt: p.reportedAt }), ctx, eff);
}

// The API may rename a field (api/<system>.schema.json in ctx.files shows the current names): each field is sent under
// the name the current schema gives it, matched by type when it is the only one left.
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const squash = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const words = s => s.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const near = (a, b) => {
  if (squash(a) === squash(b)) return 3;
  if (squash(a).includes(squash(b)) || squash(b).includes(squash(a))) return 2;
  return words(a).filter(w => words(b).includes(w)).length;
};
function fit(ctx, system, op, args) {
  let api = ctx.files?.[`api/${system}.schema.json`];
  if (typeof api === 'string') { try { api = JSON.parse(api); } catch { api = null; } }
  const props = api?.ops?.[op]?.args?.properties;
  if (!props || !args || Object.keys(args).every(k => hasOwn(props, k))) return args;
  const spare = Object.keys(props).filter(k => !hasOwn(args, k));
  const out = {};
  for (const k of Object.keys(args)) {
    if (hasOwn(props, k)) { out[k] = args[k]; continue; }
    const t = typeof args[k] === 'number' ? ['integer', 'number'] : [typeof args[k]];
    const ok = spare.filter(s => [].concat(props[s].type ?? []).some(x => t.includes(x)));
    const scored = ok.map(s => [near(k, s), s]).sort((a, b) => b[0] - a[0]);
    const pick = scored.length && scored[0][0] > 0 && (scored.length === 1 || scored[1][0] < scored[0][0]) ? scored[0][1] : (ok.length === 1 ? ok[0] : null);
    if (pick) { out[pick] = args[k]; spare.splice(spare.indexOf(pick), 1); } else out[k] = args[k];
  }
  return out;
}
const fitResult = (ctx, r) => (r && Array.isArray(r.effects) ? { ...r, effects: r.effects.map(e => ({ ...e, args: fit(ctx, e.system, e.op, e.args) })) } : r);

function tickImpl(input, ctx) {
  const eff = [];
  let S = input.state ? clone(input.state) : null;
  if (!S) {
    const b = begin(input, ctx, eff);
    if (b.ret) return b.ret;
    S = b.S;
  }
  for (const ev of input.events ?? []) handle(S, ev, ctx, eff);
  const done = S.stage === 'ended' && Object.values(S.fulfs).every(f => f.term);
  return { decisions: { subject: S.id }, state: S, effects: eff, ...(done ? { close: true } : {}) };
}

export function tick(input, ctx) { return fitResult(ctx, tickImpl(input, ctx)); }
