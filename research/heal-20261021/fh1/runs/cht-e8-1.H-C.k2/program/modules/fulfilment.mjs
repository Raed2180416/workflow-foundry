// Module fulfilment, key: the fulfilment id. One saga per fulfilment. Owns R4.2 (reserve, charge, ship, in that order,
// each after the previous one committed), R4.3 (collection is the point of no return: a cancel is refused after it),
// R4.4 (carrier reports), R5.1 (compensation in reverse order of committed steps), R5.2 (failure), S2 (committed =
// result ok, or outcome unknown and status(key) committed) and S14 (a step committing after a failure or a stop is
// compensated when it commits). Forward steps are emitted only by `advance`, at the end of a tick (S10).
// Effects: inventory.reserve (`reserve-<n>`, items `item.<sku>`), billing.charge (`charge`), carrier.create (`ship`),
// carrier.cancel (`unship`), billing.refund (`refund`), inventory.release (`release.<sku>`). Calls statuses, notices.
// Always return `output`.
//
// state: { orderId, fid, customerId, currency, edition, location, items: [{sku, qty}], amountMinor, phase,
//          batches, reserve: { [sku]: 'pending'|'ok'|'failed'|'released' }, charge, ship, shipUndo, refund,
//          collectionFailed, dispatched, reports: [{ meaning, reportedAt }], end, endedAt }
//   phase: 'new' | 'running' | 'dispatched' | 'completed' | 'failed' | 'stopped'
//   charge / ship / refund: 'none' | 'pending' | 'ok' | 'failed' ; shipUndo, refund undo: 'none'|'pending'|'done'

const MAX_BATCHES = 5;
const MEANINGS = ['collected', 'inTransit', 'delivered', 'collectionFailed'];

// Files arrive as raw text: parse a JSON file (or pass a parsed value through).
function fileJson(files, path) {
  const v = files?.[path];
  return typeof v === 'string' ? JSON.parse(v) : v ?? null;
}

export function step(input, ctx) { return withFit(stepOf(input, ctx), ctx); }

function stepOf(input, ctx) {
  switch (input.op) {
    case 'start': return start(input, ctx);
    case 'advance': return advance(input, ctx);
    case 'carrier': return carrier(input, ctx);
    case 'stop': return stop(input, ctx);
    case 'get': return { output: view(ctx.state) };
    case 'resume': return resume(input, ctx);
  }
  throw new Error(`fulfilment: unknown op ${input.op}`);
}

export function onEvent(event, ctx) { return withFit(eventOf(event, ctx), ctx); }

function eventOf(event, ctx) {
  const state = ctx.state;
  if (!state) return { output: view(null) };
  if (event.type !== 'effect.result') return { output: view(state) };
  const p = event.payload ?? {};
  const r = resultOf(p);
  if (p.key === 'charge') return chargeResult(state, r, ctx);
  if (p.key === 'ship') return shipResult(state, r, ctx);
  if (p.key === 'unship' || p.key === 'refund' || (typeof p.key === 'string' && p.key.startsWith('release.'))) {
    return undoResult(state, p, r, ctx);
  }
  if (p.system === 'inventory' && p.op === 'reserve') return reserveResult(state, p, r, ctx);
  throw new Error(`fulfilment: unexpected effect result ${JSON.stringify(p).slice(0, 160)}`);
}

function view(state) {
  if (!state) return { state: 'idle', end: null, endedAt: null, reports: [], busy: false };
  return {
    state: state.phase, end: state.end ?? null, endedAt: state.endedAt ?? null,
    reports: state.reports, busy: busy(state),
  };
}

function busy(s) {
  if (s.charge === 'pending' || s.ship === 'pending' || s.shipUndo === 'pending' || s.refund === 'pending') return true;
  return Object.values(s.reserve ?? {}).includes('pending');
}

// ---------------------------------------------------------------------------------------------------------------------
// Start and forward steps

function start(input, ctx) {
  const items = mergeItems(input.fulfilment.items);
  const state = {
    orderId: input.orderId, fid: input.fulfilment.fulfilmentId, customerId: input.customerId, currency: input.currency,
    edition: input.edition, location: input.fulfilment.location, items, amountMinor: input.fulfilment.amountMinor,
    phase: 'running', batches: 0,
    reserve: Object.fromEntries(items.map(i => [i.sku, 'none'])),
    charge: 'none', ship: 'none', shipUndo: 'none', refund: 'none', collectionFailed: false, dispatched: false,
    reports: [], end: null, endedAt: null,
  };
  return { output: view(state), state };
}

function advance(input, ctx) {
  const state = ctx.state;
  if (!state) return { output: view(null) };
  if (state.phase === 'failed' || state.phase === 'stopped') return compensate(state, ctx);
  if (state.phase !== 'running' && state.phase !== 'dispatched') return { output: view(state) };
  const effects = [];
  const s = { ...state, reserve: { ...state.reserve } };
  // Step 1: reserve every item, as one batch (R4.2).
  const emptyReserve = Object.values(s.reserve).every(v => v === 'none');
  if (emptyReserve) {
    const items = s.items.map(i => ({ key: `item.${i.sku}`, sku: i.sku, qty: i.qty }));
    for (const i of s.items) s.reserve[i.sku] = 'pending';
    s.batches = 1;
    effects.push(reserveEffect(s, items));
  }
  // Step 2: charge once every reservation committed (R4.2).
  if (s.charge === 'none' && Object.values(s.reserve).every(v => v === 'ok')) {
    s.charge = 'pending';
    effects.push({ key: 'charge', system: 'billing', op: 'charge', args: {
      orderId: s.orderId, fulfilmentId: s.fid, customerId: s.customerId, amountMinor: s.amountMinor, currency: s.currency,
    } });
  }
  // Step 3: book the shipment once the charge committed (R4.2), with the fulfilment id as the carrier ref.
  if (s.charge === 'ok' && s.ship === 'none') {
    s.ship = 'pending';
    effects.push({ key: 'ship', system: 'carrier', op: 'create', args: {
      orderId: s.orderId, fulfilmentId: s.fid, location: s.location, ref: s.fid,
    } });
  }
  if (effects.length === 0) return { output: view(state) };
  return { output: view(s), state: s, effects };
}

// A batch op keys its items, not the batch (§2): the item keys are the idempotency keys.
function reserveEffect(s, items) {
  return { system: 'inventory', op: 'reserve', args: { orderId: s.orderId, fulfilmentId: s.fid, location: s.location, items } };
}

function mergeItems(items) {
  const bySku = new Map();
  for (const i of items) bySku.set(i.sku, (bySku.get(i.sku) ?? 0) + i.qty);
  return [...bySku].map(([sku, qty]) => ({ sku, qty }));
}

// ---------------------------------------------------------------------------------------------------------------------
// Results of forward steps

function reserveResult(state, p, r, ctx) {
  const s = { ...state, reserve: { ...state.reserve } };
  const outcome = {};
  if (r.status === 'ok') {
    for (const sku of Object.keys(s.reserve)) if (s.reserve[sku] === 'pending') outcome[sku] = 'ok';
  } else if (r.status === 'partial' || Array.isArray(p.items)) {
    for (const it of p.items ?? []) {
      const sku = String(it.key ?? '').replace(/^item\./, '');
      if (!(sku in s.reserve)) continue;
      if (it.status === 'ok') outcome[sku] = 'ok';
      else outcome[sku] = it.error?.retryable === false || it.retryable === false ? 'failed-permanent' : 'failed';
    }
  } else if (isInvalidRequest(r)) {
    // R4.2: a 400 is our own mistake: correct and re-issue with the same key, inside the window (not a failure).
    return reissueReserve(s, p, ctx);
  } else if (r.status === 'error' && r.retryable === false) {
    for (const sku of Object.keys(s.reserve)) if (s.reserve[sku] === 'pending') s.reserve[sku] = 'failed';
    return fail(s, ctx, 'reserve-error', ctx.now);
  } else {
    throw new Error(`fulfilment: unexpected reserve result ${JSON.stringify(p).slice(0, 160)}`);
  }
  for (const [sku, v] of Object.entries(outcome)) {
    if (v === 'ok') s.reserve[sku] = 'ok';
  }
  const permanent = Object.values(outcome).includes('failed-permanent');
  const failed = Object.keys(outcome).filter(sku => outcome[sku] === 'failed').concat(Object.keys(s.reserve).filter(sku => s.reserve[sku] === 'pending' && !(sku in outcome)));
  if (permanent) {
    for (const sku of Object.keys(s.reserve)) if (s.reserve[sku] === 'pending') s.reserve[sku] = 'failed';
    return fail(s, ctx, 'reserve-error', ctx.now);
  }
  if (failed.length === 0) return afterStep(s, ctx);
  if (s.phase === 'stopped' || s.phase === 'failed') {
    for (const sku of failed) s.reserve[sku] = 'failed';
    return compensate(s, ctx);                                          // nothing new after a stop or a failure
  }
  // A partial batch is delivered, not retried: resubmit only the failed items, with their original keys (R4.2).
  if (s.batches >= MAX_BATCHES) {
    for (const sku of failed) s.reserve[sku] = 'failed';
    return fail(s, ctx, 'reserve-error', ctx.now);
  }
  s.batches += 1;
  const items = s.items.filter(i => failed.includes(i.sku)).map(i => ({ key: `item.${i.sku}`, sku: i.sku, qty: i.qty }));
  for (const sku of failed) s.reserve[sku] = 'pending';
  return { output: view(s), state: s, effects: [reserveEffect(s, items)] };
}

// After a result, forward steps that became due are emitted by advance (or here, at once when the saga moves on).
function afterStep(s, ctx) {
  const next = advance({}, { ...ctx, state: s });
  return next.state ? next : { output: view(s), state: s };
}

function reissueReserve(s, p, ctx) {
  if (s.phase === 'stopped' || s.phase === 'failed') {
    for (const sku of Object.keys(s.reserve)) if (s.reserve[sku] === 'pending') s.reserve[sku] = 'failed';
    return compensate(s, ctx);
  }
  const items = s.items.filter(i => s.reserve[i.sku] === 'pending').map(i => ({ key: `item.${i.sku}`, sku: i.sku, qty: i.qty }));
  return { output: view(s), state: s, effects: [reserveEffect(s, items)] };
}

function chargeResult(state, r, ctx) {
  const s = { ...state };
  if (r.status === 'ok') { s.charge = 'ok'; return afterStepOrCompensate(s, ctx); }
  if (isInvalidRequest(r)) return reissueCharge(s, ctx);
  if (isDeclined(r) || r.status === 'error' || r.status === 'unknown') {
    if (r.status === 'unknown' && ctx.status('billing', 'charge') === 'committed') { s.charge = 'ok'; return afterStepOrCompensate(s, ctx); }
    s.charge = 'failed';
    return fail(s, ctx, isDeclined(r) ? 'card-declined' : 'charge-error', ctx.now);
  }
  throw new Error(`fulfilment: unexpected charge result ${JSON.stringify(r).slice(0, 160)}`);
}

function reissueCharge(s, ctx) {
  if (s.phase === 'stopped' || s.phase === 'failed') { s.charge = 'failed'; return compensate(s, ctx); }
  return { output: view(s), state: s, effects: [{ key: 'charge', system: 'billing', op: 'charge', args: {
    orderId: s.orderId, fulfilmentId: s.fid, customerId: s.customerId, amountMinor: s.amountMinor, currency: s.currency,
  } }] };
}

function shipResult(state, r, ctx) {
  const s = { ...state };
  if (r.status === 'ok') { s.ship = 'ok'; return afterStepOrCompensate(s, ctx); }
  if (isInvalidRequest(r)) {
    if (s.phase === 'stopped' || s.phase === 'failed') { s.ship = 'failed'; return compensate(s, ctx); }
    return { output: view(s), state: s, effects: [{ key: 'ship', system: 'carrier', op: 'create', args: {
      orderId: s.orderId, fulfilmentId: s.fid, location: s.location, ref: s.fid,
    } }] };
  }
  if (r.status === 'unknown' && ctx.status('carrier', 'ship') === 'committed') { s.ship = 'ok'; return afterStepOrCompensate(s, ctx); }
  if (r.status === 'error' || r.status === 'unknown') {
    s.ship = 'failed';
    return fail(s, ctx, 'ship-error', ctx.now);
  }
  throw new Error(`fulfilment: unexpected ship result ${JSON.stringify(r).slice(0, 160)}`);
}

function afterStepOrCompensate(s, ctx) {
  // S14: a step that commits after the fulfilment failed or was stopped is compensated now.
  if (s.phase === 'failed' || s.phase === 'stopped') return compensate(s, ctx);
  return afterStep(s, ctx);
}

function undoResult(state, p, r, ctx) {
  const s = { ...state };
  if (p.key === 'unship') s.shipUndo = 'done';
  if (p.key === 'refund') s.refund = 'ok';
  if (typeof p.key === 'string' && p.key.startsWith('release.')) {
    const sku = p.key.slice('release.'.length);
    if (sku in s.reserve) s.reserve[sku] = 'released';
  }
  return { output: view(s), state: s };
}

// ---------------------------------------------------------------------------------------------------------------------
// Failure and compensation (R5.1, R5.2, S14)

function fail(s, ctx, reason, at) {
  if (s.phase === 'failed' || s.phase === 'stopped') return compensate(s, ctx);
  s.phase = 'failed';
  s.end = 'failed';
  s.endedAt = at;
  s.failReason = reason;
  const undo = compensate(s, ctx);
  const fs = { ...undo.state };
  const effects = [...(undo.effects ?? [])];
  const orderId = s.orderId;
  ctx.call('statuses', orderId, { op: 'set', orderId, fulfilmentId: s.fid, status: 'failed' });
  ctx.call('notices', orderId, { op: 'send', template: 'fulfilment-failed', about: s.fid });
  return { output: view(fs), state: fs, effects };
}

// Undo every committed step that is not undone yet, in reverse order: shipment, charge, reserved items (R5.1).
// Never undoes a step that did not commit, and never undoes one twice (the flags say which).
function compensate(state, ctx) {
  const s = { ...state, reserve: { ...state.reserve } };
  const effects = [];
  if (s.ship === 'ok' && s.shipUndo === 'none' && !s.collectionFailed) {
    s.shipUndo = 'pending';
    effects.push({ key: 'unship', system: 'carrier', op: 'cancel', args: { orderId: s.orderId, fulfilmentId: s.fid } });
  }
  // Reverse order: the shipment is settled before the charge is refunded, and the charge before the items are released.
  // A step still in flight is undone only after it commits (S14), when this runs again with the earlier steps undone.
  const settled = s.ship !== 'pending';
  if (s.charge === 'ok' && s.refund === 'none' && settled) {
    s.refund = 'pending';
    effects.push({ key: 'refund', system: 'billing', op: 'refund', args: { orderId: s.orderId, fulfilmentId: s.fid, amountMinor: s.amountMinor } });
  }
  for (const i of s.items) {
    if (s.reserve[i.sku] === 'ok' && settled && s.charge !== 'pending') {
      s.reserve[i.sku] = 'released';
      effects.push({ key: `release.${i.sku}`, system: 'inventory', op: 'release', args: { orderId: s.orderId, fulfilmentId: s.fid, sku: i.sku } });
    }
  }
  if (effects.length === 0) return { output: view(s), state: s };
  return { output: view(s), state: s, effects };
}

// ---------------------------------------------------------------------------------------------------------------------
// Carrier reports (R4.4, §3.3)

function carrier(input, ctx) {
  const s = { ...ctx.state, reports: [...(ctx.state?.reports ?? [])] };
  if (!ctx.state) return { output: view(null) };
  const meaning = meaningOf(ctx, input.message);
  const at = input.message.reportedAt;
  if (MEANINGS.includes(meaning) && !s.reports.some(x => x.meaning === meaning && x.reportedAt === at)) {
    s.reports.push({ meaning, reportedAt: at });
  }
  if (s.phase !== 'running' && s.phase !== 'dispatched') return { output: view(s), state: s };   // ended: changes nothing
  if (meaning === 'collected') {
    if (s.phase !== 'running' || s.ship !== 'ok') return { output: view(s), state: s };
    return dispatch(s, ctx, false);
  }
  if (meaning === 'delivered') {
    if (s.ship !== 'ok') return { output: view(s), state: s };
    return complete(s, ctx, at);
  }
  if (meaning === 'collectionFailed') {
    s.collectionFailed = true;
    if (s.phase !== 'running') return { output: view(s), state: s };
    return fail(s, ctx, 'collection-failed', at);
  }
  return { output: view(s), state: s };
}

function meaningOf(ctx, message) {
  const table = fileJson(ctx.files, `rulebook/${ctx.state.edition}/carrier-codes.json`) ?? [];
  const row = table.find(r => r.carrier === message.carrier && r.code === message.code);
  return row ? row.meaning : 'info';
}

function dispatch(s, ctx) {
  s.phase = 'dispatched';
  s.dispatched = true;
  ctx.call('statuses', s.orderId, { op: 'set', orderId: s.orderId, fulfilmentId: s.fid, status: 'dispatched' });
  return { output: view(s), state: s };
}

function complete(s, ctx, at) {
  const effects = [];
  const fromDispatch = s.dispatched;
  s.phase = 'completed';
  s.end = 'completed';
  s.endedAt = at;
  ctx.call('statuses', s.orderId, { op: 'set', orderId: s.orderId, fulfilmentId: s.fid, status: 'completed', afterStatus: fromDispatch ? undefined : 'dispatched' });
  return { output: view(s), state: s, effects };
}

// ---------------------------------------------------------------------------------------------------------------------
// Stop (a counted customer cancel, R6.2): no new step; compensate what committed; later commits compensated (S14)

function stop(input, ctx) {
  const state = ctx.state;
  if (!state) return { output: view({ phase: 'stopped', reports: [] }) };
  if (state.phase === 'completed' || state.phase === 'failed') return { output: view(state) };
  const s = { ...state, phase: 'stopped', end: 'stopped', endedAt: input.at };
  return compensate(s, ctx);
}

function resume(input, ctx) {
  // §3.5: a migrated fulfilment continues from its records.
  const r = input.records ?? {};
  if (!r.phase) return { output: view(ctx.state) };
  const state = { ...r };
  return { output: view(state), state };
}

// ---------------------------------------------------------------------------------------------------------------------

// An error is { code: <http status>, reason: <name>, retryable }.
function resultOf(p) {
  const error = p.error ?? null;
  return {
    status: p.status,
    code: error?.reason ?? null,
    retryable: error?.retryable ?? p.retryable ?? null,
    http: typeof error?.code === 'number' ? error.code : null,
  };
}

const isInvalidRequest = r => r.http === 400 || r.code === 'invalid-args' || r.code === 'field-renamed';
const isDeclined = r => r.http === 402 || r.code === 'card-declined';

// Args follow the system's current schema (api/<system>.schema.json, which always shows the current names): a field the
// system renamed is sent under its new name, so the call is not refused with 400 field-renamed (R4.2).
function withFit(res, ctx) {
  if (res && Array.isArray(res.effects)) {
    res.effects = res.effects.map(e => ({ ...e, args: fitObject(argsSchema(ctx.files, e.system, e.op), e.args) }));
  }
  return res;
}

function argsSchema(files, system, op) {
  const api = fileJson(files, `api/${system}.schema.json`);
  return api?.ops?.[op]?.args ?? null;
}

function fitObject(schema, obj) {
  if (!schema || !schema.properties || !obj || typeof obj !== 'object') return obj;
  const props = schema.properties;
  const free = Object.keys(props).filter(k => !(k in obj));
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k in props) { out[k] = fitValue(props[k], v); continue; }
    const target = pickRename(k, free);
    if (target) { out[target] = fitValue(props[target], v); free.splice(free.indexOf(target), 1); } else out[k] = v;
  }
  return out;
}

function fitValue(sch, v) {
  if (Array.isArray(v) && sch && sch.items && sch.items.properties) return v.map(x => fitObject(sch.items, x));
  return v;
}

function pickRename(k, free) {
  const norm = x => x.toLowerCase().replace(/[^a-z0-9]/g, '');
  const nk = norm(k);
  const exact = free.find(f => norm(f) === nk);
  if (exact) return exact;
  const similar = free.filter(f => norm(f).includes(nk) || nk.includes(norm(f)));
  if (similar.length === 1) return similar[0];
  return free.length === 1 ? free[0] : null;
}
