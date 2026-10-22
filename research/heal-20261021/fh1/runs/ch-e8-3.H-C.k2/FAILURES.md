# Failure report

The platform ran your program on the practice worlds (1235 d2, 1236 d3, 1237 d5; the same worlds `node smoke.mjs` uses) and
checked every completed order against its capability contracts, executable checks written from SPEC-E's rules.
282 of 324 completed orders pass every contract. The failing orders fall into 9 failure classes
(a class = one contract, one rule, one kind of finding). A second run reproduced every failure exactly, so each is a defect in the
program, not chance. Your program is judged on other worlds with other orders: fix the cause, not the example.

## Likely common causes

- Classes 1, 2, 3, 4, 5, 9 fail on the same 36 orders: probably one cause, upstream of the first rule they break.
- Classes 6, 7, 8 fail on the same 6 orders (for 6 of them your program committed no effect at all): probably one cause, upstream of the first rule they break.

## Class 1: 36 orders, contract "failure", rule R5.2

Finding (normalised): ORD-…: set failed without a failure
The contract checks SPEC-E rules R5.2, S13, S14.
Modules whose manifest declares rule R5.2: fulfilment.

### ORD-1237-0150 (practice world 1237, difficulty 5)

What it received:
- 2026-03-10T10:14:00+01:00 order.placed (shop): {"orderId":"ORD-1237-0150","customerId":"C-0039","placedAt":"2026-03-10T10:14:00+01:00","currency":"EUR","items":[{"sku":"SKU-1012","qty":2},{"sku":"SKU-1004","qty":3}],"channel":"app"}
What the contract found:
- [R5.2] ORD-1237-0150-F1: set failed without a failure
What your program did: effects inventory.release×2, inventory.reserve×2, orders.create×1, orders.setStatus×4; statuses F:failed, F:processing, O:failed, O:processing; notifications -

### ORD-1237-0151 (practice world 1237, difficulty 5)

What it received:
- 2026-03-10T10:15:00+01:00 order.placed (shop): {"orderId":"ORD-1237-0151","customerId":"C-0016","placedAt":"2026-03-10T10:15:00+01:00","currency":"EUR","items":[{"sku":"SKU-1025","qty":1},{"sku":"SKU-1007","qty":2}],"channel":"app"}
What the contract found:
- [R5.2] ORD-1237-0151-F1: set failed without a failure
- [R5.2] ORD-1237-0151-F2: set failed without a failure
What your program did: effects inventory.release×2, inventory.reserve×2, orders.create×1, orders.setStatus×6; statuses F:failed, F:processing, O:failed, O:processing; notifications -

### ORD-1237-0152 (practice world 1237, difficulty 5)

What it received:
- 2026-03-10T13:08:00+01:00 order.placed (shop): {"orderId":"ORD-1237-0152","customerId":"C-0018","placedAt":"2026-03-10T13:08:00+01:00","currency":"EUR","items":[{"sku":"SKU-1028","qty":2}],"channel":"app"}
- 2026-03-10T13:36:00+01:00 customer.action (customer-portal): {"orderRef":"#ORD-1237-0152","action":"cancel","from":"c0018@hollin-shop.example"}
What the contract found:
- [R5.2] ORD-1237-0152-F1: set failed without a failure
What your program did: effects inventory.release×1, inventory.reserve×1, orders.create×1, orders.setStatus×4; statuses F:failed, F:processing, O:failed, O:processing; notifications -

## Class 2: 35 orders, contract "capture", rule R4.2

Finding (normalised): ORD-…: not charged within <n> min of its reservation
The contract checks SPEC-E rules R4.2.2, §1 Keys, R5.2, R6.2.
Modules whose manifest declares rule R4.2: fulfilment.

### ORD-1237-0150 (practice world 1237, difficulty 5)

What it received:
- 2026-03-10T10:14:00+01:00 order.placed (shop): {"orderId":"ORD-1237-0150","customerId":"C-0039","placedAt":"2026-03-10T10:14:00+01:00","currency":"EUR","items":[{"sku":"SKU-1012","qty":2},{"sku":"SKU-1004","qty":3}],"channel":"app"}
What the contract found:
- [R4.2] ORD-1237-0150-F1: not charged within 120 min of its reservation
What your program did: effects inventory.release×2, inventory.reserve×2, orders.create×1, orders.setStatus×4; statuses F:failed, F:processing, O:failed, O:processing; notifications -

### ORD-1237-0151 (practice world 1237, difficulty 5)

What it received:
- 2026-03-10T10:15:00+01:00 order.placed (shop): {"orderId":"ORD-1237-0151","customerId":"C-0016","placedAt":"2026-03-10T10:15:00+01:00","currency":"EUR","items":[{"sku":"SKU-1025","qty":1},{"sku":"SKU-1007","qty":2}],"channel":"app"}
What the contract found:
- [R4.2] ORD-1237-0151-F1: not charged within 120 min of its reservation
- [R4.2] ORD-1237-0151-F2: not charged within 120 min of its reservation
What your program did: effects inventory.release×2, inventory.reserve×2, orders.create×1, orders.setStatus×6; statuses F:failed, F:processing, O:failed, O:processing; notifications -

### ORD-1237-0153 (practice world 1237, difficulty 5)

What it received:
- 2026-03-10T13:59:00+01:00 order.placed (shop): {"orderId":"ORD-1237-0153","customerId":"C-0020","placedAt":"2026-03-10T13:59:00+01:00","currency":"EUR","items":[{"sku":"SKU-1010","qty":3},{"sku":"SKU-1028","qty":1},{"sku":"SKU-1018","qty":1},{"sku":"SKU-1007","qty":1}],"channel":"app"}
What the contract found:
- [R4.2] ORD-1237-0153-F1: not charged within 120 min of its reservation
- [R4.2] ORD-1237-0153-F2: not charged within 120 min of its reservation
- [R4.2] ORD-1237-0153-F3: not charged within 120 min of its reservation
What your program did: effects inventory.release×4, inventory.reserve×4, orders.create×1, orders.setStatus×10; statuses F:failed, F:processing, O:failed, O:processing; notifications -

## Class 3: 29 orders, contract "compensation", rule R5.1

Finding (normalised): ORD-…: compensation ["release:SKU-<n>"], committed steps need []
The contract checks SPEC-E rules R5.1, R5.2, R6.2, S2, S14.
Modules whose manifest declares rule R5.1: fulfilment.

### ORD-1237-0151 (practice world 1237, difficulty 5)

What it received:
- 2026-03-10T10:15:00+01:00 order.placed (shop): {"orderId":"ORD-1237-0151","customerId":"C-0016","placedAt":"2026-03-10T10:15:00+01:00","currency":"EUR","items":[{"sku":"SKU-1025","qty":1},{"sku":"SKU-1007","qty":2}],"channel":"app"}
What the contract found:
- [R5.1] ORD-1237-0151-F1: compensation ["release:SKU-1025"], committed steps need []
- [R5.1] ORD-1237-0151-F2: compensation ["release:SKU-1007"], committed steps need []
What your program did: effects inventory.release×2, inventory.reserve×2, orders.create×1, orders.setStatus×6; statuses F:failed, F:processing, O:failed, O:processing; notifications -

### ORD-1237-0152 (practice world 1237, difficulty 5)

What it received:
- 2026-03-10T13:08:00+01:00 order.placed (shop): {"orderId":"ORD-1237-0152","customerId":"C-0018","placedAt":"2026-03-10T13:08:00+01:00","currency":"EUR","items":[{"sku":"SKU-1028","qty":2}],"channel":"app"}
- 2026-03-10T13:36:00+01:00 customer.action (customer-portal): {"orderRef":"#ORD-1237-0152","action":"cancel","from":"c0018@hollin-shop.example"}
What the contract found:
- [R5.1] ORD-1237-0152-F1: compensation ["release:SKU-1028"], committed steps need []
What your program did: effects inventory.release×1, inventory.reserve×1, orders.create×1, orders.setStatus×4; statuses F:failed, F:processing, O:failed, O:processing; notifications -

### ORD-1237-0153 (practice world 1237, difficulty 5)

What it received:
- 2026-03-10T13:59:00+01:00 order.placed (shop): {"orderId":"ORD-1237-0153","customerId":"C-0020","placedAt":"2026-03-10T13:59:00+01:00","currency":"EUR","items":[{"sku":"SKU-1010","qty":3},{"sku":"SKU-1028","qty":1},{"sku":"SKU-1018","qty":1},{"sku":"SKU-1007","qty":1}],"channel":"app"}
What the contract found:
- [R5.1] ORD-1237-0153-F1: compensation ["release:SKU-1018"], committed steps need []
- [R5.1] ORD-1237-0153-F2: compensation ["release:SKU-1010"], committed steps need []
- [R5.1] ORD-1237-0153-F3: compensation ["release:SKU-1028"], committed steps need []
What your program did: effects inventory.release×4, inventory.reserve×4, orders.create×1, orders.setStatus×10; statuses F:failed, F:processing, O:failed, O:processing; notifications -

## Class 4: 6 orders, contract "cancellation", rule R6.2

Finding (normalised): counted cancel did not cancel the order
The contract checks SPEC-E rules R6.1, R6.2, R6.3, S4, S6, S7, S10, S13, S15.
Modules whose manifest declares rule R6.2: orderflow.

### ORD-1237-0152 (practice world 1237, difficulty 5)

What it received:
- 2026-03-10T13:08:00+01:00 order.placed (shop): {"orderId":"ORD-1237-0152","customerId":"C-0018","placedAt":"2026-03-10T13:08:00+01:00","currency":"EUR","items":[{"sku":"SKU-1028","qty":2}],"channel":"app"}
- 2026-03-10T13:36:00+01:00 customer.action (customer-portal): {"orderRef":"#ORD-1237-0152","action":"cancel","from":"c0018@hollin-shop.example"}
What the contract found:
- [R6.2] counted cancel did not cancel the order
What your program did: effects inventory.release×1, inventory.reserve×1, orders.create×1, orders.setStatus×4; statuses F:failed, F:processing, O:failed, O:processing; notifications -

### ORD-1237-0163 (practice world 1237, difficulty 5)

What it received:
- 2026-03-11T04:02:00+01:00 order.placed (shop): {"orderId":"ORD-1237-0163","customerId":"C-0005","placedAt":"2026-03-11T04:02:00+01:00","currency":"EUR","items":[{"sku":"SKU-1006","qty":2},{"sku":"SKU-1013","qty":2},{"sku":"SKU-1002","qty":2}],"channel":"app"}
- 2026-03-12T13:53:00+01:00 customer.action (customer-portal): {"orderRef":"ORD-1237-0163","action":"cancel","from":"c0005@hollin-shop.example"}
What the contract found:
- [R6.2] counted cancel did not cancel the order
What your program did: effects inventory.release×3, inventory.reserve×3, orders.create×1, orders.setStatus×8; statuses F:failed, F:processing, O:failed, O:processing; notifications -

### ORD-1237-0170 (practice world 1237, difficulty 5)

What it received:
- 2026-03-11T19:18:00+01:00 order.placed (shop): {"orderId":"ORD-1237-0170","customerId":"C-0026","placedAt":"2026-03-11T19:18:00+01:00","currency":"EUR","items":[{"sku":"SKU-1029","qty":3},{"sku":"SKU-1001","qty":3}],"channel":"app"}
- 2026-03-12T23:13:00+01:00 customer.action (customer-portal): {"orderRef":"#ORD-1237-0170","action":"cancel","from":"c0026@hollin-shop.example"}
What the contract found:
- [R6.2] counted cancel did not cancel the order
What your program did: effects inventory.release×2, inventory.reserve×2, orders.create×1, orders.setStatus×6; statuses F:failed, F:processing, O:failed, O:processing; notifications -

## Class 5: 6 orders, contract "compensation", rule R5.1

Finding (normalised): ORD-…: compensation ["release:SKU-<n>","release:SKU-<n>"], committed steps need []
The contract checks SPEC-E rules R5.1, R5.2, R6.2, S2, S14.
Modules whose manifest declares rule R5.1: fulfilment.

### ORD-1237-0150 (practice world 1237, difficulty 5)

What it received:
- 2026-03-10T10:14:00+01:00 order.placed (shop): {"orderId":"ORD-1237-0150","customerId":"C-0039","placedAt":"2026-03-10T10:14:00+01:00","currency":"EUR","items":[{"sku":"SKU-1012","qty":2},{"sku":"SKU-1004","qty":3}],"channel":"app"}
What the contract found:
- [R5.1] ORD-1237-0150-F1: compensation ["release:SKU-1004","release:SKU-1012"], committed steps need []
What your program did: effects inventory.release×2, inventory.reserve×2, orders.create×1, orders.setStatus×4; statuses F:failed, F:processing, O:failed, O:processing; notifications -

### ORD-1237-0158 (practice world 1237, difficulty 5)

What it received:
- (no separate inbound message)
What the contract found:
- [R5.1] ORD-1237-0158-F1: compensation ["release:SKU-1003","release:SKU-1006"], committed steps need []
- [R5.1] ORD-1237-0158-F2: compensation ["release:SKU-1018"], committed steps need []
- [R5.1] ORD-1237-0158-F3: compensation ["release:SKU-1021"], committed steps need []
What your program did: effects inventory.release×4, inventory.reserve×4, orders.create×1, orders.setStatus×8; statuses F:failed, F:processing, O:failed, O:processing; notifications -

### ORD-1237-0175 (practice world 1237, difficulty 5)

What it received:
- 2026-03-12T03:06:00+01:00 order.placed (shop): {"orderId":"ORD-1237-0175","customerId":"C-0004","placedAt":"2026-03-12T03:06:00+01:00","currency":"EUR","items":[{"sku":"SKU-1005","qty":1},{"sku":"SKU-1027","qty":1}],"channel":"web"}
What the contract found:
- [R5.1] ORD-1237-0175-F1: compensation ["release:SKU-1005","release:SKU-1027"], committed steps need []
What your program did: effects inventory.release×2, inventory.reserve×2, orders.create×1, orders.setStatus×4; statuses F:failed, F:processing, O:failed, O:processing; notifications -

## Class 6: 6 orders, contract "intake", rule R1.1

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

## Class 7: 6 orders, contract "reservation", rule R4.2

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

## Class 8: 6 orders, contract "tracking", rule R4.1

Finding (normalised): order never set processing
The contract checks SPEC-E rules R4.1, R4.4, R4.5, R7.2.
Modules whose manifest declares rule R4.1: orderflow.

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

(1 smaller classes are not shown; `node smoke.mjs` lists every failing contract.)