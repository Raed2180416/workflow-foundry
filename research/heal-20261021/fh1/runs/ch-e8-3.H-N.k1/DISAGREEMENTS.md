# Orders where your program disagrees with the majority of independently built programs

Each order below ran on a practice world (the same ones `node smoke.mjs` uses). A majority of other programs, built
independently from the same SPEC-E, behaved one way; yours behaved another. The majority is NOT automatically right.
For each order: read what it received, decide from SPEC-E which behaviour the spec requires, and fix your program only
where yours is wrong. Write your reasoning per order (rule ids) into REPAIR-NOTES.md.

## ORD-1235-0002 (practice world 1235, difficulty 2)

What it received:
- 2026-03-02T02:19:00+01:00 customer.action (customer-portal): {"orderRef":"ORD-1235-0002","action":"cancel","from":"c0026@hollin-shop.example"}
- in the go-live migration export delivered at the start: {"records":{"orders.orders":[{"orderId":"ORD-1235-0002","customerId":"C-0026","status":"customerActionRequired","placedAt":"2026-03-01T22:42:00+01:00","currency":"EUR","items":[{"sku":"SKU-1012","qty":1},{"sku":"SKU-1011","qty":2}],"totalMinor":47792}],"orders.fulfilments":[{"fulfilmentId":"ORD-1235-0002-F1","orderId":"ORD-1235-0002","location":"WH-RTM","items":[{"sku":"SKU-1011","qty":2}],"amountMinor":30993,"status":"pending"},{"fulfilmentId":"ORD-1235-0002-F2","orderId":"ORD-1235-0002","locat

Yours: effects orders.setStatus×3; statuses F:cancelled, O:cancelled; notifications -
Majority: ∅

## ORD-1235-0003 (practice world 1235, difficulty 2)

What it received:
- 2026-03-02T05:57:00+01:00 carrier.status (carrier): {"carrier":"PARCELLA","code":"DELIVERED","shipmentId":"SHP-GL-003","fulfilmentRef":"ORD-1235-0003-F1","reportedAt":"2026-03-02T05:57:00+01:00"}
- in the go-live migration export delivered at the start: {"records":{"orders.orders":[{"orderId":"ORD-1235-0003","customerId":"C-0004","status":"processing","placedAt":"2026-02-27T11:13:00+01:00","currency":"EUR","items":[{"sku":"SKU-1007","qty":1},{"sku":"SKU-1010","qty":2}],"totalMinor":37347}],"orders.fulfilments":[{"fulfilmentId":"ORD-1235-0003-F1","orderId":"ORD-1235-0003","location":"WH-EIN","items":[{"sku":"SKU-1007","qty":1},{"sku":"SKU-1010","qty":2}],"amountMinor":37347,"status":"dispatched"}],"inventory.reservations":[{"reservationId":"RSV-

Yours: effects orders.setStatus×2; statuses F:completed, O:completed; notifications -
Majority: ∅

## ORD-1236-0002 (practice world 1236, difficulty 3)

What it received:
- 2026-03-02T01:05:00+01:00 customer.action (customer-portal): {"orderRef":"ORD-1236-0002","action":"amend","from":"c0022@hollin-shop.example"}
- in the go-live migration export delivered at the start: {"records":{"orders.orders":[{"orderId":"ORD-1236-0002","customerId":"C-0022","status":"customerActionRequired","placedAt":"2026-03-01T22:44:00+01:00","currency":"EUR","items":[{"sku":"SKU-1013","qty":1},{"sku":"SKU-1021","qty":1}],"totalMinor":30493}],"orders.fulfilments":[{"fulfilmentId":"ORD-1236-0002-F1","orderId":"ORD-1236-0002","location":"WH-RTM","items":[{"sku":"SKU-1021","qty":1}],"amountMinor":9094,"status":"pending"},{"fulfilmentId":"ORD-1236-0002-F2","orderId":"ORD-1236-0002","locati

Yours: effects billing.charge×1, carrier.create×1, inventory.reserve×1, orders.setStatus×6; statuses F:cancelled, F:completed, F:dispatched, F:processing, O:completed, O:processing; notifications -
Majority: ∅

## ORD-1236-0005 (practice world 1236, difficulty 3)

What it received:
- 2026-03-02T01:39:00+01:00 customer.action (customer-portal): {"orderRef":"ORD-1236-0005","action":"cancel","from":"c0035@hollin-shop.example"}
- in the go-live migration export delivered at the start: {"records":{"orders.orders":[{"orderId":"ORD-1236-0005","customerId":"C-0035","status":"customerActionRequired","placedAt":"2026-03-01T21:53:00+01:00","currency":"EUR","items":[{"sku":"SKU-1013","qty":3}],"totalMinor":64197}],"orders.fulfilments":[{"fulfilmentId":"ORD-1236-0005-F1","orderId":"ORD-1236-0005","location":null,"items":[{"sku":"SKU-1013","qty":3}],"amountMinor":64197,"status":"unavailable"}],"notify.notifications":[{"notificationId":"NTF-GL-005","to":"c0035@hollin-shop.example","abou

Yours: effects orders.setStatus×2; statuses F:cancelled, O:cancelled; notifications -
Majority: ∅

## ORD-1236-0003 (practice world 1236, difficulty 3)

What it received:
- 2026-03-02T21:39:00+01:00 carrier.status (carrier): {"carrier":"PARCELLA","code":"DELIVERED","shipmentId":"SHP-GL-003","fulfilmentRef":"ORD-1236-0003-F1","reportedAt":"2026-03-02T21:39:00+01:00"}
- in the go-live migration export delivered at the start: {"records":{"orders.orders":[{"orderId":"ORD-1236-0003","customerId":"C-0010","status":"processing","placedAt":"2026-02-27T14:31:00+01:00","currency":"EUR","items":[{"sku":"SKU-1007","qty":1},{"sku":"SKU-1014","qty":1},{"sku":"SKU-1009","qty":3},{"sku":"SKU-1030","qty":1}],"totalMinor":104189}],"orders.fulfilments":[{"fulfilmentId":"ORD-1236-0003-F1","orderId":"ORD-1236-0003","location":"WH-AMS","items":[{"sku":"SKU-1007","qty":1},{"sku":"SKU-1014","qty":1},{"sku":"SKU-1009","qty":3},{"sku":"SKU

Yours: effects orders.setStatus×2; statuses F:completed, O:completed; notifications -
Majority: ∅

## ORD-1237-0002 (practice world 1237, difficulty 5)

What it received:
- 2026-03-02T01:00:00+01:00 customer.action (customer-portal): {"orderRef":"ORD-1237-0002","action":"amend","from":"c0027@hollin-shop.example"}
- in the go-live migration export delivered at the start: {"records":{"orders.orders":[{"orderId":"ORD-1237-0002","customerId":"C-0027","status":"customerActionRequired","placedAt":"2026-03-01T21:48:00+01:00","currency":"EUR","items":[{"sku":"SKU-1019","qty":3},{"sku":"SKU-1003","qty":3},{"sku":"SKU-1002","qty":1}],"totalMinor":63288}],"orders.fulfilments":[{"fulfilmentId":"ORD-1237-0002-F1","orderId":"ORD-1237-0002","location":"WH-RTM","items":[{"sku":"SKU-1019","qty":3},{"sku":"SKU-1002","qty":1}],"amountMinor":34791,"status":"pending"},{"fulfilmentI

Yours: effects billing.charge×1, carrier.create×1, inventory.reserve×2, orders.setStatus×6; statuses F:cancelled, F:completed, F:dispatched, F:processing, O:completed, O:processing; notifications -
Majority: ∅

## ORD-1237-0008 (practice world 1237, difficulty 5)

What it received:
- (no separate inbound message)
- in the go-live migration export delivered at the start: {"records":{"orders.orders":[{"orderId":"ORD-1237-0008","customerId":"C-0026","status":"customerActionRequired","placedAt":"2026-03-01T21:33:00+01:00","currency":"EUR","items":[{"sku":"SKU-1026","qty":2},{"sku":"SKU-1012","qty":2},{"sku":"SKU-1002","qty":2},{"sku":"SKU-1022","qty":2}],"totalMinor":127642}],"orders.fulfilments":[{"fulfilmentId":"ORD-1237-0008-F1","orderId":"ORD-1237-0008","location":"WH-EIN","items":[{"sku":"SKU-1026","qty":2},{"sku":"SKU-1002","qty":2}],"amountMinor":55046,"stat

Yours: effects orders.setStatus×3; statuses F:cancelled, O:timedOut; notifications -
Majority: ∅

## ORD-1237-0005 (practice world 1237, difficulty 5)

What it received:
- (no separate inbound message)
- in the go-live migration export delivered at the start: {"records":{"orders.orders":[{"orderId":"ORD-1237-0005","customerId":"C-0039","status":"customerActionRequired","placedAt":"2026-03-01T21:39:00+01:00","currency":"EUR","items":[{"sku":"SKU-1009","qty":2},{"sku":"SKU-1029","qty":2}],"totalMinor":85046}],"orders.fulfilments":[{"fulfilmentId":"ORD-1237-0005-F1","orderId":"ORD-1237-0005","location":"WH-EIN","items":[{"sku":"SKU-1009","qty":2}],"amountMinor":37448,"status":"pending"},{"fulfilmentId":"ORD-1237-0005-F2","orderId":"ORD-1237-0005","locat

Yours: effects orders.setStatus×3; statuses F:cancelled, O:timedOut; notifications -
Majority: ∅

## ORD-1237-0006 (practice world 1237, difficulty 5)

What it received:
- 2026-03-02T15:49:00+01:00 carrier.status (carrier): {"carrier":"PARCELLA","code":"DELIVERED","shipmentId":"SHP-GL-006","fulfilmentRef":"ORD-1237-0006-F1","reportedAt":"2026-03-02T15:49:00+01:00"}
- 2026-03-02T16:36:00+01:00 carrier.status (carrier): {"carrier":"PARCELLA","code":"DELIVERED","shipmentId":"SHP-GL-006","fulfilmentRef":"ORD-1237-0006-F1","reportedAt":"2026-03-02T15:49:00+01:00"}
- in the go-live migration export delivered at the start: {"records":{"orders.orders":[{"orderId":"ORD-1237-0006","customerId":"C-0013","status":"processing","placedAt":"2026-02-27T08:54:00+01:00","currency":"EUR","items":[{"sku":"SKU-1002","qty":1},{"sku":"SKU-1021","qty":1}],"totalMinor":20293}],"orders.fulfilments":[{"fulfilmentId":"ORD-1237-0006-F1","orderId":"ORD-1237-0006","location":"WH-AMS","items":[{"sku":"SKU-1002","qty":1},{"sku":"SKU-1021","qty":1}],"amountMinor":20293,"status":"dispatched"}],"inventory.reservations":[{"reservationId":"RSV-

Yours: effects orders.setStatus×2; statuses F:completed, O:completed; notifications -
Majority: ∅

## ORD-1237-0003 (practice world 1237, difficulty 5)

What it received:
- 2026-03-03T02:02:00+01:00 carrier.status (carrier): {"carrier":"VELOX","code":"DL","shipmentId":"SHP-GL-003","fulfilmentRef":"ORD-1237-0003-F1","reportedAt":"2026-03-03T02:02:00+01:00"}
- 2026-03-03T03:46:00+01:00 carrier.status (carrier): {"carrier":"VELOX","code":"DL","shipmentId":"SHP-GL-003","fulfilmentRef":"ORD-1237-0003-F1","reportedAt":"2026-03-03T02:02:00+01:00"}
- in the go-live migration export delivered at the start: {"records":{"orders.orders":[{"orderId":"ORD-1237-0003","customerId":"C-0037","status":"processing","placedAt":"2026-02-27T16:58:00+01:00","currency":"EUR","items":[{"sku":"SKU-1014","qty":2},{"sku":"SKU-1028","qty":3}],"totalMinor":69890}],"orders.fulfilments":[{"fulfilmentId":"ORD-1237-0003-F1","orderId":"ORD-1237-0003","location":"WH-RTM","items":[{"sku":"SKU-1014","qty":2},{"sku":"SKU-1028","qty":3}],"amountMinor":69890,"status":"dispatched"}],"inventory.reservations":[{"reservationId":"RSV-

Yours: effects orders.setStatus×2; statuses F:completed, O:completed; notifications -
Majority: ∅

## ORD-1237-0150 (practice world 1237, difficulty 5)

What it received:
- 2026-03-10T10:14:00+01:00 order.placed (shop): {"orderId":"ORD-1237-0150","customerId":"C-0039","placedAt":"2026-03-10T10:14:00+01:00","currency":"EUR","items":[{"sku":"SKU-1012","qty":2},{"sku":"SKU-1004","qty":3}],"channel":"app"}

Yours: effects inventory.release×2, inventory.reserve×2, orders.create×1, orders.setStatus×4; statuses F:failed, F:processing, O:failed, O:processing; notifications -
Majority: effects billing.charge×1, carrier.create×1, inventory.reserve×2, orders.create×1, orders.setStatus×5; statuses F:completed, F:dispatched, F:processing, O:completed, O:processing; notifications -

## ORD-1237-0151 (practice world 1237, difficulty 5)

What it received:
- 2026-03-10T10:15:00+01:00 order.placed (shop): {"orderId":"ORD-1237-0151","customerId":"C-0016","placedAt":"2026-03-10T10:15:00+01:00","currency":"EUR","items":[{"sku":"SKU-1025","qty":1},{"sku":"SKU-1007","qty":2}],"channel":"app"}

Yours: effects inventory.release×2, inventory.reserve×2, orders.create×1, orders.setStatus×6; statuses F:failed, F:processing, O:failed, O:processing; notifications -
Majority: effects billing.charge×2, carrier.create×2, inventory.reserve×2, orders.create×1, orders.setStatus×8; statuses F:completed, F:dispatched, F:processing, O:completed, O:processing; notifications -

(48 more orders disagree in the same way or similar ways.)