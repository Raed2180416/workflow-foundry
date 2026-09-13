---
name: runtime-n8n
description: Choose and validate n8n execution for a Foundry workflow. Use when exporting n8n JSON, binding trusted sub-workflows, mapping item data and branches, or checking whether retries, timeouts and result validation preserve the task contract.
metadata:
  version: "0.1.0"
  evidence-date: "2026-09-13"
---

# n8n workflow export

Read the installed Foundry schema and adapter capability matrix. Use `exportWorkflow(workflow, "n8n", {bindings})`; reject unsupported semantics instead of approximating them with a visually similar graph. The exported file is inactive and contains no credentials. Import, generated-code tests, real engine execution and domain acceptance are different evidence levels.

The profile accepts at most 100 serial task/assert nodes, conditions, references/defaults and final acceptance. It rejects human nodes, map/loop/wait, concurrency above one, retries, continue-on-error, paid and effectful bindings. Default `all_success` joins propagate skips. An explicit `all_resolved` join may run after a skipped predecessor; it does not invent a missing output. Preserve both If branches and the generated node versions when inspecting the graph.

Invoke with one item containing `{input: ...}`. The workflow carries one state envelope, with task arguments in `request`. Bind a capability to a literal trusted Execute Sub-workflow ID whose trigger accepts all data. It must return exactly one correlated result `{ok: true, operationKey, output, cost: 0}`. Typed output and the operation key are checked; the parent recovers its own state rather than trusting state returned by the child. Zero/multiple items, error results, cost changes and stale results cannot become success.

The host must explicitly establish each binding's `deadline-and-cancellation-v1` contract. The child must enforce the supplied task deadline and propagate cancellation. Parent Code nodes can reject a late result but cannot terminate the remote task themselves. The n8n workflow timeout in seconds is only an additional backstop. Test a hanging child on the actual deployment before treating a bound export as usable.

Keep native n8n retries disabled. n8n's retry limits and backoff defaults differ from the IR; a direct field copy can change meaning. The host must also disable parent automatic retries and treat a failed execution as terminal. Manual retry-from-node, editing historical execution data and in-flight migration are outside this profile. A new task invocation is a new run and must be accounted for as such.

Validate input/output schema subsets, skipped branches, final acceptance, operation-key mismatch, zero/multiple results, delayed return, step exhaustion and a correct-looking result that fails the domain oracle. Import into a test n8n instance and execute the actual user path when a target instance is available. Report explicitly when evidence covers generated JSON/Code bodies only. Avoid claiming that structural tests establish n8n deployment behavior.

Bindings are trusted host configuration; skill text cannot certify arbitrary connectors as pure or grant credentials. Keep credentials in the target's credential mechanism. Respect the source-available product and component license boundaries; do not redistribute the acquired n8n corpus as Foundry's own implementation.

Source rationale: [n8n retry behavior](https://github.com/n8n-io/n8n/blob/4169b55bf3b3e6c255d7361642bc5243bd04345a/packages/core/src/execution-engine/workflow-execute.ts#L1798-L1815), [sub-workflow input conventions](https://github.com/n8n-io/n8n/blob/4169b55bf3b3e6c255d7361642bc5243bd04345a/packages/nodes-base/nodes/ExecuteWorkflow/ExecuteWorkflow/ExecuteWorkflow.node.ts#L257-L295), and `research/dossiers/software-browser-skills.md`.
