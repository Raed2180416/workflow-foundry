# Pattern census tables (generated 2026-10-14; 1559 items, 49 platforms, 54 catalog entries, budget 5)

**A candidate generator, not a measurement** (AUDIT-L1): "flat" + "hier" counts items the rules do not refuse; the measured coverage is AUDIT-L1 §5. Census revision 1: detectors removed P02, P16, P17, P18, P30, P49; CI event platforms github-actions, gitlab-ci; dashboard refusal at >= 20 `ui_*` widgets refuses 14 more items (without it: flat 1281, hier 243, refused 35).

| status (full catalog) | items | share |
|---|---|---|
| flat | 1276 | 81.8% |
| hier | 234 | 15.0% |
| refused | 49 | 3.1% |
| uncovered | 0 | 0.0% |

L0 only (no L1 pattern needed): 233 (14.9%). Default-rule control nodes: 391 of 24603 (1.6%).

| expansion budget (distinct L1 patterns) | items explained flat | share of all items |
|---|---|---|
| <= 1 | 546 | 35.0% |
| <= 2 | 796 | 51.1% |
| <= 3 | 995 | 63.8% |
| <= 5 | 1276 | 81.8% |
| <= 8 | 1455 | 93.3% |
| <= 12 | 1497 | 96.0% |

| k | pattern added | newly explained | explained (excl. refused) | explained + refused |
|---|---|---|---|---|
| 1 | P38 | 50 | 18.2% | 21.3% |
| 2 | P54 | 43 | 20.9% | 24.1% |
| 3 | P56 | 50 | 24.1% | 27.3% |
| 4 | P36 | 31 | 26.1% | 29.2% |
| 5 | P27 | 31 | 28.1% | 31.2% |
| 6 | P29 | 31 | 30.1% | 33.2% |
| 7 | P26 | 46 | 33.0% | 36.2% |
| 8 | P08 | 47 | 36.0% | 39.2% |
| 9 | P14 | 26 | 37.7% | 40.9% |
| 10 | P21 | 24 | 39.3% | 42.4% |
| 11 | P06 | 23 | 40.7% | 43.9% |
| 12 | P05 | 32 | 42.8% | 45.9% |
| 13 | P04 | 24 | 44.3% | 47.5% |
| 14 | P07 | 22 | 45.7% | 48.9% |
| 15 | P37 | 24 | 47.3% | 50.4% |
| 16 | P34 | 24 | 48.8% | 52.0% |
| 17 | P33 | 26 | 50.5% | 53.6% |
| 18 | P40 | 32 | 52.5% | 55.7% |
| 19 | P12 | 26 | 54.2% | 57.3% |
| 20 | P03 | 28 | 56.0% | 59.1% |
| 21 | P43 | 20 | 57.3% | 60.4% |
| 22 | P42 | 28 | 59.1% | 62.2% |
| 23 | P45 | 57 | 62.7% | 65.9% |
| 24 | P20 | 39 | 65.2% | 68.4% |
| 25 | P13 | 38 | 67.7% | 70.8% |
| 26 | P39 | 21 | 69.0% | 72.2% |
| 27 | P47 | 21 | 70.4% | 73.5% |
| 28 | P19 | 22 | 71.8% | 74.9% |
| 29 | P46 | 23 | 73.3% | 76.4% |
| 30 | P28 | 25 | 74.9% | 78.0% |
| 31 | P25 | 23 | 76.3% | 79.5% |
| 32 | P32 | 24 | 77.9% | 81.0% |
| 33 | P10 | 32 | 79.9% | 83.1% |
| 34 | P55 | 59 | 83.7% | 86.9% |
| 35 | P53 | 45 | 86.6% | 89.7% |
| 36 | P44 | 23 | 88.1% | 91.2% |
| 37 | P51 | 24 | 89.6% | 92.8% |
| 38 | P09 | 17 | 90.7% | 93.8% |
| 39 | P15 | 15 | 91.7% | 94.8% |
| 40 | P41 | 28 | 93.5% | 96.6% |
| 41 | P35 | 14 | 94.4% | 97.5% |
| 42 | P57 | 11 | 95.1% | 98.2% |
| 43 | P22 | 10 | 95.7% | 98.8% |
| 44 | P31 | 9 | 96.3% | 99.4% |
| 45 | P48 | 6 | 96.7% | 99.8% |
| 46 | P50 | 3 | 96.9% | 100.0% |
| 47 | P23 | 0 | 96.9% | 100.0% |

| distinct L1 patterns per item | items |
|---|---|
| 0 | 233 |
| 1 | 313 |
| 2 | 250 |
| 3 | 199 |
| 4 | 160 |
| 5 | 121 |
| 6 | 93 |
| 7 | 50 |
| 8 | 36 |
| 9 | 15 |
| 10 | 18 |
| 11 | 7 |
| 12 | 2 |
| 13 | 7 |
| 14 | 4 |
| 15 | 2 |

| id | pattern | family | items | by node / token / idiom-only | oracle-bearing | platforms | clusters | top mined edge-case keywords (items) |
|---|---|---|---|---|---|---|---|---|
| P01 | linear pipeline with typed hand-offs | spine | 744 | 0 / 0 / 744 | 239 | 32 | science 242, automation 185, orchestration 163, consumer-creative 146, agentic 8 |  |
| P38 | event -> guard -> act (automation rule) | trigger | 350 | 307 / 43 / 0 | 16 | 20 | automation 124, orchestration 119, consumer-creative 77, agentic 30 | state store / memory 70; validate / schema 68; notify (slack/email/chat) 52; continue-on-error / fail-fast off 18 |
| P08 | guard -> act (filter before an effect) | branch | 229 | 229 / 0 / 0 | 53 | 14 | consumer-creative 101, automation 66, science 57, agentic 3, orchestration 2 | state store / memory 40; notify (slack/email/chat) 35; batch / chunk size 24; backoff/delay between tries 14 |
| P54 | decompose into called sub-workflows (call by hash) | compose | 217 | 192 / 25 / 0 | 11 | 21 | consumer-creative 131, orchestration 40, automation 21, science 20, agentic 5 | cancel 39; notify (slack/email/chat) 28; state store / memory 24; backoff/delay between tries 13 |
| P27 | error route -> notify / cleanup (error workflow) | failure | 214 | 173 / 41 / 0 | 108 | 24 | science 81, orchestration 61, automation 59, agentic 13 | cancel 19; validate / schema 19; state store / memory 13; continue-on-error / fail-fast off 10 |
| P05 | prompt chain with typed hand-offs | spine | 212 | 212 / 0 / 0 | 42 | 25 | automation 159, science 19, orchestration 16, agentic 16, consumer-creative 2 | state store / memory 13; default / fallback value 7; notify (slack/email/chat) 7; batch / chunk size 6 |
| P45 | capped tool loop (agent node + parent-side verify) | agentic | 209 | 201 / 8 / 0 | 44 | 26 | agentic 100, automation 99, first-party 10 | state store / memory 116; cache 66; validate / schema 39; default / fallback value 31 |
| P07 | router by kind (judged classify, then dispatch) | branch | 193 | 193 / 0 / 0 | 35 | 32 | automation 105, agentic 66, consumer-creative 15, science 5, orchestration 2 | state store / memory 45; default / fallback value 32; validate / schema 28; notify (slack/email/chat) 25 |
| P06 | retrieve -> generate (untrusted context) | spine | 172 | 172 / 0 / 0 | 36 | 26 | automation 123, orchestration 18, agentic 16, science 15 | state store / memory 63; notify (slack/email/chat) 18; validate / schema 13; cancel 9 |
| P37 | webhook -> validate -> act -> respond | trigger | 163 | 116 / 47 / 0 | 22 | 16 | automation 145, agentic 13, consumer-creative 5 | state store / memory 9; notify (slack/email/chat) 8; cache 8; default / fallback value 3 |
| P36 | scheduled batch (schedule -> read -> process -> write) | trigger | 154 | 150 / 4 / 0 | 21 | 15 | automation 92, orchestration 39, consumer-creative 21, agentic 2 | validate / schema 22; state store / memory 12; continue-on-error / fail-fast off 6; notify (slack/email/chat) 4 |
| P20 | generate -> verify -> retry (bounded) | loop | 144 | 144 / 0 / 0 | 30 | 28 | agentic 103, automation 36, consumer-creative 5 | state store / memory 58; validate / schema 42; default / fallback value 35; cancel 30 |
| P42 | cross-run state: seen-set / cursor / counter | state | 144 | 0 / 144 / 0 | 17 | 19 | automation 120, agentic 24 |  |
| P32 | approval gate before an effect (timeout routing) | human | 135 | 135 / 0 / 0 | 15 | 24 | consumer-creative 55, orchestration 40, agentic 24, automation 16 | approve / reject 32; notify (slack/email/chat) 25; cancel 18; default / fallback value 9 |
| P21 | poll until ready (wait + check, timeout) | loop | 115 | 115 / 0 / 0 | 41 | 9 | automation 40, orchestration 39, consumer-creative 34, agentic 2 | state store / memory 31; backoff/delay between tries 31; batch / chunk size 26; notify (slack/email/chat) 16 |
| P29 | finally / completion hook (teardown always runs) | failure | 112 | 39 / 73 / 0 | 89 | 9 | science 72, orchestration 39, agentic 1 | validate / schema 10; cancel 8; continue-on-error / fail-fast off 5; state store / memory 4 |
| P12 | map -> code reduce (for-each, typed coverage) | fan | 109 | 109 / 0 / 0 | 9 | 12 | automation 53, consumer-creative 52, orchestration 3, agentic 1 | batch / chunk size 23; state store / memory 19; notify (slack/email/chat) 12; cancel 6 |
| P34 | durable delay / debounce -> re-check -> act | async | 109 | 82 / 27 / 0 | 3 | 11 | consumer-creative 74, automation 23, orchestration 11, agentic 1 | backoff/delay between tries 70; state store / memory 14; notify (slack/email/chat) 10; cancel 5 |
| P10 | human menu dispatch (choice -> branches, optional repeat) | branch | 108 | 108 / 0 / 0 | 7 | 13 | consumer-creative 82, automation 16, agentic 10 | notify (slack/email/chat) 57; cancel 32; pagination / cursor 22; checksum / integrity 21 |
| P33 | wait for signal / external event (with timeout) | async | 108 | 92 / 16 / 0 | 24 | 6 | consumer-creative 52, automation 35, orchestration 21 | backoff/delay between tries 25; state store / memory 23; timeout 20; notify (slack/email/chat) 14 |
| P03 | extract -> normalise -> validate (model reading, code parsing) | spine | 106 | 106 / 0 / 0 | 22 | 18 | automation 73, science 15, agentic 9, orchestration 6, consumer-creative 3 | state store / memory 10; default / fallback value 9; notify (slack/email/chat) 6; batch / chunk size 4 |
| P43 | conversational session (turn with bounded memory) | state | 104 | 10 / 94 / 0 | 11 | 15 | automation 78, agentic 26 | state store / memory 3; approve / reject 3; cancel 2; notify (slack/email/chat) 1 |
| P14 | scatter -> parallel branches -> gather | fan | 100 | 100 / 0 / 0 | 25 | 20 | automation 47, science 27, agentic 16, first-party 8, orchestration 1, consumer-creative 1 | state store / memory 10; validate / schema 6; lock / concurrency 5; pagination / cursor 3 |
| P26 | retry with backoff / adaptive retry | failure | 96 | 0 / 96 / 0 | 90 | 4 | science 94, agentic 2 |  |
| P55 | ask -> validate -> use (human input as untrusted data) | human | 91 | 91 / 0 / 0 | 12 | 15 | consumer-creative 64, automation 15, agentic 12 | notify (slack/email/chat) 18; pagination / cursor 16; cancel 9; checksum / integrity 7 |
| P41 | build -> test -> gate -> release (CI stage barrier) | trigger | 88 | 28 / 0 / 60 | 0 | 2 | orchestration 88 | cancel 8; retry 5; backoff/delay between tries 2; validate / schema 2 |
| P04 | draft -> check -> deliver (generated content before an effect) | spine | 75 | 75 / 0 / 0 | 19 | 19 | automation 47, science 15, consumer-creative 6, orchestration 5, agentic 2 | notify (slack/email/chat) 16; state store / memory 6; batch / chunk size 3; cache 3 |
| P56 | media generation chain (tool bindings) | spine | 68 | 68 / 0 / 0 | 1 | 2 | consumer-creative 67, science 1 | batch / chunk size 21; validate / schema 18; cache 6; default / fallback value 3 |
| P13 | batched extract (map with a judge body, id echo) | fan | 66 | 66 / 0 / 0 | 6 | 18 | automation 38, agentic 24, consumer-creative 2, first-party 2 | state store / memory 17; batch / chunk size 14; default / fallback value 7; notify (slack/email/chat) 7 |
| P40 | run admission policy (single / queue / restart / parallel) | trigger | 56 | 0 / 56 / 0 | 0 | 1 | consumer-creative 56 |  |
| P53 | sub-workflow per item (map over call) | compose | 53 | 53 / 0 / 0 | 8 | 20 | consumer-creative 29, agentic 13, automation 9, orchestration 2 | state store / memory 9; cancel 9; batch / chunk size 6; validate / schema 6 |
| P46 | supervisor -> agents as typed tools | agentic | 52 | 41 / 11 / 0 | 16 | 13 | agentic 31, automation 21 | state store / memory 14; lock / concurrency 6; validate / schema 6; default / fallback value 5 |
| P51 | summarise-map-reduce / context compaction | agentic | 47 | 22 / 2 / 23 | 8 | 22 | agentic 36, automation 9, orchestration 1, consumer-creative 1 | default / fallback value 5; state store / memory 4; cancel 2; lock / concurrency 2 |
| P28 | fallback on error (alternative path, rejoin) | failure | 44 | 44 / 0 / 0 | 12 | 14 | automation 23, agentic 15, orchestration 6 | notify (slack/email/chat) 10; state store / memory 7; validate / schema 7; batch / chunk size 5 |
| P25 | bounded state machine (cycles with several entries) | loop | 43 | 7 / 36 / 0 | 11 | 5 | automation 40, agentic 3 | state store / memory 2; default / fallback value 1; lock / concurrency 1 |
| P47 | model-written code in a sandbox -> run -> check | agentic | 41 | 10 / 31 / 0 | 8 | 17 | agentic 31, first-party 10 | lock / concurrency 6; default / fallback value 6; state store / memory 6; validate / schema 5 |
| P19 | planned fan-out (wide) / bounded expansion (plan) | fan | 33 | 0 / 33 / 0 | 17 | 12 | science 17, agentic 15, first-party 1 |  |
| P15 | fan-in aggregate / report | fan | 31 | 31 / 0 / 0 | 3 | 4 | orchestration 21, automation 7, science 2, first-party 1 | retry 5; backoff/delay between tries 2; default / fallback value 2; batch / chunk size 1 |
| P44 | bounded stream consumer / partial outputs | state | 27 | 0 / 27 / 0 | 2 | 8 | automation 16, agentic 11 |  |
| P39 | poll -> diff -> notify (cursor in state) | trigger | 26 | 25 / 1 / 0 | 11 | 5 | consumer-creative 11, orchestration 9, automation 4, agentic 2 | notify (slack/email/chat) 4; lock / concurrency 3; validate / schema 3; state store / memory 3 |
| P09 | judge -> confidence gate -> review queue (escalate, never guess) | branch | 20 | 20 / 0 / 0 | 0 | 10 | automation 10, agentic 6, consumer-creative 4 | notify (slack/email/chat) 4; state store / memory 3; cancel 3; default / fallback value 2 |
| P57 | caller-supplied action list (typed plan fragment) | compose | 20 | 0 / 20 / 0 | 0 | 2 | consumer-creative 19, agentic 1 |  |
| P35 | interrupt -> resume inside an agent node | async | 15 | 0 / 15 / 0 | 5 | 12 | agentic 15 |  |
| P50 | evidence -> hypothesis -> check (diagnosis) / env session | agentic | 12 | 0 / 3 / 9 | 2 | 10 | agentic 12 |  |
| P22 | loop until condition / dry (convergence cap) | loop | 10 | 10 / 0 / 0 | 0 | 1 | consumer-creative 10 | default / fallback value 1; state store / memory 1 |
| P31 | checkpoint -> resume / continue-as-new | failure | 9 | 5 / 4 / 0 | 3 | 6 | agentic 5, orchestration 4 | state store / memory 1 |
| P48 | guardrail tripwire (parallel check aborts) | agentic | 6 | 0 / 6 / 0 | 2 | 4 | agentic 6 |  |
| P02 | fetch -> transform -> write (sync / ETL) | spine | 0 | 0 / 0 / 0 | 0 | 0 |  |  |
| P16 | dedupe by identity (blocking + pairwise judge + union-find) | fan | 0 | 0 / 0 / 0 | 0 | 0 |  |  |
| P17 | reconcile two sources (join, diff, classify discrepancies) | fan | 0 | 0 / 0 / 0 | 0 | 0 |  |  |
| P18 | best-of-N / sectioning with a verifier | fan | 0 | 0 / 0 / 0 | 0 | 0 |  |  |
| P23 | paginate with a cursor | loop | 0 | 0 / 0 / 0 | 0 | 0 |  |  |
| P30 | saga: steps with compensation | failure | 0 | 0 / 0 / 0 | 0 | 0 |  |  |
| P49 | verify panel (independent verifiers vote) | agentic | 0 | 0 / 0 / 0 | 0 | 0 |  |  |

| cluster | platform | items | flat | hier | refused | L0 only | median / max patterns |
|---|---|---|---|---|---|---|---|
| agentic | ag2 | 8 | 3 | 1 | 4 | 0 | 5 / 6 |
| agentic | agno | 10 | 8 | 2 | 0 | 0 | 4 / 8 |
| agentic | anthropic | 12 | 8 | 4 | 0 | 0 | 3 / 6 |
| agentic | autogen | 14 | 7 | 1 | 6 | 0 | 3 / 6 |
| agentic | burr | 8 | 8 | 0 | 0 | 0 | 3 / 5 |
| agentic | camel | 3 | 1 | 2 | 0 | 0 | 8 / 8 |
| agentic | crewai | 13 | 13 | 0 | 0 | 0 | 4 / 5 |
| agentic | dspy | 10 | 7 | 3 | 0 | 0 | 4 / 10 |
| agentic | google-adk | 15 | 10 | 2 | 3 | 0 | 3 / 7 |
| agentic | haystack | 8 | 6 | 1 | 1 | 0 | 3 / 8 |
| agentic | inngest-agentkit | 7 | 4 | 2 | 1 | 0 | 4 / 8 |
| agentic | langgraph | 18 | 14 | 0 | 4 | 0 | 3 / 5 |
| agentic | llamaindex-workflows | 10 | 9 | 0 | 1 | 0 | 4 / 5 |
| agentic | mastra | 8 | 5 | 3 | 0 | 0 | 5 / 6 |
| agentic | metagpt | 4 | 3 | 0 | 1 | 0 | 5 / 5 |
| agentic | openai-agents | 18 | 12 | 2 | 4 | 0 | 3 / 7 |
| agentic | openai-swarm | 6 | 3 | 0 | 3 | 0 | 3 / 3 |
| agentic | pydantic-graph | 9 | 6 | 3 | 0 | 0 | 5 / 6 |
| agentic | semantic-kernel | 9 | 4 | 0 | 5 | 0 | 4 / 5 |
| agentic | smolagents | 6 | 4 | 2 | 0 | 0 | 4 / 8 |
| agentic | strands | 11 | 9 | 2 | 0 | 0 | 5 / 7 |
| automation | activepieces | 40 | 34 | 6 | 0 | 0 | 4 / 7 |
| automation | coze | 22 | 22 | 0 | 0 | 3 | 1 / 2 |
| automation | dify | 50 | 45 | 5 | 0 | 2 | 3 / 7 |
| automation | flowise | 51 | 44 | 7 | 0 | 0 | 3 / 7 |
| automation | langflow | 27 | 27 | 0 | 0 | 0 | 4 / 5 |
| automation | n8n | 135 | 41 | 94 | 0 | 4 | 7 / 15 |
| automation | node-red | 45 | 22 | 7 | 16 | 2 | 3 / 11 |
| automation | zapier | 25 | 22 | 3 | 0 | 0 | 4 / 6 |
| consumer-creative | apple-shortcuts | 79 | 36 | 43 | 0 | 2 | 6 / 11 |
| consumer-creative | comfyui | 73 | 72 | 1 | 0 | 6 | 1 / 6 |
| consumer-creative | home-assistant | 96 | 64 | 32 | 0 | 1 | 4 / 9 |
| consumer-creative | ifttt | 25 | 25 | 0 | 0 | 0 | 1 / 2 |
| first-party | claude-code-workflows | 10 | 10 | 0 | 0 | 0 | 3 / 4 |
| orchestration | airflow | 88 | 88 | 0 | 0 | 30 | 1 / 5 |
| orchestration | argo | 55 | 55 | 0 | 0 | 29 | 0 / 2 |
| orchestration | dagster | 25 | 25 | 0 | 0 | 6 | 1 / 5 |
| orchestration | github-actions | 85 | 85 | 0 | 0 | 2 | 2 / 5 |
| orchestration | gitlab-ci | 41 | 37 | 4 | 0 | 0 | 3 / 7 |
| orchestration | kubeflow | 30 | 30 | 0 | 0 | 28 | 0 / 2 |
| orchestration | prefect | 18 | 18 | 0 | 0 | 11 | 0 / 2 |
| orchestration | tekton | 20 | 20 | 0 | 0 | 10 | 0 / 2 |
| orchestration | temporal | 34 | 34 | 0 | 0 | 5 | 1 / 3 |
| science | cwl | 45 | 45 | 0 | 0 | 27 | 0 / 1 |
| science | galaxy | 60 | 60 | 0 | 0 | 16 | 1 / 3 |
| science | nextflow | 25 | 25 | 0 | 0 | 6 | 2 / 5 |
| science | nf-core | 72 | 70 | 2 | 0 | 0 | 3 / 7 |
| science | snakemake | 40 | 40 | 0 | 0 | 14 | 1 / 4 |
| science | wdl | 36 | 36 | 0 | 0 | 29 | 0 / 2 |

| refusal | items | platforms |
|---|---|---|
| unsupported:interactive-dashboard-state(census-criterion) | 14 | node-red 14 |
| unsupported:interactive-dashboard-state | 2 | node-red 2 |
| unsupported:by-design-group-chat | 13 | ag2 3, autogen 3, inngest-agentkit 1, langgraph 1, metagpt 1, semantic-kernel 4 |
| unsupported:by-design-full-history-handoff | 20 | ag2 1, autogen 3, google-adk 3, haystack 1, langgraph 3, llamaindex-workflows 1, openai-agents 4, openai-swarm 3, semantic-kernel 1 |

Cross-platform structural clustering (census distance, category|effects labels, theta 0.35, 5-40 nodes, 776 items, 54115 of 300700 pairs past the lower bound): 19 families of >= 3, 3 spanning >= 3 platforms.

| size | platforms | oracle | top patterns | sample |
|---|---|---|---|---|
| 17 | cwl 8, galaxy 1, snakemake 2, wdl 6 | 7 | P01 15/17; P05 2/17; P04 2/17; P54 1/17 | cwl:Barski-lab/workflows/devel/xenbase/xenbase-rnaseq-pe.cwl |
| 7 | airflow 1, argo 5, tekton 1 | 1 | P01 4/7; P28 2/7; P27 1/7 | airflow:apache-airflow/example_dags/example_python_decorator#example_python_decorator |
| 5 | cwl 1, galaxy 1, wdl 3 | 4 | P01 1/5 | cwl:workflowhub/549 |
| 13 | airflow 11, temporal 2 | 13 | P01 13/13; P21 5/13; P33 2/13 | airflow:apache-airflow-providers-amazon/tests/system/amazon/aws/example_s3_to_sql#example_s3_to_sql |
| 11 | argo 1, kubeflow 10 | 10 | P01 2/11 | argo:parameter-aggregation-dag |
| 9 | airflow 1, github-actions 8 | 0 | P01 9/9; P38 6/9; P36 2/9; P41 2/9 | airflow:apache-airflow-providers-common-sql/src/airflow/providers/common/sql/example_dags/example_analytics#example_analytics |
| 3 | nextflow 2, nf-core 1 | 3 | P26 3/3; P01 2/3; P05 1/3; P27 1/3 | nextflow:workflowhub/444 |
| 6 | langflow 6 | 0 | P37 5/6; P43 5/6; P45 4/6; P05 4/6 | langflow:blog-writer |
| 5 | cwl 5 | 0 | P54 5/5; P01 4/5 | cwl:workflowhub/1868 |
| 4 | flowise 4 | 0 | P05 4/4; P45 4/4; P06 3/4 | flowise:agentflows-customer-support-team-agents |
| 4 | flowise 4 | 0 | P06 4/4; P05 4/4; P01 4/4; P42 1/4 | flowise:chatflows-context-chat-engine |
| 4 | langflow 4 | 0 | P45 4/4; P37 4/4; P43 4/4; P42 2/4 | langflow:custom-component-generator |
| 4 | wdl 4 | 4 | P01 3/4 | wdl:broadinstitute/warp/beta-pipelines/broad/somatic/single_sample/targeted/TargetedSomaticSingleSample.wdl |
| 4 | comfyui 4 | 0 | P56 4/4; P01 1/4 | comfyui:Comfy-Org-workflow_templates-templates-audio_stable_audio_example.json |
| 4 | home-assistant 4 | 0 | P08 4/4; P34 4/4; P36 2/4; P38 2/4 | home-assistant:geekofweek/homeassistant/old_ha_setup/automation/roomba.yaml#14 |
| 3 | flowise 3 | 0 | P05 3/3; P45 3/3; P42 3/3 | flowise:chatflows-conversational-agent |
| 3 | airflow 3 | 3 | P21 3/3; P01 3/3 | airflow:apache-airflow-providers-amazon/tests/system/amazon/aws/example_athena#example_athena |
| 3 | github-actions 3 | 0 | P38 3/3; P36 3/3; P01 3/3; P41 3/3 | github-actions:aio-libs/multidict/.github/workflows/ci.yml |
| 3 | claude-code-workflows 3 | 0 | P45 3/3; P14 3/3; P47 3/3; P19 1/3 | claude-code-workflows:claude-session/workflows/scripts/c0-preflight-wf_d35b46dd-974.js |

| rule (category:branch) | assigned | items | nodes |
|---|---|---|---|
| condition:code-branch | L0:if | 352 | 3053 |
| human:menu | P10 | 84 | 1652 |
| subworkflow:call | P54 | 196 | 1608 |
| condition:human-then-branch | P10 | 80 | 1234 |
| human:output-display | L0:notify | 68 | 1179 |
| model:media-model | P56 | 68 | 1154 |
| trigger:trigger-event | P38 | 319 | 1067 |
| condition:guard-before-effect | P08 | 229 | 991 |
| trigger:trigger-as-input | L0:input | 442 | 919 |
| condition:code-guard | L0:guard | 138 | 873 |
| human:ask-input | P55 | 80 | 833 |
| model:model-chain | P05 | 212 | 625 |
| wait:wait-in-loop-or-sensor | P21 | 119 | 588 |
| trigger:trigger-schedule | P36 | 160 | 583 |
| human:approval-typed | P32 | 67 | 537 |
| model:agent-with-tools | P45 | 201 | 535 |
| condition:code-branch-in-loop-body | L0:if | 73 | 459 |
| condition:menu-in-loop-body | P10 | 37 | 457 |
| wait:wait-for-event | P33 | 80 | 405 |
| human:human-gate-before-effect | P32 | 70 | 384 |
| condition:cycle-with-model | P20 | 88 | 370 |
| model:classify-then-route | P07 | 153 | 357 |
| loop:for-each(default) | P12 | 112 | 315 |
| condition:loop-exit | P13 | 81 | 282 |
| model:read-then-model | P06 | 126 | 230 |
| merge:branch-reconverge | L0:join | 61 | 227 |
| condition:trigger-guard | P38 | 103 | 221 |
| trigger:trigger-webhook | P37 | 122 | 219 |
| error-handler:finally | P29 | 39 | 215 |
| loop:loop-with-wait | P21 | 67 | 214 |
| model:model-then-code | P03 | 106 | 203 |
| merge:gather | P14 | 102 | 184 |
| code:error-edge-to-handler | P27 | 54 | 183 |
| wait:durable-delay | P34 | 80 | 171 |
| error-handler:error-route | P27 | 127 | 170 |
| condition:judged-branch | P07 | 91 | 160 |
| model:single-judgment | L0:judge | 93 | 157 |
| model:embedding-retrieval | P06 | 68 | 128 |
| loop:interactive-repeat | P10 | 49 | 126 |
| model:model-then-effect | P04 | 75 | 109 |
| subworkflow:call-per-item | P53 | 53 | 106 |
| model:model-in-check-cycle | P20 | 53 | 100 |
| condition:cycle-with-wait | P21 | 17 | 91 |
| loop:map-with-judge-body | P13 | 66 | 89 |
| merge:ci-stage-barrier | P41 | 28 | 80 |
| action:error-edge-to-alternative | P28 | 23 | 78 |
| condition:judged-branch-in-loop-body | P07 | 39 | 63 |
| subworkflow:workflow-as-tool | P46 | 22 | 62 |
| merge:wide-fan-in | P15 | 32 | 59 |
| error-handler:error-route(default) | P27 | 22 | 50 |
| wait:delay-then-recheck | P34 | 26 | 49 |
| action:error-edge-to-handler | P27 | 18 | 44 |
| loop:model-loop-with-check | P20 | 29 | 41 |
| model:supervisor-agent | P46 | 19 | 35 |
| human:judge-gate-then-human | P09 | 20 | 33 |
| trigger:trigger-poll | P39 | 25 | 32 |
| loop:loop-until | P22 | 10 | 29 |
| condition:unstructured-cycle | P25 | 7 | 27 |
| human:ask-input(default) | P55 | 21 | 26 |
| model:summariser | P51 | 22 | 25 |
| model:code-writing-model | P47 | 10 | 23 |
| human:human-as-signal | P33 | 14 | 21 |
| error-handler:handler-rejoins | P28 | 15 | 17 |
| human:chat-turn | P43 | 10 | 13 |
| loop:loop-over-call | P53 | 10 | 11 |
| code:error-edge-to-alternative | P28 | 8 | 10 |
| loop:continue-as-new | P31 | 5 | 6 |
| transform:error-edge-to-alternative | P28 | 3 | 4 |
| condition:cycle-human-menu-machine | P25 | 1 | 2 |
