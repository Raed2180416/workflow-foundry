# E8 semantics ledger (E-BED §2.11)

Compared systems: the Temporal order reference application `temporalio/reference-app-orders-go@f4420d9`
(MIT; acquisition row in `research/enterprise-20261014/ACQUISITIONS.json`, read inert at
`/var/tmp/foundry-work/corpus/reference-app-orders-go`) and the saga specification of the bar
(BAR-SET §E8: the Camunda trip saga's compensation structure, Coinbase-style swap structure). Every feature is *in*
(with the spec-E section and the source line) or *out* (with the reason). Counts: **in 24, out 9**.

## In

| # | feature | spec-E | source |
|---|---|---|---|
| 1 | order statuses pending, customerActionRequired, processing, completed, failed, cancelled, timedOut | §2, R7.2 | `app/order/api.go:73-94` |
| 2 | fulfilment statuses unavailable, pending, processing, completed, cancelled, failed | §2, R7.2 | `app/order/api.go:161-179` |
| 3 | fulfilment status `dispatched` | R4.4 | named in the comment at `app/order/api.go:149`, not set by the app's code |
| 4 | per-location fulfilments from a reservation plan with availability | §2 `inventory.allocate`, R1.1 | `app/order/workflows.go:165-205` (`ReserveItems` returns reservations with `Available`) |
| 5 | customer action required when any fulfilment is unavailable | R3.1 | `workflows.go:83-88, 207-215` |
| 6 | customer action amend / cancel racing a timeout | R3.2 | `workflows.go:246-292`; timeout 30 s "aggressively low for demo purposes" `:23-24`, scaled to hours |
| 7 | amend cancels the unavailable fulfilments, the rest proceed | R3.2 | `workflows.go:102-103, 217-225` |
| 8 | timeout cancels every fulfilment and times out the order | R3.2 | `workflows.go:98-101, 227-233` |
| 9 | order outcome: failed only if every fulfilment failed | R4.5 | `workflows.go:126-129, 235-244` (the app counts cancelled fulfilments toward completed; spec-E states the outcome explicitly) |
| 10 | charge per fulfilment with an idempotency key | R4.2, §1 keys | `workflows.go:340-394` (`SideEffect` uuid key, `:356-371`) |
| 11 | shipment per fulfilment after the charge | R4.2 | `workflows.go:313-338, 396-428` (child workflow) |
| 12 | carrier status updates booked → dispatched → delivered, unknown statuses ignored | §3.3, R4.4 | `app/shipment/workflows.go:129-161` (`validCarrierStatus`) |
| 13 | activity retries with Temporal's default policy | §1 profile `temporal-like` | activity options set only `StartToCloseTimeout` (`workflows.go:168, 350`; `shipment/workflows.go:103`), so the default retry policy applies [docs.temporal.io] |
| 14 | compensation of committed steps in reverse order: cancel shipment, refund, release | R5.1 | bar: trip saga compensation boundary events (BAR-SET §E8); absent from the app (no compensat/rollback/refund in non-test Go code) |
| 15 | all-or-nothing per fulfilment; other fulfilments unaffected | R5.2 | bar |
| 16 | no orphaned charge or reservation | R5.1, R7.1 | bar (E-BED §2.8 critical violations) |
| 17 | outcome-unknown steps reconciled by `status(key)` before compensation | R5.1, S2 | bar (MR11) |
| 18 | customer cancel until collection; collection is the pivot | R6.2, R4.3, S4, S6 | bar ("cancel-vs-timeout race" and pivot reading, BAR-SET §E8) |
| 19 | fraud screening with reject and analyst review | R2 | bar (E-BED §3 E8 "fraud holds") |
| 20 | carriers with their own status vocabularies | §3.3 | bar (E-BED §3 E8 d3 drift "new carrier with a different status vocabulary") |
| 21 | repeated and out-of-order carrier reports; statuses never regress | §3.3, R7.2 | bar (E-BED §2.7 W1, W2; candidate defect "late in-transit signal regressing a delivered status") |
| 22 | effective-dated rulebook editions (customer-action window, shipping fees) chosen by placement date | R1.3 | bar (E-BED §2.6 d4) |
| 23 | go-live backlog: orders in flight at t0 | §3.5 | contract §3.5 |
| 24 | daily collection runs with a booking cut-off | R4.3 | bar (makes the pivot time a rule, not a hidden timer) |

## Out

| # | feature | reason |
|---|---|---|
| 1 | payment status record per fulfilment (`PaymentStatus` subtotal, tax, shipping) | `api.go:111-130`; the charge row carries the amount; tax is not modelled |
| 2 | tax computation | the app's billing computes tax and shipping (`app/billing/api.go`); spec-E uses a catalogue price plus a location fee |
| 3 | carrier courier reference returned by booking | `shipment/workflows.go:107-127`; not needed by any rule |
| 4 | order and shipment list/query HTTP APIs | `app/order/api.go`, `app/shipment/api.go`; the host's `sor.query` plays this role |
| 5 | loss or damage after collection | after the pivot only delivery happens in this version; a post-pivot failure needs a refund-without-release rule (future edition) |
| 6 | per-SKU partial shipment policy (E-BED §3 E8 d4) | replaced at d4 by an edition switch of the customer-action window and fees; recorded as a deviation from E-BED |
| 7 | inventory schema change and billing idempotency-header rename (E-BED §3 E8 d5) | d5 uses an F5 rename of `billing.charge` `amountMinor` → `amount`; an idempotency header is host-level here |
| 8 | re-routing a failed collection to another carrier | no rule; a collection failure fails the fulfilment |
| 9 | customer amend that changes quantities | the app's amend only drops unavailable items (`workflows.go:217-225`) |

## Deviations from E-BED §3 E8 (for review)

- d4 drift is an edition switch (window 4 h → 2 h; fees) instead of per-SKU partial shipment (Out 6).
- d5 drift is one F5 rename instead of an idempotency-header rename plus an inventory schema change (Out 7).
- Horizon 14 days at minute resolution (E-BED: 14 days at hour granularity); collection runs and the cut-off need minutes.
- The carrier is a guarded counterparty (host H-29): it collects only a shipment that is still booked at the collection
  run, so a cancellation before collection is honoured by the world for every arm.
