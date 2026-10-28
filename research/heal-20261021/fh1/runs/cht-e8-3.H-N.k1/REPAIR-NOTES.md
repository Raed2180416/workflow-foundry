# REPAIR-NOTES

## Root cause (shared by every listed order)

Each listed order is a customer cancel during processing that counts (R6.2): the order was ready (R4.1), its shipments
were booked and not reported collected before the cancel (S7), and so the cancel stops the order. The spec then
requires compensation of every non-terminal fulfilment (R6.2, R5.1): cancel its shipment, refund its full charge,
release each committed reservation, in that order, each step after the previous one committed.

My program did emit the shipment cancel (`carrier.cancel`) for each such fulfilment, but never emitted the refund or
the releases. The cause is in `parent.mjs`, not in the fulfilment saga:

- The cancellation module stops the fulfilments (`fulfilment/stop`) from inside its own call, so the parent never sees
  their busy flag.
- The parent's `setEnded()` then saw no busy module and closed the instance (`close: true`) in the same tick.
- The `carrier.cancel` result arrived after the close. Per CONTRACT.md, "later deliveries start nothing", so it was
  dropped and the saga never reached the refund step (`comp` in `modules/fulfilment.mjs`).

Evidence from smoke: before the fix, world 1235 received 1 `billing.refund` and 4 `inventory.release` results and no
`carrier.cancel` results; world 1236 received 6 refunds, 21 releases and no `carrier.cancel`. After the fix: 1235 gets
8 refunds, 11 releases and 7 `carrier.cancel`; 1236 gets 14 refunds, 32 releases and 8 `carrier.cancel`. The
`order-cancelled` notices that were lost the same way now arrive too (1235: 13 -> 18 notify results, which is the five
cancelled orders in the list; 1236: 29 -> 33, the four cancelled orders in the list). Forward-step result counts
(reserve, charge, ship, fraud, allocate, create) are unchanged, so no other behaviour moved.

## The fix (parent.mjs, `setEnded`)

After the fraud and customer-clock stops, `setEnded` now reads every saga of the order (`fulfilment/get`, which has no
side effects and is already used by the cancellation module). The reply sets each saga's busy flag in the parent, so the
instance stays open until the last compensating step has committed. When it has, the flag clears and the instance
closes as before.

Why this is the right place and rule-consistent:
- R5.1 / R6.2: a stopped fulfilment must still compensate what committed, including steps in flight; the instance must be
  alive to receive those results.
- S10 / R6.2: nothing new is booked, charged or reserved; `get` emits no effect.
- R6.2 window: the compensation effects are emitted in the cancel's own tick, so they fall within 60 min of the cancel.
- A side benefit that follows from the same reading: a fulfilment that fails inside a cancel (S13, S14) reports
  its end to the parent through the same read, so the order's R4.5 outcome is not lost.

## Per order

Rules: R6.2 (counted cancel during processing), S7 (no collection reported before the cancel; the listing shows no
carrier message), R5.1 (compensation order: shipment, refund, releases), R7.1 (records: charges with refunds, reservations
released, shipments as the carrier left them). The majority counts below are the number of compensation effects it
emitted. My program emitted the same number of shipment cancels and now emits the same refunds and releases.

- ORD-1235-0017: cancel 15:20, placed 14:50, both fulfilments available, ready at clearing. Counts (R6.2, S7).
  Compensate 2 fulfilments: 2 shipment cancels, 2 refunds, 2 releases. Fixed by the parent change.
- ORD-1235-0035: cancel 15:07, placed 12:09, one fulfilment. Counts. 1 each of cancel, refund, release. Fixed.
- ORD-1235-0038: cancel 15:23, placed 14:44, two fulfilments. Counts. 2 each of cancel, refund, release. Fixed.
- ORD-1235-0049: cancel 04:47 the next day, placed 22:14, one fulfilment, no collection reported. Counts (S7). 1 each. Fixed.
- ORD-1235-0053: cancel 07:43, placed 04:31, one fulfilment, no collection reported. Counts (S7). 1 each. Fixed.
- ORD-1236-0013: cancel 21:43, placed 16:45, four items in several fulfilments. Counts. 2 shipment cancels, 2 refunds,
  4 releases. Fixed.
- ORD-1236-0026: a duplicate `order.placed` at 19:39 (R1.4: no effect, as my program does), then cancel 02:40 next day.
  Counts. 1 each. Fixed. The duplicate was already handled correctly; only the compensation was missing.
- ORD-1236-0031: cancel 10:57, placed 08:56, counts. 2 shipment cancels, 2 refunds, 3 releases. Fixed.
- ORD-1236-0053: cancel 00:16 the next day, placed 22:12, counts. 3 each. Fixed.
- ORD-1237-0037: cancel 02:51 the next day, placed 18:27, counts. 1 each. Fixed.
- ORD-1237-0075: listing shows only `order.placed`, yet both programs end the order `cancelled` with a shipment booked
  and a charge committed. My program's only route to that state is a counted customer cancel, which the listing does not
  show. So either the listing is incomplete or the platform delivered a cancel the listing omits. Compensation is required
  either way (R6.1 / R6.2 / R5.1) and is now emitted. I could not confirm this order's trace from the smoke output, which
  reports only aggregates.
- ORD-1237-0088: placed 06:51 with an unavailable item (`customerActionRequired` in both programs). The order reached
  `processing`, then a cancel at 10:18 counts as a cancel during processing (S8, R6.2). Compensation: 2 shipment cancels,
  2 refunds, 3 releases for the committed fulfilments. The unavailable fulfilment (R3.2 amend) has nothing committed,
  so it gets none. The listing shows no amend, so I could not trace how the order reached `processing`. Both programs
  produce the same status sequence, so I left it alone; the compensation fix is correct under either path.

The six further orders mentioned in DISAGREEMENTS.md were not listed, so I did not check them individually. The
same root cause (lost compensation results after a counted cancel) explains the same counts in the smoke totals.

## Not changed

- No change to `modules/*`. The fulfilment saga already emits the right compensation (`comp`); the defect was the parent
  closing the instance too early.
- `compose.mjs check` and `compose.mjs test` pass after the change (37/37 module tests).
