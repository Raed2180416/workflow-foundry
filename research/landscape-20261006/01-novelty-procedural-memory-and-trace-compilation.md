# Novelty check: "Foundry as an agent JIT / procedural memory"

Prepared 2026-10-06. I fetched about 70 sources today. I tag an entry **[V]** when I fetched the primary page today and **[R]** when it is recalled and unverified. Vendor and README numbers are self-reported. No local files were changed.

## 1. Key findings

1. **The whole thesis loop is already published.** No single system covers general tasks, but within specific domains several systems implement nearly all of profile → compile → guard → deopt → recompile → library:
   - **PreAct** (GUI tasks, June 2026)
   - **GAC** (tool workflows, Aug 2026)
   - **Progressive Crystallization** (Microsoft production IT ops, July 2026)
   - **Skyvern Code 2.0** (web, March 2026)
2. **The "JIT" name and vocabulary are taken.** "Agent JIT Compilation" is an ICML 2026 paper. AgentJIT (PyPI, Sept 2026) ships guards with "speculative de-optimization". DeepJIT (Aug 2026) mines hot paths, promotes skills to flows and deoptimizes failing flows. A July 2026 essay, "Compiled Cognition", argues profile/guard/deopt for agents through partial evaluation. Pitching Foundry as "a JIT for agents" would now read as derivative.
3. **A direct competitor already works on the owner's own tools.** **etchplan** (created June 2026, Apache-2.0) captures Claude Code, Codex and opencode traces and mines recurring tool workflows. It compiles guarded plans, validates them on cases derived from the traces, and serves them through a draft → shadow → canary → served ladder. It has a drift kill-switch, an audit log and an MCP server. It refuses coding edit loops and one-off tasks by design.
4. **The cognitive lineage is real but 35–55 years old.**
   - STRIPS MACROPS with PLANEX (1972) already did the core of it: plans with parameters, preconditions checked during execution, resuming at the furthest step whose preconditions still hold, and replanning when none do.
   - Soar chunking (an impasse triggers deliberation, whose result becomes a rule) is the deopt-then-compile loop.
   - CogRec (Dec 2025) literally sends a Soar impasse to an LLM and turns the answer into a Soar rule.
   - "Procedural memory" is standard vocabulary: CoALA, Memp, LEGOMem, Hermes, Letta.
5. **The classic failure mode is the utility problem.** Learned macros can slow a system down because matching and retrieval cost grows (Minton). Plan reuse is not provably cheaper than generating a new plan (Nebel & Koehler 1995). The modern evidence repeats it:
   - Agentic Plan Caching (APC) reports "persistently low" hit rates on diverse workloads.
   - Muscle-Mem missed its cache 50–67% of the time on WebArena (measured by PreAct).
   - AWO cut LLM calls by only 5.6–11.9%.
   - GAC declined to compile anything on NESTFUL, API-Bank or BFCL because there was too little recurring evidence.
6. **Checking a procedure before you store it beats clever retrieval.**
   - In PreAct, verify-before-store was the dominant mechanism, worth 1.75–2.6 tasks per benchmark. Whether an LLM or a plain embedding picked the program made no difference.
   - In SkillsBench, skills the model wrote from its own priors gave no average benefit.
   - Skills grounded in traces and gated by execution did work: reSolve reached 74.9% against 60.1% for curated skills, and SkillRevise went from 36.05% to 61.63%.
7. **The size of the gain depends on what gets compiled.**
   - Replaying whole tasks that genuinely recur gives large wins: PreAct 8.5–13× faster, GAC 58.7% cheaper, Progressive Crystallization over 70% cheaper per incident, Skyvern 2.7× cheaper.
   - Meta-tools or text skills inside an agent loop give roughly 5–16% (AWO, Letta, ASI, SkillWeaver).
8. **Compiling the skeleton of a procedure while the model keeps the thinking has measured value.** SIGIL (July 2026) compiles prose skills into a typed IR that separates "model-owned cognition" from "code-owned mechanism". Step compliance rose from 56% to 86% and token use fell to 0.58×. This overlaps Foundry's "typed harness" claim, except SIGIL compiles from prose rather than from traces.
9. **The platform baselines lack the loop.** Claude Code workflows and skill-creator provide authoring, saving, parameters, offline evals and blind A/B tests. They have no runtime profiling, guards, deopt or runtime performance records.
10. **What I did not find anywhere:**
    - Classifying each fallback event (flake, model variance, harness defect, environment drift, out-of-distribution input, impossible task) and testing the cause by intervention before any repair.
    - A propensity-logged router evaluated off-policy that chooses between harness versions and the full agent.
    - Compiling harnesses that keep agent, search and verify nodes, learned from traces of exploratory tasks.
    - Checked composition of many compiled harnesses.

## 2. Entries

Format: name (date): mechanism. Results. Limits. What Foundry should adopt or avoid. URL. Tag.

### A. Near-full-loop compilers (closest prior art)

- **PreAct** (arXiv 2606.17929, June 2026)
  - Mechanism: compiles the first successful GUI run into a state machine: states carry checks on the screen, transitions carry actions. A program selector picks a program; replay checks each predicate before acting. Any mismatch hands control to the full agent. The agent's new trace is compiled into a new version, which is stored only if it re-runs cleanly from a reset environment and the benchmark's evaluator scores it a pass. It replaces the old version with the same signature.
  - Results: 8.5–13× faster with no per-step LLM calls. The store-time check is worth 1.75–2.6 tasks per benchmark (AndroidWorld, OSWorld, WebArena). Prompt wording, guardrails and selector type did not matter.
  - Limits: GUI only; assumes actions are idempotent; libraries don't transfer; relies on a benchmark oracle; WebArena needed a cache-miss fallback.
  - Adopt: the verify-before-store gate, and growing new branches from fallback traces.
  - https://arxiv.org/abs/2606.17929 [V]
- **GAC, "From Traces to Guarded Programs"** (Zenodo preprint, Aug 2026, Jazzx AI)
  - Mechanism: a compile-or-retire rule. Every tool argument must trace back to the input or an earlier tool result. Writes, approvals, handoffs and unknown effects are hard barriers. Compiled code is protected by input, output and environment guards. A finite-sample risk test (default bound 0.05) must pass before deployment. Otherwise it keeps the longest justified prefix or falls back to the unchanged agent.
  - Results: on 90 unseen cases from three GitHub workflow families, 90/90 correct against 89/90 for the agent, with 66.6% fewer model requests, 63.1% fewer tokens, 64.2% lower latency and 58.7% lower estimated cost. In a time-forward test on five more repositories it compiled four and refused one. It declined NESTFUL, API-Bank and BFCL.
  - Limits: small n; unreviewed.
  - Adopt: risk-bounded admission, prefix compilation and effect barriers.
  - https://exa.ai/library/publication/14shf2721vc [V through Exa's mirror; I did not fetch the Zenodo record]
- **Progressive Crystallization** (arXiv 2607.07052, July 2026, Microsoft Azure Networking)
  - Mechanism: three execution tiers. Type 3 is agent-run (10k–50k tokens), Type 2 is hybrid (1k–5k), Type 1 is deterministic (0 tokens).
    - 3 → 2 requires: ≥10 successful runs, zero safety violations, ≥90% identical action sequences and auto-generated acceptance tests passing.
    - 2 → 1 requires: ≥50 runs, ≥99% LLM consistency, a regression suite passing without the LLM, and human review.
    - A circuit breaker demotes on regression and re-promotes after clean runs.
  - Results: deterministic share rose from 0 to about 45% over 8 months; per-incident cost fell by more than 70% while volume doubled.
  - Limits: single author, single organisation, no public data or counterfactual baseline.
  - Adopt: explicit promotion and demotion criteria, and the Type 1:2:3 mix as a maturity metric.
  - https://arxiv.org/html/2607.07052 [V]
- **etchplan** (GitHub, created 2026-06-14, 29 stars)
  - Mechanism: mines traces from Claude Code, Codex and opencode. It learns guards and checks how parameters flow, then compiles guarded ExecutionPlans and validates them on replay cases taken from the traces. Plans move through shadow and canary stages before serving. A kill-switch fires when the fallback rate climbs. Writes sit behind mutation and idempotency gates. Every decision goes to an audit log.
  - Results (README, AppWorld, gpt-5.5): about 0.2 s against about 116 s, $0 against about $0.47, break-even at about 1.07 reuses.
  - Limits: no router across multiple routines, no repair loop; refuses coding loops.
  - Adopt: use it as a baseline arm. Its refusals mark exactly where Foundry would have to add value.
  - https://github.com/egoist-machines/etchplan [V]
- **Skyvern explore/replay and Code 2.0** (blog 2025-10-17; pull requests March 2026)
  - Mechanism: "compiles those learnings into deterministic Playwright", recording the intent behind each action. Recovery tries, in order, an alternate selector, one model query, then the original prompt. Code 2.0 caches a script per block and records a "fallback episode" when the script fails. An LLM script reviewer (triage plus a quality audit) publishes revised script versions. Branching uses `classify()` with time-based pruning of stale branches.
  - Results: run time 278.95 s → 119.92 s, cost $0.11 → $0.04. The docs claim 10–100× speedups.
  - Limits: web only. Revisions are checked by an LLM, not an independent oracle. The team's own stated gap is that each replay "fixes itself in isolation".
  - https://www.skyvern.com/blog/asking-ai-to-build-scrapers-should-be-easy-right/ and https://github.com/Skyvern-AI/skyvern/pull/4922 [V]
- **TraceCompiler** (arXiv 2608.02680, Aug 2026)
  - Mechanism: admits a dependency between tools only when a value can be traced uniquely to an earlier tool. Each binding is typed as a constant, user input, copied output, transform or **residual LLM decision**.
  - Results: dependency recovery at precision 0.928 and recall 0.943 over 15,775 edges, against 0.711 F1 for an adjacency baseline. A Venmo intent went from 34 calls to 11 and passed 15 of 21 held-out state tests; the failing fold escalated instead of acting. It refused an intent with an under-determined irreversible effect. The authors claim no net efficiency gain because compile cost was not measured.
  - Adopt: the binding taxonomy (residual LLM decisions map naturally to agent nodes).
  - https://arxiv.org/abs/2608.02680 [V]
- **DeepJIT** (2026-08-13, 2 stars)
  - Mechanism: hot-path mining (minimum 3 repeats), LLM compilation into skills or flows, ahead-of-time validation against the live tool registry. It promotes after ≥5 uses at ≥0.8 success, deoptimizes after ≥5 uses at ≤0.5 success, and garbage-collects artifacts unused for 14 days. No evaluation.
  - It shows that tiering with deopt is not novel.
  - https://github.com/fly3366/DeepJIT [V]
- **AgentJIT** (PyPI, 2026-09-11)
  - Mechanism: trace → DAG → generated Python with "speculative guards" (input types and None checks); deopts to the LLM on a guard or tool exception. Claims up to 100,000× speedup.
  - Avoid guards that only check input types.
  - https://pypi.org/project/agentjit/ [V]
- **Agent JIT Compilation** (arXiv 2605.21470, ICML 2026)
  - Mechanism: compiles a task into several code plans over cached reusable tools, statically checks each plan against tool pre- and postconditions, and picks the cheapest. A scheduler simulates latency to choose serial, parallel or hedged execution.
  - Results: 10.4× faster and +28% accuracy over Browser-Use; 2.4× faster and +9% over OpenAI CUA.
  - Limits (per an agentpatterns.ai summary of the paper): pays off only at about 5+ steps, with contracted tools and a stable UI.
  - Adopt: tool contracts (each step's postconditions must satisfy the next step's preconditions) for Foundry's composition checker.
  - https://arxiv.org/abs/2605.21470 [V]
- **SIGIL** (Zenodo, 2026-07-22, U. Michigan)
  - Mechanism: compiles a prose SKILL.md into a typed AG-IR harness.
  - Results: across 30 skills and two model generations, compliance with mandated steps rose from 56% to 86%, full completion happened 2.3× as often, and tokens fell to 0.58×.
  - https://zenodo.org/records/21499104 [V]

### B. Record/replay, caching and compilation without a full loop

- **Muscle Mem** (May 2025): a "behavior cache". A check has two parts (capture the environment, compare it) and decides whether a cached trajectory may be reused; a miss goes to the agent. Dormant since June 2025. https://github.com/pig-dot-dev/muscle-mem [V]
- **Stagehand caching and self-heal** (docs v3/v4)
  - The cache key is the instruction, page content and options, with the model deliberately excluded. A hit threshold must be reached before the cache serves results.
  - `selfHeal` re-infers a broken selector once and rewrites the cache entry.
  - The docs claim about 20–30 s and about 50k tokens on a first run, versus about 2–3 s and 0 tokens on later runs.
  - https://docs.stagehand.dev/v3/best-practices/deterministic-agent [V]
- **Workflow Use:** recorded or agent-generated workflows with extracted variables. Its README calls its own fallback "really bad" and the project "very early". https://github.com/browser-use/workflow-use [V]
- **Unbrowse:** resolves an intent through a 5-minute route cache, then a marketplace ranked 40% similarity / 30% reliability / 15% freshness / 15% verification, then live capture. A 6-hour verification loop deprecates a skill after 3 consecutive failures. https://github.com/mfasiltvpz/unbrowse (fork) [V]
- **AgentRR** (2505.17716): experiences at several levels of abstraction. "Check functions" (flow integrity, state preconditions, data constraints, safety invariants) act as the trusted base. Only one case study, no metrics. https://arxiv.org/abs/2505.17716 [V]
- **Agentic Plan Caching** (2506.14852): plan templates keyed on exact keywords; on a hit a small LM adapts the template. 50.31% lower cost, 27.28% lower latency, 96.61% of optimal accuracy. Limits: cold start, keyword collisions, low hit rates. https://arxiv.org/abs/2506.14852 [V]
- **Loop Skill Engine** (2605.14237): one-shot recording becomes a branch-free, parameterized replay for periodic tasks. 93.3–99.98% fewer tokens per month, 8.7× lower latency. https://arxiv.org/abs/2605.14237 [V]
- **Compiled AI** (2604.05150): an LLM generates code once into validated templates. 96% on BFCL with zero runtime tokens; breaks even at about 17 transactions; 57× fewer tokens at 1,000 transactions. Driven by specifications, not traces. https://arxiv.org/abs/2604.05150 [V]
- **Agentic Compilation** (2604.09718): one-shot compilation to a JSON blueprint. 80–94% compile success at $0.002–$0.092 per compile. https://arxiv.org/abs/2604.09718 [V]
- **AWO meta-tools** (2601.22037): 5.6–11.9% fewer LLM calls, up to +4.2 percentage points success. https://arxiv.org/abs/2601.22037 [V]
- **WorkflowGen** (2604.19756): routes by similarity threshold to reuse, rewrite or start fresh. Reports more than 40% fewer tokens, but the comparison is described as "qualitative". https://arxiv.org/abs/2604.19756 [V]
- **UiPath Healing Agent** (generally available May 2025): cascaded runtime recovery. It "does not permanently fix the code"; fixes become recommendations for a developer to review. https://docs.uipath.com/agents/automation-cloud/latest/release-notes-ha/may-2025 [V]
- **ECLAIR** (2405.03710): baseline RPA costs 12–18 months of setup, starts at 60% accuracy and needs multiple full-time maintainers. https://arxiv.org/abs/2405.03710 [V]

### C. Workflow and skill induction, procedural memory

- **AWM** (2409.07429): text workflows. +24.6% and +51.1% relative success on Mind2Web and WebArena. [V]
- **ASI** (2504.06821): program skills checked by re-execution. +23.5% over the static baseline and +11.3% over text skills; 10.7–15.3% fewer steps. [V]
- **SkillWeaver** (2504.07079): skills as APIs. +31.8% relative on WebArena, +39.8% on real sites; up to +54.3% when transferred from strong to weak agents. [V]
- **Voyager** (2305.16291): self-verified code skill library. 3.3× more items, milestones up to 15.3× faster. [V]
- **Text-memory family** (all [V]). These condition the agent; they never compile anything.
  - ExpeL: no headline numbers.
  - AutoManual: ALFWorld 97.4%.
  - Synapse: MiniWoB++ 99.2%.
  - Learn-by-Interact: +12.2% with in-context examples, +19.5% with training.
  - ReasoningBank: up to 34.2% relative, 16.0% fewer steps.
- **TroVE** (2401.12869): toolboxes induced by use, grow and trim. 79–98% smaller toolboxes. [V]
- **Memp** (2508.06433): procedural memory with build, retrieve and update stages.
  - ALFWorld test with GPT-4o: 42.14% → 77.86%.
  - Memory built with GPT-4o and moved to Qwen2.5-14B: +5% on TravelPlanner.
  - Depends on benchmark reward signals. [V]
- **Agent KB** (2507.06229): smolagents pass@3 55.2% → 73.9%. [V]
- **LEGOMem** (2510.04851, AAMAS 2026): memory placed at the orchestrator matters most. No headline numbers in the abstract. [V]
- **Mobile-Agent-E** (2501.11733): "Shortcuts" carry an explicit precondition. +22.1% absolute over prior state of the art. The model sometimes misread the screen and fired shortcuts in invalid states. [V]
- **The 2026 verification wave** (all [V]):
  - SkillGen (2605.10999): treats skills as interventions and runs each instance with and without the skill, counting repairs and regressions.
  - Skill-Pro (2602.01869): skills have activation and termination conditions plus score-based maintenance.
  - reSolve (2608.28638): solve-and-reproduce, re-executing the frozen result in a fresh container.
  - SkillRevise (2606.01139).
  - WebXSkill (2604.13318): a "grounded" mode replays the program, a "guided" mode has the agent follow the steps, which works as a soft deopt.

### D. Tool creation and platforms

- **LATM** (2305.17126): GPT-4 makes tools and GPT-3.5 uses them, framed as a "functional cache". Same performance as GPT-4 in both roles at lower cost. [V]
- **CREATOR** (2305.14318). [V]
- **ToolMaker** (2502.11705): 80% of 15 tasks. [V]
- **Alita** (2505.20286): 75.15% pass@1 on GAIA validation. [V]
- **AgentDistill** (2506.14728): MCP boxes made by a teacher agent, reused by a smaller student. [V]
- **Live-SWE-agent** (2511.13646): 77.4% on SWE-bench Verified. [V]
- **Agent Skills** launched 2025-10-16. The open standard at agentskills.io followed on 2025-12-18 and was adopted by Codex, VS Code, Cursor and others. Neither defines guards or performance records. [V through secondary sources]
- **skill-creator** (2026-03-03) adds evals, benchmarks of pass rate, time and tokens, blind A/B comparators, and description tuning on a held-out split. https://claude.com/blog/improving-skill-creator-test-measure-and-refine-agent-skills [V]
- **Claude Code dynamic workflows** (docs) [V]:
  - Claude writes the script, calling `agent`, `pipeline`, `parallel` and `phase`.
  - Scripts can be saved and take `args`; `Date.now` and `Math.random` throw.
  - On resume, a failed agent reruns along with every agent started after it.
  - Limit of 1,000 agents per run.
  - No guards, score history or provenance.
- **Code execution with MCP** (2025-11-04): agents save working code to `./skills`. [V]
- **Hermes Agent:** creates skills on its own and improves them in place; no verification documented. [V]
- **Letta Skill Learning** (2025-12-02): +15.7 points absolute on Terminal-Bench 2.0. It was evaluated on all 89 tasks with no held-out split described, so leakage is likely. [V]
- **SkillsBench** (2602.12670): curated skills add 16.2 percentage points, 16 of 84 tasks got worse, and self-written skills helped by about zero. [V]
- **Meta-Harness** (2603.28052): an offline outer loop over harness code. [V]

### E. Classical and cognitive lineage

- **STRIPS MACROPS and PLANEX** (Fikes, Hart & Nilsson 1972, AIJ 3:251–288). The original guard-and-deopt-with-re-entry design. [V]
- **Soar chunking** (Laird, Rosenbloom & Newell 1986). [V]
- **ACT-R production compilation** (Taatgen & Lee 2003). Small, constrained rules, avoiding the "macroprocedure" explosion that is expensive to match. [V]
- **The utility problem in explanation-based learning:**
  - MORRIS (IJCAI-85): keep plan fragments only if frequently used or helpful on hard subproblems. [V]
  - PRODIGY tracked empirical utility and discarded rules whose utility went negative. [V through a secondary source]
- **Plan reuse versus plan generation** (Nebel & Koehler 1995). [V]
- **Dynamic deoptimization in Self** (PLDI 1992). [V] Trace-based JIT (Gal et al. 2009). [R]
- **CoALA** (2309.02427): writing procedural memory is "significantly riskier" than episodic or semantic memory. [V]
- **CogRec** (2512.24113). [V]
- **Wray, Kirk & Laird** (2505.07087), proposing knowledge compilation for LLM agents. [V]

## 3. Verdict

The thesis is **undercut as stated** and only **partially supported**.

| Thesis element | Taken by |
|---|---|
| JIT metaphor and vocabulary | Agent JIT (ICML'26), AgentJIT, DeepJIT, Chen essay |
| Profile → compile → guard → deopt → recompile → library | PreAct (GUI), Skyvern (web), GAC and etchplan (tool workflows), Progressive Crystallization (IT ops) |
| Typed or verified harness | SIGIL (typed IR from prose), TraceCompiler (typed bindings), GAC (risk test), PreAct (store gate) |
| Router | PreAct selector, WorkflowGen thresholds, APC keywords, Unbrowse scores |
| Performance records and tiering | DeepJIT, Progressive Crystallization, PRODIGY, skill-creator benchmarks |
| Procedural-memory framing | CoALA, Memp, LEGOMem, Hermes; Soar and ACT-R; CogRec |

What still looks defensible, as far as this search found:

1. **Compiling agentic harnesses rather than action traces.** The compiled artifact keeps agent, search and verify nodes with budgets and outcome contracts, and is learned from traces in the exploratory domains Foundry targets (game loops, debugging). Those are exactly the cases where etchplan and TraceCompiler refuse to compile. SIGIL shows that compiling the skeleton helps, but only from prose.
2. **Causal self-healing.** Classify each fallback, test the suspected cause by intervention through record/replay, and admit a repair only after counterfactual replay on the failing case plus a regression slice, judged by an independent oracle. The neighbours each do one piece (PreAct's store gate, Skyvern's LLM triage, SkillGen's paired net effect, SkillTracer's failure attribution); none combine them.
3. **Auditable dispatch.** Propensity-logged routing between harness versions and the full agent, with off-policy evaluation. PreAct's null result on selectors means this has to prove it matters.
4. **Checked composition** of many cooperating harnesses (call-by-hash, budget algebra, effect classes). The other systems compile single routines.
5. **Evaluation discipline as a contribution.** Matched budgets that include compile and maintenance cost, time-forward held-out tests, and reported refusal rates. Only GAC comes close today.

Recommended framing: **"evidence-gated, causally repaired compilation of agentic harnesses"**, with Soar, ACT-R and PLANEX cited as lineage, not "agent JIT".

## 4. Design lessons

- **Guards**
  - Check state predicates in code before each step (PreAct, PLANEX), plus input, output and environment guards (GAC).
  - Never rely on an LLM's judgement of a precondition alone; Mobile-Agent-E's agent misread the screen and fired shortcuts in invalid states.
  - Treat writes, approvals and unknown effects as barriers (GAC), and refuse to compile under-determined irreversible effects (TraceCompiler).
  - After a fallback, re-enter compiled code at the furthest step whose preconditions still hold, as PLANEX did, instead of handing the whole task to the agent.
- **Admission**
  - Verify the frozen artifact from a reset environment with an independent evaluator (PreAct, reSolve).
  - Compare with and without the artifact on the same instances, counting regressions as well as repairs (SkillGen).
  - Bound the risk statistically (GAC).
  - Promote through shadow and canary stages (etchplan), using concrete thresholds such as Progressive Crystallization's ≥10 runs with ≥90% identical action sequences.
- **Invalidation**
  - Demote when the fallback rate rises (etchplan), when success drops to ≤0.5 after ≥5 uses (DeepJIT), or after 3 consecutive failures (Unbrowse).
  - Use circuit breakers with re-promotion (Progressive Crystallization) and time-based pruning of stale branches (Skyvern).
  - Garbage-collect unused artifacts (DeepJIT, TroVE).
  - Re-test harnesses on every model upgrade; skill-creator uses evals to detect when the base model has outgrown a skill.
  - Put the environment fingerprint, tool versions and model id into keys deliberately. Stagehand chose to leave the model out.
- **Parameterization**
  - Classify bindings using evidence of where each value came from (TraceCompiler).
  - Diff at least two runs with different inputs to find what varies (derive-client).
  - Separate an abstract interface from per-environment implementations (PolySkill [V, abstract only]).
  - Keep the intent of each step so recovery is possible (Skyvern).
- **Repair**
  - Pool fallback episodes across runs before revising; Skyvern names per-run isolation as its own gap.
  - Make repairs proposals that someone reviews (UiPath).
  - Patch nodes locally rather than re-inducing the whole procedure (SkillTracer).
- **When compilation hurts**
  - Short tasks (fewer than about 5 steps), unstable interfaces, untyped tools, weak code generation (Agent JIT).
  - Low recurrence (APC, GAC refusals).
  - A base agent that is already efficient (Nebel & Koehler).
  - Library match cost growing (the utility problem).
  - Free-text coding loops (etchplan).
  - Programs that replay to the end yet do nothing (PreAct's 100% coverage, 0 score case).
  - Prompt injection learned into skills (SkillHarness cut unsafe learned skills by 57.1%).
  - Skills written from the model's priors (SkillsBench).
  - The agent itself keeps getting cheaper, so every break-even point drifts.
- **Router:** start with a simple selector and route at task level. TRACE-Router argues the unit of routing should match the unit of feedback. Fund verification before routing sophistication.
- **Roadmap fix:** the roadmap's B9 row lists arXiv 2607.22465 as "ORACLE", but that ID is **TRACE-Router** (Raj et al., July 2026) [V].

## 5. Open questions

1. Can recurring *decision structure* (hypothesise → test → backtrack) be mined from traces when the action sequences differ? That is the core of RQ7.
2. What false-accept and false-deopt rates come from each kind of guard, and how should the risk bound be set for each class of effect?
3. Does attribution-gated repair beat simply recompiling from the fallback trace (PreAct's approach) on monotonic library improvement?
4. When does routing beat a nearest-neighbour selector?
5. How should verify-before-store work for non-idempotent effects?
6. When should a harness be retired because the agent alone is now cheaper?
7. Is H0's target of "≥30% cheaper on follow-up tasks" realistic? It is in range for whole-task recurrence (GAC −58.7%, APC −50%) but far above what sub-task reuse delivers (AWO and Letta, about 10–16%). The design of the task families will decide the outcome.

**Not verified:**
- GAC's Zenodo page itself (I read it through Exa's mirror).
- The original Agent Skills launch post (date taken from secondary sources).
- Gal et al. 2009 and Anderson 1982.
- The SkillTracer full citation (I only saw an ACM DL DOI).
- All vendor and README speed and cost claims (Stagehand, Skyvern, etchplan, AgentJIT, Unbrowse), which are self-reported.
