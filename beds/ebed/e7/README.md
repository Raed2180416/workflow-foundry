# E-bed item E7, slice 1: IT incidents with an SLA engine

*E-BED §3 E7 (incidents only), CATALOGUE A16; BED-CONTRACT v1.1; design in [`DESIGN.md`](DESIGN.md). Built 2026-10-14,
$0 (no model calls, nothing installed). The second E-bed item and the first that shares no construct-level code with
E8: it reuses only the shared host, oracle and libraries (`beds/ebed/host/`, `oracle/`, `lib/`), unchanged.*

**Status: built, not admitted.** The reference transition, its SLA engine, both reference runs, the controls and the
goldens are in place and pass (measurements below). The oracle mutation score is measured (2026-10-15,
[`ledger/MUTANTS.md`](ledger/MUTANTS.md): 679 mutants of `transition.mjs` and `sla.mjs`, MUTANTS_SCORE_LINE). Still
missing before admission, as for E8: the three blind specificity solvers (`specificity/`, a separate session, DESIGN
§18 step 5; drafts s1-s3 are in the mutation corpus), the metamorphic suite beyond its first relation (retroactive history = live history, review round 2), an Intl
minute-stepper N-version check (the clock N-version checks built here compare clocks that all use pinned zone tables;
the R4.2 evaluator of round 2 uses the generator's clock), the paid triviality attack and the arm (c) reference. Not built from the design's module
plan: `ledger/SEMANTICS.md` (DESIGN §14 is its draft) and the tools `arm-smoke`, `nversion` and `timeline`
(part A's `world-health --case` prints a planned timeline; `historyOf` gives the oracle's). `tools/specificity-run.mjs`
is built (2026-10-15, mirroring E8's) and waits for the blind solvers; E7 also runs through the item-generic B1 wiring
(`experiments/ebed/build.mjs --item e7`: grading worlds 1232–1234, build-loop practice worlds 1235–1237). Nothing here
is evidence about any arm.

```sh
node --test --test-concurrency=2 'beds/ebed/e7/test/*.test.mjs'           # world (part A) + item suites (part B)
node beds/ebed/e7/tools/health.mjs --seeds 1001-1030                       # bed health: reference runs, pools, censoring
node beds/ebed/e7/tools/controls-run.mjs --seeds 1211-1214                 # controls on attack worlds
node beds/ebed/e7/tools/world-health.mjs --seeds 1001-1030 --walk          # the world alone (part A)
node beds/ebed/e7/tools/world-health.mjs --seed 1001 --difficulty 3 --case i0042   # one case's planned timeline
node beds/ebed/e7/tools/specificity-run.mjs [--dir <solvers>] --seeds 1242-1244   # blind solvers on 1241-1249, 0 false rejects
node beds/ebed/e7/tools/mutate.mjs --json out.json                         # oracle mutation score (ledger/MUTANTS.md; ~1 h, 1 core)
```

## What the item is

One world is the IT service desk of the fictional Hollin Group (Amsterdam, New York and, from d3, Sydney) over 30
business days at minute resolution, on the `bare` platform profile (no retries, no dedupe, no correlation). Every case
is one incident: intake from a caller's report or a monitoring alert (alerts for the same CI and check join one open
incident; warnings change nothing), a 9-cell impact × urgency priority matrix with service overrides (lowest `order`
wins), assignment by rule, resolver work (accept, holds, reassignment, reclassification, resolution), an SLA engine whose
definitions are business records (start, pause, stop, cancel and reset conditions; retroactive start and pause;
schedules from the definition, the service or the group; floating schedules bound by time-zone precedence; holidays and
three DST changes; breach at target; escalations at 50/75/100%), callers who reply or not (awaiting-caller pause,
auto-closure after 3 business days; resolved incidents closed on confirmation or after 2), withdrawals, and a
major-incident approval by an incident manager (a human task with a 30-minute deadline, separation of duties, a
fail-safe declaration on timeout). The arm-facing rulebook is `spec/SPEC-E.md` (R0–R8, readings S1–S16, about 10K
tokens: 34,122 characters, at the 3.5 characters per token of the earlier 9K estimate for 31,451).

| difficulty | adds |
|---|---|
| d1 | toy: 12 incidents, 2 groups, reports only |
| d2 | base: EU + US groups (two zones), 6 SLA definitions, reports and alerts, holds (caller, vendor), reassignment and bounce, priority changes, P1 approval, withdraw, resolve before acceptance, duplicate and warning alerts, go-live backlog; DST and Easter in the horizon |
| d3 | AU group, CIs and callers from epoch 1 (third zone, AU DST end), CI aliases, mistyped numbers, actor noise on approvals, deadline ties, hold-reassign, SoD, alert escalation, strays, duplicate reports |
| d4 | edition 2026-2 effective 03-23, published 03-18: shorter targets, RES-MAJOR, an override row; the edition at attach |
| d5 | 2× volume, alert storms, 12 definitions in 3 zones (VND-HOLD, RSP-ALERT, OLA-EU/US/AU), F1 on `notify.send`, F2 on `sla.escalate`, F5 rename of `itsm.create` `ci` → `configurationItem`, the `awaitingChange` hold reason |

## Files

| file | what |
|---|---|
| `spec/SPEC-E.md`, `DESIGN.md` | the rulebook arms get; the design with decisions E7-1..E7-19 |
| `systems.mjs`, `world.mjs`, `actors.mjs` | part A: the `itsm`, `sla` (+ `notify`) mocks; `generateWorld`, `twins`, `timingProblems`; resolvers, callers, incident managers |
| `sla.mjs` | the oracle-side SLA engine: `slaTimeline` (R4.2 evaluation order, attach, retroactive start and pause, reset, schedules and zones fixed at attach, edition at attach), `reachAt` (business time on `lib/calendar`) |
| `transition.mjs` | `referenceTransition` (the oracle core), `recordsOf`, `canonicalArgs`, `historyOf`, `editionAt`, `priorityAt` |
| `index.mjs` | the module interface: `family`, `specE`, `schemas`, `binding`, `oracleItem` hooks, `critical`, `referencePolicy`, `referenceRuns`, `oracle` |
| `controls.mjs` | bad, gaming and necessity controls; `targetCases`, `plannedView` |
| `golden.mjs` | 54 hand-derived, rule-cited goldens + `runGoldens` (25 added by the mutation review, 2026-10-15) |
| `tools/` | `health`, `controls-run`, `walker-grade`, `specificity-run`, `mutate` (part B); `world-health`, `walker` (part A) |
| `ledger/MUTANTS.md` | the oracle mutation ledger: standard, result, every survivor triaged; `ledger/mutation-20261015.json` the measured run |
| `test/` | `world.test.mjs` (part A, 22 tests), `e7.test.mjs` (part B, 75 tests: 47 + 26 goldens and 2 unit checks of the 2026-10-15 mutation review), `sla-independent.mjs` (an independent R4.2–R5 evaluator and the history fuzzer for the N-version check; a fixture, not a suite) |
| `../../ebed-e7/index.mjs` | the registration shim (as for E8) |

## How the oracle works (E7 specifics)

- **History is world-determined.** `referenceTransition` rebuilds the incident's history from the truth events delivered
  so far (report or alert, joining alerts, resolver updates, caller messages, the go-live migration), the approval tasks
  the arm created and their answers, and the rule-timed changes (closure at the caller deadline D, auto-closure at D2,
  the fail-safe declaration) once their deadline has passed. Resolver, caller and alert instants are world anchors, so
  every SLA value is identical for any arm acting inside its windows; only the approval deadline and the answer instants
  depend on when the arm created its task (on-policy, R7.2).
- **The SLA clock is a pure function of that history** (`sla.mjs`): the field snapshots at each change instant go through
  R4.2 (cancel → stop → reset → pause/resume, then attach); D, thresholds, planned breaches and elapsed values come from
  `lib/calendar` business intervals in the bound zone. Memoised per (case, history) so the grader's per-point
  re-evaluation stays cheap.
- **Projection.** What the history does not yet decide is projected from what is known (a running SLA's planned breach
  and thresholds, the closure at a pending deadline, the fail-safe at a pending approval deadline) and withdrawn when a
  later event supersedes it before it was due (E8's convention). The reference policy wakes on these windows.
- **Windows** (DESIGN E7-7): `create` [t, t]; incident records, SLA records, escalations, notices and the approval task
  [t, t + 15 min]; a closure after a deadline and the SLA records it causes (D, D + 60 min]; the fail-safe and its records
  (deadline, deadline + 15 min]. Order: every op after `create`; an SLA's records in lifecycle order; the breach before
  the stop or cancel that ends the SLA (the `sla` system refuses a breach after it).
- **Decisions** graded on every graded case-tick: `subject` and `priority` (priority is not graded at the very instant a
  later event changed it: a call at that instant may not have been given that event; reading E7-B4).
- **Records** (layer 5) at the incident's closure or cancellation: the incident (state, priority, impact, urgency, group,
  assignee, opened/resolved/closed/cancelled instants, close code and reason, major, linked alerts), every SLA (stage,
  startAt, schedule, zone, pauses, breach, end, elapsed values, cancel reason), the escalations and the notifications.
  Instants are compared in canonical UTC.
- **Critical** (contract §5.3): `effect-after-end` (an `itsm` op or an `sla.start` committed after the incident's close or
  cancel record), `sod` (an approval task routed to, or answered by, the incident's caller), `major-without-approval`
  (a `setMajor` that neither follows a counted `approve` nor is the fail-safe: after the deadline, with no counted
  answer and no moot approval before it; "counted" and "moot" are the reference transition's own, R7.2–R7.3).
- **Approval tasks** (R7.2, review round 2): the first task once the priority first became 1 is required; a further
  task is permitted only from an unusable, withdrawn or schema-rejected answer on a counted task, one per such answer,
  until the deadline. Any other task is over-escalation (layer 1) and its answer never counts. An incident closed or
  cancelled at the deadline itself before an answer counts is moot (S16).

## Measurements ($0)

All numbers are from runs on 2026-10-14 at $0, rerun on 2026-10-15 after the review fixes (below) where stated; wall
times were taken with other jobs sharing the 4-core machine.

**Bed health** (`tools/health.mjs`, dev seeds 1001–1030, tail mix): 17,600 cases over 120 worlds at d2–d5. Both
reference runs (earliest and latest timing) pass every case they complete: **0 divergences, 0 oracle errors, 0 critical
violations**. Rerun 2026-10-15 with the amended critical check: the same counts in every cell below (s/world 1.70,
2.90, 3.94 and 13.42); rerun again after review round 2 (engine fix, re-ask and deadline readings): the same counts in
every cell (s/world 2.35, 4.88, 7.03 and 15.30, with other jobs on the machine).

| d | cases | completed | ep0–ep2 | ep3 | go-live | s/world (2 runs + 2 gradings) |
|---|---|---|---|---|---|---|
| d2 | 1,938 | 1,937 (99.9%) | 100% | 99.8% | 100% | 1.95 |
| d3 | 3,304 | 3,300 (99.9%) | 100% | 99.5% | 100% | 3.0 |
| d4 | 3,905 | 3,899 (99.8%) | 100% | 99.4% | 100% | 3.8 |
| d5 | 8,453 | 8,445 (99.9%) | 100% | 99.6% | 100% | 17.7 |

ep4 holds no cases (arrivals stop at business day 24, DESIGN §4.8). The censored cases are late resolutions or closures
past the horizon (`slow`, `reply-at-deadline`, `vendor-ola`, `holiday-span`). Every go-live case completes and passes,
so the oracle's SLA engine reproduces every SLA record, escalation and notice the generator's independent engine exported.

**Controls** (`tools/controls-run.mjs`, attack seeds 1211–1214, d2–d5; 16 worlds, 2,370 completed cases; rerun
2026-10-15 after the review fixes and again after review round 2, both times with the same failure counts as the
2026-10-14 run). Every bad and gaming control fails every
world: `noop` 2,297/2,370 completed cases (96.9%), `echo` and `declare-every-obligation` 2,345/2,370 (98.9%; the passes
are messages that name no incident), `escalate-everything` 2,297/2,370 (96.9%; 20 `sod` critical: its extra approval
task has no exclusions), `pause-everything` 2,130/2,370 (89.9%; d2 87.7%).

Necessity controls, summed over d2–d5. *Target share* is the target cases' share of the completed cases (how much of
the stream the construct touches); *failed outside* counts failures among the completed cases that are not targets.
**How to read the 100% column:** for the controls marked *oracle* the target cases are defined from the oracle's own
expectation: the cases whose required effects on the world's planned timeline (`controls.mjs` `plannedView`) change
when the same `referenceTransition` runs on the control's variant world (`targetCases`, `shape(a) !== shape(b)`), or,
for never-escalate, the cases whose planned expectation holds an escalation. Such a target case fails almost by
construction, so 100% there says only that the oracle grades what it expects; the informative numbers are the target
share and the failures outside. Only the *truth predicate* targets (timer-first, no-dedupe, no-correlation, no-sod) are
defined from the world's truth, independently of the oracle.

| control (construct removed) | targets | target share | target cases failed | failed outside | critical |
|---|---|---|---|---|---|
| 24x7-no-pause (every schedule 24×7, no pause) | oracle | 2,073/2,370 (87.5%) | 2,073/2,073 (100%) | 0/297 | 0 |
| never-escalate | oracle (planned escalations) | 1,749/2,370 (73.8%) | 1,749/1,749 (100%) | 3/621 | 0 |
| timer-first (closure and fail-safe taken at the deadline) | truth predicate | 1,386/2,370 (58.5%) | 1,386/1,386 (100%) | 14/984 | 59 `major-without-approval` (d3–d5) |
| wrong-timezone (every schedule in the system zone) | oracle | 1,072/2,370 (45.2%) | 1,072/1,072 (100%) | 0/1,298 | 0 |
| no-correlation (caller messages not merged) | truth predicate | 1,055/2,370 (44.5%) | 1,004/1,055 (95.2%; the passes are messages that change nothing: late replies and confirmations, a reply after a reassignment) | 0/1,315 | 0 |
| no-holiday | oracle | 403/2,370 (17.0%) | 403/403 (100%) | 0/1,967 | 0 |
| no-dedupe (every alert or report opens an incident) | truth predicate | 378/2,370 (15.9%) | 378/378 (100%) | 0/1,992 | 0 |
| pause-ignored | oracle | 351/2,370 (14.8%) | 351/351 (100%) | 0/2,019 | 0 |
| no-retroactive-start | oracle | 306/2,370 (12.9%) | 306/306 (100%) | 32/2,064 | 0 |
| no-reset | oracle | 165/2,370 (7.0%) | 165/165 (100%) | 0/2,205 | 0 |
| first-match-priority (first row in file order) | oracle | 154/2,370 (6.5%) | 154/154 (100%) | 0/2,216 | 46 `major-without-approval` (new with the 2026-10-15 critical fix) |
| breach-at-start-of-pause | oracle | 124/2,370 (5.2%) | 124/124 (100%) | 28/2,246 | 0 |
| edition-at-start (d4–d5) | oracle | 35/1,668 (2.1%) | 35/35 (100%) | 0/1,633 | 0 |
| no-sod (d3–d5) | truth predicate | 20/2,110 (0.9%) | 20/20 (100%) | 106/2,090 | 20 `sod` (every major-sod case) |

The failures outside the targets show where the planned-timeline target definition is blind (checked on attack worlds
1211–1214): the planned view creates no approval task, so it never declares a major incident and never attaches
RES-MAJOR (edition 2, d4–d5): no-retroactive-start (32, d4–d5 only) and never-escalate (3) fail on RES-MAJOR's start
and escalations after a declaration. The target diff compares the expectations at the horizon only, so a variant's
mid-trajectory projection is invisible to it: breach-at-start-of-pause (28) commits a breach during a pause on SLAs that
breach anyway after the resume (same final breach, different instant committed). timer-first (14, d3–d5) fails major
cases outside its truth predicate where actor noise on the approval (d3+) leaves no counted answer, so the fail-safe
becomes due and is taken at the deadline. no-sod (106) is over-escalation (layer 1) on every approval task it creates
without the caller excluded; only the major-sod cases also make it critical.
The 46 first-match-priority criticals are fail-safe declarations after approval tasks the rules never asked for: on
override services the first row in file order gives P1 where the lowest `order` gives P2, the arm asks for approval,
nobody answers, and it declares the incident major at its own deadline. Before the critical fix every `setMajor` after
the arm's first task deadline was excused.

**Goldens** (`golden.mjs`; 26 more since the mutation review of 2026-10-15, listed in `ledger/MUTANTS.md` §5): 28 hand-derived, rule-cited goldens (G1–G18 of DESIGN §9 with G4 in three zones, G11b, plus a
duplicate-delivery/stray golden and a records golden; G14b, G14c, G20 and G21 from review round 2) pass the reference
transition. G21 binds RES-P2 to a world copy whose floating schedule is a 01:30–03:30 night shift, the only way to
grade R4.4's in-interval DST clause, since no slice-1 schedule has an interval across a clock change. Every SLA-engine control (world edit
or engine switch) fails at least one golden, so the goldens see each construct. One hand value of DESIGN §9 was wrong
and is corrected in the golden: G11's start record plans Wed 03-18 17:00 (1,440 business minutes from Mon 09:00 end at a
close), not Thu 03-19 09:00.

**N-version clock** (`test/e7.test.mjs`): on 300 fuzzed SLA lifecycles (four schedules, three zones, 24×7, up to six
pauses) `sla.mjs` gives the same D, thresholds, elapsed and business-elapsed values and breach as `lib/clock.mjs`
(exclusive boundary) and, for D, as the generator's own clock (`world.mjs`, its own zone table); one more pause never
moves D earlier.

**N-version R4.2–R4.3** (review round 2, `test/sla-independent.mjs`): an independent evaluator written from the spec
(field timeline with pause runs as intervals, its own R0 from the rulebook files, the generator's clock for business
time, records derived at the end) agrees with `sla.mjs` on every SLA of 600 fuzzed histories on the d5 rulebook
(2,065 SLAs: ids, attach and start instants, schedule, zone, every record with its instant and cause, stage, D, breach,
thresholds, elapsed values, planned breaches). The fuzz reaches 444 histories with same-instant merged changes, 68
resets (all re-attached), 8 retroactive attaches across the edition switch, 36 retroactive attaches with past pauses,
14 of them with a pause that ends at the attach instant, and 26 attaches in a pause. A metamorphic relation checks the
same histories: a retroactive SLA's past pauses equal those of a live SLA with the same pause condition attached at
`openedAt`. A mutant of `sla.mjs` without the round-2 fix is caught by both (13/600 histories differ) and by the hand
case.

**Discrimination sanity check** (`tools/walker-grade.mjs`, dev seed 1101 d3, rerun 2026-10-15): the part-A walker
(keeps every incident record of R1–R3, R6 and R7.1 but has no SLA engine and no deadline closures) passes 8/109 completed
cases, 0 critical: the 5 messages that name no incident (3 stray caller messages, 2 warnings) and 3 incidents on which
nothing the walker leaves out is due (two P5 incidents, which no SLA definition covers, closed on the caller's
confirmation; one go-live incident whose SLAs ended before t0, closed on confirmation). The other 101 fail at layer 3
(a missed record). The first run of this check (8/111, 2026-10-14) used seed 1241, which DESIGN §13 reserves for the
specificity solvers and Track C rehearsals; that touch (walker only) is recorded in SEED-LEDGER and DESIGN §13, and the
tool now refuses the rehearsal block 1201–1249.

**Suites:** `node --test --test-concurrency=2 'beds/ebed/e7/test/*.test.mjs'`: 69 tests (22 part A, 47 part B; 97 since the mutation review: 75 part B), about
70 s with other jobs on the machine (2026-10-15, after review round 2).

## Readings and decisions added in part B (for review)

| id | decision | why |
|---|---|---|
| E7-B1 | Each SLA record's `plannedBreachAt` is the planned breach as of that record's own instant: the start plans from `startAt` with no pause (also for a retroactive SLA with past pauses and one that attaches paused); each resume (past ones included) from the pauses so far. **Stated in SPEC-E as S13 (R4.4, R4.5 amended) on 2026-10-15** | R4.4 defines the planned breach "as if not paused again"; records carry the instant the rule gives them (§4). G11 pins it (start Wed 03-18 17:00, resume Thu 03-19 11:00); G11b pins the attaches-paused case (start Wed 03-18 17:00, not null) |
| E7-B2 | An SLA that attaches while its pause condition holds attaches paused, also when it is not retroactive (pause at the attach). **SPEC-E S14 (R4.3 amended)** | R4.3 states it for retroactive SLAs only; leaving the other case to the next change instant would make it depend on unrelated changes. Never generated in slice 1 |
| E7-B3 | A reset re-attach also requires the stop condition not to hold; an empty condition list never holds. **SPEC-E S15 (R4.2 amended)** | consistent with the R4.2 attach rule; no generated definition has an empty list |
| E7-B4 | The escalation recipient is read after every change of the due instant (S5); `priority` is not graded at the instant a later event changed it | S5 orders changes before SLA evaluation; same-instant knowledge as in the grader (E8-16, which superseded E8-5 for delivered causes; E7-B10) |
| E7-B5 | Lids at instants before t0 are already recorded for go-live incidents (the export); the oracle's engine recomputes them and layer 5 compares | the generator's own SLA engine wrote the export: the reference runs cross-check two independent engines on every go-live case |
| E7-B6 | `sod` is critical when the approval task is routed to the caller (also when they delegate it on), not only when the caller answers | with actor noise the caller may delegate, withdraw or answer in free text; the routing is the separation-of-duties failure |
| E7-B7 | Necessity controls give up an effect the systems refused (4xx) instead of re-issuing it every minute | a control whose records diverged from the systems re-emitted refused effects for weeks of simulated time (hours of wall time); the reference itself never meets a refusal |
| E7-B9 | The W5 twin test runs at d2 | from d3 the host draws approval noise from the world id (`host/actors.mjs` `noiseDraw`), which the injection twin does not share, so the twin's approval answers differ (seen at seed 1008 d3); `twins()` also regenerates without a `size` override. Both are outside this item's files (shared host; part A) |
| E7-B8 | Necessity target cases are the cases whose required effects on the world's planned timeline change when the construct is removed (`plannedView`), or the classes the design names for hook controls | a definition independent of any arm's run, but not of the oracle: the 'planned' targets come from the oracle's own expectation diff (see Controls) |
| E7-B10 | Same-instant knowledge in the shared grader is per message (E8-16, 2026-10-15): a row emitted at instant t is exempt from a withdrawal at t that a delivered event caused when its call was not given that event; for other causes the old rule stays (the call was given no event of the case at t). E7 adopts it as a grading rule; SPEC-E (E7) states no same-instant reading, and none is needed: the rule only exempts more rows than E8-5 did (a superset of exemptions), so no arm that passed under E8-5 fails under it | `oracle/grade.mjs` `exemptFrom` is shared by every E-bed item; the E7 suite passed with it (54/54 when E8-16 landed, 58/58 when this row was added, both 2026-10-15). Re-review of E8, 2026-10-15 |

## Review fixes (2026-10-15, $0)

| finding | fix | regression test |
|---|---|---|
| major: the `plannedBreachAt` of a retroactive SLA's start record (E7-B1) was a README/DESIGN reading only; R4.4's "while it is paused D is not known (`null`)" read against it | SPEC-E states the oracle's reading: S13 (start record planned from `startAt` as if never paused, also with past pauses and when it attaches paused; each resume as of its own `at`), with R4.4 and R4.5 amended to point at it; E7-B2 and E7-B3 stated as S14 (R4.3) and S15 (R4.2). The oracle is unchanged: health rerun, 0 divergences | golden G11b (attaches paused: start Wed 03-18 17:00, not null; pause from Mon 14:00; no resume, breach or escalation while paused); `spec states the readings the oracle grades` |
| minor: the decision for a warning on the CI and check of an open incident was not stated | R1.2: a warning belongs to no incident (`decisions.subject` `null`), even on the CI and check of an open incident | the same spec test, on dev world 1012 d3 (warning i0067 on open incident i0061) |
| minor: `major-without-approval` skipped every `setMajor` after the first task's deadline | only a counted `approve` or the fail-safe (after the deadline, no counted answer, no moot approval) excuses a `setMajor`; counted, moot and the deadline come from the reference transition's history | `critical major-without-approval: only a counted approve or the fail-safe excuses a setMajor` (9 cases: reject then setMajor, moot, approve after a counted reject, setMajor at the deadline, before any answer; fail-safe, unusable answer, counted approve, approve at the deadline) |
| minor: the necessity table's "100% of target cases" said little alone | the table gives each control's target share and failures outside the targets, and says which targets are oracle-derived; `controls-run.mjs` prints both and a summary | (reporting; the numbers above) |
| minor: the leak test skipped short class labels, checked 40 case ids and no future knowledge | every non-legit class label, every case id, the truth-only keys, no event id or `docs/<eventId>.txt` before its delivery, no edition file before `published` (non-vacuity asserted; a planted future event id fails it) | `leak: ... nothing is visible before its instant` (world.test.mjs) |
| minor: the walker discrimination check used rehearsal seed 1241 | rerun on dev seed 1101 with `tools/walker-grade.mjs` (refuses 1201–1249); the touch of 1241 recorded in SEED-LEDGER and DESIGN §13 | `seed discipline: ...` |

## Review fixes, round 2 (2026-10-15, $0)

| finding | fix | regression test |
|---|---|---|
| major: SPEC-E never said that an API schema can change during the stream or what a `400 field-renamed` means, although d5 renames `itsm.create` `ci` → `configurationItem` from ep3 and `create` has the window [t, t]; §1's "same key with different arguments is rejected (409)" told an arm not to re-issue a corrected request under the same key | SPEC §1: an **API changes** paragraph with E8's rule (the file always shows the current names; read it on every call; on a 400 correct the request and re-issue it with the same key inside the rule's window; it is not a 409, since nothing committed and keys are compared under the system's own names), the Keys bullet amended to match, and the consequence for `create` stated: a record due in the same instant as its cause leaves no time for a second attempt, so it is written with the names the file shows at t. The window stays [t, t] (R1.1 "in the same instant"); host, oracle and reference are unchanged | `spec states the readings ...` (the new phrases); `itsm: a create refused for a renamed field is re-issued under the same key, not a 409` (mock: 400, no key committed, same-key re-issue commits, repeat dedupes, different arguments 409); `F5 (SPEC §1 API changes): ...` (real host and grader on dev world 1015 d5 size 40: a reference variant that writes `ci` after the rename gets 15 creates refused 400, each re-issued and committed under the same key one minute later; no 409, no key-split; each of the 15 cases fails at layer 3 on `create:N` (missed), every other completed case passes, 0 critical) |
| minor (latent): `sla.mjs` `attach()` dropped a retroactive pause that ends exactly at the attach instant (a reply merged with the reclassification that attaches the SLA), so D came out early | `attach()` closes such a run: pause at its start, resume at x (R4.3). No generated history hits it (the reviewer's scan: 0 of 488 retroactive attaches on dev seeds 1001-1006) | golden G20 (P3 report, hold 10:30, reply + reclassification to P1 at 11:30: RES-P1 pause 10:30, resume 11:30 planned 15:00, D 15:00, 50% 13:00, 75% 14:00; fails on the old engine); the reviewer's hand case in the N-version test |
| minor: no independent check of the R4.2/R4.3 state machine (reset re-attach, retroactive start and pause, attach after reclassification, edition at attach) | `test/sla-independent.mjs`, an evaluator written from the spec with its own structure, R0 and clock; an N-version test against `sla.mjs` on 600 fuzzed histories, a metamorphic relation (retroactive history = live history) and a mutation of the fix (see **N-version R4.2–R4.3** above) | `SLA engine N-version, R4.2-R4.3 (review 2026-10-15 round 2) ...` (0 differences; coverage asserted; the mutant differs on 13/600 histories, breaks the relation and the hand case) |
| minor: the leak test spied on the walker, which closes every tick, so `effect.result`, `timer.fired` and `humanTask.*` payloads were never inspected | the checks moved into one helper and run twice: around the walker and around the reference arm, which keeps instances open (same world, seed 1014 d5 size 60). The spy keeps each file and query row once (what was visible stays visible), which keeps both passes fast | `leak: the events routed back to an instance ...` (non-vacuity asserted: 1,417 `effect.result`, 257 `timer.fired`, `humanTask.timeout` and `humanTask.answered` inspected; no leak) |
| minor: spec, mock and oracle disagreed on `sla.escalate` after an SLA ends | SPEC §2: `escalate` is accepted for a recorded SLA at any stage, also after its stop or cancel (R5 says which notices are due; a threshold reached at the stop, S3, may be notified after the stop record); one per SLA and percent. The mock already behaved so (its description and a comment now say it); the oracle orders an escalation after the SLA's start only | `sla: escalate is accepted after the stop or cancel ...` (mock); `escalate after the end: spec, mock and oracle agree` |
| minor: R7.3 and R8.2 conflicted at the approval deadline: a withdrawal at the deadline still required the fail-safe `setMajor`, which an arm that recorded the cancel at the deadline could only write after it (`effect-after-end`) | S16 and a sentence in R7.3: an incident closed or cancelled at the deadline, before an answer counts, is moot (no declaration); one resolved, or whose priority changes, at the deadline still gets it (R7.3 says before). `checkMoot` implements it; `deadlines()` follows from the moot flag | golden G14c (withdraw at the deadline: no declaration, cancelled with `major: false`; resolved at the deadline: declaration due; an approve before the withdrawal in the same instant counts, one after it does not); `critical (round 2)` (cancel at the deadline alone is clean; a fail-safe after it is `effect-after-end` and `major-without-approval`) |
| minor: the oracle permitted any further approval task while no answer counted, and counted its answer (an arm could turn a timeout into an approval by re-asking) | R7.2 reworded: a re-ask is allowed, by the deadline and before an answer counts, once per answer on a counted task that was unusable, withdrawn or rejected by the schema; any other task is an error and its answer never counts (a timeout is no cause). The transition keeps the counted tasks and the unused causes; the R7.2 permitted window opens at the first unused cause; `critical()` follows (answers count only on counted tasks). The reference never re-asks, so its runs are unchanged | golden G14b (no cause: not permitted, its approve does not count, the fail-safe stays due; unusable, schema-rejected and withdrawn answers each open one re-ask whose approve counts; one cause, one re-ask; a timeout opens none); `critical (round 2)` (approve on an unsanctioned re-ask is `major-without-approval`) |
| minor: R4.4's in-interval DST clause could be read as "a repeated hour counts once" (120 min) where `lib/calendar` counts real time (180) | R4.4 reworded: each real instant between the first reading of the start and the first reading of the end counts once, with the 60/180-minute example, and the spec says no schedule of this desk has an interval across a clock change | golden G21 (RES-P2 on a world copy whose floating schedule is a 01:30–03:30 night shift: D Fri 04-03 00:30Z in spring, Thu 10-29 01:30Z in autumn, where the 120-minute reading gives 02:30Z); the spec test asserts every generated business interval lies between 04:00 and 23:00 |
| minor: README said readings S1–S12 | S1–S16 and the size recounted (about 10K tokens) | (reporting) |

After round 2: bed health (dev seeds 1001–1030) and the controls (1211–1214) give the same counts in every cell as
before it; the walker check (seed 1101 d3) still passes 8/109; the E7 suites pass 69/69 and the E8 suite 16/16. No file
of `beds/ebed/e8/`, `host/`, `oracle/` or `lib/` was changed for round 2.

