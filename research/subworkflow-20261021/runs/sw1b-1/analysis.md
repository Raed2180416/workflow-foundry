units 50, complete 50

| arm | layout | tasks pass | backlog pass | simple pass | $/task | $/backlog node | $/passing backlog node | backlog paths | passes by path | template picked | open stage used / passed | rounds | audit | violations | effects | proposals | max depth | node over | errors | wall s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| A0 | delimited | 1/5 (20.0%) | 5/10 (50.0%) | 10/10 (100.0%) | 0.037276 | 0.018071 | 0.036142 | direct 10 | direct 5 | - | 0 / 0 | - | 0 | 0 | 0 | 0 | 0 | 0 | - | 126 |
| A1F | delimited | 5/5 (100.0%) | 10/10 (100.0%) | 10/10 (100.0%) | 0.025369 | 0.012211 | 0.012211 | subworkflow 10 | subworkflow 10 | - | 0 / 0 | 1 9, 2 1 | 0 | 0 | 0 | 0 | 1 | 0 | - | 120 |
| A2F | delimited | 4/5 (80.0%) | 9/10 (90.0%) | 10/10 (100.0%) | 0.016585 | 0.007875 | 0.00875 | subworkflow 10 | subworkflow 9 | legacy-export-intake 10 | 0 / 0 | 1 10 | 0 | 0 | 0 | 31 | 1 | 0 | - | 93 |
| A0 | blocks | 0/5 (0.0%) | 3/10 (30.0%) | 10/10 (100.0%) | 0.031779 | 0.015296 | 0.050988 | direct 10 | direct 3 | - | 0 / 0 | - | 0 | 0 | 0 | 0 | 0 | 0 | - | 109 |
| A1F | blocks | 5/5 (100.0%) | 10/10 (100.0%) | 10/10 (100.0%) | 0.027192 | 0.013184 | 0.013184 | subworkflow 10 | subworkflow 10 | - | 0 / 0 | 1 10 | 0 | 0 | 0 | 0 | 1 | 0 | - | 147 |
| A2F | blocks | 0/5 (0.0%) | 2/10 (20.0%) | 10/10 (100.0%) | 0.057975 | 0.028575 | 0.142873 | fallback 10 | fallback 2 | legacy-export-intake 10 | 0 / 0 | 4 10 | 0 | 0 | 0 | 33 | 0 | 0 | - | 210 |
| A2OF | blocks | 3/5 (60.0%) | 8/10 (80.0%) | 10/10 (100.0%) | 0.05819 | 0.028675 | 0.035844 | subworkflow 10 | subworkflow 8 | legacy-export-intake 10 | 10 / 8 | 5 10 | 0 | 0 | 0 | 29 | 1 | 0 | - | 241 |

| a vs b (paired backlog nodes, same worlds) | worlds | both | only a | only b | neither | $ a | $ b |
|---|---|---|---|---|---|---|---|
| A0/blocks vs A0/delimited | 5 | 2 | 1 | 3 | 4 | 0.158897 | 0.18638 |
| A1F/blocks vs A1F/delimited | 5 | 10 | 0 | 0 | 0 | 0.135959 | 0.126846 |
| A2F/blocks vs A2F/delimited | 5 | 2 | 0 | 7 | 1 | 0.289873 | 0.082927 |
| A2OF/blocks vs A2OF/delimited | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| A1F/blocks vs A2F/blocks | 5 | 2 | 8 | 0 | 0 | 0.135959 | 0.289873 |
| A2OF/blocks vs A2F/blocks | 5 | 2 | 6 | 0 | 2 | 0.290951 | 0.289873 |
| A2OF/blocks vs A1F/blocks | 5 | 8 | 0 | 2 | 0 | 0.290951 | 0.135959 |
| A1F/blocks vs A0/blocks | 5 | 3 | 7 | 0 | 0 | 0.135959 | 0.158897 |
| A2F/blocks vs A0/blocks | 5 | 1 | 1 | 2 | 6 | 0.289873 | 0.158897 |
| A2OF/blocks vs A0/blocks | 5 | 3 | 5 | 0 | 2 | 0.290951 | 0.158897 |
