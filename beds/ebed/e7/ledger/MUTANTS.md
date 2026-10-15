# E7 oracle mutants: 679 mutants, one standard

Development and diagnostic evidence ($0, no model calls, 2026-10-15). The tool is `tools/mutate.mjs`, ported from
E8's (`beds/ebed/e8/tools/mutate.mjs`). Its mutants come from the two oracle modules: `transition.mjs` (ids t1–t483,
sha256 `05c6609dde239584…`) and its SLA engine `sla.mjs` (ids e1–e196, sha256 `17b1b07c334120aa…`). Neither module was
changed by this review. The measured run is `ledger/mutation-20261015.json`.

**In short.** The first measured run (run 1) used 29 goldens: the item's 28, plus the instants golden written first in this review. It killed 504 of 679. Its 175 survivors
were triaged one by one: 45 were killable, 128 are grader-equivalent and 2 are uncertain. One of the killable, t66, was
first triaged as equivalent and was corrected when the final run killed it (§4). The killable ones got 25 new goldens,
each asserting a spec-stated outcome the grader sees. The final run with the 54 goldens: FINAL_LINE.

| formula | value |
|---|---|
| raw (killed / all) | FINAL_RAW |
| E-BED §9.5 (killed / (all − equivalent)) | FINAL_EXCL |
| run 1 (29 goldens), raw | 504 / 679 = 0.742 |

The raw formula cannot reach K1 (0.95) while the 128 equivalents stay in the operator set, as for E8 (whether K1
counts equivalents in the denominator is the owner's decision). Under the second formula, which is the one E-BED §9.5
uses ("each survivor is equivalent or gets a new golden"), only the two uncertain mutants are left (§4).

## 0. The standard (one, for every mutant)

**What is compared.** The original and the mutant oracle are compared on what the shared grader reports
(`oracle/grade.mjs` `gradeCase`):
- for a completed-pool case: its verdict (`pass`), any oracle error, and the first divergence as layer/code/lid (E8's
  key);
- for every case: its critical codes.

The critical codes are part of E7's comparison because `critical()` (index.mjs) reads the transition's own history
(counted answers, moot approvals, the deadline), so a mutant of `transition.mjs` can change them. E8 compared verdicts
only. Three things are not compared: the instant of the first divergence, the detail of a critical, and the verdicts of
censored cases, which no score counts.

The mutant oracle is the whole binding re-imported over the mutant modules (a copy of `index.mjs`), so
`referenceTransition`, `recordsOf`, `canonicalArgs` and `critical` are all the mutant's. E8's H1 (`canonicalArgs` never
swapped in) does not arise.

**Reachable input.** A journal the host can write, for some arm, on some world of E7's world contract.

- **Any arm behaviour, within what the systems accept** (`systems.mjs`):
  - `itsm` checks no transition (R8 is the arm's job). It refuses unknown CIs, services, groups and incidents.
  - `sla` checks the stage, not the order of the `at` values. It accepts a breach or an escalation only for a recorded
    SLA.
  - Instant arguments (`TIME`) are any string of 1–40 characters.
  - The host refuses an effect whose `args` are not an object (an arm error, no ledger row).
- **Host semantics:**
  - Delivery within an instant is by (source, id).
  - A result arrives one minute after its effect.
  - A committed key is deduplicated.
  - F5 renames are mapped back.
- **World contract** (`world.mjs`, DESIGN §4):
  - The rulebook is generated per difficulty. From d4 there are two editions, effective 2026-01-01 and 2026-03-23.
    - `policy.json` and `alert-urgency.json` are identical in both editions.
    - `order` values are unique.
    - Every target × percent / 100 is a whole number.
    - No condition list is empty.
    - Every definition with a `reset` also has `whenStartFails`.
    - Escalations are listed in ascending percent.
    - Priority is monotone in urgency.
  - Which incident a message or an alert belongs to is the world's truth (`truth.eventCase`).
  - A caller's message about an incident comes after its report.
  - Go-live incidents are the four DESIGN §4.6 stages: report-opened, P3/P4, one export record each, nothing at t0
    itself.
  - Resolvers act along R8.2: an accept follows an assignment, and a resolver update comes ≥ 16 min after it.
  - The analyst-only `controlFlags` never occur in a generated world.
- **Inputs the spec states, generated or not.** The generator's class mix is a sample, not a limit (E8's rule), so these
  are reachable even where no generator class produces them:
  - a reply during a hold for another reason (R6.2);
  - updates after the resolution (R3.3);
  - a confirmation or a withdrawal at any time (R6.5, R6.6);
  - two approval tasks in one instant, and a re-ask at the deadline (R7.2);
  - instants written at any offset, or as no instant at all (§1).

**Killed** means one of:
1. a golden that passes the original fails the mutant (goldens assert only spec-stated outcomes the grader sees, §5);
2. the corpus differential shows a different signature on some case (§3);
3. the mutant oracle does not finish (time limit or memory limit), does not load, or throws where the original does not.

E8 also required a searched witness journal for each golden kill. That search was not repeated here. §5 instead says, per
kind of golden assertion, how the grader sees it, and the one invisible assertion found became a unit check.

**Equivalent (grader)** means no reachable input gives a different signature: no golden fails it, the corpus
differential shows 0 differences, and a one-line argument says why. The kinds:

| kind | meaning |
|---|---|
| contract | only inputs outside the world contract or the host semantics separate the two |
| consumed | the grader never reads the difference |
| stopped | the difference arises only after the grader has stopped at an earlier divergence of the same journal |
| code | dead code, the same value, or only slower (cache and memo mutants) |

**Uncertain** means the mutant is separated only by an input whose reachability the spec leaves open (§4).

## 1. Result

FINAL_TABLE

Kills by check in the final run: FINAL_KILLEDBY. Run 1, with 29 goldens, was 385 by goldens, 115 by the corpus and 4 by
the time limit.

Four mutants never terminate and are killed by the time limit or the memory watchdog. Each leaves a deadline in the list
that its firing never removes, so the deadline loop never ends:
- t223 deletes `appr.dl = …`;
- t273 sends a caller deadline into the fail-safe branch;
- t283 sends the approval deadline into the auto-closure branch;
- t291 deletes `appr.declared = D`.

An oracle that never answers cannot grade. The loop also allocates on every turn. A first attempt at the final run was
killed by the kernel at 6.5 GB while running t223, because the worker's old-generation cap did not bound the process.
The tool now has an RSS watchdog in the main thread (§7).

## 2. The mutant set

`mutantsOf()` applies generic per-line operators to every code line of both modules:

| operator | count |
|---|---|
| relational boundary | 38 |
| equality | 168 |
| logic | 118 |
| arithmetic swap, max/min, floor/ceil | 31 |
| window bound (±1 min) | 13 |
| first/last pick | 18 |
| statement deletion | 173 |
| deleted guard (an `if (…) return\|continue\|break` made `if (false)`; input-validation throws are left alone) | 56 |

It adds 64 named semantic operators from E-BED §9.5 and DESIGN §10 (§2.1). Mutants with the same module text are one
mutant: the first operator names it and the others are listed as aliases. One generated edit did not parse and is not a
mutant (`sla.mjs:200`, first/last pick).

The ids are index-stable for these two sources. A source change renumbers everything after the changed line.

### 2.1 The named operators and their fate

| E-BED §9.5 / DESIGN §10 operator | mutant | final |
|---|---|---|
| breach boundary inclusive (S2) | e168 | killed, golden G15 |
| threshold ceil | e169 (generic floor→ceil) | **equivalent (contract)**: every target × percent / 100 is a whole number, so R5.1's rounding is never exercised |
| holidays dropped | e11 | killed, golden G2 |
| zone swapped: the system zone, the calendar's own zone ignored, source precedence reversed | e54, e47, e49 (`.find`→`.findLast` over the sources) | killed, golden G5 (e49: G7) |
| calendar swap: 24×7, service ↔ group schedule | e53, e42, e44 | killed (G2; corpus; G12) |
| pause condition deleted (attach / evaluation) | e56, e106 | killed, goldens G11, G8 |
| pause on any hold | e63 | killed, corpus (ref-earliest@1009:3) |
| retroactive start / retroactive pause dropped | e39, e58 | killed, golden G11 |
| attaches running although its pause holds (S14) | e76 | killed, golden G11b |
| reset dropped (evaluation / attach) | e97, e119 | killed, golden G12 |
| reset re-attach in the old edition (S15) | e103 | killed, **new golden G12c** |
| reset re-attach unconditional (S15) | e105 | **equivalent (contract)**: every definition with a reset has whenStartFails, so the branch only runs with its start holding |
| edition by startAt (S6) | t433, e34 | killed, golden G13 |
| edition by publication | t25 | killed, corpus (ref-earliest@1010:5) |
| edition by run date: priority, definitions | t86, t369 | killed, corpus |
| edition by run date: alert urgency, approval deadline, caller/closure days | t85, t224, t47 | **equivalent (contract)**: `alert-urgency.json` and `policy.json` are identical in both editions (R0 for them is not exercised in slice 1) |
| first-match / highest-order precedence (R2.2, R3.1) | t34, t35, t44, t45 | killed (G1; corpus) |
| D anchored at attach | e55 | killed, golden G11 |
| start record plans the current D / from the attach (S13) | e143, e144 | killed (G8, G11) |
| recipient fixed at attach / the current group / at the threshold (R5.2) | t402, t374, t403 | killed (corpus; corpus; **new golden G30b**) |
| SoD exclusion dropped | t358 | killed, golden G14 |
| dedupe on CI only, join after resolution | t122, t123 | **equivalent (contract)**: which incident an alert joins is the world's truth, and the transition only validates it |
| closure at D (S1) | the `+ SEC` window bounds | killed, golden G9 |
| escalations skipped when reached before the attach (S12) | t400 | killed, corpus |
| R4.2 order: stop before cancel (S5; the analogue of "compensation order reversal") | e89 | killed, **new golden G20c** |
| missing key / record order: not after create, SLA records not in lifecycle order, breach not before the end | t339, t382, t396 | killed (**G29**, **G29**, G15) |
| approval: anchored at the latest P1, re-ask on a timeout, re-ask without a cause, any task's answer counts, answer after the deadline counts | t58, t8, t231, t243, t244 | killed (**G22**, G14b, G14b, G14b); t244 **equivalent (code)**: the fail-safe has always fired before a later answer is processed |
| other engine operators (conditions any/every, null vs missing field, generation count, cancel reasons, 100% apart from D, thresholds after the end, elapsed counts paused time) | e7, e2, e37, e90, e94, e171, e179, e185 | killed, except e2, e171 and e179: **equivalent (code)** |

## 3. The corpus differential

The corpus is 93 journals on four dev worlds (dev seeds 1001–1199 only; the tool refuses others):
- worlds 1009:d3, 1010:d5, 1011:d4 and 1012:d2, each with size 60;
- 275 cases in all;
- per world: both reference runs, every control applicable at that difficulty (18–19), and the three solvers under
  `specificity/`. The solvers run out of process in the sandbox arm.

The solvers are s1, s2 and s3 at sha256 `471bf324…`, `6609dc42…` and `134b6749…`. They are blind drafts by another
session and were still being edited (2026-10-15); the corpus key records their hashes.

Grading is per case. A case's journal content, as the grader reads it (`idx.bucket(c)`: deliveries, ledger rows, tasks,
task events, and calls reduced to outcome, decisions and whether they emitted anything), is identical across journals
up to sequence numbering and instance names. Such a case is graded once, since its grade is a function of that content.
6,402 case gradings reduce to **4,976 distinct case contents**. A full pass of the original takes 10–16 s; a surviving
mutant needs one pass, or about 250 s when the mutant disables a cache. The ledger args are run through the oracle's own
`canonicalArgs`: the original's once, and a mutant's own for mutants of `utc`/`canonicalArgs`.

Run 1's 115 corpus kills first differed on:
- `ref-earliest`: 108;
- `first-match-priority`: 3;
- `timer-first`: 2;
- `echo`: 1;
- `s3.mjs`: 1.

By first-differing signature:
- layer-5 records: 46;
- outside-allowed: 24;
- missed: 20;
- oracle error: 11;
- decision: 8. One of them, t49, differs only in its critical code: `historyOf` returning null for every incident sends
  `critical()` to its rows-only fallback, so a `major-without-approval` disappears.
- over/under-escalation: 3;
- order: 1;
- a passing case left open: 1;
- grading threw: 1.

## 4. Run 1's 175 survivors, triaged

Every survivor of run 1 is either killed by a new golden (45, named in the evidence column, final run) or equivalent
(128) or uncertain (2). For equivalents the corpus figure is from the final run. Lines are the current sources';
`tr` is transition.mjs.

FINAL_SURVIVORS

The two uncertain mutants, t185 and t188, need an owner reading. Both are separated only by a resolver `hold` that
arrives while the incident is already on hold awaiting the caller (another reason, then a reply).
- R3.2 says to record a hold for any update about an incident that is not resolved.
- R8.2 lists no `onHold → onHold` transition.
- No generator class produces one: `hold-change` is a new reason from `inProgress`.

If such a hold is reachable, both mutants are killable (the reply must change nothing, and VND-HOLD must stop at the
reply). If it is not, both are contract equivalents.

## 5. Goldens: added, changed, and what the grader sees of them

**Changed.**
- The records golden's last clause (`recordsOf` of a case with no incident is null) is something the grader never
  asks: it compares records only when the expectation has them, and a stray case's expectation never does. The clause
  alone killed t437 and t438. It is now the unit check `recordsOf gives no records for a case with no incident`
  (test/e7.test.mjs), and t437 and t438 are equivalent (consumed).
- `runGoldens(transition, recordsOf, canonicalArgs)` now passes the item's `canonicalArgs`, which decides what every
  instant an arm writes matches.
- Each golden view now has its own case id (`golden:<incident>`). The transition memoises SLA timelines per (case,
  field history), and two goldens replaying one field history for different incidents (G11/G29, G20/G20b) shared the
  memo entry under the old common id `golden`. In grading a case is one incident, so the oracle is unaffected; only the
  golden harness was.

**Added (26).** Each was derived by hand from the rules and checked against the original oracle before the final
run. Each kills the mutants named.

| golden | rule | asserts | kills |
|---|---|---|---|
| instants compared as instants, whatever their offset | §1 Time, R4.5 | `canonicalArgs`: an instant at any offset, with or without seconds or milliseconds, is the same instant; a time without an offset or no valid date is compared as written; other arguments as written | t13–t16, t18 |
| G22 approval anchored where the priority first became 1 | R7.1, R2.3 | a reclassification that keeps P1 records the impact change and does not move the task window | t58, t159, t163 |
| G14d an approval is moot from the first instant it is moot | R7.3, S11 | a later change of an ended incident does not move the moot instant | t66, t67 |
| G14e a re-ask at the deadline counts | R7.2, S1 | a re-ask and its approve at the deadline count | t225 |
| G14f a closure at the caller deadline makes a pending approval moot | R6.3, R7.3 | no declaration after the closure | t281, t304 |
| G14g a declaration at the deadline comes before later events and deadlines | R7.2, R6.3, R4.5, S14 | (d4) RES-MAJOR attaches at the fail-safe, paused since the hold, resumes at a later reply; with no reply it stops at the later caller deadline | t272, t302–t304 |
| G14h approval tasks at the moot instant, re-ask windows and leftover causes | R7.2, R7.3, S11 | a task taken in the moot instant stays required; a cause at the deadline opens a re-ask; no re-ask after a counted answer; the window opens at the first unused cause | t351, t359, t366, t368 |
| G14i an SLA attached by the fail-safe declaration, breached at its attach | R4.5, R5.1, S10, S12 | (d4) its breach and notices are records of the declaration: (x, x + 15] | t386, t406 |
| G16b a joining alert delivered again changes nothing | R1.3, R1.4 | one link, its window from the first delivery | t124 |
| G25 updates about a resolved incident change nothing | R3.3 | no accept or assignment after the resolution | t134, t135 |
| G26 a reassignment clears the assignee | R3.2, R8.1 | the record after a reassignment and a withdrawal has no assignee | t155 |
| G27 a reclassification records any change and nothing else | R2.3, R0 | urgency change with the same priority is recorded; no change is not; (d4) the same values in a new edition with a new priority are recorded, and the decision follows | t160, t161, t164, t312 |
| G28 a reply during a hold for another reason changes nothing | R6.2 | no resume | t184 |
| G10b a confirmation at D2 counts; one before the resolution changes nothing | R6.5, S1 | closed `confirmed` at D2 | t193 |
| G18b a withdrawal after the resolution changes nothing | R6.6 | no cancellation, the auto-closure stays due | t204 |
| G9c nothing is closed at the deadline instant itself | R6.3, S1, R4.5 | at D the closure is due in (D, D + 60] and the closure's SLA records are not yet named | t299 |
| G9d an event and the caller deadline in one instant | R4.5, R6.3, S10 | the closure's SLA record keeps the deadline window to D + 60 | t321, t325, t326 |
| G29 records after the create, an SLA's records in lifecycle order | R8.2, R4.5, R8.1 | `after` lists | t337, t339, t382, t383 |
| G30 an escalation due at a reassignment goes to the new group | R5.2, S5 | recipient read after the instant's changes | t370 |
| G30b a notice reached before the attach goes to the group at the attach | R5.2, S12 | recipient when the notice becomes due | t403 |
| G31 the record of an SLA paused twice | R8.1 | expected record lists both pauses closed | t423, t424 |
| G31b the record replayed from an SLA paused twice | R8.1 | the arm's record (`recordsOf`) closes each pause at its resume | t466 |
| G20b the changes of one instant are applied together | R4.2, S5 | no resume before a same-instant cancel | t429 |
| G20c cancel before stop in one instant | R4.2, S5 | `start-failed` cancel, not a stop | e89 |
| G12b a reset re-attaches its own definition only | R4.2, R4.3 | no second RES-P1 at an RSP-HI reset | e101 |
| G12c a reset re-attaches in the edition of the reset | R4.2, S15, R0 | (d4) RSP-STD gen 2 plans with edition 2's 120 min | e103 |

**What the grader sees of a golden assertion.** These are the only kinds of assertion the goldens make:
- a required lid with its `match` (an arm's row with another value is outside-allowed);
- a window bound (early, late or missed at the boundary);
- an `after` list (the order check on committed rows, §0: the sla system does not order `at` values);
- whether a lid is named at a view (a row there is matched, outside-allowed or early);
- `decisions.graded` (layer 1 on graded case-ticks);
- required and permitted human tasks (layer 4, over-escalation);
- `terminal` and `records` at a complete case (layer 5);
- `canonicalArgs` (it decides every instant match).

Three new goldens rest on a narrow witness, and are named here so a reviewer can weigh them:
- **G9c (t299):** under both oracles a row written at the deadline instant itself is an error. The mutant only changes
  its code, from outside-allowed to early.
- **G14h (a) (t351):** the witness is a second approval task in the moot instant, which the original rejects as an
  extra task.
- **The instants golden:** its "a time without an offset names no instant" reading. §1 allows any offset, and the
  original also keeps the verdict independent of the machine's zone.

## 6. Findings for the owner

1. **R0 is not exercised for `policy.json` or `alert-urgency.json`.** Both editions carry the same files, so "the
   policy at the instant its clock starts" (R0, R6, R7.2) cannot be told apart from any other edition. Four mutants are
   contract equivalents for this reason: t22 (the system zone from the last edition), t47, t85 and t224. A changed value in edition 2,
   for example `majorApprovalMinutes` or `resolvedCloseDays`, would make them killable. That is a world change, so it is
   not made here.
2. **R5.1's rounding is not exercised.** Every target × percent / 100 is a whole number, so DESIGN §10's "threshold
   ceil" operator is a contract equivalent (e169).
3. **S15's empty condition list is not exercised** (e3). No rulebook has one.
4. **The hold during a hold** (t185, t188, §4) needs a reading: R3.2 against R8.2.
5. **The control switches** `controlFlags.breachAtPlannedPause` and `controlFlags.editionAtStart` live in the oracle's
   engine. 17 mutants inside them are contract equivalents (e30, e31, e33, e152, e154–e163, e172), because no
   generated world carries the flags. Moving the switches to `controls.mjs` would shrink the operator set without
   losing anything.
6. **Corpus coverage.** 45 killable mutants survived the four-world corpus. Every one of them needs an input that is in
   the spec but not in the generator's class mix, or a same-instant coincidence: replies during vendor holds, updates
   after the resolution, a P1 reached during a hold, two deadlines between two events, a reset across the edition
   switch. The goldens now cover them; the generator's tail classes do not.

## 7. Reproducing

```sh
node beds/ebed/e7/tools/mutate.mjs --list                                   # the 679 mutants, by operator
node beds/ebed/e7/tools/mutate.mjs --json out.json                          # goldens, then the corpus (~65 min, 1 core)
node beds/ebed/e7/tools/mutate.mjs --only t185,t188 --json out.json         # some mutants (the corpus is cached)
node beds/ebed/e7/tools/mutate.mjs --golden-only                            # the goldens alone (~3 min)
```

The corpus is built on first use (about 3 minutes) and cached under `.foundry/e7-mutate/corpus/<key>/`, which is
ignored by git. The key hashes the world specs, the oracle sources and the solvers.

Each mutant runs in a worker thread with these limits: 30 s for the goldens, ≥ 20 min for the corpus (the
cache-disabling mutants take about 250 s), and a 1.5 GB old generation. The main thread also runs a process-RSS
watchdog at 2.5 GB, against a normal peak of about 0.85 GB. A worker is replaced every 30 mutants. A worker that dies,
or is stopped by the watchdog, after earlier mutants gets one retry in a fresh worker. `--tag` keeps a run's results
file apart.
Results stream to `.foundry/e7-mutate/results-<run>.jsonl`, and `--resume` continues an interrupted run.

Before any mutant, the run checks itself: the original oracle re-imported through the mutant machinery must pass every
golden and show 0 corpus differences. It did, in 0 differences out of 4,976.

`ledger/mutation-20261015.json` is the final run, compacted to one row per mutant: verdict, killer, and the corpus's
first differing case with both signatures.
