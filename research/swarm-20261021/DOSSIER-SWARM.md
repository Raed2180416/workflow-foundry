# Swarm ladder (D3): research dossier

*Research phase of item "swarm-ladder" (owner question D3: are Kimi-style agent swarms in scope?). Written by the
research step of workflow gap-closure-2 (wf_6d3b90c9-c30); committed here with the build. §1–§5 are the research
phase's text, lightly edited for layout; §6 says what was built and where the preregistration departs from the
research plan. The research phase cost $0: no model calls, nothing written to the repository, `beds/sealed/` never
read.*

Research tools were limited. WebSearch hit the shared per-turn limit after 9 searches, Exa returned 402 (no credits),
Scite needs a paid plan, and the GitHub API is blocked for repositories outside this session. Licences therefore come
from the PyPI JSON API and raw LICENSE files, and a few niche-field details are from memory, marked [U].

Tags: **[M]** measured here or in repo data; **[D]** documented in the cited source (fetched 2026-10-21); **[D-sec]**
secondary source only; **[I]** inference; **[U]** unverified.

## 1. What exists in the repo

- **The swarm bed is built.** `wbed-r6` v1.1.0 (`beds/wbed/r6/`, notes in
  `research/jit-20261008/design/W-BED-R6-NOTES.md`) has an exact oracle and stage oracles (index, plan, worker, reduce),
  relations Y1–Y5, 29 bad controls, a decidability witness, a `codePlan` / `coverageIssues` code check, `unitChecks`,
  and `MAX_FANOUT` 32. The bed's own conclusion: "no $0 evidence separates `wide` from an agent with tools".
- **It is a closed template grammar.** A text-only parser solves d2–d4, so any arm that writes code can turn R6 into a
  parser-writing task [M, bed notes §13].
- **The one-call gate already ran, and it decides the difficulty** [M,
  `research/need-router-20261014/runs/m1*/`, dev seeds 379–390, K = 1]:

  | difficulty | one Haiku call, effort none | effort medium | gate (≤ 2/12) |
  |---|---|---|---|
  | d3 | 2/12 | **6/12** ($0.036 per call) | **fails** |
  | d5 | 2/12 at a 600 s limit | 0/12 | passes |

  At d5 one call costs $0.24–0.32, because the prompt is above Haiku's 100K-token price step, and takes 260–340 s. The
  mean score is 0.81. The failures are mostly missing entities (coverage) and a wrong excluded-document set, which are
  breadth failures. **So the swarm rung is d5.**
- **d5 sizes** [M, a $0 sizing script on test-split seeds 8401–8406, generated analyst-side only: no arm saw them, and
  the rung does not use them]: 400 documents; the whole task inline is 104–106K tokens; 18–22
  compounds in scope, 26–28 plan candidates, 90–110 table cells, 4–9 excluded documents; an agent with tools needs to
  read 79–92K tokens of documents; tier "novel-test": the test dates use a phrasing no dev task contains;
  `referenceSolve` passes the oracle on every seed.
- **Gaps against task #49:** only the R1 and R3 Opus reference workflows exist and are frozen
  (`beds/wbed/references/FROZEN.json`); there is no R6 reference. `research/jit-20261008/PREREG-WBED-SLICE1.md` is a
  draft covering R1 and R3 only, with 23 TBDs, and is not frozen. No W-bed paid stream has ever run.
- **Harness pieces reused unchanged:** `runExperiment` (`experiments/lib/runner.mjs`: environment-fault rule, strict
  resume, stall rule); `b0Agent` (Claude Code with Bash/Read/Write/Edit/Glob/Grep); `b1Script` (a built `solve.mjs`
  whose only way out is a gateway with a hard per-task dollar ledger); `construct()` (`experiments/c0/construct.mjs`);
  `pairedBootstrap` and `mcnemar` (`experiments/lib/stats.mjs`). `runClaudeCode` already accepted `env`, but could not
  pass extra CLI flags, and its default tool list excludes `Agent`.
- **Claude Code overhead is negligible at Haiku prices.** One Haiku agent session on the small R0 rung costs about
  $0.001 [M]. The binding constraint is the shared session limit, not dollars.

## 2. Frontier as of 2026-10-21

- **Kimi Agent Swarm and PARL.** K2.5 blog, 2026-01-27 (https://www.kimi.ai/blog/kimi-k2-5) [D]: a trainable
  orchestrator over frozen sub-agents, up to 100 sub-agents and 1,500 steps; training reward = r_perf +
  λ1·r_parallel (against "serial collapse") + λ2·r_finish (against "spurious parallelism"), both λ annealed to 0; a
  "Critical Steps" metric (orchestrator overhead plus the slowest sub-agent, per stage); claims of 3–4.5× fewer critical
  steps and an 80% runtime cut (internal evaluation). Help page, K2.6 (2026-04-20), now "K3 Swarm"
  (https://www.kimi.ai/help/agent/agent-swarm) [D]: 300 sub-agents, about 4,000 steps, "approximately 4.5× faster",
  "significantly more credits". Neither page describes a verification step or says when not to use a swarm [D]. K3
  specifics and BrowseComp-Swarm scores come only from secondary blogs [D-sec, U].
- **Anthropic.** Multi-agent research system, 2025-06-13
  (https://www.anthropic.com/engineering/multi-agent-research-system) [D]: an Opus lead with Sonnet subagents scored
  +90.2% over a single Opus agent on an internal evaluation; about 15× the tokens of a chat; token usage alone explains
  80% of BrowseComp variance (95% with tool calls and model choice); observed failures: "50 subagents for simple
  queries", subagents searching endlessly for sources that do not exist, subagents distracting each other with excessive
  updates; effort rules: 1 agent for simple questions, 2–4 for comparisons, more than 10 for complex research; poor
  fits: shared context, coding, real-time coordination; the lead waits synchronously for each batch; evaluated on about
  20 queries with an LLM judge. "Building effective agents", 2024-12-19 [D]: orchestrator-workers means "subtasks
  aren't pre-defined, but determined by the orchestrator"; start simple.
- **Claude Code subagents**, the swarm runtime already in the harness (https://code.claude.com/docs/en/subagents) [D]:
  the tool is `Agent`; 20 subagents run concurrently by default (`CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`), nesting goes 3
  levels deep (`CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`), no total cap by default; subagents "count toward the same usage
  limits"; with a subscription the built-in Explore subagent runs on Opus, and `CLAUDE_CODE_SUBAGENT_MODEL` plus
  `CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1` force one model onto every subagent. `--forward-subagent-text` puts subagent
  text into stream-json with `parent_tool_use_id` [M, `claude --help`].
- **OpenAI Agents SDK** (https://openai.github.io/openai-agents-python/multi_agent/) [D]: separates LLM-driven from
  code-driven orchestration and calls code-driven "more deterministic and predictable … speed, cost and performance";
  agents-as-tools vs handoffs; parallel runs via `asyncio.gather`.
- **Microsoft Magentic-One** (arXiv 2411.04468) [D]: an orchestrator that "plans, tracks progress, and re-plans";
  "statistically competitive" on GAIA, AssistantBench and WebArena.
- **When a swarm wins, from controlled studies.**
  - Kim et al., arXiv 2512.08296 (v3, 2026-04-08) [D]: 260 configurations, 6 benchmarks; coordination gives negative
    returns once single-agent accuracy exceeds about **45%**; error amplification relative to a single agent:
    independent 17.2×, decentralised 7.8×, hybrid 5.1×, centralised 4.4×; overhead 58–515%; success per 1,000 tokens:
    single agent 67.7, multi-agent 13.6–42.4; +80.8% on decomposable Finance-Agent, −70% on sequential PlanCraft; its
    rule picks the right architecture in 87% of held-out configurations.
  - Tran & Kiela, arXiv 2604.02460 (2026-04) [D]: at equal thinking tokens a single agent is at least as good on
    multi-hop tasks; multi-agent systems become competitive only when the single agent's effective context use is
    degraded.
  - arXiv 2609.04217 (2026-06-25) [D, weak: one unreplicated 7B study]: at equal model calls, team 0.769 vs single
    agent 0.754 on ALFWorld (p = 0.80).
- **Failure taxonomies.** MAST, arXiv 2503.13657 v3 [D]: 1,600+ traces, 7 frameworks, κ = 0.88, 14 failure modes; the
  largest are FM-1.3 step repetition 15.7%, FM-2.6 reasoning-action mismatch 13.2%, FM-1.5 unaware of termination
  12.4%, FM-1.1 disobey task specification 11.8%, FM-3.3 incorrect verification 9.1%, FM-3.2 no or incomplete
  verification 8.2%. Who&When, arXiv 2505.00212 [D]: automated attribution finds the right agent at best 53.5% and the
  right step 14.2%, so LLM-judged attribution is unreliable. "Model or Harness?", arXiv 2607.28802 [D]: 41 failure
  modes, each placed on an edge between components and labelled with the side where the fix belongs (model, harness
  or environment/grader); κ = 0.76.
- **Wide search.** WideSearch, arXiv 2508.07999 [D]: the best system reaches 5% task success. WideSeek-R1, arXiv
  2602.04634 [D]: a 4B lead with subagents gets 40.0% item-F1, about equal to single-agent DeepSeek-R1-671B;
  performance grows with width.

**[I] What this adds up to:** swarms buy breadth and wall-clock time, not depth. They win only on separable work, when
one context is overloaded, and when the single agent is below about 45%. R6 at d5 is the regime where the theory
favours a swarm: a 105K corpus above the price step, separable work, and one-call failures that are coverage failures.

## 3. Niche and adjacent fields

1. **Crowdsourcing workflow design.** Turkomatic, CSCW 2012 (10.1145/2145204.2145354); CrowdForge, UIST 2011
   (10.1145/2047196.2047202); Soylent, UIST 2010 (10.1145/1866029.1866078) [metadata M via Semantic Scholar].
   Turkomatic's "price-divide-solve", where workers decompose the task themselves, is a human Kimi swarm; its weak
   points were the decomposition and merge steps, which needed the requester to step in [U]. CrowdForge's
   partition-map-reduce is the fixed-workflow counterpart. Soylent's Find-Fix-Verify separates generating from
   checking. → Adopt as rung 2's guard shape: discovery, then cell resolution, then an independent check.
2. **Systematic-review method.** Buscemi et al., J Clin Epidemiol 2006 (10.1016/j.jclinepi.2005.11.010): "Single data
   extraction generated more errors than double data extraction" [D, title and abstract]; the 21.7% figure is from
   memory [U]. R6 is literally an extraction table. → Duplicate cell extraction, not discovery, is the domain's proven
   guard.
3. **Tail latency.** Dean & Barroso, CACM 2013 (10.1145/2408776.2408794): a fan-out's wall clock is the maximum over
   its workers, P(slow) = 1 − (1 − p)^N; hedged requests cut the tail at a few percent extra cost [U]. → Report critical
   path and per-worker latency spread.
4. **N-version programming.** Knight & Leveson, IEEE TSE 1986 (10.1109/TSE.1986.6312924): independently written versions
   still fail together far more often than independence predicts [U on counts]. Same-model workers fail in correlated
   ways. → Label same-model verification "correlated".
5. **Entity resolution (blocking, then matching).** R6's one-call losses are recall failures on aliases, former names,
   code-only mentions and namesakes [I]. → The swarm's risk sits in the lead's discovery step, not in the workers; a
   deterministic blocking index (the bed's `textIndex` / `codePlan`) is the cheapest guard.
6. (Optional) **Cost-based query optimisation.** Choosing single agent, fixed workflow or swarm from an estimated width
   and size is a plan-selection problem, so a need-router feature [I].

## 4. Open-source projects: adopt or not

| Item | Licence; version; date | Decision |
|---|---|---|
| Claude Code `Agent` subagents | proprietary; CLI 2.1.306 at research time, 2.1.318 at the run | **Adopt** as the rung-1 swarm runtime (zero build; the vendor's own swarm primitive) |
| MAST taxonomy and MAD dataset (HF `mcemri/MAD`) | paper; repo licence not found | **Adopt** the 14 modes as a mapping target; code our own failures by program against the exact oracle |
| Kimi metrics (Critical Steps, serial collapse, spurious parallelism) | blog | **Adopt** as metrics |
| Anthropic delegation-brief elements and effort rules | blog | **Adopt** in a generic orchestrator preamble |
| openai-agents | MIT; 0.24.0; 2026-10-15 [M] | Design reference only |
| agent-framework (Microsoft, Magentic pattern) | MIT; 1.22.0; 2026-10-15 [M] | Reference for rung 2 (progress ledger, stall and replan); not a dependency |
| magentic-ui | MIT; 0.2.2; 2026-07-21 [M] | Ignore |
| autogen-agentchat | MIT; 0.7.5; 2025-09-30, maintenance mode [M] | Ignore |
| langgraph-swarm / langgraph-supervisor | MIT; 0.1.0 / 0.0.31; last release 2025-12 [M] | Ignore: handoff style, stale |
| swarms (kyegomez) | Apache-2.0; 16.0.1 [M] | Ignore |
| camel-ai | Apache-2.0; 0.2.90 [M] | Failure list as negative controls only |
| WideSearch | MIT [M] | Not runnable here (needs the live web, D10) |
| WideSeek-R1 / RLinf | Apache-2.0 [M] | Ignore (RL training and a GPU) |
| Who&When dataset | MIT [M] | Optional check of our failure coder |

Nothing was cloned or installed.

## 5. Questioned from first principles

- **"Swarm vs workflow" is a false split.** A swarm is a workflow whose plan a model writes at run time. Foundry's
  `wide` with a model-written plan is a swarm with typed coordination. The real axes are who decides the decomposition
  (nobody: single agent; code at build time: fixed workflow; a model at run time: swarm) and whether code checks
  coverage and merging. So D3's honest form is a ladder: plain swarm (rung 1), then swarm plus Foundry guards (rung 2).
- **Prior risk to the swarm.** Kim et al. predict a swarm loses if the Haiku agent passes ≥ 45% at d5. Tran & Kiela
  predict a win only if one context is degraded, which the d5 one-call failures suggest it is.
- **Built from scratch** (nothing exists): a typed spawn-tree parser for forwarded subagent transcripts; an exact
  coordination-failure coder that ties each failure to the bed's ground truth (more reliable than LLM attribution,
  given Who&When's 14–54%); a root-cause classifier that maps every wrong row to the bed trap it hit.

## 6. What was built, and where the preregistration departs from the research plan

Built (worktree branch `worktree-wf_6d3b90c9-c30-10`):

| file | what |
|---|---|
| `src/executors/claude-code.mjs` | narrow hook: `extraArgs`, an allow-list holding only `--forward-subagent-text`, empty by default (test: `tests/executor-extra-args.test.mjs`) |
| `experiments/swarm/probe-agent.mjs` | the $0.0044 capability probe: Agent works in the executor sandbox, subagents are forced onto Haiku, forwarded text reaches the transcript (fixture under `test/fixtures/`) |
| `experiments/swarm/arms.mjs` | arms A (single agent), S (swarm: + `Agent`, subagent knobs, frozen task-agnostic lead preamble), W (Haiku-built fixed workflow) |
| `experiments/swarm/spawn-tree.mjs` | typed spawn tree: workers, batches, briefs, reports, reads, writes, models, critical steps, overlap |
| `experiments/swarm/coord.mjs` | coordination codes K1–K11 by program, with their MAST modes, and $0 replays (carried rows, the brief plan's coverage check) |
| `experiments/swarm/rootcause.mjs` | error units → bed traps (counterfactual resolver with one mistake on), locus (seen or not, context size), fault side |
| `experiments/swarm/run-r1.mjs`, `launch-r1.sh` | freeze/check, the W build, calibration and held-out stages under one $8 ledger, the env-fault loop |
| `experiments/swarm/analyze-r1.mjs` | capability table, paired comparisons, root-cause lines |

Departures from the research plan (§6 of the plan), with reasons:

1. **Seeds.** The plan named held-out seeds 8401–8406; those are `wbed-heldout-c`, reserved for JIT held-out streams.
   The rung uses a fresh range in the clean test space, 9301–9310 (ledger row added).
2. **Trials.** K = 1, not k = 2: the $8 cap. The per-cell error correlation across trials is dropped; same-model
   correlation is discussed, not measured.
3. **N from a dev calibration.** N is set by a frozen rule from one dev task's measured block cost, not fixed in advance.
4. **The swarm's subagent cap** is enforced by the CLI (`CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION` = 32, found in the
   2.1.318 binary) as well as stated in the preamble.
5. **No Opus arm.** The W-bed prereg is an unfrozen draft that budgets no R6 run, and no R6 Opus reference exists.
