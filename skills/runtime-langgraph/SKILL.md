---
name: runtime-langgraph
description: Choose and validate LangGraph execution for a Foundry workflow. Use when exporting a workflow to LangGraph, binding Python capabilities, handling human interrupts or assessing whether LangGraph preserves the requested workflow semantics.
metadata:
  version: "0.1.0"
  evidence-date: "2026-09-13"
---

# LangGraph workflow export

Read the installed Foundry schema and `adapters/index.mjs` capability matrix first. Use `exportWorkflow(workflow, "langgraph", {bindings})`; do not bypass validation or silently replace unsupported nodes. A successful export means files were generated. It does not prove that the bindings run or that a deployment is durable.

The current profile accepts at most 100 serial task/assert/human nodes with conditions and reference/default semantics. Set maximum concurrency to one, maximum attempts to one, and fail on errors. Maps, loops, waits, effectful/paid capabilities, continue-on-error and arbitrary graph rewrites are unsupported. Default `all_success` joins propagate skipping after a skipped predecessor; use `all_resolved` explicitly to admit an alternative path. A skipped node has no output and costs no semantic step.

Bindings belong to the trusted host. Each must declare a relative Python entrypoint, trusted code hash, input/output schemas, maximum timeout, pure effects, zero cost, low risk and no approval requirement. Hashing code supplied by an untrusted model does not make it trusted. Missing bindings block execution. The child-process lifecycle and resource limits do not provide a filesystem/network security sandbox; the host must provide isolation appropriate to its bindings.

Install the pinned wheel lock into an isolated environment, never from the research corpus. Build through `foundry_langgraph.build_graph` with an explicit checkpointer. Give each run a unique thread ID and one owner. The managed wrapper accepts only a fresh `{input: ...}` run or a pending human answer. It blocks checkpoint rewinds, state-edit/jump commands, terminal replay and recovery of interrupted task invocations. The in-memory saver is suitable for local fixtures; persistent storage needs independent tests.

Human workflows must be totally ordered. A human pause is split into a checkpointed preparation/charge and an effect-free interrupt, because LangGraph re-executes an interrupted node on resume. Copy workflow hash, run ID and node ID from the pending interrupt into the answer envelope, validate its answer schema and retain the original deadline. A stale or invalid answer fails this profile's invocation; it does not approve anything or reset the task budget. Scope changes create a new workflow version instead of editing the paused graph.

After binding, execute positive and negative fixtures: correct output, plausible wrong output, schema mismatch, skipped prerequisite, explicit fallback join, deadline, step exhaustion, actual interruption/resume and failed-task replay. Check that the output before a human pause is unchanged after resume and that the human step was charged once. Independently test dependency/code drift. Report target/runtime versions, actual cases executed and untested persistence/cancellation boundaries.

Use the qualified adapter README for the exact schema and numeric/Unicode subsets. Do not claim support for a schema keyword that the portable profile rejects. Keep model self-report separate from the graph's final acceptance result and from an external domain oracle.

Source rationale: [LangGraph interrupt replay](https://github.com/langchain-ai/langgraph/blob/e539ac122f4126f6dd850581c1494948cf620e31/libs/langgraph/langgraph/types.py#L851-L871), [join semantics](https://github.com/langchain-ai/langgraph/blob/e539ac122f4126f6dd850581c1494948cf620e31/libs/langgraph/langgraph/graph/state.py#L928-L979), and Foundry's `research/dossiers/software-browser-skills.md`. The export does not migrate Foundry's approval authority, event chain, CAS store or in-flight effects.
