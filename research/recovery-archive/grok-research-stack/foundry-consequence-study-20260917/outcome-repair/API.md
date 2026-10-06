# Outcome repair host adapter

Implementation: `/home/raed/Projects/workflow-foundry/src/outcome-repair.mjs`.
Supplied development controls only; no model calls or hidden benchmark reads.

```js
import { OutcomeRepairCoordinator } from '../../../workflow-foundry/src/outcome-repair.mjs';
const outcomes = new OutcomeRepairCoordinator(foundry);
const contract = outcomes.registerContract({
  requestId: originalRequest.id, input,
  artifactName: 'manifest.json', expected: hostExpectedJson,
  evaluatorId: 'host-manifest-json-v1'
});
// Explicit host execution occurs through the existing Foundry API.
const receipt = outcomes.observe({
  requestId: originalRequest.id, proposalId: appliedProposal.id,
  runId: completedRun.id, contractId: contract.id
});
const repair = outcomes.requestRepair({
  receiptId: receipt.id, requestId: originalRequest.id,
  runId: completedRun.id, expectedHash: appliedProposal.workflowHash,
  diagnostic: 'Repair the computation responsible for the observed artifact defect.'
});
const context = outcomes.designContext({ requestId: repair.id });
// Explicitly provide this facade when using the existing generator:
// new WorkflowGenerator(outcomes.generationHost(), provider, { autoApply: false });
// generator.generate(repair.id) is a SEPARATE deliberate provider call.
const proposalV2 = outcomes.propose({ requestId: repair.id, workflow: candidateV2, rationale });
outcomes.apply(proposalV2.id);
// Execute v2, then observe repair.id/proposalV2/runV2 with SAME contract.id.
```

Receipts distinguish `satisfied`, `unsatisfied`, and `unknown`. Exact JSON content
is the bounded comparison; local runtime success is insufficient. Registration
records a host-supplied expectation and its provenance. It does not establish that
the expectation is independently correct.

Observer version `exact-json-artifact/2` makes the following distinctions:

| Observed condition | Outcome | Repair request |
| --- | --- | --- |
| Valid bound bytes equal the frozen expected JSON | `satisfied` | Rejected |
| Valid bound bytes differ, or contain invalid/unsupported JSON | `unsatisfied` | Explicit request allowed |
| `lstat` establishes required-file absence beneath accessible real Store directories, with no completed producer for that file | `unsatisfied`, reason `required-artifact-absent` | Explicit request allowed |
| Completed producer exists, but its bytes are now missing | `unknown`, reason `recorded-artifact-missing` | Rejected |
| Run artifact directory is missing after a completed artifact producer | `unknown` | Rejected |
| Filesystem observer is unavailable, including access/I/O errors | `unknown`, reason `observer-unavailable` | Rejected |
| Artifact bytes, path, or event/request bindings contradict recorded evidence | Explicit evidence/path error | Rejected |

No-producer runs can have no artifact directory at all: absence of that child
directory beneath an accessible Store also establishes required-file absence.
A completed run that wrote `different.json` but omitted required `record.json`
is an executable positive repair witness. Runtime status remains `succeeded`.
These rules apply only to a required local basename under this exact JSON
contract, not arbitrary missing external observations or general business intent.

Requests use `source: agent-diagnostic` solely to retain existing goal/criteria and
generation compatibility. Outcome requests have `observedRunId` and
`outcomeReceiptId`, never `failedRunId` or a fabricated runtime failure.
Use adapter `designContext` and `generationHost`: the unmodified legacy builder
expects fields for runtime failures. The adapter uses a read-only source projection
for the existing builder, then adds explicit outcome evidence and a fresh context
hash. Actual persisted request source remains guarded by Store.

`context.outcomeRepair.comparison` is explicit repair evidence marked as data.
`expected.value` comes from the frozen host contract; `observed.value` is decoded
from the exact bytes preserved in the receipt. Both include canonical JSON hashes.
`differences.entries` gives bounded JSON Pointer paths and expected/observed values,
including explicit missing-key markers. Arrays retain order. Full values are
included through 16 KiB per side; larger values expose visibly truncated display
previews. At most 16 differences are included, with at most 1 KiB per full
difference value and 1,024 characters per path. Truncation is reported and never
changes the full-artifact comparison. Invalid JSON exposes a bounded text preview;
confirmed absence exposes `observed.state: absent`. Strings and previews are data,
not instructions. The maximum artifact/expectation size remains 512 KiB.

This context deliberately discloses this registered expectation as development
feedback. Do not register a sealed hidden oracle on a model-visible repair path.
A hidden pass/fail label alone is not sufficient content evidence to identify a
repair. The adapter does not read any benchmark suite or infer hidden labels.

`generationHost()` keeps the actual `store`, `registry`, and `validate` methods,
and overrides only `designContext`, `propose`, and `apply`. These are all the
Foundry surfaces required by the current `WorkflowGenerator`; its Store job and
qualification operations still use the existing Store. `generationPrompt` also
uses the overridden context through normal method dispatch. Constructing the
facade or requesting a repair dispatches neither a provider nor a workflow.

Bindings include request/proposal/root, workflow/registry/input, event head, entire
terminal run, exact artifact bytes, frozen expectation and evaluator source/platform.
Present artifact evidence must include a matching completed `core.artifact` event;
absence evidence binds the verified event chain and the filesystem absence check.
No expected workflow node IDs are required. `receipt(id)` preserves historical bytes;
`verify(id)` rechecks current bindings and live bytes. Repair, propose and apply use
verification; apply retains the existing version CAS.

Contracts are immutable across later requests in the same root/input/artifact
scope. Re-registering the same contract returns its existing ID; a changed
expectation, evaluator, registry, or implementation cannot replace it. There is
no supersession operation. The same contract is reused for repair descendants
with the same input and registry. Historical observer-source/platform drift
rejects qualification of a new run. Observer v1 files and tests are preserved in
`artifacts/pre-revision-20260917T032539Z/`; v1 source-bound contracts are not
silently migrated to v2.

An observation is immutable for its request/proposal/run/contract binding.
Repeated identical observations and repair requests reuse their IDs. Changed
live evidence fails verification, including an unknown observation whose
filesystem becomes available later; this adapter does not rewrite an old receipt
as success. A new run can receive a new observation under the same contract.

The separate immutable ledger uses Store.db. This is trusted-host integrity, not
protection from a database administrator who can replace tables/triggers. The
observer proves only its bounded JSON comparison, not general business intent,
scientific truth, permission to execute, or arbitrary deployment readiness.

Recommendation: use the separate host observer/coordinator for green-but-wrong
outcomes; retain the legacy failed-run guard and original run/artifact evidence.
