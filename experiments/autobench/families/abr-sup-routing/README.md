# abr-sup-routing: support queue routing (AutomationBench-R family 7)

**Status (2026-10-15).** Development, $0. The generator, oracle, observable-only reference workflow, 22 bad controls,
the validity gates and the tests are built. No arm has run and no model was called. Nothing here is a capability
result. Design: [RECURRING-DESIGN.md §4.7](../../../../research/automationbench-20261014/RECURRING-DESIGN.md).
Proposed split: **TRAIN**.

## What it is

A standing automation, like a Zap. Support Ops writes the policy once ([POLICY.md](POLICY.md)) and it runs on every
trigger of a recurring family. One stream is one simulated business week, Monday to Friday, of 33–48 triggers. The
world carries over from trigger to trigger. Tickets of customers on hold wait in Freshdesk (Open, no group) until a
later trigger lifts the hold. Tier changes carry an Effective Date that takes effect mid-week. The daily totals are
counted from the routing notes and from the held queue.

| Trigger (`kind`) | Arm-visible payload | Correct handling |
|---|---|---|
| `ticket.created` (25–37/week) | `freshdesk` / `ticket_created`: the ticket (id, subject, description, status, priority, requester_id, group_id, tags, created_at) and the requester's email | Never touch a ticket that has a group or is not Open. Customer = the requester's company (contact → `company_id` → name), matched to Customer Tiers by **exact** name. If the Notes start with HOLD or SUSPENDED: nothing. Otherwise take the tier in effect today (the Previous Tier before the Effective Date), the area from the tags only, and "complex" for Premium. Apply the first matching row of the 14-row Queue Routing Config. Set `group_id` and add one private note `routed to <queue> (<rule>)` |
| `tier.changed` (2–4/week) | `google_sheets` / `row_updated` on Customer Tiers: row number, changed columns, Company and the changed cells | If the customer is no longer on hold, route its waiting tickets (Open, no group, same customer by exact name) with today's tier. Otherwise nothing. Hold placed, hold kept, upgrade or downgrade with an Effective Date: nothing |
| `ticket.assigned` (1–2/week) | `freshdesk` / `ticket_updated`: ticket id, `changed: ["group_id"]`, the group, who | Nothing, now or later. A held ticket a person assigned is not released |
| `day.close` (5/week, 17:00 UTC) | `schedule` / `day_close`: the date | Post `<date>: routed <N>, held <M>` in #support-routing. N = routing notes dated that day (releases included, people's notes excluded); M = Open tickets with no group whose customer is on hold. Friday's close is the last trigger and carries the end-of-week grading |

The "complex" rule is the family's one narrow judgment: priority ≥ 3, or the description reports ≥ 10,000 records,
or it names two or more of the listed external systems as affected. It is decided once per Premium ticket. Over seeds
601–650 there are 616 Premium routings. 197 of them (32%) carry a records, systems or number sentence, and 89 (14%)
are complex by the text alone.

All worlds, policies and noise are our own fictional text: invented people and companies, `*.example.com` domains,
the fictional product "Tallyline". The external systems named in descriptions are AutomationBench's own simulated apps.
`NexaGen` and `NexaGen Solutions` are AutomationBench's own fictional entities. AutomationBench supplies the app
schemas (`WorldState`), the `api_fetch` routing and the assertion handlers, which are used unchanged. AutomationBench's
Freshdesk has no group objects, so queue ids are plain `group_id` strings taken from the config sheet.

## Grounded on (AutomationBench public set, commit `4a8e106`)

| Task | Span | What it contributes |
|---|---|---|
| `support.freshdesk_multi_queue_routing` | `automationbench/domains/support/tasks.py:43455-44180` | The two sheets (tiers with Notes; a 14-row Rule / Condition / Queue_Group_ID / Notes config); Enterprise always senior; Premium complex ("priority ≥ 3 or large data", "multi-system or large records") vs simple; billing; general fallback; unknown tier → general; HOLD and SUSPENDED companies not routed (`NexaGen Solutions`); assigned and closed tickets skipped; an internal note naming the queue; a summary with the routed count in #support-routing |
| `support.intercom_multi_product_routing` | `automationbench/domains/support/tasks.py:44183-45061` | The customer from the contact's company record; a description that uses a word ("billing") that is not the area; one vs several products named (here: external systems for complexity); entitlements that changed recently (here: Effective Dates); closed and snoozed items skipped; only approved overrides count (here: Slack requests to hold a customer do not). Raw Haiku 15/16 [measured, RECURRING-DESIGN Appendix A] |

**What the adaptation changes [D].** The raw Freshdesk task is one batch of 15 tickets handled once. Here each ticket
is its own trigger. Holds are placed and **lifted** during the week, and the waiting tickets must then be released
exactly. A tier change has an Effective Date: before it the Previous Tier applies, and an onboarding customer has no
tier yet. People assign tickets between triggers. The summary becomes a daily `routed N, held M` counted from the
world's notes and the held queue. The 14-row table is our own complete version: it has a skip row for assigned
tickets and one for tickets that are not open. There is no junior integrations queue, so simple Premium and Standard
integration tickets fall to `grp_general`. "First matching row, top to bottom" settles tickets with two area tags.

## Class hypothesis [I, written before any label]

**Either** (family.json `hypothesis`). Most tickets need four lookups (ticket, contact, company, tier row), a 14-row
first-match table and two exact writes. A per-trigger Haiku agent should mostly get these right, with failures
concentrated on four things:
- the cross-trigger state: releases, the held count, and people's assignments while a customer is on hold;
- effective dates;
- exact-name look-alikes;
- the Premium complexity reading.

Expected `agent-H` is about 0.75–0.9 per trigger. A workflow built once, with one typed Haiku call for the complexity
judgment, is expected at about 0.9 or better. Label: workflow at N = 160 if agent-H is below about 0.85, otherwise
either.

The plausible one-defect controls below score 0.89–0.99 per trigger. That is the same band, so clean weeks separate
careful handling from careless handling better than the per-trigger rate does.

## Files

| File | Role |
|---|---|
| [POLICY.md](POLICY.md) | The standing policy every arm gets (frozen text for v1.0.0) |
| [family.json](family.json) | Id, apps, envelope, trigger kinds and rates per difficulty, trap catalogue, the judgment, need job, hypothesis, split, seeds |
| [gen.py](gen.py) | Seeded generator. It writes `world0` (validated as `WorldState`, round-tripped), the arm-visible `payloads`, the host-only `triggers` (payload + delta + traps), `truth`, `end`, one `serve-inputs` row per trigger (`assertions: []`) and `meta` with sha256. It uses `random.Random(f"{family}:{version}:{seed}:{difficulty}")` and no wall clock. The truth comes from its own canonical model (`Gen.simulate`), never from an arm. Descriptions are built from structured parts, and "complex" is computed from the parts, not from the text. It refuses seeds outside 601–650 |
| [oracle.py](oracle.py) | Per-trigger grader. It builds the effect ledger from `world_before` / `world_after` (attribution) and checks the exact effects, the envelope (nothing else written), AutomationBench's own `AssertionRegistry` on an attribution view, and the end-of-week state at Friday's close. Outcomes: correct, abstained, miss, wrong |
| [reference.py](reference.py) | Reference workflow: author-written code, no model, standard library only. It sees only the payload, the policy constants and the tools (`ctx.fetch` / `ctx.batch` → `api_fetch`). It reads and parses the Queue Routing Config sheet, keeps no private state and imports no host module |
| [controls.py](controls.py) | 22 bad controls (below) |
| [harness.py](harness.py) | `$0` stream runner. It applies each delta (insert, set_cells, and `update` for a person's change to a ticket) and calls the tools through `bridge.Rollout.batch`: the official `env_response` path, with the determinism shim and clock = trigger time. It grades every trigger, in carry and rebased modes |
| [gates.py](gates.py) | The $0 validity gates of RECURRING-DESIGN §3.11 (`--only` runs a subset) |
| [tests/test_routing.py](tests/test_routing.py) | pytest suite (65 tests) |

Nothing was added under `families/_shared/`: like the sibling families, this one keeps its harness and helpers in its
own directory.

## Commands

All of these run inside AutomationBench's own venv (`uv sync` in `corpus/AutomationBench`, pinned by its `uv.lock`):

```
PY="corpus/AutomationBench/.venv/bin/python -I -B"
F=experiments/autobench/families/abr-sup-routing
$PY $F/gen.py --seed 610 --out HOSTDIR                                # host-only stream files
$PY $F/harness.py run --solver reference --seeds 601-614 [--mode rebased] [--failures]
$PY $F/harness.py run --solver ignore-effective --seeds 610-614
$PY $F/gates.py [--seeds 610-614] [--out DIR] [--only controls,traps]  # exit 0 only when every gate passes
$PY -m pytest -q -p no:cacheprovider $F/tests
```

## Traps

The host-only truth records each trigger's traps. The simulation computes the labels from the situation; they are
not copied from the plan. Every trap can be resolved from `POLICY.md` and the tools.

| Kind | Labels | Where | Resolved by |
|---|---|---|---|
| T-lookalike | `lookalike`, `domain`, `release-lookalike` | `NexaGen` (not in Customer Tiers) vs `NexaGen Solutions` (Enterprise); a short name that is a prefix of another customer's (Standard vs Enterprise); consultants whose email domain is another customer's; a requester with no company writing from a customer's domain; a lifted hold beside a similarly named customer that is still held | Exact name (case and spaces ignored); the contact's `company_id`, never the domain |
| T-note | `held`, `hold-decoy`, `stale-hold-note`, `still-held`, `hold-added`, `status-on-hold`, `unknown` | Notes starting `HOLD` / `SUSPENDED` (any case); "Former HOLD lifted…", "Was suspended in 2025…"; a Freshdesk company note saying HOLD; a Notes edit that keeps the hold; ticket status 6 "On Hold"; customers not in the sheet | "Notes start with the word"; "only these Notes hold a customer"; status 2 only |
| T-format | `tags-vs-desc`, `multi-area`, `tag-lookalike`, `tag-case`, `records-complex`, `records-small`, `number-decoy`, `systems-complex`, `systems-decoy`, `cue-nonpremium` | Tags that disagree with the description; two area tags; `api-docs`, `billing-address`; `API`; `12,400` / `12400` / `12k records`; error codes, order numbers, amounts, API calls; two affected systems; "X is unaffected", "We stopped using X", one system named twice; complexity cues on Standard or Enterprise | Area from tags only; first matching row; the records and systems rules of section 3.7; complexity matters for Premium only |
| T-repeat | `assigned`, `not-open`, `person-assigned`, `assigned-held`, `held-not-open` | Tickets created with a group or not Open; a person assigns a held ticket before its release; a Pending held ticket | Skip rows; "waiting" means Open with no group |
| T-stale | `effective-future`, `effective-today`, `effective-past`, `no-tier-yet`, `tier-change` | Effective Dates mid-week (world0) and tier changes during the week; old Previous Tiers that no longer apply; onboarding customers with no Previous Tier | Section 3.5 |
| T-authority | `authority` | A #support-routing message from an agent asking to hold a customer | "Requests from anyone else do not" hold a customer |
| T-state | `release`, `count-noise`, `count-release`, (`held-count`, context) | Lifted holds; people's notes on the day; released tickets in the day's total; a non-empty held queue at the close | Sections 4 and 6 |

Measured share of triggers carrying a trap, over seeds 601–650: **0.406 at d2 and 0.679 at d3** (design: 40% and
65%). The share of ticket triggers carrying a trap is 0.32 and 0.65. d1 (smoke only) plants none on tickets. The d3 mix
leans on the rules a shortcut skips (see "Fixed while building"), which puts it a little above the design's 65%.

## What the oracle checks

Per trigger, on the effect ledger (world before vs after the trigger):
- **Each expected route.** The ticket (by record id) changed. Its `group_id` is the expected queue. It has exactly
  one new note, which is private and whose text is the expected `routed to <queue> (<rule>)`. Its earlier notes are
  unchanged, and no other ticket field changed (`updated_at` excepted).
- **Each expected #support-routing post.** Texts compare with whitespace collapsed and letter case ignored, and one
  trailing period is tolerated.
- **The envelope.** Nothing else was created, changed or removed in any app.
- **AutomationBench's own handlers**, on an attribution view in which each ticket's notes, the Slack messages and the
  sheet rows are only this trigger's: `freshdesk_ticket_exists` with `group_id`, `freshdesk_ticket_has_note` /
  `_not_has_note` (the queue id, the rule, `grp_senior` for non-senior queues, `routed` for held and skipped
  tickets), and `slack_message_exists`.

At Friday's close the oracle adds the end state:
- every ticket's final group, status, priority, tags, subject, description and requester;
- earlier notes unchanged and the routing notes as a multiset;
- no ticket added or removed; contacts and companies unchanged;
- Customer Tiers exactly as the week's edits left it, and the Queue Routing Config unchanged;
- the week's #support-routing messages as a multiset, and no pre-existing message edited;
- AutomationBench's `freshdesk_ticket_exists` per routed ticket and `slack_text_occurrence_count` per daily post, on
  the whole world.

Outcomes are `correct`, `abstained`, `miss` and `wrong`. `abstained` means the only effects are #automation-review
posts and no escalation was expected: no credit, and no wrong-answer penalty. `miss` means no effects although some
were expected. `pass` includes the envelope, and `pass_core` is reported beside it.

## Numbers [measured, $0, development evidence]

| Run | Result |
|---|---|
| Reference, dev seeds 610–614 (carry) | **195/195 triggers, 5/5 clean weeks**, at most 11 tool steps per trigger (the acceptance bar was ≥ 95%) |
| Reference, practice + dev 601–614 (gate) | 558/558, 14/14 clean weeks; rebased 610–614: 195/195 |
| Reference, all dev-range seeds 601–650 | 2,035/2,035, 50/50 clean weeks |
| Triggers per week | d2 33–41, d3 42–48 (seeds 601–650) |
| Determinism, leakage | pass: identical hashes on regeneration, every `world_t` round-trips; payloads equal the world after the delta; no truth vocabulary; serve rows hold only POLICY.md + payload |
| Oracle mutation score (610–614) | **4,267/4,267 killed (1.00)**, 33 operators (wrong or dropped group, note text, queue or rule in the note, public note, duplicate note, other ticket fields, a held ticket routed, an assigned ticket regrouped, edits to tiers, config or contacts, extra posts, post counts or format, deleted messages) |
| Oracle specificity (610–614) | 644/644 policy-neutral variants accepted (trailing period or newline, letter case, extra spaces, bot name, `updated_at`); an equivalent solver (PATCH, `/conversations`, channel id) passes 195/195 |
| Trap coverage, label streams 610–613 | T-authority 6, T-format 23, T-lookalike 15, T-note 21, T-repeat 24, T-stale 6, T-state 17 (each ≥ 5) |
| Tests | `pytest`: **65 passed** in about 225 s |

Controls on dev seeds 610–614 (195 triggers, five weeks). Every control fails. `null` passes exactly the 34 no-op
triggers:

| Control | Pass | Clean weeks | Outcomes |
|---|---|---|---|
| `null` | 34/195 (0.174) | 0/5 | 161 miss |
| `echo` | 0/195 | 0/5 | 195 wrong |
| `naive` (21 lines; ignores holds, effective dates, skips, Slack; substring company; priority-only complexity) | 133/195 (0.682); **d3 dev streams 0.570** (gate: < 0.60); all 25 d3 seeds of 601–650: 0.586; d2: 0.761 | 0/5 | 56 wrong, 6 miss |
| `substring-company` | 185 (0.949) | 3/5 | 8 wrong, 2 miss |
| `domain-company` | 191 (0.979) | 3/5 | 4 wrong |
| `contains-hold` | 188 (0.964) | 3/5 | 5 wrong, 2 miss |
| `ignore-hold` | 157 (0.805) | 0/5 | 37 wrong |
| `no-release` | 179 (0.918) | 0/5 | 10 wrong, 6 miss |
| `ignore-effective` | 191 (0.979) | 3/5 | 4 wrong |
| `desc-area` | 187 (0.959) | 2/5 | 8 wrong |
| `tag-order` | 191 (0.979) | 3/5 | 4 wrong |
| `priority-only` | 184 (0.944) | 1/5 | 11 wrong |
| `any-number` | 189 (0.969) | 2/5 | 6 wrong |
| `count-mentions` | 193 (0.990) | 4/5 | 2 wrong |
| `route-assigned` | 178 (0.913) | 0/5 | 17 wrong |
| `release-assigned` | 183 (0.938) | 1/5 | 12 wrong |
| `route-not-open` | 187 (0.959) | 3/5 | 8 wrong |
| `count-all-notes` | 181 (0.928) | 0/5 | 14 wrong |
| `held-today` | 174 (0.892) | 0/5 | 21 wrong |
| `public-note` | 59 (0.303) | 0/5 | 136 wrong |
| `stale-hold` | 188 (0.964) | 3/5 | 4 wrong, 3 miss |
| `slack-authority` | 168 (0.862) | 0/5 | 20 wrong, 7 miss |

A test asserts that each one-defect control fails on at least one trigger carrying the trap its broken rule resolves.
A further test moves each of the reference's routed tickets to the neighbouring queue (the plausible-but-wrong run)
and checks that every one is graded `wrong`.

## Fixed while building (2026-10-15)

- **A negative assertion that misfired.** The first truth asserted `freshdesk_ticket_not_has_note(body_contains:
  "senior")` for non-senior routings. AutomationBench's word-boundary match treats the hyphen in the rule name
  "Non-senior api" as a boundary, so the reference failed 38/195 dev triggers on correct notes. The assertion now
  names the queue id, `grp_senior`.
- **A shortcut that was too good.** The naive heuristic first scored 0.70 at d3, against the gate's < 0.60. The d3
  mix was rebalanced toward rules a shortcut skips, without new trap kinds:
  - more tickets from customers on hold;
  - more tickets created assigned or not open;
  - look-alikes biased toward the confusable short name;
  - in-week effective dates between tiers that route differently, with tickets before the date;
  - multi-area tags that list the later area first;
  - a hold placed and lifted within the week.

  The d2 mix is unchanged. The margin is thin (0.570 on the dev d3 streams, 0.586 over all d3 seeds), so this gate
  should be re-checked whenever the generator changes.
- **Controls that could not fail.** `route-assigned` passed every dev trigger because no dev stream had a ticket
  created with a group. T-authority appeared only twice across the label streams. Both traps are now required in
  every stream. `any-number` failed for a second reason (it misread `12k records`); it is now the reference's
  records rule plus any other large number, so it breaks exactly one rule.

## Limits and not done yet

- **The complexity reading is template-aware.** The reference reads it with a records regex and three not-affected
  markers ("unaffected", "still syncs fine", "stopped using"), and the generator's description templates are finite.
  The two implementations agree on all 677 descriptions built for seeds 601–614 (a test), but agreement between
  two implementations by the same author does not prove a second reader reads the policy the same way. The
  second-reader fairness gate (§3.11 gate 6) still needs a session that did not write the family. The points most
  likely to be disputed:
  - "We stopped using X last year" (not counted);
  - API-call volumes (not records);
  - "first matching row" for tickets with two area tags.
- **No escalation truth.** The generator never makes a ticket undecidable, so the escalation clause and the oracle's
  escalation check are present but unexercised. Duplicate Customer Tiers rows would trigger the reference's
  escalation. A Tier cell other than the three tiers is also unexercised; only an empty Previous Tier is generated.
- **The naive gate passes with a thin margin**, and the d3 trap share (0.68) sits a little above the design's 0.65.
- **The runner and arms do not exist yet.** The stream runner (`stream.mjs`), the bridge commands (`abr-gen`,
  `abr-apply`, `abr-grade`) and the arms (§3.7–3.8) are not built. Here everything runs in one process. Model arms
  will reach the same `env_response` path through `bridge.py serve`, with the rows `gen.serve_input` writes.
  `N` in the daily post depends on note times, which in a served arm come from the shim clock at the trigger time,
  as here.
- **Carry-mode cascades are graded.** In carry mode, an arm that routes a held ticket early leaves nothing to
  release later; the release trigger then fails. That cascade is the arm's own consequence and is graded.
- **Seed ledger.** It has no entries for this family; no labelled stream was run.
