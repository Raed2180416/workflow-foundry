// Module cancellation, key: the order id. Owns R6.1 (cancel an order before any step committed), R6.2 (a customer
// cancel during processing: stop, compensate, cancel), R6.3 (a refused cancel: cancel-refused; an ended order changes
// nothing), R6.4 (a cancel before clearing counts), S4 and S7 (which carrier reports prove collection before the cancel),
// S6 (one collection ends the right to cancel the whole order). Calls fraud, order-progress, fulfilment, statuses and
// notices. Always returns `output`.

const COLLECTED = ['collected', 'inTransit', 'delivered'];
const DONE = ['completed', 'failed', 'cancelled'];

export function step(input, ctx) {
  switch (input.op) {
    case 'customer-cancel': return customerCancel(input, ctx);
    case 'cancel-order': return { output: { verdict: cancelOrder(input.at, input.reason, ctx) } };
  }
  throw new Error(`cancellation: unknown op ${input.op}`);
}

function customerCancel(input, ctx) {
  if (input.phase === 'ended') return { output: { verdict: 'nothing' } };        // R6.3, S15
  if (input.phase === 'not-cleared') {                                           // R6.4: counts
    ctx.call('fraud', ctx.key, { op: 'stop' });
    cancelOrder(input.at, 'customer', ctx);
    return { output: { verdict: 'counts' } };
  }
  // processing (R6.2, R6.3): judge on the reports that reached us before this cancel (S4, S7).
  const fs = ctx.call('statuses', ctx.key, { op: 'get' }).fulfilments;
  const cancelAt = Date.parse(input.at);
  let collected = false;
  for (const f of fs) {
    if (f.status === 'unavailable' || f.status === 'cancelled') continue;
    const r = ctx.call('fulfilment', f.fulfilmentId, { op: 'get' });
    for (const rep of r.reports ?? []) {
      if (COLLECTED.includes(rep.meaning) && Date.parse(rep.reportedAt) <= cancelAt) collected = true;
    }
  }
  if (collected) {
    ctx.call('notices', ctx.key, { op: 'send', template: 'cancel-refused', about: ctx.key, occurrence: input.eventId });
    return { output: { verdict: 'refused' } };
  }
  // Counted: stop the order, stop every open fulfilment (compensation runs there), cancel what is left.
  ctx.call('order-progress', ctx.key, { op: 'stop' });
  for (const f of fs) {
    if (DONE.includes(f.status) || f.status === 'unavailable') continue;
    ctx.call('fulfilment', f.fulfilmentId, { op: 'stop', at: input.at });
    ctx.call('statuses', ctx.key, { op: 'set', fulfilmentId: f.fulfilmentId, status: 'cancelled' });
  }
  ctx.call('statuses', ctx.key, { op: 'set', fulfilmentId: null, status: 'cancelled' });
  ctx.call('notices', ctx.key, { op: 'send', template: 'order-cancelled', about: ctx.key });
  return { output: { verdict: 'counts' } };
}

// R6.1: every fulfilment not completed, failed or cancelled becomes cancelled, then the order, then the notice.
// Used before any step committed (R2.1, R2.2, R3.2, R6.4). Returns 'done'.
function cancelOrder(at, reason, ctx) {
  const fs = ctx.call('statuses', ctx.key, { op: 'get' }).fulfilments;
  for (const f of fs) {
    if (DONE.includes(f.status)) continue;
    ctx.call('statuses', ctx.key, { op: 'set', fulfilmentId: f.fulfilmentId, status: 'cancelled' });
  }
  ctx.call('statuses', ctx.key, { op: 'set', fulfilmentId: null, status: 'cancelled' });
  ctx.call('notices', ctx.key, { op: 'send', template: 'order-cancelled', about: ctx.key });
  return 'done';
}
