# abr-mkt-suppression: unsubscribe and bounce suppression (AutomationBench-R family 3)

**Status (2026-10-15).** Development, $0. The generator, oracle, observable-only reference workflow, bad controls and
tests are built. No arm has run and no model was called. Nothing here is a capability result. Design:
[RECURRING-DESIGN.md §4.3](../../../../research/automationbench-20261014/RECURRING-DESIGN.md).

## What it is

A standing automation, like a Zap, that the Compliance owner writes once and that runs on every trigger of a recurring
family. The policy is [POLICY.md](POLICY.md): anyone who asks to stop hearing from us, and any address that
hard-bounces, comes off every list, once, and the Compliance Log proves it. One stream is one simulated business week
(Monday 08:00 to Friday 17:00 UTC) of 42–59 triggers. The world carries over from trigger to trigger.

| Trigger (`kind`) | What arrives (arm-visible payload) | Correct handling |
|---|---|---|
| `unsub.request` | A new Unsubscribe Requests row (`google_sheets/new_row`), an `unsubscribe` reply email (`gmail/new_email`), or an updated request row asking to reprocess after a system error (`updated_row`) | Archive the address from every list it is on; one confirmation per address per 30 days; one Compliance Log row. On no list: log `Not subscribed` |
| `bounce.hard` | A new Email Bounces row, type Hard | Archive from every list; `Premium-tier` notes: email the account manager and log `Escalated` (no manager row: escalate to #automation-review) |
| `bounce.soft` | A new Email Bounces row, type Soft | Bounce Log row; the 3rd soft bounce in 30 days (this one included) is handled as a hard bounce, else log `Logged` |
| `bounce.other` | Transient or Unknown | Log `Ignored` |
| `repeat` | A webhook retry (same Ref), a `Duplicate entry` row, a second request from an address already archived, a hard bounce for an address already archived | Nothing for retries and duplicates; `Not subscribed` rows for the others |
| `policy.amendment` (d3) | An email to the suppression inbox | From compliance@ only: one Policy Log row. Otherwise nothing |
| `day.close` | 17:00 Monday to Friday | Release `hold until <date>` rows that are due, then post `<date>: archived N, escalated M, confirmations K` in #compliance. Friday's is the week close |

Before any rule, every row passes four checks in order: a Compliance Log row with its Ref already exists (repeat), the
notes say `duplicate`, the notes say `RESOLVED` / `pre-migration` / `retracted` (log `Skipped`), the notes say
`hold until <date>` (released at the first daily close on or after the date).

State that crosses triggers lives in the world, visible to every arm: the Compliance Log (repeats by Ref, the 30-day
confirmation dedupe, the daily counts), the Bounce Log (30-day soft-bounce counters, pre-seeded with earlier weeks), the
hold notes in the source sheets (some pre-seeded holds from last week fall due this week), Mailchimp member status
(archiving again is a no-op), and the Suppression Policy Log (parameter editions; the authorized d3 amendment lowers the
threshold to 2 or moves the window to 14, 21, 45 or 60 days mid-week).

## Grounded on (AutomationBench public set, commit `4a8e106`)

| Task | Span | What it contributes |
|---|---|---|
| `marketing.newsletter_unsubscribe_processing` | `automationbench/domains/marketing/tasks.py:23331-23612` | Archive from **all** lists (a Slack CAN-SPAM reminder overrides a manager's "keep the product list"); a confirmation email and a compliance log row per request; retracted rows; a row marked processed after a system error must be reprocessed; a look-alike address |
| `marketing.email_blast_suppression` | `automationbench/domains/marketing/tasks.py:34080-34468` | Only Hard bounces are archived; Premium-tier subscribers are escalated to their account manager, not archived; pre-migration and `RESOLVED` rows are invalid; temporary-hold notes; the `bad1@examp1e.com` digit-for-letter look-alike; duplicate rows; an external vendor asking to restore addresses; an older Q4 policy that the newer one overrides |

All worlds, policies and noise are our own fictional text (`*.example.com`). AutomationBench supplies the app schemas
(`WorldState`), the `api_fetch` routing and the assertion handlers, which are used unchanged. The grounding tasks were
read as data only.

## Class hypothesis [I, written before any label]

**Workflow pays**, from N of about 10 (V = $1). The volume is high (40–60 triggers a week), the rule table is strict,
and every trigger needs several lookups (the lists, the Compliance Log by Ref, the Bounce Log window, the Policy Log,
the Account Managers sheet) and an exact log row. 30-day counters, the confirmation dedupe, holds released at the daily
close and look-alike addresses recur every day. Traps sit on about 45% of event triggers at d2 and 75% at d3 (day
closes excluded; repeats, holds, amendments and reprocess requests are traps by construction). Expected:
- `agent-H` about 0.6–0.8 per trigger, with failures concentrated on soft-threshold, repeat and hold triggers;
- `wf-H` and `wfN-H` about 0.95.

Hard requirements: none typed. The append-only Compliance Log is policy, not a router guard input. Proposed split:
held-out (near), so the dev streams 610–613 are for harness rehearsal only, never router fitting.

## Files

| File | Role |
|---|---|
| [POLICY.md](POLICY.md) | The standing policy every arm gets (frozen text for v1.0.0) |
| [family.json](family.json) | Id, apps, envelope, trigger kinds and counts per difficulty, trap catalogue, amendable parameters, need job, hypothesis, seeds |
| [lib.py](lib.py) | Constants and pure helpers shared by the generator and the oracle (not by the reference) |
| [gen.py](gen.py) | Seeded generator: `world0.json`, `triggers.jsonl` (payload + host-only delta + trap ids), `truth.jsonl`, `end.json`, `meta.json`. `random.Random("abr-mkt-suppression:1.0.0:<seed>:<difficulty>")`, no wall clock. The truth comes from its own model of the business (`Gen.simulate`), never from an arm |
| [oracle.py](oracle.py) | Grades one trigger (world before vs after) and the end of the week. Never reads an arm's output to decide what was right |
| [reference.py](reference.py) | The reference workflow: observable-only, written from POLICY.md, standard library only; reaches the world only through `api.fetch` (AutomationBench's `api_fetch`) |
| [controls.py](controls.py) | Thirteen bad controls: `null`, `echo`, `naive` (33 lines) and ten one-defect variants of the reference |
| [harness.py](harness.py) | In-process stream runner and the $0 validity gates (§3.11): `run`, `controls`, `gates`, `mutation`, `export` |
| [tests/test_suppression.py](tests/test_suppression.py) | pytest, inside AutomationBench's venv |

## How to run (inside AutomationBench's own venv; nothing is installed)

From the repository root:

```sh
PY=corpus/AutomationBench/.venv/bin/python
F=experiments/autobench/families/abr-mkt-suppression
$PY -I $F/harness.py run --solver ref --seeds 610-614          # reference, carry mode
$PY -I $F/harness.py controls --seeds 610-614                  # every bad control, carry and rebased
$PY -I $F/harness.py gates --seeds 610-614                     # determinism, leakage, traps, solvability, null, mutation, specificity
$PY -I $F/gen.py --seed 610 --out /tmp/sup-610                 # host-only files for inspection
$PY -I -m pytest -p no:cacheprovider -q $F/tests
```

The harness accepts only seeds 601–650 (practice and dev). Held-out seeds (8801+) are refused and were never generated.

## Results ($0, development evidence; 2026-10-15)

RESULTS_PLACEHOLDER

## What the oracle checks

Per trigger, on the effect ledger (world before vs after the trigger):
- the exact set of Mailchimp members archived during the trigger (any other member change, a new member, or a status
  other than `archived` is a wrong write; the `updated_at` stamp a repeated archive refreshes is masked);
- the emails as a multiset of (recipient, subject), one recipient per email, with the address (and the Bounce ID for
  account-manager emails) in the body, and a confirmation that says the address was removed;
- the exact multiset of Slack posts (or the single #automation-review escalation naming the trigger id);
- the new Compliance Log, Bounce Log and Policy Log rows as multisets (Lists compared as a set; case of values ignored),
  no extra columns, no edited or deleted row in any sheet, no row in any other sheet;
- no other write anywhere (the envelope);
- AutomationBench's own handlers on an attribution view that holds only this trigger's messages and rows
  (`mailchimp_subscriber_is_archived`, `gmail_message_sent_to_with_body_contains`, `google_sheets_row_exists`,
  `slack_message_in_channel`), plus guardrails: `mailchimp_subscriber_in_list` for addresses that must stay (look-alike
  siblings, holds, skipped rows, Premium-tier) and `gmail_message_not_sent_to` for confirmations that must not go out.

Outcomes are `correct`, `abstained` (only sink posts, no escalation expected), `miss` (no effects although some were
expected) or `wrong`.

At the last daily close it adds the end state: the whole Compliance Log, Bounce Log and Policy Log as multisets, earlier
log rows unchanged by id, every member's final archived state, one confirmation per address in the week, account-manager
emails per recipient, this week's #compliance posts, an #automation-review post for each expected escalation, and
AutomationBench assertions (`mailchimp_subscriber_is_archived`, `mailchimp_subscriber_in_list`,
`gmail_message_not_sent_to` for the vendor, the old Q4 policy's address and the marketing manager, and
`slack_text_occurrence_count` per daily post).

## Design choices and deviations from RECURRING-DESIGN §4.3

- **Look-alike domains stay on reserved names.** The grounding task's `bad1@examp1e.com` pattern is reproduced as a
  digit-for-letter swap inside `*.example.com` (`n0rthgate.example.com` vs `northgate.example.com`), so every entity
  stays fictional on example.com.
- **The Compliance Log has a Confirmation column** (Date, Email, Event, Action, Lists, Confirmation, Ref), so the
  "one confirmation per address per 30 days" rule is decidable from the log; the sent mail in Gmail mirrors it.
- **The Bounce Log is the soft-bounce counter** (Date, Email, Bounce ID): one row per counted soft bounce, pre-seeded
  with earlier weeks; skipped, duplicate and held rows are not counted until they are handled.
- **Two actions the design table leaves open are named:** `Not subscribed` (an address on no list: a plus-address
  look-alike, or one already archived) and `Skipped`. An unsubscribe that archives nothing sends no confirmation.
- **Both soft-bounce parameters are amendable** (threshold and window), as the design's §4.3 table says; only
  compliance@company.example.com may amend them.
- **Friday's daily close is the week close.** The family's trigger list has five daily closes and no separate week close.
- **Packaging** follows the sibling families (`experiments/autobench/families/<id>/`, self-contained) rather than the
  design's `experiments/autobench/abr/` layout; no shared piece was needed, so nothing was written under `_shared/`.

## Not done yet

- The stream runner (`stream.mjs`), the bridge commands (`abr-gen`, `abr-apply`, `abr-grade`) and the arms (§3.7–3.8)
  do not exist. Here everything runs in one process: the generator, `abr-apply`-equivalent deltas through the apps'
  pydantic models, AutomationBench's `api_fetch`, and the oracle. The arms will reach the same `api_fetch` through the
  parity-checked `bridge.py serve` and the file mailbox.
- The second-reader fairness gate (§3.11 gate 6) needs a session that did not write the family.
- Effect masking for ids and timestamps from the bridge's `--det` shim is not needed in process. The oracle matches
  records by id (rows, messages) or by (list, address) (members) and compares contents.
- The ledger has no seed entries yet; no labelled stream was run.
