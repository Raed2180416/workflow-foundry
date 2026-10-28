// Module customer-action, key: the order id. Owns R3.1 (action-required within 120 min of clearing), R3.2 (the
// customer's deadline D = p + customerActionHours; the first amend or cancel at or before D counts; a timeout after D)
// and S1. Calls statuses and notices. Wake-up: `deadline` at D + 30 min (after D, so an action at D still wins; well
// inside the window (D, D + 60 min]).
//
// It starts when the order is recorded, so that an amend that arrives during the fraud review is still judged in time
// (R3.2 counts an action at or before D whatever the review state); R3.1 waits for the clearing.
//
// state: { phase, orderId, placedAt, deadline, unavailable: [fid], available: [fid], at, reason }
//   phase: 'inert' (nothing unavailable) | 'review' (recorded, not cleared) | 'waiting' (action-required sent) |
//          'amended' (counted amend during review) | 'ready' (counted amend, ready at `at`) | 'cancel' | 'timedOut' |
//          'stopped'

const WAKE_AFTER_MIN = 30;

// Files arrive as raw text: parse a JSON file (or pass a parsed value through).
function fileJson(files, path) {
  const v = files?.[path];
  return typeof v === 'string' ? JSON.parse(v) : v ?? null;
}

export function step(input, ctx) {
  switch (input.op) {
    case 'start': return start(input, ctx);
    case 'advance': return advance(input, ctx);
    case 'action': return action(input, ctx);
    case 'stop': return stop(input, ctx);
    case 'resume': return resume(input, ctx);
  }
  throw new Error(`customer-action: unknown op ${input.op}`);
}

export function onEvent(event, ctx) {
  if (event.type === 'timer.fired' && ctx.state && (ctx.state.phase === 'review' || ctx.state.phase === 'waiting')) {
    return timedOut(ctx.state, ctx);
  }
  return { output: view(ctx.state) };
}

function view(state) {
  if (!state) return { state: 'idle', at: null, reason: null, busy: false };
  return {
    state: state.phase, at: state.at ?? null, reason: state.reason ?? null,
    busy: state.phase === 'review' || state.phase === 'waiting',
  };
}

function start(input, ctx) {
  const unavailable = input.fulfilments.filter(f => !f.available).map(f => f.fulfilmentId);
  const available = input.fulfilments.filter(f => f.available).map(f => f.fulfilmentId);
  const deadline = addMinutes(input.placedAt, policyOf(input, ctx).customerActionHours * 60);     // R3.2, S1: from p
  if (unavailable.length === 0) {
    const state = { phase: 'inert', orderId: input.orderId, placedAt: input.placedAt, deadline, unavailable, available, at: null, reason: null };
    return { output: view(state), state };
  }
  const state = { phase: 'review', orderId: input.orderId, placedAt: input.placedAt, deadline, unavailable, available, at: null, reason: null };
  return { output: view(state), state, obligations: { upsert: [wakeUp(deadline)] } };
}

function advance(input, ctx) {
  const state = ctx.state;
  if (state && state.phase === 'amended') {
    // Counted during the review (R3.2): the order is ready when it clears; R3.1 is moot (S9).
    const next = { ...state, phase: 'ready' };
    return { output: view(next), state: next };
  }
  if (!state || state.phase !== 'review') return { output: view(state) };
  // The order is cleared now (R3.1): action-required, within 120 min of the clearing.
  const orderId = state.orderId;
  const next = { ...state, phase: 'waiting', at: input.clearedAt ?? null };
  ctx.call('statuses', orderId, { op: 'set', orderId, fulfilmentId: null, status: 'customerActionRequired' });
  ctx.call('notices', orderId, { op: 'send', template: 'action-required', about: orderId });
  return { output: view(next), state: next };
}

function action(input, ctx) {
  const state = ctx.state;
  if (!state || (state.phase !== 'review' && state.phase !== 'waiting')) return { output: view(state) };
  // The first amend or cancel at or before D counts (R3.2). Later actions change nothing.
  if (Date.parse(input.at) > Date.parse(state.deadline)) return { output: view(state) };
  const orderId = state.orderId;
  if (input.action === 'cancel') {
    const next = { ...state, phase: 'cancel', at: input.at, reason: 'customer' };
    return { output: view(next), state: next, obligations: { cancel: ['deadline'] } };
  }
  if (input.action !== 'amend') return { output: view(state) };
  // amend: every unavailable fulfilment cancelled within 60 min of the amend (R3.2). S5: nothing when none is unavailable.
  if (state.unavailable.length === 0) return { output: view(state) };
  for (const fid of state.unavailable) {
    ctx.call('statuses', orderId, { op: 'set', orderId, fulfilmentId: fid, status: 'cancelled' });
  }
  const obligations = { cancel: ['deadline'] };
  if (state.available.length === 0) {
    const next = { ...state, phase: 'cancel', at: input.at, reason: 'nothing-available' };
    return { output: view(next), state: next, obligations };
  }
  const next = { ...state, phase: state.phase === 'waiting' ? 'ready' : 'amended', at: input.at };
  return { output: view(next), state: next, obligations };
}

function timedOut(state, ctx) {
  // Nothing counted by D: after D, within 60 min of D: every fulfilment cancelled, the order timedOut (R3.2).
  const orderId = state.orderId;
  const all = [...state.unavailable, ...state.available];
  for (const fid of all) ctx.call('statuses', orderId, { op: 'set', orderId, fulfilmentId: fid, status: 'cancelled' });
  ctx.call('statuses', orderId, { op: 'set', orderId, fulfilmentId: null, status: 'timedOut' });
  ctx.call('notices', orderId, { op: 'send', template: 'order-timed-out', about: orderId });
  const next = { ...state, phase: 'timedOut', at: ctx.now };
  return { output: view(next), state: next };
}

function stop(input, ctx) {
  // A counted cancel elsewhere (R6.2, R6.1, a fraud decision) ends the order: no timeout may fire any more.
  if (!ctx.state) return { output: view({ phase: 'stopped' }) };
  const had = ctx.state.phase === 'review' || ctx.state.phase === 'waiting';
  const next = { ...ctx.state, phase: 'stopped' };
  return { output: view(next), state: next, ...(had ? { obligations: { cancel: ['deadline'] } } : {}) };
}

function resume(input, ctx) {
  // §3.5: from the migrated records: a waiting order keeps its deadline; an order not yet cleared is in review.
  const r = input.records ?? {};
  const row = (r['orders.orders'] ?? [])[0];
  const fulfilments = (r['orders.fulfilments'] ?? []).map(f => ({ fulfilmentId: f.fulfilmentId, available: (f.location ?? null) !== null }));
  const start_ = start({ orderId: row?.orderId ?? input.orderId, placedAt: input.placedAt, fulfilments, edition: input.edition }, ctx);
  if (!row || row.status === 'pending') return start_;
  if (row.status === 'customerActionRequired') {
    const state = { ...start_.state, phase: 'waiting' };
    return { output: view(state), state, obligations: { upsert: [wakeUp(start_.state.deadline)] } };
  }
  const state = { ...start_.state, phase: 'stopped' };
  return { output: view(state), state };
}

function policyOf(input, ctx) {
  return fileJson(ctx.files, `rulebook/${input.edition}/policy.json`);
}

function wakeUp(deadline) {
  return { id: 'deadline', kind: 'customer-deadline', anchor: 'placement', dueAt: addMinutes(deadline, WAKE_AFTER_MIN), onDue: 'deadline' };
}

function addMinutes(iso, minutes) {
  return new Date(Date.parse(iso) + minutes * 60000).toISOString();
}
