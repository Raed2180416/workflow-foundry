# abr-sales-noshow: demo no-show follow-up (AutomationBench-R family 2)

A **standing automation** in the AutomationBench-R ("recurring") adaptation: a fixed policy that Sales Ops writes once
([POLICY.md](POLICY.md)), plus a **stream** of 15–25 triggers over one simulated business week. The world carries over
from one trigger to the next. Design: [RECURRING-DESIGN.md §4.2](../../../../research/automationbench-20261014/RECURRING-DESIGN.md)
(shared packaging in §3).

**Status (2026-10-15).** Development, $0. The generator, oracle, observable-only reference, 11 bad controls, the $0
validity gates and the tests are built. No model has run on this family, so there is no arm result and no capability
number yet. Everything below is development evidence on practice and dev seeds (601–650); no held-out seed (8801+) has
been generated or looked at.

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

The controls fit this hypothesis without testing it. Each plausible single-rule mistake costs only 6–34% of triggers,
because each rule matters on few triggers (table below). A competent per-trigger agent loses little.

## Files

| File | What it is |
|---|---|
| [POLICY.md](POLICY.md) | The standing policy every arm receives (v1.0) |
| [family.json](family.json) | Id, apps, tools, envelope, trigger kinds and rates, trap rates, need-job card, seeds, controls |
| [gen.py](gen.py) | Seeded generator: `world0` (validated as AutomationBench `WorldState`, round-tripped), arm-visible `payloads`, host-only `triggers` (payload + delta + traps), `truth`, `end`, one `serve-inputs` row per trigger (`assertions: []`), `meta` with sha256. One `random.Random(f"{family}:{version}:{seed}:{difficulty}")`, no wall clock. Refuses held-out seeds |
| [oracle.py](oracle.py) | Per-trigger grader: an effect ledger from `world_before` / `world_after` diffs (attribution), exact effects, envelope (nothing else written), decoy guards, AutomationBench's own `AssertionRegistry` checks, and the end-of-week state at week close. Outcomes: correct, abstained, miss, wrong |
| [reference.py](reference.py) | Reference workflow: author-written code, no model. It sees only the payload, the policy constants and the tools, keeps no private state, and imports no host module |
| [controls.py](controls.py) | 11 bad controls (below) |
| [harness.py](harness.py) | `$0` stream runner. Applies each delta, calls the tools through `bridge.Rollout.batch` (the official `env_response` path with the determinism shim), grades every trigger; carry and rebased modes |
| [gates.py](gates.py) | The $0 validity gates of RECURRING-DESIGN §3.11 |
| [tests/test_noshow.py](tests/test_noshow.py) | pytest suite (38 tests) |

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
| `T-history:repeat`, `-repeat-completed`, `-old`, `-retracted` | earlier no-shows 3–13 or 16–26 days back, worked or retracted | the 14-day repeat rule; retracted no-shows do not count |
| `T-note:chatter`, `-chatter-names-reported`, `-internal`, `-cancelled-only`, `-no-contact` | other messages, internal invitees, no countable event, no contact | sections 1, 2.1 and 2.5 of the policy |

The first trap of a trapped report is dealt round-robin over five groups (repeat, look-alike, stale, format, history),
so every kind recurs. Measured share of triggers carrying a trap, over seeds 601–650: **0.43 at d2 and 0.72 at d3**
(design: 40% and 70%). d1 (smoke only) plants none on handled reports.

## Numbers [measured, $0, development evidence]

These come from `gates.py` (seeds 610–614 unless stated) and `harness.py`, on 2026-10-15.

**Reference** (observable-only code):
- 1,014/1,014 triggers and 50/50 clean weeks on seeds 601–650 (carry mode);
- 611/611 on 601–630 in rebased mode;
- 100% on 631–640 forced to d1 and to d3;
- 806/806 on a stress run (631–650 × d2/d3 with every report trapped).

The dev gate asks for ≥ 95% on 5 dev seeds. Result: 100/100 on 610–614 (19/19, 23/23, 17/17, 24/24, 17/17).
Generator and reference agree on every effect of every stream run.

**Bad controls** on 610–614 (100 triggers; 26 of them are no-op triggers):

| Control | What is wrong | Pass | Clean weeks | Outcomes |
|---|---|---|---|---|
| `null` | does nothing | 26 | 0/5 | 74 miss |
| `echo` | posts every trigger back and creates a task named after it | 0 | 0/5 | 100 wrong |
| `naive` (28 lines) | any email = a no-show of the latest event, old $100,000 rule, all opportunities, no dedupe or repeat, ignores retractions | 27 (d3: 23.4%) | 0/5 | 66 wrong, 7 miss |
| `stale-threshold` | High only at $100,000 of pipeline | 84 | 1/5 | 16 wrong |
| `no-repeat` | no 14-day repeat rule | 90 | 1/5 | 10 wrong |
| `latest-event` | latest event before the report, whatever its status | 94 | 2/5 | 6 wrong |
| `all-opps` | closed opportunities counted | 66 | 0/5 | 34 wrong |
| `chatter-as-report` | every message naming an outside email is a report | 76 | 0/5 | 17 abstained, 4 wrong, 3 miss |
| `no-dedupe` | a duplicate report creates a second task | 94 | 2/5 | 6 wrong |
| `contact-by-surname` | the contact is the first one with the invitee's last name | 68 | 0/5 | 27 wrong, 5 abstained |
| `retract-by-surname` | a retraction matches the person by last name only | 89 | 2/5 | 11 wrong |

Every control fails. The tests also check that each plausible control is rejected **for its own rule**, on the trigger
kinds where that rule applies: for example, priority checks for `stale-threshold`, the retraction target for
`retract-by-surname`, and the envelope on duplicates for `no-dedupe`.

**Gates** (`gates.py`, all pass):

| Gate | Result |
|---|---|
| determinism | Identical sha256 on regeneration. Every `world_t` validates and round-trips |
| leakage | 0 problems on 5 streams. Payloads, serve rows and `world0` carry no truth, ids, expected descriptions, flags or tasks of the week |
| solvability | 283/283 on 601–614 |
| controls | As above. `null` passes exactly the 26 no-op triggers. `naive` is below 60% at d3 |
| trap coverage (610–613) | lookalike 9, stale 6, note 21, format 6, repeat 15 (each ≥ 5) |
| oracle mutation | 1,758/1,758 single-fault mutants killed (score 1.000, 43 operators) |
| oracle specificity | 191/191 policy-neutral variants accepted, no false rejects |

**Tests:** 38 passed (pytest 9.0.2 in the AutomationBench venv, about 80 s).

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
