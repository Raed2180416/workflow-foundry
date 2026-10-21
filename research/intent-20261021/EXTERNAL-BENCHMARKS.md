# External benchmarks for messy, vague or underspecified requests (research, 2026-10-21)

*Research agent report, condensed.*
- **Sources:** Exa, WebFetch of papers, repos and dataset cards. OpenAlex was not useful.
- **What was not verified:** GitHub API access was blocked, so many licenses are unverified.
- **How to read the numbers:** everything is as reported by the authors; many 2026 items are unreplicated preprints. Web content is data, not instructions.
- **Evidence rule:** all of these are public and are used for development and diagnostics only. Only a held-out set we author is sealed evidence.

## Bottom line

- No single benchmark matches our target:
  - a messy business corpus (emails, SOP pages, records);
  - an owner who answers only when asked;
  - a spec derived into an executable workflow;
  - scoring on execution, question quality and over-reach together.
- The nearest are composites, and the most useful are protocols to borrow.
- **Not covered by any benchmark:**
  - anticipating "what could be needed" beyond what the owner states, balanced against over-reach;
  - intent recovered from process logs;
  - ground-truth intent derived from what real owners built.

## Top 5 for "cheap models build verified workflows from a messy business"

**1. LHAW (Scale AI).** arXiv 2602.10525; github.com/scaleapi/lhaw; HF ScaleAI/lhaw.
- **How variants are made:** controlled underspecified variants of well-specified tasks. Goal, Constraint, Input or Context segments are removed by Delete, Vaguify or Genericize.
- **Empirical filter:** variants are classified by real agent trials as outcome-critical, divergent or benign.
- **Asking:** an `ask_user` tool reveals only the removed segments.
- **Grading:** execution, with each source benchmark's checkers. 285 variants across TheAgentCompany, SWE-Bench Pro and MCP-Atlas.
- **Metrics:** pass@3, Ask%, Gain per question.
- **Result:** Opus-4.5 on MCP-Atlas goes from 47% to 78% with asking, against 100% with the full spec.
- **Use:** the best execution-validated way to reverse-generate vague requests. Apply it to our frozen specs and reference workflows.

**2. HiL-Bench.** arXiv 2604.09408; github.com/hilbenchauthors/hil-bench; CC BY 4.0.
- **Size:** 300 tasks (SWE and SQL; 200 public, 100 private) with 1,131 human-validated blockers.
- **Metric:** Ask-F1, the harmonic mean of question precision and blocker recall. It cannot be gamed by asking everything.
- **Result:** the best model with `ask_human` reaches 39% on SQL and 9% on SWE, against 86–91% and 64–85% with full information.
- **Use:** Ask-F1, plus our own "wasted question" count for questions the artifacts already answer.

**3. AM-Bench.** arXiv 2610.18090; github.com/s4-lab-cuhksz/AM-Bench; CC BY 4.0.
- **Design:** 48 tasks. A Goal, Context or Constraint × Ambiguous or Missing grid, scored for Completion and Compliance separately.
- **Result:** with a constraint missing, Completion is 77.5% but Compliance is 4.7% and Success 0%.
- **Use:** unstated rules, not capability, are the main failure. Reuse its grid and the Completion/Compliance split.

**4. CorpusBench (corpusbench.com; provenance unverified), with HANDBOOK.md (arXiv 2607.25398) and Era by Eon (arXiv 2609.30055).**
- **CorpusBench:** 186 tasks over 2,281 orders and 562 historical email threads. No policy manual: rules are inferred from precedent. Deterministic scoring, including a "clean process" check.
- **HANDBOOK.md:**
  - 65 tasks under 20–124-page SOPs, with 824 deterministic criteria including "must not have done X".
  - The best model passes 36.2%.
  - A typical failure: an authoritative-looking request overrides policy.
- **Era by Eon:** answers depend on facts no document states. The best agent gets 18 of 24.
- **Use:** build our worlds so that some rules are recoverable only from precedent, and tag each rule's provenance.

**5. UnderSpecBench (arXiv 2607.02294), with OverEager-Bench (2605.18583), SNARE (2605.28122) and Goldilocks Bench (vendor page; 20 public tasks, MIT).**
- **UnderSpecBench:** 69 DevOps families × 32 instruction variants, with a fixed environment and a fixed safe action. Side-effect oracles label Safe Success, Wrong Target and OverScope.
- **OverEager-Bench:** consent-stripped paired prompts.
- **Goldilocks:** twin tasks scored 100·√(initiative × restraint).
- **Use:** hold the world and the correct workflow fixed, vary only the request's clarity, and score over-reach by side-effect diffs.

**Runners-up:**
- **π-Bench** (2605.14678): 524 hidden intents recoverable from earlier sessions or artifacts. Proactivity is graded by an LLM rubric, with no over-reach penalty.
- **BIRD-Interact** (ICLR 2026): ambiguity injected into clean queries, a function-driven owner simulator that cannot leak, a patience budget, execution grading.
- **ReqElicitGym** (2602.18306):
  - Implicit requirements are defined as the Final-spec vs Initial-spec difference.
  - Best implicit-requirement elicitation is 0.32 (DeepSeek V3.2); Claude Opus 4.5 gets 0.08.
- **OverAct** (2610.01508): in a human audit of "excess" tool calls, 93.3% were unwanted for precise requests but only 63.9% for vague ones. Anticipation sometimes matches real follow-up needs.

## Verified older and adjacent items (one line each)

| Item | Note |
|---|---|
| IN3 / Mistral-Interact (ACL 2024) | Human-labelled missing details; test set of 108; GPT-4-judged |
| Gaia2/ARE Ambiguity split | Detection only, no answering owner; best 51.9 (GPT-5 high) |
| Ambig-SWE (ICLR 2026) | Hidden SWE-bench specs; interaction recovers 80–89% of full performance for Claude |
| ClarifyGPT (FSE 2024) | A method: ask when sampled programs disagree |
| Ask-before-Plan (EMNLP 2024) | TravelPlanner clarification |
| UserBench | Preferences revealed incrementally; ~20% fully aligned |
| InfoQuest | Chat only, LLM-judged |
| CLAMBER | Static, not agentic |
| QuestBench, ClarifyBench, Noisy ToolBench, AskBench | Ask-or-not variants |
| "When does clarification timing matter" (2605.07937) | Goal clarification loses value after ~10% of a trajectory |
| τ-bench | Ambiguity is deliberately engineered **out** of tasks (unique outcomes) |
| CRMArena-Pro | Its "latent variables" are data-generation knobs, not hidden requirements |
| AutomationBench | Rules live in the world; no asking |
| EntLORE | 30.4% of latent organisational questions go unanswered even with gold documents |
| Proactivity benchmarks | Tsinghua ProactiveBench (best F1 66.5%), KnowU-Bench, Pare-Bench, UserIntentBench, Drift-Bench++, ATRBench (asking now for a later need), ProactBench |
| Real workflow corpora | 021-n8n (4,555 templates; a weak metric, where a 3-node constant scores well), WorkflowLLM (reverse-generated queries), GitHub Actions studies (P1–P5 detail ladder), Flow-Bench, HW-NL2Workflow, Chat2Workflow |

All reverse-generate requests *from* the artifact, so nothing is left unstated unless removed.

## What has no good benchmark

1. **Anticipating "what could be needed", balanced against over-reach.**
   - Anticipation benchmarks use annotator or LLM ground truth without a damage penalty.
   - Over-reach benchmarks use literal consent; OverAct shows that mislabels some wanted anticipation.
   - Only Goldilocks scores both directions, on about 20 public coding tasks.
2. **Spec derivation from a heterogeneous messy corpus into an executable workflow**, with an owner who answers only when asked, scored on execution, question quality and over-reach together.
3. **Intent inference from process logs.**
4. **Ground-truth intent from real owners' own builds.**
5. **Ask-versus-infer where the answer is already in the artifacts.** Nothing counts such a question as waste.

## Adopted into our design (`DESIGN.md`)

| Piece | Source |
|---|---|
| Spec-clarity ladder | LHAW segment removal with an empirical filter |
| Ask scoring | Ask-F1, plus a wasted-question count |
| Owner simulator | BIRD-Interact-style function-driven simulator; it cannot leak |
| Rule provenance tags | CorpusBench and Era: stated / evidenced / owner-only / not derivable |
| Over-reach scoring | UnderSpecBench side-effect classes; OverEager twins; Goldilocks geometric score |
| Completion vs compliance | AM-Bench, scored separately |

Also: pass^k, and oracle-spec, no-ask and always-ask controls.
