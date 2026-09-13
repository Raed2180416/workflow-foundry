---
name: runtime-native
description: Compile a workflow into Workflow Foundry's executable bounded JSON IR, resolve validation errors, and preserve native dependency, retry, human-pause, map and loop semantics.
license: LicenseRef-Project-Pending
compatibility: Workflow Foundry 0.1.0, schemaVersion 1.0, Node 24 or newer.
---

# Native workflow construction

Read the **current** `schemas/workflow.schema.json` or MCP schema resource. Do not
guess fields from LangGraph/n8n or earlier examples. Unknown properties are errors.

Top-level required fields: `schemaVersion: "1.0"`, `id`, `version`, `title`,
`goal`, `domain`, `envelope`, `budget`, `nodes`, `acceptance`. The first version
is 1. `envelope` contains arrays `assumptions`, `risks`, `successCriteria`, with
optional `unsupported`. `budget` requires positive integer `maxSteps`,
`maxConcurrency`, `maxDurationMs`; optional `maxCost` is a nonnegative ceiling.

Every node needs `id`, `kind`, `needs: []`, and `description`. Dependencies form a
DAG; only explicit bounded control nodes perform iteration. Do not use reserved
object-property names as ids. The node descriptions should explain why each step
exists, not merely restate its tool name.

| Kind | Additional fields | Output |
|---|---|---|
| task | tool, args, timeoutMs, retry:{maxAttempts,backoffMs?}; optional onError | Actual validated capability output |
| assert | checks:[condition,...] | {passed:true}, or failure |
| human | question, answerSchema | {answer: userValue}; pauses first |
| wait | delayMs | {waitedMs}; durable waiting, resume when due |
| map | items, maxItems, body:{nodes,acceptance}, optional input | {items:[bodyOutputs,...],count} |
| loop | initial, maxIterations, until, body, optional input | {iterations,last:bodyOutputs}; fails on exhaustion |

`when` is optional on any node. A false condition skips the node without producing
an output. Dependencies default to `join:"all_success"`; a skipped or handled-error
prerequisite skips its dependent node. To deliberately join alternative branches,
use `join:"all_resolved"`, then guard/default any missing output. Never use a
permissive join to bypass a required safety/verification guard. All
reads of another node's output must name that node directly or transitively in
`needs`. Join dependent branches before final verification.

## References and conditions

Use JSON values or a reference object: `{"$ref":"input.name"}`,
`{"$ref":"nodes.observe.errorRate"}`. Optional `default` handles a genuinely
absent value, not a mismatched type. Reference objects contain only `$ref` and
`default`. No JavaScript, eval, shell interpolation, JSONPath or function syntax.

Conditions are objects:

```json
{"op":"eq","left":{"$ref":"nodes.verify.healthy"},"right":true}
```

Operators: `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `in`, `contains` use `left` and
`right`; `exists` uses `value`; `all`/`any` use `conditions`; `not` uses
`condition`. Numeric comparisons require actual numbers. Equality does not coerce
strings or booleans. `exists` handles missing references; other comparisons fail
on missing evidence unless a default is provided.

Map bodies additionally receive `item` and `index`. Loop bodies receive
`iteration` (zero-based) and `previous` (initial value on the first iteration,
previous body's output object thereafter). `nodes` always refers to the current
body's node outputs. A control node's optional `input` binds parent values to the
child's `input`; otherwise the original input is retained. `until` observes the
just-completed body outputs and the current iteration locals. Body acceptance is
checked every iteration. Nested steps consume the same parent budget.

Every map or loop `body` requires its own **nonempty** `acceptance` array with an
actual runtime observation. An empty array is invalid even when the outer workflow
has acceptance checks. For a loop, body acceptance checks the completed iteration;
`until` separately decides whether to stop iterating. Before submission, inspect
each nested body, its output shape and its checks. Refer to fields documented by
the capability output schema; a similarly named tool does not imply the same fields.

For query/action history, loop initialization/recurrence, nested extraction and
neutral construction controls, read [control dataflow](references/control-dataflow.md).

### Preserve node names when leaving a nested flow

A body returns an **object keyed by its node ids**, not the output of its last
node. For example, if each map iteration has a task `measure` returning
`{"value":7}`, the map returns:

```json
{"items":[{"measure":{"value":7}},{"measure":{"value":9}}],"count":2}
```

The corresponding `core.pluck` field is `"measure.value"`, not `"value"`.
Similarly a loop output uses `last.measure.value`. Inspect an actual nonempty
iteration; an empty map can hide a wrong extraction path. Do not add JavaScript
or `[]` JSONPath syntax to references. A `core.aggregate` field is interpreted
relative to each supplied value, using the same own-property traversal rules.

When the host asks for an architect response, return exactly
`{"workflow": <complete IR object>, "rationale": <nonempty string>}`. These
wrapper keys are not fields inside the workflow. Keep the JSON syntactically
complete; do not duplicate root fields outside the wrapper or silently omit the
rationale. A native workflow file itself contains only the IR object.

## Tools, effects and completion

Choose names and argument fields from `foundry_capabilities`. Tool implementations
and authority are host-owned. A generated workflow cannot redefine them. Default
tools include local JSON/text/artifact operations and an explicitly labeled incident
simulator; these do not constitute browser, production SRE, clinical or lab access.
Missing external tools must be registered through trusted adapters before execution.

### Preserve input types across the MCP boundary

`foundry_run` requires `workflowId` and an actual **object** in `input`, such as
`{"workflowId":"NumericRollup","input":{"values":[3,7,11]}}`. A string that
looks like JSON is still a string and must be rejected. Do not retry the same
wrong wire type while claiming the object was corrected.

For scalar, array or null roots, or a client that cannot transmit a nested object,
use the separately named `foundry_run_json` with `inputJson` containing exactly
one JSON document. That transport explicitly parses once; the saved workflow
input schema is still enforced. Double encoding is not repaired implicitly.
Use the actual tool response and inspected run input as evidence of the type
received by the host. Neither representation grants approval or weakens a gate.

Declare bounded task attempts and timeouts. Non-idempotent capabilities cannot have
automatic retries. `onError:"continue"` creates `{ok:false,error:...}` with a
`handled_error` status; a downstream recovery branch must explicitly use
`join:"all_resolved"`. It does not establish success, and downstream acceptance
must handle that result. Unknown
effects after timeout/crash become uncertain rather than being guessed successful.

Root `acceptance` is a nonempty array of conditions over actual runtime evidence.
Constant-only acceptance is rejected. An assertion can still be semantically weak:
independent task evaluation must reject wrong outputs even when local acceptance
passes. Model-created acceptance never supersedes the user's task contract.

Run the validator, execute the candidate with representative input, inspect exact
events and revise from observed failures. Do not call the workflow validated merely
because this skill was followed. Runtime mappings and their restrictions are tested
by `tests/`; consult current receipts before claiming support.

## Draft execution and delivery

Use `foundry_trial` with the current request id, exact candidate workflow and an
actual object input before applying a draft. `foundry_trial_json` is the explicit
serialized-root alternative. Trials keep competing same-version drafts separate;
they do not advance the saved workflow head or consume the request. Read the
host-provided trial capability policy: an isolated database is not permission to
perform external effects. Inspect the receipt with `foundry_inspect_trial`.

Propose the exact tested candidate. After application, run and inspect that exact
version. `foundry_delivery` checks request/proposal/run linkage; do not combine an
old proposal with a newer standalone run. Local successful execution is still not
an independent task oracle.

If an applied run fails, use `foundry_request_repair` with the original request id,
actual failed run id and exact current workflow hash. It creates a new diagnostic
request and next version while preserving the original goal and success criteria.
It does not claim to be new human intent, grant consent or automatically dispatch
a model. Uncertain effects, pending human decisions and cancelled work cannot be
repaired by secretly starting another run. Ask for reconciliation when required.

The validator also checks declared structural output paths. It can reject a field
excluded by a closed capability schema or a missing map/loop body-node wrapper.
Unknown/open schemas stay unknown. Existence probes, explicit defaults and
conditional/short-circuit reads retain their runtime meaning; warning-free syntax
is not proof of reachable, causal or correct execution. A possible later iteration
is not inevitable just because `maxIterations` exceeds one.

Each new run records its native engine identity as well as workflow/capability
hashes. A changed engine cannot silently resume a pending old run. Use the recorded
frozen engine or a separately reviewed new run; old evidence remains inspectable.
Definitions may be revalidated for a new engine, but saved execution state must
not be relabeled compatible without an explicit migration qualification.
