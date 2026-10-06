# Draft trials and version-bound repairs

This amendment addresses an observed live-client failure: a model applied a draft,
encountered a bad assertion, saved a standalone replacement, then combined the old
proposal id with the new run id. The strict comparison correctly rejected that
mixed receipt. The original TUI result remains failed; the following implementation
is a new generic mechanism tested with offline protocol controls.

## Normal agent path

Use an existing request, or relay the task with `foundry_request_design`. Relayed
tasks have `source: agent-request`, `status: diagnostic` and no automatic model
dispatch. Obtain design context and actual capability contracts, construct a draft,
validate it, and call `foundry_trial` with the request id and exact object input.
Use `foundry_trial_json` only for explicitly serialized JSON roots.

Each draft has a separate SQLite store beneath `.foundry/trials/<opaque-id>`.
Different drafts can have the same intended workflow id/version without collision.
Neither reusable heads nor request/proposal state changes during a trial. The
parent reservation and final receipt bind request/base, workflow, registry, input,
runtime policy, run, event head and artifact hashes. Inspection detects changed
artifacts and mismatched run evidence. Interrupted trials do not automatically
restart. Failed and input-rejected attempts still consume the trial budget.

Default trials admit only matching bundled `core.*` implementations, intersected
with the host's existing allowed capabilities. A replaced function or similarly
named MCP tool is not trusted by name. Hosts may explicitly select other diagnostic
capabilities through the library configuration, but low-risk, zero-cost, no-approval
and non-non-idempotent constraints still apply. An isolated store does not sandbox
arbitrary external effects; hosts remain responsible for any additional adapters.
Default caps are 12 trials per request, 200 per workspace, 200 steps and 15 seconds
per trial, further reduced by ordinary host limits.

A successful trial means its model-authored local acceptance passed. It does not
create a task-outcome qualification. Independent host evaluators remain separately
configured and source-bound; callers cannot provide a passing score or weaken an
oracle through trial arguments.

## Applied failure path

`foundry_request_repair` requires `requestId`, `failedRunId`, `expectedHash`, and
optional bounded `diagnostic` commentary. In one transaction the host verifies an
applied proposal linking that request to the exact failed run, current workflow
head, terminal failure, absence of an execution owner and intact event history.
Unrelated, successful, cancelled, waiting, approval-blocked and uncertain runs are
rejected. Unknown effects need reconciliation instead of automatic replay.

The new record preserves root request text verbatim, parent/root ids, applied
proposal, failure/event identity, goal and success criteria. Commentary is marked
untrusted agent explanation rather than new requirements or consent. A repair
draft/proposal cannot change the preserved goal or success criteria. Changed user
intent requires a distinct explicit user revision. The independent evaluator is
never changed by this API.

Repair records have `source: agent-diagnostic`, `status: diagnostic` and
`automaticGeneration: false`; the ordinary pending-user queue ignores them.
An existing host agent can handle them through MCP, or a user can explicitly run
the generator on that request. Duplicate delivery of the same failure returns its
existing repair record rather than creating more work. The default maximum repair
depth is three. Old requests, proposals, versions and failed runs remain intact.

## Final linkage

`foundry_delivery` checks that a request, applied proposal and run all identify the
same immutable workflow. It returns local execution state and separately scoped
task-evaluation records, without treating a passing suite as proof of every run or
environment. An old proposal plus a repaired version's successful run is rejected.

CLI equivalents are `trial`, `inspect-trial`, `repair-request` and `delivery`.
The graphical server exposes the same host operations, with its existing local
origin/token boundary. It does not invent a separate execution interpretation.

MCP annotations are conservative: mutating tools are not advertised as universally
additive, and tools that may dispatch configured capabilities do not claim a closed
world. Annotations are only descriptive hints; actual permissions remain enforced
by the host registry/runtime. Source: the official MCP ToolAnnotations schema at
`https://modelcontextprotocol.io/specification/2025-11-25/schema` (checked 2026-09-13).

## Draft trials and repair in the UI

The Canvas, inspector, Requests & changes, and Run evidence views include the
draft trial lifecycle.

Use **Draft trials** in the sidebar, or paste the opaque trial ID returned by the
host into **Inspect by trial ID**. Inspection loads `GET /api/trials/:id` directly.
The returned source hash stays attached to the root graph and every nested view;
polling never replaces it with a reusable workflow head. Trial source is kept
outside the saved-workflow cache. A missing exact source is shown as unavailable.

The trial view shows local acceptance and **Independent task unqualified**.
Run evidence includes the trial receipt, returned artifact receipts, events and
recorded node outputs. Rejected input shows `run: null` without invented node
execution. Paused trials remain inspectable without start, answer, approval,
resume, cancellation or repair controls. A failed reinspection marks the prior
snapshot explicitly and preserves its displayed source identity.

For a terminal failed saved run, **Open diagnostic repair** appears only when
loaded records connect an applied request and applied proposal to that run's
exact hash and current head. The action sends those actual IDs and hash to
`POST /api/repair-requests`, then loads the returned request's actual host context.
The server remains responsible for provenance, verified failure, depth and stale
head checks. A concurrent head change is displayed as an error without rebinding.
Existing diagnostic requests remain inspectable through the failed run.

Requests from `agent-request` and `agent-diagnostic` retain their source labels,
lineage, preserved intent and automatic-generation-off message even when the
workspace is configured for automatic handling of user requests. Creating a
diagnostic record does not start generation or grant execution authority.

**Inspect delivery linkage** calls `POST /api/delivery` with the actual request,
proposal and run IDs. Its receipt and separately scoped task-suite evidence are
displayed without promoting suite passes to independent verification of this run.
If the recent state page lacks a matching applied request/proposal, the UI shows
that linkage is unavailable instead of guessing identifiers.

Run the browser audit with:

```sh
FOUNDRY_UI_TRIALS_E2E=1 node --test tests/ui-trials-browser.test.mjs
```

The audit reuses one installed Chromium at `/usr/bin/chromium` and blocks external
browser requests. Fixtures use real local HTTP, Store and Runtime with handwritten
neutral workflows; there are zero model calls. Each invocation preserves a new
`ui-trials-*` directory under `FOUNDRY_UI_ARTIFACTS`, or the system temporary
directory, containing screenshots, receipts, failure evidence, a synthetic
workspace and source identities. `inputRejectedSourceAvailable` records whether
the host returned the exact source for a rejected-input receipt. Missing source
is tested as a visible limitation, never substituted with the current saved head.

The normal test suite includes the pure linkage regression and skips the browser
unless explicitly enabled. No repository formatter, linter or typechecker is
configured in `package.json`; JavaScript syntax and repository test commands
provide the available native checks.

## Evidence boundary

The historical TUI failures (typed MCP R1–R3) are summarized in the repository's
`docs/RESEARCH.md` (experiment ledger; not part of the installed package).
New default regressions are `tests/trials.test.mjs`; independent actual-stdio
controls are `tests/mcp-repair-lifecycle-audit.test.mjs`. Read their dated receipts
for observed results. No new free-model run is claimed while the provider reports
its quota limit, and no offline scripted control is relabeled as model success.
