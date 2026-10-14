# Repair notes: DISAGREEMENTS.md

## Root cause (common to every listed order)

All nine listed orders came in through the go-live migration export (§3.5). My solver closed each migrated
instance without any effect, so nothing after that point could reach the order:

1. `route()` read the order id only from the top-level `orderId` / `orderRef` of the migration payload. When
   the id was not there, the instance was closed.
2. `rebuild()` returned false when the order had no record yet, and the instance was closed. §3.5 says
   "continue each from where it stands", and an order with no record still has R1.1 to do. The majority
   records it with `orders.create`.

Because the migrated instance was closed, later customer actions and carrier reports for these orders
(§3.2, §3.3) had no open instance to merge into, so they were lost too.

## Fix (solver.mjs)

- `migOrderId(e)`: the first order id named anywhere in the migration payload.
- `migrationMessages(e)`: the placed order, customer actions and carrier reports the payload carries
  (matched by shape, like the existing `isPlaced` / `isAction` / `isCarrier`). They are replayed through
  `applyEvent`.
- `route()`, migration branch: a recorded order is rebuilt and kept open (or closed if it already ended).
  An unrecorded order starts from its placed message (`w.C = newState(...)`) and goes through R1 as a
  new order.
- `recs()`: `rebuild` reads its records through the query, and falls back to the instance's own records in
  `sor/<instance>.json` when the query returns none (§3.4).

Nothing else changed.

## Per order

Rules cited are from SPEC-E.md. "Mine" is the solver before this repair. Verdict: the majority was right in
every listed case, and the fix is in the migration path.

| order | rule ids | what the spec requires | verdict |
|---|---|---|---|
| ORD-1235-0001 | §3.5, R1.1, R1.2, R1.3, R2.1, R4.1, R4.2, R4.4, R4.5, R7.2 | Unrecorded at go-live: continue from R1.1 (allocate, `orders.create`), then fraud, processing, reserve, charge, ship per fulfilment. | Majority right. Mine closed the migrated instance with no record. Fixed. |
| ORD-1235-0002 | §3.2, §3.5, R3.2 (cancel at or before D), R6.1, R7.2, S1 | Recorded order; the portal cancel counts and the order is cancelled within 60 min with reason `customer`. R6.1 requires the `order-cancelled` notice. | Majority right on the effects (`setStatus` ×3: 2 fulfilments and the order). Mine lost the action because the instance was closed. Fixed. The majority summary shows no notification, but R6.1 requires `order-cancelled`, so I keep it. |
| ORD-1235-0003 | §3.3, §3.5 (matched by `fulfilmentRef`, no `ref` was placed), R4.4 (delivered: `dispatched` first if unset, then `completed`), R4.5, R7.2 | Carrier DELIVERED for a migrated shipment: complete the fulfilment and the order. | Majority right. The instance that should take the report had been closed. Fixed. |
| ORD-1236-0001 | as ORD-1235-0001; R4.2 step 1 for the three reserve calls | Unrecorded: full flow. | Majority right. Fixed. |
| ORD-1236-0004 | as ORD-1235-0001; R4.2 step 1 (partial or 503: resubmit the failed items with their original keys) | Unrecorded: full flow, with item retries. | Majority right. The existing per-item retry logic is kept. Fixed by the migration path. |
| ORD-1236-0002 | §3.2, §3.5, R3.2 (amend: drop unavailable, ready at a), S5, S8, R4.1, R4.2, R4.5, R7.2 | Recorded in `customerActionRequired`; the amend counts, the available fulfilment completes. | Majority right. Fixed. |
| ORD-1236-0005 | §3.2, §3.5, R3.2 (cancel), R6.1, R7.2 | Recorded and waiting; cancel the order within 60 min. | Majority right. Fixed. |
| ORD-1236-0003 | §3.3, §3.5, R4.4, R4.5, R7.2 | Carrier DELIVERED for a migrated shipment; complete. | Majority right. Fixed. |
| ORD-1237-0001 | as ORD-1235-0001 | Unrecorded: full flow. | Majority right. Fixed. |
| ORD-1237-0004 | as ORD-1235-0001 | Unrecorded: full flow. | Majority right. Fixed. |
| ORD-1237-0007 | as ORD-1235-0001; R4.2 step 1 | Unrecorded: full flow. | Majority right. Fixed. |
| ORD-1237-0002 | §3.2, §3.5, R3.2 (amend), S8, R4.1, R4.2, R4.5 | Recorded and waiting; amend counts. | Majority right. Fixed. |

The disagreement log lists four more orders "in the same way or similar ways". I cannot see them, so this
table does not cover them. They share the same root cause, but I have not checked them one by one.

## Verification

- Local checks (`/tmp/solver-tests/mig.test.mjs`, outside this directory), against an in-memory context:
  an unrecorded migrated order allocates first and is not closed; a recorded migrated order is found and
  not re-created; a later amend merges into it and is applied (F2 cancelled, order processing); an empty
  migration closes with no effects. 11 of 11 pass.
- `node smoke.mjs`, before and after the fix. No arm errors in either run.

  | world | `orders.create` ok | `setStatus` ok | `billing.charge` ok | `carrier.create` ok | `inventory.reserve` ok |
  |---|---|---|---|---|---|
  | 1235 before → after | 50 → 51 | 278 → 291 | 54 → 56 | 54 → 56 | 68 → 70 |
  | 1236 before → after | 80 → 82 | 492 → 515 | 99 → 103 | 99 → 103 | 134 → 142 |
  | 1237 before → after | 200 → 203 | 1316 → 1353 | 297 → 303 | 291 → 297 | 396 → 404 |

  The increases match the sums of the majority counts for the listed orders: 1235 `setStatus` +13 = 8+3+2
  for 0001–0003; 1236 `setStatus` +23 = 8+6+2+5+2 for 0001–0005; 1236 charges +4, reserves +8; 1237
  reserves +8 = 1+2+3+2 for 0001, 0002, 0004, 0007. 1237 `setStatus` +37 includes four orders not listed, so
  it is not checked.

## Not verified

- The exact shape of the migration payload is not in the files I have, and smoke does not show inputs. The
  repair therefore finds the order id and the messages by shape and by key anywhere in the payload, and it
  falls back to `sor/<instance>.json`. The smoke counts above are consistent with that, but I have not seen
  a migration payload.
