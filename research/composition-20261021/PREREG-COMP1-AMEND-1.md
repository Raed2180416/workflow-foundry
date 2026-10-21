# PREREG-COMP1 amendment 1 (DRAFT): M1 at the build level

**Status: DRAFT, not frozen.** Written 2026-10-21 by an Opus 5.5 subagent in a worktree, for register B7
(`research/compromises-20261021/REGISTER.md`) and action 6 of `research/compromises-20261021/FIXES.md` §2 ("amend
PREREG-COMP1 M1 before the next paid C-H build"). The orchestrator freezes it (§6); until then it binds nothing.
Development evidence only.

## 0. What the author had seen, and what that means for this amendment

The author read the graded results of C-H builds 1-3 (`runs/ch-e8-1..3/result.json`: 974, 955 and 886 of 1,022
completed grading-pool cases), the totals of C-H-T builds 1-2, and the B1L-H / B1N-H lineage grades. So this amendment
**cannot be preregistered for C-H builds 1-3**: for them both readings are reported side by side (§4) and the frozen
reading is not replaced, following PREREG-AB-v1 §7's convention for an analysis changed after data. The build-level
rule binds **prospectively**: every build graded after the freeze (any C-H-T build still running, any K growth) and
every comparative statement made after it. C-H-T results are not analysed here.

## 1. Why

PREREG-COMP1 reads M1 "pooled over K = 3 builds per arm" and says a P2 miss "is not inconclusive, because the M1
sample is large (thousands of completed cases)". The sample that carries between-build variation is K = 3, not
thousands: cases graded on one build share its defects. Under the B7 simulation (between-build SD 0.08, 43 cases per
build) a case-pooled test rejects a true null about 25% of the time at a nominal 5% at every K, and an exact
build-level test at K = 3 vs 3 can never reach p < 0.05 (smallest attainable two-sided p = 2/C(6,3) = 0.10)
(`experiments/lib/stats-builds.test.mjs`, 8/8). That sentence of the prereg is withdrawn.

## 2. M1, amended

- **Unit:** the build. Every build is graded on the same pool: the 9 grading worlds 1232-1234 × d2, d3, d5 (1,022
  completed cases per build at today's oracle; at least the template's 400). The paired world 1232 d2 size 12
  (14 cases) is reported per build as its own row and is never pooled into M1 or tested (14 cases at K = 3 cannot
  resolve anything).
- **Per arm:** the per-build pass rates, their SD, and the posterior mean build pass rate with its 95% interval
  (`betaBinomialPosterior`: beta-binomial with builds as a random effect, μ uniform, between-build SD half-normal with
  scale 0.15).
- **Between arms:** the exact build-level permutation test (`buildPermutationTest`, with its smallest attainable p and
  the label "cannot resolve at K = a vs b" when that is not below 0.05) and the posterior interval of the difference
  in mean build pass rate (`buildDifferenceInterval`). The case-pooled test is printed only as a contrast, never as
  evidence.
- **Command:** `node experiments/lib/stats-builds.mjs compare --a <C-H result.json list> --b <comparator list>`.

## 3. Reading rules, amended

- **P1** (buildability) is unchanged: at least 2 of 3 C-H builds load and pass the strict interface checks.
- **P2** (correctness), build level: P2 **holds** if C-H's posterior mean build pass rate is at least 0.95 **and** the
  lower end of its 95% interval is at least 0.90; P2 **fails** if the upper end is below 0.90; otherwise P2 is
  **unresolved at K = 3**.
- **H-COMP:** supported if P1 holds and P2 holds; refuted if fewer than 2 of 3 C-H builds load or P2 fails; otherwise
  inconclusive. "Composition costs correctness at equal budget" may be written only when P2 fails.
- **Comparisons** with B1L-H (P2's 0.982) and C-H-T against C-H (P4): the build-level test and interval only. At
  K = 3 vs 3 every such comparison is "cannot resolve at K = 3" in advance; the interval is reported.
- **P3** (fault rows M4a-e) are counts per build and stay as written: no pooled test across builds.
- **If a comparative claim is wanted**, builds are added in blocks of 2 per arm up to K_max 12 with O'Brien-Fleming
  boundaries on the build-level p (`sequentialBuildLook`; false stops 0.0476 over 10,000 null runs). Measured SD of
  build rates on the 1,022-case pool: C-H 0.045, B1L-H 0.025 (pooled 0.037). MDE at α 0.05 and power 0.8:

  | K per arm | 3 | 4 | 6 | 8 | 12 |
  |---|---|---|---|---|---|
  | MDE (points) | cannot resolve | 8.7 | 6.6 | 5.5 | 4.4 |

  A C-H build costs $0.53-1.73 (measured, builds 1-3), so K 3 → 6 is about +$2.3-4.5 per arm (FIXES B7), K → 12
  about +$4.8-15.6, against the $9 C-H cap: a K beyond 3 needs a cost amendment.

## 4. C-H builds 1-3: both readings (computed after the data were seen; development evidence)

| | Frozen reading (pooled cases) | Build-level reading (this amendment) |
|---|---|---|
| C-H M1 | 2,815 / 3,066 = 0.918 on the grading pool (0.917 with the paired world's 42 cases) | rates 0.953 / 0.934 / 0.867 (SD 0.045); posterior mean 0.880, 95% [0.715, 0.948] |
| P2 | 0.918 < 0.95: miss, "composition costs correctness" | mean < 0.95 and the interval spans 0.90: unresolved at K = 3 |
| C-H vs B1L-H l1-l3 (1.000 / 0.953 / 0.993) | diff -0.064, case-pooled p 1.4e-30 | diff -0.064, exact p 0.20: cannot resolve at K = 3 vs 3; posterior diff -0.032 [-0.214, 0.166] |
| C-H vs the COMP-1 monolith rows (B1L-H l1, B1N-H l2, l3: 1.000 each) | diff -0.082, case-pooled p 7e-59 | exact p 0.10: cannot resolve; posterior diff -0.070 [-0.241, 0.079] |

At K = 3 the interval depends on the prior: with the σ_b prior scale at 0.05 / 0.08 / 0.15 / 0.30 the C-H minus
B1L-H interval is [-0.131, 0.008] / [-0.157, 0.045] / [-0.214, 0.166] / [-0.275, 0.341]. Every one includes 0;
the frozen reading's p of 1e-30 is the case-pooling artefact B7 names. The paired 14-case world, for the record:
C-H 11, 11, 13 of 14; B1L-H l1, B1N-H l2, l3 14 of 14 each; agent-H 10 of 14 (K = 3 vs 1: cannot resolve; posterior
diff 0.28 [-0.003, 0.65]).

## 5. What does not change

The arms, build conditions, frozen harness hashes, M2-M6, P1, P3, P4's direction, the machine-load rule and the cost
caps of PREREG-COMP1.

## 6. Freeze checklist (orchestrator)

1. Decide whether the frozen pooled reading or the build-level reading is primary for C-H builds 1-3 (this draft
   keeps the frozen one primary for them and reports both), and record the decision here.
2. Change the status line to FROZEN with the date and commit, before any further C-H or C-H-T build is graded.
3. Add a one-line pointer to this file at the end of PREREG-COMP1.md.
