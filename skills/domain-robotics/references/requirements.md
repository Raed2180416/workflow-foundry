# Robotics requirement cases

Status: **proposed-contract-cases-not-runtime-verification**. These are proposed contract cases, not passed runtime tests.

Fake devices, abstract resources and simulator state only; no physical actuation.

This progressive-reading document is rendered from [requirements.json](requirements.json), SHA-256 `b1e598eeb95fb2dceb8fa494d89b6bf6320910695311266ead10610f52e4ecff`. The JSON remains the machine-readable source. Source IDs resolve in [source-map.md](source-map.md).

## robotics-001

Transport acceptance is distinct from independently observed mission completion.

**Evidence:** [ROB-D1](source-map.md#rob-d1), [ROB-D2](source-map.md#rob-d2), [ROB-D3](source-map.md#rob-d3).
**Enforcement:** Adapter state reducer and mission postcondition.

**Synthetic precondition:**

```json
{
  "httpSuccess": true,
  "commandPublished": true,
  "completionTelemetry": null
}
```

**Trigger:** Evaluate the mission outcome.
**Required observation:** Remain accepted or executing; never report completed.

**Positive control:** Fresh matching fake telemetry satisfying the mission postcondition produces observed completion.

**Tradeoff:** An adapter must expose outcome evidence beyond request transport.

## robotics-002

Idempotency binds actor, device epoch, request ID, workflow revision and payload hash durably.

**Evidence:** [ROB-C1](source-map.md#rob-c1), [ROB-D2](source-map.md#rob-d2).
**Enforcement:** Durable dispatch store.

**Synthetic precondition:**

```json
{
  "requestId": "q1",
  "firstPayload": "hash-a",
  "secondPayload": "hash-b"
}
```

**Trigger:** Reuse q1 with a different payload.
**Required observation:** Reject the conflicting request rather than replaying a cached success.

**Positive control:** The same identity and payload after a process restart returns the recorded outcome without duplicating an effect.

**Tradeoff:** Persistent deduplication needs retention policy and canonical payload hashing.

## robotics-003

Completion evidence must match the current device epoch, command and plan revision and satisfy the configured freshness bound.

**Evidence:** [ROB-D2](source-map.md#rob-d2), [ROB-D3](source-map.md#rob-d3), [ROB-P1](source-map.md#rob-p1).
**Enforcement:** Telemetry validator.

**Synthetic precondition:**

```json
{
  "currentEpoch": "boot-b",
  "telemetryEpoch": "boot-a",
  "sameNumericCommandId": true
}
```

**Trigger:** Receive a late completion observation.
**Required observation:** Reject it as stale evidence.

**Positive control:** Current-epoch telemetry within the supplied age limit is eligible for postcondition evaluation.

**Tradeoff:** Clock and epoch semantics must be explicit across devices.

## robotics-004

Timeout after possible acceptance produces an unknown effect until reconciliation.

**Evidence:** [ROB-D2](source-map.md#rob-d2), [ROB-F2](source-map.md#rob-f2).
**Enforcement:** Command supervisor and adapter status query.

**Synthetic precondition:**

```json
{
  "fakeDeviceAccepted": true,
  "acknowledgementLost": true
}
```

**Trigger:** The response deadline expires.
**Required observation:** Query the prior command outcome before any bounded retry.

**Positive control:** A proven rejection before acceptance can be retried according to the declared budget.

**Tradeoff:** Reconciliation may block progress during an outage.

## robotics-005

Retry count and overall recovery duration are bounded across nested control structures.

**Evidence:** [ROB-D2](source-map.md#rob-d2).
**Enforcement:** Global scheduler budget and adapter retry policy.

**Synthetic precondition:**

```json
{
  "fakeAdapterAlwaysUnavailable": true,
  "maxAttempts": 3
}
```

**Trigger:** Execute inside a loop and map combination.
**Required observation:** Stop attempts at the declared shared limit and preserve a non-success terminal reason.

**Positive control:** Availability restored within the budget permits the same command identity to continue.

**Tradeoff:** Global accounting can reduce parallel throughput but makes limits meaningful.

## robotics-006

Cancellation, interruption, kill and emergency stop have separate ownership and acknowledgement contracts.

**Evidence:** [ROB-C2](source-map.md#rob-c2), [ROB-T1](source-map.md#rob-t1), [ROB-D3](source-map.md#rob-d3).
**Enforcement:** Task state machine and verified deployment adapter.

**Synthetic precondition:**

```json
{
  "cancelRequested": true,
  "cleanupPending": true,
  "stopAcknowledged": false
}
```

**Trigger:** Transfer control to another actor.
**Required observation:** Block conflicting control until the required interruption or safe-state acknowledgement exists.

**Positive control:** An acknowledged interruption and valid lease transfer permit the replacement controller.

**Tradeoff:** Stopping semantics depend on device capabilities and cannot be synthesized from a generic prompt.

## robotics-007

Resource ownership is exclusive across independent agents and persists through relevant recovery transitions.

**Evidence:** [ROB-P1](source-map.md#rob-p1), [ROB-T1](source-map.md#rob-t1).
**Enforcement:** Authoritative resource scheduler.

**Synthetic precondition:**

```json
{
  "actors": [
    "a",
    "b"
  ],
  "exclusiveResource": "fake-robot-1"
}
```

**Trigger:** Both actors request the resource concurrently.
**Required observation:** Grant at most one active lease; the other remains queued or rejected.

**Positive control:** After confirmed release, the waiting actor can acquire a new lease.

**Tradeoff:** Lease expiry alone may not establish that an old physical controller stopped.

## robotics-008

Map or workflow changes invalidate affected plans, approvals and completion evidence.

**Evidence:** [ROB-P1](source-map.md#rob-p1), [ROB-T1](source-map.md#rob-t1).
**Enforcement:** Revisioned proposal application and admission.

**Synthetic precondition:**

```json
{
  "plannedMap": "m1",
  "currentMap": "m2",
  "approvedRevision": "r1"
}
```

**Trigger:** Resume a pending navigation node.
**Required observation:** Replan and obtain required revision-bound authorization before dispatch.

**Positive control:** An unchanged plan with fresh state and valid authorization can resume.

**Tradeoff:** Edits require impact analysis rather than immediate mutation of live commands.

## robotics-009

A schema-valid state without successful terminal evidence does not satisfy a mission.

**Evidence:** [ROB-S1](source-map.md#rob-s1), [ROB-T1](source-map.md#rob-t1).
**Enforcement:** Semantic result validator.

**Synthetic precondition:**

```json
{
  "booking": {
    "id": "fake-task"
  }
}
```

**Trigger:** Evaluate a structurally acceptable task-state document.
**Required observation:** Report unknown or incomplete because the mission postcondition is absent.

**Positive control:** A completed state plus matching postcondition evidence satisfies the declared mission.

**Tradeoff:** Semantic validators are task-specific and cannot be replaced by JSON schema alone.

## robotics-010

SDK health, queued telemetry and an operator notification are not interchangeable with robot outcome or intervention resolution.

**Evidence:** [ROB-F1](source-map.md#rob-f1), [ROB-F2](source-map.md#rob-f2).
**Enforcement:** Adapter result typing and handoff state.

**Synthetic precondition:**

```json
{
  "agentHealthy": true,
  "interventionId": "i1",
  "operatorResponses": []
}
```

**Trigger:** Evaluate the blocked mission.
**Required observation:** Keep the intervention pending and the mission unresolved.

**Positive control:** A matching authorized operator acknowledgement permits the declared recovery action.

**Tradeoff:** An interface needs multiple typed outcomes instead of a generic success flag.

## robotics-011

Simulation success and software snapshots do not imply physical deployment readiness or physical rollback.

**Evidence:** [ROB-D1](source-map.md#rob-d1), [ROB-T1](source-map.md#rob-t1), [ROB-F3](source-map.md#rob-f3).
**Enforcement:** Environment binding and promotion policy.

**Synthetic precondition:**

```json
{
  "mode": "simulation",
  "simulationPassed": true,
  "physicalAdapterVerified": false
}
```

**Trigger:** Request a physical execution capability.
**Required observation:** Reject promotion until deployment-specific authority and evidence are supplied.

**Positive control:** The same workflow remains usable with its verified simulator adapter.

**Tradeoff:** Deployment qualification remains a separate engineering task.

## robotics-012

The visual inspector and executor identify the same immutable workflow revision and event position.

**Evidence:** [ROB-F3](source-map.md#rob-f3), [ROB-S1](source-map.md#rob-s1), [ROB-P1](source-map.md#rob-p1).
**Enforcement:** Inspector protocol and revision store.

**Synthetic precondition:**

```json
{
  "displayedRevision": "r1",
  "executingRevision": "r2"
}
```

**Trigger:** An operator submits a change based on the displayed graph.
**Required observation:** Reject the stale proposal or require reconciliation against r2.

**Positive control:** A proposal against the current revision can be validated and applied under its authority rules.

**Tradeoff:** Clients must handle stale views explicitly.
