# Verification-policy simulator (BLOCKER-SYNTHESIS row 5)

*research/jit-20261008/analysis/verification-policy-sim.md · 2026-10-09 · $0, no model calls · dev data, diagnostic only*

**Scope, stated first (critique M3).** The PREREG's silent-miss rate is oracle-scored on every delivered answer
(`durability.mjs:19–20`; PREREG §3), so no shadow schedule can bias it. This simulator sizes a random shadow floor for
**system-view (oracle-free) numbers only**: the silent-miss rate the system estimates from its own verification calls,
system-view durability, router training rows and any self-reported miss rate. Whether to add a floor is a config choice
(synthesis C10), not an instrument defect.

Script: [`verification-policy-sim.mjs`](verification-policy-sim.mjs). Estimators live in
[`experiments/jit/stats.mjs`](../../../experiments/jit/stats.mjs) (`ipwMissEstimate`, `hypergeomTotalCI`) and are tested in
`experiments/jit/test/stats.test.mjs`. Reproduce with
`node research/jit-20261008/analysis/verification-policy-sim.mjs --draws 20000` (seed `verification-policy-sim-v1`, about 7 s).

## 1. Method

**Data.** [`nversion-records-dev.json`](../nversion-records-dev.json): 4 compiled records solvers (`opusV1`, its child
`opusV2`, `sonnetV1`, `haikuV1`) × 24 dev tasks (16 d3, then 8 d4), with status, pass and a distinct-answer count per task,
but no answers.

**Reference.** The Opus agent went 24/24 on these tasks (HANDOFF §2), so one verification call (a shadow or an adjudication
by the reference) reveals exactly whether a compiled delivery was wrong. With a perfect reference and n = 24 this is close
to a power calculation (critique V12).

**Stream.** Each solver stands in for one JIT arm's compiled path over a 24-task stream. It delivers on its `ok` tasks. A
deopt is visible to the system and needs no verification.

**Targets** (oracle truth from the reference):
- θ = wrong deliveries / deliveries (the system-view silent-miss rate);
- Q = correct compiled deliveries / 24 (system-view durability: the per-row quantity that durability.mjs's system view
  averages over its windows).

| solver | deliveries | wrong | θ | Q | deliveries on disputed tasks | wrong deliveries on undisputed tasks |
|---|---|---|---|---|---|---|
| opusV1 | 9 | 3 | 0.33 | 0.25 | 5 | 1 |
| opusV2 | 24 | 9 | 0.38 | 0.63 | 13 | 5 |
| sonnetV1 | 20 | 4 | 0.20 | 0.67 | 13 | 1 |
| haikuV1 | 14 | 8 | 0.57 | 0.25 | 9 | 0 |

A task is **disputed** when the delivered answers differ (distinct ≥ 2). A single answer (the four d4 tasks only `opusV2`
answered) has nothing to disagree with, so it is undisputed. s214 is unanimous and wrong.

**Policies.** π is the probability that a delivery is verified.

| policy | rule | estimator |
|---|---|---|
| dispute-only | verify iff disputed; undisputed answers are assumed correct (discrepant analysis) | naive count, Wilson CI. Deterministic |
| disputes + floor ε | disputed π = 1; every other delivery π = ε (Begg–Greenes) | Horvitz–Thompson (HT) |
| random ε | π = ε on every delivery, no trigger | HT |
| every 4th | stream.mjs's schedule (`jit.shadowEvery: 4`: the 4th, 8th, … compiled ok run); stream order shuffled within the d3 and d4 blocks on every draw | HT as if π = 1/4 |
| every 4th + disputes | every 4th, plus every disputed delivery. A stand-in for HANDOFF §3's `shadowOnFlags`; "flag = dispute" is an assumption, because flags are not in the data | HT, π = 1 on disputes |
| Z1.4 switching | defined here (Z1.4 inspects lots, not single answers; dossier 6 §B16.4 gives the switching rules): normal π = 1/4, tightened π = 1, reduced π = 1/8. Normal → tightened when 2 of the last 5 inspections found a wrong answer; tightened → normal after 5 consecutive correct inspections; normal → reduced after 10 consecutive correct inspections; reduced → normal on 1 wrong. Inspection is a coin flip at the state's π, which is logged | HT with the logged π (unbiased under adaptive propensities fixed before each flip) |

**CI.** The estimand is this stream's realised rate, so the CI is finite-population. In each propensity stratum, the
verified items are a simple random sample given their number, and the stratum's miss total gets an exact hypergeometric
interval. A fully verified stratum is known exactly; an unverified one is [0, N_h]. Stratum bounds are summed, which is
conservative.

**Usable** (fixed before reading results), for the system-view rate at n = 24:
- mean 95% CI width ≤ 0.30, the width falsifier of dossier 3 E-B17-3;
- empirical coverage ≥ 90%;
- |bias| ≤ 0.03, the owner's 3-point floor.

**Draws.** 20,000 per (policy, ε, solver), with a deterministic seed. Dispute-only is a single deterministic draw.

## 2. Results

### 2.1 Summary across the four solvers

Calls and dollars are summed over the four solver streams (4 × 24 tasks). Dollars are at $0.56 per reference call (the
Opus agent's records dev $/task). The width and coverage columns give the range or minimum over solvers.

| policy | reference calls (4 streams) | $ | max \|bias θ̂\| | CI width θ | CI width Q | min coverage | usable |
|---|---|---|---|---|---|---|---|
| dispute-only (naive) | 40.0 | 22.40 | **0.21** | 0.29–0.48 | 0.18–0.29 | **0%** | 0/4 |
| disputes + floor ε = 0.05 | 41.4 | 23.15 | 0.00 | 0.33–0.43 | 0.16–0.43 | 100% | 0/4 |
| disputes + floor ε = 0.1 | 42.7 | 23.91 | 0.00 | 0.32–0.41 | 0.15–0.41 | 100% | 0/4 |
| disputes + floor ε = 0.2 | 45.4 | 25.42 | 0.00 | 0.28–0.36 | 0.13–0.35 | 100% | 2/4 |
| disputes + floor ε = 0.25 | 46.8 | 26.19 | 0.00 | 0.26–0.33 | 0.12–0.33 | 100% | 2/4 |
| disputes + floor ε = 0.5 | 53.5 | 29.97 | 0.00 | 0.17–0.22 | 0.08–0.22 | 99% | **4/4** |
| disputes + floor ε = 1 (verify all) | 67.0 | 37.52 | 0.00 | 0 | 0 | 100% | 4/4 |
| random ε = 0.05 | 3.4 | 1.88 | 0.01 | 0.92–0.95 | 0.36–0.92 | 100% | 0/4 |
| random ε = 0.1 | 6.7 | 3.74 | 0.01 | 0.84–0.90 | 0.34–0.84 | 100% | 0/4 |
| random ε = 0.2 | 13.4 | 7.49 | 0.01 | 0.67–0.80 | 0.30–0.68 | 99% | 0/4 |
| random ε = 0.25 | 16.8 | 9.38 | 0.00 | 0.59–0.74 | 0.28–0.62 | 99% | 0/4 |
| random ε = 0.5 | 33.5 | 18.75 | 0.00 | 0.34–0.49 | 0.18–0.38 | 98% | 0/4 |
| every 4th (random order) | 16.0 | 8.96 | **0.07** | 0.58–0.78 | 0.29–0.62 | 100% | 0/4 |
| every 4th + disputes | 46.5 | 26.02 | 0.01 | 0.26–0.35 | 0.13–0.33 | 100% | 2/4 |
| Z1.4 switching | 22.5 | 12.61 | 0.00 | 0.55–0.71 | 0.27–0.55 | 99% | 0/4 |

### 2.2 Per solver (selected rows; the script prints every row)

**`opusV2`**: 24 deliveries, 9 wrong, 5 of them undisputed (s214 and the d4 singletons s217, s218, s220, s222).

| policy | calls / 24 tasks | bias θ̂ | SD θ̂ | CI width θ | coverage | bias Q̂ | CI width Q | 6-row windows with ≥ 1 verification |
|---|---|---|---|---|---|---|---|---|
| dispute-only (naive) | 13.0 | −0.208 | 0 | 0.29 | 0% | +0.208 | 0.29 | 100% |
| disputes + floor ε = 0.1 | 14.1 | +0.001 | 0.28 | 0.41 | 100% | −0.001 | 0.41 | 100% |
| disputes + floor ε = 0.25 | 15.8 | −0.001 | 0.16 | 0.33 | 100% | +0.001 | 0.33 | 100% |
| disputes + floor ε = 0.5 | 18.5 | +0.000 | 0.09 | 0.22 | 99% | −0.000 | 0.22 | 100% |
| random ε = 0.25 | 6.0 | +0.002 | 0.22 | 0.62 | 99% | −0.002 | 0.62 | 82% |
| every 4th (random order) | 6.0 | −0.000 | 0.15 | 0.62 | 100% | +0.000 | 0.62 | 100% |
| Z1.4 switching | 8.5 | +0.001 | 0.19 | 0.55 | 99% | −0.001 | 0.55 | 83% |

**`sonnetV1`**: 20 deliveries, 4 wrong, 1 of them undisputed (s214).

| policy | calls | bias θ̂ | CI width θ | coverage | usable |
|---|---|---|---|---|---|
| dispute-only (naive) | 13.0 | −0.050 | 0.31 | 100% | no |
| disputes + floor ε = 0.1 | 13.7 | −0.000 | 0.32 | 100% | no |
| disputes + floor ε = 0.2 | 14.4 | −0.000 | 0.28 | 100% | yes |
| every 4th (random order) | 5.0 | −0.001 | 0.58 | 100% | no |

**`haikuV1`.** All 8 wrong deliveries were disputed, so dispute-only is unbiased here. A floor only narrows the CI, and
ε = 0.2 suffices.

**`opusV1`.** Only 9 deliveries. A usable CI needs ε = 0.5. Every 4th, estimated as if π = 1/4, is biased by −0.036
(and `haikuV1` by −0.072): with D deliveries the schedule verifies ⌊D/4⌋ of them, so π = 1/4 is wrong whenever D is not
a multiple of 4.

**The dev order, every 4th, one realisation** (what a fixed-order stream reports):

| solver | verified | θ̂ (as π = 1/4) | 95% CI | θ |
|---|---|---|---|---|
| opusV1 | 2 | 0.89 | 0.22–1.00 | 0.33 |
| opusV2 | 6 | 0.67 | 0.29–0.92 | 0.38 |
| sonnetV1 | 5 | 0.20 | 0.05–0.65 | 0.20 |
| haikuV1 | 3 | 0.57 | 0.14–0.93 | 0.57 |

## 3. What it shows

1. **Dispute-only adjudication is biased exactly where it matters.**
   - On `opusV2` it under-reports the miss rate by 21 points: an estimate of 0.17 against a true 0.38, with 0% coverage.
     It over-reports system-view durability by the same 21 points.
   - The missing misses are the unanimous-wrong s214 (DEV-NOTES D8's common mode) and the four d4 answers no other version
     gave (the D9 widening class).
   - When disagreement does catch every error (`haikuV1`), the bias is 0. The bias is unknowable from inside the system,
     which is the argument for a floor.
2. **Any ε > 0 with logged propensities removes the bias.** HT stays within ±0.01 of the truth at every ε, Z1.4 included.
3. **Bias and CI width are separate problems.** At n = 24 per arm-stream, unbiasedness is cheap, but usable width is not.
   - **With a dispute or flag trigger that already catches most errors:**
     - ε = 0.2–0.25 gives a usable CI (≤ 0.30) on 2 of 4 solvers;
     - ε = 0.5 gives it on all 4;
     - ε = 0.5 costs about 6.7 more reference calls per four streams than ε = 0.25, and about 13.5 more than dispute-only.
   - **Without a trigger (pure random):** no ε ≤ 0.5 gives a usable CI on any solver.
   - **Every-4th and Z1.4:** both leave widths of 0.55–0.78.
4. **Periodic shadows are not a sample with a known propensity.**
   - Under a random order and a Hájek weight, every-4th would be unbiased. But in a fixed-order stream it is one
     systematic realisation: on the dev order, `opusV1`'s two scheduled shadows both hit wrong answers (θ̂ = 0.89 against
     0.33).
   - A Bernoulli draw at the same expected rate costs the same and gives valid IPW weights.
5. **Z1.4 switching buys nothing at this horizon.** Reduced inspection needs 10 consecutive correct inspections, which a
   24-task stream at π = 1/4 almost never reaches. Tightening then spends more calls exactly where errors cluster. Its
   CIs are no better than random ε = 0.25, and the dossier 6 kill rule ("no spend reduction at equal latency") applies.

## 4. Recommendation (input to PREREG-stream §3; a config choice, not a freeze defect)

- **The ε that gives usable system-view CIs at n = 24 is about 0.5,** and only together with a trigger (disputes here, flags
  in the §3 config) that catches most wrong answers. No ε in {0.05, 0.1, 0.2, 0.25} does so for every solver. Pure random
  sampling does not get there at any ε ≤ 0.5.
- **For the held-out round, recommend ε = 0.25 as a Bernoulli draw that replaces the periodic every-4th schedule.**
  - Compiled ok runs that raised no flag are shadowed with probability 0.25.
  - Flagged runs keep π = 1 (`shadowOnFlags`).
  - The propensity is logged on every row.
  - **Why 0.25 and not 0.5.**
    - 0.25 has the same expected shadow count as `shadowEvery: 4`, so arm behaviour and cost are approximately unchanged.
      This matters because shadows add traces and disagreements trigger recompiles: a larger floor changes the arm being
      measured.
    - It removes the unknowable dispute-only bias (up to 21 points here) and every-4th's realisation bias.
    - ε = 0.5 would double the scheduled shadows, at about $0.3–1.2 each (FG S5), across 3 JIT arms × K streams × 2
      families, and would change the JIT arms.
  - **Consequence to state in the PREREG.** At n = 24, system-view miss and durability numbers are unbiased point
    estimates with exact CIs that are expected to be wider than 0.30 for some arms. They are reported descriptively and
    never enter a comparative decision. The oracle-scored primaries and secondaries are unaffected.
- **Dependency.** `stream.mjs` (owned elsewhere) has no Bernoulli schedule or propensity field today. It needs, for
  example, a `jit.shadowFloor: 0.25` option that replaces periodic scheduling and writes `row.shadowPropensity`. That
  option must land before R0, so that R0 rehearses it.
- **If it has not landed before R0, the PREREG states "floor: none."** In that case:
  - system-view numbers are labelled "dispute/flag-only, biased optimistic by an unknown amount (up to 21 points on dev)";
  - they are not reported as rates.
- `durability.mjs` needs no change for the oracle view. An IPW system-view estimate needs the logged propensity first.
  `stats.mjs ipwMissEstimate` is the estimator to call once it exists.

## 5. Limits

- One family, one dev stream, and 4 solvers, two of which are parent and child. The reference is assumed perfect: the
  Opus agent's 24/24 is a dev result, and a real shadow interpreter is not perfect.
- "Dispute" stands in for flags. The real flag recall is unmeasured (report.mjs `flagSummary` measures it on a live run).
- Answers are not in the JSON, so "disputed" uses the per-task distinct count. Two passing answers can differ (s203,
  s210).
- The CI's summed stratum bounds are conservative. Coverage near 100% is partly that conservatism.
- Recompiles are not simulated: a shadow that disagrees would change later versions in a real stream.
