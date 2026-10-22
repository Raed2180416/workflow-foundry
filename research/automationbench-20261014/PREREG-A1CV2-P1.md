# PREREG-A1CV2-P1: A1-C v2 on look 2 of SEQUENTIAL-PLAN-v1 (held-out devTrain tasks)

**Status: FROZEN 2026-10-22, before any P1 paid call.** The freeze commit is the commit that adds this file on branch
`worktree-wf_3674d3bc-0a7-12` (`git log --diff-filter=A --format=%H -- research/automationbench-20261014/PREREG-A1CV2-P1.md`).
Later changes go only into §14 (Amendments), dated, with a reason, and committed before the paid call they affect.

**Evidence label.** Look-2 tasks are **devTrain tasks held out from every A1-C development step** (disjoint from dev60,
drawn by the committed seeded rule of PREREG-AB-v1-AMEND-1 §2.2 before any run). Results are **development evidence
under D21, not sealed test evidence**: run.mjs labels the runs "development/diagnostic", nothing here touches devCheck or
the test split, and no number from P1 is a capability claim about the test split or about any other benchmark.

Sources: [A1C-V2-DESIGN.md](A1C-V2-DESIGN.md) (§0.1 third build, §0.2 P0, §5 paid commands and analysis),
PREREG-AB-v1 and its AM-12, PREREG-AB-v1-AMEND-1
(`research/automationbench-20261014/PREREG-AB-v1-AMEND-1.md` on branch `worktree-wf_630f3979-599-4`, frozen at `2df949cb`), and decisions D18, D21–D28 in `research/decisions-20261021.md`
(main tree).

## 1. Question and scope

The work item asks whether A1-C v2 (inventory → K = 3 ledgers → code checks → act; repairs off; Haiku 5.5 acting) beats
the frozen A1-C v1 on tasks neither was developed on, and what both buy over raw Haiku (A0). Under D23 and D25 this run
is **look 2 of the frozen group-sequential plan** SEQUENTIAL-PLAN-v1, so it carries two tests with different standing:

- **Confirmatory (the plan's α):** A1-C v2 (treatment, first look 2) against A0 (control).
- **Primary development comparison (the work item; outside the plan's α):** A1-C v2 against A1-C v1.

Out of scope: devCheck (look 3 of devCheck is gated by §10.4), the test split, look 3 of the plan (23 tasks; it needs its
own launch decision and budget, and its tasks stay unopened), the frontier bar (Opus 5.5 xhigh is a separate chain:
here it is a reference arm only, §9.6).

## 2. What the author of this file had seen

- The P0 replay of this branch on dev60 (in-sample, D21): every lint refusal against its dev60 grade, by hand (§0.2 of
  the design).
- Cost and Mercury-token fields of every AutomationBench run record under `/var/tmp/foundry-work/autobench/` (aggregate
  numbers only). The two look-2 runs outside this chain were **not opened**: of `a1s-look2` only `launch.json` (model,
  cap), of `a0o-look2-1` only `launch.json`, its summary's CLI version and total spend.
- **The Opus reference arm's aggregate**, 26/60 strict pass, $0.385 per task, from the subject of main-tree commit
  `b5c2e9b4` and its NOTE.md heading (mean partial credit 0.827). No per-task outcome of any look-2 run.
- Task **names** of look 2 only as code reads them (the exposure check, §7); the six names in §12.1 were already in the
  design. No look-2 request, world or assertion.
- The earlier workflow's exposure record (design §0.1) and the re-review reports, as summarised in the build's report.

## 3. Tasks

| Item | Value |
|---|---|
| List | `research/automationbench-20261014/LOOK2-TASKS.json` = look 2 of `SEQUENTIAL-PLAN-v1.json` = `a1c-v2/HELDOUT-LOOK2.json` |
| Rule (AMEND-1 §2.2, committed before any run) | devTrain (SPLIT-v1 dev minus devCheck) minus the forced set (103), the AM-2 briefed tasks, look 1 (dev60: `--subset 60 --seed 21`) and every task another recorded run names, leaving an 83-task pool; per domain ascending `sha256('ab-seq-v1:' + task)`; the first 10 per domain |
| Size | 60 tasks, 10 in each of sales, marketing, operations, support, finance, hr |
| List sha256 (`split.mjs listSha256`) | `a8c1ed5c8b18606c97feb7fcdd83115eab8cbdffa6e7956d9ee6d9d0974e916f` |
| File sha256 | `LOOK2-TASKS.json` `85099131ad42ff27dd547c087797552fc424906093b5feb560ea5b81ebd2f567`; `SEQUENTIAL-PLAN-v1.json` `56e8d3cf5f19ebf7268d49fed99d9ae85afb3c031b873979df02777aa53dc261` |
| Plan sha256 (pinned in `sequential.mjs FROZEN_PLAN_SHA256`) | `3cd586bd7994a4a4bd0de00e771568516eeda808dc45b0297575d9a659cd2ea4` |
| Exposure check on 2026-10-22 03:2xZ (`replay/heldout-look2.mjs`) | ok, 0 hits, look 2 re-derived to the same sha |

Every task is a devTrain task outside devCheck, test and dev60: `sequential.mjs` asserts it for every look run, run.mjs
refuses test tasks in every mode (AM-4), and v2 refuses non-dev tasks itself (`DEV_ONLY`).

## 4. Arms

All arms: acting model `claude-haiku-5-5` (from `policy/models.json`, policy 2026-10-21.2, file sha256 `cffef22b…` in both
checkouts), k = 1, Claude Code CLI **2.1.307** (the chain refuses any other, §7).

| Key | Harness (version) | Node models | Checkout, commit | Manifest / runner sha256 at CLI 2.1.307 | Plan role, `--arm` | First look | Run id | Default cap |
|---|---|---|---|---|---|---|---|---|
| **A0** | none (raw runner) | – | pin `b1e16e030470c077b8c09bc3fdf06a32c2a26209` | runner `run.mjs` `ea1dca70628a80262430b0d693d013fab456aebccefaac9e48db9713d4c87c5f` | control, `A0` (the only control run) | – | `a0-look2` | $4 |
| A0-AA (T3) | none | – | pin, same | same runner | treatment, `A0 (T3 A/A)` | 2 | `a0-look2-aa` | $4 |
| **v1** | `codeowned` (a1c-v1; repairs as frozen, `maxRounds` 2) | all Haiku | pin, same | `5c452af09bb4df6853e2543c6f0e428738dbae811a62bceae04ac5c637d06de8` | treatment, `A1-C` | 2 | `a1c-v1-look2` | $6 |
| **v2** | `codeowned-v2` (a1c-v2; `maxRounds` 0, `preSendLint` false) | all Haiku | branch, V2COMMIT (below) | `716df33d5c892ceb5101c09011565f591b97bf6e199581fbce37a9eb4c7ff231` | treatment, `A1-C v2` | 2 | `a1c-v2-look2` | $6 |
| v1-M | `codeowned` (a1c-v1) | ledger, checker: `mercury-3` | pin, same | `c645c8e914a9de3b0ce23cfcf81ce12681ffec5a6e62742f87b3d0665427f167` | treatment, `A1-C (Mercury ledger and checker)` | 2 | `a1c-v1m-look2` | $4 + token cap |
| v2-M | `codeowned-v2` (a1c-v2) | ledger, checker: `mercury-3` | branch, V2COMMIT | `785093f577b9ce814c74fab20d5bb695c7fe98a47ede73e5a174df000b322ba7` | treatment, `A1-C v2 (Mercury ledger and checker)` | 2 | `a1c-v2m-look2` | $4 + token cap |

- **Pin:** worktree `.claude/worktrees/a1c-v1-pin`, branch `a1c-v1-pin-look2`, annotated tag `a1c-v1-look2` = `aada200`
  (the devCheck-evaluated a1c-v1) plus the frozen plan files; no manifest file differs from `aada200`.
- **Branch:** worktree `.claude/worktrees/wf_3674d3bc-0a7-12`, branch `worktree-wf_3674d3bc-0a7-12` (base `c6a0bb0`). The
  harness files are identical at `f726472e` (P0 decision), `78573e27` (chain switch) and the freeze commit of this file.
  **V2COMMIT** is the branch HEAD at launch: this file's commit, or a later commit that changes nothing under
  `experiments/`, `src/`, `beds/` or `policy/` (`git diff --stat <freeze commit> <V2COMMIT> -- experiments src beds policy`
  empty; only §14 amendments and decision records).
- **Shared files:** `bridge.py` `285be4f5ba32f569c904897d512524535f6b50c11c05d54e419e5e272f97641a` in both checkouts;
  the branch's `run.mjs` is `a93cd5da…` (v2's registration and `EXECUTOR_PIPELINES`; it is in v2's manifest);
  `sequential.mjs` `44d7e90f…` and `experiments/lib/stats.mjs` `94c94d3e…` identical in both checkouts.
- **Dry-run values (the freeze, $0, as the design says):** `run.mjs --harness codeowned-v2 <common flags> --dry-run
  --harness-hash 0` on the branch stops with "recomputed `716df33d…`"; the same on the pin with `--harness codeowned`
  stops with "recomputed `5c452af0…`". `manifest-hash.mjs` gives the four manifest hashes above (it refuses any arm
  run.mjs would refuse).
- **Hash history (disclosed):** the CLI version is part of every manifest. At CLI 2.1.306 v1 was `5622c941…` (its dev60
  and devCheck runs) and v1-M `fa6c2e45…`; the code is unchanged, only the CLI field differs. v2 was `7a8faa85…` at 2.1.306.
- **P0 left v2 unchanged:** the lint stays off (design §0.2), so no lint smoke ran and the hashes above are the pre-P0
  hashes.

## 5. Common configuration

```
--model claude-haiku-5-5 --date-note --concurrency 3 --budget 0.75 --timeout-min 20 --max-steps 50 --det record --k 1
```
- Session budget $0.75 and 20 min wall per task, ≤ 50 model responses (AM-1 counting), as A0 and PREREG-AB-v1 H9.
- Mercury arms add `--node-models ledger=mercury-3,checker=mercury-3 --token-cap <§6> --session-tokens 300000`.
- **Effort and temperature: unset in every arm** (no `--effort`; `CLAUDE_EFFORT` is scrubbed from the child
  environment, so each session runs at the CLI's default for the model; temperature is not settable through `claude -p`).
  This matches every dev60 and devCheck run of these harnesses and the frozen v1 manifest (`effort: null`). It departs
  from D28 (4) ("a paid run with effort unset is an error"); D28 (8) defers the effort-per-node policy edits until the
  frozen A1-C v2 runs finish. Disclosed; confirmation asked in §8.
- `DISABLE_AUTOUPDATER=1`, `FORCE_PROMPT_CACHING_5M` unset (as AM-5 records), Node v24.21.0.
- Each arm starts through `sequential.mjs look 2 --plan SEQUENTIAL-PLAN-v1.json --role … --arm … [--first-look 2]
  --exec -- --run-id <id> <options>` of its own checkout, which writes the `sequential-look.json` sidecar into the live
  directory and the repo copy before run.mjs starts; a look run may not pass `--no-copy`, `--tasks` or any selection flag.

## 6. Budgets and caps

**AutomationBench dev spend so far** (2026-10-22 03:35Z; sum of `summary.json cost.spentUsd`, else the run's rows, over
every live run record; Opus arms excluded under D19/D26):

| Group | USD |
|---|---|
| Haiku arms (A0, A1, A1-C, Sonnet-planner control, Mercury-ledger arms' Haiku part, smokes, the pre-prereg raw Haiku baseline $0.96) | 22.60 |
| Sonnet arms (A0-S, A1-S, first6 probes) | 20.68 |
| Unlabelled partial A0 runs (contaminated and paused, 2026-10-15) | 0.49 |
| P0 (this step, §0.2 of the design) | 1.77 |
| **Total settled, non-frontier** | **45.53** |
| Running: VL-1's Sonnet + A1 fork `a1s-look2` (D27), at its cap | ≤ 10.00 |
| Opus (D19/D26, not counted here): `a0o-look2-1` | 23.12 |

**D22 ($40 for the non-frontier arms it names), read strictly as its own pot:** the Sonnet-planner control
`a1csp-dev60-38` $7.474, the v2-M smoke $0.0128, P0 $1.767, `a1s-look2` at its cap $10, VL-1's judge about $1, and a
reserve of $2 for P2 (dev60, in-sample, after P1): $22.25 committed, **`D22_LEFT = 17.74`** for this chain. Under the
broader readings (PREREG-AB-v1 dev $60 raised to $150 by AM-10, plus D22's $40) at least $134 is left; under D22's own
wording ($60 + $40) at least $44. The chain is sized to the strict reading.

**Caps per arm (run.mjs starts a task only if spent + reserved + $0.75 ≤ cap; with 3 in flight an arm needs about its
expected spend + $2.25):**

| Arm | Expected (from recorded dev60/devCheck runs) | Minimum cap | Cap |
|---|---|---|---|
| v1 | $2.23 (with repairs) | $4.50 | $6 |
| v2 | ≤ $2.2 (no repairs; its ledger nodes cost $0.02 per task in P0) | $4.50 | $6 |
| A0 | $0.75–0.90 | $3.20 | $4 |
| A0-AA (T3) | $0.75–0.90 | $3.20 | $4 |
| v1-M, v2-M (Haiku part) | $0.93 | $3.20 | $4 |
| **Chain** | **about $8 (all six arms)** | | caps sum to $28; the chain lowers a new arm's cap to `D22_LEFT` minus what the chain has settled and stops (exit 5) below the arm's minimum |

**Mercury (D18, 20M tokens in total), re-tallied:** live run records 4,972,199 (token-cap smokes 1,144,839, A1-C probe
84,529, `m3-a1c-dev60-dn` 2,709,413, its fill 970,606, the v2-M smoke 62,812); outside the run records
(**`MERCURY_OTHER = 812875`**): the port probe 293, BUILDER-1 211,987, the effort dose 100,595 (booked; 66,824 reported),
ROUTER-1 500,000 (its cap, an upper bound on about 385K metered). **D18 total ≈ 5.79M.** Not counted: the official-protocol
`m3-official-dev60` (97.17M, before D8; it is the reason for D8). Each Mercury arm's token cap is min(5.5M, 20M − tally −
other − 1M reserve): 5.5M for v1-M and then for v2-M (worst case after both, 16.8M ≤ 20M). v1-M expects about 4.3M plus
0.6–0.9M held by tasks in flight; v2-M about 3.8M. The chain stops (exit 6) below 4.5M.

A resumed arm keeps its launch caps (run.mjs only lets a resume raise them, and a raise needs a §14 amendment).

## 7. Execution and faults

- **Order (back to back, not interleaved):** v1, v2, A0, A0-AA (T3), v1-M, v2-M, through
  `research/automationbench-20261014/a1c-v2/look2-chain.sh` (rehearsed at $0: 28/28 on `78573e27`).
- **Before every arm** the chain checks: the pin at `b1e16e03…` with no tracked change and its `run.mjs` `ea1dca70…`;
  the branch at V2COMMIT with no tracked change; `bridge.py`, the plan file and the look-2 file shas in both checkouts;
  the CLI is `2.1.307 (Claude Code)`; at least 1 GB free; the exposure check passes (no look-2 task in any run outside
  this plan's look-2 sidecar runs and the runs D26 and D27 name, as launched); D22 dollars; for a Mercury arm, D18 tokens.
- **Environment fault** (run.mjs exit 3: rate or session limit): wait 30 min, resume with `--resume`, at most 6 times;
  never scored. **Exit 4** (a cap): stop; a higher cap needs a §14 amendment. Exit 5: D22; exit 6: D18; exit 7: an
  integrity check (including a CLI change).
- **A container restart** (register C9: two on 2026-10-22) kills the chain and run.mjs. It is an environment fault:
  relaunch the chain (it skips finished arms and resumes a started one at its launch caps). The sessions in flight at the
  kill leave no row, so before relaunching, the launcher books 0.75 × (tasks in flight with no row) as that arm's killed
  spend in `/var/tmp/foundry-work/a1c-v2-look2-killed.json` and lowers `D22_LEFT` by it (an upper bound; run.mjs's own
  per-run cap cannot see it, disclosed).
- **A CLI change** after a restart stops the chain (exit 7). Remaining arms run only after a §14 amendment re-freezes
  their hashes at the new CLI; every comparison across the change carries it as a disclosed deviation.
- **Nobody working on an A1-C arm reads per-task lines** of the chain log, a live `results.jsonl` or a repo copy before the
  last arm finishes. Progress is read from counts only (rows written, spend).
- **Outcome rules (same for every arm; `sequential.mjs loadOutcomes`, PREREG-AB-v1 §6.3):** a row with a fault flag is not
  an outcome (the arm is resumed until none remains); a row without a final grade and without a fault scores 0 and is
  listed; the grade is the row's final grade (`task_completed_correctly`, `partial_credit`). Only repo copies are read.
  A comparison with an arm that lacks an outcome for any look-2 task is reported as incomplete, not computed.

## 8. Rulings needed before the first P1 call (the orchestrator's; recorded as decisions, not here)

1. **First look 2 for every A1-C arm** (design §0.1, AMEND-1 §2.2 per-arm rule): the request text of 6 look-2 tasks reached
   the v2 development record (1 by the anatomy overrun, 5 by ROUTER-1, which v2 does not use) and pool aggregates over
   a superset of looks 2 and 3 reached the spec; no per-task value entered the code. Proposed: keep first look 2,
   disclose (§12), read the sensitivity analysis (§9.4) beside the confirmatory result, and correct AMEND-1 §2.2
   disclosure 2. If the ruling moves any A1-C arm to first look 3, this file is amended before launch and v2 vs A0 is not
   tested at look 2.
2. **Mercury arms under D28 (7)** ("no Mercury pilot beyond the running arms until the allowance is read"; every Mercury
   call with explicit reasoning effort, a completion cap and a strict JSON schema). The v1-M and v2-M manifests, frozen
   before D28, set none of the three. The chain needs `M_ARMS=1` (run both, as D25 and D27 planned; VL-1 needs v1-M) or
   `M_ARMS=0` (skip both; §9.3's M comparisons are then not reported). It has no default.
3. **Effort unset** (§5) under D28 (4) and (8): confirm the frozen arms run as their manifests say.
4. **T3** (the paid A/A check, AMEND-1 §4, about $0.9): run (`T3=1`) — recommended here, since it is the clean check
   AMEND-1 asks for before the first look-2 comparison is read.

## 9. Analysis (fixed in code before any P1 call: `experiments/autobench/replay/look2-analysis.mjs`, sha256 `e38d82cc…`; test rr17)

Inputs: the repo copies only (`results.jsonl`, `summary.json`, `sequential-look.json`), read through `sequential.mjs
verifyLookRuns` (a run without a matching sidecar, or with another arm name or first look, is refused).

1. **T3, read first** when `a0-look2-aa` exists: A0 against A0, exact two-sided McNemar, descriptive (a check of the
   environment; it decides nothing). A T3 with p < 0.05 is reported prominently beside every comparison.
2. **Confirmatory (H1; the only test that spends the plan's α):** A1-C v2 against A0 at look 2 of SEQUENTIAL-PLAN-v1,
   `sequential.mjs analyzeLooks`, first look 2: strict pass by exact two-sided McNemar at the nominal level
   **0.0180** with the 3-point floor; partial credit (paired sign-flip, nominal 0.0180, floor 0.03) only if strict pass is
   rejected (D23 fixed sequence); the comparison stops on strict pass only.
3. **Primary development comparison (H2; the work item; outside the plan's family):** A1-C v2 against A1-C v1 on the 60
   paired tasks, **exact two-sided McNemar at α 0.05**, with the discordant pairs, the difference in tasks and points,
   Wilson intervals per arm and partial credit by paired sign-flip (descriptive). It spends none of the plan's α (AMEND-1
   §6), is not adjusted for H1, and is labelled so wherever it is reported.
4. **Secondary (descriptive; exact two-sided McNemar, p and discordant pairs, never a claim):** v2-M vs v1-M; v2-M vs v2;
   v1-M vs v1; v1 vs A0; v1-M vs A0; v2-M vs A0. Per domain (10 tasks each); termination categories (`hard-undecided`
   apart from `all-pass`); gate refusals, holds, resends and duplicates; harm (`replay/harm.mjs`, paired, v1 vs v2 and
   v1-M vs v2-M); cost per task and per strict pass, tokens per model, model responses per task.
5. **Sensitivity (pre-registered):** every comparison of 2–4 again without the 6 look-2 tasks whose request text
   reached the development record (§12.1).
6. **Reference arms, reported beside and never compared under the plan:** Opus 5.5 xhigh alone, `a0o-look2-1` (D26; same
   60 tasks, CLI 2.1.307, runner `ea1dca70…`, `--budget 3 --date-note --concurrency 3`; 26/60, $0.385 per task, already
   seen, §2), and VL-1 (D27, its own PREREG-VL1). They are not confirmatory and no P1 decision depends on them; the gap to
   Opus is reported with both arms' cost per task.

**Power, stated now.** On 60 paired tasks the exact McNemar rejects only with lopsided discordant pairs:

| Discordant pairs | 10 | 14 | 16 | 20 | 24 | 30 |
|---|---|---|---|---|---|---|
| Needed at α 0.05 (H2) | 9:1 | 12:2 | 13:3 | 15:5 | 18:6 | 21:9 |
| Needed at 0.0180 (H1) | 10:0 | 12:2 | 14:2 | 16:4 | 19:5 | 22:8 |

A1-C v1 against A0 was 20 vs 13 on devCheck (+7 tasks, aggregates only). An effect of that size is unlikely to cross
either boundary at look 2; "no resolvable difference" is the expected outcome for effects under about +10 tasks and is
declared now as a likely result, not a failure of the run.

## 10. Decision rules (stated before any P1 data)

1. **H1 (plan).** Strict pass rejected with v2 ahead → the statement "A1-C v2 raises the strict pass rate over A0 on look
   2 of the plan (development evidence, held-out devTrain tasks)" is allowed, and partial credit is then tested once at
   0.0180. Rejected with A0 ahead → harm, reported first; it ends the comparison. Not rejected → the plan continues to
   look 3 (23 tasks, cumulative 83, nominal 0.0443) under a separate launch decision; no statement about v2 vs A0 is
   made from look 2. Partial credit beyond its boundary while strict pass is not rejected is printed "NOT TESTED" and
   decides nothing.
2. **H2 (work item).** p < 0.05 with v2 ahead → "A1-C v2 beats A1-C v1 on 60 held-out devTrain tasks (exact McNemar,
   development evidence, outside the plan's α)". p < 0.05 with v1 ahead → a negative result: v2 is worse than v1 on
   held-out tasks; recorded in RESEARCH.md and v1 stays the candidate. Otherwise → "no resolvable difference" with the
   point estimate and both Wilson intervals; never read as v2 ≥ v1.
3. **Sensitivity.** If removing the 6 exposed tasks flips any H1 or H2 conclusion (rejected ↔ not rejected), the
   statement carries that fact in the same sentence.
4. **Development gate for devCheck look 3 of v2** (frozen in the design §5; never a claim): strict pass v2 − v1 ≥ +3
   tasks (paired), partial credit v2 − v1 ≥ −0.01, harm totals ≤ v1's (paired), mean cost per task and mean responses
   per task ≤ v1's, H3 clean, L1 (task names), L4 (sandbox) and L5 (transcripts) clean, and, if Δdev60 (P2 − 20/60) > 0,
   Δlook2 ≥ Δdev60 / 3. Under no effect "+3" alone passes with probability 0.17–0.30. If the gate fails, a negative
   result is recorded and v1 stays the candidate at devCheck 20/60.
5. **Mercury.** v2-M or v1-M ahead of its Haiku counterpart decides nothing here; it is input to the owner's Mercury
   decision (D28 (7)) and to VL-1.
6. **Every result** is reported with its arm's model, harness id and hash, CLI, cost per task and per strict pass, and
   the evidence label of this file. A null or negative result is committed with the same prominence as a positive one.

## 11. Amendment of PREREG-AB-v1 H8 under D21

PREREG-AB-v1 §4 H8 says "nothing derived from test tasks, rubric code or grades of **any** task may be compiled in".
From D21 (2026-10-21) H8 reads, for A1-C v2 and its variants:

> Generic rules (no task names, values or answers) may be tuned on dev60 grades as **disclosed in-sample development**.
> Every such rule and threshold is listed in the harness `KNOWLEDGE` block (v2: 18 lines, 9 citing D21), and the
> check-precision study that drove them is committed (`a1c-v2/precision/`). Nothing derived from test-split or devCheck
> tasks, rubric code, or grades of any task outside dev60 may be compiled in. A claim may only come from tasks disjoint
> from dev60, drawn by a committed seeded rule before the run.

Look 2 meets the last sentence (§3). The test-split part of H8 and the L2/L3 scans before any test-split run are
unchanged (design §7). The amendment text is recorded here as D21 directs; PREREG-AB-v1 §16 on main gains a one-line
pointer when the branch merges (main is read-only for this step).

## 12. Disclosures and deviations

1. **Look-2 content in the development record** (design §0.1, verified by script, counts only): the anatomy agent's
   `sed` overrun printed the definition header and opening request sentences of `finance.intercompany_balance_recon`;
   the need-router study ROUTER-1 used the request texts of `finance.qb_estimate_conversion`,
   `hr.recognition_nominations`, `sales.calendly_sequential_meetings`, `sales.dependency_chain` and
   `support.helpscout_customer_merge` (D25: an arm that uses the need router counts as developed on them; **no arm here
   uses it**); the critic:overfit agent's aggregates over a 91-task pool holding all 60 look-2 and 23 look-3 tasks
   reached the spec's prompt (no per-task value is in the code; test 18). AMEND-1 §2.2 disclosure 2 repeats an older,
   wrong statement of this exposure and needs correcting (§8.1).
2. **Slips on the reference arm (2026-10-22):** about 02:30Z the third-build fixer printed 3 lines of `a0o-look2-1`'s live
   log (three look-2 task names with Opus's per-task result and cost); about 02:42Z its aggregate. The last behavioural
   edit to v2 (02:27:24Z) precedes both; only the manifest text of the KNOWLEDGE exposure line changed after.
3. **CLI:** every P1 arm runs at 2.1.307 (enforced). The dev60/devCheck history of v1, A0 and the Mercury arms ran at
   2.1.300 or 2.1.306; P0 replayed v1's 2.1.306 records with 2.1.307 nodes. Not a compared-arm difference in P1.
4. **Time of run:** arms run back to back (about 1–2 h each), not interleaved; v2 sits next to v1 and A0. Other paid runs
   (SOP-Bench sealed, OT-0, VL-1) share the account. Load, rate limits and model serving drift are not modelled.
5. **A0's settings** are those of every recorded date-note A0 run (`a0-dev60-dn`, `a0-devcheck-1/2`: effort unset,
   `--tools Bash`, concurrency 3), not the `--effort high --concurrency 4` text of PREREG-AB-v1 §3's table, which no
   recorded A0 run used; the A1-C arms use the same settings, so the pairs are matched.
6. **The comparison is between two frozen harness versions,** not an ablation: v1 keeps its repair loop (`maxRounds` 2,
   as devCheck evaluated it), v2 has repairs off, a different ledger, checks and act prompt.
7. **Effort unset** in every arm against D28 (4) (§5, §8.3). **Mercury calls** in v1-M/v2-M lack D28 (7)'s explicit
   effort, completion cap and JSON schema (§8.2).
8. **P0 ran across a container restart:** the killed attempt is booked at its upper bound (design §0.2). The lint
   decision (off) used 4 refusals, so the rule is coarse; both false refusals share one mechanism (an exclusion rule
   compiled into a do-not-mention literal), recorded for v2.1.
9. **D22 accounting** uses the strict pot reading (§6); the alternatives are stated.
10. **The work item named v2 vs v1 the primary comparison;** D23/D25 make v2 vs A0 the plan's confirmatory test. Both are
   kept with their standing stated (§1, §9).
11. **Exposure-check exemptions** cover only this plan's look-2 sidecar runs, `a0o-look2-1` (D26) and `a1s-look2` (D27),
    each as launched. Any other run naming a look-2 task (for example a new VL-1 run) stops the chain at exit 7 until a
    decision names it.

## 13. Launch plan (after §8's rulings are recorded)

```
# 0. rulings recorded (first look, M_ARMS, effort, T3); df -h / ≥ 1.5 GB; claude --version = 2.1.307 (Claude Code)
# 1. $0 rehearsal on the launch commit (must print "28 passed, 0 failed"):
cd /home/user/workflow-foundry/.claude/worktrees/wf_3674d3bc-0a7-12
bash research/automationbench-20261014/a1c-v2/rehearsal/rehearse-chain.sh
# 2. a launch FILE (no process pattern on the launching command line), e.g. <scratchpad>/a1cv2-p1/launch-p1.sh:
#!/bin/bash
export V1HASH=5c452af09bb4df6853e2543c6f0e428738dbae811a62bceae04ac5c637d06de8
export V1MHASH=c645c8e914a9de3b0ce23cfcf81ce12681ffec5a6e62742f87b3d0665427f167
export V2HASH=716df33d5c892ceb5101c09011565f591b97bf6e199581fbce37a9eb4c7ff231
export V2MHASH=785093f577b9ce814c74fab20d5bb695c7fe98a47ede73e5a174df000b322ba7
export V2COMMIT=$(git -C /home/user/workflow-foundry/.claude/worktrees/wf_3674d3bc-0a7-12 rev-parse HEAD)
export CLI='2.1.307 (Claude Code)' MERCURY_OTHER=812875 D22_LEFT=17.74 T3=1 M_ARMS=<0|1 per §8.2>
exec bash /home/user/workflow-foundry/.claude/worktrees/wf_3674d3bc-0a7-12/research/automationbench-20261014/a1c-v2/look2-chain.sh
# 3. launch detached:
setsid nohup bash <scratchpad>/a1cv2-p1/launch-p1.sh > /var/tmp/foundry-work/a1c-v2-look2-chain.log 2>&1 < /dev/null &
# 4. watch counts only (rows written, spend; `[look2-chain …] … exit` lines); after a container restart: book the killed
#    sessions (§7), lower D22_LEFT, relaunch step 3.
# 5. after the last arm: the chain writes harm and analysis.json to runs/a1c-v2-look2/; commit every repo copy
#    (results.jsonl, summary.json, sequential-look.json) and the analysis on the branch; then the report.
```

## 14. Amendments

None.
