# Preregistration skeleton: need router v1 (claims C7a and C7b)

Status: **skeleton, not frozen.** Written 2026-10-14 from [DESIGN.md](DESIGN.md). It becomes
`research/need-router-20261014/PREREG-NEED-V1.md` when every TBD in §13 marked "M0" is resolved. That file is
committed before any NL0 label is paid for. A dated addendum fixing the router artefact (§6) is committed at Freeze,
before any held-out label exists. Nothing here is evidence.

Evaluation grades used below: **development** (TRAIN jobs, M1, NL0, NL1, archived LEGACY rows; used to build and
tune), **held-out** (NL2, NL2b, E2E; families never used for tuning), **sealed** (NL3; run once by a session that
tuned nothing). Tests used to improve the router or the builders are development evidence, never held-out.

---

## 1. Claims and hypotheses

- **C7a (need detection).** Whether a job needs a workflow can be read before execution from its structure
  (input size, fan-out) and its declared hard requirements.
- **C7b (routing value).** A need router beats the best fixed mode (chosen on TRAIN) on held-out families in
  utility per task, with calibrated slider positions (ROADMAP:805, restated).
- **H0 (structural rule, primary for C7a).** `intrinsic(x) = logInputTokens(x) ≥ θ_tok OR maxListLength(x) ≥ θ_fan`,
  plus the hard guard. Everything else about need is declared economics (N, V, W, executor strength).
- **H-test (workflow self-testing).** A built workflow's own check rejects most of its wrong answers. Falsified per
  lineage by F11.
- **Co-primary policies for C7b:** NR-static (guard, rule, leaf calculator; no model call before the work) and
  NR-probe (the same plus a value-of-information probe on one example). Holm over the two.

Hypotheses table: one row per job (§3) with the expected best class and mode at (V = $1, W = V, N = 1) and
(V = $1, W = V, N = 10), written and committed before any label of that job is viewed. **TBD-M0.**

## 2. Unit and populations

- **Unit:** a job = (family, difficulty band, N, V, W, verifier, typed hard requirements). One decision per job,
  before the work; pinned.
- **Primary population:** non-forced held-out jobs, L_today labels.
- **Forced stratum:** jobs with a typed hard requirement (runbook, E8). Reported separately; guard recall only.
- **Weights:** each held-out cluster weighs 1; jobs within a cluster weigh equally.

## 3. Families, clusters, splits, seeds

Cluster rule: families that share a world, generator or library (by import graph) form one cluster and stay in one
split. Cluster W = {records, wbed-r0 … r6 and their new variants}. r3p is its own cluster, flagged "near".

| Split | Cluster | Jobs (band) |
|---|---|---|
| TRAIN | W | records-lo (d1–2), records-hi (d3–5), wbed-r0 (d2–5), r0-pad, wbed-r1-hi (d3–5), wbed-r2-hi (d3–5), wbed-r3-hi (d4–5), r3-mini, wbed-stage, wbed-r6 (d3–4) |
| TRAIN | kinetics | kinetics-lo (d1–3), kinetics-hi (d4–5) |
| TRAIN | codefix | codefix (d3–5), codefix-notests (d3–5) |
| TRAIN | need-qa | need-qa |
| HELD-OUT | incident | incident (d2–4) |
| HELD-OUT | synth | synth-lo (d1–2), synth-hi (d3–5) |
| HELD-OUT | ownerci | ownerci (d3–5) |
| HELD-OUT | r3p (near) | r3p (d3–5) |
| HELD-OUT | need-constraint | need-constraint |
| HELD-OUT | far-1, far-2 | TBD-OWNER (decision 11) |
| HELD-OUT (conditional) | gameqa | gameqa (band TBD-M0) |
| FORCED | runbook, E8 | runbook (band TBD-M0); E8 from in-flight runs, diagnostic only |
| SEALED | 4 sealed families; owner tasks | TBD-OWNER; not read by any session that tunes |

Admission: a held-out family enters only after an audit by a session that did not write it, completed before its
labels are viewed. gameqa and runbook lack AUDIT.md. **TBD-NL2b.**

Seeds (new ledger purposes, owner's file; held-out ranges ≥ `heldoutMinSeed` 8001):

| Purpose | Split | Range | Use |
|---|---|---|---|
| need-example | dev | 601–603, 604–606, 607–609 | example sets 1–3 |
| need-label | dev | 610–621; 622–650 reserve | TRAIN evaluation tasks; top-ups and collision replacements |
| need-heldout | test | 8801–8812; 8813–8824 reserve | held-out evaluation tasks; replacements |
| need-heldout | test | 8825–8836 | E2E lane |
| need-heldout | test | 8837–8848 | monthly drift re-check |

M1 uses the W-bed attack seeds (dev 379–390; r3p 479–490), already in the ledger. Every runner calls
`assertSeedsAllowed` for every task (L4).

## 4. Arms and replication

| Arm | Definition | Hash | Replicates |
|---|---|---|---|
| direct-H | `b0Call({model:'claude-haiku-5-5', reasoning:'none', maxTokens:16000})`, 600 s per-call timeout, timeout charged at $1 | TBD-M0 | 2 draws |
| agent-H | `b0Agent({model:'claude-haiku-5-5', budgetUsd:2, timeoutMs:900000})` | TBD-M0 | 2 draws |
| agent-O | `b0Agent({model:'claude-opus-5-5', budgetUsd:4 (8 if example inputs > 30K tokens), timeoutMs:1200000})` | TBD-M0 | 1 draw + racing top-up |
| agent-H+proc | procedure writer (one Haiku call, `reasoning:'medium'`, example set k, no answers) + agent-H with `PROCEDURE.md` | TBD-M0 | K = 2 lineages |
| construct-H | `construct({arm:'B1', builderModel:'claude-haiku-5-5', builderEffort:'high', builderBudgetUsd:3, constructionModelUsd:1.5, perTaskUsd:1, minutes:30, scoreChecks:0, selfCheck:true, probeSeeds:<set k>})` + `b1Script({perTaskUsd:1})` | TBD-M0 | K = 3 lineages |
| build-O (ceiling) | construct-H with `builderModel:'claude-opus-5-5'`, `builderBudgetUsd:8` | TBD-M0 | K = 1 |
| R1, R3 references (ceiling) | `static@v3:` with live judges, only if the engine stamp carries it | TBD-M0 | 1 draw |
| Derived cascades | construct-H→agent-H (null, crash, schema-invalid, self-check fail); direct-H→agent-H; agent-H→agent-O (null) | – | from paired rows |

Engine kit and stamp: **TBD-M0** (ROADMAP §6 rule 13). Model ids come only from `policy/models.json`.

**Racing rule.** After the first pass, any job with P(best class) < 0.8 gets one more replicate for each mode in its
acceptable set, up to 4 per mode. agent-O gets a second draw on every task where it is in the draw-1 acceptable set.
No new tasks are added for top-ups.

## 5. Label protocol

- **Row fields:** `pass, score, delivered, schemaValid, selfVerdict, deployableVerdict, usdReported, usdRepriced,
  usdImputed, ms, tokens, error`. Build rows: `usd, minutes, artifactSha, failed, runSolverCalls, hiddenPathAttempts,
  nestedModelAttempts`.
- **Utility per task:** `u_m = p_m − c_m/V − B_m/(N·V) − (W/V)·q_m − r/(N·V)`; q = delivered, schema-valid, wrong.
- **Grid:** V ∈ {0.10, 1, 10}; N ∈ {1, 10, 100} (100 labelled extrapolated); W ∈ {V (headline), 0, 10V}; λ_t = 0
  (headline) and TBD-OWNER (sensitivity).
- **Costs:** one meter — every row re-priced from recorded tokens with the pinned price table (**TBD-M0**); timeouts
  and killed sessions at their bound; measured and imputed split; a cell with > 30% imputed dollars is unlabelled.
- **VBS\*:** select on replicate 1, score on replicate 2 (construct-H: select on two lineages, score on the third,
  rotating); seed-parity task halves; two-direction average as a sensitivity.
- **Acceptable set:** A = {m : u_m ≥ u_max − 0.03}; ties to the cheaper mode.
- **NEED label:** `workflow` / `no-workflow` when every member of A is in one class; otherwise `either`.
- **Confidence:** hierarchical bootstrap (cluster → task → replicate or lineage; 2,000 reps; seed TBD-M0); confident
  when P(best class) ≥ 0.8. Coverage is always reported.
- **Fragility:** labels recomputed at half and double each numeric oracle tolerance; flipped jobs are excluded from
  need accuracy, kept in utility, counted. Per-family tolerance list **TBD-M0**.
- **Label sets:** L_today (construct-H, agent-H+proc) primary and used for training; L_ceiling (adds build-O and
  references) reported.
- **Self-test:** per lineage, false-pass P(self pass | oracle fail) and false-fail P(self fail | oracle pass), with
  Clopper–Pearson intervals.
- **Validity gates:** R0 control ≥ 10/12; env faults ≤ 25% per arm; `taskHash` pairing; example–evaluation hash
  disjointness; automatic void on hidden-path or nested-model attempts; ownerci copied-module scan.
- **LEGACY:** archived P1, C0, JIT and Stage B rows are never pooled with new labels.

## 6. The router as a frozen artefact (addendum at Freeze)

| Item | Value |
|---|---|
| Feature whitelist | `logInputTokens, logSchemaLeaves, itemLists, maxListLength, freeText, multiSource, conventionsInProse, verifiable`, median over example set 1 at the job's band; for N = 1 owner tasks, the task itself |
| Banned inputs | family id, bed version, `kind`, oracle, reference, label or result files (L5) |
| Guard | typed requirements → workflow class; word cues only raise "ask the user" |
| θ_tok, θ_fan | **TBD-FREEZE**: fitted by leave-one-cluster-out on TRAIN to maximise balanced accuracy of confident N = 1 labels; ties → larger θ |
| Leaf modes per (V, N, W) cell | **TBD-FREEZE**: best mean TRAIN utility within each leaf |
| NR-probe | `voi.mjs bestProbe`; probeable {direct-H, agent-H}; kMax 2; example 601; Beta(1 + s, 1 + n − s) priors from TRAIN jobs in the leaf; deployable signals only; probe iff net EVSI > 0; mapping from deployable pass to success **TBD-FREEZE** |
| NR-knn (secondary) | k ∈ {3, 5} by LOCO on TRAIN, **TBD-FREEZE** |
| judge-H (secondary) | prompt and schema **TBD-M0**; 3 draws, majority |
| Shas | `features.mjs`, `router.mjs`, `voi.mjs`, `metrics.mjs`, `evaluate.mjs`, price table: **TBD-FREEZE** |
| Envelope | `evaluate.mjs --commit-decisions` writes every held-out decision; its hash is committed before the held-out matrix is joined (L6) |

## 7. Metrics

**Headline cell:** V = $1, W = V, N = 10, L_today, non-forced held-out jobs.

**Primary for C7b:** Δ = mean over held-out clusters of (u_policy − u_SBS-train), for NR-static and NR-probe.
Inference: exact one-sided sign-flip permutation test over cluster-level Δ; interval by test inversion at the
Holm-adjusted level (97.5% for the first hypothesis, 95% for the second); seeded cluster bootstrap (10,000 reps) as a
sensitivity.

**Primary for C7a:** balanced accuracy of H0's need call against confident N = 1 labels on held-out jobs, with
Wilson intervals and coverage; compared with the majority class and the tuned size rule.

**Secondaries, fixed order, all marked "not primary":**
1. The same Δ at V = $0.10 and $10; at W = 0 and 10V; at N = 1 and 100; on L_ceiling; with r3p dropped.
2. Value decomposition: always-agent-H → SBS-global → SBS(V, N) → router → VBS\*.
3. Closed gap and regret against VBS\*.
4. C7a at N = 10; precision and recall of the workflow class; precision at assumed no-workflow base rates of 50, 80
   and 95%.
5. Mode accuracy within the acceptable set; the three-way class split.
6. Slider calibration at N = 10: predicted against realised success (±0.10) and $ per task (±30%).
7. Routing cost as a share of task cost.
8. NR-knn, judge-H, NR-probe-oracle, checkpoint re-route, online replay (Holm within this family).
9. Self-test false-pass and false-fail rates per arm and lineage.
10. Co-failure of direct-H and construct-H against independence.
11. E2E: realised against predicted success and $; override count and direction.

## 8. Decision rule

**Gate G1 (TRAIN, after NL1)**, on cross-fitted VBS\* − SBS headroom per (V, N) cell at W = V:
upper bound < 0.03 and < 20% of cost in every cell → REFUTED-PREMISE (stop paid labelling; ship the fixed policy,
the guards and the calculator); lower bound > 0 in some cell at V = $1 → continue; otherwise the owner decides.

**Readings, per co-primary policy:**

| Reading | Condition |
|---|---|
| SUPPORTED | lower bound of Δ > 0; point ≥ 0.03; beats the tuned size rule and judge-H (paired lower bound > 0); slider calibrated (≤ 1 of 3 positions misses; realised success and $ per task non-decreasing in V); sign holds with r3p dropped. "Useful size shown" only if the lower bound ≥ 0.03. |
| SUPERIOR, BELOW USEFUL EFFECT | lower bound > 0; point < 0.03 |
| REFUTED | upper bound < 0.03 at all three V, or G1 refuted |
| HARMFUL | upper bound < 0 at any V; that position is disabled |
| INCONCLUSIVE | anything else; the owner decides; achieved power printed |

**C7a reading:** SUPPORTED-DIAGNOSTIC if H0's balanced-accuracy lower bound exceeds both the majority class and
the tuned size rule's point estimate, with coverage ≥ 50%; claim grade only at the thresholds of decision 16
(TBD-OWNER). REFUTED if F12 trips. Otherwise INCONCLUSIVE.

**Partial readings:** NR-static fails, NR-probe SUPPORTED → "a one-example probe is required"; C7a holds, C7b does
not → "need is detectable but routing on it does not pay at these values"; more than 50% of held-out jobs
unconfident → "the benchmark cannot separate routers".

## 9. Falsifiers

F1 G1 refuted. F2 held-out Δ upper bound < 0.03 at every V. F3 no win over the tuned size rule or judge-H.
F4 the gain vanishes without guard-forced jobs. F5 metamorphs flip > 20% of routes whose labels do not flip.
F6 any leak test L1–L8 fails (blocks every claim). F7 slider uncalibrated or non-monotone. F8 in a mixed-stream
replay no slider setting dominates both always-no-workflow and always-construct. F9 owner-task regret worse than SBS
(upper bound < 0). F10 gain on near families only. F11 a build path's self-check false-pass > 0.2 with ≥ 10 oracle
failures (that path is not deployable). F12 H0's held-out N = 1 balanced-accuracy lower bound ≤ 0.5.

## 10. Power

- **Exact floor.** One-sided sign-flip test over n clusters: smallest p = 2^−n. Holm's first step needs p ≤ 0.025.
  n = 5 → 0.031 (cannot pass); n = 6 → 0.016; n = 7 → 0.0078; n = 8 → 0.0039.
- **Interval width.** A t-type interval over 7 clusters has half-width about t(0.975, 6)·σ/√7 ≈ 0.93σ, where σ is the
  between-cluster SD of Δ. A half-width of 0.03 needs σ ≤ 0.032. If σ = 0.10, only effects above about 0.09 are
  detectable [I].
- **Power gate (after NL1).** Estimate σ by leave-one-cluster-out on TRAIN. If the projected half-width exceeds
  0.03, either add clusters (far families, gameqa, owner tasks) or accept an expected INCONCLUSIVE, recorded before
  NL2. **TBD-NL1.**
- **Simulation (M0).** Synthetic matrices with planted optima at the planned sizes: false SUPPORTED ≤ 5% under the
  null; the probability of SUPPORTED at planted Δ = 0.03, 0.08 and 0.15. **TBD-M0.**
- **C7a.** With 8–12 confident held-out jobs, a Wilson interval on balanced accuracy is about ±0.25 wide [I]; C7a
  at this size is diagnostic.

## 11. Kill and stop rules

- **K1** G1 refuted → stop paid labelling after NL1; report C7a on TRAIN as development evidence.
- **K2** direct-H on wbed-r0 below 10/12 at either effort (M1) or in NL0 → stop; fix the anchor or the harness.
- **K3** any leak test fails → the evaluator is invalid; no claim until fixed and re-run at $0.
- **K4** an arm over 25% environment faults → that arm is invalid for the stage.
- **K5** a stage reaches its cap → stop and analyse as it stands; no reruns.
- **K6** any single experiment estimated over $500 → pause for the owner (`policy/models.json:21`).
- **K7** NL0 cost per job over 1.5× the estimate → re-plan before NL1.
- **K8** every construct-H lineage fails on every NL0 job while build-O passes → continue, but no "no need" reading
  may be drawn from L_today alone.
- **K9** F11 trips on a build path → that path is scored as an unverified delivery in all later utility.

Stage caps: M1 $15, NL0 $140, NL1 $340, NL2 $270, E2E $80, NL2b $140, NL3 $240, judge-H $10.

## 12. Deviations

Any change after the freeze is recorded here with its date, reason and whether any label had been viewed. Jobs,
families or analyses added after freeze form a separate stratum and never enter the headline. Raw failures and
negative results are kept.

## 13. TBDs and what resolves each

| TBD | Resolved by | When |
|---|---|---|
| Hypotheses table (§1) | written by the program author before any label | M0 |
| Arm hashes, engine kit stamp, `static@v3:` availability | M0 stamp (ROADMAP §6 rule 13) | M0 |
| `selfCheck` prompt paragraph; procedure-writer prompt and schema; judge-H prompt | M0 code review | M0 |
| Per-seed difficulty for banded `probeSeeds` | M0 code | M0 |
| Price table version for re-pricing | M0, pinned with its source | M0 |
| Per-family deployable verifier and numeric tolerances | M0, read from each bed | M0 |
| agent-O $8 threshold (example inputs > 30K tokens) per job | M0 census at each job's band | M0 |
| Bootstrap and permutation seeds | M0 | M0 |
| Null simulation results | M0 | M0 |
| W (cost of a wrong delivery); λ_t | owner (decision 3) | before the M0 freeze, else W = V, λ_t = 0 |
| Whether NR-probe is co-primary | owner (decision 7) | before the M0 freeze |
| Seed-ledger purposes | owner (decision 8) | before NL0 |
| σ and the power gate outcome | NL1 leave-one-cluster-out | after NL1 |
| θ_tok, θ_fan, leaf modes, k, probe mapping, router shas | Freeze addendum | 10-24 |
| far-1, far-2 identity and author | owner (decision 11) | before NL2 |
| gameqa and runbook bands; their audits | an independent audit session | before NL2b |
| E8's role (forced stratum only, or more) | after #58 commits its paired runs | M1e |
| Owner tasks, acceptance checks, recurrence list | owner (decision 10) | target 10-28 |
| Sealed families' identity and seeds | a session that tuned nothing | NL3 |
| C7a and C7b claim thresholds | owner (decision 16) | before NL2 |
