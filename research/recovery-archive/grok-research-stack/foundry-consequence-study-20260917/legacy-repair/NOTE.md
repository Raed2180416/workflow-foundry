**Legacy objective compiler repair — 17 September 2026 — worker-1**

The authorized repair is complete. The existing objective source and the new runtime regression test are the only product files changed. All 81 related tests pass: 22 new consequence tests, 15 existing objective tests, and 44 existing family/intent tests. This repairs executable consequences of a supplied regex compiler. It does not establish synthesis, independent grounding, or external task completion.

Source root: `/home/raed/Projects/workflow-foundry`. Evidence root: `/home/raed/Projects/grok-research-stack/foundry-consequence-study-20260917/legacy-repair`. HEAD remains `3954dce4563708a9edff16762f521e247b38592b`; the construction files were untracked at handoff, so HEAD alone does not identify this repair. Node was `v24.20.0`.

**Preservation and identity.** Before editing either product file, `PRE_EDIT.json` recorded 27 source/test/support byte hashes, the absence of the new test, scoped Git status, and six earlier recovery receipt hashes. `pre-edit/` contains exact copies of those 27 files. `POST_EDIT.json` confirms that all copies match their originals, 26 existing files are unchanged, and only `src/construction-objective.mjs` differs. All three old construction tests, the CLI, runtime, store, schema, dependency files and earlier source report retain their original bytes. The six earlier receipts include `FOUNDRY_SOURCE_AUDIT.md`, `branch-runtime-witness.mjs`, and the four JSON files in `branch-runtime-run-1/`; all six match their pre-edit hashes. No earlier recovery receipt was updated to reflect this repair.

```text
Before src/construction-objective.mjs:
b71b08e1cf44720f4c0324b960ce3744c80a02890a95bd32efb3bb06d1011884
After src/construction-objective.mjs:
d3283d8df7230231db26efdd80305453eed1f0056ab71a4513ca133a297ea536
New tests/construction-consequences.test.mjs (absent before):
310c9ce34c26ac21f6fff0603952927b0aa53c4077a7ef6b90e1d11e3ca4f9cd

Unchanged tests/construction-closeness.test.mjs:
30083729b7d0ce526abde8b95224e1f01a2377d79a13f15a6bb20c7552a5ccd5
Unchanged tests/construction-intent.test.mjs:
3ee5b536bf892377289c54664f786b08bb25215db4ba6ac3e03afeddf3c848e5
Unchanged tests/construction-objective.test.mjs:
fa0a2a0750309bfa0339a62e2514059c82a6c1815039dc3aadbcc9d2bae45742
```

`REPAIR.patch` contains the source diff against the exact snapshot and the complete added test. The new test bytes are identical in the baseline and repaired test runs. Both runs record source/test hashes before and after execution; no source changed during a test run.

**What changed and why.** In the repaired `src/construction-objective.mjs:208-232`, both conditional paths use `join: 'all_resolved'`. This lets their conditions inspect an actual `handled_error` fetch result. Previously, the default `all_success` policy skipped the error handler before evaluating its condition. Success requires `fetch.ok === true`; the error path handles other results. The join records an explicit `null` for the unselected output. A subsequent check requires exactly `['ok', null]` or `[null, 'error']`, so two absent slots do not constitute a completed branch. An error in the error handler is no longer swallowed by its own `onError: 'continue'`.

In `src/construction-objective.mjs:270-291`, simultaneous map and branch requirements produce a map whose body contains the entire conditional subflow. The body consumes its own `$ref: 'item'`, and its branch-result acceptance is evaluated in that child's frame. The existing `input.matches` array contract and maximum of 32 items remain. The original unrelated map-only score fragment remains for objectives without branching. No runtime or shared schema redesign was needed for this particular composition.

In `src/construction-objective.mjs:320-343`, the claim schema requires the literal boolean `true`. Missing `input.claim` resolves to `null`, which fails validation. The verification assertion then fails before `receipt.json` can be written. Global acceptance now requires `nodes.verify.passed === true` with a false fallback (`:349-365`), replacing the always-present string fallback. Generated prose now describes local checks on supplied values and explicitly identifies the claim as caller-supplied (`:169-176`).

The literal `true` is still only the caller's claim. It has no independent evidential authority. The compiler does not retrieve sources, inspect citations, or test whether that assertion is truthful. Positive diagnostic runs continue to report `independentTaskVerified: false`. Failure diagnostics are preserved as evidence of failure; false or absent claims produce no success artifact.

The wait cue and named-limit extractor now recognize `30 days`, `30-days`, `thirty days`, and `thirty-days` (`src/construction-objective.mjs:24,94-100`). Each receives the exact requested-limit entry `requested:days-or-months-scale;limit:delayMsMax`. Merely retaining the generic `delayMsMax` entry was insufficient to record the spelled-out request.

**Executed witnesses.** The new tests use `Foundry.save`, `createRun`, `startRun`, and verified event reads. They do not fabricate checkpoint outputs or replace the runtime. See `tests/construction-consequences.test.mjs:19-45` for receipt capture, `:54-93` for success/failure branches, `:95-130` for claim and acceptance tests, and `:133-228` for map and wait tests.

| Case | Before repair | After repair |
|---|---|---|
| Fixed-success fetch | Runtime failed at the join with missing `nodes.errPath.branch`. | Success path completes, error path is skipped, join is `['ok', null]`, and local verification completes. |
| Real failed fetch | Fetch exhausts two attempts and becomes `handled_error`; both conditional paths are skipped, then the join fails. | Two thrown `INJECTED_FAILURE` attempts remain in the trace; the error handler actually executes and the join is `[null, 'error']`. |
| Error handler also throws | The intended handler was never reached. | Its real failure produces terminal `failed` with `INJECTED_FAILURE: handler failure witness`; there is no success artifact. |
| `grounded:false` or absent claim | Local success with `validate.valid:true` and an artifact. | `validate.valid:false`, terminal `ASSERTION_FAILED`, no successful verification output and no artifact. |
| Missing field, string, numeric or null claim values | Existing type failures were useful controls. | All seven negative claim cases fail before artifact creation. Explicit true remains an unqualified local success. |
| Verification deliberately skipped | Fallback global acceptance could still report success. | Terminal `ACCEPTANCE_FAILED`; no artifact. |
| Three differently valued items | No map was emitted. | Three separate frames retain their own item values and choose success/error/success respectively. |
| 32 items, alternating real failures | The new test stopped before execution because no map existed. | 32 frames, 48 fetch calls, 16 handled fetch failures, correct per-item joins, and 116 total steps. |
| Empty or invalid map input | Some negative tests failed for the unrelated root-branch defect. | Empty map has count zero and makes no fetch call; missing array and 33-item input fail without a success artifact. |
| Spelled-out or hyphenated 30-day wait | The explicit requested-delay entry was missing for three variants. | All four variants name the unsupported request and return `waiting`; none is reported as having completed a 30-day delay. |

The root failure witness replaces only the candidate's `fetch` capability/arguments with the existing `core.fail`; dependencies, retry bounds, guards, joins and acceptance stay compiler-generated. The maximum-size map witness binds only its existing body fetch tool to a test-local `diagnostic.item-fetch`. That handler consumes the compiler's own item argument and really throws for alternating items. It is a supplied deterministic diagnostic, with no external fetch or model call. The ordinary map test also runs the unchanged compiled identity-based branch body with differing item values.

**Budget growth.** The old fixed allowance of 80 steps cannot cover a 32-item conditional map. `stepBound` (`src/construction-objective.mjs:234-241`) conservatively counts declared task attempts and all bounded body repetitions; the emitted allowance is `max(80, stepBound(nodes))` (`:360`). For the mixed32 candidate, this changes `maxSteps` from 80 to **262**: `32 × (4 tasks × 2 attempts) + 6` root charges. Both conditional paths are counted conservatively even though only one executes. The minimum allowance remains the 80-step floor; host policy, wall time, cost, concurrency and item caps were not increased.

The measured mixed32 run used **116 steps**, across 16 first-attempt successes and 16 fetches failing twice. In this exact fixture, where only fetch can throw and other tasks succeed on their first attempt, the derived all-success/all-failure extremes are **100/132 steps** (`32 × 3 + 4`, `32 × 4 + 4`). Those extreme cases were not separately executed. The mixed run is recorded at `repaired-runs-1/foundry-consequences-qD1GTF/`, run `8e5692ee-5099-4889-ac76-00f49cbb5555`, workflow hash `7f64d5aef59a98c8d7e3b87d49b40203aa4caf0243980ce2bb0375fa4be77b41`.

**Validation receipts.** `BASELINE_TESTS.{json,tap,stderr}` preserves the original-source execution of the new and existing objective tests: **24/37 pass, 13 fail**. This comprises 12 failures among the 22 new tests and the existing objective paraphrase failure (14/15). The original failure outcomes are retained in `baseline-runs/`; there are 21 actual runtime cases because the absent-map assertion prevented the 32-item test from starting a run.

`REPAIRED_TESTS_1.{json,tap,stderr}` records **81/81 pass, exit 0** for:

```sh
node --test --test-reporter=tap --test-concurrency=2 \
  tests/construction-consequences.test.mjs \
  tests/construction-objective.test.mjs \
  tests/construction-closeness.test.mjs \
  tests/construction-intent.test.mjs
```

`repaired-runs-1/` retains all 22 new runtime cases, each with candidate, input/test binding, registry descriptor, result, event trace, and its own Store. `RUNTIME_COMPARISON.json` indexes the actual before/after cases and exposes status, errors, node status, joins, artifacts, call counts and source identities. These are exposed diagnostic regressions, not held-out construction-quality evidence.

`STATIC_CHECKS.json` records successful `node --check` for both changed product files, no trailing whitespace in either file, and successful `npm run check`. The latter runs `doctor` and is only an inventory. The package declares no dedicated formatter, linter or typechecker scripts. The whole repository suite was not run by this worker; prime owns broader integration validation.

**Remaining limits and compatibility.** The compiler still uses regex cues and supplied identity values. Standalone fetch remains a fixed-success placeholder; map fetch returns the supplied item. Payment, sandboxing, scoring and probe placeholders remain. The claim gate is global; this repair does not infer arbitrary quantifier scope or move approvals, waits and retry loops into each item. It implements the requested branch-inside-map composition using the existing input convention.

Because verification was already appended to every recognized objective, the repaired compiler now requires an explicit positive claim for those workflows to finish. Input `{}` no longer manufactures one. Thus rerunning the earlier branch smoke with `{}` will pass its join but fail at the claim check; the success-path regression intentionally supplies `{ "claim": { "grounded": true } }`. That value is a supplied control, not evidence of an external fact.

The earlier wait/deadline contradiction remains: a one-hour wait is still emitted inside a one-hour total run budget (`src/construction-objective.mjs:297-300,360`; unchanged `src/store.mjs:92-100` and `src/runtime.mjs:208,259-264`). Naming thirty-days correctly does not repair durable timing or implement compensation. The wait tests execute only to the first persisted waiting state. The old compiler-generated gold and motif-based closeness evaluation also remain circular for construction quality. No runtime, generator, evaluator, MCP, policy or old test file was edited, and no old run was resumed under altered source.

Serena `initial_instructions` and the CoS quality inventory `project_quality_map` both returned HTTP 404 `tunnel_client_not_seen`. No successful external symbol/quality diagnostics are claimed. CoS initially refused messaging and `apply_patch` for missing chat/workspace identity; the new test was created once through an exclusive Core terminal write. Identity then recovered, the source repair used `apply_patch`, and status messages were delivered to prime. Core syntax checks and runtime tests are the completed verification evidence. No dependency install, external model/provider request, commit, or broader source change was performed. Existing construction tests exercised only their local scripted providers.
