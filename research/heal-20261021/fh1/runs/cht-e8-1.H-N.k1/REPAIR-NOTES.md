# REPAIR-NOTES: orders where the majority disagreed with this program

Result: no program change. For each order below, SPEC-E requires what this program does. The majority's
"no effects" is the behaviour the spec rules out. `check` and `test` pass unchanged (58 tests).

Assumptions I could not check against the world files (`rulebook/`, `master/`, the full go-live export are not in
this directory):
- `customerActionHours = 4` for the edition in force at `p`. This is the value in the rulebook fixture the tests use
  (`tests/customer-action.test.mjs`). Every deadline below is computed with it.
- Carrier-code and notification records are as the platform holds them; the go-live export lines in DISAGREEMENTS.md
  are truncated, so I could not read the full `notify.notifications` or `carrier-codes` data for these orders.

The common pattern: the majority produced no effect for each of these orders, which is what happens when a program
does not continue a migrated instance (SPEC-E §3.5: "continue each from where it stands, under the same rules").

## Customer cancels and timeouts on migrated orders waiting for the customer

### ORD-1235-0002 (cancel, migrated `customerActionRequired`)
- Rules: §3.5, R3.2, S1, R6.1, §4.8.
- p = 2026-03-01T22:42+01:00, so D = 2026-03-02T02:42+01:00. The cancel at 02:19 is at or before D, so it counts
  (R3.2). Cancel the order within 60 min, reason `customer` (R3.2 cancel branch, R6.1).
- Program: cancels F1 and F2 (every fulfilment not ended), sets the order `cancelled`, sends `order-cancelled`.
- Verdict: program is right. Majority ∅ is wrong.

### ORD-1236-0005 (cancel, migrated `customerActionRequired`, F1 `unavailable`)
- Rules: §3.5, R3.2, R6.1, §4.8.
- p = 2026-03-01T21:53, D = 01:53. The cancel at 01:39 counts.
- R6.1 sets every fulfilment not `completed`/`failed`/`cancelled` to `cancelled`, which includes the unavailable F1.
- Program: `setStatus` for F1 and the order, then `order-cancelled`.
- Verdict: program is right. Majority ∅ is wrong.

### ORD-1237-0008 (no action, migrated `customerActionRequired`)
- Rules: R3.2 (timeout), §4.8.
- p = 2026-03-01T21:33, D = 01:33 on 03-02. Nothing counted by D.
- R3.2: after D and at most D+60, cancel every fulfilment, set the order `timedOut`, send `order-timed-out`.
- Program: wake-up at D+30 = 02:03, inside (D, D+60]. It cancels every fulfilment, sets `timedOut`, and sends the notice.
- Verdict: program is right. Majority ∅ is wrong.

### ORD-1237-0005 (no action, migrated `customerActionRequired`)
- Same rules as ORD-1237-0008. p = 2026-03-01T21:39, D = 01:39, timeout at D+30 = 02:09.
- Verdict: program is right. Majority ∅ is wrong.

## Amends on migrated orders waiting for the customer

### ORD-1236-0002 (amend at 01:05)
- Rules: R3.2 (amend), R4.1, R4.2, §3.5, S5.
- p = 2026-03-01T22:44, D = 02:44. The amend at 01:05 counts.
- R3.2: cancel the unavailable fulfilment within 60 min; the order is ready at 01:05 (R4.1), so the order and the
  available fulfilment go `processing`, then R4.2 runs reserve, charge, ship.
- Program: cancels the unavailable F2, `processing` for the order and F1, then one reserve, one charge, one carrier
  booking, and the later statuses the messages drive.
- Verdict: program is right. Majority ∅ is wrong.

### ORD-1237-0002 (amend at 01:00)
- Same rules. p = 2026-03-01T21:48, D = 01:48, so the amend counts.
- Two `inventory.reserve` calls: one per item of the single available fulfilment (R4.2.1; the reserve is per item).
- Verdict: program is right. Majority ∅ is wrong.

## Carrier reports on migrated `processing` orders

### ORD-1235-0003 (DELIVERED at 05:57, F1 already `dispatched`)
- Rules: §3.5, §3.3, R4.4, R4.5, R7.2.
- The fulfilment is already `dispatched`, so `delivered` sets `completed` only (R4.4, no second `dispatched`).
- The order has no other open fulfilment, so R4.5 sets the order `completed`.
- Program: `setStatus` for F then O (2 calls), no notice (none required).
- Verdict: program is right. Majority ∅ is wrong.

### ORD-1236-0003 (DELIVERED, F1 `dispatched`)
- Same rules and same outcome: F `completed`, then O `completed`.
- Verdict: program is right. Majority ∅ is wrong.

### ORD-1237-0006 (DELIVERED at 15:49, then a repeat at 16:36 with `reportedAt` 15:49)
- Rules: §3.3 (repeats change nothing), R7.2 (statuses move forward only), R4.4, R4.5.
- The first report completes F and then O. The repeat has no effect because the status has already moved.
- Verdict: program is right. Majority ∅ is wrong.

### ORD-1237-0003 (VELOX code `DL`, F1 `dispatched`, DELIVERED twice)
- Rules: R1.3 (the edition at `p` for the whole life of the order), §3.3 (translate the code with
  `rulebook/<edition>/carrier-codes.json`), R4.4, R4.5.
- The fulfilment's edition is the edition at `p` (`intake` resume uses `editionAt(placedAt)`), so the code is read from
  the order's edition, as R1.3 requires, not from a newer edition.
- Given `DL` means `delivered` in that edition (I could not read the table; the program's result implies it), the
  program sets F `completed` then O `completed`. The second report changes nothing.
- Verdict: program is right, subject to the edition's table. Majority ∅ is wrong.

## Open item (not changed): notifications in the four cancel and timeout orders

DISAGREEMENTS.md records no notification for this program in ORD-1235-0002, ORD-1236-0005, ORD-1237-0005 and
ORD-1237-0008. R3.2 and R6.1 require `order-cancelled` or `order-timed-out` there.

I replayed these flows through the composed program (`compose-kit/runtime.mjs` plus the real parent and modules):
- the migration tick, then the inbound cancel merged into the migrated instance, emits `orders.setStatus` ×3 and
  `notify.send order-cancelled`;
- a timer on the migrated waiting instance emits three status changes and `notify.send order-timed-out`.

So the module logic sends these notices. The platform record shows none. Two explanations I cannot separate from here:
1. The go-live export already contains that notice in `notify.notifications` (the key `<template>.<about>`). The
   notices module seeds its `sent` list from the records, so it does not send a second copy (§4.8: send exactly once).
   The truncated export lines would show this.
2. A platform-side effect that the replay does not reproduce.

I did not change the notices logic for this. If the full export shows no such notice, I would look at the platform's
notify results for these orders before changing anything.
