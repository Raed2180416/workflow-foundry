// Module order-progress, key: the order id. Owns R4.1, R4.5.
// No effects of its own: statuses through ctx.call('statuses', orderId, ...). Always return `output`.

export function step(input, ctx) {
  switch (input.op) {
    case 'ready': return ready(input, ctx);
    case 'ended': return ended(input, ctx);
    case 'stop': return stop(input, ctx);
    case 'resume': return resume(input, ctx);
  }
  throw new Error(`order-progress: unknown op ${input.op}`);
}

function ready(input, ctx) {
  // Once: set the order 'processing' and every available fulfilment 'processing', within 60 min of input.at,
  // the ready time (R4.1). The parent calls this only after the order is recorded (R4.1). State 'processing'.
  throw new Error('order-progress.ready: not implemented');
}

function ended(input, ctx) {
  // A fulfilment ended at input.at. When every fulfilment of the order (statuses get) is completed, failed or
  // cancelled: set the order 'completed' if one completed, else 'failed' if one failed, else 'cancelled',
  // within 120 min of that event (R4.5). State 'ended', outcome, at.
  throw new Error('order-progress.ended: not implemented');
}

function stop(input, ctx) {
  // Called by cancellation after a counted cancel: the order ends by R6.2, never by R4.5. State 'stopped'.
  throw new Error('order-progress.stop: not implemented');
}

function resume(input, ctx) {
  // §3.5: a migrated processing order.
  throw new Error('order-progress.resume: not implemented');
}
