# Kinetics comparator gauge, Stage B

*Generated 2026-10-09T15:45Z by `stage-b-analyze.mjs` from `research/jit-20261008/analysis/kinetics-gauge/out/stage-b/sessions.jsonl`. Model claude-haiku-5-5, cap $0.45/session, live mode.*

**Scope.** 48 sessions on 24 kinetics dev seeds (201–224 range; d4 = 201–216, d5 = 217–224, as `dev-kinetics-1.json`), 2 per seed. These seeds were seen during JIT development, so this is **dev calibration, not a freeze**: under FG §4.1 a relTol calibrated here enters the frozen PREREG only with owner decision O1; otherwise the fallback is the README-stated precision (0.05). Every rate below states its n; with n this small they are counts, not interval estimates.

## Sessions

|  | n | answer.json | schema-valid | oracle pass |
|---|---|---|---|---|
| d4 | 32 | 32 | 32 | 22/32 (68.8%) |
| d5 | 16 | 16 | 16 | 13/16 (81.3%) |
| all | 48 | 48 | 48 | 35/48 (72.9%) |

- Seeds where at least two sessions pass (a correct–correct pair exists): 15/24.
- Error codes on recorded sessions: none.
- Cost (recorded sessions): actual $3.0638, booked $3.0638; cost-unknown sessions 0; per session actual min/median/p90/max $0.0376 / $0.0495 / $0.1122 / $0.2189. Wall time per session min/median/p90/max 181 s / 241 s / 297 s / 354 s.
- Ledger (every attempt, faulted ones included): 55 attempts, 7 not recorded as sessions (environment faults), actual $4.4886, booked $4.4886.

## 1. Correct–correct pairs: spread and false-disagreement

Pairs of sessions on the same seed that both pass the oracle. Spread = `|a − b| / max(|a|, |b|)`, worst number of the pair (`dist().maxSym`). FD@t = share of pairs `same()` judges different at relTol t, with the exclusion set compared exactly (t = 0.1 sets `allowLooseTolerance`).

| pairs | n | spread min / median / p90 / max | max ΔVmax/Vmax | max ΔKm/Km | FD@0.001 | FD@0.005 | FD@0.01 | FD@0.02 | FD@0.05 | FD@0.1 |
|---|---|---|---|---|---|---|---|---|---|---|
| all correct–correct | 15 | 0 / 2.6e-6 / 1.5e-2 / 3.8e-2 | 1.3e-2 | 3.9e-2 | 13.3% (2) | 13.3% (2) | 13.3% (2) | 13.3% (2) | 0.0% (0) | 0.0% (0) |
| same exclusion set | 15 | 0 / 2.6e-6 / 1.5e-2 / 3.8e-2 | 1.3e-2 | 3.9e-2 | 13.3% (2) | 13.3% (2) | 13.3% (2) | 13.3% (2) | 0.0% (0) | 0.0% (0) |
| different exclusion set | 0 | – / – / – / – | – | – | – | – | – | – | – | – |
| d4 seeds | 9 | 0 / 4.8e-9 / 4.6e-5 / 2.1e-4 | 4.1e-6 | 2.1e-4 | 0.0% (0) | 0.0% (0) | 0.0% (0) | 0.0% (0) | 0.0% (0) | 0.0% (0) |
| d5 seeds | 6 | 0 / 4.4e-4 / 3.1e-2 / 3.8e-2 | 1.3e-2 | 3.9e-2 | 33.3% (2) | 33.3% (2) | 33.3% (2) | 33.3% (2) | 0.0% (0) | 0.0% (0) |

Two answers that both pass the oracle carry the true exclusion set (the oracle requires it exactly), so the "different exclusion set" row is empty by construction; the split below over all schema-valid pairs shows where set differences do occur.

**By number (Vmax / Km, inhibitor-free / inhibitor conditions)** — one entry per number per correct–correct pair; share of numbers whose spread exceeds t:

| numbers | n | spread min / median / p90 / max | > 0.001 | > 0.005 | > 0.01 | > 0.02 | > 0.05 | > 0.1 |
|---|---|---|---|---|---|---|---|---|
| Vmax, inhibitor-free conditions | 75 | 0 / 0 / 6.1e-6 / 1.2e-2 | 2.7% | 1.3% | 1.3% | 0.0% | 0.0% | 0.0% |
| Vmax, inhibitor conditions (shared Vmax) | 36 | 0 / 0 / 6.4e-6 / 6.9e-6 | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| Km, inhibitor-free conditions | 75 | 0 / 1.7e-9 / 5.6e-5 / 3.8e-2 | 2.7% | 2.7% | 2.7% | 2.7% | 0.0% | 0.0% |
| Km (apparent), inhibitor conditions | 36 | 0 / 1.9e-7 / 1.0e-5 / 8.7e-4 | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| all Vmax | 111 | 0 / 0 / 6.4e-6 / 1.2e-2 | 1.8% | 0.90% | 0.90% | 0.0% | 0.0% | 0.0% |
| all Km | 111 | 0 / 4.8e-9 / 1.9e-5 / 3.8e-2 | 1.8% | 1.8% | 1.8% | 1.8% | 0.0% | 0.0% |

<details><summary>By condition id (ids are per task; C1… are not the same condition across seeds)</summary>

| condition | n numbers | spread min / median / p90 / max | > 0.001 | > 0.005 | > 0.01 | > 0.02 | > 0.05 | > 0.1 |
|---|---|---|---|---|---|---|---|---|
| C1 | 30 | 0 / 7.2e-11 / 6.5e-6 / 9.4e-6 | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| C2 | 30 | 0 / 1.1e-9 / 5.8e-5 / 8.7e-4 | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| C3 | 30 | 0 / 0 / 6.6e-6 / 6.8e-5 | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| C4 | 30 | 0 / 1.9e-11 / 5.5e-6 / 3.8e-2 | 6.7% | 6.7% | 6.7% | 3.3% | 0.0% | 0.0% |
| C5 | 30 | 0 / 2.1e-10 / 7.0e-5 / 2.5e-2 | 6.7% | 3.3% | 3.3% | 3.3% | 0.0% | 0.0% |
| C6 | 30 | 0 / 3.0e-10 / 5.5e-6 / 4.5e-5 | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| C7 | 30 | 0 / 6.5e-10 / 5.8e-6 / 1.5e-4 | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| C8 | 12 | 0 / 2.5e-7 / 6.4e-6 / 1.5e-5 | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |

</details>

**All schema-valid answer pairs of a seed, by exclusion set** (share judged the same at t):

| pairs | n | spread min / median / p90 / max | same@0.001 | same@0.005 | same@0.01 | same@0.02 | same@0.05 | same@0.1 |
|---|---|---|---|---|---|---|---|---|
| same set, both pass | 15 | 0 / 2.6e-6 / 1.5e-2 / 3.8e-2 | 86.7% | 86.7% | 86.7% | 86.7% | 100.0% | 100.0% |
| same set, one or none passes | 4 | 0 / 1.1e-5 / 6.3e-5 / 8.4e-5 | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| different set | 5 | 5.5e-3 / 9.5e-3 / 2.5e-2 / 2.9e-2 | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |

## 2. Wrong agent answers, next to the Stage A controls

Sessions that fail the oracle: 13 schema-valid wrong answers, 0 schema-invalid, 0 without an answer.json. Distance is to the bed's reference answer (`referenceSolve`, fitter-A quality) and to the nearest passing agent answer of the same seed.

| region (vs reference) | wrong answers |
|---|---|
| set differs | 13/13 |
| same set, < 0.05 | 0/13 |
| same set, 0.05–0.134 | 0/13 |
| same set, ≥ 0.134 | 0/13 |
| missing conditions | 0/13 |

Same-set wrong answers' distance from the reference, min / median / max: – / – / –. False agreement with the reference at t (of 13): 0.001: 0, 0.005: 0, 0.01: 0, 0.02: 0, 0.05: 0, 0.1: 0. With passing agent answers of the same seed (of 5 correct–wrong pairs): 0.001: 0, 0.005: 0, 0.01: 0, 0.02: 0, 0.05: 0, 0.1: 0.

| session | d | oracle fails on | set = ref | Δset | dist to ref | ΔVmax | ΔKm | nearest passing agent | max truth err | estimator on own set |
|---|---|---|---|---|---|---|---|---|---|---|
| 202:0 | 4 | set (−0/+8) | no | 8 | 0.027 | 0.009 | 0.028 | – | 0.047 | sop-rounded-5sf |
| 202:1 | 4 | set (−0/+8) | no | 8 | 0.027 | 0.009 | 0.028 | – | 0.047 | sop-rounded-5sf |
| 207:1 | 4 | set (−0/+1) | no | 1 | 0.006 | 0.000 | 0.006 | 0.006 | 0.035 | sop-rounded-6sf |
| 208:0 | 4 | set (−0/+8) | no | 8 | 0.068 | 0.025 | 0.073 | – | 0.048 | sop |
| 208:1 | 4 | set (−0/+8) | no | 8 | 0.068 | 0.025 | 0.073 | – | 0.048 | sop-rounded-5sf |
| 212:1 | 4 | set (−0/+1) | no | 1 | 0.020 | 0.008 | 0.020 | 0.020 | 0.041 | sop-rounded-5sf |
| 213:0 | 4 | set (−1/+0) | no | 1 | 0.007 | 0.003 | 0.007 | 0.007 | 0.049 | sop-rounded-6sf |
| 214:0 | 4 | set (−1/+0) | no | 1 | 0.022 | 0.010 | 0.022 | – | 0.044 | sop-rounded-4sf |
| 214:1 | 4 | set (−1/+0) | no | 1 | 0.022 | 0.010 | 0.022 | – | 0.044 | sop-rounded-6sf |
| 215:0 | 4 | set (−0/+8) | no | 8 | 0.029 | 0.013 | 0.029 | 0.029 | 0.048 | sop-rounded-4sf |
| 219:0 | 5 | set (−1/+1) | no | 2 | 0.055 | 0.002 | 0.058 | – | 0.049 | loose-optimiser |
| 219:1 | 5 | set (−1/+1) | no | 2 | 0.055 | 0.002 | 0.058 | – | 0.049 | loose-optimiser |
| 223:0 | 5 | set (−0/+9) | no | 9 | 0.009 | 0.000 | 0.009 | 0.009 | 0.045 | sop-rounded-5sf |

Stage A controls (synthetic, fitter A vs control; `out/gauge-results.json`), n = 24 each, for comparison:

| control | n | exclusion set differs | same-set distance min / median / max | FA@0.05 |
|---|---|---|---|---|
| **agent wrong answers (this run)** | 13 | 13/13 | – / – / – | 0/13 (vs reference) |
| empty | 24 | 24/24 | – | 0.0% |
| shuffled-or-corrupted | 24 | 0/24 | 0.678 / 0.850 / 0.947 | 0.0% |
| pbw:keep-outliers | 24 | 24/24 | – | 0.0% |
| pbw:over-exclude-decoys | 24 | 24/24 | – | 0.0% |
| pbw:ignore-units | 24 | 0/24 | 1.000 / 1.000 / 1.086 | 0.0% |
| pbw:ignore-corrections | 24 | 0/24 | 0.952 / 0.999 / 1.000 | 0.0% |
| pbw:one-exclusion-missed | 24 | 24/24 | – | 0.0% |
| pbw:apply-rejected-claims | 24 | 0/24 | 0.134 / 0.423 / 1.000 | 0.0% |
| pbw:ignore-dose | 24 | 0/24 | 0.500 / 0.500 / 0.762 | 0.0% |
| pbw:exclude-by-residual | 24 | 24/24 | – | 0.0% |
| near-miss:km-12pct | 24 | 0/24 | 0.068 / 0.119 / 0.151 | 0.0% |

## 3. Why correct–correct pairs disagree, and whether one shared refit removes it (row 37)

Each schema-valid answer is matched against fits on the shared points (the world's displayed values, as the reference solver sees them) with the answer's own exclusion set: the SOP fit (fitter A) up to the digits the answer printed (+1e-5) → `sop` / `sop-rounded-Nsf`; else one of the non-SOP estimators (replicate means, 1/v² weights, Hanes–Woolf, Lineweaver–Burk, Eadie–Hofstee, free Vmax for inhibitor conditions) → `estimator:*`; else within 1e-3 of the SOP fit → `loose-optimiser`; else `other` (a parse or data decision the shared points do not share, or an unidentified fit). A pair's cause: exclusion-set if the sets differ; non-convergence/other if either answer is `loose-optimiser` or `other`; estimator if either is `estimator:*`; else precision/rounding.

| relTol | correct–correct pairs | disagree | precision/rounding | estimator | exclusion-set | non-convergence/other | vanish after shared refit |
|---|---|---|---|---|---|---|---|
| 0.001 | 15 | 2 | 0 | 0 | 0 | 2 | 2/2 |
| 0.005 | 15 | 2 | 0 | 0 | 0 | 2 | 2/2 |
| 0.01 | 15 | 2 | 0 | 0 | 0 | 2 | 2/2 |
| 0.02 | 15 | 2 | 0 | 0 | 0 | 2 | 2/2 |
| **0.05** | 15 | 0 | 0 | 0 | 0 | 0 | – |
| 0.1 | 15 | 0 | 0 | 0 | 0 | 0 | – |

No correct–correct pair disagrees at 0.05 (n = 15 pairs).

Answer classes (all schema-valid answers, by oracle verdict): fail:loose-optimiser 2, fail:sop 1, fail:sop-rounded-4sf 2, fail:sop-rounded-5sf 5, fail:sop-rounded-6sf 3, pass:loose-optimiser 1, pass:other 2, pass:sop 4, pass:sop-rounded-4sf 7, pass:sop-rounded-5sf 11, pass:sop-rounded-6sf 10.

Caveat (Stage A, row 37): the shared refit uses the shared points, so it also erases unit, correction and dose mistakes; "vanishes after the shared refit" is safe only for answers that passed, or if each answer carries its own point table.

## 4. Oracle-passing answers: distance from the reference and from the generating truth

| n = 35 passing answers | min | median | p90 | max |
|---|---|---|---|---|
| dist to reference (worst number, Δ/max) | 8.4e-9 | 3.2e-6 | 1.7e-4 | 3.8e-2 |
| ΔVmax/Vmax to reference | 1.9e-9 | 2.1e-6 | 1.3e-5 | 1.2e-2 |
| ΔKm/Km to reference | 8.4e-9 | 1.1e-6 | 1.7e-4 | 3.8e-2 |
| worst relative error to truth (oracle) | 0.035 | 0.045 | 0.049 | 0.082 |
| Vmax error to truth | 0.011 | 0.020 | 0.030 | 0.035 |
| Km error to truth | 0.035 | 0.045 | 0.049 | 0.082 |
| the reference's own worst error to truth (same tasks) | 0.035 | 0.045 | 0.049 | 0.049 |

Passing answers judged the same as the reference at t (of 35): 0.001: 33, 0.005: 33, 0.01: 33, 0.02: 33, 0.05: 35, 0.1: 35. The oracle box is ±10% around the truth; the reference itself sits within 5% of it (README), so a passing answer far from the reference is using the slack between the two.

## What this does not show

- n is small: 48 sessions, 15 correct–correct pairs, 13 schema-valid wrong answers. Rates are counts on these sessions, not population estimates.
- Dev calibration only (FG §4.1, O1): the seeds were used during development; a value chosen from these tables cannot be frozen without O1, and the README-precision fallback (0.05) stays available.
- Two sessions per seed give at most one correct–correct pair per seed; seeds where only one session passes contribute no pair.
