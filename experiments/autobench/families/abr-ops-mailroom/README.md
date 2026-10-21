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
(the state of record: a Routed or Skipped package is not decided again when its row changes), and a returned package
can arrive again under a tracking number already routed.

## Class hypothesis [I, written before any label]

**Either, slider-sensitive.** Most triggers are one sheet read, one directory lookup and one to three exact writes,
which a per-trigger Haiku agent should mostly get right; the failures should concentrate on cross-trigger state
(releases, the daily count over the channel history) and on the name-plus-department and note-wording traps.
Expected `agent-H` about 0.85–0.95 per trigger. A workflow built once should match that at a fraction of the
per-trigger cost at about 50 triggers a week, so the label should flip with V and N: agent at N = 1, workflow at
N = 160 when V is small relative to a session's cost. The plausible one-defect controls below score 0.92–0.98 per
trigger, which is the same band: a single misread rule costs only a few triggers a week, so clean weeks, not the
per-trigger rate, separate careful from careless handling.

*Measurement note, 2026-10-21 (not part of the hypothesis):* the per-trigger rate compared with this band is the
rebased rate (see [What the oracle checks](#what-the-oracle-checks)); in v1.1.0 the rule-level one-defect controls
score 0.910–0.992 per trigger rebased (`no-from` 0.731 and `thread-reply` 0.324 break a rule that many triggers use).

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

Measured share of triggers carrying a trap, over seeds 601–650 (v1.1.0): **0.392 at d2 and 0.631 at d3** (design: 35%
and 60%; above it because every `package.updated` trigger is a trap by construction); share of package triggers with a
planted trap 0.24 and 0.55. d1 (smoke only) plants none on packages; its one `package.updated` is a routed-note.

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

v1.1.0, measured 2026-10-21 with `gates.py --seeds 610-614` (exit 0, every gate passes) and `harness.py`. Dev seeds:
610, 612, 614 at d2 and 611, 613 at d3; 256 triggers (46, 55, 47, 58, 50 per week). Per-trigger numbers are rebased,
clean weeks are carry (see [What the oracle checks](#what-the-oracle-checks)).

**Reference** (observable-only code):
- **256/256 triggers and 5/5 clean weeks** on the five dev streams (rebased and carry);
- 2,553/2,553 triggers, 50/50 clean weeks, 0 inherited, 0 errors on seeds 601–650 (`--mode both`); 713/713 carry
  on 601–614 (the solvability gate);
- 100% on seeds 631–640 forced to d1 (420), d2 (460) and d3 (559);
- at most 9 tool steps per trigger (the official loop allows 49).

**Bad controls** (all fail; dev seeds 610–614; per trigger rebased, then carry with its inherited failures):

| Control | Per trigger (rebased) | Clean weeks (carry) | Carry per trigger (inherited) | Outcomes (rebased) |
|---|---|---|---|---|
| `null` (does nothing) | 32/256 (0.125 = exactly the no-op share) | 0/5 | 32 (0) | 224 miss |
| `echo` (payload into #mailroom) | 0/256 | 0/5 | 0 (0) | 256 wrong |
| `thread-reply` | 83/256 (0.324) | 0/5 | 58 (25) | 173 wrong |
| `naive` (19 lines, ignores notes, holds and departments) | 163/256 (0.637); **0.584 at d3** (gate: < 0.60, close; carry 0.531) | 0/5 | 155 (10) | 72 wrong, 21 miss |
| `no-from` | 187/256 (0.731) | 0/5 | 182 (5) | 69 wrong |
| `name-only` | 233/256 (0.910) | 0/5 | 217 (16) | |
| `case-notes` | 233/256 (0.910) | 0/5 | 218 (15) | |
| `no-release` | 235/256 (0.918) | 0/5 | 218 (17) | 21 miss |
| `stateless` | 236/256 (0.922) | 0/5 | 219 (17) | |
| `count-sheet` | 241/256 (0.941) | 0/5 | 239 (2) | |
| `no-dock` | 242/256 (0.945) | 0/5 | 237 (5) | |
| `sms-floor` | 243/256 (0.949) | 0/5 | 238 (5) | |
| `returned-skip` | 243/256 (0.949) | 0/5 | 238 (5) | |
| `nostatus` | 245/256 (0.957) | 0/5 | 232 (13) | |
| `count-all` | 246/256 (0.961) | 0/5 | 244 (2) | |
| `leave-as-skip` | 247/256 (0.965) | 2/5 | 242 (5) | |
| `exact-match` | 248/256 (0.969) | 0/5 | 235 (13) | |
| `post-as-written` | 250/256 (0.977) | 1/5 | 246 (4) | |
| `customs-first` | 252/256 (0.984) | 3/5 (needs the d3 precedence trap) | 250 (2) | |
| `type-exact` | 253/256 (0.988) | 2/5 | 250 (3) | |
| `no-escalate` | 253/256 (0.988) | 3/5 (needs the d3 duplicate row) | 248 (5) | |
| `release-by-name` | 254/256 (0.992) | 3/5 (needs the d3 namesake on leave) | 250 (4) | |
| `no-recheck` | 254/256 (0.992) | 3/5 (needs the d3 requeue) | 250 (4) | |

Each one-defect control fails, in rebased mode, on at least one trigger carrying the trap its broken rule resolves (a
test asserts it). The carry column shows how much the old headline double-counted: up to 17 inherited failures in 256
triggers for one misread rule. The review's two Status-blind solvers, re-measured on seeds 601–630 (`--mode both`):
`stateless` 1,410/1,528 per trigger (0.923), 0/30 clean weeks; `nostatus` 1,462/1,528 (0.957), 0/30 clean weeks
(v1.0.0: 1,445/1,445 and 30/30 for both).

**Other gates:**
- **Determinism and round trip:** two generations give identical sha256 for world0, payloads, triggers, truth and end;
  every `world_t` validates as `WorldState` and survives dump → load → dump.
- **Leakage:** 0 problems on the dev streams. A new-package payload is exactly the inserted row; an update payload
  holds only the row's key and changed cells (never a package Status); no truth vocabulary in payloads or world0;
  serve-input rows hold only POLICY.md and the payload with `assertions: []`; the reference imports only `json`, `re`,
  `datetime` and `urllib`.
- **Oracle mutation score: 4,741/4,741 = 1.000** (30 operators on the reference's correct worlds: dropped, duplicated or
  misrouted posts and SMS; a post sent as a thread reply; an SMS from another number; wrong floor, dock, name,
  department, arrow, tracking number, number or count; wrong, reverted or reformatted Status; other cells or row
  formatting edited; another package or the directory edited; an appended row; extra #mailroom, SMS or
  #automation-review writes; a pre-existing message deleted).
- **Specificity: 1,133/1,133** policy-neutral variants accepted (trailing period or newline, Status case, SMS status,
  bot name), and an equivalent solver that writes the Status through A1 notation and names the channels by id
  (escalations too) passes 256/256.
- **Trap coverage** (labels from the truth, label streams 610–613): T-lookalike 35, T-note 58, T-format 12, T-repeat 9,
  T-state 63; every kind ≥ 5. New labels: `already-routed` 11, `skipped-active` 5, `other-change` 3, `spelling` 7,
  `type-variant` 3, `ambiguous` 3. Trap share per trigger over 601–650: **0.392 at d2 and 0.631 at d3** (design 0.35
  and 0.60; above it because every `package.updated` trigger is a trap by construction); planted share of package
  triggers 0.24 and 0.55.

**Tests:** `pytest` (70 tests): 70 passed in 363 s (run beside `gates.py`).

### v1.0.0 numbers (2026-10-15, re-verified 2026-10-21; superseded)

Kept as the record of what the review found. Dev streams had 243 triggers (45, 51, 47, 55, 45); the reference passed
243/243 and 2,426/2,426 on 601–650. The 15 controls of v1.0.0 scored 0.848–0.975 per trigger in **carry** mode
(`null` 19/243, `echo` 0, `naive` 151/243 and 0.528 at d3). Mutation 4,404/4,404 (28 operators); specificity
1,190/1,190, which counted "another From number" as neutral (review defect 2). Trap coverage T-lookalike 20, T-note 68,
T-format 12, T-repeat 9, T-state 40. 48 tests. The review's `stateless` and `nostatus` solvers passed 1,445/1,445 triggers
and 30/30 clean weeks on 601–630 (review defect 1).

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

## Review fixes (2026-10-21, v1.1.0)

An adversarial review of v1.0.0 found six defects; each is fixed below or stated as still open. The version bump
changes the generator's seed string, so every stream differs from v1.0.0. No arm ever ran on v1.0.0, so nothing is
invalidated.

1. **[high] The Status column never decided anything.** Two Status-blind solvers (re-decide on any Notes change that
   lacks customs hold; on a return, re-decide every package of that name and department) passed 1,445/1,445 triggers and
   30/30 weeks, because re-deciding a held or Skipped row gave the same Status and an unchanged write leaves no trace.
   Fixed with cases where only the Status column gives the right answer: a new trigger kind `package.updated` (every
   week a delivery note on a Routed package; at d2/d3 a note on a package Skipped before its recipient joined the
   directory; in about half the d2 weeks and every d3 week a Department correction on a Skipped package or a Package
   Type relabel on a Routed one; in some d3 weeks a second customs note on a package released earlier that week; all
   expected no-ops), and, at d2/d3, the first returning employee also owns a package Routed before the leave. Labels
   `already-routed`, `skipped-active`, `other-change` (T-state). The review's solvers are now controls `stateless` and
   `nostatus`: 0/5 clean dev weeks and 0/30 clean weeks on 601–630, and in rebased mode they fail only on triggers
   carrying those labels (tests `test_status_guard_is_load_bearing`, `test_plausible_controls_fail_for_their_rule`).
2. **[medium] The SMS From number was not graded.** The oracle now requires `from_number == +15550100200` for each
   expected SMS and in `end.sms`, and the truth's `twilio_sms_sent` assertions carry `from_number`. "Another From
   number" moved from the specificity variants to the mutants (`sms-from`); control `no-from` has 0/5 clean weeks.
   POLICY.md §2 now says "every SMS is sent From the mailroom number" (test `test_sms_from_number_is_graded`).
3. **[low] A routing post sent as a thread reply passed.** AutomationBench's `conversations.history` hides thread
   replies (`automationbench/tools/api/impl/slack.py:188-220`), so such a post is not in the channel the daily count
   reads. Expected posts must now be top-level, `end.mailroom` counts top-level messages only, POLICY.md §2 says so,
   and mutant `post-thread-reply` and control `thread-reply` fail (test `test_thread_reply_posts_are_rejected`).
4. **[low] Policy clauses never exercised.** New planted cases: `spelling` (Recipient Name or Department in another
   case or spacing, every d2/d3 stream: the post must use the directory spelling), `type-variant` (`refrigerated`,
   ` HAZARDOUS`: SMS; POLICY.md rule 5 now says "ignoring letter case and extra spaces", and `gen.decide` folds case
   as `reference.needs_sms` does), `other-change` (expected no-op), and `ambiguous` (d3: one person on two directory
   rows; POLICY.md rule 2 now says that cannot be decided, so the escalation clause and the oracle's escalation check
   are exercised: 3 escalation triggers on the dev streams). `reference.package_changed` now requires `Notes` in
   `data.changed`. Controls `exact-match`, `post-as-written`, `type-exact` and `no-escalate` each fail on their label.
   With correct history a Held - Customs row always still says customs hold, so a solver that ignores `data.changed`
   but keeps the Status guard cannot be caught by any trigger; only the Status-blind solvers can, and are.
5. **[low] The reference does not check the policy independently; the Policies sheet disagreed with §4.** The
   Mailroom Policies sheet's Customs Hold rule now says "then they are decided again" (and Notifications says "any
   letter case"; test `test_policy_sheet_agrees_with_policy_md`). **The second-reader fairness gate is still not
   done:** it needs an implementation written from POLICY.md alone by a session that did not write the family, which
   is a model cost (RECURRING-DESIGN §3.11 gate 6 budgets about $5 for all families) that this $0 fix does not spend.
   The session that made these fixes read the generator, so it cannot serve as that reader.
6. **[low] Carry-mode grading double-counted errors per trigger.** The per-trigger number is now the rebased rate,
   clean weeks stay carry, and the carry rate is reported beside them with `inherited` (`harness.py --mode both`, the
   CLI default; the controls gate; `family.json` `grading`). Test
   `test_per_trigger_rate_is_rebased_and_carry_double_counts` checks that `no-release` and `leave-as-skip` have
   inherited failures in carry that rebased does not count. A model arm's per-trigger number therefore needs its
   per-trigger sessions run on the reference's world_t (the rebased worlds) as well as one carry run for clean weeks.

## Limits and not done yet

- The reference's rules are literal keyword and equality checks, checked against the generator's own text
  templates. Agreement between two implementations by the same author does not prove the policy reads the same way
  to someone else: the second-reader fairness gate (§3.11 gate 6) still needs a session that did not write the
  family (review defect 5, open). The decoy `Return to sender if undeliverable` (routed, because the policy keyword
  is *returned* to sender), the "Any other row change: do nothing" rule on a Department correction of a Skipped
  package, and the duplicate directory row read as undecidable are the readings most likely to be disputed.
- An SMS whose status is `failed` is accepted: an arm cannot set an SMS status through the API (AutomationBench creates
  every SMS `queued`), so the oracle does not grade it.
- In carry mode an arm that appends rows to Incoming Packages shifts nothing in the generator's deltas, so a later
  package row can share a row number with the arm's stray row; that cascade is the arm's consequence and is graded.
- The stream runner (`stream.mjs`), the bridge commands (`abr-gen`, `abr-apply`, `abr-grade`) and the arms (§3.7–3.8)
  do not exist yet. Here everything runs in one process; model arms will reach the same `env_response` path through
  `bridge.py serve` with the rows `gen.serve_input` writes.
- The seed ledger has no entries for this family; no labelled stream was run.
