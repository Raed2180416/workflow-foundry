# Pre-registration BREADTH-1 (draft v0, revision 2): cheap model + Foundry against frontier alone, across independent beds

**Status: DRAFT v0, revision 2, 2026-10-21. Not frozen. Nothing in this file has run.** It follows
[research/PREREGISTRATION-TEMPLATE.md](../PREREGISTRATION-TEMPLATE.md). Version v1 is frozen and committed only after
every item of the freeze checklist (§11) is filled; until then any run on a sealed item is forbidden, and a result from
a run before the v1 commit is diagnostic evidence only. The design and its reasons are in [PLAN.md](PLAN.md)
(revision 2); this file holds the rules. Revision 1 of this draft (committed in `6c56ec30`) is superseded; the changes are
listed at the end ("Draft revisions").

| Field | Value |
|---|---|
| Experiment id | BREADTH-1 |
| Claim tested | ROADMAP C1, with the construction (C0) and within-cluster reuse (C2) parts that the Foundry arm exercises: **on a declared portfolio of up to twelve independent external beds, Haiku 5.5 inside Foundry is non-inferior to Sonnet 5.5 alone within 10 points (pooled) at no more than half its cost per verified success; Foundry lifts Haiku 5.5 above Haiku 5.5 alone; and Haiku 5.5 inside Foundry is non-inferior to Opus 5.5 at effort xhigh (the owner's frontier bar, D19) within 10 points at lower cost.** Falsifiable by §5.6 |
| Evidence class | Sealed items: `sealed` (held-out, claim-bearing). Dev pilots, kit development, interim reports: `development` |
| Pre-registration commit | to be recorded at the v1 freeze (`git log --diff-filter=A --format=%H -- research/breadth-20261021/PREREG-BREADTH-v1.md`) |
| Repository HEAD when this revision was written | `7ab0c16e5401377f555e6ff8520e91b769e70178` |
| Policy file | `policy/models.json` version `2026-10-21.2` (re-read at freeze) |
| One-sided level | **0.025** for every claim-bearing test (two-sided 95% intervals); 0.05 only for dev screens |
| Date | 2026-10-21 (v0, revision 2) |

Tags: **[M]** measured or read in the repo; **[S-obs]** observed by a breadth sweep today; **[calc]** computed for this
design; **[P]** a choice this preregistration makes; **[TBD-v1]** to be filled before the freeze.

---

## 0. What the author had seen before writing

The author (an Opus 5.5 subagent) read the six breadth sweep summaries and notes (agentic-tool, enterprise-process,
construction, recurring-synthesis, methodology, repo-coverage), the cost-critic and owner-critic scripts and outputs,
README, THESIS (§5 P9, §10 D10), ROADMAP §4 and §6, OPERATING-PRINCIPLES, decisions D1–D22, `policy/models.json`, the
AB-v1 preregistration with amendments AM-10, AM-11 and the frontier amendment, DEV60 and DEVCHECK reports, the SOP-Bench
notes and design, the seed ledger, and the pinned τ² clone's telecom split and task files, registry, solo-mode code paths
and CHANGELOG. It ran two $0 calculations (`breadth/plan2/cost2.py`, `breadth/plan2/graph_power.py`). It did **not** read
any test or sealed item of any bed: no AppWorld test task, no held-out WorkBench template's instances, no AgentDojo task
text, no NaturalPlan, PlanBench, ToolHop, DABstep or BFCL instance, nothing under `beds/sealed/`, and no aggregate of the
running SOP-Bench sealed run. Of τ² telecom it read task ids (intent, subtask names, persona) and one public task's text.
It has seen published aggregate leaderboards and per-task frontier result files only through the sweeps' summaries.

---

## 1. Beds and splits

### 1.1 Portfolio, in declared order [P]

The primary pool is the first **twelve** beds of this list that pass admission (§1.2), substitutes taking the place of
skipped beds in order. The verdict (§5.6) is computed once, on the beds complete by **2026-11-11**; it needs **B ≥ 8**,
otherwise it is labelled "underpowered, B = k". The first six beds span six domains and include the long-horizon bed
(AppWorld), so the interim report at six beds is not an envelope of short tasks only.

| Order | Bed (pin) | Held-out class (PLAN §1) | Cluster | Sealed sample: Haiku arms / comparator subset | Primary outcome |
|---|---|---|---|---|---|
| 1 | WorkBench @`49c7dfd00c03d384ec59ea57374f50b766aa5613` | H2 (regenerated instances) or H4 fallback | template | 40 held-out templates × 3 = 120 / same 120 | official `is_correct` |
| 2 | AgentDojo 0.1.35, benchmark v1.2.2 | H3 (authored injections) on H4 user tasks | user task | 58 held-out user tasks × {benign, inj-1, inj-2} = 174 / same | utility ∧ (attacked ⇒ security) |
| 3 | NaturalPlan (data sha256 trip `15c4755d…`, meeting `cabd5537…`, calendar `3f34ff27…`) | H2 (our generator) or H4 fallback | task type × complexity level | ≈ 27 × 10 = ≈ 270 / same | trip exact; meeting simulator score = golden; calendar feasibility checker |
| 4 | τ²-bench telecom @`57e54143`, solo mode (`llm_agent_solo`, `dummy_user`) | H4 (+ v2.0.0-replaced subset flagged) | intent × subtask count × persona cell | 100 (official test 40 + 60 from the pool) / same; A-O 20 unless full (§1.2 step 7) | reward = environment assertions (+ ACTION where defined) |
| 5 | AppWorld 0.1.3.post1, data 0.1.0 | H1 (official test_normal) | scenario | 56 scenarios × 3 variants = 168 / 2 variants per scenario = 112; A-O 20 unless full | TGC |
| 6 | BFCL v4 multi-turn (`bfcl-eval` 2026.3.23): base, miss_func, miss_param, long_context | H4 | category × API set | 160 (40 per category) / same | state ∧ response ∧ order checkers |
| 7 | SpreadsheetBench-912 v0.1 (sha256 `9cf7228b…3399`) | within-item hold-out (cases 2–3) | instruction | 60 instructions × cases 2–3 = 120 / same | both held-out cases pass |
| 8 | PlanBench (Blocksworld, Logistics, Depots × plain, mystery, randomized), regenerated | H2 | domain × variant × size bin | ≈ 150 / same | plan valid under the domain (VAL or a parity-tested validator) and reaches the goal |
| 9 | ToolHop (HF card 2026-04-11; ToolHop.json sha256 `0a51f71a…a7fab`) | H4 | knowledge domain | 80 domains × 2 = 160 / same | exact `<answer>` |
| 10 | τ²-bench banking_knowledge (`--retrieval-config bm25`) + airline (`--communicate-scorer substring`), user simulator Haiku 5.5 | H4 | intent / document group | 90 (airline test 20 + banking 70) / same; A-O 20 unless full | reward (DB hash, ACTION, substring COMMUNICATE) |
| 11 | DABstep-fresh: fresh parameterizations of public question templates over Adyen's context data (HF `adyen/DABstep` @`b427f39e…`), oracle = our fee-rule solver | H2 (own generator) | question template | 40 templates × 3 = 120 / same | exact answer from the validated solver |
| 12 | EnterpriseOps-Gym csm + itsm + hr (repo @`271f2c35…`, HF @`c8e538ea…`), owner's laptop | H4 (public split) | domain × task template | 120 / 100; A-O 20 unless full | SQL state verifiers (tasks without `response_check` only) |
| sub 1 | NESTFUL (data_v2) | H4 | call-sequence length × API family | 160 | execute predicted calls, final answer = gold |
| sub 2 | DS-1000 (887 problems without TF/PyTorch) | H4 | library × perturbation type | 160 | test_execution on regenerated inputs + test_string |
| sub 3 | SpreadsheetBench V2, non-chart tasks | H4 (released 2026-09) | task | ≥ 60 | required cells exact, untouched cells unchanged, final answer exact |

**Not in the primary pool** (§1.7): AutomationBench AB-v1 test and SOP-Bench phase 2 (their own preregistrations;
extended pool X if they add frontier-alone arms); own Claude-written beds (pool O); factory families (pool F);
descriptive-only beds with fewer than 20 clusters or n_eff below 60 (AgentArch, ITBench-Lite, TaxCalcBench TY24,
MCPMark local); controls (LegalBench, MCPGen).

### 1.2 Admission (all before any paid sealed run on that bed) [P]

A bed is admitted only if, in this order:
1. **D16** is met: pinned install outside the repo, ≤ 500 MB, every download recorded (URL, sha256, size, licence,
   date) in DISPOSALS or the bed's acquisition note.
2. **$0 oracle-validity gate** BG-0…BG-9 (PLAN §5.3) passes, results in §1.6: gold 100%; floors reported; ≥ 3 mutation
   operators with ≥ 95% killed; identical digest on two runs; no LLM judge in the reward; alternative-valid-answer audit;
   evaluator-defaults audit; leakage test; ABC checklist row.
3. **Memorization probe** (§8.1) is clean for H4 beds.
4. **Dev pilot**, on dev items only: ≥ 30 paired dev tasks with A-H, F-H (kit as it stands) and A-S; A-O on 30 (beds 1, 2,
   3, 6, 7, 8, 9, 11) or 10 (beds 4, 5, 10, 12); a K = 3 subsample of 20 tasks for A-H and F-H. It estimates discordance,
   the intra-cluster correlation of the paired difference, the flip rate, cost and meter units per session.
5. **Headroom screen**: skipped as *saturated* if A-H and A-S both score ≥ 0.90 on the dev pilot; as *uninformative* if
   A-S scores < 0.10.
6. **Assay screen**: the dev-pilot lift A-S − A-H must be ≥ 0.10 (point estimate). A bed below it is skipped from the
   primary pool and reported as "no frontier premium here" with all its dev contrasts; the next substitute takes its place.
7. **Depth and cost gate**: with the dev ICC, the planned sample must give ≥ 20 clusters and n_eff ≥ 60 for F-H vs A-S;
   the projected sealed cost must fit the bed's cap (§7); otherwise clusters are cut, never below 20 or n_eff 60; below
   that the bed is skipped. For beds 4, 5, 10, 12, A-O runs at full comparator depth only if the dev pilot's measured meter
   draw projects the bed's A-O arm into at most two five-hour windows at ≤ 40% of each; otherwise A-O runs as a 20-task
   anchor. The **O-pool** (node C, §5.3) is the set of beds with A-O at full depth.

All screen numbers are recorded in §1.6 before the bed's sealed manifest is opened. A bed is never skipped after any of its
sealed outcomes is known.

### 1.3 Splits and sealed manifests [P, details TBD-v1]

- **WorkBench.** Within each domain, templates ordered by `sha256('breadth-wb-v1:' + template_id)`; the first
  round(0.42 · n_domain) are dev. With 12/11/9/8/8/21 templates (analytics, calendar, email, CRM, project management,
  multi_domain) that is 5/5/4/3/3/9 = 29 dev, 40 held out. Sealed instances: `workbench-generate-data` with seed
  `breadth-wb-v1` [TBD-v1: exact command and verified seed control], 3 per held-out template; manifest hash committed,
  content host-only. Fallback (generator not seedable, or failing BG-1/BG-4): shipped instances 1–3 of each held-out
  template, class H4.
- **AgentDojo.** Per suite, user tasks ordered by `sha256('breadth-ad-v1:' + suite + id)`; the first 40% are dev (39), the
  rest held out (58). Sealed injection tasks: about 3 per suite, written by a session with no access to the F-kit or any
  arm output, each validated fail-to-pass by a scripted agent, hashed and stored host-only before any arm runs. Attack:
  `important_instructions` [TBD-v1: confirm the name at the pin]. Per held-out user task: one benign and two attacked units
  (injections assigned by hash).
- **NaturalPlan.** Dev: a 30% stratified sample of public instances. Sealed: our generator's instances, admitted by the
  faithfulness gate (PLAN §4.3); fallback public instances outside the dev sample plus a paraphrased format-drift copy,
  class H4.
- **τ² telecom.** Dev: the official train split (74). Sealed: the official test split (40) plus 60 tasks drawn from the
  pool outside train and test by `sha256('breadth-t2-v1:' + id)`, at most 3 per intent × subtask-count × persona cell.
  Cluster = that cell (parsed from the task id, e.g. `[mobile_data_issue]…[PERSONA:Hard]` [M]). [TBD-v1: the cell count of
  the drawn sample must be ≥ 20.]
- **AppWorld.** Official splits. Kit development on train and dev only. Sealed: all 56 test_normal scenarios; the
  comparator subset is 2 variants per scenario chosen by `sha256('breadth-aw-v1:' + task_id)` without opening content.
  test_challenge is not touched.
- **BFCL-MT.** Per category, entries ordered by `sha256('breadth-bf-v1:' + id)`; the first 40 are sealed, the next 10 dev.
- **SpreadsheetBench-912.** 60 instructions by hash among those with 3 cases, excluding the 67 an unchanged workbook
  passes; case 1 is given to every arm with its answer workbook; cases 2–3 are scored.
- **PlanBench.** Instances regenerated with the repository's generators under seed `breadth-pb-v1` [TBD-v1: generator
  commands], 5 per domain × variant × size-bin cluster; dev: a disjoint regenerated set and the public set.
- **ToolHop.** 80 knowledge domains by hash, 2 queries each by hash; dev: 20 other domains.
- **τ² simulated-user.** Airline: official test (20) sealed, train (30) dev. Banking_knowledge: 97 tasks ordered by hash,
  27 dev, 70 sealed [TBD-v1: confirm no official split at the pin].
- **DABstep-fresh.** The 10 dev questions and the recovered public test answers are used only to validate the solver.
  Fresh sealed questions: 40 templates by hash, 3 new parameterizations each, generated with seed `breadth-dab-v1` and
  hashed; 1 further parameterization per template for dev.
- **EnterpriseOps-Gym.** Per domain, tasks without `response_check` ordered by hash; 20% dev, sealed 40 per domain; mode
  `oracle` (no distractor tools).

**Burned items.** Any sealed item that is opened, printed or diagnosed outside the run is burned and listed in a dated
amendment; it never enters another held-out set.

### 1.4 Who authored what

| Artifact | Author | Must not have seen |
|---|---|---|
| F-kit core templates and bed cards | Opus 5.5 builder session | any sealed item |
| AgentDojo sealed injection tasks | a separate session | the F-kit and any arm output |
| NaturalPlan generator, feasibility checker; PlanBench validator; DABstep generator and solver | builder sessions | sealed generated instances (they see only generator code, public data, dev items) |
| Seeds and manifests | scripts, seeds above | — |
| Analysis script | this design's author or a successor | any sealed outcome |
| Log-audit reader | a session that built nothing | — |

### 1.5 Oracles

Per bed: oracle path and sha256 [TBD-v1]. Oracle code is used as shipped except the declared changes: NaturalPlan calendar
feasibility checker; SpreadsheetBench `evaluation.py` fixes (score the output files, iterate the actual case count, repair
the 5 malformed `answer_position` strings); AgentDojo pairing fix (if a code change is needed); PlanBench validator (if VAL
cannot be built); DABstep solver (N-version gate: agrees with all 10 dev answers and with ≥ 99% of the recovered test
answers on the templates used, every disagreement explained in writing); the τ² user simulator for bed 10. Every change is
gated by BG-1 and BG-3 again.

### 1.6 Control results and admission log

[TBD-v1: one row per bed: BG results, floors, mutation score, digests, probe results, dev-pilot numbers (discordance, ICC,
flip rate, cost and meter per session by arm), headroom and assay screens, depth and cost gate, A-O full or anchor,
admitted or skipped with reason. Beds 1–4 at the v1 freeze; later beds by dated amendment before their sealed runs.]

### 1.7 Secondary pools (never inside the primary verdict) [P]

| Pool | Members | Rule |
|---|---|---|
| X: extended external | primary beds + AB-v1 test + SOP-Bench phase 2 sealed | AB-v1 enters only if its harness-freeze addendum puts a Haiku + Foundry arm and an A0 of Sonnet or Opus xhigh on the same test tasks; SOP-Bench only if a dated amendment adds A-S or A-O before any sealed aggregate is read. Reported as a sensitivity of node A with their own arm definitions named |
| O: own beds | E8 sized world, BUILDER-1 fresh-author set, Tier-A beds on fresh seeds, W-bed | each under its own preregistration; a separate forest plot labelled "own beds (Claude-written)" |
| F: factory families | PLAN §6 | the factory's own claim (PLAN §6.6) |

---

## 2. Arms

| Arm | Definition | Models (policy ids), effort | Tools | Per-task budget | Runs | Frozen hash |
|---|---|---|---|---|---|---|
| **A-H** | plain executor: `claude -p --output-format stream-json` with the bed's official system prompt where one exists, `--strict-mcp-config` with only the bed facade (direct calls on beds 3 and 8 with the official prompt) | `claude-haiku-5-5`, `high` | facade tools only; no Bash, no network | turn cap = bed's official cap; wall timeout [TBD-v1]; $ reservation $0.75 | K = 2 (3 on bed 4) | [TBD-v1] |
| **F-H** | A-H's executor plus the Foundry MCP server and F-kit v1 (PLAN §5.2): Haiku constructs from Opus-written templates and the bed card, runs, verifies with gating acceptance; F-reuse (beds 1, 2, 4, 5, 10, 11), F-build (3, 7, 8), F-live (6, 9, 12) | `claude-haiku-5-5`, `high`, for construction and nodes; templates and bed cards written once by `claude-opus-5-5` | facade + Foundry MCP | same caps as A-H; construction and verification charged to the task where they occur | 3 lineages (random stream orders); F-build: 5 build lineages per type on beds 3 and 8, 3 per instruction on bed 7; K = 3 on bed 4 | [TBD-v1] |
| **A-S** | A-H with the model changed | `claude-sonnet-5-5`, `high` | as A-H | as A-H; $ reservation $1.50 | K = 2 (3 on bed 4) | [TBD-v1] |
| **A-O** | A-H with the model changed | `claude-opus-5-5`, **`xhigh`** (D19) | as A-H | as A-H; $ reservation per bed = 3 × the dev-pilot 95th-percentile cost [TBD-v1] | K = 2 (3 on bed 4); full depth or 20-task anchor (§1.2 step 7) | [TBD-v1] |
| F-S (optional, beds 1–2) | F-H with Sonnet in every model role | `claude-sonnet-5-5`, `high` | as F-H | as F-H | 2 lineages | [TBD-v1] |
| F-HM (conditional, beds 1–2) | F-H with Mercury 3 as planner and checker, Haiku acting (the A1-C ledger/checker pattern) | `mercury-3` + `claude-haiku-5-5` | as F-H | ≤ 4M Mercury tokens per bed (D18), only if ≥ 2× that remains at the freeze | 2 lineages on 40 comparator tasks | [TBD-v1] |

**Haiku effort.** One dev look (counting toward the ≤ 3) may test both Haiku arms at `max` on beds 1 and 2; if A-H rises
by ≥ 5 points at ≤ 2× cost on both, A-H and F-H switch to `max` together before the freeze [P].

**Held constant across arms:** bed tools, environment, reset state, official prompt, turn cap, wall timeout, grader, CLI
version, engine freeze, resource limits (with the multiplier recorded). Timeouts and cap hits count as failures and are
charged at their recorded cost, or at the reservation if unrecorded (P1's lesson: an unstated per-call timeout created
most of a d4 gap [M]).

**Interleaving:** per task, arm order is randomized with seed `sha256('breadth-order-v1:' + bed + task)` and recorded;
all arms of a task run on identical reset worlds, within the same wave where possible. Comparator dev runs may be cached;
sealed runs are never cached.

**What Foundry may use on sealed items:** its own verification, applicability gates and kept workflows from earlier
instances of the same cluster in the same lineage; F-build artifacts frozen on dev. Never the oracle, gold, the sealed
manifest, another lineage's workflows, or anything written after the freeze.

**Engine:** one named engine freeze for every sealed run of BREADTH-1 [TBD-v1: tag and commit]; CLI version recorded per
run.

**Not arms:** the Haiku 4.5 harness-parity anchors (WorkBench dev templates, BFCL dev entries), the published frontier
per-task results, cached dev comparators. They check the harness and screen beds; they never enter a hypothesis.

---

## 3. Measurements

### 3.1 Primary outcome

Per task and run: binary success by the bed's primary outcome (§1.1). Per task: ȳ = the mean over its runs (F-H: over its
lineages). AgentDojo benign units count utility only.

### 3.2 Cost per verified success (CPS)

**Run-time CPS** (primary, H2): all list-price USD of the arm on the bed's sealed sample (every run, failures, timeouts,
construction, verification, applicability gates; F-build construction amortized over the held-out instances it serves)
÷ the number of oracle-verified successes. Costs as reported by the CLI (`total_cost_usd`, costBasis = list) or
recomputed from journaled tokens at the policy's prices; one basis for all arms, recorded. Haiku calls above 100K prompt
tokens are charged at the higher tier. Zero successes: add 0.5 successes and flag.

**Adaptation cost** (secondary): Opus template and bed-card authoring per bed, reported separately with the break-even
number of tasks at which it is repaid against A-S.

CPS is always reported with its two factors (cost per task ratio; success ratio), since log CPS ratio = log(C_F/C_S) −
log(p_F/p_S).

### 3.3 Secondary measurements

- pass^2 on every bed; pass^3 on bed 4.
- Harmful side-effect rate (WorkBench), targeted ASR and utility under attack (AgentDojo), SGC (AppWorld), the
  state-changing subset where a floor exceeds 10% (WorkBench).
- F-H process: construction failures, self-verification false-pass rate (own verdict pass, oracle fail), reuse rate,
  wrong-reuse rate (reused workflow fails where fresh construction passed on the same item in another lineage), deopt and
  fallback rate.
- **Usage**: meter units per session from `rate_limit_event` (5-hour and 7-day utilisation before and after), sessions,
  turns, input, output and cache tokens per success, wall time.
- Gold-solution length per task (from BG-1) as the horizon covariate.
- Contamination contrasts (§8.1).

### 3.4 Unit of analysis

Within a bed: the cluster (§5.1). Across beds: the bed (§5.2).

---

## 4. Power

[calc, `breadth/plan2/graph_power.py`; mKH-HKSJ with Paule-Mandel τ²; 2,000 replications per cell, 3,000 for size; B = 12
beds with n_eff 80 for F-H vs A-S and 100 for F-H vs A-H; O-pool 8 beds with n_eff 90, discordance 0.30; true F-H − A-S = 0;
true CPS ratio vs Sonnet 0.30; δ = 0.10; one-sided 0.025.]

| τ (F-H − A-S) | lift F-H − A-H (mean, τ) | Opus premium over Sonnet | τ of log CPS | P(node A) | P(A ∧ B) | P(A ∧ C) | P(A ∧ B ∧ C) |
|---|---|---|---|---|---|---|---|
| 0.05 | 0.10, 0.10 | 0 | 0.4 | 0.95 | 0.74 | 0.69 | 0.60 |
| 0.05 | 0.10, 0.10 | 0.05 | 0.4 | 0.96 | 0.70 | 0.25 | 0.23 |
| 0.05 | 0.05, 0.05 | 0 | 0.4 | 0.95 | 0.58 | 0.67 | 0.48 |
| 0.05 | 0.10, 0.10 | 0 | 0.7 | 0.63 | 0.50 | 0.48 | 0.43 |
| 0.10 | 0.10, 0.10 | 0 | 0.4 | 0.77 | 0.62 | 0.42 | 0.39 |
| 0.10 | 0.10, 0.10 | 0.05 | 0.4 | 0.75 | 0.58 | 0.15 | 0.14 |

Size: P(node A) = 0.024 (τ 0.05) and 0.026 (τ 0.10) at a true F-H − A-S of −0.10; P(A ∧ C) = 0.023 when F-H is 0.10 below
Opus. Monte-Carlo SE about 0.003.

n_eff = tasks ÷ design effect, DE = 1 + (m − 1)ρ with m instances per cluster; the planned samples give n_eff 62–133 per bed
under ρ = 0.15–0.45 [calc, PLAN §10.2], to be re-estimated from the dev pilots.

**Downgrades declared now:**
- Interim reports at 6 and 9 beds are **descriptive**.
- Per-bed non-inferiority tests are **directional** (202 paired tasks per bed give 0.80 power at δ 0.10 and discordance
  0.25 [S-obs calc]).
- Node C is a **stretch test**: with a 5-point Opus premium over Sonnet its power is 0.15–0.25.
- If fewer than 8 beds are complete by 2026-11-11, the analysis runs on the beds complete and is labelled "underpowered,
  B = k" with the power from this model.

---

## 5. Analysis

Analysis script: `experiments/breadth/analyze.mjs` [TBD-v1: path, sha256, frozen before any sealed run, unit-tested
against the Python simulations in `breadth/tools-meth/` and `breadth/plan2/`]. Gaps under 3 points are noise. No
conclusion from K = 1.

### 5.1 Within a bed

- Task-level paired difference D_t = ȳ_t(F-H) − ȳ_t(X) for comparator X ∈ {A-S, A-O, A-H}, on the tasks where both ran.
- Bed estimate θ̂_b = Σ_t w_t D_t / Σ_t w_t with w_t = stratum population share ÷ stratum sample share (equal when the
  sample is proportional).
- **Variance (primary): cluster-robust CR1**, v_b = G/(G−1) · Σ_c (S_c − m_c θ̂_b)² / n², S_c = Σ_{t∈c} w_t D_t, with t on
  G − 1 degrees of freedom for per-bed intervals. **F-build beds (3, 7, 8)** add a between-lineage component:
  v_b ← v_b + Σ_types π_type² · s²_lineage,type / L, where s²_lineage,type is the variance across the L build lineages of
  that type's mean F-H success and π_type its share of the sample; df = min(G − 1, Σ_types (L − 1)).
- **Sensitivities:** Tango's score test with n_eff = n/DE (ANOVA ICC of D_t, floor 0.10); cluster bootstrap (10,000
  replicates, clusters resampled within strata) **only where G ≥ 30** (it is anti-conservative at 15 clusters: size
  0.039 [calc, methodology `meth-sims/ni_interval_size2.out`]); a Bayesian paired interval (`bayes_evals`, MIT) where
  G < 20.
- Every bed reports its 2×2 discordance table (n11, n10, n01, n00) per comparator, so any reader can recompute McNemar,
  Tango and the cluster-robust interval.

### 5.2 Across beds

- Paule-Mandel τ̂²; weights w_b = 1/(v_b + τ̂²); μ̂ = Σ w_b θ̂_b / Σ w_b; q = Σ w_b (θ̂_b − μ̂)² / (B − 1).
- **SE_mKH = max( sqrt(q / Σ w_b), sqrt(1 / Σ w_b) )** (Röver-Knapp-Friede modification); lower one-sided bound
  μ̂ − t_{B−1, 0.975} · SE_mKH.
- Prediction interval for a new bed: μ̂ ± t_{B−2, 0.975} · sqrt(τ̂² + SE²); I² = τ̂² / (τ̂² + typical v_b).
- Predictive probability that a new bed is non-inferior: F_{t, B−2}((μ̂ + δ) / sqrt(τ̂² + SE²)).
- **Sensitivities** (reported, never substituted): REML τ̂², the unweighted macro mean with t on B − 1 df, and
  DerSimonian-Laird with z (expected to be anti-conservative at small B [calc]).
- Cost: per bed, ℓ_b = log CPS(F-H) − log CPS(X) with a delta-method variance from the paired task-level costs and
  successes (cluster-robust); pooled on the log scale by §5.2.

### 5.3 Hypotheses and the claim graph

All tests one-sided at 0.025 in total (family-wise), δ = 0.10.

| Id | Statement | Test (pooled over) |
|---|---|---|
| H1-S | μ(F-H − A-S) > −0.10 | lower mKH bound > −0.10 (all admitted beds) |
| H2-S | CPS(F-H) / CPS(A-S) ≤ 0.5 | upper mKH bound of pooled ℓ < log 0.5 (all admitted beds) |
| H3 | μ(F-H − A-H) > 0 | lower bound > 0 (all admitted beds) |
| H1-O | μ(F-H − A-O) > −0.10 | lower bound > −0.10 (O-pool, ≥ 5 beds) |
| H2-O | CPS(F-H) / CPS(A-O) ≤ 0.5 | upper bound < log 0.5 (O-pool) |
| H4-S | μ(F-H − A-S) > 0 ("beats Sonnet") | lower bound > 0 (all admitted beds) |
| H4-O | μ(F-H − A-O) > 0 ("beats Opus xhigh") | lower bound > 0 (O-pool) |

**Claim graph** (graphical multiple testing with α recycling; the hypotheses inside a node are an intersection-union
and need no split):
- **Node A** = H1-S ∧ H2-S, tested at α = 0.025.
- If A holds: **node B** = H3 and **node C** = H1-O ∧ H2-O are each tested at 0.0125. If one of them holds, its 0.0125
  passes to the other, which is then re-tested at 0.025.
- If A, B and C all hold: **node D** = H4-S at 0.025; if D holds, **node E** = H4-O at 0.025.
- Node C is tested only if the O-pool has ≥ 5 beds; otherwise its α stays with B, and the Opus comparison is reported
  descriptively at δ 0.15 on the anchors (direct anchors, not bridged through Sonnet: the bridge gives no precision
  gain, SE 0.043 vs 0.046 [calc, methodology `opus_ladder.out`]).

### 5.4 Assay sensitivity and retained lift (reported with every verdict)

- **Lift** λ = pooled μ(A-S − A-H), with its interval. Label of the non-inferiority result: **informative** if λ's lower
  bound > δ; **weakly informative** if λ̂ ≥ δ but its lower bound ≤ δ; **uninformative** if λ̂ < δ. The same for A-O
  versus A-H on the O-pool.
- **Retained-lift ratio** r = μ̂(F-H − A-H) / μ̂(A-S − A-H), with a Fieller interval when λ's lower bound > 0.
- **Retention test** at f = ½: per task L_t = ȳ(F-H) − ½ ȳ(A-S) − ½ ȳ(A-H), pooled by §5.2; reported (one-sided 0.025),
  not part of the graph.

### 5.5 Secondary analyses (descriptive; Holm-adjusted where a p-value is shown)

1. Per-bed table: θ̂_b with interval for F-H − A-S, F-H − A-O, F-H − A-H, A-H − A-S; per-bed directional NI with Holm.
2. Opus anchors on beds outside the O-pool: F-H − A-O, NI at δ 0.15, descriptive.
3. F-S − A-S on beds 1–2 (does Foundry lift Sonnet too); F-HM on beds 1–2 (second cheap model).
4. pass^3 on bed 4 by arm; ICC of task outcomes from the K = 3 subsamples.
5. Harm rate (WorkBench), ASR (AgentDojo), SGC (AppWorld).
6. F-H process measures (§3.3), including the self-verification false-pass rate.
7. **Horizon dose-response**: logit P(success) = a_arm + b_arm · log L with L the gold length standardized within bed,
   cluster-robust SE, pooled across beds; lengths at 50% and 80% success per arm; arm × log L interaction. A
   "long-horizon" sentence needs ≥ 2 beds whose gold-length range spans ≥ 4×.
8. **Moderators** (exploratory, at most two): held-out class H4 vs others; the bed's A-S success (headroom).
9. Accuracy-versus-cost Pareto hull per bed and pooled, origin included, in dollars, tokens and meter units.
10. Pools X, O and F beside the primary (§1.7), each labelled.
11. Host study (laptop), within host only, under its own addendum.

### 5.6 Decision rules (verdict)

| Verdict | Rule |
|---|---|
| **Supported against the owner's bar** | A ∧ B ∧ C. Sentence: "Haiku 5.5 in Foundry is non-inferior to Sonnet 5.5 alone (all beds) and to Opus 5.5 xhigh alone (O-pool beds) within 10 points, at ≤ ½ their cost per verified success, and Foundry lifts Haiku", with the envelope (beds, shapes, hosts, models tested and not), μ̂ with interval, τ̂, the prediction interval, the assay label and r |
| **Supported against Sonnet** | A ∧ B, not C. The sentence names Sonnet only and states "not shown against Opus xhigh" |
| **Cheap system, Foundry's share not shown** | A (with or without C), not B |
| **…, beats** | add "and better than Sonnet 5.5 alone" if D holds; "and better than Opus 5.5 xhigh" if E holds |
| **… with exceptions** | any supported verdict where at least one bed is *clearly inferior* (its own upper one-sided 97.5% bound for F-H − A-S below −0.10): the envelope names and excludes that bed's domain and shape |
| **Refuted (within the envelope)** | the pooled upper one-sided 97.5% bound of F-H − A-S below −0.10, or the pooled CPS-ratio lower bound above 1 |
| **Inconclusive** | anything else |

### 5.7 Robustness (stated in the same sentence as the verdict; they do not change it)

- the prediction interval's lower bound against −0.20, and the predictive probability of NI in a new bed;
- leave-one-bed-out: node A in each leave-one-out pool;
- H4 beds excluded;
- the two τ² beds as one source; SpreadsheetBench-912 and V2 as one source if both are in;
- REML, macro-t and DL pooling;
- run-time CPS with adaptation cost added.

### 5.8 Missing data

A task with an infrastructure fault (harness crash, rate-limit stop, disk full, Docker fault; not a model timeout) is
re-run once from a fresh world in the same wave; if it faults again it is excluded from **every** arm of that bed and
listed. Model timeouts and cap hits are failures (§2).

---

## 6. Stopping, kill rules and falsifiers

- **No efficacy stop**, inside a bed or across beds. Each bed runs to its planned sample unless a rule below stops it.
- **Futility inside a bed** (one look at half of its paired tasks for F-H vs A-S): stop if the one-sided score z against
  −0.10 is below 0.02 (P(stop | true 0) = 0.02, P(stop | true −0.10) = 0.47 [calc, `fut-sim.txt`]). A stopped bed enters
  the pool with the data it has, labelled.
- **Portfolio interim reports** at 6 and 9 complete beds: descriptive. A non-binding refutation stop: if the pooled upper
  one-sided 97.5% bound for F-H − A-S is below −0.10 at an interim, comparator arms on not-yet-started beds may be cancelled
  and the verdict "Refuted (within the envelope)" is issued on the complete beds. (Bed-level efficacy looks at 6/9/12 with
  α_k 0.0025 / 0.0100 / 0.0215 are an option recorded in PLAN §11 OD-6, not adopted.)
- **Cost:** a bed stops at its cap (§7) and enters the pool with the data it has, labelled.
- **Invalid evaluator:** a bed whose oracle is found invalid after its sealed run (a gold or mutation failure, a judge in
  the reward, a leak, a solver disagreement for bed 11) is excluded and the next substitute is run; the finding is
  reported (AGENTS.md: an invalid evaluator blocks claims).
- **Leakage:** if any arm or builder is found to have read a sealed item, gold, or a grader output (log audit, §8.1), that
  bed's sealed run is void and its items are burned.
- **Deadline:** analysis on the beds complete at 2026-11-11 23:59Z.
- **ROADMAP §4.3 falsifiers that apply (C1/C2):** "non-inferiority fails"; "held-out families drop more than 5 points"
  (read as: a dev-to-sealed drop of F-H above 5 points on a bed is reported as a falsifier signal); "wrong reuse exceeds 5%"
  (pooled F-reuse wrong-reuse rate).
- **Interim looks change neither the stopping rules nor the verdict.**

---

## 7. Cost caps

List price; per-task figures are [I] until the dev pilots replace them (PLAN §10).

| Bed | Planned sealed $ | Cap (stops the bed) |
|---|---|---|
| 1 WorkBench | ≈ 58 | 80 |
| 2 AgentDojo | ≈ 84 | 120 |
| 3 NaturalPlan | ≈ 28 | 40 |
| 4 τ² telecom (K = 3) | ≈ 240 | 330 |
| 5 AppWorld | ≈ 394 | 480 |
| 6 BFCL-MT | ≈ 97 | 135 |
| **Beds 1–6** | **≈ 900** | **1,185** |
| 7 SpreadsheetBench-912 | ≈ 166 | 230 |
| 8 PlanBench | ≈ 15 | 25 |
| 9 ToolHop | ≈ 58 | 80 |
| 10 τ² simulated-user | ≈ 183 | 255 |
| 11 DABstep-fresh | ≈ 144 | 200 |
| 12 EnterpriseOps-Gym | ≈ 313 | 440 |
| **Beds 7–12** | **≈ 880** | **1,230** |

Dev pilots, probes, kit development and bed cards are separate small experiments with their own caps (beds 1–6 ≈ $240,
beds 7–12 ≈ $210, F-kit core ≈ $30). If A-O runs at full depth on beds 4, 5, 10 or 12 (§1.2 step 7), that bed's plan and
cap rise by a dated amendment recorded before its sealed run. The policy's $500 single-experiment pause
(`policy/models.json` `spend`) applies per stage: PLAN §11 OD-1 records the decision and the README note before the first
stage above it starts. Every cost and every 429 is recorded.

---

## 8. Threats to validity and contamination checks

### 8.1 Contamination and leakage

1. **Release ledger.** Per bed: public release, last data change, public-answer status, canary presence, class H1–H4. No
   knowledge cut-off is published for Haiku 5.5, Sonnet 5.5 or Opus 5.5 [S-obs]; every public item older than 2026-08 is
   treated as possibly seen.
2. **Memorization probe** per bed (≈ $2–11): Haiku 5.5 and Sonnet 5.5, task text only, no tools, asked for the gold actions
   or answer, on **≥ 100 dev items**; exact one-sided binomial test against the do-nothing/constant floor at 0.05. A
   flagged H4 bed is not admitted; a flagged H1–H3 bed is admitted with the flag reported.
3. **Fresh vs public, pooled difference in differences** (WorkBench shipped vs regenerated; τ² v2.0.0-replaced vs
   unchanged; NaturalPlan and PlanBench public vs generated): per arm, gap = success(public) − success(fresh) on ≥ 60
   items per side per bed; signal = pooled (gap F-H − gap A-S) by §5.2, one-sided against 0.05; each gap reported.
4. **Library leakage scan**: F-kit templates, bed cards and kept workflows scanned for literals of sealed items (hashed
   n-grams of task text and gold); a hit voids the lineage on that bed.
5. **Network-off** bed processes and arms (facade under `unshare -rn`); no benchmark files in arm workdirs (BG-8).
6. **Log audit of every sealed run**: scripted greps over every transcript as it closes (benchmark name, HuggingFace,
   repository URLs, gold file names); a session that built nothing reads all failures and a random 10% of passes, seeded
   by `sha256('breadth-audit-v1:' + bed)`. An LLM may flag, never score. A pass reached by a shortcut is reclassified; a
   bypassable oracle voids the bed. No bed result is final before its audit.
7. **H4 sensitivity** (§5.7).

### 8.2 Oracle weaknesses known in advance

WorkBench do-nothing floor 18.0% (paired differences cancel it; the state-changing subset is reported) and an untested
generator; AgentDojo injection registration (8 workspace pairings unresolved); NaturalPlan calendar exact match (replaced);
AppWorld evaluated only through `world.evaluate` (`appworld verify` loses stdout); SpreadsheetBench font and fill comparison
disabled upstream (formatting tasks under-tested); τ² telecom's ACTION component on 32 tasks; bed 10's user simulator is
not the official one (results not comparable with the τ² board); bed 11's oracle is our solver (N-version gate);
EnterpriseOps-Gym `response_check` tasks excluded [S-obs].

### 8.3 Other threats

- **The Foundry arm differs per bed** in its bed card. Cards are written from public material only, frozen, and published
  with the result; a bed needing code beyond its card is labelled "bed-specific F".
- **F-build arms learn from labelled dev instances** (NaturalPlan, PlanBench) or from case 1 with its answer
  (SpreadsheetBench, given to every arm). The comparison is "a system that builds once from labelled examples" against "a
  model alone with the official prompt"; it is stated as such.
- **Comparator strength.** A-S runs at `high` (the setting of the existing Sonnet numbers); A-O at `xhigh` (D19). More
  reasoning effort did not raise accuracy in 21 of 36 HAL combinations [doc], so no effort is substituted after the fact.
- **Harness parity.** The Haiku 4.5 anchors on WorkBench and BFCL compare our plain executor with published per-task
  results; a disagreement above 10 points is reported as a harness difference and A-H/A-S/A-O are labelled "our harness".
- **Infrastructure noise.** Interleaved arms on identical reset worlds; CLI version, engine hash, resource limits and
  multiplier recorded per run; environment faults re-run once, never scored as failures (Anthropic reports a 6-point gap
  between resource configurations [doc]).
- **Not leaderboard entries.** Results with F-H are never submitted as standard leaderboard entries (ROADMAP §4.3);
  AppWorld per-task test results stay out of git (its terms); SOP-Bench (pool X) is CC BY-NC: per-row results stay out of git.

---

## 9. What gets reported

In `research/breadth-20261021/REPORT-INTERIM-{1,2}.md` (descriptive) and `REPORT.md` (the verdict), every number with its
command, K and cost:

1. The admission log (§1.6): every bed considered, gate results, floors, mutation scores, probes, dev-pilot numbers,
   headroom and assay screens, depth and cost gates, A-O depth, admitted or skipped with reason; substitutes used.
2. Per bed and arm: tasks, clusters, instances per cluster, success with the cluster-robust interval (score and bootstrap
   where allowed), pass^2 (pass^3 on bed 4), CPS with its two factors, tokens, sessions, meter units, wall time,
   timeouts, cap hits, infrastructure faults and exclusions; the 2×2 discordance tables.
3. Per bed: θ̂_b for F-H − A-S, F-H − A-O, F-H − A-H and A-H − A-S with intervals; directional NI with Holm.
4. Pooled: μ̂ with the mKH interval for each hypothesis, τ̂, I², the prediction interval, the predictive probability, the
   forest data, the claim-graph path actually taken, every robustness analysis of §5.7, the assay label, r and the
   retention test.
5. The verdict from §5.6, verbatim, with its envelope sentence and the power of each node at the observed τ̂.
6. Secondary analyses (§5.5), labelled descriptive; pools X, O and F, labelled.
7. Contamination results (§8.1), log-audit findings, harness-parity results, oracle weaknesses.
8. Raw failures: every failed sealed run's verdict reason in aggregate (per-task detail host-only where a licence or
   benchmark rule requires it), and negative results in `docs/RESEARCH.md`.
9. Every deviation and amendment, dated, with the items burned.
10. Published frontier numbers used for screening, labelled with model and date, never as our arms.
11. Architect model, executor model, tools, runtime and human assistance, separately (AGENTS.md).

---

## 10. Deviations

Any change after the v1 commit goes to the Amendments section with date and reason. A change to arms, beds, splits,
outcomes, hypotheses, the margin, the claim graph or the analysis script after any sealed outcome of the affected bed is
known downgrades the affected result to diagnostic.

---

## 11. Freeze checklist (v0 → v1)

- [ ] Engine freeze tag and commit; CLI version; quota-meter capture in the runner (stream-json `rate_limit_event`).
- [ ] Facade code hash; per-bed adapter hashes; installs recorded under D16; run-data rule (audit-on-write) in the runner.
- [ ] §1.6 admission rows for beds 1–4 at least; later beds by dated amendment **before** their sealed runs.
- [ ] Sealed manifests: WorkBench seed and instance hashes; AgentDojo injection-task hashes; NaturalPlan generated-instance
      hashes; τ² task list hash and cell count ≥ 20; AppWorld scenario and comparator-variant list hash.
- [ ] F-kit v1 core hash; bed-card hashes; per-bed dev-look log (≤ 3 looks each, Haiku-effort look included).
- [ ] Arm definitions frozen (§2 hashes); per-bed turn caps, wall timeouts, $ reservations, resource limits.
- [ ] Oracle paths and sha256 (§1.5), including the declared changes and their gate re-runs.
- [ ] Dev-pilot per-task costs and meter units replace the §7 estimates; O-pool membership decided (§1.2 step 7).
- [ ] Design-effect and discordance estimates from the dev pilots; §4 re-run with 20,000 replications at those values;
      the analysis script reproduces the §4 table within 0.03 on simulated data.
- [ ] Seed blocks registered in `research/jit-20261008/SEED-LEDGER.json` for every generated sealed set (PLAN §6.4).
- [ ] Decisions OD-1, OD-2, OD-5, OD-6 recorded (PLAN §11); OD-4 (K) recorded as kept at K = 2 or amended by the owner.

## Amendments

(dated entries only, after the v1 commit)

## Draft revisions (before any freeze)

**Revision 2, 2026-10-21 (this file), changes from revision 1 (`6c56ec30`):**
1. Comparator: Opus 5.5 xhigh added as a tested comparator (D19) through the claim graph of §5.3; revision 1 had Sonnet as
   the only tested comparator and Opus on 20-task anchors.
2. Portfolio: twelve beds in declared order (was eight); τ² banking_knowledge moved from bed 8 to bed 10 and paired with
   airline because it has no solo mode [M]; PlanBench, ToolHop, DABstep-fresh and EnterpriseOps-Gym promoted from
   substitutes; AgentArch and ITBench-Lite made descriptive (fewer than 20 clusters or n_eff below 60).
3. Within-bed inference: cluster-robust t (CR1) primary; bootstrap only with ≥ 30 clusters; the Bowyer et al. citation
   for the bootstrap removed (the paper does not support it at small N); between-lineage variance for F-build beds.
4. Across-bed inference: the Röver floor stated as the modified Knapp-Hartung; REML, macro-t and DL sensitivities;
   predictive probability added.
5. Assay screen at admission; assay label, retained-lift ratio and retention test with every verdict.
6. Memorization probe on ≥ 100 items with an exact test (was 30 items, floor + 5 points); fresh-vs-public as a pooled
   difference in differences (was a bare 10-point drop rule); log audit of every sealed run.
7. Stopping: interim reports at 6 and 9 beds with a non-binding refutation stop; deadline kept at 2026-11-11.
8. Cost: CPS split into factors; adaptation cost reported separately; meter units recorded; caps re-derived (PLAN §10).
9. K unchanged at 2 (owner rule "no K = 1 comparative proof"); the K = 1 alternative is PLAN §11 OD-4.
10. F-M arm replaced by F-HM (Mercury planner/checker + Haiku acting), conditional on the D18 allowance.
