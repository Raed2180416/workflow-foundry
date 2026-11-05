// Module fulfilment, key: the fulfilment id. One saga per fulfilment. Owns R4.2 (reserve, charge, ship, each after the
// previous committed), R4.3 (collection is the point of no return: a shipment is cancelled only before it), R4.4
// (carrier reports), R5.1 (compensation in reverse order of the committed steps), R5.2 (failure), S2 (a step counts as
// committed by the system's truth, status(key)), S14 (a step committing after a failure is compensated) and §3.3.
// Effects: inventory.reserve (a batch: keyed by its items 'item.<sku>'), billing.charge ('charge'), carrier.create ('ship'),
// carrier.cancel ('unship'), billing.refund ('refund'), inventory.release ('release.<sku>').
// Calls statuses and notices. Always returns `output`.

const MAX_BATCHES = 5;
const MAX_REPORTS = 100;
const DONE_END = ['completed', 'failed', 'stopped'];

function clone(v) {
  return v === null || v === undefined ? null : JSON.parse(JSON.stringify(v));
}

function readJson(files, path) {
  let v = files?.[path];
  if (v === undefined) { v = files; for (const seg of path.split('/')) v = v?.[seg]; }
  if (typeof v === 'string') return JSON.parse(v);
  return v ?? null;
}

function rowsOf(x) {
  if (Array.isArray(x)) return x;
  if (x && typeof x === 'object') {
    const arr = Object.values(x).find(v => Array.isArray(v));
    if (arr) return arr;
    return Object.entries(x).map(([k, v]) => (v && typeof v === 'object' ? { key: k, ...v } : { key: k, value: v }));
  }
  return [];
}

// §3.3: the carrier's code translated with the edition's carrier-codes table; an unlisted code means info.
function meaningOf(files, edition, code) {
  const row = rowsOf(readJson(files, `rulebook/${edition}/carrier-codes.json`)).find(r => (r.code ?? r.key) === code);
  const m = row ? (row.meaning ?? row.value) : null;
  const known = ['collected', 'inTransit', 'delivered', 'collectionFailed', 'info'];
  return known.includes(m) ? m : 'info';
}

const itemKey = sku => `item.${sku}`;

function newState(input) {
  const f = input.fulfilment;
  const items = {};
  for (const it of f.items) items[it.sku] = { qty: it.qty, st: 'none' };
  return {
    started: true, oid: input.orderId, cust: input.customerId, cur: input.currency, edition: input.edition,
    readyAt: input.readyAt, f: { fulfilmentId: f.fulfilmentId, location: f.location, items: f.items, amountMinor: f.amountMinor },
    items, batches: 0, rel: {}, charge: 'none', ship: 'none', unship: 'none', refund: 'none',
    end: null, endedAt: null, stopAt: null, failed: false, cfail: false,
    dispatched: false, collected: false, reports: [], announced: false, inflight: {},
  };
}

function blank() {
  return { started: false, reports: [], inflight: {}, end: null, endedAt: null, edition: null, oid: null, cust: null, cur: null,
    stopAt: null, failed: false, cfail: false, dispatched: false, collected: false, announced: false, items: {}, rel: {},
    charge: 'none', ship: 'none', unship: 'none', refund: 'none', batches: 0 };
}

function compPending(w) {
  if (!w.stopAt && !w.failed) return false;
  if (w.ship === 'ok' && !w.cfail && w.unship === 'none') return true;
  if (w.charge === 'ok' && w.refund === 'none') return true;
  return Object.entries(w.items).some(([sku, i]) => i.st === 'ok' && (w.rel[sku] ?? 'none') === 'none');
}

function busyOf(w) {
  return !!w && (Object.keys(w.inflight).length > 0 || compPending(w));
}

function outOf(w) {
  const state = !w ? 'idle' : w.end === 'stopped' ? 'stopped' : w.end === 'failed' ? 'failed' : w.end === 'completed' ? 'completed'
    : w.dispatched ? 'dispatched' : w.ship === 'ok' ? 'booked' : w.ship !== 'none' ? 'shipping'
    : w.charge !== 'none' ? 'charging' : w.started ? 'reserving' : 'idle';
  return { output: { state, end: w?.end ?? null, endedAt: w?.endedAt ?? null, reports: w?.reports ?? [], busy: busyOf(w) } };
}

// The API may rename a field during the run; api/<system>.schema.json in ctx.files always shows the current names
// (SPEC-E §4.2). An argument the current schema no longer names moves to the single property that replaces it.
function fit(system, op, args, ctx) {
  const schema = readJson(ctx.files, `api/${system}.schema.json`);
  const a = schema?.ops?.[op]?.args;
  if (!a || !a.properties || !args) return args;
  const props = Object.keys(a.properties);
  const out = { ...args };
  for (const k of Object.keys(args).filter(k => !props.includes(k))) {
    const free = props.filter(p => !(p in out));
    const req = free.filter(p => (a.required ?? []).includes(p));
    const pick = req.length === 1 ? req[0] : free.length === 1 ? free[0] : null;
    if (pick) { out[pick] = out[k]; delete out[k]; }
  }
  return out;
}

export function step(input, ctx) {
  const w = clone(ctx.state) ?? blank();
  switch (input.op) {
    case 'start': return start(input, ctx, w);
    case 'advance': return advance(input, ctx, w);
    case 'carrier': return carrier(input, ctx, w);
    case 'stop': return stop(input, ctx, w);
    case 'get': return { ...outOf(w) };
    case 'resume': return resume(input, ctx, w);
  }
  throw new Error(`fulfilment: unknown op ${input.op}`);
}

export function onEvent(event, ctx) {
  const w = clone(ctx.state);
  if (!w || event.type !== 'effect.result') return { ...outOf(w), state: w };
  const eff = [];
  const p = event.payload ?? {};
  // the batch result has no key of its own: it is recognised by its items
  // a batch result is recognised by its op or by its items (its own key, if any, is an item key)
  const batch = p.op === 'reserve' || (Array.isArray(p.items) && (p.key === undefined || String(p.key).startsWith('item.')));
  const key = batch ? 'reserve' : p.key;
  if (typeof key !== 'string') return { ...outOf(w), state: w };
  delete w.inflight[key];

  if (key === 'reserve') {
    if (Array.isArray(p.items) && p.items.length) {
      for (const it of p.items) {
        const sku = String(it.key ?? '').replace(/^item\./, '');
        if (!w.items[sku]) continue;
        if (it.status === 'ok') w.items[sku].st = 'ok';
        else if (it.status === 'unknown') w.items[sku].st = 'unknown';
        else reservationError(w, sku, it.error ?? it);
      }
    } else if (p.status === 'ok') {
      for (const sku of Object.keys(w.items)) if (w.items[sku].st === 'sent') w.items[sku].st = 'ok';
    } else if (p.status === 'unknown') {
      for (const sku of Object.keys(w.items)) if (w.items[sku].st === 'sent') w.items[sku].st = 'unknown';
    } else {
      for (const sku of Object.keys(w.items)) if (w.items[sku].st === 'sent') reservationError(w, sku, p.error ?? p);
    }
  } else if (key === 'charge') {
    if (p.status === 'ok') w.charge = 'ok';
    else if (p.status === 'unknown') w.charge = 'unknown';
    else if (isInvalidRequest(p.error)) w.charge = 'none';                 // our request was wrong: same key, again
    else { w.charge = 'dead'; failWith(w, event.at ?? ctx.now); }          // 402 card-declined or a permanent error (R5.2)
  } else if (key === 'ship') {
    if (p.status === 'ok') w.ship = 'ok';
    else if (p.status === 'unknown') w.ship = 'unknown';
    else if (isInvalidRequest(p.error)) w.ship = 'none';
    else { w.ship = 'dead'; failWith(w, event.at ?? ctx.now); }
  } else if (key === 'unship') {
    if (p.status === 'ok') w.unship = 'done';
    else if (p.status === 'unknown') w.unship = 'unknown';
    else w.unship = 'refused';                                             // 409 already-collected: no cancel possible
  } else if (key === 'refund') {
    if (p.status === 'ok') w.refund = 'done';
    else if (p.status === 'unknown') w.refund = 'unknown';
    else w.refund = 'refused';
  } else if (key.startsWith('release.')) {
    const sku = key.slice('release.'.length);
    if (p.status === 'unknown') w.rel[sku] = 'unknown';
    else w.rel[sku] = 'done';
  }
  if (w.failed && !w.announced) announce(w, ctx, event.at ?? ctx.now);
  drive(w, ctx, eff, ctx.now);
  return { ...outOf(w), state: w, ...(eff.length ? { effects: eff } : {}) };
}

function isInvalidRequest(err) {
  const code = typeof err === 'string' ? err : err?.code;
  return code === 'invalid-args' || code === 'field-renamed' || err?.status === 400 || err?.httpStatus === 400;
}

function reservationError(w, sku, err) {
  if (isInvalidRequest(err)) { w.items[sku].st = 'retry'; return; }    // our request was wrong (R4.2): resubmit
  if (err?.retryable === false) {                                       // permanent (R5.2)
    w.items[sku].st = 'dead';
    failWith(w, null);
    return;
  }
  w.items[sku].st = 'retry';                                            // a partial batch's failed item: resubmit with its original key
}

function failWith(w, at) {
  if (w.failed || w.end === 'stopped') return;
  w.failed = true;
  w.end = 'failed';
  w.endedAt = at;
}

function start(input, ctx, w) {
  if (w.started) return { ...outOf(w), state: w };
  const s = newState(input);
  return { ...outOf(s), state: s, effects: driveOut(s, ctx) };
}

function advance(input, ctx, w) {
  if (!w.started) return { ...outOf(w), state: w };
  const eff = [];
  drive(w, ctx, eff, ctx.now);
  return { ...outOf(w), state: w, ...(eff.length ? { effects: eff } : {}) };
}

function driveOut(s, ctx) {
  const eff = [];
  drive(s, ctx, eff, ctx.now);
  return eff;
}

// Ask the platform what committed when an outcome was unknown (S2). `pending` leaves it in flight.
function resolveUnknown(w, ctx) {
  const ask = (system, key) => ctx.status(system, key);
  for (const [sku, i] of Object.entries(w.items)) {
    if (i.st !== 'unknown') continue;
    const s = ask('inventory', itemKey(sku));
    if (s === 'committed') i.st = 'ok'; else if (s === 'not-found') i.st = 'retry';
  }
  if (w.charge === 'unknown') {
    const s = ask('billing', 'charge');
    if (s === 'committed') w.charge = 'ok'; else if (s === 'not-found') w.charge = 'none';
  }
  if (w.ship === 'unknown') {
    const s = ask('carrier', 'ship');
    if (s === 'committed') w.ship = 'ok'; else if (s === 'not-found') w.ship = 'none';
  }
  if (w.unship === 'unknown') {
    const s = ask('carrier', 'unship');
    if (s === 'committed') w.unship = 'done'; else if (s === 'not-found') w.unship = 'none';
  }
  if (w.refund === 'unknown') {
    const s = ask('billing', 'refund');
    if (s === 'committed') w.refund = 'done'; else if (s === 'not-found') w.refund = 'none';
  }
  for (const sku of Object.keys(w.rel)) {
    if (w.rel[sku] !== 'unknown') continue;
    const s = ask('inventory', `release.${sku}`);
    w.rel[sku] = s === 'not-found' ? 'none' : 'done';
  }
}

function send(ctx, w, eff, effect, marker = effect.key) {
  effect.args = fit(effect.system, effect.op, effect.args, ctx);
  w.inflight[marker] = true;
  eff.push(effect);
}

// R4.2 forward steps, in order. Nothing is emitted once stopped or failed (R6.2, R5.2).
function forward(w, ctx, eff) {
  if (!w.started || w.end || w.stopAt || w.failed) return;
  if (Object.keys(w.inflight).length > 0) return;                  // wait for the previous step's result
  if (Object.values(w.items).some(i => i.st === 'unknown' || i.st === 'dead')) return;
  const todo = Object.keys(w.items).filter(sku => w.items[sku].st === 'none' || w.items[sku].st === 'retry');
  if (todo.length) {
    if (w.batches >= MAX_BATCHES) { failWith(w, null); return; }         // keeps failing items from looping forever
    w.batches += 1;
    for (const sku of todo) w.items[sku].st = 'sent';
    // a batch op keys its items, not the batch (api/inventory.schema.json)
    send(ctx, w, eff, {
      system: 'inventory', op: 'reserve',
      args: {
        orderId: w.oid, fulfilmentId: w.f.fulfilmentId, location: w.f.location,
        items: todo.map(sku => ({ key: itemKey(sku), sku, qty: w.items[sku].qty })),
      },
    }, 'reserve');
    return;
  }
  if (!Object.values(w.items).every(i => i.st === 'ok')) return;
  if (w.charge === 'none') {
    send(ctx, w, eff, {
      key: 'charge', system: 'billing', op: 'charge',
      args: { orderId: w.oid, fulfilmentId: w.f.fulfilmentId, customerId: w.cust, amountMinor: w.f.amountMinor, currency: w.cur },
    });
    w.charge = 'sent';
    return;
  }
  if (w.charge !== 'ok') return;
  if (w.ship === 'none') {
    send(ctx, w, eff, {
      key: 'ship', system: 'carrier', op: 'create',
      args: { orderId: w.oid, fulfilmentId: w.f.fulfilmentId, location: w.f.location, ref: w.f.fulfilmentId },
    });
    w.ship = 'sent';
  }
}

// R5.1: undo the committed steps in reverse order: shipment, refund, then each reserved item. Only after the forward
// steps in flight have answered (their results bring the compensation, S14).
function compensate(w, ctx, eff) {
  if (Object.keys(w.inflight).length > 0) return;
  if (w.ship === 'ok' && !w.cfail && w.unship === 'none') {
    send(ctx, w, eff, { key: 'unship', system: 'carrier', op: 'cancel', args: { orderId: w.oid, fulfilmentId: w.f.fulfilmentId } });
    w.unship = 'sent';
    return;
  }
  if (w.unship === 'sent' || w.unship === 'unknown') return;
  if (w.charge === 'ok' && w.refund === 'none') {
    send(ctx, w, eff, { key: 'refund', system: 'billing', op: 'refund', args: { orderId: w.oid, fulfilmentId: w.f.fulfilmentId, amountMinor: w.f.amountMinor } });
    w.refund = 'sent';
    return;
  }
  if (w.refund === 'sent' || w.refund === 'unknown') return;
  for (const sku of Object.keys(w.items)) {
    if (w.items[sku].st !== 'ok' || (w.rel[sku] ?? 'none') !== 'none') continue;
    w.rel[sku] = 'sent';
    send(ctx, w, eff, { key: `release.${sku}`, system: 'inventory', op: 'release', args: { orderId: w.oid, fulfilmentId: w.f.fulfilmentId, sku } });
  }
}

function drive(w, ctx, eff) {
  if (!w.started) return;
  resolveUnknown(w, ctx);
  if (!w.stopAt && !w.failed) forward(w, ctx, eff);
  if (w.failed && !w.announced) announce(w, ctx, w.endedAt ?? ctx.now);
  if (w.stopAt || w.failed) compensate(w, ctx, eff);
}

// Failure (R5.2): the fulfilment failed; the status and the notice follow at once (S14).
function announce(w, ctx, at) {
  w.announced = true;
  ctx.call('statuses', w.oid, { op: 'set', fulfilmentId: w.f.fulfilmentId, status: 'failed' });
  ctx.call('notices', w.oid, { op: 'send', template: 'fulfilment-failed', about: w.f.fulfilmentId });
  w.endedAt = at;
}

function setDispatched(w, ctx) {
  if (w.dispatched) return;
  w.dispatched = true;
  ctx.call('statuses', w.oid, { op: 'set', fulfilmentId: w.f.fulfilmentId, status: 'dispatched' });
}

function carrier(input, ctx, w) {
  // §3.3: the report is recorded for cancellation (S7); it changes a status only while the shipment is ours and open.
  const m = input.message;
  const meaning = meaningOf(ctx.files, w.edition ?? '', m.code);
  const seen = w.reports.some(r => r.meaning === meaning && r.reportedAt === m.reportedAt);
  if (!seen) w.reports = [...w.reports, { meaning, reportedAt: m.reportedAt }].slice(-MAX_REPORTS);
  if (!w.started || w.end || w.stopAt || w.failed || w.unship !== 'none') return { ...outOf(w), state: w };
  const at = input.at;
  if (meaning === 'collected') {
    w.collected = true;
    setDispatched(w, ctx);
  } else if (meaning === 'delivered') {
    w.collected = true;
    setDispatched(w, ctx);
    ctx.call('statuses', w.oid, { op: 'set', fulfilmentId: w.f.fulfilmentId, status: 'completed', afterStatus: 'dispatched' });
    w.end = 'completed';
    w.endedAt = at;
  } else if (meaning === 'collectionFailed') {
    w.cfail = true;
    failWith(w, at);
    announce(w, ctx, at);
    const eff = [];
    compensate(w, ctx, eff);
    return { ...outOf(w), state: w, ...(eff.length ? { effects: eff } : {}) };
  }
  return { ...outOf(w), state: w };
}

function stop(input, ctx, w) {
  // R6.2: a counted customer cancel. No new forward step from here; compensate what is or becomes committed.
  if (!w.started) { w.end = 'stopped'; w.endedAt = input.at; return { ...outOf(w), state: w }; }
  if (w.end && DONE_END.includes(w.end)) return { ...outOf(w), state: w };
  w.stopAt = input.at;
  w.end = 'stopped';
  w.endedAt = input.at;
  const eff = [];
  drive(w, ctx, eff);
  return { ...outOf(w), state: w, ...(eff.length ? { effects: eff } : {}) };
}

// §3.5: a migrated fulfilment continues from its records: its status, its reservations, charge, refund and shipment.
// A shipment the carrier had already reported collected (or later) is a report at the migration instant (S7): the
// migration is before any cancel of this order.
function resume(input, ctx, w) {
  const r = input.records?.fulfilment;
  if (!r) return { ...outOf(w), state: w };
  const s = fromRecords(r);
  return { ...outOf(s), state: s };
}

function fromRecords(r) {
  const s = blank();
  const f = r.fulfilment;
  Object.assign(s, { started: true, oid: r.orderId, cust: r.customerId, cur: r.currency, edition: r.edition, readyAt: r.readyAt ?? null,
    f: { fulfilmentId: f.fulfilmentId, location: f.location, items: f.items, amountMinor: f.amountMinor } });
  for (const it of f.items) s.items[it.sku] = { qty: it.qty, st: 'none' };
  // R4.2 step 1: an item with an active reservation is reserved; a released one was reserved and then compensated (R5.1)
  for (const row of r.reservations ?? []) if (s.items[row.sku] && row.status === 'active') s.items[row.sku].st = 'ok';
  for (const row of r.reservations ?? []) {
    if (s.items[row.sku] && row.status === 'released' && s.items[row.sku].st !== 'ok') { s.items[row.sku].st = 'ok'; s.rel[row.sku] = 'done'; }
  }
  // R4.2 step 2: the charge; R5.1: a refund of it
  if ((r.charges ?? []).length) s.charge = 'ok';
  if ((r.refunds ?? []).length || (r.charges ?? []).some(c => c.refundedMinor > 0)) s.refund = 'done';
  // R4.2 step 3: the shipment; R5.2: a shipment the carrier could not collect
  const sh = (r.shipments ?? [])[0];
  if (sh) {
    s.ship = 'ok';
    if (sh.status === 'cancelled') s.unship = 'done';
    if (sh.status === 'failed') s.cfail = true;
    if (['collected', 'inTransit', 'delivered'].includes(sh.status)) {
      s.collected = true;
      s.reports = [{ meaning: sh.status, reportedAt: r.at }];
    }
  }
  // R4.4, R4.5: the status the records give the fulfilment
  if (r.status === 'dispatched' || r.status === 'completed') { s.dispatched = true; s.collected = true; }
  if (r.status === 'completed') { s.end = 'completed'; s.endedAt = r.at; }
  if (r.status === 'failed') { s.end = 'failed'; s.endedAt = r.at; s.failed = true; s.announced = true; }
  if (r.status === 'cancelled') { s.end = 'stopped'; s.endedAt = r.at; }
  return s;
}
