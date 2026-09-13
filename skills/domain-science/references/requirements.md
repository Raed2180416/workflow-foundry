# Science requirement cases

Status: **proposed-contract-cases-not-runtime-verification**. These are proposed contract cases, not passed runtime tests.

Synthetic identifiers and computational data only; no laboratory procedures or physical actions.

This progressive-reading document is rendered from [requirements.json](requirements.json), SHA-256 `99d5d6ccda9c84119aec1c9f448feec9e467f6c7de247c71d119364e7e5b27a9`. The JSON remains the machine-readable source. Source IDs resolve in [source-map.md](source-map.md).

## science-001

Every required metric is present, finite, unit-compatible and associated with the current evaluation revision before a candidate passes.

**Evidence:** [SCI-B1](source-map.md#sci-b1).
**Enforcement:** Deterministic artifact validator before a claim or promotion node.

**Synthetic precondition:**

```json
{
  "required": [
    "metric_a",
    "metric_b"
  ],
  "scores": {
    "metric_a": 1
  },
  "criterionRevision": "r1"
}
```

**Trigger:** Evaluate required evidence.
**Required observation:** Return incomplete for missing metric_b, never pass.

**Positive control:** Both required metrics, compatible units and r1 criteria yield pass only when both predicates pass.

**Tradeoff:** Stricter gates increase explicit pending states and may require additional measurements.

## science-002

A consuming node verifies content identity, producer and input lineage for every required artifact.

**Evidence:** [SCI-B1](source-map.md#sci-b1), [SCI-R1](source-map.md#sci-r1).
**Enforcement:** Artifact store and node admission.

**Synthetic precondition:**

```json
{
  "recordedHash": "hash-a",
  "currentHash": "hash-b",
  "path": "results/table.csv"
}
```

**Trigger:** Consume the artifact at its unchanged path.
**Required observation:** Reject stale evidence and invalidate dependent results.

**Positive control:** Matching content hash and producer/input revisions permit consumption.

**Tradeoff:** Hashing and lineage storage add I/O; hashes establish identity rather than truth.

## science-003

A parallel join requires the declared branch set and artifacts, not a success ratio or majority vote.

**Evidence:** [SCI-R1](source-map.md#sci-r1), [SCI-R2](source-map.md#sci-r2).
**Enforcement:** Join scheduler and artifact reconciliation.

**Synthetic precondition:**

```json
{
  "requiredBranches": [
    "a",
    "b",
    "c"
  ],
  "remoteSuccess": [
    "a",
    "b",
    "c"
  ],
  "downloadedArtifacts": [
    "a",
    "b"
  ]
}
```

**Trigger:** Enter the consensus node.
**Required observation:** Remain incomplete because branch c lacks its required artifact.

**Positive control:** All declared branch outputs present and verified permit the join.

**Tradeoff:** Tail latency becomes visible; partial analysis must be an explicitly different contract.

## science-004

Record durable intent before external effects and record failures even when the tool throws.

**Evidence:** [SCI-L3](source-map.md#sci-l3).
**Enforcement:** Effect adapter and protected journal.

**Synthetic precondition:**

```json
{
  "adapter": "fake",
  "toolBehavior": "accept-then-throw"
}
```

**Trigger:** Dispatch one permitted synthetic operation.
**Required observation:** Retain its intent and unknown-effect/failure evidence; do not report clean success or retry blindly.

**Positive control:** A fake operation with confirmed outcome produces intent, acceptance and completion records.

**Tradeoff:** Durable writes add latency and require reconciliation after crashes.

## science-005

An unavailable authoritative journal blocks new external effects and cannot be repaired by a success claim from the executor.

**Evidence:** [SCI-L2](source-map.md#sci-l2), [SCI-L3](source-map.md#sci-l3).
**Enforcement:** Admission boundary outside the agent-writable workspace.

**Synthetic precondition:**

```json
{
  "journalWritable": false,
  "toolWouldReturn": "success"
}
```

**Trigger:** Request a new external effect.
**Required observation:** Block before invoking the fake tool.

**Positive control:** A durable independent journal accepts the intent and permits the authorized fake operation.

**Tradeoff:** Availability decreases when evidence cannot be persisted; this is intentional for this profile.

## science-006

Validate nested types, finite values, units and configured bounds; unresolvable schemas are not permission to skip validation.

**Evidence:** [SCI-L4](source-map.md#sci-l4).
**Enforcement:** Trusted adapter schema validator.

**Synthetic precondition:**

```json
{
  "schema": "array of finite synthetic scalar readings",
  "value": [
    1,
    "untyped"
  ]
}
```

**Trigger:** Validate a fake instrument input.
**Required observation:** Reject the nested invalid value before invocation.

**Positive control:** A finite, correctly typed and unit-compatible array passes the same schema.

**Tradeoff:** Adapters need domain schemas; automatic type-hint inference alone is insufficient.

## science-007

Workflow, tool-schema and input revisions bind approvals; a change invalidates affected approvals and evidence.

**Evidence:** [SCI-L1](source-map.md#sci-l1), [SCI-B1](source-map.md#sci-b1).
**Enforcement:** Proposal store, admission validator and capability broker.

**Synthetic precondition:**

```json
{
  "approvedWorkflow": "r1",
  "currentWorkflow": "r2",
  "change": "tool-schema"
}
```

**Trigger:** Resume an approved node using the old approval.
**Required observation:** Block until the new revision receives the required authorization and checks.

**Positive control:** An unchanged revision with valid approval and fresh state can proceed.

**Tradeoff:** Revalidation costs increase with the number of affected dependencies.

## science-008

An await timeout cannot be treated as proof that a synchronous worker or external effect has stopped.

**Evidence:** [SCI-A1](source-map.md#sci-a1), [SCI-R1](source-map.md#sci-r1).
**Enforcement:** Execution supervisor and adapter reconciliation.

**Synthetic precondition:**

```json
{
  "fakeWorker": "continues-after-await-timeout",
  "accepted": true
}
```

**Trigger:** The node deadline expires.
**Required observation:** Mark the effect unknown and reconcile it before any retry or conflicting operation.

**Positive control:** A confirmed cancelled pure computation may be retried within budget.

**Tradeoff:** Effectful adapters need status queries or acknowledged cancellation.

## science-009

Notebook re-execution cannot replay an external effect; error outputs are checked independently of process exit.

**Evidence:** [SCI-F1](source-map.md#sci-f1).
**Enforcement:** Notebook sandbox and effect routing policy.

**Synthetic precondition:**

```json
{
  "cells": [
    "pure-transform",
    "fake-external-write"
  ],
  "editTriggersFullRerun": true
}
```

**Trigger:** Edit a later cell.
**Required observation:** Reject or isolate the external-write cell; never duplicate the effect through notebook replay.

**Positive control:** A pure synthetic transformation reruns reproducibly and produces checked artifacts.

**Tradeoff:** Convenient stateful notebooks need restructuring at effect boundaries.

## science-010

A required execution budget remains enforced when a backend rejects resource limits.

**Evidence:** [SCI-L2](source-map.md#sci-l2).
**Enforcement:** Sandbox admission and global budget accounting.

**Synthetic precondition:**

```json
{
  "strictResourceProfile": true,
  "backendRejectsLimits": true
}
```

**Trigger:** Create the fake execution environment.
**Required observation:** Fail admission rather than retry without limits.

**Positive control:** A backend that attests the requested limits permits a bounded computation.

**Tradeoff:** Some environments become unsupported instead of silently weaker.

## science-011

A simulation or benchmark episode cannot grant physical capabilities or establish a physical outcome.

**Evidence:** [SCI-F1](source-map.md#sci-f1), [SCI-D1](source-map.md#sci-d1), [SCI-E1](source-map.md#sci-e1), [SCI-P1](source-map.md#sci-p1).
**Enforcement:** Capability broker, environment binding and result classification.

**Synthetic precondition:**

```json
{
  "mode": "simulation",
  "episodeDone": true,
  "requestedCapability": "physical-adapter"
}
```

**Trigger:** Promote the generated workflow.
**Required observation:** Require separate authorized deployment evidence; keep the prior result simulation-only.

**Positive control:** A simulation remains executable against its fake adapter without physical permissions.

**Tradeoff:** Deployment needs a distinct adapter conformance and safety process.

## science-012

Failure, truncation and answer submission remain distinct from satisfying a scientific postcondition.

**Evidence:** [SCI-F1](source-map.md#sci-f1), [SCI-D1](source-map.md#sci-d1).
**Enforcement:** Terminal-state reducer and result evaluator.

**Synthetic precondition:**

```json
{
  "done": true,
  "reason": "exception",
  "postconditionVerified": false
}
```

**Trigger:** Aggregate the run outcome.
**Required observation:** Report failure, not successful scientific completion.

**Positive control:** A successful execution with independently verified required evidence may satisfy its stated computational claim.

**Tradeoff:** Metrics need more outcome categories than a single completion boolean.
