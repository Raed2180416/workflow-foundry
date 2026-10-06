# The agent-orchestration landscape on 2026-10-06: what Workflow Foundry should adopt, and where the gaps are

**Method.** I fetched about 90 primary pages on 2026-10-06. Citations like [A1] resolve in the Sources list at the end.
- **[V]** means *[verified: fetched 2026-10-06]*.
- **[U]** means *[recalled, unverified]*. It also covers sources I only saw as search-result snippets.

Sentences in sections (b)–(e) that carry no citation are my own assessment. openai.com returned HTTP 403, so the OpenAI facts come from OpenAI's docs sites, GitHub and quoted secondary sources.

## Bottom line

1. **Agents writing their own harness at run time is already shipping.** Examples:
   - Claude Code dynamic workflows, where Claude writes a JavaScript script that calls `agent()`, `pipeline()` and `parallel()` [A1,A2];
   - Deep Agents subagents launched from interpreter code [L4];
   - OpenAI programmatic tool calling [O6].

   Foundry cannot stand out by making authoring more dynamic.
2. **Outcome gates converged in 2026.** Managed Agents has `define_outcome` [A12]. Claude Code and Codex both have `/goal` [A9,O8]. Deep Agents has `RubricMiddleware` [L5], and Factory runs QA on each feature [X11]. All of them rely on a model or agent as the judge. None says how independent that judge is from the work it grades.
3. **Resume is a commodity; fork is not.** You can fork a run from a past step in LangGraph [L2], DBOS [D3] and CrewAI [X5]. Claude Code workflows instead rerun every agent that started after a failed one [A1].
4. **No system I checked keeps performance records for reusable workflows or routes between them.** Today's routers choose *models* [X14,G5,A13]. What vendors call cross-run learning is free-text memory [A15,O4,O10].
5. **The labs are folding scaffolding into the model.** OpenAI trains Codex with its harness present [O13]. Anthropic removes harness scaffolding as its models improve [A17,A18]. Foundry should compete where the labs are structurally weak: neutral, local-first measurement, selection and evidence *across* vendor harnesses.

## 1. System-by-system deconstruction

### Anthropic

**Dynamic workflows.** Shipped the week of 2026-05-25 [A10].
- **What it is:** a JavaScript script that calls `agent(prompt,{schema,label})`, `pipeline`, `parallel`, `phase` and `log`, and reads an `args` global [A1].
- **Who writes it:** Claude, when you type `ultracode` or ask for a workflow. You can save it to `.claude/workflows/` or ship it in a plugin as `/name` [A1].
- **Resume:** runs are replayed in the order agents started. The first agent whose prompt changed reruns, and so does every agent after it. A failed agent likewise reruns everything after it. `Date.now()` and `Math.random()` throw, so a relaunch repeats the same calls [A1].
- **Limits:** no user input mid-run, 1,000 agents per run, and 16 running at once by default [A1].
- **Output checking:** each agent can be given a JSON Schema. It is checked for contradictions before the agent starts, and a failing output gets 5 retries [A1].
- **Quality patterns:** adversarial verification, tournaments, loop-until-done [A2].
- **Security:** the session's permissions and sandbox still apply. Prompts that the script computes do not count as user requests. The `ultracode` keyword only works when a human typed it [A1].

**Building blocks.**
- **Subagents** can set `model`, `permissionMode`, `memory` and `isolation: worktree`, and can nest three levels deep [A3].
- **Agent teams** are experimental. Teammates share a task list protected by file locks, and one teammate cannot grant consent on the user's behalf [A4].
- **Hooks:** more than 30 hook events, including `SubagentStart`, `SubagentStop` and `TaskCompleted`. Handlers can be `command`, `http`, `mcp_tool`, `prompt` or `agent` [A5].
- **Skills** follow the agentskills.io format [A6].
- **`claude plugin eval`** (shipped the week of 2026-09-07) runs each test case three times with typed graders. It reports the score with the plugin, the score without it, and the difference (Δ), and it can fail a CI build on that score [A8,A10].

**Managed Agents** (beta).
- **Durability:** a durable session log kept on Anthropic's servers, recovery through `wake(sessionId)`, and credentials kept outside the sandbox [A11,A17].
- **Versioning:** agents are versioned. A coordinator's roster pins the versions it delegates to. It can delegate one level deep, to at most 20 agents, and can include an advisor model [A13,A16].
- **Outcomes:** you supply a rubric, and a grader with its own separate context returns `satisfied`, `needs_revision` or `max_iterations_reached` [A12].
- **Budgets:** hard dollar caps priced at list rates, including $0.08 per session-hour [A14].
- **"Dreams":** consolidate up to 100 past sessions into a *new* memory store, leaving the original untouched [A15].
- **Data retention:** because sessions are stateful, Managed Agents is not eligible for zero data retention [A11].

**Doctrine (engineering posts and docs).**
- "Building effective agents" defines workflows versus agents [A25].
- **Multi-agent research:** the system beat a single agent by 90.2% on an internal eval. Multi-agent systems use about 15× the tokens of a chat [A20].
- **Context engineering:** compaction, notes and sub-agents [A21].
- **Code execution with MCP:** tools exposed as code APIs and saved as skills, cutting one example from 150k to 2k tokens [A23].
- **Evals:** "we're evaluating the harness and the model working together", plus the pass^k measure of consistency [A22].
- **Removing scaffolding:** Opus 4.6 let Anthropic drop context resets and sprint decomposition from a harness [A18]. Harness assumptions "can go stale as models improve" [A17].
- **Containment:** contain at the environment layer first [A24].

### OpenAI

**Product shutdowns** [O1]:

| Product | Change | Date |
|---|---|---|
| Agent Builder | shuts down | 2026-11-30 |
| Evals | read-only | 2026-10-31 |
| Evals | shuts down (migration path: Promptfoo) | 2026-11-30 |
| Reusable prompts | shut down | 2026-11-30 |

**Agents SDK** (version 0.23.1 [X15]).
- **Basics:** handoffs, guardrails, sessions and tracing [O2].
- **Sandbox Agents:** a `Manifest`, local, Docker and hosted sandbox clients, and snapshots [O3].
- **Memory:** lessons from prior runs are consolidated into `MEMORY.md` [O4].
- **Approvals:** `needs_approval`, plus `RunState.to_json()` so an approval can wait indefinitely [O5].
- **Release notes:** programmatic tool calling (the model writes JavaScript), facts about whether a retry is safe to replay, and `approve_unsafe_replay` [O6].
- **April 2026:** OpenAI announced a "model-native harness" release [O15, U].

**Codex.**
- Subagents [O7].
- `/goal`, where the goal text is both the prompt and the completion criteria [O8].
- Record & Replay, which turns a demonstration into a skill [O9].
- Memories [O10].
- Auto-review, described as a "reviewer swap, not a permission grant" [O11].
- The Codex MCP server was removed in favour of the app-server [O12].

**OpenAI's view of the harness.**
- An OpenAI engineer is quoted as saying "Codex models are trained in the presence of the harness" [O13].
- A harness-engineering talk claimed "1M LOC… 0% human code, 0% human review" [O14].

### Google

**ADK 2.0** reached general availability on 2026-05-19 (Python), 06-30 (Go) and 08-21 (TypeScript). Agents are now nodes in a graph [G1].
- Code-defined workflows checkpoint automatically and skip finished sub-nodes on resume [G2].
- `RequestInput` provides human-input nodes [G3].
- `RoutedAgent` and `RoutedLlm` are experimental. They use a router function the developer writes, and fail over only before the first output [G4,G5].
- `ManagedAgent` wraps Google-hosted agents [G6].
- Rewinding a session keeps the undone steps in the log [G7].

**Other Google products.**
- **Gemini Enterprise Agent Platform** (2026-04-23) includes:
  - an Agent Runtime that runs for days;
  - Memory Bank;
  - an Agent Registry;
  - Agent Identity and Gateway;
  - Agent Optimizer, which "clusters real-world failures and suggests refined system instructions" [G8].
- **A2A 1.0.0** has moved under the Agentic AI Foundation [G9].
- **Gemini CLI** gained subagents [G10].

### LangChain, n8n, Zapier

- **LangGraph 1.2.14** [X15]:
  - Checkpointers and stores [L1].
  - Time travel has two modes [L2]. *Replay* re-executes the nodes, so LLM calls fire again. *Fork* uses `update_state` to create a branch.
  - A functional API with `@entrypoint` and `@task` [L3].
- **Deep Agents:**
  - Subagents launched from interpreter code through `task()`. This is in beta and triggered by the word "workflow" [L4].
  - `RubricMiddleware` [L5].
  - File memory with background consolidation [L6].
- **LangSmith Insights** clusters failure modes [L7].
- **n8n:**
  - The AI Workflow Builder is metered in credits [L8].
  - Outside agents can build and edit workflows through n8n's MCP server (n8n 2.13 or later) [L9].
  - Agents are in preview [L10].
- **Zapier and Make:** Zapier folded Agents into Zaps, and Make's agent builder is in beta [L11, U].

### Durable-execution engines

- **Temporal:** its OpenAI Agents integration is generally available. Model calls run as Activities and are "not repeated during Workflow replay". Shell and computer tools are not supported [D1].
- **Restate** journals LLM calls and tool calls [D2].
- **DBOS** (Postgres or SQLite): `fork_workflow()` restarts a copy of a run from a chosen step. Its documented use is moving a failed run onto fixed code [D3].
- **Pydantic AI** supports eight durable backends. Each model request and tool call becomes its own durable unit, and "Durability is not storage" [D4].
- **Inngest AgentKit** provides routers [D5].
- **Cloudflare Agents** gives each agent a durable identity, SQL storage and Code Mode [D6].

### Other frameworks and products

- **Microsoft Agent Framework 1.0**, generally available since 2026-04-03 [X4]. It provides:
  - type-checked graph and functional workflows;
  - checkpoints at each superstep;
  - declarative YAML;
  - a Harness Agent with OpenTelemetry (OTel) tracing on by default [X1–X3].
- **CrewAI Flows:** `@router`, and `@persist` with a choice of resume or fork [X5].
- **Mastra:** steps typed with Zod schemas, suspend and resume, and step replay [X6].
- **Letta Skill Learning:** +36.8% relative improvement on Terminal-Bench 2.0. No check of a skill before it is reused is described [X7].
- **smolagents** (CodeAgent) [X8], **Dify** [X9], **OpenHands SDK** [X10].
- **Factory Missions:** plans milestones, creates skills, and runs QA on each feature. Factory recommends an Agent Readiness level of 4 or higher [X11].
- **Devin:** playbooks are versioned and refined by humans [X12].
- **Manus:** Wide Research [X13].

### Protocols and standards

- **MCP spec 2026-07-28** [P1,P2]:
  - The protocol is now stateless. The `initialize` handshake is gone, servers implement `server/discover`, and each request carries its capabilities in `_meta`.
  - A server can return `input_required` and get the answer on a retry of the same request.
  - Tasks moved out of the core spec into an extension.
  - Sampling, Roots and Logging are deprecated.
  - Trace context (`traceparent`) travels in `_meta`.
- **MCP Tasks:** a durable `taskId`, and `tasks/get`, `tasks/update` and `tasks/cancel` [P3].
- **MCP Registry:** in preview, and it stores metadata only [P4].
- **Agent Skills spec:** has no version, hash or signature fields [P5].
- **OTel GenAI conventions** (still in Development status): `invoke_workflow`, `invoke_agent` and `execute_tool` spans, and a `gen_ai.evaluation.result` event [P6,P7].
- **AGENTS.md:** governed by the Agentic AI Foundation under the Linux Foundation, and used by more than 60,000 projects [P8].

### Discourse

- Cognition moved from "Don't build multi-agents" [R1] to "writes stay single-threaded and the additional agents contribute intelligence rather than actions" [R2].
- 12-factor agents [R3].
- **Automated harness search:** Meta-Harness [R4] and GEPA [R5].
- An ongoing argument that scaffolding gets absorbed into model weights [R6, U].

## (a) Capability matrix

● = a central feature · ◐ = partial · ○ = absent from the docs I fetched · ? = not verified

| System | Agent writes it at run time | Reusable library | Typed contracts | Durable replay / fork | Cross-run learning / performance records | Router | Self-healing | Verification gates | Audit / provenance | Effect / authority model |
|---|---|---|---|---|---|---|---|---|---|---|
| CC dynamic workflows [A1,A8] | ● Claude writes JS | ◐ saved `/name`, plugins | ◐ schema per agent | ◐ replays the prefix; no fork | ○ (plugin eval gives an offline Δ) | ○ | ○ | ◐ in-script checks, `/goal` | ◐ script saved per run | ● permission modes, hooks, sandbox |
| Claude Managed Agents [A11–A16] | ◐ coordinator | ● versioned, pinned | ○ | ◐ log + `wake` | ◐ memory, dreams | ◐ advisor model | ○ | ● rubric grader | ◐ server-side only | ● vaults, $ caps |
| OpenAI Agents SDK [O2–O6] | ◐ programmatic tool calling | ○ | ◐ structured output | ◐ `RunState`, snapshots | ◐ MEMORY.md | ○ | ○ | ◐ guardrails | ◐ traces | ● approvals, path grants |
| Codex [O7–O12] | ◐ subagents; demo → skill | ◐ skills | ○ | ◐ thread resume | ◐ memories | ○ | ○ | ◐ `/goal` | ◐ | ● sandbox, auto-review |
| ADK 2.0 + Agent Platform [G1–G8] | ○ developer code | ◐ Registry | ? | ● auto-checkpoint, rewind | ◐ Memory Bank | ◐ developer function | ◐ Optimizer suggests fixes | ◐ evals | ◐ Agent Identity | ◐ Gateway |
| LangGraph / Deep Agents / LangSmith [L1–L7] | ◐ `task()` | ◐ Fleet, skills | ◐ typed state | ● replay + fork | ◐ memory, Insights | ○ | ◐ diagnosis only | ● rubric, online evals | ● traces | ◐ interrupts |
| n8n [L8–L10] | ◐ builder, MCP edits | ● | ? | ? | ○ | ○ | ○ | ◐ evaluations | ◐ execution history | ◐ human approval for tools |
| Temporal / DBOS / Restate [D1–D3] | ○ | ○ | ◐ code types | ● replay; DBOS fork | ○ | ○ | ◐ fork onto fixed code | ○ | ● event histories | ◐ step semantics |
| MS Agent Framework [X1–X4] | ○ | ◐ YAML | ● typed edges | ● checkpoints | ○ | ○ | ○ | ◐ evaluator loops | ● OTel | ◐ approvals |
| Mastra / CrewAI [X5,X6] | ○ | ○ | ● Zod (Mastra) | ● resume; fork | ◐ memory | ◐ code router | ○ | ○ | ◐ | ○ |
| Letta [X7] | ◐ skills from past runs | ● skills in git | ○ | ? | ● skill learning | ○ | ◐ reflection | ○ | ◐ git | ? |
| Factory / Devin [X11,X12] | ● plans + new skills | ◐ playbooks | ○ | ? | ◐ | ○ | ◐ QA self-correction | ● QA per feature | ? | ? |
| **Foundry today** [F] | ◐ generator at design time | ◐ content-addressed heads, no search | ● typed IR | ● SQLite + hash chain; ○ no fork | ○ | ○ | ◐ manual repair | ● independent oracles | ● hash-bound receipts | ● host-owned registry, `uncertain` state |

## (b) The white space

None of the roughly 25 systems whose docs I fetched documents any of the following.

**W1. Performance records for reusable orchestration artifacts.** No system keeps per-version outcome statistics and uses them when choosing what to run. Such records would cover success rate per task category, cost, wall time, number of trials (K), a confidence interval and the grader type. The closest anyone gets:
- Plugin eval gives an offline Δ, with no history tied to a script hash [A8].
- Managed Agents emits outcome events per session on versioned agents, but the docs describe no aggregation [A12,A16].
- Letta's gains appear in a blog post, not as records per skill [X7].

**W2. Routing between harnesses.** Today's routers pick *models*: by community spend [X14], by a developer-written function [G4,G5], or through an advisor [A13]. Nobody routes between competing *harnesses* based on the owner's measured outcomes. The candidates are a Claude Code workflow, a Codex `/goal` run, a Managed Agents outcome session and a local loop. Nobody records each choice's selection probability, which is what you need to evaluate the router afterwards from logged data.

**W3. Workflows that are typed, agent-written and callable by hash.** Orchestration written by agents is untyped code [A1,L4,O6]. Typed graphs are written by developers [X2,X6,G1]. No system lets an agent produce a workflow that is statically checked for schemas, side effects and budget, and then called by its content hash.

**W4. Self-healing confirmed by counterfactual replay before promotion.** Today's loops do one of these things:
- revise the *output artifact*, not the harness [A12,L5];
- suggest new prompts [G8];
- cluster failures [L7];
- fork a run by hand [D3];
- optimize offline [R4,R5].

None runs the full loop:
1. Classify the failure as a flake, model variance, a harness defect or the environment.
2. Intervene node by node on recorded outputs.
3. Replay the patched version on the failing case plus a regression set.
4. Promote it with evidence.

**W5. Evidence semantics.**
- No grader records how independent it is: whether it executes something, uses a different model, or uses the same model as the author.
- No system separates "the harness was built correctly" from "the task outcome was achieved".
- Nothing mechanically stops the authoring agent from editing its own oracle. Anthropic's rule that the agent may only flip the `passes` field is an instruction in a prompt, not an enforced mechanism [A19].

**W6. Vendor-neutral authority and provenance.** Each vendor's permission system covers only its own agent [A1,O5,O11]. None offers a local, hash-chained ledger that the user can verify. Such a ledger would bind each approval to the exact tool, arguments and workflow hash across vendors. It would also treat `uncertain` as a proper state for side effects that cannot safely be retried. OpenAI's replay-safety facts are the closest thing, inside one SDK [O6].

**W7. A portable harness package.** Skills have no hash or version fields [P5], and Claude Code workflows only run in Claude Code [A1]. No format bundles a workflow with its outcome contract, eval cases, performance record and provenance.

## (c) What the labs will likely close within about 12 months, and what is defensible

**Likely closed (60% or more).**
- **Workflow resume and fork.** Anthropic documents the rerun limitation itself [A1], and it already runs durable logs with `wake` [A17].
- **Outcome gates inside workflows.** Rubric-style graders already ship in three Anthropic products [A8,A9,A12].
- **Eval suites for saved workflows.** Workflows already ship inside plugins, and plugins already have Δ evals [A1,A8].
- **Model routing within one vendor** [A13,O7].
- **Memory consolidation and budgets** [A14,A15,O4].

**Partly closed (30–60%).**
- Score history per agent version in vendor consoles.
- Clustered failures turned into suggested fixes. Google already ships this [G8].

**Defensible (under 30% chance the labs close it).**
- **W2, routing across vendors on private outcome data.** A lab's router will not send work to a rival's model, and OpenRouter optimizes for community spend, not your results [X14].
- **W6, authority and provenance held by the user.** Hosted lab runtimes keep state on their servers; that is why Managed Agents cannot offer zero data retention [A11,A17]. Local command-line tools keep plain transcripts [A1].
- **W5, independence labels.** The labs grade with their own models.
- **W4, counterfactual attribution.** It is research-grade, and lab effort is going into models that make scaffolding unnecessary [A17,A18,O13].
- **W3, typed composition, is defensible but exposed to the bitter lesson**, because the labs are betting on models that write code [A1,O6].
  - **Hedge:** accept JavaScript-style authoring, and record every executed dynamic graph as IR.
  - **Effect:** the IR becomes the ledger and the replay format, not the only way to author a harness.

**What this means for Foundry.** Shift its centre of gravity from how expressive the orchestration is to *measuring, choosing between and gathering evidence about vendor harnesses*. Treat each of the following as an interchangeable option behind Foundry's planned `agent` and `call` nodes:
- Claude Code workflows, which can run headless through `claude -p` and the Agent SDK [A1];
- Codex `/goal` runs;
- Managed Agents outcome sessions;
- OpenCode or Ollama loops.

**Quickest win.** Feed Claude Code runs into Foundry and score them:
- Ingest each run through the `SubagentStart`, `SubagentStop` and `TaskCompleted` hooks, using handlers of `type: "mcp_tool"` [A5]. First confirm that subagents spawned by a workflow actually fire these hooks.
- Hash the per-run script that Claude Code saves under `~/.claude/projects` [A1].

That gives saved Claude Code workflows the score history they currently lack, without rebuilding any orchestration.

## (d) Patterns and APIs to copy

1. **Claude Code workflow runtime** [A1]:
   - the `agent`, `pipeline`, `parallel`, `phase` and `log` functions and the `args` global;
   - nondeterministic globals that throw;
   - checking schemas for contradictions before an agent starts, with `MAX_STRUCTURED_OUTPUT_RETRIES`;
   - caps on agent count and concurrency;
   - `CLAUDE_CODE_WORKFLOW_PREFIX_STAGGER_MS` (it staggers fan-out so later agents reuse the prompt cache);
   - reporting "unverified" separately from "refuted".

   **Improve on it:** key replay on node, input hash and model id together, so that one failure does not rerun its siblings.
2. **Gate instructions by where they came from.**
   - A prompt that the script computed never counts as consent.
   - Triggers only fire on input marked `origin:{kind:"human"}`.
   - A teammate's message cannot grant approval [A1,A4].
3. **Outcome loop** [A12]:
   - `user.define_outcome`;
   - a grader that runs in its own context;
   - `span.outcome_evaluation_*` events;
   - a `max_iterations_reached` result.
4. **Budget object** [A14]:
   - Shape: `{type:"limit",max_list_cost:{amount:"125",currency:"USD"}}`, with amounts as whole-cent strings.
   - Checked between model calls.
   - At the cap the session pauses with `budget_reached` and accepts only events that settle work already in flight.
5. **Version pinning.** Roster entries `{"type":"agent","id","version"}` are snapshotted when the coordinator is created and delegate only one level down [A13]. This maps onto calling a harness by hash.
6. **Propose instead of mutating.** Dreams write a *new* memory store rather than editing the old one [A15]. Use the same pattern for library consolidation and repairs.
7. **The `claude plugin eval` format** [A8]. This matches RQ0, the roadmap's headline experiment comparing the same agent with and without a harness. Export Foundry's cases in this format. Its pieces:
   - graders of type `regex`, `tool_used`, `tool_order`, `file_exists`, `llm` and `baseline`;
   - three runs per case;
   - `--ablation with-without` for the with/without comparison;
   - `--max-cost-usd`;
   - `results.json` marked `partial:true` when a run is cut short;
   - each run isolated from the user's configuration.
8. **`DBOS.fork_workflow()`** [D3]. Adapt it as Foundry's `fork(run, node, patchedHash)`, the step that confirms a repair.
9. **Name three verbs explicitly.** LangGraph's replay re-executes nodes, while its fork creates a branch [L2]. Foundry should define:
   - *replay*: return the recorded outputs;
   - *resample*: draw a fresh sample with a new nonce;
   - *fork*: copy the run up to a node into a new run.
10. **Temporal's split.** Keep orchestration deterministic and run model calls as Activities that are never repeated on replay [D1]. That is the design for Foundry's `agent` node.
11. **ADK's failover and rewind rules.**
    - Fail over only before the first output.
    - Never re-select a route that has already been tried [G4].
    - A rewind appends to the log instead of deleting [G7].
    - `RequestInput` takes a `rerunOnResume` flag [G3].
12. **OpenAI's authority APIs** [O5,O6]:
    - `needs_approval` accepts a function, so approval can be decided per call;
    - `RunState.to_json()` keeps "always approve / always reject" decisions across serialization;
    - `SandboxPathGrant(read_only=True)`;
    - the rule that serialized state "never grants credential authority by itself";
    - `approve_unsafe_replay`.
13. **Codex auto-review.** Swapping in a reviewer never grants new permissions. After a denial, the agent is told not to work around it, and a per-turn circuit breaker stops repeated denials [O11].
14. **Migrate Foundry's stdio MCP server to the 2026-07-28 spec** [P2,P3]:
    - implement `server/discover`;
    - read capabilities from `_meta`;
    - use `input_required` for human nodes;
    - return Tasks from `foundry_run`, with `taskId`, `ttlMs` and `pollIntervalMs`;
    - drop Sampling;
    - forward `traceparent`.
15. **OTel output.** Emit `invoke_workflow`, `invoke_agent` and `execute_tool` spans and `gen_ai.evaluation.result` events. Pin the semantic-conventions version, since it is still in development [P6,P7].
16. **Package harnesses as skills.** Put `foundry.hash`, `foundry.contract` and `foundry.record` in the skill's `metadata`, and validate with `skills-ref` [P5].
17. **One writer per resource.** "Writes stay single-threaded" [R2]: allow only one agent that causes side effects per resource, and enforce this in the composition checker.
18. **Router cold start.** Copy OpenRouter's classifier over about 30 task types, plus allowed and excluded model patterns [X14]. Rank by the owner's measured outcomes instead of by spend.
19. **Turn a demonstration into a skill with a verification section**, as Codex Record & Replay does [O9]. Generalize it to turning a recorded trace into a candidate IR workflow.

## (e) What Foundry should not build (already commoditized)

- **A general agent loop or sandbox** [A7,O3,X3,L4,G1,X10]. The vendors train these loops together with their models [O13]. Call them rather than replacing them.
- **Visual builders and connector catalogs** [L8–L11]. OpenAI itself is shutting down its visual Agent Builder (deprecated 2026-06-03, shutting down 2026-11-30) [O1]. Freeze work on the n8n and LangGraph exports, because n8n's MCP server already lets agents build workflows natively [L9].
- **Distributed durable execution** [D1–D6]. Keep SQLite as the evidence core and use DBOS through an adapter if you need scale.
- **Memory stores** [G8,A15,X7]. AMP already covers memory.
- **Tracing UIs and general-purpose eval platforms** [L7,O1,A8]. Emit OTel instead, and build only the qualification rules.
- **Model gateways** [X14].
- **New protocols.** Use A2A, MCP Tasks, Agent Skills and AGENTS.md [G9,P3,P5,P8].
- **Plain LLM-judge rubric loops** [A12,L5]. The added value is binding them to hashes and labelling how independent each judge is.

## Sources

**Foundry (local)**
- F: /home/raed/Projects/workflow-foundry/{README.md, docs/ROADMAP.md, docs/ARCHITECTURE.md} [V]

**Anthropic** (all [V])
- A1: https://code.claude.com/docs/en/workflows
- A2: https://claude.com/blog/a-harness-for-every-task-dynamic-workflows-in-claude-code (2026-06-02)
- A3–A9: https://code.claude.com/docs/en/{sub-agents, agent-teams, hooks, skills, agent-sdk/overview, plugin-evals, goal}
- A10: https://code.claude.com/docs/llms.txt
- A11–A16: https://platform.claude.com/docs/en/managed-agents/{overview, define-outcomes, multiagent-orchestration, budgets, dreams, agent-setup}
- A17–A25: https://www.anthropic.com/engineering/{managed-agents, harness-design-long-running-apps, effective-harnesses-for-long-running-agents, multi-agent-research-system, effective-context-engineering-for-ai-agents, demystifying-evals-for-ai-agents, code-execution-with-mcp, how-we-contain-claude, building-effective-agents}

**OpenAI**
- O1: https://developers.openai.com/api/docs/deprecations.md [V]
- O2–O5: https://openai.github.io/openai-agents-python/{(index), sandbox_agents/, sandbox/memory/, human_in_the_loop/} [V]
- O6: https://github.com/openai/openai-agents-python/blob/main/docs/release.md [V]
- O7–O12: https://learn.chatgpt.com/docs/{agent-configuration/subagents, long-running-work, extend/record-and-replay, customization/memories, sandboxing/auto-review, codex-sdk}.md [V]
- O13: https://simonwillison.net/2026/Feb/22/how-i-think-about-codex/ (quotes Gabriel Chua of OpenAI) [V]
- O14: https://latent.space/p/harness-eng [V]
- O15: https://openai.com/index/the-next-evolution-of-the-agents-sdk/ [U; HTTP 403]

**Google** (all [V])
- G1–G7: https://adk.dev/{2.0, graphs/dynamic, graphs/human-input, agents/routing, agents/models/routing, agents/managed-agents, sessions/session/rewind}/
- G8: https://cloud.google.com/blog/products/ai-machine-learning/introducing-gemini-enterprise-agent-platform
- G9: https://a2a-protocol.org/latest/specification/
- G10: https://developers.googleblog.com/subagents-have-arrived-in-gemini-cli/

**LangChain, n8n, Zapier**
- L1–L3: https://docs.langchain.com/oss/python/langgraph/{overview, use-time-travel, functional-api} [V]
- L4–L6: https://docs.langchain.com/oss/python/deepagents/{dynamic-subagents, rubric, memory} [V]
- L7: https://docs.langchain.com/langsmith/insights [V]
- L8–L10: https://docs.n8n.io/build/{ways-of-building-workflows/ai-workflow-builder, ways-of-building-workflows/connect-to-n8n-mcp-server, build-and-manage-agents} [V]
- L11: Zapier and Make, search-result snippets only [U]

**Durable execution** (all [V])
- D1: https://docs.temporal.io/develop/python/integrations/openai-agents
- D2: https://docs.restate.dev/ai
- D3: https://docs.dbos.dev/python/tutorials/workflow-management
- D4: https://pydantic.dev/docs/ai/integrations/durable_execution/overview/
- D5: https://agentkit.inngest.com/overview
- D6: https://developers.cloudflare.com/agents/

**Other frameworks and products** (all [V])
- X1–X3: https://learn.microsoft.com/en-us/agent-framework/{overview, concepts/workflows, concepts/harness}
- X4: https://devblogs.microsoft.com/agent-framework/microsoft-agent-framework-version-1-0/
- X5: https://docs.crewai.com/en/concepts/flows
- X6: https://mastra.ai/docs/workflows/overview
- X7: https://www.letta.com/blog/skill-learning
- X8: https://huggingface.co/docs/smolagents/index
- X9: https://docs.dify.ai/en/use-dify/getting-started/introduction
- X10: https://docs.openhands.dev/sdk
- X11: https://docs.factory.ai/missions/overview
- X12: https://docs.devin.ai/product-guides/creating-playbooks
- X13: https://manus.im/blog/introducing-wide-research
- X14: https://openrouter.ai/docs/guides/routing/routers/auto-router
- X15: PyPI and npm registry metadata, checked 2026-10-06:

  | Package | Version |
  |---|---|
  | langgraph | 1.2.14 |
  | deepagents | 0.7.22 |
  | openai-agents | 0.23.1 |
  | claude-agent-sdk | 0.2.163 |
  | google-adk | 2.11.0 |
  | agent-framework | 1.20.0 |
  | pydantic-ai | 2.54.0 |
  | dbos | 3.2.0 |
  | temporalio-openai-agents | 1.1.0 |
  | @mastra/core | 1.74.0 |
  | @openai/codex | 0.160.1 |

**Protocols** (all [V])
- P1–P3: https://modelcontextprotocol.io/{specification/latest, specification/2026-07-28/changelog, extensions/tasks/overview}
- P4: https://modelcontextprotocol.io/registry/about
- P5: https://agentskills.io/specification
- P6–P7: https://github.com/open-telemetry/semantic-conventions-genai/tree/main/docs/gen-ai (gen-ai-agent-spans.md, gen-ai-events.md)
- P8: https://agents.md/

**Discourse and research**
- R1: https://cognition.com/blog/dont-build-multi-agents [V]
- R2: https://cognition.com/blog/multi-agents-working [V]
- R3: https://github.com/humanlayer/12-factor-agents [V]
- R4: https://arxiv.org/abs/2603.28052 (Meta-Harness) [V]
- R5: https://arxiv.org/abs/2507.19457 (GEPA) [V]
- R6: https://thesequence.substack.com/p/the-sequence-opinion-786-the-great and https://arize.com/blog/agent-harness-distillation/ [U]

I did not modify any repository files. The fetched pages are cached only in this session's scratchpad.
