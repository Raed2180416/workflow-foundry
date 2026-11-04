# Pre-registration: SWARM-R1 (swarm ladder, rung 1)

*Frozen 2026-11-04 before any paid call of this rung. Owner question D3: are Kimi-style agent swarms in scope? Research:
[DOSSIER-SWARM.md](DOSSIER-SWARM.md). Freeze record: [FROZEN-R1.json](FROZEN-R1.json) (sha256 of this file, of every
code file the run and the analysis execute, of the bed, of every task, the arm hashes, the CLI version and binary hash,
the policy). `node experiments/swarm/run-r1.mjs check` must pass before every paid stage; any change is an amendment
below, dated, before the stage it affects.*

**Question.** On a separable, breadth-bound task that one Haiku 5.5 call cannot solve, does a Haiku swarm (a lead that
decomposes at run time and fans out to Haiku workers) beat a single Haiku agent with the same tools and budget, and a
fixed workflow a Haiku builder wrote once at build time? What do the swarm's failures look like, and is a guarded swarm
(rung 2) worth building?

**Status labels.** W build probes (dev 365–367): development. Calibration (dev 368): dev/diagnostic, cost only, never a
capability claim. Held-out (test 9301–9310, d5, tier "novel-test"): held-out evaluation for this rung, fresh seeds used
once. This is not a sealed-bed run (`beds/sealed/` is not touched).

## 1. Beds and splits

- Bed `wbed-r6` v1.1.0 (W-BED-R6-NOTES), difficulty **5**: 400 documents (about 105K tokens inline), 18–22 compounds in
  scope, 24–29 plan candidates, 90–110 cells, an exact oracle (`oracle`: one row per in-scope compound and requested
  property, value exact at the stated precision, winning source exact, excluded set exact). Why d5: the one-call gate
  (need router M1, dev 379–390) passes there (0/12 at effort medium, 2/12 at none) and fails at d3 (6/12), and the
  one-call failures are coverage failures.
- At d5 the test split carries a test-date phrasing ("k days after the site visit of DATE") and a document kind
  ("Technical report") that no dev task carries; the dev split carries a sample log and conference abstracts instead.
  Every arm's builder or prompt sees only the rules, which name both kinds on both splits.
- Seeds: W build probes dev 365, 366, 367; calibration dev 368 (all in `wbed-dev`, tuning sub-range 349–372); held-out
  test 9301–9310 (clean test space ≥ 7200, no range reserved for `wbed-r6`; ledger row `swarm-r1-heldout` added in the
  same commit as this freeze). Only the first N held-out seeds run (§6.2).
- Decidability: the bed's text-only witness (`whiteboxSolve`) is checked against the oracle on every evaluated task;
  a task where they disagree is a grader fault (side "bed") for every arm.

## 2. Arms

All arms: model `claude-haiku-5-5` only (policy id), one trial per task (K = 1), the same task files, the same output
schema. Any message served by another model voids the trial (K11).

| arm | who decomposes | what runs per task | caps per task |
|---|---|---|---|
| **A** single agent (the simple baseline) | nobody | Claude Code headless, tools Bash/Read/Write/Edit/Glob/Grep (`b0Agent`), CLI default effort | $1.00 (`--max-budget-usd`), 30 min |
| **S** swarm | a model, at run time | A's session plus the built-in `Agent` tool; `CLAUDE_CODE_SUBAGENT_MODEL=claude-haiku-5-5` with `_FORCE=1`; at most 8 subagents at once, 32 per session, depth 1; `--forward-subagent-text`; A's prompt plus the frozen lead preamble (sha16 in FROZEN-R1.json) | the same $1.00 and 30 min for the whole session, workers included |
| **W** fixed workflow | code, at build time | `solve.mjs` written once by a Haiku 5.5 builder (`construct`, arm B1, effort high, 40 min, builder budget $1.00, construction model budget $0.40, 6 score checks, probes dev 365–367 at d5), run per task in the sandbox with only the model gateway (`b1Script`, Haiku only) | $0.40 gateway ledger (hard), 20 min |

- The lead preamble is task-agnostic (no R6 word, no coverage or verification instruction: those are rung 2's
  treatment) and follows Anthropic's delegation-brief elements: delegate only large independent parts, self-contained
  briefs (objective, exact items, every rule needed, compact JSON return, boundaries), parallel starts, the lead owns
  `answer.json`.
- W's build is part of the arm: a build that delivers no `solve.mjs` makes W answer nothing on every task (an outcome,
  `NO_ARTIFACT`, $0 per task). The built `solve.mjs` is used exactly as built (its sha256 is in the build record and is
  checked before every W trial); its construction cost is reported, amortised over the held-out tasks in cost per pass.
- Whether W's solver calls a model at all (a pure parser) is recorded and reported; it does not change W's scoring.
- No Opus arm: the W-bed prereg is an unfrozen draft that budgets no R6 run, and no R6 Opus reference workflow exists.

## 3. Measurements

Per trial: oracle pass (primary), oracle score, cells correct / cells, missing compounds, excluded set right; CLI-
reported cost (a killed session is charged at its budget bound; costUnknown marked); wall-clock; error code; models
served. Swarm only: workers, batches, the largest batch, critical steps (lead turns plus the slowest worker per batch,
Kimi K2.5), the CLI's `subagent_stats`, coordination codes K1–K11 (§8.2). W only: gateway calls, model-executed or
not. Every trial's raw record is archived outside the repository (transcript, answer, spawn tree, files written; W's
stdout, stderr and call log).

## 4. Power

N ≤ 10 paired tasks, K = 1. This rung is a pilot: an exact McNemar test reaches p < 0.05 only with at least 6
discordant pairs all one way. Pass rates are reported with Wilson 95% intervals and paired bootstrap intervals; no
comparison is called confirmatory unless McNemar p < 0.05. The oracle score difference (paired bootstrap) is the
secondary, more sensitive measure.

## 5. Analysis (`experiments/swarm/analyze-r1.mjs`, frozen)

1. **Complete blocks only.** A held-out task enters the comparison when A, S and W each have a recorded, non-void row
   on it. A void trial (K11 drift, or a hidden-path or repository-path access) removes its block; voids are reported.
2. **Capability table** per arm: pass k/N with Wilson 95%, mean score, cells correct, missing compounds, excluded set
   right, cost per trial and per pass (W with its construction cost amortised), median and maximum wall-clock, errors.
3. **Paired comparisons**: S vs A (primary), W vs A, S vs W: exact McNemar on pass; paired bootstrap (10,000
   resamples, seed `swarm-r1`) of the pass difference and of the score difference.
4. **Predictions written before the run** (§6 of the dossier):
   - P1 (Kim et al.): if A passes ≥ 45% of held-out tasks, S does not beat A.
   - P2 (Tran & Kiela; the d5 one-call failures are breadth failures): if A's failures are mostly compounds or cells
     whose documents A never saw, S's score exceeds A's.
   - P3 (bed notes §13): a W solver that is a pure parser fails the novel-test date forms; W's held-out pass rate is
     then at most A's.
   - P4 (MAST, Anthropic): at least a third of S's failed units carry a coordination code (K3, K5, K7) rather than a
     worker's judgment error.
5. **Ladder rule.** Rung 2 (the swarm plus Foundry guards: the plan's code coverage check `coverageIssues` and a code
   reducer that carries worker rows) is warranted if at least a third of S's failed units are coded K3, K5 or K7, or
   the carried-rows replay (§8.3) turns at least one failed S trial into a pass at $0. If S is at or below A on pass
   and score and coordination codes explain less than a third of S's failures, the result is "plain Haiku swarms add
   nothing on this bed"; rung 2 is then tested only as a guard on A's failure mode, not as a swarm.

## 6. Procedure

1. **Freeze** (this file, FROZEN-R1.json), commit, then the detached launcher (`experiments/swarm/launch-r1.sh`) runs:
   the W build and the A/S calibration in parallel, then W's calibration trial, then the held-out stage.
2. **N rule.** After calibration, with block cost c = A + S + W cost on dev 368 and s = the ledger so far:
   N = min(10, ⌊(8.00 − s − 0.50) / (1.25 c)⌋). If N < 4 the rung stops (exit 6) and needs an amendment. If a
   calibration session of A or S stops at its budget or time cap, both caps are raised together ×2, once, by a dated
   amendment before the held-out stage, and N is recomputed.
3. **Ledger.** One ledger over every stage: the capability probe ($0.0044), the build, every recorded and every
   faulted trial. Hard cap **$8.00 of Haiku**. A block (one task, all arms) starts only if 1.25 × the largest block
   cost seen (or c) fits under the cap; otherwise the stage stops with complete blocks only. Held-out blocks run two
   at a time.
4. **Faults.** A rate or session limit is an environment fault, not an outcome: the trial is not recorded, the
   launcher waits 30 minutes and resumes (at most 6 waits). A trial that ends in any other error is an outcome.
5. **Disk.** No stage starts with less than 1.2 GB free.

## 7. Kill rule and falsifiers

- The swarm claim "S beats A" is falsified on this bed if S's pass rate and mean score are both at or below A's.
- The claim "a swarm is cheaper or faster at equal quality" is falsified if S's cost per pass or median wall-clock is
  above A's while S's pass rate is not higher.
- Freeze mismatch, drift above one void per arm, or a decidability-witness disagreement stops the analysis from making
  any capability statement until resolved.

## 8. Root cause (every failure)

### 8.1 Units, traps, locus, side (`experiments/swarm/rootcause.mjs`)

Every failed trial is cut into error units: missing compound, extra compound, unknown entity, duplicate row, wrong
cell, missing cell, extra property, missing excluded document, extra excluded document. Each unit gets:
- **trap** (the bed trap it hit, from the world's construction): scope traps (alias by abbreviation or former name,
  code-only, the d5 date form, T1 tested before the cut-off, T2 quote-only, T3 retracted-only, T4 planned, T6 and
  namesake), cell traps by counterfactual (the bed's resolver re-run with one mistake on: retracted kept, superseded
  kept, non-standard, bounds, quotes, predictions, errata skipped, erratum cited, recency only, no unit conversion,
  concern voids, retraction by title, novel kind mis-ranked, another ranking policy), excluded-set traps (cascade of a
  missing or extra compound, void missed and why, not void). A unit no mistake reproduces is `unexplained`.
- **locus**: for A and the swarm's lead, whether a tool result ever showed the documents the unit needed, and the
  context size at that point; for S, whether any worker saw them and which coordination codes touch the unit; for W,
  the solver's calls and error.
- **side** (where the fix belongs, after "Model or Harness?"): `bed` if the decidability witness disagrees with the
  oracle on the task; `harness` if a limit ended the trial without an answer or the unit carries K3, K5 or K7;
  otherwise `model` (`search:not-seen` when the evidence never reached the model, `judgment:seen` when it did; for W
  `builder-code`).

Output: `research/swarm-20261021/ROOTCAUSE-R1.jsonl` (one line per trial, units included) and a written root cause per
failure class in the result document, with a fix hypothesis and, where possible, a $0 replay.

### 8.2 Coordination codes (`experiments/swarm/coord.mjs`, exact, by program)

K1 serial collapse (≤ 1 worker); K2 over-fan-out (> 32, or > 1.5× the plan candidates); K3 plan gap (a missing
in-scope compound no brief assigned by code, name or a document range holding its establishing test, no worker
returned and the lead never saw); K4 duplicate assignment; K5 aggregation loss (a worker returned the right row, no
worker disagreed, the answer lost or altered it); K6 worker error propagated (the answer's wrong row is a worker's) or a
worker ended in error; K7 conflict resolved wrongly; K8 write collision or a worker writing `answer.json`; K9 a limit
(timeout, budget, a subagent refused or killed); K10 premature termination (a worker never returned, or no answer);
K11 model drift (void). Each maps to MAST modes where MAST has one.

### 8.3 $0 replays

For every failed S trial: (a) the carried-rows replay (every worker row carried, majority per cell, the lead's own rows
elsewhere, the lead's excluded set) re-scored by the oracle; (b) the brief plan (every compound a brief names) checked
by the bed's `coverageIssues`: would rung 2's guard have flagged the missing compounds?

## 9. Cost

Hard cap $8.00 Haiku for the rung (probe, build, calibration, held-out, faults). Bounds: build $1.40; calibration block
$2.40; held-out block $2.40 (A $1.00 + S $1.00 + W $0.40). Expected far lower (Haiku list $0.10/$0.50 per MTok,
$0.50/$2.50 above 100K-token prompts; cache reads at a tenth). No Opus, Sonnet or Mercury in this rung.

## 10. Threats to validity

- N ≤ 10, K = 1: a pilot; within-task variance is not measured.
- One bed, one difficulty, a closed template grammar (a parser can solve it): a W built as a parser measures parser
  generalisation to the novel-test forms, not judgment.
- A shared machine and account: wall-clock includes contention and rate limiting; S's eight concurrent workers meet the
  same session limits as everything else.
- The CLI reports cost by its own price table; per-message usage is archived so cost can be re-priced (the 100K price
  step).
- The coordination coder reads worker rows from reports and written files in the shapes workers use; a row in an
  unrecognised shape is invisible to K5/K7 (it then shows as K3 or K6 at worst). Spot-checked by hand on every failed
  S trial.

## Amendments

FROZEN-R1.json holds the sha256 of this file as frozen (before any amendment); the rung-1 chain checked it before every
stage and ran unchanged. Amendments below are appended after the rung-1 chain ended (2026-11-04 18:44Z: 7 complete
held-out blocks, seeds 9301–9307, the §6.3 guard stopped before 9308 with $1.16 left; ledger $6.84).

### Amendment 1 (2026-11-04, after the rung-1 held-out stage ended, before any rung-1b call): rung 1b, exploratory

**Why.** In rung 1 the swarm lead never started a worker: 0 workers on the dev calibration task and on all 7 held-out
tasks (K1, serial collapse, on every S trial; the CLI's `subagent_stats.spawned` = 0). Its own closing text says it "did
the work myself with a script rather than delegating". So rung 1 compares A with "A plus an unused `Agent` tool and a
preamble"; it cannot say what a Haiku swarm does when it does swarm. Kimi K2.5 trains its orchestrator with a
parallelism reward precisely against this "serial collapse"; an untrained lead with a neutral preamble shows it.

**What.** One exploratory arm, S-F: arm S with one change, a fan-out rule appended to the lead preamble
(`experiments/swarm/run-r1b.mjs` `FANOUT_RULE`: split into 4–8 independent parts, start one worker per part in one
message before doing any work, the lead's own work is the split, the merge and conflicts; task-agnostic, no R6 word).
Same model, tools, subagent knobs, caps ($1.00, 30 min), archive and analysis code (coordination codes, root cause).

**Where and how much.** On the first k complete rung-1 held-out tasks in seed order, one trial each, k = min(4, complete
blocks, ⌊(8.00 − spent − 0.20) / (1.25 × S's largest held-out cost)⌋), under the same $8 ledger (rung 1 counted). With
$6.84 spent and S's largest cost $0.54 this gives k = 1 (seed 9301). Live data `/var/tmp/foundry-work/swarm-r1b`.

**Status.** Exploratory and anecdotal (one trial), not part of the preregistered comparison. The task is a rung-1
held-out task whose rung-1 outcomes were seen before this arm was written (the fan-out rule was not tuned on it: it was
written from the K1 code alone and is task-agnostic). Reported beside rung 1 with its failure root-caused by the frozen
tools; no capability claim is made from it. Its purpose is to exercise the coordination coder on a real swarm trace and
to see which coordination failures a forced Haiku swarm produces on this bed.

**Analysis code added after the freeze (post-hoc, labelled in the result):** `experiments/swarm/locus2.mjs` (an evidence
test that also sees script-printed sentences; the frozen `seenDocs` only sees document headers and paths, and the
calibration showed both sessions reading through scripts) and `experiments/swarm/report-r1.mjs` (the frozen analysis
plus the post-hoc checks: evidence, W's relative-date and ranking-policy checks, rung 1b). The frozen analysis is
reported as preregistered.

### Amendment 2 (2026-11-04, after the rung-1 held-out stage, analysis only): the void rule

**What happened.** §5.1's void rule (copied from the need router: any hidden-path or repository-path attempt voids a
trial) voided 10 of the 14 held-out A and S trials (every A trial, three S trials), leaving **0 complete blocks**; the
frozen `analyze-r1.mjs` then crashed on the empty comparison (a second defect: no empty-set guard). Of the 52 flagged
paths, 51 are sandbox-private: 37 are files or directories the session itself created under `/var/tmp` (scripts, notes,
outputs), 11 are the CLI's own tool-result spill files under `/root/.claude/projects/<session>/tool-results/` (the CLI
saves a long tool output there and the model reads it back), and 3 are `/var/tmp/foundry-work`, the tmpfs directory above
the session's own workdir. The 52nd is `/var/foundry-work` in A 9302: a `cd` (error discarded) to a path that does not
exist. *[Corrected 2026-11-04 after the review, finding B1. As first committed this paragraph said "Every flagged path
is sandbox-private: 38 … created … under `/var/tmp`"; the audit had miscounted `/var/foundry-work` as self-created.]* Inside the executor sandbox `/root` and `/var/tmp` are empty private tmpfs mounts
(`src/executors/claude-code.mjs` `DEFAULT_HIDDEN`), so none of these can reach hidden material. The rule was written for
sessions that do not script; it mistakes scratch for peeking.

**Change.** `experiments/swarm/void-audit.mjs` classifies every flagged path (cli-spill, self-created — the first tool
use naming it creates it, or it lies under a directory the session created — workdir-ancestor, other). A trial is void
for drift, a repository-path mention, or any path of kind `other`. `analyze-r1.mjs` uses this rule, guards the empty
case, and reports the frozen rule's outcome beside it (`frozenRule`: voids, complete blocks, path kinds). Tested
(`test/void-audit.test.mjs`: scratch is benign; reading another session's workdir, a host file, or a path read before it
was written is `other` and voids). *[Corrected 2026-11-04 after the review, finding B1. As first committed this said
"Under the amended rule no trial is void and all 7 blocks are complete". That was the output of a buggy audit: `writesOf`
(`spawn-tree.mjs`) read `"->"`, `> ''` and `a > b` inside quotes and heredocs as redirections and returned `""`, and
`under(p, "")` was true for every path, so every flagged path of such a session came out self-created. With the audit
corrected, this amendment as written voids A 9302 and leaves 6 complete blocks (9301, 9303–9307).]*

### Amendment 3 (2026-11-04, after the review, analysis only): a failed `cd` is no access; three rules reported

**Why.** With the audit corrected (review B1: `shell-scan.mjs`, a guarded `under()`), Amendment 2 voids A 9302 for a
single path, `/var/foundry-work`. The session ran `cd /var/foundry-work 2>/dev/null; cd <its workdir> && …` in tool use
31. The path does not exist on the host. The sandbox mounts the host filesystem read-only outside its private tmpfs
mounts, so the path did not exist in the session either, and the `cd` read nothing. This amendment is written after
seeing that it restores exactly the block where A passed and S failed. It is therefore a sensitivity analysis, not the
primary rule.

**Change.** `void-audit.mjs` (option `amendment3`) gives a flagged path kind `failed-cd` when every tool use that names
it names it only as the argument of `cd`, no tool use creates it, it is not under a private tmpfs root, and it does not
exist on the host. `failed-cd` is benign. `analyze-r1.mjs` reports all three rules (`rules.frozen`, `rules.a2`,
`rules.a3`: void trials, complete blocks). The table and comparisons use `--rule`, default **a2 (Amendment 2 as written,
corrected audit), the primary rule**. `report-r1.mjs` adds the a3 analysis as `sensitivity.a3`. Also: a flagged trial
whose transcript cannot be audited keeps its frozen verdict (void); and the root cause now covers every recorded trial,
with `inComparison` marking the rows the table uses.

**Outcome.** Frozen rule: 10 void trials, 0 complete blocks. Amendment 2 as written: 1 void trial (A 9302), 6 blocks.
Amendment 3: 0 void trials, 7 blocks.

### Notes after the review (2026-11-04; nothing here changes an analysis)

- **No treatment-delivery gate (M1).** §6 had no rule that stops the held-out stage when the swarm arm does not fan out.
  The calibration record showed S with 0 workers at 17:48Z, and the held-out stage started at 18:01Z anyway. The next
  rung's prereg must include `experiments/swarm/delivery-gate.mjs` (every swarm-arm calibration trial starts at least
  2 workers, by spawn tree and by the CLI, and one completes; otherwise exit 7 and an amendment), and must pilot every arm
  on dev before freezing.
- **Frozen falsifiers (§7) and §5.5, as written:** falsifier 1 and falsifier 2 did not fire under any void rule, and the
  "adds nothing" branch is not met as worded. The result is inconclusive about swarms (treatment not delivered).
- **Rung 1b's launcher** (`launch-r1b.sh`) ran the only S-F call but was committed afterwards, in 17c4ee0a, not with
  Amendment 1 (01221415).
- **W builder effort.** §2 froze effort "high" for the Haiku builder. The owner's role rule is "Haiku 5.5 max for cheap
  implementation" (OPERATING-PRINCIPLES §7). The departure was preregistered but not flagged as one.
- **Seed exposure.** The $0 sizing script of the dossier generated wbed-r6 test seeds 8401–8406 (range `wbed-heldout-c`,
  owned by wbed/JIT), and the agent that wrote this prereg saw their summary statistics. It is recorded in the seed ledger
  (`exposures`). The range owner decides whether to burn them.
- **Hashes.** `experiments/swarm/spawn-tree.mjs` and `experiments/swarm/analyze-r1.mjs` no longer match FROZEN-R1.json
  (B1 fix; the amendments). This file no longer matches either (amendments appended). FROZEN-R1.json stays as frozen.
