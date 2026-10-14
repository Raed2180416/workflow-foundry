# E-bed item E7, slice 1: IT incidents with an SLA engine (design)

*E-BED §3 E7 (incidents only), CATALOGUE A16 (A17 is slice 2); BED-CONTRACT v1.1. Written 2026-10-14 on branch
`claude/intelligent-hamilton-vg1f9a`, $0: no model calls, nothing installed, nothing committed. `beds/sealed/` and
credential files were not read. Status: **design only**. The only files written are this one and
[`spec/SPEC-E.md`](spec/SPEC-E.md) (the arm-facing rulebook, about 9K tokens). The template followed throughout is
E8 (`beds/ebed/e8/`): same module split, same oracle binding, same test and tool shapes.*

**Evidence tags** as E-BED: [M] a repo file read for this design (cited); [M-c] computed at $0 with the shared libraries
(the golden values of §9 were derived by hand, then checked with `beds/ebed/lib/calendar.mjs` and `clock.mjs` in a
scratch script outside the repo; every hand value matched); [doc] a documented product semantic as recorded in
CATALOGUE A16 (`research/enterprise-20261014/CATALOGUE.md:324-329`); [I] our design choice or reading.

---

## 0. What slice 1 is, and what it is for

One world is the IT service desk of the fictional Hollin Group (offices in Amsterdam, New York and, from d3, Sydney)
over **30 business days at minute resolution**, on the **`bare`** profile (no retries, no dedupe, no correlation by
the host). Every case is one incident: intake from a caller's report or a monitoring alert (alerts for the same CI and
check merge into one open incident), classification by a 9-cell impact × urgency matrix with service overrides
(lowest `order` wins, not first match), assignment to a group by rule, the group's resolver actions (accept, holds,
reassignment, reclassification, resolution), an **SLA engine** whose definitions are business records with start,
pause, stop, cancel and reset conditions, retroactive start and pause, schedules from the definition, the service or
the group, floating schedules bound by time-zone precedence, business-hours calendars with holidays and three DST
changes inside the horizon, breach at target, escalations at 50/75/100%, callers who reply or not (awaiting-caller
pause; auto-close after N business days of no reply; resolved incidents closed on confirmation or after N business
days), and a major-incident approval by an incident manager (a human task with a deadline, separation of duties, and
a fail-safe declaration on timeout).

The strongest oracle E-BED names for E7 holds here by construction: **every SLA instant (start, pause, resume,
threshold, breach, stop) and every elapsed and business-elapsed value is a pure function of the incident's history**,
and that history is world-determined (§4.9), so the expected SLA records are exact to the minute for every arm.

**Why build it now** (task #61): E7 is the second item after E8 and shares no construct-level code with it, so it is
the first **library-unseen** item for the templates question (B1-H with no templates vs B1L-H / (g) with a template
library built from earlier items vs agent-H, same spec, same oracle), and a family of clear **router positives** (work
that needs a durable workflow: clocks, timers, human tasks, correlation). Slice 2 (problems, changes, CAB, conflicts)
extends the same world (§16).

---

## 1. Decisions and readings (for review)

| id | decision | why |
|---|---|---|
| E7-1 | Profile `bare` (E-BED §2.2, contract §4.1): F1/F2 on `notify`/`sla.escalate` must be retried by the arm with the same key | E-BED assigns `bare` to E1–E7; makes key discipline gradable without a platform retry |
| E7-2 | Minute resolution, horizon 30 business days of the service desk calendar: t0 `2026-03-02T00:00+01:00` (Mon), `horizonEnd` `2026-04-15T00:00+02:00` (the 30th business day is 2026-04-14 [M-c]) | E-BED says "hour granularity"; minute-exact SLA arithmetic needs minutes (E8 made the same change) |
| E7-3 | The window places US DST (2026-03-08), EU DST (2026-03-29), AU DST end (2026-04-05) and Easter (Good Friday 04-03, Easter Monday 04-06) inside the horizon | calendar realism is base semantics, present at every difficulty; goldens pin each |
| E7-4 | Incident numbers are `INC-<reportId | alertId>` (SPEC §3) | a logical-effect id must be a function of business keys (contract §5.2); a sequential number would depend on cross-case creation order |
| E7-5 | Intake is immediate: `itsm.create` in the instant the report or alert arrives (window [t, t]) | otherwise two alerts of one CI and check minutes apart could both see "no incident" while the first create is pending, and no rule could make the second one's choice decidable (an instance cannot see another instance's uncommitted intent); synchronous record insertion is also how ITSM platforms behave [I] |
| E7-6 | Every incident change is recorded with the **business instant** the rule gives it (`at` = the event's time; auto-closures dated at the deadline, S10), committed within 15 minutes (60 for closures after a deadline) | makes the incident and SLA history world-determined, so the expected SLA values do not depend on when inside a window an arm wrote a record |
| E7-7 | Windows are 15 minutes for engine work (records, escalations, notices, approval task), (D, D + 60 min] for closures after a deadline, (deadline, + 15 min] for the fail-safe major declaration | an SLA engine runs on every record update; 15 min leaves room for a bare-profile retry after F1 (`retryAfter` 60 s) for an arm acting up to 13 min late |
| E7-8 | Breach at target with the exclusive boundary (S2): breached at D; a stop at D is a breach (`lib/clock.mjs` `boundary: 'exclusive'`) | the task's "breach at target"; the inclusive reading is recorded as the competing one and is a mutation operator |
| E7-9 | SLA attach rule: a definition attaches when its start condition **becomes** true, none of it is in progress or paused, and its stop condition does not hold; reset re-attaches; per-instant evaluation order cancel → stop → reset → pause/resume → attach (R4.2, S5) | CATALOGUE A16 lists the conditions but not their order or re-attachment [doc]; the order is stated so that it is decidable |
| E7-10 | The edition of a definition is the one in force when the SLA **attaches**, not at its retroactive `startAt` (S6) | discriminating golden G13; the competing reading ("edition at startAt") is a necessity control |
| E7-11 | A reassignment ends any hold (S7, W4) | product docs leave it open [I]; with the hold kept, the new group's response SLA would stop at its own start (hold counts as accepted) |
| E7-12 | Platform times are written at a fixed `+01:00` all year (SPEC §1); business time is computed in the zone a rule names | this is what the host does (`host/time.mjs` `fmt` at the t0 offset [M]); it also discriminates arms that do local arithmetic on the offset they were handed |
| E7-13 | Escalation notices are an `sla.escalate` op keyed by (SLA, percent), not `notify.send` | two SLAs of one incident reaching 50% would otherwise produce two `notify.send` rows with the same `{ to, about, template }` match, which the generic grader cannot tell apart |
| E7-14 | At most one awaiting-caller hold per incident in generated worlds | `awaiting-caller` is matched by `{ to, about, template }`; a second one would share the match (same limit class as E8-8) |
| E7-15 | Resolver, caller and approval timelines are anchored on world instants, not on the arm's commit times; resolver steps are guarded counterparty steps (host H-29) on the incident's `state` | §4.9: makes every race and every SLA value identical for any arm acting inside its windows; single-field guards suffice, so no host change |
| E7-16 | Warning alerts create nothing and join nothing (R1.2) | gives the bed a "correct answer is no effect" alert class; ignoring is the documented default of event-management severity filters [I] |
| E7-17 | Dedupe is judged at the alert's time against the incident's resolution by the events (S8); recurrence alerts are placed ≥ 30 min after the resolution event | an alert must not depend on whether an arm has already written the resolve record |
| E7-18 | No sweeps (`family.sweeps: []`): everything is per instance | no slice-1 rule needs cross-case batch work; auto-closures are per-instance obligations |
| E7-19 | No change to shared host, oracle or lib code is planned (§7.4) | E8 must stay byte-identical; the item needs only hooks E8 already uses |

---

## 2. Package and module plan (mirrors `beds/ebed/e8/`)

| file | what | E8 counterpart |
|---|---|---|
| `spec/SPEC-E.md` | arm-facing rulebook R0–R8, readings S1–S12 (written) | `spec/SPEC-E.md` |
| `ledger/SEMANTICS.md` | features in/out with sources (§14 is the draft) | same |
| `systems.mjs` | `itsm`, `sla` (+ shared `notify`); supersedes the provisional `host/systems/e7.mjs` for the item, as E8's did | `systems.mjs` |
| `world.mjs` | `generateWorld`, `twins`, `GENERATOR_VERSION`, calendars, master data, editions, classes, arrivals, backlog, faults, truth timelines | `world.mjs` |
| `actors.mjs` | resolvers (guarded steps on `itsm.assign`), callers (steps on `notify.send`), incident managers (`answer`) | `actors.mjs` |
| `sla.mjs` | **oracle-side SLA engine**: pure `slaTimeline(world, history, opts)` → per SLA: attach, startAt, schedule, tz, pauses, D, thresholds, end, record values; built on `lib/calendar.mjs` + `lib/clock.mjs`; imports nothing from host, solvers or controls | (new; E8 had `lib/saga.mjs` as its independent core) |
| `transition.mjs` | `referenceTransition`, `recordsOf`, `canonicalArgs`, `historyOf` (events → incident history) | `transition.mjs` |
| `index.mjs` | `family`, `specE`, `schemas`, `binding`, `oracleItem`, `critical`, `referencePolicy`, `referenceRuns`, `oracle` | `index.mjs` |
| `controls.mjs` | bad, gaming, necessity controls as reference variants (§8) | `controls.mjs` |
| `golden.mjs` | hand-derived goldens as data + `runGoldens(transition)` (§9) | `golden.mjs` |
| `test/e7.test.mjs`, `test/sla-nversion.test.mjs` | item suite; N-version SLA clock fuzz (§11) | `test/e8.test.mjs` |
| `tools/` | `health`, `controls-run`, `arm-smoke`, `mutate`, `specificity-run`, `nversion`, `timeline` | same + 2 |
| `specificity/` | three blind solvers (written later by a separate session) | same |
| `README.md` | status, commands, measurements, decisions (after the build) | same |

Shim `beds/ebed-e7/index.mjs` re-exporting `index.mjs`, as for E8 (E-BED §2.4). Imports allowed: `../../lib/rng.mjs`,
`../../lib/canonical.mjs`, `../lib/*` (oracle side only), `../host/mocks.mjs`, `../host/schema.mjs`,
`../host/systems/common.mjs`, `../oracle/*`.

---

## 3. Systems (`systems.mjs`)

Mocks enforce referential integrity and lifecycle only; every rule is the arm's to keep and the oracle's to grade
(E8 pattern). All ops `latencyMinutes: 1`, `subjectArgs: ['number']` (`about` for `notify.send`).

| system.op | keyed | args (canonical names) | mock checks |
|---|---|---|---|
| `itsm.create` | yes | number, source {kind, id}, callerId∣null, ci, check∣null, service, category, impact, urgency, priority, openedAt, summary | number unique; ci and service exist |
| `itsm.assign` | yes | number, group, at, ref∣null | incident and group exist; sets `assignmentGroup`, `state: assigned`, clears `assignedTo`, `holdReason`; increments `assignments` |
| `itsm.accept` | yes | number, user, at | sets `assignedTo`, `state: inProgress` |
| `itsm.hold` | yes | number, reason, at | `state: onHold`, `holdReason` |
| `itsm.resume` | yes | number, at | `state: inProgress`, `holdReason: null` |
| `itsm.reclassify` | yes | number, impact, urgency, priority, at | values 1–3 / 1–5 |
| `itsm.resolve` | yes | number, closeCode, at | `state: resolved`, `resolvedAt` |
| `itsm.close` | yes | number, reason, at | `state: closed`, `closedAt`, `closeReason` |
| `itsm.cancel` | yes | number, at | `state: cancelled` |
| `itsm.linkAlert` | yes | number, alertId | appends to `alerts` (409 if linked) |
| `itsm.setMajor` | yes | number, at | `major: true`, `majorAt` |
| `sla.start` | yes | number, definition, generation, startAt, schedule∣null, timezone∣null, plannedBreachAt∣null | 409 if the SLA id exists |
| `sla.pause` / `resume` | yes | … at (+ plannedBreachAt) | stage must be inProgress / paused (409) |
| `sla.breach` | yes | … at | stage inProgress or paused; once |
| `sla.stop` | yes | … at, elapsedMinutes, businessElapsedMinutes, breached | stage inProgress or paused |
| `sla.cancel` | yes | … at, reason | stage inProgress or paused |
| `sla.escalate` | yes | number, definition, generation, percent, to | SLA exists |
| `notify.send` | yes | to, about, template, text, ref | shared `common.mjs` |

Tables: `itsm.incidents` (pk `number`), `sla.slas` (pk `slaId` = `<number>/<definition>/<generation>`; holds the
values the arm wrote, never computed ones), `sla.escalations` (pk `<slaId>/<percent>`), `notify.notifications`.
Hidden tables: none needed (scenarios live in truth, read only by actors). Enums: `INCIDENT_STATE = new, assigned,
inProgress, onHold, resolved, closed, cancelled`; hold reasons `awaitingCaller, awaitingVendor` (+ `awaitingChange` from
the d5 enum extension); `SLA_STAGE = inProgress, paused, completed, cancelled`. Names are slice-2 ready: `itsm` will add
`problems`, `changes`, `approvals` tables and their ops; `sla` definitions will gain `appliesTo: 'incident' | 'problem'
| 'change'` (default `incident`).

---

## 4. World (`world.mjs`)

### 4.1 Time, calendars, zones

- `t0 = 2026-03-02T00:00:00+01:00`; arrivals over business days 0–24 (tuned for K1 censoring, §4.8); epochs in business
  time of `SCH-EU-STD` (ep0 0–7.5 bd, ep1 –12, ep2 –18, ep3 –25.5, ep4 –30).
- Calendars (lib format, `calendar/<id>.json`): `SCH-EU-STD` Europe/Amsterdam Mon–Fri 09:00–17:00, holidays 04-03,
  04-06 (also the service desk calendar, `businessDayMinutes: 480`); `SCH-US-STD` America/New_York Mon–Fri 08:00–17:00,
  company holiday 03-20; `SCH-AU-STD` (d3+) Australia/Sydney Mon–Fri 08:30–17:00, holidays 04-03, 04-06; `SCH-EXT`
  **floating** (`tz: null`) Mon–Sat 07:00–19:00, no holidays. 24×7 is `schedule.source: 'none'`.
- In-horizon clock events: US DST 03-08 (ep0), company holiday US 03-20 (ep2), EU DST 03-29 (ep3), Easter 04-03..06
  and AU DST end 04-05 (ep3/ep4).

### 4.2 Master data (`master/`)

- `cis.json` `{ ci, name, aliases[], service, region, timezone, supportGroup }`: d2 ≈ 24 CIs in EU and US; d3 adds AU
  CIs and aliases used by callers.
- `services.json` `{ service, name, impact, supportSchedule, owner }`: ≈ 8 services (e.g. e-mail, payroll, intranet,
  CRM, network-EU, laptops; d3 trading-AU).
- `groups.json` `{ group, name, mailbox, managerEmail, schedule }`: d2 `GRP-SD-EU`, `GRP-NET-EU` (SCH-EU-STD),
  `GRP-SD-US`, `GRP-APP-US` (SCH-US-STD); d3 adds `GRP-APP-AU` (SCH-AU-STD) from epoch 1 ("new group in a new time
  zone").
- `users.json` `{ userId, name, email, region, timezone, roles[] }`: ≈ 60 callers, resolvers per group, and the
  incident managers `u-im1..u-im3` (also callers in the SoD class); `actorsPool.incidentManager = [u-im1, u-im2, u-im3]`.

### 4.3 Rulebook (`rulebook/<edition>/`)

- `priority.json`: the 9 wildcard cells (1,1→1; 1,2→2; 1,3→3; 2,1→2; 2,2→3; 2,3→4; 3,1→3; 3,2→4; 3,3→5), order
  1000+, **listed first in the file**, plus override rows (order 10–50; e.g. intranet 1,1→2; payroll 2,1→1 and
  2,2→2). File order ≠ precedence, so a first-match engine differs on every override service.
- `assignment.json`: `access` + region → that region's service desk (order 10–12); `*`,`*` → `ciSupportGroup` (order
  100).
- `alert-urgency.json`: critical→1, major→2, minor→3, warning→null.
- `policy.json`: `{ systemTimeZone: 'Europe/Amsterdam', serviceDeskCalendar: 'SCH-EU-STD', businessDayMinutes: 480,
  callerReplyDays: 3, resolvedCloseDays: 2, majorApprovalMinutes: 30, incidentManagersMailbox }`.
- `sla-definitions.json` (all targets multiples of 4 minutes, so every threshold is a whole minute):

| id | d | start (from, retro pause) | target | schedule / tz | pause | stop | cancel | reset | escalations |
|---|---|---|---|---|---|---|---|---|---|
| RES-P1 | 2 | priority∈{1} (openedAt, yes) | 240 | none | onHold+awaitingCaller | resolved, closed | start fails; cancelled | – | 50 group, 75 groupManager, 100 incidentManagers |
| RES-P2 | 2 | priority∈{2} (openedAt, yes) | 600 | SCH-EXT floating; tz caller → ci → definition (Europe/Amsterdam) | same | same | same | – | same |
| RES-P3 | 2 | priority∈{3} (openedAt, yes) | 1440 (ed-2: 960) | service | same | same | same | – | same |
| RES-P4 | 2 | priority∈{4} (openedAt, yes) | 2400 | service | same | same | same | – | same |
| RSP-HI | 2 | priority∈{1,2} (match) | 60 | none | – | inProgress, onHold, resolved, closed | start fails; cancelled | assignmentGroup | 50/75/100 |
| RSP-STD | 2 | priority∈{3,4} (match) | 240 (ed-2: 120) | assignmentGroup | – | same as RSP-HI | same | assignmentGroup | 50/75/100 |
| RES-MAJOR | 4 (ed-2 only) | major∈{true} (openedAt, yes) | 120 | none | onHold+awaitingCaller | resolved, closed | cancelled | – | 50/75/100 |
| VND-HOLD | 5 | state∈{onHold}, holdReason∈{awaitingVendor} (match) | 240 | service | – | state∈{inProgress, assigned, resolved, closed} | cancelled | – | 75, 100 |
| RSP-ALERT | 5 | source∈{alert}, priority∈{1,2} (match) | 20 | none | – | as RSP-HI | start fails; cancelled | assignmentGroup | 50, 100 |
| OLA-EU / OLA-US / OLA-AU | 5 | assignmentGroup∈{region's groups}, priority∈{2,3,4} (match) | 960 | assignmentGroup | onHold+awaitingCaller | resolved, closed | start fails; cancelled | assignmentGroup | 50/75/100 |

  d2–d3: 6 definitions; d4: 7 (RES-MAJOR from ed-2); d5: 12 in three zones (E-BED's "12 definitions in 3 time zones").
- Editions: `ed-2026-1` (effectiveFrom 2026-01-01); d4+ `ed-2026-2` effectiveFrom **2026-03-23** (ep2), published
  2026-03-18T09:00+01:00 (RES-P3 1440→960, RSP-STD 240→120, RES-MAJOR, one new override row).

### 4.4 Inbound streams

- **Reports** (`incident.reported`): callers' business hours of their region, Poisson-like per business hour; doc
  `docs/<eventId>.txt`; d3+: CI named by name or alias (20%), mistyped numbers in caller messages (30%), duplicate
  report delivery (10%, 1–90 min later, never in the same instant).
- **Alerts** (`alert.raised`): 24×7; same (CI, check) alerts never share an instant (E7-5); W1 redelivery of the same
  alertId 1–30 min later; joining alerts 2–40 min apart; recurrence alerts ≥ 30 min after the resolution event.
- **Resolver updates, caller messages, approval answers**: on-policy reactions (§5).

### 4.5 Case classes `[id, min d, natural weight, tail]`

| class | d | w | tail | path (what it exercises) |
|---|---|---|---|---|
| `straight` | 2 | 50 | no | report → assign → accept → resolve inside targets → confirm or auto-close |
| `alert-straight` | 2 | 12 | no | alert opens → accept → resolve → auto-close (no caller) |
| `slow` | 2 | 4 | yes | resolution after the RES target: breach record, 50/75/100 escalations, stop with `breached: true` |
| `awaiting-reply` | 2 | 5 | yes | hold awaitingCaller → `awaiting-caller` → reply before D → resume (pause/resume arithmetic) |
| `awaiting-timeout` | 2 | 4 | yes | hold awaitingCaller → no reply → close at D (strictly after), SLA stopped while paused |
| `vendor-hold` | 2 | 3 | yes | hold awaitingVendor: no pause (data-driven pause condition) |
| `reassign` | 2 | 4 | yes | accept → reassign to a group in another zone → accept (new RSP generation on the new schedule) |
| `bounce` | 2 | 2 | yes | reassign before acceptance: RSP cancel(reset) + new generation |
| `priority-up` / `priority-down` | 2 | 3 / 2 | yes | reclassify: RES cancel(start-failed) + retroactive attach with past pauses; RSP swap before acceptance |
| `major-approve` / `major-reject` | 2 | 2 / 1 | yes | P1 → approval task → setMajor + notice / nothing |
| `withdraw` | 2 | 2 | yes | caller withdraws: cancel, SLAs cancelled, `incident-cancelled` |
| `resolve-unaccepted` | 2 | 2 | yes | W2: resolve from `assigned`; RSP stops at the resolution |
| `dup-alerts` | 2 | 3 | yes | alert incident + joining alerts + W1 redelivery |
| `alert-recur` | 2 | 1 | yes | an alert after the earlier incident's resolution opens a new incident |
| `alert-warning` | 2 | 1 | yes | warning alert: no effect (subject `null`) |
| `reply-at-deadline` / `reply-late` | 3 | 1 / 1 | yes | reply exactly at D counts (S1); reply after D changes nothing |
| `confirm-late` | 3 | 1 | yes | confirmation after D2 (already auto-closed) |
| `hold-reassign` | 3 | 1 | yes | W4: reassignment during an awaiting-caller hold ends it (S7) |
| `major-timeout` / `major-moot` / `major-sod` | 3 | 1 / 1 / 1 | yes | fail-safe after the deadline; resolved before the answer (R7.3); caller is an incident manager (excludeUsers) |
| `alert-escalates` | 3 | 1 | yes | joining critical alert raises urgency → P1 → approval task |
| `dst-24x7` | 3 | 1 | yes | P1/P2 opened in the night of a DST change (EU, US or AU) |
| `holiday-span` | 3 | 2 | yes | P3/P4, auto-close deadlines across Easter |
| `edition-attach` | 4 | 2 | yes | reclassified after 03-23 with `openedAt` before it (edition at attach, S6) |
| `major-late` | 4 | 1 | yes | RES-MAJOR attaches already past 50/75/100% (S12) |
| `storm` | 5 | 2 | yes | one CI outage: 3–6 checks, 20–60 alerts in an hour → one incident per check |
| `vendor-ola`, `hold-change` | 5 | 2 / 1 | yes | VND-HOLD generations; `awaitingChange` (enum extension, pauses nothing) |
| `f1-notify`, `f2-escalate` | 5 | 2 / 2 | yes | injected faults on the arm's notice / escalation (bare: arm retries with the same key) |
| `invalid` (stray) | 3 | n/40 | yes | caller message naming no incident (optional `unknown-incident`) |

Tail mix: tail classes take 60% of the mass (E8 rule). **Sizes** (arriving incidents): d1 12, d2 60, d3 100, d4 120,
d5 250 (2× d4 plus storms); scale tier ×10 (E-BED's d5 "1,000 incidents" lands at the scale tier, §15).

### 4.6 Go-live backlog (epoch `gl`; contract §3.5)

d1 2, d2 4, d3 6, d4 6, d5 10, cycling `gl-assigned` (assigned Friday, not accepted), `gl-inprogress`, `gl-awaiting`
(on hold awaitingCaller since the previous week: D falls after t0), `gl-resolved` (awaiting confirmation). The export
holds `itsm.incidents`, `sla.slas` (with their pauses and planned breach), `sla.escalations` already sent and
`notify.notifications`; post-t0 resolver updates and caller messages are pre-generated arrivals with no `ref`
(correlation by number, like E8's `gl-dispatched`).

### 4.7 Drift per difficulty

| d | adds |
|---|---|
| d1 | toy: 12 incidents, 2 groups, reports only |
| d2 | base: EU + US groups (two zones), 6 definitions, reports and alerts, holds (caller, vendor), reassignment and bounce, priority changes, P1 approval (approve, reject), withdraw, resolve-unaccepted (W2), duplicate alerts (W1), warning alerts, backlog; DST and Easter in the horizon |
| d3 | AU group, CIs and callers from epoch 1 (third zone, AU DST end, AU Easter); CI aliases and mistyped numbers; actor noise on approvals (late, none, delegated, withdrawn, free text, form route, as E8); deadline ties; hold-reassign (W4); SoD; alert escalation; strays; duplicate reports |
| d4 | `ed-2026-2` effective 2026-03-23, published 03-18 (targets, RES-MAJOR, an override row): edition at attach |
| d5 | 2× volume; alert storms; 12 definitions in 3 zones; F1 on `notify.send`, F2 on `sla.escalate`; F5 rename of `itsm.create` `ci` → `configurationItem` from ep3 (E-BED's "CMDB rename"); hold-reason enum extension `awaitingChange` from ep3 (E-BED's "state enum extension") |

### 4.8 Faults (keyed by (case, system, op, ordinal), identical for every arm; contract §4.3)

F1 `notify.send` (`retryAfterSeconds: 60`) and F2 `sla.escalate` at d5 on their classes; F5 at the ep3 boundary. No
F3/F4/F6 in slice 1 (no money, no batches, no saga); W1 (duplicate alerts and reports), W2 (resolve before
acceptance), W3 (late replies, confirmations and approvals), W4 (reassignment during a pause), W5 (injection twin) are
world classes. Censoring target (K1): completed pool ≥ 80% in ep0–ep3; arrivals end at business day 24 and resolver
delays are tuned until `tools/health.mjs` shows it.

### 4.9 Timing safety (the E8 rule, adapted)

Every resolver, caller and alert instant is computed from **world anchors** (the true `openedAt`, the true
reassignment, hold and resolution instants), in business minutes of the acting group's schedule, never from an arm's
commit time. So any arm acting anywhere inside its windows meets the same timeline, the same races and the same SLA
values. Rules the generator self-checks (test 2): consecutive resolver steps ≥ 30 wall minutes apart (a 15-minute
record window always closes before the next step's guard is read); caller replies, confirmations and approval answers
never fall within 15 minutes of their deadline except the planted ties (`reply-at-deadline`, an approval exactly at
its deadline); recurrence alerts ≥ 30 minutes after the resolution; no two events of one incident in one instant except
planted ties.

---

## 5. Actors (`actors.mjs`)

- **Resolvers** (`counterparty` on a committed `itsm.assign`): keyed by (world, truth case, assignment ordinal k). If
  `args.group` is the true group of assignment k, the reaction returns **guarded steps** with absolute times from the
  truth timeline (§4.9): `accept` (guard `state ∈ {assigned}`), then the scenario's steps (hold, resume, reclassify,
  reassign, resolve), each guarded on the state its predecessor leaves (`inProgress`, `onHold`, …), each an event
  `resolver.update` with `quoteRef: true` (routed to the instance that placed the ref, H-25). A wrong group gets
  silence (the case has already diverged). Single-field guards are enough because a group's steps end at its own
  reassign step and the next group's steps are scheduled by the next `itsm.assign`.
- **Callers** (`counterparty` on `notify.send`): `awaiting-caller` → one step: a `caller.message` (`intent: reply`,
  inbound, number typed with d3 noise) at the true reply instant, or nothing; `resolved` → a `confirm` at the true
  instant or nothing; withdrawals are pre-generated arrivals (they do not depend on a notice).
- **Incident managers** (`answer`, kind `majorIncidentApproval`): delay from task creation (5–20 min for decided
  classes, none or 45+ for timeout), noise as E8 at d3+. The answering user is the first pool member not excluded
  (contract §4.4), which makes the SoD class observable.
- Salts: `rng('ebed/e7/resolver', world.id, case, k)`, `rng('ebed/e7/caller', world.id, case, ordinal)`,
  `rng('ebed/e7/manager', world.id, case, ordinal)`; world parts `rng('ebed/e7/world'|'ebed/e7/case', seed, split, d,
  mix, …)` as E8.

---

## 6. Reference transition (`transition.mjs` + `sla.mjs`)

`referenceTransition(world, view)` for one incident at one processing point, on the arm's own trajectory:

1. **Invalid cases** (strays, warning alerts): `decisions.graded = { subject: null, priority: null }`; permitted
   `unknown-incident`; terminal.
2. **History** `historyOf(world, view)`: the incident's changes as `{ at, kind, … }` from the truth events delivered so
   far (opening report or alert, joining alerts, resolver updates, caller messages, the migration export), the
   approval tasks and answers (`view.tasks`, `view.taskEvents`), and the rule-timed changes (closure at D or D2,
   fail-safe declaration) once their deadline has passed. Same-instant changes in delivery order (S5).
3. **Classification** (R2) at each change, edition at its instant; **assignment** (R3.1) at `openedAt`.
4. **SLA timeline** `slaTimeline(world, history, edition)` in `sla.mjs`: evaluates R4.2 at every change instant;
   per SLA builds a `lib/clock` history (start at `startAt`, retroactive pauses, pauses, resumes, stop or cancel) and
   reads `dueAt`, warnings and `businessElapsedMs` / `actualElapsedMs` with `boundary: 'exclusive'`; the calendar is
   the schedule fixed at attach with the bound zone (a floating calendar gets `{ ...cal, tz }`). Memoised per (case,
   history digest) so the per-point re-evaluation stays within E8's time budget.
5. **Escalations** (R5): one per (SLA, percent) reached and not preceded by stop or cancel; recipient from the group
   at the due instant.
6. **Callers and closure** (R6), **major approval** (R7, with R7.3 moot handling as E8's S9 `maybe`).
7. **Records** (R8) and `end` when the incident is closed or cancelled.

**Logical effect ids** (functions of rule and business keys only): `create:N`, `asg:N:k`, `ntf:N:assignment:k`,
`acc:N:<ev>`, `hold:N:<ev>`, `res:N:<ev>`, `rcl:N:<ev>`, `rsv:N`, `cls:N`, `cnc:N`, `lnk:N:<alertId>`, `maj:N`,
`ntf:N:<template>`, `sla:N/DEF/g:start|stop|cancel|breach`, `sla:N/DEF/g:pause:<instant>`,
`sla:N/DEF/g:resume:<instant>`, `esc:N/DEF/g:<percent>`; task lid `mia:N`.

**Windows** (all rule-cited): `create` [t, t]; incident records, SLA records, escalations, notices, `linkAlert`,
approval task, `setMajor` on an answer [t, t + 15 min]; R6.3 / R6.5 auto-closures and the SLA records they cause
(D, D + 60 min]; R7.2 fail-safe and its records (deadline, deadline + 15 min]. Earliest of a strictly-after window is
D + 1 s (E8's convention). **Order** (`after`, graded only where declared): every op after `create:N`; SLA ops of one
SLA in lifecycle order (start → pause → resume → … → stop|cancel).

**Records** at the terminal tick: the incident (state, priority, impact, urgency, group, assignee, openedAt,
resolvedAt, closedAt, closeCode, closeReason, major, sorted alerts), each SLA (stage, startAt, schedule, timezone,
breached, breach `at`, elapsed values, end `at`), the escalation set, the notification set (template, to).

**Decisions** graded on every graded tick: `{ subject, priority }`.

---

## 7. Oracle binding (`index.mjs` `oracleItem`) and invariants

### 7.1 Hooks (the same set E8 provides)

- `referenceTransition`, `recordsOf`, `critical`.
- `canonicalArgs(system, op, args)`: every instant-valued arg (`at`, `startAt`, `openedAt`, `plannedBreachAt`) is
  rewritten to canonical UTC (`YYYY-MM-DDTHH:MM:SSZ`) when it parses as an ISO instant with offset (SPEC §1: "compared
  as instants"); `itsm.create` `source` key-sorted; nothing else normalised (normalising incident numbers is the arm's
  graded work).
- `batch: {}` (no batch ops). `fullArgs`: `itsm.assign` gets `ref: ref-<lid>`; `notify.send` gets a text.
- `taskSpec`: `majorIncidentApproval`, role `incidentManager`, `excludeUsers` = [caller] when the caller exists,
  `answerSchema { decision: approve | reject }`, `dueAt` = now + 30 min, `onTimeout: { action: 'declare' }`.

### 7.2 Critical violations (contract §5.3, E7 instances)

`effect-after-end` (an `itsm` or `sla` op committed after the incident's close or cancel record); `sod` (an approval
answered by the incident's caller); `major-without-approval` (`setMajor` committed with no `approve` counted and
before the deadline passed); W5 twin divergence (analyst side). No money movement exists in slice 1.

### 7.3 Invariants (analyst side; on the reference runs they are oracle failures)

business elapsed ≤ elapsed; Σ running + Σ paused = total per SLA; at most one SLA per definition in progress or paused
per incident; breach monotone; one terminal state; thresholds non-decreasing in percent.

### 7.4 Shared code

No change to `beds/ebed/host/`, `beds/ebed/oracle/` or `beds/ebed/lib/` is required: guards are single-field (§5),
counterparty steps with absolute times and `quoteRef` exist (`host.mjs` `#counterparty` [M]), calendars pass through as
files (`host.mjs:437` [M]), F5 renames are generic, the grader's argument match runs after `item.canonicalArgs`
(`oracle/grade.mjs:29` [M]). If a multi-field guard turns out necessary, the fallback is a backwards-compatible `all:
[guards]` in `#guardHolds`, with a host test and the E8 suite run before and after (`node --test --test-concurrency=2
'beds/ebed/e8/test/*.test.mjs'`).

---

## 8. Controls (`controls.mjs`; E-BED §2.9, contract §5.5)

Necessity controls are the reference policy minus one construct (E8's `VARIANTS`: `armWorld`, `viewFilter`, `drop`,
`due`, `post`). Constructs inside the SLA engine are removed through `armWorld` edits (definitions, calendars, tables);
the one control that needs an engine switch passes an analyst-only flag `armWorld.controlFlags` read by `sla.mjs` (the
leak test asserts no generated world carries it).

| control | kind | construct removed | target classes | must |
|---|---|---|---|---|
| `noop`, `echo` | bad | everything | all | fail every world |
| `declare-every-obligation` | gaming | (40 timers, no effects) | all | fail every world |
| `escalate-everything` | gaming | adds an approval task for every incident and every escalation at attach | all | fail every world |
| `pause-everything` | gaming | pauses every SLA at start ("hold everything") | all | fail every world |
| `24x7-no-pause` | necessity | every schedule 24×7 and no pause | schedule-bearing SLAs (P2–P4, RSP-STD), holds | ≥ 50% of target cases |
| `pause-ignored` | necessity | pause conditions dropped | awaiting-*, gl-awaiting, hold-reassign | ≥ 50% |
| `first-match-priority` | necessity | lowest `order` → first row in file order | incidents on override services | ≥ 50% |
| `breach-at-start-of-pause` | necessity | the breach instant planned before a pause is kept: an SLA paused across its planned breach is breached (and escalated at 100%) at that instant | awaiting-* whose pre-pause plan falls in the pause | ≥ 50% |
| `no-holiday` | necessity | holidays removed | holiday-span, any SLA or deadline across 03-20 or Easter | ≥ 50% |
| `wrong-timezone` | necessity | every schedule (fixed and floating) evaluated in the system zone | US and AU groups and callers, dst-24x7 on business schedules | ≥ 50% |
| `never-escalate` | necessity | `esc:` lids dropped | every case with a threshold reached (slow, awaiting-*, major-late) | ≥ 50% |
| `no-retroactive-start` | necessity (extra) | `start.from` := match | priority-up/down, major-late | ≥ 50% |
| `no-reset` | necessity (extra) | `reset` := null | bounce, reassign | ≥ 50% |
| `edition-at-start` | necessity (extra) | definition edition by `startAt` | edition-attach | ≥ 50% |
| `timer-first` | necessity (extra) | closure / fail-safe taken at the deadline | awaiting-timeout, reply-at-deadline, major-timeout, auto-close | ≥ 50% |
| `no-dedupe` | necessity (extra) | every alert opens an incident | dup-alerts, storm | ≥ 50% |
| `no-correlation` | necessity (extra) | caller messages not merged | awaiting-reply, withdraw, confirm | ≥ 50% |
| `no-sod` | necessity (extra) | `excludeUsers` dropped | major-sod (critical `sod`) | 100% |

`breach-at-start-of-pause` is defined as above because the name admits several readings; the alternative ("a pause
starting exactly at D prevents the breach") is covered by the S2 boundary mutant and golden G15 instead.

---

## 9. Goldens (`golden.mjs`; hand-derived, rule-cited, every value checked with `lib/` [M-c])

Each golden feeds a synthetic history to the transition (E8's `builder` pattern) and checks lids, windows and record
values. Times are local unless marked Z.

| id | history | expected | rules | discriminates |
|---|---|---|---|---|
| G1 matrix | 9 (impact, urgency) pairs on a non-override service; 3 override pairs | 1,2,3 / 2,3,4 / 3,4,5; intranet 1,1→2; payroll 2,1→1, 2,2→2 | R2.2 | first-match-priority (wildcard rows come first in the file) |
| G2 Easter | RES-P3 (1440, SCH-EU-STD) opened Thu 2026-04-02 15:00+02:00 | 50% Wed 04-08 11:00; **75% Wed 04-08 17:00** (at a close, S4); breach Thu 04-09 15:00+02:00 | R4.4, R5, S4 | no-holiday → breach Tue 04-07 15:00 |
| G3 EU DST, business | RES-P3 opened Fri 2026-03-27 16:00+01:00 | breach Wed 2026-04-01 16:00+02:00 (14:00Z) | R4.4 | fixed-offset arithmetic (an hour late) |
| G4 EU DST, 24×7 | RES-P1 (240) opened Sun 2026-03-29 01:30+01:00 | 50% 04:30+02:00, 75% 05:30+02:00, breach 06:30+02:00 (04:30Z) | R4.4 | local wall arithmetic (05:30) |
| G4-US / G4-AU | RES-P1 opened Sun 2026-03-08 01:30−05:00 / Sun 2026-04-05 01:30+11:00 | breach 06:30−04:00 / 04:30+10:00 | R4.4 | local arithmetic (05:30 both) |
| G5 US business | RSP-STD (240, SCH-US-STD) attached Fri 2026-03-06 15:00−05:00 | breach Mon 03-09 10:00−04:00 (14:00Z) | R4.3, R4.4 | wrong-timezone → 07:00−04:00 |
| G6 AU Easter + DST | RSP-STD (SCH-AU-STD) attached Thu 2026-04-02 16:00+11:00 | breach Tue 04-07 11:30+10:00 (01:30Z) | R4.4 | no-holiday, wrong-timezone |
| G7 floating tz | RES-P2 (600, SCH-EXT) report by a New York caller Fri 2026-03-06 17:00−05:00; alert on a Sydney CI Fri 2026-04-03 18:00+11:00 | breach Sat 03-07 15:00−05:00; Sat 04-04 16:00+11:00 (Saturday counts; no holidays on SCH-EXT) | R4.3 tz precedence | wrong-timezone (NY: 11:00−05:00); caller vs ci source |
| G8 pause arithmetic | RES-P3 opened Mon 2026-03-09 10:00+01:00; hold awaitingCaller Tue 03-10 14:00; reply Thu 03-12 11:00; resolved Fri 03-13 12:00 | planned at start Thu 03-12 10:00; **50% at Tue 14:00 = the pause instant** (S3); resume planned Fri 03-13 15:00; 75% Thu 03-12 17:00; stop elapsed 3180, business 1260 (pause 780 business min), breached false | R4.4–R4.6, R5, S3 | pause-ignored (business 2040, breached Thu 10:00); breach-at-start-of-pause (breach Thu 10:00 during the pause) |
| G9 auto-close | hold Fri 2026-03-13 16:00+01:00, 3 business days | D Wed 03-18 16:00; reply at D counts; close window (D, D + 60 min] with `at: D`; reply at D + 1 min changes nothing | R6.1–R6.3, S1, S10 | timer-first (close at D) |
| G9b auto-close, Easter | hold Thu 2026-04-02 10:00+02:00 | D Thu 04-09 10:00+02:00 | R6.1 | no-holiday → Tue 04-07 10:00 |
| G10 resolved close | resolved Fri 2026-03-06 12:00+01:00, 2 business days | D2 Tue 03-10 12:00; confirm before D2 closes at its time; none → close `at: D2` | R6.4, R6.5 | timer-first |
| G11 retroactive start + pause | opened Mon 2026-03-16 09:00 at P4; hold awaitingCaller 13:00–15:00; reclassify to P3 Tue 03-17 13:00 | RES-P4 cancelled `start-failed` at Tue 13:00; RES-P3 gen 1 startAt Mon 09:00, retro pause/resume 13:00/15:00, business at attach 600; planned Thu 03-19 11:00 | R4.2, R4.3 | no-retroactive-start → Fri 03-20 13:00 |
| G12 reset / re-attach | P3 incident; bounce (reassign before acceptance) Fri 2026-03-06 21:00+01:00 to a New York group | RSP-STD gen 1 cancelled `reset`; gen 2 startAt 21:00+01:00 on SCH-US-STD, planned Mon 03-09 10:00−04:00; after acceptance a later reassign attaches gen 3 (start holds, none active) | R4.2 reset, attach | no-reset |
| G13 edition at attach | d4: opened Fri 2026-03-20 10:00+01:00 at P4; reclassified to P3 Mon 03-23 10:00 | RES-P3 uses ed-2 target 960: business at attach 480 = **50% reached exactly at attach**; 75% Mon 14:00; planned Tue 03-24 10:00 | R0, R4.3, S6, S12 | edition-at-start → 1440, planned Wed 03-25 10:00 |
| G14 major approval | P1 at creation 10:00; task created 10:05 | deadline 10:35; answer at 10:35 counts; none → `setMajor at 10:35` in (10:35, 10:50]; resolved at 10:20 before an answer → moot; caller u-im1 must be excluded | R7, S1, S11 | timer-first, no-sod |
| G15 breach at target | RES-P1 opened 10:00, resolved 14:00 the same day (24×7) | `sla.breach at 14:00`, 100% escalation, stop `breached: true` | R4.6, S2 | inclusive-boundary mutant |
| G16 alerts | alert A (critical) opens; B same ci+check 10 min later joins; A redelivered; C after A's resolution (+30 min) opens a new incident; a warning changes nothing; a joining critical alert on a P2 incident raises urgency → P1 → approval task | R1.2–R1.4, R2.3, R7.1, S8 | no-dedupe |
| G17 hold-reassign | hold awaitingCaller 10:00, reassign 11:00, reply 12:00 | RES paused 10:00–11:00 only; reply changes nothing; no auto-close | R3.2, S7 | pause until reply |
| G18 withdraw / W2 | withdraw before acceptance; resolve from `assigned` | SLAs cancelled `cancelled`; RSP stops at the resolution | R6.6, R3.2, R4.2 | – |

The golden module is also the mutation tool's kill set, as in E8 (E8-13).

---

## 10. Property, metamorphic, N-version and mutation suites

- **N-version SLA clock** (E-BED §9.1 "P60 everywhere"): `test/sla-nversion.test.mjs` steps minute by minute with
  `Intl.DateTimeFormat` (Node's ICU zone data, independent of `lib/time.mjs`'s pinned rule table and of
  `lib/calendar.mjs`'s interval arithmetic) and compares D, thresholds and both elapsed values with `sla.mjs` on 10³
  fuzzed histories in the suite and 10⁴ in `tools/nversion.mjs` (fuzz bases 1301–1310, salt `ebed-fuzz/e7/<base>/<i>`);
  every disagreement is resolved by quoting R4.4 and logged.
- **Clock laws** (E-BED §9.2): business elapsed ≤ elapsed; adding a pause never increases business elapsed nor moves D
  earlier; breach monotone in the pause set; 24×7 DST invariance in UTC.
- **Metamorphic** (E-BED §9.3): MR3 shift by whole weeks away from DST and holidays → identical business values; MR4
  permute order-independent events in a wake-up; MR5 duplicate an alert or report → identical ledger; MR7 add an
  unrelated incident; MR8 holiday on a non-business day → no change, on a business day inside a window → D + one
  business day (480 min); MR9 edition effective after every anchor → no change; MR12 injection twin → identical
  decisions.
- **Mutation operators** (`tools/mutate.mjs`, K1 ≥ 0.95): breach boundary inclusive; threshold ceil; holidays dropped;
  zone swapped; pause condition deleted; pause on any hold; retroactive start or pause dropped; reset dropped; edition
  by startAt; edition by publication; first-match precedence; highest-order precedence; D anchored at attach;
  recipient fixed at attach; SoD exclusion dropped; dedupe on CI only; join after resolution; closure at D; escalations
  skipped when reached before attach.

---

## 11. Test list ($0; `node --test --test-concurrency=2 'beds/ebed/e7/test/*.test.mjs'`)

`test/e7.test.mjs`:
1. world generation is pure and deterministic; difficulty features appear where declared (d3 AU group/zone, d4 two
   editions with `edition.json`, d5 12 definitions, F1/F2/F5, storms); DST and Easter inside the horizon; tail share ≥ 0.5.
2. timing safety self-check (§4.9) on every case of dev worlds 1001–1010 × d2–d5.
3. both reference runs pass every case they complete (d2–d5): 0 divergences, 0 oracle errors, 0 critical, 0 invariant
   violations; completed share ≥ 0.85.
4. every bad and gaming control fails the world; every necessity control fails ≥ 50% of its target cases (attack
   world 1211, d5).
5. a reference run replays byte-identically (E-BED §9.7).
6. leak: no class id, scenario field (reply plans, resolver plans, delays), case id or `controlFlags` reaches an arm
   (inputs, files, query results); `sla.slas` holds only arm-written values.
7. golden module: every exported golden passes the reference transition.
8. goldens by name (G1–G18, one test per group as E8 does).
9. SLA engine laws and metamorphic relations on fuzzed histories (§10).
10. spec-E is the module's spec, names every rule the oracle cites (R0–R8, S1–S12), and contains no truth-only
    vocabulary (class ids, control names).
11. W5 twins: identical decisions and ledgers on the reference run.

`test/sla-nversion.test.mjs`: 10³ fuzzed histories, Intl minute stepper ≡ `sla.mjs`.

E8 is untouched by this plan; if §7.4's fallback is ever used, the E8 suite is run before and after and must be
unchanged.

---

## 12. Tools (mirroring E8)

```sh
node beds/ebed/e7/tools/health.mjs --seeds 1001-1030                 # reference runs, pools, censoring by epoch, wall time
node beds/ebed/e7/tools/controls-run.mjs --seeds 1211-1214           # controls on attack worlds
node beds/ebed/e7/tools/arm-smoke.mjs <solver.mjs> --seed 1241 --difficulty 3
node beds/ebed/e7/tools/mutate.mjs                                   # oracle mutation score (K1 >= 0.95)
node beds/ebed/e7/tools/specificity-run.mjs                          # blind solvers, 0 false rejects
node beds/ebed/e7/tools/nversion.mjs --bases 1301-1310 --n 10000     # SLA clock differential fuzz
node beds/ebed/e7/tools/timeline.mjs --seed 1001 --difficulty 3 --case i0042   # one incident's SLA timeline (analyst)
```

## 13. Seeds (SEED-LEDGER, owner `ebed`)

Dev `ebed-dev` **1001–1199** (bed health, suites, goldens, controls, dev streams); rehearsal `ebed-e7-rehearsal`
**1201–1249** (author fixtures 1201–1206, attacks 1211–1222, reference validation 1231, dev rehearsals 1232–1234,
specificity and Track C rehearsals 1241–1249); fuzz bases 1301–1310; held-out 9101–9104, sealed 9201–9204 and scale
9301–9302 are reserved and untouched by the build.

## 14. Semantics ledger (draft for `ledger/SEMANTICS.md`)

**In** (spec section; source): SLA definitions as records with start/pause/stop/cancel conditions (R4.1; A16 [doc]);
resume when the pause stops matching (R4.2; A16); cancel when start stops matching or on a condition (R4.2; A16); reset
= cancel then start a new SLA (R4.2; A16); retroactive start from a record field and retroactive pause (R4.3; A16);
schedule from the definition, a record field or none (R4.3; A16); time zone by source precedence (R4.3; A16, 3 of 5
sources); breach and percentage escalations (R4.6, R5; E-BED §3 E7); 9-cell impact × urgency priority (R2.2; E-BED
§3 E7); awaiting-caller pause, auto-close on no reply, resolved → closed (R6; bar); reassignment (R3.2; bar);
duplicate alerts as one incident (R1.2; E-BED W1); major-incident approval with a deadline (R7; bar); business
calendars, holidays, DST (R4.4; CATALOGUE §4 item 1); effective-dated editions (R0; E-BED §2.6); go-live backlog
(§3.6; contract §3.5).

**Out**: problems, changes, CAB approvals, change conflicts and the WorkArena schedule validator (slice 2); reopening
a resolved incident; user-specified and relative SLA durations (A16); the "task location" and "system" time-zone
sources (A16; our definition zone plays the system's role); resume on its own condition; reset on arbitrary
conditions; major-incident case management beyond approval (E-BED §2.11, G11); knowledge, problem and change links;
BPIC 2014 calibration [unavail: log not acquired]; vendor product state names [unavail].

## 15. Deviations from E-BED §3 E7 (for review)

- Incidents only (slice 1): no problems (10 at d2), no changes (20 at d2, 80 at d5), no CAB, no conflict set, no
  `no-conflict-check` / `cancel-in-review` controls, no WorkArena goldens (they validate change schedules) and no d4
  blackout policy; all move to slice 2.
- Minute resolution instead of hours (E7-2). Sizes: d2 60 instead of 100 incidents, d5 250 instead of 1,000 (the 1,000
  sits at the scale tier); measured against the E8 per-world time budget.
- d5 "CMDB rename" is an F5 rename of `itsm.create` `ci`; "state enum extension" is a new hold reason.
- Candidate defects of E-BED ("awaiting-caller does not pause; 24×7 where a schedule is named; retroactive start ignored
  on reassignment; blackout conflicts ignored") become necessity controls and mutants here; latent defects are mined
  later by the executed E0-silence check (E-BED §2.10). "Retroactive start ignored on reassignment" is read as the
  reset/re-attach construct (E7-9), since reassignment restarts the response SLA rather than the resolution SLA.
- ERPNext's SLA doctype (GPL-3.0) is a possible read-only semantics cross-check for the N-version step; nothing is
  copied, and it was not opened for this design.

## 16. Slice-2 extension points

`itsm.problems`, `itsm.changes`, `itsm.approvals` and their ops; human-task kind `changeApproval` (CAB) beside
`majorIncidentApproval`; rules continue at R9 (problems) and R12 (changes) so R0–R8 never renumber; definitions gain
`appliesTo`; lids are prefixed by object number (`INC-…`, later `PRB-…`, `CHG-…`); the world adds change windows and
blackouts to the same calendars; WorkArena's change-schedule validator ports into `golden.mjs` with the ±5% reading
recorded as WorkArena task policy (E-BED §2.5).

## 17. Risks and open questions

1. Spec size is about 9K tokens, above the 8K constructor cap: arm (g) needs hierarchical construction with section
   retrieval (E-BED §2.5), as for E8 (6K).
2. 15-minute windows and the fixed `+01:00` platform offset are realistic but harder than E8 for agent arms; both are
   stated in the spec and pinned by goldens; the specificity solvers (one acting late, at +12 min) test that they are
   fair.
3. Readings that are ours, not documented (E7-9, E7-10, E7-11, S10): an owner reviewing one rulebook (E-BED §11) should
   look at R4.2 and S5–S7 first.
4. Performance: the SLA engine re-runs at every processing point; memoisation per (case, history digest) is required
   to stay near E8's 6–11 s per d5 world.
5. Node's ICU zone data must agree with the pinned table for these zones in 2026 (checked by the N-version suite
   itself; a disagreement there is a finding about one of the two clocks, resolved by the published rules).

## 18. Build order (all $0)

1. `systems.mjs`, `world.mjs` (+ timing self-check), `actors.mjs`; health of the world alone.
2. `sla.mjs` with goldens G2–G15 as unit tests first, then the N-version minute stepper.
3. `transition.mjs`, `index.mjs`; both reference runs on dev 1001–1030 (health, censoring).
4. `controls.mjs`, the remaining goldens, leak, replay, twins; `tools/`.
5. Mutation score ≥ 0.95; then a separate session writes the three blind solvers (`specificity/`: event-sourced
   recompute; incremental clocks in carry acting at +7 min; minute-stepping calendar acting at +12 min) and K1
   specificity runs on 16+ worlds per difficulty. Only then is E7 a candidate for paid arms.
