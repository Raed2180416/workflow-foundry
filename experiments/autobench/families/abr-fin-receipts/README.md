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

NUMBERS_PLACEHOLDER
