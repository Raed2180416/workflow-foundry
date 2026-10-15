# E-bed item E8: order fulfilment with compensation

*E-BED §3 E8, §8.1 steps 4–5; BED-CONTRACT v1.1. Built 2026-10-14, $0 (no model calls). The first E-bed item; the
generic oracle it introduced (`beds/ebed/oracle/`) is shared by every later item.*

**Status: built, not admitted.** The K1 checks that exist pass (below), including specificity: three independently
written solvers (`specificity/`, written blind to the oracle from SPEC-E and the contract) each pass **1,749/1,749**
completed cases on 16 dev worlds (seeds 1241–1244 × d2–d5; 5,247 graded, 0 false rejects, 0 critical, 0 arm errors;
`tools/specificity-run.mjs`; after the 2026-10-15 oracle changes, the short set 1241–1242 × d3, d5 gives 1,701/1,701,
0 critical, 0 arm errors). Oracle mutation score under one differential standard (`ledger/MUTANTS.md`, evidence in
`ledger/mutants-20261015/`): 240/304 = 0.789 raw, 1.000 with the 64 grader-equivalent mutants excluded; `tools/mutate.mjs`
now measures the same standard: measured 240/304, and its 64 survivors are exactly the ledger's equivalents. Metamorphic relations MR1–MR13 (`metamorphic.mjs`, below) hold on the
unmutated oracle except two MR5 variants that need the owner (a same-instant duplicate placement of a review order: a
contract gap; a repeated refused cancel: an R6.3 reading); against the 304 mutants they kill 77, all inside the ledger's
240, and none of the 64 equivalents, so the raw score stays 240/304. Still missing before admission: K1's mutation score
(≥ 0.95 raw needs the owner's call on equivalents in the denominator), mined latent defects (step 6), the paid
triviality attack (P1) and the arm (c) reference (P2). Nothing here is evidence about any arm.

```sh
node --test --test-concurrency=2 'beds/ebed/e8/test/*.test.mjs'          # item suite (includes the metamorphic file)
node --test --test-concurrency=1 beds/ebed/e8/test/metamorphic.test.mjs  # MR1-MR13 alone (21 tests, ~100 s, one core)
node beds/ebed/e8/tools/health.mjs --seeds 1001-1030                      # bed health: reference runs, pools, censoring
node beds/ebed/e8/tools/controls-run.mjs --seeds 1211-1214                # controls on attack worlds
node beds/ebed/e8/tools/arm-smoke.mjs <solver.mjs> --seed 1241 --difficulty 3   # run a solver; shows no grading
node beds/ebed/e8/tools/mutate.mjs                                        # oracle mutation score (K1 >= 0.95)
node beds/ebed/e8/tools/mr-mutants.mjs --equivalents                     # the relations against mutate.mjs's mutants
node beds/ebed/e8/tools/defects-mine.mjs --date 2026-10-15               # latent defects from reference mutants (step 6)
node --test beds/ebed/e8/test/defects.test.mjs                           # re-executes one E0 rejection and one manifest
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
| `spec/SPEC-E.md` | the arm-facing rulebook (R1–R7, readings S1–S15) |
| `ledger/SEMANTICS.md` | features in/out with source lines; deviations from E-BED |
| `systems.mjs` | the pinned systems (orders, inventory, billing, carrier, fraud, notify) |
| `world.mjs` | `generateWorld`, `twins` (W5 injection twin) |
| `actors.mjs` | fraud analyst answers; carriers as guarded counterparties (host H-29) |
| `transition.mjs` | `referenceTransition` (the oracle core), `recordsOf`, `canonicalArgs` |
| `controls.mjs` | bad, gaming, necessity and c-oss controls |
| `index.mjs` | the module interface (contract §2), `binding` for the host, `oracle`, `referenceRuns` |
| `tools/` | health, controls, arm smoke, mutation |
| `test/e8.test.mjs` | the item suite |
| `test/unit-checks.mjs` | transition unit checks the grader cannot see (not goldens; `mutate.mjs` never runs them) |
| `ledger/MUTANTS.md`, `ledger/mutants-20261015/` | the oracle mutants under one standard, and the harness and data behind every verdict |
| `metamorphic.mjs`, `test/metamorphic.test.mjs` | E-BED §9.3 MR1–MR13 on the oracle and the reference policy: transformations, arm wrappers (MR6, MR13), the saga-planner check (MR11) |
| `tools/mr-mutants.mjs`, `ledger/mr-mutants-20261015.json` | the relations against `mutate.mjs`'s 304 mutants (its operator set read from its text; its scoring untouched) |
| `defects.mjs`, `tools/defects-mine.mjs`, `test/defects.test.mjs` | E-BED §2.10 / §9.5 latent defects: reference mutants (the policy driven by `mutate.mjs`'s transition edits, plus §3's hand candidates as policy variants) run as the arm against the original oracle; executed E0-silence check; planned true and false revealing events |
| `ledger/latent-defects/` | one manifest per admitted latent defect (`ld-*.json`) and `index.json` (every mutant's status, counts, digests of the files the run rests on) |
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
With the survivor goldens of the oracle mutation work, `golden.mjs` holds 48 rule-cited goldens, each asserting only
outcomes the grader can see; 14 transition checks the grader cannot see are unit checks (`test/unit-checks.mjs`). Which
golden kills which mutant, with a witness journal, is in `ledger/MUTANTS.md`.

**Metamorphic relations** (E-BED §9.3; `metamorphic.mjs`, `test/metamorphic.test.mjs`; dev seeds 1024–1133, d2–d5,
12–20 orders). Each relation runs in two flavours on a source world W and its follow-up T(W): *oracle* (both reference
runs and five controls, driven by the original transition, run on W and T(W); the transition under test grades both;
per-case verdicts, first divergences with layer, code, lid and time, ends, critical violations and open lids must agree
modulo T) and *reference* (the reference policy driven by the transition under test; per-case ledger rows and final
records must agree). The carriers are carried through T (`adaptActors`), because `actors.mjs` is not itself invariant
(below). Suite: 21 tests, 17 pass, 4 todo (the findings below), about 100 s on one core.

| MR | E8 | what is checked |
|---|---|---|
| MR1 | implemented | order, fulfilment and event ids renamed order-preserving (SPEC-E §1 orders deliveries by id); customers, e-mails, SKUs, locations, carriers, analysts order-reversing |
| MR2 | implemented | amounts ×10 and ×1000; E8 has no amount tolerances, so that half is N/A |
| MR3 | implemented | every time and date shifted ±1 and +52 weeks (no DST crossing; the world writes fixed +01:00); 24×7 calendar, so business-elapsed = elapsed |
| MR4 | implemented | each (instant, source) group of world arrivals with several cases delivered in reverse case order (worlds 1024, 1032, 1044, 1053 have such groups); within a case the order is spec (S4, S12, S13) |
| MR5 | implemented | every world arrival and carrier report delivered twice in its instant; placed orders and carrier reports repeated 7 min later; customer actions repeated 7 min later |
| MR6 | implemented | the arm asks for extra wake-ups halfway to its own next one |
| MR7 | implemented | two copies of existing orders added at the same instants; every original case unchanged |
| MR8 | degenerate | windows are calendar minutes on a 24×7 calendar (SPEC-E §1): the E-BED form (deadline + 1 business day) is N/A; only "a holiday changes nothing" |
| MR9 | implemented | an edition taking effect after the last placement (every table changed), published inside the horizon |
| MR10 | analog | no tolerances, limits or holds in E8; analog: halving `customerActionHours` grows the timedOut set monotonically and leaves orders without an unavailable fulfilment unchanged |
| MR11 | implemented | F6 on reserve, charge and booking, a collection failure, cancels 1, 2, 3 and 45 min after placement: committed compensations against `lib/saga.mjs` (ledger), and the expectation just before the first compensation (oracle) |
| MR12 | implemented | an instruction line in every order document (E8's only free text), world identity kept |
| MR13 | emulated | the host has no world-level mode (a change to frozen `beds/ebed/host`); `worldLevelArm` decides every instance of a round in one pass over the round-start journal: identical journal |

Fails on the unmutated oracle (todo tests carrying the finding; for the owner):

- **MR5, a placement and its duplicate in one instant, review order** (contract gap, not an oracle bug). Both start an
  instance in one round; neither has declared its subject at the round start, so neither can merge; keyed effects are
  deduplicated by the platform, human tasks are not, so the order gets two fraud-review tasks, which R2.2's re-ask
  window permits (`transition.mjs:164`, no reason checked) and the analyst answers at different times. The generator
  never delivers a duplicate in the original's instant. Options: exclude it from the world contract, or key tasks.
- **MR5, a repeated cancel that does not count** (R6.3 reading; probable oracle leniency). Every refused cancel
  re-declares `ntf:O:cancel-refused` (`transition.mjs:242`) and `lid()` keeps the last window (`:101`), so a repeat 7
  minutes later moves the window: an answer up to 7 minutes late for the first cancel passes, a missing one is
  reported later. Under "repeats change nothing" (R3.2) and "each notification exactly once" (§4.8) the first
  refused cancel's window should hold. Witness: 1124:d5:12, o0010.

Diagnostics (world code, not the oracle): `world.mjs:335` — a line comment swallows `item, seed, split, difficulty,
schedule, mix, scale, track` of the world object (since d0237bf), so `twins()` throws; a working twin would still get its
own `world.id`, which keys the actors' and noise draws (MR12 uses `injectDocs` instead). `actors.mjs` keys carrier draws
by fulfilment id, looks codes up in the constant `CARRIER_CODES` by carrier name and places reports with `world.mjs`'s
`iso()`/`collectionRuns()` anchored to the constant T0, so only generator-made worlds are consistent.

Against `tools/mutate.mjs`'s 304 mutants (`tools/mr-mutants.mjs`, `ledger/mr-mutants-20261015.json`; the 64
equivalents with every case, both flavours and both timings; the other 240 with the first case of each relation): the
relations kill **77**, all within the ledger's 240 killed, **none of the 64 equivalents**; k74 and k202 do not load.
Per relation: MR11 65, MR3 6, MR7 6, MR13 4 (exceptions only: world-level mode correlates failures), MR1 3, MR5 3,
MR6 1, MR9 1, MR10 1, and MR2, MR4, MR8, MR12 none (MR8 and MR12 cannot: the transition reads neither calendars nor
documents). 53 kills are MR11's alone; 8 of the 77 come only through exceptions.

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
| E8-14 | One differential standard for oracle mutants (`ledger/MUTANTS.md` §0): a mutant is compared with the original as the grader reports verdicts (first divergence, else passed or open) on reachable journals, frozen as the grader freezes; killed only with a witness journal on a golden's input or a corpus difference; otherwise *equivalent (grader)*, with the reason | review (2026-10-15): 7 claimed kills came only from inputs the grader never reads (k53, recordsOf), while others with the same property were called equivalent |
| E8-15 | The delivery order is part of SPEC-E (§1; S4 and S7 amended): within an instant, by `source` then id, so a carrier report reaches the arm before a customer action of its instant | S4 ("the collection wins") and S7 ("as far as reports have reached you") only agree under it; k146 and k150 are equivalent by it |
| E8-16 | S10, same-instant knowledge per message: a step counts as taken before a message if taken at an earlier instant, or in the same instant by a call not given that message. Implemented in the transition (`before`) and in the grader (`oracle/view.mjs` records `given` per call; `oracle/grade.mjs` exempts a same-instant row from a withdrawal caused by a delivery its call was not given). Supersedes E8-5's "an event of the case" for delivered causes | the old N1 rule was not in SPEC-E, and the per-case rule rejected a step from a call that was given another message about the order but not the cancel (regression test in `test/e8.test.mjs`) |
| E8-17 | S11: an order is processing from the instant it is ready, inclusive; a customer action delivered before the order it names was placed names no order yet. The transition ignores customer actions delivered before the first `order.placed` | k140's kill rested on a cancel at p, which the host delivers before the placement (`customer-portal` < `shop`): the arm cannot know the order then. Known limit: a call that answers such an action with an effect is graded against the order's subject (unreachable in generated worlds) |
| E8-18 | S12: a review answer and a cancel in one instant: the answer decides first (approve: an R6.2 cancel; reject: R2.2, the cancel changes nothing) | former A1 (k102, k105, k107); matches the transition |
| E8-19 | S13: endings and failures in a cancel's instant are judged by what reached the arm first: a carrier report of that instant came first (a delivery that ends the order: the cancel changes nothing; a collectionFailed: the fulfilment fails); a failed attempt in that instant did not (its result arrives a minute later). The transition now judges a failure by when it reached the arm (`failSeen`) and an ended order with `<=` | former A2/A3 (k176, k177, k185). The old time-only rule cancelled a fulfilment whose collectionFailed the arm had already acted on in its round-1 call, before the cancel reached it in round 3: not a rule an arm can follow |
| E8-20 | S14: a step of a failing fulfilment that commits after the failure is compensated within 120 min of its commit, and the fulfilment's compensation, status and notice within 120 min of the later of failure and commit | former A4 (k230); matches the transition (as R6.2 for a cancel); unreachable on graded trajectories (R4.2 sequencing) |
| E8-21 | Oracle defect D1 fixed: after a counted cancel, a shipment the carrier reports `collectionFailed` has the record `failed` (was `created`) | R7.1; reachable only after a missed shipment cancel, so the grader never compared it; golden `cancel-before-a-collection-failure (R6.2, R7.1)` |
| E8-22 | Goldens pin "after the deadline" (S1) as a window opening in (D, D + 1 min] with an effect exactly at D outside it, not the 1-second encoding | review: two goldens pinned `D + 1000 ms` |
| E8-23 | S4, S7 and S13 are stated in delivery terms: "the same instant" is the instant a report is delivered; S7 judges collection on the reports delivered before the cancel, using `reportedAt` only for "collected at or before the time of the cancel" | re-review: §3.3 calls `reportedAt` a report's time, so "a report with the same time as the cancel always reaches you first" was false for a held-up or repeated report. The transition already judged by delivery |
| E8-24 | SPEC-E §3.3 states the world contract of E8-8 to the arm: carriers never hold up the reports of an order the customer cancels while it is processing, so every collection before such a cancel has been reported. `ledger/MUTANTS.md` §0 and `SEMANTICS.md` use the same contract; k153 is equivalent (contract) and the S7 golden on a held-up report is a unit check | re-review: on a held-up collection with a cancel the transition required a shipment cancel the carrier refuses (409 already-collected) and a `cancelled` shipment record the carrier never writes, while §0 called that input reachable. The alternative (a reading for a refused shipment cancel) would change every counting cancel's sequencing for an input the generator never produces |
| E8-25 | S15 (S12 amended): an order counts as cancelled from the moment a rule decides it (R2.1 reject, R2.2 reject or review deadline, a counted cancel under R3.2, R6.2 or R6.4, an amend that leaves nothing available); every later cancel changes nothing and `cancel-refused` is allowed. Grader fix: the transition (`refuseLater`) permits it; golden `a-cancel-after-the-cancellation-is-decided (S15)` and the reject half of the S12 golden | re-review: after a fraud reject an arm following R6.3 was graded outside-allowed, while S13 allowed `cancel-refused` in its parallel case. Also closes N3 (a repeat cancel after a counted cancel while waiting) |
| E8-26 | S12: after an approve the order is ready only without an unavailable fulfilment; otherwise the cancel is a customer action under R3.2. S11: a customer action delivered before its order's placement is answered with nothing (close the instance) and no `unknown-order` | re-review; both state what the transition already does. Known limit N6: such a call is graded against the order's subject, so a wake-up or an effect in it diverges (unreachable in generated worlds) |
| E8-27 | The forward steps of a fulfilment are judged against the message that cut them (S10 with S13): the counted cancel when it aborted the fulfilment, its collectionFailed report when that is the failure, the call's case knowledge for a failed attempt (`cutCause`); `evAt` (instant → cancel) is gone | re-review: in a cancel's instant a non-aborted fulfilment's steps were judged against the cancel. Unreachable on graded trajectories; unit check `forward-step-cut-judged-against-its-own-message` |
| E8-28 | Goldens assert only spec-stated outcomes the grader can see; the 14 transition checks it cannot see (a lid named twice, whether a taken step stays named, windows only a second commit or a step after a stop can move, records never compared, an input outside the world contract) are unit checks. A mutant is killed when (a golden fails it and a reachable witness journal shows a verdict difference) or (the corpus differential shows one); witnesses must pass the host's carrier and system refusals | re-review: `mutate.mjs` counted 25 grader-equivalent mutants (k17 included) through unit checks, and "killed" was defined as two conditions that both hold while 42 kills rested on the corpus alone. The stricter witness check demoted k221 (its witness committed a shipment cancel at the collection run, which the carrier refuses); four goldens now use real collection runs |
| E8-29 | The evidence for `ledger/MUTANTS.md` is in the repository (`ledger/mutants-20261015/`: harness, matrices, witnesses, corpus differential, classification, corpus digest) and `tools/mutate.mjs` was run on the final files | re-review: the classifications existed only in a session scratchpad and the score was expected, not measured |

Deviations from E-BED §3 E8 are listed in `ledger/SEMANTICS.md`.
