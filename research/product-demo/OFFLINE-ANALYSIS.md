# Offline diagnosis of the three preserved browser-demo responses

The model trial remains **failed creation, three initial calls, zero revision calls**. All seven task cases are **not run** because parsing or schema validation blocked every candidate. The follow-up made **zero model calls**. Replaying unchanged response text through the original and updated host code preserves those outcomes.

## Evidence identities

Paths in this document are relative to `research/product-demo/` unless prefixed by a repository directory. The original trial is `runs/2026-09-13T13-23-00-987Z-Ld5AC8/` (H below). Its job is `c2444146-5f33-416a-8043-1a246b0aa34b`; raw responses and actual prompts are under `H/workspace/.foundry/generation/<job>/<01|02|03>/`. Nothing in that original trial was rewritten.

The completed offline follow-up is `runs/2026-09-13T13-52-41-212Z-offline-1dnBKn/` (D below). Its `result.json`, `exact-syntax-and-feedback.json`, `individual-case-metrics.json`, and separate host replay receipts are the primary evidence. The updated host was copied before replay; imports and tests load that copy, including exact installed dependency bytes. The source identities are:

| Condition | Closure SHA-256 | Verified scope |
| --- | --- | --- |
| Original model trial | `c665090f374702ba903696af5d34dde87ccd05e07c511e21b1c3c13e0c0a3463` | 3,916 files and five observed executable binaries |
| Updated offline host | `2d2ef5dff4ef2e717f83ff30b01d5202b6d3dd06157bf09e037202bddd139dbe` | 3,889 files and the Node binary |

Both closures verified unchanged after replay, as did every protected original prompt, response, stream, export, catalog and selected receipt. The updated condition contains other prime integration changes, enumerated in `D/result.json`; it is not a controlled comparison isolating model behavior. Operating-system shared libraries and remote model weights are outside these copied closures. No remote provider was contacted in the follow-up.

## The causal sequence

| Response | Exact text SHA-256 | First blocking failure |
| --- | --- | --- |
| 1 | `3c2970b439ca810dcaf916c14c3d7571fbf9dff93d3155b7329919afbeb87bc3` | Invalid JSON, UTF-16 offset 1837, line 1 column 1838 |
| 2 | `9970960750878ce0a8b65001cff60f7e9e19448c13a69dcbe969ceadeac81c11` | Same syntax defect, offset 1884, line 1 column 1885 |
| 3 | `32dde6b79abb00c6b559016aa0ee48f24a512de1a37877061e66c0d6927bd4b0` | `/nodes/2/body/acceptance` violates the nonempty-array schema |

In responses 1 and 2, an extra closing brace after the validation node's nested schema closes the entire node before `timeoutMs`. At that point the parser is back inside the `nodes` array. It can read `"timeoutMs"` as an array string element, then reports an error at the following colon. The parser's “expected comma or closing bracket” therefore describes the detection point; it does not justify inserting a comma there. A punctuation-only scan confirms the open containers at the first `timeoutMs` are the outer object, workflow object and nodes array; the node object has already closed. The unchanged excerpts are recorded in `D/exact-syntax-and-feedback.json`.

The second response repeats that local defect while changing descriptions and rationale. The third response removes the premature closure, but the map body still has `acceptance: []`. The same empty-array text was present in both malformed responses. Those earlier strings cannot be treated as parsed programs; their later defects are textual observations only. The third response produces the canonical workflow hash `cd971df69cf87e3eb30a7297ba08d3f167de5acc9e4cbfe86c70d67c34afb06a` and remains schema-invalid.

The host preserved the full preceding response in the second and third prompts. However, the accompanying error contained only `CANDIDATE_FORMAT` and “Model response is not valid JSON.” It omitted the native parser's location and excerpt. The actual prompt ranges are `H/.../02/prompt.txt:1073-1080` and `H/.../03/prompt.txt:1073-1080`; exact prior-text hashes match the responses. No suite failure, capability invocation or runtime trace reached the architect, because neither earlier response passed parsing. The final schema rejection occurred after the third and last allowed response, so no fourth repair feedback was consumed.

The original prompt selected `workflow-foundry` and `runtime-native`, with domain `general`; no domain-specific skill was loaded. The native skill explicitly described root acceptance as nonempty at `H/snapshot/skills/runtime-native/SKILL.md:119-122` but only said body acceptance is checked each iteration at lines 60-66. The actual schema already required a nonempty array for every body through `definitions.flow.acceptance` and `definitions.checks` (`H/snapshot/schemas/workflow.schema.json:59-63`). The host correctly rejected the empty body. Clearer skill wording addresses a construction omission; no schema relaxation is needed.

The later provider availability failure is a separate condition. `research/reference-swe/runs/20260913-reference-02/bucket-foundry/outcome.json:14-43` records HTTP 429 / `FreeUsageLimitError` with a 13:33:15 GMT response header. These browser-demo responses completed around 13:25-13:27 and each has an exported model identity and zero-cost receipt. The later rate limit cannot explain their syntax or schema defects.

## Reference and capability audit

The third candidate's eight root nodes and one nested task were inspected without changing the program. Its extraction path is correct. A native map returns each body's output object keyed by the body node id, so `nodes.batchMap.items` contains records such as `{sumBatch: {value: ...}}`; `core.pluck` must select `sumBatch.value`. That is exactly what this candidate specifies. The map's `count`, pluck's `items` and `count`, aggregate's `value`, serializer's `text`, and artifact's `name` are all documented outputs. Sources: `H/snapshot/src/runtime.mjs:261-271` and `H/snapshot/src/capabilities.mjs:72-99,112-136`.

The local `item` reference supplies the current inner array to `core.aggregate`. The summary's references to earlier map/count outputs are available through transitive dependencies. Validation and the explicit assertion precede artifact creation. There is no evidenced missing capability, invented output field, cross-frame reference, or unsupported argument in that chain. In particular, **`nodes.pluckSums.count` is valid**. The observed failure must not be described as a recurrence of the older campaign's flattened map-output bug.

The model's concern that nested `maxItems` might be unsupported was not established. Fifteen isolated input-schema/capability probes using the frozen implementation passed: the seven suite inputs had their expected type-validation results; the exact 20-by-100 bound was accepted; 21 outer arrays, 101 inner elements, boolean/null numbers, scalar inner values and an array root were rejected. The probes execute only the validator capability with the original input schema. They are not executions or passes of the rejected workflow. `D/capability-probes.json` records the distinction.

Static workflow validation does not prove every selected output path exists. Its semantic pass checks reference roots and dependency scope (`H/snapshot/src/validate.mjs:98-120`); capability argument validation runs after actual reference resolution. A neutral map regression confirms a shortened `payload` path can pass static validation and fail with `MISSING_REFERENCE` on nonempty input, while an empty map never traverses that path. A separate correct `emit.payload` control succeeds. This establishes a general testing requirement, without attributing the neutral defect to the model candidate.

## Oracle and numeric limits

The candidate's local acceptance checks only the returned artifact name. Its count assertion compares projection count with map count; it does not independently establish arithmetic correctness. The original suite's four valid cases compare the artifact's full parsed JSON, including absence of unexpected properties, so local acceptance alone cannot qualify those outcomes. Artifact JSON equality is semantic; it does not establish a particular whitespace or key ordering.

The three invalid-input cases accept either `input-rejected` or `failed`, coupled with absence of `summary.json`. An isolated synthetic workflow that unconditionally calls `core.fail`, without inspecting input, was run against the unchanged suite. All seven runs fail with `INJECTED_FAILURE`; the three negative cases nevertheless receive credit, and the four positive cases reject it. The suite result remains false. This **3/7 score belongs exclusively to the synthetic oracle probe**, not to any model output. See `D/synthetic-oracle-probe.json` and its separate case stores. The probe demonstrates why negative-case credit alone does not prove deliberate validation. A future diagnostic can distinguish recognized validation failures from unrelated crashes, but these frozen expectations were not changed.

The suite also lacks at-limit/over-limit cases and a numerical precision envelope. The input schema accepts finite values such as `[1e308, 1e308]`, while the actual sum capability rejects their overflowing aggregate with `AGGREGATE_OVERFLOW`. Separate direct capability calls produce 1 for a flat sum of `[1e16, -1e16, 1]` and 0 when the final pair is summed first. Binary64 rounding makes grouping observable. Supporting every finite input therefore requires an explicit overflow/precision interpretation or different arithmetic capabilities; seven modest values cannot qualify that wider claim. These are direct capability counterexamples, not runtime failures observed in the rejected candidate.

No budget mismatch was found in the candidate's declared 150 steps, concurrency 2, 60,000 ms and zero cost. The suite checks enumerated outcomes rather than independently requiring every natural-language budget field. The runtime enforces its own execution limits; a task-outcome receipt alone would still need careful interpretation of the advertised input and budget envelope.

## Minimal generic improvement and validation

The agreed improvement preserves the earliest construction failure in usable form: **strictly reject malformed response bytes, retain a bounded native syntax location and excerpt in host repair feedback, and require each nested body to carry its own nonempty runtime acceptance.** The companion skill paragraph distinguishes body acceptance from loop termination. It contains no batch-specific expected values, replacement workflow, or task answer. Prime implemented the shared parser and skill change; worker-10 edited no shared source or skill.

The updated parser reports UTF-16 offset, line, column and a bounded excerpt. Neutral tests cover Unicode, multiline/fenced JSON, malformed endings, repeated documents, prose, comments and trailing commas. Map and loop fixtures reject empty or constant-only acceptance. An actual generator test verifies that rejection details and the unchanged prior response reach the next named offline fixture callback, and that rejected candidates never invoke the evaluator or create proposals. These tests preserve the stricter rejection behavior; they do not show that a model repairs more reliably.

The exact historical response sequence was then replayed through two real generator/store/evaluator configurations: the original frozen host and a separately frozen current host. Each uses a named inert replay provider with zero external calls. Both report two parse failures and one schema rejection, with zero evaluator calls and zero workflow/proposal/run/qualification records. The actual evaluation entrypoint also rejects the unchanged third workflow before creating case stores. Current feedback contains offsets 1837 and 1884 where original feedback contains no details. No artifact was repaired or promoted, and no model was given the new feedback.

`D/neutral-tests.stdout` records **16 passed tests, zero failures** across `tests/ui-live-contract.test.mjs` and `tests/ui-contract.test.mjs`. This is offline construction/static UI verification. Existing browser/restart evidence remains attached to the original frozen UI; no new browser run is implied by these tests.

The first offline attempt, `runs/2026-09-13T13-48-56-303Z-offline-aKIUxY/`, remains failed and preserved. Its manifest omitted UI assets imported by the existing UI contract test; the seven owned tests passed, but that test module could not load. The corrected follow-up used a new directory and source snapshot. The original product freeze selection was also extended to include the new neutral fixture imported by its tests. Neither manifest correction modifies an earlier snapshot.

## Individual task-case metrics

| Case | Original expected outcome | Original trial | Both unchanged-text host replays | Revision |
| --- | --- | --- | --- | --- |
| positive | Artifact has batchCount 2, grandTotal 10 | Not run | Not run | Not attempted |
| negative-and-empty | Artifact has batchCount 2, grandTotal -1 | Not run | Not run | Not attempted |
| empty | Artifact has batchCount 0, grandTotal 0 | Not run | Not run | Not attempted |
| fractional | Artifact has batchCount 1, grandTotal 4 | Not run | Not run | Not attempted |
| string-number | Rejection/failure, artifact absent | Not run | Not run | Not attempted |
| missing | Rejection/failure, artifact absent | Not run | Not run | Not attempted |
| extra-field | Rejection/failure, artifact absent | Not run | Not run | Not attempted |

The machine-readable metrics are `D/individual-case-metrics.json`: registered 7, executed 0, passed 0, failed 0, not run 7, execution success fraction `null`. Per-case `passed` and `runId` are null. Creation is false with `GENERATION_EXHAUSTED`; revision calls remain zero. The original cost/provenance and successful synthetic browser controls remain useful evidence of their own scopes.

To repeat only this offline analysis from the repository root:

```sh
node research/product-demo/offline.mjs \
  --history research/product-demo/runs/2026-09-13T13-23-00-987Z-Ld5AC8
```

It writes a new snapshot and new diagnostic stores, uses saved text and local synthetic controls, and never invokes OpenCode. A future model evaluation of the improved feedback remains unmeasured and requires its own authorized budget after provider availability returns.
