# abr-ops-slawatch: support SLA early warning (AutomationBench-R family 5)

A **standing automation** in the AutomationBench-R ("recurring") adaptation: a fixed policy that the Support Manager
writes once ([POLICY.md](POLICY.md)), plus a **stream** of 50–60 triggers over one simulated business week. The world
carries over from one trigger to the next. Design: [RECURRING-DESIGN.md §4.5](../../../../research/automationbench-20261014/RECURRING-DESIGN.md)
(shared packaging in §3). This is the family with a **typed hard requirement**: `schedule` and `durable-wait`. The
`durable-wait` part is qualified below: most of the timing can be worked out from the clock, and the tracker's state
decides only a minority of triggers (6–8 a week).

**Headline metric: clean weeks.** A week is clean when every trigger of the stream passes. The per-trigger rate is
reported beside it, but it barely separates a solver with no memory from a correct one: the `memoryless` control
(reads no state column, keeps no memory) passes 0.853 of triggers on seeds 601–650 and keeps 0 of 50 weeks clean.

**Status (2026-10-21, generator 1.1.0).** Development, $0. Built: the generator, the oracle, an observable-only
reference workflow, 18 bad controls, the $0 validity gates and the tests. Revised after the 2026-10-21 review (History).
No model has run on this family, so there is no arm result and no capability number yet. Everything below is
development evidence on practice and dev seeds (601–650). No held-out seed (8801+) has been generated or looked at.

## What an arm does

The automation fires on every hourly check (10:00–17:00 UTC, Monday to Friday), on every new or changed row of the
ticket tracker, and on every email to its inbox. Each run gets one Zap-style payload (`{"trigger","at","app","event",
"data"}`) and AutomationBench's own three tools (`api_search`, `api_fetch`, `base64_encode`) on its simulated Google
Sheets, Twilio, Slack, Gmail and Jira.

| Trigger kind | Per week | Correct handling |
|---|---|---|
| `tick` (`schedule` / `hourly_check`) | 40 | For every Open or In Progress ticket without an `LGL-` code in Notes, the first matching rule: <ul><li>deadline ≤ now, not breached: Jira issue in SUPPORT `SLA breach <ID>`, post exactly `BREACHED <ID>` in #support-escalation, set Breached At;</li><li>0 < deadline − now ≤ window, not warned for this deadline: SMS from +15550001111 `SLA warning <ID>: due <HH:MM> UTC` to the agent's E.164 phone, post `<ID> \| <Subject> \| due <HH:MM> UTC \| <Agent>`, email the support manager from the automation inbox (subject `SLA warning <ID>`), set Warned At, Warned Agent, Warned Deadline;</li><li>warned for this deadline, deadline not passed, reassigned since: SMS the new agent only, update Warned Agent.</li></ul> If the warning (or reassignment SMS) is due but the phone cannot be read: post the trigger id and a reason in #automation-review instead, at every such check. Most checks are quiet. The Friday 17:00 check is the week close |
| `ticket.opened` (`new_row`) | 5–7 (plus 10–16 open on Monday) | Nothing. The next check applies the rules |
| `ticket.updated` (`updated_row`) | 7–10 | Nothing: resolved or closed, reassigned with a new phone, legal hold placed or cleared, deadline extended, reopened, work resumed after Waiting on Customer. The next check applies the rules |
| `policy.amendment` (`new_email`) | d3 only: 3 | From support-manager@ (60–180 minutes): append a Policy Log row, effective from its date. From support-manager@ asking for a value outside 60–180: escalate to #automation-review. From anyone else: nothing |

**The hard requirement.** A warning is correct only at the **first** hourly check at which the deadline is inside the
window. Earlier (at a ticket event, or a check before the window opens) or later (a second check inside the window) is
a failure, and so is a breach at any check but the first at or after the deadline. The oracle checks attribution (the
effect must appear in that check's ledger), each record's timestamp against the check time, and the Warned At / Breached
At values.

**What `durable-wait` does and does not mean here [measured, qualified 2026-10-21].** `schedule` binds on every
trigger. Cross-trigger state binds on far fewer: a solver that never reads Warned At, Warned Agent, Warned Deadline or
Breached At can warn when the deadline is inside the window now but was not at the previous scheduled check, and breach
when it passed since then. That gets every clock-decidable trigger right. The generator marks the triggers where it
does not (`needs_state` in the host-only truth: its memoryless counterfactual acts differently there), and the
`memoryless` control fails exactly those triggers and every week close, nothing else (seeds 601–650: 368 marked
triggers, 6.5 a week at d2 and 8.3 at d3). The marked stories:

- a reassignment after the warning;
- a legal hold cleared after the check that saw the deadline pass, or cleared inside the window;
- work resumed inside the window after Waiting on Customer;
- a short extension whose new deadline is inside the window already;
- a reopen after the deadline;
- a window amendment between two checks with the deadline between the old and the new edge (d3);
- a ticket opened already inside the window, or logged after its deadline passed;
- the second check at which an unreadable phone is escalated.

Version 1.0.0 had about 3 such triggers a week (16 in five dev weeks), and the memoryless solver scored 0.922. 1.1.0 has
about 7 (35 in the five dev weeks), and it scores 0.858 there. The state still lives in the tracker, not in the arm: an
arm needs to read it back, not to remember it.

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

What the controls below show, and what they do not: each single-rule mistake costs 3–29% of triggers on the dev
streams, and none of the 15 plausible controls keeps all five weeks clean (the best keeps 3 of 5). A per-trigger agent
has to get every rule right at every check to keep a clean week. That is consistent with the hypothesis but does not
test it; only an agent-H run does.

Caveat added 2026-10-21: the `memoryless` control scores 0.858 per trigger on the dev streams (0.853 on 601–650), inside
the 0.75–0.9 band above. So the per-trigger band cannot tell an agent that reads the tracker state from one that
ignores it. Judge agent-H on clean weeks and on the `needs_state` triggers, not on the per-trigger rate.

## Files

| File | What it is |
|---|---|
| [POLICY.md](POLICY.md) | The standing policy every arm receives (v1.1: v1 plus two clarifications, see History) |
| [family.json](family.json) | Id, apps, tools, envelope, trigger kinds and rates, trap catalogue and rates, typed hard requirements, need-job card, seeds, controls |
| [lib.py](lib.py) | Constants and pure helpers shared by the generator and the oracle (never imported by the reference) |
| [gen.py](gen.py) | Seeded generator: `world0` (validated as AutomationBench `WorldState`, round-tripped), arm-visible `payloads`, host-only `triggers` (payload + delta + traps), `truth`, `end`, one `serve-inputs` row per trigger (`assertions: []`), `meta` with sha256. One `random.Random(f"{family}:{version}:{seed}:{difficulty}")`, no wall clock. Truth comes from a typed model simulated check by check. Refuses held-out seeds |
| [oracle.py](oracle.py) | Per-trigger grader: an effect ledger from `world_before` / `world_after` (attribution; Jira actions flattened), exact effects, the envelope, timing, and the end-of-week state at the Friday 17:00 check. AutomationBench's own `AssertionRegistry` checks run as a reported cross-check (`ab_disagree`) and never decide a trigger (Matching rule, below). Outcomes: correct, abstained, miss, wrong |
| [reference.py](reference.py) | Reference workflow: author-written code, no model. It sees only the payload, the policy constants and the tools, keeps no private state, and imports no host module. Three tool steps per check with effects, two per check whose only effect is an escalation, one per quiet check |
| [controls.py](controls.py) | 18 bad controls (below) |
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
$PY $F/harness.py run --solver memoryless --seeds 610-614              # any control name from controls.py
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
| `T-repeat:reopened-late` | resolved before the deadline, reopened after the check at which it passed | the breach is owed at the next check (Breached At is empty) |
| `T-stale:window-straddle` | d3: the authorized amendment lands between two checks, effective that day, with a deadline between the old and the new window edge | the window in force at each check: warn at the later check when it widens; no second warning when it narrows |
| `T-format:unreadable-phone` | a monitored ticket's Agent Phone holds no US number (`ext. 4410`, `see Slack profile`, `555-0199`) | §7: escalate at each check that would warn it; no SMS, post, email or tracker write; breach as usual |
| `T-authority:out-of-range-amendment` | d3: support-manager@ asks for a window outside 60–180 | §6/§7: escalate; no Policy Log row |
| `T-timing:exact-window`, `exact-deadline` | deadline exactly window minutes after a check; deadline on the hour | `≤` window; `deadline ≤ now` is a breach |
| `T-timing:after-hours` | deadline between 17:00 + window and the next morning | no warning; breach at the next check |
| `T-timing:eager-open`, `eager-update` | a ticket event whose ticket is already inside the window or past its deadline; since 1.1.0 an opened eager ticket is inside the window already at the check before it existed, or was logged after its deadline passed | ticket events need no effect; the next check warns or breaches it |

## Numbers [measured, $0, development evidence]

From `gates.py` (default seeds: dev 610–614, practice 601–609) and `harness.py`, 2026-10-21. Generator version 1.1.0
(the 1.0.0 numbers are in History; every stream changed, because the version is part of the RNG seed).

**Stream shape** (seeds 601–650): 53–57 triggers at d2 and 57–60 at d3. Each week has 40 checks, 5–7 opened tickets
and 7–10 ticket updates, plus 3 amendments at d3. 10–13 tickets are open on Monday at d2 and 12–16 at d3. Per stream,
16–25 of the 40 checks have effects and the rest are quiet. A week has 9–17 warnings, 2 reassignment SMS, 11–21
breaches and 2–4 escalation triggers. Triggers marked `needs_state`: 4–9 a week at d2 (mean 6.5) and 5–11 at d3
(mean 8.3). Measured share of triggers with an exposed trap: **0.501 at d2 and 0.690 at d3** (design: 40% and 70%). d2
runs about 10 points high since 1.1.0, because the state stories expose traps at more checks.

**Reference** (observable-only code, no model), with 0 AutomationBench disagreements in every run:
- 2,841/2,841 triggers and 50/50 clean weeks on seeds 601–650 (carry mode);
- 1,698/1,698 on 601–630 in rebased mode;
- 509/509 and 596/596 on 631–640 forced to d1 and to d3;
- tool steps per trigger:
  - 1 per quiet check;
  - 3 per check with effects (read, row lookup, writes);
  - 2 per check whose only effect is an escalation;
  - 2 per authorized or out-of-range amendment, 1 per amendment from anyone else;
  - 0 per ticket event.

The dev gate asks for ≥ 95% on 5 dev seeds. Result: **282/282 (100%) on 610–614** (55/55, 60/60, 55/55, 58/58, 54/54),
5/5 clean weeks. Generator and reference agree on every effect of every stream run, escalations included.

**Bad controls** on 610–614 (282 triggers; 160 of them are passed by doing nothing: the no-op triggers apart from
week-close checks that end a week with expected effects). Clean weeks are the headline:

| Control | What is wrong | Clean weeks | Pass | Rate | Outcomes |
|---|---|---|---|---|---|
| `null` | does nothing | 0/5 | 160 | 0.567 | 118 miss, 4 wrong |
| `echo` | posts every trigger to #support-escalation and texts it to an agent | 0/5 | 0 | 0.000 | 282 wrong |
| `naive` (20 lines) | warns every row within 2 h of its deadline (offset dropped) and breaches every past one; no status, hold, dedupe, phone normalisation or tracker state | 0/5 | 78 | 0.277 (d3: 0.288) | 200 wrong, 4 miss |
| `eager` | applies the check rules at ticket events | 0/5 | 210 | 0.745 | 60 wrong, 12 miss |
| `no-hold` | ignores `LGL-` holds | 0/5 | 264 | 0.936 | 17 wrong, 1 miss |
| `utc-naive` | drops the deadline's UTC offset | 2/5 | 233 | 0.826 | 39 wrong, 10 miss |
| `status-blind` | monitors every row with a readable deadline | 0/5 | 244 | 0.865 | 34 wrong, 4 miss |
| `no-reassign` | no SMS to the new agent after a reassignment | 0/5 | 267 | 0.947 | 13 wrong, 2 miss |
| `warn-once` | never warns an extended deadline | 2/5 | 274 | 0.972 | 8 wrong |
| `strict-window` | `<` instead of `≤` for the window and the breach | 0/5 | 241 | 0.855 | 27 wrong, 14 miss |
| `slack-dedupe` | reads "already warned / breached" from Slack by substring | 1/5 | 271 | 0.961 | 10 wrong, 1 miss |
| `raw-phone` | texts the phone as written | 0/5 | 240 | 0.851 | 40 wrong, 2 miss |
| `any-amendment` | applies amendments from anyone | 3/5 | 269 | 0.954 | 12 wrong, 1 miss |
| `fixed-window` | window fixed at 120 minutes | 3/5 (the d2 weeks) | 266 | 0.943 | 15 wrong, 1 miss |
| `late-warning` | warns at the second check inside the window | 0/5 | 199 | 0.706 | 56 wrong, 27 miss |
| `early-warning` | warns one check before the window opens | 0/5 | 200 | 0.709 | 68 wrong, 14 miss |
| `memoryless` | reads no state column and keeps no memory: warns when the deadline entered the window since the previous check, breaches when it passed since then, no rule 3 | 0/5 | 242 | 0.858 | 26 wrong, 14 miss |
| `no-escalate` | silently skips what it cannot decide (unreadable phone, out-of-range amendment) | 0/5 | 270 | 0.957 | 7 wrong, 5 miss |

Every control fails: none passes every trigger or keeps every week clean, and 14 of 18 are below the 95% bar. The four
above it (`warn-once`, `slack-dedupe`, `no-escalate`, `any-amendment`) each break a rule that bites at a few triggers a
week; they keep at most 3 of 5 weeks clean. `memoryless` must stay below `gates.MEMORYLESS_BAR` = 0.90 per trigger with
0 clean weeks. On 601–650 it scores 2,424/2,841 (0.853), 0/50 clean weeks. It fails all 368 `needs_state` triggers and
all 50 week closes, and nothing else, so the generator's `needs_state` mark agrees exactly with an observable-only
solver. `no-escalate` fails exactly the escalation triggers. The tests also check that each plausible control is rejected
**on its own trap**: for example `no-hold` on triggers where `T-note:legal-hold` is exposed, `utc-naive` on
`T-format:offset`, `eager` only on ticket events with an eager trap, and `memoryless` on `T-repeat:reassigned`,
`T-repeat:reopened-late` and `T-stale:window-straddle`. They also check that the late and early controls fail at checks
through the warning SMS and the envelope.

**Matching rule** (one rule decides a trigger; review 2026-10-21):
- **SMS and warning post.** They must carry the policy literal, with at most a four-word greeting before it and no
  negation or retraction words outside it (`lib.alert_ok`). `Hi Ravi, SLA warning TK-1: due 11:10 UTC. Please take a
  look.` passes; `Ignore previous. SLA warning TK-1: ... was sent in error` does not.
- **Breach post.** It must equal `BREACHED <ID>`, ignoring case, whitespace and trailing punctuation.
- **Posts.** Posts must be top-level and not deleted. A thread reply or a deleted message is not a post in the channel.
- **Warning email.** It must come from the automation inbox: no sender, `sla-watch@company.example.com`, or
  AutomationBench's default for the authenticated mailbox, `user@gmail.com`.
- **Policy Log Value.** Digits only.
- **AutomationBench's `AssertionRegistry` handlers.** They still run on every trigger, but as a reported cross-check
  (`ab_disagree`). They never decide a trigger, because they use raw substrings and exact cells: they would reject
  policy-equivalent values (` Ravi Menon `, double spaces around `|`) on their own. Every effect they cover is also
  covered by the oracle's own checks; the mutation gate's kills are all the oracle's own.

**Gates** (`gates.py`, all pass, exit 0):

| Gate | Result |
|---|---|
| determinism | Identical sha256 on regeneration (610, 611, 601); every `world_t` validates and round-trips |
| leakage | 0 problems on 610–614. Payload rows carry ticket columns only (never the state columns), no truth vocabulary, no record ids; `world0` holds no row, email or state of the week; serve rows carry no assertions or records; the reference imports no host module |
| solvability | 791/791 triggers, 14/14 clean weeks on 601–614, 0 AutomationBench disagreements |
| controls | As above. `null` passes exactly the 160 expected triggers; `naive` scores 0.288 at d3 (below 60%); `memoryless` 0.858 (below 0.90) with 0/5 clean weeks |
| trap coverage (610–613) | lookalike 9, stale 33, note 21, authority 13, format 55, repeat 31, timing 68 (each ≥ 5) |
| oracle mutation | 7,130/7,130 single-fault mutants killed on 610–614 (score 1.000, 77 operators), each for the intended check. New since 1.1.0: negated or retracted SMS, warning posts and breach posts; deleted and thread-reply posts; an email from the former manager; a Policy Log Value with a unit; a dropped, misplaced or threaded escalation |
| oracle specificity | 1,282/1,282 policy-neutral variants accepted. New since 1.1.0: double spaces in the post, an emoji prefix, a padded or upper-case Warned Agent, a trailing period in the SMS, an explicit inbox sender, `breached tk-1.`, a Jira summary in lower case with double spaces, a Value with spaces, two escalation posts. AutomationBench's handlers alone would have rejected 306 of them (4 variant kinds) |

**Tests:** 33 passed (pytest 9.0.2 in the AutomationBench venv, 215 s).

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
- **Volume of breaches.** Most open tickets are breached during the week (11–21 breaches a week), because ticket
  updates are capped at 10 and resolutions share that budget with the state stories. This is a generator choice, not a claim about real
  support desks.
- **Trap rates** were tuned on practice and dev seeds before any arm ran. They are generator parameters, not results.
  `T-lookalike:sender`, `T-repeat:reopened`, `T-stale:window-straddle` and `T-authority:out-of-range-amendment` are rare
  on 610–613 (1–2 exposures each); they appear across 601–650.
- **Escalation (§7)** is generated since 1.1.0: an unreadable phone on a monitored ticket (every stream; escalated at
  each check that would warn it) and an out-of-range amendment from the support manager (every d3 stream). **Not
  generated:** an unreadable deadline on a monitored ticket, and an unreadable amendment email.
- **Policy v1.1** adds two clarifications to v1, made before any arm ran:
  - posts go in the channel, not as thread replies;
  - an escalation is posted again at each check at which it applies.
- **`needs_state` is the generator's own counterfactual.** It marks where a clock-only solver differs from the truth.
  It is not a claim about where a model will fail, and it covers only the memoryless rule set described above.

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
- 2026-10-21, review fixes (generator 1.0.0 → 1.1.0, policy v1 → v1.1; $0, no model; no stream had been used for a
  label). A review found that a clock-only solver with no memory scored 0.922 per trigger on 610–614 (248/269). It also
  found that the oracle accepted alerts that negate themselves, and that AutomationBench's handlers could fail a trigger
  that the oracle's own checks passed. Fixes:
  - **State share.** More stories need the tracker's state:
    - 2 reassignments after the warning;
    - hold clears after the breach check or inside the window;
    - work resumed inside the window;
    - short extensions;
    - a reopen after the deadline;
    - a window amendment between two checks (d3);
    - opened tickets inside the window already at the previous check, or logged overdue;
    - an unreadable phone.

    Story deadlines keep two checks inside the window, so they survive a window narrowed to 60 minutes. Truth rows
    carry `needs_state`. The new `memoryless` control drops from 0.922 to 0.858 on 610–614, 0/5 clean weeks. Clean
    weeks are now the headline, and `durable-wait` is qualified (above and in family.json).
  - **Escalation.** It is generated and graded: an unreadable phone in every stream, and an out-of-range amendment
    from the manager in every d3 stream (a third d3 amendment). The new `no-escalate` control fails exactly there.
  - **Oracle.** `BREACHED <ID>` must match exactly, up to case, whitespace and trailing punctuation. SMS and warning
    posts carry the literal with at most a short greeting and no negation outside it. Posts must be top-level and not
    deleted, in the per-trigger checks and in the end counts. The warning email must come from the automation inbox.
    The Policy Log Value must be digits only. AutomationBench's handlers are a reported cross-check that never gates.
    Every probe from the review is now rejected or accepted as it should be, and the probes are regression tests
    (`test_oracle_rejects_negated_retracted_and_hidden_alerts`, `test_automationbench_handlers_cannot_fail_a_trigger_alone`).
  - **Gates and tests.** The gates gained 14 mutant operators and 11 variant kinds, and the controls gate gained the
    memoryless bar. The tests went from 26 to 33.
  - **Policy v1.1.** It clarifies that posts go in the channel rather than in a thread, and that an escalation repeats
    at each check where it applies.
  - **Shape changes.** d2 has 7–10 updates, d3 has 6–7 opened tickets, and the d2 attribute-trap rate is 0.12. d3 has
    one look-alike story and at most one legal-mention story, so the d3 start-of-week count stays at or below 16.

  1.0.0 numbers for comparison: on 610–614, reference 269/269, null 158, memoryless 248 (0.922), 5,969/5,969 mutants
  (63 operators) and 556/556 variants; trap share 0.425 / 0.647 on 601–650.
