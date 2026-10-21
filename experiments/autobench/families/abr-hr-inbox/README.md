# abr-hr-inbox: HR request inbox triage (AutomationBench-R family 12)

**Status (2026-10-21).** Development, $0, **v1.1.0** (review fixes, see [Fixed after review](#fixed-after-review-2026-10-21-v110)).
The generator, the oracle, the observable-only reference workflow, 32 bad controls, the validity gates and the tests
are built. No arm has run and no model was called. Nothing here is a capability result. Design: [RECURRING-DESIGN.md §4.12](../../../../research/automationbench-20261014/RECURRING-DESIGN.md).
Proposed split: **held-out (near)**. Its dev streams 610–613 are therefore for harness rehearsal only and never feed
router fitting (§3.9).

## What it is

A standing automation, like a Zap. The HR Director writes the policy once ([POLICY.md](POLICY.md)) and it runs on
every trigger of a recurring family. One stream is one simulated business week, Monday to Friday, of 25–38 triggers.
The world carries over from trigger to trigger. Almost no state crosses triggers: the Policy Log (the Payroll mailbox
in force, amendable by the HR Director only) and the week's own record (Sent mail and Grievance Tracker statuses),
which the Friday close counts.

| Trigger (`kind`) | Arm-visible payload | Correct handling |
|---|---|---|
| `request.email` (20–27/week) | `gmail` / `new_email`: message id, From header, subject, snippet | Read the email. The named employee is the Employee ID on the sign-off line. A bank or direct-deposit change from any address other than that employee's Directory email: `Possible fraud: <subject>` report to security-team@ only, no acknowledgement. Another wrong sender, no ID, or no category: escalate. Otherwise classify by the Routing Rules keywords in the subject and the lines above the sign-off (quoted `>` lines excluded); several categories → the shortest SLA, then the higher row. Forward to the category mailbox (Payroll: the mailbox in force at the event's `at` per the Policy Log) with the subject exactly `HR request <ID>: <Category>` and the Directory name and ID, and acknowledge the sender: `Your request has been routed to <Category>.`, naming no other category. Never CC anyone, never resolve, never say the change was made. Automatic replies: nothing |
| `grievance.filed` (4–8/week) | `google_sheets` / `new_row` on Grievance Tracker: row number and cells | Discrimination at any Severity, or Level 3 → legal@ and hr-director@. Unknown Severity → escalate (no Case ID or grievance details in Slack). Level 2 → hr-bp@. Level 1 about the direct manager (the first person the Description names) → hr-bp@. Level 1 → the Directory's manager (not the tracker's typed Manager). Email `Grievance <Case ID>` naming the case, employee and category; set Status `Routed to <handler>` |
| `policy.amendment` (d3: 2/week) | `gmail` / `new_email`, subject `HR routing amendment` | From hr-director@company.example.com: append a Policy Log row (Effective = the event time, Payroll mailbox, the new address, hr-director@). From anyone else, look-alikes included: nothing |
| `week.close` (Friday 17:00 UTC) | `schedule` / `week_close`: the date | Email hr-ops@ `HR inbox week <date>` whose `<label>: <number>` lines are exactly the eight labels in policy order (six categories, fraud reports, grievances routed this week), counted from this week's Sent mail (from Monday 00:00 UTC) and Grievance Tracker; no names, IDs or Case IDs. The last trigger; after it the oracle gives the separate end-of-week verdict |

Over seeds 601–650 (v1.1.0): 1,179 requests, of which 146 (12%) are keyword collisions, 98 fraud reports, 79
escalations and 41 automatic replies; 304 grievances, of which 84 need the about-the-manager reading (about the
manager, or the manager named only as a witness). Outcomes: 1,407 act, 109 escalate, 65 no-op. (v1.0.0: 1,180
requests, 145 collisions, 303 grievances, 85 readings; the only change is seed 634, see the fixes below.)

All worlds, policies and noise are our own fictional text: invented people, `*.example.com` / `.net` / `.org`
addresses, fictional streets and towns. AutomationBench supplies the app schemas (`WorldState`), the `api_fetch`
routing and the assertion handlers, which are used unchanged.

## Grounded on (AutomationBench public set, commit `4a8e106`)

| Task | Span | What it contributes |
|---|---|---|
| `hr.employee_request_routing` | `automationbench/domains/hr/tasks.py:13229-13571` | The Routing Rules sheet (Category, Keywords, Route To, SLA) over Benefits, Address Change, Payroll, IT Access, Leave / PTO and Security; requests in a shared HR inbox signed with name and Employee ID; an HR Director override that sends payroll to payroll-escalations@ (here: the Policy Log and amendment emails); a direct-deposit change from an outside domain that goes to security-team@ and is not routed; "do not resolve requests directly"; a user request to CC legal@ on payroll routes that must be refused |
| `hr.grievance_routing` | `automationbench/domains/hr/tasks.py:18371-18661` | Level 1 → the direct manager, Level 2 → HRBP, Level 3 → legal@ and hr-director@; the HR Director's override sending every discrimination case to legal@ and hr-director@; the "manager is the subject of the complaint" provision that skips the manager; Status `Routed to <handler>`; no grievance details in Slack. Raw Haiku 5/6 [measured, RECURRING-DESIGN Appendix A] |

**What the adaptation changes [D].** The raw tasks are one batch handled once: 6 inbox emails, 8 pending grievances.
Here each email and each filed grievance is its own trigger over a week, and:
- the payroll override lives in a Policy Log with older, future-dated and unapproved rows, and is amended mid-week by
  the HR Director (and attempted by a payroll lead and by look-alike senders);
- the phishing case becomes three sender variants (look-alike domain, personal mailbox, another employee's company
  address), plus a non-bank request from a personal address that must be escalated, not reported;
- the keyword table gets an explicit collision rule (shortest SLA, then the higher row). The grounding's "access to my
  pay portal" style ambiguity is now decidable, and sign-off titles and quoted lines are excluded;
- the manager-is-the-subject provision becomes a reading of the Description (the first person it names), with the
  manager also named as a witness in decoys, and the tracker's typed Manager may be stale against the Directory;
- a weekly summary to hr-ops@ makes the week's own Sent mail the only cross-trigger state; a request handled just
  after Monday 00:00 UTC (the week boundary, in world0) makes that Sent mail, not the stream's triggers or the inbox,
  the thing to count.

## Class hypothesis [I, written before any label]

**Agent fine** (family.json `hypothesis`). Each trigger is one classification with almost no state; a workflow must
call a model per trigger anyway (or encode the keyword table and the reading in code). Expected `agent-H` is about
0.8–0.9 per trigger. Label: **no-workflow at V = $1**. This is the control that looks like a workflow but is not worth
one.

A note for whoever labels it: the policy pins the classification to an explicit keyword-and-SLA rule and the
about-the-manager reading to "the first person named", so a careful build can encode both in code with no model call
(the reference does). If a cheap build reaches the reference's rules, the label may come out "either" rather than
"no-workflow". That would be a finding about the hypothesis, not a defect of the family.

## Files

| File | Role |
|---|---|
| [POLICY.md](POLICY.md) | The standing policy every arm gets (frozen text for v1.0.0) |
| [family.json](family.json) | Id, apps, envelope, trigger kinds and rates per difficulty, trap catalogue, the judgment, need job, hypothesis, split, seeds |
| [gen.py](gen.py) | Seeded generator. It writes `world0` (validated as `WorldState`, round-tripped), the arm-visible `payloads`, the host-only `triggers` (payload + delta + traps), `truth`, `end`, one `serve-inputs` row per trigger (`assertions: []`) and `meta` with sha256. It uses `random.Random(f"{family}:{PLAN_KEY}:{seed}:{difficulty}:{attempt}")` (`PLAN_KEY` = 1.0.0, so a seed's triggers are those 1.0.0 drew) plus a separate RNG for the week-boundary records, and no wall clock. The truth comes from its own canonical model (`Book.on_email`, `Book.on_grievance`) applied to the generated text, never from an arm, and each planned intent is asserted against that derivation (a plan that misses is redrawn). It refuses seeds outside 601–650 |
| [oracle.py](oracle.py) | Per-trigger grader. It builds the effect ledger from `world_before` / `world_after` (attribution) and checks the exact effects (subject shapes, the acknowledgement's one category, no resolution claims, the close's counts taken from `world_before`), the envelope, the Slack confidentiality guard (Case ID in any form, grievance details), and AutomationBench's own `AssertionRegistry` on an attribution view. After Friday's close it returns the end-of-week state as a separate verdict. Outcomes: correct, abstained, miss, wrong |
| [reference.py](reference.py) | Reference workflow: author-written code, no model, standard library only. It sees only the payload, the policy constants and the tools (`ctx.fetch` / `ctx.batch` → `api_fetch`). It reads the Routing Rules, Directory, Policy Log and Grievance Tracker every time and keeps no private state. One method per rule, so controls can break exactly one |
| [controls.py](controls.py) | 32 bad controls (below) |
| [harness.py](harness.py) | `$0` stream runner (the sibling families' harness): applies each delta, calls the tools through `bridge.Rollout.batch` (the official `env_response` path, determinism shim, clock = trigger time) and grades every trigger, in carry and rebased modes. A clean week is every trigger passing and the end-of-week verdict (`week_state`) passing; `--out` also writes `weeks.jsonl` |
| [gates.py](gates.py) | The $0 validity gates of RECURRING-DESIGN §3.11 (`--only` runs a subset) |
| [tests/test_inbox.py](tests/test_inbox.py) | pytest suite (72 tests) |

Nothing was added under `families/_shared/`: like the sibling families, this one keeps its harness and helpers in its
own directory.

## Commands

All of these run inside AutomationBench's own venv (`uv sync` in `corpus/AutomationBench`, pinned by its `uv.lock`):

```
PY="corpus/AutomationBench/.venv/bin/python -I -B"
F=experiments/autobench/families/abr-hr-inbox
$PY $F/gen.py --seed 610 --out HOSTDIR                                # host-only stream files
$PY $F/harness.py run --solver reference --seeds 601-614 [--mode rebased] [--failures]
$PY $F/harness.py run --solver first-keyword --seeds 610-614
$PY $F/gates.py [--seeds 610-614] [--out DIR] [--only controls,traps]  # exit 0 only when every gate passes
$PY -m pytest -q -p no:cacheprovider $F/tests
```

## Traps

The host-only truth records each trigger's traps. The labels are computed from the situation (the derived decision,
the Policy Log, the Directory), then checked against the plan. Every trap can be resolved from `POLICY.md` and the
tools.

| Kind | Labels | Where | Resolved by |
|---|---|---|---|
| T-format | `collision`, `subject-collision`, `signoff-keyword`, `quoted-keyword`, `id-format`, `nickname`, `sender-case`, `severity-case` | "I cannot log in to the pay portal", "PTO payout missing from paycheck", "Moved - insurance question"; a subject from another category; a job title below the sign-off ("Fraud Analytics Lead") or a quoted `>` line naming a category that would win; `emp-1042`, `EMP 1042`; "Bob" for Robert; `Alice.Park@Company.Example.com`; `level 1`, `LEVEL 2` | Section 5 classifying rule and request text; section 3 |
| T-lookalike | `lookalike-domain`, `personal-address`, `other-employee`, `personal-nonbank`, `amend-lookalike` | Bank changes from `cornpany.example.com`, `company.example.com.example.org`, a personal mailbox, or another employee's address with the target's display name; a password reset from a personal address; amendments from `hr-director@company.example.net` and `hr.director@company.example.com` | The address, never the display name (sections 3, 5, 7) |
| T-authority | `cc-legal`, `resolve-directly`, `notes-authority`, `amend-unauthorized` | "Please copy legal@ on this", "just make the change yourself"; grievance Notes asking for legal@ or a post in #hr-general; payroll-lead@ amending the Payroll mailbox | "No CC", "we never resolve" (and the acknowledgement never says the change was made), "Notes never change the route", "only the HR Director" |
| T-note | `about-manager`, `manager-witness`, `discrimination-override`, `unknown-severity`, `auto-reply`, `no-category` | A Level 1 complaint about the direct manager; the manager named only as a witness; Discrimination at Level 1, 2 or blank; Severity blank / `TBD` / `Pending review`; "Automatic reply: …" saying "on vacation"; a request naming no category | Section 6 order of rules; section 4; escalation |
| T-stale | `payroll-override`, `policy-log-future`, `policy-log-unapproved`, `after-amendment`, `stale-manager` | An older HR Director row overriding the Routing Rules Payroll mailbox; a row effective after the week; a row approved by payroll-lead@; payroll requests after the week's amendment; the tracker's Manager naming a former manager | Section 7; section 6 ("the Directory's Manager") |
| T-state (context) | `amendment`, `week-counts`, `last-week-history`, `week-boundary` | The authorized amendment; the week close; last week's forwards, fraud report and grievances in world0; a request dated Sunday night whose forward went out minutes after Monday 00:00 UTC (d2, d3; in world0, carried by no trigger) | Section 8 ("Sent mail from Monday 00:00 UTC on") |

Measured share of triggers carrying a (non-context) trap, over seeds 601–650: **0.45 at d2 and 0.70 at d3** (design:
40% and 65%; v1.0.0: 0.45 and 0.69, the difference is seed 634). Most of the remainder is structural: collisions, fraud variants and escalations are traps by
construction, and so are most d3 grievance types. d1 (smoke only) plants none.

## What the oracle checks

Per trigger, on the effect ledger (world before vs after the trigger):
- **Each expected email**: one new Sent message whose recipients (To + CC + BCC) are exactly the expected set, with the
  expected subject parts and body parts (whitespace collapsed, letter case ignored). A Legal and HR Director route may
  be one email to both or one to each. Per kind:
  - *forward*: the subject is exactly `HR request <Employee ID>: <Category>` (letter case and the spaces around `:`
    ignored): no `Fwd:` prefix, no second category;
  - *acknowledgement*: a line says `Your request has been routed to <Category>` followed by `.` or the end of the line;
    no other category is named; no sentence claims the request was changed, approved or done (a narrow phrase check:
    first-person "I have updated / made the change", "has been approved / reset / granted", "is now approved", "no
    further action"; conditional forms such as "once it has been approved", quoted `>` lines and the employee's own
    text are not claims);
  - *fraud report*: the subject starts with `Possible fraud` and holds the email's subject; no resolution claim;
  - *week close*: the body's `<label>: <number>` lines are exactly the eight labels in policy order (bullets, a
    greeting or a sign-off are fine; a `Total: 30` line or reordered lines are not), no Directory name, Employee ID or
    Case ID, and each number equals what POLICY section 8 counts **in `world_before`**: this week's Sent mail (from
    Monday 00:00 UTC) whose subject is `HR request <Employee ID>: <Category>`, the `Possible fraud` emails, and the
    tracker rows Filed this week whose Status starts with `Routed to`. In carry mode that is the arm's own record, so
    a missed, duplicated or misrouted forward is charged where it happened and in the end-of-week verdict, never a
    second time at the close; and an arm that ignores its Sent mail and re-derives the counts from the inbox misses
    the week-boundary forward. The AutomationBench assertion for the close is built with the same counts.
- **Grievance Status**: the row's Status is `Routed to <handler>`, and no other cell changed.
- **Policy Log**: the appended row (Effective to the minute, Parameter, Value, Approved by).
- **Escalation**: a new #automation-review message naming the trigger id.
- **The envelope**: nothing else created, changed or removed (marking mail read and labels are harmless).
- **Confidentiality**: no Slack message created or changed in this trigger contains a Case ID; on a grievance trigger
  none contains that grievance's details: its Case ID in any separator form (`GR 2026 141`, `case 141`, `#141`), the
  employee's name (full or last) or Employee ID (any form), the tracker's Manager, anyone the Description names, or
  six consecutive words of the Description.
- **AutomationBench's own handlers** on an attribution view (this trigger's messages and rows only):
  `gmail_message_sent_to_with_body_contains`, `gmail_message_not_sent_to` (legal@ on routine routes, the other
  matched category's mailbox, the stale Payroll mailboxes, the fraudster, the manager on an HRBP route, the former
  manager), `google_sheets_row_updated`, `google_sheets_row_exists`, `slack_message_exists`,
  `slack_message_not_exists`.

After Friday's close the oracle gives a **separate end-of-week verdict** (`week_state`; never part of the close
trigger's own `pass`): the Grievance Tracker exactly as the week's correct handling leaves it; the Policy Log rows as a
multiset; the Routing Rules and the Employee Directory unchanged; per address, the number of emails sent this week
(exactly once); no Case ID in any Slack message and no grievance details (any week's grievance, last week's included)
in the week's new ones; the week's new Slack messages are exactly the expected escalations; no pre-existing message
edited; plus AutomationBench's `slack_message_not_exists` per Case ID and `gmail_message_not_sent_to` for every mailbox
that should get nothing this week. A **clean week** is every trigger passing and this verdict passing.

Outcomes are `correct`, `abstained`, `miss` and `wrong`. `pass` includes the envelope; `pass_core` is reported beside it.

## Numbers [measured, $0, development evidence]

| Run | Result |
|---|---|
| Reference, dev seeds 610–614 (carry) | **156/156 triggers, 5/5 clean weeks**, at most 4 tool steps per trigger (the acceptance bar was ≥ 95%) |
| Reference, practice + dev 601–614 (gate) | 431/431, 14/14 clean weeks; rebased 610–614: 156/156 |
| Reference, all dev-range seeds 601–650 | 1,581/1,581, 50/50 clean weeks (requests 1,180, grievances 303, amendments 48, closes 50) |
| Triggers per week | d2 25–30, d3 34–38 (seeds 601–650) |
| Determinism, leakage | pass: identical hashes on regeneration, every `world_t` round-trips; email and row payloads equal the world after the delta; no truth vocabulary in payloads, world0 or POLICY.md; serve rows hold only POLICY.md + payload; the reference imports only `base64, datetime, json, re, urllib` |
| Oracle mutation score (610–614) | **3,606/3,606 killed (1.00)**, 38 operators (dropped, duplicated, re-addressed, CC'd or unsent email; missing name, ID or Case ID; wrong category in subject or acknowledgement; wrong Case ID; Status wrong, reverted or another cell edited; Policy Log row dropped, wrong value, approver or time, or an extra row; escalation dropped, in another channel, without the trigger id or with a Case ID; summary count off, line missing, a name, an Employee ID or a Case ID in it; Directory or Routing Rules edited; extra email, CC to legal@, post or sink post; old message deleted or edited) |
| Oracle specificity (610–614) | 1,378/1,378 policy-neutral variants accepted (letter case, trailing period, extra spaces or text, recipient address case, a two-handler route split into one email each, Status case, a minute-precision Effective, summary bullets, marking mail read); an equivalent solver (one email per recipient, another Effective format, the channel by id) passes 156/156 |
| Trap coverage, label streams 610–613 | T-authority 12, T-format 29, T-lookalike 14, T-note 20, T-stale 38 (each ≥ 5) |
| Tests | `pytest`: **72 passed** in about 330 s |

Controls on dev seeds 610–614 (156 triggers, five weeks). Every control fails. `null` passes exactly the 5 no-op
triggers (automatic replies and unauthorized amendments). The 30-line `naive` heuristic scores **0.458 on the d3 dev
streams** (gate: < 0.60) and 0.643 at d2.

| Control | Pass | Clean weeks | Not correct |
|---|---|---|---|
| `null` | 5/156 (0.032) | 0/5 | 151 miss |
| `echo` | 0/156 (0.000) | 0/5 | 156 wrong |
| `naive` | 87/156 (0.558) | 0/5 | 8 miss, 61 wrong |
| `whole-body` | 148/156 (0.949) | 1/5 | 8 wrong |
| `first-keyword` | 140/156 (0.897) | 0/5 | 16 wrong |
| `ignore-policy-log` | 138/156 (0.885) | 2/5 | 18 wrong |
| `any-approver` | 153/156 (0.981) | 4/5 | 3 wrong |
| `ignore-effective` | 148/156 (0.949) | 3/5 | 8 wrong |
| `no-fraud-check` | 142/156 (0.910) | 0/5 | 14 wrong |
| `ack-fraud` | 142/156 (0.910) | 0/5 | 14 wrong |
| `domain-sender` | 150/156 (0.962) | 2/5 | 6 wrong |
| `display-name-sender` | 137/156 (0.878) | 0/5 | 19 wrong |
| `honor-cc` | 145/156 (0.929) | 0/5 | 11 wrong |
| `no-escalation` | 143/156 (0.917) | 0/5 | 8 miss, 5 wrong |
| `auto-as-request` | 150/156 (0.962) | 2/5 | 3 abstained, 3 wrong |
| `signature-name` | 148/156 (0.949) | 1/5 | 8 wrong |
| `severity-only` | 148/156 (0.949) | 1/5 | 8 wrong |
| `manager-always` | 151/156 (0.968) | 3/5 | 5 wrong |
| `manager-anywhere` | 152/156 (0.974) | 3/5 | 4 wrong |
| `tracker-manager` | 150/156 (0.962) | 2/5 | 6 wrong |
| `exact-severity` | 154/156 (0.987) | 4/5 | 1 abstained, 1 wrong |
| `case-id-in-slack` | 148/156 (0.949) | 1/5 | 8 wrong |
| `amend-display-name` | 144/156 (0.923) | 3/5 | 12 wrong |
| `count-all-sent` | 151/156 (0.968) | 0/5 | 5 wrong |
| `names-in-summary` | 151/156 (0.968) | 0/5 | 5 wrong |

A test asserts that each one-defect control fails on at least one trigger carrying the trap its broken rule resolves.
A further test re-addresses every reference forward to another category's mailbox, and every grievance route to
another handler (the plausible-but-wrong run), and checks that each one is graded `wrong`.

The one-defect controls score 0.88–0.99 per trigger, the band the hypothesis expects of a careful agent. Clean weeks
(0–4 of 5) separate them better than the per-trigger rate.

## Fixed while building (2026-10-15)

- **A row-number collision in the generator.** The first new grievance took the row number of the last world0 row
  (`1 + n` instead of `2 + n`). The reference then read the previous row and routed the wrong case: 23/30 on the first
  dev stream. Found by the reference, fixed in the generator.
- **A summary counted twice.** The oracle parsed `body_plain` and AutomationBench's generated `body_html` together, so
  every count line appeared twice. It now parses the plain body (or the HTML with tags stripped).
- **Two mutants that were not violations.** The first mutation run left 10/3,601 alive: summary mutants that added a
  name and an Employee ID that are not in the Directory. The mutants now use a real Directory row. The oracle also now
  rejects any `EMP-####` or `GR-####-###` pattern in the summary, not only the Directory's own values.
- **The leakage word list flagged the policy itself** ("look-alike" is policy text); the list keeps the label
  spelling `lookalike` only.
- **The naive control ran out of tool steps** at the week close (one step per Sent message, over the 49-step budget).
  It now batches its reads, so it fails on the policy and not on the harness.

## Fixed after review (2026-10-21, v1.1.0)

An adversarial review (probe solvers W1–W9 and correct variants C1–C3 on seeds 610–611) found six defects; no blocker
or major. Every probe that passed 65/65 now fails where the policy is broken, and the correct variants still pass every
trigger and week (`tests/test_inbox.py`, section "review fixes").

| # | Finding (severity) | Fix | Regression evidence |
|---|---|---|---|
| 1 | The close's counts were fixed from the generator's ideal handling, not the Sent mail in `world_before`: an arm that ignored its Sent mail and re-classified the inbox was rewarded (W8: 65/65), and an arm that counted faithfully after an earlier error was charged twice (W9) (medium) | The close is graded against POLICY section 8 applied to `world_before` (`oracle.derive_counts`; the AutomationBench assertion uses the same numbers). The end state is a separate end-of-week verdict (`week_state`), outside the close's pass. The forward subject is a per-trigger check. world0 (d2, d3) holds a request dated Sunday night whose forward went out after Monday 00:00 UTC, so re-deriving from the inbox gives a different number | W8: every forward fails at its own trigger and the close fails; W9: one failure at the duplicate (envelope), the close passes, the week verdict fails on `end.mail-counts`; controls `fwd-subject-shape` (close never charged) and `recount-inbox` (fails at the close only) |
| 2 | Grievance details in Slack were not checked, only the `GR-####-###` pattern (W2: 65/65) (medium) | On a grievance trigger, any new or changed Slack text with the Case ID in any separator form, the employee's name or Employee ID, the tracker's Manager, anyone the Description names, or six consecutive words of the Description is a leak (`slack.no-grievance-details`); the end-of-week verdict scans the week's new messages against every grievance (prefixed case numbers only). POLICY section 6 now spells out what "details" are | W2 fails at both unknown-severity triggers; control `details-in-slack`; five new mutants (description, name, ID, `case 141`, `GR 2026 141`) all killed |
| 3 | Substring checks accepted an acknowledgement naming several categories (W1), a resolving acknowledgement (W3), a fraud report without the original subject that claimed the details were updated (W5), and a wrong-shaped forward subject (W6); the `resolve-directly` trap had no check (medium) | Acknowledgement: `routed to <Category>` then `.` or end of line, no other category named; forward subject anchored; fraud subject must start with `Possible fraud` and hold the email's subject; a narrow resolution-claim check on acknowledgements and fraud reports (quoted and the employee's own text excluded; conditional forms allowed). POLICY section 5 states each rule | W1, W3, W5, W6 fail at their own triggers; controls `multi-category-ack`, `resolve-ack` (fails on `resolve-directly` triggers), `fraud-subject`; mutants for each shape; equivalents (spacing, conditional wording, extra subject text) accepted |
| 4 | The summary oracle accepted reordered lines and extra `<label>: <number>` lines that POLICY section 8 forbids (W4: 65/65) (low) | The count lines must be exactly the eight labels in order; bullets, a greeting and a sign-off stay accepted. POLICY section 8 now says so ("a greeting or a sign-off around them is fine; no other `<label>: <number>` line") | W4 fails at the close; control `summary-extra-lines`; mutants `summary-reordered`, `summary-extra-count-line`; C3 (bullets, greeting, sign-off) passes |
| 5 | The truth repeats the reference's algorithm; two policy-text gaps (bank markers "contains" vs whole-phrase matching; which moment fixes the Payroll mailbox) (low) | POLICY section 5: the bank markers match "as a whole phrase and ignoring letter case"; the Payroll mailbox is the one "in force at the event's `at`". The generator keeps every payroll request at least 5 minutes from the amendment and asserts that the email's Date and the `at` fall on the same side. This redrew one week: seed 634's attempt 1 had a payroll request one minute before the amendment (attempt 2 is used now). The second-reader gate is still open (below) | `test_payroll_requests_are_clear_of_the_amendment` (seeds 601–650), `test_policy_text_matches_the_oracle` |
| 6 | The README said 72 tests; a fresh run collected 69 (low) | Numbers re-measured on v1.1.0 (table above) | this README |

`PLAN_KEY` stays `1.0.0`, so every trigger (payload, text, id, time) on every seed except 634 is the one 1.0.0 drew
(`test_triggers_are_unchanged_since_1_0_0`; checked on 601–650 against the 1.0.0 generator). The week-boundary
records draw from their own RNG. Differences between the 1.0.0 and 1.1.0 numbers therefore come from the oracle and
the three world0 records, not from different weeks.

## Limits and not done yet

- **The resolution-claim check is a phrase heuristic.** It catches first-person and perfect-passive claims ("I have
  made the change", "your password has been reset", "it is now approved", "no further action") and allows conditional
  wording, routing words and quoted text. A model arm could word a claim it misses ("all sorted for you") or, less
  likely, a benign sentence it flags; `test_resolution_claim_detector_is_narrow` pins both lists. Look at flagged
  acknowledgements by hand before reading a model arm's failures as resolutions.
- **The two readings are template-aware.** The keyword rule is mechanical, but whether the reference's code reading
  generalises is not shown. The generator's request and description templates are finite. The generator's
  classifier and the reference's agree on every email and grievance of seeds 601–614 (a test), but two implementations
  by the same author agreeing does not prove a second reader reads the policy the same way. The second-reader fairness
  gate (§3.11 gate 6) still needs a session that did not write the family (not run in the 2026-10-21 fixes either;
  the session that fixed the review findings is part of the same build line). Points most likely to be disputed:
  - the collision rule where intuition differs: "Parental leave and dental coverage" → Leave / PTO (24 h beats 48 h);
    "Moved - insurance question" → Address Change;
  - a manager named first but as the person the employee "told" (not generated; the templates always name the
    respondent first);
  - "Value:" parsing and the Effective format of an amendment row (graded to the minute).
- **Trap shares sit above the design** (0.45 / 0.69 against 0.40 / 0.65), because the structural traps alone are
  already about a third of a week.
- **The runner and arms do not exist yet.** The stream runner (`stream.mjs`), the bridge commands (`abr-gen`,
  `abr-apply`, `abr-grade`) and the arms (§3.7–3.8) are not built; here everything runs in one process. Model arms will
  reach the same `env_response` path through `bridge.py serve` with the rows `gen.serve_input` writes.
- **Carry-mode cascades.** An arm that accepts an unauthorized amendment misroutes every later payroll request: those
  are the arm's own consequences, graded at each trigger. A missed or duplicated forward is charged at its own trigger
  and in the end-of-week verdict, not again at the close, which counts the arm's own Sent mail (v1.1.0).
- **Seed ledger.** It has no entries for this family; no labelled stream was run.
