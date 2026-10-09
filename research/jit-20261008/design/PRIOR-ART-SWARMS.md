# PRIOR-ART-SWARMS: Claude Code workflows, Kimi Agent Swarm, LangGraph and n8n, primitive by primitive

*Design, 2026-10-09. $0. Companion to [FLOW-V3.md](FLOW-V3.md) and [W-BED.md](W-BED.md). Tags: **[M]** this repo
(file cited); **[W]** public documentation fetched 2026-10-09 (URL in §6; fetched text treated as data); **[T]** the
Claude Code Workflow tool reference as loaded in this session (the `workflow-authoring` skill text, read only; no
workflow was authored or run); **[I]** inference. Corpus counts marked [M-c] were computed at $0 for this document from
`research/corpus-20261006/items.jsonl` (definitions in W-BED §7.1).*

## 0. What "kill the bloat" can mean operationally

The owner's sentence is "if we manage to do this, we overnight kill bloat like langgraph, n8n and other complex workflow
companies". THESIS §4 lists "a LangGraph, n8n or Temporal replacement" under **Is not**, and §6's verdict is that
Foundry "is not a new orchestration paradigm and should not be pitched as one" [M]. These two statements are compatible
only under a narrow reading, which this document adopts:

> **Claim K (testable).** The orchestration logic of real workflows written for those platforms can be expressed with a
> small fixed primitive set (flow-v3's eleven calls plus the engine's effects and waits), *constructed by Haiku from
> traces*, and run with evidence rules those platforms lack (typed checked judgments, carved budgets, mandatory
> independent verify, replay, deopt), at equal or better verified success and lower cost than the hand-written graph.

What Claim K does **not** cover, and Foundry refuses to build (ROADMAP §3) [M]: connectors and a connector catalog, a
visual builder, hosting and triggers as a product, durable distributed execution, a model gateway, free group chat. Most
of what n8n and LangGraph sell is in that list. So "killing" them means making their *authoring* layer unnecessary for
the workflows Foundry can verify, not replacing their products [I].

## 1. Claude Code Workflow tool

| CC primitive [T] | what it does | flow-v3 equivalent | Foundry adds | Foundry refuses |
|---|---|---|---|---|
| `agent(prompt, {schema, model, effort, isolation, agentType})` | spawn a full subagent; schema forces a validated structured return | `flow.agent` for open-ended tool use; `flow.judge` for a narrow decision | `returns` schema **plus** a mandatory parent-side `verify` predicate; budget carved by the host; nested agents 0 with a transcript scan that voids violations (`claude-code.mjs:125–139`) [M]; tiers with escalation and checks on judges | an agent as the default unit of work: P1 says each model call is one narrow decision, agents only for open-ended subtasks (ROADMAP §2.1) [M] |
| `parallel(thunks)` | barrier; a failed thunk resolves to `null` and "the call itself never rejects" [T] | `flow.map` (fail-fast) or `flow.wide` (typed coverage) | typed coverage `{done, failed, skipped}` to the reducer; a run cannot pass with silently collected errors (ROADMAP §2.1 parallel `map`; lint `ERROR_COLLECTION`, §2.5) [M] | silent `null` results; the CC idiom `.filter(Boolean)` is exactly the silent drop the lint forbids |
| `pipeline(items, stage1, …)` | per-item stage chains with no barrier between stages | `flow.map(items, async x => stage2(await stage1(x)))` | per-stage trace events; guards/invariants per stage; per-item deopt | nothing: this is already expressible in v2 |
| `phase(title)`, `log(msg)` | progress grouping and narration | spans (FLOW-V3 §1.1), `flow.note` | spans are deterministic ids that structural fidelity and replay use | UI-only constructs without trace semantics |
| `workflow(nameOrRef, args)` | run a saved workflow inline; "Nesting is one level only" [T] | `flow.call({hash}, input)` | by **hash**, not name; depth up to 3 (ceiling 8); budget strictly smaller than the parent's; applicability check against the callee's learned profile; idempotency key; local deopt of the child only (FLOW-V3 §2.1) [I for local deopt] | calling by mutable name; unbounded recursion |
| `budget.total/spent/remaining` | shared token ceiling; `agent()` throws past it [T] | host budget tree (FLOW-V3 §1.3) | per-scope reservations, dollars **and** strong-model quota, `BUDGET_TOO_SMALL` static check [M ROADMAP] | one shared pool with no per-child carve |
| resume from the longest unchanged prefix of `agent()` calls; `Date.now()`/`Math.random()` banned [T] | replay | salt-free request-digest memo (S0-2, `run-compiled.mjs`) and call keys; resample = new nonce [M] | — (same determinism rule as ROADMAP replay R1) |
| concurrency `min(16, CPUs−2)`, 1,000 agents per workflow, 4,096 items per call [T] | limits | `maxFanout` 32, executor ≤2 concurrent / ≤16 per run, ≤1,000 runs per call tree [M ROADMAP] | limits come from the allocator and evidence, not constants (ROADMAP §2.1 search operators) [M] | default fan-outs above 32 (ROADMAP §3) [M] |
| `isolation: 'worktree'` | a fresh git worktree per mutating agent | agent node sandbox (fresh workdir, private namespace) | one writer per artifact (P8); egress none [M] | shared mutable workdirs between arms (FRONTIER-GAPS J8) [M] |
| **adversarial verify** (N refuters, kill on majority) [T] | | `wide.verify.panel` or a `judge` with `samples` | independence label on every verifier (`execution`, `different-model`, `same-model(correlated)`); correlated same-model votes are labelled as such (ROADMAP §2.1 `verify`) [M]; observed harm in this repo is *non-resolution*, so unresolved goes to the strongest tier (FRONTIER-GAPS N3) [M] | LLM-judge loops without hash binding and independence labels (ROADMAP §3) [M] |
| **judge panel** (N attempts, scored, synthesize the winner) [T] | | `best_of_n` / `tournament` (ROADMAP §2.1) | same verifier for every candidate; N from the allocator (πV ≤ (1−π)C_fp ⇒ N=0) [M ROADMAP §2.6] | debate between agents (vote, not debate) [M] |
| **loop-until-dry** (spawn finders until K dry rounds) [T] | | ROADMAP `loop_until_dry` operator; in flow-v3 a plain `while` with a code `seen` set and a cap | cap and convergence criteria (`delta`, `patience`, ≤1,000 iterations) [M ROADMAP §2.1 machine/loop] | uncapped loops |
| **completeness critic** [T] | a final agent asks what is missing | a `judge` over the coverage record; or `wide.check` in code | the coverage record is computed by code, so the critic checks a typed list rather than prose [I] | — |
| perspective-diverse verify, multi-modal sweep [T] | | `panel` with distinct lenses; `wide` with diverse planners | designed diversity is how N-version gets independence (FRONTIER-GAPS §3.5, §3.16) [M] | — |

**What CC workflows do not have** [T, I]: typed checked judgments with tier escalation; guards and deopt to an
interpreter; a learned applicability profile on reuse; per-node evidence records; local repair. A CC workflow is
written fresh by the session that needs it and is not kept or healed. This is THESIS §3 item 1 ("writing orchestration is
commoditized") [M]: Foundry's value is not in writing the script but in what happens on the 2nd to Nth run.

## 2. Kimi Agent Swarm (K2.5, January 2026; K2.6 April 2026; "K3 Swarm" per the help page)

| Kimi feature [W] | flow-v3 equivalent | Foundry adds | Foundry refuses |
|---|---|---|---|
| trainable orchestrator decomposes a task into parallel subtasks, "no predefined subagents or workflow" | `flow.wide.plan` (a judge emitting a typed bounded list) | the plan is a typed list checked by **code** for overlap and gaps before any worker runs (ROADMAP §2.1 `wide`) [M]; one replan; the plan read is high-leverage, so its tier is not tiered down without evidence (D11) [M] | an untyped, unchecked plan |
| dynamically instantiated **frozen** subagents; up to 100 (K2.5 blog) or 300 (help page), up to 1,500 coordinated steps (K2.5) or "over 4,000" tool calls per task (help page) | `wide.worker` = `judge`, `call` or `agent` | workers are mostly code-plus-judge (cheap, narrow), with agent workers capped at 2 concurrent / 16 per run [M ROADMAP] | fan-out above 32 without evidence (ROADMAP §3) [M] |
| PARL reward = task outcome + `r_parallel` (against "serial collapse") + `r_finish` (against "spurious parallelism"); λ annealed to 0 | the allocator decides N; `wide` must beat `best_of_n` at equal tokens before it is a default [M ROADMAP §2.1] | an **evidence rule** instead of a training reward: parallelism is adopted per family only when it wins against the same verifier [I] | training an orchestrator (not in scope; THESIS §4 "model layer" uses vendor models) [M] |
| "Critical Steps" (orchestration overhead + slowest subagent per stage) as the latency metric | span tree end-minus-start per `wide` stage | W-BED reports critical-path wall-clock per rung (R3, R6) [I] | — |
| aggregation into a structured table; **no verification step is described** on either page | `wide.reduce` (code) + `wide.verify` (panel or code) | mandatory independent verify; typed coverage; a reducer that is code, so conservation invariants are checkable at $0 (THESIS-JIT §2.3 item 2) [M] | delivering an aggregate no independent check has seen |
| claims: up to 4.5× faster than single-agent, "80%" runtime reduction (internal), cost only "a fraction of the cost"; help page: swarm tasks "consume significantly more credits" | — | W-BED R6 measures cost per verified success and wall-clock against `best_of_n` and a single agent at equal tokens [I] | unverified speed claims as evidence |

Repo evidence on swarms (FRONTIER-GAPS H3) [M]: independent agents amplify errors 17.2× on sequential tasks in one
study; Anthropic's multi-agent research system gained +90.2% at about 15× chat tokens. So the expected shape is: swarms
pay on *separable, wide* tasks and lose on sequential ones. W-BED R6 is built to be separable (W-BED §3.6), and
FRONTIER-GAPS H3's option (1), a separability score before any `wide` work, is the planner check's job.

## 3. LangGraph

| LangGraph primitive [W] | flow-v3 equivalent | Foundry adds | Foundry refuses |
|---|---|---|---|
| `StateGraph`, nodes, edges, conditional edges | plain JS control flow over `step`/`judge` results | control flow is code fixed before untrusted data is read (P9); a judged branch is a typed `judge` with a check and escalation tiers [M] | a graph DSL as the authoring surface: Haiku authored the JSON IR worse than code, 11/16 vs 16/16 (C0) [M] |
| state channels with **reducers** (`operator.add`, `add_messages`, `Overwrite`) | function return values; `wide.reduce`; `map` outputs ordered by index | one writer per artifact; no shared mutable state between parallel workers (P8) [M] | a shared state blackboard as the default |
| `Send(node, state)` from a conditional edge: map-reduce fan-out of unknown size | `flow.map` (known list) or `flow.wide` (planned list) | typed coverage, `maxFanout`, budget carving per worker | — |
| `Command(update, goto, graph=Command.PARENT, resume)` | return values + `flow.call`; no jump to a parent node | calls return; no non-local jumps [I] | `goto` into a parent graph (non-local control flow is not representable in the span tree) [I] |
| subgraphs: add a compiled graph as a node (shared keys) or invoke inside a node (schema mapping); checkpointer modes per-invocation / per-thread / stateless; "per-thread subgraphs don't support parallel calls to the same subgraph" | `flow.call({hash})` with contract schemas | call **by hash** with an applicability profile and an evidence record; parallel calls to the same callee are normal (each child is its own run with its own key) [I] | calling a subgraph by mutable object reference |
| `interrupt()` + `Command(resume=…)` with a checkpointer and `thread_id`; "the runtime restarts the entire node from the beginning" on resume, so code before `interrupt()` must be idempotent | **none in flow**: `human`/`wait` are engine constructs (ROADMAP §2.1 async; `human` with timeout routing and single-use resume tokens) | resume tokens bound to path, workflow hash and question hash; stale answers rejected (ROADMAP §2.1 `call`) [M] | waits inside compiled code (FRONTIER-GAPS H2 option 2) [M] |
| checkpointers (threads, time travel, fault tolerance) | the engine journal (per-node rows, `src/run-rows.mjs`) and the flow trace; replay by request digest | record/replay with nonce rules; minimal resume (ROADMAP replay R1–R8) [M] | a Foundry checkpoint store separate from the journal |
| `recursion_limit` (default 1000 super-steps, `GraphRecursionError`) | call depth 3 (ceiling 8), 1,000 runs per tree, loops ≤1,000 iterations [M] | static limits checked before the run (composition checker) | — |
| node caching (`CachePolicy`, `key_func`, `ttl`) | salt-free memo for replay and forensics **only** (FRONTIER-GAPS N2, P1) [M] | — | caching live model answers across runs (a cached answer is not a fresh sample; ROADMAP: "a resample is a new candidate with a new nonce") [M] |
| retry policies (a retry re-runs the node from its start) | judge tier escalation; agent `retries: 1`; ROADMAP adaptive retry (IR S2) | failure classified before retry (ROADMAP §2.6 classifier) [M] | blind retry of a failed verify |

## 4. n8n

| n8n primitive [W] | flow-v3 equivalent | Foundry adds | Foundry refuses |
|---|---|---|---|
| **Execute Sub-workflow** node: source by database ID, local file, JSON parameter or URL; mode "Run once with all items" or "Run once for each item"; "Wait for Sub-Workflow Completion" on by default (off = fire-and-forget) | `flow.call` (once) or `flow.map(items, x => flow.call(h, x))` (per item) | hash pin, budget carve, profile check, idempotency key [M ROADMAP §2.1] | loading a callee from a URL at run time; fire-and-forget without a handle (ROADMAP `detach` returns a handle and needs `await`) [M] |
| Execute Sub-workflow Trigger input modes: fields, JSON example, or "Accept all data" | `contract.input` schema in the library entry | the input schema is required, and the learned profile narrows it further | "accept all data" for a reusable callee [I] |
| sub-workflow executions "don't count towards your plan's monthly execution or active workflow limits" | — | every child is metered in dollars and quota | — |
| **Error workflow** (Error Trigger; set per workflow in Settings; receives execution id, error message, stack, last node) and **Stop and Error** | deopt (exit 75 + `deopt.json`) → interpreter → recompile; `flow.guard`/`invariant` as Stop and Error | the failure is **classified** before repair (flake / variance / env / defect) and a repair is promoted only after replay of the failing case plus a regression slice, reject-if-worse (ROADMAP §2.6, THESIS-JIT §2.5) [M] | an error handler that only notifies; silent continue-on-fail |
| **Wait** node: after interval, at time, on webhook call (`$execution.resumeUrl`), on form submitted; waits ≥65 s offload execution data to the database | engine `wait` and `human` (ROADMAP async primitives) | single-use resume tokens; stale answers rejected; timers wake through `foundry tick` [M] | waits inside a compiled solver (H2) [M] |
| connectors (hundreds of integrations), visual canvas, hosted triggers | — | — | connector catalog and visual builder (ROADMAP §3) [M] |

## 5. The smallest primitive set, and the evidence rules the others lack

**Primitive set.** Code (`step`, plain control flow), narrow typed judgment (`judge` with schema, check, tiers,
samples), assumptions (`guard`, `invariant`), uncertainty (`flag`), fan-out (`map`), composition (`call`), delegated
open-ended work (`agent`), planned fan-out (`wide`), bounded expansion (`plan`), result (`done`). Effects, waits,
approvals and triggers stay in the engine.

**Coverage evidence so far.** On the JSON IR (not flow-v3), the corpus verdicts are 521 native, 1,003 via an extension,
35 unsupported, of 1,559 items [M-c]. The most frequent extensions are `webhook-trigger` 251, `event-trigger` 224,
`error-branch` 220, `subworkflow-call` 220, `agent-tool-loop` 209, `cross-run-state` 165, `schedule-trigger` 164,
`chat-session` 101, `adaptive-retry` 96 [M-c]. Mapped onto flow-v3: `subworkflow-call` → `call`; `agent-tool-loop` and
`agent-as-tool` (30) → `agent`; `error-branch` and `adaptive-retry` → deopt/recompile (different semantics: Foundry
repairs the workflow rather than routing around a failure, which is not equivalent and must be stated per item);
`dynamic-dag` (23) and `dynamic-agent-spawn` (6) → `wide`/`plan`; triggers, `signal-wait`, `durable-wait`,
`interrupt-resume`, `cross-run-state`, `chat-session` → engine or ContextPort, **not** flow [I]. So flow-v3 alone covers
the orchestration *logic* of most items only when paired with the engine; Claim K must be tested with both.

**Test for Claim K** (FRONTIER-GAPS H2 option 3, "express one R-bench item and count invented primitives") [M]: express
the reference workflows of W-BED's corpus rungs (W-BED §7) in flow-v3 + engine; count primitives invented, constructs
rejected with a named reason, and lines of orchestration code against the source graph's node count. Falsifier: more
than one invented primitive per item on average, or any corpus rung whose logic cannot be expressed without a
LangGraph-style shared mutable state.

**Evidence rules none of the four has** (each is a ROADMAP or THESIS-JIT rule with repo evidence behind it):

| rule | why (repo evidence) |
|---|---|
| no system component sees an oracle; the bed oracle scores only the delivered answer | `stream.mjs` header lines 9–11 [M] |
| every judgment is typed, checked by code, and escalates on a failed check | P2; S1 shows checks still miss relational errors, so checks are necessary, not sufficient (FRONTIER-GAPS §1 item 2) [M] |
| verify is independent and labelled | THESIS §6 item 6; ROADMAP §2.1 `verify` [M] |
| repairs are replay-proven and reject-if-worse; guards are never relaxed by a recompile without strong-tier confirmation | D9 (a heal widened a guard and turned refusals into silent failures) [M] |
| reuse is gated by an applicability profile and measured as correct / wrong / missed reuse | THESIS-JIT §6.7 [M] |
| comparative claims follow the decision rule (K ≥ 2, 3-point floor, McNemar, clustered CI) | `experiments/jit/stats.mjs` `DECISION_RULE` [M] |

## 6. Sources

Fetched 2026-10-09; page text treated as data.
- Kimi K2.5 blog, Agent Swarm and PARL: https://www.kimi.ai/blog/kimi-k2-5 (redirected from https://www.kimi.com/blog/kimi-k2-5)
- Kimi Agent Swarm help page (K2.6, K3 Swarm, 300 sub-agents, 4,000 tool calls, credits): https://www.kimi.ai/help/agent/agent-swarm
- Third-party summaries seen in search, not relied on: https://www.morphllm.com/kimi-k2-5-agent-swarm, https://datacamp.com/tutorial/kimi-k2-agent-swarm-guide
- LangGraph Graph API (Send, Command, reducers, recursion limit, caching): https://docs.langchain.com/oss/python/langgraph/graph-api
- LangGraph interrupts: https://docs.langchain.com/oss/python/langgraph/interrupts
- LangGraph persistence: https://docs.langchain.com/oss/python/langgraph/persistence
- LangGraph subgraphs: https://docs.langchain.com/oss/python/langgraph/use-subgraphs
- LangGraph checkpointed-subgraph restriction (search result): https://docs.langchain.com/oss/python/MULTIPLE_SUBGRAPHS
- n8n sub-workflows: https://docs.n8n.io/flow-logic/subworkflows/
- n8n Execute Sub-workflow node: https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.executeworkflow/
- n8n error handling: https://docs.n8n.io/flow-logic/error-handling/
- n8n Wait node: https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.wait/
- Claude Code Workflow tool: the `workflow-authoring` skill reference text available in this session (no public URL
  was fetched).
