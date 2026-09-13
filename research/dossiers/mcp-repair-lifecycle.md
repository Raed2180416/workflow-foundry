# MCP draft execution and diagnostic repair — 2026-09-13

Scope: offline source review and scripted protocol controls. No model calls.
The earlier typed TUI failures retain their original outcomes and receipts in
`evals/MCP-TYPED-TUI-RESULTS-20260913.md`.

## Observed gap before this amendment

The inspected MCP catalog exposed validate/save/propose/apply/run/inspect but no
draft trial or diagnostic repair request (`src/mcp.mjs:31-45`, inspected before
the lifecycle amendment). `Foundry.createRun` resolved a saved workflow, and
`save` advanced the reusable head (`src/foundry.mjs:41-47,71-74`). An applied
request was closed to new proposals (`src/store.mjs:183-190`). These observations
explain why saving a repaired version could not establish a new request/proposal
relationship in typed TUI R2; they do not qualify that failed integration.

Existing reusable mechanisms are `Store.stageEvaluationWorkflow`
(`src/store.mjs:78-85`) and per-case isolated stores in `evaluateWorkflow`
(`src/evaluation.mjs:101-151`). Staging competing drafts in the main store would
still collide on its `UNIQUE(id,version)` constraint (`src/store.mjs:29`), so
every independent draft trial needs its own store. The generator already calls
its host evaluator before proposing (`src/generator.mjs:65-98`); MCP needs an
equivalent diagnostic path. A successful model-authored assertion remains local
evidence, even when its event chain is authentic.

## Proposed generic contract sent to prime

`foundry_trial({requestId, workflow, input})` executes a validated exact draft in
an isolated store without saving a reusable head or consuming the request. Bind
the receipt to request/base, draft hash, registry identity, input, run and events.
Keep separate unsuccessful trials; allow changed drafts at the same requested
version. Provide durable inspection by opaque trial identity. Object transport
must be explicit; any serialized alternative parses once. Paths, runtime policy,
capability definitions, approval and task oracles are never model arguments.

Use only host-selected capabilities whose effects are suitable for trials.
An isolated database is insufficient to contain an external adapter's effects.
Scope artifacts to the trial. Local diagnostic success cannot create independent
task qualification. A configured host evaluator must retain its own requirements
and suite identity; model-provided expected output is not an independent oracle.

`foundry_request_repair({requestId, failedRunId, expectedHash, diagnostic})`
derives a new request from a verified failure of that request's applied proposal.
Transactionally require matching workflow id/hash, current head and explicit
expected hash; inspect the real terminal failure/event chain. Preserve the root
task verbatim and parent request, applied proposal, run, error and event head.
Store bounded agent commentary separately, with server-selected diagnostic
provenance. Never accept replacement task/source/actor/permissions. A retry for
the same failure should not multiply requests. Concurrent head changes fail CAS.
Paused/uncertain effects require reconciliation, not automatic replay.

Agent-created repair records must not silently trigger model spending through
the ordinary pending-user-request processor. Deliberate processing may still be
subject to host budget/provider suspension. A repair can correct a broken local
assertion, but cannot redefine the original task or independent evaluator.

## Proposed skill wording

Read the request and exact base; validate the draft; trial it before proposing;
inspect its actual outputs and failures. Correct the causal defect in a new draft
at the same requested version. Propose/apply the exact inspected candidate, then
run and inspect that exact applied version before reporting its locator. Preserve
each failed draft and run. When an applied run fails, open an explicitly agent
diagnostic repair request bound to that failure and current hash. Use its new
request id and next version. A standalone save does not repair an old proposal's
provenance. Never combine one proposal's hash with another version's successful
run, or weaken original requirements to make local assertions pass.

## Implemented contract

Prime implemented the four proposed strict MCP tools plus request creation and
delivery verification in `src/mcp.mjs:37-51`:

| Call | Contract |
| --- | --- |
| `foundry_trial({requestId,workflow,input})` | Required object input; exact draft version and independent store; returns opaque `id`, hashes, `runId`, `runStatus`, outputs and artifact receipts. |
| `foundry_trial_json({requestId,workflow,inputJson})` | Explicit serialized JSON parsed exactly once; scalar/null/array roots remain exact. |
| `foundry_inspect_trial({trialId})` | Returns exact workflow, run and sibling `events`; verifies reservation, output, checkpoint and actual artifact hashes. |
| `foundry_request_repair({requestId,failedRunId,expectedHash,diagnostic?})` | Verified applied failure/current hash creates a diagnostic request; bounded commentary cannot replace the task or provenance. |
| `foundry_request_design({task,workflowId?,expectedHash?})` | Explicitly agent-relayed task, source `agent-request`, status `diagnostic`; no direct-user provenance or automatic model dispatch. |
| `foundry_delivery({requestId,proposalId,runId})` | Checks exact applied-request/proposal/run identity; rejects mixed versions, exposes local status and separately scoped host task evidence. |

`src/trials.mjs:23-62` restricts default trials to matching built-in core
implementations and intersects normal host permissions/budgets. Nested task
capabilities are checked too. Each trial has a separate store; quotas default to
12 trials per request and 200 per workspace. Input-schema failures record
`runStatus: "input-rejected"` with no run/effect. Diagnostic inspection does not
resume work. Local acceptance keeps `taskOutcomeQualified: false`.

Repair records retain root/parent request ids, applied proposal, failed run,
failure and event head. Their server-selected source is `agent-diagnostic` and
status is `diagnostic`, with `automaticGeneration: false`. Ordinary pending-request
processing excludes them. Explicit processing remains a host decision. Repairs
deduplicate per failed run and stop after depth three. Drafts/proposals reject
changed declared goal or success criteria with `REPAIR_INTENT`; application still
uses version/hash CAS. Existing failures remain inspectable and unchanged.
Delivery keeps `independentTaskVerified: false`; matching host task-suite receipts
are returned separately with their evaluator id, result and declared envelope.

These guards preserve provenance and declared intent; they do **not** prove that
revised code satisfies natural-language requirements. A neutral control preserves
all requirement strings but returns a constant wrong record and weakens its local
assertion. Its trial succeeds locally and its draft can be proposed, while the
independent artifact comparison fails and task qualification remains false.
A fixed host-owned task evaluator must gate task-qualified promotion. General
semantic preservation, approval to deploy, and model improvement are unmeasured.

## Independent verification

Owner: `tests/mcp-repair-lifecycle-audit.test.mjs`. Controls launch the actual CLI
MCP server through SDK stdio in temporary workspaces with networking disabled.
Two host-policy controls serve the same MCP implementation with explicitly
restricted/custom synthetic registries. The queue check uses a scripted dispatch
sentinel, which receives zero calls. Every fixture is hand-authored diagnostic
data; no model generated or repaired a candidate in this audit.

Run explicitly:

```sh
FOUNDRY_MCP_REPAIR_AUDIT=1 node --test tests/mcp-repair-lifecycle-audit.test.mjs
```

The missing-API baseline is preserved at
`.foundry/verification/mcp-repair-lifecycle-audit-cM8khd/results.json`.
The first implemented run passed 14 behavioral controls but failed its source
stability gate while prime changed four files; it remains at
`.foundry/verification/mcp-repair-lifecycle-audit-V7sSH9/results.json`.
A stable expanded run passed 17 controls (Node reports 18 including its parent)
at `.foundry/verification/mcp-repair-lifecycle-audit-nix93y/results.json`.
The semantic counterexample was then added without changing the API, followed by
the requested agent-design/delivery controls. Intermediate successful receipts
remain in `mcp-repair-lifecycle-audit-EXs5cV` and `mcp-repair-lifecycle-audit-Uv4MgE`.

**Final unchanged-suite replay: 20 independent controls passed, Node 21/21
including the parent, zero failures/skips, 13.53 seconds, zero model calls.**
Receipt: `.foundry/verification/mcp-repair-lifecycle-audit-SXc1VJ/results.json`.
This replay includes prime's subsequent immutable-hash addressing correction.
Source identity:
`44e099422dbade361b59b9b8ffe7a36f793324f8b8f9d014daa4c8d7c6740500`.
Dependency inventory identity:
`492f89960fd0f3e91eb44273a792ba457a18ef0aa88ff0e0c0e07f088c9d7d5c`.
Frozen-source equality, before/after live-source stability, dependency stability
and protected historical TUI receipt hashes all passed. `semantic-boundary.json`
records the deliberately wrong constant artifact and failed independent comparison.

The exercised cases include same-version failed/corrected drafts and durable
inspection; exact JSON roots/input rejection; corrupted artifact/event rejection;
per-request quota; host permission intersections and nested external-tool denial;
repair creation, root lineage, depth limit, deduplication and stale/foreign evidence
rejection; declaration preservation; no automatic dispatch for either diagnostic
request source; and exact delivery linkage. A real CLI two-case host evaluation
appears separately in delivery evidence, and cannot qualify an older failed version.

Receipts preserve all actual calls, command results, before/after source hashes,
project source bytes and selected historical TUI receipt hashes. Installed
dependency bytes are hash-checked before/after, not copied into the snapshot;
operating-system libraries are not frozen. Serena returned `PLUGIN_DISABLED`.
The repository has no configured formatter, linter or typechecker and no GitHub
remote. Node syntax/doctor and actual protocol tests provide executable evidence.
The offline local syntax/doctor/secrets check for the preceding unchanged test
revision is preserved in `mcp-repair-lifecycle-audit-Uv4MgE/offline-quality.json`:
all commands exited zero and Betterleaks reported no leaks. Its post-audit source
comparison correctly records the two later namespace-fix edits; it is not a
claim that the old snapshot was still current. No network vulnerability lookup
or model/TUI call was performed by this audit.
