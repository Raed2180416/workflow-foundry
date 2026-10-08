# C0 dev round report: records and codefix

*2026-10-08. This is development evidence only. PREREG-dev §4 says "directional only; no claim is made from this
round". The sealed round (`PREREG-sealed.md`, not yet written) is the claim-bearing test. Pre-registration:
[PREREG-dev.md](PREREG-dev.md); design: [DESIGN.md](DESIGN.md).*

**Evidence tags.**
- **[M] measured**: recomputed for this report from the run files, the model journal, git, or the code at HEAD `c7149b6`.
- **[D] documented**: stated in a file, a commit message or a diagnosis, and not re-measured here. The four
  diagnoses' replays are their authors' measurements; they are cited as [D] with a link.
- **[I] inferred**.

> **INSPECTED seeds.** The four failure diagnoses inspected test-split seeds **6001, 6002, 6003 and 6004 at
> difficulty 3** of `records` (bed 3.0.0) and `codefix` (bed 1.1.0). They read the inputs, the hidden truth and the
> per-trial outputs, and replayed the oracles. These eight tasks are no longer held out and **must never be reused as
> held-out evaluation tasks** in any experiment [D: header of each diagnosis]. PREREG-dev §1's "never inspected" no
> longer holds for them. PREREG-dev itself was not edited for this report.

## Key numbers

| arm | builder → artifact | records | codefix | all | exec $/trial | construction $ | CPS amortised |
|---|---|---|---|---|---|---|---|
| F-opus | Opus 5.5 → workflow.json | 8/8 | 8/8 | **16/16** | 0.0750 | 4.51 | 0.357 |
| B1-opus | Opus 5.5 → solve.mjs | 8/8 | 4/8 | 12/16 | 0.2683 | 6.24 | 0.878 |
| F-haiku | Haiku 5.5 → workflow.json | 6/8 | 5/8 | 11/16 | 0.1062 | 1.91 | 0.328 |
| B1-haiku | Haiku 5.5 → solve.mjs | 8/8 | 8/8 | **16/16** | 0.0780 | 2.21 | 0.216 |
| B0-opus | none (Opus 5.5 agent) | 8/8 | 8/8 | **16/16** | 0.5056 | 0 | 0.506 |
| B0-haiku | none (Haiku 5.5 agent) | 4/8 | 8/8 | 12/16 | 0.1188 | 0 | 0.158 |

All values [M], from `node experiments/c0/analyze.mjs experiments/runs/c0-dev` (§2).

- **Failures: 13 of 96 evaluation trials.** 9 are construction defects (F-haiku records 2, F-haiku codefix 3,
  B1-opus codefix 4) and 4 are execution-judgment errors (B0-haiku records). None is a harness/environment or oracle
  fault [counts M; classes D, §3].
- **Probes did not predict evaluation.** All 8 constructions passed all 3 of their probes (24/24) [M]. Every one of the
  9 construction-defect failures came from a case that no probe contained [D].
- **The F run verdict was uninformative.** It was `pass` on 32/32 F trials, including all 5 that failed the oracle.
  The acceptance of all four F workflows is only `exists` [M].
- **codefix at d3 does not discriminate.** B0-haiku solved it 8/8 at $0.035 per trial, the cheapest arm in the round,
  and B0-opus solved it 8/8. All 7 codefix failures were in constructed arms [M].
- **Spend: $35.32 recorded.** Constructions $14.86, probe runs $2.02, evaluation $18.43 [M]. A further ≤ $4 is
  unrecorded: three B0 sessions killed by the first interruption [I] (§1.3).
- **Interpretation.** Within the pre-registered rules no claim is made. Directionally:
  - F-opus executes far cheaper than B0-opus and B1-opus at equal or better success.
  - The F substrate did **not** help the Haiku builder relative to scripts (F-haiku 11/16 vs B1-haiku 16/16).
  - F-haiku vs B0-haiku is ambiguous; it points in opposite directions in the two families.

## 1. What was run

### 1.1 Pre-registration and freeze

**Freeze record.** The Amendments entry "FROZEN for families `records` (bed 3.0.0) and `codefix` (bed 1.1.0)" in
PREREG-dev.md [D] records:
- commit `bec44ea9cd3ac4d5ff0ca708f77df50d2e54d967`; combined sha256
  `7df51446786f9ac0abf5c7cfc33ae1a8f8a7d61c1cdf5457824802b7cd80c265`;
- session policyHash `b44deb45…6cee`;
- kits: F `7e8f0f83153c5efb`, B1 `6bc6b06eccf45cae`;
- file hashes: prompts `f6fcb2d3e9409050`, construct `cafe956d7a87719a`, analyze `9c6013e6cebd437f`, runDev
  `e53251b442954c49`, micro-harness `05c7d97876e59ef7`, script-harness `a44a34b9b3cd2900`;
- B0 arm hashes: B0-opus `d24e44bd7c5d1a7b`, B0-haiku `63ed23715db6f597`;
- the eight test task hashes.

**Re-verified at HEAD `c7149b6`.**
- `node research/freeze.mjs` over the same paths prints the same combined sha256 `7df51446…`, with no
  uncommitted-change warning [M].
- The six file hashes recompute identically [M].
- `kitHash()` recomputes to `7e8f0f83153c5efb` (F) and `6bc6b06eccf45cae` (B1) [M].
- Every evaluation row carries one of the eight frozen task hashes [M].
- Every B0 row carries its frozen arm hash [M].

**Clerical inconsistencies.** The freeze record was committed in `289a8fe` at 22:07:06 UTC, and the first construction
started at 22:07:09 [M]. Two things in PREREG-dev disagree with that, and both are clerical [I]:
- The amendment's own timestamp, "22:2x UTC", is later than the first construction.
- The PREREG header still reads "Status: DRAFT, not frozen".

### 1.2 What ran, against the pre-registration

| item | pre-registered | what ran |
|---|---|---|
| Families | records, incident, codefix, synth, kinetics at d3 | **records and codefix only**, at d3. Incident, synth and kinetics wait for their bed audits (Amendment 2026-10-07 #4) [D], so this report covers 2 of the 5 families [M] |
| Constructions | 4 constructed arms per family, K_c = 1. Builders Opus 5.5 and Haiku 5.5 at `xhigh`. Caps: $8 builder + $2 gateway, 45 min, at most 12 `/score` calls | 8 constructions, 22:07–22:29 UTC. All delivered; none faulted or voided. Highest builder cost $2.27 (F-opus-records); highest gateway cost $1.45 (B1-opus-codefix); longest session 16.5 min; at most 8 `/score` calls used [M] |
| Construction success | each artifact runs once on dev seeds 1–3 | 24/24 probes passed, no harness fault [M] |
| Evaluation | test seeds 6001–6004, K = 2, 6 arms | 96/96 trials, with every (arm, task, trial) cell recorded exactly once [M] |
| Execution caps | F/B1 $1 per task; B0-opus $2; B0-haiku $1; 20 min | No cap was reached. Highest trial cost $0.751 (B0-opus) and $0.594 (B1-opus); longest latency 511 s (B0-haiku) [M] |
| Kill rules | $350 total; +20% over any construction cap | No kill: `kill.jsonl` does not exist [M] |
| Environment faults | `*.faults.jsonl`, retried on resume | None: no faults file exists, and no trial or construction errored [M] |
| Void rule | `nestedModelAttempts > 0` voids a construction or B0 trial | 0 in all 8 constructions and all 32 B0 trials; `voided.jsonl` does not exist [M] |
| `outsidePaths` | reviewed by hand | B1-opus-codefix and B1-haiku-codefix each flagged one tool use under `/opt/node24/bin`. Reviewed: both were a listing of the node binary directory plus `node --version`, run while checking for python. No hidden content was read and no model was accessed: benign [M] |
| Gateway | refusals, errors, unknown spend counted | 0 refusals, 0 errors and 0 unknown-cost calls in constructions and B1 trials. The journal holds 768 calls, none failed [M] |

**Who did what.**
- **Architects (builders):** Claude Code headless with Opus 5.5 or Haiku 5.5 at `xhigh`, using the kit, 3 probes and
  `/score` [D: PREREG §2].
- **F runtime:** the Foundry runtime, running on the host from the repository's `src/` [M: code].
- **B1 runtime:** the pinned `solve.mjs`, run in a sandbox with no network access; models are reached only through
  the gateway [D].
- **Executor models chosen by the builders** [M: journal]:

  | artifact | records | codefix |
  |---|---|---|
  | F-opus | Opus + Haiku | Sonnet |
  | F-haiku | Haiku (+1 Sonnet escalation) | Sonnet + Opus |
  | B1-opus | Opus + Sonnet | Opus |
  | B1-haiku | Sonnet + Haiku | Opus + Sonnet |

- **Human assistance:** none inside any construction or trial [I]. The operator stopped and resumed the runner and
  moved files out of kit paths (§1.3–1.4).

### 1.3 Timeline, interruptions and resumes

| UTC | event | evidence |
|---|---|---|
| 10-07 22:07:09–22:29:27 | 8 constructions, 4 at a time | `construct-records-codefix.log`, `constructions.jsonl` [M] |
| 22:35:20 | execution process 1 starts: records probes, then records evaluation | `execute-records-codefix.1.log` [M] |
| 22:46:52 | last record from process 1; the process stops (**interruption 1**). Three trials were in flight and were killed: B0-haiku s6001 t1 (running since 22:42:37), B0-opus s6002 t0 (since 22:46:14) and B0-haiku s6002 t0 (since 22:46:52) | Timing [M]. Which trials were in flight [I]: derived from the runner's job order (`runner.mjs:96-98`) and the recorded start times. They are exactly the three trials that process 2 started first. |
| 22:49:31 | process 2 resumes. It finishes the records evaluation (48/48 at 23:15:58) and the codefix probes (23:15:59–23:17:44) | `execute-records-codefix.2.log` [M] |
| 23:17:44 | last record from process 2; the process stops (**interruption 2**) | Commit `db730ea` (23:18:35): "All background work stopped on the owner's request … C0 dev execution 48/96 trials" [D]. The journal has no call between 23:17:44 and 07:12:09, so no codefix evaluation trial had reached a model call [M] |
| 10-08 07:09:38 | resume refused for both families: "construction F-opus-records-k1 is from another protocol version (policy/kit/builder differ)" | `execute-records-codefix.3.log` [M]; cause in §1.4 |
| 07:11:59 | `450ce53` moves `web/run-view/` to `tools/run-view/` ("restores kit 7e8f0f83153c5efb") | git [M] |
| 07:12:01–07:30:03 | process 3: all 48 codefix evaluation trials | `execute-records-codefix.log` [M] |

The task statement calls the two interruptions container restarts. The repository records a cause only for the
second one, an owner stop [D].

**Consequences.**
- **No recorded trial was redone.** The runner resumed with `strictResume` and paired construction gating, so no
  recorded trial was re-run or overwritten. Each arm has one arm hash per family across all 120 probe and evaluation
  rows [M].
- **Deviation from PREREG §5 (unknown spend).** §5 charges a killed B0 session at its budget bound. That charge is
  applied inside the runner, which died with the sessions, so the three sessions killed in interruption 1 left no
  record and no charge.
  - Bound at the caps: $1 + $2 + $1 = **$4**.
  - Scaled by elapsed time at the completed sessions' spend per minute: about **$0.3–1.0** [I].
  - Their outcomes were never observed, and the re-runs are fresh trials of the same cells, so selection bias is not
    possible [I].
- **8-hour gap before the codefix evaluation.** It ran about 8 h after its constructions and probes, with the same
  model ids and arm hashes [M]. Provider-side change over that gap cannot be observed [I].

### 1.4 Kit-hash incidents

Files were added under kit paths twice during the round. Both sets were later moved out.

| incident | added | moved out | overlap with execution |
|---|---|---|---|
| `src/judges/kit.mjs` (Kev port-kit interface, 132 lines) | committed under `src/` in `70df598` at 22:42:10. Its commit message says it is "not imported by the runtime" [D] | `880c6b9` at 22:51:44, "move judge kit out of src/ (restores frozen C0 kit hash)" | the records evaluation: process 1 was running, and process 2 started at 22:49:31 |
| `web/run-view/*` (5 files, run-view prototype) | committed in `db730ea` at 23:18:35 | `450ce53` on 10-08 at 07:11:59 | none. No trial ran between 23:17:44 and 07:12:01, and the 07:09:38 resume was refused |

**Evidence that every executed trial ran with the frozen kits** (F `7e8f0f83153c5efb`, B1 `6bc6b06eccf45cae`):

1. **Construction records.** All four F constructions record `kitHash: 7e8f0f83153c5efb` and all four B1 constructions
   `6bc6b06eccf45cae` [M]. Both kit directories under `/opt/foundry-kit/` still pass `kitIntact`. No other kit
   directory was built after 22:07:08 (`KIT.json` mtimes) [M].
2. **The execution gate.** Result rows carry no `kitHash` field [M]. The binding comes from `run-dev.mjs:43` and
   `:63-65`: each execution process hashes the working tree's kit when it starts, and refuses a family
   (`STALE_CONSTRUCTION`) unless every construction's `kitHash` matches [M: code]. Processes 1, 2 and 3 each executed
   their families, so each passed the gate at start [I: code plus logs]. The 07:09:38 attempt shows the gate firing [M].
3. **Process 2.** It passed the gate at 22:49:31, so `src/judges/` was already out of the working tree's `src/` then,
   about 2 min before the commit that recorded the move [I].
4. **The mid-process window.** Only process 1 was running while `src/judges/kit.mjs` existed, which was by 22:42:10 at
   the latest.
   - The F runtime loads `src/` by static import when the process starts (`experiments/lib/arms/foundry-workflow.mjs:7`).
   - No module in `src/` imports `src/judges/`, and `70df598` changed no other file in `src/` [M: git, grep].
   - Process 1 started only one F trial after 22:42:10: F-haiku records s6002 t0 at 22:44:55, which passed [M].
   - B1 scripts and B0 sessions never load the repository's `src/` [I: B1 runs the pinned `solve.mjs` in a sandbox
     with only the gateway; B0 is a CLI session].
   - So the added file could not change any execution [I].
5. **Content check.** `git diff bec44ea HEAD -- src web bin schemas policy skills package.json` is empty [M]. Since the
   freeze, the only commits touching kit paths are the four above [M]. Git cannot rule out uncommitted edits between
   commits; items 2–4 cover that gap [I].
6. **Arm hashes.** Each arm has one hash per family across all rows [M]. The F arm hash covers the workflow's sha and
   the policy hash, not the kit [M: code], so it pins the artifact, not the runtime.

**Conclusion [I, strong]:** no trial executed with a kit other than `7e8f0f83153c5efb` (F) or `6bc6b06eccf45cae` (B1).

### 1.5 Other checks

- **Dev/test overlap** (codefix AUDIT F2).
  - No evaluation task shares a buggy module, visible tests or a bug report with a probe (hashes of the generated
    inputs) [M].
  - codefix s6001 shares its domain (`depot_stock.py`) and its prompt text with probe dev seed 2; its source, tests
    and bug report differ [M].
  - records: all generated inputs differ; all tasks share one prompt template [M].
- **Model journal.** `journal.sqlite` totals $16.8908 over 768 calls. That equals construction gateway spend plus F/B1
  probe and evaluation spend, to four decimals [M]. B0 calls go through the CLI, not the journal.

## 2. Analysis output (verbatim)

`node experiments/c0/analyze.mjs experiments/runs/c0-dev`, re-run on 2026-10-08 at HEAD `c7149b6`. The script's sha256
prefix is `9c6013e6cebd437f`, the frozen value [M].

## Constructions

| family | arm | builder (effort) | artifact | success | probes passed | construction $ | builder $ | gateway $ (cap) | refusals | minutes | score checks | first pass at | nested | void |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| records | F-opus | claude-opus-5-5 (xhigh) | workflow.json | yes | 3/3 | 2.47 | 2.27 | 0.21 (2) | - | 9.6 | 3 | 1 | 0 |  |
| records | B1-opus | claude-opus-5-5 (xhigh) | solve.mjs | yes | 3/3 | 3.46 | 2.10 | 1.36 (2) | - | 11.0 | 3 | 1 | 0 |  |
| records | F-haiku | claude-haiku-5-5 (xhigh) | workflow.json | yes | 3/3 | 1.01 | 0.56 | 0.45 (2) | - | 13.2 | 5 | 2 | 0 |  |
| records | B1-haiku | claude-haiku-5-5 (xhigh) | solve.mjs | yes | 3/3 | 1.37 | 0.57 | 0.80 (2) | - | 16.5 | 8 | 1 | 0 |  |
| codefix | F-opus | claude-opus-5-5 (xhigh) | workflow.json | yes | 3/3 | 2.04 | 1.34 | 0.70 (2) | - | 6.9 | 4 | 1 | 0 |  |
| codefix | F-haiku | claude-haiku-5-5 (xhigh) | workflow.json | yes | 3/3 | 0.90 | 0.21 | 0.68 (2) | - | 7.3 | 3 | 1 | 0 |  |
| codefix | B1-opus | claude-opus-5-5 (xhigh) | solve.mjs | yes | 3/3 | 2.78 | 1.32 | 1.45 (2) | - | 10.8 | 3 | 1 | 0 |  |
| codefix | B1-haiku | claude-haiku-5-5 (xhigh) | solve.mjs | yes | 3/3 | 0.84 | 0.06 | 0.77 (2) | - | 5.8 | 5 | 1 | 0 |  |

## Execution

CPS = all dollars / verified successes; "amortised" includes the construction. Break-even: the number of verified successes after which the construction is repaid against the same model solving directly (B0 of that builder model), "never" if not cheaper per success.

| family | arm | success | rate | pass^2 | exec $/trial | construction $ | CPS exec | CPS amortised | break-even successes vs B0 | NO_ARTIFACT | env faults (retried) | costUnknown | void |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| records | B0-haiku | 4/8 | 0.500 | 0.250 | 0.2030 | 0.00 | 0.4060 | 0.4060 | - | 0 | 0 | 0 | 0 |
| records | B0-opus | 8/8 | 1.000 | 1.000 | 0.6949 | 0.00 | 0.6949 | 0.6949 | - | 0 | 0 | 0 | 0 |
| records | B1-haiku | 8/8 | 1.000 | 1.000 | 0.0579 | 1.37 | 0.0579 | 0.2294 | 3.9 | 0 | 0 | 0 | 0 |
| records | B1-opus | 8/8 | 1.000 | 1.000 | 0.1683 | 3.46 | 0.1683 | 0.6006 | 6.6 | 0 | 0 | 0 | 0 |
| records | F-haiku | 6/8 | 0.750 | 0.750 | 0.0390 | 1.01 | 0.0520 | 0.2206 | 2.9 | 0 | 0 | 0 | 0 |
| records | F-opus | 8/8 | 1.000 | 1.000 | 0.0462 | 2.47 | 0.0462 | 0.3553 | 3.8 | 0 | 0 | 0 | 0 |
| codefix | B0-haiku | 8/8 | 1.000 | 1.000 | 0.0346 | 0.00 | 0.0346 | 0.0346 | - | 0 | 0 | 0 | 0 |
| codefix | B0-opus | 8/8 | 1.000 | 1.000 | 0.3164 | 0.00 | 0.3164 | 0.3164 | - | 0 | 0 | 0 | 0 |
| codefix | B1-haiku | 8/8 | 1.000 | 1.000 | 0.0981 | 0.84 | 0.0981 | 0.2026 | never | 0 | 0 | 0 | 0 |
| codefix | B1-opus | 4/8 | 0.500 | 0.500 | 0.3684 | 2.78 | 0.7367 | 1.4312 | never | 0 | 0 | 0 | 0 |
| codefix | F-haiku | 5/8 | 0.625 | 0.500 | 0.1735 | 0.90 | 0.2775 | 0.4565 | never | 0 | 0 | 0 | 0 |
| codefix | F-opus | 8/8 | 1.000 | 1.000 | 0.1038 | 2.04 | 0.1038 | 0.3586 | 9.6 | 0 | 0 | 0 | 0 |
| ALL | B0-haiku | 12/16 | 0.750 | 0.625 | 0.1188 | 0.00 | 0.1584 | 0.1584 | - | 0 | 0 | 0 | 0 |
| ALL | B0-opus | 16/16 | 1.000 | 1.000 | 0.5056 | 0.00 | 0.5056 | 0.5056 | - | 0 | 0 | 0 | 0 |
| ALL | B1-haiku | 16/16 | 1.000 | 1.000 | 0.0780 | 2.21 | 0.0780 | 0.2160 | 27.5 | 0 | 0 | 0 | 0 |
| ALL | B1-opus | 12/16 | 0.750 | 0.750 | 0.2683 | 6.24 | 0.3578 | 0.8775 | 42.2 | 0 | 0 | 0 | 0 |
| ALL | F-haiku | 11/16 | 0.688 | 0.625 | 0.1062 | 1.91 | 0.1545 | 0.3278 | 485.9 | 0 | 0 | 0 | 0 |
| ALL | F-opus | 16/16 | 1.000 | 1.000 | 0.0750 | 4.51 | 0.0750 | 0.3570 | 10.5 | 0 | 0 | 0 | 0 |

## Paired comparisons (family-clustered bootstrap, 10000 resamples)

CPS ratio < 1 favours A. "finite" counts resamples in which both arms had a success.

| A | B | tasks | success diff [95% CI] | CPS ratio, execution only [95% CI] (finite) | CPS ratio, incl. construction [95% CI] (finite) |
|---|---|---|---|---|---|
| F-haiku | B1-haiku | 8 | -0.313 [-0.625, 0.000] | 1.980 [0.677, 5.037] (10000) | 1.518 [0.776, 3.706] (10000) |
| F-haiku | B0-haiku | 8 | -0.063 [-0.563, 0.375] | 0.975 [0.104, 14.105] (10000) | 2.069 [0.458, 21.398] (10000) |
| B1-haiku | B0-haiku | 8 | 0.250 [0.000, 0.688] | 0.493 [0.090, 3.189] (10000) | 1.363 [0.356, 6.593] (10000) |
| F-opus | B1-opus | 8 | 0.250 [0.000, 0.750] | 0.210 [0.060, 0.388] (9987) | 0.407 [0.114, 0.614] (9987) |
| F-opus | B0-opus | 8 | 0.000 [0.000, 0.000] | 0.148 [0.064, 0.370] (10000) | 0.706 [0.498, 1.279] (10000) |
| B1-opus | B0-opus | 8 | -0.250 [-0.750, 0.000] | 0.708 [0.239, 5.956] (9989) | 1.735 [0.850, 10.450] (9989) |
| F-haiku | F-opus | 8 | -0.313 [-0.625, 0.000] | 2.060 [0.857, 5.059] (10000) | 0.918 [0.497, 2.134] (10000) |
| B1-haiku | B1-opus | 8 | 0.250 [0.000, 0.750] | 0.218 [0.055, 0.408] (9992) | 0.246 [0.064, 0.387] (9992) |
| F-haiku | B0-opus | 8 | -0.313 [-0.625, 0.000] | 0.306 [0.059, 1.644] (10000) | 0.648 [0.264, 2.495] (10000) |

*(End of verbatim output.)*

**Reading notes.**
- **Columns.** "score checks" counts the `/score` calls each builder used (cap 12). "first pass at" is the index of
  the first passing check. Wall time from construction start to the first passing probe check was 2.1–8.1 min [M].
- **The bootstrap** resamples families, then tasks within each family (`experiments/lib/stats.mjs:92-97`) [M]. With
  only 2 families, about a quarter of the resamples contain only records tasks and a quarter only codefix tasks. The
  intervals therefore mostly span the two families' values. At this size they describe spread, not inference [I].
- **"CPS amortised" excludes probe runs.** It adds each construction record's `constructionCostUsd` (builder plus
  gateway smoke calls). The frozen script leaves out the $2.02 of probe-run spend [M: code]. Including it would add
  $0.02–0.07 per success to the constructed arms [M].
- **F-haiku's break-even of 485.9** follows from its execution CPS ($0.1545) being almost equal to B0-haiku's
  ($0.1584) [M].

## 3. Failure diagnoses

| arm | family | failed trials | classification | root cause (one line) | diagnosis |
|---|---|---|---|---|---|
| F-haiku | records | 2/8: s6001 t0 and t1 | construction-defect 2 | The single per-task `conf` read (Haiku, reasoning low, no checks, so its escalation is dead) read BRIGHTDESK's by-example day-first date order as month-first. Every numeric BRIGHTDESK date was then parsed swapped: 42 records instead of 37, score 0.789 | [F-haiku-records.md](diagnosis/F-haiku-records.md) |
| F-haiku | codefix | 3/8: s6001 t0, s6004 t0, s6004 t1 | construction-defect 3 | The builder's API check flags a correct default-value fix as "signature changed". The Opus `repair` prompt says to keep "defaults", and `answer` takes the first candidate that passes the check, so the repair undid the fix or hid it behind `__defaults__` | [F-haiku-codefix.md](diagnosis/F-haiku-codefix.md) |
| B1-opus | codefix | 4/8: s6001 t0/t1, s6004 t0/t1 | construction-defect 4 | The same over-strict default check, plus a fallback that returns the unpatched module whenever a candidate is flagged (`best` starts at the original, score −1; one flag costs −50) | [B1-opus-codefix.md](diagnosis/B1-opus-codefix.md) |
| B0-haiku | records | 4/8: s6001 t0/t1, s6002 t0, s6004 t1 | execution-judgment 4 | Three mechanisms: two near-twin over-merges (2 edits apart, shared phone), one BRIGHTDESK order misread (the agent also overrode its own rule check), and one case of line numbers used as row ids | [B0-haiku-records.md](diagnosis/B0-haiku-records.md) |
| F-opus, B1-haiku, B0-opus (both families); B1-opus records; B0-haiku codefix | – | 0 | – | not diagnosed (no failures) | – |

**Totals:** construction-defect 9, execution-judgment 4, harness/env 0, oracle 0 [D]. In every case the diagnosis
checked the oracle: fixing only the diagnosed decision makes the oracle pass, or the failed output equals a
pre-registered bad control [D].

**Per arm** [D, from the linked diagnoses]:

- **F-haiku records (6/8).** Deterministic as observed. The two `conf` calls were independent live calls, and both
  were wrong. Replaying the artifact's `merge` with only BRIGHTDESK set to day-first scores 1.0 in both trials.
  - The cause is latent in all 6 passing trials. Their notes either stated the order explicitly (6002) or agreed with
    the "US CRM" prior (6003, 6004).
  - All three probes had BRIGHTDESK month-first, so construction could not see the failing case.
  - The builder's own notes call `conf` "a single point of failure".
  - F-opus runs the same read on Opus, requires an evidence quote and has a rule for conventions stated by example.
    The same Haiku builder, writing B1, sent the read to Sonnet with a "worked example decides it" rule. Both passed
    s6001 2/2.
- **F-haiku codefix (5/8).** In every failed trial the first-pass Sonnet `fix` patch was correct; re-scored, it passes.
  - The false flag fired in 4 of 4 trials on the two wrong-default tasks.
  - s6004 failed both trials (deterministic). s6001 failed one of two: in t1 Opus overrode the check.
  - No probe had a wrong-default bug.
  - Counterfactual estimate, not measured: 8/8 at about $0.088 per trial.
- **B1-opus codefix (4/8).** Deterministic: replaying the recorded responses through the unmodified `solve.mjs`
  reproduces all 8 trials byte for byte.
  - All 8 Opus find calls produced patches that score 1.0.
  - In all 16 repair calls Opus kept the documented default, several times saying the check was wrong. The artifact
    gives it no way to dispute a check.
  - The failed trials used all 6 calls and account for $2.12 of the arm's $2.95.
  - The Haiku-built B1 artifact (8/8) checks parameter names only, and its fallback cannot fall below the patched
    candidate.
- **B0-haiku records (4/8).** Stochastic: no failure recurs in the paired trial of the same task. Fixing only the
  diagnosed decision passes in all four (1.0, 1.0, 0.994, 1.0).
  - Both merge errors were on near-twins sharing a phone: 2 of 10 such decisions went wrong, against 0 of 6 for pairs
    without a shared phone.
  - 3 of the 4 passing trials carry 1–2 field errors below the threshold.
  - B0-opus solved 8/8 with zero mismatches, but how it did so is unrecoverable: the runner deletes passing work dirs,
    and B0 writes nothing to the journal.

**Cross-cutting observations.**
1. **Every constructed-arm failure is a construction defect exposed by a case that no probe contained**
   (BRIGHTDESK day-first stated by example; a wrong-default bug) [D]. Construction success (24/24) told us nothing
   about these defects [M].
2. **In 7 of the 9 construction-defect failures, a model produced the right answer and artifact logic discarded it**
   (F-haiku codefix `fix`; B1-opus find calls) [D]. In the other 2 (F-haiku records), the error sat in one unchecked
   node [D].
3. **Three of the four codefix builders wrote a default-value-sensitive signature check** (F-haiku, F-opus, B1-opus).
   The outcome depended on how much authority the check had: 1/4, 4/4 and 0/4 on the wrong-default trials. F-opus's
   8/8 hides the same latent defect [D].
4. **No F run verdict detected a failure.**
   - All four F workflows accept on `exists` alone, and their verify nodes are structural and non-blocking. The
     verdict was `pass` on 32/32 F trials, including the 5 that failed the oracle [M].
   - The kit asks for exactly this kind of verify node: "a `verify` node (method `code`) that checks structural
     invariants of the answer" (`skills/micro-harness/SKILL.md:39-40`) [M].
5. **Retention gap.** The runner deletes passing trials' work dirs (`experiments/lib/runner.mjs:86`), and B0 sessions
   are not journaled [M: code]. As a result, passing B0 trials (including all 16 B0-opus trials) cannot be examined
   [D].
6. **Bed observation (unverified).** On all 4 records test tasks, the true BRIGHTDESK and ATLAS orders gave strictly
   fewer records than the flipped orders. A solver might therefore choose the orders without reading the notes. This
   should be tested as an attack in `beds/records/attacks/` [D: F-haiku-records.md].

## 4. Interpretation within the pre-registered rules

**Rules that apply.** PREREG-dev has no section titled "decision rules". The operative rules are:
- §4: "far below the power needed for success differences (R05 §3): **directional only**; no claim is made from
  this round".
- ROADMAP §4.3: "No K=1 comparative claims. Gaps under 3 points are noise."
- Power: "+10-point success difference needs about 116–234 paired tasks" [D]. This round has 8 paired tasks per
  comparison: 2 of 5 families, 4 tasks × K = 2 per family.
- Construction is K_c = 1 per cell. Each F-vs-B1 comparison therefore compares two single builds, and builder variance
  (PREREG §7) is confounded with the condition [I].
- Everything below is development evidence and makes no claim.

### Directionally supported

1. **F-opus executes much cheaper than B0-opus at equal success.**
   - 16/16 vs 16/16, at $0.075 vs $0.506 per trial; execution CPS ratio 0.148 [0.064, 0.370] [M].
   - Latency: mean 21 s vs 116 s [M].
   - In records, one Opus `config` call per trial is 90% of F-opus's execution cost ($0.334 of $0.370) [M].
2. **F-opus is cheaper than B1-opus, both to build and to run.**
   - Construction: $2.47 vs $3.46 (records), $2.04 vs $2.78 (codefix) [M].
   - Execution in records, where both arms solved 8/8: $0.046 vs $0.168 per trial [M].
   - CPS ratios: 0.210 [0.060, 0.388] execution only; 0.407 [0.114, 0.614] including construction [M].
   - The success difference (+0.25) is entirely B1-opus's codefix defect, and F-opus carries the same over-strict
     check in latent form. That gap therefore says nothing about the substrate [D/I].
3. **A well-built constructed solver removes the direct Haiku agent's records failure modes.**
   - B1-haiku, F-opus and B1-opus each solved records 8/8, against B0-haiku's 4/8 [M].
   - Three of B0-haiku's four failures are of kinds that code-backed execution removes: two identity-rule errors made
     by hand and one row-id bookkeeping error [D].
   - F-haiku's 6/8 is the counterexample: its one unchecked Haiku read fails in the same way B0-haiku did once.

### Not supported

1. **"F helps the weak builder more than scripts do."** The data point the other way:
   - F-haiku 11/16 vs B1-haiku 16/16: success difference −0.313 [−0.625, 0.000]; execution CPS ratio 1.980
     [0.677, 5.037] [M].
   - Both F-haiku defects come from choices made in the F substrate [D]:
     - records: a declarative escalation with no trigger;
     - codefix: a repair node told to obey a builder-written check.
2. **"Even Haiku constructs a workflow as good as Opus solving directly."** F-haiku vs B0-opus: −0.313
   [−0.625, 0.000] [M].
3. **The F run verdict as a success signal.** It flagged none of the 5 oracle failures [M].
4. **Any success-rate difference as a finding**, given the power above [D].

### Ambiguous

1. **F-haiku vs B0-haiku.** 6/8 vs 4/8 on records, 5/8 vs 8/8 on codefix: opposite signs. Overall −0.063
   [−0.563, 0.375]; execution CPS ratio 0.975 [0.104, 14.1] [M].
2. **F-opus vs B0-opus including construction.**
   - CPS ratio 0.706 [0.498, 1.279] [M].
   - Break-even comes at 3.8 successes (records) and 9.6 (codefix). For codefix that is beyond the 8 trials here [M].
3. **The builder-model effect.**
   - B1-haiku beat B1-opus: 16/16 vs 12/16; CPS ratio including construction 0.246 [0.064, 0.387] [M].
   - F-opus beat F-haiku: 16/16 vs 11/16 [M].
   - Each difference traces to one design choice in one K_c = 1 build [D].
   - The Haiku builds cost $4.11 in total, the Opus builds $10.75 [M].

### Codefix at d3 does not discriminate

- B0-haiku solved 8/8 at $0.0346 per trial, the cheapest arm in the round; B0-opus also solved 8/8 [M].
- All 7 codefix failures are construction defects in constructed arms [D].
- Break-even against B0 is "never" for B1-haiku, B1-opus and F-haiku. F-opus breaks even against B0-opus after 9.6
  successes, but per trial it costs 3× what B0-haiku does [M].
- At this difficulty the family measures only whether a construction **introduces** defects, not whether
  construction adds capability [I].

Records at d3 discriminates among the Haiku-level arms (B0-haiku 4/8, F-haiku 6/8, B1-haiku 8/8), but not among the
Opus-level arms, which all scored 8/8, B0-opus included [M].

## 5. Costs (from the ledgers)

| item | ledger | $ |
|---|---|---|
| Constructions (8): builder sessions | `constructions.jsonl` `builderCostUsd` | 8.4351 |
| Constructions (8): gateway smoke calls | `constructions.jsonl` `gatewayCostUsd` | 6.4263 |
| **Constructions, total** | `constructionCostUsd` | **14.8614** |
|   records / codefix | | 8.3144 / 6.5471 |
|   Opus builders (4) / Haiku builders (4) | | 10.7476 / 4.1138 |
| Probe runs (24) | `probes.jsonl` | 2.0223 |
| **Evaluation (96 trials)** | `results.jsonl` | **18.4336** |
|   B0-opus / B0-haiku | CLI-reported | 8.0902 / 1.9013 |
|   B1-opus / F-haiku / B1-haiku / F-opus | journal | 4.2934 / 1.6997 / 1.2487 / 1.2004 |
|   records / codefix | | 9.6752 / 8.7585 |
| **Total recorded** | | **35.3174** |
| Unrecorded: 3 B0 sessions killed at interruption 1 | none | ≤ 4.00 (estimate 0.3–1.0) [I] |

All rows [M] except the last.
- **Journal reconciliation.** Construction gateway spend + F/B1 probe spend + F/B1 evaluation spend = $16.8908, the
  journal total over 768 calls [M]. B0 spend ($9.99) is CLI-reported and not in the journal [M].
- **Against the plan.** Pre-registered estimate ≈ $200 for all five families; kill rule $350 [D]. The two families cost
  about 10% of the kill threshold [M].
- **Not in any ledger.** The development agents that wrote the diagnoses and this report are outside the experiment
  (PREREG §2) [D].
- **Construction time.**
  - Builder sessions took 5.8–16.5 min of the 45 allowed [M].
  - The Haiku builders produced about 2–5× more output tokens than the Opus builders on the same family (mostly
    thinking: 40k–105k vs 7.5k–24k thinking tokens), yet cost less [M].

## 6. What this changes for the plan

### 6.1 Haiku-as-constructor gaps, and what would have prevented each defect

Everything in this section is a proposal [I] derived from the diagnoses. Kits and artifacts are frozen for this round.
Any kit change for the sealed round is an amendment, must go **symmetrically** into `skills/micro-harness` and
`skills/script-harness` (PREREG §2, ±15%), and must pass the literal scan for family strings. The fixes therefore have
to be phrased generically, never in bed terms such as "dates" or "defaults".

| defect (arm, builder) | what would have prevented it | kind |
|---|---|---|
| A single per-task configuration read on class M at reasoning `low`, with no checks. Its `maxClass: L` / `onCheckFail: escalate` can never fire (F-haiku records, Haiku) | (a) `foundry validate` warns about escalation configured on a node with no `checks`. (b) A kit operator or template for a **global configuration read**, meaning one read that conditions every item: a verbatim evidence quote per decision, an explicit rule for conventions stated only by example, and k-sample agreement or a stronger class. (c) An executable consistency check used as an escalation trigger, for example re-running the deterministic stage with the convention flipped. It is unvalidated, derived on inspected seeds, and must be tested on dev seeds first. (d) A construction-time self-test: flip each per-task convention in a probe copy and confirm the solver follows the notes. (e) An exception in `micro-harness/SKILL.md:41-44` ("Start every agent node at the cheapest class …") for reads of this kind | validator, template, self-test, kit text |
| A builder-written check stricter than the task contract, a repair told to obey it, and selection that takes the first candidate passing the check (F-haiku codefix, Haiku) | (a) A kit rule: every builder-written check names the task-contract clause it enforces and is never stricter. (b) A selection template: score every candidate, the original included, with one function that counts positive evidence. A heuristic check may demote a candidate but never veto one that passes more evidence. Repairs get a typed way to contest a check. (c) A self-test: feed each check a known-legitimate change of every defect class the task documents name, and exercise every repair and fallback branch once. (d) Probes that cover every defect class | kit text, template, self-test, protocol |
| The same over-strict check, plus a fallback that emits the unpatched original (B1-opus codefix, **Opus**) | As above, plus a fallback rule: never emit the original when a candidate is strictly better on every measured axis except a disputed check. `script-harness/SKILL.md:58` already says "always print the best complete answer" [D], but nothing checks it | template, self-test |
| The same check, latent (F-opus codefix, **Opus**) | As above | – |
| Acceptance is `exists` alone and the verify node is structural only (all 4 F workflows, both builders) | A validator warning when acceptance has no predicate that a well-formed but wrong answer can fail. Kit text asking for at least one such consistency check | validator, kit text |

**Is this a Haiku problem? [I]**
- **Mostly not.** Two of the three defect types also appear in Opus builds; the over-strict check appears in F-opus and
  B1-opus.
- **The one Haiku-specific defect follows the kit's wording.** The cheapest-class configuration read without a check
  in F-haiku records applies the kit's "cheapest model first" sentence literally. In B1 the same Haiku builder routed
  that read to Sonnet with an explicit worked-example rule [D].
- **Haiku can construct.** The Haiku builders delivered 4/4 artifacts that passed every probe, for $4.11 against $10.75
  for Opus. B1-haiku solved 16/16 [M].
- **The gaps are therefore mostly kit, template and validator gaps.** The F substrate is the cheaper place to close two
  of them, because escalation and acceptance are declarative and so can be checked statically. That advantage is not
  yet used.

### 6.2 Protocol amendments proposed for the sealed round [I]

1. **Retain everything.** Keep the work dir, transcript and answer for every trial, passing or not, B0 included. Today
   `runner.mjs:86` deletes passing trials' work dirs.
2. **Charge in-flight work across interruptions.** Write an "in flight" ledger entry when a trial or session starts and
   settle it when it ends; a resume charges unsettled entries at their bound. This closes the interruption-1 gap
   (§1.3).
3. **Re-check the kit hash before each trial**, not only when the process starts. Keep non-kit work out of `src/` and
   `web/` while a C0 run is live, or narrow the kit allowlist. This closes the mid-process window in §1.4.
4. **Choose probes for coverage by a generic criterion.** Every per-task convention value and every defect class should
   appear in some probe, with probes chosen from dev seeds only.
5. **Keep a registry of inspected seeds.** It should list records and codefix seeds 6001–6004 at d3, and the analysis
   should refuse inspected seeds in a sealed run.
6. **Fix the PREREG-dev records.** Correct the header and the freeze timestamp, and add a dated amendment recording the
   inspected seeds.
7. **K_c ≥ 2 per cell**, as already planned (PREREG §7, DESIGN §6). With K_c = 1, every F-vs-B1 difference in this
   round traces to a single build.

### 6.3 Which families next, and at what difficulty [I unless marked]

- **incident, synth and kinetics.** Run them at d3 as pre-registered once their audits are complete [D: Amendment #4].
  Before each family's freeze, run B0-haiku and B0-opus on 4–8 dev seeds (not probes 1–3, not test seeds) to check that
  d3 discriminates. If B0-haiku solves ≥ 7/8, move that family to d4 by an amendment before its first construction.
- **codefix.** Use d4 or d5 in any further construction round. The bed's own known limits already recommend d4/d5
  because of dev/test overlap at d1–d3 [D: `beds/codefix/README.md:255-258`]. Use fresh test seeds and probes that cover
  all six mutation operators, including wrong-default.
- **records.**
  - Keep d3: it discriminates among the weak-builder arms.
  - Add d4 to separate the Opus-level arms, which are all at the ceiling at d3 [M].
  - Use fresh test seeds.
  - Test the parsimony attack (§3, observation 6) on dev seeds first.
- **Sealed families** (`beds/sealed/`). The claim-bearing round, with K_c = 2 [D: DESIGN §4, §6].

### 6.4 C1 input: workflows for assignment search

The C1 design takes its workflows from the C0 F arms built by the Opus builder [D: `research/distill-20261007/DESIGN.md` §2].

1. **Primary: `artifacts/F-opus-records-k1/workflow.json`** (sha256 `43266d74…70d8`; 8/8; $0.046 per trial) [M].
   - **Agent nodes:**

     | node | class | reasoning | calls per trial | cost per call | share of execution cost |
     |---|---|---|---|---|---|
     | `config` | F | low | 1 | $0.042 | **90%** |
     | `countries` | M | none | 1 | $0.0003 | – |
     | `vendex/extract` | M | none, 1 check | about 3 | $0.0013 | – |

   - **The search lever and the known risk are the same node** [D]. `config` holds 90% of the cost, and moving it to
     class M is exactly the F-haiku-records failure: Haiku misread the by-example day-first note in 2/2 calls, and
     B0-haiku in 1/2.
   - **Requirements** [I]:
     - The screening and reference seeds (C1 uses dev seeds 101–116) must include notes that go against the "US" prior
       and state the convention only by example. Otherwise leaf agreement will pass class M falsely, as the F-haiku
       probes did.
     - Prefer a cascade to a single assignment: class M with an evidence quote and a consistency trigger, escalating
       to F on disagreement.
     - Validate the consistency trigger on dev seeds first.
2. **Conditional: `artifacts/F-opus-codefix-k1/workflow.json`** (sha256 `cd84006a…7098`; 8/8; $0.104 per trial;
   agent nodes `audit` and `review`, both class L at reasoning medium, about $0.05 per call) [M].
   - **Not at d3.** B0-haiku solved 8/8 at $0.035 per trial, cheaper than this workflow, so no assignment of it can
     show a C1 win over cheap direct solving at d3 [M/I].
   - **At d4/d5, after checks.** Use it there only after confirming on dev seeds that it still passes, and record its
     latent default-value check as a known defect [D].
3. **Not inputs.**
   - The F-haiku artifacts carry known construction defects. They are usable only as negative controls (an M-class
     configuration read without a check).
   - The B1 artifacts have no typed nodes to assign models to [D: C1 design §2].
4. **Updates the C1 pre-registration needs.**
   - The C1 design still names Haiku 4.5 as the cheap executor; the session policy now uses Haiku 5.5 [M: read].
   - Keep B0-haiku as a baseline in every C1 family: codefix d3 shows that a cheap direct agent can beat every
     workflow [M].
   - C1's dev seeds 101–116 do not overlap the inspected seeds 6001–6004 [M].

## 7. Remaining unknowns

- **Construction variance.** One build per cell cannot separate the substrate (F vs B1) from builder variance.
- **The incident, synth and kinetics families have not run.** Every number here comes from 2 families.
- **B0-opus's method cannot be examined** (all trials passed, so their work dirs were deleted). So is the method in
  B0-haiku's passing trials.
- **Model-level rates are estimated from very few calls.** For example, Haiku misread the by-example note in 3 of 4
  observed readings on one task [D].
- **The parsimony attack on records has not been tested** on dev seeds.
- **The cost of the 3 killed B0 sessions** is known only within a bound.

## Reproduce

    node experiments/c0/analyze.mjs experiments/runs/c0-dev          # §2 tables
    node research/freeze.mjs experiments/c0 experiments/lib skills/micro-harness skills/script-harness \
      policy/models.json src beds/records beds/codefix beds/lib beds/CONTRACT.md   # combined sha256 7df51446…
    node -e 'import("./experiments/lib/kit.mjs").then(m=>console.log(m.kitHash(), m.kitHash({allow:m.SCRIPT_KIT_ALLOW})))'

Run files: `experiments/runs/c0-dev/{constructions,probes,results}.jsonl`, `journal.sqlite` (read from a copy) and
`execute-records-codefix{.1,.2,.3,}.log`. No `voided.jsonl`, `construction-faults.jsonl`, `*.faults.jsonl` or
`kill.jsonl` exists.
```

Files referenced:
- Intended report path: `/home/user/workflow-foundry/research/construction-20261006/REPORT-dev.md`
- Diagnoses:
  - `/home/user/workflow-foundry/research/construction-20261006/diagnosis/F-haiku-records.md`
  - `/home/user/workflow-foundry/research/construction-20261006/diagnosis/F-haiku-codefix.md`
  - `/home/user/workflow-foundry/research/construction-20261006/diagnosis/B1-opus-codefix.md`
  - `/home/user/workflow-foundry/research/construction-20261006/diagnosis/B0-haiku-records.md`
- Run data: `/home/user/workflow-foundry/experiments/runs/c0-dev/`
- Scratch copies of the journal and the check scripts: `/tmp/claude-0/-home-user-workflow-foundry/d3c9fb19-46ab-5a0c-bfdd-4f8b7871088a/scratchpad/`

## 8. Independent check (2026-10-08)

The independent checker re-ran `analyze.mjs`, recounted every per-arm total from the raw jsonl (all agree), spot-checked two diagnoses per arm against the journal and work directories (all held), and corrected seven overstatements in the diagnosis files (sample sizes added; K_c = 1 comparisons reworded). It required these caveats, which apply to every number above:
- **Seeds:** test seeds 6001–6004 at d3 of records and codefix are now INSPECTED and must never be held out again. `PREREG-dev.md:17` still says "never inspected" and needs a dated amendment.
- **No claim:** PREREG §4 says "directional only; no claim is made from this round". The construction count is K_c = 1 and this is development evidence.
- **Bootstrap:** the "family-clustered" bootstrap has only 2 clusters, so its confidence intervals are degenerate. For example, F-opus vs B0-opus gives [0, 0].
- **Gap size:** one trial is 6.25 points of a 16-trial rate and 12.5 points of an 8-trial family rate. In CPS execution only, F-haiku (0.1545) vs B0-haiku (0.1584) is a near-tie, which is why the break-even comes out at 485.9.
- **Codefix ceiling:** B0-haiku and B0-opus both score 8/8, so codefix can only show losses, not gains.
- **Kit incidents:**
  - The Foundry construction kit's hash (`7e8f0f83153c5efb`) was changed twice during the round.
    - First, `src/judges/kit.mjs` entered at about 22:42 and was moved out at 22:51 in commit `880c6b9`. The commit says it was not imported by the runtime.
    - Second, the run-view prototype was put in `web/`. The resume at 07:09 (`execute-records-codefix.3.log`) then skipped both families as "another protocol version". Commit `450ce53` restored the kit at 07:11:59.
  - Recorded hashes are consistent, so no trial ran on a different kit.
- **Restarts:** there were three.
  - After `.1.log`, which ends at 22:46:52.
  - The owner stop after the codefix probes at 23:17. The codefix test trials then ran about 8 hours later, 07:12–07:30 on Oct 8.
  - The refused resume at 07:09.
  - Any B0 session in flight at a stop would leave no record, because B0 does not write to the journal. This cannot be verified either way.
- **Builder vs executor models:** the Haiku-built arms do not run on Haiku. F-haiku codefix uses Sonnet and Opus only. B1-haiku codefix uses Opus and Sonnet. F-opus records uses Opus for one config call and Haiku for the rest.
- **False passes:** all 32 F trials report run verdict "pass", including the 5 that failed. The workflows' acceptance checks only test that an output exists.
- **Paths outside the sandbox:** both B1 codefix constructions read paths outside their workdir (`/opt/node24/bin`), which PREREG §5 says needs a manual review.
- **Lost evidence:** passing trials' work directories were deleted, so there are no transcripts for B0-opus or for passing B0-haiku trials.
- **Probe coverage:** no probe contained a wrong-default bug (codefix), and every probe had BRIGHTDESK as MDY (records). Both failure causes went untested during construction.
- **Counterfactuals:** the F-haiku codefix and B1-opus codefix "would have scored 8/8" figures are replays, not measurements. The B1-opus one also feeds an empty list in place of an audit call that was never recorded.
