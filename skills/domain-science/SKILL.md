---
name: domain-science
description: Construct inspectable workflows for scientific literature, computational analysis and simulated instrument coordination. Use for scientific workflow design, provenance, notebook execution, experiment-state modeling and evidence gates. Physical laboratory execution needs a separately verified deployment adapter and authority.
---

# Scientific workflow construction

Produce a workflow whose claims, observations, transformations and external effects can be distinguished and tested. This skill supplies design requirements; it does not certify an experiment or implement an instrument safety system.

## Load only the relevant evidence

Read [source-map.md](references/source-map.md) for the mechanism being designed: SCI-B1/B2 for preflight and evidence completeness, SCI-R1/R2 for remote analysis joins, SCI-L1–L4 for instrument boundaries, SCI-F1/A1/D1 for computational environments, SCI-E1/E2 for cloud-lab boundaries. Read [requirements.md](references/requirements.md) when constructing validators and fault tests; its linked JSON is the machine-readable source. The [portable source map](references/source-map.md) retains the pinned public sources and their inspection limits.

## Establish the task contract

1. Record the question, intended claim, required observations, acceptable uncertainty, dataset identities, units, provenance requirements, resource budget and observable terminal state. Separate an exploratory analysis from a confirmatory evaluation before choosing its metrics.
2. Select `literature`, `computation`, `simulation`, or `physical-deployment-design`. The last mode produces an integration proposal unless an authorized, independently checked deployment adapter is supplied. A simulator flag or model statement cannot grant physical capability.
3. Specify each artifact by content identity, producing step, tool/model version, parameters, time and validity conditions. Declare which inputs are authoritative, which are untrusted source material, and which are hypotheses. An immutable artifact can still contain a wrong conclusion.
4. Define the evidence required to support each claim. Every mandatory metric must be present, finite, compatible with its units and evaluated against a versioned criterion. Represent missing, stale and contradictory evidence explicitly; do not average them into a passing score.

## Construct the workflow

Represent each node with typed inputs and outputs, effect class, capability, preconditions, resource lease, timeout, retry rule, failure state and completion evidence. Use the runtime's supported schema; report any required field that it cannot enforce as an integration gap.

Use this sequence as a design scaffold, replacing stages only when their obligations remain covered:

`question → source acquisition → identity/unit validation → analysis plan → bounded execution → artifact reconciliation → independent checks → claim with limitations`

For a parallel analysis, bind every branch to the same declared input revision or to a documented variation. Join on the required set of artifact identities and statuses. A remote service reporting success is only one observation. A missing downloaded artifact leaves its branch incomplete. Consensus among models is another analysis result, not an independent measurement.

For notebooks, place source data in a protected input area and generated artifacts in a scoped output area. Re-executed cells must be pure or explicitly replay-safe. Route external effects through a separate adapter so editing a cell cannot repeat a laboratory action, submission, payment or message. Check cell error outputs even when the notebook process exits successfully.

For instrument integration proposals, keep the planner outside the control boundary. The adapter must authenticate the caller, validate all nested values and units, verify the instrument's current state, enforce its operating envelope, acquire exclusive resources and return independent completion evidence. Hardware interlocks and device stop behavior must remain effective when the model, MCP server or network fails.

## Preserve state and handle intervention

Persist an intent before any permitted external effect. Record dispatch, acceptance, completion, failure and unknown effect as separate transitions. A timeout after dispatch requires reconciliation; it does not authorize an automatic replay. Keep the authoritative journal outside directories writable by the executing agent.

Bind approvals and evidence to the exact workflow, tool schema, input and policy revisions. A natural-language change first becomes a proposed revision and impact report: affected nodes, changed evidence, permissions, resources, cost and tests. Quiesce affected external work and reconcile in-flight effects before applying the revision. Preserve rejected hypotheses and failed runs as evidence, without promoting them to reusable facts.

A human handoff includes the unresolved decision, evidence packet, responsible role, deadline and acknowledgement state. A request sent to an operator is not a resolved decision. Do not resume an affected operation while the required handoff remains unresolved.

## Test the boundary, then the task

Start with synthetic inputs and a fake adapter. Exercise missing metrics, contradictory sources, changed data hashes, incomplete parallel branches, thrown tool errors, journal failure, timeout after acceptance, concurrent resource requests, stale approvals, notebook replay and refused resource limits. The cases in [requirements.md](references/requirements.md) define expected behavior; they are proposed tests and are not evidence that the main runtime already implements them.

Then evaluate the intended scientific task using declared datasets, held-out cases, deterministic artifact checks and justified domain review. Record exact executor model, prompts, skills, tools and budgets. Keep simulated success, computational reproduction, measured physical outcome and clinical efficacy in separate result fields. Do not train or refine against the final holdout while reporting it as unseen.

## Required output

Deliver the workflow specification, source/evidence register, adapter capability requirements, effect/state transitions, fault cases and unresolved assumptions. Attach a verification matrix with `implemented-and-tested`, `implemented-unverified`, `proposed`, or `external-dependency` for each requirement. Terminate as `complete`, `partial`, `blocked`, or `unknown-effect` based on the declared evidence, not the model's confidence.
