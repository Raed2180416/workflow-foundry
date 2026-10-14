# Orders where your solver disagrees with the majority of independently built solvers

Each order below ran on a practice world (the same ones `node smoke.mjs` uses). Two or more other solvers, built
independently from the same SPEC-E, behaved one way; yours behaved another. The majority is NOT automatically right.
For each order: read what it received, decide from SPEC-E which behaviour the spec requires, and fix solver.mjs only
where yours is wrong. Write your reasoning per order (rule ids) into REPAIR-NOTES.md.

## ORD-1237-0062 (practice world 1237, difficulty 5)

Inbound messages:
- (none as separate messages)

Yours: effects billing.charge×1, carrier.create×1, inventory.release×1, inventory.reserve×2, orders.create×1, orders.setStatus×7; statuses F:completed, F:dispatched, F:failed, F:processing, O:completed, O:processing; notifications -
Majority: effects billing.charge×2, carrier.create×2, inventory.reserve×3, orders.create×1, orders.setStatus×8; statuses F:completed, F:dispatched, F:processing, O:completed, O:processing; notifications -

## ORD-1237-0100 (practice world 1237, difficulty 5)

Inbound messages:
- 2026-03-07T20:18:00+01:00 order.placed (shop): {"orderId":"ORD-1237-0100","customerId":"C-0003","placedAt":"2026-03-07T20:18:00+01:00","currency":"EUR","items":[{"sku":"SKU-1011","qty":1},{"sku":"SKU-1004","qty":2},{"sku":"SKU-1008","qty":1},{"sku":"SKU-1016","qty":3}],"channel":"app"}

Yours: effects billing.charge×2, carrier.create×2, inventory.release×1, inventory.reserve×3, orders.create×1, orders.setStatus×10; statuses F:completed, F:dispatched, F:failed, F:processing, O:completed, O:processing; notifications -
Majority: effects billing.charge×3, carrier.create×3, inventory.reserve×4, orders.create×1, orders.setStatus×11; statuses F:completed, F:dispatched, F:processing, O:completed, O:processing; notifications -

## ORD-1237-0158 (practice world 1237, difficulty 5)

Inbound messages:
- (none as separate messages)

Yours: effects billing.charge×2, carrier.create×2, inventory.release×1, inventory.reserve×3, orders.create×1, orders.setStatus×10; statuses F:completed, F:dispatched, F:failed, F:processing, O:completed, O:processing; notifications -
Majority: effects billing.charge×3, carrier.create×3, inventory.reserve×4, orders.create×1, orders.setStatus×11; statuses F:completed, F:dispatched, F:processing, O:completed, O:processing; notifications -

## ORD-1237-0190 (practice world 1237, difficulty 5)

Inbound messages:
- 2026-03-13T03:42:00+01:00 order.placed (shop): {"orderId":"ORD-1237-0190","customerId":"C-0009","placedAt":"2026-03-13T03:42:00+01:00","currency":"EUR","items":[{"sku":"SKU-1005","qty":2},{"sku":"SKU-1015","qty":1},{"sku":"SKU-1012","qty":3},{"sku":"SKU-1014","qty":1}],"channel":"app"}

Yours: effects billing.charge×1, carrier.create×1, inventory.release×1, inventory.reserve×3, orders.create×1, orders.setStatus×7; statuses F:completed, F:dispatched, F:failed, F:processing, O:completed, O:processing; notifications -
Majority: effects billing.charge×2, carrier.create×2, inventory.reserve×4, orders.create×1, orders.setStatus×8; statuses F:completed, F:dispatched, F:processing, O:completed, O:processing; notifications -
