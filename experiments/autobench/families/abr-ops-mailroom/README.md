# abr-ops-mailroom: mailroom package notifications (AutomationBench-R family 6)

**Status (2026-10-21, v1.1.0).** Development, $0. The generator, oracle, observable-only reference workflow, 23 bad
controls, the validity gates and the tests are built; v1.1.0 fixes the six defects of the 2026-10-21 review (see
[Review fixes](#review-fixes-2026-10-21-v110)). No arm has run and no model was called. Nothing here is a capability
result. Design: [RECURRING-DESIGN.md §4.6](../../../../research/automationbench-20261014/RECURRING-DESIGN.md).
Proposed split: **held-out (near)**. Under RECURRING-DESIGN §3.9 its dev streams 610–613 are therefore for harness
rehearsal only and never feed router fitting.

## What it is

A standing automation, like a Zap, that the Facilities owner writes once ([POLICY.md](POLICY.md)) and that runs on
every trigger of a recurring family. One stream is one simulated business week, Monday to Friday, of 42–59 triggers.
The world carries over from trigger to trigger: held packages wait in the sheet's Status column until a later trigger
releases them, a Routed or Skipped package is never decided again (only the Status column says which is which), and
the daily total is counted from the `#mailroom` history.

| Trigger (`kind`) | Arm-visible payload | Correct handling |
|---|---|---|
| `package.received` (32–45/week) | `google_sheets` / `new_row`: the new Incoming Packages row (number and cells) | First rule that applies. `returned to sender`: nothing at all. Recipient = the directory row with the same Name **and** Department (case and spaces ignored); none, or Terminated: Status `Skipped`; two such rows (d3): escalate in #automation-review. On Leave: `Held - On Leave`. Notes say `customs hold`: `Held - Customs`. Otherwise post `<TRK> → <Floor n \| Loading Dock B if oversized> (<Name>, <Dept>)` (directory spelling) as a top-level #mailroom message, SMS `Package <TRK> ready at <location>` From `+15550100200` for Refrigerated or Hazardous (any case), Status `Routed` |
| `customs.cleared` (2–4/week) | `google_sheets` / `row_updated`: row number, `changed: ["Notes"]`, the tracking number and the new Notes | If the row is `Held - Customs` and its Notes no longer say customs hold: decide it again (usually route). Otherwise nothing |
| `employee.returned` (1–2/week) | `google_sheets` / `row_updated` on the Employee Directory: Name, Department, `Status: Active` | Decide again exactly that person's `Held - On Leave` packages (same name **and** department), never their Routed one |
| `package.updated` (1–4/week) | `google_sheets` / `row_updated`: row number, `changed` (`Notes`, `Department` or `Package Type`), the tracking number and the changed cell | Nothing: the package is not `Held - Customs` (Routed, or Skipped with a recipient who is now Active), or a column other than Notes changed |
| `day.close` (5/week, 17:00 UTC) | `schedule` / `day_close`: the date | Post `Routed today: <N>`, N = that day's routing posts in #mailroom. Friday's is the last trigger and carries the end-of-week grading |

All worlds, policies and noise are our own fictional text: invented names, phones in the 555-01xx fiction range,
`company.example.com`. AutomationBench supplies the app schemas (`WorldState`), the `api_fetch` routing and the
assertion handlers, which are used unchanged.

## Grounded on (AutomationBench public set, commit `4a8e106`)

| Task | Span | What it contributes |
|---|---|---|
| `operations.mailroom_package_routing` | `automationbench/domains/operations/tasks.py:26859-27234` | The three sheets (Incoming Packages, Employee Directory, Mailroom Policies); match on Name **and** Department (two Alex Riveras); SMS with the tracking number and pickup location for Refrigerated or Hazardous only; former employees (not found) and Terminated skipped; On Leave held, "not the same as terminated"; `customs hold` blocks routing and SMS; `RETURNED TO SENDER` excluded from everything; `oversized` goes to Loading Dock B and the SMS names it; a routing post in #mailroom |

What the adaptation changes ([D]): the raw task is one batch of eight packages handled once. Here each package is its
own trigger, holds **end** (customs cleared, employee back from leave) and must be released exactly, the per-batch
summary becomes a daily `Routed today: N` counted from the channel history, a Status column records each decision
(the state of record), and a returned package can arrive again under a tracking number already routed.

## Class hypothesis [I, written before any label]

**Either, slider-sensitive.** Most triggers are one sheet read, one directory lookup and one to three exact writes,
which a per-trigger Haiku agent should mostly get right; the failures should concentrate on cross-trigger state
(releases, the daily count over the channel history) and on the name-plus-department and note-wording traps.
Expected `agent-H` about 0.85–0.95 per trigger. A workflow built once should match that at a fraction of the
per-trigger cost at about 50 triggers a week, so the label should flip with V and N: agent at N = 1, workflow at
N = 160 when V is small relative to a session's cost. The plausible one-defect controls below score 0.92–0.98 per
trigger, which is the same band: a single misread rule costs only a few triggers a week, so clean weeks, not the
per-trigger rate, separate careful from careless handling.

## Files

| File | Role |
|---|---|
| [POLICY.md](POLICY.md) | The standing policy every arm gets (frozen text for v1.0.0) |
| [family.json](family.json) | Id, apps, envelope, trigger kinds and rates per difficulty, trap catalogue, need job, hypothesis, split, seeds |
| [gen.py](gen.py) | Seeded generator: `world0` (validated as `WorldState`, round-tripped), arm-visible `payloads`, host-only `triggers` (payload + delta + traps), `truth`, `end`, one `serve-inputs` row per trigger (`assertions: []`), `meta` with sha256. `random.Random(f"{family}:{version}:{seed}:{difficulty}")`, no wall clock. The truth comes from its own canonical model (`Gen.simulate`), never from an arm. Refuses seeds outside 601–650 |
| [oracle.py](oracle.py) | Per-trigger grader: effect ledger from `world_before` / `world_after` (attribution), exact effects, envelope (nothing else written), AutomationBench's own `AssertionRegistry` on an attribution view, and the end-of-week state at Friday's close. Outcomes: correct, abstained, miss, wrong |
| [reference.py](reference.py) | Reference workflow: author-written code, no model, standard library only. It sees only the payload, the policy constants and the tools (`ctx.fetch` → `api_fetch`), keeps no private state, and imports no host module |
| [controls.py](controls.py) | 23 bad controls (below) |
| [harness.py](harness.py) | `$0` stream runner: applies each delta, calls the tools through `bridge.Rollout.batch` (the official `env_response` path with the determinism shim, clock = trigger time), grades every trigger; carry, rebased and `both` (per-trigger rate from rebased, clean weeks from carry) |
| [gates.py](gates.py) | The $0 validity gates of RECURRING-DESIGN §3.11 |
| [tests/test_mailroom.py](tests/test_mailroom.py) | pytest suite |

## Commands

All of these run inside AutomationBench's own venv (`uv sync` in `corpus/AutomationBench`, pinned by its `uv.lock`):

```
PY="corpus/AutomationBench/.venv/bin/python -I -B"
F=experiments/autobench/families/abr-ops-mailroom
$PY $F/gen.py --seed 610 --out HOSTDIR                                # host-only stream files
$PY $F/harness.py run --solver reference --seeds 601-614 [--mode both|carry|rebased] [--failures]   # default both
$PY $F/harness.py run --solver no-dock --seeds 610-614
$PY $F/gates.py [--seeds 610-614] [--out DIR]                         # exit 0 only when every gate passes
$PY -m pytest -q -p no:cacheprovider $F/tests
```

## Traps

Each trap is recorded per trigger in the host-only truth (labels computed by the simulation from the situation, not
copied from the plan). Every trap is resolvable from `POLICY.md` and the tools.

| Kind | Labels | Where | Resolved by |
|---|---|---|---|
| T-lookalike | `lookalike`, `wrong-dept`, `release-lookalike`, `spelling`, `ambiguous` | Same name in two or three departments, with different floors and phones; a name that exists only in another department; at d3 the returning employee's namesake is also On Leave with a held package; the package writes Name or Department in another case or spacing (` alex  rivera `, `engineering`); at d3 one person is on two directory rows (same name and department, other floor and phone) | Name **and** Department "ignoring letter case and extra spaces"; the post uses the directory spelling; "do not touch ... someone with the same name in another department"; "If more than one row matches ... section 6" |
| T-note | `terminated`, `on-leave`, `customs`, `returned`, `not-found`, `notes-variant`, `notes-decoy`, `precedence`, `still-held`, `not-held`, `requeue`, `type-variant` | Terminated vs On Leave (sometimes with an Active namesake); keyword casing (`CUSTOMS HOLD`, `Returned To Sender`, `OVERSIZED pallet`); decoys that do not contain a keyword (`Return to sender if undeliverable`, `cleared customs at port of entry`, `return label enclosed`, `large box`); On Leave plus customs hold; a Notes update that still says customs hold; customs cleared on a package that is Held - On Leave or Skipped; back from leave but still in customs; a Package Type `refrigerated` / ` HAZARDOUS` | The first-rule-that-applies order; "contain ... (any letter case)"; "if its Status is Held - Customs and ... no longer contain"; Package Type "ignoring letter case and extra spaces" |
| T-format | `oversized`, `oversized-sms` | Oversized notes, alone or with a Refrigerated/Hazardous type (also on packages released from customs) | Loading Dock B in the post **and** the SMS |
| T-repeat | `returned-rescan` | A returned package scanned again under a tracking number already routed | Rule 1: nothing at all; the old row stays as it is |
| T-state | `release`, `back-from-leave`, `count-noise`, `count-release`, `already-routed`, `skipped-active`, `other-change` | Hold releases; a package for someone back this week; human chatter in #mailroom; releases routed that day; a note on a Routed package (a delivery note, or at d3 a second customs note after a release); a returning employee who also has a package Routed before the leave; a note on a Skipped package whose recipient is now Active; a Department correction on a Skipped package or a Package Type relabel on a Routed one | Section 4: only `Held - Customs` rows (on a Notes change) and `Held - On Leave` rows (on a return) are decided again; "Any other row change: do nothing"; the count is routing posts dated that day, releases included |

Measured share of triggers carrying a trap, over seeds 601–650: **0.357 at d2 and 0.602 at d3** (design: 35% and
60%); share of package triggers with a planted trap 0.24 and 0.55. d1 (smoke only) plants none on packages.

## What the oracle checks

Per trigger, on the effect ledger (world before vs after the trigger):
- each expected Status change on the right row (by record id), with no other cell or row field changed;
- each expected #mailroom post with the exact text (whitespace collapsed, a trailing period tolerated) as a
  top-level message (a thread reply is not in `conversations.history`, so it is not a post in the channel);
- each expected SMS with the exact text, the exact To number and the mailroom From number `+15550100200`;
- the escalation, when the truth escalates (d3 `ambiguous`): a #automation-review post naming the trigger id;
- the envelope: nothing else created, changed or removed in any app;
- AutomationBench's own handlers (`twilio_sms_sent` with `from_number` / `_not_sent` including the namesake's phone,
  `slack_message_exists` / `_not_exists`, `google_sheets_row_exists`) on an attribution view that holds only this
  trigger's messages, SMS and rows, so an earlier post never counts again.

At Friday's close it adds the end state: every package row's final Status and unchanged other cells, no row added or
removed, the directory and policy sheet unchanged except for the week's own deltas, the week's top-level #mailroom
messages and SMS (To, From, body) as multisets, no pre-existing message or SMS edited, and AutomationBench's `slack_text_occurrence_count` per
routed tracking number and `twilio_message_count` per notified phone on the whole world.

Outcomes are `correct`, `abstained` (only #automation-review posts, no escalation expected: no credit, no
wrong-answer penalty), `miss` (no effects although some were expected) or `wrong`. `pass` includes the envelope;
`pass_core` is reported beside it.

**Which number is which.** The truth of a trigger is a snapshot of the correct history. In carry mode one earlier miss
therefore also fails later triggers that depend on it (that day's `day.close`, a later release) even when the solver
acts correctly on its own world, so the carry per-trigger rate counts one error several times. The per-trigger rate
is the **rebased** rate (each trigger graded once, on the world it should have seen); **clean weeks** come from
**carry**; the carry per-trigger rate is reported beside them with `inherited` (triggers that fail in carry but pass
rebased). `harness.py run --mode both` (the default) and the controls gate report exactly that; `family.json`
`grading` records it.

## Numbers [measured, $0, development evidence]

These come from `gates.py` (dev seeds 610–614 unless stated; exit 0, every gate passes) and `harness.py`, on
2026-10-15. Dev seeds: 610, 612, 614 at d2 and 611, 613 at d3; 243 triggers (45, 51, 47, 55, 45 per week).

**Reference** (observable-only code):
- **243/243 triggers and 5/5 clean weeks** on the five dev streams, carry mode; 243/243 rebased;
- 2,426/2,426 triggers and 50/50 clean weeks on seeds 601–650 (practice, dev, top-up, rehearsal and reserve blocks);
  678/678 rebased on 601–614;
- 100% on seeds 631–640 forced to d1 (411), d2 (452) and d3 (536);
- at most 10 tool steps per trigger (the official loop allows 49).

**Bad controls** (all fail; carry mode, dev seeds 610–614):

| Control | Triggers passed | Clean weeks | Outcomes |
|---|---|---|---|
| `null` (does nothing) | 19/243 (0.078 = exactly the no-op share) | 0/5 | 224 miss |
| `echo` (payload into #mailroom) | 0/243 | 0/5 | 243 wrong |
| `naive` (19 lines, ignores notes, holds and departments) | 151/243 (0.621); **0.528 at d3** (gate: < 0.60) | 0/5 | 74 wrong, 18 miss |
| `case-notes` | 206/243 (0.848) | 0/5 | |
| `no-release` | 210/243 (0.864) | 0/5 | 18 miss |
| `returned-skip` | 223/243 (0.918) | 0/5 | |
| `no-dock` | 224/243 (0.922) | 0/5 | |
| `sms-floor` | 224/243 (0.922) | 0/5 | |
| `name-only` | 225/243 (0.926) | 1/5 | |
| `count-sheet` | 228/243 (0.938) | 0/5 | |
| `leave-as-skip` | 229/243 (0.942) | 2/5 | |
| `count-all` | 233/243 (0.959) | 0/5 | |
| `no-recheck` | 235/243 (0.967) | 3/5 (needs the d3 requeue) | |
| `customs-first` | 236/243 (0.971) | 3/5 (needs the d3 precedence trap) | |
| `release-by-name` | 237/243 (0.975) | 3/5 (needs the d3 namesake on leave) | |

Each one-defect control fails on at least one trigger carrying the trap its broken rule resolves (a test asserts it).
Several are near the hypothesis band for `agent-H`: one misread rule costs a few triggers a week.

**Other gates:**
- **Determinism and round trip:** two generations give identical sha256 for world0, payloads, triggers, truth and end;
  every `world_t` validates as `WorldState` and survives dump → load → dump.
- **Leakage:** 0 problems on practice and dev streams. A new-package payload is exactly the inserted row; an update
  payload holds only the row's key and changed cells (never a package Status); no truth vocabulary in payloads or
  world0; serve-input rows hold only POLICY.md and the payload with `assertions: []`; the reference imports only
  `json`, `re`, `datetime` and `urllib`.
- **Oracle mutation score: 4,404/4,404 = 1.000** (28 operators on the reference's correct worlds: dropped, duplicated or
  misrouted posts and SMS; wrong floor, dock, name, department, arrow, tracking number, number or count; wrong,
  reverted or reformatted Status; other cells or row formatting edited; another package or the directory edited; an
  appended row; extra #mailroom, SMS or #automation-review writes; a pre-existing message deleted).
- **Specificity: 1,190/1,190** policy-neutral variants accepted (trailing period or newline, Status case, another From
  number, SMS status, bot name), and an equivalent solver that writes the Status through A1 notation and names the
  channel by id passes 243/243.
- **Trap coverage** (labels from the truth, label streams 610–613): T-lookalike 20, T-note 68, T-format 12, T-repeat 9,
  T-state 40; every kind ≥ 5.

**Tests:** `pytest` (48 tests): 48 passed in 97 s.

**Re-verified 2026-10-21** (unchanged code, same commands, $0, development evidence): `gates.py --seeds 610-614` exit 0,
every gate passes with the numbers above (determinism, leakage 0 problems, solvability 678/678 on 601–614 plus 243/243
rebased, controls table identical, trap coverage identical, mutation 4,404/4,404, specificity 1,190/1,190);
`harness.py run --solver reference --seeds 601-650` 2,426/2,426 triggers, 50/50 clean weeks, 0 errors, at most
10 tool steps; `pytest` 48 passed in 188 s.

## Fixed while building (2026-10-15)

- **Leak in update payloads.** A `customs.cleared` payload first carried the whole row, including the Status the
  generator's simulation expected (`Held - Customs`). In carry mode that is the truth's state, not the arm's world:
  an arm that had set a wrong status earlier would be told the right one. The leakage gate caught it on three dev
  triggers. Update payloads now carry only the row's key cells and the changed cells; the package Status, which is
  the arm's own state, never arrives in a payload, and a test asserts it.
- `release-by-name` first re-decided the namesake's package as the namesake's own, which writes the same status and
  leaves no trace. The control now does the realistic wrong thing (hands the namesake's held package to the person
  who returned) and fails.
- Two specificity variants (a padded Status cell, a doubled space inside `Routed today: N`) are rejected by
  AutomationBench's own handlers, which the oracle reuses unchanged; they are not counted as policy-neutral.

## Limits and not done yet

- The reference's rules are literal keyword and equality checks, checked against the generator's own text
  templates. Agreement between two implementations by the same author does not prove the policy reads the same way
  to someone else: the second-reader fairness gate (§3.11 gate 6) still needs a session that did not write the
  family. The decoy `Return to sender if undeliverable` (routed, because the policy keyword is *returned* to sender)
  is the note most likely to be disputed.
- No escalation truth exists in this family: the generator never makes a package undecidable (no duplicate
  directory rows). The escalation clause and the oracle's escalation check are there but unexercised.
- In carry mode an arm that appends rows to Incoming Packages shifts nothing in the generator's deltas, so a later
  package row can share a row number with the arm's stray row; that cascade is the arm's consequence and is graded.
- The stream runner (`stream.mjs`), the bridge commands (`abr-gen`, `abr-apply`, `abr-grade`) and the arms (§3.7–3.8)
  do not exist yet. Here everything runs in one process; model arms will reach the same `env_response` path through
  `bridge.py serve` with the rows `gen.serve_input` writes.
- The seed ledger has no entries for this family; no labelled stream was run.
