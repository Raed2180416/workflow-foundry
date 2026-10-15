# E8 oracle mutants: the 109 survivors of the 2026-10-14 run, under one standard

This is development and diagnostic evidence ($0, no model calls). The source is `ledger/mutation-20261014.json`, written
by `tools/mutate.mjs` at commit `4016358`: 301 mutants of `transition.mjs`, 192 killed (103 by goldens, 86 by the corpus,
3 by errors), 109 survivors, score 0.638.

**Revision of 2026-10-15** (review, six defects, all resolved here). `transition.mjs` changed: oracle defect D1, the
per-message knowledge rule S10, the placement rule of S11 and the delivery-order rule of S13 (§4). The changes keep the
mutant set **index-stable**: the regenerated set has 301 mutants with the same operator at the same expression for
every k. The exception is k176, k177 and k185: their expressions now read `<=`, so these mutants turn them back into
the old `<`, the rule S13 replaced. The verdicts below are for the mutants of the current source, and line numbers are
the current source's. `tools/mutate.mjs` was not rerun (it writes mutants into `beds/ebed/e8/.mutants`), so every score
here is expected, not measured.

## 0. The standard (one, for every mutant)

**What is compared.** The original and the mutant are compared as the grader reports them (`oracle/grade.mjs`
`gradeCase`, at every processing point). The grader stops at the first divergence or oracle error, and it compares
records only for complete, divergence-free cases. Per case the verdict is the first divergence (layer/code/lid, as
`mutate.mjs` keys it), or else passed or still open, or an oracle error. Changes in an expectation that never reach a
verdict do not count. Examples: a lid listed twice, a window of a lid that is already satisfied, records the grader
never compares.

**Reachable input.** A journal the host can write for some arm on some world of this item's world contract:
- **Any arm behaviour.**
- **Host semantics.**
  - Delivery within an instant by (source, id) (SPEC-E §1).
  - Results one minute after the attempt.
  - Platform retries keep the key, and a re-issued committed key is deduped, not committed again.
  - Carriers are guarded (H-29) and report in order, or held up (W2, delivery first).
  - One migration per go-live case, before t0.
- **World invariants.**
  - Ids are unique within their lists.
  - Edition intervals are disjoint.
  - There is one allocation per order.
  - The horizon is 14 days.

The generator's class mix is a sample, not a limit. A review order that gets a customer cancel, or a failure in a
cancel's instant, is a reachable input although no current dev world has one; sealed and later worlds may.

**Killed** means two things hold:
1. A golden that passes the original fails the mutant. This is the kill `mutate.mjs` counts.
2. The difference reaches a verdict. Either a **witness** journal on that golden's input gives a different verdict, or
   the corpus differential finds a different verdict.

A witness starts from the golden's history and completes it with a conforming arm (each named lid at its earliest,
after its predecessors). It then moves one step to a window boundary (±1 min), skips one, or adds one permitted
pattern. Carriers stay consistent with the bookings, and the carriers' shipment writes are included. The scratch
harness `gwit*.mjs` searches these; where it cannot place the needed step, the witness is hand-built (`manual*.mjs`).

**Equivalent (grader)** means no reachable input gives a different verdict. Each one has a one-line argument, no witness
on any golden input, and 0 differences in the corpus differential. The corpus differential covers 7 dev worlds (1009:3,
1010:5, 1011:4, 1012:2, 2002:4, 1013:5, 1015:3) and 151 journals: both reference runs, every control, the 3 specificity
solvers and the 3 `b1lh-e8` solvers. The solvers are model-written and ran out of process in the sandbox arm. The
corpus gives 11,083 case gradings per mutant. The kinds of equivalence:

| kind | meaning |
|---|---|
| contract | only inputs outside the world contract or the host semantics separate the two |
| consumed | the grader never reads the difference |
| satisfied | the difference is only whether a lid is still named, and the arm's own committed row already satisfied that lid. The grader keeps a satisfied lid satisfied, whether or not later expectations name it. |
| stopped | the difference arises only after the grader has stopped at an earlier divergence of the same journal |
| code | dead code, or the same value |
| harness | in `canonicalArgs`, which `mutate.mjs` never swaps in (H1) |

**Mechanical vs counted.** Some goldens are unit checks of the transition whose failures the grader never sees: the
duplicate-lid check, `recordsOf` on cases whose records are never compared, and views after a divergence. The goldens
stay, as regressions of the transition. `mutate.mjs` will report the mutants they fail as killed; this ledger counts
those mutants equivalent (grader). §1 gives both numbers.

## 1. Result

| verdict (the 109 survivors) | count |
|---|---|
| killed (a golden pins it and a reachable input shows the difference) | 49 |
| equivalent (grader: contract) | 22 |
| equivalent (grader: consumed) | 12 |
| equivalent (grader: stopped) | 10 |
| equivalent (grader: satisfied) | 7 |
| equivalent (grader: code) | 7 |
| equivalent (grader: harness) | 2 |
| ambiguous | 0 (former A1–A4 now have readings S12–S14, §3) |
| **total** | **109** |

The 2026-10-14 version claimed 68 kills. Under the one standard, 24 of those claims are grader-equivalent. Seven are the
kills the review named: k53, k263, k268, k269, k270, k287 and k288. The other 17 are k39–k42, k157, k160, k161, k174,
k175, k190–k192, k195, k200, k208, k211 and k220. That leaves 44. The five former ambiguous survivors k102, k107, k176,
k177 and k185 are now killed under readings S12 and S13, which makes 49. k77, k123, k140 and k153 stay killed on
reworked goldens whose inputs are witnessed.

The same standard was applied to all 192 mutants the run killed. 191 still have a witness or a corpus difference. 42 of
them fail no golden and are caught only by `mutate.mjs`'s 4-world corpus; that corpus still separates each of them from
the original on a completed case. **k17** was killed only by `collection-cutoff-boundary`; it is equivalent (grader: stopped). Its
mutated collection run lets the shipment-cancel window run past the real collection. A cancel attempted after that
collection is refused by the carrier (`409 already-collected`), so no arm can use the extra window. The verdict is the
same `missed csh`, only reported later.

**Expected score, all 301 mutants (not a `mutate.mjs` measurement):**

| formula | value |
|---|---|
| one standard, raw (killed / all) | 240 / 301 = **0.797** |
| one standard, equivalents excluded (E-BED §9.5: "each survivor is equivalent or gets a new golden") | 240 / (301 − 61) = 240 / 240 = **1.000** |
| what `mutate.mjs` will report (any golden failure, error or 4-world corpus difference counts) | 265 / 301 = 0.880 |

The `mutate.mjs` figure includes 25 mutants that are equivalent (grader). It counts them because a golden fails them:
k17, k39–k42, k53, k157, k160, k161, k174, k175, k190–k192, k195, k200, k208, k220, k230, k263, k268–k270, k287 and
k288. The raw formula cannot reach K1 (0.95) while the 61 equivalent mutants stay in the operator set: the ceiling is
240 / 301. Whether K1 counts equivalents in the denominator remains the owner's decision. Under the second formula
nothing is left to kill: no reachable input separates any surviving mutant without a golden pinning it.

## 2. The 109 survivors

Line numbers are those of the current `transition.mjs`. A witness column shows the grader's verdict for the original vs
the mutant: `D:layer/code/lid` is a first divergence, `PASS` passed, `OPEN` still open at the journal's horizon.

| k | line | verdict | reason (one line) | evidence |
|---|---|---|---|---|
| 1 | 14 | equivalent (grader: contract) | `<=` in `sortBy` reorders only equal keys: a SKU or fulfilment id listed twice in one list, which the world contract excludes (D3 stays open) | no golden fails it; corpus 0 in 11083 |
| 2 | 14 | equivalent (grader: contract) | `>=` in `sortBy`: as k1 | no golden fails it; corpus 0 in 11083 |
| 4 | 19 | equivalent (grader: harness) | the guard of `canonicalArgs`, which `mutate.mjs` never swaps in (H1); the transition calls it with an object only | no golden fails it; corpus 0 in 11083 |
| 7 | 20 | equivalent (grader: harness) | other ops in `canonicalArgs` (H1); no other op has those arrays | no golden fails it; corpus 0 in 11083 |
| 13 | 32 | equivalent (grader: contract) | `findLast` over editions: edition intervals are disjoint, so at most one matches | no golden fails it; corpus 0 in 11083 |
| 15 | 39 | equivalent (grader: contract) | `findLast` over locations: location names are unique | no golden fails it; corpus 0 in 11083 |
| 16 | 43 | equivalent (grader: contract) | the run loop to day 40: a run is found by day 15 (bookings end before the 14-day horizon) | no golden fails it; corpus 0 in 11083 |
| 21 | 50 | equivalent (grader: contract) | `findLast` over carrier codes: (carrier, code) is unique in an edition | no golden fails it; corpus 0 in 11083 |
| 29 | 76 | equivalent (grader: contract) | `findLast` over fees: one fee row per location | no golden fails it; corpus 0 in 11083 |
| 31 | 77 | equivalent (grader: contract) | `findLast` over the catalog: SKUs are unique | no golden fails it; corpus 0 in 11083 |
| 33 | 78 | equivalent (grader: contract) | `findLast` over customers: customer ids are unique | no golden fails it; corpus 0 in 11083 |
| 35 | 79 | equivalent (grader: contract) | `findLast` over allocations: one allocation per order | no golden fails it; corpus 0 in 11083 |
| 36 | 83 | killed | a step by the call that was given the cancel counts as before it (S10) | `steps-before-vs-after-a-processing-cancel`; witness PASS vs OPEN |
| 37 | 83 | killed | a later-instant step from a call given no event of the case counts as before (S10) | `steps-before-vs-after-a-processing-cancel`; witness D:5/records/ vs OPEN |
| 38 | 83 | killed | both of k36 and k37 (S10) | `steps-before-vs-after-a-processing-cancel`; witness PASS vs OPEN |
| 39 | 83 | equivalent (grader: satisfied) | nothing counts as before: only lids that the arm's own earlier (or in-flight) rows satisfied stop being named; the grader keeps a satisfied lid satisfied | fails `steps-before-vs-after-a-processing-cancel` (mutate.mjs counts it), no witness; corpus 0 in 11083 |
| 40 | 84 | equivalent (grader: satisfied) | `matches` never sees the arm's setStatus: as k39 for S9 statuses taken before the cancel | fails `steps-before-vs-after-a-processing-cancel` (mutate.mjs counts it), no witness; corpus 0 in 11083 |
| 41 | 84 | equivalent (grader: satisfied) | as k40 | fails `steps-before-vs-after-a-processing-cancel` (mutate.mjs counts it), no witness; corpus 0 in 11083 |
| 42 | 84 | equivalent (grader: satisfied) | as k40 | fails `steps-before-vs-after-a-processing-cancel` (mutate.mjs counts it), no witness; corpus 0 in 11083 |
| 53 | 100 | equivalent (grader: consumed) | a lid at index 0 is required twice: the grader merges lids by id (same window here); the golden's duplicate-lid check is a unit check | fails `awaiting-amend-nothing-available-cancels-once` (mutate.mjs counts it), no witness; corpus 0 in 11083 |
| 62 | 121 | equivalent (grader: contract) | the action comparator ties when `at` is equal: views list events in seq order with `at` nondecreasing | no golden fails it; corpus 0 in 11083 |
| 64 | 123 | killed | go-live migration reports ignored, so a cancel after a pre-go-live collection counts (§3.5, R6.3, S7) | `go-live-collected-refuses-cancel`; witness OPEN vs D:2/outside-allowed/ |
| 65 | 124 | killed | the migration lookup picks a non-migration event | `go-live-collected-refuses-cancel`; witness OPEN vs D:2/outside-allowed/ |
| 66 | 124 | equivalent (grader: contract) | `findLast` migration: one migration per go-live case | no golden fails it; corpus 0 in 11083 |
| 67 | 125 | killed | the migration's carrier reports are skipped | `go-live-collected-refuses-cancel`; witness OPEN vs D:2/outside-allowed/ |
| 76 | 142 | killed | create items from the allocation, not as placed (R1.1); a split SKU is a legal allocation | `create-items-as-placed-not-as-allocated`; witness OPEN vs D:2/outside-allowed/ |
| 77 | 142 | killed | a later placement of the same order (other items) changes the create (R1.4); witness: it arrives before the arm records the order | `duplicate-placement-changes-no-items`; witness OPEN vs D:2/outside-allowed/ |
| 78 | 142 | equivalent (grader: code) | dead branch: gl-dispatched implies `pre.created` | no golden fails it; corpus 0 in 11083 |
| 80 | 149 | killed | a go-live intake order is cleared whatever its verdict (§3.5, R2.1) | `go-live-intake-fraud-reject-cancels`; witness PASS vs D:2/outside-allowed/ |
| 88 | 154 | equivalent (grader: contract) | the review-task comparator: as k62 | no golden fails it; corpus 0 in 11083 |
| 89 | 155 | killed | the review deadline runs from the last task (R2.2, S3) | `review-first-task-and-first-answer-decide`; witness PASS vs D:2/early/fst:ORD-1001-0008-F1:cancelled |
| 90 | 157 | killed | an amend is taken as the R6.4 cancel | `review-open-amend-changes-nothing`; witness OPEN vs D:3/missed/fst:ORD-1001-0008-F1:cancelled |
| 91 | 157 | killed | the last cancel anchors R6.4 | `review-open-first-cancel-counts`; witness D:3/missed/fst:ORD-1001-0008-F1:cancelled vs OPEN |
| 92 | 158 | killed | R6.4 window 120 min | `review-open-first-cancel-counts`; witness D:3/missed/fst:ORD-1001-0008-F1:cancelled vs OPEN |
| 99 | 165 | equivalent (grader: contract) | the answer comparator: as k62 | no golden fails it; corpus 0 in 11083 |
| 100 | 166 | killed | the last usable answer clears the order (R2.2) | `review-first-task-and-first-answer-decide`; witness D:3/missed/ost:ORD-1001-0008:processing vs OPEN |
| 101 | 167 | killed | a cancel exactly at the review deadline no longer counts (R2.2, S1) | `review-open-first-cancel-counts`; witness PASS vs D:2/early/fst:ORD-1001-0008-F1:cancelled |
| 102 | 167 | killed | a cancel in an answer's instant, delivered after it, counts as R6.4 (S12 says the answer decides first) | `review-answer-and-cancel-in-one-instant`; witness D:5/records/ vs D:2/outside-allowed/ |
| 103 | 167 | equivalent (grader: contract) | `<=` on seq: an action and an answer never share a seq | no golden fails it; corpus 0 in 11083 |
| 104 | 167 | killed | the first non-cancel action is taken as the R6.4 cancel | `review-open-amend-changes-nothing`; witness OPEN vs D:2/outside-allowed/ |
| 105 | 167 | equivalent (grader: contract) | differs only when a cancel is delivered before a review answer of its instant, which the delivery order (§1, S12) excludes | no golden fails it; corpus 0 in 11083 |
| 106 | 167 | killed | precedence: an amend before the answer counts as a cancel | `review-open-amend-changes-nothing`; witness OPEN vs D:2/outside-allowed/ |
| 107 | 167 | killed | a same-instant cancel counts whatever the order: as k102 on reachable views (S12) | `review-answer-and-cancel-in-one-instant`; witness D:5/records/ vs D:2/outside-allowed/ |
| 108 | 167 | killed | any action before the deadline counts | `review-open-amend-changes-nothing`; witness OPEN vs D:2/outside-allowed/ |
| 109 | 167 | killed | an earlier cancel no longer counts once an answer exists | `review-open-first-cancel-counts`; witness PASS vs E |
| 110 | 167 | killed | no cancel counts once an answer exists | `review-open-first-cancel-counts`; witness PASS vs OPEN |
| 111 | 167 | killed | the last qualifying cancel anchors R6.4 | `review-open-first-cancel-counts`; witness D:3/missed/fst:ORD-1001-0008-F1:cancelled vs PASS |
| 112 | 168 | killed | R6.4 window 120 min with the review open | `review-open-first-cancel-counts`; witness D:3/missed/fst:ORD-1001-0008-F1:cancelled vs PASS |
| 123 | 186 | killed | cancel-refused permitted for a cancel at D after a counted amend (S8, S11, R6.3) | `amend-and-cancel-in-one-instant`; witness (hand-built) D:2/outside-allowed/ vs PASS |
| 124 | 186 | killed | cancel-refused permitted after late amends, not late cancels (R6.3, S5) | `action-after-deadline-is-late`; witness D:2/outside-allowed/ vs PASS |
| 125 | 186 | killed | cancel-refused never permitted after D (R6.3) | `timed-out-order`; witness PASS vs D:2/outside-allowed/ |
| 126 | 186 | killed | cancel-refused permitted for every uncounted action | `action-after-deadline-is-late`; witness D:2/outside-allowed/ vs PASS |
| 127 | 186 | killed | cancel-refused permitted for any action after D | `action-after-deadline-is-late`; witness D:2/outside-allowed/ vs PASS |
| 128 | 189 | killed | the timeout fulfilment-cancel window runs to D + 120 (R3.2) | `timeout-strictly-after-deadline`; witness D:3/missed/fst:ORD-1001-0023-F1:cancelled vs PASS |
| 133 | 191 | killed | order-timed-out runs to D + 120 (R3.2) | `timeout-strictly-after-deadline`; witness D:3/missed/ntf:ORD-1001-0023:order-timed-out vs PASS |
| 134 | 191 | killed | order-timed-out opens at D (R3.2, S1) | `timeout-strictly-after-deadline`; witness D:2/early/ntf:ORD-1001-0023:order-timed-out vs PASS |
| 140 | 207 | killed | a cancel at the ready instant is ignored (S11, S12) | `review-answer-and-cancel-in-one-instant`; witness PASS vs D:2/early/fst:ORD-1001-0008-F1:cancelled |
| 143 | 207 | killed | an amend during processing aborts the order (S5) | `review-open-amend-changes-nothing`; witness OPEN vs D:2/outside-allowed/ |
| 146 | 210 | equivalent (grader: contract) | differs only for a report delivered after a cancel of its instant, which the delivery order (§1, S4, S7) excludes | no golden fails it; corpus 0 in 11083 |
| 147 | 210 | equivalent (grader: contract) | `<=` on seq: a report and a cancel never share a seq | no golden fails it; corpus 0 in 11083 |
| 150 | 210 | equivalent (grader: contract) | `||` in the tie clause: as k146, and `at` is monotone in seq | no golden fails it; corpus 0 in 11083 |
| 153 | 210 | killed | only `collected` proves collection (S7: delivered and inTransit do too) | `delivery-report-proves-collection`; witness OPEN vs D:2/outside-allowed/ |
| 156 | 217 | killed | any reservation of F counts for every item (R4.2) | `charge-waits-for-the-last-reservation`; witness OPEN vs D:3/missed/chg:ORD-1001-0007-F1 |
| 157 | 217 | equivalent (grader: stopped) | a second reservation commit anchors the charge: a second commit needs a new key (a re-issued key is deduped, not committed), so the grader stops there (key-split) | fails `second-commit-moves-no-window` (mutate.mjs counts it), no witness; corpus 0 in 11083 |
| 159 | 221 | killed | the charge anchored at the first reservation (R4.2) | `charge-waits-for-the-last-reservation`; witness OPEN vs D:3/missed/chg:ORD-1001-0007-F1 |
| 160 | 222 | equivalent (grader: stopped) | a second charge commit anchors the ship window: as k157 | fails `second-commit-moves-no-window` (mutate.mjs counts it), no witness; corpus 0 in 11083 |
| 161 | 223 | equivalent (grader: stopped) | a second booking moves the collection run: as k157 | fails `second-commit-moves-no-window` (mutate.mjs counts it), no witness; corpus 0 in 11083 |
| 166 | 225 | equivalent (grader: contract) | the message comparator: as k62 | no golden fails it; corpus 0 in 11083 |
| 168 | 226 | killed | a repeated `collected` moves `dispatched` (§3.3, R7.2) | `repeated-carrier-messages-change-nothing`; witness D:3/missed/fst:ORD-1001-0007-F1:dispatched vs PASS |
| 170 | 227 | killed | a repeated `delivered` moves `completed` | `repeated-carrier-messages-change-nothing`; witness D:3/missed/fst:ORD-1001-0007-F1:completed vs PASS |
| 172 | 228 | killed | a repeated `collectionFailed` moves `failed` | `repeated-carrier-messages-change-nothing`; witness D:3/missed/rf:ORD-1001-0007-F1 vs PASS |
| 174 | 229 | equivalent (grader: stopped) | a later permanent failure of the same step moves the failure: that is a retry of a permanently failed step (R5.2), outside-allowed first | fails `fulfilment-fails-at-its-first-failure` (mutate.mjs counts it), no witness; corpus 0 in 11083 |
| 175 | 229 | equivalent (grader: stopped) | a later report failure moves a row failure: needs a booking after a permanent failure, outside-allowed first | fails `fulfilment-fails-at-its-first-failure` (mutate.mjs counts it), no witness; corpus 0 in 11083 |
| 176 | 238 | killed | a delivery in the cancel's instant does not end the order (S13 says it reached the arm first) | `delivery-and-cancel-in-one-instant`; witness PASS vs OPEN |
| 177 | 238 | killed | a collectionFailed in the cancel's instant does not end the order (S13) | `failure-and-cancel-in-one-instant`; witness PASS vs OPEN |
| 181 | 238 | killed | an order never counts as already ended (R6.3) | `cancel-refused-and-cancel-after-the-end`; witness PASS vs OPEN |
| 182 | 240 | killed | cancel-refused window 120 min (R6.3) | `go-live-collected-refuses-cancel`; witness D:3/late/ntf:ORD-1001-0003:cancel-refused vs OPEN |
| 184 | 247 | killed | fulfilment processing window 120 min (R4.1) | `declined-charge-releases-only`; witness D:3/missed/fst:ORD-1001-0007-F1:processing vs D:5/records/ |
| 185 | 254 | killed | a collectionFailed in the cancel's instant is cancelled, not failed (S13) | `failure-and-cancel-in-one-instant`; witness D:2/outside-allowed/ vs D:2/order/rf:ORD-1001-0006-F2 |
| 190 | 256 | equivalent (grader: satisfied) | `forwardOk` inverted: taken steps stop being named while satisfied, steps after a cut are named only after the grader stopped at them | fails `steps-before-vs-after-a-processing-cancel` (mutate.mjs counts it), no witness; corpus 0 in 11083 |
| 191 | 256 | equivalent (grader: satisfied) | no taken step is named: as k39 | fails `steps-before-vs-after-a-processing-cancel` (mutate.mjs counts it), no witness; corpus 0 in 11083 |
| 192 | 256 | equivalent (grader: satisfied) | a step judged by its commit time: an in-flight step stops being named, but the grader matched it (exempt) and keeps it satisfied | fails `steps-before-vs-after-a-processing-cancel` (mutate.mjs counts it), no witness; corpus 0 in 11083 |
| 193 | 258 | equivalent (grader: code) | `items.at(-1).pre`: every item carries the same order-level `pre` | no golden fails it; corpus 0 in 11083 |
| 195 | 260 | equivalent (grader: stopped) | a reservation after the cancel stays named: the grader stops at it first (outside-allowed) | fails `steps-before-vs-after-a-processing-cancel` (mutate.mjs counts it), no witness; corpus 0 in 11083 |
| 200 | 265 | equivalent (grader: stopped) | a charge after the cancel stays named: as k195 | fails `no-new-forward-step-after-a-cancel` (mutate.mjs counts it), no witness; corpus 0 in 11083 |
| 203 | 270 | equivalent (grader: code) | as k193 | no golden fails it; corpus 0 in 11083 |
| 207 | 271 | equivalent (grader: code) | as k193 | no golden fails it; corpus 0 in 11083 |
| 208 | 271 | equivalent (grader: stopped) | a booking after the cancel stays named: as k195 | fails `no-new-forward-step-after-a-cancel` (mutate.mjs counts it), no witness; corpus 0 in 11083 |
| 211 | 274 | equivalent (grader: consumed) | a booked shipment gets no `created` record: after D1 every terminal expectation overwrites it (cancelled, failed, collected, delivered) | no golden fails it; corpus 0 in 11083 |
| 212 | 274 | equivalent (grader: code) | as k193 | no golden fails it; corpus 0 in 11083 |
| 213 | 274 | equivalent (grader: code) | as k193 | no golden fails it; corpus 0 in 11083 |
| 215 | 278 | killed | an in-flight step's compensation window runs from the cancel, not its commit (R6.2) | `cancel-windows-and-in-flight-charge`; witness PASS vs D:3/missed/rel:ORD-1001-0007-F1:SKU-1025 |
| 220 | 281 | equivalent (grader: stopped) | a shipment cancel required after collectionFailed: reachable only when the report follows the cancel, i.e. after the arm missed the shipment cancel at R - 1 min (carriers are guarded) | fails `cancel-before-a-collection-failure` (mutate.mjs counts it), no witness; corpus 0 in 11083 |
| 230 | 298 | equivalent (grader: stopped) | the R5.2 window ignores a later in-flight commit (S14): no step of a failing fulfilment is in flight (R4.2 sequencing, no permanent reservation failure in E8); otherwise outside-allowed first | fails `step-committing-after-a-failure` (mutate.mjs counts it), no witness; corpus 0 in 11083 |
| 239 | 314 | equivalent (grader: code) | as k193 | no golden fails it; corpus 0 in 11083 |
| 249 | 325 | equivalent (grader: consumed) | the inTransit lookup writes `rec` only where `records` stays null (not terminal) | no golden fails it; corpus 0 in 11083 |
| 250 | 325 | equivalent (grader: consumed) | as k249 | no golden fails it; corpus 0 in 11083 |
| 251 | 325 | equivalent (grader: consumed) | as k249 | no golden fails it; corpus 0 in 11083 |
| 252 | 325 | equivalent (grader: consumed) | as k249 | no golden fails it; corpus 0 in 11083 |
| 254 | 331 | killed | R6.2 order-cancel window 120 min | `cancel-before-collection-after-0-steps`; witness D:3/missed/ost:ORD-1001-0007:cancelled vs PASS |
| 256 | 332 | killed | R6.2 order-cancelled notice window 120 min | `cancel-before-collection-after-0-steps`; witness D:3/missed/ntf:ORD-1001-0007:order-cancelled vs PASS |
| 263 | 353 | equivalent (grader: consumed) | `recordsOf` throws for a case with no order: the grader compares records only when the expectation has them (never for no order) | fails `records-of-create-migration-and-no-order` (mutate.mjs counts it), no witness; corpus 0 in 11083 |
| 265 | 355 | equivalent (grader: contract) | `findLast` allocation: one per order | no golden fails it; corpus 0 in 11083 |
| 267 | 358 | equivalent (grader: contract) | `findLast` backlog entry: one per go-live case | no golden fails it; corpus 0 in 11083 |
| 268 | 360 | equivalent (grader: consumed) | the migrated order status read from other rows: records are compared only for complete divergence-free cases, whose final statuses overwrite it | fails `records-of-create-migration-and-no-order` (mutate.mjs counts it), no witness; corpus 0 in 11083 |
| 269 | 360 | equivalent (grader: consumed) | as k268 | fails `records-of-create-migration-and-no-order` (mutate.mjs counts it), no witness; corpus 0 in 11083 |
| 270 | 360 | equivalent (grader: consumed) | as k268 | fails `records-of-create-migration-and-no-order` (mutate.mjs counts it), no witness; corpus 0 in 11083 |
| 287 | 375 | equivalent (grader: consumed) | the case's own create ignored: as k268 (initial statuses are always overwritten) | fails `records-of-create-migration-and-no-order` (mutate.mjs counts it), no witness; corpus 0 in 11083 |
| 288 | 375 | equivalent (grader: consumed) | initial fulfilment statuses swapped: as k287 | fails `records-of-create-migration-and-no-order` (mutate.mjs counts it), no witness; corpus 0 in 11083 |

## 3. Readings adopted (SPEC-E §5; decisions in `../README.md`)

| reading | text in brief | settles |
|---|---|---|
| §1 delivery order; S4 and S7 amended (E8-15) | within an instant events are delivered by `source`, then id: `actor` < `carrier` < `customer-portal` < `shop`; a carrier report with the same time as a cancel has reached the arm first | N5. k146 and k150 are equivalent (grader: contract): a report delivered after a cancel of its instant is not reachable, and the spec now says so |
| S10 same-instant knowledge (E8-16) | a step was taken before a message if taken at an earlier instant, or in the same instant by a call that had not been given that message | N1 is now in the spec. Kills k36–k38 visibly: `steps-before-…` E4, where the call that got the cancel sets `processing` (S9 allows it); the original passes, the mutant re-opens the lid. The grader now applies the same per-message rule (§4) |
| S11 the ready instant (E8-17) | processing from the ready instant, inclusive: a cancel in the instant of the approve or counted amend, delivered after it, is an R6.2 cancel; a customer action delivered before its order's placement names no order | k140, killed by `amend-and-cancel-in-one-instant (S11)` and the S12 golden. The old golden's cancel at p was built after the placement, an order the host never delivers (`customer-portal` < `shop`); it is now a regression golden for "names no order" |
| S12 answer and cancel in one instant (E8-18) | the answer is delivered first: approve, then an R6.2 cancel; reject, then R2.2, and the cancel changes nothing | former A1: k102 and k107 killed; k105 equivalent (grader: contract), since a cancel delivered before an answer of its instant is not reachable |
| S13 endings and failures in a cancel's instant (E8-19) | what reached the arm first came first. A carrier report of the instant came first: a delivery that ends the order means the cancel changes nothing; a collectionFailed fails its fulfilment. A declined charge or permanent carrier error of the instant did not come first, since its result arrives a minute later | former A2 and A3: k176, k177 and k185 killed. The transition changed (§4): the old time-only rule cancelled a fulfilment whose collectionFailed the arm had already acted on in its round-1 call, before the cancel reached it in round 3 |
| S14 a step committing after its fulfilment failed (E8-20) | compensated within 120 min of its commit; the fulfilment's compensation, `failed` status and notice are due within 120 min of the later of failure and commit | former A4: k230 equivalent (grader: stopped). Under R4.2 no step of a failing fulfilment is in flight, and E8 has no permanent reservation failure, so the golden pins the reading for the transition only |

## 4. Oracle changes in this revision, and other findings

**Transition and grader changes**, each with a regression golden or test. The new goldens fail the old transition
(scratch `old/orig.mjs` = blob `09d7752`) exactly on these five points.

- **D1, fixed.** In the aborted branch, a booked shipment that the carrier reports `collectionFailed` now has the record
  `failed`, as the carrier wrote it (`actors.mjs`); before, it stayed `created`.
  - This is reachable only after an arm missed the shipment cancel at R − 1 min: carriers are guarded, so a cancelled
    shipment is never reported on. The grader therefore never compared it, and **k211** is equivalent (grader:
    consumed): every terminal expectation now overwrites `created`.
  - Golden `cancel-before-a-collection-failure (R6.2, R7.1)` (renamed). It now asserts two things:
    1. the shipment cancel is due in [cancel, collection − 1 min] (R6.2 "at once", R4.3);
    2. after the report, `records.shipments[F] === 'failed'`.
  - It no longer asserts `!has(csh)` after the report. That was transition behaviour on a view the grader no longer
    reads (review item 1).
  - **k220** (shipment cancel always required) is equivalent (grader: stopped) for the same reason.
- **S10 per message.**
  - `oracle/view.mjs` records `given`, the truth events a call was given, on each call and each ledger row.
  - `oracle/grade.mjs` gives each withdrawal its cause: the one view item that became visible since the previous
    processing point. A same-instant row is exempt from a withdrawal caused by a delivery its call was not given.
  - Other causes keep the old per-case rule.
  - The transition's `before` takes the counted event, and does the same.
  - Before, a call that was given another message about the order (e.g. a carrier info report) was treated as knowing a
    cancel delivered to another instance in the same instant.
  - Regression test: `test/e8.test.mjs` "grader: same-instant knowledge is per message". It fails on the old grader.
  - The e7 suite, which shares the oracle, still passes (54/54).
- **S11 placement.** `custActions` keeps only actions delivered after the first top-level `order.placed`.
  - Known limit: a call that answers such an action with an effect is graded against the order's subject, because
    decisions are graded per case, not per call. That input is unreachable in generated worlds (no customer action at a
    placement instant).
- **S13.**
  - Each fulfilment carries `failSeen`, the time its failure reached the arm: a report's time, or a failed attempt's time
    plus one minute (its result).
  - `endedBefore` and `aborted` compare with `<=`.
  - Unchanged on every generated world: the specificity check below still shows 0 false rejects.

**Review items 3 and 6.**
- The `golden.mjs` header no longer claims that no golden rests on a same-instant tie. It says a tie is pinned only
  where a reading settles it.
- The S1 goldens assert that the window opens in (D, D + 1 min] and that an effect exactly at D is outside it, not
  `D + 1000`. This covers `timeout-strictly-after-deadline`, `review-timeout-strictly-after-deadline`, the timed-out
  order, the review timeout in `review-first-task-…`, and the item suite's race test.

**Still open** (owner decisions, unchanged from the 2026-10-14 notes):

- N2: repeated refused cancels. One lid per order, so the window moves to the latest refused cancel.
- N3: a repeat cancel after a counted cancel, inside the waiting period. `cancel-refused` is not permitted there.
- N4: S5 vs S8 for a cancel after D that follows a counted amend. The reference both requires the R6.2 cancellation and
  permits `cancel-refused`.
- D2: gl-intake create items fall back to the allocation union.
- D3: `normItems` is order-sensitive for a SKU repeated in one list. This is why k1 and k2 rest on the "ids unique
  within a list" invariant.
- H1: `canonicalArgs` is never swapped in.
- H2: the runner passes `recordsOf`.

## 5. Goldens (47 → 52)

Every golden passes the current transition (item suite: the golden-module test). "Kills" lists only the kills that
count under §0. A mechanical failure on a grader-equivalent mutant is noted as such.

| golden | change | kills under the standard |
|---|---|---|
| `steps-before-vs-after-a-processing-cancel` | S10: rows carry `given`; E4 `processing` set by the call that got the cancel is permitted, not required; E5 a reservation by a call given a carrier report but not the cancel is in flight | k36, k37, k38 (k39–k42, k190–k192, k195 mechanical only) |
| `processing-cancels: a cancel before its placement names no order, an amend never stops` | was "a cancel at the ready instant counts": the cancel at p is now built in delivery order (before the placement) and changes nothing (S11); the amend half (S5) kept | k143 |
| `amend-and-cancel-in-one-instant (S11)` | new; also both at D | k140, k123 |
| `review-answer-and-cancel-in-one-instant (S12)` | new: approve then cancel (R6.2; `processing` set by the approve's call stays required, S10), reject then cancel (R2.2) | k102, k107, k140 |
| `delivery-and-cancel-in-one-instant (S13)` | new | k176, k181 |
| `failure-and-cancel-in-one-instant (S13)` | new: a decline in the cancel's instant (cancelled); a collectionFailed delivered first with one fulfilment (failed, the order ends) and with two (one failed, one cancelled) | k177, k185 |
| `step-committing-after-a-failure (S14)` | new; pins S14 | none (k230 mechanical only) |
| `cancel-before-a-collection-failure (R6.2, R7.1)` | was `cancel-then-collection-failure-no-shipment-cancel (R5.1)`; see §4 D1 | none (k220 mechanical only) |
| `delivery-report-proves-collection (S7)` | was `in-transit-report-proves-collection`, whose lone inTransit report no carrier sends (an inTransit report comes after the collection or, held up, after the delivery report); now W2 order with two fulfilments | k153 |
| `duplicate-placement-changes-no-items` | the second placement now arrives before the arm records the order (the input where the difference reaches the grader) | k77 |
| S1 goldens (four) | (D, D + 1 min], effect at D outside | unchanged kills (k128, k133, k134 and the timeout window mutants) |

## 6. Reproducing (scratch harnesses outside the repo, in the session scratchpad `…/scratchpad/e8fix/`)

- `gen.mjs <transition> <dir>` regenerates `mutate.mjs`'s mutants with a manifest. Run on the old and new source, the
  per-k operator comparison shows 301 = 301 with the same operator at each index; k176, k177 and k185 are inverted.
- `corpus.mjs` builds the 7 corpus worlds' journals. Specificity and `b1lh` solvers run in `sandbox-arm`.
- `gdiff.mjs` is the corpus differential through `gradeCase`.
- `gview.mjs` gives the golden kill matrix and the expectation-level projection.
- `gwit.mjs` and `gwit2.mjs` search for witnesses on golden inputs, with `consistent.mjs` checking carrier consistency.
- `manual.mjs` (k77, k123) and `manual241.mjs` (k241, a 2026-10-14 kill re-checked) are the hand-built witnesses.
- `table.mjs` builds the table and the counts.
