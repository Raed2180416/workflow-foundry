// Module cancellation, key: the order id. Owns R6.1 (cancel an order before any step committed), R6.2 (a customer
// cancel during processing: judged by the collection reports, S4, S6, S7, then stop and compensate), R6.3 (a refused
// cancel: cancel-refused; a cancel for an ended order changes nothing), R6.4 (a cancel before clearing counts) and the
// S7 rule for reports. Calls fraud, order-progress, fulfilment, statuses, notices. No effects of its own.
// Always return `output`.
//
// Ops: customer-cancel { orderId, at, eventId, phase: 'not-cleared'|'processing'|'ended', fulfilmentIds: [fid] }
//      cancel-order    { orderId, at, reason }

const COLLECTED_MEANINGS = ['collected', 'inTransit', 'delivered'];
const ENDED = ['completed', 'failed', 'cancelled'];

export function step(input, ctx) {
  switch (input.op) {
    case 'customer-cancel': return customerCancel(input, ctx);
    case 'cancel-order': return cancelOrder(input, ctx);
  }
  throw new Error(`cancellation: unknown op ${input.op}`);
}

export function onEvent(event, ctx) {
  // Nothing of its own comes back: its calls are judged in the same tick.
  return { output: { verdict: 'nothing', reason: null, busy: false } };
}

function customerCancel(input, ctx) {
  const orderId = input.orderId;
  if (input.phase === 'ended') return { output: { verdict: 'nothing', reason: null, busy: false } };   // R6.3, S15

  if (input.phase === 'not-cleared') {
    // R6.4: a cancel for a recorded order that is not yet cleared counts; a later review answer changes nothing.
    ctx.call('fraud', orderId, { op: 'stop' });
    return cancelOrder({ orderId, at: input.at, reason: 'customer' }, ctx, 'counts');
  }

  // processing: judge on the reports that reached us before this cancel (S4, S7). A collection (or a later
  // carrier state that implies it) with reportedAt at or before the cancel's time refuses it (S6: one collection
  // ends the right for the whole order).
  const collected = input.fulfilmentIds.some(fid => {
    const f = ctx.call('fulfilment', fid, { op: 'get' });
    return (f.reports ?? []).some(x => COLLECTED_MEANINGS.includes(x.meaning) && Date.parse(x.reportedAt) <= Date.parse(input.at));
  });
  if (collected) {
    ctx.call('notices', orderId, { op: 'send', template: 'cancel-refused', about: orderId, occurrence: input.eventId });   // R6.3
    return { output: { verdict: 'refused', reason: null, busy: false } };
  }
  // R6.2: counts. Stop the order (so R4.5 does not decide its outcome), stop every open fulfilment, then cancel.
  ctx.call('order-progress', orderId, { op: 'stop', orderId, at: input.at });
  const st = ctx.call('statuses', orderId, { op: 'get', orderId });
  for (const [fid, status] of Object.entries(st.fulfilments)) {
    if (ENDED.includes(status)) continue;
    if (status === 'processing' || status === 'dispatched' || status === 'pending') {
      ctx.call('fulfilment', fid, { op: 'stop', at: input.at });
    }
    ctx.call('statuses', orderId, { op: 'set', orderId, fulfilmentId: fid, status: 'cancelled' });
  }
  ctx.call('statuses', orderId, { op: 'set', orderId, fulfilmentId: null, status: 'cancelled' });
  ctx.call('notices', orderId, { op: 'send', template: 'order-cancelled', about: orderId });
  return { output: { verdict: 'counts', reason: 'customer', busy: false } };
}

function cancelOrder(input, ctx, verdict = 'done') {
  // R6.1, once: every fulfilment not completed, failed or cancelled is cancelled; the order is cancelled; the notice.
  const orderId = input.orderId;
  ctx.call('fraud', orderId, { op: 'stop' });
  const st = ctx.call('statuses', orderId, { op: 'get', orderId });
  for (const [fid, status] of Object.entries(st.fulfilments)) {
    if (ENDED.includes(status)) continue;
    if (status === 'processing') ctx.call('fulfilment', fid, { op: 'stop', at: input.at });
    ctx.call('statuses', orderId, { op: 'set', orderId, fulfilmentId: fid, status: 'cancelled' });
  }
  ctx.call('statuses', orderId, { op: 'set', orderId, fulfilmentId: null, status: 'cancelled' });
  ctx.call('notices', orderId, { op: 'send', template: 'order-cancelled', about: orderId });
  return { output: { verdict, reason: input.reason, busy: false } };
}
