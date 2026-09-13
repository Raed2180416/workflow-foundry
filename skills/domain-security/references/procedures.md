# Security evidence workflow construction and adversarial evaluation

These are original procedures derived from the source analysis in
[the source notes](source-notes.md). They describe defensive
workflow semantics. The associated fixtures contain no real targets, exploit
payloads, credential material, or scanner execution instructions.

## Evidence and authority are separate inputs

Classify information by who can write it. The runtime owns capability grants,
target bindings, action admission, and immutable tool events. The evaluator owns
hidden world state and outcome observations. The model can propose actions,
summarize evidence, and request clarification; its text cannot update the first
two classes. Evidence supplied by a target or retrieved document has no authority
even when it resembles a system message or an administrator instruction.

A minimal tool contract includes an exact operation identifier, schema digest,
effect class, principal/tenant binding, permitted resources, argument schema,
read/write behavior, result envelope, pagination and completeness semantics,
timeouts, cancellation, and idempotency support. Classify a GraphQL operation by
its parsed operation and approved fields, not by the word query in a filename or
description. An account may authorize broader API access than this workflow.

Use separate credential references per authorized principal and execution scope.
Do not put secret values in workflow JSON, prompts, source citations, or traces.
Diagnostic commands that print an environment are not implicitly permitted reads.
Reject a multi-user deployment adapter that relies on an unisolated single-user
credential context. Reject missing mandatory permission enforcement at startup.

## Build a claim ladder

| Claim | Minimum independent support |
| --- | --- |
| An issue was reported | Provenance of the report; no implication that it is correct. |
| Relevant evidence was observed | Valid response schema, target/version/time binding, and immutable evidence reference. |
| A finding is supported within scope | Required evidence and functioning benign controls; contradictory evidence addressed. |
| An authorized remediation committed | Trusted execution receipt and authoritative readback for the same target/version. |
| Remediation was verified | Comparable post-change observation with functioning measurement path, plus required control checks. |
| Evaluation coverage was complete | Every required branch and asset accounted for with fresh, sufficient evidence. |

Treat failure and empty results as different types. A parser error cannot become
an empty findings queue. A branch that timed out must remain visible in coverage.
An export that lists failed steps and exits successfully still requires a domain
outcome check. A signed or hashed report can preserve an incorrect assertion
faithfully; artifact integrity cannot replace evidence validity.

## Approval, replay, and cancellation

For an effect, bind the grant to principal, tenant, target, expected version,
workflow revision, proposal digest, expiry, and one-use execution identity. The
runtime checks it at dispatch. Deny a resumed action when any binding changed.
Durably record the intent before dispatch and receipt after it. If acknowledgement
is lost, reconcile through a read-only status API or equivalent durable effect
record before reissuing. A rollback or compensation has its own effect scope.

Publication review and execution authority answer different questions. A review
of a workflow revision does not authorize any future user to operate on any
asset. A runtime action grant does not automatically approve later edits to the
workflow. The interface should show this distinction without exposing secret data.

On cancellation, stop scheduling new work and settle in-flight branches according
to the adapter contract. Preserve unknown outcomes. Completion of independent
branches does not erase cancellation or failure elsewhere. Derive the aggregate
result from required coverage and effect outcomes, not only successful children.

## Workflow import and natural-language changes

Treat public exports as inert syntax. Never enable custom YAML object constructors
or execute referenced step images while inspecting an export. Resolve every data
binding against declared outputs and parameters. Detect references to absent
names, mismatched integration destinations, unbounded loops, inconsistent branch
statuses, missing pagination, and unconditional-success exits after failed work.

Map imported step identifiers and response schemas to supported typed operations.
Pin revisions instead of importing a moving latest reference without review.
Unsupported authority, timeout, retry, state, or join semantics block deployment.
Static validation is necessary but not sufficient: compare intended destination
state against independently read actual state after simulated imports.

Natural-language modifications produce a new proposal revision. Show the intended
behavioral change, altered dependencies, new effects, evidence reuse decisions,
and approval invalidations. Preserve stable identifiers for unchanged branches.
Do not silently grant a broader scope to make the edited graph executable.

## Independent adversarial oracle

The simulator exposes only the case's `agentVisible` projection and typed mock
tool observations. It owns `world`, `faultSchedule`, authorization outcomes,
effect receipts, and a monotonic event ledger. Never let the executor read or
rewrite those fields. The development JSON is intentionally inspectable for the
researcher; exposing the complete file during a model trial invalidates the trial.

Implement each fixture's `oracle` as independent checks over that ledger and
world state. The prime must wire these specifications into the shared evaluator;
this directory does not implement a scanner, simulator, or runtime plugin.
Check the oracle using one valid trace and the included `badTrace`, then mutate
target IDs, scopes, timestamps, receipt counts, evidence digests, and completeness
flags. Reject malformed/missing fields rather than interpreting them as success.

Evaluate authority and evidence integrity as hard gates. Then report outcome
accuracy, supported coverage, appropriate abstention, duplicate effects, total
queries, elapsed virtual time, and intervention count separately. A model that
always abstains may be safe on ambiguous cases but must fail the actionable ones.
Measure both successful detection and restraint using paired negative controls.

Freeze evaluator version, scenario generator, hidden seeds, and budgets before a
comparison. Record architect, executor, tools, runtime, skill revision, and human
assistance independently. Use paired worlds for alternative executors, and
report per-case differences with uncertainty rather than a fabricated global
confidence score. Public benchmarks, published scenario answers, and cases used
to revise this skill are development data. New names around the same disclosed
causal mechanism are weak generalization evidence.

Closed products can sometimes be compared through their public integration
surface in an authorized account. Such a comparison includes the proprietary
backend as a fixed component. Swapping the chat model at an MCP client does not
swap the model inside that backend. Report unavailable code, unavailable account
access, incompatible tools, and unsupported runtime behavior as comparison limits.
