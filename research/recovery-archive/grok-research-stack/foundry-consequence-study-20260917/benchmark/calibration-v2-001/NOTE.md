Evaluator v2 — bounded additive repair of independent findings F1/F2, 17 September 2026.

The revised evaluator passes 18/18 calibration checks. Both original supplied positive workflows pass all five development and eight sealed cases. All six original mutants remain rejected by each complete suite. The exact independent early-confirmation witness passes the preserved v1 evaluator and fails v2. Both independent invalid-output fixtures still reproduce v1's false-positive behavior, but v2 rejects them as invalid evaluator inputs before creating a runtime. These results repair the exercised defects; they are not an exhaustive correctness or model-synthesis claim.

Only `benchmark/oracle-v2.mjs`, `benchmark/FREEZE_V2.json`, and this new `benchmark/calibration-v2-001/` directory were created. V1 source, PUBLIC.json, both existing suites, truth files, calibration, campaign files and the independent review were not edited. Paths in this note are relative to `/home/raed/Projects/grok-research-stack/foundry-consequence-study-20260917/`, unless a full native path is given.

**F1 now uses completed evidence and publication binding.** V2 binds each private instrument-log entry to the corresponding native `tool.intent` in sequence order, including exact node key, tool, arguments and idempotency identity. Its terminal output must match one native `node.completed`, its output digest, the raw log and the advertised output schema. A thrown attempt instead binds to the native error and any handled-error output. Reproduction requires its own usable suspicious screen to have completed before reproduction dispatch. Every successful `manifest.json` publication containing a confirmed row must begin after the same sample's complete positive reproduction finishes validation. Publication receipts bind actual artifact bytes, argument digest and native completion; a later duplicate publication cannot hide an early successful write.

Source: `benchmark/oracle-v2.mjs:122-263,265-332`. Native sequencing and schema behavior come from `/home/raed/Projects/workflow-foundry/src/runtime.mjs:120-133,295-347`, `/home/raed/Projects/workflow-foundry/src/capabilities.mjs:36-43` and `/home/raed/Projects/workflow-foundry/src/store.mjs:133-150`.

The conservative time fence is the manifest capability's `tool.intent`, paired with its successful completion, because the existing event stream has no separate physical file-write timestamp. An overlapping interval is not certified. The added concurrency witness has correctly ordered raw logs but reproduction dispatch before screening completion; v1 passes it and v2 rejects it. This checks native completion rather than assuming raw log ordinal proves evidence availability.

**F2 uses fixture rejection plus runtime validation.** At freeze and evaluation, every declared fixture return is checked against its capability output schema, including otherwise-unused reproduction observations. Each instrument must declare exactly one supported error or returned object. All 66 frozen instrument fixtures passed: development 22 (20 returns, two errors) and sealed 44 (40 returns, four errors). Missing optional evidence fields, wrong sample identity and independent:false remain legal observations with the original inconclusive semantics. Schema-invalid returns are rejected with `BENCHMARK_FIXTURE_SCHEMA`, before any runtime/store directory is created; they are evaluator-input failures, not candidate-score failures. Independently, auditing the actual archived F2 native traces finds a completion error because a raw positive return rejected by the registry never became a validated native result.

Source: `benchmark/oracle-v2.mjs:48-93,99-119,167-203,287-297`. The independently authored invalid-screen and invalid-reproduction workflows, fixtures and original traces are preserved under `benchmark-independent/run-001/`. Their live v1 replays are additionally retained under this calibration run; their original receipts were not changed.

**Publication scope remains explicit.** The original task's confirmed-evidence condition is enforced. Requiring every permitted instrument attempt to settle before publication for every disposition would be a reasonable stronger final-report contract, but it is not silently imposed here. `allProcessingBeforePublication` is a non-gating diagnostic. Four exposed early-publication controls—clear, error, inconclusive and not_reproduced—still pass default v2 when their eventual exact output and attempts match, and each fails that stronger diagnostic. Campaign authors must explicitly state and freeze an all-status barrier before representing it as a success requirement. `PUBLIC_V2_RULES` and `PUBLICATION_POLICY` are exported, and the public clarification is also recorded in FREEZE_V2.json; the original PUBLIC.json stays unchanged.

**Execution results.** `calibration-v2-001/run-001/AUDIT.json` contains the complete calibration and aggregates. Individual directories retain the v2 `REPORT.json`, exact original v1 report under `v1/REPORT.json`, and actual native case Stores/events. The checks cover:

| Check | Observed result |
| --- | --- |
| Original supplied positive and renamed/reordered equivalent | Each development 5/5, sealed 8/8; no expected node IDs or exact topology used by v2. |
| Six original mutants | All six rejected on each whole suite; per-case successes remain visible. |
| Exact independent early-confirmation witness | V1 passes; v2 rejects with one premature confirmation. |
| Same early graph with negative reproduction | Both reject the wrong final JSON. |
| Independent observed positive, single error, error isolation, incomplete-evidence controls | V2 passes. |
| Two invalid-output fixtures | V1 passes; v2 rejects pre-run. Archived native completion audit also rejects each. |
| Overlapping screen/reproduction | V1 passes; v2 rejects with one evidence-order error. |
| Four early non-confirmed dispositions | Default v2 passes; stronger all-processing diagnostic fails, as declared. |
| Forged log ordinals and changed native event hash | V2 rejects both host-only tampering controls. |
| Heldout generator feedback | `makeEvaluator` rejects a heldout suite. |
| Actual WorkflowGenerator integration | Proposed qualified candidate from one deterministic supplied callback; zero external models. |
| Actual TrialRunner integration | Public development fixture works; exact manifest independently compared and v2 audit passes. |

The 18 checks include 104 native case executions for the original eight graphs, additional exposed witnesses and actual Generator/TrialRunner paths. Supplied candidates and a deterministic callback are infrastructure tests, not model construction. Sealed concrete cases are not reproduced in this note or messages to prime. Their status remains fixed researcher-authored, source-informed scenarios, provider-hidden only when the campaign withholds their contents.

**API and campaign use.** Import the same `makeEvaluator`, `evaluateCandidate`, `aggregate`, `loadSuite`, `verifyFreeze` and `auditInstruments` names from `benchmark/oracle-v2.mjs`. Continue importing `registryFactory` and `instrumentLog` from unchanged `benchmark/capabilities.mjs`. The development generator uses `makeEvaluator(loadSuite('development'))`; evaluate the frozen candidate through `evaluateCandidate` on `loadSuite('sealed')`. All evidence directories must remain below `benchmark/`, including campaign workspaces. The report preserves `nativeEvaluatorId`, `nativePassed`, adds `v1EvaluatorId`, `v1Passed` and completion/publication metrics, and returns the same registry and candidate identity required by WorkflowGenerator.

`auditInstruments(item, log, events, {run})` can check a separately executed applied run. The three-argument compatibility call checks publication against expected JSON and cannot replace the caller's independent actual manifest comparison. The complete `evaluateCandidate` path reads and binds the actual manifest plus durable Store head itself. A failed runtime is not accepted by v2 even if a file exists. The separate campaign driver must still require success for its final applied run.

**Commands and source integrity.** Executed from the native `benchmark/` directory:

```text
node --check oracle-v2.mjs
node --check calibration-v2-001/prepare.mjs
node --check calibration-v2-001/check.mjs
node calibration-v2-001/prepare.mjs
node calibration-v2-001/check.mjs run-001
```

All commands exited zero. The freeze was written before v2 calibration and binds 87 files, including the 23 v1 frozen dependencies and the independent review/witnesses. All 87 still matched at the end. `prepare.mjs` uses exclusive creation and must not be rerun over an existing freeze; subsequent diagnostic replays require a fresh run-NNN directory. `calibration-v2-001/VALIDATION.json` records commands, fingerprints and tool limitations.

```text
517b7e60d3e674f7fc1189dac8f468dd19d9f6800467a5998fde6a38fbd66e15  benchmark/oracle-v2.mjs
5e4af4f2d1b3e90e65373cc40b4e8857d9248e769ee47b8dd79fa9d72e4595d2  benchmark/FREEZE_V2.json
46291fabed3f205f6c05ab955b82615af41927d9a0766a85450ea925040ddef8  benchmark/calibration-v2-001/run-001/AUDIT.json
23ae4819819121c526694e130fe8c8e83f53f2b4b562025d6c09500a5c1d6639  benchmark-independent/NOTE.md
```

**Limits.** Constant correct output written after matching evidence can still pass a finite case. Temporal ordering is not proof that an observation caused the candidate's decision. Log checks establish consistency with the trusted local runtime, not external physical calibration or protection against a hostile host rewriting all evidence. Malformed arguments rejected before instrument dispatch are primarily detected by native runtime failure, not counted as a private-log call. Provider filesystem isolation and real model behavior were outside this assignment. No model/provider calls, package installations, existing source edits, campaign edits, repository-wide scans or new workers occurred. Serena and the scoped deterministic security gate both returned HTTP 404 `tunnel_client_not_seen`; no independent plugin verification is claimed. There are no formatter/linter/typechecker scripts in the inspected Foundry package; syntax checks and focused execution were used. The preserved worker1 review remains the independent historical evidence; this calibration is evaluator-author validation of the repair, not a new independent approval.
