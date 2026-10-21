# abr-mkt-reviews: app review triage (AutomationBench-R family 4)

A **standing automation** in the AutomationBench-R ("recurring") adaptation. The App Review Team writes a fixed policy
once ([POLICY.md](POLICY.md)). A **stream** of 28–39 triggers then arrives over one simulated business week, and the
world carries over from one trigger to the next. Design: [RECURRING-DESIGN.md §4.4](../../../../research/automationbench-20261014/RECURRING-DESIGN.md);
the shared packaging is in §3.

**Status (2026-10-21, after the review fixes).** Development, $0. Built on 2026-10-15: the generator, the oracle, an observable-only reference
workflow, the bad controls, the $0 validity gates and the tests. Re-verified and hardened on 2026-10-21 (see
[Changes](#changes)): every d3 week now tests each note clause, the two d3 dev weeks amend different parameters, the
oracle rejects hedged summaries and deleted posts, and there are 33 bad controls. Review fixes later that day: POLICY.md
1.1 states what the oracle enforces (the summary gives one answer; the code and the ticket subject keep their letter
case; the ticket body goes in the HubSpot property `content`); the oracle checks the summary on meaning, not on one
wording, and compares the code and subject case exactly; every d2/d3 week now has a repeat update and every d3 week a
malformed notification; 22 whole-stream oracle probes are gated and tested. No model has run on this family, so there
is no arm result and no capability number yet. Everything below is development evidence on practice and dev seeds
(601–650). No held-out seed (8801+) has been generated or looked at.

## What an arm does

The automation fires on every new email in the marketing inbox, and every weekday at 17:00 UTC. Each run gets one
Zap-style payload (`{"trigger","at","app","event","data"}`). It also gets AutomationBench's own three tools
(`api_search`, `api_fetch`, `base64_encode`) on its simulated Gmail, HubSpot and Slack.

| Trigger kind | Per week | Correct handling |
|---|---|---|
| `review.new`: a store notification email, one review | 19–28 | Read the `Rating:` line, not the subject. Then, in order: <ul><li>reviews dated before today: nothing;</li><li>`Bot Suspected` or abuse notes: nothing;</li><li>a crash/freeze word (whole word, any form listed) makes the review high priority at any rating;</li><li>ticket ratings (default 1–2) or high priority: create the HubSpot ticket `[HIGH PRIORITY] App review <n>★ - <reviewer> - <code>`, with the comment as content, unless the reviewer already has a ticket this week;</li><li>thank-you ratings (default 4–5), not high priority, and no Engineering or COMP note: one `Thank you for your review` email to the reviewer;</li><li>no `Rating:` line: escalate.</li></ul> |
| `review.updated`: the same reviewer posts again within 7 days | 2–5 | The same rules. At most one ticket per reviewer per calendar week, so a repeat gets none, while last week's ticket does not count. Every d2 and d3 week has such a repeat |
| `policy.message`: an email that tries to change the rules | 1–2 (d2: 1 unauthorized; d3: 1 authorized + 1 unauthorized) | From product@ with `Parameter:`/`Value:`: post `Policy updated: <Parameter> = <Value>` in #app-reviews and apply it from then on. From anyone else (dev@, a partner, a teammate), in any format: nothing, no reply |
| `day.close`: 17:00 UTC, Monday to Friday | 5 | Email app-reviews@ with `<code>: tickets <N>, thank-yous <M>` (today's review tickets and thank-yous) on a line of its own, and no other ticket or thank-you figures, hedges or corrections |

The week's code (`TRIAGE-<nnn>-W<ww>`) is posted in #app-reviews by the Slack user `App Review Team`, and is copied in
its exact letter case. An escalation is a post in #automation-review that names the trigger id.

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

The controls fit this hypothesis without testing it. Each plausible single-rule mistake costs 2–24 of the 167 dev
triggers (1–14%, table below), because each rule matters on few triggers. Three mistakes cost more, because they touch
every ticket or summary: the code from the newest summary email (stale-code, 46%), the newest TRIAGE code by anyone
(any-poster-code, 22%, d3 weeks only) and the superseded intern policy (20%, which breaks two rules).

## Files

| File | What it is |
|---|---|
| [POLICY.md](POLICY.md) | The standing policy every arm receives (v1.1, review fixes 2026-10-21) |
| [family.json](family.json) | Id, apps, tools, envelope, harmless set, trigger kinds and rates, trap rates, world-level traps, amendable parameters, need-job card, seeds, controls |
| [lib.py](lib.py) | Constants and pure helpers shared by the generator and the oracle (the reference does not import it) |
| [gen.py](gen.py) | Seeded generator. One `random.Random(f"{family}:{version}:{seed}:{difficulty}")` for the stream and one (`...:floor`) for the d3 clause floor, no wall clock; refuses held-out seeds. It writes: <ul><li>`world0`, validated as AutomationBench `WorldState` and round-tripped;</li><li>arm-visible `payloads`;</li><li>host-only `triggers` (payload + delta + traps) and `truth`;</li><li>`end`;</li><li>one `serve-inputs` row per trigger (`assertions: []`);</li><li>`meta` with sha256, the floor conversions and the amended parameter.</li></ul> |
| [oracle.py](oracle.py) | Per-trigger grader. Checks run on an effect ledger built from `world_before` / `world_after` diffs: <ul><li>exact effects, attributed to this trigger (ticket subjects and the code in their exact case; a summary that states one answer; no deleted post);</li><li>the envelope, with harmless mail housekeeping allowed;</li><li>guards on protected addresses;</li><li>AutomationBench's own `AssertionRegistry` checks;</li><li>the end-of-week state, at Friday's close.</li></ul> Outcomes: correct, abstained, miss, wrong |
| [reference.py](reference.py) | Reference workflow: author-written code, no model. It sees only the payload, the policy constants and the tools, keeps no private state, and imports no host module |
| [controls.py](controls.py) | 33 bad controls (below) |
| [probes.py](probes.py) | 22 whole-stream oracle probes (review fixes 2026-10-21): 16 wrong outputs the oracle must reject and 6 correct variants it must accept (below) |
| [harness.py](harness.py) | `$0` stream runner (same design as `abr-sales-noshow/harness.py`). It applies each delta, calls the tools through `bridge.Rollout.batch` (the official `env_response` path with the determinism shim), and grades every trigger, in carry or rebased mode |
| [gates.py](gates.py) | The $0 validity gates of RECURRING-DESIGN §3.11, plus the `clauses` gate (d3 floor, both amendment parameters, week floor) and the `probes` gate |
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
| `T-note:bot`, `-abuse` | notes on a 1/2/4/5-star review (d3 floor: 1/2/5) | §3 step 3: nothing |
| `T-note:eng-high`, `-comp-high` | an Engineering or COMP note on a 4–5-star review (d3 floor: 5) | no email: nothing |
| `T-note:eng-low`, `-comp-low` | the same notes on a 1–2-star review | they block emails only: ticket |
| `T-note:crash-high-rating` | a crash word in a 3–5-star review ("Love it, but it crashed once"; d3 floor: 5) | high priority at any rating: `[HIGH PRIORITY]` ticket, no thank-you |
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

**d3 clause floor** (2026-10-21). Every d3 week has at least one review that each of these clauses decides:
`T-note:abuse` and `T-note:bot` at 1, 2 or 5 stars, and `T-note:crash-high-rating`, `T-note:eng-high` and
`T-note:comp-high` at 5 stars (so the clause changes the outcome under either parameter value). Missing ones are made
by converting a donor review (a planted old-date, freezer, comment-stars, subject-mismatch, crash-form, eng-low or
comp-low trap, while the week keeps another of the same id) or, failing that, a plain review. The floor draws from its
own seeded stream (`...:floor`), so d1 and d2 streams are byte-identical to the 2026-10-15 generator, and in d3 streams
every other draw is unchanged. `meta.json` lists the conversions under `floor`. On seeds 601–650 the floor made 97
conversions over 24 d3 weeks (3–5 a week), 68 from donors and 29 from plain reviews.

**d3 amendment parameter.** Product's authorized amendment changes `PARAMS[(seed // 2) % 2]`, so consecutive d3 weeks of
a block amend different parameters: 611 `Thank-you ratings` and 613 `Ticket ratings` (also 8802 and 8804). The coin it
replaces had put both d3 dev weeks on `Thank-you ratings`, so `Ticket ratings = 1-3` and dev@'s "skip 3-star reviews
again" never appeared in a dev label stream. The coin is still drawn, so the other draws are unchanged.

**Week floor** (review fixes 2026-10-21). The weekly one-ticket-per-reviewer rule is the main rule that reads back
the arm's own earlier writes, and it was decided by at most one trigger a week: 601, 603, 607, 609 and 610 had no repeat
update, so `no-dedupe` passed them. Escalation was a draw (p = 0.4 at d2, 0.7 at d3) and missed both d3 dev weeks 611
and 613. Now every d2 and d3 week has an update (1–2 stars, or a crash) from a reviewer whose first review that week
certainly got a ticket (`T-repeat:ticket-this-week`; correct handling: no new ticket), and every d3 week has a malformed
notification (`T-format:no-rating`; escalate). Missing ones are made by converting a later review (a donor as above,
else a plain review), never by adding a trigger, from the same `...:floor` stream after the clause floor. So `world0`,
every trigger the floor does not convert, the clause floor's conversions and every d1 stream are byte-identical to the
generator before the review fixes (checked against it on 601–650 and forced d1/d3 631–640, and by a test that turns the week floor
off). On 601–650 it made 17 repeat conversions over 26 d2 weeks (4 from donors), 3 over 24 d3 weeks, and 8 malformed
conversions over 24 d3 weeks (2 from donors). A converted review becomes an update, so a week now has 19–28 new reviews
and 2–5 updates (family.json).

**Trap rates.** Measured share of triggers carrying a trap, over seeds 601–650: **0.381 at d2 and 0.647 at d3**
(design: 35% and 60%; d3 was 0.606 before the clause floor and 0.639 before the week floor, d2 0.366). d1 (smoke only)
plants no review trap, but its updated reviews are repeats by construction (0.072).

**Coverage on the dev label streams 610–613:**

| Trap kind | Count |
|---|---|
| T-lookalike | 20 |
| T-note | 18 |
| T-authority | 17 |
| T-format | 10 |
| T-repeat | 9 |
| T-stale | 8 |

Each kind appears at least 5 times. Every `T-note` id occurs (abuse 2, bot 3, comp-high 4, comp-low 1,
crash-high-rating 2, eng-high 3, eng-low 3). `T-repeat:ticket-this-week` is on all four streams, `T-format:no-rating`
on all four (two of them by the floor). Not on 610–613: dev@'s "stop crash tickets" request
(`T-authority:dev-skipcrash`, a d2 draw among three requests); it occurs on other seeds (607, 614, 622, 626, 631, 643 of
601–650). A seed rotation like the d3 parameter's would change which d2 request each week gets and so every later draw
of those streams; it was left for a generator revision.

## Numbers [measured, $0, development evidence]

These come from `gates.py` (dev seeds 610–614) and `harness.py`, re-run on 2026-10-21 after the review fixes.

**Reference** (observable-only code):

| Run | Result |
|---|---|
| Seeds 601–650, carry mode | 1,693/1,693 triggers; 50/50 clean weeks |
| Seeds 601–630, rebased mode | 1,017/1,017 |
| Seeds 631–640 forced to d1 | 278/278 |
| Seeds 631–640 forced to d3 | 372/372 |
| Tool steps per trigger (601–650) | at most 7 of the 49 allowed, mean 4.35 |

The task asked for ≥ 95% on 5 dev seeds. Result: **167/167 on 610–614** (29/29, 37/37, 33/33, 35/35, 33/33). The
generator's truth and the reference agree on every effect of every stream run.

**Bad controls** on 610–614: 167 triggers, of which 45 are no-op triggers. (*) marks the five that passed every one of
the five dev weeks before the 2026-10-21 changes. The week floor changed seven rows in the review fixes: `no-dedupe` (157,
1/5 clean before), `no-escalate` (165, 3/5), `oldest-amendment` (161), `subject-rating` (155), `substring-crash` (152),
`naive` (76) and the no-op share (44).

| Control | What is wrong | Pass | Clean weeks | Other outcomes |
|---|---|---|---|---|
| `echo` | answers every email with itself, files a ticket per email, mails the payload at close | 0 | 0/5 | 167 wrong |
| `null` | does nothing | 45 | 0/5 | 122 miss |
| `naive` | 27 lines: rating from the subject; 1–2 ticket and 4–5 thank-you; newest TRIAGE code seen; no notes, dates, crash rule, amendments or dedupe; counts every ticket and sent mail | 73 (d3: 16.7%) | 0/5 | 84 wrong, 10 miss |
| `stale-code` | code from the newest summary email, as the intern advised | 91 | 0/5 | 76 wrong |
| `any-poster-code` | the newest TRIAGE code in #app-reviews, whoever posted it | 131 | 3/5 | 36 wrong |
| `intern-policy` | the superseded intern email: 1–3 stars ticketed, all dates | 134 | 0/5 | 33 wrong |
| `any-sender-amend` | an amendment-shaped email from anyone changes the rules | 143 | 2/5 | 17 wrong, 7 miss |
| `ignore-notes` | bot, abuse, Engineering and COMP notes ignored | 145 | 2/5 | 22 wrong |
| `week-count` | the daily summary counts the week, not the day | 147 | 0/5 | 20 wrong |
| `updated-ignored` | updated reviews skipped as already handled | 147 | 0/5 | 11 wrong, 9 miss |
| `no-amendments` | Product's amendments ignored | 148 | 3/5 | 13 wrong, 6 miss |
| `old-dates` | older reviews handled like today's | 149 | 0/5 | 18 wrong |
| `count-all` | the daily count includes other teams' tickets | 150 | 0/5 | 17 wrong |
| `no-crash-rule` | no high-priority rule | 151 | 0/5 | 16 wrong |
| `base-forms` | only `crash` and `freeze`, not the other listed forms | 151 | 0/5 | 16 wrong |
| `subject-rating` | rating from the subject line | 153 | 1/5 | 14 wrong |
| `substring-crash` | "freezer" counts as freeze | 154 | 0/5 | 13 wrong |
| `no-dedupe` | no one-ticket-per-week rule | 154 | 0/5 | 13 wrong |
| `comp-email` | the COMP note does not block emails | 157 | 2/5 | 10 wrong |
| `eng-no-ticket` | the Engineering note also blocks the ticket (the upstream task's reading) | 157 | 1/5 | 6 wrong, 4 miss |
| `thanks-amend-ignored` | `Thank-you ratings` amendments acknowledged, not applied | 157 | 4/5 | 10 wrong |
| `reply-requester` | the policy applied, but unauthorized requesters get a polite reply | 157 | 0/5 | 10 wrong |
| `rolling-week` | "this week" read as the last 7 days | 158 | 2/5 | 6 wrong, 3 miss |
| `no-bot` | the `Bot Suspected` note ignored | 158 | 2/5 | 9 wrong |
| `ticket-amend-ignored` (*) | `Ticket ratings` amendments acknowledged, not applied | 160 | 4/5 | 4 miss, 3 wrong |
| `substring-dedupe` | dedupe on the bare address anywhere in a subject | 161 | 3/5 | 3 wrong, 3 miss |
| `crash-rating-only` (*) | crash words only prefix tickets the rating earns | 161 | 3/5 | 4 wrong, 2 miss |
| `crash-thanks` (*) | high priority does not block the thank-you | 161 | 3/5 | 6 wrong |
| `eng-email` (*) | the Engineering note does not block emails | 161 | 3/5 | 6 wrong |
| `no-abuse` (*) | the abuse note ignored | 162 | 3/5 | 5 wrong |
| `oldest-amendment` | the oldest Product amendment per parameter wins | 163 | 4/5 | 2 wrong, 2 miss |
| `no-escalate` | a notification without a usable rating is skipped, not escalated | 163 | 1/5 | 4 miss |
| `comp-no-ticket` | the COMP note also blocks the ticket | 164 | 4/5 | 2 wrong, 1 miss |

Every control fails. The narrow ones fail only on weeks where their clause applies, so some of their weeks are clean.
The tests check that each plausible control is rejected **for its own rule**, on the triggers where that rule applies.
For example:
- `subject-rating` fails on subject-mismatch reviews;
- `substring-dedupe` fails on look-alike reviewers;
- `count-all` fails on days with another team's ticket;
- `any-sender-amend` fails on the unauthorized amendment-shaped emails;
- each of `no-abuse`, `no-bot`, `crash-rating-only`, `crash-thanks`, `eng-email` and `comp-email` fails on **every** d3
  week, on the review that carries its clause: 0/24 clean d3 weeks each on seeds 601–650 (on the 2026-10-15 generator:
  18, 17, 22, 23, 18 and 15 of the 24 d3 weeks were clean);
- `ticket-amend-ignored` and `thanks-amend-ignored` each fail on exactly the 12 of 24 d3 weeks that amend their
  parameter (before: 13 and 11 clean, with both d3 dev weeks clean for `ticket-amend-ignored`);
- `no-dedupe` fails on every week, d2 and d3, on the repeat update (0/50 clean on 601–650; before the week floor 1 of
  the 5 dev weeks was clean), and `no-escalate` on every d3 week, on the malformed notification (0/24 clean d3 weeks;
  before, both d3 dev weeks were clean).

**Oracle probes** (`probes.py`, review fixes 2026-10-21). The controls break a rule in the handling; the probes keep the reference's
handling and vary the *form* of the effects, run end to end through the tool path and the real grader on 610–614:

| Probe | What it does | Pass (of 167) | Clean weeks |
|---|---|---|---|
| `w-hedge-summary` | appends `Recount pending: possibly tickets N+1 and thank-yous M+1 ...` (review) | 142 | 0/5 |
| `w-hedge-inline` | `<line> (or one more ticket if the late crash review counts)` (review) | 142 | 0/5 |
| `w-hedge-numbers` | a recount line with other figures but no ticket or thank-you word | 142 | 0/5 |
| `w-hedge-caveat` | `These counts may be off by one ...` | 142 | 0/5 |
| `w-week-to-date` | `Week to date: tickets N, thank-yous M` (review; POLICY.md §4 now rules it out) | 142 | 0/5 |
| `w-week-in-words` | the same counts again in a sentence | 142 | 0/5 |
| `w-line-prefixed` | `Today's counts: <line>` | 142 | 0/5 |
| `w-summary-yesterday` | summary subject with yesterday's date (review) | 142 | 0/5 |
| `w-lowercase-code` | the code lower-cased everywhere (review) | 91 | 0/5 |
| `w-lowercase-subject` | the whole ticket subject lower-cased (review) | 111 | 0/5 |
| `w-lowercase-prefix` | `App Review`, `[High Priority]` | 111 | 0/5 |
| `w-paraphrase-content` | the ticket content paraphrases the comment (review) | 116 | 0/5 |
| `w-description-property` | the comment in a `description` property, not `content` (review) | 116 | 0/5 |
| `w-escalate-and-act` | unauthorized requests escalated and answered (review) | 157 | 0/5 |
| `w-ack-unauthorized` | amendment-shaped emails from anyone acknowledged (review) | 164 | 2/5 |
| `w-ack-wrong-channel` | the acknowledgement in #marketing (review) | 165 | 3/5 |
| `c-styled` | display names, an HTML thank-you, HIGH priority, wrapped content, a chatty markdown summary, other escalation wording (review) | 167 | 5/5 |
| `c-housekeeping` | archives and marks read the trigger email; acknowledgement with a trailing remark (review) | 167 | 5/5 |
| `c-thread-reply` | the thank-you as a reply in the notification's thread (review) | 167 | 5/5 |
| `c-html-summary` | the summary as HTML, the line in its own paragraph | 167 | 5/5 |
| `c-summary-signoff` | greeting, heading with the date and time, other figures, the parameter names with values, `Thank you,` | 167 | 5/5 |
| `c-address-case` | the reviewer address upper-cased in the ticket subject | 167 | 5/5 |

The two acknowledgement probes have clean d2 weeks because d2 weeks have no amendment and, on 610, no amendment-shaped
request. On the oracle before the review fixes, `w-hedge-summary`, `w-hedge-inline`, `w-hedge-numbers`, `w-hedge-caveat`,
`w-week-in-words`, `w-line-prefixed`, `w-lowercase-code`, `w-lowercase-subject` and `w-lowercase-prefix` passed every
trigger of 610, 611 and 613 (101/101), and `w-week-to-date` and `w-description-property` were rejected by checks the
policy did not state.

**Gates** (`gates.py`, all pass):

| Gate | Result |
|---|---|
| determinism | Identical sha256 on regeneration. Every `world_t` validates and round-trips |
| leakage | 0 problems on 5 streams. Payloads, serve rows and `world0` carry no truth vocabulary, no expected subject, summary line or acknowledgement, no ticket created or mail sent this week; `reference.py` imports no host module |
| solvability | 473/473 on 601–614 |
| controls | As above. `null` passes exactly the 45 no-op triggers. `naive` is 16.7% at d3 (< 60%). The six floor controls have no clean d3 week; `no-dedupe` fails on its repeat update in every week and `no-escalate` on its malformed notification in every d3 week |
| traps (610–613) | Every kind ≥ 5 (table above) |
| clauses | Every d3 week of 601–614 has a review deciding each floor clause; the d3 label weeks 611 and 613 amend both parameters; every d2/d3 week has a repeat update and every d3 week a malformed notification |
| oracle mutation | 3,300/3,300 single-fault mutants killed (score 1.000, 55 operators). The operators include a wrong code, rating, reviewer or star sign, a dropped or added `[HIGH PRIORITY]`, a duplicated or dropped ticket or email, a wrong recipient, an extra cc, a summary count ±1, a summary that adds a contradicting count line or a line with another code, a draft instead of a send, an acknowledgement or escalation deleted again, mail to a protected address, and edits to old records. Added in the review fixes: a lower-cased code in a ticket or summary, `App Review` or `[High Priority]`, the comment in `properties.description`, and seven summary faults (hedges in words, with numbers only, as a caveat or inline; week-to-date figures; the same counts again in words; the line with a prefix) |
| oracle specificity | 723/723 policy-neutral variants accepted, no false rejects. The variants: mark read, label and star, ticket priority HIGH, extra content around the comment, the reviewer address in upper case in the subject, a longer body, a summary with other figures that are not ticket or thank-you figures, a summary in markdown, in HTML, or with a greeting, a policy note and a `Thank you,` sign-off, a display-name recipient, extra words around a post. (`App Review` in the subject was a variant until 2026-10-21; POLICY.md 1.1 makes the case exact, so it is now a mutant) |
| probes | Every wrong probe fails on its own kind of trigger in every stream that has one; every correct probe passes all 167 triggers (table above) |

**Tests:** 167 passed (pytest 9.0.2 in the AutomationBench venv, 198 s). They cover:
- determinism and round trips; stream shape against `family.json`; trap rates and coverage; the d3 clause floor and the
  balanced amendment parameter; the week floor on every week of 601–630 and on forced difficulties, and its byte
  stability (with it turned off, `world0` and every unconverted trigger are identical); d1 streams and the d2 note
  clauses left alone;
- fictional entities only; held-out seeds refused; leakage; the Zap payload shape; the reference importing nothing
  host-side;
- the reference on dev, practice, rebased, d1 and d3 runs;
- every control failing, each plausible control failing on its own rule, the floor controls failing every d3 dev week,
  `no-dedupe` and `no-escalate` failing every dev week of their floor, and each amendment control failing on its
  parameter's week;
- the oracle: accepting the reference and rejecting null and echo; plausible-but-wrong effects; hedged summaries and
  deleted posts; a table of 19 policy-neutral and 24 hedged or second-figure summary bodies; exact case for the
  code and the subject, any case for the address; the 16 wrong and 6 correct probes on 610, 611 and 613; the mutation
  score; specificity; token boundaries; the end-of-week checks; harmless mail housekeeping;
- POLICY.md and family.json agreeing with the code, including the review-fix policy sentences the oracle relies on.

## Limits and open items

- **No arm has run.** `agent-H`, `wf-H` and the others need the shared stream runner (`stream.mjs`) and the `bridge.py`
  `abr-*` commands of RECURRING-DESIGN §3.7. Neither exists yet.
  - `harness.py` is the in-process $0 path for code solvers.
  - `gen.py` already writes the per-trigger `serve-inputs.jsonl` rows that `bridge.py serve` takes.
  - `harness.py` pins `TZ=UTC`, because the shim's naive clock is local time. A model-arm `serve` path must run under
    UTC too.
- **The second-reader fairness gate (§3.11 gate 6) is not done.** It needs a session that did not write this family,
  which is a model cost. The reference and the generator share an author, so their agreement does not rule out a
  shared misreading of `POLICY.md`. The review found one such gap by reading the code: §3 called the ticket
  body "Content (the ticket description)", but an AutomationBench `description` property lands in
  `ticket.properties` and the oracle (and AutomationBench's own `hubspot_ticket_exists`) read only `content`, so an
  arm that followed the parenthetical would have failed every ticket. POLICY.md 1.1 now names the property `content`
  (`w-description-property` is a probe). Run the gate (one cheap arm that reads only POLICY.md and the tools, on one
  practice seed) before any label run.
- **The summary rule is a word list.** POLICY.md §4 says the count line is the only place for ticket or thank-you
  figures and nothing may qualify them. The oracle checks this on meaning through three lists (ticket and thank-you
  words, quantities, correction words and ordinary hedges; `oracle.summary_problems`) and a table of 43 bodies in the
  tests. A caveat with none of the listed words and no number ("The late review is not in these figures"), or an
  ordinary hedge without a number ("Thank-yous might be off"), still passes; neither gives a second answer. A quantity
  next to "ticket" in an unrelated sense ("open a ticket for 2 bugs") is rejected, which the policy's "no other ticket
  figures" covers; so is a hedge word next to an unrelated number ("Any one of us can help if needed"), which the
  policy does not cover (a false reject, not seen in any probe).
- **Case.** The code and the literal parts of a ticket subject compare exactly (POLICY.md 1.1 says so); reviewer
  addresses ignore case; the thank-you and summary *subjects* still ignore case, a deliberate leniency the policy does
  not state.
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
  The d3 floor raised the d3 share to 0.639, above the design's 0.60; lowering the per-review rate barely moves it
  (0.632 at 0.38), because the floor then converts more plain reviews, so the rate was left at 0.47.
- **Not exercised** by any stream (a solver that gets these wrong is not caught):
  - an updated positive review from a reviewer already thanked this week (POLICY.md §3 step 6 sends another
    thank-you; a solver that thanks a reviewer once per week passes);
  - crash words in the subject or the notes rather than the comment (§3 step 4 reads the comment only);
  - a reviewer address in another letter case than an earlier ticket (§3 step 5 says "any case");
  - a d2 week without a COMP review does not test the COMP rule, and a d2 week without a malformed notification does
    not test escalation (`comp-email` and `no-escalate` have clean d2 weeks). Every d3 week tests both (the clause
    floor and, since the review fixes, the week floor); escalation is drawn with p = 0.4 at d2;
  - dev@'s "stop crash tickets" request is on no dev label week (above);
  - an arm that keeps its own memory instead of reading the apps back: the repeat update (every d2/d3 week) and the
    daily counts read back the arm's own writes, but nothing else does.
- **Undone writes.** A Gmail message sent and then deleted (`DELETE messages/{id}`) in the same trigger leaves no trace
  in `world_after`, so the oracle cannot see that it was sent. A Slack post deleted again stays in the world with
  `is_deleted` and is graded as a write that satisfies nothing. HubSpot tickets have no delete endpoint here.

## Changes

- 2026-10-21, review fixes ($0, no model). A review of the family as hardened earlier that day (scratch solvers through the real grader)
  found: hedged summaries worded other than `tickets N, thank-yous M` passed (medium); POLICY.md did not state that a
  summary may give no other counts, so a policy-following week-to-date line failed (low); the code and the subject
  were compared ignoring case (low); the weekly dedupe and escalation were decided on few weeks, none for escalation on
  the d3 dev weeks (low); "Content (the ticket description)" could send an arm to the wrong HubSpot property (low).
  Reproduced first: on the oracle before these fixes, nine of the new wrong probes passed 101/101 on 610, 611 and 613. Then:
  - **POLICY.md 1.1.** §2: copy the code exactly, letter case included. §3 step 5: the subject exactly as shown, letter
    case included, only the address in any case; the body in the HubSpot property `content`. §4: the count line on a
    line of its own; that line is the only place for ticket or thank-you figures (no week-to-date figures) and nothing
    qualifies them (no alternative, estimate, correction or recount).
  - **Oracle.** `summary_problems` replaces `summary_conflicts`: the line must stand alone (markdown and HTML allowed),
    no other line may give ticket or thank-you figures, no line may hedge or correct the counts (see Limits). Ticket
    subjects and the summary code compare in exact case, addresses in any case (`subject_key`). `body_text` turns HTML
    into lines, also when AutomationBench stored an HTML part in `body_plain`.
  - **Generator.** The week floor (see [Traps](#traps)); version stays 1.0.0 because no stream has been used for a
    label, and every byte the floor does not convert is unchanged.
  - **Probes, gates and tests.** `probes.py` (16 wrong, 6 correct, including the review's 11 solvers rewritten from their
    descriptions, since its scratch code was not kept), the `probes` gate, the week floor in the `clauses` gate and
    `no-dedupe`/`no-escalate` in the `controls` gate, 12 mutation operators (55), three specificity variants (and
    `ticket-subject-case` replaced by `ticket-address-case`), and 70 more tests (167).
  - Not done: the second-reader gate (a model cost); `T-authority:dev-skipcrash` on a dev label week.
- 2026-10-21, re-verification and hardening ($0, no model). Before any change, the 53 tests passed again and
  `gates.py --seeds 610-614` reproduced every 2026-10-15 number (167/167, 16 controls failing, mutation 2,847/2,847,
  specificity 608/608). Then:
  - **Probe.** An ad-hoc probe (scratch code, not committed) ran 25 more one-rule mistakes on 610–614. Five passed
    every dev week (167/167, 5/5 clean): ignoring the abuse note; crash words only prefixing tickets the rating earns;
    thanking high-priority reviews; letting the Engineering note allow emails; ignoring `Ticket ratings` amendments. Two
    more passed d3 dev weeks: ignoring `Bot Suspected` (611 and 613) and letting the COMP note allow emails (611). The
    cause: the note clauses came from a rotation that put each one on 0.04–0.46 reviews a week, and a coin had put both
    d3 dev weeks on the `Thank-you ratings` amendment. Four more passed every week because no stream contains the case
    they get wrong (three cases, listed under "Not exercised" above). The rest failed where their rule applies.
  - **Generator.** The d3 clause floor and the seed-balanced d3 amendment parameter (see [Traps](#traps)). d1 and d2
    streams are byte-identical to before; d3 streams change only where the floor converts a review or the parameter
    flips. The reference still passes every trigger (1,693/1,693 on 601–650).
  - **Oracle.** A daily summary must not also state other counts or a line with another code (`email.summary.single`,
    also at week close). A Slack post deleted again in the same trigger satisfies nothing. The 2026-10-15 oracle
    accepted 52 of the 54 new mutants of these two kinds on 610–614 (all 50 hedged or stale-code summaries, and both
    deleted escalation posts; it caught the deleted acknowledgements only through AutomationBench's
    `slack_message_in_channel`).
  - **Controls and gates.** 17 controls added (33 in all), the new `clauses` gate, three mutation operators and one
    specificity variant, and 44 more tests (97).
  - `POLICY.md`, `reference.py`, `lib.py` and `harness.py` are unchanged. The generator stays at version 1.0.0, because
    no stream from it has been used for any label; the floor's separate seeded stream keeps every earlier draw.
- 2026-10-15, first session ($0, no model). Written:
  - `POLICY.md`, `family.json`, `lib.py`, `gen.py`, `oracle.py`, `reference.py`, `controls.py` (16 controls),
    `harness.py` (adapted from `abr-sales-noshow`), `gates.py`, the tests and this README.

  Changes during development, before any arm ran:
  - fewer d3 reviews, so a week stays within 25–40 triggers;
  - d2/d3 trap rates retuned to the design's 35% / 60%;
  - amendment-shaped unauthorized requests added, so that `any-sender-amend` fails on every stream mix.

  The generator stays at version 1.0.0, because no stream from it has been used for any label.
