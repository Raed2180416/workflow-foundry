# REPAIR-NOTES

Reasoning per disagreeing order, from SPEC-E. Rule ids refer to SPEC-E §3 to §5.

## Change made

`modules/fulfilment.mjs` (R4.2, R5.2): a 400 (`invalid-args`, `field-renamed`) is a mistake of ours to correct and
re-issue, "not a failure of the fulfilment". The program gave up after three corrections per step (`MAX_FIX`) and failed
the fulfilment. Now the correction is re-issued (same key, corrected args) for as long as the step's window runs. The
window is read as 120 min from the step's first 400 (`reissue`, S.fw). The transient retry budget (`MAX_FIX` through
`tryAgain`) is unchanged. Scratch check: a charge rejected as `field-renamed` is re-issued with the renamed field, and the
step fails only after the window.

Smoke run after this change: identical effect counts to the run before it, so this change did not alter any outcome on
the practice worlds (see ORD-1237-0150 below).

## Orders where the majority did nothing and the program acts (majority wrong)

For these, the order is a go-live (§3.5) instance. The program continues it from its records. The majority does
nothing, which is the wrong reading of §3.5, and the spec's rules say the program's behaviour is required.

- **ORD-1235-0002** (customer cancel, migrated `customerActionRequired`): the cancel at 02:19 on 03-02 is inside the
  customer's deadline D (R3.2, S1), so it counts. R6.1: cancel the open fulfilments and the order, send
  `order-cancelled`. Program's behaviour required. Keep.
- **ORD-1236-0005** (customer cancel, migrated, single unavailable fulfilment): as above; the unavailable fulfilment
  is not terminal, so it is cancelled (R6.1, R7.2 `unavailable` → `cancelled`). Keep.
- **ORD-1235-0003**, **ORD-1236-0003**, **ORD-1237-0006**, **ORD-1237-0003** (carrier `DELIVERED`/`DL` for a migrated
  dispatched fulfilment): the report is routed by `fulfilmentRef` (§3.5, §3.3), `delivered` gives `completed` with
  `dispatched` already in place (R4.4), and the order completes when all fulfilments end (R4.5). The repeated report
  changes nothing (§3.3). Keep.
- **ORD-1236-0002**, **ORD-1237-0002** (amend at 01:05 / 01:00 on 03-02 for migrated `customerActionRequired`): the amend
  is at or before D (R3.2), the unavailable fulfilment is cancelled, the order is ready at the amend time (R4.1, S5).
  Charge, shipment and reservation follow (R4.2). Keep.
- **ORD-1237-0008**, **ORD-1237-0005** (no inbound message, migrated `customerActionRequired`, no action by D): R3.2,
  "nothing counted by D": after D and by D + 60 min every fulfilment is cancelled, the order is `timedOut`, and
  `order-timed-out` is sent. Keep.

## Order where the program is wrong (not yet fixed)

- **ORD-1237-0150**, **ORD-1237-0151** (new orders, placed 2026-03-10): the majority charges, ships and completes both.
  The program reserves, then releases, then fails the fulfilment with no charge. Under SPEC-E this is wrong: every item
  reserved and no permanent error or cancel means the charge is next (R4.2 steps 1 and 2), and failure needs a step that
  ends permanently or a decline (R5.2). I could not identify the cause from what the run reports. Ruled out: a plain 503
  reserve error (the replay of the reserve and charge is correct in a scratch simulation for each result shape tried);
  the re-issue cap (the change above did not change the run); the billing `field-renamed` retries (the counts are the
  same before and after). The run reports only counts, so the actual error payloads for these orders are still needed to
  settle it.
