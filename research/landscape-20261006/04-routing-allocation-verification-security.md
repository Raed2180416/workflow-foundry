# Routing, compute allocation, self-healing and security for Workflow Foundry: research report (2026-10-06)

Tags: **[V]** means verified, fetched 2026-10-06. **[R]** means recalled and unverified. I changed no local files; I only read `README.md` and `docs/ROADMAP.md`.

## 0. Corrections to ROADMAP citations

- **2607.22465 is the right ID, but the paper was retitled.** v1–v2 (Jul 2026) was *TRACE-Router: Task-Consistent and Adaptive Online Routing for Agentic AI*. v3–v4 (29 Sep and 1 Oct 2026) is *ORACLE: Agentic AI Orchestrator Routing Via Adaptive Verifier Calibration Feedback*. Cite a specific version. [V]
- **Hyperband is 1603.06560.** [V]
- **MAST (2503.13657) is now verified**, so drop the "(recalled)" tag.
- **Who&When figures are confirmed (53.5% agent, 14.2% step), but the state of the art has moved.** See AIG 2608.24361 below.
- **Archon is 2409.15254.** I first recalled 2409.14051, which is actually *GroupDebate*.
- **Martian, Not Diamond and OpenRouter:** primary sources exist, but there is no independent evidence of their performance. Details are in §2.1.

## 1. Key findings

1. **Simple routing baselines are hard to beat.** In LLMRouterBench, several routers, including OpenRouter, fail to beat the single best model. There is a 15–20% gap to the oracle, mostly from failing to pick the rare model that is right. Giving the router information helps more than making it clever: adding per-dimension performance statistics gives +15.3% relative.
2. **For agents, route at the level where feedback arrives.** Task-level routing that pins the model for the whole run, learned with a contextual bandit from delayed terminal reward (TRACE/ORACLE), beats per-call routing. Step-level downgrades can halve cost, but only when trained on execution-verified step labels. Frontier LLMs are poor zero-shot routers.
3. **Routing among strategies has real headroom and almost no prior art at the harness level.** Choosing the best paradigm per task beats the best fixed paradigm by 17.1 points. A learned router recovers up to 37% of that gap. Zero-shot self-routing failed for every model except GPT-5. Nobody routes among versioned, contract-typed harnesses with off-policy evaluation (OPE). That is open ground for Foundry.
4. **More samples can hurt.** False positives from imperfect verifiers cap the accuracy of resampling, and the optimal number of attempts is often under 10. Majority voting is non-monotone in the number of calls. Best-of-N against a proxy reward over-optimises.
5. **Execution verifiers are best but leaky; hybrids win.** On SWE-bench Verified, 29.6% of "plausible" patches behave differently from the reference, which inflates scores by 6.2 points. Learned simulators reach about 0.77 accuracy but can be reward-hacked. LLM-as-a-Verifier recovers only about 25–40% of the gap between single-attempt and oracle selection.
6. **Locating the failing step is still weak.** The best published result (AIG) reaches 55.2% step accuracy on algorithm-generated traces and only 29.3% on hand-crafted ones. In 2026, diagnosis-driven repair with regression validation reports +6.3–18.4% (HarnessFix) and a 71.3% repair rate (FlowFixer). None of these systems use replay-confirmed interventional attribution, which Foundry could do.
7. **System-level prompt-injection defenses deliver deterministic guarantees, at a utility cost.** CaMeL solves 77% of AgentDojo tasks securely versus 84% undefended. Progent cuts attack success from 39.9% to 1.0%. Model-level defenses fall to adaptive attacks. **Guarantees do not compose across agent boundaries** unless provenance travels with the data.
8. **Infrastructure:** the OTel GenAI conventions are still at "Development" status, now live in their own repo, and have no release. Daytona's open-source repo has been unmaintained since June 2026.

## 2. Per-item entries

### 2.1 Routers

- **RouteLLM 2406.18665** (Jun 2024). Routers trained on preference data choose between a strong and a weak model. More than 2× cost reduction without quality loss. Binary pool and chat labels only. *Foundry: use as a baseline only.* https://arxiv.org/abs/2406.18665 [V]
- **LLMRouterBench 2601.07206** (Jan 2026). 400K+ instances, 21 datasets, 33 models, 10 router baselines.
  - Many routers perform about the same.
  - OpenRouter scores −24.7% relative to the single best model.
  - The gap to the oracle is about 15–20%. On queries that at most three models get right (11.9% of the test set), routing accuracy is about 24%.
  - Embedding backbones matter little, and curated small pools beat large ones.
  - *Foundry: adopt "always report against the best single arm" and curate the arm set.* https://arxiv.org/abs/2601.07206 [V]
- **Arch-Router 2506.16655** (Jun 2025). A 1.5B model maps each query to owner-defined (domain, action) policies. New models can be added without retraining. Claims state-of-the-art preference matching but does not learn from outcomes. *Foundry: adopt the idea as the hard-constraint layer over the owner-authored model policy.* https://arxiv.org/abs/2506.16655 [V]
- **GPT-5 router** (system card, 13 Aug 2025). A real-time router decides between the fast and thinking models using "conversation type, complexity, tool needs, and explicit intent". It is "continuously trained on real signals, including when users switch models, preference rates for responses, and measured correctness". Mini models take over at usage limits. https://cdn.openai.com/gpt-5-system-card.pdf [V]
  - It was removed for Free and Go users on 11 Dec 2025 because latency hurt daily active users. Altman had said free-user reasoning usage rose from under 1% to 7%. Source is secondary: The Decoder citing WIRED, https://the-decoder.com/openais-gpt-5-router-rollback-shows-why-ai-requires-unlearning-old-habits [V]
  - *Lesson:* engagement signals are not correctness, and the router's objective decides what it optimises.
- **Not Diamond.** Offers a pretrained router, custom routers trained on your own evaluation data, and prompt optimisation. I found no independent benchmark. *Neutral.* https://docs.notdiamond.ai/docs/what-is-not-diamond [V]
- **Martian.** The homepage now presents a research lab focused on "understanding intelligence". The router product's status is unclear. *Avoid as a dependency.* https://www.withmartian.com/ [V]
- **OpenRouter Auto.** Routes "on the wisdom of the market":
  1. A lightweight classifier assigns one of about 30 task types.
  2. Models are ranked by trailing 7-day spend share for that type.
  3. A cost tier filters the band, then fallbacks apply. Multi-turn conversations stick to one model.

  Popularity is not correctness. The LLMRouterBench result may predate this mechanism [R]. *Avoid.* https://openrouter.ai/docs/guides/routing/routers/auto-router [V]
- **MasRouter 2502.11133** (Feb 2025). A cascaded controller chooses collaboration mode, then roles, then LLM. +1.8–8.2% on MBPP. Up to −52.07% overhead on HumanEval, and −17–28% when plugged into existing multi-agent frameworks. *Foundry: adopt the factorisation harness → strategy → model class.* https://arxiv.org/abs/2502.11133 [V]
- **Router-R1 2506.09033** (Jun 2025). An LLM router trained with RL interleaves "think" and "route" steps, aggregates over multiple rounds, and uses a cost reward. Tested on QA only. *Avoid for now: it needs RL.* https://arxiv.org/abs/2506.09033 [V]
- **Agentic Routing 2607.11399** (Jul 2026). A vendor technical report (OpenSquilla), not peer-reviewed. Step-level routing conditioned on harness state.
  - Four layers: admission, demand construction, risk pricing (tool failures, verifier results), then a LightGBM ranker.
  - Every decision becomes a logged record of query, harness state, choice, trace, outcome and cost.
  - PinchBench: 93.14 vs 93.35 at 10.9× lower cost. DRACO: 99.94% quality at −43% cost. DRACO with multiple models: 60.82 vs 59.80.
  - The harness itself is held fixed.
  - *Foundry: adopt the decision-record schema and the risk-pricing features.* https://arxiv.org/abs/2607.11399 [V]
- **ORACLE / TRACE-Router 2607.22465** (Jul–Oct 2026).
  - v2: contextual UCB at admission pins every call to one backend. The delayed reward combines accuracy and latency. Context comes from regex complexity tiers. τ2-Bench: +7–8 points against latency-matched interpolation. Terminal-Bench: +7.1 points against the strongest single model, with 36% lower latency.
  - v4: classifies the task type and assigns a task-appropriate verifier for feedback, keeps verifier latency off the dispatch path, and adds the DISC scheduler. Up to +7 points on the accuracy-cost frontier and 1.8× throughput.
  - Pools are tiny (two backends).
  - *Foundry: adopt "unit of routing = unit of feedback" and per-family verifier assignment.* https://arxiv.org/abs/2607.22465 [V]
- **TwinRouterBench 2605.18859** (May 2026). Step-level benchmark: 970 router-visible prefixes from 520 instances with execution-verified target tiers, plus a live SWE-bench Verified track.
  - 71% of steps only need a low tier.
  - A trained logistic router resolved 75/100 for $25.66, versus $54.73 with Opus alone (−53.1%). A rule-based router cost $172.56.
  - Opus acting as router predicted "high" for only 7 of 147 SWE steps that verifiably needed the strong tier.
  - *Foundry: adopt for node-level model downgrades, with trajectory-failure penalties.* https://arxiv.org/abs/2605.18859 [V]
- **Prior art for strategy and harness routing:**
  - Select-then-Solve 2604.06753: six paradigms × four LLMs × ten benchmarks (about 18k runs). The per-task oracle beats the best fixed paradigm by 17.1 points. An embedding router improves 47.6% to 53.1%, against 50.3% for the best fixed paradigm. https://arxiv.org/abs/2604.06753 [V]
  - Route-to-Reason 2505.19435: joint model and strategy routing, more than 60% fewer tokens. [V]
  - BoundaryRouter 2605.07180: chooses plain LLM vs full agent. −60.6% time against always using the agent, +28.6% over direct inference. [V]
  - Agent-as-a-Router 2606.22902: the bottleneck is information deficit (+15.3% relative from performance statistics). Combines kNN memory with a verifier and has the lowest cumulative regret. [V]
  - Archon 2409.15254: offline search over inference-time architectures, +15.1% on average over o1, GPT-4o and Claude 3.5 Sonnet. [V]
  - Classical per-instance algorithm selection: Rice 1976 and SATzilla. [R]
- **Bandits and OPE:**
  - BaRP 2510.07429: preference-conditioned contextual bandit trained under bandit feedback. [V]
  - OrcaRouter 2605.30736: LinUCB with an offline full-information ridge warm start. #2 on RouterArena at 75.54% accuracy for $1 per 1K queries. [V]
  - Doubly robust OPE 1103.4601 [V]. Anytime-valid OPE 2210.10768 [V].
  - TensorZero best-arm identification with dynamic stopping: 37% faster to identify the best variant. https://www.tensorzero.com/blog/bandits-in-your-llm-gateway/ [V]
  - FrugalGPT cascades 2305.05176. [V]

### 2.2 Test-time compute allocation

- **Snell et al. 2408.03314.** A compute-optimal strategy chosen per prompt difficulty. More than 4× efficiency over best-of-N. At matched FLOPs it beats a 14× larger model when the base model already has non-trivial success. *Adopt.* [V]
- **Large Language Monkeys 2407.21787.** Coverage scales log-linearly with samples: SWE-bench Lite goes from 15.9% to 56% at 250 samples. Without automatic verifiers, voting and reward models "plateau beyond several hundred samples". [V]
- **The Limits of Inference Scaling Through Resampling 2411.17501.** A verifier's false-positive rate caps resampling accuracy, and that rate correlates with weak single-sample accuracy. "Optimal sampling attempts are often fewer than 10." *This should be the allocator's core constraint.* [V]
- **Are More LM Calls All You Need? 2403.02419.** Vote and Filter-Vote are non-monotone in the number of calls because tasks mix easy and hard queries. The optimum can be fitted from a few samples. [V]
- **Gao et al. 2210.10760.** Best-of-N against a proxy reward over-optimises the gold reward. [V]
- **Provable test-time scaling laws 2411.19477.** Knockout and league tournaments give a provable decay in failure probability if the pairwise judge is better than random. [V]
- **Strategic Scaling 2506.12721.** Allocates compute across queries in the style of best-arm identification. At equal budget: +11.10 points on MATH-500, +10.82 on AIME25, +11.23 on LiveCodeBench. It stops spending on unsolvable queries. *Adopt.* [V]
- **Early-stopping and pruning methods:**
  - Adaptive-Consistency 2305.11860: up to 7.9× fewer samples, under 0.1% accuracy drop. [V]
  - DeepConf 2508.15260: −84.7% tokens on AIME25. [V]
  - Speculative Rejection 2410.20290. [V]
  - Hyperband 1603.06560. [V]
- **Scaling TTC for agents 2506.12928.** SmolAgents on GAIA with GPT-4.1:
  - baseline 55.76%;
  - best-of-N with list-wise verification 63.03%;
  - step-wise best-of-N 58.79%, beam search 56.97%, DVTS 55.76%;
  - list-wise verification beats scoring, which beats voting;
  - reflect only when the score drops. [V]
- **CATTS 2602.12276.** Uniformly scaling compute per step saturates. An arbiter helps on contentious steps but overrides correct consensus. Gating on vote entropy and margin gives +9.1% over ReAct with up to 2.3× fewer tokens. *Adopt as the step-level gate.* [V]
- **Agentic coding TTS 2604.16529.** Compares rollout summaries with recursive pairwise tournament voting, plus an agentic Parallel-Distill-Refine loop. Opus 4.5: 70.9% to 77.6% on SWE-bench Verified, 46.9% to 59.1% on Terminal-Bench 2. *Adopt summaries as the objects being compared.* [V]

### 2.3 Verification and self-healing

- **Leaky execution oracles.**
  - 2503.15223: 29.6% of plausible patches diverge in behaviour from the reference, 28.6% of those are certainly wrong, and resolution rates are inflated by 6.2 points. [V]
  - UTBoost 2506.09289: found 345 patches wrongly marked as passing, affecting 24.4% of SWE-bench Verified leaderboard entries. [V]
- **LLM judges.**
  - JudgeBench 2410.12784: strong judges are close to random on hard pairs. [V]
  - Self-preference 2404.13076: LLMs recognise and favour their own outputs. [V]
  - Trust or Escalate 2407.18370: selective evaluation with a provable human-agreement guarantee, over 80% agreement at about 80% coverage. *Adopt for judge escalation.* [V]
- **R2E-Gym 2504.07164.** Test-based verifiers have low distinguishability; execution-free verifiers are biased toward style. Each alone saturates at about 42–43%; the hybrid reaches 51% on SWE-bench Verified. *Adopt hybrids, with execution taking precedence.* [V]
- **SWE-World 2602.03419.** Learned transition (SWT) and reward (SWR) models replace Docker.
  - SWR accuracy 0.754/0.770 with precision about 0.78.
  - The agent resolves 60.2% in simulation versus 68.4% under real Docker.
  - With 8 candidates, SWR selection reaches 68.2%, versus 59.4% for the R2E verifier.
  - A reward model without chain-of-thought was reward-hacked during RL (trajectory length collapsed).
  - *Foundry: use only under a `learned-simulator` label, never for final qualification.* [V]
- **LLM-as-a-Verifier 2607.05391.** Scores are the expectation over score-token logits, scaled along granularity, repetition and criteria, with a tournament for selection.
  - Terminal-Bench 2: 83.1% to 86.5% (oracle 92.1%).
  - SWE-bench Verified: 76.1% to 78.2% (oracle 84.4%).
  - The discrete judge tied 88/100 times; the continuous verifier never tied.
  - Needs logprobs (local models expose them). Errors correlate on hard cases.
  - *Foundry: adopt for the local 9B model, with an independence label.* [V]
- **Process reward models for agents.** AgentPRM 2502.10325 (a 3B model beats GPT-4o on ALFWorld) [V]; AgentRM 2502.18407 (+8.8 points) [V]; Web-Shepherd 2505.15277 [V]. *Use only where environments make rollouts cheap, such as the game simulator.*
- **MAST 2503.13657.** 14 failure modes in 3 categories, κ = 0.88, 1,600+ traces across 7 frameworks. *Adopt as the classification vocabulary.* [V]
- **Failure attribution.**
  - Who&When 2505.00212. [V]
  - AgenTracer 2509.03312: labels data by counterfactual replay plus fault injection. Its 8B tracer beats frontier models by up to 18.18%, and its feedback adds 4.8–14.2% to multi-agent systems. [V]
  - Causal attribution 2509.08682: up to 36.2% step-level accuracy. [V]
  - **AIG 2608.24361, current best:** 55.2% step / 71.2% agent on algorithm-generated traces; 29.3% step on hand-crafted ones. [V]
- **Repair.**
  - HarnessFix 2606.06324: compiles traces into a harness-aware IR, builds flaw records, applies scoped repair operators, and accepts patches only after regression checks. +6.3–18.4%. [V]
  - FlowFixer 2607.02882: symbolic specifications, then attribution, then patches. 71.3% repair success on Dify, Coze and n8n workflows. [V]
  - AgentTether 2607.06273: repairs 59–65% of initially failed τ-bench Banking tasks. [V]
  - Microsoft AgentRx: invariant checker plus judge. [V repo]
- **Verdict.** Automated root-cause analysis and repair works on well-instrumented workflows with regression validation. Locating the failing step on open-ended traces remains unreliable. I found no system that confirms an attribution by replay as its default.

### 2.4 Security by construction

- **CaMeL 2503.18813.**
  - Mechanism: a privileged LLM (P-LLM) writes a program from the trusted query. A quarantined LLM (Q-LLM) with no tools parses untrusted data into a schema and can only signal `have_enough_information`. The interpreter tracks capabilities and enforces policy at every tool call.
  - Results: 77% of AgentDojo tasks with provable security vs 84% undefended. Costs 2.82× input and 2.73× output tokens.
  - Residual risks: attacks where "data influences choice of an action"; side channels (exceptions, timing, resource access, addressed by STRICT mode); text-to-text manipulation; policy-writing burden; approval fatigue.
  - *Adopt as the execution model.* [V]
- **FIDES 2505.23643.**
  - Confidentiality and integrity labels; selective hiding; `query_llm` with constrained decoding, where output types form a capacity lattice (bool ⊆ enum ⊆ string).
  - Task taxonomy: data-independent, data-independent with constrained query, and data-dependent. **Data-dependent tasks cannot be completed securely.**
  - AgentDojo with gpt-4o: successful attacks fall from 156 to 23 without policies, and to 0 with policies. Utility drops by up to 24.5% with policies.
  - It blocks explicit flows but not implicit ones through control decisions, and suffers "label creep".
  - Shipped as experimental middleware in Microsoft Agent Framework on 2026-05-20: https://devblogs.microsoft.com/agent-framework/fides/ [V]
- **Design Patterns 2506.08837.** Six patterns: action-selector, plan-then-execute, LLM map-reduce, dual-LLM, code-then-execute, context-minimization. Its principle: once an agent has ingested untrusted input, it must be impossible for that input "to trigger any consequential actions". Plan-then-execute stops new calls but **not tampered arguments or content**. [V]
- **Progent 2504.11703.** JSON-schema policies over tool names and arguments, checked deterministically. An SMT solver classifies each policy update as narrowing (applied automatically) or expansion (needs approval). Attack success: 39.9% to 1.0% on AgentDojo, 70.3% to 3.9% on ASB. It cannot stop attacks that stay within least privilege. *Adopt for `plan/expand` nodes.* [V]
- **2026 follow-ups.**
  - CaMeLoT 2609.18674: compiles the plan to a transition system and checks CTL policies with nuXmv before any call. Counterexamples become repair feedback. [V]
  - SPA 2608.27234: plan-first DSL with dual-lattice IFC over data and control dependencies. Persistent state is stored as labelled artifacts, and later planning sees only metadata. Attack success 0 on AgentDojo, 0.2% multi-query. [V]
  - PRUDENTIA 2602.11416: introduces autonomy metrics (fraction of actions safe without human approval). [V]
  - **"Can CaMeLs Talk?" 2610.05640: CaMeL's guarantees do not compose across agents.** A multi-agent protocol with a separate data channel cuts attack success from 12.9% (no defense) and 0.2% (per-agent CaMeL) to 0.0%. [V]
  - Meta, "Agents Rule of Two" (Oct 2025). [V]
  - "The Attacker Moves Second" 2510.09023: adaptive attacks exceed 90% success against most of 12 prompting, training, filter and secret-knowledge defenses. System-level defenses were not evaluated. [V]

**Key question: do typed, pre-compiled harnesses give a structural prompt-injection advantage?**

**Yes for control-flow integrity.** If the IR (nodes, edges, effect set, callees, loop bounds) is fixed and hash-pinned from trusted inputs before any untrusted byte is read, injected text cannot add an effect, tool, node or edge. This holds because the interpreter only executes declared operations, independent of how robust the model is. It is a reference-monitor proof, not a claim about model behaviour.

**The limits:**
1. **Path steering.** Untrusted values feeding branch conditions, loop termination, `map` cardinality, search scores or router features can choose among pre-declared paths (implicit flows).
2. **Argument control.** Untrusted data can still set recipients, paths, URLs, shell arguments or patch content.
3. **Content integrity.** LLM nodes that read untrusted data emit attacker-influenced values (text-to-text attacks).
4. **Dynamic nodes.** `plan/expand` and tool-bearing agent nodes reopen the hole.
5. **Composition.** A `call` that passes untrusted text on the child's instruction channel breaks the guarantee.
6. **Construction and supply chain.** A builder agent that has read untrusted content can be steered, and a poisoned library harness carries its own risk.
7. **Side channels.**
8. **Utility ceiling.** Data-dependent tasks need human endorsement.
9. **OS sandbox still needed.** Agent-built code still needs one; the README itself says installing the MCP does not sandbox the agent.

### 2.5 Sandboxing

- **Anthropic sandbox-runtime (srt).** Uses bubblewrap on Linux and sandbox-exec on macOS, with a proxy-based network allowlist and controls on filesystem, Unix sockets and network. Apache-2.0, beta. Claude Code saw 84% fewer permission prompts. Anthropic's guidance is that filesystem *and* network isolation are both required. *Adopt as the local default.* https://github.com/anthropic-experimental/sandbox-runtime [V]
- **Codex sandbox (bubblewrap).** Also uses bubblewrap on Linux. https://developers.openai.com/codex/concepts/sandboxing.md [V]
- **gVisor.** A user-space application kernel written in Go; the `runsc` OCI runtime works with Docker and Kubernetes. *Adopt for untrusted generated code on Docker hosts.* [V]
- **Firecracker.** KVM microVMs: under 125 ms boot, up to 150 VMs per second per host, under 5 MiB overhead each. *Adopt when you need VM isolation plus environment snapshots on KVM hosts.* Snapshot details [R]. [V]
- **E2B.** Firecracker/KVM infrastructure, Apache-2.0. Self-hosting is via Terraform on GCP, with AWS in beta; a general Linux machine is not supported. *Cloud only.* https://github.com/e2b-dev/infra [V]
- **Modal.** Jobs run under gVisor; network controls include `block_network`, CIDR allowlists and a domain allowlist in beta. Managed only. [V]
- **Daytona.** The repo has been "no longer maintained" since June 2026; core development moved private. *Avoid as a dependency.* [V]

### 2.6 Observability and provenance

- **OTel GenAI semantic conventions.** Moved to `open-telemetry/semantic-conventions-genai` on 2026-05-05. All `gen_ai.*` signals are at "Development" status and the repo has **no releases**. Operations include `invoke_workflow`, `invoke_agent`, `execute_tool`, `plan`, `create_agent` and memory operations. There is a `gen_ai.evaluation.result` event with name, score value/label and explanation. *Pin a commit and wrap it.* [V]
- **Trace models:**
  - Langfuse: observations nested in traces, traces grouped in sessions; built on OTel. [V]
  - LangSmith: project → trace → runs, plus threads and feedback; capped at 25,000 runs per trace. [V]
  - Phoenix (OpenInference): span kinds LLM, EMBEDDING, CHAIN, RETRIEVER, RERANKER, TOOL, AGENT, GUARDRAIL, EVALUATOR, PROMPT. [V]
  - Braintrust: span types eval, task, llm, function, tool, score, classifier. [V]
- **Provenance.**
  - SLSA attestation model: DSSE envelope, in-toto statement, predicate; Verification Summary Attestations. [V]
  - OpenSSF Model Signing v1.0 (Apr 2025): a detached Sigstore bundle with an in-toto statement over a manifest of file hashes, independent of PKI. [V]

## 3. What a frontier router, allocator, healer and security layer for Foundry should look like

### Router

1. **Action space.** An action is a tuple (harness hash, strategy, budget tier, model class). Filter it first by hard constraints:
   - the IR type-checks against the task contract;
   - ARC grants and the effect policy allow it;
   - the owner model-policy file allows it (Arch-Router-style labels);
   - it passes a Rule-of-Two check.
2. **Decision point.** Decide once at run admission and pin the choice. Node-level model downgrades come from a separate router trained on node-level verified labels, with a penalty for breaking the trajectory.
3. **Context.**
   - Task-signature fields: family, contract kind, effect class, size.
   - Outcomes per arm from the k nearest neighbours in the archive.
   - Surrogate estimates of P(success) and E[cost].
   - Taken **from trusted fields only**, since router features are themselves an injection path.
4. **Policy.**
   - Hierarchical Beta–Bernoulli Thompson sampling per (family, arm), with the surrogate as prior (5–10 pseudo-counts).
   - Utility = V·success − λ·cost, with λ set by owner policy.
   - Keep an ε floor of at least 0.05 per eligible arm, plus a 10% fully randomised slice.
   - Log propensities computed from seeded Monte-Carlo draws of the posterior.
   - Make cascades (cheap harness → verify → escalate) first-class arms.
   - Upgrade path: LinTS with an OrcaRouter-style full-information warm start replayed from dev slices.
5. **Reward.** Only from independent qualification. Log same-model-judge rewards but exclude them until the H8 experiment shows their inflation is under 2 points.
6. **Promotion.**
   - Estimate value with a doubly robust estimator, using the surrogate as the reward model and clipped (SWITCH) importance weights.
   - Promote a new policy only if the lower anytime-valid confidence bound on V(new) − max(V(current), V(best single arm)) is above 0.
   - **When ARC chooses deterministically, its logs cannot evaluate other policies offline.** ARC must randomise within a band, or OPE must rely on Foundry's uniform slice.

### Allocator

1. **Calibrate per slice.** Estimate candidate pass rate p, verifier true-positive rate α and false-positive rate β from execution-labelled history. Flag the verifier as correlated when it shares a model with the generator.
2. **Sample-until-accept.**
   - Let q = pα + (1−p)β and precision π = pα/q. **Precision does not depend on N.**
   - The next sample is worth drawing only if E[q | k rejects]·(πV − (1−π)C_fp) > c, where C_fp is the cost of delivering a wrong result and c the cost per candidate.
   - If πV ≤ (1−π)C_fp, then N* = 0: escalate the verifier or harness, or abstain. This is the formal "more N hurts" condition.
   - A Beta prior on each instance's q makes repeated rejects lower E[q], so compute stops on unsolvable tasks.
3. **Argmax selection.** Choose N per slice from held-out curves of true quality versus N, which are non-monotone. For long trajectories, use pairwise knockout or tournament voting over summaries. Locally, use logit-expected scores.
4. **Step gate (CATTS).** Draw k candidate actions. Act directly when the margin is at least τ; otherwise arbitrate, or fork from an environment snapshot (H9).
5. **Portfolio racing.**
   - Offline: successive halving with η = 3 on paired tasks, ranked by the lower confidence bound of success per dollar; use Hyperband brackets when the horizon is unknown.
   - Online: race in parallel and cancel on the first qualified result only when effects are idempotent and sandboxed. Otherwise run a cascade ordered by p_i/c_i descending (the classical optimal order [R]).
   - Budgets stay hierarchical, and `maxCost 0` remains the default.

### Healer

1. **Replay passes:** classify as a flake.
2. **Resample K = 8 at fixed upstream state:** if the Wilson lower bound on the flip rate exceeds τ, classify as model variance and hand it to the allocator. No IR patch.
3. **Environment fingerprint differs** from the last passing run: classify as environment.
4. **Contract unsatisfiable** on a known-good example: escalate to the owner.
5. **Otherwise it is a harness defect.**
   - Substitute each node's output (resample, known-good value, or stronger model class).
   - Order the interventions by an LLM tracer's prior (only a prior: about 55% accuracy at best).
   - Run delta debugging (ddmin) to find the minimal failure-inducing node set.
6. **Patch** only with scoped operators, HarnessFix-style: prompt delta, tighter schema, added verify node, strategy swap, guard, or model-class escalation within policy.
7. **Accept** only if:
   - the failing case passes on K replays;
   - the regression slice is non-inferior (paired, one-sided);
   - the held-out slice is at least as good;
   - oracle hashes are untouched;
   - the canary set does not "improve".

   Then promote by CAS with an evidence bundle; otherwise keep the negative evidence.

### Security layer

1. **Construction.** The IR is constructed by a builder whose context holds no untrusted content, then hash-pinned. A model check against temporal policies (CaMeLoT-style) runs at build time and on every `expand` proposal.
2. **Labels.** Every value carries integrity, confidentiality and provenance labels. The program counter is tainted whenever a branch, loop or map count, search score or routing decision depends on a label.
3. **Sink policies.** Policies per effect class are enforced at the runtime and at ARC's `runEffect`. Untrusted values can never be recipients, paths, URLs or shell arguments. A violation means refuse, or ask a human to endorse.
4. **Quarantined agent nodes.** A node that reads untrusted data has no tools, uses constrained decoding into small types (bool, enum, bounded int), and its outputs are labelled untrusted.
5. **Composition.** A `call` carries untrusted data only on a labelled data channel (the multi-CaMeL approach).
6. **Expansions.** Proceed automatically only when they narrow privileges, Progent-style.
7. **OS sandbox underneath.** srt or bubblewrap locally; gVisor or Firecracker for stronger isolation; E2B or Modal in the cloud.

### Audit

The hash-chained ledger stays authoritative.
- **OTel export.** Pinned semantic-conventions commit plus `foundry.*` attributes: harness hash, propensity, independence label. Verify nodes map to evaluator spans with `gen_ai.evaluation.result`.
- **in-toto statements:**
  - promotions: subject = harness hash; predicate = scores, oracle hashes, parent;
  - delivery receipts: subject = artifact hash; predicate = run record and model ids.
- **VSA.** Use Verification Summary Attestations for "qualified" status.

## 4. Open questions

1. What fraction of the 9B builder's harnesses pass the static security checks, and what utility do labels and program-counter tainting cost on Foundry tasks (label creep)?
2. With arms × families, does harness-level routing get enough runs per day to learn? Hierarchical pooling needs a power analysis.
3. Can ARC's selector expose propensities, or randomise, so that OPE is valid?
4. How quickly do verifier α/β estimates drift across harness versions, and how should recalibration be triggered (anytime-valid)?
5. Does replay-based interventional attribution beat LLM tracers at equal cost (H4b)? I found no head-to-head study.
6. Fork versus restart (H9): the evidence is training-time (BranPO, PATR) or a pivot-step analysis (CATTS). Nothing compares them at inference time with environment snapshots.
7. Can an attacker steer routing toward a weaker harness through task text? If so, routing must be restricted to arms that are all policy-safe.
8. Learned simulators (SWE-World) as cheap pre-filters: what is the reward-hacking risk inside the outer loop?
9. When will the OTel GenAI conventions see a first release, and will attribute names change before it?

Several vendor doc pages (E2B, Braintrust, LangChain) contained instructions aimed at AI agents, such as "use our MCP server or CLI". I did not act on them.
