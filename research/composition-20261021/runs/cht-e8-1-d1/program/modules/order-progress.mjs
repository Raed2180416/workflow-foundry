// Module order-progress, key: the order id. Owns R4.1 (ready -> processing statuses) and R4.5 (the order outcome
// once every fulfilment has ended). It emits no effects itself: statuses are set through the statuses module.
// Always return `output`.
//
// state: { state: 'processing'|'ended'|'stopped', outcome: null|'completed'|'failed'|'cancelled', at }

const ENDED = ['completed', 'failed', 'cancelled'];

export function step(input, ctx) {
  switch (input.op) {
    case 'ready': return ready(input, ctx);
    case 'ended': return ended(input, ctx);
    case 'stop': return stop(input, ctx);
    case 'resume': return resume(input, ctx);
  }
  throw new Error(`order-progress: unknown op ${input.op}`);
}

export function onEvent(event, ctx) {
  // This module causes no effects of its own that report back; the statuses module handles its results.
  return { output: view(ctx.state) };
}

function view(state) {
  if (!state) return { state: 'idle', outcome: null, at: null };
  return { state: state.state, outcome: state.outcome, at: state.at };
}

function ready(input, ctx) {
  // R4.1: once, at the ready instant t: the order and every available fulfilment to processing.
  if (ctx.state) return { output: view(ctx.state) };
  ctx.call('statuses', input.orderId, { op: 'set', orderId: input.orderId, fulfilmentId: null, status: 'processing' });
  for (const f of input.fulfilments) {
    if (!f.available) continue;
    ctx.call('statuses', input.orderId, { op: 'set', orderId: input.orderId, fulfilmentId: f.fulfilmentId, status: 'processing' });
  }
  const state = { state: 'processing', outcome: null, at: input.at };
  return { output: view(state), state };
}

function ended(input, ctx) {
  // R4.5: when every fulfilment is completed, failed or cancelled, the order is completed if one completed, else
  // failed if one failed, else cancelled. Done once, at the event that ended the last fulfilment.
  if (!ctx.state || ctx.state.state !== 'processing') return { output: view(ctx.state) };
  const view_ = ctx.call('statuses', input.orderId, { op: 'get', orderId: input.orderId });
  const statuses = Object.values(view_.fulfilments);
  if (statuses.length === 0 || !statuses.every(s => ENDED.includes(s))) return { output: view(ctx.state) };
  const outcome = statuses.includes('completed') ? 'completed' : statuses.includes('failed') ? 'failed' : 'cancelled';
  ctx.call('statuses', input.orderId, { op: 'set', orderId: input.orderId, fulfilmentId: null, status: outcome });
  const state = { state: 'ended', outcome, at: input.at };
  return { output: view(state), state };
}

function stop(input, ctx) {
  // R6.2: a counted customer cancel stops the order; the order then ends cancelled by R6.2, not by R4.5 (pitfall 5).
  if (!ctx.state) return { output: view({ state: 'stopped', outcome: null, at: input.at }), state: { state: 'stopped', outcome: null, at: input.at } };
  if (ctx.state.state === 'processing') {
    const state = { state: 'stopped', outcome: null, at: input.at };
    return { output: view(state), state };
  }
  return { output: view(ctx.state) };
}

function resume(input, ctx) {
  // §3.5: continue from the records: an order already processing or already ended stays so.
  const s = input.records ?? {};
  if (!s.state) return { output: view(ctx.state) };
  const state = { state: s.state, outcome: s.outcome ?? null, at: s.at ?? null };
  return { output: view(state), state };
}
