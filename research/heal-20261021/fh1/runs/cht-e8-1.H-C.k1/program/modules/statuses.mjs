// Module statuses, key: the order id. Owns R7.2 (§2 orders.setStatus): the only writer of order and fulfilment
// statuses. The system does not check transitions, so this module does: forward only, each status at most once,
// and a late or repeated request changes nothing. Effects: orders.setStatus (keys `order.<status>`,
// `f.<fulfilmentId>.<status>`). Always return `output`.
//
// state: { order: status|null, fulfilments: { [fulfilmentId]: status } }   (null until init)

const ORDER_NEXT = {
  pending: ['customerActionRequired', 'processing', 'cancelled', 'timedOut'],
  customerActionRequired: ['processing', 'cancelled', 'timedOut'],
  processing: ['completed', 'failed', 'cancelled'],
  completed: [], failed: [], cancelled: [], timedOut: [],
};

const FULFILMENT_NEXT = {
  unavailable: ['cancelled'],
  pending: ['processing', 'failed', 'cancelled'],
  processing: ['dispatched', 'failed', 'cancelled'],
  dispatched: ['completed'],
  completed: [], failed: [], cancelled: [],
};

export function step(input, ctx) {
  switch (input.op) {
    case 'init': return init(input, ctx);
    case 'set': return set(input, ctx);
    case 'get': return { output: view(ctx.state) };
    case 'resume': return resume(input, ctx);
  }
  throw new Error(`statuses: unknown op ${input.op}`);
}

export function onEvent(event, ctx) {
  // Results of orders.setStatus carry no decision of their own: a status is what we asked for, and the platform
  // retries it with the same key. Nothing to do.
  return { output: view(ctx.state) };
}

function view(state) {
  if (!state) return { applied: false, order: null, fulfilments: {}, busy: false };
  return { applied: false, order: state.order, fulfilments: { ...state.fulfilments }, busy: false };
}

function init(input, ctx) {
  // The order is recorded by orders.create (intake): order pending, each fulfilment pending or unavailable (§2).
  // Only record it here; no effect (R7.2).
  const fulfilments = {};
  for (const f of input.fulfilments) fulfilments[f.fulfilmentId] = f.location === null ? 'unavailable' : 'pending';
  const state = { order: 'pending', fulfilments };
  return { output: { ...view(state), applied: true }, state };
}

function set(input, ctx) {
  const state = ctx.state;
  if (!state) return { output: view(null) };                       // before init: refused (R4.1)
  const orderId = input.orderId;
  const target = input.fulfilmentId === null ? null : input.fulfilmentId;
  const current = target === null ? state.order : state.fulfilments[target];
  if (current === undefined) return { output: view(state) };        // unknown fulfilment: nothing
  const next = target === null ? ORDER_NEXT : FULFILMENT_NEXT;
  const emit = [];
  let at = current;
  if (input.afterStatus && input.afterStatus !== at && (next[at] ?? []).includes(input.afterStatus)) {
    emit.push(input.afterStatus);
    at = input.afterStatus;
  }
  if (at !== input.status && (next[at] ?? []).includes(input.status)) emit.push(input.status);
  else if (emit.length === 0) return { output: view(state) };        // a repeat, a backward move or a skip: nothing
  const effects = [];
  let prev = null;
  for (const status of emit) {
    const key = target === null ? `order.${status}` : `f.${target}.${status}`;
    const e = { key, system: 'orders', op: 'setStatus', args: { orderId, fulfilmentId: target, status } };
    if (prev) e.after = prev;
    effects.push(e);
    prev = key;
  }
  const newState = { order: state.order, fulfilments: { ...state.fulfilments } };
  if (target === null) newState.order = emit.at(-1);
  else newState.fulfilments[target] = emit.at(-1);
  return { output: { ...view(newState), applied: true }, state: newState, effects };
}

function resume(input, ctx) {
  // §3.5: a migrated order: take its statuses from the records as they stand.
  const r = input.records ?? {};
  const fulfilments = {};
  for (const f of r.fulfilments ?? []) fulfilments[f.fulfilmentId] = f.status;
  const state = { order: r.order ?? 'pending', fulfilments };
  return { output: { ...view(state), applied: false }, state };
}
