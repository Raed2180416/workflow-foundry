// Module order-progress, key: the order id. Owns R4.1 (processing once the order is ready) and R4.5 (the order
// outcome once every fulfilment has ended). Calls statuses only. Always returns `output`.

export function step(input, ctx) {
  switch (input.op) {
    case 'ready': return ready(input, ctx);
    case 'ended': return ended(input, ctx);
    case 'stop': return stop(input, ctx);
    case 'resume': return resume(input, ctx);
  }
  throw new Error(`order-progress: unknown op ${input.op}`);
}

function out(st) {
  return { output: { state: st.status, outcome: st.outcome ?? null, at: st.at ?? null } };
}

function ready(input, ctx) {
  // Once (R4.1): the order and every available fulfilment become processing, within 60 min of the ready time.
  if (ctx.state && ctx.state.status !== 'idle') return out(ctx.state);
  for (const f of input.fulfilments) {
    if (f.available) ctx.call('statuses', ctx.key, { op: 'set', fulfilmentId: f.fulfilmentId, status: 'processing' });
  }
  ctx.call('statuses', ctx.key, { op: 'set', fulfilmentId: null, status: 'processing' });
  const st = { status: 'processing', outcome: null, at: input.at };
  return { ...out(st), state: st };
}

function ended(input, ctx) {
  const cur = ctx.state;
  if (!cur || cur.status !== 'processing') return out(cur ?? { status: 'idle' });
  const fs = ctx.call('statuses', ctx.key, { op: 'get' }).fulfilments;
  const open = fs.some(f => !['completed', 'failed', 'cancelled'].includes(f.status) && f.status !== 'unavailable');
  if (open) return out(cur);
  const has = s => fs.some(f => f.status === s);
  const outcome = has('completed') ? 'completed' : has('failed') ? 'failed' : 'cancelled';
  ctx.call('statuses', ctx.key, { op: 'set', fulfilmentId: null, status: outcome });
  const st = { status: 'ended', outcome, at: input.at };
  return { ...out(st), state: st };
}

function stop(input, ctx) {
  // Stopped by a counted customer cancel (R6.2): the order ends by R6.2, never by R4.5.
  const st = { status: 'stopped', outcome: null, at: null };
  return { ...out(st), state: st };
}

function resume(input, ctx) {
  // §3.5: a migrated order that is already processing (or ended).
  const r = input.records?.progress ?? {};
  const st = { status: r.status ?? 'processing', outcome: r.outcome ?? null, at: r.at ?? null };
  return { ...out(st), state: st };
}
