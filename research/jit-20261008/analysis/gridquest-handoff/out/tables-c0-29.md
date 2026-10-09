### Resumer (ii): explorer-from-current-state (oracle-side upper bound)

Levels completed out of n, pass rate, 95% bootstrap CI over tasks (10 000 resamples).

| protocol | d3 | d4 | d5 | d3-d5 pooled |
|---|---|---|---|---|
| P0 no fallback (controller only) | 1/30 = 3.3% [0.0, 10.0] | 0/30 = 0.0% [0.0, 0.0] | 0/30 = 0.0% [0.0, 0.0] | 1/90 = 1.1% [0.0, 3.3] |
| P1 whole-task restart, fresh env (counterfactual) | 30/30 = 100.0% [100.0, 100.0] | 30/30 = 100.0% [100.0, 100.0] | 30/30 = 100.0% [100.0, 100.0] | 90/90 = 100.0% [100.0, 100.0] |
| P2 restart, same env, residual ledger | 27/30 = 90.0% [80.0, 100.0] | 27/30 = 90.0% [76.7, 100.0] | 28/30 = 93.3% [83.3, 100.0] | 82/90 = 91.1% [85.6, 96.7] |
| P3 hold-and-resume at first refuted expectation (snapshot + mem) | 28/30 = 93.3% [83.3, 100.0] | 28/30 = 93.3% [83.3, 100.0] | 28/30 = 93.3% [83.3, 100.0] | 84/90 = 93.3% [87.8, 97.8] |
| P4 = P3 + nonblocking permissive (oracle reachability check) | 28/30 = 93.3% [83.3, 100.0] | 28/30 = 93.3% [83.3, 100.0] | 30/30 = 100.0% [100.0, 100.0] | 86/90 = 95.6% [91.1, 98.9] |
| P4c = P3 + conservative permissive (veto every one-way / coupled action) | 28/30 = 93.3% [83.3, 100.0] | 28/30 = 93.3% [83.3, 100.0] | 30/30 = 100.0% [100.0, 100.0] | 86/90 = 95.6% [91.1, 98.9] |
| P3-lossy: mem = visited rooms only | 27/30 = 90.0% [76.7, 100.0] | 27/30 = 90.0% [76.7, 100.0] | 26/30 = 86.7% [73.3, 96.7] | 80/90 = 88.9% [82.2, 94.4] |
| P3-amn: snapshot only, mem dropped | 25/30 = 83.3% [70.0, 96.7] | 26/30 = 86.7% [73.3, 96.7] | 22/30 = 73.3% [56.7, 86.7] | 73/90 = 81.1% [72.2, 88.9] |

Paired differences against P2 (ii), same tasks; (+wins/-losses) in tasks.

| contrast | d3 | d4 | d5 | d3-d5 pooled |
|---|---|---|---|---|
| P3 - P2 | +3.3 pts [-6.7, 13.3] (+2/-1) | +3.3 pts [0.0, 10.0] (+1/-0) | +0.0 pts [-13.3, 13.3] (+2/-2) | +2.2 pts [-3.3, 8.9] (+5/-3) |
| P4 - P2 | +3.3 pts [-6.7, 13.3] (+2/-1) | +3.3 pts [0.0, 10.0] (+1/-0) | +6.7 pts [0.0, 16.7] (+2/-0) | +4.4 pts [0.0, 10.0] (+5/-1) |
| P4c - P2 | +3.3 pts [-6.7, 13.3] (+2/-1) | +3.3 pts [0.0, 10.0] (+1/-0) | +6.7 pts [0.0, 16.7] (+2/-0) | +4.4 pts [0.0, 10.0] (+5/-1) |
| P3lossy - P2 | +0.0 pts [-13.3, 13.3] (+2/-2) | +0.0 pts [-10.0, 10.0] (+1/-1) | -6.7 pts [-20.0, 6.7] (+1/-3) | -2.2 pts [-8.9, 4.4] (+4/-6) |
| P3amn - P2 | -6.7 pts [-16.7, 0.0] (+0/-2) | -3.3 pts [-13.3, 6.7] (+1/-2) | -20.0 pts [-36.7, -6.7] (+0/-6) | -10.0 pts [-17.8, -3.3] (+1/-10) |
| P1 - P2 | +10.0 pts [0.0, 20.0] (+3/-0) | +10.0 pts [0.0, 23.3] (+3/-0) | +6.7 pts [0.0, 16.7] (+2/-0) | +8.9 pts [3.3, 14.4] (+8/-0) |

Cost per task (ii); steps = all actions executed across every env incl. the controller prefix; failures = blocked/failed/invalid actions; wall = mean ms per task for that protocol's run.

| protocol | group | mean steps | mean steps (passes only) | mean failures | mean wall ms |
|---|---|---|---|---|---|
| P0 | d3 | 26.2 | 26.0 | 11.3 | 3.54 |
| ii.P1 | d3 | 52.6 | 52.6 | 1.0 | 0.98 |
| ii.P2 | d3 | 51.0 | 50.4 | 1.0 | 1.01 |
| ii.P3 | d3 | 46.6 | 46.6 | 1.0 | 0.82 |
| ii.P4 | d3 | 46.6 | 46.6 | 1.0 | 0.80 |
| ii.P4c | d3 | 46.6 | 46.6 | 1.0 | 0.77 |
| P0 | d4 | 29.0 | - | 11.2 | 3.40 |
| ii.P1 | d4 | 75.5 | 75.5 | 1.0 | 1.37 |
| ii.P2 | d4 | 74.8 | 74.8 | 1.0 | 1.36 |
| ii.P3 | d4 | 70.2 | 69.7 | 1.0 | 1.19 |
| ii.P4 | d4 | 70.2 | 69.7 | 1.0 | 1.47 |
| ii.P4c | d4 | 69.5 | 69.0 | 0.8 | 1.15 |
| P0 | d5 | 24.0 | - | 10.9 | 2.10 |
| ii.P1 | d5 | 97.0 | 97.0 | 1.0 | 1.62 |
| ii.P2 | d5 | 96.1 | 95.4 | 1.0 | 1.66 |
| ii.P3 | d5 | 85.1 | 89.9 | 1.0 | 1.41 |
| ii.P4 | d5 | 90.2 | 90.2 | 0.9 | 1.43 |
| ii.P4c | d5 | 90.8 | 90.8 | 0.8 | 1.47 |
| P0 | d3-d5 pooled | 26.4 | 26.0 | 11.1 | 3.01 |
| ii.P1 | d3-d5 pooled | 75.0 | 75.0 | 1.0 | 1.32 |
| ii.P2 | d3-d5 pooled | 74.0 | 73.8 | 1.0 | 1.34 |
| ii.P3 | d3-d5 pooled | 67.3 | 68.7 | 1.0 | 1.14 |
| ii.P4 | d3-d5 pooled | 69.0 | 69.3 | 1.0 | 1.23 |
| ii.P4c | d3-d5 pooled | 69.0 | 69.3 | 0.8 | 1.13 |

### Resumer (i): templateAwareAgent (white-box regex, amnesiac, env-driven)

Levels completed out of n, pass rate, 95% bootstrap CI over tasks (10 000 resamples).

| protocol | d3 | d4 | d5 | d3-d5 pooled |
|---|---|---|---|---|
| P0 no fallback (controller only) | 1/30 = 3.3% [0.0, 10.0] | 0/30 = 0.0% [0.0, 0.0] | 0/30 = 0.0% [0.0, 0.0] | 1/90 = 1.1% [0.0, 3.3] |
| P1 whole-task restart, fresh env (counterfactual) | 13/30 = 43.3% [26.7, 60.0] | 4/30 = 13.3% [3.3, 26.7] | 9/30 = 30.0% [13.3, 46.7] | 26/90 = 28.9% [20.0, 37.8] |
| P2 restart, same env, residual ledger | 12/30 = 40.0% [23.3, 56.7] | 4/30 = 13.3% [3.3, 26.7] | 8/30 = 26.7% [10.0, 43.3] | 24/90 = 26.7% [17.8, 35.6] |
| P3 hold-and-resume at first refuted expectation (snapshot + mem) | 8/30 = 26.7% [13.3, 43.3] | 2/30 = 6.7% [0.0, 16.7] | 4/30 = 13.3% [3.3, 26.7] | 14/90 = 15.6% [8.9, 23.3] |
| P4 = P3 + nonblocking permissive (oracle reachability check) | 8/30 = 26.7% [13.3, 43.3] | 2/30 = 6.7% [0.0, 16.7] | 4/30 = 13.3% [3.3, 26.7] | 14/90 = 15.6% [8.9, 23.3] |
| P4c = P3 + conservative permissive (veto every one-way / coupled action) | 8/30 = 26.7% [13.3, 43.3] | 3/30 = 10.0% [0.0, 23.3] | 4/30 = 13.3% [3.3, 26.7] | 15/90 = 16.7% [8.9, 24.4] |

Paired differences against P2 (i), same tasks; (+wins/-losses) in tasks.

| contrast | d3 | d4 | d5 | d3-d5 pooled |
|---|---|---|---|---|
| P3 - P2 | -13.3 pts [-26.7, -3.3] (+0/-4) | -6.7 pts [-16.7, 0.0] (+0/-2) | -13.3 pts [-26.7, -3.3] (+0/-4) | -11.1 pts [-17.8, -5.6] (+0/-10) |
| P4 - P2 | -13.3 pts [-26.7, -3.3] (+0/-4) | -6.7 pts [-16.7, 0.0] (+0/-2) | -13.3 pts [-26.7, -3.3] (+0/-4) | -11.1 pts [-17.8, -5.6] (+0/-10) |
| P4c - P2 | -13.3 pts [-26.7, -3.3] (+0/-4) | -3.3 pts [-10.0, 0.0] (+0/-1) | -13.3 pts [-26.7, -3.3] (+0/-4) | -10.0 pts [-16.7, -4.4] (+0/-9) |
| P1 - P2 | +3.3 pts [0.0, 10.0] (+1/-0) | +0.0 pts [0.0, 0.0] (+0/-0) | +3.3 pts [0.0, 10.0] (+1/-0) | +2.2 pts [0.0, 5.6] (+2/-0) |

Cost per task (i); steps = all actions executed across every env incl. the controller prefix; failures = blocked/failed/invalid actions; wall = mean ms per task for that protocol's run.

| protocol | group | mean steps | mean steps (passes only) | mean failures | mean wall ms |
|---|---|---|---|---|---|
| P0 | d3 | 26.2 | 26.0 | 11.3 | 3.54 |
| i.P1 | d3 | 50.2 | 48.8 | 7.6 | 4.13 |
| i.P2 | d3 | 48.4 | 48.3 | 6.8 | 3.74 |
| i.P3 | d3 | 49.2 | 51.3 | 8.9 | 3.93 |
| i.P4 | d3 | 49.2 | 51.3 | 8.9 | 4.24 |
| i.P4c | d3 | 49.0 | 51.3 | 8.7 | 4.11 |
| P0 | d4 | 29.0 | - | 11.2 | 3.40 |
| i.P1 | d4 | 64.2 | 67.5 | 10.0 | 5.76 |
| i.P2 | d4 | 63.1 | 67.5 | 9.2 | 5.50 |
| i.P3 | d4 | 57.3 | 72.5 | 9.9 | 4.76 |
| i.P4 | d4 | 57.3 | 72.5 | 9.9 | 4.88 |
| i.P4c | d4 | 59.7 | 71.3 | 9.6 | 5.56 |
| P0 | d5 | 24.0 | - | 10.9 | 2.10 |
| i.P1 | d5 | 64.2 | 94.9 | 8.2 | 4.78 |
| i.P2 | d5 | 63.7 | 91.8 | 8.2 | 4.67 |
| i.P3 | d5 | 51.8 | 79.5 | 9.3 | 3.68 |
| i.P4 | d5 | 52.3 | 79.5 | 9.3 | 3.50 |
| i.P4c | d5 | 53.5 | 79.5 | 9.2 | 3.63 |
| P0 | d3-d5 pooled | 26.4 | 26.0 | 11.1 | 3.01 |
| i.P1 | d3-d5 pooled | 59.5 | 67.7 | 8.6 | 4.89 |
| i.P2 | d3-d5 pooled | 58.4 | 66.0 | 8.1 | 4.63 |
| i.P3 | d3-d5 pooled | 52.7 | 62.4 | 9.4 | 4.12 |
| i.P4 | d3-d5 pooled | 52.9 | 62.4 | 9.3 | 4.21 |
| i.P4c | d3-d5 pooled | 54.1 | 62.8 | 9.2 | 4.44 |

### Kill rule (resumer (ii))

Kill if the best hold-and-resume protocol (max of P3, P4) is within 3 percentage points of P2.

| group | P2 | P3 | P4 | best(P3,P4) - P2 | within 3 pts? | CI of (P3 - P2) | CI of (P4 - P2) |
|---|---|---|---|---|---|---|---|
| d3 | 90.0% | 93.3% | 93.3% | +3.3 pts | no | +3.3 pts [-6.7, 13.3] (+2/-1) | +3.3 pts [-6.7, 13.3] (+2/-1) |
| d4 | 90.0% | 93.3% | 93.3% | +3.3 pts | no | +3.3 pts [0.0, 10.0] (+1/-0) | +3.3 pts [0.0, 10.0] (+1/-0) |
| d5 | 93.3% | 93.3% | 100.0% | +6.7 pts | no | +0.0 pts [-13.3, 13.3] (+2/-2) | +6.7 pts [0.0, 16.7] (+2/-0) |
| d3-d5 pooled | 91.1% | 93.3% | 95.6% | +4.4 pts | no | +2.2 pts [-3.3, 8.9] (+5/-3) | +4.4 pts [0.0, 10.0] (+5/-1) |

Per-level rule (dossier wording, "at every level"): KILL does not fire. Pooled over d3-d5: KILL does not fire.

### Where the handoff falls (controller = regexAgentV2)

| group | controller wins | mean controller actions | median first refuted expectation (step) | mean B | mean optimal | median prefix / B | controller stranded itself (treasure unreachable at end) | P4 permissive vetoes earlier than refutation | median lead time P3 (last recoverable - handoff) | strands at handoff under P3 |
|---|---|---|---|---|---|---|---|---|---|---|
| d3 | 1/30 | 26.2 | 9 | 68.3 | 24.7 | 0.11 | 0/30 | 0/30 (cons. 1) | 11 | 0/30 |
| d4 | 0/30 | 29.0 | 5 | 100.5 | 36.4 | 0.05 | 2/30 | 0/30 (cons. 7) | 14 | 0/30 |
| d5 | 0/30 | 24.0 | 5 | 125.2 | 45.4 | 0.04 | 3/30 | 2/30 (cons. 6) | 14 | 2/30 |
| d3-d5 pooled | 1/90 | 26.4 | 6 | 98.0 | 35.5 | 0.07 | 5/90 | 2/90 (cons. 14) | 14 | 2/90 |

### Handoff-time sweep (hand off after h controller actions instead of at the first refutation)

Pass rate (levels/n) for P2 and P3 at each h; resumer (ii) then (i). Tasks the controller already won before h count as passes under both. "stranded" = treasure already unreachable at the handoff point.

Resumer (ii)

| h | d3 P2 | d4 P2 | d5 P2 | d3-d5 pooled P2 | d3 P3 | d4 P3 | d5 P3 | d3-d5 pooled P3 | P3 - P2, pooled | stranded at h (pooled) |
|---|---|---|---|---|---|---|---|---|---|---|
| 5 | 29/30 | 28/30 | 28/30 | 85/90 | 29/30 | 28/30 | 30/30 | 87/90 | +2.2 pts [-3.3, 8.9] (+5/-3) | 1/90 |
| 10 | 29/30 | 26/30 | 27/30 | 82/90 | 29/30 | 27/30 | 28/30 | 84/90 | +2.2 pts [-4.4, 8.9] (+6/-4) | 2/90 |
| 20 | 24/30 | 24/30 | 25/30 | 73/90 | 28/30 | 26/30 | 22/30 | 76/90 | +3.3 pts [-5.6, 12.2] (+11/-8) | 3/90 |
| 30 | 23/30 | 21/30 | 23/30 | 67/90 | 23/30 | 24/30 | 21/30 | 68/90 | +1.1 pts [-8.9, 11.1] (+12/-11) | 4/90 |
| 45 | 19/30 | 17/30 | 22/30 | 58/90 | 23/30 | 21/30 | 21/30 | 65/90 | +7.8 pts [-2.2, 17.8] (+15/-8) | 5/90 |

Resumer (i)

| h | d3 P2 | d4 P2 | d5 P2 | d3-d5 pooled P2 | d3 P3 | d4 P3 | d5 P3 | d3-d5 pooled P3 | P3 - P2, pooled | stranded at h (pooled) |
|---|---|---|---|---|---|---|---|---|---|---|
| 5 | 13/30 | 4/30 | 8/30 | 25/90 | 9/30 | 5/30 | 7/30 | 21/90 | -4.4 pts [-12.2, 3.3] (+5/-9) | 1/90 |
| 10 | 13/30 | 4/30 | 8/30 | 25/90 | 6/30 | 2/30 | 3/30 | 11/90 | -15.6 pts [-24.4, -6.7] (+2/-16) | 2/90 |
| 20 | 10/30 | 3/30 | 7/30 | 20/90 | 6/30 | 3/30 | 3/30 | 12/90 | -8.9 pts [-17.8, -1.1] (+4/-12) | 3/90 |
| 30 | 9/30 | 3/30 | 6/30 | 18/90 | 7/30 | 1/30 | 4/30 | 12/90 | -6.7 pts [-15.6, 2.2] (+5/-11) | 4/90 |
| 45 | 7/30 | 2/30 | 6/30 | 15/90 | 8/30 | 1/30 | 4/30 | 13/90 | -2.2 pts [-11.1, 6.7] (+7/-9) | 5/90 |

