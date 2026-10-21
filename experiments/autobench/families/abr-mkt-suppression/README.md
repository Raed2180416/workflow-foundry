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
threshold to 2 or moves the window to 14, 21, 45 or 60 days mid-week). At d2 and d3 the Policy Log also holds a row
Compliance has already approved for a Monday one to five weeks after the week (threshold 2 or 4, or window 14 or 60
days). It does not apply yet; the generator keeps the candidate that changes the fewest, but at least one, of the week's
event outcomes for a solver that ignores the Effective date, and labels those triggers `future-parameter` (T-stale).

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
| [controls.py](controls.py) | Fourteen bad controls: `null`, `echo`, `naive` (33 lines) and eleven one-defect variants of the reference |
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

Dev seeds 610–614 (610, 612, 614 at d2; 611, 613 at d3): 250 triggers, 46/55/47/55/47 per week.

| Solver | Carry: triggers passed | Clean weeks | Rebased |
|---|---|---|---|
| **reference** | **250/250 (1.000)** | **5/5** | 5/5 |
| `null` (does nothing) | 23/250 (0.092, exactly the no-op share); every other trigger `miss` | 0/5 | 0.092 |
| `echo` (payload into #compliance and a "confirmation" to the payload address) | 0/250, all `wrong` | 0/5 | 0.000 |
| `naive` (33 lines; ignores notes, holds, repeats and authority) | 158/250 (0.632); at d3 only 61/110 (0.555) | 0/5 | 0.684 |
| `nodedupe` (no repeat check by Ref) | 218/250 (0.872) | 0/5 | 0.872 |
| `fuzzy` (drops +tags, folds digits to letters) | 218/250 (0.872) | 0/5 | 0.924 |
| `nohold` (archives held rows at once) | 226/250 (0.904) | 0/5 | 0.928 |
| `nopremium` (old Q4 policy: archives Premium-tier) | 229/250 (0.916) | 0/5 | 0.964 |
| `nowindow` (counts every soft bounce on record) | 241/250 (0.964) | 2/5 | 0.984 |
| `confirmall` (no 30-day confirmation dedupe) | 234/250 (0.936) | 1/5 | 0.972 |
| `anyauthor` (amendments from anyone) | 233/250 (0.932) | 3/5 (the d2 weeks have no amendments) | 0.992 |
| `keepproduct` (obeys the manager: keeps Product Updates) | 174/250 (0.696) | 0/5 | 0.732 |
| `noreprocess` (ignores "system error, reprocess") | 239/250 (0.956) | 1/5 | 0.984 |
| `noskip` (ignores RESOLVED / pre-migration / retracted) | 233/250 (0.932) | 1/5 | 0.968 |

Every control fails the bar the reference meets (every trigger, every week clean). The narrow one-defect variants
(`nowindow`, `confirmall`, `anyauthor`, `noreprocess`, `noskip`) only bite where their clause applies, so some of their
weeks are clean; each fails on its own clause's triggers (tests check the trap labels of the failing rows).

Other gates on the same seeds:
- **Determinism and round trip:** two generations give identical hashes, and `world0` and every `world_t` validate as
  `WorldState` and survive dump → load → dump, on every seed.
- **Leakage:** payload keys are fixed per event and row keys equal the sheet headers; no payload, delta or `world0` text
  contains truth vocabulary; `world0` holds no record a delta creates; the reference imports only the standard library
  (`__future__`, `base64`, `datetime`, `re`, `urllib`).
- **Solvability, wider:** the reference passes 2,513/2,513 triggers with 50/50 clean weeks on seeds 601–650 (practice,
  dev and rehearsal blocks). Generator and reference therefore agree on every effect of every one of those triggers.
- **Non-triviality:** `null` passes exactly the no-op share (0.092); the 33-line `naive` heuristic scores 0.555 at d3
  (gate: below 0.60).
- **Oracle mutation score:** 4,088/4,088 = 1.000 over 27 operators on the reference's correct worlds (an archive undone,
  `unsubscribed` instead of `archived`, an extra member archived or noted, emails dropped, duplicated, misaddressed, cc'd,
  re-subjected or emptied, Slack posts dropped, duplicated, miscounted, reformatted or moved, log rows dropped,
  duplicated, re-dated or with a wrong Action, Lists or Confirmation, an earlier log row edited or deleted, a source row
  marked, an extra post, sink post or email).
- **Oracle specificity:** a policy-neutral variant of the reference (another confirmation wording, display-name
  recipients, archive by `PATCH status=archived`, upper-case log values, lists reversed and comma-separated) passes
  250/250: no false rejects.
- **Trap coverage** (triggers carrying each kind, five weeks): T-lookalike 27, T-stale 14, T-note 47, T-authority 13,
  T-format 20, T-repeat 28; every kind ≥ 5. Share of event triggers with a trap: d2 0.44–0.48, d3 0.76–0.78 on these
  seeds; over seeds 601–650, d2 0.43–0.51 (mean 0.46) and d3 0.72–0.80 (mean 0.76). Weeks have 42–49 triggers at d2
  and 52–59 at d3.
- **Tests:** `tests/test_suppression.py`, 44 passed in 228 s (pytest 9.0.2 in the pinned venv, Python 3.13).

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
