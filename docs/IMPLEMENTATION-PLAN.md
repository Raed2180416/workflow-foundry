# Implementation and research plan

## Outcome and falsifier

The intended product lets an existing modest-capability agent construct a task-
specific workflow from an explicit engineering process, domain knowledge and
capability contracts; inspect it visually; revise it from natural language;
execute it under bounded authority; and reuse evidence-backed versions. Success
requires executable task outcomes, not attractive Markdown or a diagram.

The central hypothesis is falsified for a tested envelope when the external skill
system fails to improve held-constant model behavior, or approaches reference
success only by using hidden human repair, stronger executors, excessive budgets
or weakened verification. Such a result changes the mechanism and experiment;
it is not permission to erase the negative evidence.

## Stage A — source-grounded deconstruction

Acquire every verified public item in the discussed corpus, including MCP/skills
and implementation repositories, at immutable revisions. For unavailable/closed
products archive official public material and mark the internal boundary unknown.
Record acquisition failures, licenses, file inventories and what was actually
read. Analyze the existing ARC graph/intent/question/scheduler path read-only.

For each representative trace: input contract, state ownership, context retrieval,
planning, tools, effects, parallelism, verifier, failure behavior, human interaction,
termination and deployment. Extract a reusable requirement only with evidence,
applicability limits and a falsifying test. Review isolated patterns across several
domains before elevating them into a universal rule.

## Stage B — minimal common contracts

Implement the architecture in ARCHITECTURE.md: task, workflow, proposal, run,
capability and evidence identities. Freeze examples early so workers and models
target the same format. Prefer deterministic primitives for validation, state and
authority. Keep model-provided judgments separate from externally checked facts.

Acceptance: reject duplicate ids, missing dependencies, cycles, undeclared tools,
invalid reference paths, unbounded iteration, malformed schemas, privilege
escalation, stale hashes and missing acceptance. Test explicit fallback paths.

## Stage C — executable vertical slice

CLI -> skill context -> model-produced JSON -> validation -> immutable save ->
native execution -> trace -> independent oracle -> visual rendering -> natural-
language revision -> version-bound proposal -> revalidation -> new execution.

Exercise actual OpenCode TUI in an isolated project. Capture model identity and
free-provider evidence, prompts, raw responses, tool behavior and all repairs.
Never relabel a hand-authored template or headless run as this TUI experiment.

## Stage D — portable packaging

Expose the same contracts over MCP, not a second implementation. Install original
skills and client-specific MCP/hook projections using one project-local command.
Back up and preserve existing config; detect unsupported clients. Test installation
in clean and already configured fixtures and verify actual protocol calls.

Add LangGraph and n8n domain/runtime authoring skills and source-pinned adapter
qualification. Export supported structures with visible semantics. Reject unsafe
or unimplemented translations. Full automatic portability is an evidence target,
not a promise derived from the existence of an adapter file.

## Stage E — adversarial improvement

Freeze diagnostic cases and baseline settings first. Run bare agent, generic skill,
domain-enhanced skill and selected reference implementations with matched executor
and tool access. Track construction validity, true task success, false success,
recovery, boundary violations, cost, latency and human assistance separately.

Inject input contradictions, missing results, wrong types, poisoned documents,
tool denial/failure, timeouts, process death, duplicate dispatch, lost responses,
stale edits, mid-run preferences, joins after failed branches and budget depletion.
Use mutation tests to establish that the evaluator rejects deliberately broken
workflows. Regress every discovered bug, then freeze a new candidate before fresh
evaluation. Keep all diagnostic evidence distinct from final comparison evidence.

## Stage F — expanding the deployment envelope

Once the common slice works, qualify real capabilities one domain at a time:
repository tasks, browser tasks in local apps, simulated incident diagnosis,
scientific software experiments, then other authorized environments. Physical,
clinical and production-security operation need domain-specific external controls
and access; their source-derived skills alone do not qualify deployment.

Add conditional human steering without routine manual checking: ask only for
missing intent/preferences or authority, record the answer, invalidate affected
assumptions and recompile a new version. Conflicting evidence and uncertain effects
remain explicit blockers. Measure interruption frequency, not just success.

## Promotion criteria

No known critical failure in the declared tested envelope, an evaluator that fails
on injected bad cases, reproducible environment/source/model records, successful
restart and stale-edit probes, and acceptable *predeclared* performance margins
against an actual accessible reference. A single scalar rating or model confidence
cannot override these gates. Publish the limitations alongside the evidence.

## Packaging/release boundary

Local implementation and reversible testing are authorized. Public GitHub hosting,
package publication, credentials, purchases or consequential external deployments
are separate actions. The local package may be prepared completely before those
actions. Do not fabricate a published npx/uvx URL before publication exists.
