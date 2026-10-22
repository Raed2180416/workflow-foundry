# Failure report

The platform ran your program on the practice worlds (1235 d2, 1236 d3, 1237 d5; the same worlds `node smoke.mjs` uses) and
checked every completed order against its capability contracts, executable checks written from SPEC-E's rules.
290 of 324 completed orders pass every contract. The failing orders fall into 11 failure classes
(a class = one contract, one rule, one kind of finding). A second run reproduced every failure exactly, so each is a defect in the
program, not chance. Your program is judged on other worlds with other orders: fix the cause, not the example.

## Likely common causes

- Classes 1, 2, 3, 11 fail on the same 18 orders: probably one cause, upstream of the first rule they break.
- Classes 4, 5, 6, 8 fail on the same 8 orders (for 8 of them your program committed no effect at all): probably one cause, upstream of the first rule they break.

## Class 1: 18 orders, contract "refund", rule R5.1

Finding (normalised): ORD-…: captured money not refunded
The contract checks SPEC-E rules R5.1, R5.2, R6.2, R7.1.
Modules whose manifest declares rule R5.1: fulfilment.

### ORD-1235-0017 (practice world 1235, difficulty 2)

What it received:
- 2026-03-05T14:50:00+01:00 order.placed (shop): {"orderId":"ORD-1235-0017","customerId":"C-0031","placedAt":"2026-03-05T14:50:00+01:00","currency":"EUR","items":[{"sku":"SKU-1023","qty":1},{"sku":"SKU-1017","qty":3}],"channel":"web"}
- 2026-03-05T15:20:00+01:00 customer.action (customer-portal): {"orderRef":"ORD-1235-0017","action":"cancel","from":"c0031@hollin-shop.example"}
What the contract found:
- [R5.1] ORD-1235-0017-F1: captured money not refunded
- [R5.1] ORD-1235-0017-F2: captured money not refunded
What your program did: effects billing.charge×2, carrier.cancel×2, carrier.create×2, inventory.reserve×2, orders.create×1, orders.setStatus×6; statuses F:cancelled, F:processing, O:cancelled, O:processing; notifications -

### ORD-1236-0013 (practice world 1236, difficulty 3)

What it received:
- 2026-03-03T16:45:00+01:00 order.placed (shop): {"orderId":"ORD-1236-0013","customerId":"C-0007","placedAt":"2026-03-03T16:45:00+01:00","currency":"EUR","items":[{"sku":"SKU-1007","qty":3},{"sku":"SKU-1010","qty":1},{"sku":"SKU-1004","qty":3},{"sku":"SKU-1011","qty":1}],"channel":"app"}
- 2026-03-03T21:43:00+01:00 customer.action (customer-portal): {"orderRef":"ORD-1236-0013","action":"cancel","from":"c0007@hollin-shop.example"}
What the contract found:
- [R5.1] ORD-1236-0013-F1: captured money not refunded
- [R5.1] ORD-1236-0013-F2: captured money not refunded
What your program did: effects billing.charge×2, carrier.cancel×2, carrier.create×2, inventory.reserve×4, orders.create×1, orders.setStatus×6; statuses F:cancelled, F:processing, O:cancelled, O:processing; notifications -

### ORD-1237-0037 (practice world 1237, difficulty 5)

What it received:
- 2026-03-03T18:27:00+01:00 order.placed (shop): {"orderId":"ORD-1237-0037","customerId":"C-0018","placedAt":"2026-03-03T18:27:00+01:00","currency":"EUR","items":[{"sku":"SKU-1001","qty":2}],"channel":"web"}
- 2026-03-04T02:51:00+01:00 customer.action (customer-portal): {"orderRef":"ORD-1237-0037","action":"cancel","from":"c0018@hollin-shop.example"}
What the contract found:
- [R5.1] ORD-1237-0037-F1: captured money not refunded
What your program did: effects billing.charge×1, carrier.cancel×1, carrier.create×1, inventory.reserve×1, orders.create×1, orders.setStatus×4; statuses F:cancelled, F:processing, O:cancelled, O:processing; notifications -

## Class 2: 18 orders, contract "reservation", rule R5.1

Finding (normalised): ORD-…/SKU-<n>: reservation not released
The contract checks SPEC-E rules R4.2.1, R5.1, R6.2, R7.1.
Modules whose manifest declares rule R5.1: fulfilment.

### ORD-1235-0017 (practice world 1235, difficulty 2)

What it received:
- 2026-03-05T14:50:00+01:00 order.placed (shop): {"orderId":"ORD-1235-0017","customerId":"C-0031","placedAt":"2026-03-05T14:50:00+01:00","currency":"EUR","items":[{"sku":"SKU-1023","qty":1},{"sku":"SKU-1017","qty":3}],"channel":"web"}
- 2026-03-05T15:20:00+01:00 customer.action (customer-portal): {"orderRef":"ORD-1235-0017","action":"cancel","from":"c0031@hollin-shop.example"}
What the contract found:
- [R5.1] ORD-1235-0017-F1/SKU-1017: reservation not released
- [R5.1] ORD-1235-0017-F2/SKU-1023: reservation not released
What your program did: effects billing.charge×2, carrier.cancel×2, carrier.create×2, inventory.reserve×2, orders.create×1, orders.setStatus×6; statuses F:cancelled, F:processing, O:cancelled, O:processing; notifications -

### ORD-1236-0013 (practice world 1236, difficulty 3)

What it received:
- 2026-03-03T16:45:00+01:00 order.placed (shop): {"orderId":"ORD-1236-0013","customerId":"C-0007","placedAt":"2026-03-03T16:45:00+01:00","currency":"EUR","items":[{"sku":"SKU-1007","qty":3},{"sku":"SKU-1010","qty":1},{"sku":"SKU-1004","qty":3},{"sku":"SKU-1011","qty":1}],"channel":"app"}
- 2026-03-03T21:43:00+01:00 customer.action (customer-portal): {"orderRef":"ORD-1236-0013","action":"cancel","from":"c0007@hollin-shop.example"}
What the contract found:
- [R5.1] ORD-1236-0013-F1/SKU-1010: reservation not released
- [R5.1] ORD-1236-0013-F1/SKU-1004: reservation not released
- [R5.1] ORD-1236-0013-F2/SKU-1007: reservation not released
What your program did: effects billing.charge×2, carrier.cancel×2, carrier.create×2, inventory.reserve×4, orders.create×1, orders.setStatus×6; statuses F:cancelled, F:processing, O:cancelled, O:processing; notifications -

### ORD-1237-0037 (practice world 1237, difficulty 5)

What it received:
- 2026-03-03T18:27:00+01:00 order.placed (shop): {"orderId":"ORD-1237-0037","customerId":"C-0018","placedAt":"2026-03-03T18:27:00+01:00","currency":"EUR","items":[{"sku":"SKU-1001","qty":2}],"channel":"web"}
- 2026-03-04T02:51:00+01:00 customer.action (customer-portal): {"orderRef":"ORD-1237-0037","action":"cancel","from":"c0018@hollin-shop.example"}
What the contract found:
- [R5.1] ORD-1237-0037-F1/SKU-1001: reservation not released
What your program did: effects billing.charge×1, carrier.cancel×1, carrier.create×1, inventory.reserve×1, orders.create×1, orders.setStatus×4; statuses F:cancelled, F:processing, O:cancelled, O:processing; notifications -

## Class 3: 17 orders, contract "compensation", rule R5.1

Finding (normalised): ORD-…: compensation ["cancel"], committed steps need ["cancel","refund","release:SKU-<n>"]
The contract checks SPEC-E rules R5.1, R5.2, R6.2, S2, S14.
Modules whose manifest declares rule R5.1: fulfilment.

### ORD-1235-0017 (practice world 1235, difficulty 2)

What it received:
- 2026-03-05T14:50:00+01:00 order.placed (shop): {"orderId":"ORD-1235-0017","customerId":"C-0031","placedAt":"2026-03-05T14:50:00+01:00","currency":"EUR","items":[{"sku":"SKU-1023","qty":1},{"sku":"SKU-1017","qty":3}],"channel":"web"}
- 2026-03-05T15:20:00+01:00 customer.action (customer-portal): {"orderRef":"ORD-1235-0017","action":"cancel","from":"c0031@hollin-shop.example"}
What the contract found:
- [R5.1] ORD-1235-0017-F1: compensation ["cancel"], committed steps need ["cancel","refund","release:SKU-1017"]
- [R5.1] ORD-1235-0017-F2: compensation ["cancel"], committed steps need ["cancel","refund","release:SKU-1023"]
What your program did: effects billing.charge×2, carrier.cancel×2, carrier.create×2, inventory.reserve×2, orders.create×1, orders.setStatus×6; statuses F:cancelled, F:processing, O:cancelled, O:processing; notifications -

### ORD-1236-0026 (practice world 1236, difficulty 3)

What it received:
- 2026-03-05T18:27:00+01:00 order.placed (shop): {"orderId":"ORD-1236-0026","customerId":"C-0029","placedAt":"2026-03-05T18:27:00+01:00","currency":"EUR","items":[{"sku":"SKU-1014","qty":1}],"channel":"web"}
- 2026-03-05T19:39:00+01:00 order.placed (shop): {"orderId":"ORD-1236-0026","customerId":"C-0029","placedAt":"2026-03-05T18:27:00+01:00","currency":"EUR","items":[{"sku":"SKU-1014","qty":1}],"channel":"web"}
- 2026-03-06T02:40:00+01:00 customer.action (customer-portal): {"orderRef":"ORD-1236-0026","action":"cancel","from":"c0029@hollin-shop.example"}
What the contract found:
- [R5.1] ORD-1236-0026-F1: compensation ["cancel"], committed steps need ["cancel","refund","release:SKU-1014"]
What your program did: effects billing.charge×1, carrier.cancel×1, carrier.create×1, inventory.reserve×1, orders.create×1, orders.setStatus×4; statuses F:cancelled, F:processing, O:cancelled, O:processing; notifications -

### ORD-1237-0037 (practice world 1237, difficulty 5)

What it received:
- 2026-03-03T18:27:00+01:00 order.placed (shop): {"orderId":"ORD-1237-0037","customerId":"C-0018","placedAt":"2026-03-03T18:27:00+01:00","currency":"EUR","items":[{"sku":"SKU-1001","qty":2}],"channel":"web"}
- 2026-03-04T02:51:00+01:00 customer.action (customer-portal): {"orderRef":"ORD-1237-0037","action":"cancel","from":"c0018@hollin-shop.example"}
What the contract found:
- [R5.1] ORD-1237-0037-F1: compensation ["cancel"], committed steps need ["cancel","refund","release:SKU-1001"]
What your program did: effects billing.charge×1, carrier.cancel×1, carrier.create×1, inventory.reserve×1, orders.create×1, orders.setStatus×4; statuses F:cancelled, F:processing, O:cancelled, O:processing; notifications -

## Class 4: 8 orders, contract "reservation", rule R4.2

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

## Class 5: 6 orders, contract "intake", rule R1.1

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

## Class 6: 6 orders, contract "tracking", rule R4.1

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

## Class 7: 4 orders, contract "tracking", rule R4.4

Finding (normalised): ORD-…: never completed after delivery
The contract checks SPEC-E rules R4.1, R4.4, R4.5, R7.2.
Modules whose manifest declares rule R4.4: fulfilment.

### ORD-1235-0003 (practice world 1235, difficulty 2)

What it received:
- 2026-03-02T05:57:00+01:00 carrier.status (carrier): {"carrier":"PARCELLA","code":"DELIVERED","shipmentId":"SHP-GL-003","fulfilmentRef":"ORD-1235-0003-F1","reportedAt":"2026-03-02T05:57:00+01:00"}
- in the go-live migration export delivered at the start: {"records":{"orders.orders":[{"orderId":"ORD-1235-0003","customerId":"C-0004","status":"processing","placedAt":"2026-02-27T11:13:00+01:00","currency":"EUR","items":[{"sku":"SKU-1007","qty":1},{"sku":"SKU-1010","qty":2}],"totalMinor":37347}],"orders.fulfilments":[{"fulfilmentId":"ORD-1235-0003-F1","orderId":"ORD-1235-0003","location":"WH-EIN","items":[{"sku":"SKU-1007","qty":1},{"sku":"SKU-1010","qty":2}],"amountMinor":37347,"status":"dispatched"}],"inventory.reservations":[{"reservationId":"RSV-
What the contract found:
- [R4.4] ORD-1235-0003-F1: never completed after delivery
- [R4.5] order outcome processing, expected completed
What your program did: nothing at all (no committed effect for this order)

### ORD-1236-0003 (practice world 1236, difficulty 3)

What it received:
- 2026-03-02T21:39:00+01:00 carrier.status (carrier): {"carrier":"PARCELLA","code":"DELIVERED","shipmentId":"SHP-GL-003","fulfilmentRef":"ORD-1236-0003-F1","reportedAt":"2026-03-02T21:39:00+01:00"}
- in the go-live migration export delivered at the start: {"records":{"orders.orders":[{"orderId":"ORD-1236-0003","customerId":"C-0010","status":"processing","placedAt":"2026-02-27T14:31:00+01:00","currency":"EUR","items":[{"sku":"SKU-1007","qty":1},{"sku":"SKU-1014","qty":1},{"sku":"SKU-1009","qty":3},{"sku":"SKU-1030","qty":1}],"totalMinor":104189}],"orders.fulfilments":[{"fulfilmentId":"ORD-1236-0003-F1","orderId":"ORD-1236-0003","location":"WH-AMS","items":[{"sku":"SKU-1007","qty":1},{"sku":"SKU-1014","qty":1},{"sku":"SKU-1009","qty":3},{"sku":"SKU
What the contract found:
- [R4.4] ORD-1236-0003-F1: never completed after delivery
- [R4.5] order outcome processing, expected completed
What your program did: nothing at all (no committed effect for this order)

### ORD-1237-0003 (practice world 1237, difficulty 5)

What it received:
- 2026-03-03T02:02:00+01:00 carrier.status (carrier): {"carrier":"VELOX","code":"DL","shipmentId":"SHP-GL-003","fulfilmentRef":"ORD-1237-0003-F1","reportedAt":"2026-03-03T02:02:00+01:00"}
- 2026-03-03T03:46:00+01:00 carrier.status (carrier): {"carrier":"VELOX","code":"DL","shipmentId":"SHP-GL-003","fulfilmentRef":"ORD-1237-0003-F1","reportedAt":"2026-03-03T02:02:00+01:00"}
- in the go-live migration export delivered at the start: {"records":{"orders.orders":[{"orderId":"ORD-1237-0003","customerId":"C-0037","status":"processing","placedAt":"2026-02-27T16:58:00+01:00","currency":"EUR","items":[{"sku":"SKU-1014","qty":2},{"sku":"SKU-1028","qty":3}],"totalMinor":69890}],"orders.fulfilments":[{"fulfilmentId":"ORD-1237-0003-F1","orderId":"ORD-1237-0003","location":"WH-RTM","items":[{"sku":"SKU-1014","qty":2},{"sku":"SKU-1028","qty":3}],"amountMinor":69890,"status":"dispatched"}],"inventory.reservations":[{"reservationId":"RSV-
What the contract found:
- [R4.4] ORD-1237-0003-F1: never completed after delivery
- [R4.5] order outcome processing, expected completed
What your program did: nothing at all (no committed effect for this order)

## Class 8: 2 orders, contract "customer-action", rule R3.2

Finding (normalised): ORD-…: unavailable fulfilment not cancelled after the amend
The contract checks SPEC-E rules R3.1, R3.2, S1, S5, S9, S11.
Modules whose manifest declares rule R3.2: customer-action.

### ORD-1236-0002 (practice world 1236, difficulty 3)

What it received:
- 2026-03-02T01:05:00+01:00 customer.action (customer-portal): {"orderRef":"ORD-1236-0002","action":"amend","from":"c0022@hollin-shop.example"}
- in the go-live migration export delivered at the start: {"records":{"orders.orders":[{"orderId":"ORD-1236-0002","customerId":"C-0022","status":"customerActionRequired","placedAt":"2026-03-01T22:44:00+01:00","currency":"EUR","items":[{"sku":"SKU-1013","qty":1},{"sku":"SKU-1021","qty":1}],"totalMinor":30493}],"orders.fulfilments":[{"fulfilmentId":"ORD-1236-0002-F1","orderId":"ORD-1236-0002","location":"WH-RTM","items":[{"sku":"SKU-1021","qty":1}],"amountMinor":9094,"status":"pending"},{"fulfilmentId":"ORD-1236-0002-F2","orderId":"ORD-1236-0002","locati
What the contract found:
- [R3.2] ORD-1236-0002-F2: unavailable fulfilment not cancelled after the amend
What your program did: nothing at all (no committed effect for this order)

### ORD-1237-0002 (practice world 1237, difficulty 5)

What it received:
- 2026-03-02T01:00:00+01:00 customer.action (customer-portal): {"orderRef":"ORD-1237-0002","action":"amend","from":"c0027@hollin-shop.example"}
- in the go-live migration export delivered at the start: {"records":{"orders.orders":[{"orderId":"ORD-1237-0002","customerId":"C-0027","status":"customerActionRequired","placedAt":"2026-03-01T21:48:00+01:00","currency":"EUR","items":[{"sku":"SKU-1019","qty":3},{"sku":"SKU-1003","qty":3},{"sku":"SKU-1002","qty":1}],"totalMinor":63288}],"orders.fulfilments":[{"fulfilmentId":"ORD-1237-0002-F1","orderId":"ORD-1237-0002","location":"WH-RTM","items":[{"sku":"SKU-1019","qty":3},{"sku":"SKU-1002","qty":1}],"amountMinor":34791,"status":"pending"},{"fulfilmentI
What the contract found:
- [R3.2] ORD-1237-0002-F2: unavailable fulfilment not cancelled after the amend
What your program did: nothing at all (no committed effect for this order)

(3 smaller classes are not shown; `node smoke.mjs` lists every failing contract.)