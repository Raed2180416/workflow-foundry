# Qualified n8n export

Import `workflow.n8n.json` into an n8n environment supporting the recorded node versions. It is inactive and contains no credentials. `foundry-source.json` retains the original IR and immutable identity; `bindings.json` records the external capability mappings. Structural validation and executing generated Code bodies outside n8n do not establish a successful n8n import or runtime execution.

The profile supports serial task/assert nodes, conditions, references/defaults and final acceptance. It rejects human nodes, loops/maps/waits, concurrency above one, retries and continue-on-error. By default, a skipped prerequisite propagates skipping; `join: all_resolved` explicitly admits an alternative path after a skipped prerequisite. Skipped nodes have no output and consume no step.

Every task requires a trusted Execute Sub-workflow binding: `workflowId`, `effects: pure`, `cost: 0`, `risk: low`, `requiresApproval: false`, `maxTimeoutMs`, input/output schemas, and `timeoutContract: deadline-and-cancellation-v1`. These declarations belong to the host. A model cannot grant authority or certify that arbitrary connectors are pure. Missing bindings fail at initialization before any task dispatches. Native n8n retries are disabled because their bounds differ from the IR.

Invoke this workflow with exactly one data item: `{ "input": <workflow input> }`. Internally one item carries `{ state, request, dispatch }`; the capability sub-workflow must accept all incoming data and use only the `request` object to execute its declared capability. The request contains the tool, typed arguments, workflow hash, run ID, node ID, operation key, absolute deadline, timeout and zero cost allowance. Parent state is recovered from the trusted preparation node after the call, so a child cannot overwrite it by returning a state object.

The capability must return exactly one item whose JSON is:

```json
{
  "ok": true,
  "operationKey": "the unchanged request operationKey",
  "output": "the capability result conforming to outputSchema",
  "cost": 0
}
```

An absent/multiple/failed/uncorrelated result blocks acceptance. Output is limited to 512 KiB, and state to 2 MiB with additional depth/count bounds. Output after the per-task deadline is rejected. Final success appears only at `result.state.status === "succeeded"` after acceptance passes; green intermediate nodes are not the acceptance decision.

**Deadline delegation is mandatory.** The sub-workflow must enforce the supplied deadline, propagate cancellation to its task and stop promptly. The parent Code node cannot terminate a remote task; a late-result check alone does not provide timeout enforcement. The overall n8n execution timeout uses seconds and is an additional backstop, not an equivalent per-task timer. Confirm this contract with a hanging-task fixture on the actual deployment before running an exported task workflow.

The supported JSON Schema subset includes types, properties/required/additionalProperties, homogeneous items, cardinality/length/numeric bounds, uniqueItems, enum/const and allOf/anyOf/oneOf/not. Regex, `$ref`, format checks and custom keywords are rejected. Numbers must be finite, integer values within the safe JavaScript range, and strings cannot contain unpaired surrogates.

The host must disable automatic retry/re-execution of this parent workflow and treat a failed execution as terminal. A new invocation is a new run with a new budget; manually restarting from a failed node or editing execution data is outside the supported profile. Resume across a task crash, durable effect reconciliation, Foundry event chains, compare-and-swap ownership, approval authority and commercial-service parity are not provided. Inspect both branches and preserve the generated versions/conditions when editing in the UI. Re-export a changed Foundry workflow rather than manually changing its meaning under an old workflow hash.
