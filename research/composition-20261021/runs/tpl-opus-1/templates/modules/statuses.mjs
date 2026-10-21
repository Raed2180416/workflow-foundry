// Module statuses, key: the order id. The only writer of orders.setStatus. Owns R7.2 and the §2 setStatus row
// ("it does not check transitions"). Local keys: 'order.<status>', 'f.<fulfilmentId>.<status>' (one key per status
// change, §1 Keys; full name within 200 characters, COMPOSE.md). Always return `output`.

export function step(input, ctx) {
  switch (input.op) {
    case 'init': return init(input, ctx);
    case 'set': return set(input, ctx);
    case 'get': return get(input, ctx);
    case 'resume': return resume(input, ctx);
  }
  throw new Error(`statuses: unknown op ${input.op}`);
}

export function onEvent(event, ctx) {
  // setStatus results: record them; busy while any is pending. A 400: correct the args from
  // api/orders.schema.json and re-emit with the same key.
  throw new Error('statuses.onEvent: not implemented');
}

function init(input, ctx) {
  // After orders.create committed: order 'pending'; each fulfilment 'pending', or 'unavailable' when its location
  // is null (§2 orders.create). No effect. 'set' before 'init' is refused (R4.1: nothing before the record).
  throw new Error('statuses.init: not implemented');
}

function set(input, ctx) {
  // Emit orders.setStatus { orderId, fulfilmentId, status } only if the move is forward (R7.2):
  //   fulfilment pending -> processing -> dispatched -> completed; cancelled, failed as other ends;
  //   'unavailable' -> 'cancelled' as R3.2 and R6.1 ask;
  //   order pending -> (customerActionRequired) -> processing -> completed | failed | cancelled; timedOut and
  //   cancelled as other ends.
  // Each status of a target at most once; a target in an end status never moves (R7.2). Otherwise no effect,
  // applied false. afterStatus: put `after` on that change's key if it was emitted in this same tick (R4.4).
  throw new Error('statuses.set: not implemented');
}

function get(input, ctx) {
  // Return the statuses as requested so far (the decided ones, not only the committed ones).
  throw new Error('statuses.get: not implemented');
}

function resume(input, ctx) {
  // §3.5: the statuses in the migrated order and fulfilment records.
  throw new Error('statuses.resume: not implemented');
}
