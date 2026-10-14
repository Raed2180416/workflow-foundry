# Sources for the need-router design (2026-10-14)

What the design in [DESIGN.md](DESIGN.md) borrows from prior work, where each borrowing lands, and how well each
citation was checked. Nothing was fetched while writing this file: the program author made no network or model
calls. Tags come from the prior-art reader's pass earlier on 2026-10-14 (reader E).

**Tags**
- **[T]** the reader read the source text directly (PDF text extraction or raw source).
- **[S]** the reader saw a summary of a fetched page, usually the abstract. The fetch tool summarises pages with its
  own small model, so wording may be paraphrase.
- **[M]** bibliographic metadata only (OpenAlex or a landing page).
- **[U]** not verified by anyone in this program. Treat as a pointer, not as evidence.

Venue checks: RouteLLM, MixLLM and Dekoninck et al. are cited as arXiv only; their venues were not checked. One
search (for the Bahncard paper) was refused by a permission prompt and not retried.

---

## 1. Borrowings that shape v1

| # | Borrowing | Where it lands in the design | Sources |
|---|---|---|---|
| 1 | Algorithm selection framing: an instances × modes performance matrix; single best solver (SBS) chosen on training data; virtual best solver (VBS); closed gap (m − m_VBS)/(m_SBS − m_VBS); feature computation counts toward cost; a cheap "presolver" before features | §2 matrix; §5 metrics (closed gap, SBS-train); §3 routing cost charged; NR-probe as a presolver | Lindauer, van Rijn and Kotthoff, "The Algorithm Selection Competition Series 2015-17", https://arxiv.org/abs/1805.01214 **[T]**. Bischl et al., ASlib, AIJ 2016, https://arxiv.org/abs/1506.02465 **[S]**. Kerschke et al. survey, https://arxiv.org/abs/1811.11597 **[S]**. Rice, "The Algorithm Selection Problem", Advances in Computers 15 (1976), doi:10.1016/S0065-2458(08)60520-3 **[M]**; its formal content **[U]**. |
| 2 | Weak, cheap meta-features make selectors fail even with large oracle headroom (OPENML-WEKA: 6 of 8 entries left ≥ 95% of the gap); single noisy runs defeat selectors (SAT12-RAND) | §3 why the structural rule is small; why NR-probe is tested head-on | Lindauer et al. 2018, as above **[T]** |
| 3 | A VBS built from single runs of randomised solvers is optimistically biased; fix with VBS\* from many runs plus a bootstrap (their example: the SBS–VBS gap overestimated by about 15%) | §2 cross-fitted VBS\* (select on one replicate, score on another) | Cameron, Hoos and Leyton-Brown, "Bias in Algorithm Portfolio Performance Evaluation", IJCAI 2016, pp. 712–719, https://www.ijcai.org/Proceedings/16/Papers/107.pdf **[T]** |
| 4 | Learned routers are near random out of distribution and in low-data regimes; fixed by in-domain labels | §3 NR-probe co-primary; §5 expectation stated in advance | RouteLLM (Ong et al.), https://arxiv.org/abs/2406.18665 **[S]** |
| 5 | Routing pays when ex-ante quality estimates are good; cascading pays only when post-hoc estimates are much better; on SWE-Bench routing did not beat the trivial baseline | M0 diagnostic D3 (ex-ante against post-hoc on archived rows); NR-probe | Dekoninck, Baader and Vechev, "A Unified Approach to Routing and Cascading", https://arxiv.org/abs/2410.10347 **[S]** |
| 6 | Optimal routing as argmax of q̂ − λĉ with λ found by binary search to hit a budget | deferred to a v2 budget mode (§3 slider) | Dekoninck et al., as above **[S]** |
| 7 | "Zero router": random mixes of fixed models on their convex hull; no tested router beat it significantly | considered and dropped at fixed V (utility is linear in mixtures, so the hull equals the SBS); kept for v2 budget mode | RouterBench (Hu et al.), https://arxiv.org/abs/2403.12031 **[S]** |
| 8 | Routers route by surface category, not difficulty; keyword insertion flipped 98% of decisions; query-independent "gadgets" flip routers | §6 metamorphic attacks (keyword and gadget injection, paraphrase, padding); §1 prose-count features removed from the trusted set | Kassem, Schölkopf and Jin, https://arxiv.org/abs/2504.07113 **[S]**. Shafran et al., "Rerouting LLM Routers", https://arxiv.org/abs/2501.01818 **[S]** |
| 9 | A tuned kNN router matches or beats learned routers because performance is local in embedding space | NR-knn kept as a secondary (and tested by L8 for collapse to the cluster-majority baseline) | Li, https://arxiv.org/abs/2505.12601 (v2, May 2026) **[S]** |
| 10 | Value of information: probe in index order (Weitzman's Pandora rule); committing policies when a box may be taken unopened | NR-probe via `experiments/need-router/voi.mjs bestProbe` | Weitzman, Econometrica 1979, doi:10.2307/1910412 **[M]**; the rule as restated in Beyhaghi and Cai, https://arxiv.org/abs/2212.01524 **[T]**. Beyhaghi and Kleinberg, EC 2019, https://arxiv.org/abs/1905.01428 **[S]**. Howard, "Information Value Theory", IEEE TSSC 1966, doi:10.1109/TSSC.1966.300074 **[S]** |
| 11 | "Find the simplest solution possible"; workflows for well-defined tasks, agents for open-ended ones; measure and iterate | §6 always-direct and always-agent baselines; the "needs nothing" anchors | Anthropic, "Building effective agents" (Erik S. and Barry Zhang, 2024-12-19), https://www.anthropic.com/engineering/building-effective-agents **[S]** |
| 12 | A plan written first and followed by the model: pass rate 35.56% against 18.00%, constraint violations 11 against 275, same backbone (TravelPlanner) | §1 the `agent-H+proc` arm | "Blueprint First, Model Second", https://arxiv.org/abs/2508.02721 **[S]** |
| 13 | Holdout ladder (held-out tasks and domains, not seeds); cost–accuracy reporting; simple retry and escalation baselines | §4 held-out families, not seeds; §5 $ per task beside success | Kapoor et al., "AI Agents That Matter", https://arxiv.org/abs/2407.01502 **[S]** |
| 14 | Expected dollars per correct answer | utility and $ per verified success throughout | Cost-of-Pass, https://arxiv.org/abs/2504.13359 **[S]** |
| 15 | pass^k: reliability over repeated attempts | racing replication reports per-cell repeat agreement | τ-bench, https://arxiv.org/abs/2406.12045 **[S]** |
| 16 | A method judged trivial is compiled at the lowest tier, never optimised | §3 structural rule's small-job leaf maps to direct or agent | HotSpot `compilationPolicy.hpp`, `compiler_globals.hpp`, openjdk/jdk at 76310cbf63459861fd99199d9856bee8272111bf, fetched 2026-10-14 **[T]** |
| 17 | A near-free baseline tier for lukewarm code (+41% on Speedometer over the interpreter) | `agent-H+proc` as the cheapest workflow tier | V8 Sparkplug, https://v8.dev/blog/sparkplug **[S]**; Maglev, https://v8.dev/blog/maglev **[S]** |
| 18 | Cost–benefit recompilation with "future = past": a program that has run for t will run for another t | §3 secondary 5 (online replay with "N so far") | Jikes RVM Adaptive Optimization System user guide, https://www.jikesrvm.org/UserGuide/AdaptiveOptimizationSystem/index.html **[S]**; Arnold et al., OOPSLA 2000, doi:10.1145/353171.353175 **[M + abstract]** |

## 2. Borrowings recorded for v2 (not used in v1)

| Borrowing | Why deferred | Sources |
|---|---|---|
| Per-guard bridges after N failed exits instead of benching a whole workflow | JIT is out of v1 | LuaJIT, https://luajit.org/running.html **[T]** (hotloop 56, hotexit 10, maxside 100); PyPy `rpython/rlib/jit.py` at f3979b53 **[T]** (threshold 1039, trace_eagerness 200); Kulkarni, OOPSLA 2011, doi:10.1145/2048066.2048126 **[abstract]**; Hölzle, Chambers and Ungar, PLDI 1992, doi:10.1145/143095.143114 **[M]** |
| Trace-derived automatability features (frequency, standardisation, stability, failure rate; determinism of action parameters) | v1 reads examples before any trace exists | Wanner et al., ICIS 2019, https://aisel.aisnet.org/icis2019/business_models/business_models/6/ **[S]**; Leno et al., ICPM 2020, doi:10.1109/ICPM49681.2020.00031 **[S]**; Bosco et al., BPM Forum 2019, doi:10.1007/978-3-030-26643-1_9 **[S, search snippet only; wording U]** |
| Rent-or-buy with predictions; Bahncard (buying lowers but does not remove later cost) | compile timing is out of v1 | Purohit, Svitkina and Kumar, NeurIPS 2018, https://proceedings.neurips.cc/paper/2018/hash/73a427badebe0e32caa2e1fc7530b7f3-Abstract.html **[S]**; Fleischer, STACS 1998, doi:10.1007/3-540-68535-9_10 **[M]**; its competitive ratios **[U]** |
| Selective acceptance with risk control; uncertainty-weighted shadow rates | belongs to the self-check threshold in v2, once false-pass rates exist | Geifman and El-Yaniv, https://arxiv.org/abs/1705.08500 **[S]**; Conformal Risk Control, https://arxiv.org/abs/2208.02814 **[S]**; Learn then Test, https://arxiv.org/abs/2110.01052 **[S]**; Trust or Escalate, https://arxiv.org/abs/2407.18370 **[S]**; Prediction-Powered Inference, https://arxiv.org/abs/2301.09633 **[S]**; Active Statistical Inference, https://arxiv.org/abs/2403.03208 **[S]** |
| Anytime-valid monitoring of deployed modes | no deployment in v1 | Wald, SPRT 1945, doi:10.1214/aoms/1177731118 **[M]**; Howard et al., https://arxiv.org/abs/1810.08240 **[S]**; Waudby-Smith and Ramdas, https://arxiv.org/abs/2010.09686 **[S]** |
| Budget-tuned routing with continual learning; cascades with self-verification | budget mode is v2 | FrugalGPT, https://arxiv.org/abs/2305.05176 **[S]**; AutoMix, https://arxiv.org/abs/2310.12963 **[S]**; Hybrid LLM, https://arxiv.org/abs/2404.14618 **[S]** (training details **[U]**); MixLLM, https://arxiv.org/abs/2502.18482 **[S]**; RouterEval, https://arxiv.org/abs/2503.10657 **[S]** |
| Query-dependent workflow depth | whether they include a "no workflow" arm on held-out families is **[U]** | MaAS, https://arxiv.org/abs/2502.04180 **[S]**; DAAO, https://arxiv.org/abs/2509.11079 **[S]** |
| Context for the agent-versus-workflow question | background only; no matched-model enterprise study was found | AgentArch, https://arxiv.org/abs/2509.10769 **[S]**; CRMArena-Pro, https://arxiv.org/abs/2505.18878 **[S]**; MAST, https://arxiv.org/abs/2503.13657 **[S]** |

Gap noted by the reader: no controlled 2025–2026 study was found comparing an agent against a constructed workflow
on enterprise tasks, at a matched model, with cost per success. Blueprint First is the closest; its task is not
enterprise.

## 3. Ideas from the adversarial critique (not fetched by any reader)

The critic cited these from its own knowledge. No one in this program fetched them. All **[U]**. The design uses
their ideas, not their numbers.

| Idea used | Where | Citation as given |
|---|---|---|
| Derivation → validation → impact for prediction rules | framing of NL1 → NL2 → E2E | McGinn et al., JAMA 2000, 284(1):79–84; the Ottawa ankle rules programme, Stiell et al., 1992–1994 **[U]** |
| Racing: replicate only where the winner is unclear | §2 racing rule | Maron and Moore, Hoeffding races, NIPS 1993; Birattari et al., F-Race, GECCO 2002 **[U]** |
| Presolving before computing features | NR-probe framing | Xu et al., SATzilla, JAIR 2008 **[U]** |
| Weight a benchmark by real traffic | owner tasks; precision at assumed base rates | Musa, operational profiles, IEEE Software 1993 **[U]** |
| Rerun on disagreement, not everywhere | racing rule | Luo et al., flaky tests, FSE 2014 **[U]** |
| Independently written versions fail together more than independence predicts | §3 secondary 6 (co-failure check) | Knight and Leveson, 1986 **[U]**; McKeeman, differential testing, 1998 **[U]** |
| Bandits with switching costs have Θ(T^{2/3}) regret | §3 secondary 5 (block-pinned online policy) | Dekel, Ding, Koren and Peres, STOC 2014 **[U]** |
| Programming by example as a need detector | deferred to v2 | Gulwani, FlashFill, POPL 2011 **[U]** |
| Hedged requests; capture–recapture; fractional designs | rejected for v1 (Appendix A of DESIGN.md) | Dean and Barroso, CACM 2013; Lincoln–Petersen; Box, Hunter and Hunter **[U]** |

## 4. The design's own statistical choices

| Choice | Basis | Tag |
|---|---|---|
| Exact sign-flip permutation test over clusters as primary inference; bootstrap as a sensitivity | percentile cluster bootstraps undercover with fewer than about 10 clusters; the permutation floor 2^−n is exact arithmetic | [I]; the few-cluster literature (for example Cameron, Gelbach and Miller, 2008) **[U]** |
| Holm correction over the two co-primaries | standard family-wise control; implemented in `experiments/lib/stats-ebed.mjs:339` | [M] for the code |
| Wilson and Clopper–Pearson intervals | `experiments/jit/stats.mjs` (`wilson`), `experiments/lib/stats-ebed.mjs:122` | [M] for the code |

## 5. Repository sources used

Read or recounted on 2026-10-14 by the readers or by the program author:

- `docs/THESIS.md` §1, §2, §4; `docs/ROADMAP.md:617-659` (§2.8), `:632-634` (RX1 gate), `:805` (C7).
- `README.md:109-110` (honest run verdicts "Broken"; need router "Design only"), `README.md:330` (spend rule).
- `policy/models.json:21-23` (pause above $500; session soft cap $1,500).
- `research/review-20261007/05-router-constructor.md` §2 and §4 (modes, RX1–RX6, the 30-family rule);
  `00-SYNTHESIS.md` §3.4; `11-NEXT.md` (R7 three-outcome reads); `00-CRITIQUE-rigor.md:205-221`.
- `research/jit-20261008/DEV-NOTES.md` D17, D25, D32 (`:1232`); `analysis/router-replay/`; `analysis/verify-economics/REPORT.md`;
  `runs/jit-r0-kinetics/*/results.jsonl` (recounted); `SEED-LEDGER.json`.
- `research/enterprise-20261014/B1-E8-DEV.md` (B1-H, B1L-H, B1-O results); `E-BED.md` §4.
- `research/construction-20261006/REPORT-dev.md:35`; `research/core-20261006/REPORT.md`.
- `research/need-router-20261014/features-census.json`, `replay-archived.txt`.
- Code: `experiments/need-router/*.mjs` and tests; `experiments/c0/construct.mjs:67-72, 91-149`;
  `experiments/lib/arms/{b0-call,b0-agent,b1-script}.mjs`; `experiments/lib/runner.mjs:32`;
  `experiments/jit/{router,stats,seeds}.mjs`; `experiments/library/construct.mjs:58`; `experiments/library/index.mjs:122`;
  `src/construction-objective.mjs:21`; `beds/wbed/attacks/triviality.mjs:1-55`; `beds/CONTRACT.md`.

Not read, by rule: `beds/sealed/`, `beds/ebed/e8/specificity/`, `/var/tmp/foundry-work/`, any credential file.
