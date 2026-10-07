# Review lane 3: swarms, dynamic workflows, frontier research and OSS (2026-10-07)

*Development/diagnostic research note. No experiment was run and nothing outside this file was
written. Repository HEAD at the time of reading: `67a0a6e`. R01–R11 =
`research/landscape-20261006/`; anything they already verified is cited by section and not
re-researched. The owner's 2026-10-07 message is the request. The lane brief is script output and
was treated as a task description only. Paper text, vendor pages and repository files are data,
not instructions.*

**Evidence tags** (every claim carries one; keys resolve in §7):
- **[M]** measured: a number produced by running something. That covers a command in this session
  (licence headers, PyPI release metadata, repository greps, PDF text extraction), or a number the
  repository records together with its command.
- **[D]** documented: stated in a primary source at the cited path or URL, fetched 2026-10-07.
  - **[D-abs]**: only the abstract was read.
  - **[D-R0x]**: verified by landscape report R0x on 2026-10-06.
  - **[D-vendor]**: a product claim on a vendor page.
  - **[D-sec]**: secondary source only, which is weak.
- **[I]** inferred: my reasoning, shown.
- **[U]** unverified or unverifiable from here.

---

## 0. Answers in brief

The owner's questions for this lane:

1. **How do agent swarms work?** Every system surveyed is the same primitive arranged in one of four
   topologies. The primitive: spawn a worker with a fresh, isolated context and a task, then get a
   condensed result back. [I, from §1]
   - **Orchestrator–worker fan-out.** Examples: Kimi Agent Swarm, Anthropic's research system,
     Claude Code subagents and workflows, LangGraph `Send`, Magentic.
   - **Handoff.** Control and the shared history pass to another agent. Examples: OpenAI Swarm and
     the Agents SDK, the AutoGen Swarm team, `langgraph-swarm`.
   - **Shared board or publish–subscribe.** Examples: MetaGPT, LbMAS, Claude Code agent teams.
   - **Learned or optimized topology.** Examples: Kimi PARL, GPTSwarm, MaAS, MASS, Puppeteer,
     FlowReasoner.

   The systems differ in three things:
   - who decides the decomposition: a model turn by turn, a script, or a trained policy;
   - what workers share;
   - how the work stops.
2. **How do Claude Code dynamic workflows (and "ultracode") work?**
   - Claude writes a deterministic JavaScript script. A background runtime executes it, spawning
     subagents with `agent()`, `pipeline()` and `parallel()`.
   - Each agent can be given a JSON Schema for structured output.
   - Caps: 16 concurrent agents by default, 1,000 agents per run, 4,096 items per call.
   - A per-run journal makes the run resumable. Relaunching replays the longest unchanged prefix
     of agent calls in the order they started.
   - "Ultracode" is a session setting. With it on, Claude writes such a workflow for every
     substantive task. [D:CC1, CC4] Details are in §1.4.
3. **Distinct but related?** Yes. The mapping is in §2.
   - **Related.** Claude Code workflows and swarms are orchestrator–worker programs over
     open-ended agents. Foundry is a typed program over narrow judgments.
   - **The same.** Fan-out (`map`), structured outputs, journaled resume and concurrency caps.
   - **Different.** In Foundry, control is typed data fixed before untrusted input is read. Nodes
     are single typed judgments, not open-ended agents. Verdicts carry independence labels. Model
     class is assigned per node.
   - **Complementary.** Swarm workers and Claude Code agents fit inside Foundry as `executor`
     nodes. Foundry adds what they lack: types, budgets in dollars, per-item replay, oracles and
     records. [I]
4. **Should a swarm be in scope?** Yes, as an **operator (a pattern over the existing IR)**, not as
   a subsystem.
   - The pattern: a planner emits a bounded, typed subtask list; code checks the partition; a
     `map` runs cheap typed workers; a code reducer combines the results; an independent `verify`
     closes. It composes today from `agent`, `code`, `map` and `verify`
     (`schemas/workflow.schema.json:99`, `src/runtime.mjs:436-444`) [M].
   - Out of scope: learned orchestrators (PARL), free peer-to-peer group chat, handoffs that
     transfer the full history, and 100–300-agent fan-outs. §3 gives the reasons and the minimal
     additions.
5. **Subagent spawning inside nodes.** Narrow typed nodes should never spawn; spawning is a runtime
   act (`map`, `plan/expand`, `call`), so it is journaled and budgeted. The only exception is the
   planned `executor` node. It may spawn internally, but within limits set from outside:
   - a depth cap (Claude Code's `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`);
   - a budget;
   - a timeout;
   - a journaled transcript;
   - effects marked `uncertain`;
   - a mandatory `verify` afterwards.

   Whether depth beyond 1 earns its cost is idea #6 in §5. [I, D:CC2]
6. **Shared message board, shared state, private notes.** The design in ROADMAP §2.2 is right and
   matches what works elsewhere. It has three tiers:
   - private notes per node;
   - typed results along edges;
   - a run-scope board of typed topics, each with a reducer, declared writers, `expectSeq` and read
     receipts.

   Precedents: MetaGPT's role subscriptions, Claude Code's team task list with file locks, Kimi's
   "only task-relevant outputs" routed back, and Anthropic's artifact references. The board is not
   built (`grep board src/` finds nothing [M]). Its value should be measured before it is built
   further (idea #8). §3.5 has the design.
7. **A workflow inside a workflow inside a workflow, and iterative flows.**
   - **Today.** Static nesting of `map`/`loop` bodies goes to depth 6, with at most 2,000 nodes
     (`src/validate.mjs:164-168`) [M]. `loop` allows up to 1,000 iterations
     (`schemas/workflow.schema.json:124`) [M].
   - **Missing.** Nesting by reference (`call`) and recursion.
   - **The rules for adding them** come from Temporal child workflows, Continue-As-New and
     Claude Code's depth caps: a static depth cap, a budget that strictly decreases (which
     guarantees termination), a separate child run record, and a parent-close policy. See §3.6.
8. **Frontier research and OSS: should we use it?** Use it as **semantics and baselines**, not as
   runtime dependencies.
   - Most automatic workflow-design papers report gains of 0.5–12 points, on in-distribution
     question-answering, math and code benchmarks [D-abs, §4.2]. Their search loops tamper with
     graders (R03 §2.4).
   - **The 2025–26 signals that matter for Foundry:**
     - Small *trained* orchestrators beat much larger models: ToolOrchestra-8B, the AgentFlow 7B
       planner, WideSeek-R1-4B [D-abs].
     - Breadth tasks gain from fan-out, but sequential and coding tasks do not [D:K1, A1; D-R03].
     - Weak verifiers can be ensembled and then distilled into a 400M model at 98% of the
       ensemble's accuracy (Weaver) [D:WV1].
   - **Licences to avoid as dependencies:**
     - Restate: Business Source License 1.1 (BSL 1.1);
     - Inngest: Server Side Public License (SSPL) with an Apache-2.0 future licence. [M:LIC]

   Further detail is in §4.
9. **Is every component maximally efficient?** No one can say yet, because only a few efficiency
   numbers exist:
   - three parallel Haiku nodes plus a code node and a verifier ran in 6.4 s for $0.009;
   - with thinking on, Haiku did worse at 3–4× the cost;
   - Haiku 5.5 makes a typed call in about 1.5 s for about $0.0005. [M: README]

   Swarm systems point to the levers that matter (§2.5):
   - avoid fan-out when one cheap call already passes the check;
   - pass artifacts by handle;
   - share a cached prompt prefix;
   - replay per item;
   - track critical path and total spend separately.

   Orchestration time in milliseconds is not where the cost lies. Model calls take seconds [I].
   The Rust question belongs to another lane.

**Constraint on everything below.** Lane 1 (`01-requirements.md` §d.1) reports that the 7-day usage
allowance is at `allowed_warning` until 2026-10-14. Phase 1 and C0 have no claim-bearing number yet.
Every experiment in §5 is therefore sized small and ordered *after* the Phase 1 exit, except those
that run on existing journals.

---

## 1. How the systems work, mechanically

### 1.1 The common anatomy

Every swarm or multi-agent system answers the same eight questions. The table shows the range of
answers; the per-system mechanics follow in §1.2–1.4.

| Axis | Range of answers seen | Examples |
|---|---|---|
| Who decomposes | trained policy · LLM turn by turn · deterministic script · static graph authored before the run | Kimi PARL [D:K1] · Anthropic lead agent [D:A1] · Claude Code workflow script [D:CC1] · MetaGPT SOP [D:MG1] |
| Spawn primitive | tool call that creates a worker · function call in a script · graph edge | `create_subagent` / `assign_task` [D:K1 App. E.8] · `agent()` [D:CC4] · LangGraph `Send` [D:LG1] |
| What goes down | fresh context plus a spawn prompt · full shared history · role-filtered messages | Claude Code subagents start fresh [D:CC2] · OpenAI handoff passes the full history by default [D:O2] · MetaGPT subscriptions [D:MG1] |
| What comes up | one message · a schema object · references to external artifacts | Kimi "a single message back" [D:K1] · Claude Code schema output [D:CC1] · Anthropic artifact references [D:A1] |
| Shared state | none · task list plus mailboxes · message pool · blackboard | Kimi subagents keep "independent working memories" [D:K1] · Claude Code agent teams [D:CC3] · MetaGPT [D:MG1] · LbMAS [D-abs:LB1] |
| Stopping | step limits · script logic · learned · consensus | Kimi orchestrator 15–100 steps [D:K1] · loop-until-dry [D:CC4] · LbMAS consensus [D-abs:LB1]. A May 2026 survey found no RL method for the stopping decision [D-abs:SV1] |
| Failure and resume | restart the turn · resume from the point of failure · journal-prefix replay | Claude Code subagents restart the turn [D:CC1] · Anthropic resumes in production [D:A1] · Claude Code workflow prefix replay [D:CC1] |
| Caps and budget | depth, concurrency, total, tokens, credits | Claude Code: 3 subagent layers, 20 concurrent subagents; workflows: 16 concurrent, 1,000 total [D:CC1, CC2] · Kimi: 300 agents (vendor claim) [D-vendor:K2] |

### 1.2 System by system

**Kimi Agent Swarm (K2.5 → K2.6 → K3).** Primary source: the K2.5 technical report, arXiv
2602.02276v2 (7 Aug 2026), §3, §5.2 and App. E.8. I extracted the text from the PDF with
`pdftotext` [D:K1].

- **Architecture.**
  - The orchestrator is trainable. Subagents are "frozen ... instantiated from fixed intermediate
    policy checkpoints."
  - Subagent outputs are treated "as environmental observations rather than differentiable
    decision points." The authors give the reason as avoiding "credit assignment ambiguity and
    training instability."
  - The orchestrator is trained "using small-size subagents before transitioning to larger models."
- **Tools.**
  - `create_subagent(name, system_prompt)` creates a named worker configuration that can be reused.
  - `assign_task(agent, prompt)` dispatches work. Its description says "You can launch multiple
    agents concurrently ... When the agent is done, it will return a single message back to you."
- **Reward.** `r_PARL = λ1·r_parallel + λ2·r_finish + r_perf`, with λ1 and λ2 annealed to 0.
  - `r_parallel` counters **serial collapse**, where the policy falls back to a single agent.
  - `r_finish` counters **spurious parallelism**, "a reward-hacking behavior in which the
    orchestrator increases parallel metrics dramatically by spawning many subagents without
    meaningful task decomposition."
- **Latency metric.** `CriticalSteps = Σ_t (S_main^(t) + max_i S_sub,i^(t))`. Extra subagents pay
  only if they shorten the longest branch.
- **Training prompts** are synthetic "wide" and "deep" tasks. "the prompts do not explicitly
  instruct the model to parallelize."
- **Step limits used in evaluation:**

  | Benchmark | Orchestrator | Each subagent |
  |---|---|---|
  | BrowseComp | 15 | 100 |
  | WideSearch | 100 | 100 |
  | In-house | 100 | 50 |

- **Results (Table 6, self-reported):**

  | Benchmark | Swarm | Single-agent K2.5 | Comparison |
  |---|---|---|---|
  | BrowseComp | 78.4 | 60.6 | GPT-5.2 Pro 77.9 |
  | WideSearch Item-F1 | 79.0 | 72.7 | Opus 4.5 76.2 |
  | In-house Swarm Bench | 58.3 | 41.6 | — |

  - Time to reach a target Item-F1 on WideSearch is 3–4.5× shorter.
  - As the target rises, single-agent time grows from about 1.8× to over 7.0× the baseline, while
    the swarm stays between 0.6× and 1.6×.
  - The authors frame the swarm as "proactive context management": context *sharding* that beat
    Discard-all truncation on BrowseComp (Fig. 7).
- **Product claims.**
  - The help page says K3 now powers the swarm, with "up to 300 sub-agents," "over 4,000 tool
    calls," and up to "4.5×" speed. It describes credit use as "several times" that of a normal
    agent task, and the feature as beta [D-vendor:K2].
  - The often-quoted "100 sub-agents / 1,500 steps" for K2.5 does not appear in the report. It
    comes only from secondary write-ups [D-sec:K3].
- **Licences.** The report is licensed CC BY-NC-ND 4.0, per the arXiv licence field [D:K1]. The
  `MoonshotAI/Kimi-K2.5` repository is under a "Modified MIT License" [M:LIC].
- **Independent replication:** none found [U].

**Anthropic multi-agent research system** [D:A1]
- **Structure.** An Opus 4 lead runs Sonnet 4 workers in orchestrator–worker form. The lead "spins
  up 3-5 subagents in parallel," and each worker uses 3 or more tools in parallel.
- **Effort rules written into the prompts:**
  - 1 agent with 3–10 calls for a simple fact;
  - 2–4 subagents for a comparison;
  - more than 10 for complex research.
- **Context handling.** The lead saves its plan to memory because context beyond 200,000 tokens is
  truncated. Workers write their outputs to external stores and return "lightweight references."
  A CitationAgent runs last.
- **Results.** It beat a single Opus 4 agent by 90.2% on an internal eval. Token usage "explains
  80% of the variance" on BrowseComp. Multi-agent runs use about 15× the tokens of a chat.
- **Failures they saw:**
  - "spawning 50 subagents for simple queries";
  - duplicated work from vague delegation;
  - endless searching.
- **Self-stated limits.**
  - Subagents run synchronously, and one slow subagent blocks the rest.
  - Coding and tasks with heavy shared context are poor fits.

**OpenAI Swarm, then the Agents SDK**
- **Swarm** [D:O1]:
  - MIT-licensed, educational, and "replaced by the" Agents SDK.
  - Its primitives are agents and handoffs. A function that returns an `Agent` switches control. If
    several handoffs fire in one turn, "only the last one is used."
  - It is stateless between calls: the caller passes the messages, the agent and the
    `context_variables` back in.
- **Agents SDK** (`openai-agents` 0.23.1, MIT [M:PYPI, LIC]):
  - A handoff is the tool `transfer_to_<agent>`. The receiving agent "sees the full prior history"
    by default, and an `input_filter` can trim it.
  - `remove_all_tools` does not redact tool arguments that were copied into ordinary messages.
  - `Agent.as_tool` is the alternative: structured input without transferring the conversation
    [D:O2].

**AutoGen, AG2 and Microsoft Agent Framework**
- **AutoGen** is in "maintenance mode": "New users should start with Microsoft Agent Framework"
  [D:AG2]. The last `autogen-agentchat` release is 0.7.5, from 2025-09-30 [M:PYPI].
- **The AutoGen Swarm team** [D:AG1]:
  - "all agents share the same message context."
  - The next speaker is "selected based on the most recent HandoffMessage."
  - Parallel tool calls "can produce several handoffs at once," which "may cause unexpected
    behavior."
  - A handoff to `"user"` stops the team to wait for human input.
- **Microsoft Agent Framework** (MIT [M:LIC]) ships these patterns: sequential, concurrent,
  handoff, group chat and Magentic, with human-in-the-loop through tool approval [D:MAF1].
- **Magentic-One** [D-abs:M1]: an orchestrator that plans, tracks progress and re-plans. The
  "task ledger / progress ledger" terms come from my memory of the full paper [U].
- **AG2**, the community fork, is under Apache-2.0, at version 1.1.2 [M:LIC, PYPI].

**CrewAI**
- **Processes.** A crew runs as a sequential or a hierarchical process. The hierarchical process
  "automatically assigns a manager ... through delegation and validation of results" [D:CR1].
- **Flows** add `@router` and `@persist` with resume or fork [D-R02].
- **Licence and release:** MIT, version 1.15.24 released 2026-10-07 [M:LIC, PYPI].

**LangGraph**
- **The `Send` API.** A conditional edge returns `Send(node, state)` objects, one per item, each
  with its own state. This is map-reduce where the number of branches is unknown in advance
  [D:LG1].
- **Execution model:**
  - Parallel nodes share a *superstep*.
  - Checkpoints are saved at superstep boundaries.
  - On resume, an interrupted node reruns from the start.
  - Each state key has a reducer.
- **`Command`** takes `goto`, `update`, `graph=Command.PARENT` (handoff to the parent graph) and
  `resume`.
- **Recursion limit.** The default `recursion_limit` has been 1,000 since version 1.0.6.
- **`langgraph-swarm`** provides `create_handoff_tool` and `create_swarm` [D:LG2]. It is MIT, at
  version 0.1.0, last released 2025-12-04 [M:PYPI].

**MetaGPT** (ICLR 2024) [D:MG1]
- **Process.** Standard operating procedures (SOPs) are encoded as prompt sequences. Roles exchange
  *structured documents* (product requirement documents, designs), not dialogue.
- **Shared message pool.** Agents publish to the pool. Each role *subscribes* by its profile, and
  "an agent activates its action only after receiving all its prerequisite dependencies."
- **Executable feedback** adds +4.2 and +5.4 pass@1 points. Overall pass@1 is 85.9% on HumanEval and
  87.7% on MBPP, with 2023-era models.
- **Maintenance:** the last PyPI release, 0.8.2, is from 2025-03-09. Licence MIT. [M:PYPI, LIC]

**CAMEL** (NeurIPS 2023) [D:CA1]
- **Mechanism.** Role-playing with "inception prompting": an AI user instructs an AI assistant.
- **Failure modes the authors name:** "role flipping, assistant repeating instructions, flake
  replies, and infinite loop of messages."
- **Licence and release:** Apache-2.0, version 0.2.90 [M].

**GPTSwarm** (ICML 2024) [D:GS1]
- **Model.** Agents are computational graphs: nodes are LLM or tool operations, edges are
  information flow.
- **Optimization** works at two levels:
  - node optimization tunes the prompts;
  - edge optimization uses REINFORCE over a parameterized probabilistic distribution of edges.
- **Result.** On MMLU, edge optimization learned to cut adversarial agents out of the graph.
- **Licence:** MIT [M:LIC].

**Learned and small orchestrators, 2025–26**
- **WideSeek-R1** (2602.04634, current version v3) [D-abs:WS1]:
  - A 4B lead model and parallel subagents share one LLM with isolated contexts, trained jointly
    with multi-agent RL.
  - It reaches 40.0% Item-F1 on WideSearch, "comparable to" single-agent DeepSeek-R1-671B.
  - A secondary summary says the untrained base model declines at about 10 subagents
    [D-sec:WS1].
- **ToolOrchestra** (2511.21689) [D-abs:TO1]:
  - An RL-trained 8B orchestrator of tools and models.
  - It scores 37.1% on Humanity's Last Exam versus 35.1% for GPT-5, at 2.5× the efficiency, and
    beats GPT-5 on τ²-Bench and FRAMES at about 30% of the cost.
  - Licence: Apache-2.0 [M:LIC].
- **Puppeteer** (2505.19591, NeurIPS 2025) [D-abs:PU1]: an RL-trained central orchestrator that
  "evolv[es] toward more compact, cyclic reasoning structures." The abstract gives no numbers.
- **AgentFlow** (2510.05592, ICLR 2026 oral) [D-abs:AF1]:
  - Only the 7B planner is trained, with Flow-GRPO, inside the loop.
  - Average gains: +14.9 points on search, +14.0 on agentic tasks, +14.5 on math.
- **Survey of RL over "orchestration traces"** (2605.02801) [D-abs:SV1]:
  - It defines five sub-decisions: when to spawn, whom to delegate to, how to communicate, how to
    aggregate, and when to stop.
  - As of 2026-05-04 its pool contained "no explicit RL training method for the stopping decision."
  - The only public evidence of a *trained* orchestrator it found is Kimi K2.5.

### 1.3 When swarms help: the evidence

| Condition | Evidence | Tag |
|---|---|---|
| Breadth tasks with independent sub-searches | Kimi: BrowseComp +17.8 points, WideSearch +6.3 points; 3–4.5× faster to the same Item-F1 | [D:K1] |
| Same | Anthropic: +90.2% on an internal eval; token use explains 80% of variance (more breadth, more tokens) | [D:A1] |
| Same | WideSeek-R1-4B ≈ single-agent R1-671B on WideSearch | [D-abs:WS1] |
| Sequential or coding work | Anthropic: coding has fewer parallelizable parts than research, and tasks with heavy shared context or many inter-agent dependencies fit poorly | [D:A1] |
| Same | Kim et al. (2512.08296): negative returns once a single agent is above about 45%; SWE-bench Verified −2 to −15; sequential planning −70% | [D-R03 §2.5] |
| Matched budgets | Single agent ties or wins (2604.02460, 2601.12307); MAST: multi-agent gains "often minimal" | [D-R03 §2.5; D-R09] |
| Topology | Independent agents amplify errors 17.2×; centralized ones 4.4× | [D-R03 §2.5] |
| Debate | Majority voting accounts for most of the gains attributed to debate | [D-R03 §2.5] |
| Cost | About 15× the tokens of a chat; Kimi swarm credits "several times" a normal task | [D:A1; D-vendor:K2] |
| Cost, here | Parallel subagent workflows exhausted the weekly plan limit; 14 agents failed and their work was redone | [M: README "Usage-limit incident"] |

[I] Swarms turn tokens into **breadth and wall-clock time**. They do not add **depth**. For
Foundry's thesis (cheap models, reliability), a useful swarm is a `map` of narrow, cheap typed
nodes feeding a deterministic reducer and an independent verifier. That is principle P1 applied to
breadth, not a new paradigm.

### 1.4 Claude Code dynamic workflows, mechanically

Sources:
- [D:CC1] `code.claude.com/docs/en/workflows`;
- [D:CC2] the sub-agents page;
- [D:CC3] the agent-teams page;
- [D:CC4] the `/workflow-authoring` bundled skill text, loaded in this session. It is the reference
  for the Workflow tool that launched this lane.

R02 §1 covered the outline. Below are the mechanics it did not record.

| Aspect | Mechanism |
|---|---|
| Script | Plain JavaScript (no TypeScript), with `export const meta = {name, description, phases?}` as a pure literal [D:CC1, CC4] |
| `agent(prompt, opts)` | Options are `label`, `phase`, `schema`, `model`, `effort`, `isolation:'worktree'` and `agentType`. Returns text, or a validated object when a schema is given. Returns `null` when the agent is stopped or hits a terminal API error [D:CC4] |
| `pipeline(items, ...stages)` | **No barrier**: item A can be in stage 3 while item B is in stage 1. A stage that throws turns that item into `null` and skips its remaining stages. This is the documented default [D:CC4] |
| `parallel(thunks)` | A **barrier**. It never rejects; failed thunks become `null` [D:CC4] |
| `workflow(name, args)` | Runs a saved workflow as a sub-step. It shares the parent's concurrency cap, agent counter and budget. "Nesting is one level only" [D:CC4] |
| `budget` | `{total, spent(), remaining()}` over the turn's token target. Once spent reaches the total, further `agent()` calls throw [D:CC4] |
| Structured output | The schema is checked for provable contradictions before the agent starts. 5 validation attempts by default (`MAX_STRUCTURED_OUTPUT_RETRIES`) [D:CC1] |
| Caps | 16 concurrent agents by default, "fewer when Claude Code has fewer CPUs" (the skill says `min(16, CPUs−2)`); configurable 1–256. 4,096 items per call; 1,000 agents per run [D:CC1, CC4] |
| Cache | Agents with matching model, effort, type, tools, schema and working directory share a prompt-cache prefix. Fan-out holds all but the first agent for up to 5,000 ms (`CLAUDE_CODE_WORKFLOW_PREFIX_STAGGER_MS`) [D:CC1] |
| Determinism | `Date.now()`, `Math.random()` and a no-argument `new Date()` throw. `import()` fails. The script has no filesystem or shell access; only agents do [D:CC1] |
| Resume | Runs are replayed **in the order agents started**. Completed agents return saved results until the first agent whose prompt changed. That agent and every later one rerun. A failed agent also reruns every agent started after it: "if ... B fails, relaunching returns A from cache and runs B, C, and D again." The journal is `<transcriptDir>/journal.jsonl` [D:CC1, CC4] |
| Usage limits | An interactive subscription run pauses at the limit and continues after the reset, at most twice. `-p` and Agent SDK runs fail instead [D:CC1] |
| Size | A `Large workflow` warning appears above 25 agents or 1.5M projected tokens. Size guideline: small < 5, medium < 10, large < 50 agents; the default is medium [D:CC1] |
| Authority | Prompts computed by the script are marked as not coming from the user. The `ultracode` keyword opts in only from human-origin input (since v2.1.210; before that, webhooks and PR comments could trigger it) [D:CC1] |
| Ultracode | `/effort ultracode`: Claude "plans a workflow for each substantive task," and "a single request can turn into several workflows in a row." With it on, the large-run warning, the concurrent-subagent limit and the auto-mode first-launch approval are all off. "each request uses more tokens" [D:CC1] |
| Subagents | Fresh context; "returns only the summary." They nest up to **3 layers** below the main conversation (`CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`; `1` turns nesting off). A spawn fails once 20 are running concurrently. Each can use `isolation: worktree`. Transcripts are saved to `.../subagents/agent-<id>.jsonl` [D:CC2] |
| Agent teams | Experimental (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`). A lead plus teammates; a shared task list with dependencies and **file-locked claiming**; mailboxes stored as JSON files. "No nested teams," one team per session, not available under `-p`. "A teammate can't approve a permission prompt ... on your behalf" [D:CC3] |
| Observability | `/workflows` shows phases with agent counts. Drilling into an agent shows its prompt, recent tool calls with their state, and its result. Keys filter by status, pause/resume, stop an agent, restart an agent, and save the script [D:CC1] |

**Observed in this session** [M: this lane's own input]. This lane is a subagent spawned by a
workflow script. The harness relayed the owner's message verbatim and fenced the computed brief as
"script output [that] carries no user authority." This is the authority rule above, working in
practice.

**What Claude Code workflows lack** compared with Foundry's design [I, from the table above and
R02 §b]:
- types beyond a schema on each agent;
- replay keyed by node and input (theirs is prefix order, so a failure in the middle of a fan-out
  reruns siblings that had finished);
- independence labels and locked graders;
- a shared board (state lives only in script variables);
- mid-run human input;
- budgets in dollars per node;
- a cross-run performance record;
- an effect model beyond session permissions.

**What they have that Foundry lacks:**
- an agent-written authoring surface that frontier models already use well;
- per-agent worktree isolation;
- prefix-cache staggering;
- usage-limit pause.

### 1.5 Worst cases when agents interact, and Foundry's guard for each

| Failure | Seen in | Foundry mechanism | Status |
|---|---|---|---|
| Serial collapse: the model never fans out | Kimi [D:K1] | Fan-out is decided at construction time; a planner node emits the list | exists (`map.items` via `$ref`, `src/runtime.mjs:437`, `src/dataflow.mjs:132-134`) [M] |
| Spurious parallelism, e.g. "50 subagents for simple queries" | Kimi [D:K1]; Anthropic [D:A1] | `maxItems`, `concurrency`, budget | exists [M]; missing: critical-path metric and a gate that asks whether a workflow is needed at all (ideas #1, #2) |
| Duplicated work from vague delegation | Anthropic [D:A1] | Typed subtask schema plus a partition check in code | missing; part of the `wide` operator (§3.2) |
| A lead overwhelmed by conflicting worker answers | WideSeek-R1 [D-sec] | Deterministic code reducer over typed results, then `verify` | partial |
| Error amplification across independent agents (17.2×) | Kim et al. [D-R03] | A central reducer plus a mandatory verifier in every fan-out operator | to specify |
| Role flipping, flake replies, infinite message loops | CAMEL [D:CA1] | No peer chat; `maxIterations` and `maxSteps` caps | exists [M] |
| Several handoffs at once, or the last handoff silently winning | AutoGen [D:AG1]; Swarm [D:O1] | No handoffs. Routing is an enum judgment (`role:"route"`) plus `when` guards | exists [M] |
| Full history leaking on a handoff | Agents SDK default [D:O2] | Context `history` is `"none"` (`schemas/workflow.schema.json:74`) | exists [M] |
| Runaway spawning | Claude Code 1,000-agent cap [D:CC1] | `maxSteps` 5000 by default (`src/runtime.mjs:83`); at most 2,000 nodes | exists [M]; `plan/expand` caps planned |
| Usage limit hit mid-fan-out | README incident [M] | Per-call cost reservation (C0 gateway); 429 pauses the generator | runtime pause-and-resume-at-reset missing [I] |
| Cache stampede when siblings start together | Claude Code stagger [D:CC1] | Byte-stable prefix (ROADMAP §2.2) | stagger missing |
| A failure mid-fan-out rerunning finished siblings | Claude Code resume [D:CC1] | Per-item map frames reused under a context-hash check (`src/runtime.mjs:445-449`) | exists [M]; idea #4 measures it |
| Parallel writers overwriting each other | Agent teams [D:CC3] | One-writer rule in the composition checker (ROADMAP §2.2, §2.9) | planned |
| Consent laundering through a computed prompt or a peer message | Claude Code [D:CC1, CC3] | Outputs carry `grantsActionAuthority:false`; changes are proposals | exists in the vocabulary (THESIS §8) |
| Injection spreading across workers | R04, R09 | Labels; `quarantined` nodes (`schemas/workflow.schema.json:135`) | exists [M] |
| Orphan worker processes on stop or relaunch | Claude Code refuses to relaunch until they exit [D:CC1] | Process supervision; `uncertain` effects | exists for `task` nodes; needed for `executor` |
| Grader tampering by self-modifying orchestrators | R03 §2.4 | Host-side, hash-pinned oracles | exists in the C0 harness [D: `research/construction-20261006/DESIGN.md` §2] |
| No learned or principled stopping | Survey [D-abs:SV1] | `until`, `loop_until_dry`, allocator N* | partial |

---

## 2. How they relate to Foundry

### 2.1 Mapping table

| Concept | Swarms (Kimi, Anthropic) | Claude Code dynamic workflows | Foundry today (file:line) [M] | Foundry planned | Verdict [I] |
|---|---|---|---|---|---|
| Who decides decomposition | Learned policy; lead LLM turn by turn | Script Claude writes per task | IR authored before the run by construction | `plan/expand`: checked proposals (ROADMAP §2.1) | **Different.** Control is fixed before untrusted data (P9); dynamism only through checked proposals |
| Spawn primitive | `create_subagent`/`assign_task`; Task tool | `agent()` | `agent` = one typed call without tools; `code`; `verify` (`schemas/workflow.schema.json:99`) | `executor` (full agent), `call` | **Complementary.** Swarm workers are Foundry executors. Foundry's `agent` node is narrower than any swarm worker |
| Fan-out over a list | Parallel subagents | `pipeline`/`parallel`, up to 4,096 items | `map`: items from any upstream output, `maxItems` ≤ 1000, `concurrency` ≤ 16, run policy default 4 (`schemas/...:121-122`, `src/runtime.mjs:83, 437-444`) | allocator sets N | **Same** |
| Barrier | Anthropic lead waits synchronously | `pipeline` none, `parallel` barrier | `map` is a barrier; the DAG (`needs`) streams node to node; multi-stage per-item work goes inside one `map` body | `await any/first_k/race`, streams (§2.1) | **Same in kind.** No-barrier pipelines are written as a multi-node `map` body [I] |
| Context passed down | Fresh context plus spawn prompt | Prompt string (plus CLAUDE.md) | Context contract: persona, input refs, recite; `history:"none"` (`schemas/...:74`) | board `reads` (§2.2) | **Same principle.** Foundry adds receipts and labels |
| Result passed up | One message; artifact references | Text or schema object; `null` on failure | Typed outputs with joined labels; `$error` items under `collect` | Artifact handles (§2.2) | **Same.** Foundry's are typed and labelled |
| Shared state | Kimi: none between subagents. Teams: task list plus mailboxes | Script variables | **none** (no board in `src/`) | `board_events` topics and reducers (Phase 6) | **Gap.** The owner asks for it (§3.5) |
| Peer messaging | Teams `SendMessage`; AutoGen/CAMEL chat | none | none | none | **Kept out on purpose** (MAST misalignment; CAMEL loops) |
| Handoff (transfer of control and history) | OpenAI, AutoGen, `langgraph-swarm` | none | Routing via `role:"route"` plus `when` | — | **Expressed as routing.** Transferring full history is refused by default (P8) |
| Nesting | Kimi: one level [I from App. E.8]. Claude Code subagents: 3 layers | `workflow()`: one level | `map`/`loop` bodies to depth 6, at most 2,000 nodes (`src/validate.mjs:164-168`) | `call` by hash with a carved budget | **Foundry is deeper statically, but has no by-reference nesting yet** |
| Iteration | Orchestrator step caps (15–100) | JS loops; 1,000-agent cap | `loop` with `until`, `maxIterations` ≤ 1000 | `loop_until_dry`; epoch compaction | **Same** |
| Structured output | Free-text single message | JSON Schema per agent, 5 retries | `returns` schema, portable subset, `escalation.schemaRetries` ≤ 3 (`schemas/...:79`) | — | **Foundry is stricter** |
| Verification | Offline LLM judge; CitationAgent | In-script adversarial patterns; "unverified" ≠ "refuted" | `verify` with `independence` ∈ {execution, different-model, same-model} (`schemas/...:140`) | Locked graders, canaries | **Different.** Only Foundry labels independence |
| Concurrency cap | Up to 300 (vendor) | 16 by default (1–256) | 16 per `map`; run policy 4 | allocator | **Same** |
| Budget | Credits; tokens | Turn-level token pool, a hard ceiling when set | `budget` in the IR, including `maxCost` (default 0); per-call reservation in the C0 gateway | Hierarchical budgets (§2.6) | **Foundry: dollars and hierarchy. Claude Code: a token pool** |
| Resume and replay | Anthropic resumes in production | Prefix replay in start order; one failure reruns later siblings | Per-node journal; per-item map frames reused, with `FRAME_DRIFT` on a context change (`src/runtime.mjs:445-449`) | fork and resample verbs | **Different; Foundry is finer-grained** (measured in idea #4) |
| Determinism | — | Time and randomness throw | Replay rules R1–R8 (ROADMAP §2.1) | — | **Same principle** |
| Side-effect isolation | Agent teams: "own different files" | `isolation:'worktree'` | Sandboxed code nodes; capability registry; `uncertain` | EffectPort / ARC | **Complementary** |
| Model per worker | One model family (frozen checkpoints) | `opts.model` and `effort` per agent | Model class per node from `policy/models.json`, escalation E1–E7 | Assignment search | **Foundry's distinctive lever** |
| Authority | — | Computed prompts ≠ consent; ultracode only from human input | `grantsActionAuthority:false`; proposals | ARC grants | **Same principle** |
| Learning the orchestration | PARL (RL) | none (saved scripts) | Decisions logged (`foundry-decision/1`, `src/runtime.mjs:670-672`) | Selection v1 with propensities | **Complementary.** Foundry's logs could later train a spawn policy |
| Stopping | Learned plus step caps | Script logic | `until`; budgets | Allocator N*; `loop_until_dry` | **An open problem everywhere** |
| Observability | Kimi UI [U] | `/workflows` tree; per-agent prompt, tool calls, result | Web UI plus a hash-chained ledger | Decision cards; OTel export | **Same goal.** The owner's node UI with a "breathing dot" and expandable chat is the `/workflows` agent detail, drawn as a graph |

### 2.2 Same, different, complementary

- **Same.** Fan-out over runtime lists, structured outputs, journaled resume, concurrency and total
  caps, determinism rules, and the rule that machine-computed text is never consent.
- **Different.**
  - Foundry's unit of work is a *narrow typed judgment*, not an open-ended agent.
  - Its control is *typed data checked before the run*, not code or a learned policy.
  - Its evidence carries *independence labels*.
  - Its model choice is *per node and measured*.

  These differences are the thesis (THESIS §5, P1/P2/P9). The surveyed systems show nothing that
  argues against them [I].
- **Complementary.** Claude Code workflows, Kimi-style swarms and agent teams are the most capable
  open-ended *executors* available. Foundry should call them as `executor` nodes and score them,
  not reimplement them (P10, ROADMAP §3). Foundry contributes what they lack.

### 2.3 The 94% number does not cover swarms or dynamic workflows

The corpus behind the expressibility table has these properties [M:
`research/corpus-20261006/COVERAGE.md` §2, §4]:
- 1,342 items from 27 platforms;
- the greedy order reaches "1258 (94%)" after the generalized-wait bundle (`COVERAGE.md:253`);
- it contains **no agent-orchestration framework**: no LangGraph, CrewAI, AutoGen/MAF, OpenAI
  Agents SDK, Claude Code workflows, MetaGPT SOPs or Kimi-style swarms;
- the agentic shapes it does contain come from low-code builders (Flowise, Langflow, Dify).

Lane 1 found the same gap (`01-requirements.md` §d.5). So "represent any and all workflows" is
currently measured only on human-built automation, orchestration, science and consumer graphs.
Idea #3 adds an agent-orchestration slice.

**Inference [I].** Looking only at the mechanisms surveyed above, the slice will be dominated by
three shapes:
- fan-out with a dynamic item count (`map` already covers it);
- handoffs (expressible as routing);
- open-ended tool loops (the planned `executor`).

The constructs most likely to be *unsupported* are:
- free-form group chat or peer messaging;
- a shared conversation carried across agents;
- recursion by reference.

The decision is whether these become IR constructs or are refused with a reason. Measure first.

### 2.4 What the owner's "this isn't a harness ... a mini harness" changes

Nothing in ROADMAP §3 has to move to admit swarms [I]:
- A `wide` operator over `map` is not a meta-harness. It is not a general agent loop either, since
  workers are narrow nodes or vendor executors. Nor is it a visual builder, a memory store or a
  model gateway.

What does change is *priority*:
- Expressiveness for agent-orchestration shapes moves from implicit to measured (idea #3).
- Delegation rules for `executor`, `call` and `plan/expand` are needed by Phase 2–3, not Phase 6.
  Lane 1 §d.12 says the same.
- A minimal board should be tested before Phase 6 (idea #8), but only after Phase 1 reports
  (budget).

### 2.5 Efficiency levers from swarm systems, and Foundry's status

| Lever | Evidence | Foundry status |
|---|---|---|
| Don't fan out when a single cheap attempt passes the check | Kim et al. [D-R03]; cascade, 2505.18286 [D-R03] | Gate missing (idea #2) |
| Pass artifacts by handle, not by value | Anthropic [D:A1] | Planned (ROADMAP §2.2 `returns`) |
| Shared, byte-stable prompt prefix plus staggered starts | Claude Code [D:CC1] | Prefix planned; stagger missing (it rides on idea #1) |
| No barrier between per-item stages | Claude Code skill [D:CC4] | Expressible as a multi-node `map` body [I] |
| Replay per item, not by prefix | Claude Code lacks it [D:CC1] | Exists (`src/runtime.mjs:445-449`); measured in idea #4 |
| Thinking off for narrow nodes | Thinking made Haiku worse at 3–4× the cost [M: README] | Applied in the `records` pilot |
| Report critical path and total spend separately | Kimi CriticalSteps [D:K1] | Missing (idea #1) |
| Cheap workers with a strong lead or verifier | Anthropic Opus lead with Sonnet workers [D:A1]; MinionS 5.7× cheaper at 97.9% quality [D-R03] | This is claim C1 itself |
| Pause when a usage limit is hit, rather than fail | Claude Code [D:CC1] | Missing in the runtime [I] |

---

## 3. Should a swarm be in scope, and in what form?

### 3.1 Decision

**In scope as an operator family over the existing IR. Not as a subsystem.**

The reasons [I]:
1. The owner wants every workflow representable without a particular harness. A swarm is one
   workflow *shape*, so it has to be expressible. That calls for an IR pattern, not a runtime.
2. The capability evidence is narrow (breadth tasks), and the cost is large: about 15× the tokens
   of a chat, and the measured usage-limit incident. A subsystem would add cost without a claim.
3. Every mechanism a swarm needs exists or is already planned:
   - fan-out over a runtime list exists;
   - typed workers exist;
   - verification with independence labels exists;
   - budgets exist;
   - executors, `call`, `plan/expand` and the board are planned.

   What is missing is small (§3.3).
4. Foundry's comparative advantage is narrow, cheap, verified nodes (THESIS §6). Open-ended
   swarm workers are what vendors train (Kimi PARL; Codex and Claude Code co-trained, R02 §e).
   Foundry should call those workers, not compete with them.

### 3.2 The `wide` operator (sketch; field names are illustrative)

```text
plan    : agent(role=plan, class L or F) → {subtasks: [{id, question, scope}] ≤ K}   # typed, bounded
check   : code → reject overlap and gaps between subtask scopes; enforce K ≤ maxItems
work    : map(items = plan.subtasks, concurrency = c, failure = collect) {
            do    : agent(class M, narrow, private context, returns typed finding + evidence handle)
            vfy   : verify(method = code | agent, independence ≥ different-model when judged)
          }
reduce  : code → deduplicate, merge and resolve conflicts deterministically; count $error items
final   : verify(independence = execution | different-model) over the merged result
```

Variants are the same skeleton with a different body or stopping rule:
- **`panel`**: N independent attempts, scored by parallel judges, then synthesized [D:CC4 quality
  patterns].
- **`explore`**: a persona set with environment snapshots, for game QA (ROADMAP §2.1).
- **`loop_until_dry`**: repeat until K rounds in a row find nothing new [D:CC4].
- **B5, best-of-K**: the same verifier at equal tokens [D-R03 §3.1]. It is the minimal swarm
  baseline (lane 1 §d.8).

**Static checks** the operator needs [I, from ROADMAP §2.9]:
- `maxItems` and `concurrency` within policy;
- a budget carve of per-item budget × K that fits the parent's remaining budget;
- `K` and item text are *tainted* when derived from untrusted input (program-counter taint);
- the reducer is code, never a model, unless a `verify` node follows it.

### 3.3 Minimal additions

| # | Addition | Status today | Where | Size | Why |
|---|---|---|---|---|---|
| A1 | `wide`/`panel`/`loop_until_dry`/B5 as typed templates in the operator library | Composable from `agent`, `code`, `map` and `verify` now [M] | `skills/` operator library, owned by other agents (proposal only) | S | Breadth tasks; the minimal swarm baseline |
| A2 | Critical-path wall time plus total tokens and $ in every run summary | missing | run record | S | Kimi's metric; separates latency gains from cost |
| A3 | `executor` node with spawn limits: `maxDepth` (sets `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`), `allowWorkflows` (else `CLAUDE_CODE_DISABLE_WORKFLOWS=1` [D:CC1]), budget, timeout, journaled transcript, `uncertain` effects, mandatory `verify` | planned (ROADMAP §2.1), not in the schema [M] | schema plus runtime | M | Subagents inside nodes, governed |
| A4 | Per-run caps on `plan/expand`: number of expansions, depth, nodes added | ROADMAP prose only | validator | S | Runaway prevention |
| A5 | Minimal run-scope board: typed topics, reducer, writer list, `expectSeq`, read receipts | planned (ROADMAP §2.2, Phase 6), none in `src/` [M] | store plus context compiler | M | The owner's message board, gated on idea #8 |
| A6 | `call` by hash, with a carved budget, a depth cap and a child run record | planned (ROADMAP §2.1) | runtime | M–L | Nesting, reuse, recursion. Also the largest single corpus unlock: 102 items (`COVERAGE.md` §4) [M] |
| A7 | Prefix stagger for `map` bodies that share a prompt prefix | missing | model layer | S | Cache cost |

**Not added:**
- **Handoff with full history.** It violates P8, and the Agents SDK filters do not redact tool
  arguments copied into messages [D:O2].
- **Free group chat.** See CAMEL's loops and MAST.
- **PARL-style orchestrator training.** It needs weight access to the orchestrator. Haiku is
  closed, and Kev is a judge, not a generator.
- **Default fan-outs above about 32.** There is no Foundry evidence for them, and the README
  records a usage incident.

### 3.4 Subagent spawning inside nodes: the policy

1. **`agent`, `code` and `verify` nodes never spawn.** The runtime spawns, through `map`,
   `plan/expand` or `call`. Every spawn is then a journaled, budgeted, replayable event [I].
2. **`executor` nodes may spawn inside the vendor loop**, under these limits:
   - Depth is capped from outside. The default is 1, meaning no nested spawns.
   - The total budget and the timeout are enforced by the runtime, not the executor.
   - The executor's subagent transcripts are journaled. Claude Code keeps them at
     `~/.claude/projects/{project}/{sessionId}/subagents/agent-{id}.jsonl` [D:CC2].
   - Effects count as `uncertain` unless the sandbox proves there were none.
   - The output is labelled `executor:<name>`.
   - A downstream `verify` is required.
3. **Raise the depth only on evidence** (idea #6).

"Am I overcomplicating?" For narrow nodes, yes: a node that is one typed judgment should not
delegate. For open-ended steps (a bug fix, a game session), delegating to a vendor executor is the
plan already, and the limits above are all it needs [I].

### 3.5 Information architecture: board, shared state, private notes

| Tier | What it holds | Who reads it | Precedent | Foundry |
|---|---|---|---|---|
| Private notes | Per-node scratch: working memory, never shared, journaled for audit | That node; auditors | Kimi subagents' "independent working memories" [D:K1]; Claude Code subagents' fresh context [D:CC2] | `scratch` (ROADMAP §2.2) |
| Edge results | Typed outputs and artifact handles | Downstream nodes, by `$ref` | Anthropic's "lightweight references" [D:A1] | exists (typed outputs); handles planned |
| Run board | Typed topics: schema, reducer (`append`, `lww(key)` with `expectSeq`, `setUnion`, `max`, `counter`), declared writers. Readers read at one board sequence number, and the receipt records it | Nodes that declare `reads` in the IR | MetaGPT subscription by role [D:MG1]; agent-team task list with file-locked claims [D:CC3]; LbMAS [D-abs:LB1]; Salemi +13–57% [D-R09] | planned (ROADMAP §2.2) |
| Workflow scope | Playbook deltas across runs | Later runs of the same workflow | ACE "evolving playbooks" with incremental deltas, ICLR 2026 [D-abs:AC1]; AWM [D-R01] | planned; verify before storing (P4) |
| Library scope | Kept workflows and claims about them | Selection; construction | AgentKB [D-abs:KB1]; AMP | ContextPort / AMP (THESIS §8) |

**Rules** [I, consistent with P8/P9]:
- Subscriptions are declared in the IR and checked statically. An LLM never chooses at run time
  what to read from the board.
- Untrusted topics are read only through `quarantined` nodes.
- One writer per `lww` key.
- Every read and write is an event, so the UI can show which board state each node saw. That is
  the "shared understanding of state," made auditable.

### 3.6 Nesting, iteration and composition

Rules for adding `call`, recursion and composition [I, adapting D:T1, D:CC2, CC4]:
- **Static depth cap.** For example 3 by-reference levels, mirroring Claude Code subagents. Static
  body nesting stays at ≤ 6.
- **Termination by budget.** Each child's carved budget is strictly smaller than its parent's
  remainder, which makes the budget a well-founded measure: recursion must terminate.
- **The child gets its own run record and event history.** Temporal partitions large workloads
  the same way, advising ≤ 1,000 children per parent; with `ABANDON`, a child can outlive a
  cancelled parent [D:T1]. Foundry's default should be to cancel the child with the parent.
- **Unbounded iteration.** Use `loop` with `until`. Long or periodic runs use Continue-As-New
  style epoch compaction (already a ROADMAP §2.1 debt). In Temporal, a parent treats a chain of
  continued runs as one execution [D:T1].
- **Recursion over long inputs is worth measuring.** RLMs handle inputs about 100× the context
  window. They report a median +26% over compaction and +13% over Claude Code with GPT-5, and an
  8B post-trained model gains +28.3% [D-abs:RL1]. Idea #10 tests this.
- **Composing parallel workflows** (the owner's later AMP question):
  - a `map` over `call`;
  - one writer per resource;
  - a central reducer and verifier, because independent topologies amplify errors 17.2× versus
    4.4× for centralized ones [D-R03].

### 3.7 Out of scope, with reasons

| Item | Reason |
|---|---|
| Training a PARL-style orchestrator | No weight access to the constructor (Haiku 5.5 is closed). Cost. Kimi is the only public trained evidence [D-abs:SV1] |
| Peer-to-peer agent chat as a runtime feature | CAMEL failure modes [D:CA1]; MAST misalignment [D-R04]; no Foundry claim depends on it |
| Handoffs that transfer history | Violate P8 [D:O2] |
| `kyegomez/swarms` and similar branded frameworks | Apache-2.0, at v16.0.1 [M], but no primary evaluation found [U]. Nothing to adopt |
| 100–300-agent default fan-outs | Breadth gains are task-specific [D:K1]; the README records a usage incident [M] |

### 3.8 What this lane implies for "Haiku 5.5 as the workflow constructor"

- **Evidence that small models can orchestrate comes from *trained* models:**
  - ToolOrchestra-8B, the AgentFlow 7B planner, WideSeek-R1-4B and FlowReasoner, which was
    distilled from DeepSeek R1 and then trained with RL [D-abs];
  - W4S, a 7B meta-agent trained in 1 GPU-hour [D-R03].
- **Untrained weak models fall short.** They propose harness updates as well as Opus does but fail
  to follow them [D-R03 §2.3, "Harness Updating ≠ Benefit"].
- **Kimi trains its orchestrator against small subagents first** [D:K1].
- **Conclusion.** Haiku 5.5 as constructor is a hypothesis, and C0's Haiku builder arms test it.
  The C0 records list `builderModel: "claude-haiku-5-5"` [M:
  `research/construction-20261006/artifacts/F-haiku-records-k1/construction.json`].
  Training it is impossible (closed weights), so its kit must carry the knowledge [I]:
  - typed operator templates (§3.2) with *when-to-use rules taken from §1.3*, for example "do not
    fan out if one cheap call passes verify";
  - verified example workflows retrieved by similarity (AWM/AgentKB style, verify-before-store);
  - the validator in the loop;
  - environment probes.

  The trainable model is Kev. Use it for the "needs a workflow, and which shape" gate (idea #2).

---

## 4. Papers and OSS: what each does, evidence, what Foundry should do, licence

Licences are from the repository's LICENSE file [M:LIC], read 2026-10-07. "Last release" is from
PyPI [M:PYPI]. Items R01–R11 already cover are marked "(R0x)" and only extended here.

### 4.1 Swarm and multi-agent frameworks

| Item | What it does | Evidence quality | Foundry | Licence; last release |
|---|---|---|---|---|
| Kimi Agent Swarm / PARL | Learned orchestrator; frozen subagents; `create_subagent`/`assign_task`; CriticalSteps | Technical report with self-reported benchmarks; no replication [D:K1] | **Adopt** CriticalSteps as a metric (A2) and the spurious-parallelism and serial-collapse failure names. **Ignore** the training | Report CC BY-NC-ND 4.0; weights "Modified MIT" |
| Anthropic research system | Opus lead with Sonnet workers, artifact references, effort rules | Internal eval, not reproducible [D:A1] | **Adopt** the effort-scaling rules as construction priors, and artifacts by handle | proprietary |
| OpenAI Swarm, then the Agents SDK | Handoffs as tools; `input_filter`; `as_tool` | Docs [D:O1, O2] | **Ignore** handoffs. `as_tool` = Foundry's executor-as-node | MIT; Swarm deprecated; `openai-agents` 0.23.1 (2026-10-02) |
| AutoGen, then MAF; AG2 | Swarm team, SelectorGroupChat, Magentic; MAF patterns | Docs [D:AG1, AG2, MAF1] | **Ignore** as a runtime. Use MAF patterns as corpus items (idea #3) | AutoGen code MIT (docs CC-BY-4.0), maintenance mode, 0.7.5 (2025-09-30); MAF MIT; AG2 Apache-2.0, 1.1.2 |
| CrewAI | Sequential or hierarchical crews; Flows (R02) | Docs [D:CR1] | Corpus items only | MIT; 1.15.24 (2026-10-07) |
| LangGraph plus `langgraph-swarm` | `Send` map-reduce, supersteps, reducers, `Command.PARENT` | Docs [D:LG1, LG2] | **Adopt** semantics already planned (reducers, checkpoint per superstep); corpus items | MIT; 1.2.14 / 0.1.0 |
| MetaGPT | SOP roles, structured documents, pub-sub with prerequisite activation, executable feedback | ICLR 2024; 2023 models [D:MG1] | **Adopt** "activate only when all subscribed prerequisites are present" as board semantics | MIT; 0.8.2 (2025-03-09), stale |
| CAMEL | Role-playing, inception prompting | NeurIPS 2023 [D:CA1] | **Adopt** its failure list as negative controls | Apache-2.0; 0.2.90 |
| GPTSwarm | Graph agents; REINFORCE edge pruning | ICML 2024; small benchmarks [D:GS1] | **Test later**: edge pruning to drop useless map workers, only with logged data | MIT |
| Claude Code workflows, subagents, agent teams | §1.4 | Docs [D:CC1–CC4] | **B1-cc baseline** (lane 1 §d.8); **executor**; ingest journals (R02 §c) | proprietary |

### 4.2 Automatic workflow and agent design

| Item | What it does | Evidence quality | Foundry | Licence |
|---|---|---|---|---|
| ADAS, AFlow, DGM (R03) | Meta-agent search; MCTS over code workflows; self-modification | Mostly in-distribution; tampering in 63–85% of ADAS/DGM iterations vs 18% for AFlow [D-R03 §2.4] | **Ignore** global search. AFlow's typed operator set is the closest analogue to Foundry's operator library | ADAS Apache-2.0; AFlow inside MetaGPT (MIT); DGM Apache-2.0 |
| MaAS (2502.04180) | "Agentic supernet": samples an architecture per query by difficulty | Abstract: 6–45% of the inference cost, +0.54 to +11.82 [D-abs:MA1]; venue [U] | **Adopt** the idea of query-conditioned depth for the gate (idea #2). Ignore the supernet | no code link on the abstract page |
| DAAO (2509.11079, WWW 2026) | Difficulty estimator (VAE), operator allocator, cost-aware router; difficulty updated from success | Abstract with no numbers [D-abs:DA1] | **Test** as a design reference for idea #2 | [U] |
| FlowReasoner (2504.15257) | Query-level meta-agent: distilled from R1, then RL with execution feedback | +10.52% over o1-mini [D-abs:FR1] | Evidence that per-query construction by a *trained* model works; not usable for Haiku | no LICENSE at `main` [M] |
| ScoreFlow (2502.04306) | Gradient-based workflow optimization with Score-DPO | +8.2% over baselines; "smaller models outperform larger" (no figures) [D-abs:SF1] | **Ignore** (requires training) | no LICENSE at `main` [M] |
| MASS (2502.02533, ICLR 2026) | Local prompts, then topology, then global prompts | The abstract has no numbers [D-abs:MS1] | **Adopt** the ordering: tune node prompts *before* topology (fits ROADMAP §2.3 step 4) | no code link |
| EvoAgentX (2507.03616) | Framework with TextGrad, AFlow and MIPRO | HotPotQA F1 +7.44; MBPP +10; MATH +10; GAIA up to +20 [D-abs:EA1] | **Ignore** as a dependency; a possible B3 baseline source | MIT; 0.1.4 (2026-06-28) |
| Puppeteer, ToolOrchestra, AgentFlow, WideSeek-R1 | RL-trained small orchestrators or planners | Abstracts (§1.2) | **Adopt** as evidence for idea #2's labels and for C0 interpretation; no code adoption | ToolOrchestra Apache-2.0; Puppeteer (ChatDev branch) Apache-2.0; others [U] |
| BiCSRouter (ACL Findings 2026) | Chooses single- vs multi-agent per query by utility | Search snippet only [D-sec] | Check before citing | [U] |

### 4.3 Workflow memory and reuse

| Item | What it does | Evidence | Foundry | Licence |
|---|---|---|---|---|
| AWM, ExpeL, Voyager (R01) | Induced workflows, insights, self-verified skill libraries | AWM +24.6% and +51.1% relative [D-R01] | Already in THESIS P4/P5 | AWM Apache-2.0; ExpeL Apache-2.0; Voyager MIT |
| Agent KB (2507.06229) | Cross-framework experience store; planning- and feedback-stage retrieval with a disagreement gate | smolagents GAIA pass@3 55.2→73.9; OpenHands SWE-bench 24.3→28.3 [D-abs:KB1] | **Adopt** the disagreement gate as an applicability-port feature; storage belongs to AMP | Apache-2.0 |
| ACE (2510.04618, ICLR 2026) | Evolving playbooks; generator, reflector and curator; incremental deltas against "context collapse" | +10.6 on agent benchmarks; +8.6 on finance; matches the top AppWorld agent with a smaller open model [D-abs:AC1] | **Test** as workflow-scope playbook deltas, behind verify-before-store | [U] |

### 4.4 Typed and structured LLM programming

| Item | What it does | Evidence | Foundry | Licence; last release |
|---|---|---|---|---|
| DSPy | Signatures plus optimizers: few-shot, COPRO, MIPROv2, SIMBA, GEPA; **BootstrapFinetune** "distills a prompt-based DSPy program into weight updates"; BetterTogether [D:DS1] | Many papers; small-model results (R09) | **Adopt** algorithms (GEPA/MIPRO-style per-node prompt search, idea #9) in JavaScript, with no Python dependency. BootstrapFinetune is a template for Kev training data | MIT; 3.4.0 (2026-09-25) |
| Outlines, xgrammar (R09) | Grammar-constrained decoding | R09 | Already the engine-conformance plan | Apache-2.0; Outlines 1.3.3 |
| BAML | DSL for typed functions; generated clients "fix broken JSON" [D:BA1]; the docs page is labelled v0 legacy, v1 in beta | Vendor docs | **Ignore** as a dependency. Foundry validates after decoding | Apache-2.0; 0.226.2 |
| Guidance | Constrained generation | — | Ignore | MIT; 0.3.1 (2026-02-03) |
| Instructor | Pydantic validation with retry [U, from memory] | — | Equivalent to Foundry's E1 escalation | MIT; 1.17.0 |
| LMQL | Constraints by logit masking [D:LM1] | — | **Ignore**: last PyPI release 0.7.3, from 2023-10-14 [M] | Apache-2.0 |

### 4.5 Durable execution

| Item | Relevant mechanism | Foundry | Licence; last release |
|---|---|---|---|
| Temporal | Child workflows with their own histories; `ABANDON` close policy; ≤ 1,000 children per parent advised; Continue-As-New; "When in doubt, use an Activity" [D:T1]. OpenAI Agents integration (R02) | **Adopt** semantics for `call` and iteration (§3.6). No dependency | MIT; `temporalio` 1.34.0 |
| DBOS (R02) | `fork_workflow` | Adopt as the fork verb (R02 §d.8) | MIT; 3.2.0 |
| Hatchet | Any task may spawn children: regular, durable or DAG. A failed child raises in the parent [D:H1] | Precedent for executor-spawned children with parent error handling | MIT; `hatchet-sdk` 1.41.1 |
| Restate (R02) | Journals LLM and tool calls | **Avoid as a dependency**: BSL 1.1 with a no-public-platform grant [M:LIC] | BSL 1.1 |
| Inngest (R02) | AgentKit routers | **Avoid as a dependency**: SSPL v1 with an "Apache 2.0 Future License" [M:LIC] | SSPL |
| Prefect, Dagster | Data-pipeline orchestrators; already corpus platforms (18 and 25 items) [M:COVERAGE] | Corpus only | Apache-2.0; 3.8.8 / 1.13.25 |

### 4.6 Blackboard and shared memory

| Item | Evidence | Foundry |
|---|---|---|
| LbMAS (2507.01701) | Agents chosen by a control unit from blackboard content; loop until consensus; "competitive" with fewer tokens; no numbers in the abstract, no code [D-abs:LB1] | Design reference only |
| Salemi et al. (2510.01285) (R09) | +13–57% relative over master–slave and RAG baselines [D-R09] | Supports A5, behind idea #8 |
| Claude Code agent teams | Task list with dependencies and file-locked claims; JSON mailboxes; "task status can lag" [D:CC3] | Foundry should own task status in the runtime, never trust a worker's self-report [I] |

### 4.7 Cascades and routing

R04 covers FrugalGPT, RouteLLM, MasRouter, ORACLE and Agent-as-a-Router.

New here:
- RouteLLM's last release was 0.2.0, on 2024-07-08 [M]. Licence Apache-2.0. **Use it only as a
  baseline**, as R04 says.
- The strongest gate baseline for idea #2 is a **cascade**: run a cheap single attempt, verify it,
  escalate to a workflow. It gave +1.1–12% accuracy at up to about 20% lower cost [D-R03 §2.5].

### 4.8 Small-model judges and verifiers

| Item | Evidence | Foundry | Licence |
|---|---|---|---|
| Kev / Jev (owner) | Kev-0.8B transfer accuracy 0.648 vs Kev-4B 0.817 vs Jev 0.857 (author's numbers) [D: `research/kev-20261007/01-kev-dossier.md` §0]. Jev has no API key here (README D7) | The judgment-port engine; training happens on the owner's RTX 4060 | see dossier |
| Weaver (2506.18203, NeurIPS 2025) | Weak supervision over 33 reward models and judges (7B–72B): 87.7% average vs o3-mini 86.7%. A 400M cross-encoder distilled from it keeps 98.7% (abstract) or 98.2% (body) of the accuracy at up to 99.97% less compute [D:WV1] | **Adopt** the recipe: ensemble rule, Haiku and Kev verifiers, then distill into Kev (idea #7) | MIT |
| Skywork-Reward-V2 (2507.01352) | Eight reward models (0.6B–8B) trained on 26M curated pairs; state of the art on 7 benchmarks (no numbers in the abstract) [D-abs:SK1] | Candidate base or teacher for a Kev verifier port | [U] |
| LLM-as-a-Verifier, reward models, PRMs (R04) | R04 §verification | Already planned (`local-logit` engine) | — |

### 4.9 2026 developments that change the picture

1. **Swarms became products with learned orchestration.** Kimi went from K2.5 (January) to K2.6
   (April) to K3, with up to 300 agents [D-vendor:K2]. Claude Code workflows plus ultracode
   shipped [D:CC1]. Within roughly 12 months the vendors' own open-ended executors will
   parallelize by themselves [I]. Foundry should therefore treat "a swarm" as just one executor
   and measure it against narrow `map` workflows, not build one.
2. **Small trained orchestrators now beat large general ones** on tool and model coordination
   (ToolOrchestra, AgentFlow, WideSeek-R1) [D-abs]. This strengthens THESIS P1 and the case for a
   *trained* gate or judge (Kev). It weakens any plan that relies on a *prompted* small model to
   orchestrate with no checks [I].
3. **Recursion is a measured technique for long inputs** (RLM) [D-abs:RL1]. It raises the value of
   `call`.
4. **Distilling verifiers is practical** (Weaver) [D:WV1]. This is the most direct route to a
   useful Kev verifier port.

---

## 5. Top 10 ideas, ranked by expected capability gain per unit of effort

Ranking rationale [I]:
- **Expected gain** is how directly the idea moves a Foundry claim (C0, C1, C3, C4, or
  expressiveness) on beds that already exist.
- **Effort** is S (≤ 2 days), M (≤ 1 week) or L (more).
- **Budget** follows lane 1 §d.1. Ideas #3 and #4 need little or no model spend and can run now.
  The rest wait for the Phase 1 report.

Every experiment follows `research/PREREGISTRATION-TEMPLATE.md`:
- dev seeds only until frozen, then the sealed split;
- K and the margins fixed before the first run;
- the cost recorded per arm.

| Rank | Idea | Claim | Effort | Model $ (list price, estimate) |
|---|---|---|---|---|
| 1 | `wide` operator plus critical-path metric | C1 on breadth tasks | S | ≈ $30–50 |
| 2 | "Needs a workflow?" gate with a sensitivity slider | C0/C1 economics; C4 | M | reuses C0/C1 runs; ≈ $20 extra |
| 3 | Agent-orchestration slice in the expressiveness corpus | expressiveness | S–M | ≈ $0 (static), ≈ $10 for 10 executed items |
| 4 | Per-item replay vs prefix replay under a mid-fan-out failure | efficiency of durability | S | ≈ $2 |
| 5 | Verify-panel operators with independence labels | C3/C4 | S–M | ≈ $20 |
| 6 | Executor spawn-depth governance | C0 (executor arm) | M | ≈ $60–100 |
| 7 | Weak-verifier ensemble distilled into Kev | C4 | M–L | ≈ $10 plus laptop GPU |
| 8 | Run board vs isolated explorers | C5 / owner's board | M | ≈ $20–40 |
| 9 | Per-node prompt search for Haiku nodes | C1 | M | ≈ $15–30 |
| 10 | Recursive `call` for long inputs | expressiveness and C1 | L | ≈ $20 |

**1. The `wide` operator (§3.2) plus critical-path accounting (A2)**
- **Hypothesis.** On breadth-structured tasks (at least 8 independent sub-items), a Foundry `wide`
  workflow with Haiku 5.5 nodes is non-inferior in verified success to B0 (single Sonnet 5.5 call
  or agent), at ≤ 1/3 of its cost per verified success and ≥ 2× lower critical-path wall time.
- **Why it ranks first.**
  - The `records` pilot already is this shape: code-owned parsing, one Haiku judgment per 6-row
    chunk, 3/3 at d2 for $0.086 per task [M: README]. Formalizing it costs little.
  - It answers "is a swarm worth it" with a number.
- **Arms:**
  - B0-Sonnet and B0-Haiku (single call or agent);
  - B5 (best-of-K with the same verifier at equal tokens);
  - B1-cc (a real Claude Code workflow script under the same budget, per lane 1 §d.8);
  - F-wide.
- **Beds.** `records` at d3 and above, where the current hand workflow fails (0.90 and 0.95
  [M: README]), plus one bed whose generator scales the item count. If none exists, a bed owner
  adds one; this lane does not touch `beds/`.
- **Size.** n = 30 dev tasks, K = 3.
- **Metrics:** verified success (oracle), cost per verified success (CPS), critical-path wall time,
  total tokens.
- **Falsifier.** Any one of these ends `wide` as a default operator for that family:
  - F-wide is below B0-Sonnet by more than 5 points of success;
  - its CPS is not ≤ 0.5× B0-Sonnet's;
  - it loses to B5 at equal tokens.

**2. A "needs a workflow, and which shape" gate, with a sensitivity slider**
- **Hypothesis.** A gate with an adjustable threshold τ (the owner's slider) gives a better
  cost–success frontier than always-B0, always-F, or a cascade (cheap attempt, verify, escalate).
  The gate classifies a task as {no workflow, simple ≤ 3 nodes, wide, deep/iterative}.
- **Labels.** Execution-derived only (Kev program rule: no LLM labels). From paired B0/F runs on
  the same tasks (C0/C1 produce these), the label is the cheapest arm that reached verified
  success.
- **Grounding:**
  - Kimi: "parallelism is not presumed to be inherently advantageous" [D:K1];
  - Kim et al.'s threshold of about 45% single-agent success [D-R03];
  - MaAS and DAAO difficulty-conditioned depth [D-abs];
  - ultracode's documented cost of writing a workflow for every task [D:CC1].
- **Arms:**
  - always-B0;
  - always-F;
  - **cascade**: Haiku single attempt, verify, then a workflow;
  - **rule gate**: two Haiku probes; build only if fewer than 2 pass;
  - **Kev gate** at τ ∈ {0.2, …, 0.8}.
- **Metrics:** the cost–success Pareto frontier, wrong-gate rate, and CPS on held-out families.
- **Falsifier.** If the Kev gate is not Pareto-better than the cascade and the rule gate at any τ
  on held-out families, Kev stays advisory (claim C4's rule). Report the cascade as the
  recommended default.
- **Size.** At least 200 labelled tasks across at least 4 families. Labels come from runs that
  happen anyway.

**3. An agent-orchestration slice for the expressiveness number (the 94% target)**
- **Hypothesis.** At least 80% of about 120 agent-orchestration items are expressible natively or
  through *already planned* constructs. The items: Claude Code workflow scripts in public plugins;
  LangGraph `Send`, supervisor and swarm examples; CrewAI and MAF samples; OpenAI Agents SDK
  examples; MetaGPT SOPs.
- **Method.**
  - Reuse the corpus converters and verdict vocabulary (`research/corpus-20261006/`).
  - Tag each item with its constructs: handoff, dynamic spawn, peer messaging, shared board,
    recursion, streaming.
  - Execute 10 items end to end. Per AGENTS.md, expressible does not mean task success; this
    matches lane 1 §d.5's "report two numbers".
- **Falsifier.** If ≥ 20% need constructs absent from ROADMAP §2.1–2.2 (most likely free group
  chat or shared conversations), "any and all workflows" requires new IR constructs, or an
  explicit refusal list, before it can be claimed.
- **Licences.** MIT/Apache sources dominate [M:LIC]. Record licence per item as the corpus does.

**4. Per-item replay versus prefix replay**
- **Hypothesis.** After a failure injected at item k of an N = 16 fan-out:
  - Foundry re-executes exactly 1 item, using frames reused under the context-hash check
    (`src/runtime.mjs:445-449`) [M];
  - Claude Code's documented resume re-executes N − k + 1 agents [D:CC1].
- **Arms.** A Foundry `map` over a Haiku node, and an equivalent Claude Code workflow script with
  the same prompts.
- **Metrics:** model calls and dollars re-spent; output equality after resume; wall time to
  completion.
- **Falsifier.** Foundry re-executes more than 1 item, or its post-resume outputs differ from an
  uninterrupted run. Either is a replay bug and blocks the durability claim.
- **Why it ranks high.** It costs about $2, runs now, and turns a documented difference into a
  measured one. This is the cheapest defensible "why not just CC workflows" number.

**5. Verify-panel operators with independence labels**
- **Hypothesis.** At equal dollars, a panel of three Haiku verifiers beats one same-model verifier
  on the false-accept rate, and matches one Sonnet verifier. The panel is either adversarial (3
  refuters, majority vote) or uses diverse lenses (correctness, reproduction, security)
  [D:CC4 quality patterns].
- **Beds.** Families whose findings have an oracle: `codefix`, `incident`.
- **Arms:**
  - single same-model verify;
  - 3-refuter Haiku;
  - 3-lens Haiku;
  - single Sonnet;
  - execution oracle, as the upper bound.
- **Metrics:** precision and recall of accepted findings; false-accept rate; dollars per true
  accepted finding.
- **Falsifier.** If no panel beats single Sonnet at equal dollars, the panel is not a default
  operator. "Debate or Vote" (R03) predicts the gain, if any, comes from voting.

**6. Executor spawn-depth governance (A3)**
- **Hypothesis.** For open-ended executor steps, allowing nested subagents (depth 2–3) does *not*
  raise verified success at matched dollars versus depth 1, and it raises variance.
- **Arms.** Claude Code headless executor at `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` = 1, 2 and 3
  [D:CC2]. Each arm runs with and without the Workflow tool (`CLAUDE_CODE_DISABLE_WORKFLOWS=1`
  [D:CC1]), under one dollar cap and timeout, with a mandatory `verify`.
- **Bed.** `codefix`.
- **Size.** n = 20, K = 3.
- **Metrics:** verified success, pass^k, dollars per success, cap-hit rate.
- **Falsifier.** If depth > 1 improves success by ≥ 5 points at matched dollars, raise the
  default. Otherwise default to depth 1 with workflows disabled inside executors.

**7. A weak-verifier ensemble distilled into Kev (Weaver recipe)**
- **Hypothesis.** A weak-supervision combination of rule checks, Haiku verify, and stock Kev beats
  the best single verifier on selecting the correct candidate. Distilled into Kev-0.8B or 4B, it
  keeps ≥ 90% of the ensemble's gain.
- **Data.** Node-level verify labels from the judgment ledger and bed oracles (execution-derived).
  Dev and train only; test seeds ≥ 5000 untouched, per the Kev program.
- **Metrics:** best-of-N selection accuracy, AUROC, cost per judgment.
- **Falsifier.** The ensemble is ≤ best single verifier + 2 points, or the distilled Kev is below
  the best single verifier on held-out data. Either drops the recipe.

**8. Run board versus isolated explorers (A5, the owner's message board)**
- **Hypothesis.** In multi-explorer discovery tasks, explorers that read a shared `findings`
  topic (setUnion) and a `coverage` topic (max) find more unique confirmed findings per dollar
  than isolated explorers deduplicated at the end. The motivation is Anthropic's
  duplicated-work failure [D:A1].
- **Bed.** `gridquest`, or the game-QA reference once it exists (R08).
- **Arms:**
  - isolated plus code dedupe;
  - board reads before each step;
  - one explorer with 4× the budget.
- **Metrics:** unique confirmed findings per dollar, duplicate rate, coverage.
- **Falsifier.** If the board arm is ≤ the isolated arm on findings per dollar, the board stays at
  Phase 6. Simple edge passing is the default.

**9. Per-node prompt search for Haiku nodes**
- **Hypothesis.** Searching instructions per node and model raises node-check pass rates by ≥ 5
  points and flips `records` d3 from failing to passing on held-out data. The search is GEPA-style
  reflective mutation or MIPROv2-style; the metric is the node's own check; it runs on replayed
  upstream inputs. This is ROADMAP §2.3 step 4, with DSPy's optimizers as the reference
  algorithms [D:DS1] and MASS's "prompts before topology" ordering [D-abs:MS1].
- **Arms.** Hand prompt vs searched prompt, same model, same decoding.
- **Falsifier.** A lift under 5 points at node level, or no end-to-end held-out gain, ends it. Any
  dev-only gain is development evidence, per AGENTS.md.

**10. Recursive `call` for long inputs (A6)**
- **Hypothesis.** Past some input size, a recursive split through `call` (split until a chunk
  fits the class-M input budget, then reduce in code) beats both a flat fixed-chunk `map` and a
  single long-context call, on verified success per dollar [D-abs:RL1].
- **Bed.** `records` or `synth` with the input length scaled.
- **Arms:** flat map; recursive call; single Sonnet call.
- **Metrics:** success vs input length; dollars.
- **Falsifier.** If recursion is never better than a flat map at any tested length, `call` is
  kept for reuse and composition only.
- **Effort is L** because `call` does not exist yet.

**Not ranked (ignore for now):**
- PARL-style orchestrator training;
- GPTSwarm edge optimization (it needs logged data from #1 first);
- EvoAgentX/AFlow global search (R03: tampering, held-out gains near zero);
- BAML/LMQL/Instructor adoption.

---

## 6. Unknowns and unverified claims

- **Kimi.**
  - The K2.5 figure of "100 sub-agents / 1,500 steps" appears only in secondary sources [D-sec:K3].
  - The K3 swarm is described only on a vendor help page [D-vendor:K2].
  - No independent replication of any swarm number exists [U].
- **Claude Code.**
  - The docs do not say whether workflow agents may themselves spawn subagents, or how the
    workflow cap and the 3-layer subagent depth interact [U].
  - The skill text's `min(16, CPUs−2)` and the docs' "16 ... fewer when ... fewer CPUs" are
    consistent but not identical [D:CC1, CC4].
- **Venues and details.**
  - MaAS: venue not on the abstract page [U].
  - Magentic-One: ledger names not in the abstract [U].
  - BiCSRouter: snippet only [D-sec].
  - LbMAS and DAAO: no numbers in their abstracts [D-abs].
- **Licences not found:** FlowReasoner, ScoreFlow, Skywork-Reward-V2, ACE, RLM, AgentFlow,
  WideSeek-R1 [U]. Resolve before any code is acquired, per AGENTS.md, with URL, SHA, date and
  licence.
- **Unreproducible results.** Anthropic's research-system numbers come from an internal eval.
- **Owner context.** I did not have the owner's full conversation history. The requirements come
  from the relayed 2026-10-07 message and lane 1's audit.
- **No experiment was run.** The only [M] items are repository reads, licence headers, PyPI
  metadata and numbers already recorded in the repository.

## 7. Sources and commands

**Claude Code** (fetched 2026-10-07):
- CC1 https://code.claude.com/docs/en/workflows
- CC2 https://code.claude.com/docs/en/sub-agents
- CC3 https://code.claude.com/docs/en/agent-teams
- CC4 the `/workflow-authoring` bundled skill text (Claude Code's Workflow tool reference), loaded
  in this session

**Kimi:**
- K1 https://arxiv.org/abs/2602.02276 (v2, 7 Aug 2026; PDF text via `pdftotext -layout`; §3,
  §5.2, Table 6, Fig. 8, App. E.8)
- K2 https://www.kimi.com/help/agent/agent-swarm (vendor)
- K3 secondary pages: https://www.morphllm.com/kimi-k2-5-agent-swarm,
  https://www.centron.de/en/tutorial/kimi-k2-5-explained-architecture-agent-swarm-deployment-guide/

**Anthropic, OpenAI, Microsoft, CrewAI, LangChain:**
- A1 https://www.anthropic.com/engineering/multi-agent-research-system
- O1 https://github.com/openai/swarm
- O2 https://openai.github.io/openai-agents-python/handoffs/
- AG1 https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/swarm.html
- AG2 https://raw.githubusercontent.com/microsoft/autogen/main/README.md
- MAF1 https://learn.microsoft.com/en-us/agent-framework/workflows/orchestrations/
- CR1 https://raw.githubusercontent.com/crewAIInc/crewAI/main/README.md
- LG1 https://docs.langchain.com/oss/python/langgraph/graph-api
- LG2 https://github.com/langchain-ai/langgraph-swarm-py

**Multi-agent papers:**
- MG1 https://arxiv.org/abs/2308.00352 (full text)
- CA1 https://arxiv.org/abs/2303.17760 (full text)
- GS1 https://arxiv.org/abs/2402.16823 (full text)
- M1 https://arxiv.org/abs/2411.04468
- WS1 https://arxiv.org/abs/2602.04634
- TO1 https://arxiv.org/abs/2511.21689
- PU1 https://arxiv.org/abs/2505.19591
- AF1 https://arxiv.org/abs/2510.05592
- SV1 https://arxiv.org/abs/2605.02801
- RL1 https://arxiv.org/abs/2512.24601

**Automatic design, memory, verifiers:**
- MA1 https://arxiv.org/abs/2502.04180
- DA1 https://arxiv.org/abs/2509.11079
- FR1 https://arxiv.org/abs/2504.15257
- SF1 https://arxiv.org/abs/2502.04306
- MS1 https://arxiv.org/abs/2502.02533
- EA1 https://arxiv.org/abs/2507.03616
- KB1 https://arxiv.org/abs/2507.06229
- AC1 https://arxiv.org/abs/2510.04618
- LB1 https://arxiv.org/abs/2507.01701
- WV1 https://arxiv.org/abs/2506.18203 and https://arxiv.org/html/2506.18203v3
- SK1 https://arxiv.org/abs/2507.01352

**Typed programming and durable execution:**
- DS1 https://raw.githubusercontent.com/stanfordnlp/dspy/main/docs/docs/learn/optimization/optimizers.md
- BA1 https://docs.boundaryml.com/guide/introduction/what-is-baml
- LM1 https://github.com/eth-sri/lmql
- T1 https://docs.temporal.io/child-workflows
- H1 https://docs.hatchet.run/home/child-spawning

**Measured in this session:**
- **LIC** (licence headers). For each repository in §4, `curl -sSf
  https://raw.githubusercontent.com/<owner>/<repo>/<main|master>/<LICENSE|LICENSE.md|...>`, first
  three non-empty lines. The GitHub REST API was refused for these repositories in this session,
  so raw files were used instead.
- **PYPI** (release metadata). `curl -sS https://pypi.org/pypi/<pkg>/json`, reading
  `info.version` and that release's first `upload_time`, on 2026-10-07.

**Repository (HEAD `67a0a6e`):**
- `schemas/workflow.schema.json:74,79,99,121-124,135,140`
- `src/runtime.mjs:83,436-449,670-672`
- `src/validate.mjs:164-168`
- `src/dataflow.mjs:132-134`
- `research/corpus-20261006/COVERAGE.md` §2, §4 (incl. line 253)
- `research/construction-20261006/DESIGN.md` §1–2 and `artifacts/*/construction.json`
- `research/kev-20261007/01-kev-dossier.md` §0
- `research/review-20261007/01-requirements.md` §d.1, d.5, d.8, d.11, d.12
- `README.md`: Status, Usage-limit incident, Owner decisions
- R01–R11 as cited
