# A1-C v2: the spec as built, deviations, acceptance and the paid commands (2026-10-21)

*Development work on the devTrain split (PREREG-AB-v1 §5). Everything below was built and checked at $0: no model was
called. The numbers in §4 are in-sample development evidence (the recorded a1c-dev60-dn run, devTrain dev60, seed 21,
k = 1), not held-out evidence. Source of the spec: the orchestrator's "A1-C v2 implementation spec (final)", which
settles the design review and the two critiques; this file records what was built against it.*

## 1. What v2 is and how it is selected

- **Selection.** A separate harness id: `node experiments/autobench/run.mjs --harness codeowned-v2 ...` (harness version
  `a1c-v2`, arm label `A1-C v2 (code-owned harness)`; `--scripted stub` runs the $0 stand-ins). The only shared file that
  changed is `experiments/autobench/run.mjs`, and only by its registration lines (one usage comment line and the
  `codeowned-v2` entries of `PIPELINE_HARNESSES` and `PIPELINE_STUBS`).
- **v1 is untouched.** The 23 non-runner files of the v1 manifest, `harness/codeowned-stubs.mjs` and
  `test/codeowned.test.mjs` are byte-identical to `aada200` (test 20). On `main` the v1 manifest still recomputes to
  `5622c9418c7467b79e234dae5fb48b38f41d4ea8fe044fa5ef0c68f9a109c74f` with the B2 config (rechecked in the worktree
  before any edit). On this branch v1's hash is `b37c2626…`, because `run.mjs` is in the v1 manifest; this is the change
  the spec foresees (§9.3): **run v1 from `main` (or, after a merge, from a worktree at tag `a1c-v1`).**
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
paid unless `--scripted`), `harm.mjs`, `devtrain-literals.py` (test 18).

## 2. Mechanisms as built

**M1 single pass.** `PIPELINE_DEFAULTS.maxRounds = 0`. `terminationDecision` (v2/checker.mjs) returns
`single pass (repairs off): N hard check(s) fail` when hard checks fail; v1's reasons otherwise. The repair branch is kept
with v1 semantics for `maxRounds > 0` and is not part of the evaluation. The brief's check heading says no second session
follows. Round row and pipeline stats carry `nullHard`; each `check-N.json` entry carries `observable`.

**M2 effect table and app-faithful compile.** `effects.json` has 758 rows (every line of `index.txt`, 47 apps, index
sha256 `8c6b364b1dc5ede439aa92b928156c44679e632857e3df930fd9ee21f3fc5069`, corpus commit `4a8e1061…`, each `.jsonc` sha256
recorded). `effect` from METHOD + the operation's last token; `kind` the singularized resource token; `parent` for creates
on a sub-collection under a non-account `{param}`; `channel` hand-written for 23 messaging operations (email, chat, dm,
sms, social, esign, reply). Compile: Slack posts → `slack_posted` (a member → that member's im channel); another app with
a social/chat/sms/dm operation → `channel_posted`; any other message → `judged`; never Slack or Gmail for another app.
Kinds come from the table (case-insensitive, singular/plural; a kind named in the target wins, then the first named after
a create verb); a create on an existing record of the parent kind → `child_created`. List fields pass on membership, text
over 80 characters on containment. A check on an app with no non-probe listing (except google_sheets) is
`{pass: null, evidence: 'unobservable'}` with no checker call.

**M3 value typing.** `literals.mjs valueType` with the frozen thresholds (clauseWords 9, clauseLenRatio 3, clauseMinChars 40).
A literal is hard only when it is an accepted type, verified (or a slot filled from the record), and both the item and
the field have majority support (or the field was adjudicated); derived values need ≥ 2 agreeing readers. Completeness
literals (identifying values of majority-eligible candidates of a message item) are hard only with a verified `asked_by`.
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
identical resend passes; a refusal writes no request file (no world step).

**M5 business time and entity keys.** With `--date-note`, `buildInventory` records `clock {t0, t1}` and record dates
skip values with a time of day in `[t0 − 12 h, t1 + 5 min]`; the source map keeps `shownText` without them, and "today"
quotes and the host-date `shown()` test use it; the brief says "not established: take it from the request and the
records' business dates (not their system timestamps)" when no today verifies. Merge: entity keys (pointers, row ids,
addresses, `@handles`, id-like tokens); both keyed → must share a key (addresses: equal sets); one keyed → never;
neither → v1's word rule; each reader's items align with the merged items by best match. Without the date note,
inventory dates and business text are v1's.

**Ride-alongs.** JSON repair of unescaped inner quotes; one re-ask (`ledger-1b`) when ≥ 2 of 3 readers fail; `…`/`...`
quotes verified fragment by fragment in one source; no "Not rules" line (`LEDGER.json` has `unsupportedNegatives`);
recipients multi-valued; calendar lists under `calendars`; `col_<n>` cells; single-token proper nouns (cap 10).

**Prompts.** Ledger prompt and mapping prompt per the spec §4 (system block and typed negatives; "in the requirement's own
app", `channel_posted`, `child_created`); `LEDGER_SYSTEM`, `ADJUDICATE_SYSTEM`, `adjudicatePrompt`, `CHECKER_SYSTEM`,
`checkerPrompt` unchanged (imported from v1). Brief headings and tails per §4. Gate refusal text per §4 (see deviation 2).

**Configuration.** `PIPELINE_DEFAULTS` = v1's values with `maxRounds: 0` plus the §5 keys (`preSendLint: false`).
`codeownedConfig` adds `gate: {envVar: 'AB_GATE_DIR', client: 'harness/v2/tool-gated.mjs'}`. KNOWLEDGE = v1's four lines +
the four v2 lines (the second names the index sha256). The v2 manifest adds `harness/v2/effects.json` and
`harness/v2/tool-gated.mjs` to v1's rule (33 files).

## 3. Deviations from the spec (all deliberate; each has a test)

1. **Selection by harness id** (`codeowned-v2`), not a `--harness-version` flag (the spec left the choice open).
2. **Batch refusals.** For a refused call inside a multi-call batch the note ends "The other calls of this batch were sent;
   if the message must contain it, send this call again unchanged (without the calls already sent): it will be sent."
   Re-running the identical batch would duplicate the calls already sent. Identical-resend detection is per call.
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
9. **Kind-level unobservability**: `channel_posted` is null when the app's fresh read lists no post-like records
   (account-only listings), `record_created`/`child_created` null when the kind is never listed.
10. **The "deliverable noun" rule** (soft only in the spec) is not implemented: it would only add brief text.
11. **Completeness literals** skip a candidate who is the item's own recipient unless a source asks.
12. **Re-ask node** is `ledger-<k>b` for the first failed reader k (`ledger-1b` when reader 1 failed).
13. **Mapped checks** keep only values a majority of readers wrote as hard literals; a mapped `record_field` is hard only
    when its value matches a majority field.
14. **Tag `a1c-v1` was not created** (shared refs; this phase treats the main repository as read-only): test 20 compares
    against `a1c-v1` when it exists, else `aada200`. Create it with `git tag a1c-v1 aada200` before merging.
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
18. **Harm** definitions are automatic (replay/harm.mjs header). On the recorded v1 run `a1c-dev60-dn` they total:
    duplicates 37, removals 0, extra messages 39, containers 0, read flips 0.

## 4. Build acceptance ($0)

- **B1 tests.** `experiments/autobench/test/codeowned-v2.test.mjs`: 27 tests, 27 pass, 0 skipped (§6 items 1–21 plus
  the replay tools; end-to-end and leakage tests use the venv, present here). Existing autobench files, each run alone with `nice -n 15 node --test --test-concurrency=1`:
  autobench 16/16, codeowned-remote 3/3, codeowned (v1, unchanged, incl. the A0/A1 byte-identity test) 20/20, harness
  18/18, roundtrip 6/6, secondreader 10/10, split 3/3, token-meter 5/5: 81 pass, 0 fail, 0 skipped.
- **B2 v1 hash.** On `main` (worktree before any edit): `5622c9418c7467b79e234dae5fb48b38f41d4ea8fe044fa5ef0c68f9a109c74f`
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
- **B5 leakage.** Test 18 (devTrain names, ≥ 16-character world strings excluding bare timestamps/numbers, 8-word prompt
  shingles) is clean over the v2 runtime files, the stubs, `build-effects.mjs` and the test file (the test file names
  the simple-domain task it runs; for it the name rule is devTrain names). KNOWLEDGE and the index sha256 are recorded.

**Scripted smoke on devTrain tasks** ($0, stub nodes and sessions; not capability evidence), `--harness codeowned-v2
--scripted stub --date-note --concurrency 3`: finance.project_profitability, sales.qualify_lead and
support.intercom_multi_product_routing each ran inventory, ledger-1..3, act, check-0 (no repair, no checker needed), 0
audit violations, 0 errors, 4–5 model responses and 3–6 world steps per task, termination "all checks pass" (the stub
readers only extract e-mail items from the request, so the stub scores 0.333 / 0 / 0 partial credit: no capability
reading).

## 5. Paid commands (for the orchestrator; none was run here)

Common flags for every arm: `--model claude-haiku-5-5 --date-note --concurrency 3 --budget 0.75 --timeout-min 20
--max-steps 50 --det record --k 1`, CLI 2.1.306, `DISABLE_AUTOUPDATER=1`, `FORCE_PROMPT_CACHING_5M` unset.
`HELD=$(node -e 'process.stdout.write(require("./research/automationbench-20261014/HELDOUT60-A1CV2.json").join(","))')`
(run from the worktree; the list is committed here: sha256 of the compact sorted JSON
`28dcf4d322ceed9b2544ecdcf50bb13666b63c1dcde6867af8259a0e11b40ae1`; 60 in dev, 0 in devCheck, 0 in test, 0 overlap with
dev60, 0 in EXPOSURE dev.* lists, 0 in any earlier launch or run record — rechecked here).
`WT=/home/user/workflow-foundry/.claude/worktrees/wf_3674d3bc-0a7-12`, `RUNS=/home/user/workflow-foundry/research/automationbench-20261014/runs`.

**P0 (in-sample, ~$1.2).** From `$WT`:
```
P0=/var/tmp/foundry-work/autobench/a1c-v2-p0-ledger
node experiments/autobench/replay/ledger-replay.mjs --model claude-haiku-5-5 --cap 1.5 --concurrency 3 --out $P0
node experiments/autobench/replay/replay-gate.mjs --lint --from $P0 --out $P0/lint.json
mkdir -p $RUNS/a1c-v2-p0 && cp $P0/summary.json $RUNS/a1c-v2-p0/summary.json
```
(The per-task `compiled.json`, `brief.txt` and replies hold world content and stay in the live directory; `summary.json`
holds counts only. `lint.json` lists each refusal's literal for the hand review: keep it live.)
Rules (frozen): reader parse rate ≥ 177/180 (`summary.json readers`); set `preSendLint: true` in
`harness/v2/codeowned.mjs PIPELINE_DEFAULTS` only if the lint replay yields ≥ 2 true refusals and ≤ 1 false refusal
(review every refusal listed); report `coverage` (v2 vs v1) and the proxies (`wrongEntity`, `wrongValue` must not
increase). Commit the P0 decision, then **freeze the v2 hash**: from `$WT`, with the paid run's environment,
```
node experiments/autobench/run.mjs --harness codeowned-v2 --model claude-haiku-5-5 --date-note --concurrency 3 --budget 0.75 --timeout-min 20 --max-steps 50 --det record --tasks finance.cash_sweep --dry-run --harness-hash 0
```
fails with `harness hash mismatch: given 0, recomputed <V2HASH>`; `<V2HASH>` is the frozen hash. At this commit with
`preSendLint: false` (commit a7ec52e) it is
`7e8f63c37a3a8c5660f65b436ee240d7f5ce5f09b137e5c3ed1214d2b4ead969` (it changes with P0's decision and any later edit).

**P1 (primary, held-out, ~$5–6).** Check membership first (`--harness-hash` skips `assertDevOnly`).
```
# v1, from main (unchanged run.mjs; manifest 5622c941…)
cd /home/user/workflow-foundry && node experiments/autobench/run.mjs --harness codeowned --harness-hash 5622c9418c7467b79e234dae5fb48b38f41d4ea8fe044fa5ef0c68f9a109c74f --model claude-haiku-5-5 --date-note --concurrency 3 --budget 0.75 --timeout-min 20 --max-steps 50 --det record --k 1 --cap 4 --tasks $HELD --run-id a1c-v1-heldout60 --out $RUNS/a1c-v1-heldout60
# v2, from the worktree
cd $WT && node experiments/autobench/run.mjs --harness codeowned-v2 --harness-hash <V2HASH> --model claude-haiku-5-5 --date-note --concurrency 3 --budget 0.75 --timeout-min 20 --max-steps 50 --det record --k 1 --cap 4 --tasks $HELD --run-id a1c-v2-heldout60 --out $RUNS/a1c-v2-heldout60
# A0, from main
cd /home/user/workflow-foundry && node experiments/autobench/run.mjs --model claude-haiku-5-5 --date-note --concurrency 3 --budget 0.75 --timeout-min 20 --max-steps 50 --det record --k 1 --cap 2 --tasks $HELD --run-id a0-heldout60 --out $RUNS/a0-heldout60
# A1 (optional), from main
cd /home/user/workflow-foundry && node experiments/autobench/run.mjs --harness foundry --model claude-haiku-5-5 --date-note --concurrency 3 --budget 0.75 --timeout-min 20 --max-steps 50 --det record --k 1 --cap 2 --tasks $HELD --run-id a1-heldout60 --out $RUNS/a1-heldout60
```
Read only aggregates until every arm is graded. Harm (from `$WT`, on the live directories):
`node experiments/autobench/replay/harm.mjs --run /var/tmp/foundry-work/autobench/a1c-v1-heldout60 --run2 /var/tmp/foundry-work/autobench/a1c-v2-heldout60 --out $RUNS/a1c-v2-heldout60/harm.json`.

**P2 (in-sample, ~$1.8).** From `$WT`:
```
DEV60=$(node -e 'process.stdout.write(require("/var/tmp/foundry-work/autobench/a1c-dev60-dn/launch.json").tasks.join(","))')
node experiments/autobench/run.mjs --harness codeowned-v2 --harness-hash <V2HASH> --model claude-haiku-5-5 --date-note --concurrency 3 --budget 0.75 --timeout-min 20 --max-steps 50 --det record --k 1 --cap 2 --tasks $DEV60 --run-id a1c-v2-dev60-dn --out $RUNS/a1c-v2-dev60-dn
```

**Decision rule (frozen before P1; spec §8).** devCheck look 3 for v2 only if: strict pass v2 − v1 ≥ +3 on held-out
(paired; discordant pairs and exact McNemar), partial credit v2 − v1 ≥ −0.01, harm totals ≤ v1's, mean cost per task and
mean responses ≤ v1's, H3 and L1–L5 clean, and, if Δdev60 (P2 − 20/60) > 0, Δheld-out ≥ Δdev60 / 3. Otherwise record a
negative result; v1 stays the candidate at devCheck 20/60. Also report v2 vs A0 and A1, per domain, `nullHard`
acceptances, gate refusals and resends.

**Merge order (spec §9).** Do not merge the `run.mjs` registration until every queued devCheck look and A0 run has
finished (it re-hashes the A1 manifest and A0's runner provenance); tag `a1c-v1` at `aada200` first; after a merge, run
v1 from a worktree at that tag. `src/executors/*` and `src/models/*` are in the v1 manifest: an engine-bump edit there
breaks v1 verification on main.

## 6. Errata (documentation only)

- `runs/DEV60-A0-A1.md` L135 gives manifest `a5440401…` for `a1c-dev60-dn`; that hash is `a1csp-smoke2`'s. The
  `a1c-dev60-dn` manifest is `5622c941…`.
- `runs/A1C-NEARMISS-20261021.md` says reading a message by id marks it read. In the simulator a GET does not
  (`automationbench/tools/api/impl/gmail.py:379-394`, `gmail_messages_get`); only a modify that removes `UNREAD` does
  (`:531-554`, `gmail_messages_modify`). v2 adds no read-marking anywhere (test 16).
- The overfit critique's corpus-wide phrase-count incident (aggregate counts only, no task named) needs the owner's
  decision on a PREREG §1.3 note.

## 7. Known limits and unknowns

- B4 replays v1's recorded reader replies: they were written to v1's prompt, so content negatives, `asked_by` and the
  system block are absent there; their effect is measured only by P0 and P1.
- The gate's route matching uses the schema base URLs and path tails (host aliases sharing the last two labels); a call
  through an alias outside that rule passes unlinted (fail-open).
- Unobservable checks are null by design; acceptance with null hard checks is reported (`acceptedWithNullHard`).
- The harm metrics are automatic definitions (§ replay/harm.mjs); "unrequested" read flips are listed for review, not
  decided.
