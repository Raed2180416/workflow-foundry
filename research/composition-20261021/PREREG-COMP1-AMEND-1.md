# PREREG-COMP1 amendment 1 (DRAFT): M1 at the build level

**Status: DRAFT, not frozen.** Written 2026-10-21 by an Opus 5.5 subagent in a worktree, for register B7
(`research/compromises-20261021/REGISTER.md`) and action 6 of `research/compromises-20261021/FIXES.md` §2 ("amend
PREREG-COMP1 M1 before the next paid C-H build"), and revised the same day after review (§6). The orchestrator freezes
it (§7); until then it binds nothing. Development evidence only.

## 0. What the authors had seen, and what that means for this amendment

- First draft: the graded results of C-H builds 1-3 (`runs/ch-e8-1..3/result.json`: 974, 955 and 886 of 1,022
  completed grading-pool cases), the totals of C-H-T builds 1-2, and the B1L-H / B1N-H lineage grades.
- Review round: also the totals of C-H-T build 3 (`runs/cht-e8-3`, graded after e6a23ca, read from the main tree;
  C-H-T 1-3: 1,003, 974 and 920 of 1,022), to measure the between-build spread that sets the posterior's prior (§2).
- So this amendment **cannot be preregistered for any build graded before its freeze**: today C-H builds 1-3 and C-H-T
  builds 1-3. For them both readings are reported side by side (§4) and the frozen reading is not replaced, following
  PREREG-AB-v1 §7's convention for an analysis changed after data. The build-level rule binds **prospectively**: every
  build graded after the freeze (any K growth) and every comparative statement made after it. C-H-T results are not
  analysed here.

## 1. Why

PREREG-COMP1 reads M1 "pooled over K = 3 builds per arm" and says a P2 miss "is not inconclusive, because the M1
sample is large (thousands of completed cases)". The sample that carries between-build variation is K = 3, not
thousands: cases graded on one build share its defects. Under the B7 simulation (between-build SD 0.08, 43 cases per
build) a case-pooled test rejects a true null about 25% of the time at a nominal 5% at every K, and an exact
build-level test at K = 3 vs 3 can never reach p < 0.05 (smallest attainable two-sided p = 2/C(6,3) = 0.10)
(`experiments/lib/stats-builds.test.mjs`). That sentence of the prereg is withdrawn.

## 2. M1, amended

- **Unit:** the build. Every build is graded on the same pool: the 9 grading worlds 1232-1234 × d2, d3, d5 under the
  same spec hash (1,022 completed cases per build at today's oracle; at least the template's 400). The paired world
  1232 d2 size 12 (14 cases) is reported per build as its own row and is never pooled into M1 or tested (14 cases at
  K = 3 cannot resolve anything).
- **Per arm:** the per-build pass rates and their SD; the **sample mean of the build rates** as the point estimate; and
  the 95% HPD interval of the mean build pass rate from `buildRatePosterior`: a binomial model with builds as a
  logit-normal random effect (y_b ~ Bin(n_b, sigmoid(θ + u_b)), u_b ~ N(0, τ²), sigmoid(θ) uniform, τ half-normal(1) on
  the logit scale). The prior scale is set from measured E8 spread (logit-scale SD of build rates: C-H 0.58, C-H-T
  0.87). Measured (`stats-builds.test.mjs` (c), 160 simulated arms per cell): the HPD interval covers the mean build
  rate 0.95-0.99 of the time at true rates 0.92, 0.95 and 0.97 with K = 3 and 6, and the sample mean's bias is under
  0.005. The posterior median runs 0.01-0.03 low, so it is reported but is never the point estimate. When every build of
  an arm is perfect, the posterior piles up at 1 and is overconfident; the output says so.
- **Between arms:** the exact build-level permutation test (`buildPermutationTest`, with its smallest attainable p and
  the label "cannot resolve at K = a vs b" when that is not below 0.05); the difference of the arms' sample means with
  **Welch's interval on the build rates** (`buildDifferenceInterval`; coverage 0.94-0.98 measured at K = 3-6); and the
  convolved posterior difference beside it (it over-covers, 0.96-1.00, at up to 1.8x Welch's width near the ceiling). No world-level
  pairing is modelled. The case-pooled test is printed only as a contrast, never as evidence.
- **Command:** `node experiments/lib/stats-builds.mjs compare --a <C-H result.json list> --b <comparator list>`.

## 3. Reading rules, amended

- **P1** (buildability) is unchanged: at least 2 of 3 C-H builds load and pass the strict interface checks.
- **P2** (correctness), build level: P2 **holds** if C-H's sample mean of build rates is at least 0.95 **and** the
  lower end of its 95% HPD interval is at least 0.90; P2 **fails** if the upper end is below 0.90; otherwise P2 is
  **unresolved**. Operating characteristics, simulated at $0 (300 arms per cell, m = 1,022; logit spread τ of the build
  population as measured for C-H, 0.6, and C-H-T, 0.9):

  | True mean build rate (τ 0.6) | 0.844 | 0.890 | 0.927 | 0.954 | 0.976 |
  |---|---|---|---|---|---|
  | K = 3: holds / fails | 0.000 / 0.323 | 0.003 / 0.053 | 0.020 / 0.000 | 0.167 / 0.000 | 0.337 / 0.000 |
  | K = 6: holds / fails | 0.000 / 0.577 | 0.000 / 0.060 | 0.040 / 0.000 | 0.523 / 0.000 | 0.943 / 0.000 |

  | True mean build rate (τ 0.9) | 0.830 | 0.877 | 0.917 | 0.947 | 0.972 |
  |---|---|---|---|---|---|
  | K = 3: holds / fails | 0.003 / 0.297 | 0.000 / 0.057 | 0.013 / 0.010 | 0.057 / 0.000 | 0.247 / 0.000 |
  | K = 6: holds / fails | 0.000 / 0.527 | 0.000 / 0.100 | 0.030 / 0.000 | 0.240 / 0.000 | 0.607 / 0.000 |

  The thresholds keep false holds (true rate at or below 0.89) at or below 0.3% and false fails (true rate at or above
  0.917) at or below 1%. **Declared now: at K = 3, "P2 unresolved" is the expected outcome** unless the true mean build
  rate is near 0.98 (holds about a quarter to a third of the time) or below about 0.85 (fails about 30% of the time).
- **H-COMP:** supported if P1 holds and P2 holds; refuted if fewer than 2 of 3 C-H builds load or P2 fails; otherwise
  inconclusive. "Composition costs correctness at equal budget" may be written only when P2 fails.
- **Comparisons** with B1L-H (P2's 0.982) and C-H-T against C-H (P4): the build-level test and intervals only. At
  K = 3 vs 3 every such comparison is "cannot resolve at K = 3" in advance; the intervals are reported.
- **P3** (fault rows M4a-e) are counts per build and stay as written: no pooled test across builds.
- **If a comparative claim is wanted**, builds are added in blocks of 2 per arm up to K_max 12 with O'Brien-Fleming
  boundaries on the build-level p, and a crossing decides only with a gap of at least 3 points (`sequentialBuildLook`;
  false stops 0.0475 over 2,000 null runs with the floor, 0.0476 over 10,000 without it). Measured SD of build rates on
  the 1,022-case pool: C-H 0.045, B1L-H 0.025, pooled 0.037 from 3 builds per arm, so 4 degrees of freedom and a 95%
  interval of [0.022, 0.106] for the SD. MDE at α 0.05 and power 0.8, at the pooled SD [and at its 95% bounds]:

  | K per arm | 3 | 4 | 6 | 8 | 12 |
  |---|---|---|---|---|---|
  | MDE (points) | cannot resolve | 10.9 [6.5, 31.4] | 6.7 [4.0, 19.3] | 5.5 [3.3, 15.9] | 4.4 [2.6, 12.6] |

  K ≤ 6 is simulated with the exact permutation test; K = 8 and 12 use the t form (within 1% of the simulation at
  K = 8). The first draft's 8.7 at K = 4 was the t form, which understates the MDE there by about 20%. The upper bounds
  say the 3-build SD is too uncertain to size K from: re-measure it on every new build. A C-H build costs $0.53-1.73
  (measured, builds 1-3), so K 3 → 6 is about +$2.3-4.5 per arm (FIXES B7), K → 12 about +$4.8-15.6, against the $9 C-H
  cap: a K beyond 3 needs a cost amendment.

## 4. C-H builds 1-3: both readings (computed after the data were seen; development evidence)

| | Frozen reading (pooled cases) | Build-level reading (this amendment) |
|---|---|---|
| C-H M1 | 2,815 / 3,066 = 0.918 on the grading pool (0.917 with the paired world's 42 cases) | rates 0.953 / 0.934 / 0.867 (SD 0.045); sample mean 0.918; posterior median 0.898, 95% HPD [0.729, 0.967] |
| P2 | 0.918 < 0.95: miss, "composition costs correctness" | sample mean < 0.95 and the HPD interval spans 0.90: unresolved at K = 3 |
| C-H vs B1L-H l1-l3 (1.000 / 0.953 / 0.993) | diff -0.064, case-pooled p 1.4e-30 | diff -0.064, exact p 0.20: cannot resolve at K = 3 vs 3; Welch [-0.157, 0.029]; posterior [-0.279, 0.201] |
| C-H vs the COMP-1 monolith rows (B1L-H l1, B1N-H l2, l3: 1.000 each) | diff -0.082, case-pooled p 7e-59 | exact p 0.10: cannot resolve; Welch [-0.194, 0.031]; posterior [-0.270, -0.036], flagged overconfident (every monolith build is perfect) |

- The first draft's build-level figures (C-H posterior mean 0.880 [0.715, 0.948]; C-H minus B1L-H posterior
  -0.032 [-0.214, 0.166]) came from a beta-binomial posterior that read three builds near the ceiling as consistent with
  a much lower mean (B1L-H's own posterior mean was 0.912 against a sample mean of 0.982). They are withdrawn.
- Prior sensitivity at K = 3 (τ half-normal scale 0.5 / 1 / 1.5 / 2): C-H HPD [0.818, 0.954] / [0.729, 0.967] /
  [0.653, 0.966] / [0.601, 0.965]; C-H minus B1L-H posterior [-0.173, 0.014] / [-0.279, 0.201] / [-0.307, 0.356] /
  [-0.312, 0.425]. Every one includes 0; Welch's interval does not depend on the prior. The frozen reading's p of 1e-30
  is the case-pooling artefact B7 names.
- The paired 14-case world, for the record: C-H 11, 11, 13 of 14; B1L-H l1, B1N-H l2, l3 14 of 14 each; agent-H 10 of
  14. Built minus agent-H: 0.286, K = 3 vs 1, exact p 0.25: cannot resolve; Welch undefined (no spread in either arm);
  posterior [0.090, 0.660], flagged overconfident (every built lineage is perfect on these 14 cases).

## 5. What does not change

The arms, build conditions, frozen harness hashes, M2-M6, P1, P3, P4's direction, the machine-load rule and the cost
caps of PREREG-COMP1.

Merge effects of the B7 code elsewhere (not COMP-1):
- `experiments/agentv/run.mjs` (the banner's build-level MDE line) is in PREREG-SPEC1's frozen-file list
  (`research/intent-20261021/PREREG-SPEC1.md`, sha `7862118…`, DRAFT today). Merge this before SPEC-1 freezes, or re-run
  `spec1-freeze.mjs` after the merge; otherwise `preregCheck` refuses every paid SPEC-1 row.
- `experiments/lib/stats-builds.mjs` is a new file in the `experiments/lib` tree that the need-router label-engine stamp
  hashes: a need-router stage started before the merge cannot resume after it (ENGINE_CHANGED). None holds a
  `STAMP.json` on 2026-10-21.

## 6. Review record (2026-10-21)

The review found the first draft's posterior (beta-binomial, μ uniform, rate-scale σ_b half-normal(0.15)) biased low
near the ceiling: posterior-mean bias -0.025 to -0.045 at true rates 0.92-0.97, single-arm coverage 0.90 at 0.97,
difference coverage 1.00, and the amended P2 held in 0 of 80 simulated arms with a true rate of at least 0.95, so the
comparator B1L-H would itself have failed it. This revision: the point estimate is the sample mean of build rates; the
posterior is a logit-normal random effect with its prior scale set from measured E8 spread and an HPD interval (equal-
tailed intervals cover only 0.90-0.96 near the ceiling); the between-arm interval is Welch's; P2's thresholds are kept and
their operating characteristics simulated and declared (§3); the MDE is simulated at K ≤ 6 and stated with the SD's
uncertainty; the sequential rule has the 3-point floor; §4 is recomputed. It also no longer calls the design "paired
across shared worlds": the arms share a pool, and no world-level pairing is modelled.

## 7. Freeze checklist (orchestrator)

1. Name every C-H and C-H-T build graded before the freeze (today: ch-e8-1..3, cht-e8-1..3) in §0; the build-level
   rule does not bind them.
2. Decide whether the frozen pooled reading or the build-level reading is primary for those builds (this draft keeps the
   frozen one primary for them and reports both), and record the decision here.
3. Change the status line to FROZEN with the date and commit, before any further C-H or C-H-T build is graded.
4. Add a one-line pointer to this file at the end of PREREG-COMP1.md.
