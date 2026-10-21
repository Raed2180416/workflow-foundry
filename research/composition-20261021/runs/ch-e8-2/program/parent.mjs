// parent: the order process of SPEC-E (E8). It routes each event to the sub-workflow that owns it, keeps the order's
// record in its own state (fulfilment statuses, cleared or ended, the collection reports of R6.2) and asks the
// modules for what the rules require. Modules keep their own state; the parent reads only their outputs.

const TERMINAL = ['completed', 'failed', 'cancelled'];
const COLLECTED = ['collected', 'inTransit', 'delivered'];           // S7: reports that prove collection
const PHASE_STATUS = { reserving: 'processing', charging: 'processing', shipping: 'processing', shipped: 'processing',
  dispatched: 'dispatched', completed: 'completed', failed: 'failed', cancelled: 'cancelled' };

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const ms = s => Date.parse(s);
const norm = s => String(s ?? '').trim().replace(/^#/, '').trim().toUpperCase();     // SPEC §3.1
const jsonOf = f => (typeof f === 'string' ? JSON.parse(f) : (f ?? null));
const rowsOf = r => (Array.isArray(r) ? r : (isObj(r) && Array.isArray(r.rows) ? r.rows : []));

// The API may rename a field: api/<system>.schema.json in ctx.files shows the current names, so send those.
const fitNorm = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
function fitArgs(e, files) {
  const props = jsonOf(files?.[`api/${e.system}.schema.json`])?.ops?.[e.op]?.args?.properties;
  if (!props || !isObj(e.args)) return e;
  const names = Object.keys(props);
  const keys = Object.keys(e.args);
  const extra = keys.filter(k => !names.includes(k));
  const missing = names.filter(n => !keys.includes(n));
  const renamed = {};
  for (const k of extra) renamed[k] = names.find(n => fitNorm(n) === fitNorm(k)) ?? (extra.length === 1 && missing.length === 1 ? missing[0] : k);
  const args = {};
  for (const k of keys) args[renamed[k] ?? k] = e.args[k];
  return { ...e, args };
}

// A lookup table from a master or rulebook file: a list of rows, or an object keyed by the key itself.
function mapOf(x, keys, vals) {
  const out = {};
  const list = Array.isArray(x) ? x : (isObj(x) ? Object.values(x).find(Array.isArray) : null);
  if (list) {
    for (const r of list) {
      const k = keys.map(n => r?.[n]).find(v => v !== undefined);
      const v = vals.map(n => r?.[n]).find(z => z !== undefined);
      if (k !== undefined && v !== undefined) out[k] = v;
    }
  } else if (isObj(x)) {
    for (const [k, v] of Object.entries(x)) out[k] = isObj(v) ? vals.map(n => v[n]).find(z => z !== undefined) : v;
  }
  return out;
}

// R1.3: the published edition with the latest effectiveFrom on or before the date of p (Amsterdam local date).
function editionAt(ctx, placedAt) {
  const day = String(placedAt).slice(0, 10);
  let best = null;
  for (const k of Object.keys(ctx.files)) {
    const m = /^rulebook\/([^/]+)\/edition\.json$/.exec(k);
    if (!m) continue;
    const from = String(jsonOf(ctx.files[k])?.effectiveFrom ?? '');
    if (from && from <= day && (!best || from > best.from)) best = { dir: m[1], from };
  }
  return best?.dir ?? null;
}

function rulesOf(ctx, ed) {
  const f = p => jsonOf(ctx.files[p]);
  return {
    fees: mapOf(f(`rulebook/${ed}/shipping-fees.json`), ['location', 'locationId'], ['feeMinor']),
    codes: mapOf(f(`rulebook/${ed}/carrier-codes.json`), ['code'], ['meaning']),
    policy: f(`rulebook/${ed}/policy.json`) ?? {},
  };
}

// Which event this is, from its payload (routing is by channel; the business kind is read here).
function kindOf(ev) {
  const p = ev.payload ?? {};
  if (ev.type === 'effect.result' || ev.type === 'timer.fired' || String(ev.type).startsWith('humanTask.')) return 'owned';
  if (p.orderId !== undefined && Array.isArray(p.items)) return 'placed';
  if (p.orderRef !== undefined && p.action !== undefined) return 'customer';
  if (p.fulfilmentRef !== undefined && p.code !== undefined) return 'carrier';
  return 'other';
}

export function tick(input, ctx) {
  const st = input.state ?? { o: null };
  const me = input.instance;
  let subject = st.o?.id ?? null;

  // --- a new instance started by an inbound message (§3.2): merge it into its order's case, or start one
  const openFor = oid => rowsOf(ctx.instances({ subject: oid })).map(x => (typeof x === 'string' ? x : x?.instance))
    .filter(x => x && x !== me);

  // --- the order record: st.o = { id, customerId, currency, p, ed, email, reviewHours, actionHours, fs, coll, phase, cleared, ended }
  const o = () => st.o;

  function startOrder(ev) {
    const p = ev.payload;
    const oid = norm(p.orderId);
    const ed = editionAt(ctx, p.placedAt);
    const r = rulesOf(ctx, ed);
    const cust = mapOf(jsonOf(ctx.files['master/customers.json']), ['customerId', 'id'], ['email']);
    const cat = mapOf(jsonOf(ctx.files['master/catalog.json']), ['sku'], ['unitPriceMinor']);
    const prices = {};
    for (const it of p.items ?? []) if (cat[it.sku] !== undefined) prices[it.sku] = cat[it.sku];
    st.o = { id: oid, customerId: p.customerId, currency: p.currency, p: p.placedAt, ed, email: cust[p.customerId] ?? '',
      reviewHours: r.policy.fraudReviewHours, actionHours: r.policy.customerActionHours, fs: {}, coll: {}, phase: 'allocating',
      cleared: false, ended: null };
    ctx.call('intake', oid, { op: 'place', orderId: oid, customerId: p.customerId, placedAt: p.placedAt, currency: p.currency,
      items: p.items, prices, fees: r.fees });
    subject = oid;
  }

  // R2.2: a review task opens (its deadline is fixed from this first task)
  function openReview(at) {
    const x = o();
    if (x.ended || x.cleared || x.phase === 'review') return;
    x.phase = 'review';
    ctx.call('review', x.id, { op: 'open', orderId: x.id, reviewHours: x.reviewHours, at });
  }

  // R3.1 or R4.1: the order is cleared at t; with unavailable items the customer is asked first
  function clearAt() {
    const x = o();
    if (x.ended || x.cleared) return;
    x.cleared = true;
    if (Object.values(x.fs).some(f => !f.avail)) {
      x.phase = 'waiting';
      ctx.call('wait', x.id, { op: 'arm', orderId: x.id, p: x.p, customerActionHours: x.actionHours, email: x.email,
        fulfilments: Object.entries(x.fs).map(([fulfilmentId, f]) => ({ fulfilmentId, available: f.avail })) });
    } else startProcessing();
  }

  // R4.1: the order and every available fulfilment become processing; each fulfilment's saga starts
  function startProcessing() {
    const x = o();
    x.phase = 'processing';
    ctx.call('close', x.id, { op: 'processing', orderId: x.id });
    for (const [fid, f] of Object.entries(x.fs)) {
      if (!f.avail || f.status !== 'pending') continue;
      f.status = 'processing';
      ctx.call('fulfil', `${x.id}.${fid}`, { op: 'start', orderId: x.id, fid, location: f.loc, customerId: x.customerId,
        email: x.email, currency: x.currency, amountMinor: f.amt, items: f.items });
    }
  }

  // R6.1, R6.2, R6.4, S15: the order is cancelled: started fulfilments compensated, the rest set cancelled, the order too
  function cancelOrder(reason, at) {
    const x = o();
    if (x.ended) return;
    x.ended = 'cancelled';
    x.phase = 'ended';
    for (const [fid, f] of Object.entries(x.fs)) {
      if (TERMINAL.includes(f.status)) continue;
      if (f.status === 'processing') {
        const r = ctx.call('fulfil', `${x.id}.${fid}`, { op: 'compensate', reason: 'cancelled' });
        f.status = r?.phase ?? 'cancelled';
      } else {
        f.status = 'cancelled';
        ctx.emit(fitArgs({ key: `fs-cancel-${fid}`, system: 'orders', op: 'setStatus', args: { orderId: x.id, fulfilmentId: fid, status: 'cancelled' } }, ctx.files));
      }
    }
    ctx.call('close', x.id, { op: 'cancel', orderId: x.id, email: x.email, reason, at });
  }

  // R6.2: a collection report (meaning collected, inTransit or delivered) at or before t proves collection (S7)
  const collectedBy = at => Object.values(o().coll).some(r => ms(r) <= ms(at));

  // R4.5: once every fulfilment has ended, the order's outcome
  function maybeOutcome() {
    const x = o();
    if (x.ended || x.phase !== 'processing') return;
    const statuses = Object.values(x.fs).map(f => f.status);
    if (!statuses.every(s => TERMINAL.includes(s))) return;
    const r = ctx.call('close', x.id, { op: 'outcome', orderId: x.id, statuses });
    if (r?.phase === 'final') { x.ended = r.status; x.phase = 'ended'; }
  }

  function applyFulfil(fid, out) {
    const f = o().fs[fid];
    if (!f) return;
    if (PHASE_STATUS[out?.phase]) f.status = PHASE_STATUS[out.phase];
    maybeOutcome();
  }

  // Results, timers and human-task events: delivered to the module instance that caused them
  function deliverOwned(ev) {
    const x = o();
    const own = ctx.ownerOf(ev);
    if (!own || !x) return;
    const out = ctx.deliver(ev) ?? {};
    if (own.module === 'intake') {
      if (out.phase === 'recorded') {
        for (const f of out.fulfilments) x.fs[f.fulfilmentId] = { loc: f.location, amt: f.amountMinor, items: f.items,
          avail: f.available, status: f.available ? 'pending' : 'unavailable' };
        x.phase = 'checking';
      }
      if (out.phase === 'verdict') {
        if (out.verdict === 'pass') clearAt();                              // R2.1: cleared at p
        else if (out.verdict === 'reject') cancelOrder('fraud', ev.at);      // R2.1: cancel within 120 min of p
        else openReview(ev.at);                                              // R2.1: review
      }
    } else if (own.module === 'review') {
      if (out.phase === 'approved') clearAt();
      else if (out.phase === 'rejected') cancelOrder('fraud', out.at ?? ev.at);
      else if (out.phase === 'timed-out') cancelOrder('fraud-review-timeout', out.at ?? ev.at);
    } else if (own.module === 'wait') {
      if (out.timedOut) {
        for (const f of Object.values(x.fs)) f.status = 'cancelled';
        x.ended = 'timedOut';
        x.phase = 'ended';
      }
    } else if (own.module === 'fulfil') {
      applyFulfil(own.key.slice(x.id.length + 1), out);
    } else if (own.module === 'close' && out.phase === 'final') {
      x.ended = out.status;
      x.phase = 'ended';
    }
  }

  // §3.3 customer actions (S5, S8, S11, R3.2, R6.2, R6.3, R6.4)
  function onCustomer(ev) {
    const x = o();
    const p = ev.payload;
    if (!x || x.id !== norm(p.orderRef) || x.ended) return;
    if (p.action === 'cancel') {
      if (!x.cleared) return cancelOrder('customer', ev.at);                // R6.4: fraud review open
      if (x.phase === 'waiting') {
        const w = ctx.call('wait', x.id, { op: 'action', at: ev.at, action: 'cancel' });
        if (w?.counted === 'cancel') cancelOrder('customer', ev.at);
        return;
      }
      if (x.phase === 'processing') {
        if (collectedBy(ev.at)) return ctx.call('close', x.id, { op: 'refuse', orderId: x.id, ref: ev.id, email: x.email });
        return cancelOrder('customer', ev.at);                              // R6.2
      }
      return;
    }
    if (p.action === 'amend' && x.phase === 'waiting') {
      const w = ctx.call('wait', x.id, { op: 'action', at: ev.at, action: 'amend' });
      if (w?.counted !== 'amend') return;
      for (const f of Object.values(x.fs)) if (!f.avail) f.status = 'cancelled';
      if (w.nothingAvailable) return cancelOrder('nothing-available', ev.at);   // R3.2
      startProcessing();                                                       // ready at a (R4)
    }
  }

  // §3.3 carrier messages (R4.4): routed to the fulfilment by its fulfilmentRef
  function onCarrier(ev) {
    const x = o();
    const p = ev.payload;
    if (!x || !x.fs[p.fulfilmentRef]) return;
    const meaning = rulesOf(ctx, x.ed).codes[p.code] ?? 'info';              // a code not listed is info
    if (COLLECTED.includes(meaning) && (!x.coll[p.fulfilmentRef] || ms(p.reportedAt) < ms(x.coll[p.fulfilmentRef]))) {
      x.coll[p.fulfilmentRef] = p.reportedAt;
    }
    const out = ctx.call('fulfil', `${x.id}.${p.fulfilmentRef}`, { op: 'carrier', meaning, reportedAt: p.reportedAt });
    applyFulfil(p.fulfilmentRef, out);
  }

  // The first tick of an instance started by a message: placed orders start one; anything else merges into the open
  // case of its order or closes (S11: an action that names no order yet changes nothing)
  function freshMessage(k, ev) {
    const p = ev.payload;
    const oid = k === 'placed' ? norm(p.orderId) : k === 'customer' ? norm(p.orderRef)
      : rowsOf(ctx.query('orders.fulfilments', { where: { fulfilmentId: p.fulfilmentRef }, limit: 1 }))[0]?.orderId;
    const target = oid ? openFor(norm(oid))[0] : undefined;
    if (target) return { decisions: { subject: norm(oid) }, state: null, merge: { into: target } };
    if (k === 'placed') { startOrder(ev); return null; }
    return { decisions: { subject: oid ? norm(oid) : null }, state: null, close: true };
  }

  for (const ev of input.events ?? []) {
    const k = kindOf(ev);
    if (k === 'owned') { deliverOwned(ev); continue; }
    if (!st.o && (k === 'placed' || k === 'customer' || k === 'carrier')) {
      const early = freshMessage(k, ev);
      if (early) return early;
      continue;
    }
    if (k === 'customer') onCustomer(ev);
    else if (k === 'carrier') onCarrier(ev);
    // a repeated placed order (R1.4) and any other message: no effect
  }
  return { decisions: { subject }, state: st };
}
