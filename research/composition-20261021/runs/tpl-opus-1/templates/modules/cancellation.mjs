// Module cancellation, key: the order id. Owns R6.1, R6.2, R6.3, R6.4, S4, S6, S7 and the S7 sentence of §3.3.
// No effects of its own: it calls statuses, notices, fulfilment (stop, get), fraud (stop), order-progress (stop).
// Always return `output`.

export function step(input, ctx) {
  switch (input.op) {
    case 'customer-cancel': return customerCancel(input, ctx);
    case 'cancel-order': return cancelOrder(input, ctx);
  }
  throw new Error(`cancellation: unknown op ${input.op}`);
}

function customerCancel(input, ctx) {
  // A customer cancel at input.at, by input.phase:
  // - 'not-cleared': counts (R6.4): fraud stop, then cancelOrder with reason 'customer'. verdict 'counts'.
  // - 'processing': gather reports of every fulfilment (statuses get, fulfilment get). The cancel does not count if
  //   one report means collected, inTransit or delivered and its reportedAt <= at (S7; reports delivered earlier in
  //   this instant count, S4; one collection ends the right for the whole order, S6). Not counted: send
  //   'cancel-refused' (occurrence = eventId), nothing else (R6.3); verdict 'refused'. Counted (R6.2):
  //   order-progress stop; for every fulfilment not completed, failed or cancelled: fulfilment stop { at } and set
  //   it 'cancelled'; set the order 'cancelled'; send 'order-cancelled'; all within 60 min. verdict 'counts'.
  // - 'ended': changes nothing (R6.3, S15); verdict 'nothing'.
  throw new Error('cancellation.customerCancel: not implemented');
}

function cancelOrder(input, ctx) {
  // R6.1, once per order: set every fulfilment not completed, failed or cancelled to 'cancelled', set the order
  // 'cancelled', send 'order-cancelled', inside the window of the rule that asked (R2.1, R2.2, R3.2, R6.4).
  // Keep input.reason in state; SPEC-E names no arg for it (notify text is free, §4.8). verdict 'done'.
  throw new Error('cancellation.cancelOrder: not implemented');
}
