# Orders where your solver disagrees with the majority of independently built solvers

Each order below ran on a practice world (the same ones `node smoke.mjs` uses). Two or more other solvers, built
independently from the same SPEC-E, behaved one way; yours behaved another. The majority is NOT automatically right.
For each order: read what it received, decide from SPEC-E which behaviour the spec requires, and fix solver.mjs only
where yours is wrong. Write your reasoning per order (rule ids) into REPAIR-NOTES.md.

## ORD-1235-0001 (practice world 1235, difficulty 2)

Inbound messages:
- (none as separate messages)
- this order was also in the go-live migration export delivered at the start

Yours: nothing at all (no committed effect for this order)
Majority: effects billing.charge×2, carrier.create×2, inventory.reserve×2, orders.create×1, orders.setStatus×8; statuses F:completed, F:dispatched, F:processing, O:completed, O:processing; notifications -

## ORD-1235-0002 (practice world 1235, difficulty 2)

Inbound messages:
- 2026-03-02T02:19:00+01:00 customer.action (customer-portal): {"orderRef":"ORD-1235-0002","action":"cancel","from":"c0026@hollin-shop.example"}
- this order was also in the go-live migration export delivered at the start

Yours: nothing at all (no committed effect for this order)
Majority: effects orders.setStatus×3; statuses F:cancelled, O:cancelled; notifications -

## ORD-1235-0003 (practice world 1235, difficulty 2)

Inbound messages:
- 2026-03-02T05:57:00+01:00 carrier.status (carrier): {"carrier":"PARCELLA","code":"DELIVERED","shipmentId":"SHP-GL-003","fulfilmentRef":"ORD-1235-0003-F1","reportedAt":"2026-03-02T05:57:00+01:00"}
- this order was also in the go-live migration export delivered at the start

Yours: nothing at all (no committed effect for this order)
Majority: effects orders.setStatus×2; statuses F:completed, O:completed; notifications -

## ORD-1236-0001 (practice world 1236, difficulty 3)

Inbound messages:
- (none as separate messages)
- this order was also in the go-live migration export delivered at the start

Yours: nothing at all (no committed effect for this order)
Majority: effects billing.charge×2, carrier.create×2, inventory.reserve×3, orders.create×1, orders.setStatus×8; statuses F:completed, F:dispatched, F:processing, O:completed, O:processing; notifications -

## ORD-1236-0004 (practice world 1236, difficulty 3)

Inbound messages:
- (none as separate messages)
- this order was also in the go-live migration export delivered at the start

Yours: nothing at all (no committed effect for this order)
Majority: effects billing.charge×1, carrier.create×1, inventory.reserve×4, orders.create×1, orders.setStatus×5; statuses F:completed, F:dispatched, F:processing, O:completed, O:processing; notifications -

## ORD-1236-0002 (practice world 1236, difficulty 3)

Inbound messages:
- 2026-03-02T01:05:00+01:00 customer.action (customer-portal): {"orderRef":"ORD-1236-0002","action":"amend","from":"c0022@hollin-shop.example"}
- this order was also in the go-live migration export delivered at the start

Yours: nothing at all (no committed effect for this order)
Majority: effects billing.charge×1, carrier.create×1, inventory.reserve×1, orders.setStatus×6; statuses F:cancelled, F:completed, F:dispatched, F:processing, O:completed, O:processing; notifications -

## ORD-1236-0005 (practice world 1236, difficulty 3)

Inbound messages:
- 2026-03-02T01:39:00+01:00 customer.action (customer-portal): {"orderRef":"ORD-1236-0005","action":"cancel","from":"c0035@hollin-shop.example"}
- this order was also in the go-live migration export delivered at the start

Yours: nothing at all (no committed effect for this order)
Majority: effects orders.setStatus×2; statuses F:cancelled, O:cancelled; notifications -

## ORD-1236-0003 (practice world 1236, difficulty 3)

Inbound messages:
- 2026-03-02T21:39:00+01:00 carrier.status (carrier): {"carrier":"PARCELLA","code":"DELIVERED","shipmentId":"SHP-GL-003","fulfilmentRef":"ORD-1236-0003-F1","reportedAt":"2026-03-02T21:39:00+01:00"}
- this order was also in the go-live migration export delivered at the start

Yours: nothing at all (no committed effect for this order)
Majority: effects orders.setStatus×2; statuses F:completed, O:completed; notifications -

## ORD-1237-0001 (practice world 1237, difficulty 5)

Inbound messages:
- (none as separate messages)
- this order was also in the go-live migration export delivered at the start

Yours: nothing at all (no committed effect for this order)
Majority: effects billing.charge×1, carrier.create×1, inventory.reserve×1, orders.create×1, orders.setStatus×5; statuses F:completed, F:dispatched, F:processing, O:completed, O:processing; notifications -

## ORD-1237-0004 (practice world 1237, difficulty 5)

Inbound messages:
- (none as separate messages)
- this order was also in the go-live migration export delivered at the start

Yours: nothing at all (no committed effect for this order)
Majority: effects billing.charge×2, carrier.create×2, inventory.reserve×2, orders.create×1, orders.setStatus×8; statuses F:completed, F:dispatched, F:processing, O:completed, O:processing; notifications -

## ORD-1237-0007 (practice world 1237, difficulty 5)

Inbound messages:
- (none as separate messages)
- this order was also in the go-live migration export delivered at the start

Yours: nothing at all (no committed effect for this order)
Majority: effects billing.charge×2, carrier.create×2, inventory.reserve×3, orders.create×1, orders.setStatus×8; statuses F:completed, F:dispatched, F:processing, O:completed, O:processing; notifications -

## ORD-1237-0002 (practice world 1237, difficulty 5)

Inbound messages:
- 2026-03-02T01:00:00+01:00 customer.action (customer-portal): {"orderRef":"ORD-1237-0002","action":"amend","from":"c0027@hollin-shop.example"}
- this order was also in the go-live migration export delivered at the start

Yours: nothing at all (no committed effect for this order)
Majority: effects billing.charge×1, carrier.create×1, inventory.reserve×2, orders.setStatus×6; statuses F:cancelled, F:completed, F:dispatched, F:processing, O:completed, O:processing; notifications -

(4 more orders disagree in the same way or similar ways.)