# Independent review of finalized outcome repair results

Worker-6 reviewed the saved results after prime's explicit release at **2026-09-17 08:49:52 UTC**. Verdict: **PASS_BOUNDED_SAME_BUILDER_INJECTED_FAULT_REPAIR**, with **19/19 independent check groups passing**. There is no remaining discrepancy blocking that bounded claim under the trusted local host/evidence boundary. The two generic enforcement omissions recorded in the initial review remain present in the frozen source; their run-specific bindings have now been checked independently.

The review covers the source and protocol freeze, packet bytes, author and host receipts, native generation records, applied SQLite records, all 26 preserved regression cases, and the original and repaired applied runs. It used read-only SQLite queries, hash calculations, independent interpretation of the public observation rules, exact artifact comparisons, and the frozen v2 instrument auditor on saved events. No provider, generator, workflow, native case, training job, or old checker was executed. Only this directory's new `result-check.mjs`, `RESULT_AUDIT.json`, and `RESULTS_NOTE.md` were created. No candidate or result was sent to builder worker-5.

Paths below are relative to `/home/raed/Projects/grok-research-stack/foundry-consequence-study-20260917` unless identified as product sources. The result packet is `benchmark/outcome-model-001/`. Product sources are under `/home/raed/Projects/workflow-foundry/`.

## Exact authored change and packet binding

The raw `packet/RESPONSE_1.json` contains the exact workflow later stored in `REPAIRED_CANDIDATE.json`, the generation attempt, the proposal, the immutable workflow table, and the current version head. A complete recursive comparison against the faulty workflow finds exactly two changed scalar values: `/nodes/0/body/nodes/6/args/disposition` changes from `inconclusive` to `confirmed`, and `/version` changes from 1 to 2. Comparing against the original model construction finds only the version change. The goal, success criteria, acceptance, budgets, evidence predicates, dependencies, and every other workflow value are restored exactly. There is no added development-specific branch or embedded answer table.

The repaired workflow hash is `1c88cfc1168d192c8e8e1d0f498f84bc64ceeedfa1c5f73492421c0facc239ac`. Its saved candidate byte hash is `a7edbdfa47d63b836203f8e9199d9aebff94c066cd8bd00a8b768d5383d32f09`. The raw response SHA-256 is `3cbacb276917a005e866432568e6bd77441ef9613e7142f404da1b48b1fc603d`; the author-file SHA-256 is `9b376056bd3d764d5cbced13d7786cf77d73f3c3c32ebd04a06c0b1f6a35a0d5`. Both match `RECEIVED_1.json`, the native attempt's saved response/evidence, and `GENERATION_JOB.json`. The proposal rationale also equals the raw authored rationale. The generator's JSON-string digests are checked separately from raw byte SHA-256 values; the two representations are not confused.

The entire saved native context equals the prepared context, with hash `b4e909c3a8860f9d5bfb9a118be11b35d641b11b87c1ffece8e794c53ebc82ec`. Both prompt files equal the complete frozen generator template around that context. Their byte SHA-256 is `5666f633cf69d4c9fc4d4ccc3748eb73f37def5dc835e2cda8144286436d761b`, also checked in the initial audit before either response or author file existed. All selected skill texts match their saved and current bytes. The outcome facade is the actual `WorkflowGenerator(outcomes.generationHost(), ...)` path at `outcome-campaign.mjs:125-131`, with explicit `autoApply:false`; product `src/outcome-repair.mjs:381-432` supplies and guards this context and proposal/application path.

The recorded job is `daf33606-ccfe-42fe-b246-3b42591075eb`. It contains one accepted round, using the development evaluator, within the frozen two-round/900,000 ms budget. The packet contains exactly the five first-round files; the generation directory contains only `01` and `context.json`. There is no recorded sealed-feedback generation round. The observed generation interval is 216,248 ms; it includes the file relay wait and development evaluation, so it is not a measured model inference time. See product `src/generator.mjs:37-106` and the saved job/attempt records.

## Model attribution and the initial binding findings

`HOST_MODEL_RECEIPT.json` retains the exact SHA-256 read during the initial review: `6a7d7595c3bb68aaa037a4d6441796a77a2180e0e1bac9dd6f41b3d916568e94`. It records prime's extraction from actual host status at 08:46:42.455 UTC: run `a6c2cb58-50d1-4559-a931-c46650f6dc12`, worker-5, configured model `6`, reasoning `pro`. These fields agree with the protocol, author declaration, relay call, received receipt, and generation job. This is corroboration from a prime-recorded host result under the trusted host boundary; this reviewer did not inspect the author's conversation or independently attest remote model weights.

**B1 is discharged for the saved run's packet/configuration chain.** The raw author file is parsed and its request/root/base/run/version/path/context fields agree. Its `prompt.sha256:null` and unknown exact authorship time are honest unmeasured fields, not broken hashes; the actual prompt bytes and local receipt sequence provide the separately verified binding. However, `relay-provider.mjs:13-19,36-45` still accepts author-file bytes without validating their contents. This review adds evidence for this run and does not repair that generic enforcement gap. Author declarations about exclusive file access and tool activity remain declarations, not independently proven sandbox isolation.

**B2 is discharged for this run's prepared context and first prompt.** The saved native context and prompt equal the pre-response independently checked packet. All 111 inputs from the initial audit remain byte-identical. The driver still does not enforce a prepared-context comparison and still omits `workflow-foundry` and `runtime-native` skill files from its declared freeze lists. Their actual bytes were separately checked here. All 93 unique files across the protocol and v1/v2 freeze lists also remain exact, including campaign source SHA-256 `f8511ee1b4b763c6b7c45fa2016bfbc1d3dd0118adc7791595ab1a09bcaad0e6` and protocol configuration digest `2ff139b58bc279fa82cbf1ba4066b5f3a164a121d889c362264a894852964e6c`.

## Independent scoring of every saved regression case

| Workflow | Development | Provider-withheld regression | Successful runs with wrong outcomes |
|---|---:|---:|---:|
| Repaired version 2 | 5/5 | 8/8 | 0 |
| Preserved injected mutant | 4/5 | 4/8 | 5: one development and four withheld |

All 26 existing case records were checked against their own read-only SQLite run, immutable workflow, fixture, event chain, native artifact bytes, and logged instrument attempts. The independent expected manifest calculation applies the public rules to each frozen fixture, without using the candidate or report verdict to decide the expected classification. Each saved artifact was compared against those expectations. Mutant outputs differ exactly where the injected branch replaces `confirmed` with `inconclusive`; the other classifications remain correct. All 26 runs are terminal `succeeded`, which makes the five mutant content failures substantive examples of successful execution with wrong outcomes.

The review recomputed 1,554 regression event hashes and verified 110 logged instrument attempts. Per-arm totals are 97 development steps/81 synthetic work units and 181 withheld steps/172 synthetic work units. Native monetary cost fields are zero; these synthetic work units are not model charges. It verified exact instrument identities, arguments, idempotency keys, fixture values, completion/error events, screening-before-reproduction order, publication bytes, and artifact arguments. The frozen v2 auditor replay matches every saved instrument audit. Full reports, aggregates, generation assessment, registered qualification hashes, and delivery evidence all agree. The original v1 reports remain preserved alongside their v2 reports.

These checks also independently confirm the stronger all-processing-before-publication observation for the saved runs. V2 only makes validated positive reproduction before confirmed-row publication a gate; completion of every required attempt before publication remains a non-gating diagnostic (`benchmark/oracle-v2.mjs:241-262`). Finite output equality and order do not establish general causal use or arbitrary scheduler behavior.

## Promotion, applied run, and preserved wrong evidence

The exact candidate is frozen before the first withheld execution. The local chronology agrees with `outcome-campaign.mjs:135-175`: relay receipt at **08:48:32.832 UTC**, candidate freeze at **08:48:33.492**, first withheld run at **08:48:33.519**, last mutant regression completion at **08:48:35.872**, explicit promotion at **08:48:35.926**, application at **08:48:35.934**, new run creation at **08:48:35.936**, successful completion at **08:48:36.039**, satisfied observation at **08:48:36.044**, and finalized result at **08:48:36.051**. These are local saved timestamps and frozen control flow, not externally authenticated time attestations.

Applied proposal `091855cd-2ba2-4190-838a-705e6e4ff78a` targets the original faulty base and the outcome-repair descendant request. Its actual stored status is `applied`; the generation job's `proposed` status is the earlier completed generation-stage receipt and is not treated as a failed application. The main database contains exactly two requests, two proposals, two workflows, two runs, one generation job, one outcome contract, two observations, and one outcome-repair binding. The original root task text, repair goal, and success criteria are unchanged. Relevant lifecycle sources are product `src/store.mjs:279-349` and `src/outcome-repair.mjs:303-432`.

The final applied run is `a5964850-cb86-41f3-857f-5f485e957318`. Its 67-event chain, actual workflow/input/registry/engine/policy bindings, five instrument attempts, publication, and 241-byte manifest match `REPAIRED_EXECUTION.json` and observation `93c0f90949b07205481681179213f44f3ffd976020164459e22da9c0436b5a18`. Manifest SHA-256: `f45ac6e6a678ef2767b82545e25a26df7f24908983c00292af2c1e50c4d647aa`. Its observed JSON satisfies the same immutable contract `da28a44ea33ba76cbb38a9f4ed0a2ef9a9f978b0f9dbab2e1fa607f15c0ccf88` that preceded the original run.

Original run `7ba1aaee-dae6-43da-9752-8897539ed594` still has status `succeeded`, the same 67-event chain, the same fixture, and the same 244-byte incorrect artifact. Its artifact SHA-256 remains `d5d09b605d535b6070b95ed81aaf6a30948edc3fb737b32c57fa515a9b9b2417`; its immutable observation `dadf02f676ab22bee8b2afa0a37409c767c002dcc59a055a6a0fc40f5c589a1f` remains `unsatisfied`. Live bytes, preserved base64 bytes, saved execution text, and applied-record hashes agree. Together with the regression cases, 28 distinct saved runs were checked; none were reexecuted.

`DELIVERY.json` retains `independentTaskVerified:false` and names the exact two scoped qualification reports. `GENERATION_JOB.json` retains the compatibility field `deploymentQualified:true`, accompanied by its explicit evaluator-envelope qualification excluding general deployment readiness. The flag must not be extracted as a production-readiness claim. Product `src/generator.mjs:78-106` and `src/foundry.mjs:59-71` define these distinctions.

## Claim boundary and reviewer validation history

This establishes a bounded, host-controlled model correction and execution of a researcher-injected one-field fault using explicit development feedback. The same builder retains its original construction and prior aggregate result context. The corrected workflow exactly restores that construction except for its version. The surviving branch name, guard, and complete expected/observed comparison make the restoration accessible. This experiment does not isolate outcome feedback from retained solution memory, demonstrate novel repair discovery, autonomous discovery of natural errors, learning, a population repair rate, cheap-model performance, or real-world instrument validity. The fixed withheld cases establish regression coverage under procedural withholding; they are not freshly sampled tasks or evidence of absent ambient knowledge. Token use and billed model cost remain unobserved.

The first checker dry-run failed 9 of 19 groups because the reviewer initially compared stored fixtures directly to supplied fixtures. Frozen product `src/store.mjs:104` adds `actions:[]` and `wrongActions:0` on creation. Six run-check groups hit that incorrect reviewer assumption and three dependent summary checks consequently failed. The corrected checker requires the exact documented normalized fixture, unchanged observations, and both zero counters. No campaign evidence changed. The negative tool output remains recorded, and its cause/disposition is preserved in `RESULT_AUDIT.json.reviewerValidationHistory`. The corrected dry-run and final write both passed 19/19. This was a checker correction, not a campaign repair.

Validation commands, run from the study root:

```sh
node --check outcome-model-independent-20260917/result-check.mjs
node outcome-model-independent-20260917/result-check.mjs --write
```

The audit was finalized at **08:56:39.170 UTC**, covering 168 hashed input files and 29 read-only database projections. `--write` creates the new result receipt with exclusive creation and refuses to overwrite it; an ordinary checker invocation recomputes evidence without writing. Repository runtime tests were not run because the requested review forbids new native cases and changes no product code.

Result checker SHA-256: `4a1b81e56b7642d711649b9b1e781f01937f93db6de22efa140e7a28ce46ada9`.

Result audit SHA-256: `caa881c8744982decc4dcec6be0b0927f3c1d54d8afda7120247fb8dbea610aa`.

The initial `NOTE.md`, `check.mjs`, and `AUDIT.json` retain their prior exact hashes. The initial 18-check output is historical preparation evidence and is left intact; this separate result review closes the released trajectory.
