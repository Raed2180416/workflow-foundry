# Workflow Foundry: context contracts, async semantics, cheap-model assignment

*Research report, 2026-10-06.*

- **[V]** means [verified: fetched 2026-10-06]. The fetch was done by me or by a delegated research sub-agent.
- **[R]** means [recalled, unverified].
- Benchmark numbers are reported by the vendor or the paper's authors, and harnesses differ, so the numbers cannot be compared directly.
- Sections headed "Recommended mechanisms" are design proposals, not factual claims.
- No local files were modified.

## A. Context boundaries

### A1. Evidence

**Whether to isolate or share context depends on whether agents write to the same thing.**
- **Anthropic's multi-agent research system.**
  - Each subagent gets its own context window and condenses "the most important tokens" for the lead agent.
  - An Opus 4 lead with Sonnet 4 subagents beat single-agent Opus 4 by 90.2%.
  - Token usage alone explains 80% of performance variance, and multi-agent runs use about 15× the tokens of chat.
  - Each delegation needs "an objective, an output format, guidance on the tools and sources to use, and clear task boundaries". Subagents store their work externally and "pass lightweight references back" ([MA](https://www.anthropic.com/engineering/multi-agent-research-system)) [V].
  - What subagents return is "often 1,000-2,000 tokens" ([CE](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)) [V].
- **Cognition, 2025:** "Share context, and share full agent traces" and "Actions carry implicit decisions, and conflicting decisions carry bad results" ([Cog25](https://cognition.com/blog/dont-build-multi-agents)) [V].
- **Cognition, 2026-04-22** ([Cog26](https://cognition.com/blog/multi-agents-working)) [V]:
  - The multi-agent systems that work keep writes single-threaded.
  - Their review agent works best with "completely clean context". It finds about 2 bugs per PR, about 58% of them severe.
  - "Smart friend" escalation gives the larger model "a fork of the full context". It failed when the gap between the two models was "too wide".
- **Restate** enforces a single writer in the runtime: "At most one handler with write access can run at a time per object key" ([Restate](https://docs.restate.dev/concepts/services)) [V].
- **MAST** lists inter-agent misalignment as one of three top-level failure categories. The taxonomy has 14 failure modes, built from 1,600+ traces, with κ=0.88 ([MAST](https://arxiv.org/abs/2503.13657)) [V].

**Context length and tool count both need hard budgets.**
- **Chroma:** 18 models, including Qwen3-8B, 32B and 235B, get less reliable as input grows, even on simple tasks. On LongMemEval, focused prompts (~300 tokens) beat full prompts (~113K) for every model ([Chroma](https://www.trychroma.com/research/context-rot)) [V].
- **At 32K tokens:**
  - 11 of 13 models fall below half their short-context baseline ([NoLiMa](https://arxiv.org/abs/2502.05167)) [V].
  - Only half of 17 models stay satisfactory ([RULER](https://arxiv.org/abs/2404.06654)) [V].
- **Length alone** costs 13.9–85% accuracy, even when the filler is whitespace or masked. Having the model recite the relevant evidence first helps ([Du25](https://arxiv.org/abs/2510.05381)) [V].
- **Tool count:**
  - Retrieving a narrow tool set raised tool-selection accuracy from 13.62% to 43.13% ([RAG-MCP](https://arxiv.org/abs/2505.03275)) [V].
  - With an oversized tool registry, agents "invoke incorrect tools nearly 100% of the time" ([SOP-Bench](https://arxiv.org/abs/2506.08119v1)) [V].

**How existing frameworks draw the boundary.**

| System | Boundary mechanism |
|---|---|
| LangGraph | Shared state channels with reducers (overwrite by default; `operator.add` appends), private channels, and input/output schemas ([graph](https://docs.langchain.com/oss/python/langgraph/graph-api)) [V]. A subgraph with a different schema needs explicit transforms in and out ([subgraphs](https://docs.langchain.com/oss/python/langgraph/use-subgraphs)) [V]. The Store holds namespaced JSON documents with semantic, episodic and procedural memory types, following CoALA ([memory](https://docs.langchain.com/oss/python/concepts/memory)) [V]. |
| Google ADK | "Context is a compiled view over a richer stateful system." Storage is separate from presentation, explicit processors run in order, context is scoped by default, artifacts are passed by handle, and other agents' turns are rewritten as narrative ([ADK blog](https://developers.googleblog.com/en/architecting-efficient-context-aware-multi-agent-framework-for-production/)) [V]. State has `user:`, `app:` and `temp:` scopes; `temp:` is discarded after each invocation but shared down the sub-agent chain. State "should always be updated as part of adding an Event" ([ADK state](https://adk.dev/sessions/state/)) [V]. |
| OpenAI Agents SDK | Local context "is not sent to the LLM" ([context](https://openai.github.io/openai-agents-python/context/)) [V]. A handoff passes "the entire previous conversation history" by default, which `input_filter` can trim ([handoffs](https://openai.github.io/openai-agents-python/handoffs/)) [V]. |
| Letta | Memory blocks stay pinned in context, have a character limit and can be `read_only`. Agents share a block by attaching the same one. An update "completely replaces" the block, so "the last write wins" ([Letta](https://docs.letta.com/guides/agents/memory-blocks)) [V]. |
| CrewAI | Facts are extracted automatically after each task and injected automatically before the next ([CrewAI](https://docs.crewai.com/concepts/memory)) [V]. |
| Blackboards | Agents volunteer for requests posted to a shared board. This gave 13–57% relative end-to-end gains over master–slave and RAG baselines ([Salemi](https://arxiv.org/abs/2510.01285)) [V]. |
| CoALA | Working memory holds "symbolic variables for the current decision cycle". Long-term memory is episodic, semantic or procedural ([CoALA](https://arxiv.org/html/2309.02427v3)) [V]. |

**Determinism and field-level write permissions.**
- **Manus** calls KV-cache hit rate "the single most important metric"; cached input costs a tenth as much on Sonnet. Its rules ([Manus](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus)) [V]:
  - keep the prompt prefix stable;
  - make context append-only;
  - serialize deterministically;
  - mask tools rather than removing them;
  - have the agent recite its goals;
  - leave errors visible.
- **MCP 2026-07-28** asks servers for a deterministic `tools/list` order "to improve LLM prompt cache hit rates" ([MCP changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog)) [V].
- **Anthropic** keeps feature lists in JSON because models are "less likely to inappropriately change or overwrite JSON". Agents may change only the `passes` field ([LR](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)) [V].

**Information flow and untrusted input.**
- **CaMeL:** a privileged LLM sees only the trusted user query. A quarantined LLM reads untrusted data but has no tools, and values carry capability tags. It solves 77% of AgentDojo tasks with provable security, against 84% for an undefended system ([CaMeL](https://arxiv.org/abs/2503.18813)) [V].
- **FIDES** tracks confidentiality and integrity labels through dynamic taint tracking and enforces policy deterministically ([FIDES](https://arxiv.org/abs/2505.23643)) [V].
- **The governing principle:** once an agent has ingested untrusted input, it "must be constrained so that it is *impossible* for that input to trigger any consequential actions" ([Patterns](https://arxiv.org/html/2506.08837)) [V].

### A2. Synthesis: six boundary rules
1. **Private by default.** Reasoning, scratch work and raw tool transcripts stay with the node that produced them.
2. **Share decisions and artifacts, not transcripts.** Other nodes see typed events and artifact handles.
3. **One writer per artifact.** Parallel nodes may contribute findings, but a single node owns each write.
4. **Verifiers get a clean context.** They see only the artifact and its spec.
5. **Fork the full context only for escalation and repair.**
6. **Nothing implicit.** No memory is injected automatically and no handoff carries full history by default. Every read is declared, has a budget and produces a receipt.

### A3. Recommended mechanisms

**(1) A context contract on `agent` nodes**
```json
"context": {
  "persona": "persona:reviewer@sha256:…", "instructions": "prompt:review@sha256:…",
  "inputs": {
    "patch": {"ref": "nodes.edit.patch", "schema": {"$ref": "#/defs/patch"}, "render": "verbatim", "maxTokens": 6000},
    "issue": {"ref": "input.issue", "maxTokens": 1500, "label": "untrusted:user"}},
  "reads":  [{"view": "decisions", "scope": "run", "where": {…}, "maxItems": 20, "maxTokens": 1200}],
  "writes": [{"topic": "findings", "schema": {"$ref": "#/defs/finding"}, "maxEvents": 10}],
  "scratch": {"maxTokens": 4000}, "history": "none",
  "tools":  {"allow": ["repo.read", "tests.run"], "max": 5},
  "budget": {"maxInputTokens": 12000, "reserveOutputTokens": 2000, "onOverflow": "fail"},
  "returns": {"schema": {"$ref": "#/defs/review"}, "summaryMaxTokens": 1500, "artifacts": "handles"}
}
```
- **`history`** takes one of three values:
  - `none`: no carried-over conversation.
  - `own`: the same node keeps its thread across loop iterations. This is the single writer's thread.
  - `fork:<nodeKey>`: copies another node's full context. Use it only for escalation and repair.
- **`onOverflow`** is `fail`, `dropLowestPriority` or `summarizeWith:<nodeId>`. The summarizer is a recorded node, never a hidden call.
- **Default budgets by size class** (classes S/M/L/XL are defined in C1) are about 4K/8K/16K/32K input tokens and 3/5/8/12 tools. A node needs its own qualification run before it may use a larger budget.

**(2) A deterministic context compiler.** It assembles segments in a fixed order:
1. Persona plus tool schemas, canonicalized and sorted. These form a byte-stable prefix, so the provider's prompt cache can reuse it.
2. Instructions.
3. Inputs in declared order, each wrapped with its label.
4. Shared-state reads, all evaluated at one board sequence number.
5. A recitation block: goal, constraints, acceptance checks.
6. The task.

- **Receipt.** Before calling the model, the compiler appends a `context.compiled` receipt: `{prefixHash, boardSeq, segments:[{sourceRef, sourceHash, label, tokens, truncated}]}`.
- **Replay key.** The receipt hash becomes part of the node's record/replay cache key.
- **Test.** Identical inputs must produce a byte-identical prompt.

**(3) Shared state as an append-only event log with materialized views**
- **Event table.** Each scope gets a `board_events(seq, topic, writer, label, payload, prevHash)` table.
- **Topics.** Each topic declares:
  - a `schema`;
  - a `reducer`: `append`, `lww(key)` (last write wins per key), `setUnion`, `max` or `counter`;
  - its `writers`, exactly one for an artifact;
  - optionally, `writableFields`.
- **Views** are pure folds over the events, cached by `seq`.
- **Concurrency control.** `lww` writes carry `expectSeq` and are rejected if the stream has moved on. This is the standard event-sourcing answer to concurrent appends ([Azure ES](https://learn.microsoft.com/en-us/azure/architecture/patterns/event-sourcing)) [V].
- **No mutable documents.** Whole-value replacement loses concurrent writes, as Letta's docs warn.
- **Scopes:**
  - `node`: private scratch.
  - `run`: the blackboard for one run.
  - `harness`: persists across runs and holds playbook deltas.
  - `library`: read-only, accessed through AMP `compile_context` receipts. This depends on owner decision D3.
  - `temp`: never visible to child nodes unless passed explicitly.

**(4) Trust labels**
- Every segment carries an integrity label (`trusted` or `untrusted:<source>`) and a confidentiality label.
- A node's output label is the join of its input labels.
- Validation rejects any node whose context holds untrusted segments and whose tools have side effects. There are two exceptions: effect arguments that come only from trusted refs, and actions the host approves.
- A `quarantined` profile has no tools and returns only enums, booleans and bounded numbers. It is the only way to declassify untrusted data.

## B. Async workflow semantics

### B1. Evidence

| Concern | What existing systems do | Implication for Foundry |
|---|---|---|
| Spawning children and handles | Temporal child workflows keep their own history. A parent "should not spawn more than 1,000" children ([child](https://docs.temporal.io/child-workflows)) [V]. When the parent closes, children are terminated by default ([policy](https://docs.temporal.io/parent-close-policy)) [V]. MCP Tasks first appeared as an experiment in the 2025-11-25 spec ([tasks](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks)) [V]. In 2026-07-28 they moved to an extension: clients poll `tasks/get` and send input with `tasks/update`, while `tasks/result` and `tasks/list` were removed. Clients "SHOULD persist task IDs to durable storage" ([SEP-2663](https://modelcontextprotocol.io/seps/2663-tasks-extension.md)) [V]. A2A 1.0 has `input-required` and `auth-required` states, streams artifact chunks, and supports push webhooks ([A2A](https://a2a-protocol.org/latest/specification/)) [V]. | A handle needs a durable id, a typed result, a parent-close policy and a budget carved from the parent's. |
| Await | Restate's await combinators replay deterministically because "Restate logs the order of completion" ([Restate](https://docs.restate.dev/develop/ts/concurrent-tasks)) [V]. In Azure Durable Functions, `WhenAny` leaves the losing activities running. An orchestration cannot complete until every timer has fired or been cancelled ([Azure timers](https://learn.microsoft.com/en-us/azure/azure-functions/durable/durable-functions-timers)) [V]. In Inngest, a wait that loses a race stays active until it times out ([Inngest](https://www.inngest.com/docs/reference/functions/step-wait-for-event)) [V]. | Journal the completion order and declare what happens to the losers. |
| Messages into a running workflow | Temporal has three message types ([messages](https://docs.temporal.io/encyclopedia/workflow-message-passing)) [V]: signals are asynchronous writes; queries are read-only and never recorded in history; updates are validated and recorded, with at most 10 in flight at once ([limits](https://docs.temporal.io/self-hosted-guide/defaults)) [V]. Azure delivers events at least once and buffers them until something waits for them. Events sent to an unknown instance are discarded ([Azure events](https://learn.microsoft.com/en-us/azure/azure-functions/durable/durable-functions-external-events)) [V]. DBOS persists `send`/`recv` and delivers exactly once between workflows ([DBOS](https://docs.dbos.dev/python/tutorials/workflow-communication)) [V]. For input that arrives mid-run, LangGraph's deployment product offers four strategies: enqueue, reject, interrupt or rollback ([double texting](https://docs.langchain.com/langsmith/double-texting)) [V]. | An inbox with deduplication and buffering, plus a declared policy for mid-run input. |
| Timers | Temporal persists timers, and workers use no resources while waiting ([timers](https://docs.temporal.io/workflow-execution/timers-delays)) [V]. | A timers table and a wake scheduler. |
| Streams | Temporal Workflow Streams, a public preview announced 2026-06-17, is a log addressed by offset ([streams](https://temporal.io/blog/workflow-streams-live-interactivity-agents-other-applications)) [V]. Publishers batch their writes into Signals, every 2 s by default or every 100 ms for AI work. The log survives Continue-as-New. Reactive Streams keeps queues bounded with asynchronous back pressure ([RS](https://www.reactive-streams.org/)) [V]. | Treat streams as bounded, persisted logs, not open sockets. |
| Heartbeats and cancellation | In Temporal, a heartbeat can carry progress that a retry resumes from. Activities that never heartbeat "can't receive a Cancellation" ([heartbeats](https://docs.temporal.io/encyclopedia/detecting-activity-failures)) [V]. In AWS Step Functions, a task that misses its `HeartbeatSeconds` deadline fails with `States.Timeout` ([SFN](https://docs.aws.amazon.com/step-functions/latest/dg/connect-to-resource.html)) [V]. Inngest lets a running step finish before cancelling ([Inngest](https://www.inngest.com/docs/features/inngest-functions/cancellation)) [V]. MCP task cancellation is only eventually consistent ([SEP-2663](https://modelcontextprotocol.io/seps/2663-tasks-extension.md)) [V]. | Treat cancellation as a request. An effect stays `uncertain` until it is confirmed. |
| Human input | When LangGraph resumes after an `interrupt`, it re-runs the code that came before the interrupt, so that code must be idempotent ([interrupts](https://docs.langchain.com/oss/python/langgraph/interrupts)) [V]. n8n's Wait node resumes through a `resumeUrl` unique to each execution, with an optional time limit ([n8n](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.wait/)) [V]. Claude Code workflows accept "No mid-run user input". When you relaunch a run with a failed agent, that agent and every agent started after it run again ([CC](https://code.claude.com/docs/en/workflows)) [V]. | Suspend only at node boundaries, with resume tokens and timeouts that route somewhere. |
| Determinism and history size | Temporal requires replayed code to make the same calls in the same order, and keeps LLM calls in Activities ([definition](https://docs.temporal.io/workflow-definition)) [V]. History fails at 51,200 events or 50 MB ([limits](https://docs.temporal.io/self-hosted-guide/defaults)) [V], and Continue-As-New starts a fresh history ([CAN](https://docs.temporal.io/workflow-execution/continue-as-new)) [V]. Claude Code workflows make `Date.now()` and `Math.random()` throw ([CC](https://code.claude.com/docs/en/workflows)) [V]. | Journal every nondeterministic observation and compact the log in epochs. |
| Sagas | A saga runs compensable steps, then a pivot (the point of no return), then retryable steps. Compensations can themselves fail ([Saga](https://learn.microsoft.com/en-us/azure/architecture/patterns/saga)) [V]. | Effect roles should be checked statically. |
| Async inside the model | AsyncLM teaches a model to handle interrupts using an in-context protocol plus fine-tuning ([AsyncLM](https://arxiv.org/abs/2412.07017)) [V]. LLMCompiler plans parallel tool calls as a DAG ([LLMCompiler](https://arxiv.org/abs/2312.04511)) [V]. | With cheap models, keep concurrency in the harness, not in the model. |

### B2. A minimal complete set of async primitives (proposal)
All suspension happens at node boundaries.

1. **Spawn.**
   - A `task`, `agent` or `call` node with `"detach": true` completes at once and returns `{handle: {id, kind, resultSchemaHash}}`.
   - Each child gets a budget carved from the parent's.
   - `onParentClose` is `terminate` (the default), `request_cancel` or `abandon`.
2. **`call`.** `{"kind":"call","workflow":"sha256:…","input":{…}}` starts a child workflow by hash. The child has its own run record and journal.
3. **`await`.**
   - Shape: `{"kind":"await","handles":[…],"mode":"all|any|race|first_k|all_settled","k":2,"timeoutMs":…,"onLosers":"cancel|detach"}`.
   - It outputs `{results, order, timedOut}`, where `order` is the journaled completion order.
   - `first_k` covers voting quorums.
4. **`wait`, generalized.**
   - Shape: `{"for":{"any":[{"timer":{"delayMs":…}},{"event":{"name":"approve","match":<condition>}}]},"onTimeout":"fail|continue"}`.
   - It outputs `{fired, payload}`.
5. **`signals`, declared at workflow level.**
   - Shape: `{"approve":{"schema":{…},"dedupeKey":"/id","bufferMax":100}}`.
   - Delivery is at least once, deduplicated, and consumed in arrival order.
   - Events left unconsumed are reported at the end of the run, never silently dropped.
   - `concurrentInput` (`enqueue`, `reject` or `interrupt`) decides what happens to input that arrives while the run is busy.
6. **`updates` and `queries`.**
   - Updates are validated, journaled writes that return a value.
   - Queries are read-only views and are never journaled.
7. **`streams`, declared at workflow level.**
   - Shape: `{"tokens":{"schema":{…},"capacity":256,"overflow":"block|drop_oldest|coalesce","flushMs":100}}`.
   - Producers declare `emits`; consumers read by offset.
   - `block` applies back pressure to the producer.
8. **Heartbeats.**
   - `heartbeatMs` and `progressSchema` apply to long-running tasks and agents.
   - A missed heartbeat ends the attempt. Idempotent work retries from its last recorded progress; anything else becomes `uncertain`.
9. **`cancel`.**
   - It targets a handle and takes `graceMs` and `propagate: "children"`.
   - The target moves to `cancel_requested` and then ends as `cancelled`, `completed` or `uncertain`.
10. **`human`, extended.**
    - New fields: `timeoutMs`, `onTimeout` (`route:<node>`, `default:<json>` or `fail`) and a single-use resume token bound to the run, the node and the question hash.
    - Approvals remain a separate authority.
11. **`triggers`, declared at workflow level.** Shape: `{"event":"issue.opened","schema":{…},"policy":"start|signal_or_start","correlate":"/repo"}`.
12. **`saga`.**
    - Shape: `{"role":"compensable|pivot|retryable","compensate":{"tool":…,"args":…}}`.
    - The checker allows only retryable nodes after a pivot.
    - If the run fails before the pivot, compensations run in reverse order, and each is journaled.

At runtime, `history: {maxEvents, maxBytes}` triggers automatic epochs. Each epoch snapshots state and carries the inbox, timers and open handles forward.

### B3. Replay and determinism rules
- **R1. Pure control flow.** Control flow is a pure function of the workflow hash, the input and the journal so far. `now` and `random` exist only as journaled values.
- **R2. Journal before observing.** Each of these is appended to the journal before it can influence control flow:
  - tool results;
  - raw agent output, with the model id and decoding parameters;
  - context receipts;
  - inbox deliveries;
  - timer firings;
  - `await` completion order;
  - human answers;
  - stream offsets.

  Replay never re-executes an effect already in the journal.
- **R3. Awaits replay in order.** `await` resolves in the journaled order and is never re-raced.
- **R4. No suspension inside a node.** This avoids LangGraph-style re-execution of code before an interrupt.
- **R5. Idempotency.** The idempotency key is `hash(runId, nodeKey, args)`. A non-idempotent effect with an unknown outcome is `uncertain`, and a cancellation never proves the effect did not happen.
- **R6. Map order.** `map` outputs are ordered by index, not completion time.
- **R7. Pinned runs.** A run stays pinned to its workflow hash. Migrating it requires proving the replay is equivalent (owner decision D2).
- **R8. Minimal resume.** On resume, re-run only failed nodes, nodes whose input changed, and their dependents. Claude Code instead reruns everything started after the failure.

### B4. Recommended runtime mechanisms
- **Timers table.** It is scanned by the `foundry serve` loop and by a new `foundry tick` command that cron can call. This fixes the current gap where waits never wake.
- **Parallel `map`.** Add `concurrency` and `failure: fail_fast|collect`.
- **Per-node journal rows** instead of rewriting the whole run blob.
- **MCP surface.** Expose runs through the MCP tasks extension:
  - a pending `human` node maps to `input_required`, with `inputRequests` keyed by `nodeKey`;
  - `tasks/update` maps to `answer()`.

  Sampling is deprecated in MCP 2026-07-28 ([changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog)) [V], so `agent` nodes should call model providers directly.
- **A2A mapping.** Map `uncertain` to `input-required` with a reconciliation request, never to `completed`.

## C. Cheap open-weight model reliability and model assignment

### C1. Open-weight landscape, October 2026 (vendor-reported numbers)

| Class | Strong open candidates |
|---|---|
| **S** (≤4B) | Qwen3.5-4B: BFCL-V4 50.3, TAU2 79.9 ([card](https://huggingface.co/Qwen/Qwen3.5-9B)) [V]. Nemotron 3 Nano 4B: τ² airline 33.3, retail 39.8, telecom 33 ([card](https://huggingface.co/nvidia/NVIDIA-Nemotron-3-Nano-4B-BF16)) [V]. These vendor figures conflict, so treat the class as unproven. |
| **M** (7–14B) | Qwen3.5-9B: BFCL-V4 66.1, TAU2 79.1 ([card](https://huggingface.co/Qwen/Qwen3.5-9B)) [V]. Gemma 4 12B: Tau2 69.0 ([card](https://ai.google.dev/gemma/docs/core/model_card_4)) [V]. |
| **L** (20–35B) | Qwen3.8-27B (dense, Apache-2.0): Terminal-Bench 2.1 73.0, SWE-bench Pro 61.7 ([card](https://huggingface.co/Qwen/Qwen3.8-27B)) [V]. Qwen3.6-35B-A3B (Apache-2.0): TAU3 67.2 ([card](https://huggingface.co/Qwen/Qwen3.6-35B-A3B)) [V]. GLM-4.7-Flash (30B-A3B, MIT): τ² 79.5, against 47.7 for gpt-oss-20b ([card](https://huggingface.co/zai-org/GLM-4.7-Flash)) [V]. Gemma 4 31B: Tau2 76.9 ([card](https://ai.google.dev/gemma/docs/core/model_card_4)) [V]. Meta's Muse Glimmer-30B (Apache-2.0): MCP Atlas 75.5 ([card](https://huggingface.co/meta-models/Muse-Glimmer-30B)) [V]. |
| **XL** (80–130B MoE) | Qwen3.8-Flash-Next (125B total, 6B active, licence "qwen-community-1.0"): Toolathlon Verified 73.5 ([card](https://huggingface.co/Qwen/Qwen3.8-Flash-Next)) [V]. Mistral Small 4 (119B total, 6.5B active, Apache-2.0) ([card](https://huggingface.co/mistralai/Mistral-Small-4-119B-2603)) [V]. Qwen3.5-122B-A10B: BFCL-V4 72.2 ([card](https://huggingface.co/Qwen/Qwen3.5-122B-A10B)) [V]. gpt-oss-120b scores 61.0 on TauBench V2 in NVIDIA's measurement ([card](https://huggingface.co/nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-BF16)) [V]. |
| **F** (200B+) | DeepSeek-V4-Flash (284B total, 13B active, MIT, labelled "preview") ([card](https://huggingface.co/deepseek-ai/DeepSeek-V4-Flash)) [V]. GLM-5.3-Flash (320B total, 18B active, MIT) ([card](https://huggingface.co/zai-org/GLM-5.3-Flash)) [V]. Kimi K3 (2.8T total, 104B active) ([card](https://huggingface.co/moonshotai/Kimi-K3)) [V]. |

Public leaderboards lag behind releases:
- BFCL shows "Last Updated: 2026-04-12" and lists no 2026 open models ([BFCL](https://gorilla.cs.berkeley.edu/leaderboard.html)) [V].
- Meta has published no Llama model after Llama 4 ([HF](https://huggingface.co/meta-llama)) [V].
- OpenAI has released no gpt-oss weights since August 2025 apart from gpt-oss-safeguard ([OpenAI](https://help.openai.com/en/articles/11870455)) [V].

Foundry therefore has to qualify models itself, node by node.

### C2. What serving engines guarantee
- **vLLM**
  - A named or `required` tool choice is "guaranteed a validly-parsable function call - not a high-quality one".
  - In `auto` mode, "arguments may occasionally be malformed" unless strict mode is on ([tools](https://docs.vllm.ai/en/latest/features/tool_calling.html)) [V].
  - The grammar is not applied while the model reasons, only after reasoning ends ([reasoning](https://docs.vllm.ai/en/latest/features/reasoning_outputs.html)) [V].
- **SGLang**
  - `tool_choice` is "fully supported" only with the xgrammar backend ([docs](https://docs.sglang.io/advanced_features/tool_parser.html)) [V].
  - A strict-tool change raised Qwen3.6-35B-A3B's BFCL-v3-simple correct-call rate from 0.8155 to 0.9075 ([PR](https://github.com/sgl-project/sglang/pull/21722)) [V].
- **llama.cpp** silently skips JSON Schema features it does not support, including `uniqueItems`, `not` and nested `$ref` ([README](https://raw.githubusercontent.com/ggml-org/llama.cpp/master/grammars/README.md)) [V].
- **Ollama**
  - `format` accepts a JSON schema ([docs](https://docs.ollama.com/capabilities/structured-outputs)) [V].
  - Its OpenAI-compatible endpoint does not support `tool_choice` ([compat](https://raw.githubusercontent.com/ollama/ollama/main/docs/api/openai-compatibility.mdx)) [V].
  - An open issue reports gemma4:31b looping on free-text fields when `format` is set ([#15502](https://github.com/ollama/ollama/issues/15502)) [V].
- **Grammar engines**
  - XGrammar-2 claims "over 6x faster compilation" ([paper](https://arxiv.org/abs/2601.04426)) [V].
  - llguidance costs about 50 µs of CPU per token ([README](https://raw.githubusercontent.com/guidance-ai/llguidance/main/README.md)) [V].
- **Evidence on how constraints affect quality**
  - JSONSchemaBench: the best framework supports twice as many schemas as the worst, and downstream gains reach at most 4% ([JSB](https://arxiv.org/html/2501.10868)) [V].
  - Format restrictions can hurt reasoning ([paper](https://arxiv.org/abs/2408.02442)) [V]; dottxt disputes this ([dottxt](https://blog.dottxt.ai/say-what-you-mean.html)) [V].
  - CRANE alternates free reasoning with constrained output and gains up to 10 points ([CRANE](https://arxiv.org/abs/2502.09061)) [V].
  - On 0.6–4B models, constrained decoding raises schema validity from 78.6–92.9% to 100%, but multi-step function-calling errors remain ([paper](https://arxiv.org/abs/2609.23742)) [V].

### C3. How small models fail in agent loops
AgentFloor ran 16 open models (0.27–32B) and GPT-5 across six tiers ([AgentFloor](https://arxiv.org/html/2605.00334)) [V]:
- A0: instructions only;
- A: a single tool call;
- B: a two-tool chain;
- C: a branch;
- D: multi-source synthesis;
- E: long-horizon planning under constraints.

Its best open model, gemma4:26b, matched GPT-5 overall:

| Tier | A | B | C | D | E |
|---|---|---|---|---|---|
| gemma4:26b | 100% | 73.3% | 53.3% | 40.0% | 0.0% |
| GPT-5 | 97.8% | 82.2% | 51.1% | 42.2% | 10.2% |

- **Tier-E failures for gemma4:26b:** step budget exhausted (41%), invented tools (36%), early resignation (23%).
- **Interventions** helped some models and not others. A plan/execute/submit decomposition made all four models tested worse, by 5 to 33 points.
- **Starting the tool call at all** is the weak point: tool initialization failures are "the primary bottleneck for smaller models" ([paper](https://arxiv.org/abs/2601.16280)) [V].
- **Other recurring failures** ([paper](https://arxiv.org/abs/2512.07497)) [V]:
  - acting before grounding in the available data;
  - inventing substitutes for missing entities;
  - getting derailed by distracting content in the context.
- **Task length:** failures "compound nonlinearly with task length", and "additional scaffolding does not consistently improve reliability" ([paper](https://arxiv.org/abs/2607.05775)) [V].

### C4. Does structure lift small models?
It does when the runtime enforces the structure and the structure is chosen by search, not merely written into prompts.
- **Searched or compiled workflows**
  - AFlow lets "smaller models … outperform GPT-4o on specific tasks at 4.55% of its inference cost" ([AFlow](https://arxiv.org/abs/2410.10762)) [V].
  - DSPy-compiled programs on llama2-13b and T5-770M are "competitive with" expert-written GPT-3.5 prompt chains ([DSPy](https://arxiv.org/abs/2310.03714)) [V].
  - ACE on DeepSeek-V3.1 scored 59.4% on AppWorld, against 60.3% for the top GPT-4.1 agent ([ACE](https://arxiv.org/html/2510.04618)) [V].
- **Verifiers.** With 250 samples and a verifier, DeepSeek-Coder-V2 rose from 15.9% to 56% on SWE-bench Lite. Without automatic verification, voting plateaus ([Monkeys](https://arxiv.org/abs/2407.21787)) [V].
- **A different model per module**
  - LLMSelector gains 5–70% over using one model for every module ([paper](https://arxiv.org/abs/2502.14815)) [V].
  - In X-MAS, mixing models gains up to 8.4% on MATH and 47% on AIME ([paper](https://arxiv.org/abs/2505.16997)) [V].
  - α-UMi splits work across a small planner, caller and summarizer, and beats a single LLM ([paper](https://arxiv.org/abs/2401.07324)) [V].
- **Transfer across models**
  - One harness found by Meta-Harness lifted five held-out models by 4.7 points on average ([paper](https://arxiv.org/abs/2603.28052)) [V].
  - Small "student" models using MCP tool boxes built by a stronger "teacher" model match OctoTools running on GPT-4o ([AgentDistill](https://arxiv.org/abs/2506.14728)) [V].
  - NVIDIA estimates that 40–70% of LLM calls in three agent systems could go to small models. A 7B model is 10–30× cheaper to serve than a 70–175B one ([SLM](https://arxiv.org/html/2506.02153)) [V].
- **Cascades**
  - FrugalGPT matches GPT-4 at up to 98% lower cost ([FrugalGPT](https://arxiv.org/abs/2305.05176)) [V].
  - Good quality estimators are "the critical factor" in routing ([paper](https://arxiv.org/abs/2410.10347)) [V].
  - Agents can trigger escalation by self-evaluation ([AgentCollab](https://arxiv.org/abs/2603.26034)) [V] or by monitors that detect a stuck agent or check milestones ([paper](https://arxiv.org/abs/2604.27151)) [V].

**Synthesis.** Structure helps a small model when it:
- shrinks every call to a tier-A decision;
- moves chaining, branching, termination and constraint tracking into the runtime;
- attaches a check to each node;
- is chosen per model by measurement.

### C5. Model-assignment policy (proposal)

| Node role | Default class | Escalate to | Required structure |
|---|---|---|---|
| Classify, route, extract | S–M | L | Enum schema, constrained decoding, 3-way vote on nodes that gate later steps |
| Single tool call | M–L | XL | At most 5 tools, strict schema, `required` tool choice |
| Two-step chain or branch | L | XL | Split into tier-A nodes; do the branching in `when` |
| Synthesis | L plus a verifier | XL/F | Evidence passed by handle, recitation |
| Code edit | L coder | F | Tests as the oracle |
| Verifier | At least the generator's class, from a different model family | F | Clean context; prefer an execution oracle |
| Plan or expand (emits IR) | Frontier model when authoring, F at runtime | — | Type checker and capability policy |
| Long-horizon constrained planning | No model | — | A `loop` with a checker and a human gate |

**Procedure distillation (a frontier model authors, cheap models execute):**
1. **Author.** A frontier model writes the IR, the schemas, a check for each node and a tier label for each node.
2. **Record.** Capture the frontier ("teacher") traces on the dev slice in the record cache.
3. **Screen.**
   - For each node, replay the recorded upstream inputs and try candidate models, cheapest first, scoring each on that node's checks.
   - Prune candidates with successive halving ([Hyperband](https://arxiv.org/abs/1603.06560)) [V].
   - Searching one node at a time keeps the cost linear in the number of nodes.
4. **Adapt.** Keep a separate prompt variant for each node–model pair, tuned in the style of GEPA or ACE. Fixes do not transfer between models, so variants cannot be shared.
5. **Confirm.**
   - Run end to end on dev, then on the sealed held-out set, against all-frontier and all-cheapest baselines.
   - If the end-to-end result falls short of the node-level estimates, intervene on nodes one at a time to find the culprit, and upgrade only that node.
6. **Freeze.** Record a `modelAssignment` bound to the harness hash, model ids, engine version and decoding settings. Any change to these voids the assignment.

**Escalation rules:**
- **E1. Schema failure:** retry once with the validator's error message, then move up one class.
- **E2. Failed node check:** resample if this node–model pair has historically flipped often; otherwise escalate.
- **E3. Stuck:** if the same action hash repeats 3 times, or 80% of the step budget is spent, escalate with a fork of the full context.
- **E4. Milestones:** a stronger class spot-checks every milestone.
- **E5. High-stakes nodes:** a node that gates a non-idempotent effect or a saga pivot needs class L or above plus an independent verifier.
- **E6. Disagreement:** escalate when k samples disagree.
- **E7. Cap:** at most two escalations per node. A failure at class F fails visibly.

Every escalation is recorded as an event that cites the rule, the model ids and the cost.

### C6. Recommended mechanisms
```json
{"kind": "agent", "role": "patch-reviewer", "tier": "C",
 "model": {"class": "L", "maxClass": "XL", "assignment": "assign:sha256:…"},
 "decoding": {"output": "json_schema", "reasoning": "free_then_constrained", "temperature": 0, "maxTokens": 2048},
 "tools": {"allow": ["repo.read"], "choice": "required", "strict": true},
 "escalation": {"onSchemaFail": {"retries": 1}, "stuck": {"repeat": 3, "stepFrac": 0.8}, "maxEscalations": 2},
 "independence": "execution|different-model|same-model", "context": {"…": "A3"}}
```
- **Owner policy file.** It maps each class to model ids, serving engines and verified features: `jsonSchema`, `toolChoiceRequired` and `reasoningThenFormat`.
- **Engine conformance suite.** Restrict output schemas to a portable subset: no `pattern`, `oneOf`, `uniqueItems` or nested `$ref`.
- **Validation.** Validate every output after decoding, and treat `finish_reason=length` as a failure.
- **Repetition guard.** Cap string lengths to stop repetition loops.
- **Separate turns.** Keep tool-call turns separate from the final typed output.
