# Red team: Workflow Foundry's maximalist vision (2026-10-06)

Tags: **[V]** = verified: fetched 2026-10-06 (primary source). **[V2]** = verified: fetched 2026-10-06 from a secondary report, because the primary was blocked. **[R]** = recalled, unverified. **[L]** = read today in the local repo. **[calc]** = my arithmetic, with assumptions stated.

## Verdict

The maximalist version is a mistake as scoped. That version is a general meta-harness plus a router, self-healing and cooperating harnesses, "more advanced than Claude Code workflows".
- Most of it has already shipped from the labs or been commoditized by funded incumbents.
- The rest (outer-loop harness evolution, attribution-driven healing) is research where better-resourced groups are ahead and results are mixed.
- It is being built governance-first, on two unproven sibling substrates, with one synthetic positive result.

One narrow claim survives and can be tested cheaply: guarded procedure caching with deoptimization back to the agent, for recurring tasks that have executable oracles. Measure it by amortized cost and by the rate of silent false reuse, and build it on top of vendor runtimes. Run that test within 4–8 weeks. If it fails, stop.

## 1. Bitter lesson: the platform absorbs the harness

**For the attack**
- **Time horizons keep compounding.**
  - METR's Time Horizon 1.1 puts the doubling time at 131 days since 2023 and 89 days since 2024 ([METR](https://metr.org/blog/2026-1-29-time-horizon-1-1/)) [V].
  - Claude Mythos Preview's 50% horizon is "likely at least 16 hours" ([Wikipedia](https://en.wikipedia.org/wiki/METR)) [V].
  - METR says measurements above 16 hours are unreliable on its current task suite ([METR](https://metr.org/time-horizons/)) [V].
- **The labs now ship the harness themselves:**
  - Claude Code dynamic workflows. Claude writes the orchestration script, which can be saved as a reusable `/command`, distributed in a plugin and resumed. `ultracode` plans a workflow for every substantive task. The documented patterns include "keep fixing until a check passes" and looping until rounds stop finding anything new ([docs](https://code.claude.com/docs/en/workflows)) [V].
  - Auto memory is on by default, so Claude records its own "learnings and patterns" ([docs](https://code.claude.com/docs/en/memory)) [V].
  - Agent Skills, including `skill-creator`, became an open standard in December 2025 ([Claude](https://claude.com/blog/skills)) [V]. Codex, Cursor, Copilot, Gemini CLI and OpenCode support it ([agentskills.io](https://agentskills.io)) [V]. Foundry's skill packs use this same SKILL.md format [L].
  - Code execution with MCP cut one example from 150k to 2k tokens, and agents can save working code as reusable skills ([Anthropic](https://www.anthropic.com/engineering/code-execution-with-mcp)) [V]. Programmatic Tool Calling cut tokens by 37% ([Anthropic](https://www.anthropic.com/engineering/advanced-tool-use)) [V].
  - The API now has server-side compaction and context awareness ([docs](https://platform.claude.com/docs/en/build-with-claude/context-windows)) [V]. GPT-5.1-Codex-Max is OpenAI's "first model natively trained to operate across multiple context windows" ([Willison quoting OpenAI](https://simonwillison.net/b/9158)) [V2].
  - Claude Managed Agents provides checkpointing, tracing and credential management. In research preview it adds multi-agent coordination and self-evaluation against success criteria ([IT Brief](https://itbrief.com.au/story/anthropic-launches-claude-managed-agents-in-public-beta)) [V2].
  - Google ADK has a `LoopAgent` ([ADK](https://adk.dev/agents/workflow-agents/)) [V]. Microsoft Agent Framework has a "Harness Agent" and checkpointed workflows ([MS Learn](https://learn.microsoft.com/agent-framework/overview/agent-framework-overview)) [V].
- **In coding, minimal scaffolds are now enough.**
  - mini-SWE-agent is about 100 lines of agent code, scores ">74%" on SWE-bench Verified, and says "as LMs have become more capable, a lot of this is not needed" ([GitHub](https://github.com/SWE-agent/mini-swe-agent)) [V].
  - LangChain concedes: "As models improve, these guardrails will likely be unnecessary" ([LangChain](https://www.langchain.com/blog/improving-deep-agents-with-harness-engineering)) [V].

**Against the attack**
- **Harnesses still move scores a lot:**
  - With the model held fixed, LangChain went from 52.8 to 66.5 on Terminal-Bench 2.0 (same post) [V].
  - Meta-Harness beat hand-engineered harnesses on TB2, and on classification gained 7.7 points with 4x fewer tokens ([arXiv 2603.28052](https://arxiv.org/abs/2603.28052)) [V].
  - Poetiq's refinement harness scored 54% on ARC-AGI-2 at $30.57 per task. Gemini 3 Deep Think scored 45% at $77.16 ([BDTechTalks](https://bdtechtalks.com/2025/12/09/poetiq-arc-agi-2-solution/)) [V2].
  - Two harness settings took GPT-5.6 Sol from 13.3% to 38.3% on the ARC-AGI-3 public set ([Gigazine on OpenAI](https://gigazine.net/gsc_news/en/20260731-how-enabling-two-settings-tripled-arc-agi-3-benchmark/)) [V2].
- **Note who captured that ARC-AGI-3 gain:** the lab, through its own API features (retained reasoning and compaction). Chollet permits "general-purpose API settings" but bans harnesses custom-built for the benchmark ([Context Studios](https://www.contextstudios.ai/blog/arc-agi-3-measured-the-harness-not-just-the-model)) [V2].

**Net.** Harness gains are real, but they are short-lived and the vendors capture them. A general third-party meta-harness is the most exposed piece. "12–18 months" is generous, because most of it exists today. A harness built around one specific environment survives longer.

## 2. Already done, or crowded

| Vision piece | Already exists | Gap left |
|---|---|---|
| Agent writes a reusable workflow | Claude Code dynamic workflows [V]; n8n and LangGraph [R] | None on orchestration |
| Procedural memory | AWM, +24.6% and +51.1% relative ([2409.07429](https://arxiv.org/abs/2409.07429)) [V]; verified programmatic skills, +23.5% ([2504.06821](https://arxiv.org/abs/2504.06821)) [V]; Memp ([2508.06433](https://arxiv.org/abs/2508.06433)) [V]; Voyager [R] | None |
| JIT compile, guards and deopt | Muscle Mem, a "behavior cache" with capture/compare checks and agent fallback ([GitHub](https://github.com/pig-dot-dev/muscle-mem)) [V]; Workflow Use, "Deterministic, Self Healing Workflows (RPA 2.0)", "very early development" ([README](https://cdn.jsdelivr.net/gh/browser-use/workflow-use@main/README.md)) [V]; Stagehand cache with self-healing ([GitHub](https://github.com/browserbase/stagehand)) [V]; AgentRR, where check functions act as a "trust anchor" ([2505.17716](https://arxiv.org/abs/2505.17716)) [V]; Agentic Plan Caching, −50.31% cost and −27.28% latency ([2506.14852](https://arxiv.org/abs/2506.14852)) [V] | Non-browser domains, guards independent of the procedure, a false-reuse metric |
| Outer loop evolves harnesses | ADAS ([2408.08435](https://arxiv.org/abs/2408.08435)) [V]; AFlow ([2410.10762](https://arxiv.org/abs/2410.10762)) [V]; DGM, SWE-bench 20% to 50% ([2505.22954](https://arxiv.org/abs/2505.22954)) [V]; Meta-Harness, which is exactly ROADMAP's B5 [V] | Nothing a solo budget can outrun |
| Durable, auditable runtime | Temporal, $550M at a $12.55B valuation in Sep 2026 ([GS AM](https://am.gs.com/en-ae/advisors/news/press-release/2026/temporal-raises-550m-ai-infrastructure-demand)) [V]; Microsoft Agent Framework [V]; Claude Managed Agents [V2] | A local-first niche only |
| Router | GPT-5's real-time router ([Wikipedia](https://en.wikipedia.org/wiki/GPT-5)) [V]; RouteLLM ([2406.18665](https://arxiv.org/abs/2406.18665)) [V]; LLMRouterBench finds that several routers, commercial ones included, "fail to reliably outperform a simple baseline" ([2601.07206](https://arxiv.org/abs/2601.07206)) [V] | Low expected lift |
| Visual builder and evals | OpenAI shuts down Agent Builder on 2026-11-30 ([notice](https://community.openai.com/t/deprecation-notice-agent-builder/1382650)) [V], and Evals too ([mcp.directory](https://mcp.directory/blog/openai-agentkit-deprecation-2026)) [V2]; ClickHouse acquired Langfuse ([ClickHouse](https://clickhouse.com/blog/clickhouse-acquires-langfuse-open-source-llm-observability)) [V] | None. Even a lab is abandoning its visual workflow canvas |

Groups with more resources already hold the intersection. Qizheng Zhang co-authored both Meta-Harness and Agentic Plan Caching [V]. 2026 also has dedicated procedural-memory benchmarks: AFTER, EvoClawBench, Procedural Memory Under Change and Skill Misevolution (links in §3) [V]. What is left is a combination of existing parts, not a new component.

## 3. Workflow brittleness

**For the attack**
- **EvoClawBench (June 2026):**
  - Self-authored skills dropped DeepSeek-V4-Pro from 77.77% to 4.80% (PreSkill) and to 0.99% (PostSkill). The cause was "over-specific memory".
  - Token efficiency while learning fell as low as 0.2.
  - The paper's verdict: "selective and cost-sensitive, rather than an automatic benefit" ([alphaXiv 2607.09711](https://www.alphaxiv.org/abs/2607.09711)) [V].
- **Skill Misevolution (August 2026):** all 21 evolved configurations produced unsafe artifacts ([2608.12851](https://arxiv.org/abs/2608.12851)) [V].
- **Your own ledger shows the same thing.**
  - On a wrong-type follow-on, the skills arm scored 0/21, all 21 of them false successes. The baseline scored 7/21 (`/home/raed/Projects/workflow-foundry/docs/RESEARCH.md`) [L].
  - The procedure made the agent confidently wrong under shift, and a harness library multiplies exactly this failure.
- **Self-healing depends on failure attribution, and attribution is weak.** The best method reaches 53.5% at agent level and 14.2% at step level ([2505.00212](https://arxiv.org/abs/2505.00212)) [V].
- **Cooperating harnesses:**
  - Across 1,600+ traces, MAST finds multi-agent gains "often minimal" ([2503.13657](https://arxiv.org/abs/2503.13657)) [V].
  - Cognition recommends a "single-threaded linear agent" ([Cognition](https://cognition.com/blog/dont-build-multi-agents)) [V].
  - Anthropic's multi-agent system gained 90.2%, but used about 15x the tokens of chat and suits coding poorly ([Anthropic](https://www.anthropic.com/engineering/multi-agent-research-system)) [V].
- **Maintenance burden:**
  - Manus rebuilt its framework four times ([Manus](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus)) [V].
  - Workflow Use's automatic self-healing, which would rewrite the workflow file, is still a roadmap item [V].
  - EY's widely quoted figure is that 30–50% of RPA projects fail [R].

**Against the attack**
- **Learned procedures have held up under shift:**
  - AWM's advantage held, and grew from 8.9 to 14.0 absolute points, as the test distribution moved further away [V].
  - In AFTER, one refinement round adds 3.7–6.7 points ([2606.23127](https://arxiv.org/abs/2606.23127)) [V].
  - Across 32 controlled mismatch conditions, Procedural Memory Under Change found no observable interference when the task evidence was explicit ([2609.09774](https://arxiv.org/abs/2609.09774)) [V].
- **Production practice favours workflows:**
  - Most products billed as agents are "mostly deterministic code, with LLM steps sprinkled in" ([12-factor agents](https://github.com/humanlayer/12-factor-agents)) [V].
  - Microsoft: "If you can write a function to handle the task, do that instead" [V].
  - Anthropic: use workflows for well-defined tasks and agents where flexibility is needed ([Anthropic](https://www.anthropic.com/engineering/building-effective-agents)) [V].

**Net.** Compiled procedures win on well-defined, checkable, recurring tasks. They fail silently under shift unless the check is independent of the procedure. The "general" and "cooperating" parts of the vision sit on the wrong side of the evidence. Guarded reuse with independent oracles sits on the right side.

## 4. Complexity and solo-builder risk

- **The roadmap's own gap table** (`/home/raed/Projects/workflow-foundry/docs/ROADMAP.md` §2) [L]:
  - The agent node, call-by-hash, the router and composition/meta-harness are MISSING.
  - Real-world verification is THIN.
  - ARC/AMP integration is "Documented only. No code."
- **The sibling substrates** (§3) [L]:
  - ARC is not product-proven, because its effect/promotion transaction is not installed.
  - AMP has "0/72 cognition obligations accepted", with 2.6–19 s per compile.
- **The only model-in-the-loop success** is one synthetic objective, where the fault and the expected outcome were supplied (README) [L]. 10 of the 609 tests fail because a provenance pin rejects the installed OpenCode binary [L]. Today the assurance layer is the thing blocking the build.
- **Compute is ruled out.** AGENTS.md forbids paid model calls and model downloads [L]. The free-provider campaigns ended in HTTP 429s or in streams with no answer [L]. Under the current rules, the central claim cannot be measured at all.
- **The plan's scope** is 13 mechanisms (B1–B13), 6 research questions plus 5 exploratory hypotheses, milestones M1–M7 and owner decisions D1–D7 [L].
- **Your strongest result** attributes the lift to "host-side evidence enforcement, not better model reasoning" (RESEARCH.md) [L].
- **Outside evidence points the same way, though only indirectly.** I found no rigorous study of governance-first research programs.
  - Anthropic found the successful teams used "simple, composable patterns" [V].
  - Kapoor et al. call state-of-the-art agents "needlessly complex and costly" ([2407.01502](https://arxiv.org/abs/2407.01502)) [V].
  - In MIT NANDA's data, internal builds succeed about a third of the time, against about 67% for purchased tools ([Fortune](https://fortune.com/2025/08/18/mit-report-95-percent-generative-ai-pilots-at-companies-failing-cfo/)) [V].
  - Gall's law: a complex system that works evolved from a simple system that worked [R].

**Net.** Putting assurance first was honest. It has also used up the budget that should have produced one positive lift number. Three coupled substrates, none proven, multiply integration risk while the baseline improves every 3–4 months.

## 5. Economics

- **For the attack:**
  - At fixed capability, prices fall 9x–900x per year ([Epoch](https://epoch.ai/data-insights/llm-inference-price-trends)) [V].
  - Opus-class input went from $15 to $5 to $4 per million tokens (Opus 4.1, then 4.5, then 5.5). Cache reads cost 0.025–0.1x the input price and batch is 50% off ([pricing](https://platform.claude.com/docs/en/about-claude/pricing)) [V].
  - The baseline for "compile to save cost" is therefore not uncached Opus. It is the cheapest adequate model with caching and batch, which are config flags rather than a research program.
- **Against the attack:**
  - The top tier costs $10 input and $50 output per million tokens, and Claude 4.7 and later emit about 30% more tokens for the same text (same page) [V].
  - Agentic coding uses about 1,000x the tokens of code chat, and runs of the same task vary by up to 30x ([2604.22750](https://huggingface.co/papers/2604.22750)) [V].
  - Loops such as "play until solved" stay cost-sensitive. A realistic saving from reuse is about 50% (Agentic Plan Caching) [V].
- **Who pays:**
  - Buyers already spend on:
    - **Reliability.** Lightspeed on Temporal: "the demo is easy, production is hard" [V].
    - **Observability.** Langfuse counts 19 of the Fortune 50 as users [V].
    - **Compliance logging.** The EU AI Act's high-risk rules, including the Article 12 logging duties, now apply to Annex III systems from 2 December 2027 ([Gornitzky](https://www.gornitzky.com/eu-ai-omnibus-enters-into-force/)) [V2].
  - These buyers purchase from vendors with support and compliance, not from a private, local-first research repo.
  - MIT NANDA's "learning gap" shows real demand for systems that adapt [V].
  - The realistic payer is you: your recurring tasks, your research credibility and your Neural Core data.

## 6. The measurement trap

- **Public benchmarks are degrading:**
  - OpenAI stopped reporting SWE-bench Verified after finding 59.4% of 138 audited tasks flawed, plus contamination ([AI Weekly](https://aiweekly.co/alerts/openai-drops-swe-bench-verified-backs-pro-after-flaw-audit)) [V2]. It later flagged about 30% of SWE-bench Pro's 731 public tasks as defective ([AI Weekly FR](https://aiweekly.co/fr/alerts/openai-juge-swe-bench-pro-cass-et-retire-sa-recommandation)) [V2].
  - Infrastructure configuration alone moved TB2 scores by 6 points, and Anthropic says gaps under 3 points "deserve skepticism" ([Anthropic](https://www.anthropic.com/engineering/infrastructure-noise)) [V].
  - Flawed benchmarks misestimate performance by up to 100% relative ([2507.02825](https://arxiv.org/abs/2507.02825)) [V].
- **Cost.** HAL spent about $40k on 21,730 rollouts ([2510.11977](https://arxiv.org/abs/2510.11977)) [V], roughly $1.84 per rollout [calc].
- **Statistical power** [calc], at α=0.05 and power 0.8:
  - Detecting success rising from 60% to 70% needs about 354 tasks per arm unpaired, or about 155 paired at 20% discordance.
  - A 30% cost cut at parity needs about 31 paired instances if the log-cost SD is 0.7, or 62 if it is 1.0.
- **Against the attack.** The repo already has sealed splits, independent oracles and hash binding [L]. A seeded private simulator removes contamination and most of the variance.

**Net.** A solo budget cannot pay for a credible success-rate claim. It can pay for a claim about cost and latency at verified parity, on a private deterministic bed. That is the only headline you can defend.

## What survives

**(a) Steelman.** The narrowest valuable claim is about a guarded procedure cache for recurring task families that have an executable oracle. The cache works in five steps:

1. Record a verified agent run.
2. Compile it into a parameterized harness of deterministic steps.
3. Guard each step with pre- and post-checks that an oracle independent of the procedure evaluates.
4. Replay it with few or no model calls.
5. Deoptimize back to the agent when any guard fails.

The claim: compared with the strongest native setup (a saved Claude Code workflow on the cheapest adequate model with caching), this cuts amortized cost and wall time by at least 30%. Oracle-verified success does not drop. Silent wrong reuse stays at or below 1% on a predeclared shifted slice.

It is not obviously absorbed yet:
- Claude Code workflows replay *agents*, not compiled steps. The docs say there is "No direct filesystem or shell access from the workflow itself". On relaunch, a failed agent reruns every agent started after it [V].
- The workflows doc describes no score history, oracle independence or provenance [V].
- The productized caches (Muscle Mem, Workflow Use, Stagehand) target browser or computer use and rely on checks the author writes [V].
- Procedural Memory Under Change leaves open which conditions turn an applicability mismatch into a memory-caused error [V].

The moat is thin, though. A lab could ship "compile a workflow to a script with guards" in any quarter. The durable assets are the evaluation discipline, the dataset and the traces, not the runtime. The surviving version is explicitly not a general meta-harness, a router, a set of cooperating harnesses or a visual builder.

**(b) The five decisions that matter most**

1. **Substrate.** Own only the layer of guards, oracles and provenance. Use Claude Code workflows, the Agent SDK or Codex for execution and as the baseline. Do not compete with them.
2. **One bed.** Pick one recurring task family with an exact oracle plus a shifted slice: the seeded game simulator, or your own recurring repo chores with hidden tests. Freeze the breadth work: the 7 domain packs, the n8n/LangGraph exports and the UI.
3. **Compute (D1).** Amend AGENTS.md to allow a capped paid budget (about $300–1,500) or a local model. Three arms × 60 instances × 3 repeats is about 540 rollouts, roughly $1k at HAL's average [calc]. Without that change the project produces no evidence.
4. **Predeclared metric and kill rule.** Measure amortized cost and latency at parity, plus the false-reuse rate, against the strongest native baseline. Kill the project if the saving is under 30% or silent wrong reuse is over 2%.
5. **Sequencing.** Freeze ARC/AMP integration, the router, the meta-harness, automated healing and the outer loop until decision 4 passes. Neural Core gets these traces only after it passes.

**(c) Recommendation for the next 4–8 weeks**

- **Week 0 (3 days or less):**
  - Unblock the tests by allowlisting the verified v2.0.23 hash, as ROADMAP permits.
  - Decide D1.
  - Write a one-page preregistration covering the bed, the arms, K, the metrics and the kill rule.
- **Weeks 1–2:**
  - Build 40–60 instances plus 15–20 perturbed ones, with an execution oracle.
  - Record B0 (a plain headless agent) and B1 (a saved Claude-written workflow, rerun).
  - Freeze both by hash.
- **Weeks 2–4.** Build only this pipeline:
  - trace to parameterized harness;
  - guards that are independent of the procedure;
  - deoptimization back to the agent.

  Reuse the existing IR, runtime and version binding. Build nothing else.
- **Weeks 5–6:**
  - Run B0, B1 and the cache in a paired design with K≥30.
  - Report cost per solved task, wall time, success rate, deopt rate, silent false reuse and maintenance events.
- **Weeks 7–8. Decide:**
  - If it passes: write it up and ship it as a skill or plugin around Claude Code workflows. Only then consider healing.
  - If it fails: archive the runtime and keep the oracle and version-binding discipline as an eval harness for ARC and AMP.

**Stop now:**
- the router, bandit/off-policy evaluation and the surrogate;
- the composition algebra and the search/MCTS nodes;
- the outer optimizer and the blackboard;
- the n8n/LangGraph exports, the UI polish and the domain packs;
- the ARC/AMP seams.

These are the parts the evidence shows are already commoditized or have the lowest expected lift. At current progress rates, every month spent on them is spent against a stronger baseline.
