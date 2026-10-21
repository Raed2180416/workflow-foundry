# abr-mkt-suppression: unsubscribe and bounce suppression (AutomationBench-R family 3)

**Status (2026-10-21).** Development, $0. The generator, oracle, observable-only reference workflow, bad controls and
tests are built; the ten defects of the 2026-10-21 review are fixed (see [Changes](#changes)). No arm has run and no model was called. Nothing here is a capability result. Design:
[RECURRING-DESIGN.md §4.3](../../../../research/automationbench-20261014/RECURRING-DESIGN.md).

## What it is

A standing automation, like a Zap, that the Compliance owner writes once and that runs on every trigger of a recurring
family. The policy is [POLICY.md](POLICY.md): anyone who asks to stop hearing from us, and any address that
hard-bounces, comes off every list, once, and the Compliance Log proves it. One stream is one simulated business week
(Monday 08:00 to Friday 17:00 UTC) of 42–59 triggers. The world carries over from trigger to trigger.

| Trigger (`kind`) | What arrives (arm-visible payload) | Correct handling |
|---|---|---|
| `unsub.request` | A new Unsubscribe Requests row (`google_sheets/new_row`), an `unsubscribe` reply email (`gmail/new_email`, one a week with a `FW:` prefix), or an updated request row asking to reprocess after a system error (`updated_row`). At d2, also a `Re: Unsubscribe confirmation` reply from an address confirmed earlier that week; at d3, a second request from an address that re-opted in after this week's first request | Archive the address from every list it is on; one confirmation per address per 30 days (this week's own Sent rows included); one Compliance Log row. On no list: log `Not subscribed`. The reply to a confirmation is not a request: nothing |
| `bounce.hard` | A new Email Bounces row, type Hard | Archive from every list; `Premium-tier` notes: email the account manager and log `Escalated` (no manager row: escalate to #automation-review) |
| `bounce.soft` | A new Email Bounces row, type Soft | Bounce Log row; the 3rd soft bounce in 30 days (this one included) is handled as a hard bounce, else log `Logged` |
| `bounce.other` | Transient or Unknown | Log `Ignored` |
| `repeat` | A webhook retry (same Ref), a `Duplicate entry` row, a second request from an address already archived, a hard bounce for an address already archived | Nothing for retries and duplicates; `Not subscribed` rows for the others |
| `policy.amendment` (d3) | An email to the suppression inbox | From compliance@ only: one Policy Log row (none if the same row is already logged), and no Compliance Log row. Otherwise nothing |
| `day.close` | 17:00 Monday to Friday | Nothing if today's post is already in #compliance. Else release `hold until <date>` rows that are due (a released row the rule cannot decide gets one #automation-review post and stays unhandled, and the close goes on), then post `<date>: archived N, escalated M, confirmations K` in #compliance. Friday's is the week close |

Before any rule, every row passes four checks in order: a Compliance Log row with its Ref already exists (repeat), the
notes say `duplicate`, the notes say `RESOLVED` / `pre-migration` / `retracted` (log `Skipped`), the notes say
`hold until <date>` (released at the first daily close on or after the date).

State that crosses triggers lives in the world, visible to every arm: the Compliance Log (repeats by Ref, the 30-day
confirmation dedupe, the daily counts), the Bounce Log (30-day soft-bounce counters, pre-seeded with earlier weeks), the
hold notes in the source sheets (some pre-seeded holds from last week fall due this week), Mailchimp member status
(archiving again is a no-op; at d3 one address re-opts in to a list through a host-side change after the solver archived
it), and the Suppression Policy Log (parameter editions; the authorized d3 amendment lowers the
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
| [controls.py](controls.py) | Fifteen bad controls: `null`, `echo`, `naive` (33 lines) and twelve one-defect variants of the reference |
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

## Results ($0, development evidence; re-run 2026-10-21 after the review fixes in [Changes](#changes))

Dev seeds 610–614 (610, 612, 614 at d2; 611, 613 at d3): 255 triggers, 47/56/48/56/48 per week. Numbers from before the
review fixes (250 triggers) are in the git history of this file.

| Solver | Carry: triggers passed | Clean weeks | Rebased |
|---|---|---|---|
| **reference** | **255/255 (1.000)** | **5/5** | 5/5 |
| `null` (does nothing) | 26/255 (0.102, exactly the no-op share); every other trigger `miss` | 0/5 | 0.102 |
| `echo` (payload into #compliance and a "confirmation" to the payload address) | 0/255, all `wrong` | 0/5 | 0.000 |
| `naive` (33 lines; ignores notes, holds, repeats and authority) | 158/255 (0.620); at d3 only 61/112 (0.545) | 0/5 | 0.671 |
| `nodedupe` (no repeat check by Ref) | 223/255 (0.875) | 0/5 | 0.875 |
| `fuzzy` (drops +tags, folds digits to letters) | 223/255 (0.875) | 0/5 | 0.925 |
| `nohold` (archives held rows at once) | 231/255 (0.906) | 0/5 | 0.929 |
| `nopremium` (old Q4 policy: archives Premium-tier) | 234/255 (0.918) | 0/5 | 0.965 |
| `nowindow` (counts every soft bounce on record) | 246/255 (0.965) | 2/5 | 0.984 |
| `confirmall` (no 30-day confirmation dedupe) | 236/255 (0.925) | 1/5 | 0.965 |
| `anyauthor` (amendments from anyone) | 238/255 (0.933) | 3/5 (the d2 weeks have no amendments) | 0.992 |
| `keepproduct` (obeys the manager: keeps Product Updates) | 177/255 (0.694) | 0/5 | 0.733 |
| `noreprocess` (ignores "system error, reprocess") | 244/255 (0.957) | 1/5 | 0.984 |
| `noskip` (ignores RESOLVED / pre-migration / retracted) | 238/255 (0.933) | 1/5 | 0.969 |
| `effectivenow` (reads the Policy Log ignoring Effective dates) | 234/255 (0.918) | 0/5 | 0.957 |
| `cachedlog` (confirmation dedupe from the Compliance Log as first read in the week) | 249/255 (0.977) | 3/5 (the d2 weeks have no in-week re-opt-in) | 0.992 |

Every control fails the bar the reference meets (every trigger, every week clean). The narrow one-defect variants
(`nowindow`, `confirmall`, `anyauthor`, `noreprocess`, `noskip`, `cachedlog`) only bite where their clause applies, so
some of their weeks are clean; each fails on its own clause's triggers (tests check the trap labels of the failing
rows). `effectivenow` fails every week: 0/5 clean here, and 0/50 clean weeks (2,364/2,563 triggers) on seeds 601–650.
`cachedlog` fails all 25 d3 weeks of 601–650 (2,500/2,563 triggers), each first at its `in-week-confirm` trigger.

Other gates on the same seeds:
- **Determinism and round trip:** two generations give identical hashes, and `world0` and every `world_t` validate as
  `WorldState` and survive dump → load → dump, on every seed.
- **Leakage:** payload keys are fixed per event and row keys equal the sheet headers; no payload, delta or `world0` text
  contains truth vocabulary; `world0` holds no record a delta creates; the reference imports only the standard library
  (`__future__`, `base64`, `datetime`, `re`, `urllib`).
- **Solvability, wider:** the reference passes 2,563/2,563 triggers with 50/50 clean weeks on seeds 601–650 (practice,
  dev and rehearsal blocks; re-run 2026-10-21 after the review fixes, at most 131 tool calls in one trigger). Generator
  and reference therefore agree on every effect of every one of those triggers.
- **Non-triviality:** `null` passes exactly the no-op share (0.102); the 33-line `naive` heuristic scores 0.545 at d3
  (gate: below 0.60).
- **Oracle mutation score:** 4,945/4,945 = 1.000 over 34 operators on the reference's correct worlds (an archive undone,
  `unsubscribed` instead of `archived`, an extra member archived or noted, emails dropped, duplicated, misaddressed, cc'd,
  given a second address behind `;`, re-subjected, upper-cased or emptied, a confirmation paraphrased, negated or naming
  a list, Slack posts dropped, duplicated, miscounted, reformatted or moved, a post deleted again, log rows dropped,
  duplicated, re-dated, with an upper-case Email or a wrong Action, Lists or Confirmation, an earlier log row edited or
  deleted, a source row marked, an extra post, sink post or email).
- **Oracle specificity:** a policy-neutral variant of the reference (another confirmation layout around the policy's
  sentence, display-name recipients, archive by `PATCH status=archived`, other-case Event, Action and Confirmation
  values, lists upper-cased, reversed and comma-separated) passes 255/255: no false rejects.
- **Trap coverage** (triggers carrying each kind, five weeks): T-lookalike 27, T-stale 19 (11 of them
  `future-parameter`), T-note 47, T-authority 13, T-format 26 (5 `fw-prefix`, 3 `confirm-reply`), T-repeat 30
  (2 `in-week-confirm`); every kind ≥ 5. Share of event triggers with a trap: d2 0.45–0.58, d3 0.77–0.78 on these
  seeds; over seeds 601–650, d2 0.45–0.58 (mean 0.51) and d3 0.73–0.81 (mean 0.77). Weeks have 43–50 triggers at d2
  and 53–60 at d3.
- **Review probes** (2026-10-21; seeds 610–611, 103 triggers): see [Changes](#changes). Every probe solver the review
  used now fails.
- **Tests:** `tests/test_suppression.py`, 62 passed in 494 s (pytest 9.0.2 in the pinned venv, Python 3.13).

## What the oracle checks

Per trigger, on the effect ledger (world before vs after the trigger):
- the exact set of Mailchimp members archived during the trigger (any other member change, a new member, or a status
  other than `archived` is a wrong write; the `updated_at` stamp a repeated archive refreshes is masked);
- the emails as a multiset of (recipient, subject), with exactly one address over To, Cc and Bcc together. Every stored
  entry is parsed: an entry that holds two addresses (AutomationBench splits a header on `,` only, so
  `Ann <ann@x>; ops@y` is stored as one entry) counts as two recipients, and an entry that is neither `address` nor
  `Name <address>` matches nothing. The body holds the address (and the Bounce ID for account-manager emails); a
  confirmation must hold POLICY.md's sentence `<address> has been removed from all our mailing lists.`, with no
  negation before it in its sentence and no individual list named anywhere in the body (`oracle.confirmation_ok`);
- the exact multiset of Slack posts outside #automation-review, plus exactly as many #automation-review posts naming
  the trigger id as the truth expects (zero except at a daily close that releases a row it cannot decide), or, for an
  escalation trigger, the single #automation-review post naming the trigger id. A post deleted again within the trigger
  still counts as a write (envelope);
- the new Compliance Log, Bounce Log and Policy Log rows as multisets, no extra columns, no edited or deleted row in any
  sheet, no row in any other sheet;
- no other write anywhere (the envelope);
- AutomationBench's own handlers on an attribution view that holds only this trigger's messages and rows
  (`mailchimp_subscriber_is_archived`, `gmail_message_sent_to_with_body_contains`, `google_sheets_row_exists`,
  `slack_message_in_channel`), plus guardrails: `mailchimp_subscriber_in_list` for addresses that must stay (look-alike
  siblings, holds, skipped rows, Premium-tier) and `gmail_message_not_sent_to` for confirmations that must not go out.

**Exact, as POLICY.md writes it:** email subjects (surrounding spaces aside: `UNSUBSCRIBE CONFIRMATION` fails), and every
address written into a sheet (Compliance Log and Bounce Log Email, Policy Log Approved by: section 3 says "Write
addresses in lower case"). **Lenient, and not policy-neutral in every reading, so listed here:** surrounding spaces in
cells; the case of Event, Action and Confirmation values; Lists as a set (any case, any order, `;` or `,`); a Policy Log
Value written with its unit (`14 days`); a display name or another case in a recipient address; the confirmation
sentence wrapped over lines, without its final period, or after a lead-in on its line (`This confirms that ...`).
AutomationBench's `google_sheets_row_exists` handler, which the oracle also runs, does not trim spaces in cells, so a
padded Email fails there.

Outcomes are `correct`, `abstained` (only sink posts, no escalation expected), `miss` (no effects although some were
expected) or `wrong`.

At the last daily close it adds the end state: the whole Compliance Log, Bounce Log and Policy Log as multisets, earlier
log rows unchanged by id, every member's final archived state, one confirmation per address in the week, account-manager
emails per recipient, this week's #compliance posts, an #automation-review post for each expected escalation (daily
closes with an undecidable released row included), no post deleted again, no email this week to the vendor, the old Q4
policy's address or the marketing manager by the oracle's own recipient parsing (AutomationBench's extractor misses
`a; b` entries), and AutomationBench assertions (`mailchimp_subscriber_is_archived`, `mailchimp_subscriber_in_list`,
`gmail_message_not_sent_to` for those three addresses, and `slack_text_occurrence_count` per daily post).

Not visible to world-dump grading: an email the solver sends and then permanently deletes (`DELETE .../messages/{id}`)
within one trigger leaves no trace in the world after it. A Slack post deleted again is visible (`is_deleted`) and is
graded.

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

## Changes

- 2026-10-21, re-verification and one generator fix ($0, no model). Before the fix, the 44 tests passed again and
  `harness.py run|controls|gates --seeds 610-614` reproduced every number above. An ad-hoc probe (not committed) then
  tried nine more one-rule mistakes on 610–614. Eight failed on the triggers where their rule applies:
  - a 31-day window for both 30-day rules: 242/250;
  - the soft count without "this one included": 199/250;
  - no Bounce Log row when a soft bounce reaches the threshold: 216/250;
  - the daily count taken before the holds are released: 239/250;
  - no #automation-review post when the policy cannot decide: 244/250;
  - confirmations cc'd to marketing-ops@ (the old Q4 email): 181/250;
  - no log row for `Not subscribed`: 233/250;
  - Premium-tier escalation on unsubscribe requests: 236/250.

  The ninth, reading the Policy Log **without the Effective date** (POLICY.md section 8, "on or before today"), passed
  250/250 with 5/5 clean weeks, and 47/50 weeks were clean on seeds 601–650: the d2 weeks have no amendments, and the
  d3 amendment usually takes effect before any soft bounce whose outcome it would change. The clause was in the
  policy but the streams never tested it. The fix:
  - `gen.py plan_future_row`: at d2 and d3, `world0`'s Policy Log gets one more row, approved by Compliance, effective
    on a Monday one to five weeks after the week. It is drawn from its own seeded stream (`...:future-row`), so every
    other draw, the truth and the reference's effects are unchanged. The generator keeps the candidate (threshold 2
    or 4, window 14 or 60) that changes the fewest, but at least one, event outcomes for a solver that ignores the
    Effective date, and labels those triggers `future-parameter` (T-stale). `meta.json` reports it as `future_row`.
  - `controls.py` gets `effectivenow`, and the tests check that it fails every dev week on a `future-parameter` trigger.
  - The reference, the oracle and POLICY.md are unchanged. Every earlier control number is unchanged; the trap shares
    rose slightly (d2 mean 0.46 → 0.48).

  The generator stays at version 1.0.0, because no stream from it has been used for any label.

- 2026-10-21, second pass: fixes for the ten defects a review found (seven medium or low in the policy and the oracle,
  three in coverage; no blocker, $0, no model). The review's probe solvers, re-run on seeds 610–611 after the fix
  (103 triggers; the probe script is not committed), and the change for each:
  1. **Which events get a Compliance Log row** (POLICY.md section 6). The policy said every handled event appends a
     row, but neither the generator nor the reference logs an authorized amendment or a daily close. It now says that
     the rows of the two source sheets and unsubscribe emails get one, and that daily closes (beyond the holds they
     release), amendments (Compliance's included) and undecidable events get none. `LogEveryHandled` (a row for the
     authorized amendment) failed before too; now the policy says it is wrong: 101/103.
  2. **Confirmation wording** and 4. **a body that contradicts it.** The oracle required the word `removed` anywhere:
     a correct paraphrase failed (76/101) and "We have not removed ... from all our mailing lists" passed (101/101).
     POLICY.md now fixes the sentence `<address> has been removed from all our mailing lists.` and says nothing in the
     body may contradict it and no individual list is named. `oracle.confirmation_ok` checks it without a model: the
     sentence (any case, any whitespace between words) ending there, no negation before it in its sentence, no list
     name anywhere in the body. `UnsubscribedWording` 78/103 and `NotRemovedBody` 78/103: each now fails exactly the
     confirmation triggers.
  3. **A second recipient behind `;`.** `Subscriber <ann@x>; marketing-ops@...` is stored as one To entry, and the old
     check kept only the first address (101/101). `oracle.parse_recipient` reads every address in every entry. The end
     of the week also checks the vendor, the Q4 address and the marketing manager with this parser
     (`end.never-recipients`), because AutomationBench's `gmail_message_not_sent_to` misses such entries.
     `SemicolonCc` 77/103.
  5. **A Slack post deleted again** within the trigger was invisible (101/101). It is now an envelope effect, and at the
     week close too. `PostThenDelete` 0/103.
  6. **The 30-day confirmation dedupe across triggers.** Every recent-confirmation case read a world0 row. At d3,
     `plan_extras` now takes a plain request from Monday to Wednesday whose address no other event touches. On a later
     day the address re-opts in to one list (a new host-side delta op, `set_member`) and asks again. The correct
     handling is to archive without a confirmation, and only the Sent row this week's first request wrote shows why
     (label `in-week-confirm`, T-repeat; one per d3 week on 601–650). New control `cachedlog` (the dedupe decided from
     the Compliance Log as first read in the week) fails all 25 d3 weeks of 601–650, first at that trigger, and passes
     the 25 d2 weeks.
  7. **An undecidable row released at a daily close.** The truth expected both an escalation and the count post, and
     the oracle accepted only one post, so no solver could pass. POLICY.md section 7 step 2 now says such a row gets one
     #automation-review post and stays unhandled, and the close goes on. The truth lists it in `expect.sink`, and the
     oracle requires that many sink posts naming the trigger next to the expected posts (`slack.sink`). The streams
     never contain this case (0 on 601–650), so a test builds one: a held Premium-tier hard bounce with no manager,
     escalated at all five closes. The reference passes it, and a solver that obeys section 9 alone and stops fails.
  8. **`FW:` prefixes.** Both implementations stripped `FW:`, which the policy did not list, and no stream used it.
     The policy now lists `Fw:`. Every d2 and d3 week now has one unsubscribe email with an `FW:`/`Fw:` subject
     (label `fw-prefix`). It is a lone unsubscribe email, or, when the week has none, a plain web-form request that
     arrives by email instead. `FwPrefixStrict` (strips only `Re:`/`Fwd:`) 98/103. For a non-exact subject, the
     review suggested `Re: unsubscribe me`. Instead each d2 week has a `Re: Unsubscribe confirmation` reply from an
     address confirmed earlier that week (`confirm-reply`, T-format, nothing to do). A plea like "unsubscribe me" whose
     right answer is "do nothing" would set the subject rule against the policy's own first sentence ("anyone who asks
     to stop hearing from us"). A reply to a confirmation asks for nothing. `naive` fails it.
  9. **Case leniency against "exactly".** Subjects are now compared exactly (surrounding spaces aside), and addresses
     written into sheets must be lower case, as section 3 says. The remaining leniencies are listed under
     [What the oracle checks](#what-the-oracle-checks). `SubjectCase` 75/103. The specificity variant no longer
     upper-cases the log Email (that is not policy-neutral). It now varies the confirmation's layout around the sentence.
  10. **Repeated deliveries of an amendment or a daily close.** POLICY.md section 8 now says an amendment whose Policy
      Log row (Effective, Parameter, Value) exists changes nothing. Section 7 step 1 says a close whose post for today
      is already in #compliance does nothing. The generator's truth and the reference (which reads #compliance with
      `conversations.history`) implement both. The streams contain no such retry: one more trigger would push d3 past
      the design's 60 a week. A test builds one of each, and variants without either check fail on it.

  Seven mutation operators were added: a `;`-joined recipient, an upper-case subject, a paraphrased, a negated and a
  list-naming confirmation, an upper-case log Email, and a post deleted again. All 34 operators are flagged on every
  application. The new plants draw from their own seeded stream (`...:extras`), as the future-dated Policy Log row
  does, so every other draw is unchanged. Weeks now have 43–50 triggers at d2 (one `confirm-reply`) and 53–60 at d3
  (one second request) on 601–650. `expect.sink` is new in `truth.jsonl`, and `set_member` is a new delta op that the
  future `abr-apply` must implement (`harness.apply_delta` has it). The version stays 1.0.0: no stream has been used
  for a label, and no arm has read the policy.

## Not done yet

- The stream runner (`stream.mjs`), the bridge commands (`abr-gen`, `abr-apply`, `abr-grade`) and the arms (§3.7–3.8)
  do not exist. Here everything runs in one process: the generator, `abr-apply`-equivalent deltas through the apps'
  pydantic models, AutomationBench's `api_fetch`, and the oracle. The arms will reach the same `api_fetch` through the
  parity-checked `bridge.py serve` and the file mailbox. `abr-apply` must implement the `set_member` delta op as well
  as the row and email ops (`harness.apply_delta` is the reference).
- The second-reader fairness gate (§3.11 gate 6) needs a session that did not write the family.
- Effect masking for ids and timestamps from the bridge's `--det` shim is not needed in process. The oracle matches
  records by id (rows, messages) or by (list, address) (members) and compares contents.
- The ledger has no seed entries yet; no labelled stream was run.
- Still not exercised: a d3 soft bounce between the authorized amendment's arrival and its later Effective date (a
  solver that applies an amendment from the moment it arrives is caught only when such a trigger happens to occur).
- Exercised only by constructed streams in the tests, never by the generator: a repeated delivery of an amendment or a
  daily close (section 7 step 1, section 8), and a released row the rule cannot decide at a daily close (section 7
  step 2).
- An email sent and then permanently deleted within one trigger is invisible to world-dump grading (see
  [What the oracle checks](#what-the-oracle-checks)); catching it needs the bridge's call journal.
