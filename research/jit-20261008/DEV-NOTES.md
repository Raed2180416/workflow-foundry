# JIT dev-stream diagnoses (running log, development evidence)

*Dev split seeds only. The bed oracle's per-field mismatches are read here to diagnose, which dev evidence allows.
Nothing here is a claim. Each entry gives the observation, the mechanism and the design consequence.*

## 2026-10-09

**D1. Every silent compiled miss on records so far is under-merging.**
- Observation: the Opus- and Sonnet-interpreted arms (v1 and v2) have 4 compiled failures. All 4 have `predicted > entities`: 42 vs 41, 40 vs 39, 36 vs 34, 40 vs 36. The unmerged pairs are one-typo variants: "Bneoit N."/"Benoît", "de Vreis"/"de Vries", "Anook"/"Anouk". The split entity then takes the wrong country, phone or amount. No guard or invariant fired, and the result passed its own checks.
- Mechanism: the compiled fuzzy identity rule (one typing error allowed, plus an equal date or a shared phone) is a hard threshold. Clear cases go right, and near-threshold cases fall on the wrong side. The agent handles them by judgment.
- Consequence (v2 compile guidance): after any grouping, dedup or merge step, scan for near-miss groups (similar keys plus a shared secondary attribute). Send them to a narrow same-entity `flow.judge` with a verifiable check, and `flow.flag` them so the stream shadows those runs. This is a general pattern (decide clear cases in code, borderline cases with a judge), not a records special case.

**D2. A weak interpreter cannot check its own compiled code.**
- Observation: the Haiku-interpreted, Haiku-compiled arm learned a conflict-resolution procedure error from noisy Haiku traces. Amount, phone and country fields are wrong on several entities in every compiled run, at $0.004–0.007 per run. On task 7 a Haiku shadow disagreed, the Haiku adjudicator gave no majority (`unresolved`), and the wrong compiled answer was delivered.
- Consequence: interpreter quality bounds both the traces and the shadows. The economical configuration is a strong demonstrator used rarely (warmup, deopts, sampled shadows) with a cheap compiler and executor. The held-out round keeps Haiku/Haiku as an explicit negative control.

**D3. Over-strict judge checks cause deopts, and deopts heal.**
- Observation: the Opus/Haiku v1 deopted on 2 consecutive tasks. Its `vendex-entries` judge failed its own check (spans must be substrings and dates and amounts must parse) on every tier. Both tasks were re-solved correctly by the Opus interpreter. The two traces triggered recompile v2, which passed its first task ($0.90 including the recompile), and its compiled runs then cost about $0.009.
- Consequence: the loop works as designed. Check calibration is the next lever. A check that fails on every tier for an input class should become a guard (deopt immediately, without paying for escalation) or be loosened at recompile.

**D4. Compile acceptance is too permissive under the noisy-label rule.**
- Observation: kinetics Haiku/Haiku v1 was accepted with exact 0/3 and partial 0.546, because the rule is "clean (no crash or deopt) plus every disagreement named in BUILD-NOTES". The Sonnet-arm records v1 was accepted with exact 0/3 and partial 0.997, and that one worked fine.
- Consequence (v2): acceptance needs a minimum agreement level (for example mean partial ≥ 0.9, or at least one exact match among the labelled traces). Each named disagreement must also quote the task sentence that decides it. Otherwise the run counts as not accepted and gets the Opus fallback.

**D5. Static compiled code fails silently on drift.**
- Observation: the C0 B1-haiku records solver was built with oracle-scored probes at d3. In this stream it went 14/16 at d3, then 2/8 at d4, and never signalled. The JIT arms' guards fired on their first d4 tasks (Sonnet arm: deopt on #16 and #17, both re-solved correctly by the interpreter).
- Consequence: guards are the difference between graceful and silent degradation on distribution shift. This needs a preregistered held-out test with a drift segment.

**D6. Leaf agreement under-counts semantically equal judge outputs.**
- Observation: the Sonnet arm's `rules` judge is Opus-only and makes up about 90% of compiled cost. When it was replayed on Haiku and Sonnet, every decision matched except the marker representation (`"env":"sandbox"` vs `sandbox`). Leaf agreement was 0.966, under the 0.98 bar.
- Consequence: screen a tier-down end to end. Swap the judge's tier inside the compiled solver and compare final answers and dev-oracle scores (`tierdown-e2e`, being built).
