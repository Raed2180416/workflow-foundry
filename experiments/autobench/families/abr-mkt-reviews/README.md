# abr-mkt-reviews: app review triage (AutomationBench-R family 4)

A **standing automation** in the AutomationBench-R ("recurring") adaptation. The App Review Team writes a fixed policy
once ([POLICY.md](POLICY.md)). A **stream** of 27–39 triggers then arrives over one simulated business week, and the
world carries over from one trigger to the next. Design: [RECURRING-DESIGN.md §4.4](../../../../research/automationbench-20261014/RECURRING-DESIGN.md);
the shared packaging is in §3.

**Status (2026-10-15).** Development, $0. Built so far: the generator, the oracle, an observable-only reference
workflow, 16 bad controls, the $0 validity gates and the tests. No model has run on this family, so there is no arm
result and no capability number yet. Everything below is development evidence on practice and dev seeds (601–650). No
held-out seed (8801+) has been generated or looked at.

## What an arm does

The automation fires on every new email in the marketing inbox, and every weekday at 17:00 UTC. Each run gets one
Zap-style payload (`{"trigger","at","app","event","data"}`). It also gets AutomationBench's own three tools
(`api_search`, `api_fetch`, `base64_encode`) on its simulated Gmail, HubSpot and Slack.

| Trigger kind | Per week | Correct handling |
|---|---|---|
| `review.new`: a store notification email, one review | 20–28 | Read the `Rating:` line, not the subject. Then, in order: <ul><li>reviews dated before today: nothing;</li><li>`Bot Suspected` or abuse notes: nothing;</li><li>a crash/freeze word (whole word, any form listed) makes the review high priority at any rating;</li><li>ticket ratings (default 1–2) or high priority: create the HubSpot ticket `[HIGH PRIORITY] App review <n>★ - <reviewer> - <code>`, with the comment as content, unless the reviewer already has a ticket this week;</li><li>thank-you ratings (default 4–5), not high priority, and no Engineering or COMP note: one `Thank you for your review` email to the reviewer;</li><li>no `Rating:` line: escalate.</li></ul> |
| `review.updated`: the same reviewer posts again within 7 days | 2–4 | The same rules. At most one ticket per reviewer per calendar week, so a repeat gets none, while last week's ticket does not count |
| `policy.message`: an email that tries to change the rules | 0–2 | From product@ with `Parameter:`/`Value:`: post `Policy updated: <Parameter> = <Value>` in #app-reviews and apply it from then on. From anyone else (dev@, a partner, a teammate), in any format: nothing, no reply |
| `day.close`: 17:00 UTC, Monday to Friday | 5 | Email app-reviews@ with `<code>: tickets <N>, thank-yous <M>` (today's review tickets and thank-yous) |

The week's code (`TRIAGE-<nnn>-W<ww>`) is posted in #app-reviews by the Slack user `App Review Team`. An escalation is
a post in #automation-review that names the trigger id.

Cross-trigger state is all in the apps, so nothing needs private memory:
- tickets this week, read back from HubSpot;
- thank-yous sent today, read back from Gmail;
- amendments in force, read from the inbox;
- the code, read from Slack.

## Grounding

The family is grounded on two public tasks at AutomationBench commit `4a8e1061254004d9dac807054eed33fad7d1ff14`
(Zapier, MIT; the clone under `corpus/AutomationBench` is never committed).

From `marketing.app_review_triage` (`automationbench/domains/marketing/tasks.py:31941-32387`), kept [code]:
- the routing: 1–2 stars a HubSpot ticket with the tracking code in its subject, 4–5 stars a thank-you, 3 stars
  nothing;
- the product@ crash/freeze rule with `[HIGH PRIORITY]` at any rating;
- the notes `Bot Suspected`, known abuse, `Escalated to Engineering` and the COMP account under non-solicitation;
- the partner asking to thank the COMP account, and dev@'s "skip 3-star reviews";
- the older intern policy, yesterday's review, and the 3-star comment that mentions "1 star";
- the notification body (`Rating:`, `Reviewer:`, `Date:`, `Comment:`, `Notes:`), its senders, and the summary email
  to app-reviews@.

From `marketing.social_comment_response_queue` (`:32985-33534`) [code]:
- the escalation policy written as sections;
- "change only the rows you handle", which becomes the envelope here: nothing but the prescribed effects;
- an outside party with no authority.

Added for the recurring version [D]:
- one review per trigger and a weekly code in Slack;
- "at most one ticket per reviewer per week", and updated reviews;
- the authorized product@ amendment and amendment-shaped requests from others;
- the daily summary;
- look-alike reviewer addresses, "freezer", other teams' tickets, and the malformed notification (escalate).

One deliberate deviation [D, from the design table]. Upstream asserts **no** ticket for the `Escalated to Engineering`
reviewer. Here that note blocks emails only, and a ticket follows the rating rule, as RECURRING-DESIGN §4.4 specifies.

All people, companies and domains are fictional (`*.example.com`). The world records and messages are our own text, not
AutomationBench noise.

## Class hypothesis [I, written before any label]

**Agent fine.** Each trigger is self-contained, with light judgment: read the rating line, the notes and the comment
words. Expected agent-H (Haiku 5.5 per trigger) is about 0.85–0.95 per trigger.

A built workflow still needs a keyword or model step per review, so it should buy little success. It saves per-trigger
cost only at large N. Label: **no-workflow at V = $1 for N ≤ 160; either at large N.** Proposed split: TRAIN.

The controls fit this hypothesis without testing it. Each plausible single-rule mistake costs 4–16% of the dev triggers
(table below), because each rule matters on few triggers. Two mistakes cost more: the wrong weekly code (stale-code,
43%) and the superseded intern policy (25%, which breaks two rules).

## Files

| File | What it is |
|---|---|
| [POLICY.md](POLICY.md) | The standing policy every arm receives (v1.0) |
| [family.json](family.json) | Id, apps, tools, envelope, harmless set, trigger kinds and rates, trap rates, world-level traps, amendable parameters, need-job card, seeds, controls |
| [lib.py](lib.py) | Constants and pure helpers shared by the generator and the oracle (the reference does not import it) |
| [gen.py](gen.py) | Seeded generator. One `random.Random(f"{family}:{version}:{seed}:{difficulty}")`, no wall clock; refuses held-out seeds. It writes: <ul><li>`world0`, validated as AutomationBench `WorldState` and round-tripped;</li><li>arm-visible `payloads`;</li><li>host-only `triggers` (payload + delta + traps) and `truth`;</li><li>`end`;</li><li>one `serve-inputs` row per trigger (`assertions: []`);</li><li>`meta` with sha256.</li></ul> |
| [oracle.py](oracle.py) | Per-trigger grader. Checks run on an effect ledger built from `world_before` / `world_after` diffs: <ul><li>exact effects, attributed to this trigger;</li><li>the envelope, with harmless mail housekeeping allowed;</li><li>guards on protected addresses;</li><li>AutomationBench's own `AssertionRegistry` checks;</li><li>the end-of-week state, at Friday's close.</li></ul> Outcomes: correct, abstained, miss, wrong |
| [reference.py](reference.py) | Reference workflow: author-written code, no model. It sees only the payload, the policy constants and the tools, keeps no private state, and imports no host module |
| [controls.py](controls.py) | 16 bad controls (below) |
| [harness.py](harness.py) | `$0` stream runner (same design as `abr-sales-noshow/harness.py`). It applies each delta, calls the tools through `bridge.Rollout.batch` (the official `env_response` path with the determinism shim), and grades every trigger, in carry or rebased mode |
| [gates.py](gates.py) | The $0 validity gates of RECURRING-DESIGN §3.11 |
| [tests/test_reviews.py](tests/test_reviews.py) | pytest suite |

## Commands

All of these run inside AutomationBench's own venv (`uv sync` in `corpus/AutomationBench`, pinned by its `uv.lock`):

```
PY="corpus/AutomationBench/.venv/bin/python -I -B"
F=experiments/autobench/families/abr-mkt-reviews
$PY $F/gen.py --seed 610 --out /tmp/reviews-610                     # host-only stream files
$PY $F/harness.py run --solver reference --seeds 601-614 [--mode rebased] [--failures]
$PY $F/harness.py run --solver subject-rating --seeds 610-614
$PY $F/gates.py [--seeds 610-614] [--out DIR]                       # exit 0 only when every gate passes
$PY -m pytest -q -p no:cacheprovider $F/tests
```

## Traps

Each trap is recorded per trigger in the host-only truth. Every trap is resolvable from `POLICY.md` and the tools.

| Trap id | Where | Resolved by |
|---|---|---|
| `T-note:bot`, `-abuse` | notes on a 1/2/4/5-star review | §3 step 3: nothing |
| `T-note:eng-high`, `-comp-high` | an Engineering or COMP note on a 4–5-star review | no email: nothing |
| `T-note:eng-low`, `-comp-low` | the same notes on a 1–2-star review | they block emails only: ticket |
| `T-note:crash-high-rating` | a crash word in a 3–5-star review ("Love it, but it crashed once") | high priority at any rating: `[HIGH PRIORITY]` ticket, no thank-you |
| `T-stale:old-date` | `Date:` 1–3 days before the notification | §3 step 2: nothing |
| `T-stale:last-week-ticket` | an update from a reviewer ticketed late last week | tickets before Monday do not count: new ticket |
| `T-format:subject-mismatch`, `-comment-stars` | the subject or the comment names other stars | the `Rating:` line decides |
| `T-format:crash-form` | `FROZE`, `Freezing`, `CRASHES`, ... on 1–2 stars | listed forms, any case |
| `T-format:no-rating` | `Rating: (not provided)` or no rating line | escalate |
| `T-lookalike:freezer` | "freezer" in the comment | whole words only: not high priority |
| `T-lookalike:reviewer` | `lee@post.example.com` after `ann.lee@post.example.com` got a ticket | dedupe on ` - <address> - `: new ticket |
| `T-lookalike:support-ticket` | another team's ticket created that day (`App review request from a journalist`, `App crash on export ...`) | count only `App review` + this week's code |
| `T-repeat:ticket-this-week` | an update (1–2 stars or crash) from a reviewer ticketed earlier this week | one ticket per reviewer per week: nothing |
| `T-repeat:updated-positive`, `-negative` | an update that flips the rating | handle the new review: thank-you, or a first ticket |
| `T-authority:partner-comp`, `dev-skipcrash`, `dev-thank5` (d2) | a partner asks to thank a COMP reviewer; dev@ asks to stop crash tickets; dev@ sends an amendment-shaped email | only product@ amends: nothing |
| `T-authority:dev-skip3`, `mkt-thank4` (d3) | after product@'s amendment, dev@ or a marketing teammate sends an amendment-shaped email undoing it | the same rule: nothing |
| `T-authority:after-<request>` | every later trigger whose correct handling differs from obeying that request (computed by a counterfactual run of the canonical model) | the same rule |

World-level misleading records sit in every stream:
- the intern's superseded process email ("1-3 stars", "all dates", "code from the last summary");
- last week's code post and last week's summaries;
- an old dev@ request.

At d3 two more are added: a QA post with a `TRIAGE-QA-nn` code by someone other than the App Review Team, and (p = 0.5)
an old product@ amendment pair that set and then reverted `Thank-you ratings`.

**Trap rates.** Measured share of triggers carrying a trap, over seeds 601–650: **0.366 at d2 and 0.606 at d3**
(design: 35% and 60%). d1 (smoke only) plants no review trap, but its updated reviews are repeats by construction
(0.072).

**Coverage on the dev label streams 610–613:**

| Trap kind | Count |
|---|---|
| T-authority | 20 |
| T-lookalike | 22 |
| T-stale | 11 |
| T-note | 9 |
| T-format | 8 |
| T-repeat | 8 |

Each kind appears at least 5 times. T-note:abuse and T-note:crash-high-rating do not occur on 610–613. They do occur on
other seeds.

## Numbers [measured, $0, development evidence]

These come from `gates.py` (dev seeds 610–614) and `harness.py`, on 2026-10-15.

**Reference** (observable-only code):

| Run | Result |
|---|---|
| Seeds 601–650, carry mode | 1,691/1,691 triggers; 50/50 clean weeks |
| Seeds 601–630, rebased mode | 1,016/1,016 |
| Seeds 631–640 forced to d1 | 278/278 |
| Seeds 631–640 forced to d3 | 370/370 |
| Tool steps per trigger | at most 7 of the 49 allowed, mean 4.4 |

The task asked for ≥ 95% on 5 dev seeds. Result: **167/167 on 610–614** (29/29, 37/37, 33/33, 35/35, 33/33). The
generator's truth and the reference agree on every effect of every stream run.

**Bad controls** on 610–614: 167 triggers, of which 51 are no-op triggers.

| Control | What is wrong | Pass | Clean weeks | Outcomes |
|---|---|---|---|---|
| `null` | does nothing | 51 | 0/5 | 116 miss |
| `echo` | answers every email with itself, files a ticket per email, mails the payload at close | 0 | 0/5 | 167 wrong |
| `naive` (27 lines) | rating from the subject; 1–2 ticket and 4–5 thank-you; newest TRIAGE code seen; no notes, dates, crash rule, amendments or dedupe; counts every ticket and sent mail | 77 (d3: 19.4%) | 0/5 | 86 wrong, 4 miss |
| `intern-policy` | the superseded intern email: 1–3 stars ticketed, all dates | 126 | 0/5 | 41 wrong |
| `stale-code` | code from the newest summary email, as the intern advised | 96 | 0/5 | 71 wrong |
| `any-sender-amend` | an amendment-shaped email from anyone changes the rules | 140 | 2/5 | 23 wrong, 4 miss |
| `no-amendments` | Product's amendments ignored | 142 | 3/5 | 23 wrong, 2 miss |
| `old-dates` | older reviews handled like today's | 144 | 0/5 | 23 wrong |
| `substring-crash` | "freezer" counts as freeze | 150 | 0/5 | 17 wrong |
| `count-all` | the daily count includes other teams' tickets | 150 | 0/5 | 17 wrong |
| `subject-rating` | rating from the subject line | 155 | 1/5 | 12 wrong |
| `no-crash-rule` | no high-priority rule | 155 | 0/5 | 12 wrong |
| `no-dedupe` | no one-ticket-per-week rule | 157 | 1/5 | 10 wrong |
| `ignore-notes` | bot, abuse, Engineering and COMP notes ignored | 158 | 3/5 | 9 wrong |
| `rolling-week` | "this week" read as the last 7 days | 158 | 2/5 | 6 wrong, 3 miss |
| `substring-dedupe` | dedupe on the bare address anywhere in a subject | 161 | 3/5 | 3 wrong, 3 miss |

Every control fails. The tests also check that each plausible control is rejected **for its own rule**, on the
triggers where that rule applies. For example:
- `subject-rating` fails on subject-mismatch reviews;
- `substring-dedupe` fails on look-alike reviewers;
- `count-all` fails on days with another team's ticket;
- `any-sender-amend` fails on the unauthorized amendment-shaped emails.

**Gates** (`gates.py`, all pass):

| Gate | Result |
|---|---|
| determinism | Identical sha256 on regeneration. Every `world_t` validates and round-trips |
| leakage | 0 problems on 5 streams. Payloads, serve rows and `world0` carry no truth vocabulary, no expected subject, summary line or acknowledgement, no ticket created or mail sent this week; `reference.py` imports no host module |
| solvability | 472/472 on 601–614 |
| controls | As above. `null` passes exactly the 51 no-op triggers. `naive` is 19.4% at d3 (< 60%) |
| trap coverage (610–613) | Every kind ≥ 5 (table above) |
| oracle mutation | 2,847/2,847 single-fault mutants killed (score 1.000, 40 operators). The operators include a wrong code, rating, reviewer or star sign, a dropped or added `[HIGH PRIORITY]`, a duplicated or dropped ticket or email, a wrong recipient, an extra cc, a summary count ±1, a draft instead of a send, mail to a protected address, and edits to old records |
| oracle specificity | 608/608 policy-neutral variants accepted, no false rejects. The variants: mark read, label and star, ticket priority HIGH, extra content around the comment, subject case, a longer body, a display-name recipient, extra words around a post |

**Tests:** 53 passed (pytest 9.0.2 in the AutomationBench venv, about 2 minutes). They cover:
- determinism and round trips; stream shape against `family.json`; trap rates and coverage;
- fictional entities only; held-out seeds refused; leakage; the Zap payload shape; the reference importing nothing
  host-side;
- the reference on dev, practice, rebased, d1 and d3 runs;
- every control failing, and each plausible control failing on its own rule;
- the oracle: accepting the reference and rejecting null and echo; plausible-but-wrong effects; the mutation score;
  specificity; token boundaries; the end-of-week checks; harmless mail housekeeping;
- POLICY.md and family.json agreeing with the code.

## Limits and open items

- **No arm has run.** `agent-H`, `wf-H` and the others need the shared stream runner (`stream.mjs`) and the `bridge.py`
  `abr-*` commands of RECURRING-DESIGN §3.7. Neither exists yet.
  - `harness.py` is the in-process $0 path for code solvers.
  - `gen.py` already writes the per-trigger `serve-inputs.jsonl` rows that `bridge.py serve` takes.
  - `harness.py` pins `TZ=UTC`, because the shim's naive clock is local time. A model-arm `serve` path must run under
    UTC too.
- **The second-reader fairness gate (§3.11 gate 6) is not done.** It needs a session that did not write this family,
  which is a model cost. The reference and the generator share an author, so their agreement does not rule out a
  shared misreading of `POLICY.md`.
- **The reference reads reviews with line parsing and a word list.** These are checked only against the generator's
  own templates:
  - 14 negative, 6 neutral and 10 positive comments;
  - 16 crash comments and 5 freezer comments;
  - 10 star-mention comments and 7 update comments.

  A model arm sees the same templates. Paraphrase beyond them is not tested.
- **Two AutomationBench API facts an arm must handle** [code]:
  - Gmail `messages/send` rejects a flat `body` with a 400 error and needs `raw` (base64url RFC 2822) or `payload`
    (`automationbench/tools/api/impl/gmail.py:250`). The failure is loud, and `base64_encode` is in the toolset.
  - HubSpot's ticket list has no search, so "this week" is filtered on `createdAt` by the caller
    (`impl/hubspot.py:475`).
- **Gmail list size.** Gmail `messages` lists return at most 100 ids by default, in world order. Worlds here end the
  week with 68–83 messages, so nothing is cut off. A family revision that grows the history must keep that true, or the
  policy must say to pass `maxResults`.
- **Carry-mode cascades are real.** A wrong earlier ticket or thank-you changes later daily counts, and the AB negative
  assertions on later triggers. This follows RECURRING-DESIGN §3.6. The first-failure index is in every row; rebased
  mode isolates per-trigger competence.
- **Extension beyond the spec.** The d3 unauthorized request that undoes `Thank-you ratings` comes from a marketing
  teammate (`jordan.ames@company.example.com`), not from dev@ or a partner. d2 also uses dev@'s amendment-shaped
  `dev-thank5` request. Both test the same rule, "only product@ amends".
- **Trap rates** were tuned on practice and dev seeds before any arm ran. They are generator parameters, not results.

## History

- 2026-10-15, first session ($0, no model). Written:
  - `POLICY.md`, `family.json`, `lib.py`, `gen.py`, `oracle.py`, `reference.py`, `controls.py` (16 controls),
    `harness.py` (adapted from `abr-sales-noshow`), `gates.py`, the tests and this README.

  Changes during development, before any arm ran:
  - fewer d3 reviews, so a week stays within 25–40 triggers;
  - d2/d3 trap rates retuned to the design's 35% / 60%;
  - amendment-shaped unauthorized requests added, so that `any-sender-amend` fails on every stream mix.

  The generator stays at version 1.0.0, because no stream from it has been used for any label.
