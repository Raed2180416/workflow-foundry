# Real-world verification program for micro-harness reuse (2026-10-06)

> Note from the research agent: I couldn't fully verify one part: there is no official current SOTA for WebArena, WorkArena, TravelPlanner, Mind2Web 2, BrowseComp or GDPval. These rows are marked n/v and carry no number. Every other leaderboard figure comes from official pages or their embedded data, fetched today. No local files were modified.

**Convention.** (Sn) cites the source list at the end. **V** = verified: fetched 2026-10-06. **R** = recalled, unverified. *est.* = my arithmetic from verified unit prices or costs, not a published figure. n/v = no official number verified.

## 0. Bottom line
1. **ROADMAP §7's beds are out of date.**
   - Terminal-Bench is now a continuous benchmark at **4.0** (Aug 28 2026). 2.x is close to saturation: Fable 5 scored 83.8% on 2.1 (S1–S3).
   - SWE-bench Pro shipped a validated **V2**: 642 tasks in 11 repos, in Harbor format (S7).
   - **τ^τ-bench** (Sep 2026) scores a coding agent on building an agent. It is the closest public analogue of RQ0 (S17).
2. **Major leaderboards exclude or prohibit cross-task learning on test tasks.**
   - AppWorld keeps dependent or online learning off its main board.
   - Terminal-Bench counts task-specific information given to the agent as cheating (S4, S13).
   - So reuse has to be tested with a pre-registered *stream* protocol and reported as non-leaderboard results.
3. **Prior evidence points both ways.**
   - Changing only the harness (model-kept notes → preserved reasoning state + compaction) took GPT-6 Astra on ARC-AGI-3 from 62.7% to 99.9% (S22).
   - CL-Bench found that naive in-context accumulation beats dedicated memory systems (S33). A "plain agent + accumulated notes" baseline is therefore mandatory.
4. **The Anthropic-hosted cloud VM has Docker**, but only 4 vCPU, 16 GB RAM and 30 GB disk. Node 20–22 is preinstalled and Foundry needs Node 24. Foreground commands max out at 10 minutes (S37). Run container-heavy beds through Harbor's remote sandboxes (Modal or Daytona) (S5).
5. **Cost (est.):** Tier A about $1–3K, Tier B about $4–8K, Tier C about $6–7K plus τ^τ (cost unknown). Free hosted models don't work past Tier A, because 429s break paired, matched-budget streams.

## 1. Benchmark landscape

### 1a. Beds with natural task families
| Bed | Family structure | SOTA (official) | Cost signal | Infra / cloud | Contamination | Fit |
|---|---|---|---|---|---|---|
| SWE-bench Pro V2 (S7–S9) | 642 tasks/11 repos (~58/repo); HARD-51 | v1 public board: Muse Spark 1.1 61.5±3.1; GPT-5.4 xHigh 59.1 (mini-swe-agent) | proxy $0.85–4.40/problem (S11) | GHCR images; `harbor run -e modal`; oracle resolves 642/642 | copyleft; OpenAI recommends Pro over Verified (S10) | **High**: per-repo streams |
| SWE-rebench (S11) | rolling windows (111 problems/65 repos, 15 May–1 Jul 2026); pool of 21k+ tasks | Fable 5 64.5±1.4 ($4.40/problem); GPT-5.6 Sol 62.3 ($0.85) | published | Docker | fresh by construction | Medium |
| SWE-Gym / R2E-Gym / SWE-smith (S12) | 2,438 / 8.7K tasks; synthetic generation | training sets | — | Docker | older repos | dev-only family generator |
| AppWorld (S13, S14) | 750 tasks, 9 apps, 457 APIs; 3-variant scenarios (SGC) | LARA MAS + Opus 4.7: test-challenge TGC 85.6 / SGC 77.0 (Sep 2) | cheap simulator | `pip install appworld`, Docker optional; DB checkpointing | public since 2024 | **High**; online learning not eligible for the board |
| τ²/τ³-bench (S15, S16) | each domain is a family | τ² text avg pass^1 87.9 (Qwen3.5-397B); τ³ banking 55.2 (Qwen 3.8 Max) | plus LLM user simulator | `uv`, Py ≥3.12, API keys | 50+ tasks fixed Feb 2026; regraded Jul 2026 | High for pass^k; near-saturated |
| τ^τ-bench (S17) | 53 construction tasks, 4 domains (rebuilt airline/retail) | Opus 5 + Claude Code 23.9%; expert ceiling 82.2% | n/v | Docker + OpenAI and OpenRouter keys | rebuilt domains defeat memorization | **RQ0 external bed** |
| WebArena(-Verified) (S18, S19) | 812 tasks from 241 templates (3.3 each); Hard-258 | n/v | — | 6 self-hosted sites, slimmed images | public 2023 | Medium |
| WorkArena/++ (S20) | 33 ServiceNow task types; 682 compositional | n/v | — | ServiceNow instance (R2) | — | High structure; needs an account |
| ARC-AGI-3 (S21–S25) | 135 environments (25 public); levels within a game | §2 | $3K–50K per semi-private run | offline engine, no key, ~2,000 FPS | hidden sets | **High**: level progression = family |
| BALROG (S26) | 6 game suites | GPT-6 Astra Max 68.3±2.0; Opus 5 Max 63.4±1.8 | — | pip | — | Medium-high |
| Terminal-Bench 4.0 (S1, S2) | ~66 tasks (inferred: 74 at 3.0 minus 8 removed; matches 330 trials at 5/task); no families | Claude Code + Opus 5.5 64.85±3.1 ($4,719); Codex + GPT-6.1 Sol 58.2 ($634) | $0.22–29/trial | Harbor; Docker or Daytona/Modal; 8 h timeout | continuous, saturated tasks pruned | Low for reuse; use as a non-inferiority check |

The continual-learning suites supply protocol and metrics rather than beds: StreamBench, Evo-Memory, AgentCL, CL-Bench, PATH-Bench, SkillLearnBench and LifeMem (S33). AgentCL's dependent, conventional and independent streams, and CL-Bench's six domains, make good external replications.

### 1b. Poor fits
- **OSWorld-Verified:** top score 90.19 (Intelligence-Indeed Agent, Jul 25); VM/AWS-based (S27).
- **OSWorld 2.0:** 108 tasks, 1.6 h human median; best in the paper 20.6% (S28).
- **TheAgentCompany:** 175 tasks, top 42.86% resolved; board unchanged since Nov 2025; heavy stack (S29, R3).
- **GDPval:** expert-graded; the OpenAI leaderboard is inactive (S30).
- **MLE-bench:** 75 competitions, 24 h runs; top 64.44%; closed to submissions since Apr 24 (S31, R4).
- **BrowseComp** (1,266 questions) and **Mind2Web 2** (130 tasks, agent-as-judge): independent questions on the live web (S32).
- **TravelPlanner:** 1,225 intents; SOTA n/v (S32).
- **Harbor-Index:** 82 hard tasks, "a few hundred dollars" per run. Useful as a generality check only (S6).

## 2. ARC-AGI-3 and game-loop beds
- **Interface (S23):**
  - The `arc_agi` toolkit has OFFLINE, ONLINE and COMPETITION modes.
  - Actions: ACTION1–5, ACTION6 with x,y in 0–63, and ACTION7 = undo.
  - REST API with scorecards and replays; 600 RPM online.
  - Anonymous access gives 3 games. A free key unlocks the rest of the public set.
  - Offline play needs no key, has no rate limit and runs at about 2,000 FPS.
  - The environment wrapper documents only `reset`/`step`, with no snapshot.
- **Scoring (RHAE, S23):**
  - Per level: (human actions / AI actions)², capped at 1.15. The human baseline is the upper-median first-time player.
  - Per game: level-weighted mean, capped by completion. Overall: mean across games.
  - Tool calls and reasoning don't count as actions.
- **Leaderboard (semi-private, S21, S22):**

| System | Harness | Score | Cost |
|---|---|---|---|
| GPT-6 Astra | Provider Adapter | 99.95% | $18.8K |
| GPT-6 Astra | standard notes | 62.7% | $26.1K |
| GPT-6.1 Sol | adapter | 96.4% | $4.4K |
| Gemini 3.8 Flash | adapter | 35.0% | — |
| Claude Opus 5 (High) | — | 30.2% | $20.7K |
| Frontier at launch (Mar 25) | — | 0.51% | — |

  Astra used fewer actions than the median human on 96% of levels. Higher reasoning effort was *cheaper* because it took fewer actions.
- **Best open approaches (Kaggle Milestone 1, local models, no internet, S25):**
  - **Tufa Labs "The Duck":** Qwen 3.6 27B writes Python in a live REPL and evicts old context. Hand-built tools made it *worse*.
  - **Reki and "forge":** Gemma-4-31B vision-language JSON-action policies with reflection memory. The best forge run switched off its extra machinery.
  - Scores on local public games were an unreliable proxy for the leaderboard.
- **Limits (S23, S24):** Kaggle runs have no internet and no API models. Accelerators: CPU, 2×T4, P100 or RTX 6000. Submissions close Nov 2 and results come Dec 4. I couldn't find the runtime limit.
- **Implication for H7.** At the frontier, ARC-AGI-3 is saturated when the harness is good. Use it as a **fixed cheap-model bed** instead: the 25 public games run offline, with 342 human replays as an efficiency baseline (S21).
  - Restore state by replaying the action prefix, after testing determinism.
  - Report any simulator branching separately, because RHAE counts interactions with the environment.
- **Other cheap loops:**
  - TextWorld `tw-make --seed` generates games per parameter set, which gives exact families.
  - BALROG (BabyAI, Crafter, TextWorld, BabaIsAI, MiniHack, NetHack) is pip-installable. The best NetHack progress is 13.2%.
  - Craftax and MiniHack are pip-installable (S26, S43).
  - The procedural level families and Craftax's trivially snapshotted JAX state are recalled, not verified (R1).
  - AppWorld's DB checkpointing supports fork-vs-restart (H9).
  - Skip Pokémon-style runs: they give one long trajectory, so K≈1.

## 3. Metrics and methodology
| Metric | Definition |
|---|---|
| pass@k vs pass^k | pass^k = P(all k trials succeed), estimated as C(c,k)/C(n,k). On τ-bench, gpt-4o scored pass^8 <25% on retail (S16). Reuse should lift pass^k more than pass@1. |
| Cost per success (CPS) | All dollars spent (failures, retries, construction, verification) ÷ oracle-verified successes (S35) |
| Amortized curve | C(t)/S(t) per family at stream position t. Report break-even t* and the area between curves. |
| Time-to-first-harness (TTFH) | Tasks, dollars and wall time until the first harness qualifies |
| Reuse / deopt / wrong-reuse | Share of tasks routed to a library harness; share that bail out to the general agent; share where the harness finished and the oracle failed but B0 passed |
| Learning gain | The arm with its state, minus the same arm with state wiped, on the same sequence (S33) |
| Transfer | Forward and backward transfer and forgetting; degradation on held-out families and independent tasks (S33) |

**Protocol**
- Pre-register families. Split each into a dev stream and a sealed stream.
- The library learns only from dev streams and from earlier tasks of the sealed stream, never from oracles.
- Run learning arms in at least 3 random orders.
- Interleave arms on identical sandboxes. Infrastructure alone moved TB 2.0 scores by 6 points (S36).

**Contamination**
- Prefer fresh, rebuilt or private tasks.
- Run the gold-patch reproduction probe that OpenAI used to retire SWE-bench Verified (S10).
- Scan the library for task-specific literals (S4).

**Oracle health**
- Oracles fail too: at least 59.4% of an audited Verified subset had flawed tests (S10). ELT-Bench-Verified found benchmark errors as well (S42).
- Gate every bed with an oracle agent and a no-op agent, plus known-good and known-bad controls.

**Power** (my calculation; α=.05, power .8; paired log-cost t-test and McNemar):

| Claim | Assumption | Paired tasks |
|---|---|---|
| ≥30% lower cost | SD of log-diff 0.6 / 0.8 / 1.0 / 1.2 | 23 / 40 / 62 / 89 |
| +10 pt success | 15% / 20% / 30% discordant | 116 / 155 / 234 |
| Non-inferiority, 10-pt margin | 10% / 20% discordant | 62 / 124 |
| Non-inferiority, 5-pt margin | 10% / 20% discordant | 248 / 495 |

Clustering inflates the required n by 1+(m−1)·ICC: 3.7× for 10 tasks per family at ICC 0.3. So add more families rather than more tasks per family, and use a family-clustered paired bootstrap (S35).

**Baselines.** Freeze all of them by hash, with the same model, tools and budget.

| ID | Baseline |
|---|---|
| B0 | Stateless plain agent |
| B0+N | B0 plus append-only notes from earlier tasks |
| B1 | CC-workflow-style script per family, written by an independent subagent with an equal construction budget |
| B2 | Memory/skills: AWM (+24.6% / +51.1% relative on Mind2Web / WebArena), ACE (+10.6% on agents), ReasoningBank, or self-written SKILL.md (S33, S34) |
| B3 | AFlow or Meta-Harness, optimized on dev families, then frozen |
| Ceiling (Tier A) | Hand-written harness |
| Ablations | F without reuse, without the verify gate, without deopt |

## 4. Recommended program

Prices per million tokens (S38):

| Model | Input | Output | Cache hit |
|---|---|---|---|
| Opus 5.5 | $4 | $20 | $0.20 |
| Sonnet 5.5 | $2 | $10 | — |
| Haiku 4.5 | $1 | $5 | — |

The Batch API takes 50% off non-interactive steps. Budget per completed task, not per token: on TB 4.0, the Sonnet 5.5 run cost $7,334 against $4,719 for Opus 5.5 (S1).

| Tier | Bed | Size | Arms | Est. cost | Claims |
|---|---|---|---|---|---|
| A1 | TextWorld, MiniHack/BabyAI families, own seeded puzzle sim with snapshots | 8 families × 30 tasks × 3 orders | B0, B0+N, B2, F, ceiling | about 3K episodes × $0.09–0.17 → **$0.3–1.2K** | reuse, TTFH, deopt; H9 |
| A2 | ARC-AGI-3 offline, 25 public games | 3 arms × 3 seeds, ≤300 actions | B0, B0+N, F | **$0.4–1K** | H7 |
| A3 | IDoFT Python order-dependent flaky tests | 100 tests × 2 orders | B0, B0+N, B2, F | **$0.2–0.8K** | cheap real-world oracle |
| B1 | SWE-bench Pro V2 per-repo streams | 6 repos × 20 tasks × 2 orders | B0, B0+N, B1, B2, F | about 960 runs × $1.4–4.4 → **$1.5–5K** plus Modal | primary H0 |
| B2 | AppWorld | library from train/dev; sealed test scenario streams | same | **~$1K** | H0, SGC |
| B3 | τ² domains (+τ³ banking) | K=4 trials per task | B0, B2, F | **~$1K** | pass^k |
| B4 | Owner replay families (§6) | ~60 tasks | B0, B0+N, F | **$0.3–1K** | external validity |
| C1 | TB 4.0 via Harbor (Daytona/Modal) | 66 × 3 trials × 2 arms | Claude Code ± Foundry | 396 × $14.3 → **~$5.7K** | non-inferiority, overhead and deopt on non-recurring tasks |
| C2 | τ^τ-bench | 1-task gate, then 53 × 2 arms | Claude Code ± Foundry | unknown until the gate | RQ0 |
| C3 | ARC-AGI-3 online scorecards; optional Kaggle entry with a local model | best A2 config | — | about the same as A2 | replays |

A1 assumes 20 calls per episode, about 4K input tokens (mostly cached) and 600 output tokens per call.

**Gates**
- **Feasibility:** run the oracle agent and the no-op agent once per container bed (S7).
- **A→B kill:**
  - **Precondition:** families where the ceiling harness reaches ≥90% success at ≤10% of B0's cost.
  - **Requirement:** F must reach ≥60% reuse and amortized CPS ≤0.7×B0 by task 10, in at least 6 of 8 families.
- **Minimum spend:** A1 + A3 on Haiku 4.5 costs under $1K and decides whether Tier B runs.
- **Free-only path:** local Ollama on Tier A only, which needs the D5 waiver.

## 5. What would falsify the claim
Pre-register these. Any single one falsifies the claim within the tested envelope.
1. **No amortization.**
   - In Tier B, the lower 95% CI bound of the pooled F/B0 cost-per-verified-success ratio at task 10 is ≥0.85, or
   - fewer than half of the families break even within 15 tasks.
2. **Lower quality.**
   - Non-inferiority fails (margin 5 points in Tier A, 10 points in Tiers B and C), or
   - F's pass^3 is below B0's.
3. **Wrong attribution.** F doesn't beat the better of B0+N and B2 on amortized CPS (the CI includes 1). Then the gain comes from "memory", not compiled harnesses.
4. **Unsafe reuse.**
   - Wrong-reuse exceeds 5% of invocations, or
   - held-out-family or independent tasks fall more than 5 points below B0.
5. **Game loops.** No gain in RHAE or levels per dollar at matched budget on A2 plus one procedural bed.
6. **Construction.** On τ^τ-bench, Claude Code + Foundry doesn't beat Claude Code alone at equal budget.

## 6. Recurring families the owner actually faces
A read-only scan of `~/Projects` found:

| Repos / signals | Count |
|---|---|
| Git repos | 31 |
| With `package.json` | 12 |
| Python | 6 |
| With GitHub Actions | 12 |
| With Playwright or dbt | 0 |

| # | Family | Instance | Oracle | External bed |
|---|---|---|---|---|
| 1 | Dependency upgrades across repos | Renovate or `npm outdated` bump plus fix; replay historical Dependabot PRs | Clean-container install, build, typecheck and tests. A diff guard rejects deleted or skipped tests and checks the version really changed. | BUMP: 571 breaking updates from 153 Java projects, as Docker image pairs. LLMs fix 20–27% of builds (S39). |
| 2 | CI failure repair | Historical failing→fixed runs (`gh run list`) | Full workflow re-run, in a container (`act`, R6) or on a fork | CI-Repair-Bench: 567 failures, 103 repos, 12 error types; best LLM 18.9% (S40) |
| 3 | Flaky-test triage and repair | Classify order-dependent vs other; fix order-dependent ones | 100 seeded orders plus isolation reruns. A passing test needs about 170 reruns for 95% confidence. | 7,571 flaky Python tests, 59% order-dependent. Agents fixed about 70% of victim tests but only 23% of brittle ones (S41). |
| 4 | Web QA flows (Foundry UI) | Write and maintain browser checks | Mutation oracle: injected regressions must be caught and clean builds must pass | WebArena-Verified Hard-258 (S19) |
| 5 | Data/SQL repair | Fix a transform | Diff the result table against gold | ELT-Bench: best 3.9% at $4.30 per pipeline; Verified audit; Squirrel 469+516 tasks (S42) |

## 7. Concrete edits to ROADMAP §6–8
- **§7 Tier B:**
  - Replace TB 2.0 with **TB 4.0** and move it to Tier C as a non-inferiority and overhead check. It has no families.
  - Use **SWE-bench Pro V2 per-repo streams**.
  - Add **τ^τ-bench** to RQ0.
- **ARC-AGI-3:** a key is needed only for online scorecards and the full public set. Recast it as a cheap-model bed.
- **§6 H0:**
  - Restate it as: amortized CPS ratio + non-inferiority margin + must beat B0+N and B2.
  - Measure "the next 5 tasks" across at least 8 families (≥40 pairs).
- **§7 baselines and metrics:** add B0+N, B2, B3, the ceiling arm, TTFH, reuse/deopt/wrong-reuse, learning gain and pass^k.
- **§7 discipline:**
  - Never submit online-learning runs as standard leaderboard entries.
  - Add the library-leakage scan and the gold-patch probe.
  - Interleave arms.
- **§8 Phase 0.0:**
  - Install Node 24 in the setup script.
  - Raise `BASH_DEFAULT_TIMEOUT_MS`.
  - Use Custom network access for Modal, Daytona and the ARC API.
  - Budget container images within the 30 GB disk.
- **D1:** present the tiers in §4 with their costs.
- **Still unknown:** τ^τ cost per task, the Kaggle runtime limit, ARC engine determinism, and WebArena image sizes against 30 GB.

## Sources (V = verified: fetched 2026-10-06; R = recalled, unverified)
- S1 https://www.tbench.ai/leaderboard/terminal-bench/2.0 (redirects to the TB 4.0 board; embedded JSON) V
- S2 https://www.tbench.ai/news/terminal-bench-4-0 V
- S3 https://www.tbench.ai/news/terminal-bench-3-0 V
- S4 https://www.tbench.ai/news/leaderboard-integrity-update V
- S5 https://github.com/harbor-framework/harbor V
- S6 https://www.tbench.ai/news/harbor-index V
- S7 https://github.com/scaleapi/SWE-bench_Pro-os V
- S8 https://scale.com/leaderboard/swe_bench_pro_public V
- S9 arXiv 2509.16941 V
- S10 https://openai.com/index/why-we-no-longer-evaluate-swe-bench-verified/ V
- S11 https://swe-rebench.com; arXiv 2505.20411 V
- S12 arXiv 2412.21139, 2504.07164, 2504.21798 V
- S13 https://appworld.dev/appworld/leaderboard (+ leaderboard.json) V
- S14 arXiv 2407.18901; https://github.com/StonyBrookNLP/appworld V
- S15 https://taubench.com (submissions manifest on S3) V
- S16 arXiv 2406.12045, 2506.07982; https://github.com/sierra-research/tau2-bench V
- S17 https://sierra-research.github.io/hyper-tau-bench/; arXiv 2609.04611 V
- S18 arXiv 2307.13854 V
- S19 https://github.com/ServiceNow/webarena-verified V
- S20 arXiv 2403.07718, 2407.05291 V
- S21 https://arcprize.org/arc-agi/3, /blog/arc-agi-3-launch, /blog/arc-agi-3-human-dataset V
- S22 https://arcprize.org/media/data/evaluations.json, /results/openai-gpt-6-astra, /blog/astra V
- S23 https://docs.arcprize.org (methodology, local-vs-online, rate_limits, available-games, arc-prize-2026, toolkit/*) V
- S24 https://arcprize.org/competitions/2026 V
- S25 https://arcprize.org/blog/arc-prize-2026-milestone-1 V
- S26 https://balrogai.com; arXiv 2411.13543 V
- S27 https://os-world.github.io (osworld_verified_results.xlsx) V
- S28 https://osworld-v2.xlang.ai/ V
- S29 https://the-agent-company.com; arXiv 2412.14161 V
- S30 arXiv 2510.04374; https://evals.openai.com/gdpval/leaderboard V
- S31 https://github.com/openai/mle-bench V
- S32 arXiv 2504.12516, 2506.21506, 2402.01622 V
- S33 arXiv 2406.08747, 2511.20857, 2606.02461, 2606.05661, 2608.01149, 2604.20087, 2609.12655 V
- S34 arXiv 2409.07429, 2510.04618, 2410.10762, 2603.28052, 2509.25140 V
- S35 arXiv 2411.00640, 2407.01502, 2510.11977 V
- S36 https://www.anthropic.com/engineering/infrastructure-noise V
- S37 https://code.claude.com/docs/en/cloud-environments V
- S38 https://platform.claude.com/docs/en/about-claude/pricing V
- S39 arXiv 2401.09906, 2505.07522; https://dl.acm.org/doi/10.1145/3729366 V
- S40 arXiv 2604.27148 V
- S41 arXiv 2101.09077; https://mediatum.ub.tum.de/doc/1847500/uz70xgu4kwj76cdbnka2ornhw.pdf V
- S42 arXiv 2504.04808, 2603.29399, 2601.18119 V
- S43 READMEs of TextWorld, Craftax, NLE and MiniHack on GitHub V
- R1 Procedural level families in MiniHack/BabyAI; Craftax functional JAX state R
- R2 WorkArena needs a ServiceNow developer instance R
- R3 TheAgentCompany needs a multi-service self-hosted stack R
- R4 MLE-bench needs GPUs R
- R6 `act` runs GitHub Actions locally R
