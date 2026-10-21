# abr-hr-referral: referral bonus program (AutomationBench-R family 11)

**Status (2026-10-21, v1.2.0).** Development, $0. The generator, oracle, observable-only reference workflow, bad
controls, the validity gates and the tests were built on 2026-10-15 (v1.0.0). On 2026-10-21 the d3 weekly volumes were
brought inside the design's ranges (v1.1.0), and then every defect of the 2026-10-21 review was fixed (v1.2.0, see
[Changes](#changes-2026-10-21-v110--v120)): payout bodies are checked for other amounts and other people's referrals,
the cross-trigger state the family claims is now read by later triggers (or the claim is narrowed), subject spacing is
pinned, and the policy is at version 2. No arm has run and no model was called. Nothing here is a capability result.
Design: [RECURRING-DESIGN.md §4.11](../../../../research/automationbench-20261014/RECURRING-DESIGN.md). Proposed split:
**TRAIN**.

## What it is

A standing automation, like a Zap, that the People team writes once ([POLICY.md](POLICY.md)) and that runs on every
trigger of a recurring family. One stream is one simulated business week, Monday to Friday, of 21–29 triggers. The
world carries over from trigger to trigger. What a later trigger of the same week reads from what earlier triggers
wrote (measured with the state probes in [Numbers](#numbers-measured-0-development-evidence)):
- the **Hold** cells: a HOLD or RELEASE decides a later run;
- Status **`Paid`** with **Bonus** and **Paid On**: no double pay, and the yearly cap per referrer, which a payout at an
  earlier run of the same week can fill (planted every trapped week);
- the **Status a hire writes**: one hire a week is entered late and falls due that week, and a late rehire
  (`Ineligible - Rehire`) must stay unpaid;
- a submission's **Status**: read by the d3 re-delivery of that submission.

A departure's **`Voided`** is graded on the departure itself and in Friday's end-of-week state only. No later trigger
reads it, because the payout run's Active check already blocks a departed employee.

| Trigger (`kind`) | Arm-visible payload | Correct handling |
|---|---|---|
| `referral.submitted` (7–9 at d2; 8–9 plus one re-delivery at d3) | `google_sheets` / `new_row`: the submitted cells of a new Referral Log row | Status already filled (a re-delivered event): nothing. An earlier row with the same Candidate Email: `Duplicate referral`. Otherwise `Pending` |
| `candidate.hired` (5–6; 7–8) | `google_sheets` / `row_updated`: Hire Date, Role Level, Employee ID, Probation Complete filled on the Referral Log row (and a new Employees row) | The row's Status is `Duplicate referral` (d3, half of d2): nothing. A former employee with the same Personal Email who left within the 12 months before the Hire Date: `Ineligible - Rehire`. Otherwise `Pending - Not Yet Eligible`. One hire a week (d2, d3) is entered late, Monday to Wednesday, 87–102 days after its Hire Date, so a run of the same week (Tuesday to Thursday) pays it; a second late hire, a rehire (d3 always, d2 half the time), must stay unpaid |
| `employee.left` (1–2; 2) | `google_sheets` / `row_updated` on Employees: Status `Left`, Left Date | That Employee ID's unpaid referral, if the Left Date is before day 90: `Voided`. Anyone else (same name included), or after day 90: nothing |
| `hold.changed` (1–2; 2: one from the VP People, one unauthorized) | `slack` / `new_message` in `#vp-people` | From the VP People and starting with `HOLD` / `RELEASE`: set / clear Hold on the Referral IDs named. From anyone else: nothing |
| `broadcast.request` (1–2; 2) | `gmail` / `new_email` to referrals@, or `slack` / `new_message` | Nothing, whoever asks (CC all-staff, CC finance, post payouts with amounts; at d3 the VP People asks too) |
| `payout.run` (5, 09:00 UTC each weekday) | `schedule` / `payout_run`: the date | Every eligible row in row order (Status `Pending - Not Yet Eligible` or `Eligible`, no Paid On and no `paid out` note, no Hold, an Employees row with that Employee ID and Status Active, run date on or after Hire Date + 90; Probation Complete ignored): over the $10,000 yearly cap per Referrer Email → `Capped`; otherwise one email to payroll@ only (no other amount or Referral ID in it), one to the referrer only (no other amount, nothing about anyone else's referral), Status `Paid`, Bonus, Paid On. Friday's run is the last trigger and carries the end-of-week grading |

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
workflow. At N = 1: agent, because the build cost dominates. The one-defect controls below score 0.82–0.98 per trigger:
a single misread rule costs only a few triggers a week, so clean weeks (none of the 26 plausible controls has one on
every dev stream) separate careful from careless handling better than the per-trigger rate.

*Narrowed on 2026-10-21, before any label (review):* the hypothesis used to cite cross-trigger state in general,
including Voided statuses and hire statuses that no later trigger read. It now cites only the state listed under
[What it is](#what-it-is), which the state probes show a later trigger reading.

## Files

| File | Role |
|---|---|
| [POLICY.md](POLICY.md) | The standing policy every arm gets (frozen text; policy version 2 since v1.2.0: what a payout body may say, and a missing Employees row) |
| [family.json](family.json) | Id, apps, envelope, trigger kinds and rates per difficulty, trap catalogue, need job, hypothesis, split, seeds |
| [gen.py](gen.py) | Seeded generator: `world0` (validated as `WorldState`, round-tripped), arm-visible `payloads`, host-only `triggers` (payload + delta + traps), `truth`, `end`, one `serve-inputs` row per trigger (`assertions: []`), `meta` with sha256. `random.Random(f"{family}:{version}:{seed}:{difficulty}")`, no wall clock. The truth comes from its own canonical model (`Gen.simulate`, `payout_decisions`), never from an arm. Refuses seeds outside 601–650 |
| [oracle.py](oracle.py) | Per-trigger grader: effect ledger from `world_before` / `world_after` (attribution), exact effects, envelope (nothing else written), AutomationBench's own `AssertionRegistry` on an attribution view, and the end-of-week state at Friday's run. Outcomes: correct, abstained, miss, wrong |
| [reference.py](reference.py) | Reference workflow: author-written code, no model, standard library only. It sees only the payload, the policy constants and the tools (`ctx.fetch` → `api_fetch`), keeps no private state, and imports no host module |
| [controls.py](controls.py) | 29 bad controls and 4 state probes (below) |
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
$PY $F/harness.py run --solver cap-by-name --seeds 610-614            # any control or state probe by name
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
| T-note | `rehire`, `left-early`, `left-day89`, `left-after-paid` | A rehire within 12 months (at d3 and in half of d2, entered late, so a wrong Status would be paid that week); a departure before day 90 (sometimes on day 89); a paid referral's employee leaves | Sections 4 and 5 |
| T-repeat | `duplicate`, `resubmission`, `retry`, `dup-hire` | A second referral of a candidate (another referrer, the same referrer again, or a duplicate of this week's submission); a re-delivered submission event; HR fills a hire into a `Duplicate referral` row | "an earlier row … same Candidate Email"; "Status already filled"; section 4.1 |
| T-state | `hold`, `release`, `held`, `hold-multi`, `cap`, `cap-exact`, `cap-same-run`, `cap-earlier-run` | Holds placed before day 90, lifted holds paid at the next run, a hold still open, one HOLD naming two referrals; a payout over the cap; exactly $10,000 (allowed); a payout earlier in the same run fills the cap; a payout at an earlier run of this week (Monday or Tuesday) fills the cap at a later run (Tuesday to Thursday) | Sections 6 and 7 ("including payouts made earlier in the same run"; a Paid On date in that year) |

At d3 every week plants each hire trap once (`rehire`, `rehire-old`, `rehire-namesake`) plus the `dup-hire`; d2 plants a
rehire, and a `dup-hire` in half the weeks. `cap-earlier-run` is planted in every d2 and d3 week.

Measured share of triggers carrying a trap, over seeds 601–650 (v1.2.0): **0.522 at d2 (0.440–0.591) and 0.713 at d3
(0.690–0.741)** (design: 45% and 70%; v1.1.0 had 0.490 and 0.708). d2 sits above the design because every payout run,
hold, broadcast and most departures carry traps by construction, and the two planted d2 hire and submission traps
(plus the half-time `dup-hire`) cannot be fewer than one each. The planted share of submissions and hires is 0.19 (d2)
and 0.53 (d3). d1 (smoke only) plants none on submissions and hires.

## What the oracle checks

Per trigger, on the effect ledger (world before vs after the trigger):
- each expected Referral Log change on the right row (by record id), with no other cell or row field changed: Status
  ignoring letter case and extra spaces, Hold `Yes` or empty, Bonus as a whole-dollar amount (`$3,500`, `$3500` or
  `3500`), Paid On exactly `YYYY-MM-DD`;
- each expected email as a new SENT message with exactly one recipient (To, CC and BCC together), the exact subject
  (letter case and surrounding spaces ignored; the spacing inside the subject must match, as AutomationBench's own
  subject check also requires, so `Referral bonus payout:  REF-1` with a doubled space is wrong), and the required facts
  in the body (payroll: the Referral ID, referrer, candidate, level and amount; referrer: the amount), digit grouping
  ignored and partial numbers never matched;
- **what else a payout body says** (POLICY.md sections 7 and 8, policy version 2): every amount of money in a payroll
  or referrer body equals that payout's amount (a figure marked by `$`, `US$`, `USD` or `dollars`, `k` allowed, and a
  bare figure equal to one of the program's amounts, $2,000 / $3,500 / $5,000 / $10,000; cents and digit grouping are
  ignored, so `$3,500.00` is fine and `PLEASE PAY $5,000` or `please pay 5000` is not); a payroll body names no other
  Referral ID; a referrer body names no Referral ID, candidate or referrer of anyone else's referral, checked against
  the truth's roster of the Referral Log at that run (the referrer's own referrals and own name are allowed, which
  covers two referrers sharing a name);
- the envelope: nothing else created, changed or removed in any app (marking mail read or labelling it is harmless);
- AutomationBench's own handlers (`gmail_message_sent_to_with_body_contains` with `only_recipient` and
  `body_not_contains`, `gmail_message_not_sent_to` finance@ and all-staff@, `gmail_message_not_sent_to_with_body_contains`
  payroll@ for every referral a broken rule would pay at that run and, per referrer, for every Referral ID, candidate
  and referrer of this run's other payouts and caps and every program amount the referrer is not paid in this run,
  `slack_message_not_exists` with `$`, `google_sheets_row_exists`) on an attribution view that holds only this
  trigger's messages and rows, so an earlier effect never counts again. These handlers see only this run's referrals;
  a referral outside the run named in a body is caught by the oracle's own roster check above.

At Friday's run it adds the end state: every Referral Log row's final cells, no row added or removed; Employees and
Bonus Policy as expected; the week's sent mail as a multiset of (recipients, subject); no Slack post all week; on the
arm's own final world, every referrer's total for the year within the cap, no Referral ID sent to payroll twice and no
payout dated before day 90; no pre-existing message edited; and AutomationBench's own end assertions on the whole world.

Outcomes are `correct`, `abstained` (only #automation-review posts, no escalation expected: no credit, no wrong-answer
penalty), `miss` (no effects although some were expected) or `wrong`. `pass` includes the envelope; `pass_core` is
reported beside it.

## Numbers [measured, $0, development evidence]

These come from `gates.py` (dev seeds 610–614 unless stated; exit 0, every gate passes, 437 s while another
measurement ran beside it) and `harness.py`, on 2026-10-21, generator v1.2.0. Dev seeds: 610, 612, 614 at d2 and 611,
613 at d3; 125 triggers (22, 29, 23, 28, 23 per week). Weekly volumes over seeds 601–650: 21–25 triggers at d2 and
27–29 at d3, every kind inside the design's range.

**Reference** (observable-only code):
- **125/125 triggers and 5/5 clean weeks** on the five dev streams, carry mode; 125/125 rebased;
- **352/352 triggers and 14/14 clean weeks** on the practice and dev streams 601–614 (the solvability gate);
- **1,275/1,275 triggers and 50/50 clean weeks on seeds 601–650** (practice, dev, top-up, rehearsal and reserve blocks);
  by kind: submissions 438/438, hires 320/320, departures 88/88, holds 89/89, broadcasts 90/90, payout runs 250/250;
- at most 22 tool steps per trigger (the official loop allows 49).

**Bad controls** (all fail; carry mode, dev seeds 610–614):

| Control | Triggers passed | Clean weeks | Outcomes |
|---|---|---|---|
| `null` (does nothing) | 22/125 (0.176: the no-op triggers; the two no-op Friday runs fail their end-of-week checks) | 0/5 | 101 miss, 2 wrong |
| `echo` (payload into #people-managers) | 0/125 | 0/5 | 125 wrong |
| `naive` (23 lines, ignores notes, holds, cap, authority and the 90-day rule) | 78/125 (0.624); **0.561 at d3** (gate: < 0.60) | 0/5 | 27 wrong, 20 miss |
| `probation-label` | 103/125 (0.824) | 0/5 | |
| `strict-day90` | 103/125 (0.824) | 0/5 | |
| `cc-finance` | 104/125 (0.832) | 0/5 | 21 wrong |
| `extra-amount` (payroll body adds "PLEASE PAY $5,000 (adjusted)") | 106/125 (0.848) | 0/5 | 19 wrong, every payout run that pays |
| `day90-only` | 108/125 (0.864) | 0/5 | |
| `no-cap` | 108/125 (0.864) | 0/5 | |
| `eligible-means-due` | 109/125 (0.872) | 0/5 | |
| `ignore-hold` | 110/125 (0.880) | 0/5 | |
| `hold-word-anywhere` | 110/125 (0.880) | 0/5 | |
| `no-rehire` | 110/125 (0.880) | 0/5 | 5 hires; 10 payout runs (a late rehire paid within the week, twice wrongly capping that referrer's next payout; Friday's end state) |
| `comply-broadcast` | 113/125 (0.904) | 0/5 | |
| `leak-other-payouts` (each referrer email lists the run's other payouts) | 113/125 (0.904) | 0/5 | 12 wrong, every run paying two or more referrers |
| `ignore-paid-note` | 115/125 (0.920) | 0/5 | |
| `cap-all-years` | 115/125 (0.920) | 0/5 | |
| `cap-inclusive` | 115/125 (0.920) | 0/5 | |
| `cap-ignores-week` (the yearly total leaves out this week's earlier runs) | 115/125 (0.920) | 0/5 | |
| `employee-by-name` | 117/125 (0.936) | 1/5 | |
| `eu-dates` | 117/125 (0.936) | 2/5 | |
| `void-paid` | 118/125 (0.944) | 2/5 | |
| `hire-on-duplicate` (section 4.1 ignored) | 119/125 (0.952) | 2/5 | |
| `any-author-hold` | 120/125 (0.960) | 3/5 (needs the d3 unauthorized hold) | |
| `cap-by-name` | 121/125 (0.968) | 3/5 (needs the d3 same-name referrer) | |
| `dup-by-name` | 121/125 (0.968) | 3/5 | |
| `rehire-by-name` | 121/125 (0.968) | 3/5 (needs the d3 rehire namesake) | |
| `left-by-name` | 121/125 (0.968) | 3/5 | |
| `dup-case-sensitive` | 123/125 (0.984) | 4/5 | |

Each one-defect control fails on at least one trigger carrying the trap its broken rule resolves (a test asserts it);
`leak-other-payouts` and `extra-amount` fail payout runs only, each on the email check ("body also says …").
Most sit inside the hypothesis band for `agent-H`: one misread rule costs a few triggers a week.

**State probes** (the reference with one state write removed; `cap-ignores-week` reads the state but ignores this
week's part). A failure counts as "read by a later trigger" when a payout run that is not the week's last fails its own
effects, envelope or AutomationBench checks, not only Friday's end-of-week state. Over seeds 601–650 (250 payout runs):

| Probe | Later non-Friday payout runs failed on their own checks | Other failures |
|---|---|---|
| `no-hire-write` (a hire writes no Status) | **50** (one per week: the late hire is never paid) | 281 hires; 50 Friday end-of-week only |
| `cap-ignores-week` | **53** (was 1 of 250 before v1.2.0) | 1 Friday run; 49 Friday end-of-week only |
| `no-hold-write` | **38** | 65 holds; 22 Friday runs; 28 Friday end-of-week only |
| `no-paid-write` (emails sent, no Status, Bonus or Paid On) | **200** (paid again) | 50 Friday runs |
| `no-void` (a departure writes no Voided) | **0**, as the narrowed claim says | 36 departures; 36 Friday end-of-week only |

On the five dev streams the same holds (a test asserts it): each of the first four probes fails a payout run before
Friday on its own checks, and `no-void` fails only departures and Friday's end-of-week state.

**Other gates:**
- **Determinism and round trip:** two generations give identical sha256 for world0, payloads, triggers, truth and end
  (and two `gen.py` runs of seed 611 under PYTHONHASHSEED 1 and 777 give identical sha256 for every file); every
  `world_t` validates as `WorldState` and survives dump → load → dump.
- **Leakage:** 0 problems on practice and dev streams (601–614). Sheet payloads are exactly the world's cells after the
  delta and never carry Status, Hold, Bonus or Paid On (the arm's own state); a new referral row is not in world0 and
  arrives with those cells and the hire cells empty; Slack and email payloads are the messages the delta inserted; no
  truth vocabulary in payloads or world0; serve-input rows hold only POLICY.md and the payload with `assertions: []`;
  the reference imports only `base64`, `json`, `re`, `datetime` and `urllib`.
- **Oracle mutation score: 2,237/2,237 = 1.000** (42 operators on the reference's correct worlds: dropped, duplicated,
  unsent or re-addressed payroll and referrer emails; CC finance or BCC all-staff; wrong amount, level, candidate,
  referrer or subject; a subject with a doubled space; a payroll body that adds a conflicting amount or another
  Referral ID; a referrer body that adds another amount, another payout of the run with its amount, or someone else's
  referral; wrong, reverted or reformatted Status, Paid On, Bonus or Hold; other cells or row formatting edited; another
  referral's Status or Hold; an Employees edit; an appended row; a Slack post with an amount; an email to finance or
  all-staff; a #automation-review post; a pre-existing message deleted or trashed). The added body and subject mutants
  are each killed by the oracle's email check, and also by AutomationBench's handlers except those naming a referral
  outside the run (another Referral ID in a payroll body, someone else's referral in a referrer body).
- **Specificity: 373/373** policy-neutral variants accepted (subject in lower case or with surrounding spaces, amount
  without digit grouping or with cents, a display name on the recipient, a trailing signature, a referrer email naming
  the referrer's own Referral ID, Status in lower or upper case, Bonus as a bare number, Hold in lower case, an inbound
  email marked read), and an equivalent solver that writes cells through A1 notation, puts a display name on every
  recipient and words its emails differently passes 125/125.
- **Trap coverage** (labels from the truth, label streams 610–613): T-stale 60, T-state 47, T-format 35,
  T-repeat 15, T-lookalike 9, T-note 9, T-authority 8; every kind ≥ 5. Thin labels on these four streams (one
  trigger each): `candidate-namesake`, `email-case`, `left-day89`, `left-namesake`, `broadcast-allstaff`,
  `post-amounts`, `release`.

**Tests:** `pytest` (88 tests): 88 passed in 495 s (run while a 601–650 measurement ran beside it). v1.1.0 had 72
tests (the README then still said 69).

## Changes (2026-10-21, v1.1.0 → v1.2.0)

Fixes for the 2026-10-21 review (attack solvers on seeds 610 and 611), each with a regression test in
`tests/test_referral.py`:
- **[high] A referrer email could tell the referrer other people's bonuses.** The reviewer's `LeakOtherAmount` added
  "Also paid today: <referrer> for <candidate>: $5,000" to every referrer email and passed 52/52 triggers, because the
  body only had to contain the right amount. Now the oracle checks every referrer body against the truth's roster
  (no Referral ID, candidate or referrer of anyone else's referral), AutomationBench's handlers get `body_not_contains`
  and one `gmail_message_not_sent_to_with_body_contains` per referrer for each Referral ID, candidate, referrer and amount
  of the run's other payouts and caps, the mutation gate has `referrer-other-payout` and `referrer-other-referral`, and
  the bad control `leak-other-payouts` fails 12 of 25 dev payout runs (every run paying two or more referrers) and
  143 of 250 over seeds 601–650. Test: `test_payout_bodies_say_nothing_else`, `test_body_controls_fail_on_payout_runs_only`.
- **[medium] A payout email could state a second, conflicting amount.** "$3,500 … PLEASE PAY $5,000 (adjusted)" passed.
  The oracle now extracts every amount of money from payroll and referrer bodies (`oracle.money_tokens`) and requires
  exactly the payout's amount; mutants `payroll-extra-amount` and `referrer-extra-amount`; bad control `extra-amount`
  fails every dev payout run that pays (19 of 25). Tests: `test_money_tokens` and the two above.
- **POLICY.md, version 2.** So that the policy still states every parameter the oracle checks, section 7 now says the
  payroll body names "no other amount or Referral ID" and the referrer body states "no other amount, and nothing about
  anyone else's referral". Nothing else in the policy changed except the missing-Employees sentence below.
- **[medium] Most of the claimed cross-trigger state was never read by a later trigger.** Planted consumers:
  (a) `cap-earlier-run`: a referrer with two payable rows, the first paid Monday or Tuesday and the second due on a
  later weekday by Thursday, Capped only when the yearly total counts the Bonus and Paid On written at the earlier run;
  every d2 and d3 week; the bad control `cap-ignores-week` now fails 53 non-Friday payout runs over 601–650 (the review
  measured 1 of 250); (b) a hire entered late every d2 and d3 week (Monday to Wednesday, day 90 by Thursday), so the
  hire's Status decides a payout that week, and a late rehire (d3 always, d2 half the time) that a wrong Status would
  pay. The departure's `Voided` has no consumer under this policy (the Active check blocks a departed employee), so the
  README and the hypothesis now say so instead of claiming it. Four state probes in `controls.PROBES` measure it; tests
  `test_state_written_by_one_trigger_decides_a_later_one` (four probes) and `test_voided_status_is_end_of_week_state_only`
  pin both the consumers and the narrowed claim; `test_late_hires_and_cross_run_caps_are_planted` pins the plan.
- **[low] Subject spacing.** The docs said extra spaces in a subject were ignored, but AutomationBench's subject check
  (which the oracle runs) rejects them. The oracle's own subject comparison now agrees (letter case and surrounding
  spaces ignored, inner spacing exact, as the policy's "subject exactly" says); mutants `payroll-subject-double-space`
  and `referrer-subject-double-space` (killed) and the variant `subject-surrounding-spaces` (accepted) pin it. Test:
  `test_subject_spacing_inside_is_exact`.
- **[low] Unexercised policy branches.** A hire filled into world0's `Duplicate referral` row is planted (d3 every
  week, d2 half the time; truth: nothing; label `dup-hire`; bad control `hire-on-duplicate`). A missing Employees row
  now has one behaviour: **not eligible**, stated in POLICY.md section 7 condition 4. The reference used to escalate
  (`LookupError`) while the generator skipped the row; now both skip it. Tests: `test_hire_on_duplicate_row_is_a_noop`,
  `test_missing_employee_row_is_not_eligible`. A `row_updated` without Hire Date, a missing Employees row and an
  escalation are still not planted (see Limits).
- **Trap shares kept near the design.** With the Duplicate-row hire counted as one of a d3 week's planted hire traps,
  each d3 week now plants `rehire`, `rehire-old` and `rehire-namesake` once each (they were drawn at random before);
  d3 stays at 0.713, d2 rose from 0.490 to 0.522.
- **Reference refactor, same behaviour on every planted path.** `Referral.payout` now decides every row first
  (`decide`) and then writes, in the same order with the same tool calls, and the email bodies come from
  `payroll_body` / `referrer_body`, so controls can change one thing. An unreadable cell met mid-run now escalates
  before any write instead of after a partial run.
- **Version 1.2.0.** Every stream differs from v1.1.0. No v1.1.0 stream was labelled or run by an arm (the seed ledger
  has no entries for this family). Every number in this README was re-measured on v1.2.0.

## Changes (2026-10-21, v1.0.0 → v1.1.0)

- **Re-verified first, unchanged code** (same venv, AutomationBench `4a8e106`): the 68 tests passed (123 s) and
  `gates.py --seeds 610-614` exited 0 with every number of the 2026-10-15 README reproduced exactly (reference 129/129,
  mutation 2,223/2,223, specificity 380/380, naive 0.541 at d3, the same control table).
- **d3 volumes were above the design.** A d3 week had 10–11 `referral.submitted` triggers (9–10 new referrals plus the
  re-delivery) and 3 `hold.changed` triggers (a HOLD and a RELEASE from the VP People plus the unauthorized one),
  against 6–10 and 1–2 in RECURRING-DESIGN §4.11 and the 2026-10-14 build spec. `family.json` had widened its own
  `perWeek` to [6, 11] and [1, 3], so the shape test passed against the widened ranges. Now a d3 week draws 8–9 new
  referrals (9–10 events with the re-delivery) and one VP People message, a HOLD naming two referrals or a RELEASE
  (2 events with the unauthorized one). `perWeek` in `family.json` is the design's again, and a new test
  (`test_volumes_inside_the_design_ranges`) checks every practice and dev seed, generated at d2 and at d3, against a
  literal copy of the design table. d2 code paths are unchanged.
- **Version 1.1.0.** The version is part of the generator's RNG key, so every stream, d2 included, differs from v1.0.0,
  and every number in this README was re-measured on v1.1.0. No v1.0.0 stream was labelled or run by an arm (the seed
  ledger has no entries for this family), so nothing downstream depends on the old streams.
- **What d3 gives up:** the VP People's RELEASE now appears in 12 of the 24 d3 weeks of seeds 601–650 (was every d3
  week) and the two-referral HOLD in the other 12. Over the same seeds a RELEASE appears in 20 of 26 d2 weeks and a
  HOLD in 21. The share of trap-bearing triggers stays at the design's rates (0.490 at d2, 0.708 at d3).

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
- **Three test assertions were wrong, not the family:** an Employees payload legitimately carries the employee's
  Status (an HR column, not one the automation writes); the word check for host names matched `timedelta`; and the
  `null` control's one `wrong` is the no-op Friday above.
- **No paid referral ever left in the dev streams,** so `void-paid` passed every trigger. Departures are now planned
  as one that voids and (d2: sometimes; d3: one of two) one that must change nothing, including a paid referral's
  employee leaving.

## Limits and not done yet

- The reference's rules are literal keyword, date and equality checks, checked against the generator's own text
  templates. Agreement between two implementations by the same author does not prove the policy reads the same way to
  someone else: the second-reader fairness gate (§3.11 gate 6) still needs a session that did not write the family. The
  most disputable readings are probably that `Eligible` (from the old process) does not mean day 90 has passed, that a
  payout recorded only in Notes does not count towards the cap, and (new in policy version 2) how strictly "no other
  amount" reads: a referrer email that mentions the $10,000 cap or the referrer's total for the year is wrong.
- The amount check counts a bare number as money only when it equals one of the program's amounts ($2,000, $3,500,
  $5,000, $10,000). "please pay 4000" with no currency mark is not caught. The referrer-name check matches full names
  only, so a first name alone ("Also paid: Dana") is not caught.
- The `retry` trap is weak: re-handling a re-delivered submission with the same rule writes the same Status, which
  leaves no trace. It catches only an arm that does something extra on a repeat.
- `Voided` is read by no later trigger (see What it is). A consumer would need an employee who becomes Active again
  (a rescinded departure), an event kind outside the design table, so it is not planted.
- Not planted: a departure on or after day 90 of an unpaid referral, a rehire exactly 12 months back, a hold naming an
  unknown Referral ID, a Referral Log `row_updated` without Hire Date (section 4 does not apply: nothing), a referral
  whose Employee ID is not in Employees (policy version 2: not eligible; the reference and the generator agree), and
  any undecidable trigger, so no escalation truth exists; the escalation clause and the oracle's escalation check are
  there but unexercised.
- The stream runner (`stream.mjs`), the bridge commands (`abr-gen`, `abr-apply`, `abr-grade`) and the arms (§3.7–3.8)
  do not exist yet. Here everything runs in one process; model arms will reach the same `env_response` path through
  `bridge.py serve` with the rows `gen.serve_input` writes.
- The seed ledger has no entries for this family; no labelled stream was run.

