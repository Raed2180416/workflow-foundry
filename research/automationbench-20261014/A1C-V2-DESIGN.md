# A1-C v2: the spec as built, deviations, acceptance and the paid commands (2026-10-21)

*Development work on the devTrain split (PREREG-AB-v1 §5). Everything below was built and checked at $0: no model was
called. The numbers in §4 are in-sample development evidence (the recorded a1c-dev60-dn run, devTrain dev60, seed 21,
k = 1), not held-out evidence. Source of the spec: the orchestrator's "A1-C v2 implementation spec (final)", which
settles the design review and the two critiques; this file records what was built against it. **Revised the same
evening (second build, §0) after three adversarial reviews; §0 supersedes the first build wherever they differ. Revised
again on 2026-10-22 (third build, §0.1) after two re-reviews; §0.1 supersedes §0 wherever they differ.***

## 0.1 Third build: the re-review fixes (2026-10-22)

Two re-reviews of the second build (`0a5c5ed`; workflow wf_0f3cd2be-450: **A** "correctness and tests", **B**
"generic-only, safety and statistics") found 2 blockers, 6 majors and 18 minors. Decisions taken since the second
build: **D25** (A1-C v2's P1 is look 2 of the frozen SEQUENTIAL-PLAN-v1), **D26** (Opus 5.5 xhigh reference arm
`a0o-look2-1` on the look-2 tasks), **D27** (the exploratory VL-1 arm on look 2, with a new Sonnet + A1 fork `a1s-look2`
and the `a1c-v1m-look2` rows of this chain). Commits on `worktree-wf_3674d3bc-0a7-12`: `b812e09` (the frozen plan files,
D25), `6e7bba7` (runtime), `5f26cea` (replay tools), `ce597d4` (tests), `59678e9` (P1 chain and rehearsal), `56f213f`
(this document), then follow-ups: the reference arm's repo copy recognised by the exposure check, a rehearsal
expectation, and the KNOWLEDGE exposure line (which changes v2's hashes: the table below gives both). The $0 chain
rehearsal passes 24/24 on the committed branch. Pin: **`b1e16e0`** (annotated tag `a1c-v1-look2`, branch `a1c-v1-pin-look2`) = `aada200` + the same frozen plan
files. Every behavioural fix has a test in `test/codeowned-v2-rereview.test.mjs` (rr1–rr17): run against an archive of
`0a5c5ed` with that file copied in, 14 fail, rr3 passes (it is coverage: the scripted path skips the launch guard; the
guard's teeth are rr1 and rr2) and rr6/rr17 skip (no plan file there).

| Finding | Fix | Test |
|---|---|---|
| **A B-1** v2-M could not launch (`run.mjs:258` wired executor roles into `codeowned` only) | `EXECUTOR_PIPELINES = [codeowned, codeowned-v2]` at both guards (for `--harness codeowned` they decide as before); `manifest-hash.mjs` now refuses an arm run.mjs would refuse; a 1-task paid v2-M smoke (below) | rr1 (a v2 launch with Mercury roles reaches the `--cap` and `--token-cap` checks, which name mercury-3), rr2, rr3 |
| **B B1 / A M-2** the P1 chain bypassed the frozen AMEND-1 (D23) | `look2-chain.sh` starts every arm through `sequential.mjs look 2 --exec` (sidecar, repo copy, no `--no-copy`); A0 once, as the control; v2 vs A0 is the confirmatory test, v2 vs v1 descriptive (§5); the frozen plan files are in both checkouts (outside every manifest: v1 still recomputes to `5622c941…`/`fa6c2e45…` at CLI 2.1.306 on the new pin commit) | the $0 rehearsal (`a1c-v2/rehearsal/rehearse-chain.sh`), rr17 |
| **A M-1** a P0 summary with a numeric `tasks` broke the exposure check | `ledger-replay.mjs` writes `taskCount`; the check reads only list-valued `tasks` | rr4 |
| **A M-3 / B M2** the look-2 exposure statement of §0 b was wrong | corrected below; a pre-registered sensitivity analysis without the six look-2 tasks whose request text was read (§5); the first-look ruling is the orchestrator's | (record) |
| **B M1** the P1 analysis was under-specified | `replay/look2-analysis.mjs` fixes it in code before any P1 call (§5); the repo copies hold `results.jsonl`, so the pairs are recomputable from git | rr17 |
| **B M3** completeness values from records owned by another person (by id or name) | a value only for a record that links to no person outside the item's recipients: its own address, or a record of the same app it references by id or by name (`ledger.mjs linkedAddresses`) | rr7 |
| A minor 1: a re-read cut by its step budget gave FAIL | the inventory records `notIssued` (listings the step budget or depth left unissued) and `paged` (a response naming a later page); `evaluate` returns "not re-read" for an absence on a cut kind; what was read still decides | rr8, rr9 |
| A minor 2: g1 flaky | costs priced from a counted dry pass so the last task's readers must wait | g1 (4/4 here) |
| A minor 3: pinned mapped checks made advisory | advisory only when nothing pins the check (no value, recipient, channel, parent, kind or spreadsheet) | rr10 |
| A minor 4: P0 resume lost faulted spend | every row records its settled spend over attempts (waiting for sibling calls still in flight at a fault); a resumed ledger starts at the total | rr16 |
| A minor 5: regression, Buffer and Facebook posts | a post is observable per kind its post operations create (`postKindsOf`); Buffer queues `update` records the read never lists; a Facebook post may be a photo | rr11; d1 and test 5 updated |
| A minor 6 / B minor 2: `RELAUNCH=1` did not resume | the chain is idempotent: a finished arm (live `summary.json`) is skipped, a started one resumed at its launch caps | rehearsal |
| A minor 7 / B minor 1: exposure check scope and file hash | `heldout-look2.mjs`: the frozen plan (`readPlan`, pinned hash), both list files, every root `sequential.mjs` scans, exemptions only for this plan's look-2 sidecar runs and the runs D26/D27 name as launched; the chain checks plan and list file shas in both checkouts before every arm | rr5, rr6 |
| A minor 8 | DRAFT hash corrected (§0 b); Zendesk public-comment disclosure (§7); v1-M cap note (§5) | — |
| B minor 3: A0, pin unverified | the chain asserts the pin commit, the pin's `run.mjs` `ea1dca70…`, `bridge.py` `285be4f5…` in both checkouts, the branch commit and the CLI before every arm; the new pin commit has an annotated tag | rehearsal |
| B minor 4: budget ceilings | `replay/look2-guard.mjs`: the chain's settled dollars against `D22_LEFT`, the D18 token ceiling per Mercury arm | rehearsal |
| B minor 5, 6: P1 label; L1–L5 | §5 | — |
| B minor 7: KNOWLEDGE incomplete | four KNOWLEDGE lines (17 in all, 9 citing D21) | rr15 |
| B minor 8: a held call sent on its own was resent with its batch | the gated client logs held calls sent since (`sent`); a batch that would send one again is refused whole and says which | rr12, rr13; e1, e2 updated |
| B minor 9: app-less routing | an app-less e-mail goes to Gmail only when Gmail is connected (an empty connected list is not "any"); an app-less post goes to Slack only when Slack is the one connected app that posts | rr14 |

**Disputed, with reasons.**
- *B minor 3, "make `a1c-v1` annotated":* an annotated tag can be moved as easily as a lightweight one (`git tag -f`);
  what protects the pairing is the chain's assertion of full commit SHAs and file hashes, now in place. `a1c-v1` is
  left as it is (other records cite it); the new pin commit carries an annotated tag.
- *B minor 10, "require two readers for a hard send item":* kept per ruling (h) and disclosed (§7). With repairs off a
  hard check labels the termination and feeds the optional lint; the actor sees the items either way, marked "found by
  1/1 readers". Demoting one-reader sends to advisory would leave every one-reader task without a send check.

**Exposure, corrected (A M-3, B M2).** §0 b said the only look-2 task named in the earlier workflow was
`finance.cash_sweep`. That was wrong. Verified by script over the transcripts (counts and booleans only; no task content
printed):
- The anatomy:finance agent ran `sed -n 16900,16925p domains/finance/tasks.py` (`agent-a93c5aca2fc488272.jsonl`,
  line 174). Its output (line 175) holds the definition header and the opening sentences of the request of look-2 task
  **`finance.intercompany_balance_recon`** (no assertion). That anatomy fed the v2 design. Re-review A reports that
  workflow `wf_3074014a-15b` read it too: a tool result in its `agent-ac010c67c029a1dab.jsonl` (line 387) names the task
  (its content not checked here). That workflow is the verifier lab (D27), not A1-C v2's development.
- The critic:overfit agent (`agent-a5bb498e6d19efd70.jsonl`) pickled every corpus task, assertions included (line 93),
  computed features from `initial_state` and the request texts over a 91-task "clean" pool that holds all 60 look-2 and
  all 23 look-3 tasks (line 166), and printed a 60-task list naming 38 look-2 and 18 look-3 tasks (line 167). Its
  aggregates (20 tasks with unread Gmail, 11 using apps the inventory cannot list, 6 apps never seen in dev60: buffer,
  canva, helpscout, jira, quickbooks, zendesk) went verbatim into the spec agent's prompt
  (`agent-ab38bfc39492f60a5.jsonl`, first event; it names no look-2 task). The spec's attention to those apps may stem
  from these aggregates; no per-task value or threshold from them is in the code (test 18: no devTrain task name, world
  string of ≥ 16 characters or 8-word prompt shingle in any v2 file).
- The need-router study ROUTER-1 used the request texts of 5 look-2 tasks (D25): `finance.qb_estimate_conversion`,
  `hr.recognition_nominations`, `sales.calendly_sequential_meetings`, `sales.dependency_chain`,
  `support.helpscout_customer_merge`. v2 does not use the need router.
- This fix (2026-10-22, about 02:30Z): while looking up the run-summary schema for the budget guard, the fixer printed
  the last 3 lines of the live log of the Opus reference arm `a0o-look2-1`: three look-2 task names
  (`operations.zoom_project_kickoff`, `sales.calendly_sequential_meetings`, `sales.cold_email_personalization`) with
  Opus's partial credit, pass and cost. At about 02:42Z, fixing the exemption of that arm's repo copy, the fixer also
  printed its aggregate (pass rate 26/60, mean partial credit 0.827). No harness behaviour changed after either: the
  last behavioural edit to `harness/v2/` and `run.mjs` is at 02:27:24Z, before the pin commit at 02:28:21Z; the only
  later edit to a manifest file is the KNOWLEDGE line recording this exposure (manifest text, no behaviour).
- **For the orchestrator (before P1):** AMEND-1's per-arm first-look rule asks whether an arm was "developed, tuned or
  probed" on a look's tasks. The fixer's reading: the request text of 6 look-2 tasks reached the v2 development record
  (1 by the anatomy overrun, 5 by ROUTER-1, which v2 does not use), and pool aggregates over a superset of looks 2 and 3
  reached the spec; no per-task value went into the code. Proposed: keep first look 2 for every A1-C arm, disclose all
  of the above in the P1 preregistration and AMEND-1 §2.2 disclosure 2 (which repeats §0 b's error), and read the
  pre-registered sensitivity analysis without the 6 tasks (§5) beside the confirmatory result. The ruling must be
  recorded before the first P1 call.

**Hashes (CLI 2.1.307 since the container restart at 02:06Z; `DISABLE_AUTOUPDATER=1`, `FORCE_PROMPT_CACHING_5M`
unset).** The CLI version is part of every harness manifest, so the 2.1.306 hashes of §0 a no longer launch:

| Arm | Checkout | Manifest at CLI 2.1.307 | At CLI 2.1.306 |
|---|---|---|---|
| v1 | pin `b1e16e0` | `5c452af09bb4df6853e2543c6f0e428738dbae811a62bceae04ac5c637d06de8` | `5622c941…` (as at `aada200`) |
| v1-M | pin | `c645c8e914a9de3b0ce23cfcf81ce12681ffec5a6e62742f87b3d0665427f167` | `fa6c2e45…` |
| A0 | pin | runner `run.mjs` `ea1dca70…` (unchanged) | same |
| v2 (preSendLint false, before P0) | branch, with the KNOWLEDGE exposure line | `716df33d5c892ceb5101c09011565f591b97bf6e199581fbce37a9eb4c7ff231` | `7a8faa85…` |
| v2-M (before P0) | same | `785093f577b9ce814c74fab20d5bb695c7fe98a47ede73e5a174df000b322ba7` | — |

(At `59678e9`, before the KNOWLEDGE exposure line: v2 `2b6197e0…`, v2-M `67f548c4…`; the v2-M smoke ran there.)

`bridge.py` is `285be4f5…` in both checkouts; the branch's `run.mjs` is `a93cd5da…` (registration and
`EXECUTOR_PIPELINES` lines; test 20). P0 may change v2's hashes (`preSendLint`); the P0 step refreezes them and records
`V2COMMIT`.

**v2-M smoke (paid, 1 dev60 task, in-sample; run id `a1c-v2m-smoke-1`, `--no-copy`, cap $1, token cap 400K,
02:3xZ).** From this branch at `59678e9` with `--harness codeowned-v2 --node-models ledger=mercury-3,checker=mercury-3`
and the §5 flags at concurrency 1: the launch passed both guards; the three ledger readers ran on mercury-3 (62,812
Mercury tokens in all), adjudication, mapping and the act session on claude-haiku-5-5; 9 model responses, no audit
violation, no session or harness error, no environment fault; $0.0128. The task was graded (in-sample: not evidence). The
check round decided every hard check in code, so the **checker role on mercury-3 was not exercised** by this smoke (no
judged check needed it); v1-M's dev60 runs exercised it through the same dispatch.

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

*(Superseded by §0.1: the pin is now `b1e16e0` = `aada200` + the frozen plan files, and the CLI is 2.1.307.)*

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
DRAFT plan `756d7d3a…`, as `HELDOUT-LOOK2.json` records; `97cc2f8c…` was the `dac4ecdf` DRAFT). Adopted per AMEND-1 §6 (A1-C v2's held-out eval is look 2): `a1c-v2/HELDOUT-LOOK2.json`
(file sha256 `d007f99e…`). Look 3 (23 tasks) stays intact. *Exposure check (WRONG, corrected in §0.1):* "in the earlier
workflow's agent transcripts the only look-2 task named in a tool call is `finance.cash_sweep`, in the first build's
hash-freeze dry run, which failed on the hash before preparing anything (no task content shown)". The leakage scan
(test 18) reads devTrain worlds in code and prints counts only. **For the orchestrator:** AMEND-1 was still DRAFT then (FROZEN since, D23; D25 makes P1 its look 2); adopting its look 2 before the freeze
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
  changed is `experiments/autobench/run.mjs`: its registration lines (one usage comment line and the `codeowned-v2`
  entries of `PIPELINE_HARNESSES` and `PIPELINE_STUBS`) and, since the third build, `EXECUTOR_PIPELINES` (executor-model
  roles are wired into `codeowned` and `codeowned-v2`; for `--harness codeowned` the guards decide as before; test 20).
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
`manifest-hash.mjs` (any checkout's manifest hash, Mercury variants included, §0 a; it refuses an arm run.mjs would
refuse), and since the third build `look2-analysis.mjs` (the P1 analysis, §5) and `look2-guard.mjs` (the chain's D22 and
D18 guards).

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

## 5. Paid commands (for the orchestrator; none was run here but the 1-task v2-M smoke of §0.1)

*Third build: replaces the second build's §5 (re-review B B1: its chain bypassed the frozen AMEND-1; D25 makes P1
look 2 of the frozen plan).* Each paid run is launched detached from a script file (`setsid nohup bash <file> > log 2>&1
&`); an environment fault (exit 3) waits 30 minutes and resumes with `--resume`, at most 6 times, and is never scored;
exit 4 (a cap) stops: a higher cap needs a decision. Mercury keys only inside the command that needs them (`set -a; .
/root/.config/foundry/inception.env; set +a`). Model ids from `policy/models.json` only.

```
WT=/home/user/workflow-foundry/.claude/worktrees/wf_3674d3bc-0a7-12          # v2 branch (base c6a0bb0, old bridge 285be4f5…)
PIN=/home/user/workflow-foundry/.claude/worktrees/a1c-v1-pin                 # b1e16e0 (tag a1c-v1-look2) = aada200 + the frozen plan files
RUNS=$WT/research/automationbench-20261014/runs                              # v2 and v2-M repo copies; v1, v1-M and A0 land in $PIN's runs/
LIVE=/var/tmp/foundry-work/autobench
COMMON="--model claude-haiku-5-5 --date-note --concurrency 3 --budget 0.75 --timeout-min 20 --max-steps 50 --det record --k 1"
```
`DISABLE_AUTOUPDATER=1`, `FORCE_PROMPT_CACHING_5M` unset. **The CLI version is part of every harness manifest:** 2.1.307
since the 02:06Z restart (the §0.1 hashes); every arm records it, and the chain refuses to start an arm under a CLI other
than the one the hashes were frozen at (A0 has no harness hash, so this check is what keeps it on the same CLI).

**Caps (D22, D18).** run.mjs starts a task only if spent + reserved + $0.75 ≤ cap, so with 3 in flight the last task
needs about expected spend + $2.25. Expected per 60 tasks from the recorded dev60 runs: v1 $2.23 (with repairs; $1.70
without), A0 about $0.90, the Haiku part of a Mercury-ledger arm $0.93 (+ 61–71K Mercury tokens per task; the v2-M smoke
used 63K). Default caps: **v1 $6, v2 $6, A0 $4, T3 $4, v1-M $4, v2-M $4**; minimum caps (expected + $2.25): $4.5, $4.5,
$3.2, $3.2, $3.2, $3.2. **D22's +$40 is shared** with the Sonnet-planner control (`a1csp-dev60-38`, $7.47 settled), D27's
VL-1 (`a1s-look2`, cap $10, and its judge, about $1), P0, P2 and the smokes. The P0 step tallies what is left for the
chain and passes it as `D22_LEFT`; before every new arm the chain lowers the arm's cap to `D22_LEFT` minus what the chain
has settled, and stops (exit 5) below the arm's minimum. **Mercury (D18, 20M):** before every Mercury arm the chain
tallies the Mercury tokens of every run under `$LIVE` (`replay/look2-guard.mjs mercury`: 4.97M on 2026-10-22 with the
smoke) plus `MERCURY_OTHER` (the D18 ledger's use outside these run records, from the P0 step's re-tally: the
PORT-PROBE probes and BUILDER-1, the official-protocol `m3-official-dev60`, effort-dose, ROUTER-1's 319 calls with no
usage recorded at an upper bound), and gives the arm min(5.5M, 20M − tally − other − 1M reserve), stopping (exit 6)
below 4.5M. v1-M expects about 4.3M (71K per task on the heavier part) plus 0.6–0.9M held by tasks in flight: 5.5M is
tight but adequate (re-review A minor 8). A resumed arm keeps its launch caps (run.mjs only lets a resume raise them).

**P0 (in-sample, about $1.2).** From `$WT`:
```
P0=$LIVE/a1c-v2-p0-ledger
node experiments/autobench/replay/ledger-replay.mjs --model claude-haiku-5-5 --cap 2.5 --concurrency 3 --out $P0      # exit 3: wait, add --resume; exit 4: --resume, higher cap
node experiments/autobench/replay/replay-gate.mjs --lint --from $P0 --out $P0/lint.json                              # exit 1 if any task lacks compiled.json
mkdir -p $RUNS/a1c-v2-p0 && cp $P0/summary.json $RUNS/a1c-v2-p0/summary.json
```
(`compiled.json`, `brief.txt`, replies and `lint.json` hold world content: they stay live; `summary.json` holds counts
and writes `taskCount`, never a numeric `tasks`; every row records its settled spend, and `--cap` is a hard total across
resumes.) **Rules (frozen):** `summary.complete` true (no fault left, no task missing); `readers.parsedAfterReask` ≥ 177
of `readers.of` = 180 (timeouts and failed or capped tasks count as not parsed; `parsedFirstPass` is reported too);
`models.violations` = 0 (every call served by claude-haiku-5-5); set `preSendLint: true` in `harness/v2/codeowned.mjs
PIPELINE_DEFAULTS` only if the lint replay over all 60 tasks yields ≥ 2 true refusals and ≤ 1 false refusal (every
refusal reviewed by hand against the recorded dev60 grades: KNOWLEDGE names this decision); report `coverage` (v2 vs
v1) and the proxies (`wrongEntity`, `wrongValue` must not increase). Commit the P0 decision (turning the lint on also
updates test 19's `preSendLint` assertion). **If the lint is turned on:** a 1-task paid smoke with it on, on a dev60 task
whose P0 compile has a lint rule (the first task listed in `lint.json` refusals), from `$WT`: `node
experiments/autobench/run.mjs --harness codeowned-v2 $COMMON --cap 1 --no-copy --tasks <that task> --run-id
a1c-v2-lint-smoke`, and check the record's `pipeline.gate.active === true` (`false` means the configuration never reached
the client inside the sandbox: stop and fix before P1).

**Freeze** (after the P0 commit; the hash does not depend on the task):
```
cd $WT && node experiments/autobench/run.mjs --harness codeowned-v2 $COMMON --tasks simple.email_sf_contact_phone_update --dry-run --harness-hash 0   # "recomputed <V2HASH>"
node experiments/autobench/replay/manifest-hash.mjs --root $WT  --harness codeowned-v2 --node-models ledger=mercury-3,checker=mercury-3   # <V2MHASH>
node experiments/autobench/replay/manifest-hash.mjs --root $PIN --harness codeowned                                                     # <V1HASH>
node experiments/autobench/replay/manifest-hash.mjs --root $PIN --harness codeowned --node-models ledger=mercury-3,checker=mercury-3     # <V1MHASH>
git -C $WT rev-parse HEAD                                                                                                            # <V2COMMIT>
bash $WT/research/automationbench-20261014/a1c-v2/rehearsal/rehearse-chain.sh                                                       # $0; must pass on V2COMMIT
```
Before P0 (CLI 2.1.307) they are `716df33d…`, `785093f5…`, `5c452af0…`, `c645c8e9…` (§0.1).

**P1 = look 2 of SEQUENTIAL-PLAN-v1** (plan `3cd586bd…`, list `a8c1ed5c…`, 60 devTrain tasks, 10 per domain; **dev
split, disjoint from dev60: development evidence under D21, not held-out test evidence**; run.mjs labels these runs
"development/diagnostic"). After the P1 preregistration commit and the orchestrator's first-look ruling (§0.1), launch
`research/automationbench-20261014/a1c-v2/look2-chain.sh` detached with `V1HASH V1MHASH V2HASH V2MHASH V2COMMIT CLI
MERCURY_OTHER D22_LEFT` (and `T3=1` to run the A/A check) in its environment. Every arm starts through `sequential.mjs
look 2 --plan SEQUENTIAL-PLAN-v1.json --role … --arm … [--first-look 2] --exec -- --run-id … <the arm's run.mjs
options>` of the checkout it runs from, so it carries the `sequential-look.json` sidecar and its repo copy
(`results.jsonl`, `summary.json`) lands in that checkout's `runs/` (a look run may not pass `--no-copy`):

| Order | Arm | Checkout | Role, `--arm` | First look | Run id | Options |
|---|---|---|---|---|---|---|
| 1 | v1 | pin | treatment, `A1-C` | 2 | `a1c-v1-look2` | `--harness codeowned --harness-hash $V1HASH` |
| 2 | v2 | branch | treatment, `A1-C v2` | 2 | `a1c-v2-look2` | `--harness codeowned-v2 --harness-hash $V2HASH` |
| 3 | A0 | pin | **control**, `A0` (the only control run) | — | `a0-look2` | — |
| 3a | T3 (optional) | pin | treatment, `A0 (T3 A/A)` | 2 | `a0-look2-aa` | — |
| 4 | v1-M | pin | treatment, `A1-C (Mercury ledger and checker)` | 2 | `a1c-v1m-look2` | `--harness codeowned --node-models ledger=mercury-3,checker=mercury-3 --harness-hash $V1MHASH --session-tokens 300000` |
| 5 | v2-M | branch | treatment, `A1-C v2 (Mercury ledger and checker)` | 2 | `a1c-v2m-look2` | `--harness codeowned-v2 --node-models … --harness-hash $V2MHASH --session-tokens 300000` |

Before every arm the chain checks: the pin is at `b1e16e0` with no tracked change, its `run.mjs` is `ea1dca70…`,
`bridge.py` is `285be4f5…` in both checkouts, the branch is at `V2COMMIT` with no tracked change, both checkouts hold the
same plan and list files (file sha256 `56e8d3cf…`, `85099131…`), the CLI is `$CLI`, at least 1 GB is free, and
`replay/heldout-look2.mjs` passes: no look-2 task appears in any run outside this plan's look-2 sidecar runs and the runs
D26 (`a0o-look2-1`) and D27 (`a1s-look2`) name, as launched. It is idempotent: an arm with a live `summary.json` is
skipped, an arm with a `launch.json` is resumed at its launch caps. After the last arm it writes harm (paired, v1 vs v2
and v1-M vs v2-M) and the analysis to `$RUNS/a1c-v2-look2/`. Membership: every look-2 task is a devTrain task outside
devCheck, test and dev60 (`sequential.mjs` asserts it for every look run; v2 also refuses non-dev tasks itself,
`DEV_ONLY`). The optional A1 (pin, `--harness foundry`) is not part of this chain.

**Analysis (fixed before any P1 call: `replay/look2-analysis.mjs`; test rr17).**
1. *Inputs:* the repo copies only (`results.jsonl`, `summary.json`, `sequential-look.json` of each run, read through
   `sequential.mjs verifyLookRuns`: a run without a matching sidecar, or with another arm name, is refused). No live
   directory or log line is read for the analysis.
2. *Outcome rules, the same for every arm* (`sequential.mjs loadOutcomes`, PREREG-AB-v1 §6.3): a task row with a fault
   flag is not an outcome (the arm is resumed until none remains; a fault is never scored); a row without a final grade
   and without a fault scores 0 and is listed; the grade is the row's final grade. A comparison with an arm that lacks an
   outcome for any look-2 task is reported as incomplete, not computed.
3. *T3* (AMEND-1 §4), read first when `a0-look2-aa` exists: A0 against A0, exact two-sided McNemar, descriptive.
4. **Confirmatory (the only test that spends α):** A1-C v2 (treatment, first look 2) against A0 (control) at look 2 of the
   plan, `sequential.mjs analyzeLooks`: strict pass by exact McNemar at the look-2 nominal level **0.0180** with the
   3-point floor; partial credit at 0.0180 only after strict pass is rejected (D23); the comparison stops only on strict
   pass. If nothing is rejected, look 3 (23 tasks, cumulative 83, nominal 0.0443) follows under the plan.
5. *Descriptive (no α of the plan; exact two-sided McNemar with the discordant pairs and p, partial credit by paired
   sign-flip, never a claim):* **v2 vs v1** first (the work item's development question), then v2-M vs v1-M, v2-M vs v2,
   v1-M vs v1, and each harness arm vs A0; per domain; termination categories (`hard-undecided` apart from `all-pass`);
   gate refusals, holds, resends and duplicates; cost per task and tokens per model.
6. *Sensitivity, pre-registered:* every comparison again without the 6 look-2 tasks whose request text reached the
   development record (§0.1: `finance.intercompany_balance_recon` and the 5 ROUTER-1 tasks).
7. *Reference arms, reported beside and never compared under the plan:* Opus 5.5 xhigh `a0o-look2-1` (D26) and VL-1
   (D27).
8. *Time of run:* the arms run back to back (v1, v2, A0, [T3], v1-M, v2-M), not interleaved; v2 sits next to both v1 and
   A0; other paid runs (the Opus reference arm, the OT-0 re-run, the SOP-Bench sealed run) share the account at the same
   time. The time-of-run confound (load, rate limits, model serving) is disclosed and not modelled.

**Development gate for devCheck look 3 (frozen before P1; spec §8; never a claim).** devCheck look 3 for v2 only if, on
look 2: strict pass v2 − v1 ≥ +3 (paired), partial credit v2 − v1 ≥ −0.01, harm totals ≤ v1's (paired), mean cost per
task and mean responses ≤ v1's, H3 clean, L1 (task names), L4 (sandbox) and L5 (transcripts) clean, and, if Δdev60 (P2 −
20/60) > 0, Δlook2 ≥ Δdev60 / 3. L2/L3 (test-split shingle and world-literal scans) are PREREG-AB-v1 §8 gates before a
test-split run, not before a dev look, so they are not part of this gate (re-review B minor 6). Under no effect "+3"
alone passes with probability 0.17–0.30 at 10–20 discordant pairs: it decides whether devCheck is worth spending, nothing
more. Otherwise a negative result is recorded and v1 stays the candidate at devCheck 20/60.

**P2 (in-sample, dev60, about $1.8).** From `$WT`:
```
DEV60=$(node -e 'process.stdout.write(require("/var/tmp/foundry-work/autobench/a1c-dev60-dn/launch.json").tasks.join(","))')
node experiments/autobench/run.mjs --harness codeowned-v2 --harness-hash $V2HASH $COMMON --cap 6 --no-copy --tasks $DEV60 --run-id a1c-v2-dev60-dn
```

**Merge order (spec §9).** Do not merge the `run.mjs` registration until every queued devCheck look and A0 run has
finished (it re-hashes the A1 manifest and A0's runner provenance). After a merge, v1 runs from the pin (`a1c-v1-look2`),
and v2 from its frozen branch commit (a merge changes v2's hash: bridge.py and run.mjs are in its manifest). `src/executors/*`
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
    code; this build may not open them. They are PREREG-AB-v1 §8 gates before a test-split run; an authorized host-side
    count-only scan (strings and 8-word shingles of the test split against the 33 v2 manifest files, `effects.json`
    included) must run before any test-split run of v2. The devCheck gate of §5 no longer requires them (re-review B
    minor 6).
  - *The lint's state is agent-writable* (review:generic-only 11): refusal state and the host's counts come from
    `.tools/gate-log.jsonl` in the session's working directory. A host-side decision log needs the host to see calls
    before they reach the bridge (a bridge-side lint), a larger change; the `loaded`/`active` check (§0 i) makes a
    missing or bypassed lint visible but not a forged log. Disclosed; relevant only if P0 turns the lint on.
  - *The 12 h load-stamp window* (review:generic-only 10): kept (disclosed under D21). Narrowing it to "load time plus a
    margin" needs the world's load time, which the pipeline does not see (the bridge loads the world before the
    pipeline starts; prep and start are far apart at concurrency 3). It is active only with `--date-note`.
  - *P1 sealing* (review:generic-only 16): superseded by D25. Look runs must keep their repo copies (AMEND-1: `analyze`
    reads them), so P1 is not sealed; the analysis is fixed in code before the first call (§5) and every arm's rows are
    committed. *(The second build said a seal was impossible without changing v1's runner hash: wrong. run.mjs exports
    `runTasks` and honours `opt.sealed` (`run.mjs:336` on the pin), so a wrapper outside every manifest could seal a run;
    moot under AMEND-1. Re-review B.)* run.mjs logs per-task grades to the chain log; nobody working on an A1-C arm reads
    those lines before every arm is graded (§0.1 records one slip, on the Opus reference arm's log).
  - *App-less posts* (review:generic-only 17; re-review B minor 9): fixed in the third build: an app-less post goes to
    Slack only when Slack is the one connected app that posts, an app-less e-mail to Gmail only when Gmail is connected.
    The B4 wrong-app metric still cannot see app-less items.
  - *Zendesk replies* (re-review A minor 8): `zendesk.tickets.update` with a public comment is Zendesk's reply path, but
    its index description does not say it sends a message, so under the stated messaging rule (§2 M2) it has no channel:
    a public reply made that way is not linted as a reply, and a check on it is judged, not checked as a message.
  - *A single answering reader is trusted* (re-review B minor 10; ruling h): with one of three readers answering, every
    item it writes becomes required (majority floor(1/2)+1 = 1), recipients included; the brief says "found by 1/1
    readers". Kept and disclosed (§0.1 gives the reason).
  - *Cut re-reads* (third build): "not re-read" now also covers a kind whose listing the re-read's step budget or depth
    left unissued, a listing cut at its cap and a response naming a later page; a pagination marker outside the generic
    list in `inventory.mjs morePages` is not recognised (the check then decides from what was read, as before).
  - *Untested branches* (review:tests minor 11; re-review A rows 20 and 26): `fit()` cutting a v2 brief, `maxRounds > 0`
    through the v2 pipeline (not part of the evaluation) and the re-ask node under `auditPipeline` still have no test; the
    lint inside the real CLI sandbox is covered only by the paid smoke (§5); the checker role on mercury-3 inside v2 was
    not reached by the v2-M smoke (§0.1).
  - *H8 wording*: D21 reads H8 as "generic rules tuned on dev60 grades are allowed when disclosed"; the PREREG-AB-v1
    amendment text recording that reading is the orchestrator's to commit (not done here: main is read-only).
- The harm metrics are automatic definitions (§ replay/harm.mjs); "unrequested" read flips are listed for review, not
  decided.
