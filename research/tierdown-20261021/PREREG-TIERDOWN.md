# PREREG-TIERDOWN (A10 / #33, #42): frozen before any paid call

**Frozen file.** [`PREREG-TIERDOWN.json`](PREREG-TIERDOWN.json), sha256
`2790ad22d0013a087c10573225f433429ee4ea79ac597e9bf4c55b4a5dfaffd4`, written 2026-11-04 14:28 UTC by Claude Opus 5.5
(workflow subagent `wf_6d3b90c9-c30-9`) after the $0 leverage screen and before any Haiku or Mercury call of this item.
`tier-replay.mjs --expect-sha` refuses to run against any other version of the file.

**What was seen before freezing.** The $0 leverage screen over all 88 archived compiled answers (C and H rows alike:
it uses synthetic perturbations only, never a cheaper tier's answer), the per-site request sizes, and the C-slice
requests of five records sites (read to write the rule tier). No H-slice request was read by a person or a model.

**Evidence class.** Development. The units are archived dev-split runs (seeds 201–248). H is held out from every choice
this item makes; it is not sealed and it is not a fresh draw.

## Design in brief

- **Split.** A task is in H iff the first hex digit of `sha256('tierdown-20261021/split\0' + taskKey)` is ≥ 8.
  Records: C 36 runs / 16 tasks, H 28 runs / 14 tasks. Kinetics: C 10 / 8, H 14 / 8.
- **Sites and tiers.** Ten sites (table in the JSON). Model tiers: `claude-haiku-5-5` and `mercury-3` (ids from
  `policy/models.json`). Code tiers: `rule` (written from C only, abstains when unsure) and `memo` (identical earlier
  request). `jev-1.13.0` is refused: `FOUNDRY_SYSTEMONE_API_KEY` is not provisioned in this session.
- **Leverage classes** from the C rows of the perturbation screen: low < 0.05 ≤ mid < 0.20 ≤ high.
- **Selection on C.** Per site, the cheapest tier that passes Bound 2 on C and has zero pass→fail injected flips on C.
  Order: descending C-slice judge saving per unit. Frozen with the rule-tier sha256 in `AMENDMENT-1` before any H call.
- **Promotion on H (primary).** Bound 1: one-sided 95% Clopper-Pearson upper bound on the H pass→fail flip rate ≤ δ
  (0.10 / 0.05 / 0.02 for low / mid / high). Bound 2: mean decision-leaf disagreement ≤ 0.05 and usable-answer rate
  ≥ 0.95. Fixed-sequence testing at α = 0.05, stopping at the first failure.
- **Stated prediction.** Bound 1 cannot hold for any site on this archive: zero flips need 29 / 59 / 149 units, and the
  largest per-site H count is 16. The primary policy is expected to keep every reference tier (cost saved 0).
- **Secondary (exploratory, labelled as such).** A provisional tier-down: zero H pass→fail flips and Bound 2 on H.
  Its cost saving is reported with the bounds it does not meet.
- **Equal accuracy.** Exact McNemar and non-inferiority at 3 points on paired H units, flips in both directions.
- **Capability number.** Cost saved at equal accuracy = 1 − C_policy / C_ref (delivery judge USD per unit on H), with
  p50 / p95 judge latency; build-time spend reported apart.
- **Baselines.** B-ref, B-screen (the 0.98 leaf-agreement rule without leverage), B-all-haiku, B-all-mercury, B-sink
  (reference on global readers, cheapest elsewhere), B-memo.
- **Budget.** Haiku ≤ $3 (hard cap in the tool), Mercury run token cap 450,000, total ≤ $5. Environment faults are
  never scored; five in a row stop the run, the driver waits 30 minutes and resumes.
