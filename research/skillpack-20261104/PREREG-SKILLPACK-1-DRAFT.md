# Pre-registration: SKILLPACK-1 (DRAFT, not frozen)

**Status: DRAFT, 2026-11-04.** No comparative run has started. Freezing requires three things:
1. the measured σ_b below, filled in from existing builder runs at $0;
2. a budget line approved by the owner (§7);
3. this file committed and its SHA recorded.

Until then, any run is diagnostic only.

```prereg-banner
SKILLPACK-1 (development; E8 dev worlds and SOP-Bench dev SOPs)
UNIT       build
K          6 builds per arm at the first look (blocks of 2, K_max 12)
CASES      >= 400 graded cases per build (E8: 16 dev worlds; SOP-Bench: the dev rows of each SOP)
SD_RATES   TBD: estimateSigmaB on the existing E8 builder runs (B1L-H, B1G-H) and SOP-Bench p2-main builds, before freezing
STOP       O'Brien-Fleming over blocks of 2 builds, K_max 12 (stats-builds.mjs)
MDE        TBD from SD_RATES at K = 6 and K = 12; the claim needs MDE <= 0.08
PREDICTION P (pack) beats N (no pack) by >= 0.10 in build pass rate; P beats C (current skills) by >= 0.05; P costs no more per build than C
REFUTED    P does not beat N at the final look, or P is not better than C while costing more
```

| Field | Value |
|---|---|
| Experiment id | SKILLPACK-1 |
| Claim tested | C0 (construction): with `skills/foundry-construct/` loaded, a cheap builder constructs workflows that pass their executable oracle more often than with no skills or the current skills, at no higher cost |
| Evidence class | `development`. The beds are dev data, and the pack was written by someone who has seen their results. A sealed follow-up needs unseen task families |
| Pre-registration commit | TBD |
| Date | TBD at freeze |

## 1. Beds and splits
- **E8 order saga.** Builds come from SPEC-E and the host contract. Each build is graded on the 16 dev worlds
  (seeds 1241–1244 × d2–d5) by the E8 oracle. Sealed E8 families are not used.
- **SOP-Bench.** Build-once per SOP, from the SOP text, the tool specs and 5 build rows. Each build is graded on that
  SOP's dev rows only. Sealed rows are never read.
- **Excluded:** AutomationBench, because the pack must stay out of its harness contexts, and P1 is running there.

## 2. Arms
The builder is Haiku 5.5 with the same tools, budget and practice loop in every arm.

| Arm | Skills loaded |
|---|---|
| **N** | none |
| **C** | current `skills/workflow-foundry` + `skills/runtime-native` |
| **P** | `skills/foundry-construct` (core always; references on demand) |

## 3. Measurements
- Primary: the build pass rate, i.e. the share of a build's cases its oracle passes. The unit is the build.
- Secondary, reported per arm:
  - validate and strict-lint pass on the first attempt;
  - builder cost per build;
  - run cost per case;
  - the share of model nodes a code node could have replaced (audited by a fixed rule).

## 4. Power
To be completed from SD_RATES before freezing. The schedule above is fixed.

## 5. Analysis
- **Tests:** two-sided, one test per comparison: P against N, then P against C. The tests are build-level, Welch on
  logit pass rates (stats-builds.mjs), with no case pooling across builds.
- **Order:** fixed-sequence, so P against C is tested only if P against N crosses.

## 6. Kill rule and falsifiers
- If P does not beat N at K_max, the pack is not shipped as the default construction skill.
- If C ties P at lower cost, the old skills stay.
- Every pack rule is then ablated one at a time on the E8 bed. A rule whose removal does not lower the pass rate is
  dropped (the sunset rule, ANSWER.md §3.1).

## 7. Cost
- **Estimate:** 3 arms × 6–12 builds × 2 beds. Builder runs cost about $0.10–0.40 per build at Haiku prices
  (SOP-Bench p2 builds were $3.53 for 31 sessions). Grading is $0 for E8 and judge-only for SOP-Bench.
- **Proposed cap:** $20. This needs the owner's OK as a budget line.

## 8. Threats to validity
- The pack's author has seen these beds' results (development evidence only).
- SKILL.md cites E8 and SOP-Bench findings, which could favour P on exactly these beds. A sealed follow-up on
  breadth families (WorkBench, AppWorld, AgentDojo splits are frozen on the breadth branch) is the real test.
- The practice loop may dominate any skill effect. Report the practice-iteration counts per arm.

## Amendments
None.
