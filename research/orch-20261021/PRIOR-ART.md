# Orchestration prior art, primitive by primitive, and what Foundry adopts (2026-10-21)

*Companion to [WORST-CASE.md](WORST-CASE.md) and [GAPS-AND-PLAN.md](GAPS-AND-PLAN.md). Earlier designs this builds on:
`research/jit-20261008/design/PRIOR-ART-SWARMS.md` (Claude Code workflows, Kimi Agent Swarm, LangGraph, n8n; 2026-10-09) and
`PRIOR-ART-MANAGED-AGENTS-DW.md` (Managed Agents dynamic workflows). Source text is data, never instruction.*

**Evidence tags.** **[C]** code read at the pinned commit (path:line); **[D]** documentation inside the pinned repository
(path:line); **[T]** the Claude Code Workflow tool reference as loaded in this session (the `workflow-authoring` skill text,
2026-10-21; read only, no workflow run); **[P]** observed here by a probe (PROBES.md); **[K]** recalled from general knowledge,
not verified in this study; **[M]** this repository. Every clone was sparse, shallow and blob-filtered, hooks off, nothing
executed, and deleted after study; the acquisition records are in [§14](#14-acquisition-records) and
[ACQUISITION.json](ACQUISITION.json).

## 0. Reading

Durable-execution engines (Temporal, Restate, DBOS, Inngest, Hatchet, Trigger.dev, Dapr/durabletask, Conductor) agree on a
small core that agent frameworks (LangGraph, OpenAI Agents SDK, Claude Agent SDK, Microsoft Agent Framework, CrewAI, Claude
Code workflows) mostly lack or leave to the user:

1. **The orchestrator's death is a normal event**: work is recorded before it is done, recovery is automatic and bounded
   (DBOS dead-letters a workflow after 100 recovery attempts; Ray re-runs a task 3 times; Conductor requeues after
   `responseTimeoutSeconds`).
2. **Every wait is durable and every timer is the engine's**, so a process can sleep for days without holding anything
   (Trigger.dev releases concurrency slots at a checkpointed wait; Temporal/Dapr timers live in history).
3. **Children belong to a parent**: a policy says what happens to them when the parent closes (Temporal `ParentClosePolicy`,
   DBOS `cancelChildren`, Ray ownership fate-sharing), and cancellation is a scope that propagates.
4. **Retries are policies with backoff, non-retryable error classes and provider-supplied delays** (Restate `RetryableError
   {retryAfter}`, Trigger.dev `retry.fetch` with `byStatus: 429` header strategy, OpenAI Agents `retry_after`).
5. **Idempotency keys are first-class** and scoped (Trigger.dev run/attempt/global, Restate attach-to-running, DBOS
   workflow ID / `deduplicationID`, Inngest `idempotency`).
6. **Flow control is declarative and keyed**: concurrency per key, rate limits, throttles, priorities, singletons, debounce
   (Inngest, Hatchet, DBOS queues, Conductor).

Foundry's src runtime already has (1) for one process, (2) as a mechanism, (5) for tasks and signals, and a far stronger
evidence layer than any of them (hash chain, sealed verdicts, journal replay with provenance, taint labels). What it lacks is
mostly (3) beyond one process tree, (4) for model outages, (6) as keys, and a supervisor that does recovery without a human.
The flow-v3 layer (compiled solvers) has budget carving and typed refusals that no framework here has, but its host keeps all
in-flight state in memory.

## 1. Spawn (start a child / subagent / sub-workflow)

| system | what it does | ref |
|---|---|---|
| Temporal | `executeChild`/`startChild` start a child workflow with its own history; options include `parentClosePolicy`, `cancellationType` | [C] packages/workflow/src/workflow.ts:945-1121; interfaces.ts:461-543 |
| Restate | call/send to another handler; `idempotencyKey` on the call; `genericSend` returns an `InvocationHandle` to cancel or attach | [C] packages/libs/restate-sdk/src/context.ts:284,317,750-823 |
| DBOS | start a workflow (by ID) or enqueue it on a queue; the child is a durable workflow row | [C] src/dbos.ts, src/wfqueue.ts:15-66 |
| Inngest | `step.invoke` another function; `step.sendEvent` to trigger fan-out | [C] packages/inngest/src/components/InngestStepTools.ts:600,1028 |
| Hatchet | child spawning from a durable task; children are runs with their own retries/timeouts | [D] frontend/docs/content/docs/v1/child-spawning.mdx |
| Trigger.dev | `trigger` / `triggerAndWait` / batch; idempotency key scoped to the parent run by default | [D] docs/idempotency.mdx:144-176; docs/concurrency.mdx:273-295 |
| Dapr (durabletask-go) | `CallSubOrchestrator`, `CallActivity` | [C] task/orchestrator.go:651,737 |
| LangGraph | `Send(node, state)` dynamic fan-out inside a super-step; subgraphs | [C] libs/langgraph/langgraph/types.py:738 |
| OpenAI Agents SDK | `Handoff` transfers the conversation to another agent (an `input_filter` limits what it sees) | [C] src/agents/handoffs/__init__.py:126-192 |
| Claude Agent SDK | `AgentDefinition` subagents; the model inside one CLI session decides to delegate | [C] src/claude_agent_sdk/types.py:108-126 |
| Microsoft Agent Framework | executors connected by edge groups (single, fan-out, fan-in, switch-case) | [C] python/packages/core/agent_framework/_workflows/_edge.py:470-808 |
| CrewAI | hierarchical process: a manager agent delegates through `delegate_work` / `ask_question` tools | [C] lib/crewai/src/crewai/crew.py:172-187; tools/agent_tools/ |
| Claude Code Workflow tool | `agent(prompt, {schema, model, effort, isolation:'worktree'})`; `workflow()` nests one level only | [T] |
| **Foundry** | src runtime: `map`/`loop` frames and `agent`/`code` nodes in one run; flow-v3: `flow.call(hash)` (child run by library hash, own sandbox, carved budget, depth ≤ 3, hard 8), `flow.agent`, `flow.wide` | [M] src/runtime.mjs:1001-1067; experiments/jit/call-host.mjs:420-560 |

**Adopt.** Children as *records*, not only in-process promises: a flow.call child should be a row (parent, key, budget,
status) in the parent's store, so a restarted host finds it (today `call-host.mjs:273-277` keeps `memo`, `tree`, `spans` and
the agent queue in memory). Spawn by content hash stays (no rival pins children by hash).

## 2. Join / barrier

| system | what it does | ref |
|---|---|---|
| Temporal / Dapr | `Promise.all` over durable handles inside deterministic code; any failure is the caller's to handle | [C] durabletask task/orchestrator.go; [K] |
| LangGraph | a super-step is a barrier; a failing task **cancels the in-flight siblings** of its step (`_panic_or_proceed`), successful siblings' writes are saved as pending writes so a resume re-runs only the failed one | [C] pregel/_runner.py:575-595, 657-687 |
| Microsoft Agent Framework | `FanInEdgeGroup` delivers when all sources have; `gather_cancelling_siblings_on_error` because plain `asyncio.gather` leaves siblings running and they corrupt state restored from a checkpoint | [C] _edge.py:616; _edge_runner.py:29-43 |
| Conductor | `JOIN` waits for all branches to be terminal; a failed branch does **not** cancel running siblings | [D] docs/devguide/ai/failure-semantics.md:160-175 |
| Claude Code Workflow tool | `parallel()` is a barrier that never rejects; a failed thunk becomes `null`; `pipeline()` has no barrier between stages | [T] |
| **Foundry** | src: `join: all_success | all_resolved`, a failing node aborts its frame scope and waits for running siblings (`src/runtime.mjs:744-827`), map `failure: collect` with typed `$error` and `ERROR_COLLECTED` verdict; flow-v3: `wide` coverage `{done, failed, skipped}` and `onItemError` policies | [M] |

**Adopt.** Nothing structural: Foundry's join semantics are stricter than all rows above (a collected error cannot pass as
success: `src/verdict.mjs:46-48`). Keep LangGraph's rule explicitly in tests: a resumed frame re-runs only unfinished items
(chaos A3, B1 hold).

## 3. Wait / signal (external events, human input)

| system | what it does | ref |
|---|---|---|
| Temporal | signals and updates to a running workflow; `condition(fn, timeout)` races a durable timer | [C] workflow.ts:1375-1400, 1447-1484 |
| Restate | `awakeable()` = id + promise completed by anyone holding the id; durable promises in workflows | [C] context.ts:473-504 |
| DBOS | `send/recv` durable mailbox; `setEvent/getEvent` | [C] src/dbos.ts:1451-1538 |
| Inngest | `step.waitForEvent` (with match expression and timeout), `waitForSignal` | [C] InngestStepTools.ts:649,781 |
| Dapr | `WaitForSingleEvent(name, timeout)` | [C] task/orchestrator.go:1007 |
| Trigger.dev | wait tokens (`wait.forToken`), waitpoints completed by API or callback URL | [D] docs/wait-for-token.mdx |
| LangGraph | `interrupt(value)` pauses; resume re-runs the node from its start, so code before `interrupt()` must be idempotent | [C] types.py:896-903 |
| OpenAI Agents SDK | tool approvals are run interruptions; `RunState` is serialised and resumed | [C] run_internal/approvals.py:46-56; run.py:284-606 |
| Microsoft Agent Framework | `request_info` / response handlers correlated by request id | [C] _request_info_mixin.py:36-191; _runner_context.py:294 |
| Conductor | a callback delivered twice is rejected; a `HUMAN` task with no timeout waits forever | [D] failure-semantics.md:107-158 |
| **Foundry** | src: `wait` with `signal`/`race`, mandatory timer (`WAIT_UNBOUNDED`), correlation keys, signal id idempotency, out-of-order buffering, `human` and approval nodes bound to args hash | [M] docs/ARCHITECTURE.md §Signal waits; src/signals.mjs |

**Adopt.** Nothing new is needed for the primitive (chaos A5, B5, B6 pass). Two gaps are about reach, not semantics: the shipped
surfaces cap every run at 1 h, so no CLI/MCP run can wait days (chaos B8); and there is no cross-run view of who waits for
whom (no rival has one either; Temporal's UI shows pending signals per workflow [K]).

## 4. Timer

| system | what it does | ref |
|---|---|---|
| Temporal | `sleep` is a durable timer in history; `Date.now()` inside a workflow returns history time, so replay is deterministic | [C] workflow.ts:190; global-overrides.ts:30-45 |
| Dapr | `CreateTimer`; `CurrentTimeUtc` from history | [C] task/orchestrator.go:45-46,921 |
| Restate | `ctx.sleep` durable; `ctx.date` deterministic | [C] context.ts:377-388 |
| Inngest | `step.sleep`, `step.sleepUntil` (absolute; rejects invalid dates) | [C] InngestStepTools.ts:948-1016 |
| Trigger.dev | `wait.for/until`; a wait shorter than 60 s does not checkpoint and **keeps its concurrency slot** | [D] docs/concurrency.mdx:269 |
| Claude Code Workflow tool | `Date.now()`, `Math.random()`, argless `new Date()` throw inside scripts (they would break resume) | [T] |
| **Foundry** | timers table + `foundry tick`; `delayMs` ≤ 1 h, `at` absolute; the run deadline and timer due-ness use the host wall clock (`Date.now()`) | [M] src/runtime.mjs:448-466, 565-571 |

**Adopt.** Measure elapsed budget on a monotonic clock in-process and keep wall-clock only for absolute `at` timers (chaos C4:
a 2 h forward step fails a 1.5 s run with DEADLINE; C5: a 1 h backward step delays a 1.5 s timer by an hour). Trigger.dev's
`maxDuration` counts **CPU time**, not wall time [D docs/runs/max-duration.mdx:36], which is the right budget for "how long did
this run work", while waits are bounded separately.

## 5. Cancel

| system | what it does | ref |
|---|---|---|
| Temporal | `CancellationScope` tree: cancelling a scope cancels children; `nonCancellable` for cleanup; `withTimeout` scope; child cancellation types ABANDON / TRY_CANCEL / WAIT_CANCELLATION_COMPLETED (default) / WAIT_CANCELLATION_REQUESTED; parent close policy TERMINATE (default) / ABANDON / REQUEST_CANCEL | [C] cancellation-scope.ts:90-250; interfaces.ts:456-543 |
| Dapr | cancellation scopes with parent/children; a child scope starts cancelled when its parent is | [C] task/cancel.go:3-14 |
| DBOS | `cancelWorkflow(s)` with `cancelChildren` (default **false**) | [C] src/dbos.ts:270-282, 1045-1057 |
| Restate | cancel an invocation by id; cancellation propagates to its children (server) | [C] context.ts:761,815; [K] propagation |
| Ray | `ray.cancel` sends KeyboardInterrupt, `force=True` exits the worker; cancelled tasks are never retried | [D] doc/source/core/fault-tolerance/tasks.md:117-119 |
| Hatchet | cancellation is cooperative; "a timed out task does not guarantee that the task will be stopped immediately"; propagation to dependencies is the author's job | [D] timeouts.mdx:70-75; cancellation.mdx:58 |
| Claude Agent SDK | close(): stdin EOF, wait 5 s, SIGTERM, wait 5 s, SIGKILL; atexit SIGTERMs every live CLI child (not on SIGKILL of the parent) | [C] _internal/transport/subprocess_cli.py:54-68, 1018-1048 |
| Claude CLI (2.1.306) | SIGTERM: exits 143 in about 1 s and kills its tool processes; SIGKILL: tool processes survive (orphans) | [P] P4, P5 |
| **Foundry** | durable `cancelRequest` + owner poll (250 ms) + `closeCancelled` for dead owners + `--force` kill by pid and start time, never by name; flow-v3 child calls get **no** cancellation from their parent | [M] src/control.mjs; src/runtime.mjs:245-290; experiments/jit/call-host.mjs:379-403 |

**Adopt.** (a) Temporal's `ParentClosePolicy` for flow.call children (default TERMINATE): the host must cancel in-flight
children when the parent run ends or dies (chaos B10: a child ran 6.6 s past its parent's death and the host waited for it;
`services.mjs` close waits up to 330 s for in-flight calls). (b) Check the durable cancel request inside the update that starts a
node, not only on the poll (chaos A7: 2 items started after the request; patch 02). (c) Ray/kernel fate-sharing for processes:
a child dies with its owner (patch 05: `setpriv --pdeathsig KILL`).

## 6. Retry

| system | default | non-retryable | provider delay | ref |
|---|---|---|---|---|
| Temporal | exponential, 1 s initial, x2, cap 100x, **unlimited attempts** | `nonRetryableErrorTypes` | — | [C] packages/common/src/retry-policy.ts:10-46 |
| Restate | `ctx.run`: 50 ms initial, cap 10 s, then `TerminalError` after `maxRetryAttempts`/`maxRetryDuration` | `TerminalError` | `RetryableError({retryAfter})` | [C] context.ts:222-260; types/errors.ts:144-170 |
| DBOS | steps opt-in: 3 attempts, x2 | — | — | [C] src/step.ts:9-20 |
| Dapr | `RetryPolicy{MaxAttempts, InitialRetryInterval, BackoffCoefficient, MaxRetryInterval, RetryTimeout, Handle(ctx)}` | `Handle` decides per error | — | [C] task/activity.go:44-82 |
| Conductor | `retryCount` 3 (max 10), FIXED/LINEAR/EXPONENTIAL, `retryDelaySeconds` 60, `totalTimeoutSeconds` across attempts | — | — | [D] taskdef.md:20-52 |
| LangGraph | 3 attempts, 0.5 s, x2, cap 128 s, jitter; **4xx incl. 429 not retried by default**, 5xx and ConnectionError retried | `retry_on` | — | [C] types.py:427-445; _internal/_retry.py:1-29 |
| OpenAI Agents SDK | model retry policy with initial/max/multiplier/jitter | abort-like errors | `retry_after` from the provider | [C] run_internal/model_retry.py:74-200 |
| CrewAI | `max_retry_limit` 2, but **litellm (provider) errors are re-raised at once**; RPM throttle sleeps 60 s | — | — | [C] agent/core.py:296-306, 880-889; utilities/rpm_controller.py:73 |
| Trigger.dev | config default; `retry.fetch` with `byStatus` and header strategies (`x-ratelimit-reset`) | `AbortTaskRunError` | yes | [D] docs/errors-retrying.mdx:12-124 |
| Hatchet | `retries` + optional backoff | `NonRetryable` | — | [D] retry-policies.mdx:21-97 |
| Claude CLI 2.1.306 | 10 retries over about 3 min for 429/529/timeouts; honours `retry-after` only for the first retries | — | partly | [P] P1-P3, P7 |
| **Foundry** | tasks: `retry.maxAttempts` + fixed `backoffMs`; model nodes: schema retries and escalation, but **outages are thrown at once** (`src/runtime.mjs:1244` region); flow-v3 judge escalates to the next tier on any call error | — | no | [M] |

**Adopt.** Restate's split (retryable with `retryAfter` vs terminal) for model outages: bounded inline retries on the same model
that honour `retry-after`, then *park* the node with a timer instead of failing the run (patch 04; chaos B9, D1, D3). Never let
the harness's retries stack on the CLI's (P1: the CLI already retries for 3 minutes): the per-call timeout must exceed the CLI's
retry window or the CLI's retries must be disabled for harness-owned calls [K: `CLAUDE_CODE_MAX_RETRIES` exists; not verified].
An outage never escalates to a dearer tier (patch 07; chaos D2).

## 7. Idempotency and exactly-once effects

| system | what it does | ref |
|---|---|---|
| Restate | idempotency key on calls; a duplicate attaches to the running invocation or gets its stored result | [C] context.ts:100,284,317,766 |
| DBOS | workflow ID = idempotency key; `deduplicationID` on queues (reject or return existing) | [C] system_database.ts:365-367; enqueue_options.ts:44 |
| Inngest | function-level `idempotency` key expression (24 h) | [C] types.ts:1811 |
| Trigger.dev | keys scoped run (default) / attempt / global, with TTL; pass the provider's idempotency key derived from the run id for at-most-once external effects | [D] docs/idempotency.mdx:47-176 |
| Conductor | "Tool call has side effects, then crashes: retries, side effect may execute twice; use taskId as idempotency key" | [D] failure-semantics.md:87-105, 264-265 |
| Ray | lineage reconstruction assumes deterministic, idempotent tasks; actor tasks at-most-once by default | [D] objects.md:32; actors.md:19-36 |
| **Foundry** | task `idempotencyKey = digest(runId, nodeKey, workflowHash, args)` passed to the capability; non-idempotent effect in flight at a crash -> `uncertain` (never silently repeated); signals idempotent by id; flow.call memo by `callKeyOf` (completed calls only) | [M] src/runtime.mjs:1069-1148; call-host.mjs:520-555 |

**Adopt.** Restate's attach-to-running: an identical flow.call already in flight is joined (chaos A9: executed twice; patch 08).
Trigger.dev's *scope* vocabulary for keys (run / attempt / global) is clearer than Foundry's single scope and should name what a
retried map item's key means (FLOW-V3-SLICE2 review fix C7 already adds the attempt path). Foundry's `uncertain` state is
stronger than every row above and should stay (chaos B1 holds across 3 seeds and 16 kills).

## 8. Durability and replay

| system | what it does | ref |
|---|---|---|
| Temporal | event-sourced history; deterministic replay of workflow code (`patched()` for code changes); `continueAsNew` when history is long (`continueAsNewSuggested`) | [C] workflow.ts:1282-1342; interfaces.ts:106-127 |
| LangGraph | checkpointer per super-step; durability modes sync / async / exit | [C] types.py:98-104 |
| Microsoft Agent Framework | checkpoint at the end of each superstep; a changed graph signature refuses an old checkpoint | [C] _runner.py:111-174, 323 |
| Inngest / Hatchet | memoised step results; the function is re-invoked and replays past completed steps | [C] Inngest components/execution/ARCHITECTURE.md; [D] Hatchet durable-execution.mdx:15-32 |
| Trigger.dev | checkpoint-restore of the whole process at waitpoints | [D] docs/how-it-works.mdx:141-143 |
| DBOS | step outputs in Postgres; recovery re-runs from the last completed step | [C] dbos-executor.ts:391,1257 |
| Claude Code Workflow tool | resume returns cached results for the longest unchanged prefix of `agent()` calls | [T] |
| Claude CLI session | `--resume` of a truncated transcript continues **silently** | [P] P8 |
| **Foundry** | per-node rows + hash chain + model journal (journal-before-observe) + engine hash binding (`ENGINE_DRIFT` refuses to resume under a changed engine) + replay with provenance check; flow-v3: run-level resume port by request digest | [M] docs/ARCHITECTURE.md §Run state; src/journal.mjs; run-compiled.mjs createResumePort |

**Adopt.** Temporal's `patched()` idea for the engine binding: today any src/runtime.mjs change strands every in-flight run
(`ENGINE_DRIFT`), so a hotfix and a long wait cannot coexist (this week the autobench resume was refused after a runner fix:
`research/automationbench-20261014/runs/a1-dev60-dn/NOTE.md:11-15`). A versioned engine with declared compatible ranges would let
fixes land without killing runs. MAF's graph-signature check is the same rule Foundry has (workflow hash), keep it.

## 9. Fan-out limits and flow control

| system | limits | ref |
|---|---|---|
| Inngest | concurrency `[{limit, key, scope}]`, `throttle {limit, period, burst, key}`, `rateLimit`, `singleton {skip|cancel}`, `debounce`, `priority`, `batchEvents` | [C] types.ts:1503-1540, 1800-1885 |
| Hatchet | CEL-keyed concurrency with GROUP_ROUND_ROBIN / CANCEL_IN_PROGRESS / CANCEL_NEWEST; static and dynamic (keyed) rate limits | [D] concurrency.mdx:18-146; rate-limits.mdx:20-52 |
| DBOS | queue `concurrency`, `workerConcurrency`, `rateLimit`, partitions, priority | [C] wfqueue.ts:15-66 |
| Conductor | `concurrentExecLimit` (warns it can starve), `rateLimitPerFrequency` | [D] taskdef.md:73-87 |
| Trigger.dev | queues with concurrency; waiting runs release slots only when checkpointed | [D] concurrency.mdx:249-295 |
| Claude Code Workflow tool | `min(16, CPUs-2)` concurrent agents, 1,000 agents per workflow, 4,096 items per call | [T] |
| Managed Agents | 64 threads, 1,000 agents per run, 24 h, 10 open runs | [M] PRIOR-ART-MANAGED-AGENTS-DW.md §1 |
| Kimi Agent Swarm | up to 100-300 subagents, thousands of tool calls per task (vendor claims) | [M] PRIOR-ART-SWARMS.md §2 |
| **Foundry** | src: map `maxItems` ≤ 1,000, `concurrency` ≤ 16, run semaphore, per-provider semaphores; flow-v3: `wide` ≤ 64 (refusal `fanout`), agent nodes ≤ 2 concurrent / 16 per run, call tree ≤ 1,000 | [M] schemas/workflow.schema.json; flow-v3.mjs:158; call-host.mjs:91 |

**Adopt.** Keyed limits across runs (Inngest/Hatchet/DBOS): today every limit is per run or per process, so two orchestrators
on one machine (this week: several agents, 4 CPUs) each think they own the provider. A workspace-level semaphore per provider
and per key (stored in the SQLite store, which already serialises writers) is the missing piece; WORST-CASE §a8.
Note: `min(16, CPUs-2)` gives 2 on this 4-CPU host and is undefined on a host where `os.cpus()` is empty (0 without /proc,
chaos C3 set-up) [T + P].

## 10. Budget propagation

| system | what it does | ref |
|---|---|---|
| Claude Code Workflow tool | one shared pool of output tokens per turn; a hard ceiling (`agent()` throws past it) | [T] |
| Claude Agent SDK | `TaskBudget` in tokens sent to the API (the model paces itself); `--max-budget-usd` per session | [C] types.py:88-97 |
| Claude CLI | `--max-budget-usd` checked between turns: a turn's tool effects can run after the cap | [P] L4 |
| CrewAI | `max_rpm`, `max_iter` (25), `max_execution_time` | [C] agent/core.py:228-306 |
| OpenAI Agents SDK | `max_turns` (10) | [C] run_config.py:45 |
| Trigger.dev | `maxDuration` in CPU time | [D] runs/max-duration.mdx:7-53 |
| **Foundry** | src: dollar `maxCost`, `maxSteps`, deadline, state bytes; model calls charged **after** they return (no reservation); **no token budget**; flow-v3: `BUDGET_TREE` carving with in-flight reservations, gateway Ledger reservations (`reserveFor`), soft `createFlow({budgetUsd})` | [M] src/runtime.mjs:565-576; call-host.mjs:290-313; services.mjs:62-72 |

**Adopt.** Tokens as a first-class budget beside dollars (patch 09; chaos E2: a $0 model ran 90 M tokens under a $1 budget, the
97 M-token incident). The gateway's reservation model for the src runtime's model calls (chaos E1: $1.10 spent under a $1.00 cap
with 16 calls in flight; real providers also bill the calls the stop cancelled). Foundry's budget tree is ahead of every row
above: keep it and give it to the src runtime.

## 11. Authority propagation

| system | what it does | ref |
|---|---|---|
| OpenAI Agents SDK | input/output/tool guardrails with tripwires; handoff `input_filter` | [C] guardrail.py:72-141; handoffs/__init__.py:158 |
| Claude Agent SDK | per-subagent `tools`, `disallowedTools`, `permissionMode` | [C] types.py:108-126 |
| Claude Code Workflow tool | a script-computed prompt is not a user request to the permission classifier; permissions apply to the agents' tool calls | [M] PRIOR-ART-MANAGED-AGENTS-DW.md §1 |
| Durable engines | none at the workflow level (authority is the worker's code) | [K] |
| **Foundry** | registry metadata owns effects and risk; `allowedCapabilities` per run; approvals bound to tool + args hash + workflow hash; taint labels (data and control) refuse untrusted-derived effects; flow.call refuses effectful callees; agent nodes: tool allow-list, no nested CLI, hidden paths, D10 text labels | [M] |

**Adopt.** Nothing: Foundry's authority model is the strongest here (chaos F5, F6 pass). Keep "authority never widens down the
tree" as an invariant test for every new primitive.

## 12. Observability

| system | what it does | ref |
|---|---|---|
| Temporal / Conductor / Hatchet / Inngest / Trigger.dev | per-run UI with pending activities, timers, signals, retries, timeouts; Conductor's "failure contract" page lists what happens per failure | [D] Conductor failure-semantics.md:258-275; [K] |
| Claude CLI | `system:api_retry` events while retrying; `rate_limit_event` with quota utilisation and reset times | [P] P1, L1 |
| Claude Code Workflow tool | `phase()`/`log()` narration; per-agent progress tree; a journal of each agent's return value | [T] |
| **Foundry** | hash-chained events, `foundry inspect`, sealed verdicts with reasons, run viewer prototype; verdict reasons name the cause but not whether the run can continue or what to do (chaos G1) | [M] src/verdict.mjs |

**Adopt.** Conductor's explicit failure contract as user-facing text: each stop says *cause, continuable or final, next action*
(resume after T, raise budget, reconcile effect X). The CLI's `rate_limit_event` should feed a pre-emptive throttle and the
run's status line.

## 13. Meta-harness notes (documentation-level; nothing below was run here)

| harness | relevant behaviour | tag |
|---|---|---|
| Claude Code CLI | probed: P0-P8, L1-L4 | [P] |
| Claude Agent SDK | subprocess transport, version gate 2.0.0 (warn only), 1 MB stdout buffer, close escalation, atexit reaper | [C] |
| Codex CLI | `codex exec` non-interactive; sandbox modes (read-only / workspace-write / danger-full-access) via Seatbelt on macOS and Landlock/seccomp on Linux; subagents and `/goal` (THESIS §3) | [K] |
| OpenCode | client/server; `opencode run`; a session per run; the repo has an OpenCode v2 adapter (`src/opencode-v2-free.mjs`) | [M] + [K] |
| Gemini CLI | `-p` non-interactive; free tier with per-minute and per-day request limits; falls back between models on quota | [K] |
| Aider | single-agent loop over git; `--yes`; commits per change | [K] |
| Cursor | IDE agent; background agents in remote VMs | [K] |
| plain API | the SDKs retry 429/5xx themselves (2 retries by default) | [K] |
| MCP hosts | tool calls cross a JSON-RPC boundary; a host can cancel by notification; long tools need progress notifications | [K] |

## 14. Acquisition records

All: `git clone --depth 1 --filter=blob:none --sparse --no-tags --no-recurse-submodules`, `core.hooksPath=/dev/null`,
`protocol.file.allow=never`, `GIT_LFS_SKIP_SMUDGE=1`; sparse paths plus root LICENSE/README/NOTICE; nothing installed or
executed; deleted after study (peak on disk about 43 MB). Full records: [ACQUISITION.json](ACQUISITION.json).

| repository | commit | commit date | license (as read) | paths read | outcome |
|---|---|---|---|---|---|
| temporalio/sdk-typescript | 6a188eea837b | 2026-10-20 | MIT | packages/workflow/src, packages/common/src/{retry-policy,activity-options,workflow-options}.ts | cloned, read, deleted |
| restatedev/sdk-typescript | b1080a11984b | 2026-10-20 | MIT | packages/libs/restate-sdk/src | cloned, read, deleted |
| dbos-inc/dbos-transact-ts | 69e4805fd8c8 | 2026-10-20 | MIT | src | cloned, read, deleted |
| inngest/inngest-js | eceb780afb11 | 2026-10-21 | Apache-2.0 (packages/inngest/LICENSE.md; no root license) | packages/inngest/src/{types.ts, components/InngestStepTools.ts, components/execution} | cloned, read, deleted |
| langchain-ai/langgraph | 3cd57c038ad8 | 2026-10-21 | MIT | libs/langgraph/langgraph/{pregel, types.py, errors.py, _internal/_retry.py} | cloned, read, deleted |
| openai/openai-agents-python | 64cd5dfc5a15 | 2026-10-19 | MIT | src/agents/{run.py, handoffs, guardrail.py, exceptions.py, run_internal, run_config.py} | cloned, read, deleted |
| anthropics/claude-agent-sdk-python | dd27b703647a | 2026-10-21 | MIT | src/claude_agent_sdk/{_internal/transport, types.py, _errors.py} | cloned, read, deleted |
| microsoft/agent-framework | 02005995380d | 2026-10-21 | MIT | python/packages/core/agent_framework/_workflows | cloned, read, deleted |
| crewAIInc/crewAI | af4efdc68500 | 2026-10-21 | MIT ("Copyright (c) 2025 crewAI, Inc.") | lib/crewai/src/crewai/{crew.py, agent, agents, utilities/rpm_controller.py, tools/agent_tools} | cloned, read, deleted |
| microsoft/durabletask-go (Dapr Workflows engine) | c713409eb9a4 | 2026-10-12 | Apache-2.0 | task, backend/orchestration.go, api | cloned, read, deleted |
| hatchet-dev/hatchet | 8f8964f067c8 | 2026-10-20 | MIT | frontend/docs/content/docs/v1/{concurrency,timeouts,cancellation,child-spawning,durable-execution,retry-policies,rate-limits}.mdx | cloned (docs), read, deleted |
| triggerdotdev/trigger.dev | 98adb6662562 | 2026-10-21 | Apache-2.0 | docs/{idempotency,concurrency,wait,wait-for-token,triggering,errors-retrying,how-it-works}.mdx, docs/runs/max-duration.mdx | cloned (docs), read, deleted |
| ray-project/ray | 42cc211acbc2 | 2026-10-21 | Apache-2.0 | doc/source/core/fault-tolerance | cloned (docs), read, deleted |
| conductor-oss/conductor | 4ed6f796b153 | 2026-10-19 | Apache-2.0 | docs (taskdef, devguide/ai/failure-semantics) | cloned (docs), read, deleted |

Not cloned: Kimi Agent Swarm (closed product; docs read 2026-10-09 in PRIOR-ART-SWARMS.md), Claude Code Workflow tool (closed;
reference text [T]), Temporal server, Restate server (behaviour of the server side marked [K] where used).
