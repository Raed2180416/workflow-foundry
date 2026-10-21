// Module fulfilment, key: the fulfilment id. One saga per fulfilment (§4.4). Owns R4.2, R4.3, R4.4, R5.1, R5.2,
// S2, S14, §1 Profile and §3.3 (carrier messages). Its compensation lives here because ctx.status takes only this
// instance's local keys and results come back only to the instance that emitted (COMPOSE.md Names).
// Effects: inventory.reserve (batch key 'reserve-<n>', item keys 'item.<sku>'), billing.charge 'charge',
// carrier.create 'ship', carrier.cancel 'unship', billing.refund 'refund', inventory.release 'release.<sku>'.
// Statuses via ctx.call('statuses', orderId, ...), notices via ctx.call('notices', orderId, ...).
// Always return `output`.

export function step(input, ctx) {
  switch (input.op) {
    case 'start': return start(input, ctx);
    case 'advance': return advance(input, ctx);
    case 'carrier': return carrier(input, ctx);
    case 'stop': return stop(input, ctx);
    case 'get': return get(input, ctx);
    case 'resume': return resume(input, ctx);
  }
  throw new Error(`fulfilment: unknown op ${input.op}`);
}

export function onEvent(event, ctx) {
  // Record outcomes only: never emit a forward step here (that is advance's job, S10).
  // - Reserve result: per-item outcomes; failed retryable items are resubmitted by advance with their original
  //   item keys (R4.2); a permanent item error fails the fulfilment (R5.2).
  // - 402 card-declined, or any permanent error (retryable: false) other than a 400: fail (R5.2): compensate (R5.1),
  //   set 'failed', send 'fulfilment-failed' about the fulfilment id, within 120 min of the failed attempt. Never
  //   retry it. end 'failed', endedAt.
  // - 400 (invalid-args, field-renamed): not a failure; advance re-emits corrected args (api/<system>.schema.json),
  //   same key, inside the step's window (R4.2).
  // - A forward step that commits after stop or after failure: compensate it at once (R6.2: 60 min; S14: 120 min).
  // - Results of the undo effects: record them; an undo is never emitted twice (R5.1).
  throw new Error('fulfilment.onEvent: not implemented');
}

function start(input, ctx) {
  // Keep orderId, customerId, currency, edition, readyAt and the fulfilment in state. No effect. State 'reserving'.
  throw new Error('fulfilment.start: not implemented');
}

function advance(input, ctx) {
  // Called by the parent once per tick, at the end, and never after a counted cancel. Emit at most the next step,
  // each only after the previous one committed (R4.2):
  // 1. reserve all items at the location within 120 min of readyAt; after a partial batch, only the failed items
  //    (original item keys, a new batch key);
  // 2. charge amountMinor with customerId and currency within 120 min of the last reservation's commit;
  // 3. carrier.create with the location and ref (the fulfilment id) within 120 min of the charge's commit.
  // Nothing once ended, failed or stopped.
  throw new Error('fulfilment.advance: not implemented');
}

function carrier(input, ctx) {
  // Translate message.code with rulebook/<edition>/carrier-codes.json; unlisted codes mean 'info' (§3.3).
  // Record { meaning, reportedAt } in reports (deduplicated). Then, unless the shipment was cancelled or the
  // fulfilment is completed or failed (§3.3: changes nothing):
  // collected -> 'dispatched'; delivered -> 'dispatched' if never set, then 'completed' (afterStatus
  // 'dispatched'), end 'completed'; inTransit, info -> nothing; collectionFailed -> fail (R5.2). Within 120 min of
  // the message (R4.4); a repeated or late message never moves a status back (R7.2, enforced by statuses).
  throw new Error('fulfilment.carrier: not implemented');
}

function stop(input, ctx) {
  // Called by cancellation for a counted cancel (R6.2). From now on emit no forward step. Compensate (R5.1):
  // in reverse order, cancel the shipment (if booked and not reported collectionFailed), refund the full
  // amountMinor (if the charge committed), release each reserved item (if its reservation committed). A step
  // counts as committed if its result was ok, or if ctx.status(system, key) says 'committed' (S2); 'pending'
  // means in flight: compensate it when it commits. The cancelled status is set by cancellation. end 'stopped'.
  throw new Error('fulfilment.stop: not implemented');
}

function get(input, ctx) {
  // Return the current output (state, end, reports, busy); no change.
  throw new Error('fulfilment.get: not implemented');
}

function resume(input, ctx) {
  // §3.5: committed steps from the migrated records (reservations, charges, shipments) and the carrier messages
  // already received, which go into reports.
  throw new Error('fulfilment.resume: not implemented');
}
