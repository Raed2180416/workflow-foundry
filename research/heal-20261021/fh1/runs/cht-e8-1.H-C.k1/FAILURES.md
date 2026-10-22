# Failure report

The platform ran your program on the practice worlds (1235 d2, 1236 d3, 1237 d5; the same worlds `node smoke.mjs` uses) and
checked every completed order against its capability contracts, executable checks written from SPEC-E's rules.
317 of 324 completed orders pass every contract. The failing orders fall into 4 failure classes
(a class = one contract, one rule, one kind of finding). A second run reproduced every failure exactly, so each is a defect in the
program, not chance. Your program is judged on other worlds with other orders: fix the cause, not the example.

## Likely common causes

- Classes 1, 2, 3 fail on the same 6 orders (for 6 of them your program committed no effect at all): probably one cause, upstream of the first rule they break.

## Class 1: 6 orders, contract "intake", rule R1.1

Finding (normalised): order never recorded
The contract checks SPEC-E rules R1.1, R1.2, R1.3, R1.4, §3.1, §3.5.
Modules whose manifest declares rule R1.1: intake.

### ORD-1235-0001 (practice world 1235, difficulty 2)

What it received:
- (no separate inbound message)
- in the go-live migration export delivered at the start: {"records":{},"events":[{"id":"ev-ORD-1235-0001","type":"order.placed","at":"2026-03-01T23:29:00+01:00","source":"shop","payload":{"orderId":"ORD-1235-0001","customerId":"C-0002","placedAt":"2026-03-01T23:29:00+01:00","currency":"EUR","items":[{"sku":"SKU-1030","qty":3},{"sku":"SKU-1018","qty":1}],"channel":"web"}}]}
What the contract found:
- [R1.1] order never recorded
What your program did: nothing at all (no committed effect for this order)

### ORD-1236-0001 (practice world 1236, difficulty 3)

What it received:
- (no separate inbound message)
- in the go-live migration export delivered at the start: {"records":{},"events":[{"id":"ev-ORD-1236-0001","type":"order.placed","at":"2026-03-01T23:36:00+01:00","source":"shop","payload":{"orderId":" ord-1236-0001","customerId":"C-0001","placedAt":"2026-03-01T23:36:00+01:00","currency":"EUR","items":[{"sku":"SKU-1024","qty":2},{"sku":"SKU-1014","qty":1},{"sku":"SKU-1002","qty":2}],"channel":"app"}}]}
What the contract found:
- [R1.1] order never recorded
What your program did: nothing at all (no committed effect for this order)

### ORD-1237-0001 (practice world 1237, difficulty 5)

What it received:
- (no separate inbound message)
- in the go-live migration export delivered at the start: {"records":{},"events":[{"id":"ev-ORD-1237-0001","type":"order.placed","at":"2026-03-01T23:39:00+01:00","source":"shop","payload":{"orderId":" ord-1237-0001","customerId":"C-0022","placedAt":"2026-03-01T23:39:00+01:00","currency":"EUR","items":[{"sku":"SKU-1003","qty":1}],"channel":"app"}}]}
What the contract found:
- [R1.1] order never recorded
What your program did: nothing at all (no committed effect for this order)

## Class 2: 6 orders, contract "reservation", rule R4.2

Finding (normalised): ORD-…: not every item reserved within <n> min of ready
The contract checks SPEC-E rules R4.2.1, R5.1, R6.2, R7.1.
Modules whose manifest declares rule R4.2: fulfilment.

### ORD-1235-0001 (practice world 1235, difficulty 2)

What it received:
- (no separate inbound message)
- in the go-live migration export delivered at the start: {"records":{},"events":[{"id":"ev-ORD-1235-0001","type":"order.placed","at":"2026-03-01T23:29:00+01:00","source":"shop","payload":{"orderId":"ORD-1235-0001","customerId":"C-0002","placedAt":"2026-03-01T23:29:00+01:00","currency":"EUR","items":[{"sku":"SKU-1030","qty":3},{"sku":"SKU-1018","qty":1}],"channel":"web"}}]}
What the contract found:
- [R4.2] ORD-1235-0001-F1: not every item reserved within 120 min of ready
- [R4.2] ORD-1235-0001-F2: not every item reserved within 120 min of ready
What your program did: nothing at all (no committed effect for this order)

### ORD-1236-0001 (practice world 1236, difficulty 3)

What it received:
- (no separate inbound message)
- in the go-live migration export delivered at the start: {"records":{},"events":[{"id":"ev-ORD-1236-0001","type":"order.placed","at":"2026-03-01T23:36:00+01:00","source":"shop","payload":{"orderId":" ord-1236-0001","customerId":"C-0001","placedAt":"2026-03-01T23:36:00+01:00","currency":"EUR","items":[{"sku":"SKU-1024","qty":2},{"sku":"SKU-1014","qty":1},{"sku":"SKU-1002","qty":2}],"channel":"app"}}]}
What the contract found:
- [R4.2] ORD-1236-0001-F1: not every item reserved within 120 min of ready
- [R4.2] ORD-1236-0001-F2: not every item reserved within 120 min of ready
What your program did: nothing at all (no committed effect for this order)

### ORD-1237-0001 (practice world 1237, difficulty 5)

What it received:
- (no separate inbound message)
- in the go-live migration export delivered at the start: {"records":{},"events":[{"id":"ev-ORD-1237-0001","type":"order.placed","at":"2026-03-01T23:39:00+01:00","source":"shop","payload":{"orderId":" ord-1237-0001","customerId":"C-0022","placedAt":"2026-03-01T23:39:00+01:00","currency":"EUR","items":[{"sku":"SKU-1003","qty":1}],"channel":"app"}}]}
What the contract found:
- [R4.2] ORD-1237-0001-F1: not every item reserved within 120 min of ready
What your program did: nothing at all (no committed effect for this order)

## Class 3: 6 orders, contract "tracking", rule R4.1

Finding (normalised): order never set processing
The contract checks SPEC-E rules R4.1, R4.4, R4.5, R7.2.
Modules whose manifest declares rule R4.1: order-progress.

### ORD-1235-0001 (practice world 1235, difficulty 2)

What it received:
- (no separate inbound message)
- in the go-live migration export delivered at the start: {"records":{},"events":[{"id":"ev-ORD-1235-0001","type":"order.placed","at":"2026-03-01T23:29:00+01:00","source":"shop","payload":{"orderId":"ORD-1235-0001","customerId":"C-0002","placedAt":"2026-03-01T23:29:00+01:00","currency":"EUR","items":[{"sku":"SKU-1030","qty":3},{"sku":"SKU-1018","qty":1}],"channel":"web"}}]}
What the contract found:
- [R4.1] order never set processing
What your program did: nothing at all (no committed effect for this order)

### ORD-1236-0001 (practice world 1236, difficulty 3)

What it received:
- (no separate inbound message)
- in the go-live migration export delivered at the start: {"records":{},"events":[{"id":"ev-ORD-1236-0001","type":"order.placed","at":"2026-03-01T23:36:00+01:00","source":"shop","payload":{"orderId":" ord-1236-0001","customerId":"C-0001","placedAt":"2026-03-01T23:36:00+01:00","currency":"EUR","items":[{"sku":"SKU-1024","qty":2},{"sku":"SKU-1014","qty":1},{"sku":"SKU-1002","qty":2}],"channel":"app"}}]}
What the contract found:
- [R4.1] order never set processing
What your program did: nothing at all (no committed effect for this order)

### ORD-1237-0001 (practice world 1237, difficulty 5)

What it received:
- (no separate inbound message)
- in the go-live migration export delivered at the start: {"records":{},"events":[{"id":"ev-ORD-1237-0001","type":"order.placed","at":"2026-03-01T23:39:00+01:00","source":"shop","payload":{"orderId":" ord-1237-0001","customerId":"C-0022","placedAt":"2026-03-01T23:39:00+01:00","currency":"EUR","items":[{"sku":"SKU-1003","qty":1}],"channel":"app"}}]}
What the contract found:
- [R4.1] order never set processing
What your program did: nothing at all (no committed effect for this order)

## Class 4: 1 order, contract "compensation", rule R5.1

Finding (normalised): ORD-…: charge undone before ship (not reverse order)
The contract checks SPEC-E rules R5.1, R5.2, R6.2, S2, S14.
Modules whose manifest declares rule R5.1: fulfilment.

### ORD-1237-0093 (practice world 1237, difficulty 5)

What it received:
- 2026-03-07T10:36:00+01:00 order.placed (shop): {"orderId":"ORD-1237-0093","customerId":"C-0031","placedAt":"2026-03-07T10:36:00+01:00","currency":"EUR","items":[{"sku":"SKU-1004","qty":1},{"sku":"SKU-1023","qty":1},{"sku":"SKU-1021","qty":1}],"channel":"app"}
- 2026-03-07T10:41:00+01:00 customer.action (customer-portal): {"orderRef":"ORD-1237-0093","action":"cancel","from":"c0031@hollin-shop.example"}
- 2026-03-07T11:14:00+01:00 order.placed (shop): {"orderId":"ORD-1237-0093","customerId":"C-0031","placedAt":"2026-03-07T10:36:00+01:00","currency":"EUR","items":[{"sku":"SKU-1004","qty":1},{"sku":"SKU-1023","qty":1},{"sku":"SKU-1021","qty":1}],"channel":"app"}
What the contract found:
- [R5.1] ORD-1237-0093-F1: charge undone before ship (not reverse order)
- [R5.1] ORD-1237-0093-F2: charge undone before ship (not reverse order)
- [R5.1] ORD-1237-0093-F3: charge undone before ship (not reverse order)
What your program did: effects billing.charge×3, billing.refund×3, carrier.cancel×3, carrier.create×3, inventory.release×3, inventory.reserve×3, orders.create×1, orders.setStatus×8; statuses F:cancelled, F:processing, O:cancelled, O:processing; notifications -
