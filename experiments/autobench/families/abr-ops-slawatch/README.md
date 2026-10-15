# abr-ops-slawatch: support SLA early warning (AutomationBench-R family 5)

A **standing automation** in the AutomationBench-R ("recurring") adaptation: a fixed policy that the Support Manager
writes once ([POLICY.md](POLICY.md)), plus a **stream** of 50–60 triggers over one simulated business week. The world
carries over from one trigger to the next. Design: [RECURRING-DESIGN.md §4.5](../../../../research/automationbench-20261014/RECURRING-DESIGN.md)
(shared packaging in §3). This is the family with a **typed hard requirement**: `schedule` and `durable-wait`.

**Status (2026-10-15).** Development, $0. Built: the generator, the oracle, an observable-only reference workflow,
16 bad controls, the $0 validity gates and the tests. No model has run on this family, so there is no arm result and
no capability number yet. Everything below is development evidence on practice and dev seeds (601–650). No held-out
seed (8801+) has been generated or looked at.

## What an arm does

The automation fires on every hourly check (10:00–17:00 UTC, Monday to Friday), on every new or changed row of the
ticket tracker, and on every email to its inbox. Each run gets one Zap-style payload (`{"trigger","at","app","event",
"data"}`) and AutomationBench's own three tools (`api_search`, `api_fetch`, `base64_encode`) on its simulated Google
Sheets, Twilio, Slack, Gmail and Jira.

| Trigger kind | Per week | Correct handling |
|---|---|---|
| `tick` (`schedule` / `hourly_check`) | 40 | For every Open or In Progress ticket without an `LGL-` code in Notes, the first matching rule: <ul><li>deadline ≤ now, not breached: Jira issue in SUPPORT `SLA breach <ID>`, post `BREACHED <ID>` in #support-escalation, set Breached At;</li><li>0 < deadline − now ≤ window, not warned for this deadline: SMS from +15550001111 `SLA warning <ID>: due <HH:MM> UTC` to the agent's E.164 phone, post `<ID> \| <Subject> \| due <HH:MM> UTC \| <Agent>`, email the support manager (subject `SLA warning <ID>`), set Warned At, Warned Agent, Warned Deadline;</li><li>warned for this deadline, deadline not passed, reassigned since: SMS the new agent only, update Warned Agent.</li></ul> Most checks are quiet. The Friday 17:00 check is the week close |
| `ticket.opened` (`new_row`) | 5–8 (plus 10–14 open on Monday) | Nothing. The next check applies the rules |
| `ticket.updated` (`updated_row`) | 5–10 | Nothing: resolved or closed, reassigned with a new phone, legal hold placed or cleared, deadline extended, reopened, work resumed after Waiting on Customer. The next check applies the rules |
| `policy.amendment` (`new_email`) | d3 only: 2 | From support-manager@ (60–180 minutes): append a Policy Log row, effective from its date. From anyone else: nothing |

**The hard requirement.** A warning is correct only at the **first** hourly check at which the deadline is inside the
window. Earlier (at a ticket event, or a check before the window opens) or later (a second check inside the window) is
a failure, and so is a breach at any check but the first at or after the deadline. The oracle checks attribution (the
effect must appear in that check's ledger), each record's timestamp against the check time, and the Warned At / Breached
At values.

**State of record.** Warned At, Warned Agent, Warned Deadline and Breached At are columns of the tracker. Every arm
reads them back; nothing needs private memory. Warned Deadline is an addition to the spec's three columns [D]: "warned
for this deadline" (so an extended deadline is warned once more) is not decidable from Warned At alone once the window
is amendable, so the policy records which deadline the warning covered.

## Grounding

Two public tasks at AutomationBench commit `4a8e1061254004d9dac807054eed33fad7d1ff14` (Zapier, MIT; the clone under
`corpus/AutomationBench` is never committed):

- `operations.sla_breach_early_warning`, `automationbench/domains/operations/tasks.py:20926-21269` (raw Haiku 1/7: it
  never found Twilio or Slack). Kept [code]: the Open Tickets tracker and its columns (Ticket ID, Subject, Assigned
  Agent, Agent Phone, SLA Deadline, Status, Priority, Notes); the 2-hour window; SMS to the agent, a #support-escalation
  post and an email to the support manager; resolved, closed and past-deadline tickets skipped by the warning; the
  `LGL-` code that blocks every notification, with an SLA Hold Policy sheet; a closed `- duplicate` row; a deadline
  exactly at the current time is not inside the window.
- `support.freshdesk_sla_monitoring`, `automationbench/domains/support/tasks.py:16597-16991` (raw Haiku 14/14). Kept:
  approaching vs breached tiers; real breaches get a Jira issue in project SUPPORT; within-SLA and resolved tickets get
  nothing.

Added for the recurring version [D]: the hourly schedule and its first-check timing; Breached At and the breach
post (the grounding task routes breaches to "a separate workflow"); reassignment, extension, reopening and hold
clearing during the week; phone formats and UTC offsets; look-alike ticket ids; the SLA Policy Log and amendments.
All people, companies and domains are fictional (`*.example.com`, 555 numbers). Every record is our own text, not
AutomationBench noise.

## Class hypothesis [I, written before any label]

**Forced, by the timer requirement.** agent-H (Haiku 5.5 per trigger) must rebuild the state from the tracker at every
check. Per-trigger success may be high (about 0.75–0.9), because most checks are quiet, but clean weeks should be rare:
a double SMS, a missed or early window, a held ticket. About 40 sessions a week go to near-empty checks, which a
workflow handles in code with no model at all (the reference is that workflow). The family tests whether the need
router's typed guard (`schedule` → workflow class) is also right on economics. Proposed split: TRAIN, forced stratum.

What the controls below show, and what they do not: every single-rule mistake costs 2–33% of triggers, and a third of
the mistakes still leave most weeks unclean, so a per-trigger agent has to get every rule right at every check to keep
a clean week. That is consistent with the hypothesis but does not test it; only an agent-H run does.

## Files

| File | What it is |
|---|---|
| [POLICY.md](POLICY.md) | The standing policy every arm receives (v1) |
| [family.json](family.json) | Id, apps, tools, envelope, trigger kinds and rates, trap catalogue and rates, typed hard requirements, need-job card, seeds, controls |
| [lib.py](lib.py) | Constants and pure helpers shared by the generator and the oracle (never imported by the reference) |
| [gen.py](gen.py) | Seeded generator: `world0` (validated as AutomationBench `WorldState`, round-tripped), arm-visible `payloads`, host-only `triggers` (payload + delta + traps), `truth`, `end`, one `serve-inputs` row per trigger (`assertions: []`), `meta` with sha256. One `random.Random(f"{family}:{version}:{seed}:{difficulty}")`, no wall clock. Truth comes from a typed model simulated check by check. Refuses held-out seeds |
| [oracle.py](oracle.py) | Per-trigger grader: an effect ledger from `world_before` / `world_after` (attribution; Jira actions flattened), exact effects, the envelope, timing, AutomationBench's own `AssertionRegistry` checks, and the end-of-week state at the Friday 17:00 check. Outcomes: correct, abstained, miss, wrong |
| [reference.py](reference.py) | Reference workflow: author-written code, no model. It sees only the payload, the policy constants and the tools, keeps no private state, and imports no host module. Three tool steps per check with effects, one per quiet check |
| [controls.py](controls.py) | 16 bad controls (below) |
| [harness.py](harness.py) | `$0` stream runner. Applies each delta, calls the tools through `bridge.Rollout.batch` (the official `env_response` path with the determinism shim, clock = trigger time), grades every trigger; carry and rebased modes |
| [gates.py](gates.py) | The $0 validity gates of RECURRING-DESIGN §3.11 |
| [tests/test_slawatch.py](tests/test_slawatch.py) | pytest suite |

## Commands

All of these run inside AutomationBench's own venv (`uv sync` in `corpus/AutomationBench`, pinned by its `uv.lock`):

```
PY="corpus/AutomationBench/.venv/bin/python -I -B"
F=experiments/autobench/families/abr-ops-slawatch
$PY $F/gen.py --seed 610 --out /tmp/slawatch-610                    # host-only stream files
$PY $F/harness.py run --solver reference --seeds 601-614 [--mode rebased] [--failures]
$PY $F/harness.py run --solver no-hold --seeds 610-614
$PY $F/gates.py [--seeds 610-614] [--only mutation,specificity]      # exit 0 only when every gate passes
$PY -m pytest -q -p no:cacheprovider $F/tests
```

## Traps

Each trap is recorded on the triggers where it is **exposed**: where a solver ignoring exactly that rule (simulated
over the whole week with its own state) would act differently, or, for format and look-alike traps, where the ticket
has an effect whose literals the trap changes. Every trap is resolvable from `POLICY.md` and the tools.

| Trap id | Where | Resolved by |
|---|---|---|
| `T-lookalike:id` | `TK-4012` and `TK-40127` in the same tracker; the sibling open later or warned last week (posts, SMS, issues share the prefix) | exact ticket ids; the tracker, not Slack, is the state of record |
| `T-lookalike:sender` | an amendment from `support-manager@company-example.com` or similar | the exact owner address |
| `T-stale:window-amended` | the window changes mid-week (d3) | the newest Policy Log row in force |
| `T-stale:former-manager`, `old-window-row` | d3: a `Former Support Manager Email` row first in SLA Config; an older 180-minute Policy Log row | the setting named exactly `Support Manager Email`; the newest row |
| `T-note:legal-hold` | `LGL-` codes (any code, any case) in Notes: all week, cleared after the deadline, cleared inside the window, or placed mid-week | §3 legal hold: nothing while held; rules apply from the next check after clearing |
| `T-note:legal-mention`, `waiting` | Notes mentioning legal without a code; Waiting on Customer | not a hold; not monitored |
| `T-note:void-row` (world-level) | archived and void rows with `N/A`, `VOID`, `TBD` deadlines | not monitored |
| `T-authority:unauthorized-amendment` | an agent or team lead asks to change the window | owner only |
| `T-format:offset` | SLA Deadline written with `-05:00`, `-04:00`, `+01:00`, `+02:00`, `+05:30` | convert to UTC (timing and `HH:MM`) |
| `T-format:phone` | six US phone formats, also after a reassignment | E.164 |
| `T-format:status-case` | d3: `in progress`, `OPEN`, ` Open ` | status ignoring case and spaces |
| `T-repeat:closed-duplicate` | a Closed `- duplicate` row with a deadline in the window | not monitored |
| `T-repeat:breached-last-week` | In Progress, Breached At already filled | breached: nothing |
| `T-repeat:reassigned` | reassigned after the warning | rule 3: the new agent only |
| `T-repeat:extended` | a later deadline (this week, or extended last week) | Warned Deadline: warn once more |
| `T-repeat:reopened` | resolved after the warning and reopened before the deadline | still warned for that deadline |
| `T-timing:exact-window`, `exact-deadline` | deadline exactly window minutes after a check; deadline on the hour | `≤` window; `deadline ≤ now` is a breach |
| `T-timing:after-hours` | deadline between 17:00 + window and the next morning | no warning; breach at the next check |
| `T-timing:eager-open`, `eager-update` | a ticket event whose ticket is already inside the window or past its deadline | ticket events need no effect |

NUMBERS_PLACEHOLDER
