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

Receipts distinguish `satisfied`, `unsatisfied`, and `unknown`. Missing artifact
observation is unknown and cannot open the unsatisfied-outcome repair path. Exact
JSON content is the bounded oracle; local runtime success is insufficient.

Requests use `source: agent-diagnostic` solely to retain existing goal/criteria and
generation compatibility. Outcome requests have `observedRunId` and
`outcomeReceiptId`, never `failedRunId` or a fabricated runtime failure.
Use adapter `designContext` and `generationHost`: the unmodified legacy builder
expects fields for runtime failures. The adapter uses a read-only source projection
for the existing builder, then adds explicit outcome evidence and a fresh context
hash. Actual persisted request source remains guarded by Store.

Bindings include request/proposal/root, workflow/registry/input, event head, entire
terminal run, exact artifact bytes, frozen expectation and evaluator source/platform.
Artifact evidence must include a matching completed `core.artifact` event; no
expected workflow node IDs are required. `receipt(id)` preserves historical bytes;
`verify(id)` rechecks current bindings and live bytes. Repair, propose and apply use
verification; apply retains the existing version CAS.

The separate immutable ledger uses Store.db. This is trusted-host integrity, not
protection from a database administrator who can replace tables/triggers. The
observer proves only its bounded JSON comparison, not general business intent,
scientific truth, permission to execute, or arbitrary deployment readiness.

Recommendation: use the separate host observer/coordinator for green-but-wrong
outcomes; retain the legacy failed-run guard and original run/artifact evidence.
