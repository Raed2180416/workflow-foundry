// Module intake, key: the order id. Owns R1.1, R1.2, R1.3, R1.4 and §3.1 (placedAt, duplicates).
// Effects: inventory.allocate, orders.create. Local keys: 'allocate', 'create' (stable, §1 Keys).
// Always return `output` (schema in composition.json) from step and onEvent.

export function step(input, ctx) {
  switch (input.op) {
    case 'placed': return placed(input, ctx);
    case 'resume': return resume(input, ctx);
  }
  throw new Error(`intake: unknown op ${input.op}`);
}

export function onEvent(event, ctx) {
  // effect.result for 'allocate': choose the edition in force at placedAt (R1.3), compute every fulfilment's
  //   amountMinor and totalMinor (R1.2), emit orders.create with the fields of R1.1 (key 'create').
  // effect.result for 'create': ok -> status 'recorded'. A 400 (invalid-args, field-renamed): correct the args
  //   from api/orders.schema.json and re-emit with the same key (R4.2 400 paragraph).
  throw new Error('intake.onEvent: not implemented');
}

function placed(input, ctx) {
  // Already in state, or a record for this orderId in orders.orders (compare ids through order-id): a duplicate,
  // no effect (R1.4), output duplicate: true. Otherwise emit inventory.allocate { orderId } (key 'allocate'),
  // within 60 min of placedAt (R1.1). placedAt is the event's time (§3.1).
  throw new Error('intake.placed: not implemented');
}

function resume(input, ctx) {
  // §3.5: an order record in input.records -> status 'recorded' with its plan; edition by R1.3 from placedAt.
  throw new Error('intake.resume: not implemented');
}
