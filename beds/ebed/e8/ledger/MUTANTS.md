# E8 oracle mutants: one standard, 304 mutants

This is development and diagnostic evidence ($0, no model calls). The base is `ledger/mutation-20261014.json`, written
by `tools/mutate.mjs` at commit `4016358`: 301 mutants of `transition.mjs`, 192 killed (103 by goldens, 86 by the corpus,
3 by errors), 109 survivors, score 0.638.

**Revisions.** The first revision of 2026-10-15 answered a review with six defects (D1, the per-message rule S10, the
placement rule of S11, the delivery-order rule of S13; one differential standard). This second revision answers the
re-review of the same day. In short:

| re-review item | what changed |
|---|---|
| S4, S7, S13 mixed report time and delivery time | SPEC-E S4, S7 and S13 are stated in delivery terms; `reportedAt` is used only in S7's "reported collected at or before the cancel" test. Spec text only: the transition already judged by delivery |
| §0 called held-up reports with a customer cancel reachable | The world contract now says it (SPEC-E §3.3, `SEMANTICS.md`, §0 below): held-up reports never meet a customer cancel of a processing order (E8-8, made explicit). **k153** becomes equivalent (contract); its golden became a unit check. Every equivalent verdict stands (narrowing the inputs cannot separate a mutant) and every kill was re-witnessed under the narrower contract (§0) |
| S12 left cancel-refused open after a fraud reject | Reading **S15** (and S12 amended): once a rule has decided that the order is cancelled, a later cancel changes nothing and `cancel-refused` is allowed. The transition permits it after every decided cancellation (R2.1, R2.2, R3.2, R6.2, R6.4), which also closes open item N3. Golden `a-cancel-after-the-cancellation-is-decided (S15)`; new mutants **k302** and **k303** are killed |
| S12 (approve with an unavailable fulfilment) and S11 (unknown-order) | S12 sends the cancel to R3.2 when the order has an unavailable fulfilment; S11 says explicitly to answer a pre-placement action with nothing, close, and send no `unknown-order`. Both state what the transition already does |
| "Killed" defined as two conditions that both hold | §0: killed = (a golden fails it **and** a witness journal shows a verdict difference) **or** (the corpus differential shows one) |
| the evidence existed only in a session scratchpad | `ledger/mutants-20261015/`: the harness, its outputs and a digest of the corpus (§6). `tools/mutate.mjs` was run: the measured score is next to the expected one (§1) |
| goldens checked things the grader cannot see | The 14 such checks moved out of `goldens` into `test/unit-checks.mjs` (run by the item suite, never by `mutate.mjs`). No golden now fails a grader-equivalent mutant, so `mutate.mjs` measures the ledger's standard (§1) |
| the forward-step cut was keyed by instant | `cutCause`: a fulfilment's forward steps are judged against the message that cut them (the cancel, or its collectionFailed report); `evAt` is gone. Unit check `forward-step-cut-judged-against-its-own-message`; new mutant **k301** is equivalent (stopped) |

Two findings of this revision's own re-check:

- **Witness reachability was too loose.** The witness harness checked only the carriers' reports. It now also enforces
  the host's refusals (`harness/consistent.mjs`): a shipment cancel at or after the collection run cannot commit (the
  carrier collects in the host's phase 0, before any call of that instant), and `release`, `refund`, `carrier.create`,
  `carrier.cancel` and `setStatus` commit only when the systems would accept them. **k221** loses its 2026-10-14 witness
  (a shipment cancel committed at R) and is equivalent (contract), like k17. Four goldens put carrier reports at times
  that are not collection runs (`cancel-at-collection-refused`, `cancel-after-collection-refused`,
  `collection-failure-refund-then-release`, `delivery-before-collection-report`); they now use the real run. The S13
  two-fulfilment golden now books both fulfilments, F1 at the location that collects first.
- **k14 and k37 needed a reachable golden.** k14 (the collection run read from another location) is visible only when
  another location collects inside the cancel's 60 minutes; the generator never times a cancel there (`blocked` in
  `world.mjs`). New golden `shipment-cancel-window-at-its-own-location (R4.3, R6.2)`. k37's only golden assertion moved
  to the unit checks; the steps-before golden gained part E6 (`processing` set at a later instant than the cancel is
  permitted, not required), which the grader sees when the lid re-opens.

The mutant set stays **index-stable**: `harness/gen.mjs` on the current source gives 304 mutants; k0–k300 have the same
operator at the same expression as on 2026-10-14 (k176, k177 and k185 inverted by the first revision, as noted then;
`tools/mutate.mjs`'s `before(row, cut)` operator now also matches `before(row, cut, cutEv)`, so k192 is the same
mutant). The helpers added here (`cutCause`, `refuseLater`) sit at the end of `transition.mjs`, so their mutants are
k301–k303. Line numbers below are the current source's.

## 0. The standard (one, for every mutant)

**What is compared.** The original and the mutant are compared as the grader reports them (`oracle/grade.mjs`
`gradeCase`, at every processing point). The grader stops at the first divergence or oracle error, and it compares
records only for complete, divergence-free cases. Per case the verdict is the first divergence (layer/code/lid, as
`mutate.mjs` keys it), or else passed or still open, or an oracle error. Changes in an expectation that never reach a
verdict do not count: a lid listed twice, whether a lid the arm already satisfied stays named, a window no arm can use,
records the grader never compares.

**Reachable input.** A journal the host can write for some arm on some world of this item's world contract:
- **Any arm behaviour**, within what the systems accept.
- **Host semantics.**
  - Delivery within an instant by (source, id) (SPEC-E §1).
  - An effect is applied in the instant it is emitted; its result arrives one minute later.
  - Platform retries keep the key; a re-issued committed key is deduplicated, not committed again.
  - The systems' refusals (`systems.mjs`): a second active reservation, a release without one, a refund without a
    charge or above it, a booking while a shipment is live, a shipment cancel without a shipment or once it was
    collected or failed (409). The carrier collects (or fails to) in the host's phase 0, before any call of that instant.
  - Carriers are guarded (H-29). They report in order, or hold reports up (W2, delivery first), **but never for an order
    that gets a customer cancel while it is processing** (SPEC-E §3.3, E8-8, E8-24).
  - One migration per go-live case, before t0.
- **World invariants.** Ids are unique within their lists; edition intervals are disjoint; one allocation per order;
  the horizon is 14 days.

The generator's class mix and timing are a sample, not a limit (a review order that gets a customer cancel, a failure
in a cancel's instant, a cancel shortly before another location's collection run are reachable although no dev world
has one). The held-up-report exclusion above is a stated contract, not a sample property.

**Killed** means either:
1. a golden that passes the original fails the mutant **and** a witness journal shows a different verdict, or
2. the corpus differential shows a different verdict on a graded case.

A **witness** starts from a golden's history (any golden) and completes it with a conforming arm (each named lid at its
earliest, after its predecessors). It then moves one step to a window boundary (±1 min), skips one, or adds one
permitted pattern, and is graded at two horizons. Every candidate must pass `harness/consistent.mjs` (carriers and
systems as above); the carriers' shipment writes are included. The hand-built witnesses of the first revision
(`harness/manual*.mjs`: k77, k123, k241) still hold; the search now finds k77 and k241 itself, so only k123 rests on a
hand-built one. An import failure (k74, k202) is killed.

The **corpus differential** grades every case of 151 journals on 7 dev worlds (1009:3, 1010:5, 1011:4, 1012:2, 2002:4,
1013:5, 1015:3) under the original and the mutant: both reference runs, every control, the 3 specificity solvers and the
3 `b1lh-e8` solvers (model-written; run out of process in the sandbox arm). That is 11,083 case gradings per mutant.

**Equivalent (grader)** means no reachable input gives a different verdict: no golden fails it (§5: goldens assert only
what the grader can see), the corpus differential shows 0 differences, and a one-line argument says why. The kinds:

| kind | meaning |
|---|---|
| contract | only inputs outside the world contract or the host semantics separate the two |
| consumed | the grader never reads the difference |
| satisfied | the difference is only whether a lid is still named, and the arm's own committed row already satisfied that lid. The grader keeps a satisfied lid satisfied, whether or not later expectations name it |
| stopped | the difference arises only after the grader has stopped at an earlier divergence of the same journal |
| code | dead code, or the same value |
| harness | in `canonicalArgs`, which `mutate.mjs` never swaps in (H1) |

## 1. Result

| verdict | the 109 survivors of 2026-10-14 | the 192 killed then | k301–k303 | all 304 |
|---|---|---|---|---|
| killed | 48 | 190 | 2 | **240** |
| equivalent (grader: contract) | 23 | 1 (k221) | 0 | 24 |
| equivalent (grader: consumed) | 12 | 0 | 0 | 12 |
| equivalent (grader: stopped) | 10 | 1 (k17) | 1 (k301) | 12 |
| equivalent (grader: satisfied) | 7 | 0 | 0 | 7 |
| equivalent (grader: code) | 7 | 0 | 0 | 7 |
| equivalent (grader: harness) | 2 | 0 | 0 | 2 |
| **total** | 109 | 192 | 3 | 304 |

The 240 kills: 184 by a golden with a witness (one hand-built, k123), 54 by the corpus differential, 2 import errors. Against the
first revision: **k153** (contract, §3.3) and **k221** (no reachable witness) moved from killed to equivalent; k14 and
k37 stay killed on new golden parts; k145, k148, k185 and k241 are re-witnessed on goldens with real collection runs.

| formula | value |
|---|---|
| one standard, raw (killed / all) | 240 / 304 = **0.789** (the 301 of 2026-10-14 alone: 238 / 301 = 0.791) |
| one standard, equivalents excluded (E-BED §9.5: "each survivor is equivalent or gets a new golden") | 240 / (304 − 64) = 240 / 240 = **1.000** |
| `tools/mutate.mjs`, expected (a golden fails it, it does not load, or its 4-world corpus differs on a completed case) | 240 / 304 = 0.789 |
| `tools/mutate.mjs`, **measured** (36 min, `mutants-20261015/data/mutate-measured.json`) | 240 / 304 = **0.789**: 184 by goldens, 53 by its corpus, 3 errors (k74 and k202 do not load; one corpus kill throws while grading); 64 survivors |

The measured run agrees mutant for mutant: its 64 survivors are exactly the 64 equivalents above. No golden fails a
grader-equivalent mutant, and every corpus kill differs on a completed case of the four worlds `mutate.mjs` builds, so
the tool now measures this standard. The raw formula cannot reach K1 (0.95) while the 64 equivalent
mutants stay in the operator set; whether K1 counts equivalents in the denominator remains the owner's decision. Under
the second formula nothing is left to kill.

## 2. The survivors, the changed verdicts and the new mutants

The 109 survivors of 2026-10-14, the two 2026-10-14 kills that are now equivalent (k17, k221), and k301–k303. Evidence:
`golden …; witness on …: original vs mutant` (`D:layer/code/lid` a first divergence, `PASS`, `OPEN` open at the horizon,
`E` an oracle error; order ids shortened), or the corpus result. For equivalents the unit check that still pins the
transition is named.

| k | line | verdict | reason (one line) | evidence |
|---|---|---|---|---|
| 1 | 16 | equivalent (grader: contract) | `<=` in `sortBy` reorders only equal keys: a SKU or fulfilment id listed twice in one list, which the world contract excludes (D3 stays open) | no golden fails it; corpus 0 in 11083 |
| 2 | 16 | equivalent (grader: contract) | `>=` in `sortBy`: as k1 | no golden fails it; corpus 0 in 11083 |
| 4 | 21 | equivalent (grader: harness) | the guard of `canonicalArgs`, which `mutate.mjs` never swaps in (H1); the transition calls it with an object only | no golden fails it; corpus 0 in 11083 |
| 7 | 22 | equivalent (grader: harness) | other ops in `canonicalArgs` (H1); no other op has those arrays | no golden fails it; corpus 0 in 11083 |
| 13 | 34 | equivalent (grader: contract) | `findLast` over editions: edition intervals are disjoint, so at most one matches | no golden fails it; corpus 0 in 11083 |
| 15 | 41 | equivalent (grader: contract) | `findLast` over locations: location names are unique | no golden fails it; corpus 0 in 11083 |
| 16 | 45 | equivalent (grader: contract) | the run loop to day 40: a run is found by day 15 (bookings end before the 14-day horizon) | no golden fails it; corpus 0 in 11083 |
| 17 | 47 | equivalent (grader: stopped) | a booking exactly cut-off minutes before a run is collected a day later: the extra shipment-cancel window starts at the real run, where the carrier collects before any call of that instant and refuses the cancel (409), so the verdict is the same `missed csh`, reported later | no golden fails it; corpus 0 in 11083; unit check `collection-cutoff-boundary` fails it |
| 21 | 52 | equivalent (grader: contract) | `findLast` over carrier codes: (carrier, code) is unique in an edition | no golden fails it; corpus 0 in 11083 |
| 29 | 78 | equivalent (grader: contract) | `findLast` over fees: one fee row per location | no golden fails it; corpus 0 in 11083 |
| 31 | 79 | equivalent (grader: contract) | `findLast` over the catalog: SKUs are unique | no golden fails it; corpus 0 in 11083 |
| 33 | 80 | equivalent (grader: contract) | `findLast` over customers: customer ids are unique | no golden fails it; corpus 0 in 11083 |
| 35 | 81 | equivalent (grader: contract) | `findLast` over allocations: one allocation per order | no golden fails it; corpus 0 in 11083 |
| 36 | 85 | killed | a step by the call that was given the cancel counts as before it (S10) | golden `steps-before-vs-after-a-processing-cancel`; witness on `steps-before-vs-after-a-processing-cancel`: D:2/outside-allowed/ vs D:3/missed/ost:0007:processing |
| 37 | 85 | killed | a step at a later instant from a call not given the cancel counts as before it (S10): `processing` set after the cancel is required again | golden `steps-before-vs-after-a-processing-cancel`; witness on `steps-before-vs-after-a-processing-cancel`: D:2/outside-allowed/ vs D:3/missed/ost:0007:processing |
| 38 | 85 | killed | both of k36 and k37 (S10) | golden `steps-before-vs-after-a-processing-cancel`; witness on `steps-before-vs-after-a-processing-cancel`: D:2/outside-allowed/ vs D:3/missed/ost:0007:processing |
| 39 | 85 | equivalent (grader: satisfied) | nothing counts as before: only lids that the arm's own earlier (or in-flight) rows satisfied stop being named; the grader keeps a satisfied lid satisfied | no golden fails it; corpus 0 in 11083; unit check `steps-before-vs-after-a-processing-cancel: taken steps and their naming` fails it |
| 40 | 86 | equivalent (grader: satisfied) | `matches` never sees the arm's setStatus: as k39 for S9 statuses taken before the cancel | no golden fails it; corpus 0 in 11083; unit check `steps-before-vs-after-a-processing-cancel: taken steps and their naming` fails it |
| 41 | 86 | equivalent (grader: satisfied) | as k40 | no golden fails it; corpus 0 in 11083; unit check `steps-before-vs-after-a-processing-cancel: taken steps and their naming` fails it |
| 42 | 86 | equivalent (grader: satisfied) | as k40 | no golden fails it; corpus 0 in 11083; unit check `steps-before-vs-after-a-processing-cancel: taken steps and their naming` fails it |
| 53 | 102 | equivalent (grader: consumed) | a lid at index 0 is required twice: the grader merges lids by id (same window here); the golden's duplicate-lid check is a unit check | no golden fails it; corpus 0 in 11083; unit check `awaiting-amend-nothing-available: no lid named twice` fails it |
| 62 | 123 | equivalent (grader: contract) | the action comparator ties when `at` is equal: views list events in seq order with `at` nondecreasing | no golden fails it; corpus 0 in 11083 |
| 64 | 125 | killed | go-live migration reports ignored, so a cancel after a pre-go-live collection counts (§3.5, R6.3, S7) | golden `go-live-collected-refuses-cancel`; witness on `go-live-collected-refuses-cancel`: OPEN vs D:2/outside-allowed/ |
| 65 | 126 | killed | the migration lookup picks a non-migration event | golden `go-live-collected-refuses-cancel`; witness on `go-live-collected-refuses-cancel`: OPEN vs D:2/outside-allowed/ |
| 66 | 126 | equivalent (grader: contract) | `findLast` migration: one migration per go-live case | no golden fails it; corpus 0 in 11083 |
| 67 | 127 | killed | the migration's carrier reports are skipped | golden `go-live-collected-refuses-cancel`; witness on `go-live-collected-refuses-cancel`: OPEN vs D:2/outside-allowed/ |
| 76 | 144 | killed | create items from the allocation, not as placed (R1.1); a split SKU is a legal allocation | golden `create-items-as-placed-not-as-allocated`; witness on `create-items-as-placed-not-as-allocated`: OPEN vs D:2/outside-allowed/ |
| 77 | 144 | killed | a later placement of the same order (other items) changes the create (R1.4); witness: it arrives before the arm records the order | golden `duplicate-placement-changes-no-items`; witness on `duplicate-placement-changes-no-items`: OPEN vs D:2/outside-allowed/ |
| 78 | 144 | equivalent (grader: code) | dead branch: gl-dispatched implies `pre.created` | no golden fails it; corpus 0 in 11083 |
| 80 | 151 | killed | a go-live intake order is cleared whatever its verdict (§3.5, R2.1) | golden `go-live-intake-fraud-reject-cancels`; witness on `go-live-intake-fraud-reject-cancels`: PASS vs D:2/outside-allowed/ |
| 88 | 156 | equivalent (grader: contract) | the review-task comparator: as k62 | no golden fails it; corpus 0 in 11083 |
| 89 | 157 | killed | the review deadline runs from the last task (R2.2, S3) | golden `review-first-task-and-first-answer-decide`; witness on `review-first-task-and-first-answer-decide`: PASS vs D:2/early/fst:0008-F1:cancelled |
| 90 | 159 | killed | an amend is taken as the R6.4 cancel | golden `review-open-amend-changes-nothing`; witness on `review-open-amend-changes-nothing`: OPEN vs D:3/missed/fst:0008-F1:cancelled |
| 91 | 159 | killed | the last cancel anchors R6.4 | golden `review-open-first-cancel-counts`; witness on `review-open-first-cancel-counts`: D:3/missed/fst:0008-F1:cancelled vs OPEN |
| 92 | 160 | killed | R6.4 window 120 min | golden `review-open-first-cancel-counts`; witness on `review-open-first-cancel-counts`: D:3/missed/fst:0008-F1:cancelled vs OPEN |
| 99 | 167 | equivalent (grader: contract) | the answer comparator: as k62 | no golden fails it; corpus 0 in 11083 |
| 100 | 168 | killed | the last usable answer clears the order (R2.2) | golden `review-first-task-and-first-answer-decide`; witness on `review-first-task-and-first-answer-decide`: D:3/missed/ost:0008:processing vs D:2/outside-allowed/ |
| 101 | 169 | killed | a cancel exactly at the review deadline no longer counts (R2.2, S1) | golden `review-open-first-cancel-counts`; witness on `review-open-first-cancel-counts`: PASS vs D:2/early/fst:0008-F1:cancelled |
| 102 | 169 | killed | a cancel in an answer's instant, delivered after it, counts as R6.4 (S12 says the answer decides first) | golden `review-answer-and-cancel-in-one-instant (S12)`; witness on `review-answer-and-cancel-in-one-instant (S12)`: D:5/records/ vs D:2/outside-allowed/ |
| 103 | 169 | equivalent (grader: contract) | `<=` on seq: an action and an answer never share a seq | no golden fails it; corpus 0 in 11083 |
| 104 | 169 | killed | the first non-cancel action is taken as the R6.4 cancel | golden `review-open-amend-changes-nothing`; witness on `review-open-amend-changes-nothing`: D:2/early/fst:0008-F1:cancelled vs PASS |
| 105 | 169 | equivalent (grader: contract) | differs only when a cancel is delivered before a review answer of its instant, which the delivery order (§1, S12) excludes | no golden fails it; corpus 0 in 11083 |
| 106 | 169 | killed | precedence: an amend before the answer counts as a cancel | golden `review-open-amend-changes-nothing`; witness on `review-open-amend-changes-nothing`: D:2/early/fst:0008-F1:cancelled vs PASS |
| 107 | 169 | killed | a same-instant cancel counts whatever the order: as k102 on reachable views (S12) | golden `review-answer-and-cancel-in-one-instant (S12)`; witness on `review-answer-and-cancel-in-one-instant (S12)`: D:5/records/ vs D:2/outside-allowed/ |
| 108 | 169 | killed | any action before the deadline counts | golden `review-open-amend-changes-nothing`; witness on `review-open-amend-changes-nothing`: D:2/early/fst:0008-F1:cancelled vs PASS |
| 109 | 169 | killed | an earlier cancel no longer counts once an answer exists | golden `review-open-first-cancel-counts`; witness on `review-open-first-cancel-counts`: PASS vs E |
| 110 | 169 | killed | no cancel counts once an answer exists | golden `review-open-first-cancel-counts`; witness on `review-open-first-cancel-counts`: PASS vs OPEN |
| 111 | 169 | killed | the last qualifying cancel anchors R6.4 | golden `review-open-first-cancel-counts`; witness on `review-open-first-cancel-counts`: D:3/missed/fst:0008-F1:cancelled vs PASS |
| 112 | 170 | killed | R6.4 window 120 min with the review open | golden `review-open-first-cancel-counts`; witness on `review-open-first-cancel-counts`: D:3/missed/fst:0008-F1:cancelled vs PASS |
| 123 | 188 | killed | cancel-refused permitted for a cancel at D after a counted amend (S8, S11, R6.3) | golden `amend-then-cancel-at-deadline-counts (S8)`; witness on `amend-and-cancel-in-one-instant (S11)` (hand-built): D:2/outside-allowed/ vs PASS |
| 124 | 188 | killed | cancel-refused permitted after late amends, not late cancels (R6.3, S5) | golden `timed-out-order: window (D, D+60] and late actions`; witness on `action-after-deadline-is-late`: D:2/outside-allowed/ vs PASS |
| 125 | 188 | killed | cancel-refused never permitted after D (R6.3) | golden `timed-out-order: window (D, D+60] and late actions`; witness on `timed-out-order: window (D, D+60] and late actions`: PASS vs D:2/outside-allowed/ |
| 126 | 188 | killed | cancel-refused permitted for every uncounted action | golden `timed-out-order: window (D, D+60] and late actions`; witness on `action-after-deadline-is-late`: D:2/outside-allowed/ vs PASS |
| 127 | 188 | killed | cancel-refused permitted for any action after D | golden `timed-out-order: window (D, D+60] and late actions`; witness on `action-after-deadline-is-late`: D:2/outside-allowed/ vs PASS |
| 128 | 191 | killed | the timeout fulfilment-cancel window runs to D + 120 (R3.2) | golden `timed-out-order: window (D, D+60] and late actions`; witness on `timeout-strictly-after-deadline`: D:3/missed/fst:0023-F1:cancelled vs PASS |
| 133 | 193 | killed | order-timed-out runs to D + 120 (R3.2) | golden `timed-out-order: window (D, D+60] and late actions`; witness on `timeout-strictly-after-deadline`: D:3/missed/ntf:0023:order-timed-out vs PASS |
| 134 | 193 | killed | order-timed-out opens at D (R3.2, S1) | golden `timed-out-order: window (D, D+60] and late actions`; witness on `timeout-strictly-after-deadline`: D:2/early/ntf:0023:order-timed-out vs PASS |
| 140 | 209 | killed | a cancel at the ready instant is ignored (S11, S12) | golden `review-answer-and-cancel-in-one-instant (S12)`; witness on `review-answer-and-cancel-in-one-instant (S12)`: PASS vs D:2/early/fst:0008-F1:cancelled |
| 143 | 209 | killed | an amend during processing aborts the order (S5) | golden `review-open-amend-changes-nothing`; witness on `review-open-amend-changes-nothing`: D:3/missed/ost:0008:processing vs D:2/outside-allowed/ |
| 146 | 212 | equivalent (grader: contract) | differs only for a report delivered after a cancel of its instant, which the delivery order (§1, S4, S7) excludes | no golden fails it; corpus 0 in 11083 |
| 147 | 212 | equivalent (grader: contract) | `<=` on seq: a report and a cancel never share a seq | no golden fails it; corpus 0 in 11083 |
| 150 | 212 | equivalent (grader: contract) | `\|\|` in the tie clause: as k146, and `at` is monotone in seq | no golden fails it; corpus 0 in 11083 |
| 153 | 212 | equivalent (grader: contract) | only `collected` proves collection: differs only when a delivery or in-transit report reaches the arm before the collection report and a cancel of the processing order follows, i.e. a held-up report meeting a processing cancel, which the world contract excludes (SPEC-E §3.3, E8-24) | no golden fails it; corpus 0 in 11083; unit check `delivery-report-proves-collection (S7, outside the world contract)` fails it |
| 156 | 219 | killed | any reservation of F counts for every item (R4.2) | golden `charge-waits-for-the-last-reservation`; witness on `charge-waits-for-the-last-reservation`: OPEN vs D:3/missed/chg:0007-F1 |
| 157 | 219 | equivalent (grader: stopped) | a second reservation commit anchors the charge: a second commit needs a new key (a re-issued key is deduped, not committed), so the grader stops there (key-split) | no golden fails it; corpus 0 in 11083; unit check `second-commit-moves-no-window` fails it |
| 159 | 223 | killed | the charge anchored at the first reservation (R4.2) | golden `charge-waits-for-the-last-reservation`; witness on `charge-waits-for-the-last-reservation`: OPEN vs D:3/missed/chg:0007-F1 |
| 160 | 224 | equivalent (grader: stopped) | a second charge commit anchors the ship window: as k157 | no golden fails it; corpus 0 in 11083; unit check `second-commit-moves-no-window` fails it |
| 161 | 225 | equivalent (grader: stopped) | a second booking moves the collection run: as k157 | no golden fails it; corpus 0 in 11083; unit check `second-commit-moves-no-window` fails it |
| 166 | 227 | equivalent (grader: contract) | the message comparator: as k62 | no golden fails it; corpus 0 in 11083 |
| 168 | 228 | killed | a repeated `collected` moves `dispatched` (§3.3, R7.2) | golden `repeated-carrier-messages-change-nothing`; witness on `repeated-carrier-messages-change-nothing`: D:3/missed/fst:0007-F1:dispatched vs PASS |
| 170 | 229 | killed | a repeated `delivered` moves `completed` | golden `repeated-carrier-messages-change-nothing`; witness on `repeated-carrier-messages-change-nothing`: D:3/missed/fst:0007-F1:completed vs PASS |
| 172 | 230 | killed | a repeated `collectionFailed` moves `failed` | golden `repeated-carrier-messages-change-nothing`; witness on `repeated-carrier-messages-change-nothing`: D:3/missed/rf:0007-F1 vs PASS |
| 174 | 231 | equivalent (grader: stopped) | a later permanent failure of the same step moves the failure: that is a retry of a permanently failed step (R5.2), outside-allowed first | no golden fails it; corpus 0 in 11083; unit check `fulfilment-fails-at-its-first-failure` fails it |
| 175 | 231 | equivalent (grader: stopped) | a later report failure moves a row failure: needs a booking after a permanent failure, outside-allowed first | no golden fails it; corpus 0 in 11083; unit check `fulfilment-fails-at-its-first-failure` fails it |
| 176 | 240 | killed | a delivery in the cancel's instant does not end the order (S13 says it reached the arm first) | golden `delivery-and-cancel-in-one-instant (S13)`; witness on `delivery-and-cancel-in-one-instant (S13)`: PASS vs OPEN |
| 177 | 240 | killed | a collectionFailed in the cancel's instant does not end the order (S13) | golden `failure-and-cancel-in-one-instant (S13)`; witness on `failure-and-cancel-in-one-instant (S13)`: PASS vs OPEN |
| 181 | 240 | killed | an order never counts as already ended (R6.3) | golden `cancel-refused-and-cancel-after-the-end`; witness on `cancel-refused-and-cancel-after-the-end`: PASS vs OPEN |
| 182 | 242 | killed | cancel-refused window 120 min (R6.3) | golden `go-live-collected-refuses-cancel`; witness on `cancel-after-collection-refused`: D:3/late/ntf:0007:cancel-refused vs OPEN |
| 184 | 249 | killed | fulfilment processing window 120 min (R4.1) | golden `processing-window-after-the-steps`; witness on `collection-failure-refund-then-release`: D:3/missed/fst:0007-F1:processing vs PASS |
| 185 | 256 | killed | a collectionFailed in the cancel's instant is cancelled, not failed (S13) | golden `failure-and-cancel-in-one-instant (S13)`; witness on `failure-and-cancel-in-one-instant (S13)`: PASS vs OPEN |
| 190 | 258 | equivalent (grader: satisfied) | `forwardOk` inverted: taken steps stop being named while satisfied, steps after a cut are named only after the grader stopped at them | no golden fails it; corpus 0 in 11083; unit check `steps-before-vs-after-a-processing-cancel: taken steps and their naming` fails it |
| 191 | 258 | equivalent (grader: satisfied) | no taken step is named: as k39 | no golden fails it; corpus 0 in 11083; unit check `steps-before-vs-after-a-processing-cancel: taken steps and their naming` fails it |
| 192 | 258 | equivalent (grader: satisfied) | a step judged by its commit time: an in-flight step stops being named, but the grader matched it (exempt) and keeps it satisfied | no golden fails it; corpus 0 in 11083; unit check `steps-before-vs-after-a-processing-cancel: taken steps and their naming` fails it |
| 193 | 260 | equivalent (grader: code) | `items.at(-1).pre`: every item carries the same order-level `pre` | no golden fails it; corpus 0 in 11083 |
| 195 | 262 | equivalent (grader: stopped) | a reservation after the cancel stays named: the grader stops at it first (outside-allowed) | no golden fails it; corpus 0 in 11083; unit check `steps-before-vs-after-a-processing-cancel: taken steps and their naming` fails it |
| 200 | 267 | equivalent (grader: stopped) | a charge after the cancel stays named: as k195 | no golden fails it; corpus 0 in 11083; unit check `new-forward-steps-after-a-cancel-not-named` fails it |
| 203 | 272 | equivalent (grader: code) | as k193 | no golden fails it; corpus 0 in 11083 |
| 207 | 273 | equivalent (grader: code) | as k193 | no golden fails it; corpus 0 in 11083 |
| 208 | 273 | equivalent (grader: stopped) | a booking after the cancel stays named: as k195 | no golden fails it; corpus 0 in 11083; unit check `new-forward-steps-after-a-cancel-not-named` fails it |
| 211 | 276 | equivalent (grader: consumed) | a booked shipment gets no `created` record: after D1 every terminal expectation overwrites it (cancelled, failed, collected, delivered) | no golden fails it; corpus 0 in 11083 |
| 212 | 276 | equivalent (grader: code) | as k193 | no golden fails it; corpus 0 in 11083 |
| 213 | 276 | equivalent (grader: code) | as k193 | no golden fails it; corpus 0 in 11083 |
| 215 | 280 | killed | an in-flight step's compensation window runs from the cancel, not its commit (R6.2) | golden `cancel-windows-and-in-flight-charge (R6.2)`; witness on `cancel-windows-and-in-flight-charge (R6.2)`: D:2/order/rel:0007-F1:SKU-1025 vs D:3/missed/rel:0007-F1:SKU-1025 |
| 220 | 283 | equivalent (grader: stopped) | a shipment cancel required after collectionFailed: reachable only when the report follows the cancel, i.e. after the arm missed the shipment cancel at R - 1 min (carriers are guarded) | no golden fails it; corpus 0 in 11083; unit check `cancel-before-a-collection-failure: records after the report (D1)` fails it |
| 221 | 284 | equivalent (grader: contract) | the shipment-cancel window closes at R instead of R - 1 min: a cancel emitted at R is refused (the carrier collects in the host's phase 0, before any call of that instant), so no arm commits a shipment cancel in the extra minute; same `missed csh` (the 2026-10-14 witness committed a cancel at R, which the host cannot write) | no golden fails it; corpus 0 in 11083; unit check `second-commit-moves-no-window` fails it |
| 230 | 300 | equivalent (grader: stopped) | the R5.2 window ignores a later in-flight commit (S14): no step of a failing fulfilment is in flight (R4.2 sequencing, no permanent reservation failure in E8); otherwise outside-allowed first | no golden fails it; corpus 0 in 11083; unit check `step-committing-after-a-failure (S14)` fails it |
| 239 | 316 | equivalent (grader: code) | as k193 | no golden fails it; corpus 0 in 11083 |
| 249 | 327 | equivalent (grader: consumed) | the inTransit lookup writes `rec` only where `records` stays null (not terminal) | no golden fails it; corpus 0 in 11083 |
| 250 | 327 | equivalent (grader: consumed) | as k249 | no golden fails it; corpus 0 in 11083 |
| 251 | 327 | equivalent (grader: consumed) | as k249 | no golden fails it; corpus 0 in 11083 |
| 252 | 327 | equivalent (grader: consumed) | as k249 | no golden fails it; corpus 0 in 11083 |
| 254 | 333 | killed | R6.2 order-cancel window 120 min | golden `review-answer-and-cancel-in-one-instant (S12)`; witness on `cancel-before-collection-after-3-steps`: D:3/missed/ost:0007:cancelled vs PASS |
| 256 | 334 | killed | R6.2 order-cancelled notice window 120 min | golden `cancel-windows-and-in-flight-charge (R6.2)`; witness on `cancel-before-collection-after-3-steps`: D:3/missed/ntf:0007:order-cancelled vs PASS |
| 263 | 355 | equivalent (grader: consumed) | `recordsOf` throws for a case with no order: the grader compares records only when the expectation has them (never for no order) | no golden fails it; corpus 0 in 11083; unit check `records-of-create-migration-and-no-order` fails it |
| 265 | 357 | equivalent (grader: contract) | `findLast` allocation: one per order | no golden fails it; corpus 0 in 11083 |
| 267 | 360 | equivalent (grader: contract) | `findLast` backlog entry: one per go-live case | no golden fails it; corpus 0 in 11083 |
| 268 | 362 | equivalent (grader: consumed) | the migrated order status read from other rows: records are compared only for complete divergence-free cases, whose final statuses overwrite it | no golden fails it; corpus 0 in 11083; unit check `records-of-create-migration-and-no-order` fails it |
| 269 | 362 | equivalent (grader: consumed) | as k268 | no golden fails it; corpus 0 in 11083; unit check `records-of-create-migration-and-no-order` fails it |
| 270 | 362 | equivalent (grader: consumed) | as k268 | no golden fails it; corpus 0 in 11083; unit check `records-of-create-migration-and-no-order` fails it |
| 287 | 377 | equivalent (grader: consumed) | the case's own create ignored: as k268 (initial statuses are always overwritten) | no golden fails it; corpus 0 in 11083; unit check `records-of-create-migration-and-no-order` fails it |
| 288 | 377 | equivalent (grader: consumed) | initial fulfilment statuses swapped: as k287 | no golden fails it; corpus 0 in 11083; unit check `records-of-create-migration-and-no-order` fails it |
| 301 | 398 | equivalent (grader: stopped) | `cutCause` report test inverted: changes which message a forward step taken in a failure's instant is judged against; no forward step of a fulfilment exists at its failure instant on a graded trajectory (it would be a second commit or a step after the failure, reported first) | no golden fails it; corpus 0 in 11083; unit check `forward-step-cut-judged-against-its-own-message (S10, S13)` fails it |
| 302 | 404 | killed | cancel-refused allowed after a decided cancellation for an amend, not for a later cancel (S15) | golden `review-answer-and-cancel-in-one-instant (S12)`; witness on `review-open-first-cancel-counts`: OPEN vs D:2/outside-allowed/ |
| 303 | 405 | killed | cancel-refused never allowed after a decided cancellation (S15, S12) | golden `review-answer-and-cancel-in-one-instant (S12)`; witness on `review-open-first-cancel-counts`: OPEN vs D:2/outside-allowed/ |

## 3. Readings adopted (SPEC-E §5; decisions in `../README.md`)

| reading | text in brief | settles |
|---|---|---|
| §1 delivery order; S4 and S7 (E8-15, E8-23) | within an instant events are delivered by `source`, then id (`actor` < `carrier` < `customer-portal` < `shop`); "the same instant" is the instant a report is delivered; S7 judges collection on the reports delivered before the cancel, with `reportedAt` at or before the cancel's time | N5; k146 and k150 equivalent (contract) |
| §3.3 held-up reports (E8-24) | carriers never hold up the reports of an order the customer cancels while it is processing: every collection before such a cancel has been reported | k153 equivalent (contract); the S7 golden on a held-up report is a unit check |
| S10 same-instant knowledge (E8-16) | a step was taken before a message if taken at an earlier instant, or in the same instant by a call that had not been given that message | k36–k38 killed (steps-before E4, E6) |
| S11 the ready instant (E8-17, E8-26) | processing from the ready instant, inclusive; a customer action delivered before its order's placement names no order: answer it with nothing, close, no `unknown-order` | k140 killed |
| S12 answer and cancel in one instant (E8-18, E8-26) | the answer is delivered first: approve, then an R6.2 cancel (or R3.2 with an unavailable fulfilment); reject, then R2.2: the cancel changes nothing, `cancel-refused` allowed | k102, k107 killed; k105 equivalent (contract) |
| S13 endings and failures in a cancel's instant (E8-19, E8-23) | what reached the arm first came first: a carrier report delivered in the cancel's instant came first; a failed attempt's result arrives a minute later | k176, k177, k185 killed |
| S14 a step committing after its fulfilment failed (E8-20) | compensated within 120 min of its commit | k230 equivalent (stopped); unit check |
| S15 a cancel after the cancellation is decided (E8-25) | an order counts as cancelled from the moment a rule decides it (R2.1 reject, R2.2 reject or deadline, a counted cancel, an amend with nothing available); every later cancel changes nothing, `cancel-refused` allowed | N3 closed; k302, k303 killed |

## 4. Oracle changes

**This revision** (each with a golden or a unit check that the first revision's transition, commit `922ca92`, fails):
- **`refuseLater` (S15).** `cancelOrder` and the R6.2 abort permit `cancel-refused` for every later customer cancel
  of the order. Goldens `a-cancel-after-the-cancellation-is-decided (S15)` and the reject half of
  `review-answer-and-cancel-in-one-instant (S12)`; the first revision's transition fails both.
- **`cutCause` (S10, S13).** The forward steps of a fulfilment are judged against the message that cut them: the
  counted cancel when it aborted the fulfilment, its collectionFailed report when that report is the failure, none (the
  call's knowledge of the case) for a failed attempt. `evAt`, the map from instant to cancel, is gone; the S9 checks use
  the counted cancel directly. Unit check `forward-step-cut-judged-against-its-own-message`; the first revision's
  transition fails it.
- **No grader change.** `oracle/` is unchanged by this revision.

**First revision** (unchanged): D1 (a shipment the carrier reports collectionFailed after a counted cancel has the
record `failed`), S10 per message in the transition and in `oracle/view.mjs` / `oracle/grade.mjs`, S11 placement
(`custActions` only after the first `order.placed`), S13 (`failSeen`, `<=`).

**Still open** (owner decisions):
- N2: repeated refused cancels. One lid per order, so the window moves to the latest refused cancel.
- N4: S5 vs S8 for a cancel after D that follows a counted amend. The reference both requires the R6.2 cancellation and
  permits `cancel-refused`.
- N6: S11's pre-placement action is graded per case: a call that answers it with a wake-up or an effect is graded
  against the order's subject (the rule says to close; unreachable in generated worlds).
- D2: gl-intake create items fall back to the allocation union.
- D3: `normItems` is order-sensitive for a SKU repeated in one list (k1 and k2 rest on "ids unique within a list").
- H1: `canonicalArgs` is never swapped in. H2: the runner passes `recordsOf`.

## 5. Goldens (48) and unit checks (14)

A golden asserts only spec-stated outcomes the grader can see. Every golden passes the current transition (item suite).
Changes in this revision:

| golden | change |
|---|---|
| `steps-before-vs-after-a-processing-cancel` | keeps the release checks (E2, E3, E5) and E4; adds E6 (`processing` set a minute after the cancel is permitted, not required: k37); the "taken step stays named" checks moved to a unit check |
| `review-answer-and-cancel-in-one-instant (S12)` | adds "reject then cancel: `cancel-refused` allowed, not required"; the S10 "processing stays named" part is a unit check |
| `a-cancel-after-the-cancellation-is-decided (S15)` | new: R2.1, R2.2 reject and deadline, R6.4 and R3.2 repeats, R6.2 repeat; an amend gets nothing; the counting cancel gets nothing |
| `shipment-cancel-window-at-its-own-location (R4.3, R6.2)` | new: a cancel 30 min before another location's run (k14) |
| `cancel-shortly-before-collection (R6.2, R4.3)` | was `cancel-before-a-collection-failure (R6.2, R7.1)`: the shipment cancel window only, closing at R − 1 min or R (one rule: a cancel at R is refused); the D1 records part is a unit check |
| `processing-window-after-the-steps` | was `taken-forward-steps-stay-asked-for`: the processing window only |
| `cancel-windows-and-in-flight-charge (R6.2)`, `no-new-forward-step-after-a-cancel` | the windows and compensations only; "stays named" / "not named" parts are unit checks |
| `awaiting-amend-nothing-available-cancels-once` | the duplicate-lid check is a unit check |
| `cancel-at-collection-refused`, `cancel-after-collection-refused`, `collection-failure-refund-then-release`, `delivery-before-collection-report` | carrier reports at the real collection run (R4.3), so the inputs are reachable |
| `failure-and-cancel-in-one-instant (S13)` | (c) books both fulfilments; F1 is the one whose location collects first |

Unit checks (`test/unit-checks.mjs`, run by `test/e8.test.mjs`, never by `mutate.mjs`): the naming checks above,
`second-commit-moves-no-window`, `fulfilment-fails-at-its-first-failure`, `collection-cutoff-boundary`, the D1 records
check, `step-committing-after-a-failure (S14)`, `delivery-report-proves-collection (S7, outside the world contract)`,
`forward-step-cut-judged-against-its-own-message`, the duplicate-lid check and `records-of-create-migration-and-no-order`.
Every one of the 25 grader-equivalent mutants the goldens used to fail fails at least one of them, as do k153, k221 and
k301; no golden fails any equivalent mutant.

## 6. Reproducing (`ledger/mutants-20261015/`)

The harness and its outputs are in the repository; see its `README.md` for the commands, the blob hashes of the files
the evidence was computed on and what each file holds. The corpus journals themselves (about 400 MB) are not committed;
`data/corpus-index.json` gives each world's file hash, journals and completed cases, and `harness/corpus.mjs` rebuilds
them.
