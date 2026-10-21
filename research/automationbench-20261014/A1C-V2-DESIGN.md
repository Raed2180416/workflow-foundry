# A1-C v2: the spec as built, deviations, acceptance and the paid commands (2026-10-21)

*Development work on the devTrain split (PREREG-AB-v1 §5). Everything below was built and checked at $0: no model was
called. The numbers in §4 are in-sample development evidence (the recorded a1c-dev60-dn run, devTrain dev60, seed 21,
k = 1), not held-out evidence. Source of the spec: the orchestrator's "A1-C v2 implementation spec (final)", which
settles the design review and the two critiques; this file records what was built against it. **Revised the same
evening (second build, §0) after three adversarial reviews; §0 supersedes the first build wherever they differ.***

## 0. Second build: the review fixes (2026-10-21 evening)

Three reviews of the first build (`5559247`; workflow wf_3674d3bc-0a7: review:correctness, review:generic-only,
review:tests) found 3 blockers, 14 majors and about 30 minors. The orchestrator ruled on the open choices (a)-(l); every
blocker and major is applied below, and the cheap minors. Commits on `worktree-wf_3674d3bc-0a7-12` (base `c6a0bb0`,
not pushed): `c283e03` (runtime), `60a96ae` (replay tools), `2d9a20f` (a stats key and a regex name; no behaviour
change), `acf6651` (tests), `44e7cc5` (held-out rule, study, P1 chain, manifest tool), then this document with the B4
third look. Each behavioural fix has a test in `test/codeowned-v2-review.test.mjs` that fails on `5559247` (all 24 fail
there, checked by running the file against an archive of that commit).

**(a) One bridge for every compared pair.** PREREG-AB-v1 §2 froze `bridge.py` `285be4f5…`; main's bridge is now
`caf3ddd6…` (commit `2f02281`, `pin_timezone`). Tag **`a1c-v1` = `aada200`** (created; verified: the v1 manifest
recomputes there to `5622c9418c7467b79e234dae5fb48b38f41d4ea8fe044fa5ef0c68f9a109c74f` with the B2 config), and a
detached **pin worktree `/home/user/workflow-foundry/.claude/worktrees/a1c-v1-pin`** at that tag (`corpus` symlinked to
the main checkout's, which is not written). v1, A0, v1-M (and the optional A1) run from the pin; v2 and v2-M from this
branch. `git diff a1c-v1 HEAD` outside `harness/v2/`, `replay/`, `test/` and `research/` is `run.mjs`'s registration
lines only (and `.gitignore`), so bridge.py (`285be4f5…` on both), `src/`, `policy/`, `tool.mjs` and v1's harness are
byte-identical between the pin and v2. **Mercury roles:** `aada200` already runs `--node-models
ledger=mercury-3,checker=mercury-3` (the Mercury executor and registration predate it; `aada200..c6a0bb0` touches no
file under `experiments/autobench`, `src` or `policy`): nothing was ported. The pin reproduces `m3-a1c-dev60-dn`'s
recorded manifest **`ef5c3382…`** exactly (concurrency 2, its launch settings) and its runner sha `ea1dca70…`, so v1-M
from the pin is the configuration of the Mercury dev60 result. Hashes (`replay/manifest-hash.mjs`, which mirrors
run.mjs's remote-executor manifest line; `run.mjs --dry-run` cannot give a Mercury variant's hash):

| Arm | Checkout | Manifest (concurrency 3, CLI 2.1.306, `DISABLE_AUTOUPDATER=1`) |
|---|---|---|
| v1 | pin `aada200` | `5622c9418c7467b79e234dae5fb48b38f41d4ea8fe044fa5ef0c68f9a109c74f` |
| v1-M (ledger, checker = mercury-3; session tokens 300K, call tokens 100K) | pin | `fa6c2e45320ff5d986d5afe2b9d62c2f3720cb3f34138a604c4082d34236af7f` (`ef5c3382…` at concurrency 2) |
| A0 | pin | no harness manifest; runner `run.mjs` sha256 `ea1dca70628a80262430b0d693d013fab456aebccefaac9e48db9713d4c87c5f` |
| A1 (optional) | pin | `2db80fd19db60a78547b9f383654fcf4034c7b488c001676412b3bb313083a9b` |
| v2 (preSendLint false, before P0) | this branch, review-fix commits | `c8c4f418dd4e82b53a8b34a1df430c7b72aa9d00cf5b9952fd7abab9d77b0384` |
| v2-M (before P0) | this branch | `78d4940b2b8b0da02b75398cc262e4a8c5b6bd17c9ad51052ef2e40259529527` |

v2 stays on this branch (base `c6a0bb0`, old bridge) and is **not rebased**: merging it into main later changes its
hash (bridge.py, run.mjs), so the frozen v2 hash belongs to the frozen branch commit, and any later devCheck look runs
from that commit, not from merged code (both hashes are to be recorded at that time).

**(b) Held-out list: PREREG-AB-v1-AMEND-1 look 2.** The first build's `HELDOUT60-A1CV2.json` (list sha256 `28dcf4d3…`)
had no rule (the builder chose it) and took 18 of look 3's 23 tasks; it is **withdrawn** (deleted here; in git history).
AMEND-1 (DRAFT, branch `worktree-wf_630f3979-599-4`) produces look 2 by a committed seeded rule (`sequential.mjs
computePlan`, commits `3562d3ed`/`dac4ecdf`): devTrain minus the forced set (103), the AM-2 briefed tasks (11), look 1
(dev60, 35 non-forced) and every task a recorded run names (8), ordered per domain by `sha256('ab-seq-v1:' + task)`,
first 10 per domain. `replay/heldout-look2.mjs` re-implements the rule on this branch, re-derives the pool from the
main tree's runs, this branch's runs and the live root, and checks the result against the DRAFT plan: **identical**
(pool 83; list sha256 **`a8c1ed5c8b18606c97feb7fcdd83115eab8cbdffa6e7956d9ee6d9d0974e916f`** = the DRAFT's look-2 hash;
DRAFT plan `97cc2f8c…`). Adopted per AMEND-1 §6 (A1-C v2's held-out eval is look 2): `a1c-v2/HELDOUT-LOOK2.json`
(file sha256 `d007f99e…`). Look 3 (23 tasks) stays intact. Exposure check: in the earlier workflow's agent transcripts
the only look-2 task named in a tool call is `finance.cash_sweep`, in the first build's hash-freeze dry run, which
failed on the hash before preparing anything (no task content shown); the leakage scan (test 18) reads devTrain worlds
in code and prints counts only. **For the orchestrator:** AMEND-1 is still DRAFT; adopting its look 2 before the freeze
is what its §6 asks, and the plan must not be recomputed between now and P1 by a run on other unexposed tasks.

**(c) D21 KNOWLEDGE.** Five new KNOWLEDGE lines (13 in all) name every grader-tuned rule and threshold and cite D21:
the value-typing thresholds (clauseWords 9, clauseLenRatio 3, clauseMinChars 40, derivedAgreement 2, the sheet-wide
share, the containment length 80); the B4 targets and commits `2b52d5d`, `0de452b`, `a7ec52e`; the hand-written
operation-word lists of `build-effects.mjs` and its messaging rule; the 12 h load-stamp rule; and these review fixes
(made after reading reviews that cite B4 dev60 rows). The check-precision study is committed (l).

**(d) Observability from capability, not outcome.** `postconditions.mjs listedKinds`: a check is observable when the
first read LISTED its app and kind (an enumeration-plan listing that answered, even empty); look-ups by search term
do not count (the re-read does not repeat them). A listed-but-empty kind now FAILS a missing post (`channel_posted`),
record (`record_created`) or child (`child_created`); a kind never listed is null (`unobservable`); a kind the
bounded re-read did not reach is null (`notReread`, every check type, never a pass or a fail on missing evidence).
Children tie to their parent by an exact scalar field value only (no substring); a listing whose records name no parent
(events per calendar) makes `child_created` unobservable instead of passing any new record (this reverts the
`a7ec52e` loosening the correctness review flagged). Termination: `terminationDecision` returns a `category`
(`hard-fail`, `hard-undecided`, `advisory-fail`, `all-pass`, `no-checks`, …); with an undecided hard check the
reason is "all decided checks pass; N hard check(s) undecided", never "all checks pass"; the pipeline stats carry
`category` and `undecidedHard`. B4 re-run: §4 (pass 3) and the honest false-accept count.

**(e) Batches.** A batch with a refused call is refused whole (no call sent, no world step, exit 1 = "refused the
step", tool.mjs's contract); the identical resend sends every call once. Resends are recognised against earlier log
lines only, so `[m, m]` is `refuse, held`, then `resend, resend`. Tests: `e1` (decide), `e2` (the real client: a
mixed batch writes no request; the resend serves exactly 3 calls), `e3` (pipeline: each recipient gets exactly one
message).

**(f) Completeness literals.** Added only when an `asked_by` quote verifies in the item's OWN cited source, only as
hard values (never "may mention"), and never for a candidate whose record carries an address that is not one of the
item's recipients; a deciding value the item's own source asks for is no longer demoted.

**(g) P0 replay tool.** `ledger-replay.mjs`: run.mjs's waiting USD ledger (a call waits while others are in flight;
refused only when nothing is in flight and it still does not fit: then the run stops, exit 4); denominator tasks × K
always (180); `--resume` keeps finished rows and their spend; an environment fault is never scored (task recorded as
a fault, no new task starts, exit 3); timeouts are counted apart (and count as not parsed); every call's served model
is read back (`models`, L5 violations); node folders are named by task index. Tests `g1` (60 tasks, $0.075 reserved
per call, $1.5 cap: all complete, calls waited, 180/180), `g2` (fault, resume, timeouts), `g3` (a capped task stays in
the denominator).

**(h) Degraded readers.** Support is counted over the readers that answered: majority = floor(n/2)+1 with n = readers
whose reply yielded a ledger, at least 1 (2 of 3 when all answer, as before). The brief says how many answered. The
re-ask goes only to a reader whose reply completed but did not parse (a timeout or a budget stop would fail again) and
needs 10 minutes left. Tests `h1`–`h4` (one reader, failed re-ask, all three failing in parallel, timeouts).

**(i) Lint activity.** The gated client logs a `loaded` line per invocation that loads gate.json; the act node's gate
row reports `active: false` when the session reached the world and nothing loaded (fail-open made visible), `loaded`,
`held`, `worldSteps` and the installed client's sha256. The gate is installed only with at least one rule; a leftover
gate.json is removed first; a send past the refusal limit gets a stderr note. **If P0 turns the lint on, run a 1-task
paid smoke with it on first** (§5).

**(j) Mapped checks.** A mapped check whose value list is empty after the majority split is advisory (`hardValue:
false`), for every positive type; one shared `applyMapped` serves the pipeline and the replay tools (B4 and P0 now
measure the pipeline's own mapping step). Test `j1` drives a scripted mapping reply through `runPipeline`.

**(k) Caps** that let every arm finish (run.mjs starts a task only if spent + reserved + $0.75 ≤ cap; with 3 in flight
the last task needs about expected spend + $2.25): §5.

**(l) The check-precision study** is committed in `a1c-v2/precision/` (report, labels, derived inputs, scripts; the
3.6 MB world replays are left out and re-derivable).

**Effect-table messaging gap.** The hand-written list of 19 messaging operations is gone. `build-effects.mjs
MESSAGING_RULE` classifies every operation from its index description by one stated rule (§2 M2), recorded in
effects.json. New: `recruitee.mailbox.messages.create`, `xero.invoices.email`, `quickbooks.{invoice,estimate,salesreceipt}
.send`, `wave.invoices.send` (email), `zoho_desk.tickets.comment`, `freshdesk.tickets.notes.create` (reply, they may
reach the requester); internal notes are their own channel `note` (not outgoing): `intercom.conversations.note` (which
shares the reply path; calls are told apart by the schema's pinned body constant `message_type: "note"`) and
`helpscout.conversations.note`. No earlier operation lost its channel. A send that also creates a record keeps the
record's kind (`creates`).

**Minors applied:** gate only with rules; client sha in the gate row; leftover gate.json; capped-send note; harm
compared on the paired task set (not comparable, exit 1, when sets differ); lint replay fails on missing tasks; P0
folders by index; DEV_ONLY (run.mjs runs assertDevOnly even with `--harness-hash`); freeze command on a simple task;
absolute paths; brief no longer says which checks are unobservable; parent kinds dropped only when named next to their
child; an unresolved channel is no channel (never the target's first word); an e-mail item without an app goes to Gmail
only when Gmail is connected; deciding values asked for are kept; the act session keeps back 4 responses when single
pass (checker 1 + AM-1 drift 3; H3 still holds: about 6 + 40 + 1 + 3 ≤ 50). **Left open:** §7.

## 1. What v2 is and how it is selected

- **Selection.** A separate harness id: `node experiments/autobench/run.mjs --harness codeowned-v2 ...` (harness version
  `a1c-v2`, arm label `A1-C v2 (code-owned harness)`; `--scripted stub` runs the $0 stand-ins). The only shared file that
  changed is `experiments/autobench/run.mjs`, and only by its registration lines (one usage comment line and the
  `codeowned-v2` entries of `PIPELINE_HARNESSES` and `PIPELINE_STUBS`).
- **v1 is untouched.** The 23 non-runner files of the v1 manifest, `harness/codeowned-stubs.mjs` and
  `test/codeowned.test.mjs` are byte-identical to tag `a1c-v1` (= `aada200`; test 20). On this branch v1's hash is
  `b37c2626…`, because `run.mjs` is in the v1 manifest. **Run v1 (and A0, v1-M, A1) from the pin worktree at
  `a1c-v1`** (§0 a), where it recomputes to `5622c941…`. *(The first build said "run v1 from main": wrong. Main's
  bridge.py changed in `2f02281`, so v1 on main recomputes to `78056793…` and aborts; review:correctness blocker 1.)*
- **Pipeline.** inventory → K = 3 ledger readers (official system prompt as `<system>`, pointer `system`) → one re-ask
  when ≥ 2 readers fail to parse → merge, settle, adjudicate → value typing → app-faithful checks → mapping call →
  act (optionally with the pre-send lint) → one check round (code + checker; instrumentation) → stop ("single pass").

| File (all new, under `experiments/autobench/harness/v2/`) | Role |
|---|---|
| `codeowned.mjs` | pipeline, config, manifest, KNOWLEDGE; imports v1's audit, stop, accounting helpers and act prompt |
| `inventory.mjs` | v1's node + clock, load-stamp-free dates (date note), calendar fix, `col_<n>`, single-token terms |
| `ledger.mjs` | v2 prompt, JSON repair, fragment quotes, typed negatives, entity-key merge, best-match alignment, value typing over the ledger (`typeLedger`), brief rendering |
| `literals.mjs` | value typing (slot / clause / quoted / email / id / number / date / short), tolerant comparison, slot filling |
| `postconditions.mjs` | app-faithful compile from the effect table, new check types, tolerant evaluation, unobservable = null |
| `checker.mjs` | brief, single-pass termination, check round with unobservable checks skipped |
| `effects.json` + `build-effects.mjs` | effect table generated from `tools/api/schemas/index.txt` + `<app>.jsonc` (build time only) |
| `gate.mjs` + `tool-gated.mjs` | pre-send lint: host side (gate.json, log read-back) and the gated client |
| `codeowned-stubs.mjs` | $0 stand-ins (v1's, re-pointed; the session stub passes `args.env`) |

Developer tools (never imported by a harness module; test 17): `experiments/autobench/replay/` — `playback.py` (moved
from the check-precision study), `lib.mjs`, `replay-gate.mjs` (B4, and `--lint` for P0), `ledger-replay.mjs` (P0,
paid unless `--scripted`), `harm.mjs`, `devtrain-literals.py` (test 18), `heldout-look2.mjs` (the held-out rule, §0 b),
`manifest-hash.mjs` (any checkout's manifest hash, Mercury variants included, §0 a).

## 2. Mechanisms as built

**M1 single pass.** `PIPELINE_DEFAULTS.maxRounds = 0`. `terminationDecision` (v2/checker.mjs) returns
`single pass (repairs off): N hard check(s) fail` when hard checks fail, "all decided checks pass; N hard check(s)
undecided" when none fails but some is null, "no checks", or "all checks pass" only when every check was decided and
passed; every decision carries a `category` (§0 d). The repair branch is kept with v1 semantics for `maxRounds > 0` and
is not part of the evaluation. The brief's check heading says no second session follows. Round row and pipeline stats
carry `nullHard` and `notReread`; each `check-N.json` entry carries `observable` and `notReread`.

**M2 effect table and app-faithful compile.** `effects.json` has 758 rows (every line of `index.txt`, 47 apps, index
sha256 `8c6b364b1dc5ede439aa92b928156c44679e632857e3df930fd9ee21f3fc5069`, corpus commit `4a8e1061…`, each `.jsonc` sha256
recorded). `effect` from METHOD + the operation's last token; `kind` the singularized resource token; `parent` for creates
on a sub-collection under a non-account `{param}`; `channel` from `MESSAGING_RULE` over every operation's index
description (S = the first sentence, D = the whole description; first match wins): **sms** S sends an SMS or text
message; **chat** S sends a message to a channel; **dm** S sends a direct message; **email** S sends/delivers/dispatches
an e-mail, draft, campaign, invoice, estimate or receipt, or starts "Email a(n)"; **esign** S dispatches an envelope;
**social** S publishes, queues/creates/shares/schedules a post, or adds/uploads a photo or video to a page, feed or
profile; **reply** S posts/sends/appends/writes/attaches a reply or response, or D says "visible to the requester";
**note** S names an internal or private note, annotation or comment (not an outgoing message). 29 operations have a
channel (27 outgoing). Operations sharing one METHOD + path are told apart by the request field the schema pins to a
constant (`bodyIs` / `bodyIsNot`). Compile: Slack posts → `slack_posted` (a member → that member's im channel); another app with
a social/chat/sms/dm operation → `channel_posted`; any other message → `judged`; never Slack or Gmail for another app.
Kinds come from the table (case-insensitive, singular/plural; a kind named in the target wins, then the first named after
a create verb); a create on an existing record of the parent kind → `child_created`. List fields pass on membership, text
over 80 characters on containment. A check on an app with no non-probe listing (except google_sheets) is
`{pass: null, evidence: 'unobservable'}` with no checker call; below that, observability is decided per kind from what the
first read listed (`listedKinds`, §0 d), and a kind the re-read did not reach is null "not re-read".

**M3 value typing.** `literals.mjs valueType` with the frozen thresholds (clauseWords 9, clauseLenRatio 3, clauseMinChars 40).
A literal is hard only when it is an accepted type, verified (or a slot filled from the record), and both the item and
the field have majority support (or the field was adjudicated); derived values need ≥ 2 agreeing readers. Majority is
counted over the readers that answered (§0 h). Completeness literals (identifying values of majority-eligible candidates
of a message item) are added only when an `asked_by` verifies in the item's own cited source, only as hard values, and
never for a candidate whose record carries another recipient's address (§0 f).
Co-occurrence (record and row checks), sheet-wide values (≥ 50 % of ≥ 3 row checks of one spreadsheet → one check),
number and date tolerance, machine timestamps shown as dates to write in words (with the record's own rendering).
Distinct reader values group by normalized number or day.

**M4 content constraints.** Readers type negatives (`scope` effect/content, `limits`, `leave_out`, `asked_by`). A content
negative attaches to the positive it limits as `exclusions`, never forms a polarity conflict, and adjudication never
supersedes a content-limited positive. Standing rule: a content negative whose rule source is `system` excludes the
identifying values of the item's candidates that are out by majority with a verified rule source (not recipients, not
values a source asks to name). Exclusions with majority support compile to `bodyNot` on messages, `row_not_exists` on
sheets, `record_unchanged` on records; a ban that overlaps an in-scope identifying value or a hard positive literal is
dropped; a hard `gmail_not_sent` on a required recipient is dropped and logged (`satisfiability.json`); ineligible
candidates become recipient bans only when the item's recipients are drawn from the candidates. Pre-send lint
(`preSendLint`, **off by default until P0**): `gate.json` (mode 0444) in the act session's read-only step-guard directory,
`tool-gated.mjs` copied over `tool.mjs`, `AB_GATE_DIR` in the session environment, `.tools/gate-log.jsonl` read back with
`O_NOFOLLOW` and a 1 MiB cap into `gate-log.json`; at most 1 refusal per (rule, recipient) and 2 per session; an
identical resend passes; a refusal writes no request file (no world step); a batch with a refused call is refused whole;
installed only with ≥ 1 rule; `loaded` lines and `active` on the host (§0 e, i).

**M5 business time and entity keys.** With `--date-note`, `buildInventory` records `clock {t0, t1}` and record dates
skip values with a time of day in `[t0 − 12 h, t1 + 5 min]`; the source map keeps `shownText` without them, and "today"
quotes and the host-date `shown()` test use it; the brief says "not established: take it from the request and the
records' business dates (not their system timestamps)" when no today verifies. Merge: entity keys (pointers, row ids,
addresses, `@handles`, id-like tokens); both keyed → must share a key (addresses: equal sets); one keyed → never;
neither → v1's word rule; each reader's items align with the merged items by best match. Without the date note,
inventory dates and business text are v1's.

**Ride-alongs.** JSON repair of unescaped inner quotes; one re-ask (`ledger-1b`) when ≥ 2 of 3 readers fail, only for a
reply that completed unparsed and with ≥ 10 minutes left; `…`/`...`
quotes verified fragment by fragment in one source; no "Not rules" line (`LEDGER.json` has `unsupportedNegatives`);
recipients multi-valued; calendar lists under `calendars`; `col_<n>` cells; single-token proper nouns (cap 10).

**Prompts.** Ledger prompt and mapping prompt per the spec §4 (system block and typed negatives; "in the requirement's own
app", `channel_posted`, `child_created`); `LEDGER_SYSTEM`, `ADJUDICATE_SYSTEM`, `adjudicatePrompt`, `CHECKER_SYSTEM`,
`checkerPrompt` unchanged (imported from v1). Brief headings and tails per §4. Gate refusal text per §4 (see deviation 2).

**Configuration.** `PIPELINE_DEFAULTS` = v1's values with `maxRounds: 0` plus the §5 keys (`preSendLint: false`) and,
since the second build, `singlePassReserveResponses: 4` and `reaskMinMsLeft: 600000`. `DEV_ONLY = true`.
`codeownedConfig` adds `gate: {envVar: 'AB_GATE_DIR', client: 'harness/v2/tool-gated.mjs'}`. KNOWLEDGE = v1's four lines +
four v2 lines (the second names the index sha256 and the messaging rule) + five D21 lines (§0 c). The v2 manifest adds
`harness/v2/effects.json` and `harness/v2/tool-gated.mjs` to v1's rule (33 files).

## 3. Deviations from the spec (all deliberate; each has a test)

1. **Selection by harness id** (`codeowned-v2`), not a `--harness-version` flag (the spec left the choice open).
2. **Batch refusals** (second build): a batch with a refused call is refused whole; the note says "No call of this batch
   was sent. Remove it and send the batch again; if the message must contain it, run the identical command again: every
   call will be sent once." *(First build: only the violating call was refused and the rest sent, so the natural identical
   resend duplicated them; review:generic-only major 3.)*
3. **Restatement clause guard.** "≥ 60 % of the statement's words" applies to literals of ≥ 5 words (a 3-word subject can
   share 60 % of a short statement's words).
4. **Alternatives** need alternatives of ≥ 2 letters each (`N/A` stays a value).
5. **Load stamps** are values with a time of day (ISO datetime, epoch, chat ts); a date without a time is never a stamp.
6. **Co-occurrence** also keeps computed values agreed by ≥ 2 readers (they are not record values).
7. **Exclusions in the brief and in `bodyNot`** need majority support; the overlap guard ("banned literal dropped if part
   of an in-scope identifying value or a hard positive literal") applies to every exclusion, not only standing ones.
8. **App-faithful beyond posts**: an e-mail item for another app is `judged` unless that app posts itself (no re-routing to
   Gmail); a row added in another app than the spreadsheets is a record of that app; a record check whose pointer is in
   another app than the item's is `judged`.
9. **Kind-level unobservability** (second build): decided from what the first read listed (listing capability), never
   from the outcome: a listed-but-empty kind fails; a never-listed kind is null; a kind the re-read missed is null "not
   re-read". *(First build: decided partly from the after-read, so a listable-but-empty kind could never fail.)*
10. **The "deliverable noun" rule** (soft only in the spec) is not implemented: it would only add brief text.
11. **Completeness literals** (second build): only when the item's own source asks, only hard, never another recipient's
    record (§0 f). *(First build: every eligible candidate's value was added, hard on any verified asked_by, else "may
    mention".)*
12. **Re-ask node** is `ledger-<k>b` for the first failed reader k (`ledger-1b` when reader 1 failed).
13. **Mapped checks** keep only values a majority of readers wrote as hard literals; a mapped `record_field` is hard only
    when its value matches a majority field; a mapped positive check with no majority value left is advisory (second
    build).
14. **Tag `a1c-v1` = `aada200`** (created in the second build, verified by the v1 manifest hash) and the pin worktree;
    test 20 compares against `a1c-v1`.
15. **B4 alignment is automatic** (replay/lib.mjs `alignScore`, a port of the study's autoalign rule) for both columns;
    the study's v1 figure (97 aligned hard false rejects) came from hand labels, so the B4 v1 column is recomputed with
    the same automatic rule. B4 makes no checker call (judged checks stay undecided) and rebuilds the initial inventory
    with v2 code from the served initial world (the recorded run's inventory clock marks load stamps).
16. **P0 tool details**: `ledger-replay.mjs` uses the recorded inventories (spec) unless `--inventory v2`; "wrong
    entity" and "wrong value" are automatic proxies (hard checks aligned with no assertion; hard checks aligned by entity
    only whose values match none of the aligned assertions'), to be reviewed by hand. A $0 run (`--scripted`, stub
    readers) over all 60 recorded tasks completes with 0 errors and finds the 121 failing scored assertions of the
    recorded final grades (the coverage denominator).
17. **B4 second look.** The scoring pass is reported as the B4 result; the kind fix that followed it and the re-run
    are declared in §4 (the fix was found by reading the pass's rows, so the second look is not an independent pass).
    *Correction (review:correctness minor 14): the second look did change an evaluation rule: `a7ec52e` also let
    `child_created` pass any new record of the kind when the listing never names a parent (false accepts 33 → 34). The
    second build removes that loosening (§0 d).*
19. **B4 third look** (second build): B4 re-run once after the review fixes, as the orchestrator ordered (§4, pass 3).
    The fixes were written from the reviews, which cite B4 dev60 rows; the third look is in-sample, disclosed under D21,
    and no threshold changed.
18. **Harm** definitions are automatic (replay/harm.mjs header). On the recorded v1 run `a1c-dev60-dn` they total:
    duplicates 37, removals 0, extra messages 39, containers 0, read flips 0.

## 4. Build acceptance ($0)

- **B1 tests (second build, every file of `experiments/autobench/test/` run alone with `nice -n 15 node --test
  --test-concurrency=1`):** autobench 16/16, codeowned-remote 3/3, codeowned (v1, unchanged) 20/20, harness 18/18,
  roundtrip 6/6, secondreader 10/10, split 3/3, token-meter 5/5, codeowned-v2 27/27, **codeowned-v2-review 24/24**:
  132 pass, 0 fail, 0 skipped. The 24 review tests all fail when run against an archive of `5559247` (the first build).
  First build: `experiments/autobench/test/codeowned-v2.test.mjs`: 27 tests, 27 pass, 0 skipped (§6 items 1–21 plus
  the replay tools; end-to-end and leakage tests use the venv, present here). Existing autobench files, each run alone with `nice -n 15 node --test --test-concurrency=1`:
  autobench 16/16, codeowned-remote 3/3, codeowned (v1, unchanged, incl. the A0/A1 byte-identity test) 20/20, harness
  18/18, roundtrip 6/6, secondreader 10/10, split 3/3, token-meter 5/5: 81 pass, 0 fail, 0 skipped.
- **B2 v1 hash.** At tag `a1c-v1` (`aada200`, the pin worktree; second build; on main the first build checked it
  before main's bridge changed): `5622c9418c7467b79e234dae5fb48b38f41d4ea8fe044fa5ef0c68f9a109c74f`
  with the B2 config (model claude-haiku-5-5, effort null, budget 0.75, timeout 20, maxSteps 50, tools [Bash], det record,
  k 1, concurrency 3, dateNote true, cli "2.1.306 (Claude Code)", childEnv DISABLE_AUTOUPDATER=1 only).
- **B3 scripted run.** `node experiments/autobench/run.mjs --harness codeowned-v2 --scripted stub --tasks
  simple.email_sf_contact_phone_update --domains simple`: clean (no violation, no error; nodes inventory, ledger×3, act,
  check-0).
- **B4 code-side replay gate** (`node experiments/autobench/replay/replay-gate.mjs --concurrency 2`; dev60, the recorded
  reader, adjudication and mapping replies recompiled by v2, round-0 worlds rebuilt with `playback.py` — 0 mismatched
  steps over 60 tasks — and served for the v2 re-read; automatic alignment for both columns; no checker call). The
  scoring pass ran once at commit `0de452b` with the thresholds frozen beforehand. Its rows showed one compile defect
  (a kind named with its parent: "a calendar event" compiled to a new calendar, unobservable, and the brief described the
  wrong record); it was fixed in `a7ec52e` and B4 was re-run once as a **declared second look** (no threshold or rule
  changed). Results (`runs/a1c-v2-b4/pass1.json`, `pass2.json`: totals and per-task counts, no world content):

  | Measure at round 0 (21 of 60 worlds pass the grader) | v1 (recorded verdicts) | v2 pass 1 (`0de452b`) | v2 second look (`a7ec52e`) | Target | Met |
  |---|---|---|---|---|---|
  | Aligned hard false rejects | 48 (hand labels: 97) | **5** | **5** | ≤ 25 | yes |
  | Unaligned hard false rejects | 77 | 18 | 18 | report | |
  | Hard false accepts | 30 (hand labels: 28) | **33** | **34** | ≤ 28 | **no** |
  | Passing worlds rejected | 13 | **3** | **3** | ≤ 3 | yes |
  | Clause or slot literals shown as copy-exactly | — | 0 | 0 | 0 | yes |
  | Checks compiled to another app than the item's | — | 0 | 0 | 0 | yes |
  | Failing worlds accepted (of 39) | 18 | 32 | 31 | report | |
  | Hard checks undecided (null), all unobservable | 0 | 33 | 24 | report | |
  | Accepted worlds with ≥ 1 null hard check | 0 | 12 | 9 | report | |
  | Hard checks / all checks | 372 / 618 | 321 / 658 | 321 / 658 | | |

  **B4 is not met: hard false accepts 34 > 28** (4 of 5 targets met). Hard false accepts by type (second look):
  gmail_sent 15, slack_posted 7, record_created 5, sheet_row 4, record_field 3 (v1: 15, 7, 5, 0, 3). The message checks
  that pass failing worlds are the same ones as v1's (weak: they carry the recipient but not the value the grader tests);
  the new ones are sheet_row checks whose values became soft under the per-literal rule. v2 trades rejection precision
  for weaker acceptance: failing worlds accepted rise from 18 to 31. With repairs off the round-0 verdict is
  instrumentation only (it changes no world), so this miss bears on the checks' reading, not on the act session; the
  orchestrator decides whether it blocks P0/P1. The three passing worlds still rejected: one item demands one message to
  two recipients that the work sent separately (hr), one demands e-mails to people the grader does not require
  (helpcrunch), one demands a tag (intercom). The brief's "today" changed in 13 tasks (v1 took a load-time stamp as
  today; v2 leaves it "not established").

  **B4 third look (second build, `60a96ae` runtime + replay tools; the same command, `--concurrency 3`; 60 tasks, 0
  errors, 0 mismatched steps; `runs/a1c-v2-b4/pass3.json`, counts only).** Declared (deviation 19); no threshold
  changed. The v1 column is unchanged (recorded verdicts).

  | Measure at round 0 (21 of 60 worlds pass the grader) | v1 | v2 second look | **v2 third look** | Target | Met |
  |---|---|---|---|---|---|
  | Aligned hard false rejects | 48 | 5 | **7** | ≤ 25 | yes |
  | Unaligned hard false rejects | 77 | 18 | **18** | report | |
  | Hard false accepts (a hard check passes, an aligned assertion fails) | 30 | 34 | **34** | ≤ 28 | **no** |
  | + undecided hard checks on a failing assertion (hidden false accepts) | 0 | (not counted) | **6** | report | |
  | **Honest hard false accepts** (the two rows above) | 30 | ≥ 34 | **40** | report | |
  | Passing worlds rejected | 13 | 3 | **3** | ≤ 3 | yes |
  | Failing worlds not rejected (of 39): clean / with an undecided hard check | 18 / 0 | 31 | **30: 24 / 6** | report | |
  | Hard checks undecided: unobservable / not re-read | 0 | 24 | **25: 25 / 0** | report | |
  | Clause or slot literals shown as copy-exactly; checks in another app | — | 0; 0 | **0; 0** | 0; 0 | yes |
  | Hard checks / all checks | 372 / 618 | 321 / 658 | **325 / 658** | | |

  **B4 is still not met: hard false accepts 34 > 28, and the honest count is 40.** Read plainly: v2's checks accept
  more failing worlds than v1's (40 hidden or visible false accepts against v1's 30; 30 of 39 failing worlds not
  rejected against 18), while rejecting far fewer passing ones (3 against 13). By type (third look): gmail_sent 15,
  slack_posted 7, record_created 4, sheet_row 4, record_field 4. What moved from the second look, task by task (all
  in-sample): `sales.advance_opportunity_stage` gained 4 hard checks because only 1 of its 3 recorded readers parsed and
  ruling (h) now counts support over the readers that answered (one more false accept, one true accept, two aligned
  false rejects); `operations.docusign_contractor_offboard`'s `record_created` (a card on a board the first read could
  not list) was a false accept and is now unobservable (counted in the honest total); four undecided checks are now
  classed as undecided on a failing assertion (the new class, same verdicts). The capability rule changed no
  other hard check's verdict on dev60's round-0 worlds (no listed-but-empty kind turned a null into a failure there), and
  no check was left "not re-read". With
  repairs off the round-0 verdict changes no world, so per the orchestrator's ruling the miss does not block P1; it is
  recorded as a failed pre-declared gate.
- **B5 leakage.** Test 18 (devTrain names, ≥ 16-character world strings excluding bare timestamps/numbers, 8-word prompt
  shingles) is clean over the v2 runtime files, the stubs, `build-effects.mjs` and the test file (the test file names
  the simple-domain task it runs; for it the name rule is devTrain names); since the second build `effects.json` is
  scanned for strings and shingles too, not only names. KNOWLEDGE and the index sha256 are recorded. The test-split
  scan is open (§7).

**Scripted smoke on devTrain tasks** ($0, stub nodes and sessions; not capability evidence), `--harness codeowned-v2
--scripted stub --date-note --concurrency 3`: finance.project_profitability, sales.qualify_lead and
support.intercom_multi_product_routing each ran inventory, ledger-1..3, act, check-0 (no repair, no checker needed), 0
audit violations, 0 errors, 4–5 model responses and 3–6 world steps per task, termination "all checks pass" (the stub
readers only extract e-mail items from the request, so the stub scores 0.333 / 0 / 0 partial credit: no capability
reading).

## 5. Paid commands (for the orchestrator; none was run here)

*Second build: replaces the first build's §5 (v1 "from main", `HELDOUT60-A1CV2.json`, caps that stop P2 and A1 early,
a held-out task in the freeze command).* Each paid run is launched detached from a script file (`setsid nohup bash
<file> > log 2>&1 &`); an environment fault (exit 3) waits 30 minutes and resumes with `--resume`, at most 6 times, and
is never scored; exit 4 (a cap) stops: a higher cap needs a decision. Mercury keys only inside the command that needs
them (`set -a; . /root/.config/foundry/inception.env; set +a`). Model ids from `policy/models.json` only.

```
WT=/home/user/workflow-foundry/.claude/worktrees/wf_3674d3bc-0a7-12          # v2 branch (base c6a0bb0, old bridge 285be4f5…)
PIN=/home/user/workflow-foundry/.claude/worktrees/a1c-v1-pin                 # detached at tag a1c-v1 = aada200
RUNS=$WT/research/automationbench-20261014/runs                              # repo copies land on the v2 branch, never in main
LIVE=/var/tmp/foundry-work/autobench
COMMON="--model claude-haiku-5-5 --date-note --concurrency 3 --budget 0.75 --timeout-min 20 --max-steps 50 --det record --k 1"
HELD=$(node -e 'process.stdout.write(require(process.argv[1]).tasks.join(","))' $WT/research/automationbench-20261014/a1c-v2/HELDOUT-LOOK2.json)
```
CLI 2.1.306, `DISABLE_AUTOUPDATER=1`, `FORCE_PROMPT_CACHING_5M` unset (the hashes in §0 a assume these).

**Caps (D22, +$40 for non-frontier dev arms; D18, Mercury ≤ 20M tokens).** run.mjs starts a task only if spent +
reserved + $0.75 ≤ cap, so with 3 in flight the last task needs about expected spend + $2.25. Expected spend from the
recorded dev60 runs (per 60 tasks): v1 $2.23 (with repairs; $1.70 without), A1 $2.37, A0 about $0.90, Haiku part of the
Mercury-planner arm $0.93 (+ about 61-71K Mercury tokens per task). Caps: **v1 $6, v2 $6, A0 $4, v1-M $4 + 5.5M tokens,
v2-M $4 + 5.5M tokens, P0 $2.5, P2 $6, A1 (optional) $6, lint smoke $1**: $33.5 of caps for P0 + the five arms + P2 (expected about
$9-10). Mercury tally (re-counted from run records): `PORT-PROBE.md` ledger 4.22M (smokes, probe, BUILDER-1,
`m3-a1c-dev60-dn` 2,709,413) + `m3-a1c-dev60-dn-fill` 970,606 + `effort-dose` ≤ 240K ≈ 5.4M (the orchestrator's 5.8M
includes runs not in these records); v1-M + v2-M expect about 8.6M and are capped at 11M: at most about 16.8M of 20M.

**P0 (in-sample, about $1.2).** From `$WT`:
```
P0=$LIVE/a1c-v2-p0-ledger
node experiments/autobench/replay/ledger-replay.mjs --model claude-haiku-5-5 --cap 2.5 --concurrency 3 --out $P0      # exit 3: wait, add --resume; exit 4: --resume, higher cap
node experiments/autobench/replay/replay-gate.mjs --lint --from $P0 --out $P0/lint.json                              # exit 1 if any task lacks compiled.json
mkdir -p $RUNS/a1c-v2-p0 && cp $P0/summary.json $RUNS/a1c-v2-p0/summary.json
```
(`compiled.json`, `brief.txt`, replies and `lint.json` hold world content: they stay live; `summary.json` holds counts.)
**Rules (frozen):** `summary.complete` true (no fault left, no task missing); `readers.parsedAfterReask` ≥ 177 of
`readers.of` = 180 (timeouts and failed or capped tasks count as not parsed; `parsedFirstPass` is reported too);
`models.violations` = 0 (every call served by claude-haiku-5-5); set `preSendLint: true` in `harness/v2/codeowned.mjs
PIPELINE_DEFAULTS` only if the lint replay over all 60 tasks yields ≥ 2 true refusals and ≤ 1 false refusal (every
refusal reviewed by hand); report `coverage` (v2 vs v1) and the proxies (`wrongEntity`, `wrongValue` must not
increase). Commit the P0 decision (turning the lint on also updates test 19's `preSendLint` assertion). **If the lint
is turned on:** a 1-task paid smoke with it on, on a dev60 task whose P0 compile has a lint rule (the first task listed
in `lint.json` refusals), from `$WT`: `node experiments/autobench/run.mjs --harness codeowned-v2 $COMMON --cap 1
--no-copy --tasks <that task> --run-id a1c-v2-lint-smoke`, and check the record's `pipeline.gate.active === true`
(`false` means the configuration never reached the client inside the sandbox: stop and fix before P1).

**Freeze the hashes** (after the P0 commit; the hash does not depend on the task):
```
cd $WT && node experiments/autobench/run.mjs --harness codeowned-v2 $COMMON --tasks simple.email_sf_contact_phone_update --dry-run --harness-hash 0   # "recomputed <V2HASH>"
node experiments/autobench/replay/manifest-hash.mjs --root $WT --harness codeowned-v2 --node-models ledger=mercury-3,checker=mercury-3                # <V2MHASH>
```
At the review-fix commits with `preSendLint: false` they are `c8c4f418dd4e82b53a8b34a1df430c7b72aa9d00cf5b9952fd7abab9d77b0384` and `78d4940b2b8b0da02b75398cc262e4a8c5b6bd17c9ad51052ef2e40259529527`.

**P1 (primary, held-out, look 2).** Launch `research/automationbench-20261014/a1c-v2/look2-chain.sh` (detached;
`V2HASH=… V2MHASH=…` in its environment). It checks that look 2 is still unexposed (`heldout-look2.mjs`, exit 1
otherwise; set `RELAUNCH=1` when restarting an interrupted chain), then runs, each with `$COMMON --no-copy --tasks
$HELD`: v1 (pin, `--harness codeowned --harness-hash 5622c941… --cap 6`), v2 (branch, `--harness codeowned-v2
--harness-hash $V2HASH --cap 6`), A0 (pin, `--cap 4`), v1-M (pin, `--node-models ledger=mercury-3,checker=mercury-3
--harness-hash fa6c2e45… --cap 4 --token-cap 5500000 --session-tokens 300000`), v2-M (branch, the same with
`$V2MHASH`). The optional A1 runs from the pin: `--harness foundry --cap 6` (manifest `2db80fd1…`). Membership: every
look-2 task is a devTrain task outside devCheck, test and dev60 (`heldout-look2.mjs` asserts it; v2 also refuses
non-dev tasks itself, `DEV_ONLY`; v1 given `--harness-hash` does not, which is why the chain checks first).
`--no-copy` keeps every per-task grade in the live directory; read only the aggregates (`summary.json` headline) until
every arm is graded, and do not read the chain log's per-task lines before then. **After:** copy each
`$LIVE/<run-id>/summary.json` to `$RUNS/<run-id>/`, then harm, paired (exit 1 when the runs do not hold the same
tasks):
`node experiments/autobench/replay/harm.mjs --run $LIVE/a1c-v1-look2 --run2 $LIVE/a1c-v2-look2 --out $RUNS/a1c-v2-look2/harm.json`
(and v1-M vs v2-M the same way).

**P2 (in-sample, dev60, about $1.8).** From `$WT`:
```
DEV60=$(node -e 'process.stdout.write(require("/var/tmp/foundry-work/autobench/a1c-dev60-dn/launch.json").tasks.join(","))')
node experiments/autobench/run.mjs --harness codeowned-v2 --harness-hash $V2HASH $COMMON --cap 6 --no-copy --tasks $DEV60 --run-id a1c-v2-dev60-dn
```

**Decision rule (frozen before P1; spec §8).** devCheck look 3 for v2 only if: strict pass v2 − v1 ≥ +3 on held-out
look 2 (paired; discordant pairs and exact McNemar), partial credit v2 − v1 ≥ −0.01, harm totals ≤ v1's (paired), mean
cost per task and mean responses ≤ v1's, H3 and L1–L5 clean, and, if Δdev60 (P2 − 20/60) > 0, Δheld-out ≥ Δdev60 / 3.
Otherwise record a negative result; v1 stays the candidate at devCheck 20/60. Also report v2 vs A0, v1-M vs v2-M (the
same rule, as a second comparison), per domain, the termination categories (`hard-undecided` acceptances apart from
`all-pass`), gate refusals, holds and resends. Under AMEND-1 (if frozen first) look 2's nominal levels apply as
co-primary tests beside this rule; this rule decides devCheck look 3.

**Merge order (spec §9).** Do not merge the `run.mjs` registration until every queued devCheck look and A0 run has
finished (it re-hashes the A1 manifest and A0's runner provenance). After a merge, v1 runs from the pin (`a1c-v1`), and
v2 from its frozen branch commit (a merge changes v2's hash: bridge.py and run.mjs are in its manifest). `src/executors/*`
and `src/models/*` are in the v1 manifest: an engine-bump edit there breaks v1 verification on main.

## 6. Errata (documentation only)

- `runs/DEV60-A0-A1.md` L135 gives manifest `a5440401…` for `a1c-dev60-dn`; that hash is `a1csp-smoke2`'s. The
  `a1c-dev60-dn` manifest is `5622c941…`.
- `runs/A1C-NEARMISS-20261021.md` says reading a message by id marks it read. In the simulator a GET does not
  (`automationbench/tools/api/impl/gmail.py:379-394`, `gmail_messages_get`); only a modify that removes `UNREAD` does
  (`:531-554`, `gmail_messages_modify`). v2 adds no read-marking anywhere (test 16).
- The overfit critique's corpus-wide phrase-count incident (aggregate counts only, no task named) needs the owner's
  decision on a PREREG §1.3 note.
- First build (§1, §5, report): "run v1 from main, where it still recomputes to 5622c941…" was false once `2f02281`
  changed main's bridge.py (v1 on main recomputes to `78056793…`); "no threshold or rule changed" in the B4 second look
  was false for `child_created` (deviation 17). Both corrected in the second build.

## 7. Known limits and unknowns

- B4 replays v1's recorded reader replies: they were written to v1's prompt, so content negatives, `asked_by` and the
  system block are absent there; their effect is measured only by P0 and P1.
- The gate's route matching uses the schema base URLs and path tails (host aliases sharing the last two labels); a call
  through an alias outside that rule passes unlinted (fail-open).
- Unobservable checks are null by design; acceptance with null hard checks is reported (`acceptedWithNullHard`,
  `failingWorldsUndecided`, termination category `hard-undecided`) and B4's honest false-accept count adds the null hard
  checks on failing assertions.
- **Open (second build), with reasons:**
  - *L2/L3 scans over test-task strings* (review:correctness 13): not run. They need test-split task contents read by
    code; this build may not open them. An authorized host-side count-only scan (strings and 8-word shingles of the test
    split against the 33 v2 manifest files, `effects.json` included) should run before devCheck look 3.
  - *The lint's state is agent-writable* (review:generic-only 11): refusal state and the host's counts come from
    `.tools/gate-log.jsonl` in the session's working directory. A host-side decision log needs the host to see calls
    before they reach the bridge (a bridge-side lint), a larger change; the `loaded`/`active` check (§0 i) makes a
    missing or bypassed lint visible but not a forged log. Disclosed; relevant only if P0 turns the lint on.
  - *The 12 h load-stamp window* (review:generic-only 10): kept (disclosed under D21). Narrowing it to "load time plus a
    margin" needs the world's load time, which the pipeline does not see (the bridge loads the world before the
    pipeline starts; prep and start are far apart at concurrency 3). It is active only with `--date-note`.
  - *P1 sealing* (review:generic-only 16): the pinned runner has no `--sealed` flag for dev tasks and adding one would
    change v1's runner hash; P1 uses `--no-copy` (no repo copy until every arm is graded) and the discipline of reading
    aggregates only; run.mjs still logs per-task grades to the chain log.
  - *App-less posts* (review:generic-only 17, partly fixed): an unresolved channel is no channel and an app-less e-mail
    goes to Gmail only when Gmail is connected; an app-less post still goes to Slack when Slack is connected, and the B4
    wrong-app metric still cannot see app-less items.
  - *Untested branches* (review:tests minor 11): `fit()` cutting a v2 brief and `maxRounds > 0` through the v2 pipeline
    (not part of the evaluation) still have no test; the lint inside the real CLI sandbox is covered only by the paid
    smoke (§5).
  - *H8 wording*: D21 reads H8 as "generic rules tuned on dev60 grades are allowed when disclosed"; the PREREG-AB-v1
    amendment text recording that reading is the orchestrator's to commit (not done here: main is read-only).
- The harm metrics are automatic definitions (§ replay/harm.mjs); "unrequested" read flips are listed for review, not
  decided.
