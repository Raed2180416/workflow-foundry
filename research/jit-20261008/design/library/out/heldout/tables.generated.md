### T1 per platform and pooled (strict = `yes` only)

| platform | n | yes / partly / no | strict | Wilson 95% | lenient (yes + partly) | Wilson 95% | pooled without this platform |
|---|---|---|---|---|---|---|---|
| Windmill | 10 | 10 / 0 / 0 | 100% | 72.2–100 | 100% | 72.2–100 | 97.5% |
| Kestra | 10 | 10 / 0 / 0 | 100% | 72.2–100 | 100% | 72.2–100 | 97.5% |
| Power Automate | 10 | 10 / 0 / 0 | 100% | 72.2–100 | 100% | 72.2–100 | 97.5% |
| AWS Step Functions | 10 | 10 / 0 / 0 | 100% | 72.2–100 | 100% | 72.2–100 | 97.5% |
| Azure Logic Apps | 10 | 9 / 1 / 0 | 90% | 59.6–98.2 | 100% | 72.2–100 | 100% |
| **pooled** | **50** | **49 / 1 / 0** | **98%** | **89.5–99.6** | 100% | 92.9–100 | |

### T2 pooled sensitivities

| reading | x / n | % | Wilson 95% |
|---|---|---|---|
| strict (yes only): the J1 statistic | 49 / 50 | 98% | 89.5–99.6 |
| lenient (yes + partly) | 50 / 50 | 100% | 92.9–100 |
| non-trivial workflows only (size ≥ 3 steps by the mechanical count), strict | 38 / 39 | 97.4% | 86.8–99.5 |
| S3: yes and no gap that needs a vocabulary change (construct, field or binding, lacks yes or partial) | 33 / 50 | 66% | 52.2–77.6 |
| S4: yes and no gap that needs a construct or a field (bindings excluded) | 34 / 50 | 68% | 54.2–79.2 |

### T3 in-sample comparators (sonnet-60 hand labels, revision-1 strata, post-stratified, strict, dashboard app = refusal)

| in-sample subset | labels | corpus items | coverage | Wilson 95% at Kish n |
|---|---|---|---|---|
| all five clusters (the comparator: 93.6%) | 60 | 1549 | 93.6% | 82.3–97.9 (n 43.8) |
| non-agentic clusters (automation, orchestration, science, consumer-creative) | 48 | 1342 | 97.4% | 86–99.5 (n 35.7) |
| automation + orchestration (the nearest to the five J1 platforms) | 24 | 791 | 95.5% | 75.6–99.3 (n 17.9) |
| automation + orchestration, dashboard app read as explained | 24 | 791 | 100% | 82.3–100 (n 17.9) |
| agentic | 12 | 207 | 69.6% | 38.9–89.2 (n 9.7) |

### T4a gaps that would need a vocabulary change (lacks = yes or partial; counts are workflows, of 50)

| tag | what the vocabulary lacks | workflows | platforms | kind | class | lacks |
|---|---|---|---|---|---|---|
| `clock-or-random` | wall clock or randomness in a pure step | 11 | Kestra, Azure Logic Apps, Power Automate, AWS Step Functions, Windmill | field | leaves | partial |
| `unbounded-cycle` | loop, poll or pagination with no literal cap (time limit only, or none) | 5 | Azure Logic Apps, Power Automate, AWS Step Functions, Windmill | rewrite | leaves | partial |
| `map-failure-policy` | per-item failure policy on map (skip_failures, continue past a failed item) | 3 | Windmill | field | leaves | partial |
| `run-status-end` | explicit end of the run with a chosen status and message (Terminate, Fail) | 2 | Azure Logic Apps, Power Automate | field | leaves | partial |
| `approval-callback-url` | approval answered through a callback URL in another system | 1 | Windmill | binding | leaves | partial |
| `approval-no-timeout` | approval or wait with no timeout in the definition | 1 | Power Automate | rewrite | leaves | partial |
| `approval-quorum` | approval with several approvers and a per-approver response list | 1 | Power Automate | field | leaves | partial |
| `durable-delay-until` | wait until an absolute caller-supplied timestamp, any length | 1 | Azure Logic Apps | field | leaves | partial |
| `heartbeat-lease` | concurrent heartbeat or lease renewal cancelled through a shared flag | 1 | Azure Logic Apps | construct | stops | yes |
| `image-input` | a model read over image inputs | 1 | Windmill | field | leaves | partial |
| `multi-entry` | several independent triggers into one body | 1 | Kestra | idiom | leaves | partial |

### T4b gaps recorded that need no vocabulary change (rewrites into existing constructs, L3 binding detail, latent defects of the definition)

| tag | what it is | workflows | platforms | kind |
|---|---|---|---|---|
| `external-wait-sync` | start an external job and wait for completion (.sync, polling plugin) | 3 | Kestra, AWS Step Functions | binding |
| `effects-in-code` | effects (network, database) inside a code step | 2 | Kestra | rewrite |
| `injection-defect` | untrusted input concatenated into SQL or a shell string (a defect the binding removes) | 2 | Kestra, Windmill | binding |
| `parameter-binding` | connector or tool specifics (pagination policy, sessions, retry settings) | 2 | Azure Logic Apps, AWS Step Functions | binding, idiom |
| `shared-workspace-or-accumulator` | shared mutable workspace or external accumulator between tasks | 2 | Kestra | rewrite |
| `b2b-artifact-binding` | integration-account decode, validate or transform bound to artifacts | 1 | Azure Logic Apps | binding |
| `batch-positional-judge` | a batch model read returning free text aligned by position | 1 | Windmill | rewrite |
| `code-router-with-none` | router by kind decided in code with an unsupported branch | 1 | AWS Step Functions | idiom |
| `keyed-cross-run-state` | cross-run cursor in a keyed state map | 1 | Windmill | idiom |
| `parallel-effects-no-compensation` | parallel effects with no compensation if one fails | 1 | AWS Step Functions | idiom |
| `stream-consumer-batch` | bounded batch read of a topic with a broker-held offset | 1 | Kestra | binding |
| `typed-resume-input` | a human gate that returns a typed answer on resume (Pause with onResume) | 1 | Kestra | binding |
| `validation-in-code` | validation of an input in code before any effect | 1 | Windmill | idiom |

### T5 needs profile per platform (hand labels)

| platform | n | trivial (≤ 2 steps) | patterns per workflow: median / max / over 5 | most used patterns | most used L0 rows | nearest in-corpus platforms by pattern-share cosine (census) |
|---|---|---|---|---|---|---|
| Windmill | 10 | 5 | 2 / 6 / 1 | P38 8, P08 3, P12 3, P13 2, P03 1, P04 1 | effect 12, done 10, step 9, if 7, trigger.event 6, input 5 | github-actions (orchestration) 0.698; autogen (agentic) 0.691; zapier (automation) 0.636 |
| Kestra | 10 | 0 | 4 / 7 / 2 | P36 8, P27 6, P08 5, P01 4, P04 3, P42 3 | effect 20, done 10, input 8, trigger.schedule 8, step 7, route.error 6 | dagster (orchestration) 0.556; activepieces (automation) 0.492; node-red (automation) 0.469 |
| Power Automate | 10 | 0 | 3 / 6 / 1 | P01 5, P12 4, P27 4, P04 3, P08 3, P38 3 | effect 31, step 13, done 10, input 8, if 6, map 6 | activepieces (automation) 0.516; github-actions (orchestration) 0.498; n8n (automation) 0.409 |
| AWS Step Functions | 10 | 1 | 2 / 5 / 0 | P08 5, P26 5, P01 3, P38 3, P04 2, P07 2 | effect 24, done 10, input 8, if 7, retry 5, map 3 | nextflow (science) 0.658; zapier (automation) 0.537; nf-core (science) 0.518 |
| Azure Logic Apps | 10 | 5 | 3 / 4 / 0 | P39 5, P12 3, P01 2, P02 2, P04 2, P27 2 | effect 12, done 10, trigger.poll 6, step 5, if 3, input 3 | ifttt (consumer-creative) 0.713; dagster (orchestration) 0.55; activepieces (automation) 0.375 |

### T6 L1 patterns used by the 50 workflows, with the corpus census support (candidate-generator counts)

| pattern | J1 workflows | corpus items (census) |
|---|---|---|
| P08 | 17 | 229 |
| P38 | 16 | 364 |
| P01 | 14 | 0 |
| P27 | 13 | 215 |
| P12 | 12 | 112 |
| P04 | 11 | 75 |
| P36 | 11 | 164 |
| P39 | 7 | 26 |
| P02 | 5 | 0 |
| P26 | 5 | 96 |
| P42 | 5 | 157 |
| P21 | 4 | 120 |
| P32 | 4 | 135 |
| P37 | 3 | 169 |
| P44 | 3 | 39 |
| P03 | 2 | 106 |
| P07 | 2 | 193 |
| P13 | 2 | 66 |
| P14 | 2 | 102 |
| P15 | 1 | 32 |
| P17 | 1 | 0 |
| P22 | 1 | 10 |
| P25 | 1 | 49 |
| P29 | 1 | 112 |
| P33 | 1 | 108 |
| P34 | 1 | 118 |
| P55 | 1 | 91 |

### T7 L0 rows used (workflows naming the row)

effect 99 · done 50 · step 37 · input 32 · if 28 · map 17 · route.error 15 · trigger.event 12 · trigger.schedule 11 · guard 9 · state 8 · trigger.poll 7 · trigger.webhook 6 · for 5 · retry 5 · wait.delay 5 · approve 4 · judge 4 · stream 2 · wait.signal 2 · finally 1

### A1 every label (strict reading: yes only)

| # | platform | workflow | size | explained | L1 patterns | gap tags (class) |
|---|---|---|---|---|---|---|
| 1 | Windmill | 75 | 1 | yes | P38 P42 | unbounded-cycle, keyed-cross-run-state, clock-or-random |
| 2 | Windmill | 61 | 1 | yes | P38 | – |
| 3 | Windmill | 72 | 1 | yes | P38 | – |
| 4 | Windmill | 23 | 6 | yes | P38 P08 P12 | map-failure-policy, injection-defect |
| 5 | Windmill | 83 | 14 | yes | P38 P08 P32 P55 | approval-callback-url, validation-in-code |
| 6 | Windmill | 65 | 1 | yes | P44 P38 | – |
| 7 | Windmill | 30 | 4 | yes | P12 P08 | map-failure-policy |
| 8 | Windmill | 35 | 3 | yes | P39 P13 | batch-positional-judge |
| 9 | Windmill | 82 | 19 | yes | P38 P13 P14 P03 P12 P04 | image-input, map-failure-policy, clock-or-random |
| 10 | Windmill | 59 | 1 | yes | P38 | – |
| 11 | Kestra | kafka-schema-registry-compatibility-mode-drift-guard | 40 | yes | P36 P08 P12 P17 P32 P42 P27 | shared-workspace-or-accumulator, typed-resume-input |
| 12 | Kestra | stripe-to-crm-sync | 8 | yes | P36 P02 P42 P01 P04 | effects-in-code, clock-or-random |
| 13 | Kestra | postgres-connection-saturation-guard | 10 | yes | P36 P38 P08 P27 | multi-entry, clock-or-random |
| 14 | Kestra | mistral-agent-workflow-run | 3 | yes | P21 P27 P04 | external-wait-sync |
| 15 | Kestra | codedeploy-failed-deployment-sentinel | 8 | yes | P36 P08 P27 | injection-defect |
| 16 | Kestra | github-actions-unpinned-action-audit | 10 | yes | P36 P01 P39 P42 P08 P27 | shared-workspace-or-accumulator, effects-in-code |
| 17 | Kestra | github-search | 3 | yes | P01 | – |
| 18 | Kestra | csv-duckdb-slack | 3 | yes | P36 P04 | – |
| 19 | Kestra | kestra-flow-failure-rate-gate | 8 | yes | P36 P08 P27 | clock-or-random |
| 20 | Kestra | auditlogs-to-bigquery | 5 | yes | P36 P44 P02 P01 | stream-consumer-batch |
| 21 | Power Automate | o365groups-graph-create-group | 8 | yes | P01 P12 P08 | – |
| 22 | Power Automate | Try-Catch-Finally | 3 | yes | P27 P29 | – |
| 23 | Power Automate | exception-handing-in-do-until-loop | 10 | yes | P22 P27 | clock-or-random, run-status-end |
| 24 | Power Automate | sharepoint-group-creation-with-user-added | 6 | yes | P01 | – |
| 25 | Power Automate | site-design-homepage | 8 | yes | P38 P01 | – |
| 26 | Power Automate | new-employee-tip-of-the-day | 14 | yes | P36 P12 P08 P42 P04 | – |
| 27 | Power Automate | sharepoint-set-item-level-permissions | 11 | yes | P01 P12 P27 | – |
| 28 | Power Automate | request-review-and-approval-for-a-selected-file | 40 | yes | P38 P32 P21 P27 P15 P04 | unbounded-cycle, approval-quorum |
| 29 | Power Automate | teams-invites-via-graph-api | 16 | yes | P38 P32 P08 P01 | approval-no-timeout |
| 30 | Power Automate | teams-adaptive-card-reminders-from-lists | 5 | yes | P36 P12 P04 | clock-or-random |
| 31 | AWS Step Functions | inventory-management-sam | 11 | yes | P08 P14 | clock-or-random, parallel-effects-no-compensation |
| 32 | AWS Step Functions | s3-sfn-lambda-bedrock | 6 | yes | P38 P07 | code-router-with-none |
| 33 | AWS Step Functions | batch-lambda-cdk/batch_lambda_cdk | 2 | yes | P01 P33 | external-wait-sync |
| 34 | AWS Step Functions | resource-configuration-backup-sam | 10 | yes | P12 P26 P02 P08 | unbounded-cycle, parameter-binding, clock-or-random |
| 35 | AWS Step Functions | web-contact-form-processor-tf | 7 | yes | P37 P07 P26 P08 P04 | clock-or-random |
| 36 | AWS Step Functions | synchronous-job | 3 | yes | P26 P27 P04 | external-wait-sync |
| 37 | AWS Step Functions | text-processing-sqs-express | 4 | yes | P38 P01 | – |
| 38 | AWS Step Functions | support-notifications-cdk/typescript | 4 | yes | P38 P08 | – |
| 39 | AWS Step Functions | chain-of-responsibility-cdk/typscript | 4 | yes | P01 P26 | – |
| 40 | AWS Step Functions | lookout-for-vision-inference-sam | 8 | yes | P21 P25 P26 P08 | unbounded-cycle |
| 41 | Azure Logic Apps | veter | 4 | yes | P37 P01 P03 | b2b-artifact-binding |
| 42 | Azure Logic Apps | Azure-Blob-Auto-Tier | 5 | yes | P36 P12 P08 | clock-or-random, parameter-binding |
| 43 | Azure Logic Apps | twitter-to-smtp | 1 | yes | P39 P04 | – |
| 44 | Azure Logic Apps | blockchain-dataworkflow | 1 | yes | P39 P02 | – |
| 45 | Azure Logic Apps | dropbox-to-sharepoint | 1 | yes | P39 P02 | – |
| 46 | Azure Logic Apps | scheduler-run-once-http | 5 | yes | P37 P34 P27 | durable-delay-until |
| 47 | Azure Logic Apps | sap-receive-batch | 4 | yes | P38 P12 | – |
| 48 | Azure Logic Apps | office-to-wunderlist | 1 | yes | P39 | – |
| 49 | Azure Logic Apps | service-bus-sessions | 25 | partly | P44 P27 P12 P21 | heartbeat-lease (stops), unbounded-cycle, run-status-end |
| 50 | Azure Logic Apps | sharepoint-file-email | 2 | yes | P39 P01 P04 | – |
