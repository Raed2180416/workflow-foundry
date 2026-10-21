# Pre-registration BREADTH-1 (draft v0): cheap model + Foundry against frontier alone, across independent beds

**Status: DRAFT v0, 2026-10-21. Not frozen. Nothing in this file has run.** It follows
[research/PREREGISTRATION-TEMPLATE.md](../PREREGISTRATION-TEMPLATE.md). Version v1 is frozen and committed only after
every item of the freeze checklist (§11) is filled; until then any run on a sealed item is forbidden, and a result from
a run before the v1 commit is diagnostic evidence only. The design and its reasons are in [PLAN.md](PLAN.md); this file
holds the rules.

| Field | Value |
|---|---|
| Experiment id | BREADTH-1 |
| Claim tested | ROADMAP C1, with the construction (C0) and reuse-within-cluster (C2) parts that the Foundry arm exercises: **on a fixed portfolio of eight independent beds, Haiku 5.5 inside Foundry is non-inferior to Sonnet 5.5 alone on verified task success within 10 points (pooled), costs at most half as much per verified success, and does better than Haiku 5.5 alone.** Falsifiable by §5.5 |
| Evidence class | Sealed items: `sealed` (held-out, claim-bearing). Dev pilots, kit development and the Stage-A pooled report: `development` |
| Pre-registration commit | to be recorded at the v1 freeze (`git log --diff-filter=A --format=%H -- research/breadth-20261021/PREREG-BREADTH-v1.md`) |
| Repository HEAD when v0 was written | `f8478b4994ac3cf808a7f86358fd9dc8cbd6df9e` |
| Policy file | `policy/models.json` version `2026-10-21.2` (re-read at freeze) |
| Date | 2026-10-21 (v0) |

Tags: **[M]** measured or read in the repo; **[S-obs]** observed by a breadth sweep today; **[calc]** computed for this
design; **[P]** a choice this preregistration makes; **[TBD-v1]** to be filled before the freeze.

---

## 0. What the author had seen before writing

The author (an Opus 5.5 subagent) read the four breadth sweep summaries and notes, README, THESIS, ROADMAP §4 and §6,
decisions D1–D16, the AB-v1 and SOP-Bench documents, the τ² acquisition record, the telecom split and task files and
the CHANGELOG of the pinned τ² clone, and the methodology sweep's leftover scripts and outputs. It ran one $0 power
simulation. It did **not** read any test or sealed item of any bed: no AppWorld test task, no held-out WorkBench
template's instances, no AgentDojo task text, no NaturalPlan instance, nothing under `beds/sealed/`. It has seen
published aggregate leaderboards and per-task frontier result files only through the sweeps' summaries.

---

## 1. Beds and splits

### 1.1 Portfolio, in declared order [P]

The pooled primary analysis uses exactly **B = 8 beds**: the first eight in this list that pass admission (§1.2).
Beds 1–4 form Stage A, beds 5–8 Stage B. A bed that fails admission is replaced by the next substitute, in order.

| Order | Bed (pin) | Held-out class (PLAN §1) | Cluster | Sealed sample | Primary outcome |
|---|---|---|---|---|---|
| 1 | WorkBench @`49c7dfd00c03d384ec59ea57374f50b766aa5613` | H2 (regenerated instances) or H4 fallback | template | 40 held-out templates × 3 instances = 120 | official `is_correct` |
| 2 | AgentDojo 0.1.35, benchmark v1.2.2 | H3 (authored injections) on H4 user tasks | user task | 40 held-out user tasks × {benign, inj-1, inj-2} = 120 | utility ∧ (attacked ⇒ security) |
| 3 | NaturalPlan (data sha256 trip `15c4755d…`, meeting `cabd5537…`, calendar `3f34ff27…`) | H2 (our generator) or H4 fallback | task type × complexity level | ≈ 27 clusters × 10 = ≈ 270 | trip exact; meeting simulator score = golden; calendar feasibility checker |
| 4 | AppWorld 0.1.3.post1, data 0.1.0 | H1 (official test_normal) | scenario | 30 scenarios × 3 variants = 90 | TGC |
| 5 | τ²-bench telecom @`57e54143`, solo mode | H4 (+ v2.0.0 replaced subset) | intent | ≈ 90 tasks over ≈ 40 intents | reward = env assertions (+ ACTION where defined) |
| 6 | BFCL v4 multi-turn (`bfcl-eval` 2026.3.23) | H4 | category × API set | 120 entries over ≈ 40 clusters | state ∧ response ∧ order checkers |
| 7 | SpreadsheetBench-912 v0.1 (sha256 `9cf7228b…3399`) | within-item held-out (cases 2–3) | instruction | 60 instructions × cases 2–3 = 120 | all held-out cases pass (hard) |
| 8 | τ²-bench banking_knowledge, `--retrieval-config bm25` | H4 | intent / document group | ≈ 90 tasks over ≈ 30 clusters | reward (DB hash or ACTION) |
| sub 1 | EnterpriseOps-Gym (csm, itsm, hr; laptop Docker) | H4 | domain × task template | 90 | SQL state verifiers (only tasks with no `response_check`) |
| sub 2 | PlanBench (regenerated, obfuscated variants) | H2 | domain × variant | 120 | VAL-valid plan |
| sub 3 | ITBench-Lite CISO + FinOps | H4 | CIS control / anomaly | 30 (all) | OPA eval / exact |
| sub 4 | AgentArch | H4 | use case × config family | 110 | strict tool, argument and decision match |
| sub 5 | ToolHop | H4 | hop count × domain | 120 | exact `<answer>` |

Concurrent beds **not pooled**: AutomationBench AB-v1 test and SOP-Bench phase 2 (their own preregistrations hold no
Sonnet-alone arm; AB-v1 §3 says its Sonnet reference is "never in a claim" [M]); the factory families (their own claim,
PLAN §6.6); TaxCalcBench, DABstep, NESTFUL, DS-1000, LegalBench, MCPGen (dev-only or controls). They are reported beside
the portfolio, never inside H1–H3.

### 1.2 Admission (all before any paid sealed run on that bed) [P]

A bed is admitted only if, in this order:
1. **D16** is met: pinned install outside the repo, ≤ 500 MB, recorded in DISPOSALS or the bed's acquisition note.
2. **$0 oracle-validity gate** BG-0…BG-8 (PLAN §5.3) passes, with results recorded in §1.6: gold 100%; floors
   reported; ≥ 3 mutation operators with ≥ 95% killed; identical digest on two runs; no LLM judge in the reward;
   alternative-valid-answer audit; evaluator-defaults audit; leakage test.
3. **Memorization probe** (§8.1) is clean for H4 beds.
4. **Headroom screen**, on dev items only: the bed is skipped as *saturated* if A-H and A-S both score ≥ 0.90 on the dev
   pilot, and as *uninformative* if A-S scores < 0.10. A bed where only A-H is low stays in (it is a fair hard test).
   The screen's numbers are recorded before the sealed manifest of that bed is opened.
5. **Cost gate**: the dev pilot's measured $/task projects the sealed run under the bed's cap (§7); if not, the sample is
   cut, never below 20 clusters; below that the bed is skipped.

Skips are recorded in §1.6 with the reason. A bed is never skipped after any of its sealed outcomes is known.

### 1.3 Splits and sealed manifests [P, details TBD-v1]

- **WorkBench.** Within each of its 6 domains, templates ordered by `sha256('breadth-wb-v1:' + template_id)`; the first
  round(0.42 · n_domain) are dev, the rest held out. With 12/11/9/8/8/21 templates (analytics, calendar, email, CRM,
  project management, multi_domain; 10 shipped instances each [S-obs]) that is 5/5/4/3/3/9 = 29 dev and 40 held out. Sealed instances: `workbench-generate-data` with seed
  `breadth-wb-v1` [TBD-v1: exact command and verified seed control], 3 per held-out template; manifest hash committed,
  content stored host-only. Fallback (generator not seedable or failing BG-1/BG-4): shipped instances 1–3 of each held-out
  template, class H4.
- **AgentDojo.** Per suite, user tasks ordered by `sha256('breadth-ad-v1:' + suite + id)`; first 40% dev. Sealed
  injection tasks: written by a session with no access to the F-kit, about 3 per suite, each validated fail-to-pass by a
  scripted agent, hashed and stored host-only before any arm runs. Attack: `important_instructions` [TBD-v1: confirm the
  name at the pin]. Sample: 40 held-out user tasks stratified by suite; per user task one benign and two attacked units.
- **NaturalPlan.** Dev: a 30% stratified sample of public instances. Sealed: our generator's instances, admitted by the
  faithfulness gate (PLAN §4.3); fallback public instances outside the dev sample plus a paraphrased format-drift copy,
  class H4.
- **AppWorld.** Official splits. Kit development on train and dev only. Sealed: 30 test_normal scenarios chosen by
  `sha256('breadth-aw-v1:' + scenario_id)` over the id list, without opening task content; all 3 variants each.
  test_challenge is not touched.
- **τ² telecom / banking.** Dev: the official train split (telecom 74). Sealed telecom: the official test split (40)
  plus 50 tasks from the full pool outside train and test, stratified by intent [TBD-v1: confirm intent field]; tasks
  in the v2.0.0 replaced set flagged for the contamination contrast. Banking: [TBD-v1: split rule at the pin].
- **BFCL-MT.** Category-stratified hash sample of 120 entries; dev: a disjoint 40.
- **SpreadsheetBench-912.** 60 instructions by hash among those with 3 cases, excluding the 67 an unchanged workbook
  passes; build on case 1, score cases 2–3.

**Burned items.** Any sealed item that is opened, printed or diagnosed is burned and listed in a dated amendment; it
never enters another held-out set.

### 1.4 Who authored what

| Artifact | Author | Must not have seen |
|---|---|---|
| F-kit core templates and bed cards | Opus 5.5 builder session | any sealed item |
| AgentDojo sealed injection tasks | a separate session | the F-kit and any arm output |
| NaturalPlan generator, feasibility checker | a builder session | sealed generated instances (it sees only the generator code and public data) |
| WorkBench seeds and manifests | script | — |
| Analysis script | this design's author or a successor | any sealed outcome |

### 1.5 Oracles

Per bed: oracle path and sha256 [TBD-v1]. Oracle code is used as shipped except the declared fixes: NaturalPlan calendar
feasibility checker; SpreadsheetBench `evaluation.py` fixes (score the output files, iterate actual case count, repair the
5 malformed `answer_position` strings); AgentDojo pairing fix (if a code change is needed). Every fix is gated by BG-1 and
BG-3 again.

### 1.6 Control results and admission log

[TBD-v1: one row per bed: BG results, floors, mutation score, digests, probe results, headroom screen numbers, cost gate,
admitted or skipped with reason.]

---

## 2. Arms

| Arm | Definition | Models (policy ids) | Tools | Per-task budget | K | Frozen hash |
|---|---|---|---|---|---|---|
| **A-H** | plain executor: `claude -p` with the bed's official system prompt where one exists, `--strict-mcp-config` with only the bed facade | `claude-haiku-5-5`, effort high | facade tools only; no Bash, no network | turn cap = bed's official cap; wall timeout [TBD-v1]; $ reservation $0.75 | 2 | [TBD-v1] |
| **F-H** | A-H's executor plus the Foundry MCP server and F-kit v1 (PLAN §5.2): construct from frontier-written templates, run, verify with gating acceptance, reuse inside the cluster stream (F-reuse) or build once on dev (F-build: NaturalPlan, SpreadsheetBench, PlanBench) | `claude-haiku-5-5` for construction and nodes; templates written once by `claude-opus-5-5` | facade + Foundry MCP | same caps as A-H; construction cost charged to the instance where it occurs | 3 lineages, each a random stream order | [TBD-v1] |
| **A-S** | A-H with the model changed | `claude-sonnet-5-5`, effort high | as A-H | as A-H; $ reservation $1.50 | 2 | [TBD-v1] |
| A-O (secondary) | A-H with the model changed, on a 20-task anchor per bed | `claude-opus-5-5`, effort high | as A-H | as A-H; $ reservation $3.00 | 2 | [TBD-v1] |
| F-S (optional, WorkBench and AgentDojo) | F-H with Sonnet in every model role | `claude-sonnet-5-5` | as F-H | as F-H | 2 lineages | [TBD-v1] |
| F-M (conditional on D8) | F-H with Mercury 3 as constructor and node model, token-capped | `mercury-3` | as F-H | token cap per run [TBD-v1] | 2 lineages | [TBD-v1] |

On the reliability bed (τ² telecom) every arm runs K = 3.

**Held constant across arms:** bed tools, environment, reset state, official prompt, turn cap, wall timeout, effort label,
grader. Timeouts and cap hits count as failures and are charged at their recorded cost, or at the reservation if
unrecorded (P1's lesson: an unstated per-call timeout created most of a d4 gap [M]).

**Interleaving:** per task, the arm order is randomized with seed `sha256('breadth-order-v1:' + bed + task)` and recorded;
all arms of a task run on identical reset worlds, within the same wave where possible.

**What Foundry may and may not use on sealed items:** its own verification, applicability gates and kept workflows from
earlier instances of the same cluster in the same lineage. Never the oracle, gold, the sealed manifest, another lineage's
workflows, or anything written after the freeze.

**Engine:** one named engine freeze for all sealed runs [TBD-v1: tag and commit]; CLI version recorded per run.

**Not an arm:** the Haiku 4.5 harness-parity anchor (WorkBench dev templates, BFCL dev entries) and the published
frontier per-task results. They check the harness and screen beds; they never enter H1–H3.

---

## 3. Measurements

### 3.1 Primary outcome

Per task and run: binary success by the bed's primary outcome (§1.1). Per task: the mean over its K runs (for F-H, over
its 3 lineages). AgentDojo benign units count utility only.

### 3.2 Cost per verified success (CPS)

CPS(arm, bed) = all list-price USD of the arm on the bed's sealed sample (every run, failures, timeouts, construction,
verification, applicability gates; F-build construction amortized over the held-out instances it serves) ÷ number of
oracle-verified successes. Costs as reported by the CLI (`total_cost_usd`, costBasis = list) or recomputed from journaled
tokens at the policy's prices; one basis for all arms, recorded. Haiku calls above 100K prompt tokens are charged at the
higher tier.

### 3.3 Secondary measurements

- pass^k: pass^2 for every bed; pass^3 on τ² telecom.
- Harmful side-effect rate (WorkBench), targeted ASR and utility under attack (AgentDojo), SGC (AppWorld), headline on the
  state-changing subset where a floor exceeds 10% (WorkBench).
- F-H process: construction failures (no runnable workflow), self-verification false-pass rate (own verdict pass, oracle
  fail), reuse rate, wrong-reuse rate (reused workflow, oracle fail where fresh construction passed on the same item in
  another lineage), deopt and fallback rate.
- Usage proxy: sessions, turns, input/output/cache tokens per success, wall time.
- Contamination contrasts (§8).

### 3.4 Unit of analysis

Within a bed: the cluster, by cluster bootstrap (§5.1). Across beds: the bed (§5.2).

---

## 4. Power

[calc, PLAN §7: `scratchpad/breadth/plan/pool_power.py` over the methodology sweep's `portfolio_sim.py`; 4,000
replications per cell; discordance 0.25 (observed 0.23–0.27 on AB dev60 [M]); δ = 0.10; one-sided α = 0.025;
Hartung-Knapp with Paule-Mandel τ².]

| B | n_eff per bed | τ between beds | P(H1 \| true 0) | P(H1 \| true +0.03) | type-I at true −δ |
|---|---|---|---|---|---|
| 4 | 60 / 90 | 0.05 | 0.31 / 0.42 | 0.52 / 0.66 | ≤ 0.005 |
| 8 | 60 / 90 | 0.05 | 0.85 / 0.91 | 0.97 / 0.99 | ≤ 0.018 |
| 8 | 60 / 90 | 0.08 | 0.66 / 0.71 | 0.87 / 0.90 | ≤ 0.019 |

n_eff is the number of tasks divided by the within-bed design effect; with 2–3 tasks per cluster and an intra-cluster
correlation of the paired difference up to 0.45, the planned 90–270 tasks per bed give n_eff ≈ 60–90 [P, assumption to
be re-estimated from dev pilots before the freeze].

**Downgrades declared now:**
- The Stage-A pooled analysis (B = 4) is **directional**: power 0.24–0.42 at a true difference of 0.
- Per-bed non-inferiority tests are **directional**: about 0.48 power each [calc].
- If fewer than 8 beds are admitted by 2026-11-11, the pooled analysis runs on the admitted beds and is labelled
  "underpowered, B = k" with the power from this table's model.

---

## 5. Analysis

Analysis script: `experiments/breadth/analyze.mjs` [TBD-v1: path, sha256, frozen before any sealed run]. Gaps under 3
points are noise. No conclusion from K = 1.

### 5.1 Within a bed

- Task-level paired difference D_t = ȳ_t(F-H) − ȳ_t(A-S) (and F-H − A-H for H3), with ȳ the mean over runs or lineages.
- Bed estimate d_b = stratum-weighted mean of D_t (weights = stratum population share ÷ sample share; equal weights when
  the sample is proportional).
- Interval: cluster bootstrap, 10,000 replicates, resampling clusters within strata; for F-build beds a two-stage
  bootstrap (lineages within cluster type, then clusters). Percentile intervals; no CLT-based interval for any bed
  (n is in the regime where CLT intervals under-cover: Bowyer et al., arXiv 2503.01747 [S-obs fetch]).
- Variance v_b for pooling = bootstrap variance of d_b.

### 5.2 Across beds

- Random-effects pooling: Paule-Mandel τ², inverse-variance weights 1/(v_b + τ²), Hartung-Knapp-Sidik-Jonkman standard
  error with the floor "never smaller than the fixed-effect standard error", t distribution with B − 1 df.
- Prediction interval for the true effect in a new bed: μ̂ ± t_{B−2} · sqrt(τ̂² + SE²).
- Reported with I² and τ̂.

### 5.3 Hypotheses

All one-sided at α = 0.025. H1, H2 and H3 are co-primary and the claim needs all three, so no multiplicity correction
is applied to the conjunction.

| Id | Statement | Test |
|---|---|---|
| **H1** non-inferiority | pooled μ(F-H − A-S) > −0.10 | lower bound of the one-sided 97.5% HKSJ interval > −0.10 |
| **H2** cost | pooled ratio CPS(F-H) / CPS(A-S) ≤ 0.5 | per bed, log CPS ratio with a cluster-bootstrap variance; pooled on the log scale (same method as §5.2); upper bound of the one-sided 97.5% interval ≤ log 0.5 |
| **H3** lift | pooled μ(F-H − A-H) > 0 | lower bound > 0 |
| H1-sup (closed test after H1) | pooled μ(F-H − A-S) > 0 ("beats") | lower bound > 0 |

### 5.4 Secondary analyses (descriptive; Holm-adjusted where a p-value is shown)

1. Per-bed table: d_b with interval for F-H − A-S, F-H − A-H, A-H − A-S; per-bed directional NI at δ = 0.10 with Holm.
2. Opus: F-H − A-O on the anchors, pooled; NI at δ = 0.15 descriptive.
3. F-S − A-S on WorkBench and AgentDojo: does Foundry lift Sonnet too.
4. pass^3 on τ² telecom by arm.
5. Harm rate (WorkBench), ASR (AgentDojo), SGC (AppWorld).
6. F-H process measures (§3.3), including self-verification false-pass rate.
7. Mercury F-M, if run.
8. Host study (laptop), within host only, if run under its own addendum.

### 5.5 Decision rules (verdict)

| Verdict | Rule |
|---|---|
| **Supported** | H1 ∧ H2 ∧ H3 hold at B = 8. The claim is stated with its envelope: the beds, shapes and models tested, the pooled μ̂ with interval, τ̂, and the prediction interval |
| **Supported, beats** | the above plus H1-sup |
| **Supported with exceptions** | the above, but at least one bed is *clearly inferior* (its own upper 97.5% bound for F-H − A-S below −0.10): the envelope statement excludes that bed's domain and shape by name |
| **Cheap model, not Foundry** | H1 and H2 hold, H3's interval lies at or below 0 |
| **Refuted (within the envelope)** | the pooled upper 97.5% bound of F-H − A-S is below −0.10, or the pooled CPS-ratio lower bound is above 1 |
| **Inconclusive** | anything else |

Robustness requirements, reported with the verdict (they do not change it but are stated in the same sentence):
- the prediction interval's lower bound against −0.20;
- leave-one-bed-out: H1 in each of the 8 leave-one-out pools;
- excluding H4 beds;
- treating the two τ² beds as one source;
- unweighted (macro) pooling with t_{B−1}.

### 5.6 Missing data

A task with an infrastructure fault (harness crash, rate-limit stop, disk full; not a model timeout) is re-run once from
a fresh world in the same wave; if it faults again it is excluded from **every** arm of that bed and listed. Model
timeouts and cap hits are failures (§2).

---

## 6. Stopping, kill rules and falsifiers

- **No early stop for efficacy.** Each bed runs to its planned sample unless a rule below stops it.
- **Futility (per bed, one interim look at half of its paired tasks):** stop if the one-sided z for F-H − A-S against
  −0.10 is below 0.02. Operating characteristics: P(stop | true 0) = 0.02, P(stop | true −0.10) = 0.47 [S-obs calc,
  `fut-sim.txt`]. A stopped bed enters the pool with the data it has.
- **Cost:** a bed stops at its cap (§7). It enters the pool with the data it has, labelled.
- **Invalid evaluator:** a bed whose oracle is found invalid after its sealed run (a gold or mutation failure, a judge in
  the reward, a leak) is excluded from the pool and the next substitute is run; the finding is reported (AGENTS.md: an
  invalid evaluator blocks claims).
- **Leakage:** if any arm or builder is found to have read a sealed item, gold, or a grader output, that bed's sealed run
  is void and the items are burned.
- **Falsifiers from ROADMAP §4.3 that apply:** C1/C2 — "non-inferiority fails"; "held-out families drop more than 5
  points" (read here as: on a bed with dev and sealed numbers for F-H, a drop of more than 5 points from dev to sealed is
  reported as a falsifier signal); "wrong reuse exceeds 5%" (F-reuse wrong-reuse rate, pooled).
- **Interim looks change neither the stopping rule nor the verdict.** The Stage-A pooled report is descriptive.

---

## 7. Cost caps

List price, arithmetic in [PLAN §9](PLAN.md#9-cost-table) [I until the dev pilots replace the per-task figures].

| Bed | Planned sealed cost | Cap (stops the bed) |
|---|---|---|
| WorkBench | ≈ $20 | $40 |
| AgentDojo | ≈ $24 | $45 |
| NaturalPlan | ≈ $9 | $20 |
| AppWorld | ≈ $184 (+ $64 Opus anchor if approved) | $250 (+ $64) |
| **Stage A sealed** | **≈ $240** | **$355** |
| τ² telecom (K = 3) | ≈ $150 (+ $54 Opus anchor) | $200 |
| BFCL-MT | ≈ $29 | $45 |
| SpreadsheetBench-912 | ≈ $71 | $100 |
| τ² banking | ≈ $105 (+ $36 Opus anchor) | $150 |
| **Stage B sealed** | **≈ $350** (≈ $440 with the τ² Opus anchors) | **$495** |

Each stage's sealed run is one experiment under the $500 pause rule (`policy/models.json` `spend`): above it, stop and ask
the owner in README first. Dev pilots and kit development are separate experiments with their own caps (Stage A ≈ $115,
Stage B ≈ $80). Every cost and every 429 is recorded.

---

## 8. Threats to validity and contamination checks

### 8.1 Contamination

1. **Memorization probe** per bed (≈ $1): Haiku 5.5 and Sonnet 5.5, task text only, no tools, asked for the gold actions
   or answer, on 30 dev items. Flag if blind success exceeds the do-nothing floor + 0.05. A flagged H4 bed is not
   admitted; a flagged H1–H3 bed is admitted with the flag reported.
2. **Fresh vs public contrast** (WorkBench shipped vs regenerated; τ² v2.0.0-replaced vs unchanged; NaturalPlan public vs
   generated): A-H and A-S success on each; a drop over 10 points on fresh items is reported as a contamination signal.
3. **Library leakage scan**: F-kit templates, bed cards and kept workflows scanned for literals from sealed items; any hit
   voids the lineage on that bed.
4. **Network-off** bed processes and arms (facade under `unshare -rn`).
5. **H4 sensitivity** (§5.5).

No model knowledge cutoff is published for Haiku 5.5, Sonnet 5.5 or Opus 5.5 [S-obs]; every public item released before
2026-08 is treated as possibly seen.

### 8.2 Oracle weaknesses known in advance

WorkBench do-nothing floor 18.0% (paired differences cancel it; the state-changing subset is reported) and an untested
generator; AgentDojo injection registration (8 workspace pairings unresolved); NaturalPlan calendar exact match (replaced);
AppWorld evaluated only through `world.evaluate` (and `appworld verify` loses stdout); SpreadsheetBench font and fill
comparison disabled upstream (formatting tasks under-tested); τ² telecom's ACTION component on 32 tasks [S-obs].

### 8.3 Other threats

- **The Foundry arm differs per bed** in its bed card. Cards are written from public material only, frozen, and published
  with the result; a bed needing code beyond its card is labelled "bed-specific F".
- **Weak frontier baseline.** A-S is Sonnet in Claude Code with the bed's tools, at effort high; F-S tests whether
  Foundry is generically helpful.
- **Harness parity.** The Haiku 4.5 anchors on WorkBench and BFCL compare our plain executor with published per-task
  results; a disagreement above 10 points is reported as a harness difference, and A-H/A-S results are labelled
  "our harness".
- **Infrastructure noise.** Interleaved arms on identical reset worlds; CLI version and engine hash recorded per run.
- **Not leaderboard entries.** Results with F-H are never submitted as standard leaderboard entries (ROADMAP §4.3), and
  AppWorld per-task test results stay out of git (its terms).

---

## 9. What gets reported

In `research/breadth-20261021/REPORT-STAGE-A.md` (descriptive) and `REPORT.md` (the verdict), with every number carrying
its command, K and cost:

1. The admission log (§1.6): every bed considered, gate results, floors, mutation scores, probes, headroom screen, cost
   gate, admitted or skipped with reason; substitutes used.
2. Per bed and arm: n tasks and clusters, success with cluster-bootstrap interval, pass^2 (pass^3 on τ² telecom), CPS,
   tokens, sessions, wall time, timeouts, cap hits, infrastructure faults and exclusions.
3. Per bed: d_b for F-H − A-S, F-H − A-H and A-H − A-S with intervals; directional NI with Holm.
4. Pooled: μ̂ with the HKSJ interval for H1 and H3, the pooled CPS ratio for H2, τ̂, I², the prediction interval, the
   forest plot data, and every robustness analysis of §5.5.
5. The verdict from §5.5, verbatim, with its envelope sentence.
6. Secondary analyses (§5.4), labelled descriptive.
7. Contamination results (§8.1), harness-parity results, and oracle weaknesses.
8. Raw failures: every failed sealed run's verdict reason in aggregate (per-task detail host-only where a licence or
   benchmark rule requires it: AppWorld test, NC data), and negative results in `docs/RESEARCH.md`.
9. Every deviation and amendment, dated, with the items burned.
10. The published frontier numbers used for screening, labelled with model and date, never as our arms.

---

## 10. Deviations

Any change after the v1 commit goes to the Amendments section with date and reason. A change to arms, beds, splits,
outcomes, hypotheses, the margin or the analysis script after any sealed outcome is known downgrades the affected
result to diagnostic.

---

## 11. Freeze checklist (v0 → v1)

- [ ] Engine freeze tag and commit; CLI version.
- [ ] Facade code hash; per-bed adapter hashes; installs recorded under D16.
- [ ] §1.6 admission rows for beds 1–4 (Stage A) at least; Stage-B rows may be added by dated amendment **before** any
      Stage-B sealed run.
- [ ] Sealed manifests: WorkBench seed and instance hashes; AgentDojo injection-task hashes; NaturalPlan generated-instance
      hashes; AppWorld scenario id list hash.
- [ ] F-kit v1 core hash; bed-card hashes; per-bed dev-look log (≤ 3 looks each).
- [ ] Arm definitions frozen (§2 hashes); per-bed turn caps and wall timeouts.
- [ ] Oracle paths and sha256 (§1.5), including the declared fixes and their gate re-runs.
- [ ] Dev-pilot per-task costs replace the §7 estimates; caps re-checked under $500 per stage.
- [ ] Design-effect estimate from dev pilots; §4 re-run if n_eff falls below 60 for any bed.
- [ ] Analysis script path and sha256; a dry run of it on simulated data reproduces the §4 power table within 0.03.
- [ ] Owner decisions OD-1, OD-2 (D10), OD-5, OD-6 recorded (PLAN §10).

## Amendments

(dated entries only)
