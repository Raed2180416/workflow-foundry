# Orders where your program disagrees with the majority of independently built programs

Each order below ran on a practice world (the same ones `node smoke.mjs` uses). A majority of other programs, built
independently from the same SPEC-E, behaved one way; yours behaved another. The majority is NOT automatically right.
For each order: read what it received, decide from SPEC-E which behaviour the spec requires, and fix your program only
where yours is wrong. Write your reasoning per order (rule ids) into REPAIR-NOTES.md.

## ORD-1235-0017 (practice world 1235, difficulty 2)

What it received:
- 2026-03-05T14:50:00+01:00 order.placed (shop): {"orderId":"ORD-1235-0017","customerId":"C-0031","placedAt":"2026-03-05T14:50:00+01:00","currency":"EUR","items":[{"sku":"SKU-1023","qty":1},{"sku":"SKU-1017","qty":3}],"channel":"web"}
- 2026-03-05T15:20:00+01:00 customer.action (customer-portal): {"orderRef":"ORD-1235-0017","action":"cancel","from":"c0031@hollin-shop.example"}

Yours: effects billing.charge×2, carrier.cancel×2, carrier.create×2, inventory.reserve×2, orders.create×1, orders.setStatus×6; statuses F:cancelled, F:processing, O:cancelled, O:processing; notifications -
Majority: effects billing.charge×2, billing.refund×2, carrier.cancel×2, carrier.create×2, inventory.release×2, inventory.reserve×2, orders.create×1, orders.setStatus×6; statuses F:cancelled, F:processing, O:cancelled, O:processing; notifications -

## ORD-1235-0035 (practice world 1235, difficulty 2)

What it received:
- 2026-03-09T12:09:00+01:00 order.placed (shop): {"orderId":"ORD-1235-0035","customerId":"C-0020","placedAt":"2026-03-09T12:09:00+01:00","currency":"EUR","items":[{"sku":"SKU-1004","qty":1}],"channel":"app"}
- 2026-03-09T15:07:00+01:00 customer.action (customer-portal): {"orderRef":"ORD-1235-0035","action":"cancel","from":"c0020@hollin-shop.example"}

Yours: effects billing.charge×1, carrier.cancel×1, carrier.create×1, inventory.reserve×1, orders.create×1, orders.setStatus×4; statuses F:cancelled, F:processing, O:cancelled, O:processing; notifications -
Majority: effects billing.charge×1, billing.refund×1, carrier.cancel×1, carrier.create×1, inventory.release×1, inventory.reserve×1, orders.create×1, orders.setStatus×4; statuses F:cancelled, F:processing, O:cancelled, O:processing; notifications -

## ORD-1235-0038 (practice world 1235, difficulty 2)

What it received:
- 2026-03-09T14:44:00+01:00 order.placed (shop): {"orderId":"ORD-1235-0038","customerId":"C-0018","placedAt":"2026-03-09T14:44:00+01:00","currency":"EUR","items":[{"sku":"SKU-1001","qty":2},{"sku":"SKU-1010","qty":2}],"channel":"app"}
- 2026-03-09T15:23:00+01:00 customer.action (customer-portal): {"orderRef":"ORD-1235-0038","action":"cancel","from":"c0018@hollin-shop.example"}

Yours: effects billing.charge×2, carrier.cancel×2, carrier.create×2, inventory.reserve×2, orders.create×1, orders.setStatus×6; statuses F:cancelled, F:processing, O:cancelled, O:processing; notifications -
Majority: effects billing.charge×2, billing.refund×2, carrier.cancel×2, carrier.create×2, inventory.release×2, inventory.reserve×2, orders.create×1, orders.setStatus×6; statuses F:cancelled, F:processing, O:cancelled, O:processing; notifications -

## ORD-1235-0049 (practice world 1235, difficulty 2)

What it received:
- 2026-03-12T22:14:00+01:00 order.placed (shop): {"orderId":"ORD-1235-0049","customerId":"C-0017","placedAt":"2026-03-12T22:14:00+01:00","currency":"EUR","items":[{"sku":"SKU-1019","qty":3}],"channel":"web"}
- 2026-03-13T04:47:00+01:00 customer.action (customer-portal): {"orderRef":"ORD-1235-0049","action":"cancel","from":"c0017@hollin-shop.example"}

Yours: effects billing.charge×1, carrier.cancel×1, carrier.create×1, inventory.reserve×1, orders.create×1, orders.setStatus×4; statuses F:cancelled, F:processing, O:cancelled, O:processing; notifications -
Majority: effects billing.charge×1, billing.refund×1, carrier.cancel×1, carrier.create×1, inventory.release×1, inventory.reserve×1, orders.create×1, orders.setStatus×4; statuses F:cancelled, F:processing, O:cancelled, O:processing; notifications -

## ORD-1235-0053 (practice world 1235, difficulty 2)

What it received:
- 2026-03-14T04:31:00+01:00 order.placed (shop): {"orderId":"ORD-1235-0053","customerId":"C-0034","placedAt":"2026-03-14T04:31:00+01:00","currency":"EUR","items":[{"sku":"SKU-1016","qty":3}],"channel":"web"}
- 2026-03-14T07:43:00+01:00 customer.action (customer-portal): {"orderRef":"ORD-1235-0053","action":"cancel","from":"c0034@hollin-shop.example"}

Yours: effects billing.charge×1, carrier.cancel×1, carrier.create×1, inventory.reserve×1, orders.create×1, orders.setStatus×4; statuses F:cancelled, F:processing, O:cancelled, O:processing; notifications -
Majority: effects billing.charge×1, billing.refund×1, carrier.cancel×1, carrier.create×1, inventory.release×1, inventory.reserve×1, orders.create×1, orders.setStatus×4; statuses F:cancelled, F:processing, O:cancelled, O:processing; notifications -

## ORD-1236-0013 (practice world 1236, difficulty 3)

What it received:
- 2026-03-03T16:45:00+01:00 order.placed (shop): {"orderId":"ORD-1236-0013","customerId":"C-0007","placedAt":"2026-03-03T16:45:00+01:00","currency":"EUR","items":[{"sku":"SKU-1007","qty":3},{"sku":"SKU-1010","qty":1},{"sku":"SKU-1004","qty":3},{"sku":"SKU-1011","qty":1}],"channel":"app"}
- 2026-03-03T21:43:00+01:00 customer.action (customer-portal): {"orderRef":"ORD-1236-0013","action":"cancel","from":"c0007@hollin-shop.example"}

Yours: effects billing.charge×2, carrier.cancel×2, carrier.create×2, inventory.reserve×4, orders.create×1, orders.setStatus×6; statuses F:cancelled, F:processing, O:cancelled, O:processing; notifications -
Majority: effects billing.charge×2, billing.refund×2, carrier.cancel×2, carrier.create×2, inventory.release×4, inventory.reserve×4, orders.create×1, orders.setStatus×6; statuses F:cancelled, F:processing, O:cancelled, O:processing; notifications -

## ORD-1236-0026 (practice world 1236, difficulty 3)

What it received:
- 2026-03-05T18:27:00+01:00 order.placed (shop): {"orderId":"ORD-1236-0026","customerId":"C-0029","placedAt":"2026-03-05T18:27:00+01:00","currency":"EUR","items":[{"sku":"SKU-1014","qty":1}],"channel":"web"}
- 2026-03-05T19:39:00+01:00 order.placed (shop): {"orderId":"ORD-1236-0026","customerId":"C-0029","placedAt":"2026-03-05T18:27:00+01:00","currency":"EUR","items":[{"sku":"SKU-1014","qty":1}],"channel":"web"}
- 2026-03-06T02:40:00+01:00 customer.action (customer-portal): {"orderRef":"ORD-1236-0026","action":"cancel","from":"c0029@hollin-shop.example"}

Yours: effects billing.charge×1, carrier.cancel×1, carrier.create×1, inventory.reserve×1, orders.create×1, orders.setStatus×4; statuses F:cancelled, F:processing, O:cancelled, O:processing; notifications -
Majority: effects billing.charge×1, billing.refund×1, carrier.cancel×1, carrier.create×1, inventory.release×1, inventory.reserve×1, orders.create×1, orders.setStatus×4; statuses F:cancelled, F:processing, O:cancelled, O:processing; notifications -

## ORD-1236-0031 (practice world 1236, difficulty 3)

What it received:
- 2026-03-06T08:56:00+01:00 order.placed (shop): {"orderId":"ORD-1236-0031","customerId":"C-0014","placedAt":"2026-03-06T08:56:00+01:00","currency":"EUR","items":[{"sku":"SKU-1003","qty":1},{"sku":"SKU-1005","qty":2},{"sku":"SKU-1012","qty":1}],"channel":"web"}
- 2026-03-06T10:57:00+01:00 customer.action (customer-portal): {"orderRef":"ORD-1236-0031","action":"cancel","from":"c0014@hollin-shop.example"}

Yours: effects billing.charge×2, carrier.cancel×2, carrier.create×2, inventory.reserve×3, orders.create×1, orders.setStatus×6; statuses F:cancelled, F:processing, O:cancelled, O:processing; notifications -
Majority: effects billing.charge×2, billing.refund×2, carrier.cancel×2, carrier.create×2, inventory.release×3, inventory.reserve×3, orders.create×1, orders.setStatus×6; statuses F:cancelled, F:processing, O:cancelled, O:processing; notifications -

## ORD-1236-0053 (practice world 1236, difficulty 3)

What it received:
- 2026-03-08T22:12:00+01:00 order.placed (shop): {"orderId":"ORD-1236-0053","customerId":"C-0020","placedAt":"2026-03-08T22:12:00+01:00","currency":"EUR","items":[{"sku":"SKU-1001","qty":1},{"sku":"SKU-1020","qty":1},{"sku":"SKU-1007","qty":2}],"channel":"web"}
- 2026-03-09T00:16:00+01:00 customer.action (customer-portal): {"orderRef":"ORD-1236-0053","action":"cancel","from":"c0020@hollin-shop.example"}

Yours: effects billing.charge×3, carrier.cancel×3, carrier.create×3, inventory.reserve×3, orders.create×1, orders.setStatus×8; statuses F:cancelled, F:processing, O:cancelled, O:processing; notifications -
Majority: effects billing.charge×3, billing.refund×3, carrier.cancel×3, carrier.create×3, inventory.release×3, inventory.reserve×3, orders.create×1, orders.setStatus×8; statuses F:cancelled, F:processing, O:cancelled, O:processing; notifications -

## ORD-1237-0037 (practice world 1237, difficulty 5)

What it received:
- 2026-03-03T18:27:00+01:00 order.placed (shop): {"orderId":"ORD-1237-0037","customerId":"C-0018","placedAt":"2026-03-03T18:27:00+01:00","currency":"EUR","items":[{"sku":"SKU-1001","qty":2}],"channel":"web"}
- 2026-03-04T02:51:00+01:00 customer.action (customer-portal): {"orderRef":"ORD-1237-0037","action":"cancel","from":"c0018@hollin-shop.example"}

Yours: effects billing.charge×1, carrier.cancel×1, carrier.create×1, inventory.reserve×1, orders.create×1, orders.setStatus×4; statuses F:cancelled, F:processing, O:cancelled, O:processing; notifications -
Majority: effects billing.charge×1, billing.refund×1, carrier.cancel×1, carrier.create×1, inventory.release×1, inventory.reserve×1, orders.create×1, orders.setStatus×4; statuses F:cancelled, F:processing, O:cancelled, O:processing; notifications -

## ORD-1237-0075 (practice world 1237, difficulty 5)

What it received:
- 2026-03-06T08:35:00+01:00 order.placed (shop): {"orderId":"ORD-1237-0075","customerId":"C-0017","placedAt":"2026-03-06T08:35:00+01:00","currency":"EUR","items":[{"sku":"SKU-1003","qty":3}],"channel":"web"}

Yours: effects billing.charge×1, carrier.cancel×1, carrier.create×1, inventory.reserve×1, orders.create×1, orders.setStatus×4; statuses F:cancelled, F:processing, O:cancelled, O:processing; notifications -
Majority: effects billing.charge×1, billing.refund×1, carrier.cancel×1, carrier.create×1, inventory.release×1, inventory.reserve×1, orders.create×1, orders.setStatus×4; statuses F:cancelled, F:processing, O:cancelled, O:processing; notifications -

## ORD-1237-0088 (practice world 1237, difficulty 5)

What it received:
- 2026-03-07T06:51:00+01:00 order.placed (shop): {"orderId":"ORD-1237-0088","customerId":"C-0024","placedAt":"2026-03-07T06:51:00+01:00","currency":"EUR","items":[{"sku":"SKU-1018","qty":3},{"sku":"SKU-1029","qty":2},{"sku":"SKU-1005","qty":3},{"sku":"SKU-1006","qty":1}],"channel":"app"}
- 2026-03-07T10:18:00+01:00 customer.action (customer-portal): {"orderRef":"ORD-1237-0088","action":"cancel","from":"c0024@hollin-shop.example"}

Yours: effects billing.charge×2, carrier.cancel×2, carrier.create×2, inventory.reserve×3, orders.create×1, orders.setStatus×8; statuses F:cancelled, F:processing, O:cancelled, O:customerActionRequired, O:processing; notifications -
Majority: effects billing.charge×2, billing.refund×2, carrier.cancel×2, carrier.create×2, inventory.release×3, inventory.reserve×3, orders.create×1, orders.setStatus×8; statuses F:cancelled, F:processing, O:cancelled, O:customerActionRequired, O:processing; notifications -

(6 more orders disagree in the same way or similar ways.)