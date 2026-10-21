# abr-sales-noshow: demo no-show follow-up (AutomationBench-R family 2)

A **standing automation** in the AutomationBench-R ("recurring") adaptation: a fixed policy that Sales Ops writes once
([POLICY.md](POLICY.md)), plus a **stream** of 15–25 triggers over one simulated business week. The world carries over
from one trigger to the next. Design: [RECURRING-DESIGN.md §4.2](../../../../research/automationbench-20261014/RECURRING-DESIGN.md)
(shared packaging in §3).

**Status (2026-10-21, generator 1.1.0).** Development, $0. The generator, oracle, observable-only reference, 11 bad
controls, the $0 validity gates and the tests are built, and the defects of the 2026-10-21 review are fixed (History).
No model has run on this family, so there is no arm result and no capability number yet. Everything below is
development evidence on practice and dev seeds (601–650); no held-out seed (8801+) has been generated or looked at.
Generator 1.1.0 re-keys every stream (the version is part of the seed string), so no 1.0.0 number carries over.

## What an arm does

Every message posted in Slack `#sales-alerts` fires the automation, and so does a Friday 17:00 UTC schedule. Each run
gets one Zap-style payload (`{"trigger","at","app","event","data"}`) and AutomationBench's own three tools
(`api_search`, `api_fetch`, `base64_encode`) on its simulated Slack, Calendly and Salesforce.

| Trigger kind | Per week | Correct handling |
|---|---|---|
| `noshow.reported` (a rep reports that an invitee missed a meeting) | 10–16 | Mark the invitee's active Calendly event that started in the 3 hours before the report as a no-show. Create the Salesforce task `Follow up on missed call - <Event>` (Not Started) on the contact. Priority is High if any open opportunity on the account is $50,000 or more, or if the invitee is a repeat no-show (14 days); otherwise Normal. Description: `Scheduled: YYYY-MM-DD HH:MM UTC \| Account pipeline: $N[ \| Repeat no-show]`. Internal invitees and duplicate reports: do nothing. No unique event or no unique contact: escalate |
| `chatter` (any other message naming an invitee) | 3–5 | Nothing |
| `noshow.retracted` ("joined late") | 1–3 | Set the open follow-up task to Completed and append ` \| Retracted: joined late`. Calendly cannot unmark a no-show (`automationbench/tools/api/impl/calendly.py:328`), so Calendly is left as it is |
| `week.close` (Friday 17:00) | 1 | Post `No-shows this week: <N>` in `#sales-alerts` (tasks created this week, not retracted) |

An escalation is a post in `#automation-review` that names the trigger id. Cross-trigger state is light: repeat no-shows
are read back from Calendly flags and earlier tasks in the world. Nothing needs private memory.

**How strictly the oracle reads the prescribed strings** (since the 2026-10-21 review):
- the task description must equal `Scheduled: YYYY-MM-DD HH:MM UTC | Account pipeline: $N[ | Repeat no-show]` exactly
  (case and field order included); only whitespace runs and one trailing period are policy-neutral. Cents, reordered
  fields, added text and a second pipeline value fail;
- a new task may leave WhatId empty or set it to the contact's own account, nothing else, and its IsClosed must match
  its status (False for `Not Started`);
- a retraction must leave the description as the old description plus exactly ` | Retracted: joined late`;
- the week post must contain `No-shows this week: <N>` and no other number that could be a count (an explanation, an
  ISO date, an `HH:MM` time or the trigger id may follow);
- the week-close trigger is graded on its post and envelope only. The end-of-week state (flags, this week's tasks,
  untouched records) is a separate per-stream `week_state` verdict, so one earlier mistake is charged once. A clean
  week is every trigger passed **and** the week state passed.

## Grounding

`sales.calendly_no_show_followup`, `automationbench/domains/sales/tasks.py:9803-10104`, at AutomationBench commit
`4a8e1061254004d9dac807054eed33fad7d1ff14` (Zapier, MIT; clone under `corpus/AutomationBench`, never committed).
Kept from that task [code]:
- the Slack report, worded as in the task ("Hey team, we had a no-show today...");
- the same invitee with a cancelled event and an older event;
- the same surname at another account;
- the superseded `$100,000` procedure message next to the current `$50,000` one;
- a "Deal closed!" chatter message naming the same email;
- the `HH:MM` and comma-grouped whole-dollar description, and exactly one task per report.

Added for the recurring version [D]: the 3-hour window instead of "most recent", retractions, repeat no-shows, duplicate
and internal reports, escalations and the week-close count. All people, companies and domains are fictional
(`*.example.com`). The world records and messages are our own text, not AutomationBench noise.

## Class hypothesis [I, written before any label]

**Agent fine: this family is the negative control.** Volume is low, each trigger is self-contained, and there is one
real judgment (which event). Expected agent-H (Haiku 5.5 per trigger) is about 0.85–0.95 per trigger. A built workflow
should add no success and save little at N = 160. Label: **no-workflow, or either**. Proposed split: held-out (near).

The controls fit this hypothesis without testing it. Each plausible single-rule mistake costs only 1–34% of triggers,
because each rule matters on few triggers (table below). A competent per-trigger agent loses little.

## Files

| File | What it is |
|---|---|
| [POLICY.md](POLICY.md) | The standing policy every arm receives (v1.0) |
| [family.json](family.json) | Id, apps, tools, envelope, trigger kinds and rates, trap rates, need-job card, seeds, controls |
| [gen.py](gen.py) | Seeded generator (version 1.1.0): `world0` (validated as AutomationBench `WorldState`, round-tripped), arm-visible `payloads`, host-only `triggers` (payload + delta + traps), `truth`, `end`, one `serve-inputs` row per trigger (`assertions: []`), `meta` with sha256. One `random.Random(f"{family}:{version}:{seed}:{difficulty}")`, no wall clock. Refuses held-out seeds. Asserts two story invariants in `compute_truth` (no duplicate report after a retraction of the same no-show; no earlier no-show on the 14-day repeat boundary) |
| [oracle.py](oracle.py) | Per-trigger grader: an effect ledger from `world_before` / `world_after` diffs (attribution), exact effects (exact description, retraction suffix and count), envelope (nothing else written), decoy guards, AutomationBench's own `AssertionRegistry` checks. At week close it also returns the separate `week` verdict on the end-of-week state. Outcomes: correct, abstained, miss, wrong |
| [reference.py](reference.py) | Reference workflow: author-written code, no model. It sees only the payload, the policy constants and the tools, keeps no private state, and imports no host module |
| [controls.py](controls.py) | 11 bad controls (below) |
| [harness.py](harness.py) | `$0` stream runner. Applies each delta, calls the tools through `bridge.Rollout.batch` (the official `env_response` path with the determinism shim), grades every trigger and the week state; carry and rebased modes. `--out` writes `results.jsonl`, `weeks.jsonl` and `summary.json` |
| [gates.py](gates.py) | The $0 validity gates of RECURRING-DESIGN §3.11 |
| [tests/test_noshow.py](tests/test_noshow.py) | pytest suite (46 tests) |

## Commands

All of these run inside AutomationBench's own venv (`uv sync` in `corpus/AutomationBench`, pinned by its `uv.lock`):

```
PY="corpus/AutomationBench/.venv/bin/python -I -B"
F=experiments/autobench/families/abr-sales-noshow
$PY $F/gen.py --seed 610 --out /tmp/noshow-610                      # host-only stream files
$PY $F/harness.py run --solver reference --seeds 601-614 [--mode rebased] [--failures]
$PY $F/harness.py run --solver stale-threshold --seeds 610-614
$PY $F/gates.py [--seeds 610-614] [--out DIR]                       # exit 0 only when every gate passes
$PY -m pytest -q -p no:cacheprovider $F/tests
```

## Traps

Each trap is recorded per trigger in the host-only truth. Every trap is resolvable from `POLICY.md` and the tools.

| Trap id | Where | Resolved by |
|---|---|---|
| `T-repeat:cancelled-in-window`, `T-repeat:older-event`, `T-repeat:later-today` | the invitee's other events | "active", "started in the 3 hours before the report" |
| `T-repeat:in-week` | the same invitee no-shows again later in the week | the repeat rule (High, `Repeat no-show`) |
| `T-repeat:duplicate-report` | a second rep reports the same no-show | "already marked: do nothing" |
| `T-lookalike:surname` | same surname at another account, with a large open opportunity | contact by email |
| `T-lookalike:colleague` | a colleague invited to the same meeting | "mark only this invitee" |
| `T-lookalike:retraction-surname` | same surname at another account, with an open follow-up task for an event of the same name | the retraction names the person |
| `T-stale:threshold`, `T-stale:closed-big`, `T-boundary:50k` | opportunities between $50,000 and $100,000, a closed big one, exactly $50,000 | $50,000 rule (not the old $100,000 message), open only, "or more" |
| `T-format:offset`, `T-format:email-case`, `T-format:localtime` | Calendly time written with a US Eastern offset, mixed-case email, report quoting ET | UTC in the description, emails ignore case, Calendly is the source of the time |
| `T-history:repeat`, `-repeat-completed`, `-old`, `-retracted` | earlier no-shows 3–13 or 16–26 days before the reported meeting (1–4 days more before a later in-week repeat of the same invitee), worked or retracted; never on the calendar day 14 days back or within 12 h of the exact boundary (`gen.near_repeat_boundary`, asserted for every act) | the 14-day repeat rule; retracted no-shows do not count |
| `T-note:chatter`, `-chatter-names-reported`, `-internal`, `-cancelled-only`, `-no-contact` | other messages, internal invitees, no countable event, no contact | sections 1, 2.1 and 2.5 of the policy |

Every trap of a trapped report is dealt round-robin over five groups (repeat, look-alike, stale, format, history), at
most one per group per report, and round-robin over the members inside each group. d3 adds a floor: each group is dealt
at least 3 times per d3 stream (`D3_DEAL_FLOOR`), met by giving trapped reports more traps (at most 3) before trapping
more reports. Coverage is counted by group (`gen.trap_kind`), so `T-boundary:50k` counts as T-stale. Measured share of
triggers carrying a trap, over seeds 601–650: **0.43 at d2 and 0.77 at d3** (design: 40% and 70%; over the 199 d3
seeds in 601–1000 it is 0.76, of which the floor adds about 0.01). d1 (smoke only) plants none on handled reports.

## Numbers [measured, $0, development evidence]

These come from `gates.py` (seeds 610–614 unless stated) and `harness.py`, on 2026-10-21, generator 1.1.0.

**Reference** (observable-only code):
- 1,015/1,015 triggers and 50/50 clean weeks (50/50 week states) on seeds 601–650 (carry mode);
- 603/603 on 601–630 in rebased mode;
- 100% on 631–640 forced to d1 (150/150) and to d3 (230/230);
- 823/823 on a stress run (631–650 × d2/d3 with every report trapped).

The dev gate asks for ≥ 95% on 5 dev seeds. Result: 98/98 on 610–614 (16/16, 23/23, 16/16, 23/23, 20/20).
Generator and reference agree on every effect of every stream run.

**Bad controls** on 610–614 (98 triggers; 26 of them are no-op triggers). Since 1.1.0 the week-close trigger is graded
on its post only, so a control's earlier mistake no longer also fails the week close; the week state is its own column:

| Control | What is wrong | Pass | Clean weeks | Week state | Outcomes |
|---|---|---|---|---|---|
| `null` | does nothing | 26 | 0/5 | 0/5 | 72 miss |
| `echo` | posts every trigger back and creates a task named after it | 0 | 0/5 | 0/5 | 98 wrong |
| `naive` (28 lines) | any email = a no-show of the latest event, old $100,000 rule, all opportunities, no dedupe or repeat, ignores retractions | 27 (d3: 21.7%) | 0/5 | 0/5 | 63 wrong, 8 miss |
| `stale-threshold` | High only at $100,000 of pipeline | 92 | 2/5 | 2/5 | 6 wrong |
| `no-repeat` | no 14-day repeat rule | 91 | 1/5 | 1/5 | 7 wrong |
| `latest-event` | latest event before the report, whatever its status | 97 | 4/5 | 4/5 | 1 wrong |
| `all-opps` | closed opportunities counted | 65 | 0/5 | 0/5 | 33 wrong |
| `chatter-as-report` | every message naming an outside email is a report | 74 | 0/5 | 3/5 | 19 abstained, 3 wrong, 2 miss |
| `no-dedupe` | a duplicate report creates a second task | 90 | 1/5 | 1/5 | 8 wrong |
| `contact-by-surname` | the contact is the first one with the invitee's last name | 68 | 0/5 | 0/5 | 25 wrong, 5 abstained |
| `retract-by-surname` | a retraction matches the person by last name only | 88 | 2/5 | 2/5 | 10 wrong |

Every control fails. The tests also check that each plausible control is rejected **for its own rule**, on the trigger
kinds where that rule applies: for example, priority checks for `stale-threshold`, the retraction target for
`retract-by-surname`, and the envelope on duplicates for `no-dedupe`.

**Gates** (`gates.py`, all pass):

| Gate | Result |
|---|---|
| determinism | Identical sha256 on regeneration. Every `world_t` validates and round-trips |
| leakage | 0 problems on 5 streams. Payloads, serve rows and `world0` carry no truth, ids, expected descriptions, flags or tasks of the week |
| solvability | 277/277 triggers and 14/14 clean weeks on 601–614 |
| controls | As above. `null` passes exactly the 26 no-op triggers. `naive` is 21.7% at d3 (below 60%) |
| trap coverage (610–613, by group) | lookalike 12, stale 7 (threshold 2, closed-big 2, boundary 3), note 21, format 7, repeat 13 (each ≥ 5); history 8 (not a gated kind) |
| oracle mutation | 2,087/2,087 single-fault mutants killed (score 1.000, 55 operators; killed = the trigger or, at week close, the week verdict fails) |
| oracle specificity | 259/259 policy-neutral variants accepted, no false rejects |

Determinism also holds across processes: identical sha256 of the streams, the final reference worlds and the verdicts
on 610 and 611 with `PYTHONHASHSEED=1` and `977`.

**Tests:** 46 passed (pytest 9.0.2 in the AutomationBench venv, about 2 min).

## Limits and open items

- **No arm has run.** `agent-H`, `wf-H` and the others need the shared stream runner (`stream.mjs`) and the `bridge.py`
  `abr-*` commands of RECURRING-DESIGN §3.7. Neither exists yet.
  - `harness.py` is the in-process $0 path for code solvers.
  - `gen.py` already writes the per-trigger `serve-inputs.jsonl` rows that `bridge.py serve` takes.
  - `harness.py` pins `TZ=UTC`, because the shim's naive clock is local time. A model-arm `serve` path must run under
    UTC too.
- **The second-reader fairness gate (§3.11 gate 6) is not done.** It needs a session that did not write this family (a
  model cost). The reference and the generator share an author, so their agreement does not rule out a shared misreading
  of `POLICY.md`.
- **The reference classifies messages by keyword rules.** They are checked only against the generator's own templates
  (5 report templates, one of them quoting ET, plus 2 duplicate, 3 retraction and 6 chatter templates). A model arm sees the same templates. Paraphrase beyond
  them is not tested.
- **One AutomationBench API quirk** [code, `impl/salesforce.py:1323`]. `PATCH sobjects/Task/{id}` accepts the model's
  snake_case fields (`status`, `description`), not Salesforce's `Status` and `Description`. The PascalCase form returns a
  422 error, so the failure is loud and an arm can retry. It affects only the retraction trigger.
- **No amendments.** The family has no amendable parameters, so d3 differs from d2 only in trap rates and volume.
- **Trap rates** were tuned on practice and dev seeds before any arm ran. They are generator parameters, not results.
  The d3 share (0.77 on 601–650) sits above the design's 70%, because chatter, internal, duplicate and escalation
  reports are traps by construction; `TRAP_RATE` was not retuned for 1.1.0.
- **A clean week needs the week state too.** The per-trigger pass rate is the headline; `week_state` is reported beside
  `clean_weeks` (`harness.py` summary and `weeks.jsonl`). The two never disagreed for the reference.

## History

- 2026-10-15, first session: `POLICY.md`, `family.json`, `gen.py`, `oracle.py`, `reference.py`, `controls.py`
  (9 controls) and `harness.py`. The session stopped before tests and a README.
- 2026-10-15, resumed session:
  - fixed a harness crash (`serve_input` arity);
  - tightened the oracle's string checks with token boundaries, so `No-shows this week: 1` no longer matches `...: 12`
    and `$1,250` no longer matches `$1,250,000`;
  - dealt the trap groups round-robin, and added the retraction look-alike trap, because look-alikes appeared only
    2–3 times on 610–613 (the gate needs 5);
  - kept duplicate reports before a later meeting starts, which removes a latent policy conflict;
  - added the `contact-by-surname` and `retract-by-surname` controls;
  - added `gates.py`, the tests and this README.

  The generator stays at version 1.0.0, because no stream from it has been used for any label.
- 2026-10-21, re-verification (no code change, $0): the 38 tests pass again (about 50 s), and `gates.py --seeds 610-614`
  reproduces every number above. An uncommitted ad-hoc probe tried five more one-rule mistakes on 610–614. Each one
  failed on the trigger kind where its rule applies:
  - Calendly wall clock with the UTC offset ignored: 88/100;
  - no escalation: 97/100, the 3 escalations graded `miss`;
  - week count including retracted tasks: 95/100;
  - an extra acknowledgement post on retraction: 90/100;
  - internal invitees handled: 95/100.
- 2026-10-21, review fixes (generator 1.1.0, $0). An independent review found the oracle too lenient on prescribed
  strings and two generator story defects. Fixed, each with a regression test:
  - **exact description** (medium). The oracle matched substrings, so reordered fields, `$87,000.00`, a junk prefix
    and a second, conflicting pipeline value all passed. Now `task.description` requires the exact POLICY.md 2.7 string
    (whitespace runs and one trailing period aside); the part checks stay only as diagnostics;
  - **exact retraction** (medium). `'retracted' in desc.lower()` accepted a prepended marker, other wording and
    ` | Not retracted`. Now the new description must be the old one plus exactly ` | Retracted: joined late`; the
    end-of-week check tests that suffix too, and the reference tests case-sensitive `Retracted`, as POLICY.md 2.7 says;
  - **contradicted count** (medium). `No-shows this week: N (actually N+1)` passed. Now the post may hold no other
    number that could be a count;
  - **other fields of the new task** (low). A WhatId on another company's account and IsClosed=True on a
    `Not Started` task now fail (`task.what-id`, `task.is-closed`);
  - **duplicate after retraction** (low). 3 of 36 duplicate reports on 601–650 followed the retraction of the same
    no-show, an incoherent story that invites a fair escalation. A retraction is now planned after any duplicate of
    its no-show, and `compute_truth` asserts it;
  - **week close double-counted** (low). The end-of-week checks were folded into the week-close trigger, so one
    earlier mistake failed two triggers (`stale-threshold`: week close 1/5). They are now the separate `week_state`
    verdict (`stale-threshold`: week close 5/5, week state 2/5);
  - **14-day boundary** (low). The README claimed repeat history never sits on the boundary, which was false for
    in-week repeats (s615/t22 under 1.0.0: a prior no-show exactly 14 days before). The in-week repeat's day now avoids
    the calendar day 14 days after any earlier no-show, `compute_truth` asserts this for every act, and the claim above
    is corrected.

  The mutation gate gained 12 operators for these cases (reorder, cents, junk prefix, conflicting pipeline, WhatId,
  IsClosed, prepended / reworded / negated retraction, contradicted and decimal count, an earlier week task
  re-described); the specificity gate gained 4 policy-neutral variants (extra whitespace in the description, a trailing period after
  the retraction suffix, a week post with an explanation, and one with the week's date, the trigger id and a time). The version
  bump re-keyed every stream, and the trap-coverage gate then failed on 610–613 (stale 1 by id prefix). A probe showed
  why: under 1.0.0 dealing only about 20% of 4-seed blocks (d2, d3, d2, d3) met the ≥ 5 gate, so 1.0.0's pass on
  610–613 was a draw on the seeds it was tuned on. 1.1.0 deals every trap round-robin by group and member, adds the d3
  floor, and counts coverage by group; 300 of 300 random 4-seed blocks (seeds 20000+) then pass.
