// Module customer-action, key: the order id. Owns R3.1, R3.2, S1.
// No effects of its own: statuses through ctx.call('statuses', orderId, ...), notices through
// ctx.call('notices', orderId, ...). Wake-up: 'deadline'. Always return `output`.

export function step(input, ctx) {
  switch (input.op) {
    case 'start': return start(input, ctx);
    case 'advance': return advance(input, ctx);
    case 'action': return action(input, ctx);
    case 'resume': return resume(input, ctx);
  }
  throw new Error(`customer-action: unknown op ${input.op}`);
}

export function onEvent(event, ctx) {
  // Wake-up 'deadline' (inside (D, D + 60 min], never at D, R3.2) and no action counted: set every fulfilment
  // 'cancelled', the order 'timedOut', send 'order-timed-out' about the order; state 'timedOut' (R3.2).
  throw new Error('customer-action.onEvent: not implemented');
}

function start(input, ctx) {
  // D = placedAt + customerActionHours of the order's edition (R3.2; anchored at p, S1). Keep D, clearedAt and
  // the fulfilments in state; set wake-up 'deadline' after D, at most D + 60 min. State 'waiting'.
  throw new Error('customer-action.start: not implemented');
}

function advance(input, ctx) {
  // Once, while waiting: order 'customerActionRequired' and send 'action-required' about the order, within
  // 120 min of clearedAt (R3.1). The parent stops calling this once the customer has acted (S9).
  throw new Error('customer-action.advance: not implemented');
}

function action(input, ctx) {
  // The first amend or cancel with at <= D counts (D itself counts, S1, R3.2); later ones and repeats change nothing.
  // amend: set every unavailable fulfilment 'cancelled' (within 60 min of at); some available -> state 'ready',
  //   at; none -> state 'cancel', reason 'nothing-available'.
  // cancel: state 'cancel', reason 'customer', at.
  // A counted action cancels the wake-up.
  throw new Error('customer-action.action: not implemented');
}

function resume(input, ctx) {
  // §3.5: continue a migrated order waiting for its customer.
  throw new Error('customer-action.resume: not implemented');
}
