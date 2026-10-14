# REPAIR-NOTES

Four orders disagreed (ORD-1237-0062, ORD-1237-0100, ORD-1237-0158, ORD-1237-0190, all practice world 1237). They share one root cause, and the majority is right on all four. The fault was in my solver: `rsvResult` in `solver.mjs`.

## Root cause

Practice world 1237 returns partial `inventory.reserve` batches in which one item fails with `503 batch-item-not-processed`. That error is retryable. The solver read the error from the item only, resubmitted only for a fixed list of codes, and treated any other item error as a failure. So a transient, unprocessed item failed the whole fulfilment. Compensation then released the other reserved item and the fulfilment was marked `failed` with no charge and no shipment. The majority resubmits the item with its original key.

Fix (in `rsvResult`, `solver.mjs`): an item the batch left undone is resubmitted with its original key. Only a permanent error (`retryable: false`, and not an invalid request of ours) fails the item, within the existing `MAX_TRIES` bound. The error is read from the item, falling back to the batch.

## Per order

### ORD-1237-0062
- Rules: Platform §1 (a partial batch is delivered, not retried; a permanent error, `retryable: false`, is never retried); R4.2 step 1 (resubmit only the failed items, with their original keys, in the same window); R5.2 (a fulfilment fails only on a permanent step error); R5.1 (compensation of committed steps only).
- Verdict: **majority right, yours wrong.** A retryable item error was treated as permanent. Fixed.
- Expected after the fix: charge 2, carrier.create 2, reserve 3, release 0, setStatus 8, no `F:failed`. Matches the majority.

### ORD-1237-0100
- Rules: as ORD-1237-0062.
- Verdict: **majority right, yours wrong.** Same cause. Fixed.
- Expected after the fix: charge 3, carrier.create 3, reserve 4, release 0, setStatus 11, no `F:failed`. Matches the majority.

### ORD-1237-0158
- Rules: as ORD-1237-0062.
- Verdict: **majority right, yours wrong.** Same cause. Fixed.
- Expected after the fix: charge 3, carrier.create 3, reserve 4, release 0, setStatus 11, no `F:failed`. Matches the majority.

### ORD-1237-0190
- Rules: as ORD-1237-0062.
- Verdict: **majority right, yours wrong.** Same cause. Fixed.
- Expected after the fix: charge 2, carrier.create 2, reserve 4, release 0, setStatus 8, no `F:failed`. Matches the majority.

The "expected" counts are derived: each order's previous count, plus the resubmitted reserve and the fulfilment that the failure had stopped, minus the release that compensation made. They are not read from per-order output, because smoke reports only world-level totals.

## Verification

- `node smoke.mjs` before the fix and after it: 0 arm errors in every practice world, and run status complete in each.
- World 1235 and world 1236: identical result counts before and after (neither has a 503).
- World 1237, before → after (world totals): `billing.charge ok` 299 → 303, `carrier.create ok` 293 → 297, `inventory.reserve ok` 400 → 404, `orders.setStatus ok` 1349 → 1353, `inventory.release ok` 75 → 71. The `503 batch-item-not-processed` count stays at 4, which is expected: each one now triggers a resubmission that succeeds. The four orders are the only ones affected.
- Offline harness (outside the work directory): a partial batch with one item at `503` (retryable) resubmits only that item with its original key, and the charge follows. A partial batch with one item at `retryable: false` starts compensation (release of the committed item) and does not resubmit.
- Not reconciled: the world 1237 "effects emitted" total moved +8, but the result deltas above sum to +12. My guess is that the emitted total counts each keyed effect once, so the reserve resubmissions are not counted. This is inference; I did not confirm it.

## Not changed (outside the four orders)

- The solver never calls `ctx.status`. R5.1 and S2 require a committed step whose outcome was unknown to be compensated when `status(key)` shows `committed`. Currently an unknown outcome is treated as not committed, so it is never undone. No disagreement covers this, so I left it as it was.
