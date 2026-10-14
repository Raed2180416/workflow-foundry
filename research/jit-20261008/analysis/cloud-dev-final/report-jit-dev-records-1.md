# JIT stream report: jit-dev-records-1

Generated 2026-10-14T12:00:17.736Z. Evidence: **development / diagnostic (not held-out evidence)**.

> K=1 stream per arm: any success gap under 3 points (tasks) is noise; arms with different task counts are not compared. This task rule is shown for continuity; the rule applied is the PREREG decision rule (3-point floor + McNemar + clustered CI over K >= 2 streams, experiments/jit/stats.mjs).

## Arms

| arm | n | success | 95% CI (Wilson) | total $ | $/success | $/task | last half (success, $/task) | delivered by |
|---|---|---|---|---|---|---|---|---|
| agent:claude-haiku-5-5 | 24 | 15/24 (62.5%) | 42.7%–78.8% | $2.465 | $0.164 | $0.103 | 9/12 (75.0%), $0.146 | interpreter 24 |
| agent:claude-opus-5-5 | 24 | 24/24 (100.0%) | 86.2%–100.0% | $13.54 | $0.564 | $0.564 | 12/12 (100.0%), $0.660 | interpreter 24 |
| agent:claude-sonnet-5-5 | 24 | 13/24 (54.2%) | 35.1%–72.1% | $7.053 | $0.542 | $0.294 | 9/12 (75.0%), $0.341 | interpreter 24 |
| jit:claude-haiku-5-5/claude-haiku-5-5 | 24 | 14/24 (58.3%) | 38.8%–75.5% | $8.124 | $0.580 | $0.339 | 9/12 (75.0%), $0.545 | interpreter 7, compiled 16, adjudicated 1 |
| jit:claude-opus-5-5/claude-haiku-5-5 | 24 | 18/24 (75.0%) | 55.1%–88.0% | $7.527 | $0.418 | $0.314 | 9/12 (75.0%), $0.240 | interpreter 5, compiled 18, adjudicated 1 |
| jit:claude-sonnet-5-5/claude-haiku-5-5 | 24 | 22/24 (91.7%) | 74.2%–97.7% | $8.987 | $0.408 | $0.374 | 11/12 (91.7%), $0.527 | interpreter 5, compiled 19 |
| static:B1-haiku-records-k1 | 24 | 16/24 (66.7%) | 46.7%–82.0% | $1.209 | $0.076 | $0.050 | 6/12 (50.0%), $0.052 | compiled 24 |

## Cost breakdown ($)

| arm | components |
|---|---|
| agent:claude-haiku-5-5 | interpreter $2.464 |
| agent:claude-opus-5-5 | interpreter $13.54 |
| agent:claude-sonnet-5-5 | interpreter $7.053 |
| jit:claude-haiku-5-5/claude-haiku-5-5 | interpreter $0.530, compileBuilder $1.211, compileGateway $2.232, compileCheck $0.900, compiled $0.744, shadow $0.337, adjudicator $2.169 |
| jit:claude-opus-5-5/claude-haiku-5-5 | interpreter $2.312, compileBuilder $1.153, compileGateway $0.805, compileCheck $0.106, compiled $0.306, shadow $2.202, adjudicator $0.643 |
| jit:claude-sonnet-5-5/claude-haiku-5-5 | interpreter $1.464, compileBuilder $2.245, compileGateway $2.163, compileCheck $0.420, compiled $0.889, shadow $1.188, adjudicator $0.619 |
| static:B1-haiku-records-k1 | compiled $1.209 |

## Compiled-path events

| arm | compiles (recompiles) | attempts / Opus fallbacks | rejected | failed | deopts by kind | crashes | timeouts | invalid | shadows | disagreements | adjudicated | regressions | unresolved | faults |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| jit:claude-haiku-5-5/claude-haiku-5-5 | 4 (3) | 4 / 0 | 0 | 0 | judge 1, guard 1, invariant 2 | 0 | 0 | 0 | 4 | 4 | none 3, interpreter 1 | 1 | 3 | 1 |
| jit:claude-opus-5-5/claude-haiku-5-5 | 3 (2) | 3 / 0 | 0 | 0 | judge 2 | 0 | 0 | 0 | 4 | 1 | interpreter 1 | 1 | 0 | 1 |
| jit:claude-sonnet-5-5/claude-haiku-5-5 | 2 (1) | 3 / 1 | 0 | 0 | invariant 2 | 0 | 0 | 0 | 4 | 2 | compiled 2 | 0 | 0 | 1 |
| static:B1-haiku-records-k1 | 0 (0) | 0 / 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

## Against each agent arm

| arm | vs | success gap (tasks) | noise? | break-even idx (observed) | projected | cumulative $ gap |
|---|---|---|---|---|---|---|
| agent:claude-haiku-5-5 | agent:claude-opus-5-5 | -9 | no | 0 | – | $-11.079 |
| agent:claude-haiku-5-5 | agent:claude-sonnet-5-5 | +2 | noise | 0 | – | $-4.589 |
| agent:claude-opus-5-5 | agent:claude-haiku-5-5 | +9 | no | – | – | $11.08 |
| agent:claude-opus-5-5 | agent:claude-sonnet-5-5 | +11 | no | – | – | $6.490 |
| agent:claude-sonnet-5-5 | agent:claude-haiku-5-5 | -2 | noise | – | – | $4.589 |
| agent:claude-sonnet-5-5 | agent:claude-opus-5-5 | -11 | no | 0 | – | $-6.490 |
| jit:claude-haiku-5-5/claude-haiku-5-5 | agent:claude-haiku-5-5 | -1 | noise | – | – | $5.660 |
| jit:claude-haiku-5-5/claude-haiku-5-5 | agent:claude-opus-5-5 | -10 | no | 0 | – | $-5.420 |
| jit:claude-haiku-5-5/claude-haiku-5-5 | agent:claude-sonnet-5-5 | +1 | noise | – | – | $1.071 |
| jit:claude-opus-5-5/claude-haiku-5-5 | agent:claude-haiku-5-5 | +3 | no | – | – | $5.063 |
| jit:claude-opus-5-5/claude-haiku-5-5 | agent:claude-opus-5-5 | -6 | no | 9 | – | $-6.016 |
| jit:claude-opus-5-5/claude-haiku-5-5 | agent:claude-sonnet-5-5 | +5 | no | – | 28 | $0.474 |
| jit:claude-sonnet-5-5/claude-haiku-5-5 | agent:claude-haiku-5-5 | +7 | no | – | – | $6.523 |
| jit:claude-sonnet-5-5/claude-haiku-5-5 | agent:claude-opus-5-5 | -2 | noise | 0 | – | $-4.556 |
| jit:claude-sonnet-5-5/claude-haiku-5-5 | agent:claude-sonnet-5-5 | +9 | no | – | – | $1.934 |
| static:B1-haiku-records-k1 | agent:claude-haiku-5-5 | +1 | noise | 5 | – | $-1.256 |
| static:B1-haiku-records-k1 | agent:claude-opus-5-5 | -8 | no | 0 | – | $-12.335 |
| static:B1-haiku-records-k1 | agent:claude-sonnet-5-5 | +3 | no | 0 | – | $-5.845 |

## Paired comparison, both units (this stream only)

Decision rule (PREREG §4): Effect reported only if: no arm invalid by the 25% env-fault rule; K >= 2 streams; pooled gap >= 3 points and every stream's gap >= 3 points in the same direction; exact two-sided McNemar p < 0.05 on pooled pairs; and the 95% lineage-clustered CI (wider of two-stage cluster bootstrap and Deff-widened task bootstrap, rho 0.1) excludes 0. Otherwise "directional, no decision". One run directory is one stream, so every row here is "directional, no decision"; `node experiments/jit/stats.mjs decide <armX> <armY> <runDir>...` applies the rule over K streams. Task rule = report.mjs NOISE_SUCCESSES (|gap| >= 3 tasks), shown, not applied. Point floor = 3 percentage points.

| arm | vs | gap (tasks) | gap (points) | task rule | point floor | McNemar X-only / Y-only, p | 95% clustered CI (points; Deff) | verdict |
|---|---|---|---|---|---|---|---|---|
| agent:claude-haiku-5-5 | agent:claude-opus-5-5 | -9 of 24 | -37.5 | clears | clears | 0 / 9, 0.004 | -58.3 to -16.7 (1) | directional, no decision (one stream) |
| agent:claude-haiku-5-5 | agent:claude-sonnet-5-5 | +2 of 24 | 8.3 | noise | clears | 7 / 5, 0.774 | -20.8 to 37.5 (1) | directional, no decision (one stream) |
| agent:claude-opus-5-5 | agent:claude-haiku-5-5 | +9 of 24 | 37.5 | clears | clears | 9 / 0, 0.004 | 16.7 to 58.3 (1) | directional, no decision (one stream) |
| agent:claude-opus-5-5 | agent:claude-sonnet-5-5 | +11 of 24 | 45.8 | clears | clears | 11 / 0, 0.001 | 25.0 to 66.7 (1) | directional, no decision (one stream) |
| agent:claude-sonnet-5-5 | agent:claude-haiku-5-5 | -2 of 24 | -8.3 | noise | clears | 5 / 7, 0.774 | -37.5 to 20.8 (1) | directional, no decision (one stream) |
| agent:claude-sonnet-5-5 | agent:claude-opus-5-5 | -11 of 24 | -45.8 | clears | clears | 0 / 11, 0.001 | -66.7 to -25.0 (1) | directional, no decision (one stream) |
| jit:claude-haiku-5-5/claude-haiku-5-5 | agent:claude-haiku-5-5 | -1 of 24 | -4.2 | noise | clears | 5 / 6, 1.000 | -49.6 to 48.8 (3.3) | directional, no decision (one stream) |
| jit:claude-haiku-5-5/claude-haiku-5-5 | agent:claude-opus-5-5 | -10 of 24 | -41.7 | clears | clears | 0 / 10, 0.002 | -79.5 to -11.4 (3.3) | directional, no decision (one stream) |
| jit:claude-haiku-5-5/claude-haiku-5-5 | agent:claude-sonnet-5-5 | +1 of 24 | 4.2 | noise | clears | 5 / 4, 1.000 | -41.2 to 49.6 (3.3) | directional, no decision (one stream) |
| jit:claude-opus-5-5/claude-haiku-5-5 | agent:claude-haiku-5-5 | +3 of 24 | 12.5 | clears | clears | 5 / 2, 0.453 | -25.3 to 50.3 (3.3) | directional, no decision (one stream) |
| jit:claude-opus-5-5/claude-haiku-5-5 | agent:claude-opus-5-5 | -6 of 24 | -25.0 | clears | clears | 0 / 6, 0.031 | -55.3 to 5.3 (3.3) | directional, no decision (one stream) |
| jit:claude-opus-5-5/claude-haiku-5-5 | agent:claude-sonnet-5-5 | +5 of 24 | 20.8 | clears | clears | 7 / 2, 0.180 | -24.6 to 58.7 (3.3) | directional, no decision (one stream) |
| jit:claude-sonnet-5-5/claude-haiku-5-5 | agent:claude-haiku-5-5 | +7 of 24 | 29.2 | clears | clears | 8 / 1, 0.039 | -8.7 to 67.0 (3.3) | directional, no decision (one stream) |
| jit:claude-sonnet-5-5/claude-haiku-5-5 | agent:claude-opus-5-5 | -2 of 24 | -8.3 | noise | clears | 0 / 2, 0.500 | -31.0 to 6.8 (3.3) | directional, no decision (one stream) |
| jit:claude-sonnet-5-5/claude-haiku-5-5 | agent:claude-sonnet-5-5 | +9 of 24 | 37.5 | clears | clears | 10 / 1, 0.012 | -0.3 to 75.3 (3.3) | directional, no decision (one stream) |
| static:B1-haiku-records-k1 | agent:claude-haiku-5-5 | +1 of 24 | 4.2 | noise | clears | 6 / 5, 1.000 | -25.0 to 29.2 (1) | directional, no decision (one stream) |
| static:B1-haiku-records-k1 | agent:claude-opus-5-5 | -8 of 24 | -33.3 | clears | clears | 0 / 8, 0.008 | -54.2 to -16.7 (1) | directional, no decision (one stream) |
| static:B1-haiku-records-k1 | agent:claude-sonnet-5-5 | +3 of 24 | 12.5 | clears | clears | 9 / 6, 0.607 | -20.8 to 45.8 (1) | directional, no decision (one stream) |

## Environment faults (PREREG §6 rule)

Impaired = planned tasks left unresolved by an env fault (no row; for a JIT arm, every task after the fault that stopped the stream) plus rows whose shadow or adjudicator faulted. Invalid when impaired / planned > 25%. Fault events are faults.jsonl lines (after the one in-place retry); transient = recovered retries; both are reported, neither decides.

| arm | planned | impaired (unresolved + degraded) | rate | fault events (by code) | transient retries | verdict |
|---|---|---|---|---|---|---|
| agent:claude-haiku-5-5 | 24 | 0 (0 + 0) | 0.0% | 19 (MODEL_RATE_LIMIT 19), stressed | 19 | valid |
| agent:claude-opus-5-5 | 24 | 0 (0 + 0) | 0.0% | 12 (MODEL_RATE_LIMIT 12), stressed | 12 | valid |
| agent:claude-sonnet-5-5 | 24 | 0 (0 + 0) | 0.0% | 9 (MODEL_RATE_LIMIT 9), stressed | 9 | valid |
| jit:claude-haiku-5-5/claude-haiku-5-5 | 24 | 0 (0 + 0) | 0.0% | 1 (MODEL_RATE_LIMIT 1) | 1 | valid |
| jit:claude-opus-5-5/claude-haiku-5-5 | 24 | 0 (0 + 0) | 0.0% | 1 (MODEL_RATE_LIMIT 1) | 1 | valid |
| jit:claude-sonnet-5-5/claude-haiku-5-5 | 24 | 0 (0 + 0) | 0.0% | 1 (MODEL_RATE_LIMIT 1) | 1 | valid |
| static:B1-haiku-records-k1 | 24 | 0 (0 + 0) | 0.0% | 0 | 0 | valid |

## Cumulative curves (successes / $ by task index)

| idx | agent:claude-haiku-5-5 | agent:claude-opus-5-5 | agent:claude-sonnet-5-5 | jit:claude-haiku-5-5/claude-haiku-5-5 | jit:claude-opus-5-5/claude-haiku-5-5 | jit:claude-sonnet-5-5/claude-haiku-5-5 | static:B1-haiku-records-k1 |
|---|---|---|---|---|---|---|---|
| 0 | 0 / $0.048 * | 1 / $0.474 | 0 / $0.241 * | 1 / $0.079 | 1 / $0.459 | 1 / $0.225 | 1 / $0.045 |
| 1 | 1 / $0.092 | 2 / $0.944 | 1 / $0.485 | 1 / $0.137 * | 2 / $0.932 | 2 / $0.489 | 2 / $0.093 |
| 2 | 2 / $0.136 | 3 / $1.402 | 1 / $0.726 * | 2 / $0.217 | 3 / $1.411 | 3 / $0.707 | 2 / $0.136 * |
| 3 | 3 / $0.183 | 4 / $1.888 | 1 / $0.983 * | 2 / $0.953 * | 3 / $2.212 * | 4 / $1.853 | 3 / $0.183 |
| 4 | 3 / $0.231 * | 5 / $2.381 | 2 / $1.194 | 2 / $1.076 * | 4 / $2.720 | 4 / $1.892 * | 4 / $0.259 |
| 5 | 3 / $0.321 * | 6 / $2.854 | 2 / $1.430 * | 2 / $1.083 * | 5 / $3.241 | 5 / $1.932 | 5 / $0.301 |
| 6 | 4 / $0.402 | 7 / $3.310 | 2 / $1.656 * | 2 / $1.090 * | 6 / $4.136 | 6 / $2.214 | 6 / $0.350 |
| 7 | 4 / $0.443 * | 8 / $3.751 | 2 / $1.876 * | 2 / $1.199 * | 6 / $4.145 * | 7 / $2.251 | 6 / $0.396 * |
| 8 | 4 / $0.483 * | 9 / $4.245 | 3 / $2.121 | 3 / $1.203 | 7 / $4.616 | 8 / $2.291 | 7 / $0.443 |
| 9 | 5 / $0.603 | 10 / $4.711 | 3 / $2.348 * | 3 / $1.207 * | 8 / $4.625 | 9 / $2.329 | 8 / $0.490 |
| 10 | 6 / $0.648 | 11 / $5.192 | 4 / $2.618 | 4 / $1.259 | 9 / $4.633 | 10 / $2.627 | 9 / $0.533 |
| 11 | 6 / $0.707 * | 12 / $5.618 | 4 / $2.961 * | 5 / $1.585 | 9 / $4.641 * | 11 / $2.665 | 10 / $0.581 |
| 12 | 6 / $0.757 * | 13 / $6.423 | 5 / $3.211 | 6 / $1.588 | 10 / $5.113 | 12 / $2.701 | 11 / $0.622 |
| 13 | 7 / $0.825 | 14 / $7.242 | 5 / $3.436 * | 6 / $1.676 * | 10 / $5.122 * | 12 / $2.749 * | 12 / $0.664 |
| 14 | 8 / $0.872 | 15 / $7.745 | 5 / $3.671 * | 7 / $1.681 | 11 / $5.128 | 13 / $3.307 | 13 / $0.711 |
| 15 | 9 / $0.911 | 16 / $8.215 | 5 / $4.107 * | 8 / $1.686 | 12 / $5.136 | 14 / $3.354 | 14 / $0.752 |
| 16 | 10 / $1.056 | 17 / $8.820 | 6 / $4.549 | 9 / $1.869 | 13 / $6.417 | 15 / $3.769 | 14 / $0.805 * |
| 17 | 10 / $1.356 * | 18 / $9.466 | 7 / $4.913 | 9 / $3.030 * | 13 / $6.811 * | 16 / $4.195 | 14 / $0.863 * |
| 18 | 11 / $1.514 | 19 / $10.17 | 8 / $5.289 | 10 / $3.238 | 14 / $6.822 | 17 / $7.962 | 15 / $0.920 |
| 19 | 12 / $1.672 | 20 / $10.84 | 9 / $5.623 | 11 / $5.669 | 15 / $6.833 | 18 / $8.016 | 15 / $0.972 * |
| 20 | 13 / $1.739 | 21 / $11.49 | 10 / $5.992 | 12 / $5.758 | 16 / $7.492 | 19 / $8.852 | 16 / $1.031 |
| 21 | 14 / $1.885 | 22 / $12.15 | 11 / $6.326 | 12 / $5.842 * | 17 / $7.504 | 20 / $8.898 | 16 / $1.089 * |
| 22 | 14 / $2.153 * | 23 / $12.89 | 12 / $6.684 | 13 / $8.114 | 17 / $7.515 * | 21 / $8.941 | 16 / $1.150 * |
| 23 | 15 / $2.465 | 24 / $13.54 | 13 / $7.053 | 14 / $8.124 | 18 / $7.527 | 22 / $8.987 | 16 / $1.209 * |

`*` marks a failed task at that index.

## Integrity flags

- agent:claude-opus-5-5: nested model attempts 0, hidden-path attempts 9 (review by hand), voided compiles 0, rows with unknown cost 0.
- agent:claude-sonnet-5-5: nested model attempts 0, hidden-path attempts 3 (review by hand), voided compiles 0, rows with unknown cost 0.
- jit:claude-haiku-5-5/claude-haiku-5-5: nested model attempts 0, hidden-path attempts 2 (review by hand), voided compiles 0, rows with unknown cost 1.
- jit:claude-opus-5-5/claude-haiku-5-5: nested model attempts 0, hidden-path attempts 3 (review by hand), voided compiles 0, rows with unknown cost 0.
- jit:claude-sonnet-5-5/claude-haiku-5-5: nested model attempts 0, hidden-path attempts 14 (review by hand), voided compiles 0, rows with unknown cost 0.
