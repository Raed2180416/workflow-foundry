# SPINE-0 + LAT-0 + OUT-0: prediction (written 2026-10-15 08:50 UTC, before any adapter code or back-filled number)

FIRST-CLASS-PROGRAMS.md §0.1 (S1 with the S6 timing fields), §6.4 OUT-0, §8.4 LAT-0, §10 rows 1–2. $0: no model, Jev
or paid call; the back-fill reads existing run outputs only. Written at HEAD `b1fe87e`.

**What I had already seen when writing this (so these are not blind).** While surveying the outputs I read: the row
counts of every source; the E8 `result.json` summaries, build wall times and four build transcripts' final events
(`duration_ms`, `duration_api_ms`); agent-H s12's `wallMs` and its contaminated run's `wallMs`; the M1, M1-R, J-Q and
J-NEED-2 reports; the AutomationBench `summary.json` files and one live `calls.jsonl`. I had **not** computed any
latency quantile, any time per verified success, any coverage share, any origin share or any metered total across
sources.

## Minimum detectable effects (printed again by the back-fill before it runs)

| Reading | n | MDE | Consequence |
|---|---|---|---|
| E8 s12, built arm vs agent-H, paired completed cases | 14 | 6 discordant pairs all one way (exact two-sided McNemar p = 0.031); 0.43 in pass rate | the observed +4 (p = 0.125) reads **inconclusive** |
| AutomationBench A1 vs A0 (dev-first6), paired tasks | 6 | 6 of 6 discordant one way (p = 0.031); 1.00 in strict pass rate | any difference reads inconclusive |
| Time per verified success, any arm, K = 1 | – | no run-to-run variance is observable; the only interval is the success count's (Clopper–Pearson) | time ratios are descriptive; a ratio threshold resolves only if that interval excludes it |
| p99 latency per arm at n < 100 | ≤ 96 | p99 is the sample maximum (nearest rank) | tails are reported, never compared |
| Origin census | all rows | a count, not an estimate | no MDE |

## Predictions

Each has a refutation bar. Between the predicted value and the bar the reading is inconclusive.

- **P1 (F6 origin census).** Of the verdict-bearing back-filled rows, the third-party share is ≤ 10% by rows and ≤ 15% by
  metered USD, and the real-process share is 0. *Refuted* if the third-party share exceeds 20% on either measure.
  (A check rather than a test: the row counts were seen.)
- **P2 (the §12 meter).** Charging every back-filled source by the need router's meter (max of reported and re-priced;
  a row with no observed cost at its bound; set-aside attempts counted) gives a charged total ≥ 2.5× the reported total,
  and ≥ 80% of the difference comes from M1/M1-R timeouts at their $1 bound. *Refuted* if the ratio is < 1.5.
- **P3 (F8 tails, M1).** Per-call latency p99/p50 ≥ 10 for each M1 arm (effort none, effort medium) at d3. *Refuted* if
  < 5 for either arm.
- **P4 (F8 time to first effect, AutomationBench).** Over AutomationBench model rows whose live call log survives, the
  median share of session wall time that passes before the first mutating world call is ≥ 0.40. *Refuted* if < 0.25.
- **P5 (F8, E8 s12).** Ranked by wall time per verified success, every built arm that passes 14/14 is ahead of agent-H at
  both of agent-H's wall-time bounds, even with its whole build (and repair) charged to this one 14-case world.
  *Refuted* if any 14/14 built arm is behind agent-H's lower bound. (Inputs seen; a check.)
- **P6 (what the old outputs cannot say).** Of all back-filled rows, time to first effect is supplied for ≤ 40%, a
  model-versus-rest time split for ≤ 40%, and a wait duration (rate limit, Retry-After, queue, human) for 0%. *Refuted* if
  either of the first two reaches 50%; then S6's new fields are mostly back-fillable and S6 matters less than §8.2
  says.

## Reading rule

Development evidence only (dev seeds, dev-train, synthetic sets). Nothing here is a claim. A back-filled field the
outputs cannot supply is recorded as missing with the reason, never filled in. Values quoted only in a report are
marked `doc` and kept apart from values computed from outputs.
