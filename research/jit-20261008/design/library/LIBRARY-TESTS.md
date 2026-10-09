# LIBRARY-TESTS: how each claim in LIBRARY.md is tested

*Library design, 2026-10-09. $0 to write; nothing here has run. Order: the $0 mechanical tests first (§2), then the
research tests L1–L8 the coordinator named (§3), each with claim, bed, arms, metric, oracle, decision rule, seeds, cost,
falsifier and an honest prior. Tags as in LIBRARY.md.*

## 0. Overview

| id | claim tested (LIBRARY §) | cost | Jev requests | blocks |
|---|---|---|---|---|
| T1–T10 | mechanical claims: index lines, context caps, composition checker, card fixtures, retro sweep, option audit, quarantine baseline, lifecycle, code retrieval, checklist audit | $0 | 0 | everything below |
| L1 | coverage (L1-PATTERNS §0, LIBRARY §9) | a: $0; b: ≈ $4–8 Haiku | 0 | the coverage claim leaving this directory |
| L2 | retrieval: code vs code + Jev vs embedding (§4.3–4.4) | ≈ $0.5 Haiku | ≈ 1,700 | Jev ordering at S5 |
| L3 | library-first construction = W-bed arm (g) (§5) | ≈ $25–50 Haiku | ≈ 1,500 (shadow) | the owner's question |
| L4 | wrong reuse in and out of domain; kill threshold (§7.4, §9) | ≈ $8–25 Haiku | ≈ 600 | any `reuse` in production |
| L5 | overburden curve (§5.2) | ≈ $15 Haiku | ≈ 500 (shadow) | the default k |
| L6 | edge-case checklists reduce latent-defect failures (L1 §9, §3.2) | a: $0; b: ≈ $20 Haiku | 0 | keeping checklists in cards |
| L7 | utility problem at 50 / 500 / 1,500 items (§4.5) | ≈ $10 Haiku | ≈ 1,500 | library caps |
| L8 | Jev calibration per port (JEV-PORTS §9) | from L2–L7 logs | (counted above) | promotion of any port |

Dollar figures are list-price estimates from measured unit costs [I]; Jev requests cost the owner's TypeSafe account
about $0.04 per million input tokens (unverified, `policy/models.json`) [M], so about $0.3 for all of the above at
≤ 3K tokens per request [I]. **No Jev call runs without the owner's go-ahead** (it bills his account).

## 1. Shared rules

- **Paired success comparisons** use `experiments/jit/stats.mjs` `DECISION_RULE` unchanged [M]: no arm invalid by the
  25% env-fault rule; K ≥ 2 streams; pooled gap ≥ 3 points and every stream's gap ≥ 3 points in the same direction;
  exact two-sided McNemar p < 0.05 on pooled pairs; the 95% lineage-clustered CI (ρ 0.1) excludes 0. Otherwise
  "directional, no decision".
- **Power, stated before anything runs.** At K = 2 lineages × 24 tasks the rule's MDE at 80% power is 23 points (ρ = 0)
  to 39 points (ρ = 0.1) (`node experiments/jit/stats.mjs power`, W-BED §8) [M]. Success comparisons in L3, L5, L6 are
  therefore **directional by rule** unless the gap is very large; cost ratios and rates (L2, L4, L7) are where these tests
  have power.
- **Rates** (wrong reuse, recall) use Wilson intervals (`experiments/lib/stats.mjs` `wilson`) [M] and, where items
  cluster (platform, task family, lineage), a cluster bootstrap with B = 4,000.
- **Seeds** respect `research/jit-20261008/SEED-LEDGER.json` [M]. W-bed dev range `wbed-dev` 301–390 (`allow: jit-dev`),
  subdivided as W-BED §8: stream A 301–324, stream B 325–348, out-of-sample 349–372, fixtures 373–378, attacks 379–390.
  **Proposed new sub-range** (needs a ledger entry by the orchestrator, not by this directory): `lib-probe`, wbed-r0…r3,
  dev 391–400, `allow: jit-dev`, for construction-probe tasks in L5 and L7 — W-BED §8 leaves 391–400 unassigned [M].
  Held-out blocks 8201–8524 are used only by a pre-registered confirmatory round, never by these dev tests.
- **No component sees an oracle** (W-BED §2.2) [M]. Oracles score after the run.
- **Negatives are kept** and reported with the same prominence (owner rule).

## 2. $0 mechanical tests (run first; all are `node --test` files in a future `experiments/library/test/`)

| id | claim | test | oracle | pass rule |
|---|---|---|---|---|
| T1 | index lines are code-generated and ≤ 30 tokens (LIBRARY §4.1) | build the index for all 54 L1 cards plus fixture L2/L3/L4 entries; count tokens with a fixed tokenizer approximation (chars / 3.5, conservative) | the counter | every line ≤ 30; no line contains a field marked `untrusted` without the `‹untrusted›` marker |
| T2 | no constructor call exceeds its cap (§5.2) | run the constructor loop end to end with a **scripted model** (canned slot values) on W-bed R1–R3 fixture tasks (seeds 373–378); intercept every prompt | the cap table | every prompt ≤ its cap; an oversized fixture is refused with `CONTEXT_OVER_CLASS_BUDGET`, never truncated |
| T3 | the composition checker catches each violation (§6, L1 §9) | for every check code, one mutant of a clean composed solver (wrong callee type, effect in solver, budget overdraw, two writers, self-call, unbounded loop, judge without check, enum without `none`, branch on text) | the injected mutant | each mutant fires exactly its code; the clean solver fires none |
| T4 | first-slice cards run (L1 §4) | each of the 12 cards: positive, no-match and drift fixtures through the replay override (`tools/flow-override.mjs` hook, flow-v2/v3) with a stub gateway | fixture `expect` | all 36 fixtures pass; the drift fixture deopts with the expected kind |
| T5 | the retroactive sweep finds exactly the affected outputs (§7.5) | take an R1 reference-like solver, journal 24 stub-gateway runs on dev fixtures, inject a known latent defect (for example drop the borderline band in P16's slot) into v1, "discover" it, fix as v2, run the sweep | the set of runs whose v2 output differs, computed by brute force | sweep's suspect set equals the brute-force set; callers in a two-level `flow.call` tree are marked; ledger rows relabelled; total live spend $0 |
| T6 | Jev criteria pass the option audit (JEV-PORTS §1.2) | lint every criteria map in JEV-PORTS and in every card's `when[]` | the audit rule | no pair of options above 50% content-word overlap; every choice has a no-match option |
| T7 | the quarantined-read baseline catches planted text (JEV-PORTS §6) | generate 200 skill descriptions (100 with a planted instruction, 100 clean) from templates; run the regex baseline | planted flag | report recall and false-positive rate (no pass rule: this is the baseline the port must beat) |
| T8 | lifecycle rules hold (§7) | registry state machine: revoked hash refused by the call host; circuit breaker demotes after 3 consecutive failures; a policy-hash change drops kept items to shadow; a retired item leaves the index but keeps evidence | the state table | all transitions as specified |
| T9 | code retrieval works on the corpus (§4.3) | the code arms of L2 (§3, L2) | census `needs` | numbers reported; no threshold (they are baselines) |
| T10 | checklists name known failures (L6-a) | §3, L6 part a | repo failure records | numbers reported |

## 3. Research tests

### L1 coverage

**Claim.** 54 patterns explain 97.8% of corpus items structurally; 90% at 37; 82.2% within the 5-pattern budget;
buildable shares by tier (L1-PATTERNS §0, §7) [M-c].

- **L1-a hand audit ($0, agent time).** 60 items stratified by cluster (10 per cluster) and, within cluster, by number of
  patterns (0–1, 2–4, 5+). For each: does every assigned pattern's skeleton describe the node it owns (yes / partly /
  no), and does any control node have an obviously better owner? Plus 20 items per support-only detector (P01, P02,
  P16, P17, P18, P49) for keyword precision. Single auditor (an agent), with the owner spot-checking 10 items blind.
  **Decision.** The coverage claim leaves this directory only if rule precision (yes + partly/2) ≥ 0.85 with Wilson lower
  bound ≥ 0.75; a detector with precision < 0.5 is removed and the census re-run. **Falsifier.** Precision < 0.75.
  **Prior.** High for node rules (1.6% default-rule share), low for P17 and P18 keyword detectors (L1 §1 item 3) [I].
- **L1-b executable coverage (Haiku ≈ $4–8).** First, at $0, count which of the 438 oracle-bearing items have an oracle
  runnable in Foundry's sandbox without the source platform (COVERAGE §7 lists oracle kinds) [M]. From those, 40 items
  stratified by cluster: library-first construction (§5) with k = 3, then the item's oracle. **Metric.** Share
  constructed and passing, by tier. **Decision.** Report "executable coverage" = pass share with its Wilson CI; the
  structural number is never quoted without it. **Falsifier.** < 50% of structurally explained, tier-S items pass.
  **Prior.** Low to moderate: oracles test platform behaviour (tool outputs) that L3 bindings stub [I].

### L2 retrieval precision@k: code vs code + Jev vs embedding

**Claim.** Code-first candidate generation finds the needed patterns; Jev ordering adds recall at small k (LIBRARY §4.3–4.4).

- **Tasks.** (i) Corpus: the written summary of each of the 1,524 non-refused items as the task; gold = census `needs`
  (L1 patterns only) [M-c]. Leakage caveat: the summaries were written by an agent that read the workflow, so they
  over-state structure; a second variant strips structural verbs from summaries by a fixed word list to approximate a
  user's request [I]. (ii) W-bed: the task text of R0–R3 dev fixtures (373–378), gold = the reference workflow's
  patterns (W-BED §2.3).
- **Arms.** A1 BM25 over cards; A2 code ranker (rules + BM25 + companions, LIBRARY §4.3); A3 `bge-small` embedding top-k
  (local, $0); A4 A2 + Jev stage A noul re-ranking (JEV-PORTS §3); A5 A2 + Haiku choose (one call) on a 200-item
  subsample.
- **Metric.** Recall@3 and @5 of the gold set; precision@5; mean reciprocal rank of the first gold pattern. Anything
  fitted (thresholds, weights) is fitted leave-platform-out.
- **Decision.** Jev ordering is adopted at S5 iff A4 − A2 recall@5 ≥ 5 points with the platform-clustered bootstrap 95% CI
  excluding 0 on both task sets; otherwise A2 stays. **Falsifier** (for the design's retrieval claim): A2 recall@5 < 0.7
  on W-bed tasks — then code-first retrieval is not adequate and the constructor must see more of the index.
- **Cost.** A1–A3 $0; A4 ≈ 1,524 + 200 requests (corpus + stripped variant subsample) ≈ $0.1 [I]; A5 ≈ $0.3 Haiku [I].
- **Prior.** PreAct: the selector did not matter once verify-before-store was in place [M]; J1: stock Jev lost to a $0
  probe in-family on two ports [M]. Expect A4 ≈ A2 [I].

### L3 construction with the library: W-bed arm (g)

**Claim.** Library-first construction by Haiku builds R1–R3 workflows that match JIT H/H on verified success at a small
fraction of construction cost, and the library (not just L0) is what makes it work (LIBRARY §5).

- **Bed.** W-bed R1 (ledger close), R2 (inbox router), R3 (statement audit), with R0 interleaved 1 in 8 (W-BED §5) [M].
  R4 joins when its generator lands (W-BED §9 step 5).
- **Arms** (fractional design of the coordinator's k ∈ {0, 3, 8} × library ∈ {none, patterns, components, both}; the
  full 12 cells are not affordable and "components" is empty before a curriculum exists):

| cell | k | library | why |
|---|---|---|---|
| g0 | 0 | none (L0 card only) | the blank-page control (C0's condition, with flow-v3) |
| gP3 | 3 | patterns | the design default |
| gP8 | 8 | patterns | over-expansion (with L5) |
| gB3 | 3 | both, CUR across R1 → R3 | components from earlier rungs (curriculum, W-BED §5) |

  Shared comparators from the W-BED first run, same seeds and order: (a) JIT H/H, (c) reference, (d) Haiku agent; (e)
  B1 if run.
- **Metric.** Second-half verified success per stream (bed oracle); construction spend ($ and Haiku calls); cost per
  verified success including construction; share of slot groups repaired; deopt kinds.
- **Decision.** Success pairs: `DECISION_RULE` (directional by power, §1). Construction cost ratio gP3 / (a): paired
  bootstrap CI by lineage; the ≥ 30× prediction (LIBRARY §5.2) is **confirmed** if the CI's upper bound is below 1/10
  and **refuted** if above 1/3. Non-inferiority of gP3 to (a) on success: the W-BED H1 reading (δ = 10 points against the
  lineage-clustered CI).
- **Seeds.** Streams A 301–324 and B 325–348 per rung (K = 2), identical across arms.
- **Cost.** Constructions ≤ $0.05 each × ≤ 4 per lineage; runs: compiled judges $0.009–0.043 per task (FRONTIER-GAPS
  S6) [M] plus shadows every 4th task with the Haiku agent at $0.103 [M] → ≈ $1–2 per stream; 4 cells × 3 rungs × 2 =
  24 streams ≈ $25–50 [I]. Jev pattern choice and applicability run in shadow on every construction (≈ 1,500 requests).
- **Falsifiers.** (1) gP3 ≤ g0 on construction success (the library adds nothing over the vocabulary: the SkillsBench
  "self-generated" outcome); (2) gP3 below (e) B1 built once from the description (C0: the description-built script was
  16/16) [M]; (3) gB3 ≤ gP3 on R3 construction spend (components did not pay).
- **Prior.** C0: Haiku authoring from description 11/16 vs script 16/16 [M]. Library-first removes structural authoring,
  which is where C0's artefacts failed (O4: existence-only acceptance in 7 of 7) [M]; it does not help with judge
  prompts and parsing slots, where most compiled misses came from (D1 under-merging) [M]. Expect gP3 ≈ (a) on success,
  far cheaper to build; g0 lower on R2–R3 [I].

### L4 wrong reuse in and out of domain, with the kill threshold

**Claim.** The applicability gate keeps wrong reuse ≤ 0.05 (Wilson upper bound) without refusing most correct reuse
(LIBRARY §9; JEV-PORTS §2).

- **Library under test.** The accepted solvers from L3 (or the W-BED first run) for R1, R2, R3, plus 3 deliberately
  near-miss variants per rung (one convention changed, one rule dropped, one output field renamed) built at $0 by editing
  slots.
- **Offers.** Every task of stream B (325–348) for R0–R3 is offered every library entry whose contract input schema
  admits it (≈ 24 × 4 × 6 ≈ 580 decisions) [I]. In-domain = same rung, including the d4 drift tasks; out-of-domain =
  other rungs; cross-domain = kinetics dev tasks 201–224 (already used, dev, diagnostic use only; SEED-LEDGER
  `jit-dev-streams`) [M].
- **Ground truth.** Each offered entry is run offline on the task and scored by the oracle (`classifyReuse` with
  `calleeWouldPass`) [M].
- **Arms.** b0 no gate; b1 `checkProfile`; b2 similarity threshold; b3 Haiku typed call (same questions); J Jev
  applicability; J+b1 stacked (JEV-PORTS §9). Thresholds fitted on streams A, evaluated on B.
- **Metric.** Wrong-reuse rate (headline), missed-reuse rate, and the selective-risk curve per arm.
- **Decision.** A gate configuration may serve production reuse iff its wrong-reuse 95% Wilson upper bound ≤ 0.05 at
  ≥ 60 admitted decisions and its missed-reuse rate is within 5 points of the best arm's. **Kill threshold** in live use
  as LIBRARY §9. Jev gates applicability only if J or J+b1 beats b1 on wrong reuse at matched missed reuse
  (cluster bootstrap by task, CI excluding 0).
- **Cost.** Offline candidate runs ≈ 580 × $0.01–0.04 ≈ $6–23 (memoised across arms) [I]; b3 ≈ $0.3; Jev ≈ 580 requests.
- **Falsifier.** Every arm's upper bound > 0.05 → reuse stays off; the library ships as patterns-only (template mode).
- **Prior.** Out-of-domain offers mostly fail the contract schema or the profile at $0; the hard cases are in-domain d4
  drift, where meaning changes without shape (the D1 class; the profile caught 0 of those) [M]. That is where Jev could
  add value, and where its non-independence from the Claude that built the solver hurts [I].

### L5 the overburden curve

**Claim.** Construction success rises with expanded items up to a small k and then falls; the per-call caps are not
binding below k = 5 (LIBRARY §5.2).

- **Bed.** R2 and R3 (pattern choice matters there).
- **Factors.** k expanded ∈ {0, 1, 3, 5, 8}; index lines shown ∈ {20, 54 (all of L1), 200 (L1 + 146 distractor lines
  generated from corpus summaries, labelled distractor)}; 3 replicate constructions per cell → 5 × 3 × 2 rungs × 3 = 90
  constructions.
- **Metric.** Per construction: pass share on 6 probe tasks (seeds 391–396 of the proposed `lib-probe` range), slot
  repairs, Haiku calls, tokens per call (max and mean).
- **Decision.** The default k is the smallest k within 3 points of the best cell (cluster bootstrap over constructions).
  "Overburden exists" if k = 8 or index = 200 is ≥ 10 points below the peak with CI excluding 0.
- **Cost.** 90 × ($0.05 construction + 6 × $0.02 probes) ≈ $15 [I].
- **Falsifier** (of progressive disclosure as the mechanism): success flat in k and index size — then the budget is
  cost discipline, not a capability need.
- **Prior.** Inverted U (context rot hits small models hardest, THESIS P8 citing R09) [M], peak at k = 1–3 [I].

### L6 edge-case transfer: do corpus checklists reduce latent-defect failures?

- **L6-a ($0).** Take every recorded failure cause in the repo's compiled runs: FRONTIER-GAPS S1 (≥ 21 wrong compiled
  outputs, no check fired), DEV-NOTES D1 (under-merging near the threshold), D9 (guard widening), the R8 fault classes
  (W-BED §3.8) [M]. For each, is there a checklist line or checker code in L1 that names it? **Metric.** Share named.
  **Decision.** If < 50%, the checklists are corpus trivia rather than failure knowledge; add lines from the repo's own
  failures (they become `minedFrom: repo:<ref>`).
- **L6-b (≈ $20 Haiku).** gP3 cards with checklists vs the same cards with checklist lines removed (skeleton and slots
  identical), on R1–R3 streams with d4 drift and the R8 f1/f3 fault schedule (W-BED §8: f1 at tasks 9 and 17, f3 at 11
  and 20) [M]. **Metric.** Silent misses per 100 tasks; time to first deopt after a fault. **Decision.** `DECISION_RULE`
  on paired per-task silent-miss indicators (directional by power). **Falsifier.** No reduction.
- **Prior.** Small: most checklist value is already in the composition checker codes, which both arms keep [I].

### L7 the utility problem at 50 / 500 / 1,500 items

**Claim.** The candidate cap (20), retirement and the code-first ranker keep retrieval quality, wrong reuse and route cost
flat as the library grows (LIBRARY §4.5).

- **Library sizes.** 50, 500, 1,500 L2/L4 entries: the real entries from L3/L4 plus code-generated distractors whose
  contracts and index lines are derived from corpus item summaries (plausible, never correct for a W-bed task; gold
  known).
- **Tasks.** Stream B of R1–R3 (96 tasks) and R4 when built.
- **Metric.** Recall@5 of the correct entry; wrong-reuse rate under the L4-selected gate; `route` latency and $; R4
  construction success at each size (5 constructions per size).
- **Decision.** "Utility problem present" if, from 50 to 1,500, recall@5 or wrong reuse worsens by ≥ 5 points (Wilson /
  bootstrap CI excluding 0), or route cost exceeds 5% of the construction cost it saves.
- **Cost.** Retrieval and latency $0; Jev ranking at three sizes ≈ 3 × 96 × 5 requests; R4 constructions ≈ $10 [I].
- **Falsifier** (of the guard design): metrics degrade despite the cap.
- **Prior.** Literature says the problem is real (APC, Muscle-Mem, AWO; landscape R01 §1.5) [M]; the cap bounds cost but
  not precision. Expect recall to fall by some points at 1,500 [I].

### L8 Jev calibration per port

- **Data.** Every Jev row from L2–L7 with its labels (JEV-PORTS §8), plus the planted sets of T7 and W-bed f3.
- **Split.** Calibration = rows from stream A seeds (301–324) and corpus platforms in folds 1–3; evaluation = stream B
  (325–348) and folds 4–5. Held-out W-bed blocks only in a later pre-registered round.
- **Reads.** K = 2 on 20% of calibration rows; permuted option order on 5% (JEV-PORTS §1.3).
- **Metric.** Per port: accuracy / bacc, Brier, ECE (10 equal-width and 15 equal-mass bins, as J1), selective risk and
  coverage at the port's error budget (`calibrationReport`) [M], flip rate, order sensitivity; same metrics for every
  baseline.
- **Decision.** JEV-PORTS §9 promotion rule. **Falsifier.** No port promoted after L2–L7 → Jev stays a logged shadow
  signal and a training-set source; the library runs on code baselines.
- **Prior.** In-family dev J1: macro bacc 0.82–0.85, overconfident by 0.06–0.10, worst on option-boundary questions [M].
  Expect applicability (a meaning read over prose preconditions) to be the hardest port and quarantined read the
  easiest [I].

## 4. Order and budget

1. T1–T10 ($0) as their code lands (BUILD-ORDER §1).
2. L1-a ($0), L6-a ($0), L2 code arms ($0).
3. With owner go-ahead for Jev: L2 A4 (≈ 1,700 requests).
4. L3 with the W-BED first run (shared comparator arms), then L4 on its accepted solvers, then L5 and L6-b.
5. L7 after L4 has selected a gate.
6. L8 continuously; first promotion decision after L4.

Total paid Haiku ≈ $80–125 list [I], almost all in L3–L7; Jev ≈ 6,000 requests ≈ $0.3 [I].

## 5. What these tests do not cover

- Effects, waits, approvals and triggers (tiers IR/HOST/N): W-bed R7 is parked (W-BED §3.7) [M]; the replication streams
  (DESIGN-STREAMS) are the effect testbed.
- Agent-node and swarm patterns (P45, P47, P19): need flow-v3 `agent` / `wide` (BUILD-ORDER §3), then R5/R6.
- Cross-project sharing and the fine-tuned judge: need real projects and an owner opt-in (LIBRARY §8.1).
