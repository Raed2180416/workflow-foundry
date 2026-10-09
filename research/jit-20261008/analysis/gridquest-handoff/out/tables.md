### Resumer (ii): explorer-from-current-state (oracle-side upper bound)

Levels completed out of n, pass rate, 95% bootstrap CI over tasks (10 000 resamples).

| protocol | d3 | d4 | d5 | d3-d5 pooled |
|---|---|---|---|---|
| P0 no fallback (controller only) | 2/30 = 6.7% [0.0, 16.7] | 0/30 = 0.0% [0.0, 0.0] | 0/30 = 0.0% [0.0, 0.0] | 2/90 = 2.2% [0.0, 5.6] |
| P1 whole-task restart, fresh env (counterfactual) | 30/30 = 100.0% [100.0, 100.0] | 30/30 = 100.0% [100.0, 100.0] | 30/30 = 100.0% [100.0, 100.0] | 90/90 = 100.0% [100.0, 100.0] |
| P2 restart, same env, residual ledger | 22/30 = 73.3% [56.7, 86.7] | 26/30 = 86.7% [73.3, 96.7] | 24/30 = 80.0% [66.7, 93.3] | 72/90 = 80.0% [71.1, 87.8] |
| P3 hold-and-resume at first refuted expectation (snapshot + mem) | 30/30 = 100.0% [100.0, 100.0] | 28/30 = 93.3% [83.3, 100.0] | 27/30 = 90.0% [76.7, 100.0] | 85/90 = 94.4% [88.9, 98.9] |
| P4 = P3 + nonblocking permissive (oracle reachability check) | 30/30 = 100.0% [100.0, 100.0] | 28/30 = 93.3% [83.3, 100.0] | 29/30 = 96.7% [90.0, 100.0] | 87/90 = 96.7% [92.2, 100.0] |
| P4c = P3 + conservative permissive (veto every one-way / coupled action) | 30/30 = 100.0% [100.0, 100.0] | 29/30 = 96.7% [90.0, 100.0] | 29/30 = 96.7% [90.0, 100.0] | 88/90 = 97.8% [94.4, 100.0] |
| P3-lossy: mem = visited rooms only | 28/30 = 93.3% [83.3, 100.0] | 25/30 = 83.3% [70.0, 96.7] | 26/30 = 86.7% [73.3, 96.7] | 79/90 = 87.8% [81.1, 94.4] |
| P3-amn: snapshot only, mem dropped | 25/30 = 83.3% [70.0, 96.7] | 25/30 = 83.3% [70.0, 96.7] | 24/30 = 80.0% [63.3, 93.3] | 74/90 = 82.2% [74.4, 90.0] |

Paired differences against P2 (ii), same tasks; (+wins/-losses) in tasks.

| contrast | d3 | d4 | d5 | d3-d5 pooled |
|---|---|---|---|---|
| P3 - P2 | +26.7 pts [13.3, 43.3] (+8/-0) | +6.7 pts [0.0, 16.7] (+2/-0) | +10.0 pts [-6.7, 26.7] (+5/-2) | +14.4 pts [6.7, 23.3] (+15/-2) |
| P4 - P2 | +26.7 pts [13.3, 43.3] (+8/-0) | +6.7 pts [0.0, 16.7] (+2/-0) | +16.7 pts [3.3, 30.0] (+5/-0) | +16.7 pts [8.9, 24.4] (+15/-0) |
| P4c - P2 | +26.7 pts [13.3, 43.3] (+8/-0) | +10.0 pts [0.0, 23.3] (+3/-0) | +16.7 pts [3.3, 30.0] (+5/-0) | +17.8 pts [10.0, 25.6] (+16/-0) |
| P3lossy - P2 | +20.0 pts [3.3, 36.7] (+7/-1) | -3.3 pts [-16.7, 10.0] (+2/-3) | +6.7 pts [-10.0, 23.3] (+4/-2) | +7.8 pts [-2.2, 16.7] (+13/-6) |
| P3amn - P2 | +10.0 pts [-6.7, 26.7] (+5/-2) | -3.3 pts [-16.7, 6.7] (+1/-2) | +0.0 pts [-13.3, 13.3] (+2/-2) | +2.2 pts [-5.6, 10.0] (+8/-6) |
| P1 - P2 | +26.7 pts [13.3, 43.3] (+8/-0) | +13.3 pts [3.3, 26.7] (+4/-0) | +20.0 pts [6.7, 33.3] (+6/-0) | +20.0 pts [12.2, 28.9] (+18/-0) |

Cost per task (ii); steps = all actions executed across every env incl. the controller prefix; failures = blocked/failed/invalid actions; wall = mean ms per task for that protocol's run.

| protocol | group | mean steps | mean steps (passes only) | mean failures | mean wall ms |
|---|---|---|---|---|---|
| P0 | d3 | 28.3 | 39.0 | 9.6 | 3.10 |
| ii.P1 | d3 | 53.3 | 53.3 | 1.0 | 0.93 |
| ii.P2 | d3 | 50.0 | 47.8 | 1.0 | 0.73 |
| ii.P3 | d3 | 43.4 | 43.4 | 1.0 | 0.67 |
| ii.P4 | d3 | 43.4 | 43.4 | 1.0 | 0.65 |
| ii.P4c | d3 | 43.4 | 43.4 | 0.9 | 0.63 |
| P0 | d4 | 31.4 | - | 10.9 | 3.22 |
| ii.P1 | d4 | 76.0 | 76.0 | 1.0 | 1.09 |
| ii.P2 | d4 | 74.3 | 73.2 | 1.0 | 1.04 |
| ii.P3 | d4 | 63.8 | 62.9 | 1.0 | 0.90 |
| ii.P4 | d4 | 63.8 | 62.9 | 1.0 | 0.95 |
| ii.P4c | d4 | 62.5 | 63.1 | 0.7 | 0.99 |
| P0 | d5 | 23.4 | - | 11.0 | 2.12 |
| ii.P1 | d5 | 104.0 | 104.0 | 1.0 | 1.75 |
| ii.P2 | d5 | 102.3 | 100.1 | 1.0 | 1.62 |
| ii.P3 | d5 | 89.8 | 94.7 | 1.0 | 1.46 |
| ii.P4 | d5 | 96.0 | 96.0 | 0.9 | 1.59 |
| ii.P4c | d5 | 95.9 | 95.9 | 0.8 | 1.52 |
| P0 | d3-d5 pooled | 27.7 | 39.0 | 10.5 | 2.82 |
| ii.P1 | d3-d5 pooled | 77.8 | 77.8 | 1.0 | 1.25 |
| ii.P2 | d3-d5 pooled | 75.5 | 74.4 | 1.0 | 1.13 |
| ii.P3 | d3-d5 pooled | 65.7 | 66.1 | 1.0 | 1.01 |
| ii.P4 | d3-d5 pooled | 67.7 | 67.2 | 1.0 | 1.06 |
| ii.P4c | d3-d5 pooled | 67.3 | 67.2 | 0.8 | 1.05 |

### Resumer (i): templateAwareAgent (white-box regex, amnesiac, env-driven)

Levels completed out of n, pass rate, 95% bootstrap CI over tasks (10 000 resamples).

| protocol | d3 | d4 | d5 | d3-d5 pooled |
|---|---|---|---|---|
| P0 no fallback (controller only) | 2/30 = 6.7% [0.0, 16.7] | 0/30 = 0.0% [0.0, 0.0] | 0/30 = 0.0% [0.0, 0.0] | 2/90 = 2.2% [0.0, 5.6] |
| P1 whole-task restart, fresh env (counterfactual) | 17/30 = 56.7% [40.0, 73.3] | 7/30 = 23.3% [10.0, 40.0] | 3/30 = 10.0% [0.0, 23.3] | 27/90 = 30.0% [21.1, 40.0] |
| P2 restart, same env, residual ledger | 13/30 = 43.3% [26.7, 60.0] | 6/30 = 20.0% [6.7, 33.3] | 2/30 = 6.7% [0.0, 16.7] | 21/90 = 23.3% [14.4, 32.2] |
| P3 hold-and-resume at first refuted expectation (snapshot + mem) | 12/30 = 40.0% [23.3, 56.7] | 3/30 = 10.0% [0.0, 23.3] | 0/30 = 0.0% [0.0, 0.0] | 15/90 = 16.7% [8.9, 24.4] |
| P4 = P3 + nonblocking permissive (oracle reachability check) | 12/30 = 40.0% [23.3, 56.7] | 3/30 = 10.0% [0.0, 23.3] | 0/30 = 0.0% [0.0, 0.0] | 15/90 = 16.7% [8.9, 24.4] |
| P4c = P3 + conservative permissive (veto every one-way / coupled action) | 11/30 = 36.7% [20.0, 53.3] | 6/30 = 20.0% [6.7, 36.7] | 0/30 = 0.0% [0.0, 0.0] | 17/90 = 18.9% [11.1, 27.8] |

Paired differences against P2 (i), same tasks; (+wins/-losses) in tasks.

| contrast | d3 | d4 | d5 | d3-d5 pooled |
|---|---|---|---|---|
| P3 - P2 | -3.3 pts [-20.0, 13.3] (+3/-4) | -10.0 pts [-20.0, 0.0] (+0/-3) | -6.7 pts [-16.7, 0.0] (+0/-2) | -6.7 pts [-14.4, 1.1] (+3/-9) |
| P4 - P2 | -3.3 pts [-20.0, 13.3] (+3/-4) | -10.0 pts [-20.0, 0.0] (+0/-3) | -6.7 pts [-16.7, 0.0] (+0/-2) | -6.7 pts [-14.4, 1.1] (+3/-9) |
| P4c - P2 | -6.7 pts [-23.3, 10.0] (+2/-4) | +0.0 pts [-10.0, 10.0] (+1/-1) | -6.7 pts [-16.7, 0.0] (+0/-2) | -4.4 pts [-11.1, 2.2] (+3/-7) |
| P1 - P2 | +13.3 pts [3.3, 26.7] (+4/-0) | +3.3 pts [0.0, 10.0] (+1/-0) | +3.3 pts [0.0, 10.0] (+1/-0) | +6.7 pts [2.2, 12.2] (+6/-0) |

Cost per task (i); steps = all actions executed across every env incl. the controller prefix; failures = blocked/failed/invalid actions; wall = mean ms per task for that protocol's run.

| protocol | group | mean steps | mean steps (passes only) | mean failures | mean wall ms |
|---|---|---|---|---|---|
| P0 | d3 | 28.3 | 39.0 | 9.6 | 3.10 |
| i.P1 | d3 | 50.7 | 52.5 | 4.9 | 3.40 |
| i.P2 | d3 | 48.3 | 45.8 | 4.9 | 3.03 |
| i.P3 | d3 | 46.8 | 46.8 | 5.0 | 2.72 |
| i.P4 | d3 | 46.8 | 46.8 | 5.0 | 2.84 |
| i.P4c | d3 | 47.2 | 47.0 | 5.4 | 3.16 |
| P0 | d4 | 31.4 | - | 10.9 | 3.22 |
| i.P1 | d4 | 62.6 | 75.0 | 8.7 | 4.17 |
| i.P2 | d4 | 61.9 | 70.7 | 8.3 | 3.98 |
| i.P3 | d4 | 52.0 | 72.3 | 9.4 | 3.11 |
| i.P4 | d4 | 52.0 | 72.3 | 9.4 | 3.16 |
| i.P4c | d4 | 51.4 | 68.8 | 8.9 | 3.49 |
| P0 | d5 | 23.4 | - | 11.0 | 2.12 |
| i.P1 | d5 | 73.2 | 108.0 | 10.5 | 5.81 |
| i.P2 | d5 | 71.9 | 99.0 | 10.0 | 5.29 |
| i.P3 | d5 | 57.7 | - | 9.6 | 4.23 |
| i.P4 | d5 | 58.9 | - | 9.9 | 4.15 |
| i.P4c | d5 | 58.7 | - | 10.4 | 4.31 |
| P0 | d3-d5 pooled | 27.7 | 39.0 | 10.5 | 2.82 |
| i.P1 | d3-d5 pooled | 62.2 | 64.5 | 8.1 | 4.46 |
| i.P2 | d3-d5 pooled | 60.7 | 58.0 | 7.7 | 4.10 |
| i.P3 | d3-d5 pooled | 52.1 | 51.9 | 8.0 | 3.36 |
| i.P4 | d3-d5 pooled | 52.5 | 51.9 | 8.1 | 3.39 |
| i.P4c | d3-d5 pooled | 52.4 | 54.7 | 8.2 | 3.65 |

### Kill rule (resumer (ii))

Kill if the best hold-and-resume protocol (max of P3, P4) is within 3 percentage points of P2.

| group | P2 | P3 | P4 | best(P3,P4) - P2 | within 3 pts? | CI of (P3 - P2) | CI of (P4 - P2) |
|---|---|---|---|---|---|---|---|
| d3 | 73.3% | 100.0% | 100.0% | +26.7 pts | no | +26.7 pts [13.3, 43.3] (+8/-0) | +26.7 pts [13.3, 43.3] (+8/-0) |
| d4 | 86.7% | 93.3% | 93.3% | +6.7 pts | no | +6.7 pts [0.0, 16.7] (+2/-0) | +6.7 pts [0.0, 16.7] (+2/-0) |
| d5 | 80.0% | 90.0% | 96.7% | +16.7 pts | no | +10.0 pts [-6.7, 26.7] (+5/-2) | +16.7 pts [3.3, 30.0] (+5/-0) |
| d3-d5 pooled | 80.0% | 94.4% | 96.7% | +16.7 pts | no | +14.4 pts [6.7, 23.3] (+15/-2) | +16.7 pts [8.9, 24.4] (+15/-0) |

Per-level rule (dossier wording, "at every level"): KILL does not fire. Pooled over d3-d5: KILL does not fire.

### Where the handoff falls (controller = regexAgentV2)

| group | controller wins | mean controller actions | median first refuted expectation (step) | mean B | mean optimal | median prefix / B | controller stranded itself (treasure unreachable at end) | P4 permissive vetoes earlier than refutation | median lead time P3 (last recoverable - handoff) | strands at handoff under P3 |
|---|---|---|---|---|---|---|---|---|---|---|
| d3 | 2/30 | 28.3 | 13 | 61.7 | 22.3 | 0.17 | 0/30 | 0/30 (cons. 1) | 11 | 0/30 |
| d4 | 0/30 | 31.4 | 7 | 92.8 | 33.6 | 0.09 | 0/30 | 0/30 (cons. 10) | 13 | 0/30 |
| d5 | 0/30 | 23.4 | 7 | 129.3 | 46.9 | 0.05 | 2/30 | 2/30 (cons. 6) | 11 | 2/30 |
| d3-d5 pooled | 2/90 | 27.7 | 8 | 94.6 | 34.3 | 0.09 | 2/90 | 2/90 (cons. 17) | 11 | 2/90 |

### Handoff-time sweep (hand off after h controller actions instead of at the first refutation)

Pass rate (levels/n) for P2 and P3 at each h; resumer (ii) then (i). Tasks the controller already won before h count as passes under both. "stranded" = treasure already unreachable at the handoff point.

Resumer (ii)

| h | d3 P2 | d4 P2 | d5 P2 | d3-d5 pooled P2 | d3 P3 | d4 P3 | d5 P3 | d3-d5 pooled P3 | P3 - P2, pooled | stranded at h (pooled) |
|---|---|---|---|---|---|---|---|---|---|---|
| 5 | 27/30 | 30/30 | 28/30 | 85/90 | 30/30 | 30/30 | 29/30 | 89/90 | +4.4 pts [0.0, 10.0] (+5/-1) | 1/90 |
| 10 | 24/30 | 29/30 | 25/30 | 78/90 | 30/30 | 30/30 | 28/30 | 88/90 | +11.1 pts [4.4, 18.9] (+11/-1) | 1/90 |
| 20 | 14/30 | 23/30 | 21/30 | 58/90 | 26/30 | 27/30 | 27/30 | 80/90 | +24.4 pts [13.3, 35.6] (+27/-5) | 2/90 |
| 30 | 12/30 | 18/30 | 21/30 | 51/90 | 19/30 | 24/30 | 23/30 | 66/90 | +16.7 pts [5.6, 27.8] (+22/-7) | 2/90 |
| 45 | 13/30 | 16/30 | 20/30 | 49/90 | 19/30 | 23/30 | 22/30 | 64/90 | +16.7 pts [4.4, 27.8] (+23/-8) | 2/90 |

Resumer (i)

| h | d3 P2 | d4 P2 | d5 P2 | d3-d5 pooled P2 | d3 P3 | d4 P3 | d5 P3 | d3-d5 pooled P3 | P3 - P2, pooled | stranded at h (pooled) |
|---|---|---|---|---|---|---|---|---|---|---|
| 5 | 17/30 | 7/30 | 2/30 | 26/90 | 15/30 | 4/30 | 1/30 | 20/90 | -6.7 pts [-15.6, 2.2] (+5/-11) | 1/90 |
| 10 | 17/30 | 7/30 | 2/30 | 26/90 | 10/30 | 4/30 | 0/30 | 14/90 | -13.3 pts [-22.2, -4.4] (+3/-15) | 1/90 |
| 20 | 10/30 | 5/30 | 2/30 | 17/90 | 6/30 | 2/30 | 0/30 | 8/90 | -10.0 pts [-17.8, -2.2] (+2/-11) | 2/90 |
| 30 | 5/30 | 3/30 | 0/30 | 8/90 | 5/30 | 2/30 | 0/30 | 7/90 | -1.1 pts [-6.7, 4.4] (+3/-4) | 2/90 |
| 45 | 7/30 | 3/30 | 0/30 | 10/90 | 7/30 | 2/30 | 0/30 | 9/90 | -1.1 pts [-6.7, 4.4] (+3/-4) | 2/90 |

