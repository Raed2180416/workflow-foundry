# Agentic constructs: one labelling convention for the agent-framework slice

Status: development/diagnostic, 2026-10-08. It applies to the 217 agentic items staged in
`/var/tmp/foundry-work/corpus-agentic/<platform>.jsonl` (21 platform files, 20 third-party plus the first-party
`claude-code-workflows`). Every item's `ir.verdict` and `ir.notes` were re-labelled to this convention. The
pre-harmonisation files are kept in `pre-harmonise/` in that directory, and each changed verdict has one line in
`harmonise-log.md` there. All verdicts are static model readings of pinned sources. Nothing was compiled or executed.
Corpus text is untrusted data.

The convention replaces the platform conventions in the 21 ledgers (`<platform>-ledger.md`) where they differ.
Those ledgers stay as the record of what each extractor and verifier decided. Item notes cite the rules below by
their two-letter codes (for example "rule HO").

## 1. What a verdict says

A verdict is judged against the Phase 1 IR (`schemas/workflow.schema.json`, `research/core-20261006/DESIGN.md`) with
the same three kinds as the merged corpus (`COVERAGE.md` §4):

- `native`: every construct maps onto Phase 1 node kinds by a local rewrite. Routing counts as native: an `agent`
  with `role: "route"` (schema L128) and an enum output, followed by `when` guards (L103). If the source loop has no
  cap, the cap is named in the notes (rule BL).
- `via-extension:<a>+<b>`: tokens from the construct registry (§3), in registry order. **A token names an IR
  mechanism the item needs. It is never a topology label.** Topologies that need no mechanism of their own are
  recorded in the notes as *native patterns* (§4), so that they can still be counted.
- `unsupported:by-design-<refusal>[+<refusal>]`: an owner design refusal (§5). Such an item is representable with
  a turn cap, but the design refuses it. Coverage reports must keep these apart from `unsupported:<reason>` items
  that are not expressible at all. The notes list the extension constructs the item would also need, as
  `Needs: a, b.` (the form `merge-items.mjs` already parses for unsupported verdicts).

Each item's notes now start with a header:

```
Harmonised 2026-10-08 (research/corpus-20261006/AGENTIC-CONVENTIONS.md): verdict <v>. [Refused by design: ...; Needs: ...]
[Changed from <old>: <reason with source spans>] [Native patterns, no token: ...] [...the header and the convention win.]
Record: <the extractor's and verifier's notes, unchanged>
```

The header is at most 1,498 characters, so it survives the 2,000-character cut in `merge-items.mjs`. The record
after it may still name retired tokens; the header overrides it.

## 2. General rules

- **G1 Reachable semantics.** Tag what the shipped code and configuration can do. That includes model-chosen paths
  and failure paths: in the CAMEL workforce items, worker spawning, code execution and the approval prompt are
  reachable only on the failure path, and they are counted. Do not tag a capability that the item never configures
  or exercises. Examples: the unused `sequence_number` resume in the Burr templates; code execution enabled but
  unused in the AG2 nested chat; CAMEL's default history summarisation, which the role-play never reaches.
- **G2 Display is not semantics.** Printing tokens or events to the console, `print_response(stream=True)` and
  progress logs (`phase()`, `log()`) add no construct (rule PS).
- **G3 Mechanism over vocabulary.** A framework's own name ("handoff", "group chat", "supervisor", "swarm") does
  not decide the tag. Two questions decide it: who chooses the next agent (code, a manager model, or the active
  agent), and what context the receiver gets (a typed payload or task string, or the shared conversation).
- **BL Bounded semantics.** Some source loops lack a cap but are meant to end: tool loops, reflection, retries,
  games that end at game over, tasks with human pauses. They count as native once a cap is named in the notes.
  An open-ended process is different. A poller with no stop, or a chat loop whose only end is the user leaving,
  becomes triggered bounded runs: `poll-trigger`/`schedule-trigger` or `chat-session`, plus `cross-run-state` for
  whatever it carries (owner-agreed bounded semantics, ROADMAP-AMENDMENTS L297-L298).
- **G4 One token per mechanism.** No token is added for a part already carried by another token. Examples: no
  `unstructured-cycle` for a handoff mesh (rule UC); no `llm-router` next to a tool loop (rule LR).

## 3. Construct registry for agentic items

The 19 existing `CONSTRUCTS` ids keep their order and meaning. Twelve agentic constructs follow them, in this order:
`state-reducer, interrupt-resume, checkpoint-rewind, agent-as-tool, shared-scratchpad, guardrail-tripwire,
partial-output-stream, model-generated-code-exec, multimodal-io, dynamic-agent-spawn, context-compaction,
env-session`. Item counts are for the 184 non-refused items; the figures in brackets add the `Needs:` lists of the
33 refused items.

### 3.1 Existing registry ids, as applied to agent frameworks

| id | rule | definition for this slice | native instead | items |
|---|---|---|---|---|
| `agent-tool-loop` | TL | A model is offered tools: function, hosted or provider-side (web search, code interpreter), MCP, agent tools, or code-as-action. It chooses whether, which, how often and with what arguments to call them, and at least one result returns to a model call that may call again (within one turn, or across turns of the same agent). | A forced single call whose result never returns to a model (typed output plus `task`; AutoGen illustrator, inngest SQL matcher). Terminal routing or output tools returning a typed object (AG2 coordinator `handoff`/`finish`, `final=True`). An `exit_loop` or escalate tool in a capped loop (`until`). A fixed loop in which a model writes plain text that a fixed node runs (AutoGen assistant-executor). A model-written list of calls over a closed tool set dispatched by code (Swarm local planner engine). | 110 (138) |
| `chat-session` | CS | The item is an open-ended conversational entry point: each user message is a turn answered in one ongoing conversation, with no task-defined end. This covers REPL or chat loops that call the run API per message, chat endpoints and served chat agents. A scripted multi-message session against one agent or session also counts, because the script stands in for a user (agno nested teams, LlamaIndex CodeAct, OpenAI compaction session, Strands persistent trust). | A finite task that pauses for input at defined points and resumes, even if the answer arrives as a new invocation: a `human` node at a boundary, or `interrupt-resume` inside a node (ADK `agent_in_workflow`, Burr email assistant, agno review cycle). Blocking prompts inside one run (AG2 `UserProxyAgent`, AutoGen Core user agent). Typed menu choices in a game loop (DSPy text adventure). | 24 (36) |
| `cross-run-state` | CM | State written by one invocation and read by a later one. This includes conversation history carried between chat turns, session state across turns, long-term or user memory, stores and persisted records. **A `chat-session` that carries history or session state always also carries `cross-run-state`.** That is the main corpus's convention (conversation memory counts as cross-run-state, `COVERAGE.md` E1 evidence), and E2 sessions are built on E1 state (`review-20261007/02-ir-expressiveness.md` L830-L863). | Loop-carried state inside one run. A file or repository read as an ordinary external resource (Claude Code workflows). A stateless chat in which each turn starts cold. | 31 (43) |
| `stream` | LS | A continuous inbound stream into a running invocation. For agents, a live or realtime model session receiving microphone audio or messages during a turn (server VAD, barge-in). Such a session is `stream` (in) plus `partial-output-stream` (out) plus `multimodal-io`, not `chat-session`, unless the item re-invokes once per user turn with carried state. | Inputs only at turn boundaries from scripted text (pydantic-ai `realtime_handoff`). | 2 (3) |
| `unstructured-cycle` | UC | A strongly connected region with more than one entry, in authored control flow. | Not added when the multi-entry cycle is a handoff or group-chat mesh, or a chat re-entry at the last active agent: the refused construct, or `chat-session`, carries it (Swarm airline and triage, LangGraph customer support and swarm). | 2 (2) |
| `subworkflow-call`, `dynamic-dag`, triggers, waits, failure ids | as `COVERAGE.md` §4 | Unchanged. A model-written plan with dependencies is `dynamic-dag`; a model-written flat list is a `map`. A transfer into a task pipeline is not `subworkflow-call` (rule HO). | | see §8 |

### 3.2 New registry constructs

**`state-reducer`** (rule SR; 0 items). Parallel branches or concurrent agents write the same state key, a
declared reducer merges the writes, and either the merge order or a reader during the run depends on run-time
interleaving. *Native instead:* an append or fold over a `map`'s index-ordered outputs; an append in call order
that is read only after the batch (Haystack deep-research `_collect_note`, `tool_calling.py:L559-L590`, removed);
last-writer-wins with a single writer. *Mechanism:* board topics with reducers (ROADMAP §2.2 L257). The construct
is kept because the mechanism is planned and the main corpus will need it, even though this slice has no item.

**`interrupt-resume`** (15 items, 23 with needs). The run pauses *inside* a node and resumes with a value that flows
back into the same model loop. Examples: a tool-approval hook between a model's tool request and its execution
(AutoGen intervention handler, pydantic-ai deferred tools, Strands interrupts, Mastra `requireApproval`); a tool
that asks the user (LangGraph `AskHuman`, Haystack `execute_order` `input()`, CAMEL subprocess confirm); a
task-mode agent that keeps its node open across user turns (ADK `agent_in_workflow`, ADK live workflow).
Blocking console prompts count the same as durable suspensions. *Native instead:* a pause at a node boundary with
a typed answer (ADK `request_input`, agno output review, Burr `halt_before`). *Mechanism:* Phase 1 suspends only at
node boundaries (ROADMAP L197), so this needs approval-gated agent tools and resume tokens (ROADMAP §2.1 `human`;
02-ir E3 Rule of Two).

**`checkpoint-rewind`** (4). A run, or a new run, restarts from an *earlier* stored checkpoint, possibly with
edits, as a fork: LangGraph time travel, agno `continue_from`, pydantic-ai `fork_run`, Burr `main()` loading an
earlier sequence number. *Native instead:* resume at the latest durable point, or replay of an identical prefix
(Claude Code resume, ADK loan "resume at the first incomplete step"). *Mechanism:* fork from a checkpoint (ROADMAP
§2.3 L607).

**`agent-as-tool`** (rule AT; 30, 31). An agent with its own instructions and model loop is invoked by another
agent's model through a tool call, and its final result returns into the caller's loop. Examples: `as_tool`,
`AgentTool`, CrewAI delegation tools, agno team delegate tools, smolagents managed agents, a sub-agent reached from
model-written code (DSPy RLM facade, pydantic-ai harness), and spawn/send/wait tools whose `wait` returns the worker
reports (Anthropic managed-agents coordinator, OpenAI hosted multi-agent). *Native instead:* a sub-agent called by
authored code (a node), or a model-chosen target that does not return (routing). *Mechanism:* agent `tools` entries
that are `call` or `executor` runs with carved budgets (02-ir E3; ROADMAP §2.1 L134).

**`shared-scratchpad`** (rule SS; 6, 9). Two or more agents, or model-invoked tools of different agents, read and
write a common mutable store during one run, *and the order of those reads and writes is decided at run time*,
step by step by a model (a supervisor's or a handoff's next choice) or by concurrency. Examples: agno nested teams,
ADK loan and presentations session keys, LlamaIndex agents-as-tools state, the Strands swarm `SharedContext`, Claude
Code `phase0-unblock` concurrent workers in one tree. *Native instead:* fixed-order hand-over, where the writer
returns before the reader starts and the artifact is a declared output (Claude Code fixed pipelines); state carried
round to round by a loop with one writer per step (ADK release analyzer cursor); writes ordered by a typed plan list
that code consumes (inngest code assistant, LlamaIndex planner); strict alternation (AutoGen chess board); disjoint
writes nobody reads during the run (OpenAI sandbox memory notes). A shared *conversation* is not a scratchpad; it
falls under §5. *Mechanism:* run board (ROADMAP §2.2 L255-L262).

**`guardrail-tripwire`** (rule GT; 6, 7). A validator attached to an agent's input, output or tool calls that
cannot be expressed as a sequential check node: it runs concurrently with the agent and cancels it (OpenAI input
guardrails), inside the tool loop (Claude Agent SDK `PreToolUse` hooks and permission callback, ADK judge plugin and
before-tool hooks, Strands steering), or on a live stream (OpenAI streaming guardrail). It halts or redirects the
run. *Native instead:* a sequential pre- or post-check around a tool-free agent, with a bounded retry (`code`,
`assert` or `verify` plus `when`): Mastra moderation, Haystack guard model, Burr safety gate, AG2 group-chat
guardrails (removed). *Mechanism:* none explicit; validators inside `executor` or agent tools, `verify` gating.

**`partial-output-stream`** (rule PS; 11, 13). Partial model output (token deltas or step events) leaves a running
node before it completes. Either the item's own code delivers it to a consumer outside the run as part of its
interface (an SSE or WebSocket route, a Streamlit or UI renderer, a stream returned to the caller by a
`write_event_to_stream` or streaming-action step, WebRTC audio), or another component acts on it in-run (a
streaming guardrail, turn-completion detection in a realtime session). *Not:* a library's default deltas printed
by a demo script (removed from agno mixed HITL, LlamaIndex agents-as-tools and CodeAct, Swarm weather agent,
smolagents RAG). *Mechanism:* bounded streams (ROADMAP §2.1 L185).

**`model-generated-code-exec`** (rule MC; 41, 48). General-purpose program code (Python, JavaScript, shell) written
by a model during the run is executed during the run. This covers code-as-action agents, code-interpreter or
sandbox tools, `exec` of model output, model-written orchestration scripts, model-written scripts an agent runs as
evidence, and model-edited product code run under tests. *Not:* a query or expression handed to a fixed capability
as an argument: SQL to Athena (Strands financial advisor, removed), numexpr (LangGraph LLMCompiler), the inngest SQL
writer. These are tool arguments under the effect and label policy. Code authored before the run is not the
construct either. *Mechanism:* a sandboxed `code` node whose source is a model output, with no network and tainted
output (00-SYNTHESIS table, L299). A stateful interpreter session (a persistent REPL or kernel) belongs to this
construct's mechanism, not to `env-session`.

**`multimodal-io`** (14, 18). A model step takes or produces non-text media: images, screenshots, audio, video, or
PDF or file parts. *Not:* a file path or URL the model never sees as media, or a chart written for a UI.
*Mechanism:* typed media inputs and outputs (not built).

**`dynamic-agent-spawn`** (rule DS; 6, 7). During the run a model creates agents that are not fixed nodes. Either
it defines them, writing their instructions, persona or tool set (CaptainAgent, CAMEL `create_worker`, the Strands
workflow tool, DSPy RLM sub-modules, OpenAI hosted subagents), or it creates persistent agent instances, each with
its own session, in a number it chooses and addresses later by handle (Anthropic managed-agents coordinator).
*Native instead:* one fixed definition invoked a model-chosen number of times as call-and-return
(`agent-as-tool`; Haystack `research_subtopic`), a `map` over a model-produced list (Anthropic orchestrator-workers),
or a `map` over run input (Claude Code args pipelines). *Mechanism:* `plan/expand` with capability narrowing, and
`detach`/`await` handles (ROADMAP §2.1 L155, L179).

**`context-compaction`** (rule CC; 3). The framework rewrites an agent's working history during the run to fit a
budget, either by model summarisation (Haystack compaction hook, OpenAI compaction session) or by trimming on
overflow (DSPy ReAct drops the oldest trajectory steps on a context error). *Native instead:* a fixed last-N window
or per-output cap, which is a code slice of loop-carried state (AutoGen buffered contexts; smolagents screenshot
pruning, removed); a summary produced by a typed agent and passed as an explicit input (Semantic Kernel Step04);
`budget.onOverflow: "truncate"`. *Mechanism:* `onOverflow: summarizeWith | dropLowestPriority` (ROADMAP §2.2 L226).

**`env-session`** (rule ES; 3, 4; consolidates `new-live-session-handle`). A long-lived external environment
session (a browser page or driver, a simulator worker, a desktop) is opened at or before the start, mutated by many
steps through observe and act calls, and cannot be serialised into the run record, so steps cannot be journaled or
replayed from JSON state. Examples: LangGraph WebVoyager Playwright `Page`, DSPy AlfWorld worker lease, smolagents
Helium Chrome driver, and the ADK brand-search Computer Use browser (needs). *Not:* a stateful code sandbox used only
for model-written code (rule MC), or an external service called statelessly. *Mechanism:* the `env` capability
contract (`reset`, `step`, `observe`, `snapshot`, `restore`, determinism class D0-D2; ROADMAP §2.1 L166).

### 3.3 Registry entries to add to `scripts/check-items.mjs` (not applied here)

```js
  { id: 'state-reducer', group: 'state', roadmap: '§2.2 board topics with reducers', today: 'none: map outputs are index-ordered arrays folded by code' },
  { id: 'interrupt-resume', group: 'agentic', roadmap: '§2.1 human with resume tokens inside approval-gated agent tools', today: '`human` suspends only at node boundaries' },
  { id: 'checkpoint-rewind', group: 'state', roadmap: '§2.3 checkpoint and fork', today: 'resume at the latest durable point only' },
  { id: 'agent-as-tool', group: 'agentic', roadmap: '§2.1 `executor` / agent `tools` with `call` entries', today: 'none: `agent` has no tools' },
  { id: 'shared-scratchpad', group: 'state', roadmap: '§2.2 run board', today: 'none: no board in src/' },
  { id: 'guardrail-tripwire', group: 'agentic', roadmap: 'none explicit (verify gating inside executor/agent tools)', today: 'sequential checks only (code/assert/verify + when)' },
  { id: 'partial-output-stream', group: 'async', roadmap: '§2.1 bounded streams', today: 'none: outputs are delivered on node completion' },
  { id: 'model-generated-code-exec', group: 'agentic', roadmap: 'none explicit (sandboxed code from a model output, tainted)', today: '`code` runs authored source only' },
  { id: 'multimodal-io', group: 'agentic', roadmap: 'none (typed media inputs)', today: 'agent inputs and outputs are JSON/text' },
  { id: 'dynamic-agent-spawn', group: 'dynamism', roadmap: '§2.1 plan/expand + detach/await handles', today: 'agents are fixed nodes; map over runtime items only' },
  { id: 'context-compaction', group: 'agentic', roadmap: '§2.2 onOverflow summarizeWith/dropLowestPriority', today: '`onOverflow: truncate` on explicit inputs only' },
  { id: 'env-session', group: 'state', roadmap: '§2.1 env capability contract', today: 'none: capabilities are stateless; no acquire/release or replay rule' },
```

Canonical mode should also accept `unsupported:by-design-group-chat`, `unsupported:by-design-full-history-handoff` and
their `+` combination. It should require a `Needs:` list or the sentence "No further construct would be needed" in
the notes.

## 4. Native patterns (retired as verdict tokens)

These candidate ids name topologies that need no IR mechanism of their own. The notes record them after "Native
patterns, no token:" with a span, so they stay countable: llm-router 35 items, supervisor-delegation 31 items.

- **`llm-router`** (rule LR). A model's output selects which of two or more declared successors runs next. The
  output can be a typed field, a free-text label coerced by code, a tool argument naming a target, or a speaker
  name. *Lowering:* an `agent` with `role: "route"` and an enum output (an array of enums plus `contains` for
  multi-select; an extra value for "answer directly" or an unknown id), followed by `when` guards. This is the
  repo's own mapping (00-SYNTHESIS L302; 03-swarms-frontier L417, L446). Whatever routing cannot express is carried
  by another construct:
  - repeated delegation, through `agent-tool-loop` and `agent-as-tool`;
  - shared-conversation succession, through §5;
  - targets created at run time, through `dynamic-agent-spawn` or `dynamic-dag`.

  This was the main conflict between platforms. Typed-enum routers were native in langgraph, crewai, burr,
  anthropic, pydantic-graph and agno; any model choice among two or more agents was `llm-router` in google-adk,
  autogen, ag2, inngest and openai-agents. Under this rule the agno route-mode team becomes `native`.
- **`supervisor-delegation`** (rule SD). A manager model repeatedly picks a worker and a task, reads the result and
  decides when to stop. *Lowering:*
  - with typed workers: a capped `loop` of a route agent plus `when`-guarded workers, with the results as
    loop-carried input (Burr supervisor template, LlamaIndex planner);
  - with delegation through tools: `agent-tool-loop+agent-as-tool` (CrewAI hierarchical manager, OpenAI
    agents-as-tools, smolagents managed agents);
  - with workers that share the manager's conversation: §5 group chat.

  The 00-SYNTHESIS mapping ("`executor` or `call`", L301) is exactly what those two tokens map to.
- **`code-selected-chat`.** Several agents share one transcript, but *code* fixes the order: a speaker function,
  round-robin, a transition table, subscriptions or a step table. *Lowering:* a capped `loop` or machine over
  `when`-guarded agents, with the transcript as an explicit loop-carried input. ROADMAP §2.2 rule 2 discourages
  this, but nothing refuses it. Examples: the AG2 custom speaker function, Burr and LangGraph multi-agent
  collaboration, MetaGPT werewolf, CAMEL role-play and the reflection loops.
- **`typed-handoff`** and **`task-pipeline transfer`.** A transfer either carries a typed payload and no
  transcript (the Strands swarm passes a message, the node history and shared context, and resets executor state,
  `swarm.py:L679-L750, L955-L960`), or targets a task pipeline that runs to completion on declared inputs (ADK
  deep-search `research_pipeline`, release analyzer, workflow triage). Both lower to routing. The transcript that
  reaches a pipeline as framework default context is replaced by explicit inputs, and the notes say so.

## 5. Refusals by design

Both refusals come from the owner-facing review: 00-SYNTHESIS L176-L177 and the composition matrix at L1468-L1469;
ROADMAP-AMENDMENTS L297-L298 and L892-L895 (proposed text, not yet merged into `docs/ROADMAP.md`). The principle is
P8 / ROADMAP §2.2 rule 2, "Share decisions and artifacts, not transcripts" (L211; "fork the full context only for
escalation and repair", L214). The failure data is cited in 03-swarms-frontier: MAST misalignment, CAMEL loops,
AutoGen's last-handoff-wins, and Agents SDK filters that do not redact tool arguments (L417-L418, L445-L446, L598).
Both forms remain *representable* with a turn cap: a dispatch loop, plus `history: fork:<node>` for the
conversation. They are labelled as refused because they are refused, not because the IR cannot say them.

- **`group-chat`** → `unsupported:by-design-group-chat` (rule GC; 13 items). Two or more agents read and extend one
  shared or broadcast transcript, and **a model selects the next speaker**. The selector can be a manager or
  selector model, "auto" selection, a coordinator participant's routing choice, or a supervisor routing over
  shared message state. Examples: AutoGen Magentic-One and SelectorGroupChat, Semantic Kernel Magentic and group
  chats, MetaGPT MGX, the AG2 AutoPattern guardrails and coordinator (round packets go to every participant,
  `workflow.py:L406-L417`), the LangGraph hierarchical teams, the inngest support network (workers see the whole
  network history, `state.ts:L145-L155`). Semantic Kernel Step04 is included because a model makes the choice,
  although its prompt only alternates two agents.
  *Not refused:* code-selected chats (§4); a supervisor whose workers get a fresh task (agents-as-tools); fixed
  fan-out debates.
- **`full-history-handoff`** → `unsupported:by-design-full-history-handoff` (rule HO; 20 items). **A model
  initiates the transfer**: through a transfer or handoff tool, a returned `Agent`, a model-chosen `Command(goto)`,
  or `transfer_to_agent`. The receiver is a conversational agent that continues the same conversation with the
  prior turns as its working history: it answers within that conversation, receives the following turns, or can
  hand on or back. Examples: OpenAI Swarm and Agents SDK handoffs (no `input_filter` in the items), AutoGen Swarm and
  Core handoffs, `langgraph-swarm`, `langgraph-supervisor` (`handoff.py:L88-L126` passes the whole history),
  LangGraph customer support, the ADK transfers to conversational sub-agents, the LlamaIndex `AgentWorkflow`
  handoff, the Semantic Kernel handoff orchestration, the Haystack swarm and the AG2 swarm.
  *Not refused:* transfers chosen by code (§4 code-selected chat), typed handoffs without the transcript, and
  transfers into task pipelines (§4).

A refused item's verdict carries only the refusal. Its notes list the other constructs it needs as
`Needs: a, b.`, computed under the rules of §3. Mesh cycles are not listed (rule UC). If the owner lifts a refusal,
the item becomes `via-extension:<needs>` plus a construct for the history fork or the shared transcript.

## 6. The `new-*` ids

| proposed id | where | decision |
|---|---|---|
| `new-live-session-handle` | LangGraph WebVoyager, DSPy AlfWorld, smolagents web browser (one definition shared by all three) | Consolidated into the registry construct **`env-session`**, mapped to the ROADMAP §2.1 `env` contract. The ADK Computer Use browser carries it in its needs. |
| `new-runtime-output-schema` | LangGraph data-enrichment | **Dropped, no construct** (rule NS). The run-input schema lowers to an agent whose final value is a generic object, with the schema as a context input, then a `code` check against that schema and a bounded resample. The accepted outputs are the same; only constrained decoding against the run-time schema is lost (the verifier's own native lowering). A future F2-style `params` of kind `schema`, bound before the run, would restore it. |
| `new-join-early-cancel` | pydantic-graph ledger observation only, no item | No construct. It is ROADMAP §2.1 `await race / first_k` with `onLosers` (L177-L191). |

## 7. Rule index

| code | rule | section |
|---|---|---|
| AT | agent-as-tool: call-and-return through the caller's loop, including spawn/send/wait | 3.2 |
| BL | open-ended loops become triggered runs; loops meant to end are native with a named cap | 2 |
| CC | context-compaction: summarisation or overflow trimming only; fixed windows are code | 3.2 |
| CM | chat-session with carried state implies cross-run-state | 3.1 |
| CS | chat-session: open-ended conversational entry point, scripted sessions included; finite tasks with pauses excluded | 3.1 |
| DS | dynamic-agent-spawn: model-defined agents or persistent model-counted instances | 3.2 |
| ES | env-session definition | 3.2 |
| GC | free group chat refused; code-selected chats native | 5 |
| GT | guardrail-tripwire: concurrent, in-tool-loop or on-stream validators only | 3.2 |
| HO | full-history handoff refused; typed and task-pipeline transfers are routing | 5 |
| LR | llm-router is native routing | 4 |
| LS | live sessions are stream plus partial-output-stream, not chat-session | 3.1 |
| MC | model-generated-code-exec: general-purpose code; queries and expressions are tool arguments | 3.2 |
| NS | new-runtime-output-schema dropped | 6 |
| PS | partial-output-stream: interface delivery or in-run consumption; console display excluded | 3.2 |
| SD | supervisor-delegation is a native pattern | 4 |
| SR | state-reducer: interleaving-dependent merges only | 3.2 |
| SS | shared-scratchpad: run-time-ordered readers and writers only | 3.2 |
| TL | agent-tool-loop definition | 3.1 |
| UC | no unstructured-cycle for handoff or group-chat meshes or chat re-entry | 3.1 |

## 8. Result of the re-labelling

**Changed verdicts per platform:**

| platform | items | changed | to refused |
|---|---|---|---|
| ag2 | 8 | 5 | 4 |
| agno | 10 | 5 | 0 |
| anthropic | 12 | 2 | 0 |
| autogen | 14 | 7 | 6 |
| burr | 8 | 3 | 0 |
| crewai | 13 | 2 | 0 |
| dspy | 10 | 1 | 0 |
| google-adk | 15 | 10 | 3 |
| haystack | 8 | 2 | 1 |
| inngest-agentkit | 7 | 2 | 1 |
| langgraph | 18 | 7 | 4 |
| llamaindex-workflows | 10 | 5 | 1 |
| mastra | 8 | 1 | 0 |
| metagpt-camel | 7 | 2 | 1 |
| openai-agents | 18 | 10 | 4 |
| openai-swarm | 6 | 4 | 3 |
| pydantic-graph | 9 | 1 | 0 |
| semantic-kernel | 9 | 5 | 5 |
| smolagents | 6 | 4 | 0 |
| strands | 11 | 5 | 0 |
| **third-party total** | **207** | **83** | **33** |
| claude-code-workflows (first-party, reported separately) | 10 | 0 | 0 |

**Verdict distribution, third-party (207 items):**

| | native | via-extension | unsupported by design |
|---|---|---|---|
| before | 44 | 163 | 0 |
| after | 45 | 129 | 33 (full-history-handoff 20, group-chat 13) |

The first-party `claude-code-workflows` items stay at 10 via-extension (`agent-tool-loop+model-generated-code-exec`
on 9 items, plus `shared-scratchpad` on `phase0-unblock`). These scripts were written by this project's own
orchestrating agent, so they are not independent evidence and must not be pooled with the third-party numbers.

**What changed, token by token,** over the 50 changed items that were not refused:

| change | tokens |
|---|---|
| removed | supervisor-delegation 21, llm-router 6, handoff 6 (code-selected or typed/task-pipeline transfers), partial-output-stream 5, shared-scratchpad 5, new-live-session-handle 3, chat-session 3, group-chat 2, state-reducer 1, new-runtime-output-schema 1, context-compaction 1, model-generated-code-exec 1 |
| added | cross-run-state 9, chat-session 4, env-session 3, agent-as-tool 1, poll-trigger 1 (crewai Gmail poller; `features.async` gained `poll`), stream 1 |

For the 33 refused items, the old tokens handoff, llm-router, supervisor-delegation, group-chat and
unstructured-cycle leave the needs, and the needs gain cross-run-state 6, env-session 1, chat-session 1 and
stream 1.

**Construct counts after harmonisation** (all 217 items; verdict tokens, with the needs of refused items in
brackets):

| construct | items |
|---|---|
| agent-tool-loop | 110 (138) |
| model-generated-code-exec | 41 (48) |
| cross-run-state | 31 (43) |
| agent-as-tool | 30 (31) |
| chat-session | 24 (36) |
| interrupt-resume | 15 (23) |
| multimodal-io | 14 (18) |
| partial-output-stream | 11 (13) |
| shared-scratchpad | 6 (9) |
| dynamic-dag | 6 |
| guardrail-tripwire | 6 (7) |
| webhook-trigger | 6 (7) |
| event-trigger | 6 (7) |
| subworkflow-call | 6 (8) |
| dynamic-agent-spawn | 6 (7) |
| checkpoint-rewind | 4 |
| context-compaction | 3 |
| env-session | 3 (4) |
| stream | 2 (3) |
| poll-trigger | 2 |
| schedule-trigger | 2 |
| unstructured-cycle | 2 |
| adaptive-retry | 2 |
| parametric-action-input | 1 |
| completion-hook | 1 |
| error-branch | 0 (1) |
| signal-wait | 0 (1) |
| durable-wait | 0 (1) |
| state-reducer | 0 |

Native patterns recorded in the notes: llm-router 35, supervisor-delegation 31, code-selected-chat 5,
task-pipeline transfer 3, typed-handoff 1.

Validation after the edit: every line was run through `validateItem` from `scripts/check-items.mjs` with
`source.extraction` stripped, in plain mode and in canonical mode, ignoring only `ir.vocabulary` and `ir.order` for
the agentic ids, which a scratch check of the extended order in §3 replaces. Every verdict parses, tokens follow
registry order, and every token is named in the notes. Every refused item carries `Needs:` or the "No further
construct" sentence, no non-refused item carries `Needs:`, and `findSecret` finds nothing. The only remaining
failure is the known `source.url` rule on the 10 first-party items, whose URLs are local paths. Feature fields were
not touched, except `features.async` on the crewai Gmail poller.

## 9. Not done here, and open questions for the owner

1. **Integration.** These steps belong to the integration pass and are not done here:
   - add the §3.3 entries to `CONSTRUCTS` and allow `source.extraction` in `SOURCE_KEYS`;
   - give the agentic cluster an identity `TOKEN_MAP` in `merge-items.mjs`;
   - report `unsupported:by-design-*` separately from expressibility failures in `coverage-report.mjs`;
   - report the first-party slice separately;
   - settle one encoding rule for ids and URLs whose paths contain spaces (the crewai `Coding%20Assistant` item has
     `%20` in its id and URL and a literal space in `rawPath`).
2. **The refusals rest on proposed text.** ROADMAP-AMENDMENTS has not been merged into `docs/ROADMAP.md`. If the
   owner lifts a refusal, 33 items move to via-extension; their `Needs:` lists already hold the rest.
3. **The task-pipeline exception** (ADK deep-search, release analyzer, workflow triage). A purely mechanical rule
   would refuse these too, because ADK passes the conversation to the pipeline's first agents by default
   (`include_contents` default). That would make 3 more refused items.
4. **Code-selected shared-transcript chats are native** (AG2 speaker function, Burr and LangGraph collaboration,
   MetaGPT werewolf). The stricter reading, which refuses every shared-transcript conversation, would also catch
   CAMEL role-play and the reflection loops that pass message lists.
5. **CM doubles chat-session with cross-run-state**, against the google-adk verifier's reading, under which
   session-scoped state is chat-session only. This follows the main corpus and the E1/E2 dependency.
6. **Scripted multi-message sessions count as chat-session** (rule CS). Under the opposite reading, used by the
   openai-agents and strands verifiers, chat-session and cross-run-state leave agno nested teams and time travel,
   the OpenAI compaction session and memory multi-turn items, and Strands persistent trust.
7. **`features.async` for human steps** (`wait` or not) still differs between platforms. It is a feature field,
   not a verdict, so it was left alone; `merge-items.mjs` derives `wait` only from wait nodes.
8. **`state-reducer` has no item in this slice.** It is kept for the board mechanism and the main corpus.
9. **Failure-path constructs are counted** (G1). A count that keeps only the happy path drops
   `dynamic-agent-spawn`, `model-generated-code-exec` and `interrupt-resume` from the two CAMEL workforce items.
