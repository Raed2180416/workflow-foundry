# ARC existing workflow and graph system

## Provenance and inspection depth

- **Source:** user-owned local implementation, not a downloaded SDK or a reconstruction of a proprietary product. Public upstream URL was not established by this audit; no public-source acquisition was performed.
- **Inspected root:** `/home/raed/.agentic-os` (`ARC_ROOT` below). All source references below are relative to this exact root unless explicitly qualified.
- **Revision:** `4059ac32606acadf22e7c9e21480a6aaf48c65dc`, checked before and after inspection on **2026-09-13 UTC**. This is the inspection date, not an asserted upstream release date. There was no new acquisition; an exact acquisition time is not applicable.
- **Repository census:** `git ls-files | wc -l` returned **3,784 tracked paths**. This is not a count of audited files or executable source files. The tracked working-tree status before and after was only ` M .serena/project.yml`; it was left untouched.
- **License:** package metadata marks the project private. `git ls-files 'LICENSE*' 'COPYING*' 'NOTICE*'` returned no tracked root notices. This audit establishes no public redistribution license. Reuse recommendations describe mechanisms; copying private source into a public Foundry package requires a separately established publication decision.
- **Depth:** targeted end-to-end source audit of the daemon, turn runner, legacy planning/steering, immutable runtime, candidate boundary, operator journal, and primary Rust TUI; bounded tests and in-memory counterexamples. This is not an audit of every tracked file or an observed live model run.
- **Related worktree:** `/home/raed/.agentic-os-worktrees/clide-ui-parity-genome` could not be inspected. Core rejected it as outside approved roots; Remote Desktop Commander had no online device; CodeGraph reported no existing index. No index was created and no repository or worktree was modified to gain access. Conclusions about the primary TUI must not be projected onto that sibling.
- **Evidence tools:** Core supplied current numbered source, repository searches, and bounded terminal execution. CodeGraph supplied structural navigation and current source excerpts for the primary repository. Serena's initialization returned `PLUGIN_DISABLED`, so no Serena diagnostics are claimed. No browser/UI session, external model, or live tool action was started.
- **Write scope:** only this dossier in `/home/raed/Projects/workflow-foundry/research/dossiers/`. The new project's `AGENTS.md` and dossier template were read. There were no additional `AGENTS.md` files in `research/` or `research/dossiers/` at inspection.

### Main finding

ARC contains useful immutable intent, evidence, capability, and replay machinery. Its current source also contains **several distinct control representations**, with different consumers and different meanings of success. It is inaccurate to call everything a facade: ordinary frozen turns reach a modern TaskRuntime admission callback and can reach a bounded, task-conditioned shadow scheduler. It is equally inaccurate to describe that route as a complete general workflow engine: the modern candidate-author path deliberately returns unresolved after recording and evaluating one isolated candidate, and the coordinator terminal bridge has no positive transaction for applying a new candidate.

The recommended Foundry foundation is a small, explicit workflow IR and interpreter with independently enforceable contracts. Port the strongest ARC mechanisms through adapters and conformance tests. Do not put a new visual graph on top of the legacy phase ribbon or assume that changing a prompt changes the authoritative execution graph.

### Source evidence index

The ranges below identify the inspected behavior used in this report. A declaration proves existence; a caller proves source reachability; neither proves that a service was running with the necessary configuration.

| ID | Referenced source ranges / exercised suites | Evidence |
|---|---|---|
| E01 | `scripts/arc-daemon.mjs:1925-1968,2360-2445,2990-3139` | Client dispatch, total turn receipt, original product TaskRuntime admission and graph-control entry. |
| E02 | `scripts/chat-turn-runner.mjs:3301-3735` | Input admission, casual bypass, pending draft, freeze, semantic admission and source-bound author context. |
| E03 | `scripts/arc-daemon.mjs:2170-2245,3156-3229` | Attested product adapter selection; original-runtime candidate recording, materialization, evaluation and terminal bridge. |
| E04 | `scripts/task-runtime.mjs:3427-3533,4518-4607` | Reserved delta transactions, version activation and canonical bootstrap graph. |
| E05 | `scripts/task-delta-v2.mjs:10-71,72-197,200-291` | Closed primary/shadow union and mandatory projection coverage policy. |
| E06 | `scripts/task-conditioned-workflow-v1.mjs:19-80,147-223,272-535` | Registry-conditioned stages, achievements, AND/OR edges, budgets and authority-free proposal. |
| E07 | `scripts/task-runtime.mjs:5270-5465,6010-6115,7990-8055` | Exact-cycle replay, durable branch schedule and runtime-owned executor call. |
| E08 | `scripts/langgraph-dynamic-scheduler-adapter-v1.mjs:1-197` | Optional scheduling wrapper, exact branch-set join and explicit absence of execution/effect authority. |
| E09 | `scripts/governed-phase-machine.mjs:17-90`; `scripts/governed-engine-phase-adapters.mjs:194-298` | Fixed macro phases and memoized single coordinator execution reused across phase labels. |
| E10 | `scripts/arc-daemon.mjs:3351-3360,3380-3445`; `scripts/multihour-loop-runner.mjs:98-207,510-560` | Gated multi-hour selection, phase focus and user steering appended to turn input. |
| E11 | `scripts/plan-ledger.mjs:1-75,190-318,546-623,657-681`; `scripts/multihour-loop.mjs:391-467,476-560` | Separate hierarchical planning ledger, ordering-only dependencies, bounded expansion and phase outcome folding. |
| E12 | `scripts/steering-channel.mjs:1-53,60-65,96-123,155-330` | Legacy steering shape, JSONL store, consumption before phase execution and acknowledgement failure behavior. |
| E13 | `scripts/reliable-coding-loop-plan-graph-adapter.mjs:112-249,278-453` | Narrow ground/act/verify adapter for supplied patch plus final command. |
| E14 | `scripts/task-runtime.mjs:11135-11405` | Host-registered handlers, leases, capabilities, exact effect arguments, write-ahead request and in-doubt state. |
| E15 | `scripts/product-task-terminal-bridge-v1.mjs:47-126,134-239` | Exact candidate lineage and current-source checks; replay-only success; missing new-candidate promotion. |
| E16 | `scripts/chat-turn-runner.mjs:4263-4395` | Modern author limited to one exact target; candidate recorded/evaluated but explicitly not applied. |
| E17 | `scripts/arc-daemon.mjs:4363-4568`; `scripts/arc-operator-turn-journal.mjs:1-334` | Operator capability check, durable answers, exact frozen result, restart handling and re-driven turn. |
| E18 | `scripts/task-runtime.mjs:10810-10985` | Separate graph-node answer application, epoch check, resume transition and retry timing. |
| E19 | `scripts/arc-daemon.mjs:4876-4960`; `scripts/clide-task-runtime-projection-v1.mjs:4381-4405` | Physically read-only replay, sidecar verification, branded projection and typed errors. |
| E20 | `apps/arc-tui/src/workspace/state.rs:754-785,3013-3153,3386-3445,4428-4448` | Runtime read-model cache, matching answer receipt, explicit chat/task binding and automatic pull after turn completion. |
| E21 | `apps/arc-tui/src/workspace/render.rs:2170-2330`; `apps/arc-tui/src/workspace/protocol.rs:348-415` | Governed runtime rendered as status/evidence/node rows; operator and projection wire contracts. |
| E22 | `scripts/tests/plan-graph-v1.test.mjs:134-389`; `scripts/tests/task-delta-v2.test.mjs:50-365` | Successfully executed contract tests. |
| E23 | `scripts/tests/task-conditioned-workflow-v1.test.mjs:1-183`; `scripts/tests/arc-operator-turn-journal.test.mjs:1-121`; `scripts/tests/product-task-terminal-bridge-v1.test.mjs:1-272` | Relevant test bodies inspected; execution blocked during module loading. |

## End-to-end trace

### 1. User input becomes a source-bound task, with a separate clarification path

`handleMessage` routes `chat-send` to `handleChatSendWithTerminalSignal` (E01). The wrapper deduplicates a concurrent submission by request identity and emits a `turn-complete` lifecycle frame in `finally`. This frame ends a chat turn; it is **not** a `TaskCompleted` proof. A task ID is included only when the returned outcome contains one (`arc-daemon.mjs:2425-2438`).

`runChatTurn` screens and segments the original prompt before its main compilation path. A casual online fast path returns without a TaskSpec; the governed trace below applies to non-casual tasks that reach compilation. The compiler produces a pending or frozen TaskSpec; a pending operator draft is resumed as that exact draft, rather than being silently regenerated from conversation prose (`chat-turn-runner.mjs:3384-3490`). Once frozen, the turn runner verifies its digest, derives an IntentProgram and GoalCapsule, and requires the admission result to bind the relevant semantic artifacts (`3528-3610`).

The ordinary daemon passes `admitProductTaskSpec` into this turn. That callback starts **the original task identity** in TaskRuntime and records semantic-intent admission (`arc-daemon.mjs:3015-3083`). Therefore older comments saying ordinary chats have no canonical chat-to-task mapping are incomplete for this revision: the server can return a task ID and the primary TUI records it (`state.rs:3398-3433`).

### 2. Modern control is reachable, but model transport and authority matter

`resolveProductBrainAdapters` differentiates an ordinary injected chat callback from a runtime-attested branch adapter. Without an injected product factory, supplying `invokeLocalOption` alone returns `INJECTED_CHAT_TRANSPORT_HAS_NO_RUNTIME_ATTESTATION`; an offline local model returns no adapters (`arc-daemon.mjs:2185-2200`). The default attested factory receives model/runtime artifact paths and stores its receipts under the canonical product evidence root (`2202-2225`). No runtime attestation was exercised in this audit.

With semantic admission and at least one product adapter, the daemon calls `initializeTaskConditionedPlanV1()`, then `advanceUnresolvedFrontier()`. The bootstrap method is deliberately zero-argument: the caller cannot select a node, topology, workspace or budget. It verifies the current TaskSpec/GoalCapsule artifacts, accepts the canonical bootstrap graph if absent, and opens `semantic-bootstrap` (`task-runtime.mjs:4532-4606`).

The compiler for the task-conditioned shadow workflow constructs stages from the admitted work profile and IntentProgram. It uses a code-owned operator registry and achievement policy. It supports sequence and AND/OR proposal structure, but its global limits are 16 stages, 256 nodes, 512 edges and two initially ready branches. Each ready branch has at most one model call, zero tool calls and a shadow authority ceiling (`task-conditioned-workflow-v1.mjs:23-26,210-223`). Its own result explicitly declares no truth, primary-graph, effect or completion authority (`517-523`).

That is meaningful task conditioning: different admitted work families can produce different operator sets and stage structures. It does not amount to arbitrary executable workflow synthesis. In particular, the apparent verification gate in this shadow graph is a blocked proposal obligation, not evidence that an independent verifier has run.

### 3. Durable branch execution belongs to TaskRuntime

`advanceUnresolvedFrontier` binds the active intent epoch, source artifacts, exact graph digest, decision state, adaptive proposal and expected branch set. It resolves or records the durable schedule and calls `executeDynamicBranchScheduleV1` with only its schedule-artifact ID and adapter ID (`task-runtime.mjs:6010-6064`). The executor rejects a schedule for a stale graph epoch and resolves the exact recorded proposal (`7998-8055`).

A preflight refusal yields a blocked control outcome with no progress authority. Ambiguous invocation leaves an open in-doubt cycle, preserving the possibility of later reconciliation (`6065-6115`). This is an important boundary for a portable workflow engine: a model proposal and a returned message are different from a committed physical execution receipt.

The daemon has a bounded follow-up: when the first advance awaits independent evidence, it executes the repository probe, advances again, derives author inputs, and records eligibility if lineage exists (`arc-daemon.mjs:3092-3129`). This is a concrete product consumer of the modern graph-control machinery, not merely a test-only compiler.

The optional LangGraph wrapper receives an already frozen branch set and returns through the native exact-set join. It explicitly declares checkpoint state to be acceleration-only and has no idempotency, ledger, effect or selection authority (`langgraph-dynamic-scheduler-adapter-v1.mjs:186-195`). A correctly hashed callback result cannot prove physical isolation or exactly-once execution. In the inspected non-test/non-verification `scripts/` sources, the exported `runLangGraphDynamicBranchScheduleV1` had no call site beyond its declaration. The product path traced here invokes TaskRuntime's native executor. This is a bounded static reachability finding, not a claim about every possible external caller.

### 4. The modern candidate path stops before effects and completion

When graph-control context exists and the candidate policy is eligible, `runChatTurn` requires exactly one allowed target file, a runtime-owned recorder and lease preparation. The generated candidate must contain that one path and matching entrypoint (`chat-turn-runner.mjs:4269-4312`). The daemon records the proposal, physically materializes it, and evaluates that exact materialization through the original runtime (`arc-daemon.mjs:3176-3191`).

After obtaining proposal/materialization/evaluation event IDs, the turn runner renders the result as supported, refuted or unresolved, explicitly says it was not applied, and returns `status: 'unresolved'` in all three cases (`chat-turn-runner.mjs:4350-4395`). This is the most direct current product breakpoint. A successful isolated candidate evaluation does not currently advance this path to a source effect or task completion.

The coordinator terminal bridge is separately wired (`arc-daemon.mjs:3212-3228`). It verifies exact candidate event ancestry, hashes, workspace identity and a supported Oracle evaluation (`product-task-terminal-bridge-v1.mjs:81-126`). It then checks the current workspace and repository base before effect admission (`207-213`). For a new running task, it ultimately returns `unverified`, stating that the runtime-owned candidate-specific effect and promotion transaction is not installed (`224-238`). Its only positive result replays a task that has **already** succeeded with a matching completion lineage (`182-200`). Its header's older description of running the coding loop is not an accurate description of this final function body.

Do not bridge this gap by setting `solved`, accepting a model's verifier command, or calling generic completion. The missing positive transaction needs an exact candidate, sealed evaluation, current-source check, effect request/result, and candidate-specific terminal evidence in one governed lifecycle.

### 5. Older phase orchestration and multi-hour planning are separate systems

The legacy `GovernedPhaseMachine` exposes the fixed sequence `intent → research → explore → context → patch → verify → apply` and advances by array index (`governed-phase-machine.mjs:19-27,74-89`). `createCoordinatorPhaseDelegator` memoizes one coordinator run and returns its shared result under different phase labels (`governed-engine-phase-adapters.mjs:194-256`). This facade cannot establish that each displayed phase caused a distinct action or independent verification.

A different legacy route is selected only when `ARC_MULTIHOUR_LOOP === '1'`, mode is `auto`, and the signal is not already aborted (`multihour-loop-runner.mjs:108-109`; daemon selection at `3384,3421-3437`). This route uses the hierarchical `plan-ledger` and accumulates coding phases. The ledger has `goal/subtask/step` nodes and `pending/in-progress/done/blocked/skipped` statuses, rather than the modern PlanGraph contract.

Its dependencies mean **run after the predecessor has settled**, including failure. `nextActionable` accepts `done`, `blocked` or `skipped` predecessors (`plan-ledger.mjs:277-300`). That makes sense for trying independent code-file repairs despite a failed neighboring repair; it is unsuitable for a workflow edge meaning “execute only after successful authorization/validation.” `isPlanComplete` means there are no actionable nodes; `fullySucceeded` is a separate summary (`305-314`). A UI or adapter must not turn that drain condition into successful completion.

On repeated failure, optional bounded `expandNode` creates children and redirects dependents, with global and per-node expansion caps (`plan-ledger.mjs:546-609`; `multihour-loop.mjs:525-555`). This is a real tree mutation in that ledger. It is not the same operation as accepting an immutable PlanGraph insertion or activating a new frozen TaskSpec version.

### 6. Natural-language steering currently changes prompt context

The old steering channel uses a separate per-repository/chat JSONL path, under `~/.agentic-os-tmp/steering-channel`, with queued messages and consume markers (`steering-channel.mjs:170-182,191-254`). At phase boundaries, the loop polls for the next actionable node, then passes returned messages in `ctx.steering` to `runPhase` (`multihour-loop.mjs:484-502`). The runner joins the text and appends a marker and correction to `rawPrompt`; it also refreshes a `focusPlan` array (`multihour-loop-runner.mjs:145-153,183-207`).

This producer/consumer does not produce an inspectable proposed PlanGraph revision, changed-edge diff, permission delta or acknowledged new intent epoch. The main daemon dispatch contains no plan-propose/edit/apply frame (`arc-daemon.mjs:1925-1968`). The inspected TUI protocol/input search likewise did not expose a steering-submit action. The source establishes a gated polling consumer and a file-store producer API, not the requested complete natural-language visual workflow editor.

There is also a delivery boundary: `pollSteeringOnce` marks a message consumed **before** the phase begins. A crash after polling can remove the correction from the queue without applying it. A failed consume-marker write is swallowed but `consumedCount` is still based on the number of selected messages (`steering-channel.mjs:291-310`). Both behaviors were reproduced with an in-memory store, without filesystem or model operations; see validation below.

### 7. Human clarification is durable; arbitrary graph revision is not connected to it

The daemon's operator handler validates the private local operator capability for a network socket, rejects a mismatching question-set ID, normalizes answers, and writes durable answers through `ArcOperatorTurnJournal` when the parked turn is durable (`arc-daemon.mjs:4370-4406,4500-4533`). The journal validates the whole batch before appending, preserves conflicting duplicates as errors, and rebuilds the frozen TaskSpec from the exact pending draft plus durable answers (`arc-operator-turn-journal.mjs:250-290,303-331`). Its JSON restart envelope is a handle; TaskRuntime/EventKernel own authority.

Durable parked turns remain until frozen admission succeeds. The daemon then re-drives the same prompt through the whole turn wrapper, with the answers folded in (`arc-daemon.mjs:4536-4568`). This is useful recovery behavior. It does not by itself implement editing an already active arbitrary graph.

TaskRuntime also contains a distinct `resumePlanNodeFromOperatorAnswer` method. It resolves the raised question and answer events, checks the exact intent/base/execution graph epoch, records `PlanNodeOperatorAnswerApplied`, and moves a suspended node to ready with an incremented attempt (`task-runtime.mjs:10810-10929`). In the inspected production `scripts/` search, only its declaration was found; call sites were in tests. The daemon's parked-turn path uses the journal instead. Treat graph-node resume as a reusable runtime API whose product consumer still needs to be established.

Likewise, `activateTaskSpecVersion` requires a primary user-decision bound to the previous active digest, validates the exact successor bytes, persists them and appends activation (`task-runtime.mjs:3443-3533`). Static production searches found declarations, not a daemon/UI call, for this method and `applyAdaptivePlanDecision`. Do not infer reachability from the similarly named projection fields.

The wire advertises answer arrays while the handler chooses the first non-`other` selected ID (`arc-daemon.mjs:4441`) and the durable normalization chooses either that ID or freeform (`4511-4515`). The primary card is described and implemented as a single-choice flow. A future multi-choice or ordered-answer UI needs an explicit end-to-end contract; it cannot rely on the presence of `selectedIds`/`orderedIds` fields alone.

### 8. Tool authority and verification are reusable, but the narrow executor is not a universal backend

`runEffect` resolves a host-registered handler, verifies the active lease and running node, enforces exact causal decision-input artifacts, checks recorded capabilities and graph-declared authority, and enforces the tool budget (`task-runtime.mjs:11135-11309`). It persists arguments/registry evidence and appends `EffectRequested` before calling the adapter (`11311-11377`). An identical retry returns the prior result or an in-doubt state; it does not blindly repeat an uncertain effect (`11241-11264`). A thrown adapter leaves the durable request unresolved because the external effect may already have happened (`11390-11396`).

The older coding PlanGraph adapter gives a concrete narrow example: `ground → act → verify`, a supplied patch, and one final independent command. It rejects wider setup/test/provisioning options, uses exact command bindings, and compares the verifier workspace before and after execution (`reliable-coding-loop-plan-graph-adapter.mjs:112-249,278-317`). Its already-admitted-task entry also refuses an already existing PlanGraph (`378-409`), so it cannot simply be attached after the modern bootstrap without a deliberate graph transition. Reuse its isolation and evidence binding ideas; rebuilding its three nodes as a “general workflow” would reproduce the same narrowness.

### 9. Graph/TUI projection is real and read-only

The daemon opens EventKernel read-only, replays a requested task, verifies referenced sidecars, and compiles the CLIDE projection (`arc-daemon.mjs:4904-4935`). Missing, unavailable, corrupt and projection-failed outcomes remain distinct (`4917-4925,4942-4960`). The projection compiler rejects an unbranded replay (`clide-task-runtime-projection-v1.mjs:4381-4390`), while TaskDelta's closed registry requires new semantic kinds to declare projection coverage (`task-delta-v2.mjs:200-291`).

The primary Rust UI caches the projection, validates task identity and coherence, and requests it after the explicit `turn-complete.taskId` binding (`state.rs:3088-3153,3390-3433`). Operator cards are retained while submitting and cleared only on a matching positive answer receipt (`3041-3058,4428-4447`). Several adjacent older comments say cards are cleared optimistically or chats lack a mapping; current code supersedes those comments.

The inspected runtime renderer displays status, evidence counts, digests and node rows (`render.rs:2170-2318`). These are useful inspection surfaces. They do not establish an editable canvas, node-level mutation protocol, or continuous live execution-graph subscription. The dispatch exposes a pull-based projection request; the inspected subscription topics are chat/status/notes/todos/browser. A Foundry UI should preserve the read-model boundary while adding a separate, version-bound proposal flow.

## Contracts

| Concern | Existing contract worth retaining | Boundary or missing composition |
|---|---|---|
| Intent | Frozen source-bound TaskSpec/GoalCapsule; explicit successor activation with prior digest and user-decision (E02/E04). | Legacy prompt steering does not invoke that successor transaction. |
| Graph semantics | Closed PlanGraph validation; explicit node authority, evidence and budgets (E13/E14/E22). | Legacy plan-ledger ordering edges and modern shadow hyperedges have different meanings. An adapter must declare which it supports. |
| Delta authority | Primary and shadow lanes; reserved runtime-owned transactions; mandatory projection disposition (E04/E05). | A recorded shadow suggestion is not accepted control or physical evidence. |
| Persistence | Content-addressed intent and decision artifacts; EventKernel replay; durable question journal (E04/E17/E19). | Legacy steering has its own JSONL consumption semantics. Journal answer batches are validated first but are not cross-file atomic transactions (`arc-operator-turn-journal.mjs:266-289`). |
| Concurrency | Exact branch denominator, exact adapter identity, active intent/graph epoch (E07). | LangGraph callback scheduling alone supplies no isolation or physical execution guarantee (E08). |
| Retries | Stable effect identity; duplicate requests yield prior result/in-doubt; explicit reconciliation (E14). | Legacy phase retries and skip/continue are a different policy. An automatic repeated effect is not implied by a retryable node. |
| Cancellation | Parked-question cancellation is recorded before removing the restart handle (`arc-operator-turn-journal.mjs:292-300`); phase-gate stop bypasses turn runners (E10/E17). | Full external-effect cancellation/compensation was not exercised. Do not label an unknown external effect cancelled merely because a chat turn ended. |
| Human input | Local channel, question-set binding, event-backed answers, exact draft freeze, matching UI receipt (E17/E20). | General graph-node resume and intent revision are APIs without a located main product caller. |
| Tool permissions | Host handler registry plus recorded grant plus graph authority plus lease and budget (E14). | Model text, workflow JSON, a canvas edit, or a LangGraph callback cannot mint a grant. |
| Verification | Candidate ancestry, immutable artifact/workspace hashes, independent Oracle and source drift checks (E15/E16). | Positive candidate-specific effect/promotion is missing on the traced product route. |
| Read models | Branded authoritative replay, verified artifacts, typed errors, explicit task identity (E19/E20). | The UI needs an event cursor/request identity for same-task stale responses, live changes and proposal/application receipts. This is a proposed extension, not an audited feature. |
| Portability | Pure PlanGraph/TaskDelta contracts load and pass selected tests (E22). | Broader compiler/runtime imports currently fail on a missing web-search dependency; avoid inheriting the whole import graph. |

### AMP, ARC and immutable evidence integration constraint

The following is the **requested Foundry integration boundary**, not a claim that an AMP provider adapter was located in these code paths. Searches for `AMP`, `Hippocampus` and `semantic-provider` in the inspected primary production source/contract scope did not identify that integration. Verify the actual AMP provider contract with its owner before implementing it.

AMP may return semantic context, source spans, retrieval provenance, freshness and uncertainty. Foundry may use that response to propose a workflow, identify missing evidence, or explain a revision. ARC remains the action authority: runtime identity, leases, capabilities, physical effect receipts, replay and completion belong to ARC or a conforming independent Foundry executor. Evidence artifacts remain immutable and attributable to the actual producer/validator. A retrieval hit, a model-generated claim or an AMP summary must never be converted into an executed-tool receipt or independent verification solely by changing its type label.

The web UI is a projection and proposal client. Its local positions, collapsed groups, selection and draft text are presentation state. It must not become a second owner of task state, graph success or permissions.

## Failures and falsifiers

| Finding | Concrete falsifier / acceptance experiment | Scope and consequence |
|---|---|---|
| **F01: a phase label can reuse the same coordinator invocation** (E09). | Instrument `runCoordinator`; traverse explore/context/patch/verify/apply and compare invocation and event IDs. A claimed independent phase requires distinct causal work/evidence, not repeated rendering of one result. | Reproduces the architecture of the memoized facade; no live coordinator call was made here. |
| **F02: new modern candidates do not reach application** (E16). | On an isolated harmless fixture, supply admissible single-target evidence and a supported candidate; demand a source effect and candidate-specific TaskCompleted receipt on the original task. Current branch returns unresolved/not-applied. | Directly established by the current return path; its model-dependent test suite could not load. |
| **F03: bridge success can only replay prior completion** (E15). | Start a running task with exact valid lineage and unchanged source; ask the bridge to promote it. Require a newly recorded candidate-specific effect before completion. Current final path returns unverified. | Do not count its existing-succeeded replay test as proof of fresh execution. |
| **F04: dependency settlement is not prerequisite satisfaction** (E11). | Mark `observe` blocked in a two-step `observe → act` legacy plan. A success-prerequisite workflow must block act. The current ledger selects `step:act`. | Executed in memory. Intentional legacy coding policy; incompatible with a generic prerequisite edge. |
| **F05: steering can be lost after dequeue** (E12). | Poll one message, then simulate process death before application. Restart must either redeliver or expose a durable unapplied delivery needing reconciliation. Current store yields no queued message. | Executed in memory. No guarantee that consumed text changed the plan. |
| **F06: steering acknowledgement can misreport a failed write** (E12). | Make `markConsumed` throw. Require an explicit uncertain acknowledgement; current poll reports consumedCount 1, while the next poll redelivers the same message. | Executed in memory. A delivery receipt must distinguish selected, delivered, applied and committed. |
| **F07: graph-node human resume and revision have no located main caller** (E04/E18). | Raise a graph-bound question during a real daemon task, answer through the UI, and require one correctly bound `PlanNodeOperatorAnswerApplied` plus resume transition. Then request an NL revision and require exact successor activation. | Static production search found only declarations for the relevant entry methods. External/dynamic consumers were not disproved. |
| **F08: a generic injected model is not the attested branch adapter** (E03). | Replace only `invokeLocal` and compare branch-execution receipts. Passing a chat callback is insufficient; a declared portable adapter must produce the required receipt or return a typed unsupported capability. | Prevents unfair model comparisons where only one arm enters the modern scheduler. |
| **F09: pure workflow tests import unrelated search dependencies** (E23). | Run the selected compiler/operator/terminal suites with existing dependencies only. They must load without booting optional web-search or model services. Current import fails on `readdown`. | Observed module-load blocker; no installs or old-repo fixes made. |
| **F10: a stale or decorative UI can imply more than replay proves** (E19-E21). | Corrupt a sidecar, send an older same-task projection after a newer one, or remove a shadow projection family. The view must show corruption/staleness explicitly and never invent success or a missing node. | Existing typed projection validation is a useful base. Same-task sequencing and an editable UI are proposed validation targets, not verified live behavior. |

### Reusable principles, applicability and cost

| Principle and source | Apply when | Counterexample to reject | Cost / tradeoff |
|---|---|---|---|
| Immutable intent epochs and exact successor binding (E04). | A user changes obligations, scope or permissions during a run. | Old approval silently authorizes new scope. | Requires proposal storage, stale-base handling and explicit migration of unexecuted nodes. |
| Exact evidence lineage (E15/E16). | A candidate is evaluated, materialized or promoted. | A passing test from another workspace is attached to the displayed candidate. | Artifact hashing, workspace retention and replay checks add I/O and storage. |
| Write-ahead effect ledger and in-doubt state (E14). | A tool can have an external effect before returning. | Retry after timeout blindly submits twice. | Needs connector-specific reconciliation; some operations remain human-disposition only. |
| Code-owned capability intersection (E14). | Generated workflows select operations. | Workflow JSON adds a new filesystem/network grant. | More adapter metadata and admission checks; cannot promise every agent backend supports every effect. |
| Typed primary/shadow projections (E05/E19). | Suggestions and executed facts coexist in one UI. | A proposed verification node appears as an executed pass. | Closed-schema evolution requires coordinated producer and UI changes. |
| Bounded branch schedules with exact joins (E06-E08). | Parallel candidate or evidence branches have a known denominator. | A missing branch is omitted and the remaining candidates are declared complete. | Explicit fan-out limits and failure policy may reduce apparent flexibility but improve accounting. |
| Durable question identity and receipt retention (E17/E20). | An operator must answer across reconnects or crashes. | A late answer receipt clears the current different question. | Requires idempotency, private local channel and atomic application state. |
| Explicit edge meaning and terminal meaning (E11/E22). | A domain uses both sequencing and hard prerequisites. | A failed prerequisite is treated as merely an ordering delay, or a drained plan is called successful. | More IR edge/state types; unsupported adapters must reject rather than approximate. |

### Validation performed

One bounded Node test invocation used **Node v24.20.0**, `--test-concurrency=1`, a new isolated `AGENTIC_OS_STATE_ROOT` and `TMPDIR`, local model autostart disabled, and a 45-second process bound. The new temporary root was removed afterward. The following existing suites were attempted:

```text
node --test --test-concurrency=1 --test-reporter=spec \
  scripts/tests/task-delta-v2.test.mjs \
  scripts/tests/plan-graph-v1.test.mjs \
  scripts/tests/task-conditioned-workflow-v1.test.mjs \
  scripts/tests/arc-operator-turn-journal.test.mjs \
  scripts/tests/product-task-terminal-bridge-v1.test.mjs
```

**Observed result:** 15 passing cases: nine PlanGraph checks and six TaskDelta checks. The command exited 1. Three test files failed during module loading, each with `ERR_MODULE_NOT_FOUND: Cannot find package 'readdown' imported from .../scripts/searxng-web-search.mjs`. Their individual test bodies did not execute. The runner's summary was 18 tests, 15 pass, three fail; those three are file-load failures, not evidence of three independently exercised contract failures. No dependency was installed or modified.

Passing cases covered canonical hashing/freezing, unknown fields, malformed/dangling/cyclic graphs, authority and independent-evidence requirements, node dependency/retry/evidence rules, repeated negative states, delta lane separation, and deterministic/idempotent replay. They do not establish model quality, end-to-end product completion, or live UI correctness.

Three additional **memory-only behavioral probes** completed with these observations:

```json
{
  "steeringDelivery": 1,
  "queuedAfterUnappliedDelivery": 0,
  "reportedConsumedOnFailedWrite": 1,
  "redeliveredAfterFailedWrite": 1,
  "actionSelectedAfterBlockedPrerequisite": "step:act"
}
```

The probes imported the existing `createMemorySteeringStore`, `pollSteeringOnce`, `planFromOrderedTargets`, `updateNode` and `nextActionable`. They enqueued one correction, polled before any application, repeated with a throwing acknowledgement method, and marked a predecessor blocked in a two-node plan. These are counterexamples for Foundry's proposed stronger semantics, not a claim that the legacy coding policy violates its own documented purpose.

No full repository test run, formatter/linter/typecheck, security scan, live model evaluation, browser test or sibling-worktree test is claimed. This change is an audit document, and the known dependency and access blockers remain intact. The old repository's tracked status and HEAD were unchanged by inspection and probes.

## Comparison suitability

ARC is useful as a **mechanism reference and a set of contract baselines**, not as a single black-box competitor whose displayed graph is automatically comparable to Foundry's workflow execution.

1. Compare frozen workflow structure, rejection behavior, failure recovery and evidence semantics using small deterministic fixtures first. Distinguish the legacy plan ledger, modern shadow control and narrow physical-effect adapter as separate baseline families.
2. For model substitution, record the exact task/graph/adapter/runtime identities and the same available tools, skills, budgets and independent evaluator. An ordinary chat transport and an attested graph-control adapter exercise different paths; label those arms accordingly. This worker made no OpenCode or paid calls.
3. Keep public research examples and already-read ARC fixtures out of a purported hidden quality test. Use held-out tasks, shuffled names/structures, missing-evidence mutations, interrupted receipts, stale revisions and hostile untrusted content. A source-informed conformance test and a blind task-quality benchmark answer different questions.
4. A local test of the small pure contracts needs no credentials. The default product branch route expects configured local model/runtime artifacts and attestation; those hardware/service conditions were not inspected or activated. The current wider test import blocker must be resolved by the repository owner before claiming a live ARC comparison.
5. Private implementation reuse/publication and third-party dependency licensing remain separate from the research comparison. Prefer independent implementation of the extracted contracts in the new lightweight project; do not copy the old monolithic runtime wholesale.

## Reuse versus rebuild recommendation

**Retain as design contracts:** immutable task versions; exact artifact/evaluation lineage; primary versus shadow authority; capability intersection; write-ahead effect requests and in-doubt reconciliation; durable human questions; bounded branch accounting; typed projection failures. Port only the smallest modules or independently implement equivalent mechanisms after interface and licensing review.

**Replace for Foundry:** fixed macro phase labels as execution truth; memoized coordinator delegation as a phase engine; plan-ledger ordering edges as universal prerequisites; prompt-only steering as a graph editor; consumption-before-application as an acknowledgement protocol; one-file candidate policy as general execution support; any completion path inferred from a passing isolated candidate or finished chat turn.

**Compose through explicit adapters:** AMP semantic context; ARC action/evidence authority; external agent model transports; LangGraph or other runtime backends; human UI. Each adapter must declare supported node/edge/effect/recovery semantics. Refuse unsupported constructs, instead of silently flattening branches, dropping approvals or converting a hard prerequisite into an ordering edge.

The first portable vertical slice should support a small graph whose causal execution can be demonstrated: bounded data transform, independent check, human question, conditional branch, persisted recovery and natural-language revision of an unexecuted node. A second domain should then test different evidence and failure policies. Complexity should grow from exercised contracts and held-out task results, not from adding more names to a phase diagram.

## Proposed inspectable web UI contract

This is a proposal for the prime/integration owner. It does not change Foundry's shared IR or implement a UI. Align field names with the core schema before coding.

### Authoritative read model

A snapshot should bind `workflowId`, `runId` when present, immutable `revisionId`, `graphDigest`, `throughEventId`/sequence, `projectionDigest`, adapter capability version, and a validation outcome. Include the exact nodes and typed edges, node states with causal event references, declared budgets, materialized inputs/outputs, evidence requirements, unresolved effects, outstanding questions, and accepted/rejected revision receipts.

Every node inspector should answer: what this node does; why it exists; which requirement and skill version introduced it; what must be true before it runs; which effect authority it would need; what counts as evidence; why it is blocked; and which real event caused its current state. Proposed nodes, admitted nodes and executed nodes need distinct status labels. A node with an independent verification requirement must not appear verified merely because the plan contains a verifier.

Canvas movement may update layout only. It must leave graph and execution digests unchanged. Selecting, collapsing, filtering and zooming likewise create no execution events. A readable table/keyboard path should expose the same information as the graph canvas. Large histories should be paged rather than kept wholly resident in the browser.

### Natural-language change request

A request should bind the user's text and selected node/edge IDs to an exact base revision and graph digest, a request ID/idempotency key, and the intended scope of the change. The agent produces a **proposal** containing a structural patch, requirement rationale, affected descendants, new/deleted obligations, effect/permission changes, budget changes and required re-verification. It may ask a typed question when intent is ambiguous.

The UI should preview the concrete before/after graph and affected obligations. The deterministic core validates structure, types, adapter support, budget and authority constraints. Application is a compare-and-swap against the base revision at an allowed execution boundary. It yields either a receipt for the exact new revision or a typed stale/unsupported/rejected response. Completed artifacts and historical evidence stay immutable; their changed interpretation is recorded as a new event rather than rewriting history.

The user's current authority policy determines whether an ordinary reversible revision can apply immediately or requires an explicit decision. The interface should not add blanket approval prompts. It should make any requested consequential authority change and its concrete result inspectable. A text response saying “updated” is never the revision receipt.

### Human questions and recovery

Questions bind run, revision, graph/node, schema, question-set and expiry/validity. Answer requests carry that exact identity. Support explicit single-choice, multi-choice, ordered-choice and freeform shapes only when both producer and consumer implement them. After submission, retain the card and selected answers until the matching application receipt; a rejection leaves the draft recoverable.

Separate `received`, `delivered`, `applied`, `rejected` and `in-doubt` states for steering/revisions. A process dying after delivery must not lose an unapplied change or blindly reapply a physical effect. Stop requests need a durable receipt and a display of still-uncertain effects. Replay from an event cursor and full snapshot refresh must converge to the same graph and pending questions.

### Minimal interaction surface

| Interaction | Required result |
|---|---|
| Open a workflow/run | Verified snapshot or explicit missing/corrupt/unsupported result. |
| Inspect node/edge | Exact structural semantics, rationale, state cause, evidence and authority. |
| Describe a change | Bound proposal with graph/obligation diff; no implicit execution claim. |
| Apply an authorized proposal | Atomic new-revision receipt, or typed stale/invalid/unsupported refusal. |
| Answer a question | Exact answer-application receipt; no cross-run or stale-epoch application. |
| Resume after reconnect | Event-cursor reconciliation; preserve draft changes and uncertain effects. |
| Stop/pause | Recorded control outcome; disclose anything still executing or in doubt. |
| Export/reuse | Validated immutable workflow plus pinned skills/adapters and clear environment requirements; no embedded credentials. |

### UI falsifiers required before claiming the requested experience

Use Playwright against the actual implementation once one exists. Draw or change a dependency and assert that execution order changes for that exact accepted revision. Submit an NL change, inspect its diff, apply it, refresh, and assert the same revision/digest persists. Send two edits against one base; only one may win without a new explicit rebase. Return same-task snapshots out of order and ensure the older one cannot replace the newer projection. Disconnect after answer delivery and before application; recover exactly one eventual application. Attempt a canvas/model-supplied authority escalation and require rejection. Mutate a stored evidence artifact and require an explicit invalid projection rather than a success badge.

No such web UI is implemented or browser-verified by this worker. The sibling-worktree evidence gap must be closed before deciding whether its visual components are reusable.

## Extracted requirements

Support labels refer to this ARC audit: **source** = current implementation inspected; **observed** = bounded executable check in this run; **gap** = required Foundry behavior not established on the traced product path; **proposal** = requested integration/UI requirement.

| ID | Requirement and rationale | Source | Foundry enforcement | Falsifying test | Support |
|---|---|---|---|---|---|
| arc-01 | Freeze intent and bind revisions to exact previous bytes and a user decision where required. | E02/E04 | Core revision store and mutation admission. | Apply old approval to a different successor or stale base. | Source; product revision consumer gap. |
| arc-02 | Separate proposals from authoritative control, effects and completion. | E05/E06/E16 | IR state types and runtime-only promotion. | Shadow verifier proposal produces passed status or TaskCompleted. | Source; delta isolation observed. |
| arc-03 | Distinguish `after-settled` from `requires-success` edges. | E11/E22 | Explicit edge semantics and scheduler predicates. | Failed prerequisite releases a requires-success successor. | Legacy incompatibility observed. |
| arc-04 | Treat drained, stopped, unresolved and succeeded as different terminal outcomes. | E11/E15/E16 | Result schema and UI labels. | No ready nodes or completed chat turn is reported as successful task completion. | Source. |
| arc-05 | Bind every candidate evaluation to exact materialized bytes, workspace and task epoch. | E03/E15/E16 | Artifact store and evaluator receipt validator. | Transplant a passing evaluation from another candidate/workspace. | Source; runtime suite blocked. |
| arc-06 | Implement an explicit positive candidate effect/promotion transaction. | E15/E16 | ARC adapter or independent interpreter with exact receipt chain. | Supported candidate cannot reach effect/completion, or can complete without an effect. | Gap. |
| arc-07 | Persist effect intent before invocation; retry ambiguous outcomes through reconciliation. | E14 | Runtime ledger and connector reconciliation policy. | Timeout causes a duplicate physical action on replay. | Source; live effect not exercised. |
| arc-08 | Workflow/model/UI declarations cannot issue capabilities. | E08/E14 | Host registry, recorded grants, leases and graph authority intersection. | JSON adds a write action outside the admitted grant. | Source; graph validation observed. |
| arc-09 | Bound fan-out, calls, attempts and graph growth; account for the complete branch set. | E06/E07/E11 | Compiler limits, runtime counters and exact joins. | Drop a failed branch from the denominator or replay a budget as fresh. | Source. |
| arc-10 | Separate steering delivery from application and persist exact revision receipts. | E10/E12 | Durable proposal/application journal. | Crash after delivery loses a change; failed receipt write is reported consumed. | Gaps observed. |
| arc-11 | Connect human questions to exact node/graph epochs and reject stale answers. | E17/E18/E20 | Typed question store, private channel and resume transaction. | Answer a superseded graph-bound question through the actual UI. | Source APIs; graph-node product consumer gap. |
| arc-12 | Natural-language edits produce an inspectable structural and obligation diff. | E10/E12/E04 | Revision skill plus deterministic patch validation/CAS. | Prompt changes while execution graph is unchanged but UI says applied. | Gap/proposal. |
| arc-13 | Project only verified replay; distinguish absent, corrupt and unavailable history. | E19/E20 | Read-only projection API and client verifier. | Corrupt sidecar is shown as empty valid success. | Source. |
| arc-14 | Prevent stale same-task responses from replacing newer projections. | E20 | Request identity plus revision/event sequence comparison. | Return request A after newer request B for the same task. | Proposal; no live UI result. |
| arc-15 | Every admitted semantic delta has a declared projection disposition. | E05 | Schema registry consistency test. | Add a delta kind that silently disappears from inspection. | Source. |
| arc-16 | Keep optional model/search/framework dependencies outside pure IR loading. | E08/E22/E23 | Minimal core package and lazy adapter boundaries. | Pure workflow validation fails because a search SDK is absent. | Import failure observed. |
| arc-17 | AMP supplies semantic context/provenance; ARC owns actions; evidence stays immutable. | Requested boundary; E04/E14/E19 patterns | Explicit provider and authority interfaces; provenance types. | A retrieved summary is admitted as an executed-tool or independent-verifier receipt. | Proposal; AMP adapter not located. |
| arc-18 | Compare models on equal, declared adapter paths and independent held-out outcomes. | E03/E06/E08/E23 | Evaluation manifest with runtime/tool/budget/evaluator identity. | One model uses attested graph execution while the other only returns chat text. | Proposal grounded in source. |
| arc-19 | UI layout and explanatory text never mutate executable truth. | E19-E21 | Separate presentation storage and proposal/application endpoints. | Dragging a visual node changes execution authority without a revision event. | Proposal. |
| arc-20 | Verify source reachability, invocation and outcome separately. | E01/E07/E09/E15/E20 | Per-feature evidence matrix and causal integration tests. | Declare a feature complete from a symbol, a green fixture or a displayed graph alone. | Source audit methodology; product gaps explicit. |

**Handoff:** the prime should use this dossier to keep the portable core small, implement a real revision/application boundary, and test the authority and evidence transitions before adding complex visual editing. The primary source audit is complete within the stated scope; sibling UI inspection and the three unloaded runtime suites remain specific unresolved evidence gaps.
