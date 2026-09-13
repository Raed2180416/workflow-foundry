# SRE construction procedures and evaluation contract

These procedures are original design requirements informed by the pinned source
traces in [the source notes](source-notes.md). They are not
a certification of any executor. Names below describe semantic fields; the prime
must map them to the shared intermediate representation without silently losing
constraints.

## 1. Define the evidence envelope

An observation must carry `evidenceId`, `sourceId`, `tenantId`, `resourceId`,
`queryDigest`, `observedAt`, `intervalStart`, `intervalEnd`, `resourceVersion`,
`completeness`, `status`, and an artifact digest or immutable object reference.
Use explicit statuses such as `observed`, `no-data`, `unauthorized`, `timeout`,
`malformed`, and `partial`. A `no-data` response cannot supply a zero-valued sample.
Keep transport status separate from measurement semantics.

Preserve units, aggregation, sampling resolution, labels, and denominator. A
globally averaged error rate may conceal a low-traffic region outage. A successful
query may have silently widened the sampling step; include the actual resolution
in the evidence shown to the model. Pin a replay clock for historical evaluation.
Do not send an archived incident through the present-day telemetry endpoint.

Keep provider scope and query shape outside free-form text. Prefer structured
query arguments over shell construction. Bound interval width, page count,
cardinality, result bytes, execution time, concurrency, and total tool calls.
When a provider cannot enforce timeouts, the adapter must supply a verified
outer deadline or reject deployment requiring that guarantee.

## 2. Build a hypothesis ledger

For each candidate, store the claimed mechanism, affected scope, observations
supporting it, observations against it, missing observations, and the next
discriminating query. A timeline establishes ordering; it does not establish
causality by itself. A retrieved runbook can propose an intervention but cannot
authorize it or prove that its preconditions hold.

Rank the next query by expected ability to distinguish remaining explanations,
cost, and potential operational impact. This is a planning heuristic, not a
calibrated probability guarantee. Explicitly represent competing explanations
and stop with `inconclusive` when the available observations cannot distinguish
them. Do not invent a root cause to satisfy a required nonempty text field.

Check the following joins before generating the workflow: all required service
slices reported; each result belongs to the same tenant and incident interval;
stale observations cannot overwrite newer ones; optional failures remain visible;
and cancellation propagates to child reads without claiming they all stopped.

## 3. Classify retry and recovery behavior

| Condition | Required handling |
| --- | --- |
| Read returns a transient transport failure | Retry within the workflow-wide deadline and call budget; retain every attempt. |
| Provider supplies retry-after | Respect the earliest permitted retry, with a capped attempt count and deadline. |
| Authentication or authorization denied | Stop that branch; never reinterpret it as empty data. |
| Query shape or pagination mode is invalid | Repair or change the query once its cause is understood; repeating the same invalid request spends budget without evidence. |
| Mutation fails before dispatch | A retry may be allowed if the runtime can prove no effect was dispatched. |
| Mutation times out after possible dispatch | Mark outcome unknown, reconcile by the same idempotency identity, and avoid blind retry. |
| Effect committed but checkpoint acknowledgement lost | Adopt the verified committed result; record missing operational-cost information instead of inventing zero cost. |
| Compensation fails | Preserve both original and compensation outcomes; terminal status remains partial or failed. |

Persist workflow revision, event sequence, branch states, approvals, effect
intents, known receipts, verification evidence, cancellation requests, and
partial-coverage reasons. Checkpointing a conversation alone cannot establish
whether an external mutation committed. A recovery run must restore these facts
before planning another action.

## 4. Bind authority to a proposal

The trusted runtime should validate the tuple `(principal, tenant, resource,
workflowRevision, proposalDigest, expectedResourceVersion, expiry, nonce)` against
an external approval record. Consume the nonce atomically with effect admission,
or provide an equivalent durable protocol. A changed region, increased batch
size, changed command, or new workflow revision requires a new applicable grant.
An approval to publish a workflow is distinct from authority to execute its
mutations against a particular environment.

Human feedback changes the proposal graph through an explicit revision. Reuse an
observation only when its source, time, target, and preconditions still apply.
Show why each changed node affects downstream verification. Verify the executor
cannot bypass the gate through a general shell tool or a second connector.

## 5. Define the recovery oracle before execution

The evaluator owns the world state and event ledger. The agent owns only its
proposed workflow and report. The evaluator records actual tool dispatches,
committed effects, allowed/denied authority decisions, and final service counters.
Reject transcripts written solely by the model as authoritative execution logs.

For a synthetic recovered service, a typical oracle requires all of:

1. The intended resource version and configuration are read back independently.
2. Every required region has fresh post-change measurements across the declared
   consecutive windows, with sufficient nonzero request volume.
3. Errors and latency satisfy the frozen task thresholds, and dependency health
   or data-integrity invariants remain satisfied.
4. No out-of-scope dispatch, duplicate non-idempotent effect, expired/replayed
   approval, or unrecorded human intervention occurred.
5. The report's terminal status and citations agree with those observations.

Do not combine these as an average score that lets good prose offset an authority
violation. Authority, evidence integrity, and outcome validity are hard gates.
Report efficiency, intervention count, and latency separately after passing them.

## 6. Use the fixture specifications

`fixtures.json` deliberately includes evaluator-only fields in one development
artifact for review. Before an actual model evaluation, materialize only each
case's `agentVisible` projection into the task workspace. Keep `world`,
`oracle`, `faultSchedule`, and `badTrace` outside every agent, tool, retrieval
index, and generated prompt. The runner must synthesize allowed observations
from the hidden world; copying the complete JSON into a prompt invalidates the
evaluation.

These fixtures specify required behavior but do not implement a simulator or
register new shared runtime operators. `oracle` entries are declarative checks
for an independent evaluator; the prime must implement and test them before
reporting a pass rate. A model-written assertion matching `expectedTerminal` is
insufficient without the evaluator-owned evidence and event checks.

Before freezing an evaluation, test each oracle against its `badTrace`, a valid
reference trace, missing fields, duplicate events, reordered independent reads,
and corrupted evidence digests. A broken oracle invalidates the run. Use the
public cases to improve the skill, then generate sealed variants with different
topology, timing, failure causes, and authority assignments. Renaming entities
alone does not create a held-out causal problem.

Record architect and executor model identifiers, exact skill/workflow versions,
tool manifests, simulator seed and clock, budgets, human assistance, retries,
coverage, and raw traces. Report uncertainty and per-family outcomes. Reuse of a
commercial integration endpoint does not demonstrate parity with the commercial
investigation engine.
