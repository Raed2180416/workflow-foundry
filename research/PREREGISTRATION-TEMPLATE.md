# Pre-registration: <experiment id>

Copy this file to `research/<topic>-<date>/PREREG.md` and fill every field **before** the
first comparative run. Commit it, record the commit SHA below, and do not edit it after
that except in the "Amendments" section (dated, with a reason). An experiment without a
committed pre-registration produces diagnostic evidence only, never a claim.

*Template amended 2026-10-21 (compromise register B7 and A4; `research/compromises-20261021/FIXES.md`
§2 actions 6 and 7): §3 names the unit of analysis, §4 asks for the build-level K schedule, stop rule
and MDE from a measured σ_b, or for the group-sequential task schedule, §5 forbids case-pooled tests
over builds, and the banner block below is required by runners that print it
(`experiments/agentv/run.mjs` `preregBanner`). Tools: `experiments/lib/stats-builds.mjs` (builds),
`experiments/lib/stats.mjs` group-sequential core, `experiments/autobench/sequential.mjs` (tasks).*

```prereg-banner
<EXPERIMENT ID> (<evidence class>; <beds and worlds>)
UNIT       build | task (paired, k = 1) | case (only when every arm is one fixed artefact)
K          <builds per arm at the first look; build unit only>
CASES      <graded cases per build; >= 400 for a build-unit claim>
SD_RATES   <measured SD of build pass rates at CASES (stats-builds.mjs estimateSigmaB), or SIGMA_B <between-build SD>>
STOP       <K schedule and stop rule, e.g. blocks of 2 builds, O'Brien-Fleming, K_max 12>
MDE        <minimum detectable gap at the planned K / n, computed, not asserted>
PREDICTION <the numbers you expect, with ranges>
REFUTED    <what result refutes the hypothesis>
```

| Field | Value |
|---|---|
| Experiment id | |
| Claim tested | C0 / C1 / C2 / C3 / C4 / C5 (ROADMAP §4.1), stated as a falsifiable sentence |
| Evidence class | `development` (diagnostic) or `sealed` (held-out, claim-bearing) |
| Pre-registration commit | `git rev-parse HEAD` after committing this file |
| Date | |

## 1. Beds and splits
- Families and their generators (path + content hash):
- Dev split (seeds / ids) and sealed split (seeds / ids, or the hash of the sealed manifest
  if the split is hidden from the builder):
- Who authored the sealed split, and what the experimenter has and has not seen:
- Oracle per family (path + sha256). Oracle controls run before the experiment:
  known-good (reference solver) must pass, known-bad (no-op, corrupted output) must fail.
  Record the control results here before any arm runs.

## 2. Arms
For every arm: what it is, the model ids (from `policy/models.json`, with policy version),
the tools, the budget per task (USD, tokens, wall time, steps), the construction budget if
any, and the hash of the frozen arm definition (prompt/script/workflow).

| Arm | Definition | Models | Tools | Budget/task | Frozen hash |
|---|---|---|---|---|---|
| B0 | plain executor | | | | |
| B0+N | B0 + append-only notes | | | | |
| B1 | independent CC-workflow-style script | | | | |
| B5 | best-of-K with the same verifier | | | | |
| F | Foundry | | | | |
| Ceiling | hand-written workflow | | | | |

Held constant across arms: model(s), tools, environment image, per-task budget, verifier.
Interleaving: arms run interleaved per task on identical environments (order recorded).

## 3. Measurements
- Primary metric and its exact definition (e.g. verified success; CPS = all USD incl.
  failures, construction and verification ÷ oracle-verified successes):
- Secondary metrics (pass^k with k=, TTFH, reuse / deopt / wrong-reuse, cost, latency):
- K (trials per task per arm), stream orders (≥3 for learning arms):
- Unit of analysis and clustering. Name the unit the arms differ in:
  - **build** (a compiled solver, a composed program, a workflow lineage: anything a model *built*):
    the build is the experimental unit. Cases graded on one build share its defects, so a test that
    pools cases across builds treats K builds × m cases as K·m independent draws; under the B7
    simulation (σ_b 0.08, 43 cases per build) it rejects a true null about 25% of the time at a
    nominal 5% (`experiments/lib/stats-builds.test.mjs`). Grade every build on the same pool of
    worlds (one spec, the same worlds, so the pool's case difficulty is common to every build), at
    least 400 cases per build (E8: the 9-world pool of 1,022 completed cases, $0).
  - **task** (one fixed harness run on many tasks): paired by task at k = 1. More tasks buy more
    power than repeats at the same budget (120 runs per arm: power 0.70 as 120 × k=1 against 0.58
    as 60 × k=2, FIXES A4); use k ≥ 2 only for pass^k claims.
  - **admission** (a gate that admits or refuses a whole group, such as a supplier, a source or a tenant, and then
    serves every item of an admitted group): the group is the unit. Its errors are correlated within the group (C2-2 T1:
    17 of 17 accepted items wrong in one supplier), so an M3 bound clustered on a finer unit (shipment, item) overstates
    the effective n. Cluster M3 by the admission unit (`experiments/reuse/posthoc.mjs m3Views`;
    [RESULT-C2-2 §0](reuse-20261021/RESULT-C2-2.md), added 2026-11-04).
  - Family-clustered paired bootstrap (B=10000) only on top of the right unit, never instead of it.

## 4. Power
- Assumed effect size, variance source, α, power, resulting n (cite ROADMAP §4.3 / R05 §3):
- If the affordable n is below the required n, say so here and downgrade the result to
  "directional" in advance.
- **Build unit.** All of:
  - σ_b measured, not assumed: the SD of build pass rates at the planned cases per build, from
    existing builds (`node experiments/lib/stats-builds.mjs compare …` prints it), with its source
    and its uncertainty (an SD pooled from two arms of K builds has 2(K − 1) degrees of freedom;
    at K = 3 its 95% interval runs from about 0.6x to 2.9x the estimate);
  - the MDE it implies (`stats-builds.mjs mde --K … --m … --sd-rates …`; the spread is required),
    stated in points, at the SD estimate and at its 95% bounds. At K ≤ 6 the MDE is simulated with
    the exact permutation test (the t form understates it there: by about 20% at K = 4);
  - the K schedule and stop rule: builds added in blocks of 2 per arm up to K_max (default 12),
    O'Brien-Fleming boundaries on the exact build-level permutation p, and a crossing decides only
    with a gap of at least 3 points (`sequentialBuildLook`); or a fixed K with its reason. K = 3 vs 3
    can never reach p < 0.05 (smallest attainable p 0.10): such a design reports intervals only and
    is labelled "cannot resolve at K = 3" in advance;
  - for a threshold on one arm (e.g. "mean build pass rate ≥ 0.95"), its operating characteristics
    at the planned K, simulated (how often it holds, fails or stays unresolved at plausible true
    rates), stated in advance;
  - the cost per build and the K_max cost.
- **Task unit, sequential.** The look schedule (task counts per look, disjoint batches), the
  boundary (O'Brien-Fleming by default; nominal levels per look), α per metric if there are
  co-primary metrics, and the pool the batches come from with its exposure exclusions.
- If an effect size comes from the same data the arm was developed on, say so: it is in-sample
  and the power computed from it is optimistic.

## 5. Analysis
- Analysis script path and sha256 (frozen before data collection):
- Decision rule (e.g. non-inferiority margin δ, CI level), naming the unit (§3):
  - build unit: the exact build-level permutation test for the headline; the difference in mean
    build pass rate (difference of the arms' sample means of build rates) with Welch's interval on
    the build rates (`buildDifferenceInterval`) beside it; per arm, the sample mean of build rates
    as the point estimate with the 95% HPD interval of the logit-normal random-effect posterior
    (`buildRatePosterior`; it is overconfident for an arm whose builds are all perfect, and says so).
    A case-pooled test (z, McNemar or bootstrap over cases pooled across builds) is not admissible
    for a comparison between arms of builds. Per-build values are always reported.
  - task unit: the primary test, any co-primary metric and its α share, and the group-sequential
    boundary if there are looks.
- Intervals: exact, Wilson or Bayes intervals at n < 200, never CLT bars; an effect is reported
  with its interval, never as a bare p.
- Gaps under 3 points are noise. No K=1 comparative claim.

## 6. Kill rule and falsifiers
- Kill rule (stop early if …):
- Falsifiers from ROADMAP §4.3 that apply:

## 7. Cost
- Estimated cost (show the arithmetic). Above $500 for a single experiment: stop and ask
  the owner in README first.
- Cost ledger entry id in README:

## 8. Threats to validity
- Contamination / leakage controls (library leakage scan for task literals, gold-patch probe):
- Oracle weaknesses known in advance:
- Infrastructure noise controls:

## Amendments
(dated entries only)
