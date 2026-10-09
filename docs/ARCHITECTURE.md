# Workflow Foundry architecture — working contract

This document describes the implementation target, not a claim of completed
product capability. Source receipts and tests determine what is supported.

## Product boundary

Foundry is an installable procedural layer for an existing agent. It does not
require retraining, an embedded frontier model, ARC, or a universal framework.
The host agent reads progressively disclosed skills, obtains the current task,
capabilities and evidence, and submits a candidate workflow. Deterministic checks
and independent task oracles determine whether that candidate may be used.

ARC retains action authority and its existing evidence/state machinery. AMP's
existing semantic/context interfaces are optional providers, not redefined as a
workflow compiler. Integration with either must be demonstrated on their real
interfaces before being advertised.

## Four separate objects

1. **Task contract:** requested outcome, deployment envelope, budget, allowed
   effects and independently defined acceptance. A generated workflow cannot
   silently weaken it.
2. **Workflow:** immutable versioned program. Nodes describe capabilities,
   dependencies, conditions, checks, human questions and bounded control.
3. **Run:** one execution pinned to a workflow hash and registry identity, with
   durable node state and append-only events. Displayed state comes from this
   record, not a parallel UI interpretation.
4. **Proposal:** a replacement workflow bound to the old hash and a natural-
   language change request. It contains rationale, impact and evidence; stale
   proposals are rejected. Existing runs remain on their pinned program.

## Initial portable IR

The top-level workflow has `schemaVersion: "1.0"`, `id`, `version`, `title`,
`goal`, `domain`, `envelope`, `budget`, `nodes`, and `acceptance`.

Each node has `id`, `kind`, `needs`, optional `when`, and `description`.
Supported kinds are `task`, `assert`, `human`, `map`, `loop` and `wait`.
Top-level dependencies form a DAG. Iteration is explicit and bounded inside
`map` and `loop`, never a hidden unbounded graph cycle. Independent ready nodes
may run concurrently. Dependencies default to `join: "all_success"`: a skipped
or handled-error prerequisite propagates a skip, so a bypassed guard cannot admit
an effect. A deliberate join of alternative branches uses `join: "all_resolved"`;
it waits for all predecessors to complete, skip or produce a handled-error result.
A skipped node has no output; downstream references to missing outputs fail unless
guarded/defaulted explicitly. Uncertain and unhandled failed work never qualifies
as a resolved predecessor.

Task nodes name a host-registered `tool`, `args`, timeout and retry policy.
Arguments may contain `{ "$ref": "input.someField" }` or
`{ "$ref": "nodes.someNode.someField" }`. References are typed JSON traversal,
not JavaScript, shell or template execution. Condition objects use a small
operator language (`eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `exists`, `in`, `all`,
`any`, `not`); false, missing and invalid are different outcomes.

An assert node checks conditions; the final `acceptance` checks determine local
workflow completion. Those checks are not a substitute for independent benchmark
oracles: a model can create a weak workflow assertion, but cannot redefine the
external task's success criterion.

Human nodes hold a question and answer schema. They pause rather than invent a
response. Risk/authority approvals are separate runtime decisions bound to the
exact tool, arguments and workflow hash; a human-answer node or model text cannot
grant them. Changes in preference can trigger a versioned workflow proposal.

Map/loop nodes contain a nested workflow; output and per-iteration execution state
are namespaced. Every nested step is charged to the parent budget. Adapters must
reject constructs whose semantics they cannot preserve.

## Capability and execution boundary

Registry metadata is trusted configuration outside the generated workflow:
input/output schemas, implementation identity, permissions, side-effect class,
idempotency support, timeout/cancellation contract and risk. The workflow can
request capabilities but cannot define its own permissions or reclassify effects.
The initial bundled capabilities are safe local transformations, scoped artifacts,
and explicit test fixtures; external tools require a configured adapter.

The runner writes the intention before dispatch, then the result and an event in
one SQLite transaction. After a crash, an incomplete pure/idempotent operation may
be retried within its remaining budget; an incomplete non-idempotent operation
becomes **uncertain** and needs reconciliation. Exactly-once behavior is not
promised for arbitrary external services. Timeout without confirmed cancellation
is likewise uncertain for effects.

The runner uses a process lease; independent runners cannot execute the same run
concurrently. Attempts, retries, costs, deadline and nested work are durably
accounted. Completed work is not rerun on ordinary resume. Capability/schema
changes invalidate incompatible execution rather than silently changing meaning.

### Scheduling

Dispatch is work-conserving, per flow frame (the root, each map item, each loop
iteration). A node starts as soon as every node it `needs` is done and fewer than
`min(workflow budget.maxConcurrency, run policy maxConcurrency)` of the frame's nodes
are running; it does not wait for a batch it was not part of (the earlier dispatcher
ran up to that many ready nodes and waited for all of them, which cost 6.5-8.8 % of
wall on the records-v3 DAG shape, `research/review-20261007/04-efficiency-rust.md`
section 3.6). Composite nodes (map, loop) occupy a continuation slot in their own
frame only; the actual capability, model and code calls are bounded by the run-wide
semaphore of the same size. Budget reservation is unchanged: every start charges its
step and cost in one compare-and-swap update, so concurrent starts cannot overdraw.

Ready nodes are taken in the order the workflow declares them, so what runs next
depends only on the DAG and on which nodes have finished. Each dispatch takes the next
run-wide number (1, 2, ... continuing across resumes), recorded as `dispatch` on the
node's first chain event after the dispatch (`dispatchOrder(events)` in
`src/runtime.mjs` returns the order). The number is part of the hash chain, so a
replay's order can be compared with the recording's. It is a record, not yet an
enforced schedule: a replay serves model calls from the journal by node key and
attempt, so its outputs do not depend on the order, but its event interleaving can
differ from the live run's when the completion order does.

A failing node aborts its frame's scope. The frame then starts nothing, waits for the
nodes it has running to settle (nothing runs on after a frame returns or throws), and
throws the first real failure in declaration order (a cancellation only when every
failure is one). A node that ends `uncertain` stops new dispatch in the whole run:
running nodes finish, nothing else starts. An open human question or approval holds
back only its own dependents; independent branches keep going until nothing is left to
run, and the run then waits.

Sandboxed code and model-CLI subprocesses run in detached process groups whose
wall-clock limits are timers in the Foundry process, so they would outlive a CLI killed by
a signal. `foundry run`, `resume`, `tick` and `trial` therefore handle SIGINT and SIGTERM:
they abort every execution they own (the abort reaches each node's signal synchronously
and kills those groups), report the interrupted runs on stderr and exit 130/143 as a crash
would, so each run stays resumable (`tests/cli-interrupt.test.mjs`). A SIGKILL of the CLI
still leaves them running (the sandbox sets no CPU-time limit) until `foundry cancel`, `stop-all` or
`resume` finds them on file and stops them ("Cancel and stop-all" below).

## Cancel and stop-all

`foundry cancel RUN` and `foundry stop-all` (`src/control.mjs`; `POST /api/runs/:id/cancel` and `/api/stop-all` over HTTP)
stop runs whichever process executes them. The CLI that cancels is rarely the process that runs the work, so cancellation
goes through the store, never through a signal alone:

1. **Request.** `Runtime.requestCancel` writes `cancelRequest` into the run header and a `cancel.requested` event in one
   compare-and-swap update. It is durable and idempotent (the first request stands). A run that has already succeeded,
   failed or been cancelled refuses it (`RUN_CLOSED`): cancelling it is a no-op with a message, and nothing is written. An
   `uncertain` run is not executing, so there is nothing to stop either.
2. **The owner stops itself.** An execution looks for the request every `cancelPollMs` (250 ms) and when it takes ownership
   of a run. It aborts exactly as it does for a caller's signal: model calls are cancelled (journaled with what they
   consumed, `model.cancelled`), sandboxes and model CLIs are killed with their process groups, a capability that ignores its
   signal is abandoned after `cancelGraceMs` (2 s; a task whose capability has effects then ends `uncertain`). The owner then
   writes the verdict itself: status `cancelled`, verdict `inconclusive`, code `CANCELLED`, final events `run.verdict`,
   `run.stopped` (carrying the request). A run executing in the process that cancels it is aborted at once.
3. **Nothing executes it.** A run parked on a timer, a question or an approval, a run never started, and a run whose owner
   died (before or after the abort) are closed by the canceller in one update (`Runtime.closeCancelled`): the same verdict,
   with the nodes the dead owner left `running` settled (`uncertain` for a task whose capability has effects, otherwise
   `failed` with the cancellation) and the wait timers cleared by the seal. A live owner refuses this (`RUN_BUSY`).
4. **An owner that does not answer.** After `--grace` seconds (default 10) `cancel` reports it (exit 3); with `--force`, and
   always in stop-all, the owner is frozen (SIGSTOP), every process below it is killed (sandboxes and model CLIs by process
   group), the owner is killed (SIGKILL), and the run is closed as in 3. The owner is identified by the pid and start time its
   run recorded, never by name; this process, its ancestors and their process groups are never signalled (`escalationPlan`).
5. **What a killed owner leaves behind.** The process groups of sandboxes and model CLIs are recorded in `run_children`
   while they run (`src/children.mjs`, called from `src/sandbox.mjs` and `src/process.mjs`), so a group whose owner was
   killed from outside can still be found: `cancel` and `stop-all` stop what a dead owner left, and so does a run taken over
   by `resume` (a `children.reaped` event). A recorded group is killed only if its leader is still the recorded process (pid
   and start time) or its members remain.

`stop-all` cancels every run of the workspace that has not finished: executing runs and parked ones (so no timer restarts them
later); `--executing-only` leaves the parked ones alone. `uncertain` runs are left as they are. One run that cannot be closed
(a broken chain, a journal in another database without `--journal FILE`) is reported and does not stop the others. A stopped
run is final: `resume`, `answer` and `approve` refuse it. Exit codes: 0 stopped or nothing to stop, 2 a run stopped with an
effect of unknown outcome (listed in `effectsUnknown`), 3 not stopped; `foundry run` and `resume` exit 3 for a run that was cancelled.
Not covered: runs of `foundry trial` (isolated stores), and the processes of a capability that spawns its own (only sandboxes
and model CLIs are recorded). Tests: `tests/cancel.test.mjs` (library, two handles on one workspace), `tests/cli-cancel.test.mjs`
(separate processes, signals, process groups).

## Run state

A run is stored as rows (`src/run-rows.mjs`), not as one JSON blob: `runs.body` is the run
header (status, steps, cost, event head, owner, policy, approvals, verdict ...), `run_input`
holds the immutable input, `run_frames` one row per nested frame (a map item, a loop
iteration) and `run_nodes` one row per node instance (state plus output). An event reads and
writes only the rows it touches, so its cost does not grow with the run; the runtime's loop
reads statuses, labels and outputs by key and never re-reads the whole record.

- **Compare-and-swap.** Every row carries a revision; an update writes a row only if the
  revision it read is still current (`STATE_CONFLICT` otherwise), inside the same IMMEDIATE
  transaction as the chain event. The chain head, the owner token and the revisions are
  independent checks.
- **Bounds.** Each row has a byte bound (node state 1 MiB, output 2 MiB, frame 64 KiB, header
  4 MiB, input 2 MiB). The whole record must stay one value `data.mjs` accepts, because the
  verdict seal (`verdictInputsHash`), `verify-run` and outcome receipts (`digest(run)`) hash it
  whole: the run keeps two counters, its canonical size (`bytes`, rows plus the keys that place
  them) and its JSON value count (`items`), and each row's nesting is bounded by its depth in the
  record (40 levels in all). A soft bound (10 MiB) stops new nodes (`STATE_BUDGET`); every write
  keeps the hard bounds (12 MiB, 198,000 values); only the terminal update (the seal or failure
  receipt, `updateRun(..., { final: true })`) may use the headroom up to 15 MiB and checkData's
  200,000 values, so a run that fills its state still closes with a sealed receipt instead of
  staying `running`.
- **Integrity.** The `status` and `label` columns of a node row repeat its state so the runtime
  can query them; the seal hashes the states. `store.rows.mismatchedRows(id)` lists rows whose
  columns no longer repeat their state (or that belong to no frame): resume refuses such a run
  (`CHECKPOINT_TAMPERED`) and `verify-run` reports `STATE_ROW_EDITED`. As before, an edit made
  while a run is live and undone before the next check is not detected.
- **The record is unchanged.** `store.run(id)` returns exactly the record the whole-run store
  returned (same fields, sorted keys, same digest), and the CLI, HTTP API, MCP tools, replay keys
  and the event hash chain are the same. What an update returns (and `foundry run`, `answer` and
  `approve` print) keeps that store's key order too: stored keys sorted, keys the update added
  (such as `verdict`) after them (`Session.record()`). A workspace written by the earlier store
  opens as it is; its runs are split into rows by their first write, or all at once with
  `foundry migrate-store`. A store written by the first rows layout gains the `items` column, and
  each run is recounted by its next write. Code that reads `runs.body` directly sees only the
  header: use `store.run()`, `store.rows.*` or `tools/run-view/store-adapter.mjs`.

## Interfaces

- CLI: validate, prompt, import, run/resume, inspect, request/propose/apply,
  serve, mcp, install/doctor and evaluate.
- MCP over stdio: expose bounded design/evidence/validation/proposal operations.
  The protocol surface does not expose arbitrary shell execution or approval
  authority. Files remain inside an explicit workspace.
- Visual UI: render the canonical program and node/event status; inspect args,
  conditions, dependencies, failures and evidence. Natural-language edits enqueue
  requests handled by the host agent. A model-backed bridge must identify its
  provider and preserve raw output; a canned parser is not called an agent.
- Runtime: native only. The LangGraph/n8n export adapters and the `export`
  command were deleted under owner decision D6 (Git history keeps them); their
  interrupt, join and retry semantics remain research motifs, not export
  targets. Typed workflow JSON is the portable output.
- Installation: project-scoped, explicit client adapters, backups and conflict
  checks; do not overwrite existing global configs or silently elevate trust.

## Research and evaluation

The acquisition ledger distinguishes implementation, SDK, skill, specification,
benchmark and closed product. Dossiers trace real entrypoints and cite revision,
path and span. A public website does not reveal an internal harness.

The comparison design keeps architect, executor, tools, environment, budget and
human assistance separate. Baseline vs skills vs skills+domain vs improved skills
are diagnostic development conditions. A task set repeatedly inspected during
improvement is never described as held out. Commercial comparison needs actual
authorized product runs; local proxies cannot establish commercial parity.

Release gates include correct outputs, false-success detection, restart recovery,
duplicate effects, stale proposals, malformed references, unavailable tools,
branching/joins, human interruption, deadline/budget exhaustion and malicious
source content. No finite suite proves all possible worst cases. Unmodeled or
unsupported situations must fail visibly or escalate, not be labeled complete.

## Qualification and publication amendments — 2026-09-13

Evaluation receipts distinguish `construction` from `task-outcome`. Structural
checks and neutral transcript conformance can qualify construction behavior only.
A missing level is unclassified evidence, never an implicit task qualification.
The suite evaluator emits `task-outcome` because it executes the exact candidate
against independent named outcome checks. That scope remains limited to its
declared cases, registry and budget. The legacy `deploymentQualified` API field is
retained as an alias of this bounded `taskOutcomeQualified` result for compatibility;
it is not a general production-readiness assertion.

Proposal creation and request-state update are committed together. Application
also commits workflow insertion, head compare-and-swap, proposal state and request
consumption in one SQLite transaction. An interrupted process cannot publish a
new program head while leaving the same request available for another application.
Tests inject both failed metadata writes and actual process death before commit.

MCP `foundry_run` advertises an explicit required object input. The separately
named `foundry_run_json` transport accepts one intentionally serialized JSON value,
parses it once and applies the same workflow schema. No implicit object/string
coercion is used to accommodate an agent's erroneous call. This separation came
from observed actual-TUI failures, which remain in the diagnostic evidence.

Native runs now bind the loaded engine source/schema and declared Node/Ajv
execution identity at creation, with the same identity in the creation event.
Pending runs with different or missing bindings are not silently resumed. Existing
evidence remains inspectable; migration or new execution is a distinct operation.
This compatibility check is not remote attestation and cannot prove a mutable
external service or model retained its behavior.

The structural pass distinguishes excluded paths from unknown ones. It checks
closed capability schemas and native control wrappers, keeps local schema roots
separate, and reports initializer/recurrence gaps. Reads behind unresolved guards
remain warnings. Existence probes and defaults retain missing-value behavior.
Neutral execution still checks causal message handoffs; static validity is not
a task-success oracle.

The MCP lifecycle includes isolated, bounded candidate trials before application.
Only exact default core tools are admitted by default; external tools need explicit
host qualification and still intersect normal authority. Trials do not create a
reusable head, consume a request, overwrite an earlier draft or qualify task success.
An applied program's terminal failure can open an evidence-bound diagnostic
descendant preserving the original task, goal and criteria. Such descendants are
not auto-dispatched by the background processor. Changing the goal is a separate
user action, and declared intent preservation alone cannot prove semantic fidelity.

## Construction and outcome modules — 2026-09-17

These modules were added during the consequence study. They are library and CLI
features. Live model campaigns using them are recorded separately.

- `src/construction.mjs` is the facade for construction experiments, behind
  `foundry construct-compare | construct-intent | construct-objective`. It freezes a
  harness family, intent class or objective, builds the builder-visible pack, detects
  held-out leakage, compares a candidate's closeness to a sealed target, and turns
  gaps into a constraint ledger. Providers are scripted unless a host supplies one.
- `src/construction-families.mjs`, `construction-industry.mjs`,
  `construction-durable.mjs` and `construction-closed.mjs` hold source-derived harness
  motifs and sealed held-out targets. These cover open-source agents, public industry
  products, durable-execution engines and closed products, and include
  `FOUNDRY_IR_LIMITS`. Each target is checked against its own scenarios at load time.
- `src/construction-objective.mjs` extracts requirements from a free-text objective
  and composes a native candidate. Constructs the IR cannot express are listed in
  `IR_UNSUPPORTED` rather than approximated.
- `src/outcome-repair.mjs` registers a frozen host expectation for one required
  JSON artifact (`exact-json-artifact/2`). It observes a run as
  satisfied, unsatisfied or unknown, and opens a goal-preserving repair request from an
  unsatisfied receipt. It never dispatches a provider, applies a proposal or runs a
  workflow by itself. See [OUTCOME-REPAIR.md](OUTCOME-REPAIR.md).
- `src/outcome-history.mjs` is the read-only historical inspector. It re-evaluates
  retained evidence after the registry changes and always reports
  `currentWorldQualification: false`.
- `src/ollama-local.mjs` is a library-only local Ollama provider. It is not wired into
  the CLI.
