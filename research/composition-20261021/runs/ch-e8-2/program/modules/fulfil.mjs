// fulfil: one fulfilment's saga (R4.2 reserve, charge, ship), its carrier messages (R4.4), and its compensation (R5.1).
// Keys: 'charge', 'ship', 'status-<to>', 'notice', and the undo keys 'release-<item>', 'refund', 'ship-cancel'. The reserve
// batch has no key of its own: its items are r0, r1, ... The parent calls op 'start' when the order is ready, 'carrier'
// for each report about this fulfilment, and 'compensate' when the order is cancelled.

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const jsonOf = f => (typeof f === 'string' ? JSON.parse(f) : (f ?? null));
const INVALID = ['invalid-args', 'field-renamed'];      // our request was wrong: correct it and re-issue (R4.2)
const MAX_BAD = 3;
const MAX_RESUBMIT = 5;

// The API may rename a field: api/<system>.schema.json in ctx.files shows the current names, so send those.
const nrm = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
function fitArgs(e, files) {
  const props = jsonOf(files?.[`api/${e.system}.schema.json`])?.ops?.[e.op]?.args?.properties;
  if (!props || !isObj(e.args)) return e;
  const names = Object.keys(props);
  const keys = Object.keys(e.args);
  const extra = keys.filter(k => !names.includes(k));
  const missing = names.filter(n => !keys.includes(n));
  const renamed = {};
  for (const k of extra) renamed[k] = names.find(n => nrm(n) === nrm(k)) ?? (extra.length === 1 && missing.length === 1 ? missing[0] : k);
  const args = {};
  for (const k of keys) args[renamed[k] ?? k] = e.args[k];
  return { ...e, args };
}
function fitAll(res, files) {
  if (!isObj(res) || !Array.isArray(res.effects)) return res;
  return { ...res, effects: res.effects.map(e => fitArgs(e, files)) };
}

const setStatus = (st, status, key) => ({ key, system: 'orders', op: 'setStatus', args: { orderId: st.orderId, fulfilmentId: st.fid, status } });
const chargeEffect = st => ({ key: 'charge', system: 'billing', op: 'charge', args: { orderId: st.orderId, fulfilmentId: st.fid, customerId: st.customerId, amountMinor: st.amountMinor, currency: st.currency } });
const shipEffect = st => ({ key: 'ship', system: 'carrier', op: 'create', args: { orderId: st.orderId, fulfilmentId: st.fid, location: st.location, ref: st.fid } });
// A batch op keys its items, not the batch: each item's key ('r0', 'r1', ...) is what its result is routed by.
const reserveEffect = st => ({
  system: 'inventory', op: 'reserve',
  args: { orderId: st.orderId, fulfilmentId: st.fid, location: st.location,
    items: st.items.filter(it => st.res[it.key] !== 'ok').map(it => ({ key: it.key, sku: it.sku, qty: it.qty })) },
});

// The compensating step for one undo key (R5.1).
function undoEffect(st, key) {
  if (key === 'refund') return { key, system: 'billing', op: 'refund', args: { orderId: st.orderId, fulfilmentId: st.fid, amountMinor: st.amountMinor }, compensates: 'charge' };
  if (key === 'ship-cancel') return { key, system: 'carrier', op: 'cancel', args: { orderId: st.orderId, fulfilmentId: st.fid }, compensates: 'ship' };
  const it = st.items.find(i => `release-${i.key}` === key);
  return it ? { key, system: 'inventory', op: 'release', args: { orderId: st.orderId, fulfilmentId: st.fid, sku: it.sku }, compensates: it.key } : null;
}

// Compensation (R5.1): cancel the shipment (not if collection failed), refund the charge, release each committed item.
// Only steps that committed and are not undone yet are undone (never twice, never a step that did not commit).
function undoSteps(st) {
  const undone = { ...st.undone };
  const keys = [];
  if (st.ship === 'ok' && !undone.ship && st.carrier !== 'collectionFailed') { keys.push('ship-cancel'); undone.ship = true; }
  if (st.charge === 'ok' && !undone.refund) { keys.push('refund'); undone.refund = true; }
  for (const it of st.items) if (st.res[it.key] === 'ok' && !undone[it.key]) { keys.push(`release-${it.key}`); undone[it.key] = true; }
  return { effects: keys.map(k => undoEffect(st, k)), undone };
}

// A step that committed after the fulfilment was cancelled or failed is compensated at once (S14, R6.2).
function lateUndo(st, phase) {
  const u = undoSteps(st);
  return { state: { ...st, undone: u.undone }, effects: u.effects, output: { phase, lateUndo: true } };
}

// Re-issue a request the system refused as invalid, with the same key (bounded).
function reissue(st, key, effect, where) {
  const bad = { ...(st.bad ?? {}), [key]: (st.bad?.[key] ?? 0) + 1 };
  if (bad[key] > MAX_BAD) return fail({ ...st, bad }, where, 'invalid-request');
  return { state: { ...st, bad }, effects: [effect], output: { phase: st.phase, reissued: key } };
}

// The outcome of one effect: unknown is decided by status(key) (S2).
const outcomeOf = (p, ctx, system) => (p.status === 'unknown' ? (ctx.status(system, p.key) === 'committed' ? 'ok' : 'error') : p.status);

// R5.2: the fulfilment fails: compensate what committed, set failed, tell the customer.
function fail(st, where, why = null) {
  if (['failed', 'cancelled', 'completed'].includes(st.phase)) return { output: { phase: st.phase } };
  const u = undoSteps(st);
  const effects = [...u.effects, setStatus(st, 'failed', 'status-failed')];
  effects.push({ key: 'notice', system: 'notify', op: 'send', args: { to: st.email ?? '', about: st.fid, template: 'fulfilment-failed', text: `Fulfilment ${st.fid} failed (${why ?? where}).` } });
  return { state: { ...st, phase: 'failed', undone: u.undone }, effects, output: { phase: 'failed', where, why } };
}

export function step(input, ctx) { return fitAll(stepRaw(input, ctx), ctx.files); }

function stepRaw(input, ctx) {
  const st = ctx.state;
  if (input.op === 'start') {
    if (st) return { output: { phase: st.phase } };
    const items = input.items.map((it, i) => ({ key: `r${i}`, sku: it.sku, qty: it.qty }));
    const next = { orderId: input.orderId, fid: input.fid, location: input.location, customerId: input.customerId, email: input.email,
      currency: input.currency, amountMinor: input.amountMinor, items, res: {}, charge: 'none', ship: 'none', carrier: null,
      phase: 'reserving', undone: {}, attempts: 0, bad: {} };
    return { state: next, effects: [setStatus(next, 'processing', 'status-processing'), reserveEffect(next)], output: { phase: 'reserving' } };
  }
  if (!st) return { output: { phase: 'none' } };
  if (input.op === 'carrier') return carrier(input.meaning, input.reportedAt, st, ctx);
  if (input.op === 'compensate') return cancelFulfilment(st, input.reason);
  return { output: { phase: st.phase } };
}

// R4.4: a carrier report about this fulfilment. Reports about a finished or cancelled fulfilment change nothing.
function carrier(meaning, reportedAt, st) {
  const open = ['reserving', 'charging', 'shipping', 'shipped', 'dispatched'].includes(st.phase);
  if (!open || st.ship !== 'ok') return { output: { phase: st.phase, changed: false } };
  if (meaning === 'collected') {
    if (st.phase !== 'shipped') return { output: { phase: st.phase, changed: false } };
    return { state: { ...st, phase: 'dispatched', collected: reportedAt }, effects: [setStatus(st, 'dispatched', 'status-dispatched')], output: { phase: 'dispatched', collected: true } };
  }
  if (meaning === 'delivered') {
    const effects = st.phase === 'dispatched' ? [] : [setStatus(st, 'dispatched', 'status-dispatched')];
    effects.push(setStatus(st, 'completed', 'status-completed'));
    return { state: { ...st, phase: 'completed' }, effects, output: { phase: 'completed', collected: true } };
  }
  if (meaning === 'collectionFailed') return fail({ ...st, carrier: 'collectionFailed' }, 'carrier', 'collection-failed');
  return { output: { phase: st.phase, changed: false } };       // inTransit, info
}

// R6.1 / R6.2: the order is cancelled; this fulfilment is compensated and set cancelled.
function cancelFulfilment(st, reason) {
  if (['completed', 'failed', 'cancelled'].includes(st.phase)) return { output: { phase: st.phase, changed: false } };
  const next = { ...st, phase: 'cancelled' };
  const u = undoSteps(next);
  return { state: { ...next, undone: u.undone }, effects: [...u.effects, setStatus(next, 'cancelled', 'status-cancelled')], output: { phase: 'cancelled', reason } };
}

export function onEvent(event, ctx) { return fitAll(onEventRaw(event, ctx), ctx.files); }

function onEventRaw(event, ctx) {
  const st = ctx.state;
  if (!st) return { output: { phase: 'none' } };
  if (event?.type === 'effect.result') return onResult(event.payload ?? {}, st, ctx);
  return { output: { phase: st.phase } };
}

function onResult(p, st, ctx) {
  if (Array.isArray(p.items) || p.key === 'reserve') return onReserve(p, st);
  if (p.key === 'charge') return onCharge(p, st, ctx);
  if (p.key === 'ship') return onShip(p, st, ctx);
  // an undo step refused as invalid on our request: correct it and re-issue
  if (p.status === 'error' && INVALID.includes(p.error?.code) && undoEffect(st, p.key)) return reissue(st, p.key, undoEffect(st, p.key), 'undo');
  return { output: { phase: st.phase } };
}

// R4.2 reserve: committed items stay, failed ones are resubmitted with their original keys inside the window.
function onReserve(p, st) {
  const next = { ...st, res: { ...st.res } };
  if (p.status === 'ok') for (const it of st.items) next.res[it.key] = 'ok';
  if (Array.isArray(p.items)) for (const it of p.items) if (it?.status === 'ok' && it.key) next.res[it.key] = 'ok';
  if (p.status === 'error' && INVALID.includes(p.error?.code)) return reissue(next, 'reserve', reserveEffect(next), 'reserve');
  if (p.status === 'error' && p.error?.code !== 'batch-item-not-processed') return fail(next, 'reserve', p.error?.code ?? 'error');
  if (st.phase !== 'reserving') return lateUndo(next, st.phase);
  const flagged = next.items.filter(it => next.res[it.key] !== 'ok');
  if (!flagged.length) return { state: { ...next, phase: 'charging' }, effects: [chargeEffect(next)], output: { phase: 'charging' } };
  if (next.attempts >= MAX_RESUBMIT) return fail(next, 'reserve', 'reserve-exhausted');
  const again = { ...next, attempts: next.attempts + 1 };
  return { state: again, effects: [reserveEffect(again)], output: { phase: 'reserving', resubmitted: flagged.length } };
}

function onCharge(p, st, ctx) {
  if (p.status === 'error' && INVALID.includes(p.error?.code)) return reissue(st, 'charge', chargeEffect(st), 'charge');
  if (p.status === 'error') return fail({ ...st, charge: 'declined' }, 'charge', p.error?.code ?? 'error');
  const s = outcomeOf(p, ctx, 'billing');
  if (s === 'error') return fail({ ...st, charge: 'declined' }, 'charge', 'unknown');
  if (s !== 'ok') return { output: { phase: st.phase } };
  const next = { ...st, charge: 'ok' };
  if (st.phase !== 'charging') return lateUndo(next, st.phase);
  return { state: { ...next, phase: 'shipping' }, effects: [shipEffect(st)], output: { phase: 'shipping' } };
}

function onShip(p, st, ctx) {
  if (p.status === 'error' && INVALID.includes(p.error?.code)) return reissue(st, 'ship', shipEffect(st), 'ship');
  if (p.status === 'error') return fail({ ...st, ship: 'error' }, 'ship', p.error?.code ?? 'error');
  const s = outcomeOf(p, ctx, 'carrier');
  if (s === 'error') return fail({ ...st, ship: 'error' }, 'ship', 'unknown');
  if (s !== 'ok') return { output: { phase: st.phase } };
  const next = { ...st, ship: 'ok' };
  if (st.phase !== 'shipping') return lateUndo(next, st.phase);
  return { state: { ...next, phase: 'shipped' }, output: { phase: 'shipped' } };
}
