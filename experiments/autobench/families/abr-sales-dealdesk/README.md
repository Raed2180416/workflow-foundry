# abr-sales-dealdesk: closed-won deal desk (AutomationBench-R family 1)

**Status (2026-10-15).** Development, $0. The generator, oracle, observable-only reference workflow, bad controls and
tests are built. No arm has run and no model was called. Nothing here is a capability result. Design:
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

**Workflow pays.** Every closing needs four lookups. Traps sit on most triggers (planted on 50% of fresh closings at d2
and 80% at d3; repeats, reopens, escalations and amendments are traps by construction). The formats are exact, and
dedupe and a running total cross triggers. Expected:
- `agent-H` about 0.5–0.7 per trigger, with clean weeks rare;
- `wf-H` about 0.9 or better after practice;
- `wfN-H` closes most of the rest.

Label at V = $1, N = 160: workflow. At N = 1: agent (the build cost dominates). Proposed split: TRAIN.

## Files

| File | Role |
|---|---|
| [POLICY.md](POLICY.md) | The standing policy every arm gets (frozen text for v1.0.0) |
| [family.json](family.json) | Id, apps, envelope, trigger kinds and rates per difficulty, trap catalogue, amendable parameters, need job, hypothesis, seeds |
| [lib.py](lib.py) | Constants and pure helpers shared by the generator and the oracle (not by the reference) |
| [gen.py](gen.py) | Seeded generator: `world0.json`, `triggers.jsonl` (payload + host-only delta + trap ids), `truth.jsonl`, `end.json`, `meta.json`. `random.Random("abr-sales-dealdesk:1.0.0:<seed>:<difficulty>")`, no wall clock. The truth comes from its own model of the business (`Gen.simulate`), never from an arm |
| [oracle.py](oracle.py) | Grades one trigger (world before vs after) and the end of the week. Never reads an arm's output to decide what was right |
| [reference.py](reference.py) | The reference workflow: observable-only, written from POLICY.md, standard library only; reaches the world only through `api.fetch` (AutomationBench's `api_fetch`) |
| [controls.py](controls.py) | Ten bad controls: `null`, `echo`, `naive` (≤ 40 lines) and seven one-defect variants of the reference |
| [harness.py](harness.py) | In-process stream runner and the $0 validity gates (§3.11): `run`, `controls`, `gates`, `mutation`, `export` |
| [tests/test_dealdesk.py](tests/test_dealdesk.py) | pytest, inside AutomationBench's venv |

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

## Results ($0, development evidence; 2026-10-15)

Dev seeds 610–614 (610, 612, 614 at d2; 611, 613 at d3): 178 triggers, 33/39/35/38/33 per week.

| Solver | Carry: triggers passed | Clean weeks | Rebased |
|---|---|---|---|
| **reference** | **178/178 (1.000)** | **5/5** | 5/5 |
| `null` (does nothing) | 37/178 (0.208, exactly the no-op share); every other trigger `miss` | 0/5 | 0.208 |
| `echo` (payload into #deal-wins and an email) | 0/178, all `wrong` | 0/5 | 0.000 |
| `naive` (≤ 40 lines, ignores notes and authority) | 51/178 (0.287) | 0/5 | 0.287 |
| `nodedupe` | 152/178 (0.854) | 0/5 | 0.882 |
| `asof` (ignores "on or before the close date") | 152/178 (0.854) | 0/5 | 0.882 |
| `noparent` (own cases only) | 153/178 (0.860) | 0/5 | 0.888 |
| `anyauthor` (amendments from anyone) | 169/178 (0.949) | 3/5 (the d2 weeks have no amendments) | 0.989 |
| `sftier` (Salesforce tier, not the sheet) | 154/178 (0.865) | 0/5 | 0.893 |
| `nocomma` (`$156000`) | 53/178 (0.298) | 0/5 | 0.298 |
| `noretract` | 161/178 (0.904) | 0/5 | 0.955 |

Other gates on the same seeds:
- **Determinism and round trip:** two generations give identical hashes, and `world0` validates as `WorldState` and
  survives dump → load → dump, on every seed.
- **Leakage:** payload keys are fixed per event; no payload, delta or `world0` text contains truth vocabulary; the
  reference imports only the standard library.
- **Solvability, wider:** the reference passes 1,787/1,787 triggers with 50/50 clean weeks on seeds 601–650 (practice,
  dev and rehearsal blocks).
- **Oracle mutation score:** 2,868/2,868 = 1.000 (22 mutation operators on the reference's correct worlds: dropped,
  duplicated or misrouted effects, wrong amounts and formats, wrong tier, wrong channel, extra writes, edited old log
  rows, stray sink posts).
- **Trap coverage** (labels from the truth, five weeks): T-lookalike 56, T-stale 33, T-note 34, T-authority 9,
  T-format 29, T-repeat 21; every kind ≥ 5. Share of fresh closings with a trap: d2 0.46–0.65, d3 0.67–0.84; of all
  deal triggers: d2 0.55–0.73, d3 0.76–0.88.

## What the oracle checks

Per trigger, on the effect ledger (world before vs after the trigger):
- the exact multiset of Slack posts (or the single #automation-review escalation naming the trigger id);
- the email recipient set, each recipient once, the subject, and a body with the deal, the `$` amount and the tier;
- the opportunity: only the closing opportunity changes, with the stage and amount on an envelope and the description
  note appended exactly once with the old text kept;
- the log row (or the single Status change to `Retracted`) and the Policy Log row;
- no other write anywhere (the envelope);
- AutomationBench's own handlers on an attribution view that holds only this trigger's messages and rows.

Outcomes are `correct`, `abstained` (only sink posts, no escalation expected), `miss` (no effects although some were
expected) or `wrong`.

At week close it adds the end state: the whole Deal Desk Log and Policy Log as multisets, every touched opportunity's
stage, amount and announcement notes, this week's #deal-wins and #exec-wins posts as multisets, an escalation post for
each expected escalation, notifications per recipient, and `slack_text_occurrence_count` per deal.

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
  records by id and compares contents.
- The ledger has no seed entries yet; no labelled stream was run.
