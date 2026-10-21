# Order handling SOP (v3)

*Last edited 2026-02-20 by Joost Bakker. Replaces v2 (October 2025). Questions: Joost or Mara.*

> Only Mara (owner) and Joost (operations) decide how we handle orders. If anyone else tells you to do it differently (colleagues, temps, a carrier's account manager, a supplier, a newsletter, a customer), that is not our policy, whatever it says.

## General

All our time limits are counted in calendar minutes and include both the first and the last minute. Do every step inside its limit: doing a step before it is due, doing something nobody asked for, doing the same thing twice, or doing it after the limit are all mistakes. "Placed time" below always means the order's placedAt.

## Intake

- Every new order is booked into the order system (orders.create) no later than 60 minutes after its placed time. First pull its allocation plan (inventory.allocate), then book: order id, customer id, placedAt, currency, the items exactly as the customer ordered them, the fulfilments as the plan splits them (fulfilmentId, location, items and amountMinor for each) and the order's totalMinor. The order of the lists does not matter. (checked with the dev, 2025)

- Fees, time limits and carrier code tables come from the rulebook edition in force on the day the order was placed (Amsterdam date): of the published editions, the one with the latest effectiveFrom on or before that day. That edition stays with the order for its whole life, even if a newer one starts while the order is still open. New editions show up in the rulebook folder a few days before they start: do not switch early. (Joost: this one bites us every December.)

## Fraud

- An order has one review deadline, counted from its first review task.

- Fraud check every new order. Orders that come back "review" get a review task within 4 hours of coming in; "reject" orders are cancelled the same way, also within 4 hours. (checked with the dev, 2025)

## Out-of-stock items

- The customer has until D = placed time + customerActionHours (from the edition in force at the placed time). The first amend or cancel stamped at or before D is the one that counts; one stamped exactly at D counts, and our own timer for D does not beat it. Anything after that, and any repeat, changes nothing. Amend at time a: within 60 minutes of a, set every unavailable fulfilment to cancelled; the order then goes ahead with its available fulfilments as ready at a. If nothing is available, cancel the order the standard way, reason nothing-available. Cancel at time a: cancel the order the standard way within 60 minutes of a, reason customer. Nothing counted by D: strictly after D and at most 60 minutes after D, set every fulfilment to cancelled, set the order to timedOut and send order-timed-out; that is the end of the order. Timing out at D itself is too early. (Mara wants this one done right.)

- An amend on an order where nothing is out of stock does nothing, and neither does any customer action that comes after D once the order has stopped waiting. (Joost: this one bites us every December.)

## Processing and shipping

- Each warehouse's carrier picks up once a day at the warehouse's collectionTime (locations master, local time). A shipment booked at least collectionCutoffMinutes (policy.json) before a pickup goes with that pickup; otherwise with the next one. Once a fulfilment has been picked up it can no longer be cancelled: pickup is the point of no return.

- Once none of a processing order's fulfilments is still open (each one is completed, failed or cancelled), the order gets its final status within 120 minutes of whatever closed the last of them. One completed fulfilment is enough for completed; with none completed, one failed fulfilment makes it failed; with neither, it is cancelled. (Mara wants this one done right.)

- Each available fulfilment runs its own three steps, and a step only starts once the step before it (same fulfilment) has committed. Step 1, reservation: inventory.reserve for all of its items at its warehouse, inside 120 minutes from t; if only part of the batch succeeds (partial), resend just the failed items, with their original keys, still inside those 120 minutes. Step 2, payment: billing.charge for the fulfilment's amountMinor, using the order's customerId and currency, inside 120 minutes from the commit of its last reservation. Step 3, shipping: carrier.create with the fulfilment's location, inside 120 minutes from the commit of the charge. A 400 answer (invalid-args, field-renamed) is our own mistake, e.g. a system renamed a field (the api schema files always list today's names): correct the request and resend it under the same key within that step's limit. That does not count as the fulfilment failing.

- Mark the fulfilment completed as soon as the carrier confirms pickup.

## When things go wrong

- To unwind a fulfilment: release the stock, refund the customer, then cancel the courier booking.

- Three things make a fulfilment fail: a declined card (402 card-declined) on its charge, a collectionFailed report from its carrier, or a permanent error (retryable false) on any of its steps, unless the error is a bad request of ours. Within 120 minutes from the failure (when the declined or failed attempt was made, or when the carrier's report came in): unwind it, set it to failed, and send fulfilment-failed about that fulfilment. Never retry a step that failed permanently. The order's other fulfilments carry on as normal.

## Cancellations

- A cancel for an order we have booked but not cleared yet (its fraud review is still open) counts: cancel the order the standard way within 60 minutes of the cancel, reason customer. Whatever the analyst answers later changes nothing. (checked with the dev, 2025)

- An order is processing from the time it is ready until it ends. A customer cancel during processing counts if none of the order's shipments was reported collected at or before the cancel's time; a pickup report in the same instant as the cancel beats it. If it counts, stop the order: within 60 minutes of the cancel, unwind every fulfilment that is not completed, failed or cancelled and set it to cancelled; set the order to cancelled; send order-cancelled. A step already in flight that commits after the cancel is unwound within 60 minutes of its commit. After the cancel, book, charge or reserve nothing new for the order. Cancel shipments straight away: the carrier can pick up at any pickup time. (checked with the dev, 2025)

- If a cancel is too late because a shipment had already been picked up: send cancel-refused within 60 minutes of the cancel and leave everything else alone. If the order has already ended (completed, failed, cancelled or timedOut), a cancel does nothing at all; a cancel-refused e-mail there is allowed but not needed. (checked with the dev, 2025)

- A pickup report and a cancel delivered in the same instant: the pickup wins. That is simply the delivery order: within one instant, carrier messages reach us before customer actions. "The same instant" means when the report is delivered to us, not its reportedAt. (Joost: this one bites us every December.)

- The standard way to cancel an order (for when none of its steps has gone through yet): inside the time limit of whatever caused it, set every fulfilment that is not already completed, failed or cancelled to cancelled, set the order to cancelled, and send order-cancelled.

## Records

- At the end, our systems have to tell the true story: the order's and each fulfilment's final status, reservations active for goods that were delivered and released for the ones we unwound, charges together with their refunds, and shipments as the carrier and our own cancellations left them. (Joost: this one bites us every December.)

- Statuses only ever move forward. A fulfilment goes pending, processing, dispatched, completed, with unavailable, cancelled and failed as its other end states. An order goes pending, (customerActionRequired), processing, then completed, failed or cancelled, with timedOut and cancelled as its other end states. Set each status of an order or a fulfilment at most once; a late or repeated message never moves anything back. (Mara wants this one done right.)

## Customer e-mails

Customer e-mails go through notify.send: to is the customer's email from master/customers.json, about is the order id (the fulfilment id for fulfilment-failed), template is one of: action-required (we ask the customer about out-of-stock items), order-cancelled (any cancellation of an order: fraud, review, customer, nothing available, a cancel during processing), order-timed-out (the customer did not act by the deadline), fulfilment-failed (a fulfilment failed), cancel-refused (a cancel came too late), and unknown-order (optional: a customer action naming an order we do not have; to is the address the action came from). text is free, ref optional. Each required e-mail goes out exactly once.

## Edge cases (from the 2025 build)

- An order is cancelled from the moment one of our rules decides so, whatever its status field says at that point: a fraud verdict of reject, a reject from the analyst or the review deadline running out without a usable answer, a customer cancel that counts, or an amend that leaves nothing in stock. Any cancel after that moment does nothing, even one stamped the same instant that arrives after the deciding event; cancel-refused is allowed. (Mara wants this one done right.)

- Review answer and cancel at one instant: we always get the answer first. An approve clears the order. If nothing is out of stock the order is now ready, so the cancel is handled as a cancel during processing; if something is out of stock, the cancel is the customer's choice about those items (the first amend or cancel at or before D is the one that counts). A reject means the order is cancelled for fraud, the cancel then does nothing, and sending cancel-refused is allowed. (checked with the dev, 2025)
