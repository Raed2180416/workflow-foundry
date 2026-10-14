# E-bed item E8: order fulfilment with compensation

*E-BED §3 E8, §8.1 steps 4–5; BED-CONTRACT v1.1. Built 2026-10-14, $0 (no model calls). The first E-bed item; the
generic oracle it introduced (`beds/ebed/oracle/`) is shared by every later item.*

**Status: built, not admitted.** The K1 checks that exist pass (below), including specificity: three independently
written solvers (`specificity/`, written blind to the oracle from SPEC-E and the contract) each pass **1,749/1,749**
completed cases on 16 dev worlds (seeds 1241–1244 × d2–d5; 5,247 graded, 0 false rejects, 0 critical, 0 arm errors;
`tools/specificity-run.mjs`). Still missing before admission: the oracle mutation score (≥ 0.95), the metamorphic suite
(MR1–MR13), mined latent defects (step 6), the paid triviality attack (P1) and the arm (c) reference (P2). Nothing here
is evidence about any arm.

```sh
node --test --test-concurrency=2 'beds/ebed/e8/test/*.test.mjs'          # item suite (14 tests, ~30 s)
node beds/ebed/e8/tools/health.mjs --seeds 1001-1030                      # bed health: reference runs, pools, censoring
node beds/ebed/e8/tools/controls-run.mjs --seeds 1211-1214                # controls on attack worlds
node beds/ebed/e8/tools/arm-smoke.mjs <solver.mjs> --seed 1241 --difficulty 3   # run a solver; shows no grading
node beds/ebed/e8/tools/mutate.mjs                                        # oracle mutation score (K1 >= 0.95)
```

## What the item is

One world is one shop (Hollin Retail) over 14 days at minute resolution, on the `temporal-like` platform profile.
Every case is one order: intake (`orders.create` from the inventory plan), fraud screening (pass, reject, or a human
review with a deadline), a customer action racing a deadline when items are unavailable, then one saga per
fulfilment (reserve → charge → ship), carrier collection as the pivot, carrier reports in each carrier's own
vocabulary (repeated, out of order), compensation of committed steps in reverse order on failure (declined card,
collection failure, permanent carrier failure) and on a customer cancel before collection, and the order outcome.
The spec every arm gets is `spec/SPEC-E.md` (about 6K tokens); what is in and out of scope, with source lines in
`temporalio/reference-app-orders-go@f4420d9`, is `ledger/SEMANTICS.md` (in 24, out 9).

| difficulty | adds |
|---|---|
| d1 | toy size |
| d2 | base: 3 warehouses / 2 carriers, business failures (declines, collection failures, fraud rejects), customer amend / cancel / timeout, processing cancels before and after collection, go-live backlog (orders awaiting intake, awaiting the customer, dispatched) |
| d3 | a new carrier with its own codes (from epoch 1), info codes, repeated and out-of-order carrier reports, fraud review tasks (actor noise: late, none, delegated, withdrawn, free text, form route), actions exactly at the deadline and late actions, cancels at the collection instant, duplicate placements, mistyped order refs, stray customer messages |
| d4 | an edition switch on 2026-03-08 (customer window 4 h → 2 h, fees), published three days before it takes effect |
| d5 | 2× volume, F3 on charge and refund, F4 partial reservation, F1 on charge, F6 permanent carrier failure, F5 rename of `billing.charge` `amountMinor` → `amount` |

## Files

| file | what |
|---|---|
| `spec/SPEC-E.md` | the arm-facing rulebook (R1–R7, readings S1–S6) |
| `ledger/SEMANTICS.md` | features in/out with source lines; deviations from E-BED |
| `systems.mjs` | the pinned systems (orders, inventory, billing, carrier, fraud, notify) |
| `world.mjs` | `generateWorld`, `twins` (W5 injection twin) |
| `actors.mjs` | fraud analyst answers; carriers as guarded counterparties (host H-29) |
| `transition.mjs` | `referenceTransition` (the oracle core), `recordsOf`, `canonicalArgs` |
| `controls.mjs` | bad, gaming, necessity and c-oss controls |
| `index.mjs` | the module interface (contract §2), `binding` for the host, `oracle`, `referenceRuns` |
| `tools/` | health, controls, arm smoke, mutation |
| `test/e8.test.mjs` | the item suite |
| `../oracle/view.mjs`, `grade.mjs`, `policy.mjs` | item-independent: journal index and case views, the grading machine (contract §5.3), the reference policy (§5.6) |

## Measurements ($0, dev seeds)

**Bed health** (dev 1001–1030, tail mix): 9,240 cases over 80 worlds at d2–d5. Both reference runs (earliest and
latest timing) pass every case they complete: 0 divergences, 0 oracle errors, 0 critical violations. Completed share
by epoch: ep0–ep2 100%, ep3 86–93%, ep4 (last, exempt) 38–51%, go-live 100%. Wall time per world (both runs and both
gradings): d2 0.9 s, d3 2.0 s, d4 2.6 s, d5 6–11 s.

**Controls** (attack worlds 1211–1214, d2–d5): `noop`, `echo`, `declare-every-obligation`, `escalate-everything`,
`charge-twice` and `hold-everything` fail every world. Necessity controls on their target cases:

| control (construct removed) | target cases failed |
|---|---|
| no-compensation | 100% |
| forward-order-compensation | 100% |
| no-correlation (customer messages not matched to orders) | 100% |
| edition-by-publication (edition applied from publication, not effectiveFrom) | 91–95% |
| timer-first (timeout taken at the deadline) | 83–86% |
| no-dedupe (duplicate placement recorded again) | 84–87% |
| last-signal-wins (late reports regress statuses) | 76–78% |
| no-keys (d5, F3 on charge and refund) | 57% (an F3 refund retried without a key is refused as an over-refund by billing, so only charges double) |

`c-oss`, the literal port of the reference app (no fraud check, no compensation, no processing cancel, a timer that
races the customer at the deadline), fails 52–59% of completed cases and leaves orphaned charges (critical).

**Goldens**: hand-derived failure points of the saga (cancel after 0–3 committed steps; collection failure; declined
charge; unknown charge outcome committed or not; cancel after and at the collection instant; delivery before
collection; the deadline race), each checked against the independent saga planner `beds/ebed/lib/saga.mjs` (MR11).

## Decisions and readings (for review)

| id | decision | why |
|---|---|---|
| E8-1 | Deadlines are inclusive for the party who must act and exclusive for the timeout that follows: the customer-action timeout and the review-timeout cancel are due strictly after the deadline (S1) | an action exactly at the deadline counts, so a timeout taken at the deadline cannot know whether one is arriving; this also makes the timer-first defect detectable on every timeout, not only on planted ties |
| E8-2 | Each edition publishes `edition.json` with its `effectiveFrom`; the edition in force is the published one with the latest `effectiveFrom` on or before the placement date (R1.3) | found by a specificity author: the first version gave arms no effective dates |
| E8-3 | Carriers are guarded counterparties (host 1.2.0, H-29): a collection happens only if the shipment is still booked at the collection run | otherwise a shipment cancelled before collection would still be "collected" by pre-scheduled events |
| E8-4 | Collection is a daily run per location with a 30-minute cut-off (R4.3) | makes the pivot a rule an arm can reason about, not a hidden timer |
| E8-5 | Same-instant knowledge in the grader: a withdrawal at instant t does not apply to a row emitted earlier (in flight) or at t by a call that had not been given an event of the case at t | a call cannot react to an event delivered to another instance in the same round; known leniency: such a row may satisfy a withdrawn lid (documented in `oracle/grade.mjs`) |
| E8-6 | The latest-timing reference acts 10 minutes before each window closes (`LATE_SLACK`) | a fault (F3, F4) inside the window needs retry room for any arm acting late; acting at the latest minute made fault cases censored |
| E8-7 | Permanence of a failed step is read from the ledger's error code (402, `permanent`) | ledger rows keep code and reason only |
| E8-8 | Customer cancels never meet out-of-order carrier reports in generated worlds | the cancel race is decided by reports (R6.2); a physically collected parcel whose report is late would make a counting cancel unexecutable |
| E8-9 | No sweeps: E8 is per-instance only (E-BED §7: cross-run state ○) | no rule needs cross-case work |
| E8-10 | Carrier collection is judged by the report's `reportedAt`, not its arrival (S7) | found by specificity: out-of-order reports arrive after later ones but state when the parcel moved |
| E8-11 | A cancel after a counted amend falls under R6.2, not R3.2 (S8; class `amend-then-cancel`, d3+) | found by specificity: the first spec left a cancel following an amend unclassified |
| E8-12 | Steps a counted cancel or customer action supersedes before they were due are not required but stay permitted (S9: R3.1 lids at the action, R4.1 processing lids at the abort) | found by specificity (S2 4/878 false rejects on cancel-processing): a solver that never set `processing` because the cancel came first was rejected |
| E8-13 | Goldens are a module (`golden.mjs`, 24 rule-cited cases) run by the item suite and against every oracle mutant | one set of hand-derived expectations for both the oracle's self-check and mutation killing |

Deviations from E-BED §3 E8 are listed in `ledger/SEMANTICS.md`.
