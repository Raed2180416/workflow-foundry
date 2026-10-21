// The order process (SPEC-E): routes every event of the instance to the module that owns the decision, and runs the
// settle pass once per tick. Subject = the normalised order id (§3.1). One instance per order.

const norm = x => String(x ?? '').trim().replace(/^#/, '').trim().toUpperCase();
const fileJson = (files, p) => {
  let v = files?.[p];
  if (v === undefined) v = p.split('/').reduce((o, k) => (o ? o[k] : undefined), files);
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { return null; } }
  return v ?? null;
};
const deepFind = (v, key, d = 0) => {
  if (!v || typeof v !== 'object' || d > 8) return undefined;
  if (!Array.isArray(v) && key in v) return v[key];
  for (const x of Object.values(v)) { const r = deepFind(x, key, d + 1); if (r !== undefined) return r; }
  return undefined;
};

// R1.3: the published edition with the latest effectiveFrom on or before the date of the order (its own local date)
function editionAt(files, at) {
  const day = at.slice(0, 10);
  let best = null;
  for (const k of Object.keys(files ?? {})) {
    const m = /^rulebook\/([^/]+)\/edition\.json$/.exec(k);
    if (!m) continue;
    const e = fileJson(files, k);
    if (!e?.effectiveFrom || e.effectiveFrom > day) continue;
    if (!best || e.effectiveFrom > best.from) best = { dir: m[1], from: e.effectiveFrom };
  }
  if (!best) throw new Error(`no edition in force on ${day}`);
  return best.dir;
}

// the carrier's own code → one meaning (§3.3); a code the table does not list is info
const COLLECTED = ['collected', 'inTransit', 'delivered'];
function meaningOf(files, ed, code) {
  const t = fileJson(files, `rulebook/${ed}/carrier-codes.json`);
  if (Array.isArray(t)) { const row = t.find(r => r.code === code); return row ? (deepFind(row, 'meaning') ?? 'info') : 'info'; }
  return t?.[code] ?? 'info';
}

const inbound = e => e.channel?.kind === 'inbound';
const kindOf = e => {
  if (e.source === 'shop') return 'placed';
  if (e.source === 'customer-portal') return 'action';
  if (e.source === 'carrier') return 'carrier';
  return null;
};

export function tick(input, ctx) {
  const files = ctx.files;
  let st = input.state ?? { o: null, ed: null, p: null, ord: null, al: false, fids: [], v: null, pc: null };
  const events = input.events ?? [];

  // An inbound message starts a new instance: it belongs to an open case (merge), to a closed one (close), or is new.
  const first = events[0];
  if (!st.o && first && inbound(first)) {
    let sub = null;
    if (kindOf(first) === 'placed') sub = norm(first.payload.orderId);
    else if (kindOf(first) === 'action') sub = norm(first.payload.orderRef);
    else if (kindOf(first) === 'carrier') {
      const rows = ctx.query('orders.fulfilments', { where: { fulfilmentId: norm(first.payload.fulfilmentRef) }, limit: 1 });
      sub = rows[0] ? norm(rows[0].orderId) : null;
    }
    if (!sub) return { decisions: { subject: null, phase: 'none' }, state: st, close: true };
    const others = (ctx.instances({ subject: sub }) ?? []).filter(i => i.instance !== input.instance);
    if (others.length) return { decisions: { subject: sub, phase: 'merged' }, state: st, merge: { into: others[0].instance } };
    if (kindOf(first) !== 'placed') {
      // a message about an order that is already closed changes nothing; one about no order at all is answered with nothing
      return { decisions: { subject: sub, phase: 'closed' }, state: st, close: true };
    }
    if (ctx.query('orders.orders', { where: { orderId: sub }, limit: 1 }).length) {
      return { decisions: { subject: sub, phase: 'duplicate' }, state: st, close: true };   // R1.4
    }
  }

  for (const e of events) {
    if (e.type === 'effect.result' || e.type === 'timer.fired' || String(e.type).startsWith('humanTask.')) {
      const owner = ctx.ownerOf(e);
      if (owner) { absorb(owner.module, ctx.deliver(e)); continue; }
      if (e.type === 'effect.result') readResult(e);
      continue;
    }
    if (e.type === 'migration') { migrate(e); continue; }
    const k = kindOf(e);
    if (k === 'placed') placed(e);
    else if (k === 'action') action(e);
    else if (k === 'carrier') carrier(e);
  }

  // the settle pass: effects that depend on the whole tick's decisions (R3.1 notice, R4.1 processing and starts)
  let done = false;
  if (st.o && st.al) done = ctx.call('orderflow', st.o, { op: 'settle' }).done;
  return {
    decisions: { subject: st.o, phase: st.al ? 'recorded' : st.o ? 'allocating' : 'none' },
    state: st,
    ...(done ? { close: true } : {}),
  };

  // go-live (§3.5): an order already in flight continues from its records: the order's status and fulfilments, and for
  // a processing order each fulfilment's committed reservation, charge and shipment (a fulfilment resumes from them)
  function migrate(e) {
    const oid = norm(deepFind(e.payload, 'orderId'));
    const rec = oid && !st.o ? ctx.query('orders.orders', { where: { orderId: oid }, limit: 1 })[0] : undefined;
    if (!rec) return;
    const frs = ctx.query('orders.fulfilments', { where: { orderId: oid }, limit: 100 });
    const customers = fileJson(files, 'master/customers.json');
    const row = (Array.isArray(customers) ? customers : customers?.rows ?? []).find(c => c.customerId === rec.customerId);
    if (!row?.email) throw new Error(`no email for customer ${rec.customerId}`);
    st.o = oid;
    st.p = rec.placedAt;
    st.ed = editionAt(files, st.p);
    st.al = true;
    st.ord = { orderId: oid, customerId: rec.customerId, placedAt: rec.placedAt, currency: rec.currency, items: rec.items };
    const fl = frs.map(f => ({ fid: norm(f.fulfilmentId), loc: f.location ?? null, av: f.location != null && f.status !== 'unavailable', amt: f.amountMinor, items: f.items }));
    st.fids = fl.map(f => f.fid);
    ctx.call('orderflow', oid, { op: 'record', p: st.p, ed: st.ed, em: row.email, cur: rec.currency, cust: rec.customerId, fl });
    const fs = {};
    for (const f of frs) if (['completed', 'failed', 'cancelled'].includes(f.status)) fs[norm(f.fulfilmentId)] = f.status;
    ctx.call('orderflow', oid, { op: 'resume', status: rec.status, fs });
    if (rec.status === 'pending') ctx.call('fraud', oid, { op: 'start' });   // the review is asked again: no decision is known
    if (rec.status === 'processing') {
      for (const f of frs) {
        const fid = norm(f.fulfilmentId);
        if (f.location == null || f.status === 'unavailable' || fs[fid]) continue;
        const where = { orderId: oid, fulfilmentId: f.fulfilmentId };
        ctx.call('fulfilment', fid, {
          op: 'resume',
          fulfilment: { orderId: oid, fulfilmentId: fid, location: f.location, customerId: rec.customerId, currency: rec.currency, amountMinor: f.amountMinor, items: f.items, email: row.email },
          reserved: ctx.query('inventory.reservations', { where: { ...where, status: 'active' }, limit: 100 }).map(r => r.sku),
          charged: ctx.query('billing.charges', { where, limit: 10 }).length > 0 && ctx.query('billing.refunds', { where, limit: 10 }).length === 0,
          shipped: ctx.query('carrier.shipments', { where, limit: 10 }).some(s => s.status !== 'cancelled' && s.status !== 'failed'),
          dispatched: f.status === 'dispatched',
        });
      }
    }
  }

  function placed(e) {
    if (st.o) return;                                   // a repeat of the order this instance already runs (R1.4)
    const oid = norm(e.payload.orderId);
    st.o = oid;
    st.p = e.payload.placedAt;
    st.ed = editionAt(files, st.p);
    st.ord = { orderId: oid, customerId: e.payload.customerId, placedAt: e.payload.placedAt, currency: e.payload.currency, items: e.payload.items };
    ctx.call('intake', oid, { op: 'place', order: st.ord, edition: st.ed });
    ctx.call('fraud', oid, { op: 'start' });
  }

  function action(e) {
    if (!st.o || norm(e.payload.orderRef) !== st.o) return;
    if (!st.al) {
      // before the order is recorded: a cancel is kept and counts once the order is recorded (R6.4)
      if (e.payload.action === 'cancel' && !st.pc) st.pc = { at: e.at, eid: e.id };
      return;
    }
    ctx.call('orderflow', st.o, { op: 'action', action: e.payload.action, at: e.at, eid: e.id });
  }

  function carrier(e) {
    const fid = norm(e.payload.fulfilmentRef);
    if (!st.o || !st.fids.includes(fid)) return;
    const meaning = meaningOf(files, st.ed, e.payload.code);
    if (COLLECTED.includes(meaning)) ctx.call('orderflow', st.o, { op: 'evidence', reportedAt: e.payload.reportedAt });
    const r = ctx.call('fulfilment', fid, { op: 'carrier', report: { meaning, reportedAt: e.payload.reportedAt, code: e.payload.code } });
    if (r?.ended) ctx.call('orderflow', st.o, { op: 'ended', fid: r.ended.fid, status: r.ended.status, at: r.ended.at });
  }

  // an effect result nobody owns: the read operations, whose answers the parent turns into decisions
  function readResult(e) {
    const p = e.payload;
    if (!st.o) return;
    if (p.system === 'inventory' && p.op === 'allocate' && !st.al) {
      if (p.status !== 'ok') throw new Error(`allocation of ${st.o} ended ${p.status}`);
      const fulfilments = deepFind(p, 'fulfilments');
      if (!Array.isArray(fulfilments)) throw new Error(`allocation of ${st.o} has no fulfilments`);
      const r = ctx.call('intake', st.o, { op: 'allocated', plan: { fulfilments }, order: st.ord, edition: st.ed });
      st.al = true;
      st.fids = r.fl.map(f => f.fid);
      ctx.call('orderflow', st.o, { op: 'record', p: st.p, ed: st.ed, em: r.em, cur: r.cur, cust: r.cust, fl: r.fl });
      if (st.v) { const v = st.v; st.v = null; verdict(v); }
      if (st.pc) { const pc = st.pc; st.pc = null; ctx.call('orderflow', st.o, { op: 'action', action: 'cancel', at: pc.at, eid: pc.eid }); }
    } else if (p.system === 'fraud' && p.op === 'check') {
      const v = deepFind(p, 'verdict');
      if (!st.al) st.v = v;      // held until the order is recorded (its cleared or cancelled state needs the lines)
      else verdict(v);
    }
  }

  function verdict(v) {
    const r = ctx.call('fraud', st.o, { op: 'verdict', verdict: v, at: st.p, edition: st.ed });
    absorb('fraud', r);
  }

  function absorb(module, r) {
    if (module === 'fraud' && r?.outcome) {
      const o = r.outcome;
      if (o.kind === 'cleared') ctx.call('orderflow', st.o, { op: 'cleared', at: o.at });
      else if (o.kind === 'rejected') ctx.call('orderflow', st.o, { op: 'reject', reason: o.reason, at: o.at });
    } else if (module === 'fulfilment' && r?.ended) {
      ctx.call('orderflow', st.o, { op: 'ended', fid: r.ended.fid, status: r.ended.status, at: r.ended.at });
    } else if (module === 'orderflow' && r?.done) {
      // the order is over and its fulfilments are terminal: nothing is pending
    }
  }
}
