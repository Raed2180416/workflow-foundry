# Failure report

The platform ran your program on the practice worlds (1235 d2, 1236 d3, 1237 d5; the same worlds `node smoke.mjs` uses) and
checked every completed order against its capability contracts, executable checks written from SPEC-E's rules.
320 of 324 completed orders pass every contract. The failing orders fall into 3 failure classes
(a class = one contract, one rule, one kind of finding). A second run reproduced every failure exactly, so each is a defect in the
program, not chance. Your program is judged on other worlds with other orders: fix the cause, not the example.

## Likely common causes

- Classes 1, 2, 3 fail on the same 4 orders: probably one cause, upstream of the first rule they break.

## Class 1: 4 orders, contract "compensation", rule R5.1

Finding (normalised): ORD-…: compensation ["release:SKU-<n>"], committed steps need []
The contract checks SPEC-E rules R5.1, R5.2, R6.2, S2, S14.

### ORD-1237-0062 (practice world 1237, difficulty 5)

What it received:
- (no separate inbound message)
What the contract found:
- [R5.1] ORD-1237-0062-F1: compensation ["release:SKU-1022"], committed steps need []
What your program did: effects billing.charge×1, carrier.create×1, inventory.release×1, inventory.reserve×2, orders.create×1, orders.setStatus×7; statuses F:completed, F:dispatched, F:failed, F:processing, O:completed, O:processing; notifications -

### ORD-1237-0100 (practice world 1237, difficulty 5)

What it received:
- 2026-03-07T20:18:00+01:00 order.placed (shop): {"orderId":"ORD-1237-0100","customerId":"C-0003","placedAt":"2026-03-07T20:18:00+01:00","currency":"EUR","items":[{"sku":"SKU-1011","qty":1},{"sku":"SKU-1004","qty":2},{"sku":"SKU-1008","qty":1},{"sku":"SKU-1016","qty":3}],"channel":"app"}
What the contract found:
- [R5.1] ORD-1237-0100-F1: compensation ["release:SKU-1016"], committed steps need []
What your program did: effects billing.charge×2, carrier.create×2, inventory.release×1, inventory.reserve×3, orders.create×1, orders.setStatus×10; statuses F:completed, F:dispatched, F:failed, F:processing, O:completed, O:processing; notifications -

### ORD-1237-0158 (practice world 1237, difficulty 5)

What it received:
- (no separate inbound message)
What the contract found:
- [R5.1] ORD-1237-0158-F1: compensation ["release:SKU-1006"], committed steps need []
What your program did: effects billing.charge×2, carrier.create×2, inventory.release×1, inventory.reserve×3, orders.create×1, orders.setStatus×10; statuses F:completed, F:dispatched, F:failed, F:processing, O:completed, O:processing; notifications -

## Class 2: 4 orders, contract "failure", rule R5.2

Finding (normalised): ORD-…: set failed without a failure
The contract checks SPEC-E rules R5.2, S13, S14.

### ORD-1237-0062 (practice world 1237, difficulty 5)

What it received:
- (no separate inbound message)
What the contract found:
- [R5.2] ORD-1237-0062-F1: set failed without a failure
What your program did: effects billing.charge×1, carrier.create×1, inventory.release×1, inventory.reserve×2, orders.create×1, orders.setStatus×7; statuses F:completed, F:dispatched, F:failed, F:processing, O:completed, O:processing; notifications -

### ORD-1237-0100 (practice world 1237, difficulty 5)

What it received:
- 2026-03-07T20:18:00+01:00 order.placed (shop): {"orderId":"ORD-1237-0100","customerId":"C-0003","placedAt":"2026-03-07T20:18:00+01:00","currency":"EUR","items":[{"sku":"SKU-1011","qty":1},{"sku":"SKU-1004","qty":2},{"sku":"SKU-1008","qty":1},{"sku":"SKU-1016","qty":3}],"channel":"app"}
What the contract found:
- [R5.2] ORD-1237-0100-F1: set failed without a failure
What your program did: effects billing.charge×2, carrier.create×2, inventory.release×1, inventory.reserve×3, orders.create×1, orders.setStatus×10; statuses F:completed, F:dispatched, F:failed, F:processing, O:completed, O:processing; notifications -

### ORD-1237-0158 (practice world 1237, difficulty 5)

What it received:
- (no separate inbound message)
What the contract found:
- [R5.2] ORD-1237-0158-F1: set failed without a failure
What your program did: effects billing.charge×2, carrier.create×2, inventory.release×1, inventory.reserve×3, orders.create×1, orders.setStatus×10; statuses F:completed, F:dispatched, F:failed, F:processing, O:completed, O:processing; notifications -

## Class 3: 4 orders, contract "reservation", rule R4.2

Finding (normalised): ORD-…: not every item reserved within <n> min of ready
The contract checks SPEC-E rules R4.2.1, R5.1, R6.2, R7.1.

### ORD-1237-0062 (practice world 1237, difficulty 5)

What it received:
- (no separate inbound message)
What the contract found:
- [R4.2] ORD-1237-0062-F1: not every item reserved within 120 min of ready
What your program did: effects billing.charge×1, carrier.create×1, inventory.release×1, inventory.reserve×2, orders.create×1, orders.setStatus×7; statuses F:completed, F:dispatched, F:failed, F:processing, O:completed, O:processing; notifications -

### ORD-1237-0100 (practice world 1237, difficulty 5)

What it received:
- 2026-03-07T20:18:00+01:00 order.placed (shop): {"orderId":"ORD-1237-0100","customerId":"C-0003","placedAt":"2026-03-07T20:18:00+01:00","currency":"EUR","items":[{"sku":"SKU-1011","qty":1},{"sku":"SKU-1004","qty":2},{"sku":"SKU-1008","qty":1},{"sku":"SKU-1016","qty":3}],"channel":"app"}
What the contract found:
- [R4.2] ORD-1237-0100-F1: not every item reserved within 120 min of ready
What your program did: effects billing.charge×2, carrier.create×2, inventory.release×1, inventory.reserve×3, orders.create×1, orders.setStatus×10; statuses F:completed, F:dispatched, F:failed, F:processing, O:completed, O:processing; notifications -

### ORD-1237-0158 (practice world 1237, difficulty 5)

What it received:
- (no separate inbound message)
What the contract found:
- [R4.2] ORD-1237-0158-F1: not every item reserved within 120 min of ready
What your program did: effects billing.charge×2, carrier.create×2, inventory.release×1, inventory.reserve×3, orders.create×1, orders.setStatus×10; statuses F:completed, F:dispatched, F:failed, F:processing, O:completed, O:processing; notifications -
