# Requirement tracker on E8: first paid run

*2026-10-14. This is a development / diagnostic run on practice worlds 1235–1237 only. It answers the owner's ask:
"log the conditions specified by user normally and check against logic and stuff demanded". The plan was frozen
before the first paid call in [PREREG.md](PREREG.md), with [gold.json](gold.json), [teeth.json](teeth.json) and
[freeze.json](freeze.json). The numbers are in [results.json](results.json). The ledger with its 78 properties is
[ledger.json](ledger.json), and the tracker's own per-build reports are in [reports/](reports/). This is one run of
one text, so every number below is development evidence and nothing more.*

## Bottom line

**Logging the user's conditions works and is cheap. Checking them with cheap-model-written properties does not yet
work:**
- **Cost.** The tracker pipeline cost **$0.13 and about 6 minutes** in total: one Haiku extraction, 78
  Haiku-written properties, and the check of three builds. A re-check costs **$0** and takes about 1 minute for 3
  builds × 3 worlds. All paid calls in this evaluation together, including the Sonnet comparison arm, cost $0.33 of the
  $3 cap.
- **Lineage 3's partial-reserve defect is caught.** The line-162 requirement Q-043 fails 4/4. Those are exactly the
  4 cases the bed oracle fails for lineage 3 on world 1237 (193/197).
- **B1-O's batch keying is not caught by any requirement.**
  - Extraction missed SPEC-E line 47 ("each item carries its own `key`").
  - In the gold-ledger ablation, the property Haiku wrote for line 47 reads only applied effects. Every B1-O reserve
    was refused by the platform, so the property reads `untested`.
  - The defect is visible only in run health: 39, 63 and 183 refused outputs, with the first reason "a batch op keys
    its items, not the batch".
- **False alarms make the output unusable as a verdict today.** None of them is a solver error:
  - **Lineage 1:** 16 of 78 requirements fail (the target was ≤ 1), yet the oracle passes 331/331 of its completed
    practice cases. All 16 are the tracker's fault.
  - **Reference runs:** 21 requirements fail (the target was 0). These are property bugs, plus a reference policy
    that skips reads and acts on commit times a real workflow cannot see.
  - **Mutation score:** 0.16 (the bar was 0.8).
- **The dominant cause is the property writer.**
  - It sees only the quote and the trace API, so it guesses the vocabulary. It invented a `decisions` effect, a
    `cancel` op with a `reason` argument, an inbound `ready` event, and a `compensate` op.
  - The G2 contrast pair still passes, because the writer builds both mini-traces from the same guesses. G2 checks
    that a property is consistent with itself, not that it matches the real trace shape.
  - 44 of 78 requirements read `untested` on lineage 1. Many of them are conditions the worlds exercise hundreds of
    times, such as `collected` → `dispatched` and the order outcome. The property never matches the real message
    shape.
- **Extraction recall is below the 0.95 bar.**
  - **Haiku id recall:** 0.77 on the primary sample, 0.93 on the second, and 0.00 on the third (a raw failure: one
    entry).
  - **Sonnet id recall:** 0.53–0.57.
  - **Readings S1–S9:** both models mostly skip them.
  - **Switch rule:** it fires on the letter, but Sonnet is not better, so switching is not recommended.

## 1. What ran

| step | what | model | $ | wall |
|---|---|---|---|---|
| freeze | gold (30 ids, 15 U statements, 76 clauses), control map, expected outcomes, thresholds, budget | none | 0 | none |
| extract | SPEC-E → ledger, 3 samples. Sample 0 is primary (78 entries kept, 1 dropped). | `claude-haiku-5-5` | 0.034 (0.011 each) | 59–72 s each |
| write | one property per entry, with the G2 contrast pair: 80 calls, 2 rewrites, 0 escalations, 1 "not observable", 0 untrustworthy | `claude-haiku-5-5` (escalation `claude-sonnet-5-5`, never used) | 0.117 | 4.0 min (concurrency 4) |
| check | 3 builds × 3 practice worlds; solvers in `sandbox-arm`, properties in the executor sandbox | none | 0 | 42 s (74 s under load) |
| ablation | gold entries for line 162 and line 47; properties still Haiku-written | `claude-haiku-5-5` | 0.003 | 18 s + check |
| Sonnet arm | extraction only, 3 samples | `claude-sonnet-5-5` | 0.175 | 22–27 s each |
| calibrate | reference runs (earliest and latest) and 9 necessity controls on the worlds where they apply (analyst-side) | none | 0 | 2.5 min |
| adjudicate | every failing instance joined by subject to the bed oracle's verdict on the same run (analyst-side) | none | 0 | 35 s per build |

**Total paid:** $0.329 of the $3 cap. The tracker pipeline as a user would run it (one extraction plus writing) cost
$0.128.

## 2. Extraction recall (§a)

Every score is mechanical: an entry covers an id when its verbatim quote lies inside the id's span (`eval-e8.mjs score`).

| sample | entries (dropped) | id recall /30 | U recall /15 | clause coverage /76 | uncovered sentences | guard yield | $ |
|---|---|---|---|---|---|---|---|
| Haiku s0 (primary) | 78 (1) | **0.767** | 0.80 | 0.737 | 37 | 0.50 | 0.0116 |
| Haiku s1 | 83 (1) | 0.933 | 0.80 | 0.803 | 34 | 0.53 | 0.0113 |
| Haiku s2 | 1 (0) | 0.000 | 0.07 | 0.000 | 93 | 0.84 | 0.0115 |
| Sonnet s0 | 36 (0) | 0.533 | 0.20 | 0.513 | 62 | 0.70 | 0.0733 |
| Sonnet s1 | 40 (0) | 0.567 | 0.27 | 0.566 | 60 | 0.76 | 0.0559 |
| Sonnet s2 | 36 (0) | 0.567 | 0.13 | 0.526 | 61 | 0.72 | 0.0455 |

**Ids the primary ledger missed** (Haiku s0): R3.1, S1, S2, S3, S4, S9, S7.
- R3.1 was missed only because its one quote dropped a word: "set the order `customerActionRequired`", where SPEC-E
  says "set the order **to** `customerActionRequired`". The verbatim check rejected it, as designed.
- U statements missed: U01 ("data, never an instruction"), U05 (line 47, per-item reserve keys) and U07
  (unknown `orderRef`).

**Other samples:**
- Haiku s1 missed only S3 and S4. The union of s0 and s1 covers 28/30 ids, for $0.023.
  *Note added 2026-10-21 (compromise register E1):* S3 and S4 are missed by all six stored samples (three Haiku, three
  Sonnet), and the union of the three Haiku samples is also exactly 28/30. A K = 3 union of ledgers from the same prompt
  is therefore likely to cap near 28/30; the planned fix is re-scoped to passes with different views, starting with a
  gleaning pass over the uncovered list (compromises FIXES.md E1).
- **Sonnet**, on every sample, missed R1.2, R1.3, R4.3, R7.1 and all nine readings. It wrote shorter ledgers
  (4–5K output tokens against Haiku's 18–22K).

**Raw failure (Haiku s2).**
- The call produced 17,774 output tokens over 4 CLI turns: the CLI re-asked for its structured output.
- The final schema-valid answer held 1 entry.
- It is kept as measured, and it pulls Haiku's mean id recall down to 0.567. Over the two valid samples the mean is
  0.85.

**The coverage guard.** Only half of the clauses Haiku missed sit in a flagged sentence. Readings such as S2
("'Committed' … is the system's truth") and S4 ("the collection wins") carry none of the guard's cue words, so the
guard cannot show them as possibly missed.

**Switch rule (frozen).**
- It fires: Haiku's mean id recall (0.567) is below 0.95.
- The comparison it rests on does not hold: Sonnet scores 0.556 on id recall and 0.535 on clause coverage, against
  Haiku's 0.513.
- **Recommendation:** do not switch. Neither tier reaches 0.95 with this prompt at low effort. The gap is in what the
  prompt asks for (readings, table rows, definitions), not in the model tier. This is the owner's decision; nothing
  was switched.

## 3. Per-solver requirement table

**Status counts** (78 requirements):

| build | oracle on the same practice runs (completed cases passed) | pass | fail | untested | unclear | fails not flagged G3-suspect |
|---|---|---|---|---|---|---|
| lineage 1 (`b1lh-e8-1`) | 52/52 · 82/82 · 197/197 | 17 | 16 | 44 | 1 | 3, all false |
| lineage 3 (`b1lh-e8-3`) | 52/52 · 82/82 · 193/197 | 16 | 18 | 43 | 1 | 5, of which 1 real (Q-043) |
| B1-O (`b1o-e8-1`) | 15/52 · 27/82 · 49/197 | 9 | 15 | 53 | 1 | 2, neither names B1-O's defect |

**Run health:**
- Lineages 1 and 3 had 0 refused tick outputs.
- B1-O had 39, 63 and 183 refused tick outputs, with the first reason "a batch op keys its items, not the batch".
- Traces were 0.50, 0.94 and 2.40 MB for lineage 1. The solver runs took 2.9, 4.2 and 9.1 s.

**Reading the table:**
- **fail f/n:** f failing instances out of n triggered.
- **pass n:** n instances decided, none of them false.
- **untested (n null):** n instances triggered, all censored or undecidable.
- **SPEC-E:** the gold id or ids whose span holds the quote, and the quote's line.

| id | SPEC-E | kind | quote (first 60 chars) | lineage 1 | lineage 3 | B1-O | note |
|---|---|---|---|---|---|---|---|
| Q-001 | U02 l.23 | must | and reuse it for every attempt of that effect. | untested | untested | untested |  |
| Q-002 | U02 l.23 | never | Never reuse a key for a different effect. | pass 4 | untested | untested |  |
| Q-003 | - l.26 | order | `after: <key>` on an effect makes it wait for that effect of… | untested | untested | **fail** 125/125 | fails on reference runs |
| Q-004 | U03 l.31 | must | If it belongs to a case you already run, return `merge: { in… | pass 133 | pass 118 | pass 123 |  |
| Q-005 | U04 l.35 | must | `decisions.subject` is the order id (§3.1) the instance work… | **fail** 1976/1976 | **fail** 1921/1921 | **fail** 553/553 | L1 false alarm: property bug (G3 suspect) |
| Q-006 | U06 l.64 | must | **Normalise every order id you read anywhere** by trimming s… | pass 67 | pass 67 | pass 67 |  |
| Q-007 | U06 l.66 | never | The same order can be delivered more than once; it is still … | **fail** 460/460 | **fail** 456/456 | untested | L1 false alarm: property bug |
| Q-008 | U08 l.78 | never | a code the table does not list is treated as `info`. | untested | untested | untested |  |
| Q-009 | U09 l.80 | never | Messages about a shipment you cancelled, or about a fulfilme… | untested | untested | untested |  |
| Q-010 | U10 l.86 | never | `late: true` means after the `dueAt` you set; whether an ans… | untested | untested | untested |  |
| Q-011 | U11 l.93 | must | Carrier messages for shipments booked before go-live carry n… | **fail** 2/6 | **fail** 2/6 | **fail** 2/6 | L1 false alarm: property bug (G3 suspect) |
| Q-012 | U12 l.98 | must | Every window below is inclusive and in calendar minutes. **A… | unclear | unclear | unclear |  |
| Q-013 | U12 l.98 | never | Acting before a rule asks for an effect, an effect the rules… | untested | pass 4798 | pass 1001 |  |
| Q-014 | R1.1 l.104 | deadline | Within **60 min** of `p`: read `inventory.allocate` and reco… | pass 367 | pass 367 | pass 367 | fails on reference runs |
| Q-015 | R1.2 l.110 | must | when its location is not `null` (an unavailable fulfilment h… | untested | untested | untested |  |
| Q-016 | R1.2 l.110 | must | `totalMinor` = Σ `amountMinor` over all the order's fulfilme… | pass 336 | pass 336 | pass 336 |  |
| Q-017 | R1.3 l.114 | must | The edition in force at `p` is the published edition with th… | untested (367 null) | untested (367 null) | untested (367 null) |  |
| Q-018 | R1.4 l.118 | never | A placed order whose id you already recorded is a duplicate:… | **fail** 31/37 | **fail** 31/37 | **fail** 25/37 | L1 false alarm: property bug (G3 suspect) |
| Q-019 | R2.1 l.122 | must | Read `fraud.check` for every new order. | **fail** 37/367 | **fail** 37/367 | **fail** 37/367 | L1 false alarm: property bug (G3 suspect) |
| Q-020 | R2.1 l.123 | must | `pass`: the order is **cleared** at `p`. | untested | untested | untested |  |
| Q-021 | R2.1 l.124 | deadline | `reject`: cancel the order (R6.1) within **120 min** of `p`,… | **fail** 6/6 | **fail** 4/4 | **fail** 4/4 | L1 false alarm: property bug + spec gap (G3 suspect) |
| Q-022 | R2.1 l.125 | deadline | `review`: create one human task (R2.2) within **120 min** of… | untested | untested | untested |  |
| Q-023 | R2.2 l.127 | must | The review task: `kind: fraudReview`, `role: fraudAnalyst`, … | pass 19 | pass 19 | pass 19 |  |
| Q-024 | R2.2 l.129 | must | from the creation of the **first** review task for the order… | **fail** 19/19 | **fail** 19/19 | **fail** 19/19 | L1 false alarm: property bug (G3 suspect) |
| Q-025 | R2.2 l.131 | must | `approve` before the deadline: the order is **cleared** at t… | **fail** 8/8 | **fail** 8/8 | **fail** 8/8 | L1 false alarm: property bug (G3 suspect) |
| Q-026 | R2.2 l.132 | deadline | `reject` before the deadline: cancel the order (R6.1) within… | untested | untested | untested |  |
| Q-027 | R2.2 l.134 | when-then | reason `fraud-review-timeout` (an answer exactly at the dead… | **fail** 7/7 | **fail** 7/7 | **fail** 7/7 | L1 false alarm: property bug + spec gap (G3 suspect) |
| Q-028 | R2.2 l.134 | never | A later answer changes nothing. | pass 5 | untested | untested |  |
| Q-029 | R2.2 l.135 | never | An answer counts only if it carries `decision`; free text is… | untested | untested | untested |  |
| Q-030 | R3.2 l.142 | must | The customer has until the **deadline D = p + `customerActio… | untested | untested | untested |  |
| Q-031 | R3.2 l.142 | must | The first `amend` or `cancel` for the order whose time is **… | **fail** 304/367 | **fail** 304/367 | **fail** 304/367 | L1 false alarm: property bug (G3 suspect) |
| Q-032 | R3.2 l.144 | never | Later actions and repeats change nothing. | untested | untested | untested |  |
| Q-033 | R3.2 l.145 | deadline | within **60 min** of a, set every unavailable fulfilment `ca… | untested | untested | untested |  |
| Q-034 | R3.2 l.146 | when-then | If none is available, cancel the order (R6.1), reason `nothi… | untested | untested | untested |  |
| Q-035 | R3.2 l.148 | deadline | `cancel` at time a: cancel the order (R6.1) within **60 min*… | **fail** 60/60 | **fail** 60/60 | **fail** 60/60 | L1 false alarm: property bug + spec gap (G3 suspect) |
| Q-036 | R3.2 l.149 | deadline | nothing counted by D: **after D** and at the latest **D + 60… | untested | **fail** 35/35 | **fail** 367/367 |  |
| Q-037 | R3.2 l.150 | never | Because an action exactly at D counts, a timeout taken at D … | untested | untested | untested |  |
| Q-038 | R4.1 l.155 | must | An order with no unavailable fulfilment is **ready** when it… | untested | untested | untested |  |
| Q-039 | R4.1 l.155 | deadline | When an order is ready at time t: set the order `processing`… | untested | untested | untested |  |
| Q-040 | R4.1 l.156 | never | Nothing about an order (a status, a reservation) is done bef… | **fail** 33/2654 | **fail** 33/2646 | **fail** 25/432 | L1 false alarm: property bug (missing context) (G3 suspect) |
| Q-041 | R4.2 l.159 | order | For each available fulfilment, in this order (each step only… | **fail** 11/491 | **fail** 7/487 | untested | L1 false alarm: property bug |
| Q-042 | R4.2 l.161 | deadline | **Reserve** every item of the fulfilment at its location (`i… | untested | untested | untested |  |
| Q-043 | R4.2 l.161 | must | If a batch comes back `partial`, resubmit only the failed it… | untested (4 null) | **fail** 4/4 | untested | line 162: catches lineage 3 |
| Q-044 | R4.2 l.163 | deadline | **Charge** the fulfilment's `amountMinor` (`billing.charge`,… | pass 266 | pass 266 | untested | fails on reference runs |
| Q-045 | R4.2 l.165 | deadline | **Ship**: book the shipment (`carrier.create` with the fulfi… | pass 462 | pass 458 | untested | fails on reference runs |
| Q-046 | R4.2,U13 l.169 | must | correct it and re-issue it, with the same key, inside the st… | untested | untested | untested |  |
| Q-047 | R4.2,U13 l.170 | never | It is not a failure of the fulfilment. | untested | untested | untested |  |
| Q-048 | R4.3 l.173 | must | A shipment booked at least `collectionCutoffMinutes` (`polic… | untested | untested | untested |  |
| Q-049 | R4.3 l.174 | never | **Collection is the point of no return** for its fulfilment:… | pass 31 | pass 31 | untested |  |
| Q-050 | R4.4 l.178 | deadline | `collected`: set the fulfilment `dispatched` within **120 mi… | untested | untested | untested |  |
| Q-051 | R4.4 l.179 | order | `delivered`: set the fulfilment `completed` within **120 min… | untested | untested | untested |  |
| Q-052 | R4.4 l.181 | never | `inTransit`, `info`: nothing. | untested | untested | untested |  |
| Q-053 | R4.4 l.182 | when-then | `collectionFailed`: the fulfilment fails (R5.2). | untested | untested | untested |  |
| Q-054 | R4.5 l.184 | deadline | When every fulfilment of a processing order is `completed`, … | untested | untested | untested |  |
| Q-055 | R5.1 l.192 | order | then release each of its reserved items (only items whose re… | pass 76 | pass 76 | untested |  |
| Q-056 | R5.1 l.193 | must | A step counts as committed if its result was `ok`, or if its… | pass 2853 | pass 2849 | pass 1199 |  |
| Q-057 | R5.1 l.194 | never | Never undo a step that did not commit; never undo a step twi… | untested (93 null) | untested (93 null) | untested |  |
| Q-058 | R5.2 l.196 | when-then | A fulfilment **fails** when its charge is declined (`402 car… | pass 35 | pass 35 | untested |  |
| Q-059 | R5.2 l.198 | deadline | Then, within **120 min** of the failure (the time of the dec… | **fail** 35/35 | **fail** 35/35 | untested | L1 false alarm: property bug |
| Q-060 | R5.2 l.199 | never | Do not retry a permanently failed step. | pass 35 | pass 35 | untested |  |
| Q-061 | R5.2 l.200 | never | Other fulfilments of the order are not affected. | untested | untested | untested |  |
| Q-062 | R6.1 l.204 | deadline | **Cancelling an order** before any of its steps committed: w… | untested (60 null) | untested (60 null) | untested (60 null) |  |
| Q-063 | R6.2 l.209 | must | has been reported `collected` at or before the time of the c… | untested | untested | untested |  |
| Q-064 | R6.2 l.210 | deadline | Within **60 min** of the cancel, compensate every fulfilment… | **fail** 21/60 | **fail** 21/60 | **fail** 8/60 | L1 false alarm: property bug (missing context) (G3 suspect) |
| Q-065 | R6.2 l.212 | deadline | A step that commits after the cancel (one already in flight)… | untested | untested | untested |  |
| Q-066 | R6.2 l.212 | never | Book, charge or reserve nothing new for the order after the … | pass 60 | pass 60 | pass 60 |  |
| Q-067 | R6.2 l.213 | must | The carrier may collect at any collection time, so cancel a … | untested | untested | untested |  |
| Q-068 | R6.3 l.216 | deadline | A `cancel` that does not count because a shipment was collec… | untested | untested | untested |  |
| Q-069 | R6.3 l.217 | never | A `cancel` for an order that is already `completed`, `failed… | untested | untested | untested |  |
| Q-070 | R6.4 l.220 | deadline | A `cancel` for a recorded order that is not yet cleared (its… | untested | untested | untested |  |
| Q-071 | R7.1 l.225 | must | The business records must end up describing what happened: | untested | untested | untested |  |
| Q-072 | R7.2 l.231 | never | Set each status of an order or fulfilment at most once. | **fail** 1218/2159 | **fail** 1210/2155 | **fail** 762/1255 | L1 false alarm: property bug (G3 suspect) |
| Q-073 | R7.2 l.232 | never | A late or repeated message never moves a status back. | pass 1 | pass 1 | untested |  |
| Q-074 | U14 l.236 | must | `to` is the customer's `email` (`master/customers.json`) | untested (229 null) | untested (233 null) | untested (191 null) |  |
| Q-075 | U15 l.248 | must | Send each required notification exactly once. | pass 229 | pass 233 | pass 191 |  |
| Q-076 | S5 l.257 | never | An amend for an order with no unavailable fulfilment, or any… | untested | untested | untested |  |
| Q-077 | S6 l.259 | never | Collection of one fulfilment ends the customer's right to ca… | untested | untested | untested |  |
| Q-078 | S8 l.261 | must | after a counted `amend` the order is ready and processing, a… | untested | untested | untested |  |

## 4. Were the known defects caught? (§b)

| defect (span) | requirement | lineage 1 | lineage 3 | B1-O | caught? |
|---|---|---|---|---|---|
| lines 161–162: partial → resubmit only the failed items, original keys | Q-043 | untested (4 triggered, all null) | **fail 4/4** | untested | **yes**: `ORD-1237-0062/-0100/-0158/-0190` are the 4 cases the oracle fails |
| line 47 / §1 keys: one key per reservation item | Q-001, Q-002 (§1); line 47 not extracted | untested · pass | untested · untested | untested · untested | **no**: missed at extraction |
| line 47, gold-ledger ablation | G-001 (gold quote, Haiku property) | pass 495 | pass 491 | **untested** | **no**: a check miss |
| R4.2 step 1: reserve every item within 120 min of t | Q-042 | untested | untested | **untested** | **no**: anchored on an invented `ready` inbound event, so it never triggers |
| line 162, gold-ledger ablation | G-002 | untested (4 null) | **fail 4/4** | untested | yes (reproduces Q-043) |

**Verdict (b): fail.** One of the three defect cells was caught. No lineage-1 cell is `fail`, as required.

**Why B1-O escapes:**
- Its reserves never reach a system. Every one sits in `t.refused[].proposed`.
- The trace API says that a condition about what the workflow tried to do may need to read `t.refused`. Neither Haiku
  property does.

**Why lineage 1 reads `untested` on line 162 instead of `pass`:**
- The property ends the window when the instance closes, and lineage 1 never closes order instances, so every verdict
  stays `null`.
- It also requires the resubmission to come strictly after the partial result (`>`). Lineage 1 resubmits in the same
  instant.
- If lineage 1 closed its instances, the strict `>` alone would turn these 4 into false alarms. The reference runs
  show exactly that (§5.2).

## 5. False alarms (§c)

### 5.1 Lineage 1: 16 failing requirements

All 16 are the tracker's fault. Each one was inspected by reading the property and a failing trace excerpt. Every
failing instance was then joined by subject to the oracle's verdict on the same run. Lineage 1 passes all 331
completed practice cases, and no failing instance lands on a case the oracle fails.

| id | SPEC-E | failing instances | cause | what the property got wrong | G3 suspect |
|---|---|---|---|---|---|
| Q-005 | §1 subject (U04) | 1976 | property bug | looks for an invented `decisions` effect; the declared subject is `t.instances[].subject` | yes |
| Q-007 | §3.1 (U06) | 460 | property bug | `/create/` also matches `carrier.create`, so every shipment counts as a second creation of the order | no |
| Q-011 | §3.5 (U11) | 2 | property bug | reads "must be matched" as "an effect must follow every ref-less carrier message"; a repeated `delivered` report for a completed fulfilment correctly changes nothing (§3.3) | yes |
| Q-018 | R1.4 | 31 | property bug | counts the original order's later effects (same subject, after the duplicate arrived) as caused by the duplicate | yes |
| Q-019 | R2.1 | 37 | property bug | counts a duplicate `order.placed` as a "new order" | yes |
| Q-021 | R2.1 | 6 | property bug + spec gap | anchors R2.1's `reject` on a review answer (R2.2's trigger) and wants an op named `*cancel*` whose args name "fraud". No API op carries a reason: `orders.setStatus` takes `orderId`, `fulfilmentId`, `status`. | yes |
| Q-024 | R2.2 | 19 | property bug | demands a workflow timer whose kind matches `/review/`, an implementation choice SPEC-E never states | yes |
| Q-025 | R2.2 | 8 | property bug | treats "cleared" (a state) as an effect named `*clear*` | yes |
| Q-027 | R2.2 | 7 | property bug + spec gap | wants "fraud-review-timeout" inside a cancel op's args; the reason has no API field | yes |
| Q-031 | R3.2 | 304 | property bug | turns "the first amend or cancel at or before D **counts**" into "every order must get one by D" | yes |
| Q-035 | R3.2 | 60 | property bug + spec gap | wants an op named `*cancel*` with `args.reason = customer` | yes |
| Q-040 | R4.1 | 33 | property bug (missing context) | ignores go-live: migrated orders were recorded before go-live (the migration payload) | yes |
| Q-041 | R4.2 | 11 | property bug | compares a fulfilment's charge with the order's first reserve, not the reserve "of the same fulfilment" | no |
| Q-059 | R5.2 | 35 | property bug | looks for an op named `*compens*`; compensation is `carrier.cancel`, `billing.refund` and `inventory.release` | no |
| Q-064 | R6.2 | 21 | property bug (missing context) | ignores whether the cancel counts (after collection it is refused, R6.2/R6.3); reads an invented `payload.counted` | yes |
| Q-072 | R7.2 | 1218 | property bug | keys a fulfilment's status by `args.orderId`, which is always present, so setting F1 and F2 to `processing` counts as setting the order twice | yes |

**By cause** (the design's four categories):
- extraction misreading: 0;
- property bug: 16, of which 3 are co-caused by a spec gap and 2 by missing context;
- anchor slack: 0;
- spec ambiguity alone: 0.

**The spec gap:**
- SPEC-E asks for a cancellation "reason `fraud`", "`customer`" and so on, but no system op has a field for a reason.
- The condition is not observable, and a property should have said so (`observable: false`).
- This is worth fixing in SPEC-E or in the API, independently of the tracker.

**Lineage 3 and B1-O:**
- On **lineage 3**, Q-041 fires on the same 5 orders as on lineage 1, 4 of which are the partial-reserve cases. It
  hits failing cases there by coincidence.
- On **B1-O**, 337 of the 553 Q-005 alarms land on cases the oracle fails. B1-O fails 75% of its cases (R4.1
  missed), so the coincidence is expected. None of B1-O's alarms names its actual defect.

### 5.2 Reference runs, G3 and teeth (§c and G4)

**Reference runs: 21 requirements fail (the target was 0).**
- The 16 above fail there too.
- Five fail only on reference runs:

| id | cause | what happened |
|---|---|---|
| Q-003 | extraction precision + property bug | The quote states platform behaviour (`after: <key>`), not a workflow obligation. The property compares an after-chained effect's emission time with its predecessor's result time. |
| Q-014 | G4 validity limit | The bed's reference policy is oracle-informed and never emits the `inventory.allocate` read that R1.1 requires. Lineage 1 passes Q-014 on 367/367 orders. |
| Q-043 | property bug | Strict `>`: the reference resubmits in the same instant the partial result arrives, and closes the instance. |
| Q-044, Q-045 | G4 validity limit + property bug | The reference charges at the commit instant, 1 s before the reserve result is delivered, using commit times a real workflow cannot see. Q-044 also groups reserves by order, not by fulfilment. |

**Reference runs are not always valid known-good traces for the tracker.**
- They skip reads, and they act on commit times that no real workflow can see.
- The design assumed they were. Any future G4 run needs a reference arm that reads and waits for delivered results.

**G3 (K = 3).**
- 13 requirements fail on every build and are flagged `suspect`: Q-005, Q-011, Q-018, Q-019, Q-021, Q-024, Q-025,
  Q-027, Q-031, Q-035, Q-040, Q-064, Q-072.
- Every one is a lineage-1 false alarm. G3 catches 13 of the 16.
- A user who sets the suspects aside sees 3 false alarms on lineage 1 (Q-007, Q-041, Q-059).
- On lineage 3 that user sees 5 fails, of which 1 is real.

**Teeth.**
- **Mutation score:** 3/19 (control, id) pairs = **0.16** (the bar was 0.8). The pairs that hit:
  - no-compensation → R5.2 (Q-058);
  - last-signal-wins → R7.2 (Q-073);
  - charge-twice → §1 keys (Q-001).
- **Two pairs have no covering requirement:** no-keys → line 47 (missed at extraction), and timer-first → S1 (missed
  at extraction).
- **Most other pairs fail for one of two reasons:** the covering property already fails on the reference runs, or it
  never triggers.

## 6. Cost and time (§d)

- **One-off cost of the tracker** for a 275-line spec: $0.128 (Haiku extraction $0.012 plus 78 properties $0.117).
  That is about a quarter of one Haiku build ($0.39–$0.53), which meets the target.
- **Wall time:** about 6 minutes in total: about 1.1 min for extraction, 4.0 min for writing at concurrency 4, and
  0.7–1.2 min for the check.
- **Each re-check** of a new build costs $0 and takes about 15–25 s per build across the 3 worlds.
- **The analyst-side evaluation** (calibration plus adjudication) cost $0 and took about 4 minutes.
- **Escalations:** none. Every property passed its own contrast pair within 2 attempts, which is the problem described
  in §7.

## 7. What this says about the design

**1. G2 cannot catch the main failure.**
- A contrast pair tests that a property agrees with the writer's own idea of the trace.
- 77 of 78 properties passed their pair, yet at least 16 of them read invented fields.
- The writer is starved of vocabulary that the user's own text and platform do have: the §2 systems table, the §3
  payloads, `api/<system>.schema.json` and the carrier-code table.
- **The cheapest fix that keeps G1** is to give the writer that shared, build-independent vocabulary. A G1-safe $0
  lint could also flag any system, op, event type or payload field in a property that is not in that vocabulary.

**2. `untested` is mostly "never matched", not "not exercised".** Examples:
- `collected` → `dispatched` (Q-050) looks for `payload.status === 'collected'`, but carriers send codes such as
  `COLLECTED` that must be translated through `rulebook/<edition>/carrier-codes.json`.
- R2.1 review creation (Q-022) looks for a verdict in an inbound message. The verdict is `fraud.check`'s result.
- `cancel-refused` (Q-068) looks for an op of that name. It is a `notify.send` template.

A runner-side flag "untested on every build" (like G3, $0) would expose these.

**3. Extraction is the cheaper half to fix.**
- Two Haiku samples cover 28/30 ids for about $0.02.
- Prompting explicitly for readings and table rows, and choosing quotes so that the verbatim check passes, are
  prompt changes.

**4. Same-instant boundaries.** Windows in SPEC-E are inclusive, and the platform delivers results and lets a workflow
act in the same instant. Two properties used strict comparisons there. The writing rules should say so.

None of these were applied in this run. They are the next iteration, to be preregistered as a new version (trace API
v1.1 and writer prompt v2), because changing them changes every property.

## 8. Tracker fixes made in this run

All 24 tests pass, 2 of them new.

1. **`extract.mjs` and `run.mjs`: low-coverage flag.**
   - An extraction that keeps fewer entries than the normative sentences it leaves uncovered is now flagged in
     `ledger.extractor.lowCoverage`, and the CLI warns.
   - The CLI turn count is recorded in `ledger.extractor.turns`.
   - Found when Haiku s2 returned 1 entry after 4 CLI turns. The flag also fires on all three Sonnet samples. Their
     raw ledgers were written before the flag was renamed from `degenerate`, so they carry the old name.
2. **`report.mjs`: refused-output warning.** When the platform refused tick outputs, `report.md` now warns that
   `untested` rows are not evidence. This is the B1-O case, where reserve requirements read `untested` instead of
   `fail`.
3. **`run.mjs`: G3 logging.** The G3 summary was logged once per build. It is now logged once.

The per-build reports were regenerated after fixes 2 and 3 at $0, with byte-identical statuses. An uncommitted change
was already in the tree when this run started (`writeChecks` leaves an entry pending on a writer error, plus wording
in the README and in `checks.mjs`). It was not made here and was kept as found.

**New analyst-only script: `experiments/tracker/eval-e8.mjs`.**
- `score` is the mechanical recall against `gold.json`.
- `adjudicate` joins failing instances to the oracle verdicts on the same run.
- The tracker never imports it.

## 9. Deviations from the prereg and other limits

- **Freeze order.**
  - The freeze files and the `score` part of `eval-e8.mjs` were written before the first paid call.
  - `adjudicate` was written after extraction had started. It only joins the oracle to failing instances and holds no
    threshold.
- **Root causes.** The labels in §5 are the analyst's (mine), from reading each property and an excerpt. The oracle
  join backs the "tracker wrong" verdicts but not the cause labels.
- **Scope.**
  - One user text, one primary ledger, three builds, three practice worlds.
  - The reference-run "known-good" premise held only in part (§5.2).
  - Nothing here touches dev worlds 1232–1234 or any sealed world.
- **Bed code held still.** The bed code this run imports (`beds/ebed/host`, `beds/ebed/oracle`, and E8 `index`,
  `transition`, `controls`) was last modified before the freeze. Other agents edited `beds/ebed/e8/golden.mjs` and
  `tools/mutate.mjs` during the run, but nothing here imports them.
- **Raw data.** The run directory `/var/tmp/foundry-work/tracker/e8-eval` holds the journals, the traces (lineage
  runs) and the full adjudication files. It is not committed.
- **What is committed here:**
  - the extraction samples, in [extraction/](extraction/);
  - the ablation ledger and its reports, in [ablation/](ablation/);
  - every paid call, in [model-calls.jsonl](model-calls.jsonl);
  - the calibration output, in [calibration.json](calibration.json).
