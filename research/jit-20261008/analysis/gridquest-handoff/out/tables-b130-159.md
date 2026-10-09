### Resumer (ii): explorer-from-current-state (oracle-side upper bound)

Levels completed out of n, pass rate, 95% bootstrap CI over tasks (10 000 resamples).

| protocol | d3 | d4 | d5 | d3-d5 pooled |
|---|---|---|---|---|
| P0 no fallback (controller only) | 0/30 = 0.0% [0.0, 0.0] | 0/30 = 0.0% [0.0, 0.0] | 0/30 = 0.0% [0.0, 0.0] | 0/90 = 0.0% [0.0, 0.0] |
| P1 whole-task restart, fresh env (counterfactual) | 30/30 = 100.0% [100.0, 100.0] | 30/30 = 100.0% [100.0, 100.0] | 30/30 = 100.0% [100.0, 100.0] | 90/90 = 100.0% [100.0, 100.0] |
| P2 restart, same env, residual ledger | 27/30 = 90.0% [80.0, 100.0] | 28/30 = 93.3% [83.3, 100.0] | 28/30 = 93.3% [83.3, 100.0] | 83/90 = 92.2% [86.7, 96.7] |
| P3 hold-and-resume at first refuted expectation (snapshot + mem) | 29/30 = 96.7% [90.0, 100.0] | 28/30 = 93.3% [83.3, 100.0] | 28/30 = 93.3% [83.3, 100.0] | 85/90 = 94.4% [88.9, 98.9] |
| P4 = P3 + nonblocking permissive (oracle reachability check) | 29/30 = 96.7% [90.0, 100.0] | 30/30 = 100.0% [100.0, 100.0] | 29/30 = 96.7% [90.0, 100.0] | 88/90 = 97.8% [94.4, 100.0] |
| P4c = P3 + conservative permissive (veto every one-way / coupled action) | 29/30 = 96.7% [90.0, 100.0] | 30/30 = 100.0% [100.0, 100.0] | 29/30 = 96.7% [90.0, 100.0] | 88/90 = 97.8% [94.4, 100.0] |
| P3-lossy: mem = visited rooms only | 29/30 = 96.7% [90.0, 100.0] | 28/30 = 93.3% [83.3, 100.0] | 27/30 = 90.0% [76.7, 100.0] | 84/90 = 93.3% [87.8, 97.8] |
| P3-amn: snapshot only, mem dropped | 28/30 = 93.3% [83.3, 100.0] | 27/30 = 90.0% [80.0, 100.0] | 24/30 = 80.0% [63.3, 93.3] | 79/90 = 87.8% [81.1, 94.4] |

Paired differences against P2 (ii), same tasks; (+wins/-losses) in tasks.

| contrast | d3 | d4 | d5 | d3-d5 pooled |
|---|---|---|---|---|
| P3 - P2 | +6.7 pts [0.0, 16.7] (+2/-0) | +0.0 pts [-13.3, 13.3] (+2/-2) | +0.0 pts [-13.3, 13.3] (+2/-2) | +2.2 pts [-4.4, 8.9] (+6/-4) |
| P4 - P2 | +6.7 pts [0.0, 16.7] (+2/-0) | +6.7 pts [0.0, 16.7] (+2/-0) | +3.3 pts [-6.7, 13.3] (+2/-1) | +5.6 pts [0.0, 11.1] (+6/-1) |
| P4c - P2 | +6.7 pts [0.0, 16.7] (+2/-0) | +6.7 pts [0.0, 16.7] (+2/-0) | +3.3 pts [-6.7, 13.3] (+2/-1) | +5.6 pts [0.0, 11.1] (+6/-1) |
| P3lossy - P2 | +6.7 pts [0.0, 16.7] (+2/-0) | +0.0 pts [-13.3, 13.3] (+2/-2) | -3.3 pts [-16.7, 10.0] (+2/-3) | +1.1 pts [-5.6, 8.9] (+6/-5) |
| P3amn - P2 | +3.3 pts [0.0, 10.0] (+1/-0) | -3.3 pts [-13.3, 6.7] (+1/-2) | -13.3 pts [-26.7, -3.3] (+0/-4) | -4.4 pts [-11.1, 1.1] (+2/-6) |
| P1 - P2 | +10.0 pts [0.0, 20.0] (+3/-0) | +6.7 pts [0.0, 16.7] (+2/-0) | +6.7 pts [0.0, 16.7] (+2/-0) | +7.8 pts [3.3, 13.3] (+7/-0) |

Cost per task (ii); steps = all actions executed across every env incl. the controller prefix; failures = blocked/failed/invalid actions; wall = mean ms per task for that protocol's run.

| protocol | group | mean steps | mean steps (passes only) | mean failures | mean wall ms |
|---|---|---|---|---|---|
| P0 | d3 | 24.2 | - | 9.2 | 2.82 |
| ii.P1 | d3 | 46.5 | 46.5 | 0.9 | 0.73 |
| ii.P2 | d3 | 45.8 | 44.4 | 0.9 | 0.65 |
| ii.P3 | d3 | 40.0 | 39.9 | 0.9 | 0.70 |
| ii.P4 | d3 | 40.0 | 39.9 | 0.9 | 0.54 |
| ii.P4c | d3 | 39.8 | 39.7 | 0.9 | 0.65 |
| P0 | d4 | 25.8 | - | 12.0 | 2.43 |
| ii.P1 | d4 | 75.5 | 75.5 | 1.0 | 1.19 |
| ii.P2 | d4 | 74.8 | 74.6 | 1.0 | 1.19 |
| ii.P3 | d4 | 65.3 | 69.1 | 1.0 | 1.02 |
| ii.P4 | d4 | 69.5 | 69.5 | 0.9 | 1.01 |
| ii.P4c | d4 | 68.7 | 68.7 | 0.8 | 0.94 |
| P0 | d5 | 27.8 | - | 11.5 | 2.55 |
| ii.P1 | d5 | 97.5 | 97.5 | 1.0 | 1.86 |
| ii.P2 | d5 | 97.2 | 94.9 | 1.0 | 1.73 |
| ii.P3 | d5 | 92.1 | 94.6 | 1.0 | 1.62 |
| ii.P4 | d5 | 94.7 | 94.6 | 1.0 | 1.58 |
| ii.P4c | d5 | 93.7 | 93.6 | 0.8 | 1.64 |
| P0 | d3-d5 pooled | 25.9 | - | 10.9 | 2.60 |
| ii.P1 | d3-d5 pooled | 73.2 | 73.2 | 1.0 | 1.26 |
| ii.P2 | d3-d5 pooled | 72.6 | 71.7 | 1.0 | 1.19 |
| ii.P3 | d3-d5 pooled | 65.8 | 67.5 | 1.0 | 1.12 |
| ii.P4 | d3-d5 pooled | 68.1 | 68.0 | 0.9 | 1.04 |
| ii.P4c | d3-d5 pooled | 67.4 | 67.4 | 0.8 | 1.08 |

### Resumer (i): templateAwareAgent (white-box regex, amnesiac, env-driven)

Levels completed out of n, pass rate, 95% bootstrap CI over tasks (10 000 resamples).

| protocol | d3 | d4 | d5 | d3-d5 pooled |
|---|---|---|---|---|
| P0 no fallback (controller only) | 0/30 = 0.0% [0.0, 0.0] | 0/30 = 0.0% [0.0, 0.0] | 0/30 = 0.0% [0.0, 0.0] | 0/90 = 0.0% [0.0, 0.0] |
| P1 whole-task restart, fresh env (counterfactual) | 16/30 = 53.3% [36.7, 70.0] | 9/30 = 30.0% [13.3, 46.7] | 3/30 = 10.0% [0.0, 23.3] | 28/90 = 31.1% [22.2, 41.1] |
| P2 restart, same env, residual ledger | 13/30 = 43.3% [26.7, 60.0] | 9/30 = 30.0% [13.3, 46.7] | 3/30 = 10.0% [0.0, 23.3] | 25/90 = 27.8% [18.9, 37.8] |
| P3 hold-and-resume at first refuted expectation (snapshot + mem) | 8/30 = 26.7% [13.3, 43.3] | 6/30 = 20.0% [6.7, 36.7] | 1/30 = 3.3% [0.0, 10.0] | 15/90 = 16.7% [8.9, 24.4] |
| P4 = P3 + nonblocking permissive (oracle reachability check) | 8/30 = 26.7% [13.3, 43.3] | 6/30 = 20.0% [6.7, 36.7] | 1/30 = 3.3% [0.0, 10.0] | 15/90 = 16.7% [8.9, 24.4] |
| P4c = P3 + conservative permissive (veto every one-way / coupled action) | 8/30 = 26.7% [13.3, 43.3] | 6/30 = 20.0% [6.7, 36.7] | 3/30 = 10.0% [0.0, 23.3] | 17/90 = 18.9% [11.1, 27.8] |

Paired differences against P2 (i), same tasks; (+wins/-losses) in tasks.

| contrast | d3 | d4 | d5 | d3-d5 pooled |
|---|---|---|---|---|
| P3 - P2 | -16.7 pts [-30.0, -3.3] (+0/-5) | -10.0 pts [-20.0, 0.0] (+0/-3) | -6.7 pts [-16.7, 0.0] (+0/-2) | -11.1 pts [-17.8, -5.6] (+0/-10) |
| P4 - P2 | -16.7 pts [-30.0, -3.3] (+0/-5) | -10.0 pts [-20.0, 0.0] (+0/-3) | -6.7 pts [-16.7, 0.0] (+0/-2) | -11.1 pts [-17.8, -5.6] (+0/-10) |
| P4c - P2 | -16.7 pts [-30.0, -3.3] (+0/-5) | -10.0 pts [-20.0, 0.0] (+0/-3) | +0.0 pts [-10.0, 10.0] (+1/-1) | -8.9 pts [-15.6, -2.2] (+1/-9) |
| P1 - P2 | +10.0 pts [0.0, 20.0] (+3/-0) | +0.0 pts [0.0, 0.0] (+0/-0) | +0.0 pts [0.0, 0.0] (+0/-0) | +3.3 pts [0.0, 7.8] (+3/-0) |

Cost per task (i); steps = all actions executed across every env incl. the controller prefix; failures = blocked/failed/invalid actions; wall = mean ms per task for that protocol's run.

| protocol | group | mean steps | mean steps (passes only) | mean failures | mean wall ms |
|---|---|---|---|---|---|
| P0 | d3 | 24.2 | - | 9.2 | 2.82 |
| i.P1 | d3 | 46.8 | 47.8 | 5.9 | 3.09 |
| i.P2 | d3 | 45.6 | 43.9 | 5.7 | 2.91 |
| i.P3 | d3 | 42.1 | 39.4 | 8.0 | 2.64 |
| i.P4 | d3 | 42.1 | 39.4 | 8.0 | 2.59 |
| i.P4c | d3 | 42.0 | 39.4 | 7.6 | 2.45 |
| P0 | d4 | 25.8 | - | 12.0 | 2.43 |
| i.P1 | d4 | 66.6 | 68.0 | 8.2 | 4.90 |
| i.P2 | d4 | 66.2 | 68.0 | 8.2 | 4.34 |
| i.P3 | d4 | 61.0 | 67.0 | 9.2 | 4.34 |
| i.P4 | d4 | 62.8 | 67.0 | 9.4 | 4.43 |
| i.P4c | d4 | 63.2 | 67.0 | 9.3 | 4.82 |
| P0 | d5 | 27.8 | - | 11.5 | 2.55 |
| i.P1 | d5 | 76.6 | 94.7 | 10.8 | 6.31 |
| i.P2 | d5 | 76.1 | 94.7 | 10.5 | 5.96 |
| i.P3 | d5 | 71.1 | 99.0 | 11.2 | 5.64 |
| i.P4 | d5 | 72.1 | 99.0 | 11.3 | 5.73 |
| i.P4c | d5 | 73.8 | 104.7 | 10.4 | 5.99 |
| P0 | d3-d5 pooled | 25.9 | - | 10.9 | 2.60 |
| i.P1 | d3-d5 pooled | 63.3 | 59.3 | 8.3 | 4.77 |
| i.P2 | d3-d5 pooled | 62.6 | 58.7 | 8.1 | 4.40 |
| i.P3 | d3-d5 pooled | 58.1 | 54.4 | 9.5 | 4.21 |
| i.P4 | d3-d5 pooled | 59.0 | 54.4 | 9.6 | 4.25 |
| i.P4c | d3-d5 pooled | 59.7 | 60.6 | 9.1 | 4.42 |

### Kill rule (resumer (ii))

Kill if the best hold-and-resume protocol (max of P3, P4) is within 3 percentage points of P2.

| group | P2 | P3 | P4 | best(P3,P4) - P2 | within 3 pts? | CI of (P3 - P2) | CI of (P4 - P2) |
|---|---|---|---|---|---|---|---|
| d3 | 90.0% | 96.7% | 96.7% | +6.7 pts | no | +6.7 pts [0.0, 16.7] (+2/-0) | +6.7 pts [0.0, 16.7] (+2/-0) |
| d4 | 93.3% | 93.3% | 100.0% | +6.7 pts | no | +0.0 pts [-13.3, 13.3] (+2/-2) | +6.7 pts [0.0, 16.7] (+2/-0) |
| d5 | 93.3% | 93.3% | 96.7% | +3.3 pts | no | +0.0 pts [-13.3, 13.3] (+2/-2) | +3.3 pts [-6.7, 13.3] (+2/-1) |
| d3-d5 pooled | 92.2% | 94.4% | 97.8% | +5.6 pts | no | +2.2 pts [-4.4, 8.9] (+6/-4) | +5.6 pts [0.0, 11.1] (+6/-1) |

Per-level rule (dossier wording, "at every level"): KILL does not fire. Pooled over d3-d5: KILL does not fire.

### Where the handoff falls (controller = regexAgentV2)

| group | controller wins | mean controller actions | median first refuted expectation (step) | mean B | mean optimal | median prefix / B | controller stranded itself (treasure unreachable at end) | P4 permissive vetoes earlier than refutation | median lead time P3 (last recoverable - handoff) | strands at handoff under P3 |
|---|---|---|---|---|---|---|---|---|---|---|
| d3 | 0/30 | 24.2 | 7 | 65.1 | 23.6 | 0.13 | 0/30 | 0/30 (cons. 2) | 12 | 0/30 |
| d4 | 0/30 | 25.8 | 6 | 96.1 | 34.8 | 0.06 | 3/30 | 2/30 (cons. 5) | 11 | 2/30 |
| d5 | 0/30 | 27.8 | 6 | 125.4 | 45.5 | 0.05 | 1/30 | 1/30 (cons. 7) | 14 | 1/30 |
| d3-d5 pooled | 0/90 | 25.9 | 6 | 95.5 | 34.6 | 0.06 | 4/90 | 3/90 (cons. 14) | 12 | 3/90 |

### Handoff-time sweep (hand off after h controller actions instead of at the first refutation)

Pass rate (levels/n) for P2 and P3 at each h; resumer (ii) then (i). Tasks the controller already won before h count as passes under both. "stranded" = treasure already unreachable at the handoff point.

Resumer (ii)

| h | d3 P2 | d4 P2 | d5 P2 | d3-d5 pooled P2 | d3 P3 | d4 P3 | d5 P3 | d3-d5 pooled P3 | P3 - P2, pooled | stranded at h (pooled) |
|---|---|---|---|---|---|---|---|---|---|---|
| 5 | 28/30 | 30/30 | 29/30 | 87/90 | 29/30 | 29/30 | 28/30 | 86/90 | -1.1 pts [-5.6, 2.2] (+1/-2) | 2/90 |
| 10 | 28/30 | 26/30 | 28/30 | 82/90 | 28/30 | 28/30 | 27/30 | 83/90 | +1.1 pts [-3.3, 5.6] (+3/-2) | 3/90 |
| 20 | 24/30 | 23/30 | 25/30 | 72/90 | 24/30 | 26/30 | 26/30 | 76/90 | +4.4 pts [-3.3, 12.2] (+8/-4) | 4/90 |
| 30 | 20/30 | 20/30 | 21/30 | 61/90 | 24/30 | 25/30 | 25/30 | 74/90 | +14.4 pts [4.4, 24.4] (+17/-4) | 4/90 |
| 45 | 18/30 | 18/30 | 19/30 | 55/90 | 22/30 | 22/30 | 23/30 | 67/90 | +13.3 pts [3.3, 23.3] (+17/-5) | 4/90 |

Resumer (i)

| h | d3 P2 | d4 P2 | d5 P2 | d3-d5 pooled P2 | d3 P3 | d4 P3 | d5 P3 | d3-d5 pooled P3 | P3 - P2, pooled | stranded at h (pooled) |
|---|---|---|---|---|---|---|---|---|---|---|
| 5 | 14/30 | 9/30 | 3/30 | 26/90 | 10/30 | 6/30 | 2/30 | 18/90 | -8.9 pts [-16.7, -2.2] (+2/-10) | 2/90 |
| 10 | 14/30 | 9/30 | 3/30 | 26/90 | 7/30 | 4/30 | 1/30 | 12/90 | -15.6 pts [-24.4, -6.7] (+2/-16) | 3/90 |
| 20 | 11/30 | 8/30 | 3/30 | 22/90 | 4/30 | 2/30 | 3/30 | 9/90 | -14.4 pts [-22.2, -6.7] (+1/-14) | 4/90 |
| 30 | 9/30 | 5/30 | 3/30 | 17/90 | 1/30 | 3/30 | 4/30 | 8/90 | -10.0 pts [-18.9, -1.1] (+4/-13) | 4/90 |
| 45 | 7/30 | 5/30 | 3/30 | 15/90 | 2/30 | 2/30 | 3/30 | 7/90 | -8.9 pts [-16.7, -2.2] (+2/-10) | 4/90 |

