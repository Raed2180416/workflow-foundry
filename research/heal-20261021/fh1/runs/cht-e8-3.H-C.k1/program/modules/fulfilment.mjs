// Module fulfilment, key: the fulfilment id. Owns R4.2, R4.3, R4.4, R5.1, R5.2, S2, S14 (DECOMPOSITION 4.6).
// Forward steps (reserve, charge, ship) are emitted only by `advance`, which the parent calls at the end of a tick, so
// a counted cancel in the same tick stops them first (S10, R6.2). Results and stops only compensate (R5.1).
// Effect keys (per fulfilment): 'charge', 'ship', 'unship', 'refund', 'release.<sku>'. The reservation batch has no key:
// each item carries its own key ('item.<sku>'), and its result comes back by item key.

const MAX_BATCHES = 4;
const MAX_BAD_REQUESTS = 20;
const MEANINGS = ['collected', 'inTransit', 'delivered', 'collectionFailed', 'info'];

export function step(input, ctx) {
  const s = ctx.state ?? fresh();
  const eff = [];
  if (input.op === 'start') start(s, input);
  else if (input.op === 'resume') resume(s, input);
  else if (input.op === 'advance') { if (live(s)) forward(s, ctx, eff); }
  else if (input.op === 'carrier') carrier(s, input.message, input.at, ctx, eff);
  else if (input.op === 'stop') stop(s, input.at, ctx, eff);
  conformAll(ctx.files, eff);
  return { output: outOf(s), state: s, effects: eff };
}

export function onEvent(event, ctx) {
  const s = ctx.state ?? fresh();
  const eff = [];
  if (event.type === 'effect.result') result(s, event.payload ?? {}, ctx, eff);
  conformAll(ctx.files, eff);
  return { output: outOf(s), state: s, effects: eff };
}

function start(s, input) {
  if (s.started || s.stopped) return;
  const f = input.fulfilment;
  Object.assign(s, {
    started: true, orderId: input.orderId, customerId: input.customerId, currency: input.currency,
    edition: input.edition, readyAt: input.readyAt, location: f.location, amountMinor: f.amountMinor, items: mergeItems(f.items),
  });
  s.reserve = { tries: 0, reuse: false, inflight: false, st: {} };
  for (const i of s.items) s.reserve.st[i.sku] = 'none';
}

// Migration (SPEC-E 3.5): continue from the records that exist for this fulfilment.
function resume(s, input) {
  if (s.started) return;
  start(s, input);
  const rec = input.records ?? {};
  for (const r of rec.reservations ?? []) if (r.status === 'active' && s.reserve.st[r.sku] !== undefined) s.reserve.st[r.sku] = 'ok';
  if (rec.charge) s.charge = 'ok';
  if (rec.shipment) {
    s.ship = 'ok';
    const meaning = { collected: 'collected', inTransit: 'inTransit', delivered: 'delivered' }[rec.shipment.status];
    if (meaning) s.reports.push({ meaning, reportedAt: rec.shipment.createdAt ?? input.readyAt });
  }
  if (input.status === 'dispatched' || input.status === 'completed' || rec.shipment?.status === 'delivered') s.dispatched = true;
  if (input.status === 'completed') { s.end = 'completed'; s.endedAt = input.readyAt; }
  else if (input.status === 'failed') { s.end = 'failed'; s.endedAt = input.readyAt; }
  else if (input.status === 'cancelled') { s.end = 'stopped'; s.endedAt = input.readyAt; }
}

// R4.2: reserve every item, then charge, then book the shipment. One step at a time, each after the previous committed.
function forward(s, ctx, eff) {
  if (s.reserve.inflight) return;
  const todo = s.items.filter(i => s.reserve.st[i.sku] === 'none');
  if (todo.length) {
    if (!s.reserve.reuse && s.reserve.tries >= MAX_BATCHES) { fail(s, 'reserve-retries', ctx.now); return; }
    if (!s.reserve.reuse) s.reserve.tries += 1;
    s.reserve.reuse = false;
    for (const i of todo) s.reserve.st[i.sku] = 'pending';
    s.reserve.inflight = true;
    eff.push({
      system: 'inventory',
      op: 'reserve',
      args: {
        orderId: s.orderId, fulfilmentId: ctx.key, location: s.location,
        items: todo.map(i => ({ key: `item.${i.sku}`, sku: i.sku, qty: i.qty })),
      },
    });
    return;
  }
  if (s.items.some(i => s.reserve.st[i.sku] !== 'ok')) return;
  if (s.charge === 'none') {
    s.charge = 'pending';
    eff.push({ key: 'charge', system: 'billing', op: 'charge', args: { orderId: s.orderId, fulfilmentId: ctx.key, customerId: s.customerId, amountMinor: s.amountMinor, currency: s.currency } });
    return;
  }
  if (s.charge !== 'ok') return;
  if (s.ship === 'none') {
    s.ship = 'pending';
    eff.push({ key: 'ship', system: 'carrier', op: 'create', args: { orderId: s.orderId, fulfilmentId: ctx.key, location: s.location, ref: ctx.key } });
  }
}

function result(s, p, ctx, eff) {
  const k = String(p.key ?? '');
  if (isBatch(p)) {
    if (s.reserve.inflight) onReserve(s, p, ctx);
  } else if (k === 'charge') {
    onCharge(s, p, ctx);
  } else if (k === 'ship') {
    onShip(s, p, ctx);
  } else if (k === 'unship') {
    s.shipCancel = 'done';
  } else if (k === 'refund') {
    s.refund = 'done';
  } else if (k.startsWith('release.')) {
    s.released[k.slice('release.'.length)] = 'done';
  }
  comp(s, ctx, eff);
}

// The reservation batch comes back with its item keys (the batch itself has no key).
function isBatch(p) {
  return p.op === 'reserve' || (Array.isArray(p.items) && p.items.some(i => i && typeof i.key === 'string' && i.key.startsWith('item.')));
}

// Per item: ok commits it; a 400 is our request's fault (re-issue it); a permanent error fails the fulfilment (R5.2);
// anything else is retried in a new batch with the original item keys.
function onReserve(s, p, ctx) {
  s.reserve.inflight = false;
  const items = Array.isArray(p.items) ? p.items : null;
  for (const sku of Object.keys(s.reserve.st)) {
    if (s.reserve.st[sku] !== 'pending') continue;
    const r = items ? items.find(x => x && x.key === `item.${sku}`) : null;
    const src = r ?? p;
    if (src.status === 'ok' || (!r && p.status === 'ok')) { s.reserve.st[sku] = 'ok'; continue; }
    const e = errInfo(src);
    if (e.invalid) { s.reserve.st[sku] = 'none'; s.reserve.reuse = true; badRequest(s, ctx); }
    else if (e.permanent) { s.reserve.st[sku] = 'failed'; fail(s, `reserve:${e.code}`, ctx.now); }
    else s.reserve.st[sku] = 'none';
  }
}

function onCharge(s, p, ctx) {
  if (p.status === 'ok') { s.charge = 'ok'; return; }
  if (p.status === 'unknown') { s.charge = ctx.status('billing', 'charge') === 'committed' ? 'ok' : 'none'; return; }
  const e = errInfo(p);
  if (e.invalid) { s.charge = 'none'; badRequest(s, ctx); return; }
  if (e.permanent) {
    s.charge = e.code === 'card-declined' ? 'declined' : 'failed';
    fail(s, `charge:${e.code}`, ctx.now);
    return;
  }
  s.charge = 'none';
}

function onShip(s, p, ctx) {
  if (p.status === 'ok') { s.ship = 'ok'; return; }
  if (p.status === 'unknown') { s.ship = ctx.status('carrier', 'ship') === 'committed' ? 'ok' : 'none'; return; }
  const e = errInfo(p);
  if (e.invalid) { s.ship = 'none'; badRequest(s, ctx); return; }
  if (e.permanent) { s.ship = 'failed'; fail(s, `carrier:${e.code}`, ctx.now); return; }
  s.ship = 'none';
}

// A request the platform keeps refusing cannot finish the fulfilment; after too many, it fails rather than loops.
function badRequest(s, ctx) {
  s.bad = (s.bad || 0) + 1;
  if (s.bad > MAX_BAD_REQUESTS) fail(s, 'invalid-request', ctx.now);
}

// R4.4: carrier reports. Repeats, out-of-order reports and reports about a stopped or ended fulfilment change nothing
// except the record of reports, which cancellation reads for S7.
function carrier(s, msg, at, ctx, eff) {
  const meaning = translate(ctx, s.edition, msg.code);
  if (!s.reports.some(r => r.meaning === meaning && r.reportedAt === msg.reportedAt)) {
    s.reports.push({ meaning, reportedAt: msg.reportedAt });
  }
  if (!s.started || s.stopped || s.failing || s.end) return;
  if (meaning === 'collected' || meaning === 'delivered') setDispatched(s, ctx);
  if (meaning === 'delivered') {
    ctx.call('statuses', s.orderId, { op: 'set', fulfilmentId: ctx.key, status: 'completed' });
    s.end = 'completed';
    s.endedAt = at;
  } else if (meaning === 'collectionFailed') {
    s.collectionFailed = true;
    fail(s, 'collection-failed', at);
    comp(s, ctx, eff);
  }
}

function setDispatched(s, ctx) {
  if (s.dispatched) return;
  s.dispatched = true;
  ctx.call('statuses', s.orderId, { op: 'set', fulfilmentId: ctx.key, status: 'dispatched' });
}

// R6.2: stop = no new steps; compensate what committed, and what commits later (in flight).
function stop(s, at, ctx, eff) {
  if (s.end || s.failing) return;
  if (!s.stopped) { s.stopped = true; s.stopAt = at; }
  comp(s, ctx, eff);
}

function fail(s, reason, now) {
  if (s.stopped || s.failing || s.end) return;
  s.failing = true;
  s.failReason = reason;
  s.failedAt = now;
}

// R5.1: undo committed steps in reverse order: shipment, charge, reservations. Waits for steps still in flight.
function comp(s, ctx, eff) {
  if (!(s.stopped || s.failing) || s.end) return;
  if (s.reserve.inflight || s.charge === 'pending' || s.ship === 'pending') return;
  if (s.ship === 'ok' && s.shipCancel === 'none' && !s.collectionFailed) {
    s.shipCancel = 'pending';
    eff.push({ key: 'unship', system: 'carrier', op: 'cancel', args: { orderId: s.orderId, fulfilmentId: ctx.key } });
    return;
  }
  if (s.shipCancel === 'pending') return;
  if (s.charge === 'ok' && s.refund === 'none') {
    s.refund = 'pending';
    eff.push({ key: 'refund', system: 'billing', op: 'refund', args: { orderId: s.orderId, fulfilmentId: ctx.key, amountMinor: s.amountMinor } });
    return;
  }
  if (s.refund === 'pending') return;
  let issued = false;
  for (const i of s.items) {
    if (s.reserve.st[i.sku] === 'ok' && !s.released[i.sku]) {
      s.released[i.sku] = 'pending';
      issued = true;
      eff.push({ key: `release.${i.sku}`, system: 'inventory', op: 'release', args: { orderId: s.orderId, fulfilmentId: ctx.key, sku: i.sku } });
    }
  }
  if (issued) return;
  if (Object.values(s.released).includes('pending')) return;
  finish(s, ctx);
}

function finish(s, ctx) {
  if (s.failing) {
    s.end = 'failed';
    s.endedAt = ctx.now;
    ctx.call('statuses', s.orderId, { op: 'set', fulfilmentId: ctx.key, status: 'failed' });
    ctx.call('notices', s.orderId, { op: 'send', template: 'fulfilment-failed', about: ctx.key, customerId: s.customerId });
  } else {
    s.end = 'stopped';
    s.endedAt = s.stopAt ?? ctx.now;
  }
}

function live(s) {
  return s.started && !s.stopped && !s.failing && !s.end;
}

function translate(ctx, edition, code) {
  const m = lookup(J(ctx.files, `rulebook/${edition}/carrier-codes.json`), 'code', code, 'meaning');
  return MEANINGS.includes(m) ? m : 'info';
}

function mergeItems(items) {
  const by = {};
  for (const i of items ?? []) by[i.sku] = (by[i.sku] ?? 0) + i.qty;
  return Object.keys(by).map(sku => ({ sku, qty: by[sku] }));
}

// SPEC-E 4.6: effect arguments follow the system's current schema (api/<system>.schema.json, after any F5 rename).
function conformAll(files, effects) {
  for (const e of effects) e.args = conform(files, e.system, e.op, e.args);
}

function conform(files, system, op, args) {
  const schema = J(files, `api/${system}.schema.json`)?.ops?.[op]?.args;
  return schema && schema.properties ? fit(args, schema) : args;
}

// A field the schema names differently maps to its new name when the names match, or when it is the last one left.
function fit(obj, schema) {
  const props = schema.properties;
  const norm = x => x.toLowerCase().replace(/minor/g, '').replace(/[^a-z0-9]/g, '');
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const out = {};
  const left = [];
  for (const k of Object.keys(obj)) { if (has(props, k)) out[k] = obj[k]; else left.push(k); }
  const free = Object.keys(props).filter(p => !has(obj, p));
  const rest = [];
  for (const k of left) {
    const hit = free.find(p => norm(p) === norm(k)) ?? free.find(p => norm(p).includes(norm(k)) || norm(k).includes(norm(p)));
    if (hit !== undefined) { out[hit] = obj[k]; free.splice(free.indexOf(hit), 1); } else rest.push(k);
  }
  if (rest.length === 1 && free.length === 1) { out[free[0]] = obj[rest[0]]; rest.length = 0; }
  for (const k of rest) out[k] = obj[k];
  for (const k of Object.keys(out)) {
    const p = props[k];
    if (p && p.items && p.items.properties && Array.isArray(out[k])) {
      out[k] = out[k].map(x => (x && typeof x === 'object' ? fit(x, p.items) : x));
    }
  }
  return out;
}

function errInfo(p) {
  const e = p.error;
  const code = typeof e === 'string' ? e : (e?.code ?? p.code ?? null);
  const retryable = e && typeof e === 'object' && 'retryable' in e ? e.retryable : p.retryable;
  const invalid = code === 'invalid-args' || code === 'field-renamed';
  // A declined card is permanent (R5.2) whatever flag the result carries.
  return { code, invalid, permanent: !invalid && (retryable === false || code === 'card-declined') };
}

function fresh() {
  return {
    started: false, stopped: false, failing: false, failReason: null, failedAt: null, stopAt: null,
    end: null, endedAt: null, reports: [], collectionFailed: false, dispatched: false,
    orderId: null, customerId: null, currency: null, edition: null, readyAt: null, location: null,
    amountMinor: 0, items: [],
    reserve: { tries: 0, reuse: false, inflight: false, st: {} },
    charge: 'none', ship: 'none', shipCancel: 'none', refund: 'none', released: {}, bad: 0,
  };
}

function outOf(s) {
  const state = s.end === 'completed' ? 'completed' : s.end === 'failed' ? 'failed' : s.end === 'stopped' ? 'stopped'
    : s.failing ? 'failing' : s.dispatched ? 'dispatched' : s.charge === 'ok' && s.ship === 'ok' ? 'booked'
    : s.started ? 'active' : 'idle';
  const busy = s.reserve.inflight || s.charge === 'pending' || s.ship === 'pending' || s.shipCancel === 'pending'
    || s.refund === 'pending' || Object.values(s.released).includes('pending');
  return { state, end: s.end, endedAt: s.endedAt, failing: !!s.failing, reports: s.reports, busy: !!busy };
}

function J(files, p) {
  let v = files ? files[p] : undefined;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch (e) { v = null; } }
  return v === undefined ? null : v;
}

// The value of `valueField` on the row whose `keyField` is `key`, in an array of rows or a map keyed by `key`.
function lookup(data, keyField, key, valueField) {
  const pick = e => (e && typeof e === 'object' ? (valueField in e ? e[valueField] : e) : e);
  const walk = (x, d) => {
    if (x === null || typeof x !== 'object' || d > 3) return undefined;
    if (Array.isArray(x)) {
      const hit = x.find(e => e && typeof e === 'object' && e[keyField] === key);
      if (hit !== undefined) return pick(hit);
      for (const y of x) { const r = walk(y, d + 1); if (r !== undefined) return r; }
      return undefined;
    }
    if (Object.prototype.hasOwnProperty.call(x, key)) return pick(x[key]);
    for (const k of Object.keys(x)) { const r = walk(x[k], d + 1); if (r !== undefined) return r; }
    return undefined;
  };
  return walk(data, 0);
}
