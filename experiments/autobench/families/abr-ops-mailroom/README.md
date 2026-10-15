# abr-ops-mailroom: mailroom package notifications (AutomationBench-R family 6)

**Status (2026-10-15).** Development, $0. The generator, oracle, observable-only reference workflow, 15 bad controls,
the validity gates and the tests are built. No arm has run and no model was called. Nothing here is a capability
result. Design: [RECURRING-DESIGN.md §4.6](../../../../research/automationbench-20261014/RECURRING-DESIGN.md).
Proposed split: **held-out (near)**. Under RECURRING-DESIGN §3.9 its dev streams 610–613 are therefore for harness
rehearsal only and never feed router fitting.

## What it is

A standing automation, like a Zap, that the Facilities owner writes once ([POLICY.md](POLICY.md)) and that runs on
every trigger of a recurring family. One stream is one simulated business week, Monday to Friday, of 41–55 triggers.
The world carries over from trigger to trigger: held packages wait in the sheet's Status column until a later trigger
releases them, and the daily total is counted from the `#mailroom` history.

| Trigger (`kind`) | Arm-visible payload | Correct handling |
|---|---|---|
| `package.received` (33–45/week) | `google_sheets` / `new_row`: the new Incoming Packages row (number and cells) | First rule that applies. `returned to sender`: nothing at all. Recipient = the directory row with the same Name **and** Department; none, or Terminated: Status `Skipped`. On Leave: `Held - On Leave`. Notes say `customs hold`: `Held - Customs`. Otherwise post `<TRK> → <Floor n \| Loading Dock B if oversized> (<Name>, <Dept>)` in #mailroom, SMS `Package <TRK> ready at <location>` for Refrigerated or Hazardous, Status `Routed` |
| `customs.cleared` (2–4/week) | `google_sheets` / `row_updated`: row number, `changed: ["Notes"]`, the tracking number and the new Notes | If the row is `Held - Customs` and its Notes no longer say customs hold: decide it again (usually route). Otherwise nothing |
| `employee.returned` (1–2/week) | `google_sheets` / `row_updated` on the Employee Directory: Name, Department, `Status: Active` | Decide again exactly that person's `Held - On Leave` packages (same name **and** department) |
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
| [controls.py](controls.py) | 15 bad controls (below) |
| [harness.py](harness.py) | `$0` stream runner: applies each delta, calls the tools through `bridge.Rollout.batch` (the official `env_response` path with the determinism shim, clock = trigger time), grades every trigger; carry and rebased modes |
| [gates.py](gates.py) | The $0 validity gates of RECURRING-DESIGN §3.11 |
| [tests/test_mailroom.py](tests/test_mailroom.py) | pytest suite |

## Commands

All of these run inside AutomationBench's own venv (`uv sync` in `corpus/AutomationBench`, pinned by its `uv.lock`):

```
PY="corpus/AutomationBench/.venv/bin/python -I -B"
F=experiments/autobench/families/abr-ops-mailroom
$PY $F/gen.py --seed 610 --out HOSTDIR                                # host-only stream files
$PY $F/harness.py run --solver reference --seeds 601-614 [--mode rebased] [--failures]
$PY $F/harness.py run --solver no-dock --seeds 610-614
$PY $F/gates.py [--seeds 610-614] [--out DIR]                         # exit 0 only when every gate passes
$PY -m pytest -q -p no:cacheprovider $F/tests
```

## Traps

Each trap is recorded per trigger in the host-only truth (labels computed by the simulation from the situation, not
copied from the plan). Every trap is resolvable from `POLICY.md` and the tools.

| Kind | Labels | Where | Resolved by |
|---|---|---|---|
| T-lookalike | `lookalike`, `wrong-dept`, `release-lookalike` | Same name in two or three departments, with different floors and phones; a name that exists only in another department; at d3 the returning employee's namesake is also On Leave with a held package | Name **and** Department; "do not touch ... someone with the same name in another department" |
| T-note | `terminated`, `on-leave`, `customs`, `returned`, `not-found`, `notes-variant`, `notes-decoy`, `precedence`, `still-held`, `not-held`, `requeue` | Terminated vs On Leave (sometimes with an Active namesake); keyword casing (`CUSTOMS HOLD`, `Returned To Sender`, `OVERSIZED pallet`); decoys that do not contain a keyword (`Return to sender if undeliverable`, `cleared customs at port of entry`, `return label enclosed`, `large box`); On Leave plus customs hold; a Notes update that still says customs hold; customs cleared on a package that is Held - On Leave or Skipped; back from leave but still in customs | The first-rule-that-applies order; "contain ... (any letter case)"; "if its Status is Held - Customs and ... no longer contain" |
| T-format | `oversized`, `oversized-sms` | Oversized notes, alone or with a Refrigerated/Hazardous type (also on packages released from customs) | Loading Dock B in the post **and** the SMS |
| T-repeat | `returned-rescan` | A returned package scanned again under a tracking number already routed | Rule 1: nothing at all; the old row stays as it is |
| T-state | `release`, `back-from-leave`, `count-noise`, `count-release` | Hold releases; a package for someone back this week; human chatter in #mailroom; releases routed that day | Section 4; the count is routing posts dated that day, releases included |

Measured share of triggers carrying a trap, over seeds 601–650: **0.357 at d2 and 0.602 at d3** (design: 35% and
60%); share of package triggers with a planted trap 0.24 and 0.55. d1 (smoke only) plants none on packages.

## What the oracle checks

Per trigger, on the effect ledger (world before vs after the trigger):
- each expected Status change on the right row (by record id), with no other cell or row field changed;
- each expected #mailroom post and SMS with the exact text (whitespace collapsed, a trailing period tolerated) and,
  for SMS, the exact number;
- the envelope: nothing else created, changed or removed in any app;
- AutomationBench's own handlers (`twilio_sms_sent` / `_not_sent` including the namesake's phone,
  `slack_message_exists` / `_not_exists`, `google_sheets_row_exists`) on an attribution view that holds only this
  trigger's messages, SMS and rows, so an earlier post never counts again.

At Friday's close it adds the end state: every package row's final Status and unchanged other cells, no row added or
removed, the directory and policy sheet unchanged except for the week's own deltas, the week's #mailroom messages and
SMS as multisets, no pre-existing message or SMS edited, and AutomationBench's `slack_text_occurrence_count` per
routed tracking number and `twilio_message_count` per notified phone on the whole world.

Outcomes are `correct`, `abstained` (only #automation-review posts, no escalation expected: no credit, no
wrong-answer penalty), `miss` (no effects although some were expected) or `wrong`. `pass` includes the envelope;
`pass_core` is reported beside it.

## Numbers [measured, $0, development evidence]

NUMBERS_PLACEHOLDER

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
