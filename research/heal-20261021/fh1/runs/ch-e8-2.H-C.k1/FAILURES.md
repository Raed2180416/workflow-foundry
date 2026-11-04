# Failure report

The platform ran your program on the practice worlds (1235 d2, 1236 d3, 1237 d5; the same worlds `node smoke.mjs` uses) and
checked every completed order against its capability contracts, executable checks written from SPEC-E's rules.
301 of 324 completed orders pass every contract. The failing orders fall into 14 failure classes
(a class = one contract, one rule, one kind of finding). A second run reproduced every failure exactly, so each is a defect in the
program, not chance. Your program is judged on other worlds with other orders: fix the cause, not the example.

## Likely common causes

- Classes 1, 2, 3, 5 fail on the same 8 orders (for 8 of them your program committed no effect at all): probably one cause, upstream of the first rule they break.

## Class 1: 8 orders, contract "reservation", rule R4.2

Finding (normalised): ORD-…: not every item reserved within <n> min of ready
The contract checks SPEC-E rules R4.2.1, R5.1, R6.2, R7.1.
Modules whose manifest declares rule R4.2: fulfil.

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

## Class 2: 6 orders, contract "intake", rule R1.1

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

## Class 3: 6 orders, contract "tracking", rule R4.1

Finding (normalised): order never set processing
The contract checks SPEC-E rules R4.1, R4.4, R4.5, R7.2.
Modules whose manifest declares rule R4.1: fulfil.

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

## Class 4: 4 orders, contract "tracking", rule R4.4

Finding (normalised): ORD-…: never completed after delivery
The contract checks SPEC-E rules R4.1, R4.4, R4.5, R7.2.
Modules whose manifest declares rule R4.4: fulfil.

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

## Class 5: 2 orders, contract "customer-action", rule R3.2

Finding (normalised): ORD-…: unavailable fulfilment not cancelled after the amend
The contract checks SPEC-E rules R3.1, R3.2, S1, S5, S9, S11.
Modules whose manifest declares rule R3.2: wait.

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

## Class 6: 2 orders, contract "customer-action", rule R3.2

Finding (normalised): order never timed out
The contract checks SPEC-E rules R3.1, R3.2, S1, S5, S9, S11.
Modules whose manifest declares rule R3.2: wait.

### ORD-1237-0005 (practice world 1237, difficulty 5)

What it received:
- (no separate inbound message)
- in the go-live migration export delivered at the start: {"records":{"orders.orders":[{"orderId":"ORD-1237-0005","customerId":"C-0039","status":"customerActionRequired","placedAt":"2026-03-01T21:39:00+01:00","currency":"EUR","items":[{"sku":"SKU-1009","qty":2},{"sku":"SKU-1029","qty":2}],"totalMinor":85046}],"orders.fulfilments":[{"fulfilmentId":"ORD-1237-0005-F1","orderId":"ORD-1237-0005","location":"WH-EIN","items":[{"sku":"SKU-1009","qty":2}],"amountMinor":37448,"status":"pending"},{"fulfilmentId":"ORD-1237-0005-F2","orderId":"ORD-1237-0005","locat
What the contract found:
- [R3.2] order never timed out
- [R3.2] ORD-1237-0005-F1: not cancelled at the timeout
- [R3.2] ORD-1237-0005-F2: not cancelled at the timeout
What your program did: nothing at all (no committed effect for this order)

### ORD-1237-0008 (practice world 1237, difficulty 5)

What it received:
- (no separate inbound message)
- in the go-live migration export delivered at the start: {"records":{"orders.orders":[{"orderId":"ORD-1237-0008","customerId":"C-0026","status":"customerActionRequired","placedAt":"2026-03-01T21:33:00+01:00","currency":"EUR","items":[{"sku":"SKU-1026","qty":2},{"sku":"SKU-1012","qty":2},{"sku":"SKU-1002","qty":2},{"sku":"SKU-1022","qty":2}],"totalMinor":127642}],"orders.fulfilments":[{"fulfilmentId":"ORD-1237-0008-F1","orderId":"ORD-1237-0008","location":"WH-EIN","items":[{"sku":"SKU-1026","qty":2},{"sku":"SKU-1002","qty":2}],"amountMinor":55046,"stat
What the contract found:
- [R3.2] order never timed out
- [R3.2] ORD-1237-0008-F1: not cancelled at the timeout
- [R3.2] ORD-1237-0008-F2: not cancelled at the timeout
What your program did: nothing at all (no committed effect for this order)

## Class 7: 2 orders, contract "customer-action", rule R3.2

Finding (normalised): order not cancelled after the counted action
The contract checks SPEC-E rules R3.1, R3.2, S1, S5, S9, S11.
Modules whose manifest declares rule R3.2: wait.

### ORD-1235-0002 (practice world 1235, difficulty 2)

What it received:
- 2026-03-02T02:19:00+01:00 customer.action (customer-portal): {"orderRef":"ORD-1235-0002","action":"cancel","from":"c0026@hollin-shop.example"}
- in the go-live migration export delivered at the start: {"records":{"orders.orders":[{"orderId":"ORD-1235-0002","customerId":"C-0026","status":"customerActionRequired","placedAt":"2026-03-01T22:42:00+01:00","currency":"EUR","items":[{"sku":"SKU-1012","qty":1},{"sku":"SKU-1011","qty":2}],"totalMinor":47792}],"orders.fulfilments":[{"fulfilmentId":"ORD-1235-0002-F1","orderId":"ORD-1235-0002","location":"WH-RTM","items":[{"sku":"SKU-1011","qty":2}],"amountMinor":30993,"status":"pending"},{"fulfilmentId":"ORD-1235-0002-F2","orderId":"ORD-1235-0002","locat
What the contract found:
- [R3.2] order not cancelled after the counted action
What your program did: nothing at all (no committed effect for this order)

### ORD-1236-0005 (practice world 1236, difficulty 3)

What it received:
- 2026-03-02T01:39:00+01:00 customer.action (customer-portal): {"orderRef":"ORD-1236-0005","action":"cancel","from":"c0035@hollin-shop.example"}
- in the go-live migration export delivered at the start: {"records":{"orders.orders":[{"orderId":"ORD-1236-0005","customerId":"C-0035","status":"customerActionRequired","placedAt":"2026-03-01T21:53:00+01:00","currency":"EUR","items":[{"sku":"SKU-1013","qty":3}],"totalMinor":64197}],"orders.fulfilments":[{"fulfilmentId":"ORD-1236-0005-F1","orderId":"ORD-1236-0005","location":null,"items":[{"sku":"SKU-1013","qty":3}],"amountMinor":64197,"status":"unavailable"}],"notify.notifications":[{"notificationId":"NTF-GL-005","to":"c0035@hollin-shop.example","abou
What the contract found:
- [R3.2] order not cancelled after the counted action
What your program did: nothing at all (no committed effect for this order)

## Class 8: 1 order, contract "fraud", rule R2.2

Finding (normalised): order cancelled at <time>, window <time>-<n>-07T14:<n>
The contract checks SPEC-E rules R2.1, R2.2, R6.4, S1, S3, S12, S15.
Modules whose manifest declares rule R2.2: review.

### ORD-1237-0079 (practice world 1237, difficulty 5)

What it received:
- 2026-03-06T13:20:00+01:00 order.placed (shop): {"orderId":"ORD-1237-0079","customerId":"C-0037","placedAt":"2026-03-06T13:20:00+01:00","currency":"EUR","items":[{"sku":"SKU-1016","qty":2},{"sku":"SKU-1028","qty":2},{"sku":"SKU-1008","qty":1},{"sku":"SKU-1023","qty":2}],"channel":"app"}
What the contract found:
- [R2.2] order cancelled at 2026-03-07T12:22, window 2026-03-07T12:22..2026-03-07T14:22
What your program did: effects orders.create×1, orders.setStatus×5; statuses F:cancelled, O:cancelled; notifications -

(6 smaller classes are not shown; `node smoke.mjs` lists every failing contract.)