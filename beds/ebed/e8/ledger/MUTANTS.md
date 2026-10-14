# E8 oracle mutants: the 109 survivors of the 2026-10-14 run

This is development and diagnostic evidence ($0, no model calls). The source is `ledger/mutation-20261014.json`, written
by `tools/mutate.mjs` at commit `4016358`: 301 mutants of `transition.mjs`, 192 killed (103 by goldens, 86 by the corpus,
3 by errors), 109 survivors, score 0.638. `transition.mjs` has not changed since that commit (blob `09d7752564f5`). The
scratch regeneration of the mutants reproduced all 109 survivors (k, line, from, to) with 0 mismatches.

Each survivor gets one of these verdicts:

- **killed**: a new golden in `golden.mjs` passes the original transition and fails the mutant. Every kill below was run,
  not inferred: each mutant was a scratch copy of `transition.mjs` with that one line replaced, under `/tmp/claude-0/`
  and outside the repo, run through `runGoldens(mod.referenceTransition, mod.recordsOf)`.
- **equivalent**: no input separates the mutant from the original.
- **equivalent (reachable)**: only inputs that the generator and host cannot produce separate them, and on those inputs no
  spec sentence picks between the two.
- **equivalent (harness)**: the change is only in the exported `canonicalArgs`, which `mutate.mjs` never swaps in.
- **ambiguous**: they differ only on a same-instant or in-flight case that SPEC-E does not settle. A proposed reading is in
  §3. No golden takes a side.

## 1. Result

| verdict | count |
|---|---|
| killed by a new golden | 68 |
| equivalent (all three kinds) | 34 |
| ambiguous | 7 |
| **total survivors** | **109** |

**Expected score, if every confirmed kill holds** (this is not yet a `mutate.mjs` measurement; see §5):

- With the raw formula of `mutate.mjs` (killed / all mutants): (192 + 68) / 301 = **260 / 301 = 0.864**. That is below K1 (0.95).
- Leaving out the 34 equivalent mutants, as E-BED §9.5 allows ("each survivor is equivalent or gets a new golden"):
  260 / 267 = **0.974**. The 7 ambiguous mutants count as survivors here.
- With readings adopted for the ambiguous mutants and goldens added for them: 267 / 267 under the second formula, or
  267 / 301 = 0.887 under the raw one.

Whether K1 counts equivalent mutants in the denominator is a decision for the owner. Under the raw formula,
K1 cannot be reached while 34 equivalent mutants stay in the operator set.

**Differential check of the 42 mutants that no golden kills** (34 equivalent and 7 ambiguous, plus k77 before its golden
was added). I compared the original and each mutant at every grader processing point of every case. The points were the
start, each delivery, call, row, task and task event at its seq, at Infinity and one minute later, and the horizon. I also
compared `recordsOf` per case. The worlds were outside the `mutate.mjs` corpus: `2002:4:80` and `1013:5:60`, with both
reference runs and every control. That gave 34 journals, 126,612 transition points and 2,686 `recordsOf` calls, and
**0 differences for each of the 42 mutants**. To show the harness can see a difference, I ran it on killable mutants in
world `2002:4:80`: k53 differed at 371 points, k184 at 55,620 and k254 at 3,562.

## 2. The 109 survivors

Line numbers are 1-based, in `transition.mjs`. The rule names after each reason are from SPEC-E.

| k | line | verdict | reason (one line) | killing golden / equivalence argument |
|---|---|---|---|---|
| 1 | 14 | equivalent (reachable) | `<=` in `sortBy` reorders only equal keys | Generated SKUs and fulfilment ids are distinct within each list. `sortBy` is reached only through `canonicalArgs`, which is not swapped (k4). For a repeated SKU, see D3 |
| 2 | 14 | equivalent (reachable) | `>=` returns 1 instead of 0 for equal keys | Equal keys never occur (k1). Triage: 20,000 random arrays with duplicate keys sorted the same way |
| 4 | 19 | equivalent (harness) | the guard differs only for null or primitive `args` | The transition calls `canonicalArgs` only with an object literal. `mutate.mjs:100` does not swap `canonicalArgs` (H1) |
| 7 | 20 | equivalent (harness) | other ops' `items`/`fulfilments` would also be normalised | The transition calls it only for `orders.create`. No other schema op has those arrays (H1) |
| 13 | 32 | equivalent (reachable) | `findLast` over editions | Edition intervals [from, to) are disjoint, so at most one matches |
| 15 | 39 | equivalent (reachable) | `findLast` over locations | Location names are unique |
| 16 | 43 | equivalent (reachable) | the loop runs to day 40 | A run is always found by day 15, because bookings end before t0 + 14 d (host horizon) |
| 21 | 50 | equivalent (reachable) | `findLast` over carrier codes | (carrier, code) is unique in each edition |
| 29 | 76 | equivalent (reachable) | `findLast` over fees | One fee row per location |
| 31 | 77 | equivalent (reachable) | `findLast` over the catalog | SKUs are unique |
| 33 | 78 | equivalent (reachable) | `findLast` over customers | Customer ids are unique |
| 35 | 79 | equivalent (reachable) | `findLast` over allocations | One allocation per order (`world.mjs:165`) |
| 36 | 83 | killed | a step emitted by the call that was given the cancel counts as before it (R6.2, §1) | `steps-before-vs-after-a-processing-cancel` (E2) |
| 37 | 83 | killed | a later-instant step from a call without the case's events counts as before (R6.2) | `steps-before-vs-after-a-processing-cancel` (E3), `no-new-forward-step-after-a-cancel` |
| 38 | 83 | killed | both of the above | `steps-before-vs-after-a-processing-cancel`, `no-new-forward-step-after-a-cancel` |
| 39 | 83 | killed | nothing counts as before, so steps taken before a cancel are relieved (S9, R4.1) | `steps-before-vs-after-a-processing-cancel` (E1), `cancel-windows-and-in-flight-charge (R6.2)` |
| 40 | 84 | killed | `matches` never sees the arm's own setStatus, so R4.1 `processing` is relieved (S9) | `steps-before-vs-after-a-processing-cancel` (E1) |
| 41 | 84 | killed | same as k40, with the op inverted | `steps-before-vs-after-a-processing-cancel` (E1) |
| 42 | 84 | killed | same as k40, now every key must differ | `steps-before-vs-after-a-processing-cancel` (E1) |
| 53 | 100 | killed | a lid at index 0 is not replaced, so a status is required twice (R7.2, §4.8). This is reachable: a go-live awaiting order with nothing available is amended. The grader merges by lid, so it never sees it | `awaiting-amend-nothing-available-cancels-once` |
| 62 | 121 | equivalent (reachable) | the action comparator ties when `at` is equal | Views list actions in seq order with `at` nondecreasing (`host.mjs` refuses a wake-up that is not later). The stable sort keeps the order |
| 64 | 123 | killed | gl-dispatched migration reports are ignored, so a cancel after a collection before go-live counts (§3.5, R6.2, R6.3, S7) | `go-live-collected-refuses-cancel` |
| 65 | 124 | killed | the migration lookup picks a non-migration event | `go-live-collected-refuses-cancel` |
| 66 | 124 | equivalent (reachable) | `findLast` migration | A case view holds at most one migration (one per backlog entry, first delivery only) |
| 67 | 125 | killed | the migration's carrier reports are skipped | `go-live-collected-refuses-cancel` |
| 76 | 142 | killed | create items come from the allocation union, not "as placed" (R1.1). Only a split SKU separates the two | `create-items-as-placed-not-as-allocated` |
| 77 | 142 | killed (**triage said equivalent**) | `findLast` takes a later duplicate placement's items. R1.4: "a duplicate: no effect" | `duplicate-placement-changes-no-items`. The generator's duplicates repeat the payload, so the corpus never sees it |
| 78 | 142 | equivalent | dead branch | gl-dispatched implies `pre.created` (lines 82, 138), so the create block at line 139 is skipped |
| 80 | 149 | killed | a gl-intake order is cleared at p whatever its verdict (§3.5 "same rules", R2.1) | `go-live-intake-fraud-reject-cancels` |
| 88 | 154 | equivalent (reachable) | the review-task comparator | As k62. Only `first.at` (the minimum) and an order-free id set are read |
| 89 | 155 | killed | the deadline runs from the last review task (R2.2, S3) | `review-first-task-and-first-answer-decide` |
| 90 | 157 | killed | an amend is taken as the R6.4 cancel (R6.4, S5) | `review-open-amend-changes-nothing`, `review-open-first-cancel-counts` |
| 91 | 157 | killed | the last cancel anchors the R6.4 window (R6.4, R6.3) | `review-open-first-cancel-counts` |
| 92 | 158 | killed | the R6.4 window is 120 min (R6.4 says 60) | `review-open-first-cancel-counts` |
| 99 | 165 | equivalent (reachable) | the answer comparator | As k88 |
| 100 | 166 | killed | the last usable answer clears the order (R2.2 says the first approve; R4.1) | `review-first-task-and-first-answer-decide` |
| 101 | 167 | killed | a cancel exactly at the review deadline no longer counts (R2.2, S1, R6.4) | `review-open-first-cancel-counts` |
| 102 | 167 | ambiguous | a cancel and an answer in the same instant, answer delivered first: the cancel wins | A1 |
| 103 | 167 | equivalent (reachable) | `<=` on seq | A customer action and an answer always come from distinct journal rows, so their seqs differ |
| 104 | 167 | killed | the first non-cancel action (an amend) is taken as the R6.4 cancel | `review-open-amend-changes-nothing`, `review-open-first-cancel-counts` |
| 105 | 167 | ambiguous | same instant, cancel delivered first: the answer wins | A1 |
| 106 | 167 | killed | precedence: an amend before the answer and the deadline counts as a cancel | `review-open-amend-changes-nothing` |
| 107 | 167 | ambiguous | a same-instant cancel counts whatever the delivery order (equal to k102 on reachable views) | A1 |
| 108 | 167 | killed | any action at or before the deadline counts | `review-open-amend-changes-nothing` |
| 109 | 167 | killed | once an answer exists, an earlier cancel no longer counts | `review-open-first-cancel-counts` |
| 110 | 167 | killed | no cancel counts once an answer exists | `review-open-first-cancel-counts` |
| 111 | 167 | killed | the last qualifying cancel anchors the window | `review-open-first-cancel-counts` |
| 112 | 168 | killed | the R6.4 window with the review open is 120 min | `review-open-first-cancel-counts` |
| 123 | 186 | killed | cancel-refused is permitted for a cancel exactly at D after a counted amend (S8, R6.2, R6.3) | `amend-then-cancel-at-deadline-counts (S8)` |
| 124 | 186 | killed | cancel-refused is permitted after late amends, not after late cancels (R6.3, S5, §4.8) | `timed-out-order: window (D, D+60] and late actions` |
| 125 | 186 | killed | cancel-refused is never permitted after D (R6.3) | `timed-out-order: …` |
| 126 | 186 | killed | cancel-refused is permitted for every action that was not counted | `timed-out-order: …`, `amend-then-cancel-at-deadline-counts (S8)` |
| 127 | 186 | killed | cancel-refused is permitted for any action after D | `timed-out-order: …`, `amend-then-cancel-at-deadline-counts (S8)` |
| 128 | 189 | killed | the timeout fulfilment-cancel window runs to D + 120 (R3.2 says D + 60) | `timed-out-order: …` |
| 133 | 191 | killed | order-timed-out runs to D + 120 | `timed-out-order: …` |
| 134 | 191 | killed | order-timed-out opens at D (R3.2 says (D, D + 60]; S1) | `timed-out-order: …` |
| 140 | 207 | killed | a cancel at the ready instant is ignored (R6.2: processing from ready; R2.1, R4.1) | `processing-cancels: …` |
| 143 | 207 | killed | an amend during processing aborts the order (S5) | `processing-cancels: …`, `review-open-amend-changes-nothing` |
| 146 | 210 | equivalent (reachable) | differs only for a same-instant report delivered after the cancel | The host delivers `carrier` before `customer-portal` within one instant (`time.mjs:113`) (N5) |
| 147 | 210 | equivalent (reachable) | `<=` on seq | A report and a cancel never share a seq |
| 150 | 210 | equivalent (reachable) | `||` in the tie clause | As k146, plus `at` is monotone in seq. Migration reports are before t0 |
| 153 | 210 | killed | only `collected` proves collection (S7 says inTransit and delivered do too) | `in-transit-report-proves-collection` |
| 156 | 217 | killed | any reservation of F counts for every item, so the charge comes before every item is reserved (R4.2) | `charge-waits-for-the-last-reservation` |
| 157 | 217 | killed | a duplicate reservation commit anchors the charge window (§4, §1 Keys, R4.2) | `second-commit-moves-no-window` (the grader stops at the duplicate first) |
| 159 | 221 | killed | the charge is anchored at the first reservation, not the last (R4.2) | `charge-waits-for-the-last-reservation` |
| 160 | 222 | killed | a duplicate charge anchors the ship window | `second-commit-moves-no-window` |
| 161 | 223 | killed | a duplicate booking moves the collection, so the shipment cancel runs past R (R4.3) | `second-commit-moves-no-window` |
| 166 | 225 | equivalent (reachable) | the message comparator | As k62. A gl-dispatched export has one carrier message, before t0 |
| 168 | 226 | killed | a repeated `collected` moves `dispatched` (§3.3, R4.4, R7.2) | `repeated-carrier-messages-change-nothing` |
| 170 | 227 | killed | a repeated `delivered` moves `completed` | `repeated-carrier-messages-change-nothing` |
| 172 | 228 | killed | a repeated `collectionFailed` moves `failed` | `repeated-carrier-messages-change-nothing` |
| 174 | 229 | killed | a retried decline moves the failure (R5.2) | `fulfilment-fails-at-its-first-failure` |
| 175 | 229 | killed | a later failure report moves the failure (R5.2, §3.3) | `fulfilment-fails-at-its-first-failure` |
| 176 | 236 | ambiguous | a delivery that ends the last fulfilment in the cancel's instant counts as already completed | A2 |
| 177 | 236 | ambiguous | a failure in the cancel's instant counts as already failed | A3 |
| 181 | 236 | killed | an order never counts as already ended, so a late cancel aborts a failed order (R6.3) | `cancel-refused-and-cancel-after-the-end` |
| 182 | 238 | killed | the cancel-refused window is 120 min (R6.3 says 60) | `cancel-refused-and-cancel-after-the-end`, `go-live-collected-refuses-cancel` |
| 184 | 245 | killed | the fulfilment `processing` window is 120 min (R4.1 says 60) | `taken-forward-steps-stay-asked-for` |
| 185 | 252 | ambiguous | a failure in the counted cancel's instant fails the fulfilment instead of cancelling it | A3 |
| 190 | 254 | killed | `forwardOk` is inverted: taken steps are dropped without a cut and kept after a cancel (R4.2, R6.2) | `taken-forward-steps-stay-asked-for`, `no-new-forward-step-after-a-cancel`, `steps-before-…` |
| 191 | 254 | killed | no taken step is ever required (R4.2) | `taken-forward-steps-stay-asked-for`, `steps-before-…`, `cancel-windows-…` |
| 192 | 254 | killed | a step is judged by its commit time, so an in-flight charge counts as new after the cancel (R6.2) | `cancel-windows-and-in-flight-charge (R6.2)` |
| 193 | 256 | equivalent | `items.at(-1).pre` | Every item carries the same order-level `pre` (line 218). An empty list throws the same way |
| 195 | 258 | killed | a reservation made after the cancel stays required (R6.2) | `no-new-forward-step-after-a-cancel`, `steps-before-…` |
| 200 | 263 | killed | a charge made after the cancel stays required (R6.2) | `no-new-forward-step-after-a-cancel` |
| 203 | 268 | equivalent | as k193 | line 218 |
| 207 | 269 | equivalent | as k193 | line 218 |
| 208 | 269 | killed | a booking made after the cancel stays required (R6.2) | `no-new-forward-step-after-a-cancel` |
| 211 | 272 | killed | a booked shipment gets no record when collectionFailed follows a counted cancel (R7.1) | `cancel-then-collection-failure-no-shipment-cancel (R5.1)` |
| 212 | 272 | equivalent | as k193 | line 218 |
| 213 | 272 | equivalent | as k193 | line 218 |
| 215 | 276 | killed | an in-flight step's compensation window runs from the cancel, not from its commit (R6.2) | `cancel-windows-and-in-flight-charge (R6.2)` |
| 220 | 279 | killed | a shipment cancel is required after the shipment was reported collectionFailed (R5.1) | `cancel-then-collection-failure-no-shipment-cancel (R5.1)` |
| 230 | 296 | ambiguous | the R5.2 window runs from the failure alone, ignoring a later in-flight commit | A4 (unreachable under R4.2 sequencing) |
| 239 | 312 | equivalent | as k193 | line 218 |
| 249 | 323 | equivalent | the `inTransit` lookup | It writes only `rec`, in a branch where `end` stays null, so `records` is null |
| 250 | 323 | equivalent | as k249 | as k249 |
| 251 | 323 | equivalent | as k249 | as k249 |
| 252 | 323 | equivalent | as k249 | as k249 |
| 254 | 329 | killed | the R6.2 order-cancel status window is 120 min (R6.2 says 60) | `cancel-windows-and-in-flight-charge (R6.2)` |
| 256 | 330 | killed | the R6.2 order-cancelled notice window is 120 min | `cancel-windows-and-in-flight-charge (R6.2)` |
| 263 | 351 | killed | `recordsOf` no longer returns null for a case with no order, and throws (§1, §3.2) | `records-of-create-migration-and-no-order` |
| 265 | 353 | equivalent (reachable) | `findLast` allocation | One allocation per order |
| 267 | 356 | equivalent (reachable) | `findLast` backlog entry | One backlog entry per go-live case |
| 268 | 358 | killed | the migrated order status is read from non-order rows (§3.5, R7.1) | `records-of-create-migration-and-no-order` |
| 269 | 358 | killed | it is read from other orders' rows | `records-of-create-migration-and-no-order` |
| 270 | 358 | killed | it is read from any row | `records-of-create-migration-and-no-order` |
| 287 | 373 | killed | the create of the case's own order is ignored (§2 `orders.create`) | `records-of-create-migration-and-no-order` |
| 288 | 373 | killed | the initial fulfilment statuses are swapped (§2) | `records-of-create-migration-and-no-order` |

## 3. Ambiguous mutants and proposed readings (for the owner; SPEC-E and `transition.mjs` are unchanged)

**A1 (k102, k105, k107; `transition.mjs:167`): a customer cancel and a usable review answer at the same time.**

- The text in tension: R6.4 says a cancel "for a recorded order that is not yet cleared (its fraud review is open) counts
  … a later review answer changes nothing". R2.2 says "`approve` before the deadline: the order is cleared at the time of
  the answer".
- Proposed reading, which is what line 167 does now: *"A customer `cancel` and a usable review answer with the same time
  are taken in the order they reached you. A cancel that reached you first counts (R6.4). One that reached you after an
  `approve` is a cancel during processing (R6.2). After a `reject` it changes nothing (R2.2)."*
- If adopted, a golden with a same-instant cancel and answer, in both delivery orders and for both approve and reject,
  kills all three mutants.
- A time-only rule like S4 would instead require a change to line 167. "The cancel wins" matches k102 and k107; "the
  answer wins" matches k105.

**A2 (k176; `transition.mjs:236`): a delivery report that ends the last open fulfilment, in the same instant as a cancel.**

- Proposed reading: *"An order is already `completed` or `failed` (R6.3, second sentence) only when the report or failure
  that ended its last open fulfilment came strictly before the cancel. A cancel in the same instant is judged by R6.2 with
  S4 and S7. If that judgement refuses it because a shipment was collected, `cancel-refused` is required within 60 min, not
  optional."*
- This matches the original. The generator never produces this tie.

**A3 (k177, k185; `transition.mjs:236`, `:252`): a fulfilment failure in the same instant as a customer cancel.**

- The failure can be a decline, a permanent error or `collectionFailed`.
- Proposed reading: *"A failure in the same instant as a `cancel` does not come before it. The cancel counts unless a
  collection report wins (S4). The fulfilment is compensated and set `cancelled` (R6.2), not `failed` (R5.2), and the
  order is cancelled."*
- This matches the original. The generator never combines a failure and a customer action in one case.

**A4 (k230; `transition.mjs:296`): a step of a failing fulfilment that commits after the failure (in flight).**

- R5.2 has no in-flight clause. R6.2 has one for a cancel.
- Proposed reading: *"A step that commits after the failure (one already in flight) is compensated within 120 min of its
  commit. The other compensations keep R5.2's 120 min from the failure."*
- This matches the original (L = max(failure, commits) + 120). It is unreachable under R4.2 sequencing.

## 4. Other findings from triage and integration (owner decisions; nothing changed)

**Readings and clarifications**

- **N1 (supports the k36–k38 golden).** Make explicit the same-instant rule that `before` (line 83) and
  `grade.mjs:94 exemptFrom` already apply: *"A step is taken before an event if it was taken at an earlier instant, or at
  the same instant by a call that had not been given that event. A step taken by a call that had been given a counted
  cancel or customer action, or at a later instant, is taken after it (S9, R6.2)."*
  - The golden's E2 rests on R6.2 ("nothing new … after the cancel", "one already in flight") together with §1 (one call is
    one case-tick).
- **N2. Repeated refused cancels.** The reference has one lid per order (`ntf:O:cancel-refused`), and `lid()` replaces the
  earlier entry, so the window moves to the latest refused cancel.
  - Possible reading: *"Repeated cancels that do not count are answered once: within 60 min of the first. A second
    `cancel-refused` is permitted."*
  - That reading would need a change in the reference.
- **N3. A repeat cancel after a counted cancel, inside the waiting period.** At p+150 or at D, the reference does not
  permit `cancel-refused`. It permits it only after D.
  - R6.3 ("already … cancelled … you may send cancel-refused") suggests it should be permitted.
  - This is a possible oracle gap.
- **N4. S5 and S8 conflict for a cancel after D that follows a counted amend.** The reference both requires the R6.2
  cancellation (line 207) and permits `cancel-refused` (line 186).
  - Proposed reading: *"S5 does not apply to a cancel after a counted amend; S8 governs it."*
- **N5. k146 and k150 are equivalent only because of the host's delivery order.** Within one instant the host delivers
  `carrier` before `customer-portal` (`time.mjs:113`).
  - Proposed addition to S4/S7: *"In one instant the platform delivers carrier messages before customer actions."*

**Oracle defects and latent issues** (`transition.mjs` is out of scope here, so none is fixed)

- **D1. Aborted-branch shipment record.** After a counted cancel, if the carrier then reports `collectionFailed`, the
  expected `rec.shipments[F]` stays `created` (line 272). But the carrier writes `failed` (`actors.mjs:45`).
  - Verified: the golden `cancel-then-collection-failure-no-shipment-cancel` scenario gives `{"ORD-1001-0007-F1":"created"}`.
  - A conforming arm would get a layer-5 `records` divergence. The current generator cannot reach this.
  - Suggested fix: in the aborted branch, `if (s.failedMsg) rec.shipments[F] = 'failed';`. The golden checks only that the
    record exists, so it survives the fix.
- **D2. gl-intake create items.** For a gl-intake order, line 142 looks for `order.placed` only among top-level events,
  but that event is inside the migration. The create's `items` therefore fall back to the allocation union.
  - This breaks R1.1 once a SKU is split across fulfilments. It is unreachable under the current generator.
- **D3. Repeated SKU in one list (found during integration).** `normItems`/`canonicalArgs` is not order-insensitive when a
  SKU repeats within one list: `[{A,1},{A,2}]` and `[{A,2},{A,1}]` normalise differently (verified).
  - R1.1 says list order "is not significant", so an arm that lists such entries in another order would diverge falsely.
  - The generator never repeats a SKU in a placed payload.

**Harness**

- **H1. `canonicalArgs` is never swapped in.** `mutate.mjs` replaces only `referenceTransition` and `recordsOf` (line 100).
  Mutants of `canonicalArgs` (k4, k7, and k1 and k2 through it) can therefore only survive. Passing
  `canonicalArgs: mod.canonicalArgs` there would let them count. Triage found the 44,218 corpus ledger rows normalise
  identically under all four.
- **H2. Runner change made with this ledger.** The change is needed for the records golden.
  - `runGoldens(transition, recordsOf = null)` passes `recordsOf` to every check.
  - `tools/mutate.mjs:79` and `:97` pass `oracleItem.recordsOf` and `mod.recordsOf`.
  - `test/e8.test.mjs:233` passes `recordsOf` from `index.mjs`.
  - Without this change, no golden can reach a mutant's `recordsOf`. The grader never sees k263, k268–k270, k287 or k288
    either: records are compared only for complete, divergence-free cases, whose terminal statuses overwrite these values.

## 5. Goldens added (24 → 47) and how each was verified

Every golden passes the original transition, and all 47 pass `node --test` (the golden-module test). The "kills" column
lists every survivor the golden fails, as confirmed on scratch mutant copies. None of the 41 equivalent or ambiguous
survivors that remain fails any golden.

| golden | rules | confirmed kills |
|---|---|---|
| `steps-before-vs-after-a-processing-cancel` | S9, R4.1, R4.2, R6.2, §1 | 36–42, 190, 191, 195 |
| `awaiting-amend-nothing-available-cancels-once` | R3.2, R6.1, R7.2, §4.8, §3.5 | 53 |
| `go-live-collected-refuses-cancel` | §3.5, R6.2, R6.3, S6, S7 | 64, 65, 67, 182 |
| `go-live-intake-fraud-reject-cancels` | §3.5, R2.1, R6.1 | 80 |
| `create-items-as-placed-not-as-allocated` | R1.1 | 76 |
| `duplicate-placement-changes-no-items` (added during integration) | R1.1, R1.4, §3.1 | 77 |
| `review-open-amend-changes-nothing` | R6.4, S5, R2.2, R4.1 | 90, 104, 106, 108, 143 |
| `review-open-first-cancel-counts` | R6.4, R6.3, R2.2, S1 | 90–92, 101, 104, 109–112 |
| `review-first-task-and-first-answer-decide` | R2.2, S3, S1, R4.1 | 89, 100 |
| `timed-out-order: window (D, D+60] and late actions` | R3.2, S1, R6.3, S5, §4.8 | 124–128, 133, 134 |
| `amend-then-cancel-at-deadline-counts (S8)` | S8, R6.2, R6.3, S5 | 123, 126, 127 |
| `processing-cancels: a cancel at the ready instant counts, an amend never stops` | R2.1, R4.1, R6.2, S9, S5 | 140, 143 |
| `in-transit-report-proves-collection` | S7, R6.2, R6.3 | 153 |
| `taken-forward-steps-stay-asked-for` | R4.1, R4.2 | 184, 190, 191 |
| `cancel-windows-and-in-flight-charge (R6.2)` | R6.2, R4.2 | 39, 191, 192, 215, 254, 256 |
| `no-new-forward-step-after-a-cancel` | R6.2, R5.1 | 37, 38, 190, 195, 200, 208 |
| `charge-waits-for-the-last-reservation` | R4.2 | 156, 159 |
| `second-commit-moves-no-window` | §1 Keys, §4, R4.2, R4.3, R6.2 | 157, 160, 161 |
| `repeated-carrier-messages-change-nothing` | §3.3, R4.4, R4.5, R5.2, R7.2 | 168, 170, 172 |
| `fulfilment-fails-at-its-first-failure` | R5.2, §3.3, R7.2 | 174, 175 |
| `cancel-refused-and-cancel-after-the-end` | R6.3, R6.2, R4.5 | 181, 182 |
| `cancel-then-collection-failure-no-shipment-cancel (R5.1)` | R5.1, R6.2, R7.1 | 211, 220 |
| `records-of-create-migration-and-no-order` | §2 orders.create, §3.5, R7.1, §1, §3.2 | 263, 268–270, 287, 288 |

Changes from the triage proposals:

- **`awaiting-amend-…`** uses W4's real gl-awaiting order (o0002, nothing available) with its real backlog export,
  instead of relabelling W's o0011 as gl-awaiting.
- **In-flight charge parts merged.** The in-flight-charge part of `taken-forward-steps-stay-asked-for` was nearly
  identical to `cancel-windows-and-in-flight-charge`, so I merged it into the latter (which now also kills k192).
- **R5.1 golden made tie-free.** The proposed version put the cancel in the same instant as the `collectionFailed`
  report, which took a side on the A3 tie: it fails k177 (verified on a scratch copy, where m177 is not cancelled). In the
  renamed `cancel-then-collection-failure-…`, the cancel comes 10 min before the report.
- **`in-transit-report-proves-collection`** uses the policy cut-off instead of a hard-coded 30 min.
- **Shared fixtures and editions.** The three review goldens share one fixture block. The timeout, amend and review
  goldens take their hours from the edition in force at p (R1.3).
- **Fixtures fail loudly.** A missing fixture throws at import instead of silently skipping a golden.
- **`duplicate-placement-changes-no-items`** is new, for k77. Triage had called k77 equivalent, but R1.4 decides the
  contradictory-duplicate input.

**Not yet done.** `tools/mutate.mjs` has not been re-run, because it writes mutants into `beds/ebed/e8/.mutants` and runs
the specificity sandbox. The score in §1 is therefore expected, not measured.

Scratch harnesses (under `/tmp/claude-0/`, outside the repo):

- `…/scratchpad/integ/gen.mjs` regenerates the mutants and checks them against the ledger.
- `matrix.mjs` builds the golden × survivor kill matrix.
- `diff.mjs` runs the differential.
- `tie.mjs` checks the proposed same-instant R5.1 golden against m177 and m185.
