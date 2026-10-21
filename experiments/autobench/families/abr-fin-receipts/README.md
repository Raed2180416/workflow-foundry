# abr-fin-receipts: expense receipt capture (AutomationBench-R family 10)

**Status (2026-10-15).** Development, $0. The generator, oracle, observable-only reference workflow, 26 bad controls,
the validity gates and the tests are built. No arm has run and no model was called. Nothing here is a capability
result. Design: [RECURRING-DESIGN.md §4.10](../../../../research/automationbench-20261014/RECURRING-DESIGN.md).
Proposed split: **TRAIN**.

## What it is

A standing automation, like a Zap. Finance writes the policy once ([POLICY.md](POLICY.md)) and it runs on every
message posted in `#expense-submissions`. One stream is one simulated business week, Monday to Friday 16:00, of 31–48
triggers. The world carries over from trigger to trigger: the Submissions worksheet, the channel's threads and the
automation's own replies are the state, and last week's receipts, rows, replies and weekly email are already there.

| Trigger (`kind`) | Arm-visible payload | Correct handling |
|---|---|---|
| `receipt.posted` (24–38/week) | `slack` / `new_message`, top level: ts, user, free text, files | Read the receipt (amount in digits, `USD` or words; date as ISO, month name, today, yesterday or none; category written or from a word table; attendees; receipt; alcohol; client; hotel nights and country; flight cabin and hours). Unknown poster: escalate. Repost: nothing. Otherwise apply the eight rules in order (category, receipt over $25, alcohol, four meal rules including the $100 daily cap on individual meals, hotel nightly, flight cabin). Rejected: reply `Rejected: <reason>`. Passed: append one Submissions row (Approved, or Pending Pre-Approval over $500) and reply `Logged: …` or `Pending pre-approval: …` in the receipt's thread |
| `receipt.corrected` (2–4/week) | `slack` / `new_message`, a thread reply starting `Correction` | Only the receipt's own poster corrects it. Apply the stated values, re-check from rule 1 (the cap counts the employee's *other* rows), update the row in place or append it if the receipt had been rejected, and reply with the new outcome |
| `receipt.reposted` (2–3/week) | `slack` / `new_message`, top level | The same employee, expense date and amount as an earlier top-level message (this week or last), in other words: nothing at all |
| `preapproval.reply` (1–3/week) | `slack` / `new_message`, a thread reply starting `pre-approved` | Only the poster's manager (by email, from the Employees sheet), only on a pending row: Status Approved and `Logged: …` in the thread. Anyone else, "Not pre-approved yet", or a second approval: nothing |
| `week.close` (Friday 16:00) | `schedule` / `week_close`: week_start, date | Email finance@ `Weekly expense totals <week_start>`: per-employee Approved totals of rows submitted this week, `Total: $…`, `Pending pre-approval: <N>` |

The narrow judgment is the reading of a free-text receipt (and of a correction). The reference does it with a small
parser; a workflow arm would use one typed Haiku extraction per message and keep every rule in code. The cross-trigger
state is the daily meal cap (across messages and across the week boundary), pending pre-approvals and who may approve
them, corrections that re-check and update in place, and reposts compared against the channel's history.

All worlds, policies and noise are our own fictional text: invented people, restaurants, hotels, tools, firms and
clients, `*.example.com` addresses. Real city and country names appear only as places. AutomationBench supplies the
app schemas (`WorldState`), the `api_fetch` routing and the assertion handlers, which are used unchanged.

**One adaptation to the simulator.** AutomationBench's Slack history (`Message.to_display_dict`) omits a message's
`attachments`, so a file on an earlier receipt would be invisible to every arm when a correction re-checks it. Files
are therefore also shown in the message text as `[file: <name>]` (as a Slack export shows them), and POLICY.md says so.
The payload still carries `attachments`.

## Grounded on (AutomationBench public set, commit `4a8e106`)

| Task | Span | What it contributes |
|---|---|---|
| `finance.slack_receipt_capture` | `automationbench/domains/finance/tasks.py:1599-1732` | The `#expense-submissions` channel and its free-text messages (`Expense: <what>, $<amount>, category: <C>, date: <date>`); the Expense Tracker with Submissions and Expense Policy worksheets; allowed and rejected categories (Entertainment, Personal, Gifts need VP pre-approval); the $75 per person meal limit that needs the attendee count; a thread reply confirming or rejecting; the escape-room (Entertainment) and Uber (Travel) cases |
| `finance.expense_policy_violation` | `automationbench/domains/finance/tasks.py:9561-9754` | Hotel $250 domestic / $350 international per night, meals $75 team / $50 individual, economy unless over 6 hours (business on a 5-hour flight is a violation), alcohol only for client entertainment with the client's name ("Drinks at conference"), manager pre-approval over $500, receipts over $25 |

**What the adaptation changes [D].** The raw tasks are one batch handled once. Here each message is its own trigger.
The daily meal cap ($100 of individual meals per employee per day, counting logged rows, including last week's) turns
the meal rules into cross-trigger state. Over $500 a receipt waits as `Pending Pre-Approval` until the right manager
replies in its thread. Submitters correct their own receipts in the thread; others' "corrections" change nothing.
Near-identical reposts get nothing. A weekly per-employee totals email closes the week. The policy text, the word
table, the reasons and the formats are our own; the limits are the grounding tasks'.

## Class hypothesis [I, written before any label]

**Either; workflow at high N** (family.json `hypothesis`). Each receipt is easy for an agent: one message, two
lookups (the poster's Employees row, the Submissions rows), eight table rules and one exact reply. Expected `agent-H`
is about 0.75–0.9 per trigger, with failures concentrated on:
- the daily cap across messages and across the week boundary;
- pending pre-approvals: who may approve (by email, not by name), negations, repeats;
- corrections: re-check, update in place, never a second row;
- reposts against the channel's history;
- the free-text reading: synonyms, amounts in words, relative dates, the 6-hour boundary.

A workflow built once, with one typed Haiku extraction per message and every rule and format in code, is expected
at about 0.9 or better. At N = 160 the build cost amortises; at N = 1 an agent is cheaper.

## Files

| File | Role |
|---|---|
| [POLICY.md](POLICY.md) | The standing policy every arm gets (frozen text for v1.0.0) |
| [family.json](family.json) | Id, apps, envelope, trigger kinds and rates per difficulty, trap catalogue, the judgment, need job, hypothesis, split, seeds |
| [gen.py](gen.py) | Seeded generator. It writes `world0` (validated as `WorldState`, round-tripped), the arm-visible `payloads`, the host-only `triggers` (payload + delta + traps), `truth`, `end`, one `serve-inputs` row per trigger (`assertions: []`) and `meta` with sha256. It uses `random.Random(f"{family}:{version}:{seed}:{difficulty}")` and no wall clock. Receipts are structured facts decided by `decide()` against the canonical Submissions rows; text is rendered from the facts afterwards, and a self-check refuses any text whose category or alcohol reading would be ambiguous. It refuses seeds outside 601–650 |
| [oracle.py](oracle.py) | Per-trigger grader. It builds the effect ledger from `world_before` / `world_after` (attribution) and checks the exact effects, the envelope (nothing else written), AutomationBench's own `AssertionRegistry` on an attribution view, and the end-of-week state at Friday's close. Outcomes: correct, abstained, miss, wrong |
| [reference.py](reference.py) | Reference workflow: author-written code, no model, standard library only. It sees only the payload, the policy constants and the tools (`ctx.fetch` → `api_fetch`). It keeps no private state: the channel, its threads and the two worksheets are read back on every trigger |
| [controls.py](controls.py) | 26 bad controls (below) |
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
$PY $F/harness.py run --solver no-cap --seeds 610-614
$PY $F/gates.py [--seeds 610-614] [--out DIR] [--only controls,traps]  # exit 0 only when every gate passes
$PY -m pytest -q -p no:cacheprovider $F/tests
```

## Traps

The host-only truth records each trigger's traps. The simulation computes the labels from the situation; they are
not copied from the plan. Every trap can be resolved from `POLICY.md` and the tools; a generator self-check refuses
any text whose category, alcohol, hotel or flight reading would be ambiguous.

| Kind | Labels | Where | Resolved by |
|---|---|---|---|
| T-format | `synonym`, `declared-category`, `words-amount`, `currency-format`, `date-format`, `drinks`, `hotel-intl`, `flight-long`, `flight-six`, `approval-negated` | `category: Rideshare` / `Lodging` / `Team building`, or no category at all; a software license declared `Office Supplies`; `forty-two dollars and fifty cents`, `USD 45.00`; `Mar 4`, `4 March`, `yesterday`, no date; drinks, wine, happy hour; `Toronto, Canada`; business at 9h 45m or at exactly 6h; "Not pre-approved yet" | Section 7's reading rules and word table; "the category field decides"; "over means strictly more"; "starts with pre-approved" |
| T-authority | `wrong-corrector`, `wrong-approver`, `unknown-poster` | A colleague's "Correction:"; "pre-approved" from the employee, another manager, Finance; a contractor not in Employees | Corrections only from the poster; approvals only from the Manager Email; escalate an unknown poster |
| T-lookalike | `namesake`, `display-name`, `manager-display-name` | An approver with the manager's first name; nicknames in Slack (`Kate Laine` for `Katherine Laine`); a manager shown as `Priya L.` | People by email, names from the Employees sheet |
| T-repeat | `repost`, `repost-history`, `repost-fixed`, `near-dup`, `approval-again` | The same receipt in other words (this week or last week, or now with its file); the same description and amount on another day, another amount the same day, another employee; a second pre-approval | Same employee + expense date + amount, each message read relative to its own date; only a pending row is approved |
| T-state | `meal-cap`, `cap-history`, `cap-under`, `correction`, `correction-fix`, `approval`, `approval-history`, `pending-at-close`, `approved-last-week`, `corrected-total` | Individual meals of one day across messages and across the week boundary; corrections that re-check and update in place or append; last week's pending receipt approved this week (not in this week's totals); corrected amounts in the totals | Sections 4, 5, 6 and rule 4d |

Measured share of `receipt.posted` triggers carrying a trap, over seeds 601–650: **0.32 at d2 and 0.62 at d3**
(design: 35% and 60%). At trigger level the shares are 0.47 and 0.70, because corrections, reposts, pre-approvals and
the week close carry state traps by construction. Plain rule applications (an explicit `Entertainment`, a hotel over
its limit) are context labels and do not count. d1 (smoke only) plants no format traps, nicknames or near-duplicates.

## What the oracle checks

Per trigger, on the effect ledger (world before vs after the trigger):
- **Each expected new Submissions row**: exactly one new row with that Message TS; every column equal (Employee,
  Category and Status ignoring letter case and extra spaces; Amount and Attendees as numbers; dates exactly ISO); no
  other non-empty cell.
- **Each expected row update**: the receipt's existing row, found by Message TS in world_before, changed in place to
  the expected cells (a delete-and-append is not an update).
- **Each expected thread reply**: a new `#expense-submissions` message whose `thread_ts` is the receipt's ts and whose
  text is the expected text (whitespace collapsed, letter case ignored, money compared by value, one trailing period
  tolerated).
- **The weekly email**: one sent message to finance@ and nobody else, the expected subject, and the expected body
  lines as a multiset (line order, blank lines and lines without digits, such as a greeting, are ignored).
- **An escalation**: a new `#automation-review` post naming the trigger id.
- **The envelope**: nothing else created, changed or removed in any app. Harmless: a thread parent's `reply_count`,
  read flags or labels on mail already there.
- **AutomationBench's own handlers**, on an attribution view in which the Slack messages, the sheet rows and the mail
  are only this trigger's: `google_sheets_row_exists` / `_not_exists` (Message TS, Amount, Category, Status),
  `slack_message_exists` (the reply's parts), `gmail_message_sent_to_with_body_contains` (subject and lines).

At Friday's close the oracle adds the end state (nine checks): the Submissions worksheet equals the week's expected
rows with no duplicate Message TS; Employees and Expense Policy unchanged; no pre-existing Slack message edited or
removed; the week's automation replies as a multiset of (thread, text); exactly the expected escalations; nothing
posted elsewhere; exactly one email sent this week; and AutomationBench's `google_sheets_row_exists` per final row.

Outcomes are `correct`, `abstained`, `miss` and `wrong`. `abstained` means the only effects are `#automation-review`
posts and no escalation was expected: no credit, and no wrong-answer penalty. `pass` includes the envelope, and
`pass_core` is reported beside it.

## Numbers [measured, $0, development evidence]

| Run | Result |
|---|---|
| Reference, dev seeds 610–614 (carry) | **199/199 triggers, 5/5 clean weeks**, at most 7 tool steps per trigger (the acceptance bar was ≥ 95%) |
| Reference, practice + dev 601–614 (gate) | 546/546, 14/14 clean weeks; rebased 610–614: 199/199 |
| Reference, all dev-range seeds 601–650 | **1,988/1,988, 50/50 clean weeks** (generator and reference agree on every effect) |
| Triggers per week | d2 31–38, d3 42–48 (seeds 601–650) |
| Determinism, leakage | pass: identical hashes on regeneration, every `world_t` round-trips; payloads equal the inserted message; no truth vocabulary; serve rows hold only POLICY.md + payload |
| Reading agreement | the reference's text reading equals the generator's structured facts on every receipt of 601–614 (amount, date, category, attendees, receipt, alcohol, client, hotel, flight) |
| Oracle mutation score (610–614) | **4,473/4,473 killed (1.00)**, 41 operators (row cells, dropped or duplicated rows, update reverted or done as an append, reply dropped / duplicated / at top level / in another thread / wrong amount, category, verb or reason, email dropped / duplicated / readdressed / cc'd / wrong subject, total, count or line, edits to old rows, Employees or old messages, extra rows, replies, posts, mail) |
| Oracle specificity (610–614) | 1,317/1,317 policy-neutral variants accepted; an equivalent solver (row-by-id update, channel id, blank-line email) passes 199/199 |
| Trap coverage, label streams 610–613 | T-authority 8, T-format 42, T-lookalike 11, T-repeat 16, T-state 41 (each ≥ 5) |
| Gates | `gates.py` (determinism, leakage, solvability, controls, traps, mutation, specificity): **all pass**, exit 0 |
| Tests | `pytest`: **76 passed** in about 200 s (about 15 min when the machine is heavily loaded) |

Controls on dev seeds 610–614 (199 triggers, five weeks). Every control fails. `null` passes exactly the 20 no-op
triggers:

| Control | Pass | Clean weeks | Outcomes |
|---|---|---|---|
| `null` | 20/199 (0.101) | 0/5 | 179 miss |
| `echo` | 0/199 | 0/5 | 199 wrong |
| `naive` (25 lines; no repost, receipt, alcohol, meal, cap, hotel or flight rule; ignores corrections; anyone's "pre-approved" approves) | 116/199 (0.583); **d3 dev streams 0.556** (gate: < 0.60); all 24 d3 seeds of 601–650: 0.561; d2: 0.625 | 0/5 | 72 wrong, 11 miss |
| `no-dedupe` | 182 (0.915) | 0/5 | 17 wrong |
| `no-cap` | 187 (0.940) | 0/5 | 12 wrong |
| `cap-all-meals` | 183 (0.920) | 1/5 | 16 wrong |
| `cap-week-only` | 189 (0.950) | 0/5 | 10 wrong |
| `any-corrector` | 191 (0.960) | 1/5 | 8 wrong |
| `any-approver` | 195 (0.980) | 3/5 | 4 wrong |
| `name-approver` | 195 (0.980) | 3/5 | 4 wrong |
| `contains-approved` | 195 (0.980) | 3/5 | 4 wrong |
| `field-category` | 152 (0.764) | 0/5 | 47 wrong |
| `digits-only` | 188 (0.945) | 2/5 | 3 wrong, 8 miss |
| `drinks-ok` | 194 (0.975) | 3/5 | 5 wrong |
| `slack-name` | 180 (0.904) | 0/5 | 19 wrong |
| `no-preapproval` | 178 (0.894) | 0/5 | 18 wrong, 3 miss |
| `top-level-reply` | 24 (0.121) | 0/5 | 175 wrong |
| `log-rejected` | 131 (0.658) | 0/5 | 68 wrong |
| `total-all-weeks` | 194 (0.975) | 0/5 | 5 wrong |
| `no-receipt-rule` | 178 (0.894) | 0/5 | 21 wrong |
| `domestic-only` | 195 (0.980) | 3/5 | 4 wrong |
| `cabin-ignored` | 191 (0.960) | 2/5 | 8 wrong |
| `six-hours-ok` | 195 (0.980) | 3/5 | 4 wrong |
| `correction-append` | 189 (0.950) | 0/5 | 10 wrong |
| `unknown-logged` | 191 (0.960) | 1/5 | 8 wrong |
| `date-posted` | 112 (0.563) | 0/5 | 87 wrong |

A test asserts that each one-defect control fails on at least one trigger carrying the trap its broken rule resolves.
A further test takes the reference's own correct worlds and makes one plausible slip each (a logged amount one cent
off, the reply at the top level instead of in the thread, a rejected receipt logged anyway): every one is graded
`wrong`. The one-defect controls score 0.76–0.98 per trigger, the band the hypothesis expects for a careless agent, so
clean weeks separate careful handling from careless handling better than the per-trigger rate does.

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
  - the daily cap counts last week's rows for the same expense date.
- **The daily meal cap is narrower than the build spec's wording [D].** The orchestrator's spec (2026-10-14) reads "at
  most $100 of meals per employee per day"; POLICY.md rule 4d applies the cap to individual meals only (1 attendee or
  none), because a team meal paid by one employee covers several people and a $75-per-person team meal would almost
  always break a $100 cap. `cap-all-meals` is the control for the literal reading, and it fails (0.920 on 610–614). A
  reviewer who prefers the literal reading would need a policy version bump and regenerated truth.
- **Escalation truth is one case.** Only an unknown poster is undecidable; an ambiguous category or a correction on a
  pending receipt is never generated (the reference would escalate the first and handles the second by the policy).
- **The naive gate passes with a thin margin** (0.556 on the d3 dev streams, 0.561 over all d3 seeds), and the
  trigger-level trap shares (0.47 / 0.70) sit above the design's 35% / 60%; the receipt-level shares are close to it.
- **The runner and arms do not exist yet.** As for the sibling families, the stream runner (`stream.mjs`), the bridge
  commands (`abr-gen`, `abr-apply`, `abr-grade`) and the arms (§3.7–3.8) are not built; here everything runs in one
  process. Model arms will reach the same `env_response` path through `bridge.py serve` with the rows `gen.serve_input`
  writes.
- **Carry-mode cascades are graded.** An arm that logs a rejected receipt, or misses a correction, carries a wrong
  Submissions sheet into the daily cap and the weekly email; those later failures are its own consequences.
- **Seed ledger.** It has no entries for this family; no labelled stream was run.
