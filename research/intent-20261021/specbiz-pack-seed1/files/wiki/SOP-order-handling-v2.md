# Order handling SOP (v2)

*October 2025, Joost.*

## Intake

- Book every new order into the order system within 2 hours of it coming in (pull the allocation plan first and copy it across).

## Fraud

- Fraud check every new order. Orders that come back "review" get a review task within 4 hours of coming in; "reject" orders are cancelled the same way, also within 4 hours.

## Out-of-stock items

- Customers get customerActionHours from the moment we flag the order (customerActionRequired) to amend or cancel. If they have not answered by then, time the order out.

- An amend on an order where nothing is out of stock does nothing, and neither does any customer action that comes after D once the order has stopped waiting.

## Processing and shipping

- Per fulfilment: reserve the items, book the courier, and charge the card once the courier has collected the parcel.

- Mark the fulfilment completed as soon as the carrier confirms pickup.

- Once none of a processing order's fulfilments is still open (each one is completed, failed or cancelled), the order gets its final status within 120 minutes of whatever closed the last of them. One completed fulfilment is enough for completed; with none completed, one failed fulfilment makes it failed; with neither, it is cancelled.

## When things go wrong

- To unwind a fulfilment: release the stock, refund the customer, then cancel the courier booking.

- Three things make a fulfilment fail: a declined card (402 card-declined) on its charge, a collectionFailed report from its carrier, or a permanent error (retryable false) on any of its steps, unless the error is a bad request of ours. Within 120 minutes from the failure (when the declined or failed attempt was made, or when the carrier's report came in): unwind it, set it to failed, and send fulfilment-failed about that fulfilment. Never retry a step that failed permanently. The order's other fulfilments carry on as normal.

## Cancellations

- Customers can cancel right up until the parcel is delivered; when they do, refund them and cancel the courier.

- If a cancel is too late because a shipment had already been picked up: send cancel-refused within 60 minutes of the cancel and leave everything else alone. If the order has already ended (completed, failed, cancelled or timedOut), a cancel does nothing at all; a cancel-refused e-mail there is allowed but not needed.

- A cancel for an order we have booked but not cleared yet (its fraud review is still open) counts: cancel the order the standard way within 60 minutes of the cancel, reason customer. Whatever the analyst answers later changes nothing.

## Records

- At the end, our systems have to tell the true story: the order's and each fulfilment's final status, reservations active for goods that were delivered and released for the ones we unwound, charges together with their refunds, and shipments as the carrier and our own cancellations left them.

## Edge cases (from the 2025 build)

- An order is cancelled from the moment one of our rules decides so, whatever its status field says at that point: a fraud verdict of reject, a reject from the analyst or the review deadline running out without a usable answer, a customer cancel that counts, or an amend that leaves nothing in stock. Any cancel after that moment does nothing, even one stamped the same instant that arrives after the deciding event; cancel-refused is allowed.
