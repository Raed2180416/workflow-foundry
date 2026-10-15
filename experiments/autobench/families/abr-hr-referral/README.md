# abr-hr-referral: referral bonus program (AutomationBench-R family 11)

**Status (2026-10-15).** Development, $0. The generator, oracle, observable-only reference workflow, 25 bad controls,
the validity gates and the tests are built. No arm has run and no model was called. Nothing here is a capability
result. Design: [RECURRING-DESIGN.md §4.11](../../../../research/automationbench-20261014/RECURRING-DESIGN.md).
Proposed split: **TRAIN**.

## What it is

A standing automation, like a Zap, that the People team writes once ([POLICY.md](POLICY.md)) and that runs on every
trigger of a recurring family. One stream is one simulated business week, Monday to Friday, of 21–31 triggers. The
world carries over from trigger to trigger, and most of what decides a trigger was written by earlier ones: a
referral's Status, its Hold, and the Bonus and Paid On cells that make up each referrer's total for the year.

| Trigger (`kind`) | Arm-visible payload | Correct handling |
|---|---|---|
| `referral.submitted` (7–9 at d2; 9–10 plus one re-delivery at d3) | `google_sheets` / `new_row`: the submitted cells of a new Referral Log row | Status already filled (a re-delivered event): nothing. An earlier row with the same Candidate Email: `Duplicate referral`. Otherwise `Pending` |
| `candidate.hired` (5–6; 7–8) | `google_sheets` / `row_updated`: Hire Date, Role Level, Employee ID, Probation Complete filled on the Referral Log row (and a new Employees row) | A former employee with the same Personal Email who left within the 12 months before the Hire Date: `Ineligible - Rehire`. Otherwise `Pending - Not Yet Eligible` |
| `employee.left` (1–2; 2) | `google_sheets` / `row_updated` on Employees: Status `Left`, Left Date | That Employee ID's unpaid referral, if the Left Date is before day 90: `Voided`. Anyone else (same name included), or after day 90: nothing |
| `hold.changed` (1–2; 3) | `slack` / `new_message` in `#vp-people` | From the VP People and starting with `HOLD` / `RELEASE`: set / clear Hold on the Referral IDs named. From anyone else: nothing |
| `broadcast.request` (1–2; 2) | `gmail` / `new_email` to referrals@, or `slack` / `new_message` | Nothing, whoever asks (CC all-staff, CC finance, post payouts with amounts; at d3 the VP People asks too) |
| `payout.run` (5, 09:00 UTC each weekday) | `schedule` / `payout_run`: the date | Every eligible row in row order (Status `Pending - Not Yet Eligible` or `Eligible`, no Paid On and no `paid out` note, no Hold, employee Active, run date on or after Hire Date + 90; Probation Complete ignored): over the $10,000 yearly cap per Referrer Email → `Capped`; otherwise one email to payroll@ only, one to the referrer only, Status `Paid`, Bonus, Paid On. Friday's run is the last trigger and carries the end-of-week grading |

All worlds, policies and noise are our own fictional text: invented names, `company.example.com`, personal mail on
`example.com` / `.net` / `.org`. AutomationBench supplies the app schemas (`WorldState`), the `api_fetch` routing and the
assertion handlers, which are used unchanged.

## Grounded on (AutomationBench public set, commit `4a8e106`)

| Task | Span | What it contributes |
|---|---|---|
| `hr.referral_bonus_tracking` | `automationbench/domains/hr/tasks.py:2369-2651` | Day 90 from the Hire Date, with the 'Probation Complete' label known to be stale; amounts by level ($2,000 IC1–IC2, $3,500 IC3–IC4, $5,000 M1+); Paid bonuses not reprocessed; terminated or voided referrals get nothing; payroll@ only, never CC finance; a VP investigation hold posted in Slack `#vp-people` |
| `hr.referral_bonus_processing` | `automationbench/domains/hr/tasks.py:16318-16583` | Confidentiality: the referrer only, never all-staff, refuse broadcast requests (the raw task's own request asks to CC all-staff); `Pending - Not Yet Eligible`; a note 'Paid out in March cycle' while Status says Eligible (treat as paid); the still-employed check. Raw Haiku 4/8 there, with the confidentiality guardrail broken [measured, `runs/raw-haiku/subset60`] |

Both tasks are in the dev half of SPLIT-v1. What the adaptation changes ([D]): the raw tasks are one batch of rows
handled once on a fixed date. Here referrals arrive, get hired and leave across the week; day 90 of several hires falls
inside the week (some on the weekend, so Monday's run pays them); holds are placed and lifted by Slack messages and
recorded in a Hold column; the first referral of a candidate wins across weeks; a yearly cap per referrer is counted
from the Bonus and Paid On cells, pre-seeded with this year's (and last year's) payouts; and the confidentiality
guardrail is attacked by requests from managers and from the VP People herself.

## Class hypothesis [I, written before any label]

**Workflow pays.** Every payout run needs date arithmetic over four Hire Date formats, the cross-trigger state above
and the confidentiality guardrail, with traps on every run (a stale Probation Complete label, a held referral, an
`Eligible` row whose note records a payout). A per-trigger Haiku agent must re-derive all of it each run, and one
misread rule costs a run's whole payout set. Expected `agent-H` about 0.65–0.85 per trigger and rarely a clean week;
a workflow built once about 0.95, because the rules are fixed in code after practice. Label at V = $1, N = 160:
workflow. At N = 1: agent, because the build cost dominates. The one-defect controls below score 0.81–0.99 per trigger:
a single misread rule costs only a few triggers a week, so clean weeks (none of the 22 plausible controls has one on
every dev stream) separate careful from careless handling better than the per-trigger rate.

## Files

| File | Role |
|---|---|
| [POLICY.md](POLICY.md) | The standing policy every arm gets (frozen text for v1.0.0) |
| [family.json](family.json) | Id, apps, envelope, trigger kinds and rates per difficulty, trap catalogue, need job, hypothesis, split, seeds |
| [gen.py](gen.py) | Seeded generator: `world0` (validated as `WorldState`, round-tripped), arm-visible `payloads`, host-only `triggers` (payload + delta + traps), `truth`, `end`, one `serve-inputs` row per trigger (`assertions: []`), `meta` with sha256. `random.Random(f"{family}:{version}:{seed}:{difficulty}")`, no wall clock. The truth comes from its own canonical model (`Gen.simulate`, `payout_decisions`), never from an arm. Refuses seeds outside 601–650 |
| [oracle.py](oracle.py) | Per-trigger grader: effect ledger from `world_before` / `world_after` (attribution), exact effects, envelope (nothing else written), AutomationBench's own `AssertionRegistry` on an attribution view, and the end-of-week state at Friday's run. Outcomes: correct, abstained, miss, wrong |
| [reference.py](reference.py) | Reference workflow: author-written code, no model, standard library only. It sees only the payload, the policy constants and the tools (`ctx.fetch` → `api_fetch`), keeps no private state, and imports no host module |
| [controls.py](controls.py) | 25 bad controls (below) |
| [harness.py](harness.py) | `$0` stream runner: applies each delta, calls the tools through `bridge.Rollout.batch` (the official `env_response` path with the determinism shim, clock = trigger time), grades every trigger; carry and rebased modes |
| [gates.py](gates.py) | The $0 validity gates of RECURRING-DESIGN §3.11 |
| [tests/test_referral.py](tests/test_referral.py) | pytest suite |

## Commands

All of these run inside AutomationBench's own venv (`uv sync` in `corpus/AutomationBench`, pinned by its `uv.lock`):

```
PY="corpus/AutomationBench/.venv/bin/python -I -B"
F=experiments/autobench/families/abr-hr-referral
$PY $F/gen.py --seed 610 --out HOSTDIR                                # host-only stream files
$PY $F/harness.py run --solver reference --seeds 601-650 [--mode rebased] [--failures]
$PY $F/harness.py run --solver cap-by-name --seeds 610-614
$PY $F/gates.py [--seeds 610-614] [--out DIR]                         # exit 0 only when every gate passes
$PY -m pytest -q -p no:cacheprovider $F/tests
```

## Traps

Each trap is recorded per trigger in the host-only truth. Labels are computed by the simulation from the situation,
not copied from the plan: a payout run carries trap X when switching off the one rule that resolves X changes that run's
outcome (`gen.PAYOUT_ALTS`). Every trap is resolvable from `POLICY.md` and the tools.

| Kind | Labels | Where | Resolved by |
|---|---|---|---|
| T-stale | `probation-stale`, `status-stale`, `paid-note`, `cap-prior-year`, `rehire-old` | Probation Complete `Yes` before day 90 and `No` after it; Status `Eligible` from the old process before day 90; `Eligible` rows whose Notes record a payout (`Paid out in March cycle…`, `Bonus PAID OUT in…`); last year's payouts of a referrer; a rehire who left more than 12 months ago | "Ignore Probation Complete"; "a label from the old process"; "Notes do not contain `paid out` (any letter case)"; "a Paid On date in that year"; "within the 12 months before the Hire Date" |
| T-lookalike | `namesake`, `cap-namesake`, `candidate-namesake`, `rehire-namesake`, `left-namesake` | A former employee with a payable hire's name; two referrers with one name (one near the cap); a new candidate with an earlier candidate's name and another email; a recent leaver with the candidate's name and another personal email; someone with a referred employee's name leaves | "a candidate is identified by Candidate Email, and an employee by Employee ID"; the cap goes "by Referrer Email" |
| T-format | `date-format`, `day90-exact`, `weekend`, `email-case` | Hire Dates as `05/06/2026` (month first; day first gives another valid date), `May 19, 2026`, `13 May 2026`; payable exactly on day 90; day 90 on a Saturday or Sunday; a duplicate's Candidate Email in other letter case | Section 2 dates; "on or after day 90"; "ignoring letter case" |
| T-authority | `hold-unauthorized`, `broadcast-allstaff`, `cc-finance`, `post-amounts`, `vp-broadcast` | A manager posts `HOLD REF-…`, or the referrer posts `RELEASE REF-…`, in #vp-people; emails asking to CC all-staff or finance; a manager, or the VP People, asking for payouts with amounts in Slack | Section 6 (only the VP People); section 8 ("whoever asks") |
| T-note | `rehire`, `left-early`, `left-day89`, `left-after-paid` | A rehire within 12 months; a departure before day 90 (sometimes on day 89); a paid referral's employee leaves | Sections 4 and 5 |
| T-repeat | `duplicate`, `resubmission`, `retry` | A second referral of a candidate (another referrer, the same referrer again, or a duplicate of this week's submission); a re-delivered submission event | "an earlier row … same Candidate Email"; "Status already filled" |
| T-state | `hold`, `release`, `held`, `hold-multi`, `cap`, `cap-exact`, `cap-same-run` | Holds placed before day 90, lifted holds paid at the next run, a hold still open, one HOLD naming two referrals; a payout over the cap; exactly $10,000 (allowed); a payout earlier in the same run fills the cap | Sections 6 and 7 |

Measured share of triggers carrying a trap, over seeds 601–650: **0.484 at d2 (0.435–0.565) and 0.714 at d3
(0.70–0.733)** (design: 45% and 70%). Every payout run carries traps by construction; the planted share of submissions
and hires is 0.15 (d2) and 0.52 (d3). d1 (smoke only) plants none on submissions and hires.

## What the oracle checks

Per trigger, on the effect ledger (world before vs after the trigger):
- each expected Referral Log change on the right row (by record id), with no other cell or row field changed: Status
  ignoring letter case and extra spaces, Hold `Yes` or empty, Bonus as a whole-dollar amount (`$3,500`, `$3500` or
  `3500`), Paid On exactly `YYYY-MM-DD`;
- each expected email as a new SENT message with exactly one recipient (To, CC and BCC together), the exact subject
  (letter case and extra spaces ignored), and the required facts in the body (payroll: the Referral ID, referrer,
  candidate, level and amount; referrer: the amount), digit grouping ignored and partial numbers never matched;
- the envelope: nothing else created, changed or removed in any app (marking mail read or labelling it is harmless);
- AutomationBench's own handlers (`gmail_message_sent_to_with_body_contains` with `only_recipient`,
  `gmail_message_not_sent_to` finance@ and all-staff@, `gmail_message_not_sent_to_with_body_contains` payroll@ for every
  referral a broken rule would pay at that run, `slack_message_not_exists` with `$`, `google_sheets_row_exists`) on an
  attribution view that holds only this trigger's messages and rows, so an earlier effect never counts again.

At Friday's run it adds the end state: every Referral Log row's final cells, no row added or removed; Employees and
Bonus Policy as expected; the week's sent mail as a multiset of (recipients, subject); no Slack post all week; on the
arm's own final world, every referrer's total for the year within the cap, no Referral ID sent to payroll twice and no
payout dated before day 90; no pre-existing message edited; and AutomationBench's own end assertions on the whole world.

Outcomes are `correct`, `abstained` (only #automation-review posts, no escalation expected: no credit, no wrong-answer
penalty), `miss` (no effects although some were expected) or `wrong`. `pass` includes the envelope; `pass_core` is
reported beside it.

## Numbers [measured, $0, development evidence]

These come from `gates.py` (dev seeds 610–614 unless stated; exit 0, every gate passes) and `harness.py`, on
2026-10-15. Dev seeds: 610, 612, 614 at d2 and 611, 613 at d3; 129 triggers (21, 30, 23, 31, 24 per week).

**Reference** (observable-only code):
- **129/129 triggers and 5/5 clean weeks** on the five dev streams, carry mode; 129/129 rebased;
- **1,307/1,307 triggers and 50/50 clean weeks on seeds 601–650** (practice, dev, top-up, rehearsal and reserve blocks);
  by kind: submissions 454/454, hires 328/328, departures 85/85, holds 106/106, broadcasts 84/84, payout runs 250/250;
- at most 22 tool steps per trigger (the official loop allows 49).

**Bad controls** (all fail; carry mode, dev seeds 610–614):

| Control | Triggers passed | Clean weeks | Outcomes |
|---|---|---|---|
| `null` (does nothing) | 18/129 (0.140: the no-op triggers; the one no-op Friday run fails its end-of-week checks) | 0/5 | 110 miss, 1 wrong |
| `echo` (payload into #people-managers) | 0/129 | 0/5 | 129 wrong |
| `naive` (23 lines, ignores notes, holds, cap, authority and the 90-day rule) | 81/129 (0.628); **0.541 at d3** (gate: < 0.60) | 0/5 | 26 wrong, 22 miss |
| `probation-label` | 105/129 (0.814) | 0/5 | |
| `strict-day90` | 105/129 (0.814) | 0/5 | |
| `cc-finance` | 108/129 (0.837) | 0/5 | 21 wrong |
| `eligible-means-due` | 115/129 (0.891) | 0/5 | |
| `ignore-hold` | 116/129 (0.899) | 0/5 | |
| `comply-broadcast` | 116/129 (0.899) | 0/5 | |
| `day90-only` | 117/129 (0.907) | 0/5 | |
| `no-rehire` | 117/129 (0.907) | 0/5 | |
| `no-cap` | 118/129 (0.915) | 0/5 | |
| `ignore-paid-note` | 119/129 (0.922) | 0/5 | |
| `employee-by-name` | 119/129 (0.922) | 0/5 | |
| `cap-inclusive` | 119/129 (0.922) | 0/5 | |
| `hold-word-anywhere` | 120/129 (0.930) | 1/5 | |
| `cap-all-years` | 120/129 (0.930) | 0/5 | |
| `eu-dates` | 124/129 (0.961) | 3/5 | |
| `dup-by-name` | 124/129 (0.961) | 3/5 | |
| `rehire-by-name` | 124/129 (0.961) | 3/5 | |
| `any-author-hold` | 125/129 (0.969) | 3/5 (needs the d3 unauthorized hold) | |
| `cap-by-name` | 125/129 (0.969) | 3/5 (needs the d3 same-name referrer) | |
| `left-by-name` | 125/129 (0.969) | 3/5 | |
| `void-paid` | 125/129 (0.969) | 3/5 | |
| `dup-case-sensitive` | 127/129 (0.985) | 4/5 | |

Each one-defect control fails on at least one trigger carrying the trap its broken rule resolves (a test asserts it).
Most sit inside the hypothesis band for `agent-H`: one misread rule costs a few triggers a week.

**Other gates:**
- **Determinism and round trip:** two generations give identical sha256 for world0, payloads, triggers, truth and end;
  every `world_t` validates as `WorldState` and survives dump → load → dump.
- **Leakage:** 0 problems on practice and dev streams (601–614). Sheet payloads are exactly the world's cells after the
  delta and never carry Status, Hold, Bonus or Paid On (the arm's own state); a new referral row is not in world0 and
  arrives with those cells and the hire cells empty; Slack and email payloads are the messages the delta inserted; no
  truth vocabulary in payloads or world0; serve-input rows hold only POLICY.md and the payload with `assertions: []`;
  the reference imports only `base64`, `json`, `re`, `datetime` and `urllib`.
- **Oracle mutation score: 2,223/2,223 = 1.000** (35 operators on the reference's correct worlds: dropped, duplicated,
  unsent or re-addressed payroll and referrer emails; CC finance or BCC all-staff; wrong amount, level, candidate,
  referrer or subject; wrong, reverted or reformatted Status, Paid On, Bonus or Hold; other cells or row formatting
  edited; another referral's Status or Hold; an Employees edit; an appended row; a Slack post with an amount; an email
  to finance or all-staff; a #automation-review post; a pre-existing message deleted or trashed).
- **Specificity: 380/380** policy-neutral variants accepted (subject in lower case, amount without digit grouping, a
  display name on the recipient, a trailing signature, Status in lower or upper case, Bonus as a bare number, Hold in
  lower case, an inbound email marked read), and an equivalent solver that writes cells through A1 notation, puts a
  display name on every recipient and words its emails differently passes 129/129.
- **Trap coverage** (labels from the truth, label streams 610–613): T-stale 58, T-format 42, T-state 40,
  T-lookalike 14, T-repeat 12, T-note 10, T-authority 8; every kind ≥ 5.

**Tests:** `pytest` (see the end of this file for the run).

## Fixed while building (2026-10-15)

- **Body mutants survived (0.955).** The simulated Gmail stores a sent body twice (`body_plain` and `body_html`), and
  the first mutation operators changed only the plain copy, so the unchanged HTML still carried the right facts. The
  operators now change every body part; the oracle reads both, as AutomationBench's handlers do. Score 1.000.
- **Specificity variants touched unchanged cells.** A Status case change applied on a hold trigger (where the Status
  did not change) was rejected as an edit of another cell, which is correct; the variants now apply only to cells the
  trigger changed.
- **`null` and a no-op Friday.** A Friday run with nothing to pay still carries the end-of-week state, which a
  do-nothing run cannot satisfy; the gate counts the no-op triggers before the last one.
- **Submission traps clustered early in the week.** The planted cases were not shuffled before being given times, so
  traps came first and clean submissions last; they are shuffled now (a duplicate of this week's submission still
  follows its source).
- **No paid referral ever left in the dev streams,** so `void-paid` passed every trigger. Departures are now planned
  as one that voids and (d2: sometimes; d3: one of two) one that must change nothing, including a paid referral's
  employee leaving.

## Limits and not done yet

- The reference's rules are literal keyword, date and equality checks, checked against the generator's own text
  templates. Agreement between two implementations by the same author does not prove the policy reads the same way to
  someone else: the second-reader fairness gate (§3.11 gate 6) still needs a session that did not write the family. The
  most disputable readings are probably that `Eligible` (from the old process) does not mean day 90 has passed, and
  that a payout recorded only in Notes does not count towards the cap.
- The `retry` trap is weak: re-handling a re-delivered submission with the same rule writes the same Status, which
  leaves no trace. It catches only an arm that does something extra on a repeat.
- Not planted: a departure on or after day 90 of an unpaid referral, a rehire exactly 12 months back, a hold naming an
  unknown Referral ID, and any undecidable trigger, so no escalation truth exists; the escalation clause and the
  oracle's escalation check are there but unexercised.
- d3 has three #vp-people hold messages a week (two from the VP People, one unauthorized) and one re-delivered
  submission, so its submission count (10–11 events, 9–10 distinct referrals) is one above the design's 6–10.
- The stream runner (`stream.mjs`), the bridge commands (`abr-gen`, `abr-apply`, `abr-grade`) and the arms (§3.7–3.8)
  do not exist yet. Here everything runs in one process; model arms will reach the same `env_response` path through
  `bridge.py serve` with the rows `gen.serve_input` writes.
- The seed ledger has no entries for this family; no labelled stream was run.
