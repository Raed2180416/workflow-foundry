| arm | n | foundMin per run | mean (sd) | foundMinClass | foundAny | false reports | USD total | USD per found bug | wall s (mean) |
|---|---|---|---|---|---|---|---|---|---|
| gqa1/agent | 5 | 1, 1, 1, 1, 1 | 1 (0) | 1, 1, 1, 1, 1 | 1, 1, 1, 1, 1 | 0, 0, 0, 0, 0 | 0.018 | 0.004 | 54 |
| gqa1/monkey | 5 | 1, 1, 1, 1, 1 | 1 (0) | 1, 1, 1, 1, 1 | 1, 1, 1, 1, 1 | 0, 0, 0, 0, 0 | 0 | 0 | 101 |
| gqa1/monkey-ref | 5 | 8, 9, 11, 10, 11 | 9.8 (1.304) | 8, 9, 11, 10, 11 | 9, 12, 12, 10, 11 | 0, 0, 0, 0, 0 | 0 | 0 | 371 |
| gqa1/workflow | 5 | 8, 8, 6, 5, 5 | 6.4 (1.517) | 7, 8, 5, 5, 5 | 9, 8, 6, 5, 5 | 0, 0, 0, 0, 0 | 0.335 | 0.01 | 251 |
| gqa1/workflow-random | 5 | 7, 7, 6, 5, 7 | 6.4 (0.894) | 6, 6, 6, 5, 6 | 7, 7, 6, 8, 8 | 0, 0, 0, 0, 0 | 0.038 | 0.001 | 299 |
| gqa1m3/agent | 3 | 3, 4, 7 | 4.667 (2.082) | 3, 3, 6 | 3, 4, 7 | 0, 0, 0 | 0 | 0 | 602 |
| gqa1m3/workflow | 3 | 0, 0, 0 | 0 (0) | 0, 0, 0 | 0, 0, 0 | 0, 0, 0 | 0 | - | 98 |
| gqa1nb/agent-persist | 5 | 2, 1, 1, 2, 2 | 1.6 (0.548) | 1, 0, 1, 2, 1 | 2, 1, 2, 3, 2 | 0, 0, 0, 0, 0 | 0.176 | 0.022 | 442 |
| gqa1nb/agent | 5 | 1, 1, 1, 1, 1 | 1 (0) | 1, 1, 1, 1, 1 | 1, 1, 1, 1, 1 | 0, 0, 0, 0, 0 | 0.02 | 0.004 | 53 |
| gqa1v/agent | 5 | 1, 0, 1, 1, 1 | 0.8 (0.447) | 1, 0, 1, 1, 1 | 1, 1, 1, 1, 1 | 0, 0, 0, 0, 0 | 0.02 | 0.005 | 50 |
| gqa1v/workflow | 5 | 7, 6, 7, 5, 0 | 5 (2.915) | 6, 5, 7, 5, 0 | 8, 8, 7, 5, 0 | 0, 0, 0, 0, 0 | 0.324 | 0.013 | 186 |
| gqa1v/workflow-random | 5 | 5, 5, 6, 4, 1 | 4.2 (1.924) | 5, 4, 5, 4, 1 | 8, 6, 7, 6, 1 | 0, 0, 0, 0, 0 | 0.026 | 0.001 | 135 |
| gqa2/agent-matched | 5 | 4, 4, 5, 4, 5 | 4.4 (0.548) | 3, 3, 4, 3, 4 | 5, 6, 5, 5, 5 | 0, 0, 0, 0, 1 | 0.338 | 0.015 | 553 |

| comparison | n | means | diff | U | p | decision |
|---|---|---|---|---|---|---|
| H1 primary: the cheap-built workflow finds more bugs (1-minimal repros) than the Haiku agent alone | 5 vs 5 | 6.4 vs 1 | 5.4 | 25 | 0.004 (greater) | supported (dev evidence) |
| H2: the workflow beats the random monkey baseline | 5 vs 5 | 6.4 vs 1 | 5.4 | 25 | 0.004 (greater) | supported (dev evidence) |
| H3: the Haiku agent alone beats the random monkey baseline | 5 vs 5 | 1 vs 1 | 0 | 12.5 | 1 (greater) | not supported |
| H4 ablation: persona-guided exploration vs random exploration with the same constructed checks | 5 vs 5 | 6.4 vs 6.4 | 0 | 12.5 | 1 (two-sided) | no difference shown |
| S1 (A1, secondary): H1 against the agent without the CLI budget line | 5 vs 5 | 6.4 vs 1 | 5.4 | 25 | 0.004 (greater) | supported (dev evidence) |
| S2 (A1, secondary): does removing the CLI budget line change the agent? | 5 vs 5 | 1 vs 1 | 0 | 12.5 | 1 (two-sided) | no difference shown |
| S3 (A1, secondary): H1 against the agent with no budget line whose early finish is refused | 5 vs 5 | 6.4 vs 1.6 | 4.8 | 25 | 0.004 (greater) | supported (dev evidence) |
| S4 (A1, secondary): does refusing the early finish change the agent? | 5 vs 5 | 1.6 vs 1 | 0.6 | 20 | 0.167 (two-sided) | no difference shown |
| R1 (A2): H1 replicated on one CLI version, all reps run on the same day | 5 vs 5 | 5 vs 0.8 | 4.2 | 20.5 | 0.048 (greater) | supported (dev evidence) |
| R2 (A2): H2 with the replication workflow runs | 5 vs 5 | 5 vs 1 | 4 | 20 | 0.063 (greater) | not supported |
| R4 (A2): H4 replicated | 5 vs 5 | 5 vs 4.2 | 0.8 | 17.5 | 0.341 (two-sided) | no difference shown |
| C1 (A2): the workflow vs the agent with the persona prompt wording, append-only reports and restarts up to the workflow's dollars | 5 vs 5 | 5 vs 4.4 | 0.6 | 19 | 0.107 (greater) | not supported |
| C2 (A2): the cheaper random-exploration workflow vs the same matched agent | 5 vs 5 | 4.2 vs 4.4 | -0.2 | 14.5 | 0.437 (greater) | not supported |
| C3 (A2): does matching (prompt, report log, restarts, dollars) change the agent? | 5 vs 5 | 4.4 vs 0.8 | 3.6 | 25 | 0.008 (two-sided) | a > b |
| S2v (A2): the budget line on one CLI version (S2 compared 2.1.312 with the line against 2.1.318 without it) | 5 vs 5 | 0.8 vs 1 | -0.2 | 10 | 1 (two-sided) | no difference shown |
| P1 (A2, secondary): H1 pooled over both series (K = 10 vs 10, unpaired) | 10 vs 10 | 5.7 vs 0.9 | 4.8 | 90.5 | 0 (greater) | supported (dev evidence) |

| bug | gqa1/agent | gqa1/monkey | gqa1/monkey-ref | gqa1/workflow | gqa1/workflow-random | gqa1m3/agent | gqa1m3/workflow | gqa1nb/agent-persist | gqa1nb/agent | gqa1v/agent | gqa1v/workflow | gqa1v/workflow-random | gqa2/agent-matched |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| GQ01 | 1/5 | 0/5 | 3/5 | 0/5 | 0/5 | 0/3 | 0/3 | 0/5 | 0/5 | 0/5 | 1/5 | 0/5 | 4/5 |
| GQ02 | 0/5 | 0/5 | 4/5 | 0/5 | 0/5 | 0/3 | 0/3 | 0/5 | 0/5 | 0/5 | 0/5 | 0/5 | 0/5 |
| GQ03 | 1/5 | 0/5 | 5/5 | 5/5 | 4/5 | 1/3 | 0/3 | 0/5 | 0/5 | 0/5 | 4/5 | 4/5 | 0/5 |
| GQ04 | 0/5 | 0/5 | 5/5 | 3/5 | 3/5 | 1/3 | 0/3 | 0/5 | 0/5 | 0/5 | 0/5 | 0/5 | 0/5 |
| GQ05 | 0/5 | 5/5 | 5/5 | 5/5 | 5/5 | 2/3 | 0/3 | 3/5 | 0/5 | 0/5 | 4/5 | 5/5 | 3/5 |
| GQ06 | 0/5 | 0/5 | 2/5 | 0/5 | 0/5 | 3/3 | 0/3 | 0/5 | 0/5 | 0/5 | 0/5 | 0/5 | 4/5 |
| GQ07 | 0/5 | 0/5 | 4/5 | 4/5 | 5/5 | 0/3 | 0/3 | 0/5 | 0/5 | 0/5 | 4/5 | 4/5 | 0/5 |
| GQ08 | 0/5 | 0/5 | 1/5 | 4/5 | 1/5 | 0/3 | 0/3 | 0/5 | 0/5 | 0/5 | 4/5 | 0/5 | 0/5 |
| GQ09 | 0/5 | 0/5 | 5/5 | 5/5 | 5/5 | 0/3 | 0/3 | 0/5 | 0/5 | 0/5 | 4/5 | 4/5 | 0/5 |
| GQ10 | 2/5 | 0/5 | 5/5 | 3/5 | 3/5 | 2/3 | 0/3 | 4/5 | 3/5 | 2/5 | 0/5 | 0/5 | 4/5 |
| GQ11 | 1/5 | 0/5 | 5/5 | 2/5 | 2/5 | 3/3 | 0/3 | 1/5 | 1/5 | 2/5 | 3/5 | 3/5 | 5/5 |
| GQ12 | 0/5 | 0/5 | 5/5 | 1/5 | 4/5 | 2/3 | 0/3 | 0/5 | 1/5 | 0/5 | 1/5 | 1/5 | 2/5 |

excluded: [{"run":"gqa1m3-workflow-random-r1","why":"harness fault (runner exception)"},{"run":"gqa1m3-workflow-random-r2","why":"harness fault (runner exception)"},{"run":"gqa1m3-workflow-random-r3","why":"harness fault (runner exception)"}]
