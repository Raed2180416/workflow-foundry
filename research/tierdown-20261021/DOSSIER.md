# Tier-down (A10 / #33, #42): research dossier and build plan, 2026-10-21

*Committed 2026-11-04 by the build item (workflow subagent `wf_6d3b90c9-c30-9`) as it was handed to the build, with
two changes only: this note, and a marker where the Sources list was cut off in the hand-over. Where the build deviates
from this plan, [RESULT-TIERDOWN.md](RESULT-TIERDOWN.md) §Deviations says how and why.*

**Status.** Research phase only. Nothing was built, committed or paid for, and the main tree was not edited. I ran read-only $0 analysis on archived dev data and deleted my scratch copies afterwards. I did not read sealed rows or devCheck data.

**Research limits.** Exa returned HTTP 402 (out of credits), and the session's WebSearch budget ran out partway through. Four references below are cited from memory and are marked **[mem]**.

**Tags:** **[M]** measured this session · **[repo]** a repo document · **[doc]** an external abstract or README (a documentation claim) · **[I]** my inference.

---

## 1. What we already have

### Tools already built
| Asset | Where | Use for this item |
|---|---|---|
| Judge profiler and node screen (successive halving, 0.98 leaf agreement, evidence fields stripped) | `experiments/jit/tierdown.mjs` (LADDER L21, decisionAgreement L78, tierDownJudge L83, kevRecords L94) | Node-level replay. The ladder lists Claude models only. |
| End-to-end tier swap | `experiments/jit/tierdown-e2e.mjs` | It **re-samples every other judge**. That is the confound behind the disputed D11 effect size (BLOCKER-SYNTHESIS C3, L425). |
| Override hook (`callSite {name, ordinal, digest, tier}` → `{value}` at $0) | `experiments/jit/flow-v3.mjs` L107–126, L399–405 | The counterfactual substrate. |
| Strict memo replay | `experiments/jit/run-compiled.mjs` (createMemoPort L111, runCompiled L244; flowOverride needs flow-v2/v3) | Rebuilds archived runs at $0. |
| Archived rebuild of compiled answers | `experiments/jit/eval-invariance.mjs` L56–59 | Its output rebuilt **74 compiled answers at $0, 72 of them faithful [M]**. |
| Exact bounds | `experiments/lib/stats-ebed.mjs` (clopperPearson L122, minCasesFor L150) | Preregistered promotion bound. |
| Jev questions and calibration | `src/judgment.mjs` L56 and L106 | Jev tier for enum leaves. |
| Other reusable pieces | `cusum.mjs`, `compare.mjs` (tolerant comparison), `verify-economics.mjs` (cost model) | Monitoring and cost accounting. |

### Mercury route
- `mercury-3` is in `executorModels` only. ModelPort can reach it by explicit id through `src/models/providers/openai-chat.mjs`, which sends a strict json_schema and enforces token caps (`runTokenCap`). See `policy.mjs` L212–220 **[repo]**.
- So a typed Mercury judge needs no runtime edit, but the `tierdown.mjs` ladder does not include it.

### Prior findings
- **D6:** `rules` scored 0.966 leaf agreement on Haiku and Sonnet. Only the marker spelling differed.
- **D11:** tiering `rules` down from Opus to Haiku gave 5/8 against 7/8 passes, at $0.0061 against $0.0386 per task. It is a global reading with about 15 decision units, and one date-order leaf governs 7–23 dates.
- **N3:** a $0 count rule agrees with Opus on 25/26 date-order leaves at d3, but only 11/14 at d4 (near-ties).
- **Jev** (J1 dev-select, reweighted): accuracy 0.774 against Haiku 0.864. Median latency is about 280 ms. P(Haiku wrong | Jev right) = 0.023.
  - Jev's errors are strongly correlated with Claude's: phi 0.61, OR 42.
  - It is overconfident on some ports (X6 ECE 0.39), and no calibration has been fitted. **[repo]**

### New $0 measurements this session [M]
Source: all `journal.jsonl` files under `research/jit-20261008/runs/`, covering 4 dev experiments.

1. **Judge spend is mostly at build time, not in delivered runs.** 8,329 successful judge calls cost $65.13 in total.

   | Phase | Spend | Share |
   |---|---|---|
   | Builder test runs during compile | $37.50 | 58% |
   | Host check | $19.97 | 31% |
   | Delivered compiled runs | $7.67 | 12% |

   A tier-down applied only at run time can save at most about 12% of this spend.

2. **About half of judge spend repeats identical requests.** Same model, system, prompt and schema within an arm: $32.25 (49.5%).
   - The duplicates that cannot be intentional k-sample votes (across runs) are $21.69, or 33%: compile $11.88 and check $9.81.
   - In `jit-r0-kinetics`, duplicates are 75% of its $18.19. The host check re-asked Opus 65 times ($6.27), and every one of those calls was a repeat.

3. **Most expensive delivery-time judges:**

   | Judge | Model | Cost (calls) |
   |---|---|---|
   | kinetics per-document extractor | Sonnet | $1.40 (24) |
   | kinetics auditor | Opus | $0.90 (6) |
   | r0-kinetics SOP applier | Opus | $0.90 (6) |
   | records source-notes `rules` reader | Opus | $0.77 (21, 7.9 s per call) |
   | records per-batch extractor | Haiku | $0.74 (296) |
   | records config reader | Sonnet | $0.44 (24) |
   | country maps, date conventions and void-status readers | Haiku | ≤ $0.06 each |

4. **Mercury cannot replay the whole archive within budget.** Replaying every unique archived request would take about 6.5M tokens (estimate). A targeted set fits about 0.4M: global readers, date, void and country.

5. **E8 and SOP-Bench builders already tier down to code.**
   - The 7 E8 solvers contain no model calls.
   - The SOP-Bench p2 dev runs show 0 judge calls per run on all 9 SOPs.
   - That is a positive result: there are no residual judges left to tier down there.

6. **A1-C has paired archived data for its model nodes on the same 60 devTrain tasks.**
   - The nodes are ledger ×3, adjudicate, pcmap and checker. One run has Haiku in every role (267 transcripts); the other has Mercury as ledger and checker (174 files).
   - The terminal verdict "all checks pass" was right 9/25 times with Haiku and 17/28 with Mercury.
   - So a different-family cheap model is **more** accurate here. Cost and accuracy are not monotone across tiers.

## 2. Frontier work (2025–2026)

**Assigning a model per module or per step:**
- **LLMSelector** (arXiv 2502.14815, Feb 2025; ICML 2025): end-to-end quality tracks per-module quality, and iterative per-module allocation gains 4–73% [doc].
- **AgentRouter** (arXiv 2609.22951, 19 Sep 2026; ICML 2026 workshop): a 12M-parameter per-step router over 4 tiers cuts cost 72% while keeping 97.3% of quality. Applied per step, RouteLLM saves only 31% and FrugalGPT 44% [doc]. No code is released.
- **Planner-as-Router** (arXiv 2609.32917, 26 Sep 2026): cost −44% for −2.9 points [doc].
  - A simple "frontier only on terminal nodes" heuristic matches it.
  - The authors report a possible compounding penalty when cheap tiers are chained.
  - Code: github.com/vsingh45/par-entbench, Apache-2.0.
- **"Which Model for Which Role?"** (arXiv 2610.26676; NeurIPS 2026 listing): a Pareto search that spends about 6% of the cost of exhaustive evaluation [doc]. I did not open its arXiv page.
- **ShapleyFlow** (ACL Findings 2026) and **CapaBench** (arXiv 2502.00510): Shapley credit per module [doc].

**Cascades with guarantees:**
- **Trust or Escalate** (arXiv 2407.18370; ICLR 2025 oral): selective judging with a provable agreement guarantee, thresholds set by fixed-sequence testing, and a cascade from cheap to strong judges [doc].
- **Conformal Cascade** (arXiv 2607.25018, Jul 2026): accept only when the calibrated answer set is a single answer [doc].
  - Finite-sample accuracy of at least 1−Kα.
  - Tested on multiple-choice only; open-ended answers are left for future work.
- **Agreement-Based Cascading** (TMLR 2025, arXiv 2407.02348): agreement within an ensemble decides whether to defer. Needs no training [doc].
- **Unified routing and cascading** (arXiv 2410.10347; ICML 2025): the quality estimator is the critical part [doc].
- **Inter-Cascade** (arXiv 2509.22984, revised Feb 2026): the strong model's answers to deferred queries become reusable strategies for the weak model. Strong-model calls fall by up to 48% [doc].

**Counterfactual failure attribution:**
- **AgenTracer** (arXiv 2509.03312; ICLR 2026): counterfactual replay plus fault injection [doc].
- **REFLECT** (arXiv 2606.09071, Jun 2026): replays from a diagnosed step with a targeted patch and confirms the step only if the outcome flips. Reports 76.3% exact-match localisation on WTQ [doc].
- **AgentLocate** (arXiv 2607.07989, Jul 2026): argues replay is unstable over long horizons, because one change alters later prompts [doc]. Our strict memo turns that into an explicit, counted "unmeasured" bucket.

**Tier to cache or code:**
- **vCache** (arXiv 2502.03771; ICLR 2026): per-prompt online thresholds that keep a semantic cache within a user-set error bound [doc]. The repo is vcache-project/vCache; I could not confirm its licence.
- **ALCHEmist** (arXiv 2407.11004; NeurIPS 2024): the LLM writes labelling *programs* instead of labels, about 500× cheaper [doc].

## 3. Niche and adjacent fields

1. **Reliability demonstration testing (success-run theorem).** n = ln(1−C)/ln(R): 59 trials with zero failures demonstrate 95% reliability at 95% confidence, and 29 demonstrate 90/95. This gives the sample size for the promotion bound up front.
2. **Global sensitivity analysis.** Morris one-at-a-time elementary effects [mem: Morris 1991] screen which inputs matter. Here the "inputs" are a judge's decision leaves and the response is the oracle verdict. SALib (MIT from v0.5) can cross-check the design.
3. **Safety assurance levels (DO-178C).** Assurance effort scales with failure severity: 71/69/62/26/0 objectives for levels A–E (Rapita). Analogue: the allowed flip rate δ shrinks as a judge's leverage grows. This replaces the single 0.98 bar that D11 broke.
4. **Crowdsourcing quality control.** Cheap workers are qualified on gold questions, gold keeps being injected, workers below a running-accuracy floor are dropped (80% default), and gold count ≈ √labels. Analogue: shadow re-asks at the reference tier plus demotion.
5. **Weak supervision and program synthesis, and compiler tiering with deoptimisation.** The rule/code tier must abstain and fall back (deopt) on inputs it does not recognise.
   - This matters because the 61 date-convention sentences take 36 distinct forms [repo].
6. **Multiple testing.** Fixed-sequence testing [mem: Bauer 1991] and Learn-then-Test [mem: arXiv 2110.01052] promote several judges without Bonferroni loss.

## 4. Adopt, build, skip

**Adopt** the in-repo tools from §1. They cover nearly everything; no external runtime dependency is needed.

**Use only as inert reference** (not imported): SALib (MIT); par-entbench (Apache-2.0), to define the "frontier on terminal nodes" baseline.

**Do not adopt:** RouteLLM (Apache-2.0, 5.6k stars): its routers are trained on single-turn chat preferences, and they save little when applied per step. AgentRouter, Conformal Cascade and Inter-Cascade release no code: reimplement only the ideas. vCache: idea only, until its licence is checked.

**Build from scratch:** new files under `experiments/tierdown/`. No `src/runtime.mjs` edits; the flow-v3 hook is enough.
1. **`leverage.mjs`** ($0): fidelity gate (archived v1/v2 solvers must reproduce under flow-v3 with strict memo); then, per call site and per decision leaf, one-at-a-time perturbations through the override hook (alternative enum value, add or drop one list item, MDY↔DMY), with every other judge served from the journal. Outputs per site: oracle flip rate with a Clopper-Pearson interval, number of answer leaves changed, the share of runs it could not measure (a replay miss), and cost share split by delivery, check and compile. Rank by leverage × cost share.
2. **`tier-replay.mjs`**: replay archived requests for the top sites on these tiers: Haiku; Mercury-3, by explicit id with a `runTokenCap` of 450K; Jev, for enum leaves, through kevRecords and toSystemOneQuestion; rule/code that abstains on unseen forms, written by Opus from the calibration slice only; memo. Agreement is tolerant and scored on decision leaves only.
3. **`inject.mjs`** ($0): feed each cheaper tier's real answers into the solver through the override, with all other judges held fixed, then score with the oracle. This reruns D11 without the re-sampling confound.
4. **`policy.mjs`**: promotion rule plus cascade (confidence, cross-family agreement, or deferral on a code check), and monitoring by a shadow floor plus CUSUM demotion.
5. **Build-time memo config.** Serve compile and check judge calls from the arm's journal with k-th-answer semantics (no reuse past the end, as in MEM-0 M3). This changes what `jit-check` measures: code determinism instead of judge variance. So it needs a preregistration amendment and an owner-visible decision, not a silent switch.

## 5. Measurement plan

**Phase 0 ($0, about 1 day)**: fidelity gate (target ≥70 of 74 archived answers plus R0), inventory, leverage screen. Kill rules: if fewer than 50% of the top-cost sites can be measured, misses go to a paid injection at the original tier; if perturbation-predicted leverage and injected outcomes have rank correlation below 0.5, drop synthetic perturbation and use injection only.

**Phase 1 (node replays, calibration slice C)**: C = archived dev tasks: records seeds 201–248, kinetics 201–248. About 6 sites. Budget: Haiku ≤ $3, Mercury ≤ 0.4M tokens (hard cap), Jev ≤ 2K questions, rule synthesis ≤ $5 in Opus. Drop any tier whose schema-valid rate is below 95%.

**Phase 2 ($0):** run end-to-end injection on C. Choose the order in which tiers are tried and the cascade thresholds.

**Phase 3 (held-out slice H)**: register a new SEED-LEDGER block first (proposal: records and kinetics dev seeds 701–760, found free; 60 tasks per family). Write the preregistration before any paid call on H. Run the reference compiled solvers live once (≤ $30), then the candidate tiers' node calls, then $0 injection.

**Promotion rule (to preregister).** A tier t replaces the reference tier at site s only when both bounds below hold on H:

| Leverage class (flip rate on C) | Allowed flip rate δ on H | Zero-flip tasks needed |
|---|---|---|
| low (< 0.05) | 0.10 | 29 |
| mid (0.05–0.2) | 0.05 | 59 |
| high (≥ 0.2) | 0.02 | 149 (more than H holds) |

- **Bound 1:** the one-sided 95% Clopper-Pearson upper bound on the task-level pass→fail flip rate is ≤ δ for the site's class.
- **Bound 2:** node disagreement on decision leaves is ≤ ε.
- High-leverage sites therefore keep the reference tier, or use a verified cascade.
- Sites are tested in a fixed preregistered order of expected saving, at α = 0.05, stopping at the first failure.

**Equal accuracy.** The whole policy is non-inferior to the all-reference arm on H: paired outcomes, a 3-point margin (the owner's floor), exact McNemar, with flips in both directions reported.

**Capability metric.** Cost saved at equal accuracy = 1 − C_policy / C_ref on H. C counts judge dollars per task, delivery plus amortised check and compile. Also report cost per verified success and p50/p95 latency.

**Simple baselines:** B-ref (the solvers as compiled); B-screen (the existing `tierdown.mjs` 0.98 leaf-agreement rule, without leverage); B-all-cheap (Haiku everywhere, and separately Mercury everywhere); B-sink (frontier tier only on global readers); B-memo (cache only).

**A1-C extension**: measure node-level verdict accuracy against the grader at $0 from the dev60 transcripts. An end-to-end counterfactual is not possible because the actor is a live session, so promotion needs paid A1-C runs. Hand that to the A1-C v2 track. Never touch the devCheck run directories.

**What I expect [I]**: at delivery time, `rules` and the kinetics auditor stay at the frontier tier, or move to a k-sample or abstaining-rule hybrid; date, void and country judges move to rule or Jev; the per-batch extractors move to Mercury, which mostly gains latency. The largest dollar saving is at build time: memo plus tiering down the check-time Opus calls (an archive-implied 33–50% of judge spend).

## 6. Risks
1. **Unmeasurable sites.** When a changed value alters later judges' prompts, the replay misses. That biases leverage toward independent sites, so report coverage alongside every number.
2. **Synthetic flips are not real tier errors.** For example, Haiku systematically misreads BRIGHTDESK as DMY. Rank with perturbations, but decide only on real answers injected end to end.
3. **Correlated errors (phi 0.61 between Jev and Claude).** An agreement-based cascade only works across different families, such as Mercury against Haiku.
4. **Rule tiers fail silently on new forms.** They must guard and deopt.
5. **Small samples.** 2 families, K = 1 archives, dev only. All 60-task results are development evidence; δ = 0.02 cannot be shown on 60 tasks.
6. **Mercury and Jev specifics.** Mercury's $0 listed price can change, and the D18 cap applies. Jev's price is unverified (output price null) and it has no calibration fit.
7. **Measurement artefacts.** Leaf agreement undercounts equivalent answers (D6) and exact numeric comparison misfires (D7). Always use tolerant, decision-leaf scoring.
8. **Memo changes what the check measures** (see §4 item 5).
9. **Cost model.** On kinetics, deopt fallbacks already make compiled runs dearer than the Haiku agent (verify-economics). Tier-down savings must be booked in the full-system cost, not per judge.

## Sources (dates as listed)
- [arXiv 2502.14815](https://arxiv.org/abs/2502.14815v1), [ICML 2025 LLMSelector](https://icml.cc/virtual/2025/47988)
- [arXiv 2609.22951](https://arxiv.org/abs/2609.22951), [arXiv 2609.32917](https://arxiv.org/abs/2609.32917), [arXiv 2610.19316](https://arxiv.org/abs/2610.19316), [NeurIPS 2026 "Which Model for Which Role?"](https://neurips.cc/virtual/2026/170709)
- [arXiv 2407.18370](https://arxiv.org/pdf/2407.18370), [arXiv 2607.25018](https://arxiv.org/abs/2607.25018), [arXiv 2407.02348](https://arxiv.org/pdf/2407.02348), …

*(The hand-over was cut off here; the remaining source links were not received. Every source above is a documentation
claim the dossier author read as an abstract or README; this build did not re-open them.)*
