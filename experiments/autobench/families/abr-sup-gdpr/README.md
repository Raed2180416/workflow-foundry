# abr-sup-gdpr: GDPR erasure requests (AutomationBench-R family 8)

A **standing automation** in the AutomationBench-R ("recurring") adaptation: a fixed policy that the Privacy Office
writes once ([POLICY.md](POLICY.md)), plus a **stream** of 21–32 triggers over one simulated business week. The world
carries over from one trigger to the next. Design: [RECURRING-DESIGN.md §4.8](../../../../research/automationbench-20261014/RECURRING-DESIGN.md)
(shared packaging in §3). This family carries two **typed hard requirements**: an append-only audit log (`audit`) and a
statutory 30-day deadline checked at the daily close (`schedule`).

**Status (2026-10-15).** Development, $0. Built: the generator, the oracle, an observable-only reference workflow,
25 bad controls, the $0 validity gates and the tests. No model has run on this family, so there is no arm result and
no capability number yet. Everything below is development evidence on practice and dev seeds (601–650). No held-out
seed (8801+) has been generated or looked at.

**Re-verified 2026-10-21** ($0, same venv, AutomationBench `4a8e106`). Before any change, the 27 tests passed, `gates.py`
exited 0 and every number below reproduced exactly. One gap was found and closed: no blocked request ever reached day 30
at a daily close (the oldest was 27 days over 601–650), so the rule "only `Verification Sent` requests are closed" was
never tested against a legal hold that outlasts the deadline. The new trap `deadline-held`, the control `close-held` and
one POLICY.md sentence (§8.1) cover it (History). Reference: still every trigger and every week.

**Review fixes 2026-10-21** ($0, no model; History has the details). A review found that the oracle graded more
loosely than POLICY.md states, plus four smaller gaps. Fixed:
- The oracle now grades every text the policy fixes **as written** (family.json `exactness`). That covers ticket tags
  (letter case counts), ticket subjects (the prefix with one space, no padding), the `#privacy-ops` summary (no
  trailing period), and log rows (exact Request ID, Transition and Reference, commas as the separator). At must be
  the event's instant in a UTC spelling.
- A required email that is sent and then moved to Trash or Spam no longer counts as sent. The envelope reports it.
- New d2/d3 story `hold-lift-inweek`: a hold added this week is lifted later the same week. The lift then reads a
  Blocked row that the automation wrote itself.
- Trigger ids are now opaque, and the prompt no longer names the family.
- `bridge.py serve` and `replay` pin the process time zone from the row's `info.tz`, which is `UTC` for this family.

Every reviewer variant that passed 77/77 before the fix now fails. Gate 6 (second reader) stays open.

## What an arm does

The automation fires on every new Erasure Requests row, every email to the privacy inbox, every Legal Hold change and
at 17:00 UTC each weekday. Each run gets one Zap-style payload (`{"trigger","at","app","event","data"}`) and
AutomationBench's own three tools (`api_search`, `api_fetch`, `base64_encode`) on its simulated Zendesk, Google Sheets,
Gmail and Slack.

| Trigger kind | Per week (d2 / d3) | Correct handling |
|---|---|---|
| `erasure.requested` (`google_sheets` / `new_row`) | 8–10 / 10–12 | The first rule that applies: <ul><li>another request for the same address is open, blocked or purged: log `Duplicate` (Reference = that request);</li><li>no Zendesk user has the address: log `Not Found`, email `Erasure request <ID>: no account found`;</li><li>otherwise: email `Verify your erasure request <ID>`, log `Verification Sent`.</li></ul> |
| `verification.reply` (`gmail` / `new_email`) | 6–8 / 8–10 | Verifies a request only when it quotes the ID of a request in `Verification Sent` **and** the sender's address (the part in angle brackets) is that request's address. Then log `Verified` (Reference = message id) and, in the same run: an Active hold on the exact address → log `Blocked - Legal Hold`, email the hold notice; otherwise purge and log `Purged` (Reference = ticket ids or `none`). Anything else: nothing |
| `legal_hold.changed` (`google_sheets` / `new_row` or `row_updated`) | 1–3 / 2–3 | A hold added: nothing. A hold lifted: purge every blocked request for that address, unless another Active hold row remains |
| `erasure.duplicate` (`google_sheets` / `new_row`) | 1–2 / 2–3 | The same address again: `Duplicate` |
| `day.close` (`schedule` / `day_close`) | 5 | Close every `Verification Sent` request whose Requested Date is 30 or more days before the date (log `Closed - Unverified`, email), then post `<date>: <N> purged, <M> blocked, batch <Batch_Reference>` in #privacy-ops. Friday's close is the week close |

**Purge.** Every ticket whose requester is the user gets the subject prefix `[GDPR Purged] ` and the tag `gdpr-purged`,
keeping its other tags; then the user is deleted. Tickets of anyone else stay untouched, even when they mention the
requester, carry the requester's comment, share the organization or have a requester with the same name.

**The hard requirements.**
- `audit`: the Compliance Log is append-only, one row per transition. The oracle fails a trigger that changes or removes
  any existing log row (`audit.append-only`), that misses or duplicates a transition row, or that appends rows of one
  request out of order. The week close re-checks that every world0 row is unchanged and in place, and that the week's
  rows equal the truth multiset. AutomationBench's own `google_sheets_row_not_updated` runs on earlier rows as well.
- `schedule` (statutory deadline): no request may reach day 30 at a daily close without a terminal state. The
  closures are graded at each close, and at the week close `end.statutory-deadline` recomputes the rule **from the
  arm's own world**: every Erasure Requests row 30 or more days old at Friday must have a terminal or hold state in the
  arm's log.

**State of record.** A request's state is the Transition of its latest Compliance Log row. Every arm reads it back; no
private memory is needed.

## Grounding

One public task at AutomationBench commit `4a8e1061254004d9dac807054eed33fad7d1ff14` (Zapier, MIT; the clone under
`corpus/AutomationBench` is never committed):

- `support.zendesk_gdpr_purge`, `automationbench/domains/support/tasks.py:22601-23005` (not in the raw Haiku subset).
  Kept [code]: one spreadsheet holding Erasure Requests, Legal Hold, Compliance Log and Report Config; find the Zendesk
  user by email; anonymize the user's tickets with the `[GDPR Purged]` subject prefix and the tag `gdpr-purged`; delete
  the user; check the legal-hold list first, so a held user and their tickets stay untouched; log every request,
  including not-found ones; a #privacy-ops summary with `Batch_Reference` and `<N> purged`. The task's `.de` domain is
  the origin of the look-alike-domain trap.

Added for the recurring version [D, from the family spec]: verification by reply from the exact address; the request
lifecycle in an append-only log with one row per transition; holds that are added and lifted during the week; the
30-day deadline at the daily close; duplicates; the per-day summary with blocked counts.

**Narrowed [D].** The spec asks for the description `[redacted]` on purged tickets. The simulated Zendesk API cannot
change a ticket's description: `PUT /tickets/{id}` forwards no description field
(`automationbench/tools/api/routes/zendesk.py:92-117`), and `zendesk_tickets_update` takes none
(`automationbench/tools/api/impl/zendesk.py:134-182`). POLICY.md therefore keeps the subject prefix and the tag, and
forbids any other ticket change or comment. A test checks the API behaviour (`test_api_cannot_set_a_ticket_description`).

All people, companies and domains are fictional and use the RFC 2606 names only (`*.example.com`, `.example.net`,
`.example.org`). Look-alikes such as the grounding task's `.de` are rendered as `.example.net` vs `.example.com`,
`brand-de.example.com`, digit-for-letter brands, dotless local parts and `+tags`. Every record is our own text, not
AutomationBench noise.

## Class hypothesis [I, written before any label]

**Forced, by the typed hard requirements (audit and schedule).** Every trigger has to rebuild request state from an
append-only log; check the sender's exact address, the Legal Hold sheet and the 30-day clock; and write exact rows and
emails. A per-trigger Haiku agent (`agent-H`) is expected to reach about 0.6–0.8 per trigger with few clean weeks. The
expected failures are skipped or edited log rows and spoofed verifications accepted. One such error is an irreversible
deletion or an audit breach. A workflow built once should pay, and more so as the cost of a wrong action W rises above V
(a W = 5V sensitivity is proposed). Proposed split: held-out (near, forced).

What the controls show, and what they do not: each single-rule mistake costs 3–35% of triggers on the dev streams
(78% for writing At as a date only, which spoils every log row). None of the 25 controls keeps all five weeks clean;
the best keep 3 of 5. That fits the hypothesis but does not test
it; only an agent-H run does.

## Files

| File | What it is |
|---|---|
| [POLICY.md](POLICY.md) | The standing policy every arm receives (v1) |
| [family.json](family.json) | Id, apps, tools, envelope, narrowing, trigger kinds and rates, trap catalogue and rates, typed hard requirements, need-job card, hypothesis, seeds, controls |
| [gen.py](gen.py) | Seeded generator: `world0` (validated as AutomationBench `WorldState`, round-tripped), arm-visible `payloads`, host-only `triggers` (payload + delta + traps), `truth`, `end`, one `serve-inputs` row per trigger (`assertions: []`), `meta` with sha256. Uses `random.Random(f"{family}:{version}:{seed}:{difficulty}")` with no wall clock; an unschedulable plan is redrawn from a numbered sub-seed. The plan says only what happens in the world; the truth is derived by applying the policy to it, step by step, and the plan's intent is asserted against that derivation. Refuses held-out seeds |
| [oracle.py](oracle.py) | Per-trigger grader: an effect ledger from `world_before` / `world_after` (attribution), the audit checks, exact effects, the envelope, AutomationBench's own `AssertionRegistry` checks, and the end-of-week state at the Friday close. Outcomes: correct, abstained, miss, wrong |
| [reference.py](reference.py) | Reference workflow: author-written code, no model. It sees only the payload, the policy constants and the tools, keeps no private state, and imports only the standard library. At most 14 tool steps per trigger |
| [controls.py](controls.py) | 25 bad controls (below) |
| [harness.py](harness.py) | `$0` stream runner. It applies each delta and calls the tools through `bridge.Rollout.batch`: the official `env_response` path with the determinism shim, clock = trigger time. It grades every trigger, in carry and rebased modes |
| [gates.py](gates.py) | The $0 validity gates of RECURRING-DESIGN §3.11 |
| [tests/test_gdpr.py](tests/test_gdpr.py) | pytest suite |

## Commands

All of these run inside AutomationBench's own venv (`uv sync` in `corpus/AutomationBench`, pinned by its `uv.lock`):

```
PY="corpus/AutomationBench/.venv/bin/python -I -B"
F=experiments/autobench/families/abr-sup-gdpr
$PY $F/gen.py --seed 610 --out /tmp/gdpr-610                         # host-only stream files
$PY $F/harness.py run --solver reference --seeds 601-614 [--mode rebased] [--failures]
$PY $F/harness.py run --solver any-sender --seeds 610-614
$PY $F/gates.py [--seeds 610-614] [--only mutation,specificity]       # exit 0 only when every gate passes
$PY -m pytest -q -p no:cacheprovider $F/tests
```

## Traps

Each trap id is recorded on the triggers where it is **exposed**: where a solver that ignored exactly that rule would
act differently. Every trap is resolvable from `POLICY.md` and the tools.

| Kind | Trap id | Where | Resolved by |
|---|---|---|---|
| T-lookalike | `lookalike-domain` | a request for `x@brand.example.net`, `x@brand-de.example.com`, `x@br4nd...` or a dotless local part, while only `x@brand.example.com` is a Zendesk user | §3 same address: `Not Found` |
| | `same-name` | another Zendesk user with the requester's name, with tickets | §6: only the user with the same address |
| | `hold-lookalike` | an Active hold on a similar address | §5: exact address only, purge |
| | `wrong-id` (d3) | the requester quotes someone else's Request ID | §5: the sender must be that request's address |
| T-authority | `spoof-lookalike`, `spoof-forward`, `spoof-display`, `spoof-colleague` | a reply from a look-alike address; from another address claiming to be the requester; with the requester's address as the display name; a colleague confirming | §5: nothing |
| T-note | `cc-user` | another user's ticket mentions the requester's address and carries the requester's comment | §6: untouched |
| | `org-domain` | other users of the requester's organization have tickets | §6: untouched |
| | `no-id` | a reply from the right address without the ID | §5: nothing |
| | `hold-on-request`, `on-hold`, `hold-added` | the address is on hold when the request arrives / when it is verified; a hold row is added | §4: verification still sent; §5: blocked with notice; §7: nothing now |
| T-repeat | `duplicate-open`, `duplicate-blocked`, `duplicate-purged`, `duplicate-case` | the same address again (d3: other case or padded) | §4 rule 1 |
| | `repeat-reply`, `late-reply` | a second confirmation after purge or block; a confirmation after `Closed - Unverified` | §5: nothing |
| T-format | `case-address`, `case-sender` | a capitalized request or reply address | §3: same address |
| | `keep-tags`, `no-tickets` | purged tickets carry other tags; the user has no tickets | §6: keep the tags; Reference `none` |
| | `id-in-body` | the ID only deep in the body (not in the subject or the payload snippet) | §5: subject or anywhere in the body |
| | `backdated` (d3) | postal requests entered with an earlier Requested Date | §8: the deadline counts from the Requested Date |
| T-stale | `re-request` | an earlier request for the address ended `Closed - Unverified` | §4: handled as new |
| | `hold-lifted-row` | a Lifted hold row for the exact address | §5: only Active rows hold |
| | `batch-changed` (d3) | `Batch_Reference` changes mid-week, under a `Previous_Batch_Reference` row | §8: the setting named exactly `Batch_Reference`, read at the close |
| T-timing | `deadline`, `deadline-late` (d3), `deadline-not-yet`, `deadline-day`, `deadline-held` | a closure at age 30; a postal letter entered 31–33 days after its date, closed at that day's close; an open request at age 29; a verification on the morning of day 30; a request blocked by a legal hold that is 30 or more days old at a close (pre-seeded 30–47 days old) | §8: `>= 30` at a close, state `Verification Sent` only; a blocked request is verified and answered, so it is never closed |
| T-state | `hold-lift`, `hold-still` (d3), `count-lift` | a hold lifted (purge at that trigger); one of two holds lifted (still held); today's summary includes a hold-lift purge | §7, §8 |
| | `hold-lift-inweek` (d2/d3) | a request verified while on hold this week, whose hold is lifted later the same week: the lift purges from a `Blocked - Legal Hold` row the automation wrote this week (every other hold-lift purge reads a row pre-seeded in world0) | §5, §7 |

## Numbers [measured, $0, development evidence]

From `gates.py` (default seeds: dev 610–614, practice 601–609) and `harness.py`, 2026-10-15. Re-run 2026-10-21 twice:
after the `deadline-held` fix, and again after the review fixes (the exact oracle, the in-week hold lift and opaque
trigger ids; every number below is from that last run). Generator version 1.0.0.

**Stream shape** (seeds 601–650):

| | d1 (631–640 forced) | d2 | d3 |
|---|---|---|---|
| Triggers per week | 21 | 23–27 | 29–32 |
| Purged per week | | 4–7 | 4–6 |
| Blocked per week | | 0–1 | 1–2 |
| Closed - Unverified per week | | 1–2 | 4 |
| Share of triggers with an exposed trap (design) | 0.27 | **0.59** (0.45) | **0.82** (0.75) |

Each kind also appears within the spec's per-week range. Every pre-seeded open request is at most 29 days old on
Monday, as the spec says, and reaches day 30 during the week. A pre-seeded request that is already verified and
blocked by a legal hold may be older (30–47 days; `deadline-held`, in 13 of 26 d2 weeks and 17 of 24 d3 weeks, with
631–640 at their default difficulty). The in-week hold lift (`hold-lift-inweek`) appears in 16 of the 40 d2/d3 weeks
(8 d2, 8 d3; dev seed 611). Both difficulties sit above the design rates.
Duplicates, hold changes, non-verifying replies and deadline closes are traps by construction, and they already make
up about a third of a d2 week. The base rates (users in organizations, tagged tickets, capitalized and body-only
replies) were lowered once, which brought d2 from 0.58 to about 0.55. That tuning used practice and dev seeds only,
before any arm ran.

**Reference** (observable-only code, no model):
- 1,369/1,369 triggers and 50/50 clean weeks on seeds 601–650 (carry mode, default difficulty);
- 822/822 on 601–630 in rebased mode;
- 210/210 and 305/305 on 631–640 forced to d1 and to d3;
- at most 17 tool steps per trigger (14 on the default streams).

The deliverable bar is ≥ 95% on 5 dev seeds. Result: **132/132 (100%) on 610–614** (23/23, 31/31, 24/24, 31/31,
23/23), with 5/5 clean weeks. Generator and reference agree on every effect of every stream run.

**Bad controls** on 610–614 (132 triggers; 18 of them are passed by doing nothing):

| Control | What is wrong | Pass | Rate | Clean weeks | Outcomes |
|---|---|---|---|---|---|
| `null` | does nothing | 18 | 0.136 | 0/5 | 114 miss |
| `echo` | posts every trigger's data in #privacy-ops | 0 | 0.000 | 0/5 | 132 wrong |
| `naive` (25 lines) | verifies every request, purges on any reply quoting an ID (no sender, state or hold check), no holds, no deadline, first `Batch` setting | 48 | 0.364 (d3: 0.306) | 0/5 | 67 wrong, 17 miss |
| `any-sender` | accepts a quoted ID from any address | 106 | 0.803 | 0/5 | 22 wrong, 4 miss |
| `display-first` | takes the first address-like text in From | 123 | 0.932 | 3/5 | 8 wrong, 1 miss |
| `fuzzy-address` | compares addresses by local part | 104 | 0.788 | 0/5 | 24 wrong, 4 miss |
| `case-sensitive` | compares addresses with letter case | 117 | 0.886 | 2/5 | 10 wrong, 5 miss |
| `no-hold` | ignores the Legal Hold sheet | 123 | 0.932 | 2/5 | 8 wrong, 1 miss |
| `any-hold-row` | counts Lifted rows as holds | 124 | 0.939 | 2/5 | 8 wrong |
| `no-lift` | never purges at a hold lift | 116 | 0.879 | 0/5 | 10 wrong, 6 miss |
| `text-search` | finds tickets by free-text search for the address | 121 | 0.917 | 0/5 | 11 wrong |
| `org-purge` | purges the whole organization's tickets | 118 | 0.894 | 2/5 | 14 wrong |
| `name-match` | purges every user with the requester's name | 124 | 0.939 | 1/5 | 8 wrong |
| `replace-tags` | sets tags to `['gdpr-purged']` | 125 | 0.947 | 2/5 | 7 wrong |
| `edit-log` | edits the request's latest log row instead of appending | 86 | 0.651 | 0/5 | 46 wrong |
| `skip-verified` | does not log `Verified` | 101 | 0.765 | 0/5 | 31 wrong |
| `no-dedupe` | a duplicate gets a second verification | 117 | 0.886 | 0/5 | 15 wrong |
| `dedupe-any` | any earlier request makes a duplicate | 122 | 0.924 | 0/5 | 10 wrong |
| `exact-deadline` | closes only at exactly day 30 | 128 | 0.970 | 3/5 | 4 wrong |
| `late-deadline` | closes from day 31 | 115 | 0.871 | 0/5 | 17 wrong |
| `close-held` | also closes Blocked requests at day 30 or later | 121 | 0.917 | 2/5 | 9 wrong, 2 miss |
| `count-all` | the summary counts every row in the log | 107 | 0.811 | 0/5 | 25 wrong |
| `stale-batch` | first setting containing `Batch` | 122 | 0.924 | 3/5 (the d2 weeks) | 10 wrong |
| `snippet-only` | looks for the ID in the payload subject and snippet only | 111 | 0.841 | 0/5 | 10 wrong, 11 miss |
| `at-date` | writes At as the date only | 29 | 0.220 | 0/5 | 103 wrong |

Every control fails: none passes every trigger or keeps every week clean. 24 of the 25 are below the 95% bar
(`exact-deadline`, at 0.970, is the exception: it is wrong only on the late postal requests). The
tests also check that each plausible control is rejected **on its own trap**: for example `any-sender` on the spoof
triggers, `text-search` on `cc-user`, `exact-deadline` on `deadline-late` and `snippet-only` on `id-in-body`. They
also check that `edit-log` trips `audit.append-only` itself, and that `late-deadline` trips `end.statutory-deadline`.
In rebased mode every spoofed verification that `any-sender` accepts is a wrong delivery. In carry mode one is not
(s613/t09): an earlier spoof had already purged that request, which is the cascade the carry mode reports.

**Gates** (`gates.py`, all pass, exit 0):

| Gate | Result |
|---|---|
| determinism | Identical sha256 on regeneration (610, 611, 612); every `world_t` validates and round-trips |
| leakage | 0 problems on 610–614. Payload keys are fixed per event. Sheet payloads equal the world's cells after the delta, and email payloads equal the inbound message. No trap id, trigger kind or plan word appears in payloads or world0. Trigger ids are unique 10-hex hashes, and no payload or prompt names the seed, the trigger's position or the family. Request rows and inbound emails arrive with their trigger. Serve rows have a fixed system line, carry no assertions or records, and pin `info.tz` to UTC. The reference imports only the standard library |
| solvability | 381/381 triggers, 14/14 clean weeks on 601–614; rebased 132/132 on 610–614 |
| controls | As above. `null` passes exactly the 18 no-op triggers; `naive` scores 0.306 at d3 (below 60%) |
| trap coverage (610–613) | lookalike 9, authority 10, note 22, repeat 13, format 24, stale 13, timing 33, state 12 (each ≥ 5) |
| oracle mutation | 4,019/4,019 single-fault mutants killed on 610–614 (score 1.000, 57 operators). Examples: a dropped or duplicated log row, an edited or deleted earlier row, a log row's At moved or blanked, rows of one request swapped, an email with an extra CC or without the Request ID, a ticket with replaced tags or a comment, another user's ticket prefixed, a user left undeleted, a summary count off by one, a stale batch, a trashed inbound email. 14 operators were added after the 2026-10-21 review. They cover re-cased tags, an extra space after the prefix, a padded subject, a sent-then-trashed email, a trailing period or doubled space in the summary, an At 50 s late or in another offset, and a re-cased or padded Request ID, Reference or Transition. They also cover a `;`-separated Reference. The pre-fix oracle let 519 of these through on 610–614 |
| oracle specificity | 720/720 policy-neutral variants accepted: an At with `+00:00` or without seconds, the log Email in other case (§3), Reference ids reordered (commas), a display name or upper case in To, a longer body, an email subject padded at its ends, reordered tags, another bot name on the post, the inbound email marked read. An equivalent solver passes 132/132. It appends by worksheet title, uses the tags endpoint and the channel id, writes offsets in At, reverses the Reference order and lower-cases the Email |

**Tests:** 40 passed (pytest 9.0.2 in the AutomationBench venv, 200 s; 2026-10-21, after the review fixes).

## Limits and open items

- **No arm has run.** `agent-H`, `wf-H` and the other arms need the shared stream runner (`stream.mjs`) and the
  `bridge.py` `abr-*` commands of RECURRING-DESIGN §3.7; neither exists yet. `harness.py` is the in-process $0 path for
  code solvers. `gen.py` already writes the per-trigger `serve-inputs.jsonl` rows that `bridge.py serve` takes.
  The shim's naive clock is local time. `harness.py` pins `TZ=UTC` in-process. Since 2026-10-21 each serve-input row
  also carries `info.tz = "UTC"`, and `bridge.py serve` and `replay` set the process time zone from it before the shim
  is installed (`pin_timezone`). Rows without `info.tz`, which includes every official AutomationBench task, keep the
  host's zone. `test_serve_process_is_pinned_to_utc` runs `bridge.py replay` under `TZ=Pacific/Auckland` and shows
  that a ticket's `updated_at` falls on the trigger minute only with the pin.
- **The second-reader fairness gate (§3.11 gate 6) is still open.** It needs a session that did not write this family.
  The reference and the generator share an author, so their agreement does not rule out a shared misreading of
  `POLICY.md`; they are independent only in code (a typed model versus strings through the tools). The 2026-10-21
  reviewer read POLICY.md against the generated cases and found no departure. It checked duplicate before not found,
  the exact sender address, Active-only holds, the §7 lift with no other Active row, and the §8 close of only
  `Verification Sent` requests at age 30 or more. That reading is recorded here as evidence, not as the gate.
- **Exactness: the oracle grades the stated contract** (tightened 2026-10-21; family.json `exactness`):
  - Ticket subjects and the `#privacy-ops` summary must match exactly.
  - Ticket tags must match exactly, in any order.
  - Request ID, Transition and Reference must match exactly. A Purged or Blocked Reference is a comma-separated set.
  - At must be the event's instant in a UTC spelling (`Z` or `+00:00`, a space for `T`, no seconds when they are 0).
  - Email subjects must match exactly after trimming their ends.

  The only case-insensitive comparison is the address rule that POLICY.md §3 states itself. The earlier tolerances
  are gone: lower-cased tags, collapsed whitespace, a trailing period on the summary, At to the minute, case-folded
  ids and `;` as a separator. A required email that was sent and then trashed or marked spam also no longer counts.
  `gates.py` makes each removed tolerance a mutant. The pre-fix oracle, including AutomationBench's own handlers,
  let 519 of those mutants through on 610–614 (History).
- **Trigger ids are opaque only to an arm that cannot read `gen.py`.** An id is the first 10 hex characters of a
  sha256 over the family, version, seed, difficulty and index. The seed range is small enough to brute-force the hash,
  so the sandbox (no repository access) is what keeps the seed hidden. The leakage gate checks that no payload or
  prompt names the seed, the trigger's position or the family.
- **AutomationBench API quirks an arm must get past** [code]:
  - Gmail `messages/send` takes `raw` (RFC 2822, base64url).
  - `values/{range}:append` takes a positional 2-D `values` array in header order (`impl/google_sheets.py:617-695`).
  - `PUT /tickets/{id}` replaces the whole tag list, so the old tags must be sent back; `PUT /tickets/{id}/tags` adds
    tags instead.

  These calls fail loudly or are visible in the tool result, so an arm can recover.
- **Not generated:** an email that verifies two requests, a verified requester whose Zendesk user is already gone, two
  users sharing an address, and several open requests for one address. POLICY.md says to escalate when it cannot
  decide; the reference escalates in these cases, but nothing tests it.
- **Trap rates** were tuned on practice and dev seeds before any arm ran. They are generator parameters, not results.
  `hold-still`, `no-id`, `repeat-reply`, `late-reply`, `spoof-colleague` and `wrong-id` are rare on 610–613 (1–3
  exposures each). They appear across 601–650.

## History

- 2026-10-15, first session: POLICY.md, family.json, gen.py, oracle.py, reference.py, controls.py (24), harness.py
  (adapted from `abr-ops-mailroom`), gates.py, tests and this README. Fixes made before any stream was used for a label:
  - the `email-body-no-id` mutant also scrubs `body_html`, because the send path fills both bodies;
  - the subject-spacing equivalent pads only the ends (see Limits);
  - the d2 base rates were lowered once (above);
  - the `text-search` control uses Zendesk search instead of fetching comments per ticket, because the per-ticket
    fetch exceeded the 49-step budget;
  - a d3 pre-seeded request at age 31–32 on Monday (day 30 on the weekend) broke the spec's "up to 29 days old". It was
    replaced by a late-entered postal request (`deadline-late`), which keeps the `>= 30` vs `== 30` trap;
  - the spoofed-verification test runs in rebased mode (see the controls note).

  The generator stays at version 1.0.0, because no stream from it has been used for any label.
- 2026-10-21, re-verification and one fix ($0, no model):
  - Reproduced first: 27 tests passed; `gates.py` exit 0; reference 131/131 on 610–614; every control row unchanged.
  - Gap: a pre-seeded blocked request was 8–25 days old on Monday, so none reached day 30 at a close, and a solver that
    also closes held requests passed 131/131 (an uncommitted probe). Fix: with a separate seeded draw (`r_held`, so every
    other draw of a stream is unchanged), a pre-seeded blocked request is 22 days older (30–47) with probability 0.5
    (hold lifted this week) or 0.8 (still held), at d2 and d3 only. The day close labels `deadline-held` when a request in
    `Blocked - Legal Hold` is 30 or more days old. POLICY.md §8.1 now says that requests in any other state, including
    `Blocked - Legal Hold`, are not closed (§3 already called a blocked request verified and open; the sentence removes
    the doubt). New control `close-held`: 120/131, 2/5 clean weeks; over 601–650 it fails 102 of 1,347 triggers. New
    test `test_held_requests_past_day_30_are_not_closed`.
  - Effect on the streams: trigger counts and kinds are unchanged; world0 changes in 36 of 50 weeks (a request date, and
    request ids, which follow request dates). The d2 trap share rises from 0.558 to 0.581 (601–650 mean), d3 from 0.809
    to 0.814. Reference: 1,347/1,347 and 50/50 clean weeks on 601–650, 809/809 rebased on 601–630, 210/210 (d1) and
    298/298 (d3) on 631–640. Mutation 3,249/3,249, specificity 838/838, unchanged.
  - An uncommitted ad-hoc probe tried ten more one-rule mistakes on 610–614; each failed where its rule applies:
    no Not Found email 119/131; no hold notice 123/131; verifying a request in any state 126/131; blocking at intake
    instead of sending a verification 123/131; Purged with an empty Reference 100/131; a CC on every email 65/131; an extra
    acknowledgement post 69/131; the summary without its date 106/131; the Verified row after the outcome row 100/131;
    closing held requests 120/131. Two policy-neutral variants passed 131/131: Verified and the outcome appended in one
    call with two rows, and terse email bodies that still name the Request ID.
- 2026-10-21, review fixes ($0, no model). A review ran scratch variants through `harness.run_stream` on 610–612 (77
  triggers). Each fix below has a regression test in `tests/test_gdpr.py`.
  1. *Tag case (medium).* Re-cased other tags passed 77/77, and so did `GDPR-PURGED`. The oracle compared tags as
     lower-cased sets, and AutomationBench's `zendesk_ticket_has_tag` does not catch a re-cased tag. The simulated
     API keeps each tag as sent. Tags now compare as an exact multiset, per trigger and in `end.tickets`. New mutants:
     `ticket-tag-case` and `ticket-other-tags-case`.
  2. *Prefix spacing.* `[GDPR Purged]   Subject` and a padded subject passed. Ticket subjects now compare exactly.
     New mutants: `ticket-prefix-spacing` and `ticket-subject-padded`.
  3. *Trashed sends.* An email that was sent and then moved to Trash in the same trigger passed. A sent message
     labelled TRASH or SPAM is now never the expected email, the envelope reports it, and `end.emails` misses it. New
     mutant: `trash-own-sent`.
  4. *Tolerances not in POLICY.md.* Choice: tighten the oracle, recorded in family.json `exactness`. The summary must
     be exact (§8.2), so a trailing period fails. At must be the event's instant in a UTC spelling, so 50 s later fails
     and another offset fails. Request ID, Transition and Reference are exact: the old oracle folded the case of the
     ids and of Transition, although §9 says "exactly as named". Reference separators must be commas. New mutants:
     `post-trailing-period`, `post-double-space`, `log-at-seconds`, `log-at-other-offset`, `log-request-id-case`,
     `log-request-id-padded`, `log-reference-case`, `log-transition-case` and `log-reference-semicolon`. The
     specificity equivalents changed with this: the transition-case and trailing-period variants are mutants now, the
     Reference reorder uses commas, and the equivalent solver writes exact transitions.
  5. *In-week hold lift.* No hold-lift purge on 601–650 consumed a Blocked row written during the same week. The new
     d2/d3 story `hold-lift-inweek` lifts the hold added this week after its request is blocked, with probability
     0.75, in weeks with two hold changes, so the spec's 1–3 a week holds. It uses its own seeded draw, scheduled
     after every other event. As a result, world0 and every other payload of 601–650 are byte-identical to before,
     apart from trigger ids (checked). The story appears on dev seed 611.
  6. *Host identity.* Payload trigger ids embedded the seed and index (`s613/t01`), and the system line named the
     family. Ids are now opaque hashes. The mapping to seed and index stays in the host-only `triggers.jsonl` and
     `truth.jsonl`. The system line is `standing automation`. The leakage gate checks that ids are unique and opaque,
     and that no payload or prompt names the seed, the position or the family.
  7. *UTC serve.* Each serve-input row now carries `info.tz = "UTC"`, and `bridge.py` `pin_timezone` applies it
     (Limits). The change is opt-in, so official task rows are unaffected. Gate 6 stays open.

  Before the fix, the pre-fix oracle passed every variant the reviewer reported on 611 (31/31 each: other-tags-upper,
  upper-tag, double-space, leading-space, trash-sent, post-period, at-later). It also let 519 of the new single-fault
  mutants through on 610–614. After the fix, every variant fails where its rule applies, and every mutant is killed.
  The generator stays at version 1.0.0, because no stream from it has been used for any label.
