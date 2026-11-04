# abr-fin-receipts: expense receipt capture (AutomationBench-R family 10)

**Status (2026-10-21).** Development, $0. Generator, oracle and reference are at **1.1.0**, and POLICY.md at version
1.1. These fix the six defects found by the 2026-10-21 review ([below](#review-of-2026-10-21-generator-oracle-and-reference-110)).
The family has 40 bad controls, the validity gates and 113 tests. No arm has run and no model was called. Nothing
here is a capability result. Design: [RECURRING-DESIGN.md §4.10](../../../../research/automationbench-20261014/RECURRING-DESIGN.md).
Proposed split: **TRAIN**.

## What it is

A standing automation, like a Zap. Finance writes the policy once ([POLICY.md](POLICY.md)) and it runs on every
message posted in `#expense-submissions`. One stream is one simulated business week, Monday to Friday 16:00. A d2
week has 32–39 triggers and a d3 week has 48–54. The world carries over from trigger to trigger. The state is the
Submissions worksheet, the channel's threads and the automation's own replies. Last week's receipts, rows, replies
and weekly email are already there.

| Trigger (`kind`) | Arm-visible payload | Correct handling |
|---|---|---|
| `receipt.posted` (24–35/week) | `slack` / `new_message`, top level: ts, user, free text, files | Read the receipt: the amount (digits, `USD` or words), the date (ISO, month name, today, yesterday or none), the category (written or from a word table), attendees, receipt, alcohol, client, hotel nights and country, and the flight cabin and hours. Unknown poster: escalate. Repost (checked on amount and date before anything else is read): do nothing. Otherwise apply the eight rules in order: category, receipt over $25, alcohol, four meal rules (one of them the $100 daily cap on individual meals), hotel nightly limit, flight cabin. Rejected: reply `Rejected: <reason>`. Passed: append one Submissions row (Approved, or Pending Pre-Approval over $500) and reply `Logged: …` or `Pending pre-approval: …` in the receipt's thread |
| `receipt.corrected` (2–3/week at d2, 9 at d3) | `slack` / `new_message`, a thread reply starting `Correction` | Only the receipt's own poster corrects it. Apply the stated values. Several corrections in a thread apply in order, and a relative date is read on the correction's own day. Check again from rule 1: the cap counts the employee's *other* rows of the corrected date, and a pre-approval given while the row was pending still counts. Update the row in place (to Approved, Pending Pre-Approval or Rejected), or append it if the receipt had been rejected. Reply with the new outcome |
| `receipt.reposted` (2–3/week at d2, 3–4 at d3) | `slack` / `new_message`, top level | The same employee, expense date and amount as an earlier top-level message (this week or last), in other words, with each message read relative to its own posting date: nothing at all |
| `preapproval.reply` (1–3/week at d2, 5 at d3) | `slack` / `new_message`, a thread reply starting `pre-approved` | Only the poster's manager (by email, from the Employees sheet), and only on a pending row: set Status Approved and reply `Logged: …` in the thread. Do nothing for anyone else, for "Not pre-approved yet", for a second approval, or for a `pre-approved` on a receipt that is not pending |
| `week.close` (Friday 16:00) | `schedule` / `week_close`: week_start, date | Email finance@ `Weekly expense totals <week_start>` with the per-employee Approved totals of rows submitted this week, `Total: $…` and `Pending pre-approval: <N>` |

The narrow judgment is reading a free-text receipt (or a correction). The reference does it with a small parser. A
workflow arm would make one typed Haiku extraction per message and keep every rule in code. The cross-trigger state:
- the daily meal cap, across messages and across the week boundary, after corrections, and skipping rows a correction
  rejected;
- pending pre-approvals and who may approve them;
- corrections that are checked again and update the row in place;
- reposts compared against the channel's history.

All worlds, policies and noise are our own fictional text: invented people, restaurants, hotels, tools, firms and
clients, and `*.example.com` addresses. Real city and country names appear only as places. AutomationBench supplies
the app schemas (`WorldState`), the `api_fetch` routing and the assertion handlers, which are used unchanged.

**One adaptation to the simulator.** AutomationBench's Slack history (`Message.to_display_dict`) omits a message's
`attachments`. A file on an earlier receipt would then be invisible to every arm when a correction checks it again.
Files are therefore also shown in the message text as `[file: <name>]` (as a Slack export shows them), and POLICY.md
says so. The payload still carries `attachments`.

## Grounded on (AutomationBench public set, commit `4a8e106`)

| Task | Span | What it contributes |
|---|---|---|
| `finance.slack_receipt_capture` | `automationbench/domains/finance/tasks.py:1599-1732` | The `#expense-submissions` channel and its free-text messages (`Expense: <what>, $<amount>, category: <C>, date: <date>`); the Expense Tracker with Submissions and Expense Policy worksheets; allowed and rejected categories (Entertainment, Personal, Gifts need VP pre-approval); the $75 per person meal limit that needs the attendee count; a thread reply confirming or rejecting; the escape-room (Entertainment) and Uber (Travel) cases |
| `finance.expense_policy_violation` | `automationbench/domains/finance/tasks.py:9561-9754` | Hotel $250 domestic / $350 international per night, meals $75 team / $50 individual, economy unless over 6 hours (business on a 5-hour flight is a violation), alcohol only for client entertainment with the client's name ("Drinks at conference"), manager pre-approval over $500, receipts over $25 |

**What the adaptation changes [D].** The raw tasks are one batch handled once. Here each message is its own
trigger. The daily meal cap turns the meal rules into cross-trigger state: at most $100 of individual meals per
employee per day, counting logged rows, last week's included. Over $500 a receipt waits as `Pending Pre-Approval`
until the right manager replies in its thread. Submitters correct their own receipts in the thread, and the corrected
receipt is checked again against every rule. Others' "corrections" change nothing. Near-identical reposts get nothing.
A weekly per-employee totals email closes the week. The policy text, the word table, the reasons and the formats are
our own; the limits are the grounding tasks'.

## Class hypothesis [I, written before any label]

**Either; workflow at high N** (family.json `hypothesis`). Each receipt is easy for an agent: one message, two
lookups (the poster's Employees row, the Submissions rows), eight table rules and one exact reply. Expected `agent-H`
is about 0.75–0.9 per trigger, with failures concentrated on:
- the daily cap across messages and across the week boundary;
- pending pre-approvals: who may approve (by email, not by name), negations, repeats;
- corrections: check again, update in place, never a second row;
- reposts against the channel's history;
- the free-text reading: synonyms, amounts in words, relative dates, the 6-hour boundary.

A workflow built once, with one typed Haiku extraction per message and every rule and format in code, is expected
at about 0.9 or better. At N = 160 the build cost amortises; at N = 1 an agent is cheaper.

## Files

| File | Role |
|---|---|
| [POLICY.md](POLICY.md) | The standing policy every arm gets (policy version 1.1; 1.0 to 1.1 only spells out the Amount cell format) |
| [family.json](family.json) | Id, apps, envelope, trigger kinds and rates per difficulty, trap catalogue, the judgment, need job, hypothesis, split, seeds |
| [gen.py](gen.py) | Seeded generator. It writes `world0` (validated as `WorldState`, round-tripped), the arm-visible `payloads`, the host-only `triggers` (payload + delta + traps), `truth`, `end`, one `serve-inputs` row per trigger (`assertions: []`) and `meta` with sha256. It uses `random.Random(f"{family}:{version}:{seed}:{difficulty}")` and no wall clock. Receipts are structured facts decided by `decide()` against the canonical Submissions rows; text is rendered from the facts afterwards, and a self-check refuses any text whose category or alcohol reading would be ambiguous. It refuses seeds outside 601–650 |
| [oracle.py](oracle.py) | Per-trigger grader. It builds the effect ledger from `world_before` / `world_after` (attribution) and checks the exact effects, the envelope (nothing else written), AutomationBench's own `AssertionRegistry` on an attribution view, and the end-of-week state at Friday's close. Outcomes: correct, abstained, miss, wrong |
| [reference.py](reference.py) | Reference workflow: author-written code, no model, standard library only. It sees only the payload, the policy constants and the tools (`ctx.fetch` → `api_fetch`). It keeps no private state: the channel, its threads and the two worksheets are read back on every trigger. Each rule of 5.1 and 5.2 is its own small method, so that a control can break exactly one |
| [controls.py](controls.py) | 40 bad controls (below) |
| [harness.py](harness.py) | `$0` stream runner (from the sibling families). It applies each delta (a new Slack message, and a thread parent's reply count) and calls the tools through `bridge.Rollout.batch`: the official `env_response` path, with the determinism shim and clock = trigger time. It grades every trigger, in carry and rebased modes |
| [gates.py](gates.py) | The $0 validity gates of RECURRING-DESIGN §3.11 (`--only` runs a subset) |
| [tests/test_receipts.py](tests/test_receipts.py) | pytest suite |

Nothing was added under `families/_shared/`: like the sibling families, this one keeps its harness and helpers in its
own directory.

## Commands

All of these run inside AutomationBench's own venv (`uv sync` in `corpus/AutomationBench`, pinned by its `uv.lock`):

```
PY="corpus/AutomationBench/.venv/bin/python -I -B"
F=experiments/autobench/families/abr-fin-receipts
$PY $F/gen.py --seed 610 --out HOSTDIR                                # host-only stream files
$PY $F/harness.py run --solver reference --seeds 601-614 [--mode rebased] [--failures]
$PY $F/harness.py run --solver no-recheck --seeds 610-614
$PY $F/gates.py [--seeds 610-614] [--out DIR] [--only controls,traps]  # exit 0 only when every gate passes
$PY -m pytest -q -p no:cacheprovider $F/tests
```

## Traps

The host-only truth records each trigger's traps. The simulation computes the labels from the situation; they are
not copied from the plan. Every trap can be resolved from `POLICY.md` and the tools; a generator self-check refuses
any text whose category, alcohol, hotel or flight reading would be ambiguous.

| Kind | Labels | Where | Resolved by |
|---|---|---|---|
| T-format | `synonym`, `declared-category`, `words-amount`, `currency-format`, `date-format`, `drinks`, `hotel-intl`, `flight-long`, `flight-six`, `approval-negated`, `correction-relative-date`, `cabin-lookalike` | `category: Rideshare` / `Lodging` / `Team building`, or no category at all; a software license declared `Office Supplies`; `forty-two dollars and fifty cents`, `USD 45.00`; `Mar 4`, `4 March`, `yesterday`, no date; drinks, wine, happy hour; `Toronto, Canada`; business at 9h 45m or at exactly 6h; "Not pre-approved yet"; `Correction: the date was yesterday` posted a day or more after the receipt; a flight "for a business meeting" | Section 7's reading rules and word table; "the category field decides"; "over means strictly more"; "starts with pre-approved"; 5.1 "relative to the correction's posting date"; the cabin is business class, first class or premium economy, not any use of the word |
| T-authority | `wrong-corrector`, `wrong-approver`, `unknown-poster` | A colleague's "Correction:"; "pre-approved" from the employee, another manager, Finance; a contractor not in Employees | Corrections only from the poster; approvals only from the Manager Email; escalate an unknown poster |
| T-lookalike | `namesake`, `display-name`, `manager-display-name` | An approver with the manager's first name; nicknames in Slack (`Kate Laine` for `Katherine Laine`); a manager shown as `Priya L.` | People by email, names from the Employees sheet |
| T-repeat | `repost`, `repost-history`, `repost-fixed`, `repost-terse`, `repost-relative` (`repost-rel`, `repost-rel-rev`), `near-dup`, `near-dup-relative`, `approval-again`, `approval-not-pending` | The same receipt in other words (this week or last week, now with its file, or terse without description or category); a receipt dated `today` / `yesterday` reposted on a later day with an explicit date, and the reverse; the same description and amount on another day, another amount the same day, another employee, or the same words `today` on a later day; a second pre-approval; the manager's `pre-approved` on a receipt logged Approved at once | Same employee + expense date + amount, each message read relative to its own date, before any category reading; only a pending row is approved |
| T-state | `meal-cap`, `cap-history`, `cap-under`, `cap-rejected-row`, `correction`, `correction-fix`, `correction-recheck`, `correction-cap`, `correction-own-row`, `correction-multi`, `correction-preapproved`, `correction-early-approval`, `correction-travel-facts`, `approval`, `approval-history`, `pending-at-close`, `approved-last-week`, `corrected-total`, `total-rejected-row` | Individual meals of one day across messages and across the week boundary; a later meal of a day whose earlier meal a correction rejected; corrections whose check makes the receipt Pending or Rejected; a meal's date corrected onto a day with no room left; the last meal of a nearly capped day corrected; a second correction in a thread; a pre-approved receipt corrected; a premature `pre-approved` given while the row was Approved, then a correction over $500; a hotel declared Consulting corrected to Travel; last week's pending receipt approved this week (not in this week's totals); corrected and rejected rows in the totals | Sections 4, 5, 6 and rule 4d |

Every d3 week carries each of `correction-recheck`, `correction-cap`, `correction-own-row`, `correction-multi`,
`correction-relative-date`, `correction-preapproved`, `correction-early-approval`, `cap-rejected-row`,
`total-rejected-row`, `approval-again`, `approval-not-pending`, `repost-relative`, `near-dup-relative`, `flight-six`
and `hotel-intl` (the traps gate checks 610–613, a test checks every d3 seed of 601–650). About half of the d2 weeks
carry `approval-again` (15 of 26). `correction-travel-facts` (9 of 50 seeds) and `cabin-lookalike` (3 of 50) are drawn
at random.

Over seeds 601–650, the measured share of `receipt.posted` triggers that carry a trap is **0.31 at d2 and 0.62 at
d3** (design: 35% and 60%). At trigger level the shares are 0.47 and 0.76, because corrections, reposts,
pre-approvals and the week close carry state traps by construction. Plain rule applications (an explicit
`Entertainment`, a hotel over its limit) are context labels and do not count. d1 (smoke only) plants no format traps,
nicknames or near-duplicates.

## What the oracle checks

Per trigger, on the effect ledger (world before vs after the trigger):
- **Each expected new Submissions row**: exactly one new row with that Message TS; every column equal; no other
  non-empty cell. Employee, Category and Status are compared ignoring letter case and extra spaces. Attendees is
  compared as a number. Dates must be exactly ISO. Amount must be as POLICY.md section 4 writes it: text with two
  decimals and no `$` or commas (`1250.00`), or a number cell of that value. `$1,250.00`, `1,250.00`, `1250` and
  `1250.000` as text fail.
- **Each expected row update**: the receipt's existing row, found by Message TS in world_before, changed in place to
  the expected cells (a delete-and-append is not an update).
- **Each expected thread reply**: a new `#expense-submissions` message whose `thread_ts` is the receipt's ts and whose
  text is the expected text (whitespace collapsed, letter case ignored, money compared by value, one trailing period
  tolerated).
- **The weekly email**: one sent message to finance@ and nobody else, with the expected subject. The body's lines of
  the three shapes of POLICY.md section 6 (`<name>: $<amount>`, `Total: $<amount>`, `Pending pre-approval: <N>`) must
  equal the expected lines as a multiset; a missing, extra or wrong line of those shapes fails. Other lines (a
  greeting, a dated header), line order, blank lines, list markers (`- `, `* `, `• `, `1. `) and HTML markup (`<br>`,
  `<p>`, `<li>`, or an HTML-only body) are ignored.
- **An escalation**: a new `#automation-review` post naming the trigger id.
- **The envelope**: nothing else created, changed or removed in any app. Harmless: a thread parent's `reply_count`,
  read flags or labels on mail already there.
- **AutomationBench's own handlers**, on an attribution view in which the Slack messages, the sheet rows and the mail
  are only this trigger's: `google_sheets_row_exists` / `_not_exists` (Message TS, Amount, Category, Status),
  `slack_message_exists` (the reply's parts), `gmail_message_sent_to_with_body_contains` (subject and lines).

At Friday's close the oracle adds nine end-state checks:
- the Submissions worksheet equals the week's expected rows, with the same cell rules and no duplicate Message TS;
- Employees and Expense Policy are unchanged;
- no pre-existing Slack message was edited or removed;
- the week's automation replies match as a multiset of (thread, text);
- exactly the expected escalations were posted;
- nothing was posted elsewhere;
- exactly one email was sent this week;
- AutomationBench's `google_sheets_row_exists` passes for each final row.

Outcomes are `correct`, `abstained`, `miss` and `wrong`. `abstained` means the only effects are `#automation-review`
posts and no escalation was expected: no credit, and no wrong-answer penalty. `pass` includes the envelope, and
`pass_core` is reported beside it.

## Numbers [measured, $0, development evidence, generator 1.1.0]

| Run | Result |
|---|---|
| Reference, dev seeds 610–614 (carry) | **211/211 triggers, 5/5 clean weeks**, at most 9 tool steps per trigger (the acceptance bar was ≥ 95%) |
| Reference, practice + dev 601–614 (gate) | 596/596, 14/14 clean weeks; rebased 610–614: 211/211 |
| Reference, all dev-range seeds 601–650 | **2,149/2,149, 50/50 clean weeks** (generator and reference agree on every effect, including 280 corrections: 151 Logged, 32 Pending, 61 Rejected, 36 no-ops) |
| Triggers per week | d2 32–39, d3 48–54 (seeds 601–650) |
| Determinism, leakage | pass. Regeneration gives identical hashes and every `world_t` round-trips. Payloads equal the inserted message. No truth vocabulary reaches the arm, and the serve rows hold only POLICY.md + payload |
| Reading agreement | the reference's text reading equals the generator's structured facts on every receipt of 601–614 (594 receipts: amount, date, category, attendees, receipt, alcohol, client, hotel, flight) |
| Oracle mutation score (610–614) | **5,173/5,173 killed (1.00)**, 49 operators. They cover row cells (since 1.1.0 also an Amount cell as `$1,975.89`, `1,975.89`, `145.000` or `145`) and dropped or duplicated rows. They cover an update reverted or done as an append. They cover a reply dropped, duplicated, posted at top level or in another thread, or with a wrong amount, category, verb or reason. They cover an email dropped, duplicated, readdressed or cc'd, or with a wrong subject, total, count or line, including an extra or wrong line behind list markers or HTML. They also cover edits to old rows, Employees or old messages, and extra rows, replies, posts or mail |
| Oracle specificity (610–614) | 1,319/1,319 policy-neutral variants accepted (18 operators, since 1.1.0 also a dated header line, `- ` / `* ` / `• ` / `1. ` lines, an HTML-only body and HTML in the plain body); an equivalent solver (row-by-id update, channel id, blank-line email) passes 211/211 |
| Trap coverage, label streams 610–613 | T-authority 8, T-format 42, T-lookalike 12, T-repeat 30, T-state 72 (each ≥ 5); no d3 stream misses a required state |
| Gates | `gates.py` (determinism, leakage, solvability, controls, traps, mutation, specificity): **all pass**, exit 0 (14 min on a heavily loaded machine) |
| Tests | `pytest`: **113 passed** in 11 min (on a heavily loaded machine: load average about 16 on 4 cores) |

Controls on dev seeds 610–614 (211 triggers, five weeks; from the gate run). Every control fails. `null` passes
exactly the 28 no-op triggers:

| Control | Pass | Clean weeks | Outcomes |
|---|---|---|---|
| `null` | 28/211 (0.133) | 0/5 | 183 miss |
| `echo` | 0/211 | 0/5 | 211 wrong |
| `naive` (25 lines; no repost, receipt, alcohol, meal, cap, hotel or flight rule; ignores corrections; anyone's "pre-approved" approves) | 130/211 (0.616); **d3 dev streams 0.551** (gate: < 0.60); all 24 d3 seeds of 601–650: 0.554; d2: 0.643 | 0/5 | 59 wrong, 22 miss |
| `no-dedupe` | 190 (0.900) | 0/5 | 18 wrong, 3 abstained |
| `no-cap` | 197 (0.934) | 0/5 | 14 wrong |
| `cap-all-meals` | 196 (0.929) | 0/5 | 15 wrong |
| `cap-week-only` | 205 (0.972) | 2/5 | 6 wrong |
| `any-corrector` | 205 (0.972) | 2/5 | 6 wrong |
| `any-approver` | 207 (0.981) | 3/5 | 4 wrong |
| `name-approver` | 207 (0.981) | 3/5 | 4 wrong |
| `contains-approved` | 207 (0.981) | 3/5 | 4 wrong |
| `field-category` | 160 (0.758) | 0/5 | 51 wrong |
| `digits-only` | 198 (0.938) | 2/5 | 6 wrong, 6 miss, 1 abstained |
| `drinks-ok` | 207 (0.981) | 4/5 | 4 wrong |
| `slack-name` | 196 (0.929) | 1/5 | 15 wrong |
| `no-preapproval` | 188 (0.891) | 0/5 | 21 wrong, 2 miss |
| `top-level-reply` | 32 (0.152) | 0/5 | 179 wrong |
| `log-rejected` | 160 (0.758) | 0/5 | 51 wrong |
| `total-all-weeks` | 206 (0.976) | 0/5 | 5 wrong |
| `no-receipt-rule` | 194 (0.919) | 0/5 | 17 wrong |
| `domestic-only` | 207 (0.981) | 3/5 | 4 wrong |
| `cabin-ignored` | 201 (0.953) | 1/5 | 10 wrong |
| `six-hours-ok` | 205 (0.972) | 2/5 | 6 wrong |
| `correction-append` | 189 (0.896) | 0/5 | 22 wrong |
| `unknown-logged` | 203 (0.962) | 1/5 | 8 wrong |
| `date-posted` | 112 (0.531) | 0/5 | 96 wrong, 3 abstained |
| `no-recheck` (1.1.0) | 199 (0.943) | 2/5 | 12 wrong |
| `no-pending-check` (1.1.0) | 203 (0.962) | 2/5 | 8 wrong |
| `repost-rel-now` (1.1.0) | 205 (0.972) | 3/5 | 4 wrong, 2 miss |
| `category-first` (1.1.0) | 205 (0.972) | 2/5 | 3 wrong, 3 abstained |
| `cap-counts-rejected` (1.1.0) | 207 (0.981) | 3/5 | 4 wrong |
| `total-counts-rejected` (1.1.0) | 209 (0.991) | 3/5 | 2 wrong |
| `cap-counts-own-row` (1.1.0) | 207 (0.981) | 3/5 | 4 wrong |
| `latest-correction-only` (1.1.0) | 207 (0.981) | 3/5 | 4 wrong |
| `correction-receipt-day` (1.1.0) | 207 (0.981) | 3/5 | 4 wrong |
| `preapproval-forgotten` (1.1.0) | 205 (0.972) | 3/5 | 6 wrong |
| `preapproval-any-time` (1.1.0) | 207 (0.981) | 3/5 | 4 wrong |
| `correction-no-cap` (1.1.0) | 207 (0.981) | 3/5 | 4 wrong |
| `travel-facts-kept` (1.1.0, rare trap) | seeds 601, 617: 82/86 | 0/2 | fails on `correction-travel-facts` (s601/t27, s617/t42) |
| `cabin-anywhere` (1.1.0, rare trap) | seeds 624, 628: 68/72 | 0/2 | fails on `cabin-lookalike` (s624/t17, s628/t06) |

A test asserts that each one-defect control fails on at least one trigger carrying the trap its broken rule resolves.
A further test takes the reference's own correct worlds and makes one plausible slip each (a logged amount one cent
off, the reply at the top level instead of in the thread, a rejected receipt logged anyway): every one is graded
`wrong`. Eleven of the twelve 1.1.0 controls scored here fail both d3 dev weeks (611, 613), because their traps are
required in every d3 week. `category-first` is the exception: it fails 611, 610 and 614 but passes 613, because its
trap `repost-terse` is not planted every week. Most of them pass the d2 weeks, where those traps are random. 31 of the
34 one-defect controls scored on 610–614 (`top-level-reply` aside) pass 0.89–0.99 of the triggers. Clean weeks
therefore separate careful handling from careless handling better than the per-trigger rate does.

## Review of 2026-10-21 (generator, oracle and reference 1.1.0)

A review found one high, two medium and three low defects in 1.0.0. All six are fixed, each with regression tests.
The reviewer's own lazy solvers, rerun unchanged on the 1.1.0 streams of seeds 601–630, are the before/after evidence
(`lazy.py` in the review's scratchpad):

| Reviewer's solver | 1.0.0 (601–630) | 1.1.0 (601–630) |
|---|---|---|
| no re-check on corrections (`handle`) | 1,186/1,186, 30/30 clean weeks | 1,195/1,284, **10/30** (all 14 d3 weeks fail; 55 of 162 corrections wrong) |
| approve without the pending check (`no_pending_check`) | 1,184/1,186, 29/30 | 1,219/1,284, **5/30** (all 14 d3 weeks fail; 40 of 105 pre-approval replies wrong) |
| an earlier message's relative date read on the new message's day (`repost_rel_now`) | 1,184/1,186, 29/30 | 1,242/1,284, **16/30** (all 14 d3 weeks fail; the 16 clean weeks are the d2 weeks) |
| reposts by amount only (`repost_amount_only`) | 1,162/1,186, 20/30 | 1,240/1,284, 12/30 |

1. **(high) The "corrections re-check from rule 1" state was never exercised.** In 1.0.0 all 114 valid corrections
   over 601–650 ended `Logged`, and no Submissions row ever had Status Rejected. Every d3 week now carries nine
   corrections:
   - the rejected-receipt fix, and one more correction drawn from the amount, date and category fixes and the
     re-check cases below;
   - a correction from someone other than the poster;
   - `fix-break-meal`: an individual meal raised over $50. The row becomes Rejected, and a later meal of that day
     passes only if the cap skips the Rejected row;
   - `fix-cap-own`: the last meal of a nearly capped day changed. It passes only if the cap leaves out the receipt's
     own row;
   - `fix-second`: a second correction in the thread, with a relative date read on its own, later day;
   - `fix-preapproved`: a pre-approved receipt corrected. The pre-approval still counts;
   - `fix-over`: an approved receipt raised over $500 after the manager's premature `pre-approved`. It becomes
     Pending, because that approval never counted;
   - `fix-date-cap`: an individual meal's date corrected onto a day whose other individual meals leave no room. It is
     Rejected, `Over daily meal cap`.

   d2 draws its second correction from the same re-check cases. Over 601–650 the 280 corrections end 151 Logged, 32
   Pending, 61 Rejected and 36 no-ops. New controls: `no-recheck`, `correction-no-cap`, `cap-counts-own-row`,
   `cap-counts-rejected`, `total-counts-rejected`, `latest-correction-only`, `correction-receipt-day`,
   `preapproval-forgotten`, `preapproval-any-time`. Tests check that every d3 week has a re-check to Pending and one to
   Rejected, that a Rejected row reaches a later cap and the weekly email, and that the date correction is rejected by
   the cap of its new date.
2. **(medium) The oracle rejected correct weekly emails that differed only in layout** (a dated header, bullets, an
   HTML body with `<br>`). `body_lines()` now strips HTML and list markers and compares only lines of the three
   shapes section 6 lists. A missing, extra or wrong line of those shapes still fails. The variants are in the
   specificity gate, and their wrong-line counterparts are in the mutation gate.
3. **(medium) The rule that a pre-approval counts only on a pending row was almost never exercised** (one
   `approval-again` in 50 seeds). An `approval-again` is now planted in every d3 week and in about half of the d2
   weeks (15 of 26). Every d3 week (and some d2 weeks) also carries the manager's `pre-approved` on a receipt that was
   logged Approved directly (`approval-not-pending`). Control: `no-pending-check`, with a test that it fails on both
   labels.
4. **(low) Repost dates "each relative to its own posting date" were barely exercised.** Every d3 week now has three
   cases. A receipt dated `today` or `yesterday` is reposted on a later day with an explicit date (`repost-rel`). The
   reverse is planted too (`repost-rel-rev`). A near-duplicate repeats the same words on a later day and so states
   another expense date (`near-dup-relative`, processed normally). Control: `repost-rel-now`.
5. **(low) Amount cell format: policy and oracle disagreed.** The oracle now requires the policy's form for text
   cells (`^\d+\.\d{2}$`) and compares number cells by value, as it already did for dates. POLICY.md section 4
   (version 1.1) states exactly that. Mutation operators cover `$1,975.89`, `1,975.89`, `145.000` and `145`.
6. **(low) The reference departed from the policy text where the generator never reached.** Each departure is fixed
   and now has a generator case and a control:
   - (a) A category corrected to Travel re-reads the hotel and flight from the receipt's own text (`fix-cat-travel`;
     control `travel-facts-kept`).
   - (b) A pre-approval counts in the correction path only if the row was pending when it was given
     (`correction-early-approval`; control `preapproval-any-time`).
   - (c) The repost check (amount and date only) runs before the category is read, so a terse repost with no category
     is a repost, not an escalation (`repost-terse`; control `category-first`).
   - (d) The cabin is read only as `business class`, `first class`, `premium economy` or a bare `, business,` item, and
     a flight "for a business meeting" is economy (`cabin-lookalike`; control `cabin-anywhere`).

   The traps for (a) and (d) are random, so their controls are gated on the first two dev-range seeds that carry them.

**Fixed while verifying the first 1.1.0 snapshot (same day).** The first 1.1.0 implementation, which was autosaved
unreviewed, passed `gates.py`, but the full test suite failed. The traps gate looks only at 610–613; the test looks at
every d3 seed of 601–650. Two d3 seeds (602, 619) had no relative-date correction: the first correction of the
`fix-second` thread fell on Friday afternoon, so the second correction lost its later day and fell back to an amount.
That first correction now targets a Monday–Thursday receipt and comes by noon of the next day. The review's
"date correction onto a day near the cap" was added as `fix-date-cap` with the `correction-no-cap` control; before it,
a solver that skipped the cap when re-checking a correction passed every trigger. Adding it moved the RNG streams, and
the dev streams 610–614 then held no international hotel, so `domestic-only` passed every trigger. `hotel-intl` is now
planted in every d3 week, as `flight-six` already was.

## Fixed while building (2026-10-15)

- **Files invisible to arms.** AutomationBench's Slack history omits `attachments`, so a correction could not see the
  original receipt's file and the reference re-checked such receipts as "Receipt required". Files now also appear in
  the text as `[file: <name>]`, and POLICY.md section 7 says so.
- **A negative assertion that misfired on whitespace.** AutomationBench's `slack_message_exists` does not collapse
  spaces, so the first truth (the full reply text) rejected a policy-neutral double space. The truth now gives the
  reply's parts in list form (all must appear in one message); the oracle's own exact check is unchanged.
- **A latent ambiguity found by the reading test.** "Uber back to the hotel" mentions a hotel, and section 7 makes any
  Travel receipt that mentions one a hotel stay. The outcome happened to be the same, but the phrase was removed and
  the generator's self-check now also covers hotel and flight words.
- **Controls that could not fail.** `contains-approved`, `six-hours-ok` and `name-approver` passed every dev trigger
  because "Not pre-approved yet", exactly-6-hour business flights and namesake approvers were random and absent from
  the dev streams. All three are now required in every d3 week (the namesake pointed at a staff member's pending
  receipt so that a namesake exists), and every d2 week has at least one authority trap.
- **A shortcut that was too good.** The naive heuristic first scored 0.62 on the d3 dev streams. The d3 free-receipt
  mix was rebalanced toward the rules a shortcut skips (receipt, alcohol, meal, hotel and flight rejections), with no
  new trap kinds; d2 is unchanged.
- **A pending receipt that was not pending.** A three-night hotel at the low end of the range totalled under $500, so a
  planned pre-approval landed on an Approved row. The pending hotel is now always over $500.

## Limits and not done yet

- **The reading is template-aware.** The reference reads receipts with regexes, a word table and a number-word parser,
  and the generator's templates are finite. The two agree on every receipt built for seeds 601–614 (a test), but
  agreement between two implementations by the same author does not prove that a second reader reads the policy the
  same way. The second-reader fairness gate (§3.11 gate 6) still needs a session that did not write the family. The
  points most likely to be disputed:
  - the written category decides even when the description says otherwise (`declared-category`);
  - a rejected receipt reposted with its file is still a repost (`repost-fixed`): the policy asks for a correction;
  - weekly totals count rows by their Submitted date, so last week's receipt approved this week is not in this week's
    total;
  - the daily cap counts last week's rows for the same expense date;
  - a manager's `pre-approved` given while the row was Approved does not count after a correction makes the receipt
    pending (5.2 "on a receipt that is not pending: do nothing").
- **Two derivations of "pending" in the correction path.** The generator decides on its canonical rows. The reference
  replays the thread: a receipt is pending when its facts at that point are over $500 and pass every rule. Pending
  does not depend on the daily cap, because an individual meal over $50 fails rule 4b first. The two agree on every
  generated stream; they are not the same code.
- **The daily meal cap is narrower than the build spec's wording [D].** The orchestrator's spec (2026-10-14) reads "at
  most $100 of meals per employee per day". POLICY.md rule 4d applies the cap to individual meals only (1 attendee or
  none), because a team meal paid by one employee covers several people and a $75-per-person team meal would almost
  always break a $100 cap. `cap-all-meals` is the control for the literal reading, and it fails (0.929 on 610–614). A
  reviewer who prefers the literal reading would need a policy version bump and regenerated truth.
- **Escalation truth is one case.** Only an unknown poster is undecidable. These are never generated: an ambiguous
  category (the reference would escalate it), a correction posted in a repost's thread, and a correction on a pending
  receipt that the manager approved in an earlier week.
- **Thin margins.** The naive gate passes with a thin margin (0.551 on the d3 dev streams, 0.554 over all d3 seeds).
  The reading-agreement test's coverage floor (at least 15 receipts with the amount in words) is met with 17 on
  601–614. The trigger-level trap shares (0.47 / 0.76) sit above the design's 35% / 60%; the receipt-level shares are
  close to it.
- **The runner and arms do not exist yet.** As for the sibling families, the stream runner (`stream.mjs`), the bridge
  commands (`abr-gen`, `abr-apply`, `abr-grade`) and the arms (§3.7–3.8) are not built; here everything runs in one
  process. Model arms will reach the same `env_response` path through `bridge.py serve` with the rows `gen.serve_input`
  writes.
- **Carry-mode cascades are graded.** An arm that logs a rejected receipt, or misses a correction, carries a wrong
  Submissions sheet into the daily cap and the weekly email; those later failures are its own consequences.
- **Seed ledger.** It has no entries for this family; no labelled stream was run. The 1.1.0 streams differ from 1.0.0
  for every seed (the generator's RNG is keyed on the version), so no 1.0.0 number above carries over.
