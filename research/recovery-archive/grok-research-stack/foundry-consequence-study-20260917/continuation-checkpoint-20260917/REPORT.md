# Workflow Foundry: constructed process → observed failure → actual model repair

Checkpoint: 2026-09-17, after the 09:16 UTC evidence collection. Research root: `/home/raed/Projects/grok-research-stack`. Product source: `/home/raed/Projects/workflow-foundry`.

## Established result and its boundary

Foundry now has an exercised, actual-model repair path from a successful execution with a wrong required artifact, through independently registered outcome evidence, a goal-preserving repair request, model generation, regression evaluation, explicit version promotion, native re-execution, and a satisfied observation under the same expectation.

This is one bounded synthetic objective, not the general research goal completed. The initial workflow was constructed by COS worker-5 with host-observed model `6`, reasoning `pro`. The repair used that same builder, who retained its original solution context. Researchers injected a single-field fault and supplied an exact development expectation. Consequently, this demonstrates a working model-in-the-loop product mechanism, not autonomous discovery of a novel repair, inferred business intent, organizational learning, cheap-model capability, or arbitrary deployment safety.

The implementation does not depend on ARC, AMP, or Neural Core. The earlier lessons about immutable evidence, goal versus method, and the difference between a green execution and a satisfied objective inform the mechanism without importing those systems wholesale.

## What actually ran

| Evidence | Observed result | What it does not establish |
|---|---|---|
| Actual COS model repair | First repair candidate passed 5 development and 8 provider-withheld cases; explicit v2 apply and native run produced the required artifact | Independent novel diagnosis or success on a population of unrelated objectives |
| Independent saved-trajectory audit | 19/19 checks; raw response, proposal, version, evidence, regression, run and observation bindings checked | An independent second model construction or production attestation |
| Separately authored finite semantic partitions | Repaired candidate 98/98; faulty counterpart 80/98; 196 native executions total | Exhaustive arbitrary input, invalid transport schemas, or all possible architectures |
| Wrong-output negative control | 18 of those 98 counterpart cases were runtime-successful but outcome-wrong, affecting 28 rows | A guard/order negative control: both candidates had identical guard/call/interval traces |
| Final default repository suite | 645 tests: 641 passed, zero failures, four opt-in skips | Those skipped integration groups from this command alone |
| Explicit opt-in integration run | All four previously skipped groups enabled; 82 checks passed, zero failures or skips | Real-model use through the UI, real upstream client applications, or publication |
| Historical inspection | 58 focused tests and 14 independent review groups passed on the corrected source | Current-world qualification or permission to repair/apply |
| Provider termination fix | 23 focused checks, including 10 actual-adapter controls, passed | A successful second hosted construction campaign |

These counts have overlapping scopes and must not be summed as independent successes. The default suite and opt-in run are separately preserved. The opt-in run used actual local MCP stdio, an actual locally built tarball and project installation with existing pinned dependencies, and Chromium against local HTTP. Workflow and provider responses in those integration tests were explicitly supplied controls, not generated intelligence. The new outcome/history experience is a CLI/library feature; the browser tests are regression coverage for the existing UI, not a claim that a new outcome-history UI was built.

All relevant source identities stayed stable during the final two test runs. The original native benchmark/evaluator freezes still verify. No changes were made to the frozen runtime, Store, generator, native capability implementation, schemas, package manifests, or historical benchmark suites.

## The actual repair trajectory

The original model candidate is preserved at `benchmark/campaign-cos-001/CANDIDATE.json`. The new campaign copies it and changes exactly `/nodes/0/body/nodes/6/args/disposition` from `confirmed` to `inconclusive`. Goal, success criteria, guards, budgets, graph structure and acceptance are unchanged. This is an intentionally injected fault, not a naturally occurring model error.

Before running it, the host registers the expected `manifest.json` for one exposed development input. The native run succeeds and actually writes a wrong artifact. `OutcomeRepairCoordinator.observe` records `unsatisfied` while preserving the successful runtime status. `requestRepair` retains the root request and original objective instead of inventing a failed runtime or replacing the goal.

The actual `WorkflowGenerator(outcomes.generationHost(), provider, ...)` then compiles the repair context. Worker-5 reads the exact generated packet and authors its response. The evaluator supplies development feedback only. After that candidate passes, its exact bytes and workflow hash are frozen before the eight provider-withheld regression cases are opened. No withheld scenario or result is sent to the builder.

The host explicitly applies version 2, executes it with the same development input, and observes `satisfied` under the same immutable contract. The original wrong artifact and earlier run/events remain unchanged. Delivery still reports `independentTaskVerified:false`; the narrow outcome check does not silently become a general task/intent certificate.

Key identities:

```text
Original model workflow:
5cc364ca2bd741330968016c582f6f6c2f4464aff5e3a75a99d2c9b908f62510

Researcher-faulted workflow:
ace61076c1694141ff04e4ab29e7cf8713af7087755e646e4476fb559a21ccd8

Actual model-repaired version 2:
1c88cfc1168d192c8e8e1d0f498f84bc64ceeedfa1c5f73492421c0facc239ac

Original successful-but-wrong run:
7ba1aaee-dae6-43da-9752-8897539ed594

Repaired successful run:
a5964850-cb86-41f3-857f-5f485e957318
```

The independent partition author saw only the public semantic contract/interfaces before freezing the new suite. Its expectations were not copied from the existing expected-output helper. The cases vary screening evidence, reproduction evidence, identity binding, missing fields, errors, input order, batch lengths, misleading claims, and matched evidence swaps. A pre-execution runner path bug was caught before candidate exposure; the original frozen runner and its corrective addendum are retained.

## New product behavior

The CLI now exposes explicit `outcome-contract`, `outcome-observe`, `outcome-repair-request`, `outcome-context`, `outcome-propose`, and `outcome-apply`, plus `generate --outcome-repair`. Observation does not automatically dispatch a model, apply a workflow, or run it. Outcome generation cannot request automatic application; promotion is a separate action with live evidence rechecking.

Ordinary CLI proposal/application/prompt/generation routes reject an outcome-repair descendant rather than bypassing its coordinator. This is a tested CLI boundary, not a claim to restrict a privileged host calling arbitrary library functions.

`docs/OUTCOME-REPAIR.md` contains a complete offline command example. Its first bash block was executed literally, apart from setting TMPDIR to preserve evidence in the research directory. It produced succeeded/unsatisfied v1 followed by succeeded/satisfied v2. That example is supplied, and is separate from the actual model campaign.

The new read-only `outcome-history` command operates before component loading or Foundry/Store initialization. It opens existing SQLite read-only, uses `query_only` and a read transaction, and loads no external component or provider. Its result explicitly keeps current evidence unverified and current-world qualification false. SQLite may use its ordinary WAL reader machinery; the command does not create/change workflow records, schemas, or artifacts.

Inspect the actual wrong outcome:

```bash
cd /home/raed/Projects/workflow-foundry
node bin/foundry.mjs outcome-history \
  --receipt dadf02f676ab22bee8b2afa0a37409c767c002dcc59a055a6a0fc40f5c589a1f \
  --workspace /home/raed/Projects/grok-research-stack/foundry-consequence-study-20260917/benchmark/outcome-model-001/workspace
```

The repaired observation can be inspected with receipt `93c0f90949b07205481681179213f44f3ffd976020164459e22da9c0436b5a18`. Both commands were executed after the final inspector correction. They returned the respective unsatisfied/satisfied historical assessments, with the main database byte hash unchanged. The current built-in-only catalog differs from the historical synthetic-instrument catalog; this does not prevent historical assessment, and it does not qualify a new execution.

## The architectural distinction exposed by the next counterexample

A deterministic native witness adds one unused pure local capability after a completed wrong-output run. Existing capability descriptors, old artifact bytes, run/events and expectation are unchanged. The old receipt remains readable, but the original coordinator's current verification and repair refuse the changed registry. Registering the same expectation under the same root/input/artifact also refuses because the contract is immutable. Restoring the original catalog restores verification.

This is conservative known behavior, not erased history. It reveals that four questions must remain distinct: whether the retained record is intact; whether the recorded bytes satisfied the frozen expectation; what can be observed physically now; and whether a future execution is qualified in its current environment.

The new historical inspector re-evaluates only the first two within its supported observer semantics. It validates the root/proposal/workflow/run/event bindings and all completed artifact producers, including producers of other filenames. It repeats the pinned JSON comparison from preserved bytes. For absence and unavailable-observer cases, it checks the recorded observation's consistency and labels the basis as recorded observer evidence; it does not pretend to perform the old physical observation again. Its namespaced result cannot serve as an existing repair receipt.

Independent review then found a real flaw in the first implementation: intermediate ancestor proposals did not check their base against their own request, and an intermediate repaired workflow could drift from its own request's goal/criteria while later descendants remained internally consistent. These were reproduced with finite independent records and fresh disposable native fixtures—not by corrupting the actual model campaign. All three intended-rejection tests failed before the fix. The corrected implementation checks those relations at every ancestor. The original source, failed checks, initial finalization descriptor and unexpected reports remain available; `FINALIZED_V2.json` explicitly supersedes, rather than overwrites, that history.

Primary-source mechanism research is preserved in `../outcome-dependency-study-20260917/MECHANISM.md`. Bazel's registered-dependency and change-pruning mechanisms, and Temporal's explicit execution-version boundaries, motivate separating value/history from new-world eligibility. The inspected Bazel `DirtyBuildingState.java` blob is `b664dfb91dfb6c9ea464f5a904779cfbd023fb69`. No Bazel code was copied and no cross-registry compatibility theorem is claimed. Unregistered dependencies, remote behavior, closure state, policy metadata and newly reachable tools remain counterexamples to simply comparing a few old tool names.

## The unsuccessful free-provider campaign and what it taught us

A separate actual `opencode/big-pickle` construction campaign used the installed pinned OpenCode interface, isolated execution, a zero-price catalog gate, a 150-second per-call bound and no paid fallback. It made one inference request. HTTP 200 returned 199,373 bytes of partial SSE: 676 JSON frames, 675 reasoning fragments totaling 6,967 UTF-8 bytes, but zero final-answer bytes, no finish marker, and no usage record. There was no usable workflow candidate to evaluate.

The saved failure originally said `MODEL_TRANSPORT`. Timing strongly supports the configured deadline as the initiating cause, but the original code did not record first-abort provenance, so that cause is an inference rather than historical timer attestation. Source inspection did establish an error-precedence bug: aborting at a deadline produced a later stream AbortError, and that later error displaced the initiating reason.

The minimal provider revision now records the first locally observed terminal cause before shared cancellation, retains later abort/process observations and partial bytes, and distinguishes its own timeout, caller cancellation, an already observed HTTP refusal, and an earlier network error. Ten new tests exercised the actual production adapter, installed CLI and private server with all external responses supplied; thirteen existing provider checks also passed. No second hosted inference was run. A completed supplied response still had to satisfy the original successful export and completion gates.

The old failed campaign and 23 checked receipts remain unchanged. Exactly one of its 41 frozen source entries—the deliberately revised provider—now differs. The old campaign's current-source check therefore refuses as intended; its historical `sourceStable:true` record was not rewritten. Old provider source is preserved both in its original isolated task receipt and in the new fix study. The new provider has not yet demonstrated success on this long construction task. No usage or billed-cost value is invented from the absent completion record; zero catalog pricing is not an account billing observation. Model scale is unknown.

## Jev and the remaining research gap

No live Jev inference or calibration was performed in this continuation. The supported current execution context lacks gateway authentication; the access receipts state that limitation without exposing or copying credentials. The existing adversarial semantic-judgment protocol remains available. Jev is still relevant to interpretation, relevance, assumption violations and repair selection, but exact identity/byte checks need no model and probabilistic judgments cannot supply authority.

The largest unresolved step is now explicit: our outcome expectation was authored by the host. The general process-engineering goal requires deriving an adequate, grounded and revisable success condition from a previously unseen objective, recognizing consequential ambiguity, and acquiring evidence instead of manufacturing certainty. More passing cases of this one fixed contract would not demonstrate that step. Cross-world continuation with preserved goal lineage and fresh qualification is also not implemented; historical inspection is deliberately not a substitute for it.

Cheap-model success, Jev calibration, new-objective transfer, outcome-contract identification, selective architecture reuse and actual learning remain unverified. Those are retained goals, not erased by the completed repair mechanism. A subsequent provider campaign must use a fresh source/configuration freeze; no silent retry of the historical failed run is authorized by this checkpoint.

## Canonical evidence index

All paths below are relative to `/home/raed/Projects/grok-research-stack/foundry-consequence-study-20260917/`.

| Path | Contents |
|---|---|
| `continuation-checkpoint-20260917/EVIDENCE.json` | Read-only aggregate, exact source/result hashes and explicit claim boundaries |
| `benchmark/outcome-model-001/` | Actual model prompt/response, injected fault, contracts, raw executions, repaired artifact, withheld regression and observations |
| `outcome-model-independent-20260917/RESULT_AUDIT.json` | Independent 19-check saved-trajectory review |
| `benchmark/partition-validation-20260917/` | Independently authored frozen suite, runner correction and 196 execution receipts |
| `outcome-cli-20260917/` | CLI integration tests and preserved pre-history source checkpoint |
| `outcome-dependency-study-20260917/` | Catalog-change native separation witness and primary-source mechanism research |
| `outcome-history-20260917/FINALIZED_V2.json` | Corrected historical inspector, pre-fix negative evidence, source snapshots and 58 focused checks |
| `history-independent-review-20260917/AUDIT.json` | Independent pre-fix findings and corrected 14-group review |
| `benchmark/campaign-opencode-v2-continuation-001/` | Actual unsuccessful free-provider construction; unchanged historical receipts |
| `provider-continuation-20260917/RESULT_REVIEW.json` | Partial-stream/termination diagnosis and its uncertainty |
| `provider-termination-fix-20260917/FINALIZED.json` | Minimal source change, old/new copies and 23 supplied-response adapter checks |
| `continuation-checkpoint-20260917/FINAL_REGRESSION.json` | Final default-suite counts and before/after source identities |
| `continuation-checkpoint-20260917/OPT_IN_REGRESSION.json` | All opt-in MCP/packaging/browser groups enabled and passed |
| `continuation-checkpoint-20260917/HISTORY_CLI_CHECK_V2.json` | Actual saved-model outcomes inspected with corrected source, database unchanged |

Product changes are deliberately uncommitted and coexist with earlier untracked work. No cleanup/reset, publication, external deployment, paid fallback, historical rewrite, or new model-training experiment was performed. Optional external code-review/security plugins were unavailable; their unavailable status is not counted as a passing check.
