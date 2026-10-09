# Kinetics comparator gauge, Stage A (row 2) and the shared SOP fitter (row 37)

*2026-10-09 · $0 · no model calls · kinetics dev seeds 201–224 only (d4 for 201–216, d5 for 217–224, as `dev-kinetics-1.json`).
Seeds 225+ and `beds/sealed/` were not touched; `gauge.mjs` has a seed guard.*

Source rows: `research/jit-20261008/BLOCKER-SYNTHESIS.md` §2.1 rows 2 (Stage A) and 37, and conflict C1 (§3).

## Files

| file | what |
|---|---|
| `fitters.mjs` | Two independent SOP-compliant fitters (A: Levenberg–Marquardt on ln Vmax, ln Km, multi-start; B: variable projection + Brent on ln Km), the shared-Vmax rule for inhibitor conditions, and five SOP-**violating** variants (replicate means, 1/v² weighting, Hanes–Woolf, Lineweaver–Burk, Eadie–Hofstee). Neither A nor B calls `beds/kinetics/fit.mjs`. |
| `refit.mjs` | Row 37: the one shared fitter (SOP §5 = fitter A, B as cross-check), `retainedPoints`, `refitAnswer`, `decisionFirstSame`. |
| `gauge.mjs` | The experiment. `node --max-old-space-size=1024 research/jit-20261008/analysis/kinetics-gauge/gauge.mjs` (4 s, 100 MB). |
| `tables.mjs` | Prints the tables below from `out/gauge-results.json`. |
| `out/` | `gauge-results.json` (everything), `pairs-cc.jsonl` / `pairs-cw.jsonl` (one row per pair), `answers-A.json` (fitter-A answer per seed), `tables.md`. |

## What Stage A is, and is not

- **The SOP fixes the estimator.** SOP §5 reads: unweighted nonlinear least squares of v = Vmax·[S]/(Km + [S]) on all retained
  individual wells, "do not average replicates first and do not use linearised plots such as Lineweaver–Burk"; inhibitor
  conditions use the Vmax fitted on the inhibitor-free condition of the same pH and temperature. So two SOP-compliant fitters
  can differ only by numerical routine, not by method. That is why fitters A and B (two algorithms for one estimator) are the
  "correct–correct" pair; the variants are what a non-compliant agent might do, kept apart as a sensitivity analysis.
- **Both fitters see the same cleaned data.** Parsing the prose (exclusions, units, corrections, dose) is the hard part of the
  task and is exactly what Stage B measures. Stage A takes the world's retained wells (`status !== 'outlier'`, displayed values
  after the bed's own unit and correction handling) and the true SOP exclusion set, so it isolates the fitting spread only.
- **"Correct" = passes `oracle()`.** A, B and the bed's `referenceSolve` pass on 24/24 seeds. Generating-truth error of the
  reference-quality fit: max 4.9%, median per-task max 4.5% (README: rejection-sampled to ≤ 5%).
- **Metric.** The spread is `|a − b| / max(|a|, |b|)` per number (what `compare.mjs` thresholds against), worst number over
  all conditions of the pair. `|Δvmax|/vmax` and `|Δkm|/km` (relative to the first answer) are in their own columns.
  `compare.mjs` tolerant mode: `tolerantKeys ['vmax','km']`, `absTol 1e-9`; `condition_id` and `excluded_samples` are compared
  exactly (strings; the exclusion list as a multiset), which is the "set-exact exclusion" of the task.
- 24 seeds × (1 pair per fitter pair) is a small sample; it is a fixed-seed dev replay, not an interval estimate. The seeds
  have been seen before (DEV-NOTES), which does not matter for a fitter or control comparison.

## Result 1: correct–correct spread and false-disagreement

FD@t = share of correct–correct pairs that `tolerantEqual` judges different at relTol t.

| pair | n | median / max spread | max \|Δvmax\|/vmax | max \|Δkm\|/km | FD@0.001 | FD@0.002 | FD@0.005 | FD@0.01 | FD@0.02 | FD@0.05 |
|---|---|---|---|---|---|---|---|---|---|---|
| **A vs B (SOP-compliant)** | 24 | 3.6e-9 / 7.3e-9 | 2.0e-9 | 7.3e-9 | 0% | 0% | 0% | 0% | 0% | 0% |
| A vs bed `fit.mjs` | 24 | 5.9e-9 / 1.0e-8 | 2.3e-9 | 1.0e-8 | 0% | 0% | 0% | 0% | 0% | 0% |
| B vs bed `fit.mjs` | 24 | 6.4e-9 / 9.9e-9 | 2.9e-9 | 9.9e-9 | 0% | 0% | 0% | 0% | 0% | 0% |
| *output rounded to 4 s.f.* | 24 | 2.6e-4 / 4.8e-4 | 3.6e-4 | 4.8e-4 | 0% | 0% | 0% | 0% | 0% | 0% |
| *output rounded to 3 s.f.* | 24 | 2.9e-3 / 4.8e-3 | 4.8e-3 | 4.7e-3 | 100% | 83% | 0% | 0% | 0% | 0% |
| *output rounded to 2 s.f.* | 24 | 2.7e-2 / 3.7e-2 | 3.6e-2 | 3.8e-2 | 100% | 100% | 100% | 100% | 83% | 0% |
| SOP-violating: replicate means | 24 | 8.6e-3 / 3.9e-2 | 8.4e-3 | 3.9e-2 | 100% | 100% | 96% | 38% | 4% | 0% |
| SOP-violating: 1/v² weights | 17 | 5.4e-2 / 1.1e-1 | 3.5e-2 | 1.2e-1 | 100% | 100% | 100% | 100% | 100% | 71% |
| SOP-violating: Hanes–Woolf | 23 | 4.3e-2 / 8.2e-2 | 2.4e-2 | 8.2e-2 | 100% | 100% | 100% | 100% | 96% | 35% |
| SOP-violating: Eadie–Hofstee | 12 | 3.9e-2 / 9.0e-2 | 2.9e-2 | 9.0e-2 | 100% | 100% | 100% | 100% | 100% | 25% |
| SOP-violating: Lineweaver–Burk | 5 | 7.7e-2 / 8.0e-2 | 6.0e-2 | 8.6e-2 | 100% | 100% | 100% | 100% | 100% | 80% |

- Rows in italics are fitter A's output rounded, i.e. the same numbers an agent would print with fewer digits.
- The variant rows are restricted to seeds where the variant also passes the oracle ("correct"): means 24/24, Hanes–Woolf
  23/24, 1/v² 17/24, Eadie–Hofstee 12/24, Lineweaver–Burk 5/24. A linearised or weighted fit that deviates from the SOP can
  pass the 10% oracle and still sit 8–11% from the SOP fit.
- **Noise floor of an SOP-compliant fit: below 1e-8.** Fine grid: A–B false-disagreement is 100% at relTol 1e-9 (absTol 1e-9
  and a 1e-9 relative tolerance are the same order as the optimiser tolerance) and 0% from 1e-7 (A vs the bed's own fit: 4% at 1e-8). The BUILD-NOTES figure "about
  1e-5" (dossier 5) holds, with margin.

## Result 2: correct–wrong pairs (fitter A vs each bed control)

Distance = `|a − b|/max` of the worst number, among tasks where the control has the **correct exclusion set**. FA@t = share of
(control, seed) pairs judged the same at relTol t, with set-exact exclusions. n = 24 per control.

| control | exclusion set differs | same-set distance: min / median / max | FA@0.001 … FA@0.05 |
|---|---|---|---|
| `empty` | 24/24 | – | 0% at every t |
| `shuffled-or-corrupted` | 0/24 | 0.678 / 0.850 / 0.947 | 0% |
| pbw `keep-outliers` | 24/24 | – (numbers differ 3%–33%, median 10%) | 0% |
| pbw `over-exclude-decoys` | 24/24 | – (**numbers identical**: only the list differs) | 0% |
| pbw `ignore-units` | 0/24 | 1.000 / 1.000 / 1.086 | 0% |
| pbw `ignore-corrections` | 0/24 | 0.952 / 0.999 / 1.000 | 0% |
| pbw `one-exclusion-missed` | 24/24 | – (numbers differ 0%–22%, median 0.6%) | 0% |
| pbw `apply-rejected-claims` | 0/24 | 0.134 / 0.423 / 1.000 | 0% |
| pbw `ignore-dose` | 0/24 | 0.500 / 0.500 / 0.762 | 0% |
| pbw `exclude-by-residual` | 24/24 | – (numbers differ 1%–5%, median 2%) | 0% |
| `near-miss:km-12pct` (not one of the 8) | 0/24 | 0.068 / 0.119 / 0.151 | 0% |

**False-agreement rate of the 8 plausible-but-wrong controls: 0/192 at every relTol in {0.001 … 0.05}.** The same holds for all
264 control pairs including `empty`, `shuffled` and the near-miss.

Without the exclusion set (numbers only, i.e. `excluded_samples` blanked on both sides) the 8 controls would agree with the
correct answer in 15% / 16% / 19% / 21% / 28% / 37% of pairs at relTol 0.001 / 0.002 / 0.005 / 0.01 / 0.02 / 0.05. The
set-exact check carries half the controls (`keep-outliers`, `over-exclude-decoys`, `one-exclusion-missed`,
`exclude-by-residual`); the tolerance carries the other half.

Smallest same-set distance seen: **0.068** (near-miss), **0.134** (`apply-rejected-claims`, the closest of the 8). Everything
else is 0.5 or more.

## Verdict on the synthesis' prediction

> "Most controls differ by ≥ 15% or by the exclusion set, so Stage A alone cannot set the value."

**Confirmed, with a sharper reason.**

- Of the 192 plausible-but-wrong (control, seed) pairs, 96 differ in the exclusion set and 94 of the remaining 96 differ by
  ≥ 15%; only 2 (both `apply-rejected-claims`, 13.4% and 14.2%) are closer, so **190/192 (99%)** satisfy "≥ 15% or the set".
  No same-set wrong answer is within 13% of the correct one.
- Stage A cannot set the value because **both error rates are flat at zero across the whole candidate range**:
  SOP-compliant correct–correct pairs sit at ~1e-8, wrong ones sit at ≥ 6.8% or differ in the set. Any relTol between ~1e-7
  and 0.05 gives 0% false-disagreement and 0% false-agreement on Stage A pairs. Stage A therefore identifies a **window**,
  not a value:
  - lower edge: the noise between two correct agent answers, which Stage A does not contain (SOP fitters: 1e-8; but 4-digit
    printing needs ≥ 1e-3, 3-digit needs ≥ 5e-3, a replicate-mean fit needs ≥ 0.04);
  - upper edge: the nearest wrong same-set answer, 0.068 (near-miss) / 0.134 (plausible-but-wrong). `compare.mjs`'s 0.05 cap
    is inside it by a factor of 1.4 against the 12% near-miss, so the cap protects but 0.068 is already the edge.
- What this does **not** show: how far apart two *agent* answers are when both pass. The only non-trivial correct–correct
  spreads here come from output rounding and from SOP-violating estimators, which are guesses about agent behaviour. They
  decide the lower edge, and only measured agent answers can say which of them occurs.

## What Stage B must add (two Haiku-agent sessions per seed 201–224; needs `CLAUDE_CODE_OAUTH_TOKEN`)

1. **Pairs of real agent answers that both pass the oracle**, scored with this script's `dist()` and `same()`: the spread
   distribution of correct–correct pairs (the lower edge), by condition and by Vmax/Km, split by whether the pair used the
   same exclusion set. Needs a decision on the pairing (the two sessions per seed give 1 pair per seed, 24 pairs; add pairs
   with the compiled/agent arms if a larger n is wanted).
2. **Agent answers that fail the oracle**, to put real wrong answers next to the synthetic controls: whether wrong agent
   answers cluster near the correct ones (small numeric error, same exclusion set) or sit in the control-like ≥ 13% region.
   Stage A controls were built to fail by a margin (traps are load-bearing > 13%); a real agent can fail by less.
3. **The cause of each correct–correct disagreement**: printing precision, estimator (means / weights / linearised),
   parse differences in a displayed value, different retained wells with the same set (cannot occur if the set is exact),
   or a fit that did not converge. This tells whether an exclusion-set + refit rule (row 37 below) would remove them.
4. **Oracle-passing agent answers' distance from the reference** (to confirm the 10% box is ~±5% in practice).
5. Stage B stays dev-calibration under FG §4.1: freezing the value needs O1 or the README-precision fallback (below).

## Row 37: decision-first comparison with one shared refit

The shared fitter is `refit.mjs` (SOP §5, fitters A and B agree to 1e-8, and agree with `beds/kinetics/fit.mjs` to 1e-8).
`gauge.mjs` applies it to every disagreeing pair whose exclusion sets are equal: refit both answers from the retained wells
of their (identical) set and compare.

| relTol | correct–correct (non-SOP + rounding) disagreeing pairs | vanish after shared refit | wrong (8 pbw controls) disagreeing | vanish after shared refit |
|---|---|---|---|---|
| 0.001 | 129 of 153 | **129 (100%)** | 192 of 192 | 96 (50%) |
| 0.005 | 104 of 153 | 104 (100%) | 192 | 96 (50%) |
| 0.01 | 90 of 153 | 90 (100%) | 192 | 96 (50%) |
| 0.02 | 77 of 153 | 77 (100%) | 192 | 96 (50%) |
| 0.05 | 27 of 153 | 27 (100%) | 192 | 96 (50%) |

- **Share of correct–correct disagreements that vanish: 100%** at every relTol, because passing the oracle forces the exact
  set, and then only the estimator or precision differs.
- **The same refit also removes 50% of the wrong answers' disagreement** (`ignore-units`, `ignore-corrections`,
  `apply-rejected-claims`, `ignore-dose`: right set, wrong data decisions). The refit takes the points as given, and the
  answer object does not say which points the answer used; with shared points, the unit, correction and dose errors that
  produced the wrong numbers are replaced by the right ones. So "exclusion set exactly, then shared refit" has a **false
  agreement rate of 50% on the plausible-but-wrong controls (96/192)**, against 0% for tolerant comparison with set-exact.
- This is by construction (the refit is blind to data decisions), and it is the finding: row 37 is only safe if each answer
  carries its own cleaned point table (`{well id, S, v}` per retained well) and the refit runs on those. Then fit-method and
  precision differences vanish (100%) and unit, correction and dose errors stay visible because the points differ. The
  point-table variant needs the solver to emit points, so it is a change to the output contract; it is not measured here.
- Even without the refit, the cheap rule works: for SOP-compliant solvers, set-exact exclusions plus relTol anywhere in the
  window above give 0% on both error rates in Stage A.

## C1 fallbacks (BLOCKER-SYNTHESIS §3, C1; Q4)

| source | stated precision | what it implies for relTol | Stage A check |
|---|---|---|---|
| Kinetics README (v4.0.0, "Oracle", "How the data are generated") and `world.mjs` | reference NLLS fit within **5%** of the generating parameters (`MARGIN = 0.05`); fit on replicate means within **8%** (`MEANS_MARGIN`); oracle tolerance 10% (`TOL`); "a different reasonable estimator, such as weighted least squares, is guaranteed only for the fit on replicate means (within 8%)" | 0.05 (the `compare.mjs` cap; no `allowLooseTolerance`), or 0.08 if the means fit is to count (loose) | Measured reference error to truth: max 4.9%, median per-task max 4.5%. At 0.05: false-disagreement 0% for SOP-compliant pairs, 17.6% for SOP-violating oracle-passers; false-agreement 0% (pbw), 0% (near-miss). At 0.08: 3.3% / 0% / **8.3%** (near-miss agrees) |
| Task prompt (grading rule) | every vmax and km within **10%** of the true parameters | 0.10 against a known-correct answer (loose, recorded). Two answers that each pass can be 0.2/1.1 = **18.2%** apart (`|a−b|/max`), so a symmetric rule between two unverified answers would need ~0.18 | At 0.10: false-disagreement 0% / 0.7%; false-agreement 0% (pbw), **25%** (near-miss). At 0.15: pbw 1.0%, near-miss 87.5%. At 0.20: pbw 1.6%, near-miss 100% |

Reading:
- The README-precision fallback (0.05) is inside the safe window of Stage A and needs no loosening flag. It is also the value
  at which the synthetic-control separation (0.068 for the near-miss, 0.134 for the closest plausible-but-wrong) still leaves
  a margin.
- The prompt's ±10% rule is a distance-to-truth rule. Used as an answer-to-answer tolerance it accepts the oracle's own
  near-miss (a Km 12% off) in 25% of tasks at 0.10 and the closest plausible-but-wrong control from 0.15, so it is not a safe
  comparator tolerance. It would also need `allowLooseTolerance`.
- Provenance per DEV-NOTES D7 and FG §4.1: a README-stated precision is an allowed threshold source; a value calibrated on
  dev data (Stage B) needs O1 (BLOCKER-SYNTHESIS §7).
- Stage A alone supports "0.05, with the exclusion set exact" as the conservative freeze candidate and says nothing for or
  against tighter values (0.005, 0.01, 0.02) until Stage B gives the agent-noise lower edge.

## Notes and limits

- The bed has 11 entries in `badControls`: `empty`, `shuffled-or-corrupted`, 8 `plausible-but-wrong:*` and `near-miss:km-12pct`
  (the synthesis' "10 known-bad controls" counts all but the near-miss). All 264 (control, seed) answers fail the oracle.
- `ignore-dose` at d3+ is the only control whose distance is a rate factor (0.50 = half the rates).
- The 4 same-set controls have distances ≥ 0.134. A real wrong answer with the correct exclusion set that applies every trap
  but one mild rounding or a small data mistake could be closer; the bed's traps are load-bearing by > 13% on some fit, so
  such answers are likely near the oracle's own boundary and nowhere in this table.
- Variants that fail the oracle are dropped from the correct–correct rows rather than counted as errors; 1/v², Eadie–Hofstee
  and Lineweaver–Burk fail it on 7, 12 and 19 seeds.
- Fitter noise floor 1e-8 is the optimiser tolerance, not a property of the data. A solver with a looser stopping rule (for
  example scipy `curve_fit` defaults, ~1e-8) lands in the same range.
