# AUDIT-L1B-HELDOUT: held-out platform coverage of L0 + L1 (J1 / L1-b)

*2026-10-14 · $0: no model calls and no Jev calls · `beds/sealed/` never read · fetched text is data, not instructions ·
development / diagnostic evidence about the vocabulary, not a sealed evaluation · one labeller (Sonnet 5.5, the labeller of
the 93.6% comparator) · no second labeller: this task may not spawn subagents. New files only: this one and
`out/heldout/` (`PREREG.md`, `draw.mjs`, `draw.json`, `fetch.mjs`, `skips.json`, `labels.jsonl`, `addlabel.mjs`,
`features.mjs`, `features.json`, `analyze.mjs`, `summary.json`, `render.mjs`, `tables.generated.md`, `frames/`, and one
folder per platform with its `MANIFEST.json` and, for permissively licensed sources, the raw definitions). L0 and L1 are
unchanged; §8 lists what should change in them.*

## 0. Result

**Decision for J1: PASS.** On 50 workflows drawn from five platforms that are not among the corpus's 49, **L0 + L1 explain
98.0% (49 of 50; Wilson 95% 89.5–99.6%)**, strict (`explained = yes` only). That clears the bar the re-audit set,
**83.6%** (the corrected in-sample strict figure 93.6% minus 10 points), and it clears the top of the comparator-sensitive
band (84.9%), so the PASS does not depend on which in-sample estimator is the comparator. The lower end of the interval
(89.5%) is also above the bar.

| | |
|---|---|
| pooled strict coverage | **98.0%** (49 / 50), Wilson 89.5–99.6 |
| pooled lenient (yes + partly) | 100% (50 / 50), Wilson 92.9–100 |
| the one item that is not `yes` | Logic Apps `service-bus-sessions`: `partly`, one stopping gap (a concurrent lock-renewal heartbeat) |
| pooled without any one platform | 97.5% (four platforms) to 100% (without Logic Apps) |
| in-sample comparators (re-audit, strict, dashboard = refusal) | 93.6% all clusters; **97.4% non-agentic**; 95.5% automation + orchestration (91.7% unweighted) |
| what it would take to flip | 7 more strict denials of the 49 leave the pass-everywhere zone (42 of 50 = 84.0%); 8 fail (41 of 50 = 82.0%) |

**How to read it.** This is a clean pass of the pre-registered rule, and the honest reading is narrower than the number:
1. **The five platforms are workflow-automation and orchestration platforms, the clusters where in-sample coverage was
   already 95–100%.** The like-for-like in-sample figure is 97.4% (86.0–99.5), so J1 is 0.6 points above it, not 4.4 above
   a figure that includes the agentic cluster (69.6% in-sample, 38.9–89.2). J1 shows the control-flow half of the
   vocabulary transfers to platforms it was not mined from. It does not test the half where the in-sample coverage lost
   ground.
2. **The hard constructs are barely exercised.** Of 50 workflows, `judge` appears in 4, `agent`, `wide`, `plan` and `call`
   in none, and none contains a model-defined agent or streaming-with-cancel, the two run-stopping gaps of
   AUDIT-L1-REAUDIT §7. The brief's candidate list has no agent framework, so this was not avoidable by the draw.
3. **11 of 50 have one or two steps** (five one-module Windmill flows, of which four are trigger-preprocessor stubs with an
   empty body and one is a single large script; five one-action Logic Apps polling templates; one two-state Step Functions
   machine). They are all `yes`. Without them: 38 of 39 (97.4%, 86.8–99.5). The size count is mechanical and crude.
4. **"Explained" is not "needs no change".** 16 of the 49 `yes` workflows carry a gap that would need a construct, a field
   or a binding the vocabulary lacks (§4): 33 of 50 (66.0%, 52.2–77.6) are explained with no vocabulary change at all.
   The gap-recording rate differs from the in-sample labels (57.1% of `yes` rows carry a gap here, 36.4% there), so S3
   is a descriptive figure, not a like-for-like one (§7).
5. **One labeller.** The PASS survives a labeller who is stricter on about 6 of the 49 `yes` rows. The re-audit's two
   labellers differed on 1 of 10 strict calls, which is the only available indication of that rate (§7).

## 1. Method

**Frozen before the draw** (`out/heldout/PREREG.md`, commit a8a3060, before any workflow was drawn or labelled): the
admission rule, the frames, the draw, the skip reasons, the labelling rubric, the primary statistic and the decision bar.
Deviations are in §6.

**Platform admission (decision PAUSE §5.4, taken).** The brief's candidate list was walked in its own order, admitting a
platform if it is not in the corpus, a public source returns at least 10 complete workflow definitions as text without login
(authored as samples, templates or real use, not unit-test fixtures), a licence note can be recorded, and it is reachable
through the egress proxy; stop at five.

| # | platform | source and probe | outcome |
|---|---|---|---|
| 1 | Windmill | `hub.windmill.dev/flows` (default listing, JSON, 30 flows) and `/flows/<id>` | admitted |
| 2 | Kestra | `kestra-io/blueprints` (the repository behind kestra.io/blueprints), 1,513 `flows/*.yaml` | admitted |
| 3 | Pipedream | `pipedreamhq/pipedream`: 29,355 files, components not workflows; docs: export "as JSON, one project at a time", no public gallery | **not admitted** (no public definitions) |
| 4 | Make | `make.com/en/templates`: "Use template" only; no blueprint download, JSON URL, API or repository; `make-com/blueprints` does not exist | **not admitted** (no public definitions) |
| 5 | Power Automate | `pnp/powerautomate-samples` (MIT): 24 solution zips, each one flow `definition.json` | admitted |
| 6 | AWS Step Functions | `aws-samples/step-functions-workflows-collection` (MIT-0): 171 `*.asl.json` | admitted |
| 7 | Azure Logic Apps | `Azure/logicapps` `templates/` (MIT), 45 template files | admitted (fifth; the walk stops) |

Not probed, not drawn: Camunda/BPMN, Huginn, Airbyte, Mage, Hatchet, Trigger.dev, Retool.

**Pins.** Kestra `kestra-io/blueprints@4a19ce21…`; Power Automate `pnp/powerautomate-samples@dbff07a8…`; Step Functions
`aws-samples/step-functions-workflows-collection@7842c46f…`; Logic Apps `Azure/logicapps@c16c1d57…` (full SHAs in
`draw.json`); Windmill is the live hub API on 2026-10-14 and is not versioned. Sources were read with shallow, blobless,
inert clones (tree listings only), `curl` of the public raw URLs at the pinned SHAs and the hub JSON API, plus WebSearch and
WebFetch for the admission probes. Nothing was built, installed or run.

**Draw** (`draw.mjs`, the L1-a and re-audit procedure): per platform the frame ids sorted byte-wise, Fisher-Yates on one
shared `mulberry32(20261017)` stream, platforms in admission order, the first 10 are the sample and the next 12 the reserve.
Frame sizes: Windmill 30, Kestra 1,513, Power Automate 24, Step Functions 170, Logic Apps 45. A drawn item is replaced from
the reserve only for the reasons fixed in PREREG §3 (not a workflow, an exact or variant duplicate, not retrievable). One
replacement was needed: **Windmill 73** (`modules: []`, no preprocessor, no code, only an input schema) was replaced by 59.
Four other Windmill drawn items (61, 72, 65, 59) are trigger-preprocessor templates with an empty body and one code step;
they were kept, because they have a trigger and a step.

**Labelling** (PREREG §4, the AUDIT-L1 method, the shape of `labels-sonnet-60.jsonl` without census fields): each definition
was read whole, then one row was written with the L0 rows, the L1 patterns, `explained`, a refusal field, the gaps (a
quoted fragment, why, `class` stops or leaves, `kind` construct, pattern, field, binding, idiom or rewrite, `lacks` yes,
partial or no) and a note. Rows carry their append time (13:40:30–13:45:01Z; the reading happened before each append) and the file was in git while it grew. Seven rows were
revised afterwards, each with `revisedAt` and `revisionNote`: six recorded a clock read in the definition (§6), one corrected
a `lacks` value; no revision changed an `explained` value.

**Structural cross-check** (`features.mjs`, PREREG §5): mechanical counts from each definition (states, tasks, actions,
modules, triggers, loops, waits, error routes, approvals, clock and randomness uses, cycles) checked against each row. First
run: 5 labels omitted a clock read that the definition makes; after the revisions, 0 issues. It is a recall check on the
labeller written after the labels, not a second labeller.

**Estimators.** Primary: pooled strict share with Wilson 95% at n = 50 (equal weight per workflow and per platform).
Reported beside it: per-platform Wilson, leave-one-platform-out, lenient, the extra-strict readings S3 and S4, the
non-trivial subset (size ≥ 3 by the mechanical count) and the in-sample comparators recomputed from the re-audit's own
labels with its estimator (post-stratified, Wilson at the Kish n).

## 2. Platforms, sources and licences

| platform | unit | frame | licence at the pin | raw files in the repository |
|---|---|---|---|---|
| Windmill | a hub flow (`/flows/<id>` JSON) | 30 | none stated on the hub (WebFetch found no licence or terms text) | no (`.gitignore`; `MANIFEST.json` only) |
| Kestra | a blueprint `flows/<name>.yaml` | 1,513 | no LICENSE file in the tree; the README shows only the kestra-io/kestra badge | no (`.gitignore`; `MANIFEST.json` only) |
| Power Automate | the flow `definition.json` inside a solution zip | 24 | MIT | yes |
| Step Functions | `*.asl.json` | 170 | MIT-0 | yes |
| Logic Apps | `templates/<name>.json` | 45 | MIT | yes |

Source availability does not grant redistribution (AGENTS.md): the Windmill and Kestra definitions are kept in this
working tree only; their URL, fetch time, sha256 and size are in each `MANIFEST.json`, and the labels quote at most 200
characters per gap. Every file in the manifests was fetched on 2026-10-14; none is a duplicate (sha256 distinct).

## 3. Tables

The tables below are generated (`render.mjs` from `summary.json` and `labels.jsonl`); each number is the same number as in
§0. T1 is the J1 result by platform; T3 the in-sample comparators; T4a and T4b the missing constructs and fields; A1 every
label.

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

## 4. Missing constructs and fields, with counts

Only **one** gap stops a workflow being explained. All other gaps leave it explained and say what the vocabulary would need,
or what a rewrite must add. Counts are workflows, of 50 (T4a).

**Stops (1 workflow).**
- **Concurrent heartbeat with cancellation** (Logic Apps `service-bus-sessions`): `Renew_session_lock_until_cancelled`
  (Until `isDone`, wait 25 s, renew the session lock) runs beside `While_there_are_more_messages_for_the_session_in_the_queue`
  and both end by `Set_isDone_=_true`. L0 has no concurrent background task, lease or heartbeat with cancellation, and
  refuses a shared mutable flag. The rewrite moves lock renewal into the queue binding (an L3 lease capability) and keeps
  the drain loop (P44, P12, P27). One workflow is not enough to justify an L0 construct; it is a candidate for the L3
  binding contract.

**Fields or small constructs the vocabulary would need (leave the item explained).**
- **Clock and randomness in a pure step: 11 of 50** (Windmill 2, Kestra 3, Power Automate 2, Step Functions 3, Logic Apps 1).
  `Date.now()`, `now() | dateAdd(...)`, `utcNow()`, `utcnow()`, `$$.Execution.StartTime`, `States.UUID()`, `rand(0, 5)`.
  L0 `step` is pure code with no clock or random source, so a time window, a dated key or a fresh id must be an input from
  the trigger or an effect. This is the same gap AUDIT-L1-REAUDIT §7 found on 3 of 60 corpus items; here it is the most
  frequent gap by a wide margin, because these platforms compute windows and ids inside the definition.
- **A literal cap on loops, polls and pagination: 5 of 50** (Windmill 1, Power Automate 1, Step Functions 2, Logic Apps 1).
  Step Functions cycles with no counter (`Check Model Status` → `Wait 30 second` → `Check Model Status`; `NextToken`
  pagination), Power Automate and Logic Apps `Until` loops bounded by a time limit only, an unbounded `while (pageToken)`.
  The `UNBOUNDED` rule already forbids these, so each is a rewrite that adds a literal cap; it changes behaviour (a model
  that never reaches HOSTED now ends) and the rule's wording should say what the cap's exhaustion does.
- **Per-item failure policy on `map`: 3 of 50** (Windmill, three `skip_failures` loops). L0 `map` is fail-fast. This is
  prior-art adoption 1c of the slice 2 brief; L1 P12 has no slot for it.
- **An explicit failed end with a code and message: 2 of 50** (Power Automate `Terminate` with `runStatus: Failed`, Logic
  Apps `Terminate` with `runError`). L0 `done` carries a typed output, `refuse:<reason>` a reason; a failed run status is
  an envelope notion that the card does not name.
- **Approval details: 3 of 50, one each.** A quorum rule with a per-approver response list (Power Automate
  `BasicAwaitAll`); no timeout in the definition (Power Automate `StartAndWaitForAnApproval`: L0 refuses a wait with no
  timeout, so the rewrite adds one); a callback-URL transport answered in another system (Windmill `getResumeUrls`).
  P32 has `APPROVERS`, `TIMEOUT` and `ON_TIMEOUT` slots but no quorum or response-list slot.
- **Delay until an absolute, caller-supplied timestamp: 1 of 50** (Logic Apps `Delay_until`). `wait.delay` is relative and
  at most 1 h; a durable delay-until with a documented maximum is the rewrite.
- **Image inputs to a model read: 1 of 50** (Windmill `Reimbursement`, a vision read of receipts). L0 `judge` reads text.
- **Several independent entry points into one body: 1 of 50** (Kestra: a schedule and a webhook). Recorded by the earlier
  audits as "several entry points".

**Recorded, needs no vocabulary change (T4b).** Effects inside code steps (2, Kestra), a shared working directory or an
external accumulator between tasks (2, Kestra), start-and-wait integrations such as `.sync` and polling plugins (3),
untrusted input concatenated into SQL or a shell string (2, a defect the typed binding removes), a batch model read
returning free text aligned by position (1, a defect against the one-decision-per-judge rule), a code router with an
unsupported branch (1, P07 with its none option), parallel effects with no compensation (1, a defect), connector and
integration-account detail (3), a typed resume answer (1), a broker-held offset (1), validation in code (1).

**What no workflow needed.** No refusal class applied (group chat, full-history handoff, interactive dashboard state,
model-chosen tool, self-modification). No credential literal was found in the 50 files (a grep for key, token and password
assignments and for AWS, OpenAI, GitHub and Slack key shapes was empty); Kestra uses `secret(...)`, Windmill resource
references and blank placeholders, Power Automate and Logic Apps connection references.

## 5. Needs profile against the nearest in-corpus clusters

T5 gives each platform's hand-labelled profile. The comparison is against L1 §2.4 (the census, a candidate generator) and
against the re-audit's hand labels for the same labeller.

- **Pattern mix.** The 50 workflows use 27 distinct L1 patterns. The most used are P08 guard before an effect (17), P38
  event rule (16), P01 linear pipeline (14), P27 error route (13), P12 for-each (12), P04 deliver (11) and P36 schedule
  (11), all patterns with high corpus support (P38 364, P08 229, P27 215, P36 164 items by the census). The patterns that are used
  far more here than the census suggests are **P39 poll → diff → notify (7 of 50 here, 26 corpus items)** and **P02 fetch →
  transform → write (5 of 50 here, 0 corpus items)**. P02 had no census evidence because revision 1 removed its detector
  at precision 0.23; five real data-movement workflows here (Stripe to CRM, audit logs to BigQuery, a configuration backup to
  S3, a blockchain event to SQL, Dropbox to SharePoint) are P02 by hand. That supports keeping P02 and reading "no census
  evidence" as a detector failure, not a statement about the pattern.
- **Patterns per workflow.** Medians 2 (Windmill, Step Functions), 3 (Power Automate, Logic Apps) and 4 (Kestra); maxima 4
  to 7; 4 of 50 need more than 5 patterns (Windmill `Reimbursement`, Kestra drift guard and unpinned-action audit, Power
  Automate review and approval), a hierarchical share of 8%. In-sample hand labels have medians 4 (automation) and 6
  (orchestration) with 3 of 12 and 6 of 12 above 5, so J1's workflows are smaller; the census's own per-platform medians
  are 1 to 7 for automation platforms and 0 to 3 for orchestration platforms (L1 §2.4). The comparison is rough: the census
  finds about 60% of the patterns the hand labels name (recall 0.60), and J1's small items pull the median down.
- **Nearest in-corpus cluster** (mean cosine of pattern-share vectors against census platform vectors, a weak measure):
  Windmill automation (0.35), Kestra orchestration (0.29) with automation close behind (0.27), Power Automate orchestration
  (0.29) and automation (0.28), Step Functions science (0.33, from P26 retry and P08 with P01) with automation behind
  (0.26), Logic Apps consumer-creative (0.29; the single platform neighbour is IFTTT at 0.71, a polling trigger and one
  action) with automation (0.27). All cosines are low; no J1 platform is close to any one corpus platform. That is the
  expected shape for platforms that were not mined, and the patterns they use are still the catalog's.
- **L0 rows used** (T7): `effect` 99, `done` 50, `step` 37, `input` 32, `if` 28, `map` 17, `route.error` 15, `trigger.event`
  12, `trigger.schedule` 11, `guard` 9, `state` 8, `trigger.poll` 7, `trigger.webhook` 6, `for` 5, `retry` 5, `wait.delay` 5,
  `approve` 4, `judge` 4, `stream` 2, `wait.signal` 2, `finally` 1. Not used: `call`, `agent`, `wide`, `plan`, `flag`, `invariant`,
  `ask`, `compensate`, `admission`, `session`.

## 6. Deviations from the pre-registration

All are recorded, none changed the primary statistic.
1. **Frame sizes corrected before the draw** (Kestra 1,545 yaml files in the tree vs 1,513 under `flows/`; Step Functions
   171 vs 170 after the `_` rule). The corrected PREREG is the committed one (a8a3060).
2. **One skip applied**: Windmill 73, before any label, under reason (a) (empty skeleton).
3. **Seven revision rows** after `features.mjs` (six clock gaps, one `lacks` correction), none changing `explained`.
4. **S3 as specified could not be computed on the in-sample labels** (their gaps carry no `kind` or `lacks`). The
   comparison offered instead is the share of `yes` rows with any gap (36.4% in-sample, 57.1% here), which is a measure of
   recording thoroughness as much as of the vocabulary.
5. **Added after the draw, exploratory (not in PREREG)**: the like-for-like in-sample comparators (T3), the non-trivial
   subset, S4, the gap tags (regex rules in `analyze.mjs`; every gap is tagged, 0 untagged, and `summary.json` lists each tag so a
   reader can recode), and the needs-profile cosines. The primary statistic, the decision rule and the bar are as
   registered.
6. **Retrieval tools.** The task allowed WebSearch and WebFetch. Byte-exact files and the pinned SHAs needed `curl` of the
   public raw URLs and the hub API, and blobless clones for tree listings (AGENTS.md allows shallow clones as inert
   research material). WebFetch returns a model summary of a page, so it was used only for the admission probes.

## 7. Limits

- **One labeller.** The brief and the re-audit ask for a blind second labeller of another model size on at least 10 items.
  This task cannot spawn one. The labeller is Sonnet 5.5, the labeller of the 93.6% comparator, so a labeller effect cancels
  in the comparison but nothing here is a second reading, and nothing is a human reading. Both the vocabulary and the
  labeller are Claude-family; correlated leniency cannot be excluded. The re-audit's two labellers agreed on 9 of 10 strict
  calls; if a second labeller here were stricter on 10% of the 49 `yes` rows (about 5) the pooled figure would be 88%, still
  a pass; it would take 7 to leave the pass-everywhere zone and 8 to fail. An indication, not an estimate.
- **Not blind to the platform.** The labeller knew each platform's name and read L0 and L1 first; the census was not run
  on these items and no corpus label was read for them. The stratum letter of L1-a does not exist here.
- **Gap-recording thoroughness differs from the in-sample labels** (57.1% of `yes` rows carry a gap, 36.4% in-sample; J1
  records every clock read after the consistency pass). S3 and S4 are descriptive.
- **Samples are small.** Ten per platform; per-platform Wilson lower bounds are 59.6% (Logic Apps) and 72.2% (the rest).
  Five clusters cannot support a design effect, so the pooled Wilson interval treats the 50 as exchangeable; the
  leave-one-platform-out range (97.5–100%) is the only clustering guard.
- **Frames are what the sources expose.** Windmill's hub frame has 13 of its 30 flows titled as trigger templates (most
  with an empty body) and is not versioned; Kestra's blueprint directory contains many recently added, long, uniformly structured "gate" and "sentinel"
  flows (authorship not checked); Logic Apps' `templates/` is the older Consumption gallery (the poll-trigger-plus-one-action
  era); Power Automate's samples are one community repository; Step Functions' collection includes variants of one pattern
  in several IaC flavours (the variant rule did not fire). None of that is a sample of "all workflows on the platform".
- **Not tested:** agent-framework shapes (the two run-stopping gaps of the re-audit), BPMN (human tasks, boundary events,
  event sub-processes), Airbyte-style connector pipelines, and executable coverage (L1-b executable is a separate paid test
  on the oracle-bearing corpus subset).
- **Structural, not executable.** "Explained" means each control structure maps onto L0 and L1; it does not mean a
  constructor can build the workflow or that an L3 binding exists for each connector (Step Functions SDK integrations,
  Graph API calls, SharePoint HTTP requests are all L3 work).
- **The cross-check is weak.** `features.mjs` was written after the labels and by the labeller; it caught one omission class.

## 8. Decision for J1, and what follows

- **J1: PASS** (pooled strict 98.0%, Wilson 89.5–99.6, against the bar 83.6% and the pass-everywhere line 84.9%). There is
  no evidence in this sample that L0 + L1 are fitted to the 49 corpus platforms in their control-flow part. The kill rule
  in PAUSE §6 ("out-of-sample within 10 points of in-sample, else L0/L1 are revised before any paid library run") does not
  fire.
- **What the PASS does not unblock.** D1 stays **N** on L1-a (rule precision 0.713, AUDIT-L1-REAUDIT); the census stays a
  candidate generator; the agentic half of the vocabulary is untested out of sample; the L3 bindings these platforms need
  are unbuilt. A reasonable next out-of-sample test is an agent-framework draw (frameworks outside the corpus's 21) plus a
  BPMN platform, because the first carries the in-sample losses and the second adds human-task shapes; the brief's list has
  neither, so this needs a new platform list from the owner.
- **Proposed changes to L0 and L1 (not applied; this file changes nothing existing).**
  1. L0 card, `step`: add one sentence that a step has no clock and no random source, and that a window, a dated key or a
     fresh id is an input supplied by the trigger or an `effect` (a `clock` and an `id` binding in L3). Affects 11 of 50 here.
  2. L0 `map` and L1 P12: add `onItemError: fail | skip | flag` to `map` (prior-art adoption 1c, slice 2) and a P12 slot;
     `flag` the skipped item so SILENT_DROP holds. Affects 3 of 50.
  3. L1 `UNBOUNDED` (§9) wording: a state-machine or poll cycle with no counter, an `Until` bounded only by a time limit and
     a pagination loop are rewritten with a literal cap and an explicit behaviour on exhaustion (P21, P22). Affects 5 of 50.
  4. L0 `wait.delay` and P34: add `until` (an absolute caller-supplied time, durable, with a maximum) next to `delayMs`;
     L0 `done`: name a failed end (`fail:<code,message>`) beside `refuse:<reason>`. Affects 1 and 2 of 50.
  5. L1 P32: add `QUORUM` (any, all, k of n) and a per-approver response list to the output; say that a missing timeout is
     rewritten with one. Affects 2 of 50 (plus 1 callback-URL transport, an L3 binding detail).
  6. L0 `judge` (card note): image inputs are an L3 tool read (`effect`) whose text output is untrusted, until a typed
     `inputs` field exists. Affects 1 of 50.
  7. L3 binding contract (LIBRARY): a queue binding exposes a lease or session-lock renewal capability, so a heartbeat loop
     is never workflow logic; do not add an L0 construct for one workflow.
  8. L1 §2.5 / P02 / P39: P02 has 5 of 50 real hits and P39 7 of 50 here, against 0 and 26 corpus items by the census; keep
     P02 and note that its "no census evidence" is a removed detector, not an absence of the pattern.
  9. L1 §10: record J1 as run with the result above and the untested clusters named.
- **PROOF-LEDGER (not edited here; the brief forbids touching existing files).** J1 row status, proposed text: "**PASS
  (2026-10-14, design/library/AUDIT-L1B-HELDOUT.md)**: 98.0% (49 of 50, Wilson 89.5–99.6) strict on 5 held-out platforms
  (Windmill, Kestra, Power Automate, Step Functions, Logic Apps, 10 each, seeded draw, pre-registered), one labeller, bar 83.6%.
  Like-for-like in-sample 97.4%. Does not test agent-framework shapes; 11 of 50 are stubs; 66.0% explained with no vocabulary
  change. Missing: clock and randomness in `step` (11), literal cap on loops (5), `map` item-failure policy (3)." D1 stays N.

## 9. Files

In `research/jit-20261008/design/library/out/heldout/`: `PREREG.md` (frozen rules and the admission walk), `frames/`
(the five frames, their sha256 and the Windmill listing), `draw.mjs` → `draw.json`, `skips.json`, `fetch.mjs`, one folder per
platform (`MANIFEST.json` with url, fetch time, sha256, size, licence note, peeks; raw definitions for Power Automate, Step
Functions and Logic Apps only), `labels.jsonl` (57 rows: 50 labels and 7 revisions), `addlabel.mjs`, `features.mjs` →
`features.json`, `analyze.mjs` → `summary.json`, `render.mjs` → `tables.generated.md`. To reproduce the numbers from the
labels: `node …/heldout/analyze.mjs` (reads `labels.jsonl`, `features.json`, the manifests and, read-only, the re-audit's
`labels-sonnet-60.jsonl`, `draw.json` and `out/pattern-census-items.jsonl`).
