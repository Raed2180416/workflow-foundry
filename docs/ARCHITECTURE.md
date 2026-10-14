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
   `run.stopped` (carrying the request). A run executing in the process that cancels it is aborted at once. A request that
   lands after the owner last looked, while its flow is pausing the run (a question, a timer, an approval), is honoured in the
   update that would have parked it: the run is closed as cancelled instead of parked with the request unanswered (a parked
   run has no owner to see it, and a canceller that does not wait, the UI or `--grace 0`, has already returned). A run that
   finished first keeps its result. A run taken over (`resume`, `tick`) with its request already standing runs nothing, not
   even crash recovery: what an earlier owner left running is settled as in 3, so `resume` and `cancel` finish it alike.
3. **Nothing executes it.** A run parked on a timer, a question or an approval, a run never started, and a run whose owner
   died (before or after the abort) are closed by the canceller in one update (`Runtime.closeCancelled`): the same verdict,
   with the nodes the dead owner left `running` settled (`uncertain` for a task whose capability has effects, by the registry
   or by the effects its `tool.intent` recorded; otherwise `failed` with the cancellation) and the wait timers cleared by the
   seal. A live owner refuses this (`RUN_BUSY`). An owner that has exited but that its parent has not reaped (a zombie) is dead.
4. **An owner that does not answer.** After `--grace` seconds (default 10) `cancel` reports it (exit 3); with `--force`, and
   always in stop-all, the owner is frozen (SIGSTOP), every process below it is killed (sandboxes and model CLIs by process
   group), the owner is killed (SIGKILL), and the run is closed as in 3. The owner is identified by the pid and start time its
   run recorded, never by name (no recorded start time, no signal); this process, its ancestors and their process groups are
   never signalled (`escalationPlan`). `stop-all --grace 0` only asks, as `cancel --grace 0` does: no owner is killed without
   having had time to see the request.
5. **What a killed owner leaves behind.** The process groups of sandboxes and model CLIs are recorded in `run_children`
   while they run (`src/children.mjs`, called from `src/sandbox.mjs` and `src/process.mjs`), so a group whose owner was
   killed from outside can still be found: `cancel` and `stop-all` stop what a dead owner left, and so does a run taken over
   by `resume` (a `children.reaped` event). A recorded group is killed only if its leader is still the recorded process (pid
   and start time) or its members remain. Over HTTP no owner process is signalled; only such groups of dead owners are stopped.

`stop-all` cancels every run of the workspace that has not finished: executing runs and parked ones (so no timer restarts them
later); `--executing-only` leaves the parked ones alone. `uncertain` runs are left as they are. One run that cannot be closed
(a broken chain, a journal in another database without `--journal FILE`) is reported and does not stop the others. A stopped
run is final: `answer` and `approve` refuse a run once its cancellation is requested (before it is closed too), and `resume`
returns a cancelled run, or one whose cancellation stopped `uncertain`, unchanged. Exit codes: 0 stopped or nothing to stop, 2 a
run stopped with an effect of unknown outcome (listed in `effectsUnknown`), 3 not stopped; `foundry run` and `resume` exit 3 for a
run that was cancelled. Known gap: a model call the owner journaled but had not yet charged when it died is not charged by the
close (the run's cost leaves it out; verify-run warns `JOURNAL_ROW_UNREFERENCED`).
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

## Cross-run state (E3 step 1, L0 row 27)

`src/state.mjs`, run by `Invocation.stateNode` in `src/runtime.mjs`. A workflow declares named slots under `state`; `state` nodes read
and write them. Everything below is enforced by the validator and again at run time; `tests/state-node.test.mjs` covers each rule.

```json
"state": {"seen": {"type": "set", "maxItems": 100000, "ttlDays": 30, "writer": "dedupe"}},
"nodes": [{"id": "dedupe", "kind": "state", "needs": [], "description": "Mark the event id as seen", "slot": "seen", "op": "add", "key": {"$ref": "input.id"}}]
```

- **Types and operations.** `set` (get, add, delete), `counter` (get, incr, put, delete; safe integers, an absent key reads 0),
  `cursor` (get, put, delete; `monotonic: true` refuses a move back) and `record` (get, put, delete). Record and cursor values are
  checked against the slot's `schema`. Keys are non-empty strings of at most 512 bytes; a number is not coerced. Outputs:
  get `{found, version, value?, expiresAt?}`, add `{added, version}`, incr `{value, version, previousVersion}`, put
  `{version, previousVersion, changed}`, delete `{deleted, previousVersion}`; the dataflow analysis knows these shapes.
- **Scope.** A slot belongs to the workflow id: every version of that workflow shares it, and no other workflow can name it. A slot
  remembers the hash of what its entries mean (type, schema, label, monotonic); a run whose declaration differs is refused
  (`STATE_DRIFT`) while the slot holds live entries, and an empty slot adopts the new declaration. Migration is not built.
- **One writer.** Only the node the slot names as `writer` (or each of a list of at most 8, such as an upsert and an expiry) writes
  it, from one place in the workflow. At run time every key has a version, the slot revision of its last write (0 when absent,
  deleted or expired; a re-created key never reuses a version). Every operation runs in one IMMEDIATE transaction, so writers in
  one run (a map body) and in other processes serialize. `ifVersion` makes a write a compare-and-swap; a stale one is the typed
  refusal `STATE_VERSION_CONFLICT` and writes nothing. A `put` must name it (`0`: the key must be absent); `add`, `incr` and
  `delete` are atomic read-modify-writes and may.
- **Bounds and refusals.** `maxItems` (required), `maxValueBytes` (default 64 KiB, at most 256 KiB) and `maxBytes` (at most 64 MiB) per
  slot. Refusals are outcomes, not crashes: `STATE_VERSION_CONFLICT`, `STATE_FULL`, `STATE_VALUE_LIMIT`, `STATE_SCHEMA`, `STATE_KEY`,
  `STATE_CURSOR_REGRESSION`. Each is journaled, replayed, and handled by `onError: "continue"` (output `{ok: false, error}`). A run
  that fails on a lost compare-and-swap or a full slot is `inconclusive`; on the others, `harness_fault`. `STATE_DRIFT` and
  `STATE_CORRUPT` (a stored value that no longer satisfies its schema: the table was edited) are integrity faults that no
  continuation hides.
- **TTL.** `ttlMs` or `ttlDays`: each write sets `expiresAt = now + ttl`; at `expiresAt` the entry reads as absent. `add` of a live
  member does not refresh it. Expired entries are purged by later writes (all of them when a bound would otherwise refuse).
  `now` is the Runtime's `now` option (default `Date.now`), so expiry is testable under a simulated clock.
- **Labels.** A slot has an integrity `label` (default `trusted`). A read carries it, joined with its key's label. A write whose
  arguments or control (its `when`, its predecessors, an enclosing map) carry a label the slot's does not cover is
  `LABEL_POLICY` / `UNTRUSTED_STATE_WRITE`: untrusted data cannot be stored and read back as trusted by a later run.
- **Journal, crash and replay.** The operation, its `state_ops` row, the node's outcome and the chain events (`node.completed` and
  `state.op {opId, opHash}`) commit in one run update: a crash loses all of it or none, and a node left `running` re-executes an
  operation that never committed (a committed refusal stands). A replay run (`modelMode: "replay"`, the recording's `sampleSalt`)
  serves each operation recorded under the same replay key (salt, node key, request) and writes no state: a missing recording is
  `REPLAY_MISS`, a recording its run's chain does not bind (edited or planted) is `JOURNAL_TAMPERED`. `replay-or-live` is refused for
  workflows with state, because a recorded write that is served is not applied. `verify-run` re-hashes every bound row
  (`STATE_OP_EDITED`, `STATE_OP_MISSING`, `STATE_OP_FOREIGN`) and reports rows no event binds (`STATE_OP_UNBOUND`).
- **Not built.** A sweep or listing of keys, migration of a drifted slot, sharing a slot between workflows, state in the envelope
  of a compiled solver, and a UI view of slots (`store.state.slots()` / `entries()` are the read API).

## Signal waits and absolute timers (E3 step 2, L0 rows 18 and 19)

`src/signals.mjs` holds the rule; `Invocation.wait`, `decideWait` and `finishWait`, and `Runtime.deliverSignal` and `correlateSignal`
in `src/runtime.mjs` apply it. `tests/wait-signal.test.mjs` covers each item below.

```json
{"id": "pay", "kind": "wait", "needs": [], "description": "Wait for this order's payment", "signal": "payment.settled",
 "correlate": {"$ref": "input.order"}, "schema": {"type": "object", "required": ["amount"], "properties": {"amount": {"type": "number"}}},
 "timeoutMs": 86400000, "onTimeout": "escalate"}
```

- **Shapes.** A timer wait has `delayMs` (at most 1 hour, as before) or the absolute `at`: epoch milliseconds, an ISO 8601 date-time
  with an explicit offset, or a reference to either, resolved when the wait starts (a local time without an offset is refused; every
  field is range-checked). A signal wait has `signal` (one name, with optional `correlate` and payload `schema`) or `race` (2–8
  signals, each with its own), and exactly one timer: `timeoutMs` (at most 30 days) or `at`. A signal wait without a timer is refused
  (`WAIT_UNBOUNDED`); other mixes are `WAIT_SHAPE`. One signal name has one payload schema per workflow (`SIGNAL_SCHEMA_CONFLICT`); no
  schema means the signal carries no payload. Output: a delay `{waitedMs}`, an absolute timer `{wakeAt}`, a signal
  `{outcome: "signal", signal, id, key, payload, at}`, a timeout `{outcome: "timeout", at}` (`at` is the timer's time, not the clock's).
- **What starts with the wait.** Its wake time and, for each subscription, the correlation key computed from the instance
  (`correlate` is a template over the input, node outputs and map/loop locals) are fixed in its `node.started` event, its state and its
  timer row, in one commit, so a crash keeps them. A signal wait's or absolute timer's time after the run deadline is refused there
  (`WAIT_DEADLINE`): the run would stop on `DEADLINE` before any timeout branch ran. The run deadline is the smaller of the workflow's
  `budget.maxDurationMs` and the runtime policy's (default 1 hour), so a host that wants day-long waits raises both. A decided wait keeps
  a due timer until it completes, so a process that dies in between leaves a run the next timer scan resumes.
- **The rule.** A wait takes the first-delivered unconsumed signal that matches one of its subscriptions (same name; same key, unless
  the subscription has no `correlate`) and was received strictly before its timer; with none, it times out once the clock reaches the
  timer (a tie goes to the timer). A newly delivered signal goes to the parked, unresolved wait it matches that started first. Each
  signal is consumed at most once; the losers of a race (the other signals and the timer) are cancelled and named in the decision.
- **Delivery.** `Runtime.deliverSignal(run, {id, name, key?, payload?})`, `foundry signal RUN --name --id [--key] [--payload]`, `POST
  /api/runs/:id/signals` (local UI token, as for answers and approvals). The workflow must declare the name (`SIGNAL_UNDECLARED`) and the
  payload must satisfy its schema. One compare-and-swap update puts the signal in the run's inbox (header `signals`) with the time it
  was received, appends `signal.delivered` (with the payload), and, if a parked wait takes it, records that wait's decision
  (`wait.resolved`, by `delivery`) and moves its timer to now, so the next `foundry tick` or `serve` scan (or the HTTP route itself)
  resumes the run. Otherwise the signal stays buffered: a wait that starts later takes it if it matches and arrived before that wait's
  timer (out-of-order delivery), and a late signal (after its wait resolved) is kept, unconsumed. A closed run, or one whose
  cancellation was requested, takes none (`RUN_CLOSED`). At most 256 signals per run; payloads at most 64 KiB, keys 4 KiB.
- **Correlation without a run id** (BAR-SET G1). `Runtime.correlateSignal`, `foundry signal` without RUN, `POST /api/signals`: the one
  open run with a parked wait subscribed to that name and key takes it; none is `SIGNAL_UNMATCHED`, several runs `SIGNAL_AMBIGUOUS`.
  Only waits that declare `correlate` are found, and only parked ones (a run that has not reached its wait cannot be found; deliver to
  it by id and it buffers). Keys match exactly (canonical JSON); fuzzy or mistyped business keys are the solver's job.
- **Idempotency.** The signal id is the idempotency key, unique in the workspace (table `signals`): the same id with the same run, name,
  key and payload is a no-op that returns the first delivery (`duplicate: true`); with anything else it is `SIGNAL_CONFLICT`, and nothing
  is written.
- **Timeouts.** `onTimeout`: `fail` (the default) fails the wait with `WAIT_TIMEOUT` (verdict `inconclusive`); `continue` completes it
  with outcome `timeout`; a node id names the timeout branch: that node (it must need the wait and join `all_success`) runs on a
  timeout and every other direct dependent joined `all_success` is skipped, and the reverse when a signal arrives.
- **Labels.** Signals are trusted by default, as answers are: an authenticated delivery. A wait's `label` marks what its signals carry
  as untrusted; its output then carries that label, joined with the labels of what its keys and `at` were computed from, and a wait
  whose onTimeout names a branch is control for its direct dependents (validator and runtime alike).
- **Journal and replay.** Every input of the rule is journaled before it decides anything (the wait's subscriptions and timer, each
  signal with its receipt time, each decision), so every outcome is a pure function of the chain. `replayWaits(events)` re-derives each
  decision from the chain alone, and verify-run reports any difference (`WAIT_REPLAY_MISMATCH`: an error on the engine that recorded the
  run, a warning on another). A wait completes from the chain, not from the record: its decision must be its `wait.resolved` event and
  its payload is read from the `signal.delivered` event. Resume refuses a record whose inbox or wait decisions differ from the chain
  (`CHECKPOINT_TAMPERED`; verify-run `SIGNAL_EDITED`).
- **Not built.** Re-executing a recorded run with its signals into a new run (the clock is not journaled, so timeouts would race
  again; replay here is the re-derivation above), a workspace-level buffer for signals no run waits for yet, non-interrupting
  reminders on a waiting step (G3), pausable business-calendar clocks (G15/G16), `at` in business time zones, and a UI for open waits.
  A map whose item parks stops starting new items (as for any pause), so a correlated fan-out needs `concurrency` of at least its item
  count.

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
