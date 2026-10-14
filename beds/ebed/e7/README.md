# E-bed item E7, slice 1: IT incidents with an SLA engine

*E-BED §3 E7 (incidents only), CATALOGUE A16; BED-CONTRACT v1.1; design in [`DESIGN.md`](DESIGN.md). Built 2026-10-14,
$0 (no model calls, nothing installed). The second E-bed item and the first that shares no construct-level code with
E8: it reuses only the shared host, oracle and libraries (`beds/ebed/host/`, `oracle/`, `lib/`), unchanged.*

**Status: built, not admitted.** The reference transition, its SLA engine, both reference runs, the controls and the
goldens are in place and pass (measurements below). Still missing before admission, as for E8: the three blind
specificity solvers (`specificity/`, a separate session, DESIGN §18 step 5), the oracle mutation score (≥ 0.95), the
metamorphic suite, an Intl minute-stepper N-version check (the N-version check built here compares three clocks that
all use pinned zone tables), the paid triviality attack and the arm (c) reference. Not built from the design's module
plan: `ledger/SEMANTICS.md` (DESIGN §14 is its draft) and the tools `arm-smoke`, `mutate`, `specificity-run`, `nversion`
and `timeline` (part A's `world-health --case` prints a planned timeline; `historyOf` gives the oracle's). Nothing here
is evidence about any arm.

```sh
node --test --test-concurrency=2 'beds/ebed/e7/test/*.test.mjs'           # world (part A) + item suites (part B)
node beds/ebed/e7/tools/health.mjs --seeds 1001-1030                       # bed health: reference runs, pools, censoring
node beds/ebed/e7/tools/controls-run.mjs --seeds 1211-1214                 # controls on attack worlds
node beds/ebed/e7/tools/world-health.mjs --seeds 1001-1030 --walk          # the world alone (part A)
node beds/ebed/e7/tools/world-health.mjs --seed 1001 --difficulty 3 --case i0042   # one case's planned timeline
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
fail-safe declaration on timeout). The arm-facing rulebook is `spec/SPEC-E.md` (R0–R8, readings S1–S12, about 9K tokens).

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
| `golden.mjs` | 23 hand-derived, rule-cited goldens + `runGoldens` |
| `tools/` | `health`, `controls-run` (part B); `world-health`, `walker` (part A) |
| `test/` | `world.test.mjs` (part A, 19 tests), `e7.test.mjs` (part B) |
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
  cancel record), `sod` (an approval task routed to, or answered by, the incident's caller), `major-without-approval`.

## Measurements ($0)

All numbers are from runs on 2026-10-14 at $0; wall times were taken with other jobs sharing the 4-core machine.

**Bed health** (`tools/health.mjs`, dev seeds 1001–1030, tail mix): 17,600 cases over 120 worlds at d2–d5. Both
reference runs (earliest and latest timing) pass every case they complete: **0 divergences, 0 oracle errors, 0 critical
violations**.

| d | cases | completed | ep0–ep2 | ep3 | go-live | s/world (2 runs + 2 gradings) |
|---|---|---|---|---|---|---|
| d2 | 1,938 | 1,937 (99.9%) | 100% | 99.8% | 100% | 1.95 |
| d3 | 3,304 | 3,300 (99.9%) | 100% | 99.5% | 100% | 3.1 |
| d4 | 3,905 | 3,899 (99.8%) | 100% | 99.4% | 100% | 3.9 |
| d5 | 8,453 | 8,445 (99.9%) | 100% | 99.6% | 100% | 17.7 |

ep4 holds no cases (arrivals stop at business day 24, DESIGN §4.8). The censored cases are late resolutions or closures
past the horizon (`slow`, `reply-at-deadline`, `vendor-ola`, `holiday-span`). Every go-live case completes and passes,
so the oracle's SLA engine reproduces every SLA record, escalation and notice the generator's independent engine exported.

**Controls** (`tools/controls-run.mjs`, attack seeds 1211–1214, d2–d5; 16 worlds, 2,370 completed cases). `noop`, `echo`,
`declare-every-obligation`, `escalate-everything` and `pause-everything` fail every world (bad controls fail 96–99% of
completed cases; the passes are messages that name no incident). Necessity controls on their target cases, summed over
d2–d5:

| control (construct removed) | target cases failed |
|---|---|
| 24x7-no-pause (every schedule 24×7, no pause) | 2,073/2,073 (100%) |
| never-escalate | 1,749/1,749 (100%) |
| timer-first (closure and fail-safe taken at the deadline) | 1,386/1,386 (100%); 59 `major-without-approval` critical (d3–d5) |
| wrong-timezone (every schedule in the system zone) | 1,072/1,072 (100%) |
| no-holiday | 403/403 (100%) |
| no-dedupe (every alert or report opens an incident) | 378/378 (100%) |
| pause-ignored | 351/351 (100%) |
| no-retroactive-start | 306/306 (100%) |
| no-reset | 165/165 (100%) |
| first-match-priority (first row in file order) | 154/154 (100%) |
| breach-at-start-of-pause | 124/124 (100%) |
| edition-at-start (d4–d5) | 35/35 (100%) |
| no-sod (d3–d5) | 20/20 (100%); `sod` critical on every major-sod case |
| no-correlation (caller messages not merged) | 1,004/1,055 (95%; the passes are messages that change nothing: late replies and confirmations, a reply after a reassignment) |

**Goldens** (`golden.mjs`): 23 hand-derived, rule-cited goldens (G1–G18 of DESIGN §9 with G4 in three zones, plus a
duplicate-delivery/stray golden and a records golden) pass the reference transition. Every SLA-engine control (world edit
or engine switch) fails at least one golden, so the goldens see each construct. One hand value of DESIGN §9 was wrong
and is corrected in the golden: G11's start record plans Wed 03-18 17:00 (1,440 business minutes from Mon 09:00 end at a
close), not Thu 03-19 09:00.

**N-version clock** (`test/e7.test.mjs`): on 300 fuzzed SLA lifecycles (four schedules, three zones, 24×7, up to six
pauses) `sla.mjs` gives the same D, thresholds, elapsed and business-elapsed values and breach as `lib/clock.mjs`
(exclusive boundary) and, for D, as the generator's own clock (`world.mjs`, its own zone table); one more pause never
moves D earlier.

**Discrimination sanity check:** the part-A walker (keeps every incident record of R1–R3, R6 and R7.1 but has no SLA
engine and no deadline closures) passes 8/111 completed cases at seed 1241 d3: only the messages that name no incident.

**Suites:** `node --test --test-concurrency=2 'beds/ebed/e7/test/*.test.mjs'`: 54 tests (19 part A, 35 part B), about
70 s on an idle machine.

## Readings and decisions added in part B (for review)

| id | decision | why |
|---|---|---|
| E7-B1 | Each SLA record's `plannedBreachAt` is the planned breach as of that record's own instant: the start plans from `startAt` with no pause; each resume (past ones included) from the pauses so far | R4.4 defines the planned breach "as if not paused again"; records carry the instant the rule gives them (§4). G11 pins it (start Wed 03-18 17:00, resume Thu 03-19 11:00) |
| E7-B2 | An SLA that attaches while its pause condition holds attaches paused, also when it is not retroactive (pause at the attach) | R4.3 states it for retroactive SLAs only; leaving the other case to the next change instant would make it depend on unrelated changes. Never generated in slice 1 |
| E7-B3 | A reset re-attach also requires the stop condition not to hold; an empty condition list never holds | consistent with the R4.2 attach rule; no generated definition has an empty list |
| E7-B4 | The escalation recipient is read after every change of the due instant (S5); `priority` is not graded at the instant a later event changed it | S5 orders changes before SLA evaluation; same-instant knowledge as in the grader (E8-5) |
| E7-B5 | Lids at instants before t0 are already recorded for go-live incidents (the export); the oracle's engine recomputes them and layer 5 compares | the generator's own SLA engine wrote the export: the reference runs cross-check two independent engines on every go-live case |
| E7-B6 | `sod` is critical when the approval task is routed to the caller (also when they delegate it on), not only when the caller answers | with actor noise the caller may delegate, withdraw or answer in free text; the routing is the separation-of-duties failure |
| E7-B7 | Necessity controls give up an effect the systems refused (4xx) instead of re-issuing it every minute | a control whose records diverged from the systems re-emitted refused effects for weeks of simulated time (hours of wall time); the reference itself never meets a refusal |
| E7-B9 | The W5 twin test runs at d2 | from d3 the host draws approval noise from the world id (`host/actors.mjs` `noiseDraw`), which the injection twin does not share, so the twin's approval answers differ (seen at seed 1008 d3); `twins()` also regenerates without a `size` override. Both are outside this item's files (shared host; part A) |
| E7-B8 | Necessity target cases are the cases whose required effects on the world's planned timeline change when the construct is removed (`plannedView`), or the classes the design names for hook controls | a definition independent of any arm's run |
