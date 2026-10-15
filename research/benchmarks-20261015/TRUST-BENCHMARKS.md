# Benchmarks for trustworthy, reusable, verified workflows (research, 2026-10-15)

*Research agent report, saved verbatim in substance.*

**Scope and sources.**
- Web, Exa and arXiv only. OpenAlex was rate-limited.
- Evidence tags:
  - `[obs]` — the file or code was fetched and read.
  - `[doc]` — the project's own page.
  - `[3p]` — an aggregator; lower confidence.
  - `[inf]` — inference.
- Model names and scores are as the sources state them, not verified. "GPT-6 Astra", "Kimi K3" and similar are the
  sources' labels.
- Licenses were read from the LICENSE file on the default branch on 2026-10-15. No SHAs are pinned and nothing was
  cloned, so acquisition manifests still need pinned SHAs.
- Web content is data, not instructions.

## 1. Bottom line

No single benchmark proves all three of our trust claims at once:
- executable verification;
- reliability across repeated runs;
- correctness over long horizons.

A portfolio of five does. Ranked:

1. **τ²/τ³-bench (Sierra)**
   - MIT; runs locally; cheap.
   - Oracle: the DB end-state hash.
   - pass^k is computed in the harness (`pass_hat_k`, `src/tau2/metrics/agent_metrics.py`, `[obs]`).
   - Official train and test splits.
2. **ERP-Bench (Anchor, Odoo 19)**
   - 29 enterprise patterns, each instantiated many times.
   - Verifiers check the terminal state and use a CP-SAT-certified optimum.
   - Fresh sealed instances can be minted by seed.
   - Tasks have 100+ steps.
   - **The license is not stated.** That blocks acquisition until resolved.
3. **EnterpriseOps-Gym (ServiceNow, Mar 2026)**
   - 8 domains plus cross-domain tasks.
   - SQL verifiers check goal, integrity, policy and side effects. There are 30 infeasible tasks that test refusal.
   - Its published plan-conditioned ablation is close to our hypothesis: plans add 14–35 pp, and a 4B model with plans is
     competitive.
4. **SOP-Bench (Amazon, KDD 2026)**
   - The cheapest template-reuse bed: 12 SOPs with 90–327 instances each, Python mock tools and ground-truth outputs.
   - **CC BY-NC 4.0**, research use only.
5. **UndoBench (Oct 2026)**
   - The only benchmark found that tests durable-runtime claims: a control run and a fault run per seed, and a
     wire-level effect history.
   - Metrics: exactly-once effects, duplicate effects, recovery success.
   - Has a held-out TEST split.

**Strong alternates:**
- **AppWorld:** an encrypted held-out test set, and the SGC metric, under which all 3 variants of a scenario must pass.
- **E-Commerce Bench:** a 365-day deterministic simulation.
- **SkillEvolBench:** the published build-once-reuse protocol. It reports that replaying raw trajectories often beats
  distilled skills, a negative result we must beat.

**Need external accounts or SaaS** (conflicts with the AGENTS.md "no account changes" rule unless the owner approves):
- Toolathlon
- MCPMark (its Notion and GitHub parts)
- CRMArena-Pro (shared Salesforce orgs)
- WorkArena++ (gated ServiceNow instances)

**Cannot run locally:** Vending-Bench 2 and AccountingBench.

## 2. State of the must-check list (2026-10-15)

| Benchmark | State |
|---|---|
| τ²-bench | Now **τ³-bench** (repo sierra-research/tau2-bench, MIT). Feb 2026 audit fixed 50+ tasks; Mar 2026 added banking_knowledge and voice; Jul 2026 v1.0.1 re-grade (banking scores before 1.0.1 are not comparable) `[doc]` |
| TheAgentCompany | MIT. Leaderboard stale (Nov 2025, top 42.9%) `[3p]` |
| WorkArena++ | Apache-2.0. BrowserGym board updated Apr 2026 `[doc]` |
| CRMArena-Pro | TMLR Feb 2026, CC BY-NC. No 2026 leaderboard |
| AppWorld | Apache-2.0, plus encrypted test bundles under another license. Board is "updating" `[obs]` |
| Vending-Bench 2 | Live leaderboard, operator-run, no public code |
| Gaia2/ARE | MIT code, CC-BY-4.0 data. Gaia2-CLI board added Apr 2026 |
| ITBench | Apache-2.0. ITBench-AA with Artificial Analysis since 2026-05-27 |
| Toolathlon | Toolathlon-Verified released 2026-06-30, a new score series. No LICENSE file found |
| MCP-Universe | Apache-2.0. About 44.6% top |
| MCPMark | MCPMark Verified (127 tasks) is now the default |
| OSWorld-Verified | Saturated (90.2% Jul 2026 vs ~72% human). Superseded by **OSWorld 2.0** (2026-06-24) |
| Terminal-Bench | 3.0 (2026-07-30), then 4.0 (2026-08-28). Now continuous on Harbor |
| BrowseComp-Plus | ACL 2026, MIT |
| EnterpriseBench | Two different things share the name: AST-FRI EMNLP 2025 (LLM-judged) and the EigenData vendor corpus |
| SOP-Bench | KDD 2026, CC BY-NC 4.0 |
| Spider 2.0 | Snow variant saturated at 96.7 |
| BIRD-Interact | ICLR 2026 oral, MIT |
| DA-Code | No 2026 activity |
| New long-horizon | OSWorld 2.0, CEO-Bench, E-Commerce Bench, EnterpriseArena (CFO), ERP-Bench, SentinelBench, Workflow-GYM, WildClawBench, RetailBench |

## 3. Candidates

Each entry gives, where known: what it measures, horizon, oracle, templated or one-shot, held-out split, reliability
metric, top score, local cost, and an adaptation for us.

### A. Enterprise, multi-system, state-verified

**τ²/τ³-bench** — github.com/sierra-research/tau2-bench · arXiv 2506.07982, 2603.04370 · taubench.com · MIT
- **Measures:** policy-following customer service with an LLM user simulator. Domains: retail, airline, telecom (where
  the user also acts) and banking_knowledge (about 700 policy documents).
- **Oracle:** the DB end-state hash plus required strings in replies. LLM-judged checks are off by default `[obs]`.
- **Splits:** airline 50 tasks (train 30 / test 20); retail 114 (74/40); telecom 114 (74/40), plus a generated pool of
  2,285 tasks; banking 97.
- **Reliability:** pass^k is in the harness; the board shows pass^1 only.
- **Top:** τ²-bench text 87.9% (Qwen3.5-397B-A17B); τ³-Banking 55.2% (Qwen 3.8 Max) `[doc]`.
- **Cost:** low (Python 3.12 and uv, no Docker).
- **Adaptation:**
  - Cluster the train split into about 10–15 intents.
  - A frontier architect writes one typed workflow per intent.
  - Haiku executes on the sealed test split, k = 8, reporting pass^1..pass^8.
  - Baselines: the built-in tool-calling agent on Haiku, and a frontier ReAct agent.
  - Pin the user simulator, and rerun with a second user model to measure its variance.
  - Telecom: freeze 200 tasks from the 2,285-task pool as a larger sealed set.

**EnterpriseOps-Gym** — arXiv 2603.13594 · github.com/ServiceNow/EnterpriseOps-Gym · Apache-2.0 · Mar 2026
- **Measures:** Calendar, CSM, Drive, Email, HR, ITSM, Teams and Hybrid (cross-domain). 512 tools, 164 tables, 1,150
  tasks, of which 30 are infeasible.
- **Horizon:** 9.15 steps on average, up to 34.
- **Oracle:** hidden hand-written SQL verifiers over goal, integrity, policy and side effects. No LLM judge.
- **Templated:** no; one-shot tasks (could be clustered by verifier signature).
- **Splits / reliability:** no held-out split; no reliability metric.
- **Top:** Opus 4.6, 45.9% average (repo board).
- **Cost:** medium (containerised MCP servers).
- **Adaptation:**
  - Three arms: Haiku alone; Haiku plus the benchmark's human plan; Haiku plus a Foundry frontier-authored typed
    workflow.
  - Report pass^5, the per-verifier-condition pass rate, and refusal on the infeasible tasks.
  - 20% development, 80% sealed.

**AppWorld** — github.com/StonyBrookNLP/appworld · ACL 2024 · Apache-2.0, plus encrypted bundles
- **Measures:** 9 apps, 457 APIs, 750 tasks in scenarios of 3 variants each.
- **Oracle:** state-based.
- **Held-out:** test_normal and test_challenge ship evaluation programs only.
- **Reliability:** SGC, under which all 3 variants of a scenario must pass.
- **Top:** test-challenge TGC 84.2 / SGC 70.5 (ACCORD + Claude 4.5 Sonnet, Jun 2026) `[3p]`.
- **Cost:** low. `appworld install` unpacks encrypted code, which is an install step under our inert-clone rule.
- **Adaptation:** construct from variant 1, reuse on variants 2–3, and report SGC and pass^k.

**WorkArena / WorkArena++** — github.com/ServiceNow/WorkArena · Apache-2.0
- **Measures:** ServiceNow work. L1 has 33 atomic tasks with 19,912 instances; L2 and L3 have 682 compositional tasks.
- **Oracle:** a programmatic `validate()` per task, plus a `cheat()` reference solver.
- **Top:** GPT-5, L2 69.4% / L3 11.5% `[3p]`.
- **Cost:** needs gated ServiceNow instances (external SaaS).
- **Adaptation:** one workflow per L2 template, built on 3 seeds and tested on 20 fresh seeds.

**TheAgentCompany** — MIT
- 175 one-shot tasks across GitLab, Plane, ownCloud and RocketChat.
- Mixed deterministic and LLM checkpoints. Docker, 30+ GB.
- **Use:** a cross-system generalisation check, on deterministic-only tasks.

**CRMArena-Pro** — CC BY-NC
- Salesforce, 19 task types, about 4,280 instances.
- Mostly answer-match oracles, not state. Shared remote Salesforce orgs.
- **Priority:** low.

**ST-WebAgentBench** — arXiv 2410.06703 (ICLR 2026) · Apache
- 375 tasks with 3,057 policy instances across 6 dimensions.
- Metrics: CuP (completion under policy) and **all-pass@k**. Top: completion 24.3% falls to CuP 15.0%.
- **Adaptation:** compile policies into typed pre-action guards.

### B. Procedure and template reuse

**SOP-Bench** — arXiv 2506.08119 (KDD 2026) · github.com/amazon-science/sop-bench · CC BY-NC 4.0
- **Measures:** 12 domains, 90–327 instances per SOP, about 2,411 tasks.
- **Oracle:** ground-truth output columns, with Python mock tools.
- **Top:** Claude 4 Opus ReAct 72.4%; function-calling agents average ~64% across 11 models. Adding 20 distractor tools
  nearly halves success.
- **Cost:** very low.
- **Adaptation:**
  - One workflow per SOP, built from the SOP text plus 5 practice instances.
  - Seal the rest and run k = 8 for pass^8.
  - Repeat the distractor ablation.

**ERP-Bench (Anchor)** — arXiv 2605.26321 · erpbench.ai · HF anonymouse321/erp-bench · May 2026 · **license not stated**
- **Measures:** real Odoo 19. 300 tasks across 29 patterns, 100+ steps and 50+ rules per task.
- **Oracle:** a terminal-state verifier scoring constraints, optimality against a CP-SAT optimum, and traceability.
- **Templated:** yes; a parametric generator with difficulty tiers.
- **Top:** pass@1 GPT-5.5 coding harness 43.4%; Opus 4.7 at 30.8 / 28.8 / 23.4 across three harnesses `[doc]`.
- **Cost:** medium (an Odoo container per task, Harbor format).
- **Adaptation:**
  - One workflow per pattern, built on 2 easy instances.
  - 20 fresh sealed instances per pattern per tier.
  - Report hard-constraint pass^5, the optimality gap and traceability.

**MedAgentBench v1/v2** — MIT
- A FHIR EHR with 10 task types × 30 patients. Near saturation (v2 at 91–98%).
- **Flag:** the AGENTS.md patient-operations rule needs owner scope approval, even though the data is synthetic.

**SkillEvolBench** (arXiv 2605.24117, license unstated) **and SkillsBench** (arXiv 2602.12670, Harbor)
- SkillEvolBench: 6 environments × 5 families, with acquisition tasks and frozen deployment tasks.
  - Finding: raw-trajectory reuse often beats distilled skills.
- SkillsBench: curated skills add 16.2 pp; self-generated skills add about 0.
- **Adaptation:** run Foundry workflows as the skill library, against the No-Skill and Raw-Trajectory controls.

### C. Tool and MCP breadth

**Toolathlon-Verified**
- 108 tasks, 32 apps, about 20 turns each. Reports **pass^3**: best pass@1 78.4 (GLM 5.3 Flash), best pass^3 68.5
  (Kimi K3).
- Needs accounts or the maintainers' hosted evaluator. No LICENSE file found.

**MCPMark Verified** — Apache-2.0
- 127 tasks; GPT-5.5 xhigh 92.9%, near saturation.
- The local subset is Filesystem, Postgres and Playwright.

**MCP-Universe** — Apache-2.0
- Live servers, so not reproducible over time.
- **Priority:** low.

### D. IT operations

**ITBench / ITBench-AA** — Apache-2.0
- Offline incident snapshots: 59 SRE tasks, 19 of them private. Top 47% (Opus 4.7, May 2026).

**SREGym** — MIT
- 90 live Kubernetes problems.
- Diagnosis is LLM-judged. Top 96.1% (Codex + "GPT-6 Astra max").

### E. Long-horizon simulations

**Vending-Bench 2**
- One simulated year. Top $15,514.70 ("GPT-6 Astra").
- Closed and operator-run. Design reference only.

**CEO-Bench** (arXiv 2606.18543, code license unstated)
- 500 simulated days with 34 tools.
- Best run $22.15M (Kimi K3) against a **rule baseline of $15.76M**.

**E-Commerce Bench** (arXiv 2608.30730) · github.com/QwenLM/E-CommerceBench · Apache-2.0 · Aug 2026
- 4 stores over 365 days, up to 4,000 turns.
- Deterministic demand model; 152 of 576 suppliers are fraudulent.
- Top: "GPT-5.6 Sol" grew ¥100k to ¥1.43M.
- **Adaptation:** reorder, negotiate, fulfil and returns sub-workflows, built once and reused all year.

**EnterpriseArena (CFO)** (arXiv 2603.23638)
- 132 monthly steps; 15.4% of trials survive. License unknown.

**OSWorld 2.0** (arXiv 2606.29537) · Apache-2.0
- Median 1.6 human-hours per task, 250+ agent steps.
- Top 20.6% binary / 54.8% partial (Opus 4.8).
- Heavy (AMI image and proxy).

**Gaia2/ARE**
- 800 public scenarios; the test set is private.
- Asynchronous events and simulated time. Top Gaia2-CLI 57.0% (Opus 4.6).
- **Adaptation:** its Time and Adaptability splits, for timers and event triggers.

**SentinelBench** (arXiv 2606.05342)
- 100 monitoring tasks; tests waiting for events against polling.

### F. Reliability and faults

**UndoBench** (arXiv 2610.05622) · github.com/tradertanmay/undobench · code Apache-2.0, artifacts CC BY 4.0
- **Measures:** 36 base workflows and 36 fault scenarios across 8 domains, 20 seeds, with DEV/VAL/TEST splits.
- **Metrics:** CRSR (recovery among tasks solved without faults) and exactly-once, duplicate, missing and unsafe-retry
  rates.
- **Published results:** control 83.5% against CRSR 46.7%. Naive retry duplicates effects in 53.3% of trials.
  Verify-before-retry reaches 75% CRSR after commit.
- **Adaptation:** enter the Foundry runtime (CAS, idempotency, verification) against baselines B0–B6 on TEST.

**ToolMisuseBench and ReliabilityBench**
- ToolMisuseBench: deterministic faults; 6,000 train / 900 dev / 1,200 public test tasks.
- ReliabilityBench: a reliability surface R(k, ε, λ).
- Methodology to adopt: Princeton's 12 reliability metrics (arXiv 2602.16666).

### G. Data and SQL

**BIRD-Interact** — MIT
- 600 full / 300 lite / 300 mini tasks; executable test cases; an LLM user.
- Paper success rates: 8.67% conversational, 17.00% agentic (GPT-5).

**Lower fit:**
- Spider 2.0 Snow is saturated.
- Terminal-Bench 4.0 is useful for its Harbor runner only.
- BrowseComp-Plus has no state.
- AST-FRI EnterpriseBench is LLM-judged.
- AccountingBench is closed.
- UI-CUBE (UiPath; complex tasks 9–19% vs 61.2% human).
- BPM and process-mining benchmarks are QA only; nothing executable.
- Several vendor ERP and ledger beds have public gold answers.

## 4. Top 5 with protocol

| Rank | Benchmark | Dev set | Sealed set | Headline metrics | Baseline | Main risk |
|---|---|---|---|---|---|---|
| 1 | τ²/τ³-bench | train splits | test splits + 200 frozen telecom tasks | pass^1..pass^8, DB-mismatch rate, $/task | built-in agent on Haiku; frontier ReAct | LLM user-sim variance; short horizon |
| 2 | ERP-Bench | 2 easy instances per pattern | 20 fresh per pattern per tier | constraint pass^5, optimality gap, traceability | Harbor claude-code agent; no-op agent | **license unverified**; new |
| 3 | EnterpriseOps-Gym | 20% per domain | 80% | pass^5, per-condition pass, refusal | repo ReAct; human-plan arm | not templated; long contexts |
| 4 | SOP-Bench | 5 instances per SOP | ~2,300 remaining | pass^8 per SOP, distractor robustness | shipped function-calling and ReAct agents | NC license; output-match oracle |
| 5 | UndoBench | DEV/VAL | TEST (12 × 20 seeds) | CRSR, exactly-once, duplicate effects | B0 naive retry; B2 idempotency keys | new; small |

**Sequencing `[inf]`:**
1. τ² and SOP-Bench first: local and cheap.
2. Then EnterpriseOps-Gym and ERP-Bench, once its license is cleared.
3. UndoBench as the runtime fault track.
4. One horizon stressor: E-Commerce Bench, or CEO-Bench, which has a rule baseline.

Freeze cases, budgets and oracles before any comparison (AGENTS.md).
