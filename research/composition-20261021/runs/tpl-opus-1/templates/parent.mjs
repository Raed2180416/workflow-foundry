// Parent orchestrator: routing and the order of the phases (DECOMPOSITION.md §3).
// Owns SPEC-E §1 (keys, results, routing, subject, time, delivery order), §3.2, §3.5, §4 preamble, R7.1,
// S5, S8, S9, S10, S11, S12, S13, S15. It emits no effects itself: every system is reached through a module.
//
// Parent state (JSON, survives between ticks; the whole carry stays under 64 KB, COMPOSE.md):
//   { orderId, phase: 'new'|'intake'|'fraud'|'waiting'|'processing'|'ended', placedAt, customerId, currency,
//     edition, fulfilments: [{ fulfilmentId, location, available, items, amountMinor }], hasUnavailable,
//     clearedAt, readyAt, progressStarted, sagas: { [fulfilmentId]: { started, end, busy } },
//     busy: { [module]: boolean }, held: [ customer actions held for an open point, DECOMPOSITION.md §8 ] }

export function tick(input, ctx) {
  // input: { kind, item, world, instance, now, events, state } (CONTRACT.md case-tick; `state` is the
  // parent state from the last tick of this instance, or null).
  // 1. state = input.state ?? a new state with phase 'new'.
  // 2. If phase is 'new' and the first event is an inbound message: routeFirstTick. It may answer with
  //    { decisions: { subject }, merge: { into } } (only allowed on this first tick, §1 Routing) or with close.
  // 3. For every event, in the order given (§1 Delivery order; never re-sort): handleEvent.
  // 4. endOfTick: the only place where forward steps are emitted (S10, S9).
  // 5. Return { decisions: { subject: state.orderId ?? null }, state, close: true when shouldClose }.
  throw new Error('parent.tick: not implemented');
}

function routeFirstTick(event, state, ctx) {
  // Every inbound message that is not a ref-quoting carrier message starts a new instance (§1 Routing).
  // Normalise every order id with ctx.call('order-id', 'n', { raw }) (§3.1).
  // - order.placed: open instance for that subject (ctx.instances) -> merge into it. Otherwise this instance
  //   runs the order: phase 'intake' (intake decides R1.4 from the records).
  // - customer.action: open instance for the orderRef -> merge. Otherwise: an order already ended and closed
  //   changes nothing (R6.3, S15); a reference naming no order is answered with nothing: no effect, task or
  //   wake-up, close (§3.2, S11). The template sends no `unknown-order` (optional, §3.2; forbidden in the S11 case,
  //   which this tick cannot tell apart).
  // - carrier.status: find the order of payload.fulfilmentRef (query orders.fulfilments, §3.5). Open instance
  //   -> merge. Otherwise it changes nothing (§3.3): close with subject = that order id, or null.
  // - migration: resumeMigration.
  throw new Error('routeFirstTick: not implemented');
}

function handleEvent(event, state, ctx) {
  // const owner = ctx.ownerOf(event)
  // - owner (effect.result, wake-up, humanTask.*): const out = ctx.deliver(event); onModuleOutput(owner.module,
  //   owner.key, out, state, ctx). Deliver whatever the phase: late results still need compensation (R6.2, S14).
  // - order.placed (a merged duplicate): ctx.call('intake', orderId, { op: 'placed', order }) -> duplicate,
  //   nothing else (R1.4).
  // - customer.action: routeCustomerAction.
  // - carrier.status: the fulfilment of this order named by fulfilmentRef -> ctx.call('fulfilment', fid,
  //   { op: 'carrier', message, at: event time }) and onModuleOutput. Unknown fulfilment: nothing (§3.3).
  throw new Error('handleEvent: not implemented');
}

function routeCustomerAction(event, state, ctx) {
  // at = the event's time (§3.2). orderRef normalised by order-id (§3.2, §3.1). By phase:
  // - 'intake' (placed, not yet recorded): open point (DECOMPOSITION.md §8). Template default: hold it in
  //   state.held and route it, in order, when the phase changes.
  // - 'fraud' (recorded, not cleared): cancel -> cancellation customer-cancel, phase 'not-cleared' (R6.4);
  //   amend -> open point (§8), hold as above.
  // - 'waiting': amend or cancel -> customer-action { op: 'action', action, at } (R3.2).
  // - 'processing': cancel -> cancellation customer-cancel, phase 'processing' (R6.2, R6.3, S8, S11, S12);
  //   amend -> nothing (S5).
  // - 'ended' (ended or cancellation decided, S15): cancel -> cancellation customer-cancel, phase 'ended'
  //   (R6.3: changes nothing); amend -> nothing (S5).
  // Verdict 'counts' -> phase 'ended'.
  throw new Error('routeCustomerAction: not implemented');
}

function onModuleOutput(module, key, out, state, ctx) {
  // Act only on transitions not acted on before (outputs repeat the module's current state).
  // - intake recorded: statuses init { fulfilments: [{ fulfilmentId, location }] }, notices init { customerId },
  //   fraud start { orderId, placedAt, edition }; store the plan and edition (R1.3); phase 'fraud'.
  //   Nothing about the order is done before this (R4.1). Then route any held actions.
  // - fraud cleared at c: hasUnavailable -> customer-action start { clearedAt: c, ... }, phase 'waiting' (R3.1);
  //   otherwise readyAt = c, phase 'processing' (R4.1; processing from that instant, inclusive, S11, S12).
  // - fraud cancel (reason, at) -> cancellation cancel-order { reason, at }; phase 'ended' from now (S15).
  // - customer-action ready at a -> readyAt = a, phase 'processing' (R3.2).
  // - customer-action cancel (reason, at) -> cancellation cancel-order; phase 'ended' (S15).
  // - customer-action timedOut -> phase 'ended' (R3.2: the end of the order).
  // - fulfilment end 'completed' | 'failed' (new) -> order-progress { op: 'ended', fulfilmentId, end, at: endedAt };
  //   its state 'ended' -> phase 'ended'. Do not call order-progress after a counted cancel (R6.2).
  //   A fulfilment that ended before the cancel in the same tick has ended before it (S13).
  // - every output: record out.busy for shouldClose.
  throw new Error('onModuleOutput: not implemented');
}

function endOfTick(state, ctx) {
  // Runs after all events of this call. Nothing here once phase is 'ended': a counted cancel in this call
  // means every forward step would be new after it (S10, R6.2), and moot steps need not be taken (S9).
  // - 'waiting': customer-action { op: 'advance' } (R3.1 status and notice, once).
  // - 'processing': once, order-progress { op: 'ready', at: readyAt, fulfilments } (R4.1); once per available
  //   fulfilment, fulfilment { op: 'start', ... } (R4.2); then, every tick, fulfilment { op: 'advance' } for each.
  throw new Error('endOfTick: not implemented');
}

function shouldClose(state) {
  // True when phase is 'ended' and no module reports busy (pending results, set wake-ups). Until then the
  // instance stays open, so carrier messages quoting our ref still reach it (§1 Routing).
  throw new Error('shouldClose: not implemented');
}

function resumeMigration(event, state, ctx) {
  // §3.5: the instance's first event carries the records and the messages already received. Declare the
  // subject (normalised order id), give each module its part with { op: 'resume', records }, set the phase
  // from where the order stands, and continue under the same rules. Its carrier messages carry no ref of ours:
  // they arrive as new instances and are merged here by fulfilmentRef (routeFirstTick).
  throw new Error('resumeMigration: not implemented');
}
