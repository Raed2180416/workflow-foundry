# JIT stream report: jit-r0-kinetics

Generated 2026-10-14T16:07:05.648Z. Evidence: **development / diagnostic (not held-out evidence)**.

> K=1 stream per arm: any success gap under 3 points (tasks) is noise; arms with different task counts are not compared. This task rule is shown for continuity; the rule applied is the PREREG decision rule (3-point floor + McNemar + clustered CI over K >= 2 streams, experiments/jit/stats.mjs).

## Arms

| arm | n | success | 95% CI (Wilson) | total $ | $/success | $/task | last half (success, $/task) | delivered by |
|---|---|---|---|---|---|---|---|---|
| agent:claude-haiku-5-5 | 24 | 15/24 (62.5%) | 42.7%–78.8% | $2.086 | $0.139 | $0.087 | 9/12 (75.0%), $0.117 | interpreter 24 |
| jit:claude-opus-5-5/claude-haiku-5-5 | 14 | 13/14 (92.9%) | 68.5%–98.7% | $33.17 | $2.552 | $2.370 | 7/7 (100.0%), $2.859 | interpreter 9, compiled 3, adjudicated 2 |

## Cost breakdown ($)

| arm | components |
|---|---|
| agent:claude-haiku-5-5 | interpreter $2.086 |
| jit:claude-opus-5-5/claude-haiku-5-5 | interpreter $3.828, compileBuilder $7.799, compileGateway $10.30, compileCheck $6.856, compiled $1.027, shadow $2.166, adjudicator $1.196 |

## Compiled-path events

| arm | compiles (recompiles) | attempts / Opus fallbacks | rejected | failed | deopts by kind | crashes | timeouts | invalid | shadows | disagreements | adjudicated | regressions | unresolved | faults |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| jit:claude-opus-5-5/claude-haiku-5-5 | 6 (5) | 8 / 2 | 0 | 0 | judge 1, guard 5 | 0 | 0 | 0 | 5 | 3 | none 1, interpreter 2 | 2 | 1 | 0 |

## Uncertainty flags and flag-triggered shadows

Shadows are grouped by why they ran: scheduled (every shadowEvery-th compiled ok run, flagged or not, so an unbiased sample) or flag-triggered (jit.shadowOnFlags); a run both scheduled and flagged counts in both. Disagreement is with the shadow, not the oracle. Base rate = disagreement rate of unflagged runs in the scheduled sample; recall = share of the scheduled disagreements whose run was flagged; precision = disagreement rate of the flag-triggered shadows. Flag-only shadows are the extra ones flags caused (their shadow and adjudicator dollars). The oracle column is the experimenter's view only: the compiled answer's pass rate (compiledPass where an adjudicated answer replaced it). Prompt version 2 also sends near-threshold cases to a judge (item 6), so a gap between a v1 and a v2 arm mixes that change with flags; compare flagged and unflagged runs within an arm.

| arm | flagged runs / compiled ok (flag rate), flags | scheduled shadows | scheduled disagree: flagged / unflagged (base rate) | recall of flags | flag-triggered shadows (flag-only, $) | flag-triggered disagree (precision) | regressions from flags | oracle, compiled answer: flagged / unflagged | flags by name (runs) |
|---|---|---|---|---|---|---|---|---|---|
| jit:claude-opus-5-5/claude-haiku-5-5 | 5/5 (100.0%), 22 | 0 | no base rate, recall not measurable (no answered scheduled shadow) | – | 5 (4, $2.909) | 3/5 (60.0%) | 2 | 4/5, 0/0 | dilution-nonstandard 5, unit-corrected 5, relabel-applied 5, swap-applied 5, csv-reread 2 |

## Comparison and acceptance (non-default)

Shown only for arms with compile.compare, compile.acceptance or jit.compare set. Exact and partial are under the compile's comparison; canonical exact is the same cases under canonical JSON. Strict acceptance: clean, then (trace mean partial >= minPartial or one exact trace), then every diff case explained by its own quote, verbatim from its own task and not shared by every other case's task.

- jit:claude-opus-5-5/claude-haiku-5-5: compile comparison tolerant (rel 0.05, abs 1e-9, keys km vmax), acceptance strict (minPartial 0.9), shadow comparison tolerant (rel 0.05, abs 1e-9, keys km vmax); tolerant shadows 2, of which agreeing only within tolerance 2.

| arm | idx | version (builder) | comparison | exact / labelled (canonical exact) | mean partial | acceptance | passed | failed | unexplained | accepted |
|---|---|---|---|---|---|---|---|---|---|---|
| jit:claude-opus-5-5/claude-haiku-5-5 | 3 | v1 (claude-haiku-5-5) | tolerant (rel 0.05, abs 1e-9, keys km vmax) | 0/3 (0) | 0.87 | strict (trace partial 0.87 vs 0.9, exact traces 0) | clean | agreement, explained | trace-0, trace-1, trace-2 | no |
| jit:claude-opus-5-5/claude-haiku-5-5 | 3 | v1 (claude-opus-5-5) | tolerant (rel 0.05, abs 1e-9, keys km vmax) | 3/3 (0) | 1 | strict (trace partial 1 vs 0.9, exact traces 3) | clean, agreement, explained | – | – | yes |
| jit:claude-opus-5-5/claude-haiku-5-5 | 5 | v2 (claude-haiku-5-5) | tolerant (rel 0.05, abs 1e-9, keys km vmax) | 3/5 (0) | 0.6 | strict (trace partial 1 vs 0.9, exact traces 3) | clean, agreement, explained | – | – | yes |
| jit:claude-opus-5-5/claude-haiku-5-5 | 8 | v3 (claude-haiku-5-5) | tolerant (rel 0.05, abs 1e-9, keys km vmax) | 7/7 (0) | 1 | strict (trace partial 1 vs 0.9, exact traces 7) | clean, agreement, explained | – | – | yes |
| jit:claude-opus-5-5/claude-haiku-5-5 | 9 | v4 (claude-haiku-5-5) | tolerant (rel 0.05, abs 1e-9, keys km vmax) | 9/9 (0) | 1 | strict (trace partial 1 vs 0.9, exact traces 8) | clean, agreement, explained | – | – | yes |
| jit:claude-opus-5-5/claude-haiku-5-5 | 10 | v5 (claude-haiku-5-5) | tolerant (rel 0.05, abs 1e-9, keys km vmax) | 10/10 (0) | 1 | strict (trace partial 1 vs 0.9, exact traces 8) | clean, agreement, explained | – | – | yes |
| jit:claude-opus-5-5/claude-haiku-5-5 | 13 | v6 (claude-haiku-5-5) | tolerant (rel 0.05, abs 1e-9, keys km vmax) | 8/11 (0) | 0.815 | strict (trace partial 0.995 vs 0.9, exact traces 6) | clean, agreement | explained | trace-2 | no |
| jit:claude-opus-5-5/claude-haiku-5-5 | 13 | v6 (claude-opus-5-5) | tolerant (rel 0.05, abs 1e-9, keys km vmax) | 11/11 (0) | 1 | strict (trace partial 1 vs 0.9, exact traces 9) | clean, agreement, explained | – | – | yes |

## Against each agent arm

| arm | vs | success gap (tasks) | noise? | break-even idx (observed) | projected | cumulative $ gap |
|---|---|---|---|---|---|---|
| jit:claude-opus-5-5/claude-haiku-5-5 | agent:claude-haiku-5-5 | -2 | noise | – | – | $32.33 |

## Paired comparison, both units (this stream only)

Decision rule (PREREG §4): Effect reported only if: no arm invalid by the 25% env-fault rule; K >= 2 streams; pooled gap >= 3 points and every stream's gap >= 3 points in the same direction; exact two-sided McNemar p < 0.05 on pooled pairs; and the 95% lineage-clustered CI (wider of two-stage cluster bootstrap and Deff-widened task bootstrap, rho 0.1) excludes 0. Otherwise "directional, no decision". One run directory is one stream, so every row here is "directional, no decision"; `node experiments/jit/stats.mjs decide <armX> <armY> <runDir>...` applies the rule over K streams. Task rule = report.mjs NOISE_SUCCESSES (|gap| >= 3 tasks), shown, not applied. Point floor = 3 percentage points.

| arm | vs | gap (tasks) | gap (points) | task rule | point floor | McNemar X-only / Y-only, p | 95% clustered CI (points; Deff) | verdict |
|---|---|---|---|---|---|---|---|---|
| jit:claude-opus-5-5/claude-haiku-5-5 | agent:claude-haiku-5-5 | +6 of 14 | 42.9 | clears | clears | 7 / 1, 0.070 | -11.3 to 86.2 (2.3) | directional, no decision (one stream) |

## Environment faults (PREREG §6 rule)

Impaired = planned tasks left unresolved by an env fault (no row; for a JIT arm, every task after the fault that stopped the stream) plus rows whose shadow or adjudicator faulted. Invalid when impaired / planned > 25%. Fault events are faults.jsonl lines (after the one in-place retry); transient = recovered retries; both are reported, neither decides.

| arm | planned | impaired (unresolved + degraded) | rate | fault events (by code) | transient retries | verdict |
|---|---|---|---|---|---|---|
| agent:claude-haiku-5-5 | 24 | 0 (0 + 0) | 0.0% | 0 | 0 | valid |
| jit:claude-opus-5-5/claude-haiku-5-5 | 24 | 0 (0 + 0) | 0.0% | 0 | 0 | valid |

## Cumulative curves (successes / $ by task index)

| idx | agent:claude-haiku-5-5 | jit:claude-opus-5-5/claude-haiku-5-5 |
|---|---|---|
| 0 | 1 / $0.054 | 1 / $0.403 |
| 1 | 1 / $0.111 * | 2 / $0.818 |
| 2 | 1 / $0.155 * | 3 / $1.210 |
| 3 | 1 / $0.205 * | 4 / $10.13 |
| 4 | 2 / $0.264 | 5 / $10.61 |
| 5 | 2 / $0.312 * | 6 / $12.21 |
| 6 | 3 / $0.364 | 6 / $13.16 * |
| 7 | 4 / $0.410 | 7 / $13.56 |
| 8 | 5 / $0.461 | 8 / $16.68 |
| 9 | 5 / $0.505 * | 9 / $20.66 |
| 10 | 5 / $0.629 * | 10 / $24.14 |
| 11 | 6 / $0.677 | 11 / $24.60 |
| 12 | 7 / $0.806 | 12 / $25.04 |
| 13 | 7 / $0.848 * | 13 / $33.17 |
| 14 | 8 / $0.897 | – |
| 15 | 8 / $0.952 * | – |
| 16 | 9 / $1.044 | – |
| 17 | 10 / $1.203 | – |
| 18 | 11 / $1.274 | – |
| 19 | 12 / $1.526 | – |
| 20 | 12 / $1.631 * | – |
| 21 | 13 / $1.800 | – |
| 22 | 14 / $1.925 | – |
| 23 | 15 / $2.086 | – |

`*` marks a failed task at that index.

## Integrity flags

- agent:claude-haiku-5-5: nested model attempts 0, hidden-path attempts 65 (review by hand), voided compiles 0, rows with unknown cost 0.
- jit:claude-opus-5-5/claude-haiku-5-5: nested model attempts 0, hidden-path attempts 22 (review by hand), voided compiles 0, rows with unknown cost 1.
