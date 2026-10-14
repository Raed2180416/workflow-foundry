# JIT stream report: jit-dev-kinetics-1

Generated 2026-10-14T12:00:17.846Z. Evidence: **development / diagnostic (not held-out evidence)**.

> K=1 stream per arm: any success gap under 3 points (tasks) is noise; arms with different task counts are not compared. This task rule is shown for continuity; the rule applied is the PREREG decision rule (3-point floor + McNemar + clustered CI over K >= 2 streams, experiments/jit/stats.mjs).

## Arms

| arm | n | success | 95% CI (Wilson) | total $ | $/success | $/task | last half (success, $/task) | delivered by |
|---|---|---|---|---|---|---|---|---|
| agent:claude-haiku-5-5 | 24 | 17/24 (70.8%) | 50.8%–85.1% | $2.103 | $0.124 | $0.088 | 8/12 (66.7%), $0.119 | interpreter 24 |
| agent:claude-sonnet-5-5 | 24 | 17/24 (70.8%) | 50.8%–85.1% | $7.402 | $0.435 | $0.308 | 8/12 (66.7%), $0.346 | interpreter 24 |
| jit:claude-haiku-5-5/claude-haiku-5-5 | 12 | 8/12 (66.7%) | 39.1%–86.2% | $20.66 (incl. $8.570 unfinished attempts) | $2.582 | $1.721 | 4/6 (66.7%), $1.330 | interpreter 7, compiled 5 |
| jit:claude-opus-5-5/claude-haiku-5-5 | 19 | 17/19 (89.5%) | 68.6%–97.1% | $21.99 (incl. $1.260 unfinished attempts) | $1.293 | $1.157 | 8/9 (88.9%), $0.602 | interpreter 9, compiled 10 |
| jit:claude-sonnet-5-5/claude-haiku-5-5 | 13 | 7/13 (53.8%) | 29.1%–76.8% | $21.49 (incl. $1.040 unfinished attempts) | $3.070 | $1.653 | 3/6 (50.0%), $0.848 | interpreter 9, compiled 4 |

## Cost breakdown ($)

| arm | components |
|---|---|
| agent:claude-haiku-5-5 | interpreter $2.103 |
| agent:claude-sonnet-5-5 | interpreter $7.402 |
| jit:claude-haiku-5-5/claude-haiku-5-5 | interpreter $0.482, compileBuilder $2.083, compileGateway $4.338, compileCheck $3.205, compiled $1.881, shadow $0.047, adjudicator $0.050 |
| jit:claude-opus-5-5/claude-haiku-5-5 | interpreter $4.390, compileBuilder $5.432, compileGateway $5.268, compileCheck $2.747, compiled $1.095, shadow $0.874, adjudicator $0.921 |
| jit:claude-sonnet-5-5/claude-haiku-5-5 | interpreter $2.446, compileBuilder $8.309, compileGateway $7.131, compileCheck $1.660, compiled $0.346, shadow $0.259, adjudicator $0.298 |

## Compiled-path events

| arm | compiles (recompiles) | attempts / Opus fallbacks | rejected | failed | deopts by kind | crashes | timeouts | invalid | shadows | disagreements | adjudicated | regressions | unresolved | faults |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| jit:claude-haiku-5-5/claude-haiku-5-5 | 1 (0) | 3 / 1 | 1 | 0 | judge 3, guard 1 | 0 | 0 | 0 | 1 | 1 | none 1 | 0 | 1 | 2 |
| jit:claude-opus-5-5/claude-haiku-5-5 | 3 (2) | 5 / 2 | 0 | 0 | judge 1, guard 5 | 0 | 0 | 0 | 2 | 2 | none 2 | 0 | 2 | 2 |
| jit:claude-sonnet-5-5/claude-haiku-5-5 | 3 (2) | 5 / 2 | 0 | 0 | guard 6 | 0 | 0 | 0 | 1 | 1 | none 1 | 0 | 1 | 2 |

## Against each agent arm

| arm | vs | success gap (tasks) | noise? | break-even idx (observed) | projected | cumulative $ gap |
|---|---|---|---|---|---|---|
| agent:claude-haiku-5-5 | agent:claude-sonnet-5-5 | +0 | noise | 0 | – | $-5.300 |
| agent:claude-sonnet-5-5 | agent:claude-haiku-5-5 | +0 | noise | – | – | $5.300 |
| jit:claude-haiku-5-5/claude-haiku-5-5 | agent:claude-haiku-5-5 | -9 | noise | – | – | $11.41 |
| jit:claude-haiku-5-5/claude-haiku-5-5 | agent:claude-sonnet-5-5 | -9 | noise | – | – | $8.832 |
| jit:claude-opus-5-5/claude-haiku-5-5 | agent:claude-haiku-5-5 | +0 | noise | – | – | $19.28 |
| jit:claude-opus-5-5/claude-haiku-5-5 | agent:claude-sonnet-5-5 | +0 | noise | – | – | $15.00 |
| jit:claude-sonnet-5-5/claude-haiku-5-5 | agent:claude-haiku-5-5 | -10 | noise | – | – | $19.72 |
| jit:claude-sonnet-5-5/claude-haiku-5-5 | agent:claude-sonnet-5-5 | -10 | noise | – | – | $16.74 |

## Paired comparison, both units (this stream only)

Decision rule (PREREG §4): Effect reported only if: no arm invalid by the 25% env-fault rule; K >= 2 streams; pooled gap >= 3 points and every stream's gap >= 3 points in the same direction; exact two-sided McNemar p < 0.05 on pooled pairs; and the 95% lineage-clustered CI (wider of two-stage cluster bootstrap and Deff-widened task bootstrap, rho 0.1) excludes 0. Otherwise "directional, no decision". One run directory is one stream, so every row here is "directional, no decision"; `node experiments/jit/stats.mjs decide <armX> <armY> <runDir>...` applies the rule over K streams. Task rule = report.mjs NOISE_SUCCESSES (|gap| >= 3 tasks), shown, not applied. Point floor = 3 percentage points.

| arm | vs | gap (tasks) | gap (points) | task rule | point floor | McNemar X-only / Y-only, p | 95% clustered CI (points; Deff) | verdict |
|---|---|---|---|---|---|---|---|---|
| agent:claude-haiku-5-5 | agent:claude-sonnet-5-5 | +0 of 24 | 0.0 | noise | below | 3 / 3, 1.000 | -20.8 to 20.8 (1) | directional, no decision (one stream) |
| agent:claude-sonnet-5-5 | agent:claude-haiku-5-5 | +0 of 24 | 0.0 | noise | below | 3 / 3, 1.000 | -20.8 to 20.8 (1) | directional, no decision (one stream) |
| jit:claude-haiku-5-5/claude-haiku-5-5 | agent:claude-haiku-5-5 | -1 of 12 | -8.3 | noise | clears | 1 / 2, 1.000 | -44.6 to 27.9 (2.1) | directional, no decision (one stream) |
| jit:claude-haiku-5-5/claude-haiku-5-5 | agent:claude-sonnet-5-5 | -1 of 12 | -8.3 | noise | clears | 0 / 1, 1.000 | -32.5 to 3.7 (2.1) | directional, no decision (one stream) |
| jit:claude-opus-5-5/claude-haiku-5-5 | agent:claude-haiku-5-5 | +4 of 19 | 21.1 | clears | clears | 4 / 0, 0.125 | -5.4 to 56.3 (2.8) | directional, no decision (one stream) |
| jit:claude-opus-5-5/claude-haiku-5-5 | agent:claude-sonnet-5-5 | +2 of 19 | 10.5 | noise | clears | 3 / 1, 0.625 | -24.7 to 45.8 (2.8) | directional, no decision (one stream) |
| jit:claude-sonnet-5-5/claude-haiku-5-5 | agent:claude-haiku-5-5 | -3 of 13 | -23.1 | clears | clears | 0 / 3, 0.250 | -57.3 to 11.2 (2.2) | directional, no decision (one stream) |
| jit:claude-sonnet-5-5/claude-haiku-5-5 | agent:claude-sonnet-5-5 | -3 of 13 | -23.1 | clears | clears | 1 / 4, 0.375 | -68.7 to 22.6 (2.2) | directional, no decision (one stream) |

## Environment faults (PREREG §6 rule)

Impaired = planned tasks left unresolved by an env fault (no row; for a JIT arm, every task after the fault that stopped the stream) plus rows whose shadow or adjudicator faulted. Invalid when impaired / planned > 25%. Fault events are faults.jsonl lines (after the one in-place retry); transient = recovered retries; both are reported, neither decides.

| arm | planned | impaired (unresolved + degraded) | rate | fault events (by code) | transient retries | verdict |
|---|---|---|---|---|---|---|
| agent:claude-haiku-5-5 | 24 | 0 (0 + 0) | 0.0% | 20 (MODEL_RATE_LIMIT 20), stressed | 20 | valid |
| agent:claude-sonnet-5-5 | 24 | 0 (0 + 0) | 0.0% | 12 (MODEL_RATE_LIMIT 12), stressed | 12 | valid |
| jit:claude-haiku-5-5/claude-haiku-5-5 | 24 | 12 (12 + 0) | 50.0% | 2 (MODEL_RATE_LIMIT 2) | 2 | invalid: env faults |
| jit:claude-opus-5-5/claude-haiku-5-5 | 24 | 5 (5 + 0) | 20.8% | 2 (MODEL_RATE_LIMIT 2) | 2 | valid |
| jit:claude-sonnet-5-5/claude-haiku-5-5 | 24 | 11 (11 + 0) | 45.8% | 2 (MODEL_RATE_LIMIT 2) | 2 | invalid: env faults |

## Cumulative curves (successes / $ by task index)

| idx | agent:claude-haiku-5-5 | agent:claude-sonnet-5-5 | jit:claude-haiku-5-5/claude-haiku-5-5 | jit:claude-opus-5-5/claude-haiku-5-5 | jit:claude-sonnet-5-5/claude-haiku-5-5 |
|---|---|---|---|---|---|
| 0 | 1 / $0.086 | 1 / $0.292 | 1 / $0.085 | 1 / $0.457 | 1 / $0.317 |
| 1 | 1 / $0.136 * | 1 / $0.591 * | 1 / $0.158 * | 2 / $0.979 | 1 / $0.586 * |
| 2 | 2 / $0.186 | 2 / $0.838 | 2 / $0.286 | 3 / $1.488 | 2 / $0.841 |
| 3 | 3 / $0.236 | 3 / $1.093 | 3 / $3.623 | 4 / $9.568 | 2 / $8.300 * |
| 4 | 4 / $0.316 | 4 / $1.372 | 4 / $3.874 | 5 / $9.582 | 3 / $8.556 |
| 5 | 5 / $0.385 | 4 / $1.607 * | 4 / $4.107 * | 6 / $9.594 | 4 / $8.838 |
| 6 | 5 / $0.436 * | 5 / $1.938 | 5 / $4.356 | 7 / $10.72 | 4 / $15.36 * |
| 7 | 5 / $0.487 * | 5 / $2.185 * | 5 / $4.531 * | 7 / $11.37 * | 4 / $15.59 * |
| 8 | 6 / $0.531 | 6 / $2.458 | 5 / $11.23 * | 8 / $11.80 | 5 / $15.86 |
| 9 | 7 / $0.580 | 7 / $2.728 | 6 / $11.66 | 9 / $15.31 | 6 / $19.16 |
| 10 | 8 / $0.625 | 8 / $3.002 | 7 / $11.95 | 10 / $15.33 | 7 / $19.47 |
| 11 | 9 / $0.675 | 9 / $3.253 | 8 / $12.09 | 11 / $15.66 | 7 / $20.19 * |
| 12 | 10 / $0.727 | 10 / $3.708 | – | 12 / $16.15 | 7 / $20.45 * |
| 13 | 10 / $0.771 * | 11 / $4.210 | – | 13 / $17.22 | – |
| 14 | 10 / $0.823 * | 11 / $4.471 * | – | 14 / $17.23 | – |
| 15 | 10 / $0.872 * | 12 / $4.718 | – | 14 / $17.25 * | – |
| 16 | 11 / $1.178 | 13 / $5.056 | – | 15 / $17.82 | – |
| 17 | 12 / $1.334 | 14 / $5.351 | – | 16 / $20.22 | – |
| 18 | 13 / $1.451 | 15 / $5.722 | – | 17 / $20.73 | – |
| 19 | 14 / $1.578 | 15 / $6.060 * | – | – | – |
| 20 | 14 / $1.733 * | 15 / $6.384 * | – | – | – |
| 21 | 15 / $1.814 | 16 / $6.720 | – | – | – |
| 22 | 16 / $1.900 | 17 / $7.061 | – | – | – |
| 23 | 17 / $2.103 | 17 / $7.402 * | – | – | – |

`*` marks a failed task at that index.

## Integrity flags

- agent:claude-haiku-5-5: nested model attempts 0, hidden-path attempts 3 (review by hand), voided compiles 0, rows with unknown cost 0.
- agent:claude-sonnet-5-5: nested model attempts 0, hidden-path attempts 8 (review by hand), voided compiles 0, rows with unknown cost 0.
- jit:claude-haiku-5-5/claude-haiku-5-5: nested model attempts 0, hidden-path attempts 2 (review by hand), voided compiles 0, rows with unknown cost 0.
- jit:claude-opus-5-5/claude-haiku-5-5: nested model attempts 0, hidden-path attempts 9 (review by hand), voided compiles 0, rows with unknown cost 0.
- jit:claude-sonnet-5-5/claude-haiku-5-5: nested model attempts 0, hidden-path attempts 55 (review by hand), voided compiles 0, rows with unknown cost 0.
