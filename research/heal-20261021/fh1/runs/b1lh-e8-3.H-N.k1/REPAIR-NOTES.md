# REPAIR-NOTES

Result: no change to `solver.mjs`. For each order below I checked the behaviour the solver produced against SPEC-E
and found it to match the spec, except one notice (ORD-1235-0002, ORD-1236-0005) that I could not reproduce
locally and could not confirm from the platform. Where the majority did nothing (`Majority: ∅`), the spec requires
the solver's behaviour, so the majority is the side that is wrong.

Method: smoke run (`node smoke.mjs`: 1235, 1236, 1237 complete, 0 arm errors); a local harness that calls
`solver.mjs` with a mock context built from the DISAGREEMENTS records (migration tick, then the later message) to
inspect the exact effects emitted.

## Orders with a migrated, un-recorded order.placed (majority ∅)

ORD-1235-0001, ORD-1236-0001, ORD-1236-0004, ORD-1237-0001, ORD-1237-0004, ORD-1237-0007

- §3.5: the migration carries "the messages already received". Here the placed order is only in the export's events,
  with no `orders.orders` record, so it is continued from the message.
- R1.1 (record within 60 min of p), R1.2 (amounts), R1.4 (duplicate check), R2.1 (fraud `pass` clears at p),
  R4.1 (processing), R4.2 (reserve, charge, ship per fulfilment), R4.4/R4.5 (collection and delivery reports, order
  outcome `completed`) are all followed; the solver emits exactly these.
- The `placedAt` of these orders is 2026-03-01 23:18–23:39, and they sit in the same export, so the go-live instant is
  at or after 23:39. R1.1's 60-minute window (to 00:18–00:39) is therefore still open at go-live only if go-live is
  before it. I cannot see the migration tick's time from this directory, so this rests on the export's contents and
  not on a checked instant. If go-live were after a window, R1.1 would make the create an error; the spec has no
  late-intake rule, so I did not change the behaviour.
- ORD-1236-0001 carries `orderId: " ord-1236-0001"`; §3.1 normalisation (`norm`) is applied, so no change.
- Majority ∅ is wrong here: a placed order that is still in its intake window must be recorded and processed.

## ORD-1235-0002 (cancel while customerActionRequired, migrated)

- R3.1 is already done (status `customerActionRequired` in the records). The cancel at 2026-03-02T02:19 is at or before
  D = p + customerActionHours (S1, R3.2), so it counts as the customer's `cancel` (R3.2, S5 does not apply).
- R6.1 (via R3.2 `cancel`, reason `customer`): set each open fulfilment `cancelled`, set the order `cancelled`, send
  `order-cancelled` (§4.8). The solver emits F1 cancelled, F2 cancelled, order cancelled, and `order-cancelled`.
- The DISAGREEMENTS record shows only the three `orders.setStatus` effects and no notification. My local run of the
  same input emits the `notify.send` (`template: order-cancelled`) as well; a mock with no customer email, or with the
  customers table as a map, also emits it. The gap is therefore not in the rule logic as I can exercise it. It is
  unresolved: it would be settled by the platform's effect log for ORD-1235-0002 (was `notify.send` submitted, and if
  so what did the platform answer?).
- Majority ∅ is wrong: a counted cancel must cancel the order.

## ORD-1236-0005 (cancel with an unavailable fulfilment, migrated)

- Same as ORD-1235-0002: counted `cancel` (R3.2), R6.1: F cancelled, order cancelled, `order-cancelled` to the
  customer's email. The local run emits the notification (`to: c0035@hollin-shop.example`). The platform record shows
  none; unresolved for the same reason.
- The migration records list a `notify.notifications` row (NTF-GL-005) for this order. The solver does not read it,
  and the spec does not require it to be read for `order-cancelled` (a different template), so it is not a cause here.

## ORD-1235-0003 and ORD-1236-0003 (carrier DELIVERED, migrated, status processing)

- The `delivered` report reaches the migrated instance (carrier messages for pre-go-live shipments start new instances
  and are matched by `fulfilmentRef`, §3.5; the solver merges them into the open order).
- R4.4 `delivered`: fulfilment `completed` within 120 min (dispatched first if not yet set); R4.5: the only fulfilment
  ends the order `completed`. The solver emits F `completed` and O `completed` (2 `setStatus`), matching the spec.
- Majority ∅ is wrong: a delivery report for an open order must change its status.

## ORD-1236-0002 and ORD-1237-0002 (amend, migrated, customerActionRequired)

- R3.2 `amend` at 01:05 / 01:00 (≤ D): unavailable fulfilments `cancelled` within 60 min; the order is `ready` at the
  amend's time (R4.1, S8, S11), so the order and available fulfilments become `processing`; each available fulfilment
  runs the R4.2 saga; R4.4/R4.5 complete it.
- The solver emits: 1 cancelled (unavailable), processing, and the saga for the available fulfilment(s) only, with
  `billing.charge` and `carrier.create` per available fulfilment, `inventory.reserve` per item, and the completed
  statuses. This matches R3.2 and R4.
- No notification is required by the spec for an amend, and none is emitted.
- Majority ∅ is wrong: an amend is a counted action that must lead to processing.

## Not checked

- The eight other disagreeing orders are not listed in DISAGREEMENTS.md, so I could not check them.
- The platform's per-order effect log is not visible from this directory; the smoke output gives counts only.
