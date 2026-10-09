# Prime Agent: its principles, and which of them help Foundry

*2026-10-09, laptop session. Read-only study, $0, no model calls. The owner asked to "take the best principles from how
Prime Agent works and see if that helps us". Every Prime Agent claim is tagged with its source:*

- **[doc]**: shipped documentation in the release directory;
- **[py]**: shipped Python source (`prime-agent-runtime`, bundled skills);
- **[bin]**: a string literal or minified function body extracted from the compiled binary;
- **[cl]**: the shipped CHANGELOG;
- **[inf]**: my inference, not read anywhere.

*`$R` = `/home/raed/.local/share/prime-agent/releases/0.9.8-linux-x64-83fb…35e2/`. Exact paths, hashes and the extraction
method are in [INVENTORY.md](INVENTORY.md). The TypeScript source is not on this machine. The binary is a Bun executable
whose source map has no `sourcesContent`, so TypeScript behaviour is cited from docs and bundle strings, not from source
lines. Nothing here is a measurement; every Foundry number quoted comes from the cited file.*

## 0. Summary

1. Prime Agent 0.9.8 is a terminal coding and research agent. It is a hard fork of `pi-mono` and is built around a
   "recursive language model" (RLM) runtime. The model gets **one tool, a persistent Python REPL**. Files, shell, skills,
   MCP and sub-agents are all callables inside that kernel.
2. The design rule underneath is the one Foundry's P1 already states: **the model writes code, and the host owns
   authority.** Provider calls, budgets, child lifecycles, goal state and scheduling stay in TypeScript. The Python side
   is a shim that sends typed `host_request`s.
3. **Control flow is split.** The model writes the procedure (Python cells) one turn at a time. Code owns only the
   *continuation policy*: when to re-prompt, when to stop, which gates must pass, and how much budget remains.
4. **Sub-agents are asynchronous actors, not function calls.** `rlm.spawn` returns an admission handle. Results come back
   as messages, as files, or through `rlm.collect`, a typed fan-in with a timeout. Recursion depth defaults to 2. There is
   no per-child budget; child cost is attributed upward after the fact.
5. **There is no shared board.** Coordination runs over tree edges only (parent, siblings, children), through
   rate-limited messages, bounded read-only observation, progress notes and files.
6. **Verification is gate-based and shell-level.** Autonomous mode keeps going until user-supplied gate commands pass or
   a limit is hit. It refuses to re-run a failed gate on an unchanged workspace (a git fingerprint). Prime Agent has no
   typed judgments, shadows, oracle-free invariants or replay-proven promotion.
7. **Self-improvement ("continual harness", `/refine`) adopts model-proposed edits without any replay test.** It runs
   automatically every 25 turns and on compaction. Its safety comes from scope (local or global), versioning, before/after
   snapshots and one-command rollback. This contradicts Foundry's P7.
8. Most of Prime Agent is standard engineering, already present or planned in Foundry: journaling, idempotency,
   at-most-once scheduling, crash recovery, compaction and progressive skill disclosure. The parts that are uncommon and
   transferable are listed next.
9. **Transferable:** (a) the *inverted shape*: compiled code is a tool the agent calls, not a replacement for the agent
   (Foundry gap FRONTIER-GAPS G5); (b) per-child *settled envelopes* for fan-in, with no fail-fast; (c) *no-progress
   detection* before re-checking; (d) *quota parking* instead of faulting; (e) state that outlives the context window.
10. **Ranked bets (§5).**
    1. The inverted arm: the Haiku agent calls the compiled solver. About $6–10.
    2. Item-local deopt to a sub-agent instead of a whole-task deopt. $0 census, then about $3–6.
    3. A persistent interpreter workspace across the stream. About $6–10.
    4. `flow.call` composition with child envelopes, folded into BLOCKER row 25. About $3–8.
    5. Quota parking in `stream.mjs`. $0.

## 1. What Prime Agent is (one page)

**Lineage.** `@earendil-works/pi-coding-agent` 0.9.8, MIT, by Mario Zechner. It is a hard fork of `badlogic/pi-mono`,
now developed by Prime Intellect [doc README.md:13, :506–510; package.json]. Prime Agent calls the runtime "RLM-native"
[doc README.md:12]. A CHANGELOG contributor is `@alexzhang13` [cl :965]. [inf] The name and the design ("context lives in
a REPL; the model recurses through code") follow Zhang and Khattab's *Recursive Language Models* line of work. The docs
do not cite it.

**Processes** [doc architecture.md; daemon.md]:
- a client (TUI, print, JSON or RPC);
- a detached **supervisor** that owns routing, attachment, message delivery, health and command journals;
- one **worker process per root session tree**, which owns the `AgentSession`, its scheduler, its Python kernels and all
  RLM descendants;
- one **Python kernel per session**, speaking JSONL over stdio.

These processes exist for lifecycle and failure containment. The docs say twice that they are "not security sandboxes"
[doc architecture.md; rlm-runtime.md "Trust Boundary"].

**Tool model.** By default the model has exactly one tool, `ipython` [doc rlm.md:33; README "Then just talk"]. The
system prompt (bundle string starting `The \`ipython\` tool is a persistent Python REPL`) tells it:
- "Python is the orchestration language … Use `bash()` to invoke programs, not to write shell programs" [bin];
- `bash()` returns a background handle; finishing processes wake the agent with a notice [doc rlm.md:35–60];
- MCP servers are not tools. Each one is a Python package whose methods are bound from the server's tool list
  [doc README "MCP Integrations"];
- skills are Agent-Skills `SKILL.md` files, optionally Python-backed (`pyproject.toml` + `src/<import>/`), pre-imported
  into the kernel and called as `await <skill>.<fn>(...)` [doc rlm.md §3; py skill-creator/references/python-skills.md].

**How a multi-step task is represented.** Prime Agent has no plan object, graph or DAG. A task is:
- a transcript: an append-only JSONL tree with `id`/`parentId`, plus branches and compaction entries
  [doc session-format.md];
- kernel state: Python variables, helper functions and live handles, snapshotted to `kernel-state.dill` for revival
  [doc rlm-runtime.md "Session Artifacts"];
- optionally a **goal**: a host-held objective with a token budget that "the harness keeps prompting … until
  `goal.complete()`" [doc long-running-agents.md:197; py skills/goal];
- the **child registry**: an append-only spawn ledger [cl :640, :468].

The plan exists only in what the model writes into cells and notes [inf].

**Where control flow lives.**

| decision | owner | evidence |
|---|---|---|
| what to do next, loops, branching, which helper to write, whether to spawn | model, as Python cells | rlm.md §1 |
| whether to re-prompt after a turn ends (continuation) | host code: goal and autonomous policies | long-running-agents.md "Autonomous Mode"; [bin] decision reasons `gate_failed`, `missing_terminal_evidence`, `limit_reached` |
| whether the run may finish | host code: gates (shell commands) must exit 0 | usage.md:285; README:640 |
| limits | host code: continuations 3, turns 12, tokens 80k, 30 min by default; checked in that order | usage.md:272–285; settings.md:46–49 |
| child admission, depth, model resolution, deletion | host code | rlm-runtime.md "Child Execution" |
| when to compact or refine | host thresholds, plus a model "review gate" for auto-refine | compaction.md:32–41; [bin] auto-refine defaults |

**Sub-agents** [doc rlm.md §2; rlm-runtime.md]:
- `await rlm.spawn(prompt, name=..., model=?, thinking=?)` returns `{rlm_child_id, name, session_dir, model}` at
  admission. It "never waits for or returns the child's answer" [doc rlm.md:73].
- Each child is a full `AgentSession` with its own context, transcript and kernel under `sub-xxxxxxxx/`.
- A child inherits the model, tools, skills and retry policy.
- Unknown options and unavailable models fail. Nothing silently falls back [doc rlm-runtime.md:136].
- Results come back through `agent_message.send(..., receiver_role="parent")`, through files, or through
  `rlm.collect(targets, timeout_ms)`. `collect` returns per-child envelopes
  `{status ∈ queued|running|done|error|cancelled, settled, answer_preview, error, duration_ms, tool_use_count,
  replied_since_task}` and never steers the parent [py rlm/__init__.py `collect`; cl :329].
- `rlm.progress_note(msg)` (≤ 512 chars, about one per 10 s) shows in the parent's roster without a reply
  [py `progress_note`].
- The default maximum depth is 2: root, children, grandchildren [doc rlm-runtime.md:151].
- Kernel boots are bounded at `min(16, 2*cores)` [cl :981].

**Memory.** Three layers:
1. kernel variables, which survive compaction and kernel restore [doc rlm.md:35];
2. the transcript, which compaction summarises while keeping recent messages and the full file [doc compaction.md];
3. the **continual harness**: typed entries (`prompt`, `memory`, `skill`, `subagent`) with `scope` local or global,
   `version`, `reference`/`arguments` for skills, and a list of refinement events [py harness.py:170–200].
   - Local entries live in `session-artifacts/<id>/harness/`; global ones in `~/.prime/agent/harness/`
     [doc rlm-runtime.md:189].
   - The base system prompt is immutable; entries are supplemental [doc rlm-runtime.md:193].

**Verification.**
- Autonomous **gates**: shell commands that must pass before completion. A failed gate's bounded output is fed to the
  next continuation [doc usage.md:285].
- A failed gate is **not re-run** while the git fingerprint of the workspace is unchanged; the attempt still counts
  [bin `not rerun: workspace unchanged since previous failed gate`].
- In print mode, a run that ends on a limit without passing gates exits 1 [bin `Autonomous run stopped before terminal
  evidence`].
- There is nothing else: no judge layer, no output schema on children, no consensus.

**Budgets.**
- Session-level budgets only: autonomous (continuations, turns, tokens, wall clock) and goal (a token budget).
- `rlm.spawn` has no budget parameter [py `spawn` signature].
- Child usage is folded into the parent turn that spawned it (`child_usage_attributed`) [doc rlm-runtime.md:179].

**Failure recovery.**
- Worker crash: retries after 250 ms, 1 s and 5 s; after three failures the root is marked failed. Old process groups
  are reaped and a visible recovery marker is appended [doc daemon.md:38, :142].
- Uncertain mutations are never replayed [doc daemon.md:135–142].
- Scheduled ticks are claimed before delivery, so delivery is at most once [doc long-running-agents.md:170].
- Quota: a session waits for usage with backoff (1 s doubling to 5 min) or parks until the provider-reported reset.
  Parks are bounded (`maxParks` 8, 24 h each) [doc settings.md:207–214; cl :336].
- An optional `providerBackupModel` takes over, with logged transitions [cl :338].
- Child failures arrive as `[child-failed …]` or `[child-exited: no-reply|cancelled …]` notices [bin].
- A 25-minute keep-alive continuation lets a parent unblock hung children [doc long-running-agents.md:246].

**Nesting and parallelism.**
- The guidance is "Spawn independent children in separate calls and end your turn instead of awaiting completion"
  [bin system prompt].
- Python-backed skills may themselves call `rlm.spawn` [doc rlm.md §3], so a capability can own sub-agents.
- The inherited pi `subagent` extension adds file-defined agent profiles with single, parallel (≤ 8 tasks, 4 at once)
  and chain (`{previous}`) modes [doc examples/extensions/subagent/README.md].
- Peers: `rlm.create_session` starts another top-level session from a depth-0 daemon session. Roots are siblings
  [py `create_session`; bin system prompt].

**Configuration.** `settings.json` (global, then project), CLI flags, `SYSTEM.md`/`APPEND_SYSTEM.md`, `AGENTS.md`/`CLAUDE.md`
context files, skills/extensions/packages, and `subagentDefaultModel` [doc settings.md:20–25].

**Logging and replay.**
- Session JSONL is the durable record; `/tree`, `/fork` and `/clone` branch from any entry [doc README "Branching"].
- The daemon protocol replays events by `{generation, sequence}` cursor, with snapshots as the recovery baseline
  [doc agent-connection.md].
- A per-session `semantic-edges.jsonl` ledger tags every provider call with an idempotency key that stays stable across
  retries [cl :474].
- There is **no deterministic replay of model calls.** Recovery means "restore state and continue", not "re-execute with
  recorded answers" [inf from the absence of any record/replay surface in docs or CHANGELOG].

## 2. The principles, as testable design rules

Each rule is stated so that a test could fail it. "Unique" means uncommon among agent harnesses as of these docs [inf].
"Standard" means it is commodity practice (Claude Code, Codex, Temporal-style runtimes) and Foundry should not count it
as a lesson.

| # | Design rule | Evidence | Unique / standard |
|---|---|---|---|
| **A1** | The model has one programmable tool. Every capability (files, shell, skills, MCP, children) is a callable in one persistent interpreter, and results bind to variables rather than to context. | rlm.md:33–60; README "MCP Integrations"; [bin] ipython description | Standard in lineage (CodeAct; code-execution-with-MCP). Unusual as the *only* tool. |
| **A2** | Kernel state outlives the context window. Variables, helpers and handles survive compaction and restart (dill snapshots). Large data stays on disk or in variables, never in the transcript. | rlm.md:35; rlm-runtime.md "Session Artifacts"; [bin] "Compaction removes individual variables whose serialized form exceeds 16 MiB" | **Unique** (the RLM core). |
| **A3** | The host owns authority. Model-written code reaches state only through typed `host_request`s that the host validates; the kernel never calls providers. | rlm.md:148 "Host Bridge"; rlm-runtime.md:72; py goal/refine `__init__.py` | Standard (P1/ARC-style). |
| **A4** | Spawn is admission. A delegation returns a handle at once, and results come only through explicit replies, files or a typed fan-in. The parent never blocks on a child's answer. | rlm.md:73, :83; py `spawn`, `collect` | **Unique** among coding harnesses (Claude Code's Task tool blocks) [inf]. |
| **A5** | Fan-in returns one settled envelope per child. A failed or cancelled child yields an envelope, not an exception, and one failure never rejects the others. | py `collect` (statuses, `settled`); skills/agent-message "One failed delivery does not reject successful deliveries"; cl :47–52 | **Unique** in agent harnesses; standard in actor systems (`Promise.allSettled`). |
| **A6** | Recursion is bounded and fails closed. Depth ≤ 2 by default, child names unique among siblings, an explicit model or option is honoured exactly or the spawn fails, and nothing falls back silently. | rlm-runtime.md:136, :151; cl :162 | Standard. |
| **A7** | Cost is attributed up the tree. Each child's usage is folded into the parent turn that spawned it, and own and aggregate totals reconcile. | rlm-runtime.md:170–185 | Standard. Note the **absence** of budget carving. |
| **A8** | Continuation is a code policy with explicit stop reasons. After every turn, code decides continue or stop (`gate_failed`, `missing_terminal_evidence`, `limit_reached`, `not_needed`). Limits are checked in a fixed order. Hitting a limit is never success. | usage.md:285; [bin] decision function; print-mode exit 1 | **Partly unique** (the named reasons and the exit code). |
| **A9** | No progress means no re-check. A failed gate is not re-executed while the workspace fingerprint (status, diff, untracked hash) is unchanged; the attempt is charged anyway. | [bin] fingerprint and the "not rerun" message; usage.md:285 | **Unique**. |
| **A10** | Wake on events, not timers. While children or background processes run, timer-driven continuations are held; completion notices wake the parent; a slow keep-alive valve catches hangs. | long-running-agents.md:236–253; cl :166, :334 | **Unique** in this form. |
| **A11** | Communication follows tree edges. Messages reach only parent, siblings and direct children, with daemon-derived sender identity and size/rate/queue limits. Observation is read-only and bounded (≤ 50 messages × ≤ 2000 chars). There is no shared board. | skills/agent-message; skills/agent-observe; [bin] "deeper communication relays through the intermediate child" | **Unique** as an explicit restriction. |
| **A12** | Self-edits are scoped, versioned and reversible, but not tested. Refinements are small typed CRUD edits with rationale and `expectedOutcome`, behind an immutable base prompt, with before/after snapshots and one-command rollback. Adoption needs no replay or check. | rlm-runtime.md:189–193; [bin] refine planner and review-gate prompts, optimistic "entry changed during refinement planning"; cl :67 (the model-facing `record_refinement` was removed because it "added unverified ones") | **Unique** in shape; it **contradicts** Foundry P7. |
| **A13** | A cheap gate decides whether the expensive step runs. Auto-refine first asks a review gate "shouldRefine?" (≤ 4,096 output tokens) and runs the planner only if it says yes. Cadence: every 25 turns or on compaction, 20-minute cooldown. | [bin] auto-refine defaults; review-gate prompt | Standard pattern (cascade), unusual for self-edit. |
| **A14** | Quota exhaustion is a park, not a failure. Back off, park until the reported reset, bound the parks; an active goal survives the park. | settings.md:207–214; cl :32, :177, :336 | **Partly unique**. |
| **A15** | Effects and commands are at most once. Mutations are journalled before dispatch; uncertain ones are reported, not replayed; scheduled ticks are claimed before delivery; crash recovery reaps process groups. | daemon.md:135–142; long-running-agents.md:170 | Standard (Temporal/Restate/DBOS). |
| **A16** | Capabilities are disclosed progressively. Only skill name and description are in the prompt; full instructions load on demand; Python skills expose typed signatures (`help`, `inspect.signature`). | skills.md:132–137; [bin] "Read each skill's SKILL.md for its API" | Standard (Agent Skills). |
| **A17** | Context is private by default. A child gets only its task prompt; the parent gets replies and previews, never transcripts; compaction keeps kernel state. | rlm.md "keeps its own context focused"; agent-observe bounds | Standard (Anthropic/Cognition consensus). |

## 3. Mapping onto Foundry

Legend: **HAS** (cite Foundry file), **CONTRADICTS** (cite THESIS P# or THESIS-JIT §6 item), **LACKS** (with an entry
point and an experiment), **PARTIAL**.

The rules that apply to every experiment below are:
- preregister first (`research/jit-20261008/PREREG-stream.md` style);
- K = 2 streams per arm and family, with gaps under 3 points called noise (THESIS-JIT §4; HANDOFF §0);
- Haiku builds (`compile.builder` = `claude-haiku-5-5`);
- the bed oracle scores only the delivered answer and never reaches the system (`stream.mjs` header);
- seeds come from `SEED-LEDGER.json`;
- no new Claude Code Workflow fan-outs (owner rule, HANDOFF §0): runs go through `stream.mjs` as processes.

On seeds: 225–248 belong to R0 and 249–272 to BLOCKER row 3. A new bet either rides on R0's seeds as extra arms through a
PREREG amendment written *before* R0 starts, or gets a new ledger range. Dev 1–400 is also listed as `kev-probe-pilot`
reserved, so the coordinator must pick the range.

**A1, one programmable tool: PARTIAL.**
- Foundry already holds "the authoring surface should be code" (THESIS-JIT §2.2; B1-haiku 16/16 against F-haiku 11/16).
- The interpreter is Claude Code with its usual tools (`experiments/jit/interpret.mjs` via `experiments/lib/arms/b0-agent.mjs`).
- The compiled solver is a one-shot script on `flow-v2.mjs`.
- What Foundry does not have is the **inverted** use: the interpreter calling a compiled solver or helpers as a tool.
  That is FRONTIER-GAPS G5 (`FRONTIER-GAPS.md:425`, still open).
- Entry point: a new stream arm kind (bet 1, §5).

**A2, state outlives context: LACKS for the interpreter.**
- Each interpretation is independent and "never sees earlier traces" (`interpret.mjs` header). That is deliberate: it
  keeps shadows independent (THESIS-JIT §6.3).
- A persistent workspace would break shadow independence if the same interpreter also shadows, so shadows must stay fresh.
- Entry point: an `agent+ws:<model>` arm in `stream.mjs` whose workdir persists across tasks: `lib/`, `NOTES.md`, no
  traces, no oracle.
- This is FRONTIER-GAPS §3.14 arm 2 (Bet C). Prime Agent is a shipped instance of the shape, not evidence that it helps.

**A3, host owns authority: HAS.**
- P1 (`docs/THESIS.md:153`).
- `flow-v2.mjs` reaches models only through `callModel` and the gateway. Deopt is a host contract (exit 75 plus
  `deopt.json`, `flow-v2.mjs:39`, `:155–163`).
- Effects go through ARC's EffectPort (THESIS §8).

**A4, spawn is admission: LACKS, and mostly not needed.**
- `flow.map` (`flow-v2.mjs:229–240`) is synchronous and in-process; the engine's `agent` node kind exists
  (`schemas/workflow.schema.json:109`) but blocks too.
- Compiled solvers are short batch programs, so asynchronous handles add little [inf].
- They matter only if a node owns a *long* sub-agent (scenario §4b). Do not build this before bet 2 shows item-local
  sub-agents pay.

**A5, settled fan-in envelopes: LACKS.**
- `flow.map` is fail-fast: the first error is rethrown and the rest discarded (`flow-v2.mjs:235–240`).
- So one bad item in a 50-row map turns into a whole-task crash or deopt, and the interpreter re-solves all 50 rows.
- Entry point (flow-v3, opt-in, so no v1/v2 arm hash moves): `flow.map(items, fn, { settle: true })` returns
  `[{ ok, value } | { ok: false, error, deopt? }]`, plus a trace event per failed item. The solver then decides: deopt
  the task, or hand only the failed items to `flow.agent` (bet 2).

**A6, bounded fail-closed recursion: HAS (rule) / LACKS (primitive).**
- The rule: ROADMAP §6 rule 3, "No silent fallbacks: every escalation is an event" (`docs/ROADMAP.md:1148–1150`).
- `flow.judge` tiers are explicit and logged (`flow-v2.mjs:165–226`).
- The `call` primitive (depth 3, hard ceiling 8) is designed but unbuilt (`docs/ROADMAP.md:130`, `:190–202`).

**A7, cost attribution: HAS, and stronger.**
- `flow` charges every call from `calls.jsonl` and deopts on budget (`flow-v2.mjs:199`, `:205`).
- ROADMAP's `call` carves a strictly smaller child budget (`docs/ROADMAP.md:190–197`). Prime Agent has no carving.
- Foundry should keep carving and also copy Prime Agent's "own vs aggregate reconciles" accounting into the trace of any
  `flow.call`.

**A8, continuation as code with named stop reasons: HAS.**
- Termination is code: `flow.done`, exit 75, budget deopt (P1).
- The stream has named outcomes per row: `delivered` = compiled / adjudicated / interpreter, plus deopt kinds
  (`stream.mjs:951–965`).
- Prime Agent's "a limit is never success" corresponds to THESIS-JIT §1's finding that "acceptance was only `exists`".
  Foundry already learned that.

**A9, no progress means no re-check: LACKS.**
- In `compile.mjs` the builder runs `check-traces` itself, inside its session; the host check runs once afterwards
  (`compile.mjs:140`, `:217`).
- [inf] Builders probably re-run checks on unchanged `solve.mjs`. When judges are live, each re-run spends quota.
- Entry point: a $0 audit first. From R0's compile records (`versions/<v>/compile.json`, builder transcripts), count
  `check-traces` invocations whose `solve.mjs` sha matches the previous invocation's.
  - If that share is ≥ 10% of check spend, add the guard to the builder's tool wrapper: refuse and report "unchanged
    since last failed check".
  - Otherwise drop it.
- Not a ranked bet; it is $0.

**A10, wake on events, not timers: N/A.** Foundry streams are batch and never poll. Revisit only if `flow.agent` children
become long-running.

**A11, tree-edge communication and no board: HAS (by design choice).**
- P8 (`docs/THESIS.md:160`): "Share decisions and artifacts, never transcripts."
- ROADMAP refuses "free group chat between agents" and builds the run board only after a preregistered ≥ 15 %-per-dollar
  win over plain edges (`docs/ROADMAP.md:341`, `:783`).
- Prime Agent shipped a production fan-out system without a board. That is consistent with keeping the board gated.

**A12, untested self-edits: CONTRADICTS P7 and P6.**
- P7 (`docs/THESIS.md:159`): "Adaptations are proposals. Every promotion replays the failures plus a regression slice."
- P6: never evolve one global workflow. Prime Agent's `global_=True` edits do exactly that.
- THESIS §3 item 5: about 55 % of rejected self-edits broke something.
- THESIS-JIT §6.10: compiler self-improvement is adopted "only if it does better on held-out compile histories".
- Foundry's recompile already does the tested version (regressions plus reject-if-worse, `stream.mjs:333`).
- Worth copying: the *mechanics* around adoption.
  - An immutable base plus supplemental entries. Foundry's builder prompt plus the diagnosis log could be structured
    the same way.
  - Before/after snapshots with a one-step `rollback <id>`. A "durability rollback" would re-adopt the previous version
    when `durability.mjs` shows the new one's guard-fire or silent-miss rate is worse over a window. It is $0, an
    offline policy simulation on R0 data.

**A13, a cheap gate before an expensive step: PARTIAL.**
- The stream recompiles on a count (`recompileOnDeopts: 2`, `stream.mjs:32`), not on a cheap "is this worth it?"
  judgment.
- THESIS-JIT §6.2 ("verify decisions, not answers") is the same cascade idea applied to verification.
- No change proposed: a count is cheaper than a gate.

**A14, quota park: LACKS.**
- `src/models/port.mjs:66–71` maps usage-limit messages to `MODEL_RATE_LIMIT`.
- `experiments/lib/runner.mjs:19` counts it as an env fault: the task is faulted, not failed.
- Relaunching is manual (`experiments/jit/resume-streams.mjs`). The cloud session's run data was lost to exactly this
  stop (HANDOFF; `_local/WORKFLOWS-PAUSED.md`).
- THESIS-JIT §6.6: "The currency is quota."
- Entry point: in `stream.mjs`, an arm that hits `MODEL_RATE_LIMIT` parks.
  - It sleeps with backoff (1 s doubling, ceiling 5 min), or until a reset time parsed from the error.
  - It writes a `park` event with start, end and reason, and then retries **the same task**.
  - Parks are bounded (e.g. 8 per episode, 6 h each); past the bound it stops as today.
  - Not hashed, so no arm hash moves.
- **Do not** copy `providerBackupModel`. Switching the model mid-stream silently changes the arm, which conflicts with
  ROADMAP §6 rule 3 and with frozen arm hashes (`stream.mjs` header, "Not hashed" fields).

**A15, at-most-once effects: HAS.**
- `src/journal.mjs` (journal-before-observe).
- `src/runtime.mjs:129–141` (`effect.uncertain` on swept tasks with effects).
- `src/children.mjs` (process-group reaping after owner death).

**A16, progressive disclosure: HAS** (`skills/` uses Agent Skills; AGENTS.md "Layout").

**A17, private context: HAS** (P8; `flow.judge` sends only what code passes).

## 4. The owner's scenarios

Inputs not read in this study, so tagged **[ext]**:
- Kimi's agent swarm (a trained orchestrator that fans out to many sub-agents);
- Claude Code's dynamic Workflow tool (`agent()`, `parallel()`, `pipeline()`, `phase()`).

They are taken as the owner describes them; neither API nor any measurement of them was inspected here.

### 4a. Workflows nested inside workflows

**Prime Agent.**
- Nesting is recursive sessions: `rlm.spawn` inside a cell or a Python skill, depth ≤ 2 by default
  [doc rlm-runtime.md:151].
- Each child has its own transcript and kernel under the parent's artifact directory (`sub-xxxxxxxx/`), a durable
  registry and a tombstone on delete, and its usage is attributed to the parent turn [doc rlm-runtime.md].
- The parent–child interface is **untyped**: a prompt string goes in; a free-text message, files or an `answer_preview`
  envelope come out.
- There is no input/output schema and no budget per child.

**Smallest Foundry primitive: `flow.call(name, ref, input, { budgetUsd, schema })`** (flow-v3, opt-in).
- `ref` is a content-addressed sub-solver (`lib/<module>.mjs` with its own `flow` guards and invariants). It is in-process
  for code-only modules, or a subprocess when it calls judges.
- The child's budget is carved and strictly smaller (`docs/ROADMAP.md:190–197`).
- Its return is validated against `schema`.
- Its trace events are nested under `call:<name>#<ordinal>`, with own and aggregate cost.
- A child deopt propagates as `deopt.kind = 'call'` with `{ child: name, childDeopt }`. The heal localiser can then
  recompile one module (THESIS-JIT §6.7 composition; FRONTIER-GAPS I2).
- Depth limit 3, enforced at runtime.

What Prime Agent adds to ROADMAP's `call`:
- settled envelopes (A5) instead of exceptions;
- one cost record that reconciles own against aggregate (A7);
- a name that is unique among siblings, so trace ids stay stable for replay (`flow-v2` call-site ids already have this
  shape).

### 4b. Nodes that own their own sub-agents

**Prime Agent.**
- Any cell or Python-backed skill can spawn [doc rlm.md §3].
- Reusable delegation roles are stored as `subagent` entries in the continual harness [py harness.py `_KINDS`].
- `subagentDefaultModel` sets the child model when the spawn names none [doc settings.md:20–25].
- Children inherit tools and skills.

**Smallest Foundry primitive: `flow.agent(name, { tiers, prompt, files, schema, check, budgetUsd, maxTurns })`.**
- It runs one bounded interpreter session (the same `b0-agent` machinery the stream uses) on a *slice* of the task.
- The result must validate against `schema` and pass `check`, or it escalates a tier. If no tier passes, it deopts with
  `kind: 'agent'`.
- The transcript hash and cost go into the trace. Nested agents are 0 by default (`docs/ROADMAP.md:175`).
- This is the SDK form of the engine's `agent` node kind. It is what makes "deopt one item, not the whole task" possible
  (bet 2).
- It must not see the oracle, other tasks' traces or the regression set (`stream.mjs` header rule).

### 4c. Swarm-style fan-out with a shared board

**Prime Agent has no board.** Fan-out is many independent spawns ("end your turn instead of awaiting"). Fan-in is
`rlm.collect`, with `progress_note` for liveness and files on disk for artifacts. Communication follows tree edges with
rate limits [skills/agent-message; skills/agent-observe]. There are also concurrency caps on kernel boots [cl :981], and
the pi `subagent` extension's parallel mode caps 8 tasks with 4 at a time.

[inf] Mapping the owner's named functions onto Prime Agent:
- `agent()` ≈ spawn + collect;
- `parallel()` ≈ several spawns + one collect;
- `pipeline()` ≈ the extension's chain mode;
- `phase()` has no counterpart (closest: goal or autonomous continuations).

**Smallest Foundry primitive.** No new board. ROADMAP's `wide` operator already specifies the shape
(`docs/ROADMAP.md:207–211`):
- a planner emits a typed, bounded subtask list;
- code checks it for overlap and gaps;
- `flow.map` runs cheap typed workers;
- a code reducer combines their outputs;
- an independent `verify` checks the result.

Prime Agent contributes two concrete additions:
1. `flow.map(..., { settle: true })` envelopes (A5), so the reducer sees every outcome;
2. `flow.note`-style progress events, already in flow-v2 (`flow.note`).

If a shared board is ever built, Prime Agent's restrictions (sender identity set by the host, reach along tree edges,
size/rate/queue limits, bounded read-only observation) are a working spec for its injection and flooding tests
(`docs/ROADMAP.md:341`). The precondition stands: beat plain edges by ≥ 15 % per dollar, and beat best-of-K at equal
tokens (`docs/ROADMAP.md:784`). FRONTIER-GAPS H3 records the main evidence against swarms on sequential work.

### 4d. Self-healing

**Prime Agent has six mechanisms, none of them replay-validated.**

| mechanism | evidence |
|---|---|
| gate retry with no-progress suppression (A9) | [bin] gate fingerprint; usage.md:285 |
| bounded continuations | usage.md:272–285 |
| worker crash recovery | daemon.md:38 |
| quota park / backup model (A14) | settings.md:207–215 |
| child failure notices and keep-alive | [bin]; long-running-agents.md:246 |
| `/refine` model-planned harness edits, auto every 25 turns or on compaction, with rollback (A12) | [bin]; rlm-runtime.md:189–193 |

**Foundry already has the stronger loop** (HANDOFF §1; `stream.mjs`):
1. deopt to the interpreter;
2. shadow;
3. adjudication by majority (`stream.mjs:951–965`);
4. a regression case;
5. recompile with reject-if-worse (`stream.mjs:333`).

**Smallest additions taken from Prime Agent:**
- (i) the A9 no-progress guard on check re-runs;
- (ii) a version rollback record (A12 mechanics) driven by `durability.mjs` windows;
- (iii) quota parking (A14);
- (iv) item-local healing through `flow.agent` on settled-map failures (bet 2), so a heal can be local instead of a
  whole recompile.

Do not copy untested adoption.

## 5. Bets worth running first (ranked, at most 5)

Costs are Haiku list-price dollars. Each spends the owner's own usage. They are estimated from these per-task costs:
- Haiku agent about $0.10–0.12 per records task (THESIS-JIT §1: $0.111/trial; HANDOFF §2: 15/24 at $0.16/success);
- compiled runs $0.016–0.078 per task (THESIS-JIT §1);
- a static C0 24-task run about $1.2 (BLOCKER-SYNTHESIS row 21).

Every bet needs a preregistration note and a seed-ledger entry, and runs as `stream.mjs` arms, not as Workflow fan-outs.

### Bet 1: the inverted arm (the agent calls the compiled solver). Haiku about $6–10.

- **Principles:** A1 and A16; FRONTIER-GAPS G5.
- **Arm:** `agent+solver:<model>`. A Haiku interpreter gets the task plus `tools/solve.mjs` (a frozen solver), runnable
  as `node tools/solve.mjs task.json`, which prints an answer or exits 75 with `deopt.json`. The prompt says: use it,
  check its output against the task, and override it only with stated reasons.
  - Solver now: the static C0 records solver
    (`research/construction-20261006/artifacts/B1-haiku-records-k1/solve.mjs`, 16/24 in the dev stream, silent on d4).
  - Solver after R0: R0's adopted S/H version, frozen.
- **Bed:** records, d3 → d4 drift, 24 tasks, K = 2.
- **Comparators:** the Haiku agent and the JIT S/H arm on the same seeds.
- **Metrics:**
  - successes;
  - $/success;
  - silent misses (oracle-scored, experimenter view);
  - the override rate, and override accuracy.
- **Oracle:** never visible; the solver's answer is not ground truth to the agent.
- **Falsifier:** the inverted arm is within 3 points of the Haiku agent's successes, or has more silent misses than the
  static solver alone, or its $/success is ≥ the Haiku agent's. That would mean the agent neither catches the solver's
  errors nor saves cost.

### Bet 2: item-local deopt to a sub-agent. $0 census, then Haiku about $3–6.

- **Principles:** A5, plus §4b.
- **Stage A ($0, after R0, or now on a static C0 run of about $1.2):** from `deopt.json` and `trace.jsonl`, measure the
  share of deopts and crashes raised inside a `flow.map` worker for one item, against task-level guards.
  - **Kill if < 30 %:** whole-task deopt is the right unit.
- **Stage B:** flow-v3 opt-in with `map({ settle: true })` and `flow.agent` for the failed items only, each a Haiku
  session given the item, the SOP and the output schema. The solver merges the results.
- **Arm:** JIT S/H with v3 against JIT S/H with v2, records, K = 2.
- **Metrics:**
  - successes;
  - $/task;
  - interpreter calls per task;
  - silent misses on items healed by sub-agents.
- **Falsifier:** success drops ≥ 3 points, or $/task falls < 25 %, against v2.
- **Prerequisite:** an engine-freeze note, since a new SDK version changes the kit (ROADMAP rule 13).

### Bet 3: a persistent interpreter workspace. Haiku about $6–10.

- **Principles:** A2; FRONTIER-GAPS §3.14 arm 2.
- **Arm:** `agent+ws:claude-haiku-5-5`. One workdir persists across the 24 tasks in stream order. It may hold `lib/`
  helpers and `NOTES.md`. No oracle, no scores, no other arm's traces.
- **Comparator:** the Haiku agent (fresh workdir per task).
- **Bed:** records, K = 2.
- **Metrics:**
  - successes;
  - $/task;
  - second-half against first-half success (does the workspace compound?);
  - success after the d4 drift.
- **Falsifier:** within 3 points of the Haiku agent, and second-half $/task not lower by ≥ 20 %. The SkillsBench prior
  in FRONTIER-GAPS §3.14 predicts this falsifier will fire. It is cheap enough to settle.

### Bet 4: `flow.call` composition with child envelopes. Haiku about $3–8, folded into BLOCKER-SYNTHESIS row 25.

- **Principles:** A5 and A7; §4a.
- **Change:** row 25 (B12-E2) already refactors the records solver into `lib/{dates,phones,money,identity}.mjs` and
  applies one D1 fix in `identity.mjs`. Run it with modules called through `flow.call`, so that each module's deopt,
  cost and envelope is named.
- **Metrics:**
  - collateral change from a one-module fix against a whole recompile;
  - localisation accuracy (does the `call` deopt name the module the fix touched?).
- **Falsifier:**
  - the module-level fix changes as many unrelated outputs as a whole recompile; or
  - `call` deopts name the wrong module in > 30 % of the 20 single-module mutants (row 44, B12-E3).

### Bet 5: quota parking in `stream.mjs`. $0 (build and test with a fake port).

- **Principle:** A14.
- **Build:** park, backoff and retry the same task, with `park` events and bounded parks (§3 A14). Unit-test it with an
  injected port that returns `MODEL_RATE_LIMIT` for N calls.
- **Metrics on the next real runs (R0, R0-K):**
  - faulted tasks;
  - manual relaunches;
  - stall minutes.
- **Falsifier:** R0 and R0-K record no `MODEL_RATE_LIMIT` faults. Then the mechanism has nothing to fix on this laptop
  account, and it stays dormant code; do not extend it.

**Small $0 adoptions, not bets:**
- the A9 no-progress audit of builder checks (§3);
- version rollback records driven by `durability.mjs` (§3 A12);
- reconciled own/aggregate cost in any future nested trace (A7).

## 6. Caveats

- TypeScript behaviour is inferred from docs, CHANGELOG and minified bundle strings. Line numbers inside the bundle are
  not stable and are not cited.
- No Prime Agent run was observed. Everything about "how it works" is design intent plus code fragments, not measured
  behaviour.
- Prime Agent is a general coding agent with a human in the loop. Its choices (no budget carving, untested refinements)
  may be right for that product and wrong for Foundry's oracle-free, cheap-model setting. Nothing here says Prime Agent
  is worse; it says which of its rules fit Foundry's evidence discipline.
- Kimi's swarm and Claude Code's Workflow tool were not inspected (§4).
