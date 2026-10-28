// Module cancellation, key: the order id. Owns R6.1-R6.4, S4, S6, S7 (DECOMPOSITION 4.7). Stateless.
// The parent says which phase the order is in; this module judges the cancel and executes it.

const TERMINAL = ['completed', 'failed', 'cancelled'];
const COLLECTED = ['collected', 'inTransit', 'delivered'];

export function step(input, ctx) {
  if (input.op === 'cancel-order') {
    cancelOrder(ctx, input.customerId);
    return { output: { verdict: 'done', busy: false } };
  }
  return { output: customerCancel(input, ctx) };
}

// R6.1: every fulfilment not completed, failed or cancelled is cancelled, then the order, then the notice.
function cancelOrder(ctx, customerId) {
  const g = ctx.call('statuses', ctx.key, { op: 'get' });
  for (const f of g.fulfilments) {
    if (!TERMINAL.includes(f.status)) ctx.call('statuses', ctx.key, { op: 'set', fulfilmentId: f.fulfilmentId, status: 'cancelled' });
  }
  ctx.call('statuses', ctx.key, { op: 'set', fulfilmentId: null, status: 'cancelled' });
  ctx.call('notices', ctx.key, { op: 'send', template: 'order-cancelled', about: ctx.key, customerId });
}

function customerCancel(input, ctx) {
  if (input.phase === 'ended') return { verdict: 'nothing', busy: false };
  if (input.phase === 'not-cleared') {
    // R6.4: a cancel before clearing counts; the fraud review is stopped so a later answer changes nothing.
    ctx.call('fraud', ctx.key, { op: 'stop' });
    cancelOrder(ctx, input.customerId);
    return { verdict: 'counts', busy: false };
  }
  // processing (R6.2, R6.3, S4, S6, S7): the cancel does not count if a collection was reported at or before its time.
  const g = ctx.call('statuses', ctx.key, { op: 'get' });
  let collected = false;
  const failing = {};
  for (const f of g.fulfilments) {
    const r = ctx.call('fulfilment', f.fulfilmentId, { op: 'get' });
    failing[f.fulfilmentId] = !!r.failing;
    for (const x of r.reports) {
      if (COLLECTED.includes(x.meaning) && Date.parse(x.reportedAt) <= Date.parse(input.at)) collected = true;
    }
  }
  if (collected) {
    ctx.call('notices', ctx.key, { op: 'send', template: 'cancel-refused', about: ctx.key, occurrence: input.eventId, customerId: input.customerId });
    return { verdict: 'refused', busy: false };
  }
  // S13: a fulfilment that failed before the cancel is no longer open; when none is left the order has already ended.
  if (!g.fulfilments.some(f => !TERMINAL.includes(f.status) && !failing[f.fulfilmentId])) {
    return { verdict: 'nothing', busy: false };
  }
  ctx.call('order-progress', ctx.key, { op: 'stop' });
  for (const f of g.fulfilments) {
    if (TERMINAL.includes(f.status)) continue;
    const r = ctx.call('fulfilment', f.fulfilmentId, { op: 'stop', at: input.at });
    if (!r.failing && r.end !== 'completed' && r.end !== 'failed') {
      ctx.call('statuses', ctx.key, { op: 'set', fulfilmentId: f.fulfilmentId, status: 'cancelled' });
    }
  }
  ctx.call('statuses', ctx.key, { op: 'set', fulfilmentId: null, status: 'cancelled' });
  ctx.call('notices', ctx.key, { op: 'send', template: 'order-cancelled', about: ctx.key, customerId: input.customerId });
  return { verdict: 'counts', busy: false };
}
