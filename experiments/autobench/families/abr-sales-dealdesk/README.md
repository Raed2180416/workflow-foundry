# abr-sales-dealdesk: closed-won deal desk (AutomationBench-R family 1)

**Status (2026-10-21, v1.1.0).** Development, $0. The generator, oracle, observable-only reference workflow, bad
controls, oracle attack tests and tests are built, and were reviewed on 2026-10-21 (section "Review" below). No arm has
run and no model was called. Nothing here is a capability result. Design:
[RECURRING-DESIGN.md §4.1](../../../../research/automationbench-20261014/RECURRING-DESIGN.md).

## What it is

A standing automation, like a Zap, that the Sales Ops owner writes once and that runs on every trigger of a recurring
family. The policy is [POLICY.md](POLICY.md): announce every closed deal once, to the right mailboxes, in the house
format. One stream is one simulated business week (Monday 08:00 to Friday 17:00 UTC) of 30–42 triggers. The world
carries over from trigger to trigger.

| Trigger (`kind`) | What arrives (arm-visible payload) | Correct handling |
|---|---|---|
| `deal.signed` | DocuSign `envelope_completed`: event id, envelope id, deal name as typed, amount, currency | Find the opportunity; set Closed Won and the envelope amount; announce. Escalate if the envelope matches no single opportunity |
| `deal.won` | Salesforce `opportunity_stage_changed` to Closed Won | Announce |
| `deal.repeat` | A retry, the integration's own stage change after an envelope, or an envelope for a deal already won | Nothing |
| `deal.reopened` | Stage moved back from Closed Won | `RETRACTED: <deal>` in #deal-wins; log row Status `Retracted` |
| `ref.changed` | A new Account Hierarchy or FX Rates row, sometimes future-dated | Nothing now; later closings read it |
| `policy.amendment` (d3) | An email to the deal desk inbox | From sales-ops@ only: one Policy Log row. Otherwise nothing |
| `week.close` | Friday 17:00 | `Weekly closed-won: $<sum> across <N> deals` from the Deal Desk Log |

To announce a closing, the arm makes four lookups: the tier (the newest Account Hierarchy row by account ID dated on or
before the close date), the FX rate (the same rule), open Critical or High cases on the account or its parent, and the
owner's name. It then makes five effects: the email, the #deal-wins post (plus #exec-wins at or above the threshold),
the description note, and the log row. State that crosses triggers lives in the world: the Deal Desk Log (dedupe by
event id and by opportunity, retractions, the weekly total) and the Policy Log (parameter editions).

## Grounded on (AutomationBench public set, commit `4a8e106`)

| Task | Span | What it contributes |
|---|---|---|
| `sales.multi_hop_lookup` | `automationbench/domains/sales/tasks.py:40-355` | Tier from the newest of conflicting Account Hierarchy rows; EUR to USD at the newer rate; an open Critical case on the parent account; the routing table, subject `Deal Closed Notification`, `$` with comma grouping; Meridian Corp, Meridian Corporation and Meridian Solutions look-alikes |
| `sales.slack_deal_notification` | `automationbench/domains/sales/tasks.py:8768-9108` | The `CLOSED: <deal> \| $<amount> \| <tier> \| AE: <owner>` post; the description noting the announcement; an already-won look-alike deal; an account note asking for other routing, which has no authority |
| `sales.docusign_completion_processor` | `automationbench/domains/sales/tasks.py:26751-27112` | Completed envelopes close the opportunity and set its amount; look-alike signer domains |

All worlds, policies and noise are our own fictional text (`*.example.com`). AutomationBench supplies the app schemas
(`WorldState`), the `api_fetch` routing and the assertion handlers, which are used unchanged.

## Class hypothesis [I, written before any label]

**Workflow pays.** Every closing needs four lookups. Traps sit on most triggers (planted on exactly 50% of fresh
closings at d2 and 80% at d3; repeats, reopens, escalations and amendments are traps by construction). The formats are
exact, and dedupe and a running total cross triggers. Expected:
- `agent-H` about 0.5–0.7 per trigger, with clean weeks rare;
- `wf-H` about 0.9 or better after practice;
- `wfN-H` closes most of the rest.

Label at V = $1, N = 160: workflow. At N = 1: agent (the build cost dominates). Proposed split: TRAIN.

## Files

| File | Role |
|---|---|
| [POLICY.md](POLICY.md) | The standing policy every arm gets (frozen text for v1.1.0) |
| [family.json](family.json) | Id, apps, envelope, trigger kinds and rates per difficulty, trap catalogue, amendable parameters, need job, hypothesis, seeds |
| [lib.py](lib.py) | Constants and pure helpers shared by the generator and the oracle (not by the reference) |
| [gen.py](gen.py) | Seeded generator: `world0.json`, `triggers.jsonl` (payload + host-only delta + trap ids), `truth.jsonl`, `end.json`, `meta.json`. `random.Random("abr-sales-dealdesk:1.1.0:<seed>:<difficulty>")`, no wall clock. The truth comes from its own model of the business (`Gen.simulate`), never from an arm |
| [oracle.py](oracle.py) | Grades one trigger (world before vs after) and the end of the week. Never reads an arm's output to decide what was right |
| [reference.py](reference.py) | The reference workflow: observable-only, written from POLICY.md, standard library only; reaches the world only through `api.fetch` (AutomationBench's `api_fetch`) |
| [controls.py](controls.py) | Ten bad controls: `null`, `echo`, `naive` (≤ 40 lines) and seven one-defect variants of the reference |
| [harness.py](harness.py) | In-process stream runner and the $0 validity gates (§3.11): `run`, `controls`, `gates`, `mutation`, `export` |
| [tests/test_dealdesk.py](tests/test_dealdesk.py) | pytest, inside AutomationBench's venv: generator, leakage, solvability, controls, oracle, docs |
| [tests/test_oracle_attack.py](tests/test_oracle_attack.py) | Oracle attack: valid alternatives accepted, tolerated forms accepted on purpose, plausible-but-wrong variants rejected; Slack ts collisions; cross-process determinism |

## How to run (inside AutomationBench's own venv; nothing is installed)

From the repository root:

```sh
PY=corpus/AutomationBench/.venv/bin/python
F=experiments/autobench/families/abr-sales-dealdesk
$PY -I $F/harness.py run --solver ref --seeds 610-614          # reference, carry mode
$PY -I $F/harness.py controls --seeds 610-614                  # every bad control, carry and rebased
$PY -I $F/harness.py gates --seeds 610-614                     # determinism, leakage, traps, solvability, null, mutation
$PY -I $F/gen.py --seed 610 --out /tmp/dd-610                  # host-only files for inspection
$PY -I -m pytest -p no:cacheprovider -q $F/tests
```

The harness accepts only seeds 601–650 (practice and dev). Held-out seeds (8801+) are refused and were never generated.

## Results ($0, development evidence; v1.1.0, 2026-10-21)

Dev seeds 610–614 (610, 612, 614 at d2; 611, 613 at d3): 177 triggers, 31/38/34/40/34 per week. Commands as above.

| Solver | Carry: triggers passed | Clean weeks | Rebased pass rate |
|---|---|---|---|
| **reference** | **177/177 (1.000)** | **5/5** | 1.000 (177/177, 5/5 clean) |
| `null` (does nothing) | 36/177 (0.203, exactly the no-op share); every other trigger `miss` | 0/5 | 0.203 |
| `echo` (payload into #deal-wins and an email) | 0/177, all `wrong` | 0/5 | 0.000 |
| `naive` (39 lines, ignores notes and authority) | 49/177 (0.277); the d3 weeks 19/78 (0.244) | 0/5 | 0.277 |
| `nodedupe` | 151/177 (0.853) | 0/5 | 0.881 |
| `asof` (ignores "on or before the close date") | 151/177 (0.853) | 1/5 | 0.876 |
| `noparent` (own cases only) | 163/177 (0.921) | 1/5 | 0.944 |
| `anyauthor` (amendments from anyone) | 167/177 (0.944) | 3/5 (the d2 weeks have no amendments) | 0.989 |
| `sftier` (Salesforce tier, not the sheet) | 149/177 (0.842) | 0/5 | 0.870 |
| `nocomma` (`$156000`) | 52/177 (0.294) | 0/5 | 0.294 |
| `noretract` | 160/177 (0.904) | 0/5 | 0.955 |

Other gates on the same seeds:
- **Determinism and round trip:** two generations give identical hashes, and `world0` validates as `WorldState` and
  survives dump → load → dump, on every seed. Two separate interpreters write byte-identical files (test).
- **Leakage:** payload keys are fixed per event; no payload, delta or `world0` text contains truth vocabulary; the
  reference imports only the standard library.
- **Solvability, wider:** the reference passes 1,793/1,793 triggers with 50/50 clean weeks on seeds 601–650 (practice,
  dev and rehearsal blocks), and 112/112 triggers on the d1 smoke weeks of seeds 610–614.
- **Oracle mutation score:** 3,590/3,590 = 1.000 (28 mutation operators on the reference's correct worlds: dropped,
  duplicated or misrouted effects, wrong amounts and formats, wrong tier, a second tier or `$` amount in the email,
  the note on the same line, odd CloseDate or Probability, wrong channel, extra writes, a post deleted again, edited
  old log rows, stray sink posts).
- **Oracle attack** ([tests/test_oracle_attack.py](tests/test_oracle_attack.py), d3 weeks 611 and 613, every case on
  both): 13 cases accepted and 15 plausible-but-wrong cases rejected as `wrong`.
  - Accepted: one email per recipient with prose around the facts, Cc instead of To, draft then send, a whole-row
    retraction, escalation by channel id, CRM bookkeeping, a chattier body quoting the account and the typed deal
    name, a trailing period on the note, and the two tolerated cell forms below.
  - Rejected: a BCC to the AE; clearing or appending a row instead of retracting; escalation plus an email; escalation
    without the trigger id; a weekly total counting retracted rows; a hedged second tier; a second `$` figure; the
    note on the same line; CloseDate 2020-01-01; Probability 3; a post deleted again; the approver's name instead of
    the address; an unauthorized amendment applied; a EUR envelope's amount written to Salesforce in USD.
- **Trap coverage** (labels from the truth, five weeks): T-lookalike 64, T-stale 41, T-note 32, T-authority 15,
  T-format 17, T-repeat 21; every kind ≥ 5. Planted share of fresh closings: d2 0.500–0.522, d3 0.783–0.800. Labelled
  share of closings: d2 0.50–0.54, d3 0.83–0.85. Labelled share of all deal triggers: d2 0.61–0.65, d3 0.87–0.88
  (spec: about 50% and 80%).
- **Tests:** 103 passed (`pytest` in AutomationBench's venv, 2.5–4.5 minutes).

## What the oracle checks

Per trigger, on the effect ledger (world before vs after the trigger):
- the exact multiset of Slack posts (or the single #automation-review escalation naming the trigger id);
- the email recipient set, each recipient once, the subject, and a body with the deal, the `$` amount and the tier, and
  no other tier or `$` amount (policy step 8). 'SMB' and 'Mid-Market' count anywhere; Enterprise, Strategic, Partner
  and Growth, which are also ordinary words, count only within three words of "tier". Quoted record names are
  removed first;
- the opportunity: only the closing opportunity changes, with the stage and amount on an envelope and the description
  note appended exactly once, on its own line, with the old text kept;
- the log row (or the single Status change to `Retracted`) and the Policy Log row;
- no other write anywhere (the envelope), including a Slack post made and deleted again during the trigger;
- AutomationBench's own handlers on an attribution view that holds only this trigger's messages and rows.

Outcomes are `correct`, `abstained` (only sink posts, no escalation expected), `miss` (no effects although some were
expected) or `wrong`.

At week close it adds the end state: the whole Deal Desk Log and Policy Log as multisets, every touched opportunity's
stage, amount and announcement notes, this week's #deal-wins and #exec-wins posts as multisets, an escalation post for
each expected escalation, notifications per recipient, and `slack_text_occurrence_count` per deal.

## What the oracle tolerates (on purpose)

- **Equivalent cell values** in the Deal Desk Log and the Policy Log:
  - `$156,000` for `156000`;
  - `announced` for `Announced`;
  - `$350,000` for an Exec threshold of `350000`;
  - `;` or `,` between Routed To addresses, in any order.

  This mirrors AutomationBench's own sheet matching (`_cell_values_equal`,
  `automationbench/rubric/assertions/google_sheets.py:50-90`). The policy still asks for digits only and `Announced`,
  and an arm that writes other forms may trip over its own rows on a later trigger. That cost is real, and it is graded
  where it lands.
- **CRM bookkeeping on the closing opportunity** that agrees with the closing: IsClosed and IsWon true, Probability
  100, CloseDate equal to the close date. Other values, such as CloseDate 2020-01-01 or Probability 3, are overreach.
- **A trailing period** after the description note. The per-trigger check and the week-close check read it the same
  way.
- **Mail housekeeping:** read flags, labels and stars, and a draft that is sent within the same trigger.

## Review (2026-10-21, v1.0.0 → v1.1.0)

An attack on the v1.0.0 oracle ran valid alternatives and plausible-but-wrong runs on real triggers. It found the
problems below, all fixed:
- **A description note on the same line passed per trigger but failed at week close.** The two readings disagreed. Both
  now require the note on its own line, and both tolerate a trailing period.
- **Any CloseDate or Probability passed.** `CLOSE_FIELDS` allowed these fields with any value. Now only values that
  agree with the closing pass.
- **A Slack post made and deleted again passed.** Deleted new records were dropped from the ledger. Now they are an
  envelope violation.
- **A hedged email passed,** for example "Tier: Strategic (sheet says Enterprise)". POLICY.md step 8 now says the body
  names no other tier and no other `$` amount. The oracle checks this with a rule that leaves ordinary prose alone.
- **Slack records were keyed by (channel, ts).** AutomationBench stamps a post `<unix second>.<random 6 digits>`
  (`automationbench/schema/slack/base.py:28-34`), so two posts can share a ts. One of them would then be merged away
  or read as an edit. The ledger and the week-close check now compare Slack records as multisets. This may explain one
  `envelope` failure in the attack run of 2026-10-15, which never reproduced.
- **A look-alike sender used a non-reserved domain** (`company-example.com`). It is now `company.example.net`.
- **The trap share varied widely between weeks of the same difficulty.** Each closing got its own coin flip, so one d2
  week had 0.33 of its closings trapped and one d3 week had 0.96. The planted share is now exact per week.
- **The `naive` control was 43 lines,** over the design's limit of 40. It is now 39 lines with the same behaviour
  (49/177), and a test holds the limit.

The version bump changes the generator's seed string, so every stream differs from v1.0.0. No arm ever ran on v1.0.0,
so nothing is invalidated.

## Fixed while resuming (2026-10-15)

- The truth's expected log row was the same object as the simulated log row, so a later retraction rewrote an earlier
  trigger's expectation (`Status: Retracted`). The reference was graded wrong on that trigger, which exposed the bug.
  The truth now keeps a copy.
- Dated reference rows can no longer tie: there is one Account Hierarchy row per (account, date) and one FX row per
  (currency, date). The policy's "newest row" therefore never needs a tie-break. Policy Log ties resolve to the later
  row in both implementations.
- The d2 volume floor rose from 29 to 30 triggers (deal.won 12–13), so it stays in the spec's 30–45 range.
- `harness.py run` computed its summary after dropping passed rows; the summary now covers every row. The default seeds
  are now the dev gate, 610–614.
- The end-of-week check no longer fails the week a second time for extra #automation-review posts, which are already
  graded at their own triggers.

## Not done yet

- The stream runner (`stream.mjs`), the bridge commands (`abr-gen`, `abr-apply`, `abr-grade`) and the arms (§3.7–3.8)
  do not exist. Here everything runs in one process: the generator, `abr-apply`-equivalent deltas through the apps'
  pydantic models, AutomationBench's `api_fetch`, and the oracle. The arms will reach the same `api_fetch` through the
  parity-checked `bridge.py serve` and the file mailbox.
- The second-reader fairness gate (§3.11 gate 6) needs a session that did not write the family.
- Effect masking for ids and timestamps from the bridge's `--det` shim is not needed in process. The oracle matches
  Gmail messages, Salesforce records and sheet rows by id and compares contents, and compares Slack posts as multisets
  of whole records.
- The ledger has no seed entries yet; no labelled stream was run.
