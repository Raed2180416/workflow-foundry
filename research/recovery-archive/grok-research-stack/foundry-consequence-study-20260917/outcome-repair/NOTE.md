# Outcome repair coordinator: completed bounded development validation

The native addition is installed in
`/home/raed/Projects/workflow-foundry/src/outcome-repair.mjs`, with regression tests
in `tests/outcome-repair.test.mjs`. It is ready for the prime's explicit host CLI
consumer and subsequent separately measured model repair experiment. The public
method signatures in `API.md` are unchanged. No model calls or benchmark hidden
suite reads were made by this worker.

## Concrete gap and completed trajectory

The actual unchanged `Store.createDiagnosticRepair` requires a terminal failed
run. The preserved original witness at `artifacts/legacy-witness-DxhxG9/` records a
run that wrote wrong JSON, returned `succeeded`, failed an actual content
comparison, and received legacy `REPAIR_RUN_STATE` when repair was requested.

The new coordinator permits a separate, explicitly requested repair after an
unsatisfied host observation. It preserves the original green run, its event
chain, and artifact bytes. It does not relabel the runtime status as failed.

The durable v2 witness is `artifacts/trajectory-v2-b44wYu/RESULT.json`:

| Supplied defect | First runtime | Observation | Repaired version/runtime | New observation |
| --- | --- | --- | --- | --- |
| Wrong JSON contents | `succeeded` | `unsatisfied / json-content-mismatch` | v2, `succeeded` | `satisfied` |
| Wrote `different.json`, omitted required `record.json` | `succeeded` | `unsatisfied / required-artifact-absent` | v2, `succeeded` | `satisfied` |

Both trajectories execute the actual request, proposal, apply, runtime and
artifact paths. They preserve parent/root, goal, success criteria, old run state
and original bytes. Both legacy repair attempts still reject `REPAIR_RUN_STATE`.
Both have zero generation jobs and zero model calls. Supplied corrected workflows
are explicit development controls, not model construction/repair successes.
Each trajectory directory includes complete contract, context, request, proposal,
run, event and observation JSON, plus the actual retained Store and artifact files.

## Revision requested by prime

`designContext` now includes `outcomeRepair.comparison`. For the wrong record,
the actual prompt contains expected `label: requested`, observed `label: wrong`,
and the `/label` difference with both values. The data comes from the frozen host
contract and preserved receipt bytes; mutable caller objects and diagnostic prose
do not supply the comparison. The generator regression checks those values inside
the actual `WorkflowGenerator` prompt through an explicitly invoked offline
callback.

Full JSON values are included through 16 KiB per side. Larger values receive
visibly truncated display previews and up to 16 JSON Pointer differences, each
with bounded values and paths. The exact assessment still compares full supported
JSON and binds all observed bytes. Missing keys are distinguished from JSON null;
array ordering and pointer escaping are covered. Malformed JSON has a bounded
data preview. All embedded strings remain data, not instructions.

Required-file absence is now distinct from unavailable observation. A confirmed
`lstat` ENOENT under accessible, checked real Store directories, with no completed
producer for the required basename, is unsatisfied. A completed successful
producer followed by missing bytes is unknown. Missing artifact directories after
a producer and filesystem access/I/O errors are also unknown. Tampered bytes,
symlinks and inconsistent bindings fail with an explicit evidence/path error.
Unknown observations and unavailable observers cannot create repair requests.

The prior module, tests and API are preserved with hashes at
`artifacts/pre-revision-20260917T032539Z/`. Their 31/31 baseline tests are retained
there; their former all-missing-is-unknown behavior remains recorded as history.
Observer identity is now `exact-json-artifact/2`, with source and platform hashes.
Historical source-bound contracts are not silently reinterpreted.

## API and provenance

`registerContract`, `contract`, `observe`, `receipt`, `verify`, `requestRepair`,
`designContext`, `propose`, `apply`, and `generationHost` remain the public methods.
No authority override input is accepted. Host registration records the supplied
expectation and its provenance; it does not assert independently established
truth. No interpretation of arbitrary business outcomes is implemented.

`generationHost()` retains the actual `store`, `registry` and `validate`, and
overrides only `designContext`, `propose` and `apply`. Those are the Foundry
surfaces required by the inspected `WorkflowGenerator`. Existing job lifecycle,
proposal validation and apply CAS remain in their original implementations.
The facade's construction, contract registration and repair request do not start
generation, execution, approvals or a request processor.

Requests retain `source: agent-diagnostic` for the existing Store's goal/criteria
guard. They use `observedRunId`, `observedRunStatus` and `outcomeReceiptId`, with no
`failedRunId` or fabricated runtime error. The adapter projects an explicit outcome
source only into the old design-context builder; persisted intent remains guarded.

Same-root/input/artifact contracts cannot be replaced, including by a descendant
repair request. Identical registration returns the same ID. Different expected
JSON/evaluator conflicts; evaluator implementation/platform or registry drift
cannot qualify a new run. Original contracts remain reusable by descendants with
the same input and registry. Tests cover repeated observation and repair across
Store connections, stale versions, cross-run/root/input substitution, tampered
artifact/event/checkpoint/request evidence, changed goals/criteria and depth limits.

## Validation and exact evidence

`artifacts/revision-tests-01/TEST_RUN.json`: focused regression suite, **41 pass,
0 fail, 0 skipped**.

`artifacts/verification-v2-R9ZwN9/REPORT.json` records:

* `node --check src/outcome-repair.mjs` and the test file: exit 0.
* `node outcome-repair/trajectory.mjs`: both durable native trajectories pass.
* `npm run check`: exit 0 on Node v24.21.0.
* `npm test`: **518 tests, 514 pass, 0 fail, 4 optional skips**, exit 0.

The full local source snapshot is stable through verification (`sourceChanges:
[]`). All eight hashes in `artifacts/source-before.sha256` still match: Store,
runtime, Foundry, data helpers, capabilities, generator, engine and validator.
No formatter, linter or typechecker scripts are declared in package.json.
The broad suite used ordinary defaults; optional browser, packaging and expanded
MCP checks are not represented as executed checks.

Module SHA-256:
`8de15af4b6ce842c3e54039531c651472a9079a231bf31390f4a8f95b924f1fd`

Tests SHA-256:
`216692223b1f7c081e2a2909f5e28bac94f62a94898731887e5d94b8878e65f3`

Rerun from the Foundry checkout with:

```sh
node --test tests/outcome-repair.test.mjs
node ../grok-research-stack/foundry-consequence-study-20260917/outcome-repair/verify.mjs
```

The runner creates a fresh evidence directory on every explicit invocation.

## Limits and remaining integration evidence

This is deterministic local JSON artifact comparison under a host-supplied
expectation, a trusted Store and a trusted local administration boundary. It is
not a proof of the expectation's correctness, arbitrary user intent, deployed
business outcomes or protection from a database administrator replacing the
ledger. Present bytes require completed `core.artifact` provenance; other artifact
providers are outside this first observer. JSON uses Foundry canonicalization and
bounded finite JavaScript numbers, not arbitrary-precision JSON arithmetic.

Model-visible repair context deliberately discloses the registered expectation
as development feedback. A hidden evaluator must not be wired into this context.
A hidden pass/fail label alone cannot identify a repair. The prime's actual model
repair and host CLI are separate integration work, not counted as completed here.

Observations are immutable per exact request/proposal/run/contract binding. An
unknown receipt is not upgraded after the filesystem changes: verification then
blocks. A new run can receive a new observation under the same contract. No
contract migration or general observation-recovery framework was introduced.

Serena `initial_instructions`, `project_quality_map`, and the full local
`security_scan` each returned HTTP 404 `tunnel_client_not_seen`. No plugin security,
symbol or remote CI success is claimed. Local tests and direct source evidence are
successful; independent plugin security/quality review remains unverified. No
nested workers were created. A final batched read/git inspection was separately
blocked by the tool's safety-status check; it did not execute or alter the completed
tests and their receipts.
