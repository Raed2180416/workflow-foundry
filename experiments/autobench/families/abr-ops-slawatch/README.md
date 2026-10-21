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

What the controls below show, and what they do not: each single-rule mistake costs 3–32% of triggers on the dev
streams, and none of the 13 plausible controls keeps all five weeks clean (the best keeps 3 of 5). A per-trigger agent
has to get every rule right at every check to keep a clean week. That is consistent with the hypothesis but does not
test it; only an agent-H run does.

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

## Numbers [measured, $0, development evidence]

From `gates.py` (default seeds: dev 610–614, practice 601–609) and `harness.py`, 2026-10-15. Generator version 1.0.0.

**Stream shape** (seeds 601–650): 50–55 triggers at d2 and 56–60 at d3; 40 checks, 5–8 opened tickets, 5–10 ticket
updates, 2 amendments at d3; 10–14 tickets open on Monday. Per stream 14–26 of the 40 checks have effects and the rest are
quiet; 7–19 warnings, 0–2 reassignment SMS and 9–19 breaches a week. Measured share of triggers with an exposed trap: **0.425 at d2 and 0.647 at d3** (design: 40% and 70%; d3
is short because more held or waiting tickets would break the 10–14 open-ticket budget).

**Reference** (observable-only code, no model):
- 2,773/2,773 triggers and 50/50 clean weeks on seeds 601–650 (carry mode);
- 1,659/1,659 on 601–630 in rebased mode;
- 510/510 and 585/585 on 631–640 forced to d1 and to d3;
- tool steps: 1 per quiet check, 3 per check with effects (read, row lookup, writes), 0 per ticket event.

The dev gate asks for ≥ 95% on 5 dev seeds. Result: **269/269 (100%) on 610–614** (52/52, 57/57, 51/51, 59/59, 50/50),
5/5 clean weeks. Generator and reference agree on every effect of every stream run.

**Bad controls** on 610–614 (269 triggers; 158 of them are passed by doing nothing: the no-op triggers apart from
week-close checks that end a week with expected effects):

| Control | What is wrong | Pass | Rate | Clean weeks | Outcomes |
|---|---|---|---|---|---|
| `null` | does nothing | 158 | 0.587 | 0/5 | 107 miss, 4 wrong |
| `echo` | posts every trigger to #support-escalation and texts it to an agent | 0 | 0.000 | 0/5 | 269 wrong |
| `naive` (20 lines) | warns every row within 2 h of its deadline (offset dropped) and breaches every past one; no status, hold, dedupe, phone normalisation or tracker state | 67 | 0.249 (d3: 0.293) | 0/5 | 200 wrong, 2 miss |
| `eager` | applies the check rules at ticket events | 226 | 0.840 | 0/5 | 33 wrong, 10 miss |
| `no-hold` | ignores `LGL-` holds | 243 | 0.903 | 0/5 | 25 wrong, 1 miss |
| `utc-naive` | drops the deadline's UTC offset | 209 | 0.777 | 2/5 | 45 wrong, 15 miss |
| `status-blind` | monitors every row with a readable deadline | 234 | 0.870 | 0/5 | 33 wrong, 2 miss |
| `no-reassign` | no SMS to the new agent after a reassignment | 261 | 0.970 | 1/5 | 5 wrong, 3 miss |
| `warn-once` | never warns an extended deadline | 257 | 0.955 | 0/5 | 8 wrong, 4 miss |
| `strict-window` | `<` instead of `≤` for the window and the breach | 231 | 0.859 | 0/5 | 26 wrong, 12 miss |
| `slack-dedupe` | reads "already warned / breached" from Slack by substring | 250 | 0.929 | 0/5 | 15 wrong, 4 miss |
| `raw-phone` | texts the phone as written | 238 | 0.885 | 1/5 | 31 wrong |
| `any-amendment` | applies amendments from anyone | 259 | 0.963 | 3/5 | 7 wrong, 2 miss, 1 abstained |
| `fixed-window` | window fixed at 120 minutes | 243 | 0.903 | 3/5 (the d2 weeks) | 21 wrong, 5 miss |
| `late-warning` | warns at the second check inside the window | 195 | 0.725 | 0/5 | 47 wrong, 27 miss |
| `early-warning` | warns one check before the window opens | 183 | 0.680 | 0/5 | 64 wrong, 22 miss |

Every control fails: none passes every trigger or keeps every week clean, and 13 of 16 are below the 95% bar. The
tests also check that each plausible control is rejected **on its own trap** (for example `no-hold` on triggers where
`T-note:legal-hold` is exposed, `utc-naive` on `T-format:offset`, `eager` only on ticket events with an eager trap), and
that the late and early controls fail at checks through the warning SMS and the envelope.

**Gates** (`gates.py`, all pass, exit 0):

| Gate | Result |
|---|---|
| determinism | Identical sha256 on regeneration (610, 611, 601); every `world_t` validates and round-trips |
| leakage | 0 problems on 610–614. Payload rows carry ticket columns only (never the state columns), no truth vocabulary, no record ids; `world0` holds no row, email or state of the week; serve rows carry no assertions or records; the reference imports no host module |
| solvability | 770/770 triggers, 14/14 clean weeks on 601–614 |
| controls | As above. `null` passes exactly the 158 expected triggers; `naive` scores 0.293 at d3 (below 60%) |
| trap coverage (610–613) | lookalike 14, stale 39, note 25, authority 13, format 57, repeat 23, timing 53 (each ≥ 5) |
| oracle mutation | 5,969/5,969 single-fault mutants killed on 610–614 (score 1.000, 63 operators), each for the intended check (spot-checked: e.g. an SMS an hour late fails `timing.records`, a duplicate SMS fails the envelope, Warned At set to the deadline fails `warn.row.Warned At`) |
| oracle specificity | 556/556 policy-neutral variants accepted (greeting around the SMS text, subject case, other ISO forms of written times, Warned Deadline as written with its offset, Jira issue type Bug with a description, reading the inbound email) |

**Tests:** 26 passed (pytest 9.0.2 in the AutomationBench venv, 180 s).

## Limits and open items

- **No arm has run.** `agent-H`, `wf-H` and the others need the shared stream runner (`stream.mjs`) and the `bridge.py`
  `abr-*` commands of RECURRING-DESIGN §3.7. Neither exists yet.
  - `harness.py` is the in-process $0 path for code solvers. `gen.py` already writes the per-trigger `serve-inputs.jsonl`
    rows that `bridge.py serve` takes.
  - The timing check relies on the determinism shim's clock starting at the trigger time. `serve` seeds it from the
    row's `current_time` (gen writes it), and `harness.py` pins `TZ=UTC` because the shim's naive clock is local time;
    a model-arm `serve` path must run under UTC too.
- **The second-reader fairness gate (§3.11 gate 6) is not done.** It needs a session that did not write this family (a
  model cost). The reference and the generator share an author, so their agreement does not rule out a shared misreading
  of `POLICY.md`; they are independent implementations only in code (typed model vs strings through the tools).
- **AutomationBench API quirks an arm must get past** [code]: `PUT .../values/{ws}/rows/{rowId}` needs the worksheet
  **id** (`ws-open-tickets`), not its title (`automationbench/schema/google_sheets/base.py:197-222`), so POLICY.md lists
  the ids; Gmail `messages/send` takes `raw` (RFC 2822, base64url), not a `body` field (the error says so). Both fail
  loudly, so an arm can retry.
- **Volume of breaches.** Most open tickets are breached during the week (9–19 breaches a week), because ticket
  updates are capped at 5–10 and resolutions share that budget. This is a generator choice, not a claim about real
  support desks.
- **Trap rates** were tuned on practice and dev seeds before any arm ran. They are generator parameters, not results.
  `T-repeat:reopened` and `T-lookalike:sender` are rare on 610–613 (1–2 exposures each); they appear across 601–650.
- **Not generated:** an unreadable deadline or phone on a monitored ticket, and an out-of-range amendment from the
  manager. POLICY.md says to escalate; the reference implements it; nothing tests it.

## History

- 2026-10-15, first session: POLICY.md, family.json, lib.py, gen.py, oracle.py, reference.py, controls.py (16),
  harness.py, gates.py, tests and this README. Fixes made during the session, before any stream was used for a label:
  last week's breach checks landed on this Monday (history deadlines moved into last week's working hours); the d3
  start-of-week ticket count exceeded 14 (story tickets may now open mid-week); the reopen story now reopens before the
  deadline, and "work resumed" now happens inside the window, so both traps are exposed. The generator stays at version
  1.0.0, because no stream from it has been used for any label.
- 2026-10-21, re-verification by a later session ($0, no model, no code change): every number above reproduced exactly
  (reference 269/269 and 5/5 clean weeks on 610–614; null 158, echo 0, naive 67 of 269; all seven gates pass:
  770/770 solvability, 5,969/5,969 mutants, 556/556 specificity; 26 tests pass in 206 s). Three further
  plausible-but-wrong solvers written outside this directory, in that session's scratch space, were also rejected on
  610–614. The first resends the full warning bundle on a reassignment: 261/269, 8 wrong, 1/5 clean weeks. The second
  writes HH:MM from the deadline's local offset: 237/269, 28 wrong; 4 more failures were crashes in the probe itself.
  The third never writes Breached At: 89/269, 180 wrong.
