| arm | n | foundMin per run | mean (sd) | foundMinClass | foundAny | false reports | USD total | USD per found bug | wall s (mean) |
|---|---|---|---|---|---|---|---|---|---|
| gqa1/agent | 5 | 1, 1, 1, 1, 1 | 1 (0) | 1, 1, 1, 1, 1 | 1, 1, 1, 1, 1 | 0, 0, 0, 0, 0 | 0.018 | 0.004 | 54 |
| gqa1/monkey | 5 | 1, 1, 1, 1, 1 | 1 (0) | 1, 1, 1, 1, 1 | 1, 1, 1, 1, 1 | 0, 0, 0, 0, 0 | 0 | 0 | 101 |
| gqa1/monkey-ref | 5 | 8, 9, 11, 10, 11 | 9.8 (1.304) | 8, 9, 11, 10, 11 | 9, 12, 12, 10, 11 | 0, 0, 0, 0, 0 | 0 | 0 | 371 |
| gqa1/workflow | 5 | 8, 8, 6, 5, 5 | 6.4 (1.517) | 7, 8, 5, 5, 5 | 9, 8, 6, 5, 5 | 0, 0, 0, 0, 0 | 0.335 | 0.01 | 251 |
| gqa1/workflow-random | 5 | 7, 7, 6, 5, 7 | 6.4 (0.894) | 6, 6, 6, 5, 6 | 7, 7, 6, 8, 8 | 0, 0, 0, 0, 0 | 0.038 | 0.001 | 299 |
| gqa1nb/agent-persist | 5 | 2, 1, 1, 2, 2 | 1.6 (0.548) | 1, 0, 1, 2, 1 | 2, 1, 2, 3, 2 | 0, 0, 0, 0, 0 | 0.176 | 0.022 | 442 |
| gqa1nb/agent | 5 | 1, 1, 1, 1, 1 | 1 (0) | 1, 1, 1, 1, 1 | 1, 1, 1, 1, 1 | 0, 0, 0, 0, 0 | 0.02 | 0.004 | 53 |

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

| bug | gqa1/agent | gqa1/monkey | gqa1/monkey-ref | gqa1/workflow | gqa1/workflow-random | gqa1nb/agent-persist | gqa1nb/agent |
|---|---|---|---|---|---|---|---|
| GQ01 | 1/5 | 0/5 | 3/5 | 0/5 | 0/5 | 0/5 | 0/5 |
| GQ02 | 0/5 | 0/5 | 4/5 | 0/5 | 0/5 | 0/5 | 0/5 |
| GQ03 | 1/5 | 0/5 | 5/5 | 5/5 | 4/5 | 0/5 | 0/5 |
| GQ04 | 0/5 | 0/5 | 5/5 | 3/5 | 3/5 | 0/5 | 0/5 |
| GQ05 | 0/5 | 5/5 | 5/5 | 5/5 | 5/5 | 3/5 | 0/5 |
| GQ06 | 0/5 | 0/5 | 2/5 | 0/5 | 0/5 | 0/5 | 0/5 |
| GQ07 | 0/5 | 0/5 | 4/5 | 4/5 | 5/5 | 0/5 | 0/5 |
| GQ08 | 0/5 | 0/5 | 1/5 | 4/5 | 1/5 | 0/5 | 0/5 |
| GQ09 | 0/5 | 0/5 | 5/5 | 5/5 | 5/5 | 0/5 | 0/5 |
| GQ10 | 2/5 | 0/5 | 5/5 | 3/5 | 3/5 | 4/5 | 3/5 |
| GQ11 | 1/5 | 0/5 | 5/5 | 2/5 | 2/5 | 1/5 | 1/5 |
| GQ12 | 0/5 | 0/5 | 5/5 | 1/5 | 4/5 | 0/5 | 1/5 |
