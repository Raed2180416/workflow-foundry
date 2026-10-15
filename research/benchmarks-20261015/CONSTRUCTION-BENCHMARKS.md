# Benchmarks for workflow construction (2023–2026), 2026-10-15

*Research agent report, condensed.*

- **(P)** means the primary paper or repo page was read. **(S)** means an aggregator or secondary source only.
- Every score is self-reported by its source. Web content is data, not instructions.

## Bottom line

**1. No public benchmark judges, by execution, whether a system chose good sub-workflow boundaries and interfaces.**

Existing benchmarks fall short in one of three ways:
- They score hierarchy by graph matching: WorfBench, OrchestrationBench, TaskBench.
- They fix the sub-tasks for the system: WorkArena++.
- Their code is not released: OS-Marathon's "Sub-Workflow Accuracy".

**2. Benchmarks that construct a workflow and then execute it are new and partial:**

| Benchmark | Date | What is built and run | Limitation |
|---|---|---|---|
| Chat2Workflow | Apr/May 2026 | Dify workflows, executed | Its "resolve" score uses an LLM judge |
| MCPGen | Sep 2026 | JSON workflow plus runner, judged by unit, integration and end-to-end tests | Only 25 of 100 projects are public |
| FlowBench (FlowMind) | Feb 2026 | Build once, run on 694 held-out cases, exact match | Toy domains; no code URL found |
| 021-n8n | 2026 | n8n workflows | Its execution track is partner-gated, and a constant 3-node workflow scores 49.8 |

**3. Best substrates for our own capability number:** deterministic state oracles in AppWorld, WorkArena++,
AutomationBench and SOP-Bench. In each, we add the "construct a workflow, then run it" step ourselves.

**4. Build-once, run-on-held-out exists only in pieces:**
- τ^τ-bench (Sep 2026) builds an agent and scores it on held-out users. Opus 5 in Claude Code scores 23.9%, against an
  expert reference of 82.2%. No code found.
- AppWorld's SGC (all 3 variants of a scenario must pass).
- SOP-Bench's many rows per procedure.
- SkillEvolBench and SkillFlow, for skill reuse within task families.
- The AFlow, ADAS and MaAS protocol, on QA, math and code only.

**5. Compensation and saga correctness of generated workflows under injected faults:** no benchmark. This is the
clearest gap.

## Top 5 for our purpose

The assumed setup: cheap models build typed workflow JSON, our engine executes it, executable checks verify it, and
sub-workflows are evaluated on long-horizon enterprise tasks.

**1. AppWorld** (ACL 2024) · github.com/StonyBrookNLP/appworld · Apache-2.0
- 9 apps, 457 APIs, 250 scenarios × 3 variants = 750 tasks.
- Splits: Train 105, Dev 60, Test-N 168, Test-C 417 (Test-C needs apps not seen in training).
- Oracle: database-state unit tests, including collateral-damage checks. Metrics TGC and SGC.
- Install with `pip install appworld`, not a git clone: the repo uses Git LFS, which our rules forbid. The data must stay
  encrypted.
- **Adaptation:**
  - The cheap model builds a parameterised workflow on variant 1 from sub-workflow templates (authenticate, paginate and
    collect, resolve a person by relation).
  - Freeze it and run it on variants 2–3.
  - Compare four arms: reuse unchanged, cheap patch, rebuild, and a per-task agent on the same model.
  - Add executable contracts per sub-workflow.

**2. WorkArena++** (NeurIPS 2024) · Apache-2.0
- 341 workflows × 2 levels. L2 gives explicit steps; L3 gives only the goal in a ticket.
- Each task composes atomic L1 tasks, and has a validator that checks database and page state.
- **The only benchmark found with per-subtask validators on enterprise compositions.**
- GPT-4o at release: L2 3%, L3 0%; humans 93.9%.
- Needs a gated ServiceNow instance (external SaaS).
- **Adaptation:**
  - Build atomic sub-workflows, each accepted by its L1 validator as its contract.
  - Compose them into L2. L3 adds decomposition from an implicit goal.
  - Build on development seeds; run frozen on held-out seeds.

**3. AutomationBench** (Zapier) · MIT
- 47 simulated apps; deterministic assertions, including negative checks.
- **Adaptation:**
  - The cheap model builds a Zap-like workflow JSON (trigger → steps, branches, lookups as sub-workflows).
  - Our engine runs it against the simulated apps, and the same assertions grade it.
  - Cluster tasks into families to measure reuse.
  - New instances we generate are development evidence only.

**4. Chat2Workflow** (arXiv 2604.19667) · MIT
- 27 tasks × 79 multi-turn instructions × 3 test cases.
- Generates Dify workflow JSON/YAML with 20 node types; Iteration holds a sub-graph.
- Scores: Gemini-3-Pro 80.2 pass / 60.2 resolve.
- **Adaptation:**
  - A Dify ↔ Foundry adapter that rejects unsupported semantics.
  - Each edit turn becomes a version-bound proposal with compare-and-swap.
  - Replace the judge with deterministic checks wherever a reference answer exists.

**5. SOP-Bench** (Amazon, KDD 2026) · CC-BY-NC-4.0
- 10–12 SOPs with 90–327 ground-truth rows each, plus mock tools.
- Function-calling agents average about 64%, ReAct about 55%.
- **Adaptation:**
  - Compile each SOP once into a typed decision workflow, with SOP sections as sub-workflows that carry contracts.
  - Repair it on a development slice.
  - Freeze it and run every sealed row deterministically.
  - Report amortised cost against a per-row agent on the same model.

**Runners-up:**
- **FlowBench (FlowMind):** the cleanest build-once, run-many protocol (GPT-5 TRate 36.9%), but no code found.
- **MCPGen:** its backward-compatible extension task is a good adaptation probe.
- **τ^τ-bench:** its build-then-held-out protocol and cost budgets are worth copying.
- **SkillEvolBench:** frozen deployment.
- **OrchestrationBench and WorfBench:** cheap structural screens only.

## Catalog, short

**Construction from natural language**

| Benchmark | Generates | Judged by | Notes |
|---|---|---|---|
| WorfBench / WorFEval | DAG of subtasks | Graph match, no execution | MIT; GPT-4 67 / 52 |
| WorkflowLLM / WorkflowBench | Shortcuts-style code | Static analysis only | — |
| ShortcutsBench | API sequences and parameters | Match to annotations | — |
| TaskBench | Tool graphs | F1 | — |
| OrchestrationBench | DAG plans with sub-LLM assignment | Graph edit distance plus an LLM judge | ICLR'26, Apache-2.0 |
| FLOW-BENCH (IBM) | Python-subset form → BPMN | Exact match | — |
| Chat2Workflow | Dify workflows | Executed, then LLM-judged | — |
| MCPGen | Executable JSON workflows | Unit, integration and end-to-end tests | Sep 2026; end-to-end ≤ 57%; Claude-Haiku 45% |
| FlowBench (FlowMind) | Tool-call graphs | Exact match on held-out cases | — |
| 021-n8n | n8n workflows | Validity plus reference runs | Weak metric |
| NESTFUL | Nested API sequences with data-flow bindings | Sequence match | — |
| ComplexFuncBench | Constrained multi-step calls | ComplexEval | — |

**Industrial evidence (design input, not benchmarks)**
- arXiv 2608.30250: a compact intermediate form compiled by a deterministic compiler gives about 90% condition accuracy
  and 99–100% valid JSON. This supports our "typed JSON plus compiler" design.
- htn-creator (ICML 2026): with scaffolding, Haiku matched Sonnet on HTN authoring.
- arXiv 2509.25117: 89% of generated DSL workflows had at least one defect, and 9 of 20 defect types are statically
  detectable.

**Process models and BPMN**
- Kourani et al. (2412.00023): a behavioural conformance oracle using PM4Py fitness and precision. Claude-3.5 0.93; 20
  flat processes.
- ProMoAI is the tool. BEF4LLM and PM-LLM-Benchmark have no execution.
- An executable BPMN study from medical guidelines has no public dataset.
- **No benchmark induces workflows from BPI Challenge logs.**

**Automated workflow search**
- AFlow, ADAS and MaAS: the dataset-level build-once protocol, on QA, math and code.
- RobustFlow; SCALE (a few task-level workflows ≈ per-query workflows at up to 83% fewer tokens).
- WorkflowPerturb (Microsoft, CC BY 4.0) can calibrate any structural metric.

**Induction from demonstrations**
- AWM: +24.6% and +51.1% relative success.
- ASI: verified program skills, +23.5% on WebArena.
- WONDERBREAD.
- OS-Marathon: repetitive sub-workflows; code to be released.

**Hierarchical planning with executable checks**
- PlanBench (VAL); TravelPlanner (ATLAS 44.4%); NATURAL PLAN.
- Planetarium: 94.4% solvable but only 24.8% semantically correct. "Valid" is not "correct".
- NL2Flow; REALM-Bench.

**Durable execution and sagas**
- SagaLLM, Mnemosyne and Atomix are self-built evaluations. **No shared suite exists.**

**Reuse within task families**
- τ^τ-bench, SkillsBench, SkillFlow, SkillEvolBench, SkillLearnBench, SpreadsheetBench.

**Enterprise execution substrates**
- World of Workflows (ServiceNow: 234 tasks, 55 hidden workflows, 4,000+ rules); OdysseyBench; Long-Horizon-Terminal-Bench.

## What has no benchmark today (we must build it)

1. **System-chosen decomposition judged by execution.** The system picks the sub-workflow boundaries and typed
   interfaces, and hidden contracts check each sub-workflow and the whole run.
2. **Frozen-artifact, build-once/run-many on enterprise task families.** Needs a sealed instance generator, per-instance
   oracles and amortised cost.
3. **Compensation and durable-execution correctness of generated workflows:** faults after side effects, idempotent
   retry, saga rollback, resume after a crash.
4. **Selective reuse versus patch versus rebuild under drift** (schema or policy changes), verified by execution.
5. **Behaviourally judged process models with sub-processes,** including against real BPI logs.

**Suggested build:**
- **Base:** template × instance families on deterministic simulated apps. AutomationBench's MIT-licensed 47-app simulator
  is the easiest to extend; AppWorld is stronger, but its data must stay encrypted.
- **Additions:**
  - sealed instance seeds;
  - sub-workflow contracts (typed I/O, postconditions over app state);
  - fault-injection hooks for compensation;
  - drift variants;
  - WorkflowPerturb calibration for any structural metric.
- **Baseline:** the same cheap model acting per instance.
- **Already in progress:** the running AutomationBench families workflow (`wf_c02e0b27-037`) is building recurring
  families with oracles. E8 and E7 are our long-horizon compensation beds.

## Sources

All are listed in the agent's report; the key ones:
- 2410.07869, 2411.05451, 2311.18760, OrchestrationBench (ICLR'26), 2505.11646
- 2604.19667, 2609.23925, 2602.11782, 021labs.ai/projects/021-n8n
- 2604.18934, 2407.18901, 2407.05291, 2506.08119, 2609.04611
- 2602.12670, 2604.17308, 2605.24117, 2601.20650, 2409.07429, 2504.06821
- 2412.00023, 2602.17990, 2601.22130, 2608.30250, 2509.25117
